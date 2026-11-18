# REVIEW_SYNC_DELETE.md

针对本轮两个 P0 的**先读后改**审计。行号取自当前工作区（2026-11-17）。
结论先行：这两处都不是「小瑕疵」，而是**把失败原因归错了**和**把危险操作做成了无防护**。

---

## P0-A 远程同步误报「网络不通」

### A1. 打字机式归因：把所有 fetch 失败压成一句话（严重）

`src/lib/git/repo.ts:412-424`

```ts
if (/Failed to fetch|NetworkError|CORS|ENOTFOUND|timeout/i.test(message)) {
  return new GitError(`网络不通：${message}`, '浏览器模式走 cors.isomorphic-git.org 代理，国内可能被墙；桌面端用 Rust 侧请求没有这个问题。')
}
```

- 五个**完全不同**的失败源（DNS、TLS、超时、CORS、我们自己的适配层异常）被合并成同一句话；
- 提示语直接替用户下了「你网络/被墙」的结论 —— 用户网络明明能开 GitHub，这是**误诊**；
- 正则只看 message 字符串，而 isomorphic-git 的错误里**状态码在 `err.data.statusCode`、URL 在 `err.data.url`**，压根没被读过。

### A2. 适配层异常被伪装成网络问题（严重）

`src/lib/http.ts:6-18`

```ts
try { return await (await import('@tauri-apps/plugin-http')).fetch(input, init) }
catch (err) { console.warn('[http] 插件请求失败，回退到 window.fetch', err) }
return fetch(input, init)
```

- 插件（Rust reqwest）失败后**静默回退**到 `window.fetch`；在 Tauri 里 webview 的 origin 是
  `http://localhost:1420`，直连 `github.com` 必然被 CORS 拦 → 抛 `TypeError: Failed to fetch`
  → 被 A1 归因为「网络不通」。**根因明明是插件调用失败**（capability 没匹配、URL 不在 scope、
  代理没生效等），用户永远看不到。
- 适配层没有 timeout、没有重定向开关、没有把 `status/url/stage` 带出来，
  等于把最需要诊断的信息丢在了这一层。

### A3. 类型断言掩盖参数问题（中）

`repo.ts:227-233 / 281-285 / 298-305 / 313-319` 共 4 处

```ts
} as unknown as Parameters<typeof git.push>[0])
```

`isomorphic-git` 的选项类型把 `http` 标成必填，我们为了“浏览器只给 corsProxy”一路强转。
强转本身让「参数写错」在编译期彻底不可见 —— 正是本轮要求禁止的写法。
（注：运行时只给 `corsProxy` 确实合法，所以需要一个**有注释、有单测**的收敛点，而不是四处 `as unknown as`。）

### A4. 错误分类缺口清单

| 失败类型 | 现象 | 当前处理 |
| --- | --- | --- |
| DNS | `getaddrinfo ENOTFOUND github.com` | 归为「网络不通」 |
| 连接超时 | `UND_ERR_CONNECT_TIMEOUT` / `ETIMEDOUT` | 归为「网络不通」 |
| TLS | `unable to verify the first certificate` / `self signed certificate` | 归为「网络不通」 |
| 系统代理 | `ECONNREFUSED 127.0.0.1:7890` | 归为「网络不通」 |
| 401/403 | `HttpError` + `data.statusCode` | 只在 message 里碰巧含 401 才命中 |
| 404 | `HttpError` + 404 | 同上，容易漏 |
| 分支不存在 | `NotFoundError: Could not find refs/heads/xxx` | 直接抛原始 message |
| CORS 代理失败 | 代理 5xx / 代理不可达 | 归为「网络不通」 |
| 适配层异常 | 插件调用抛错 | 被 A2 伪装成网络问题 |
| merge/fastForward 冲突 | `MergeConflictError`；且 `pull()` 的 catch 把真实原因吞了 | 一律「拉取冲突」 |

`pull()`（`repo.ts:321-340`）尤其糟：`fastForward` 失败后**无差别**去 merge，merge 再失败就说「冲突」。
如果 fastForward 失败是因为 403，用户会得到「先手动解决冲突」的荒谬建议。

### A5. 观测与诊断缺失（中）

- `src/stores/sync.ts:90-94` 的 `fail()` 只留 `message/hint`，`name/status/url/code/cause` 全丢；
- `SyncSection.tsx` 的错误框只渲染一行文字，无法复制、没有下一步、没有「连接诊断」入口；
- 日志（`console.warn`）里可能带完整 URL 与 Authorization 头，**没有脱敏**。

---

## P0-B 删除仓库不能删文件夹

### B1. 只删记录，没有任何删除能力（严重）

`src/stores/vaults.ts:319-339`

```ts
const registry = removeVault(get().registry, id)
set({ registry }); await saveRegistry(registry)
```

- 整个函数**没有一次文件系统调用**：磁盘上的 `papers/`、`.git/`、截图全部留下；
- 对话框 `VaultManagerDialog.tsx:215` 用 `window.confirm('…磁盘上的文件不动')` —— 只能"移除记录"，
  用户想清掉文件夹必须自己去资源管理器里删（还容易删错库）。

### B2. 没有危险路径护栏（严重）

`removeVault` 接收 id 后直接用注册表里的 `rootPath`；若注册表被手工改成
`C:\`、`%APPDATA%`、`Program Files`、`/`、`..`、空串，将来的删除实现会**照删**。
当前代码虽未删盘，但一旦按 B1 补删除功能而不同时补护栏，就是数据灾难。

### B3. 删除当前仓库时的时序错误（高）

`vaults.ts:324-337`：先 `close()` + `reset()`，再开下一个。
- **没有 flush 编辑器**：`NoteSurface` 有 700ms 防抖、标注有 500ms 防抖，正在写的笔记会丢；
- **没有停自动提交**：`useVaultBoot` 的 60s interval 还活着，删除期间可能向正在被删的 `.git` 提交；
- 没有"先切走再删"的顺序保证：若删除过程中 `openEntry` 失败，注册表已经写掉，仓库直接失踪。

### B4. 缺少删除前信息与二次确认（中）

需求要求展示 resolved 绝对路径、文件数、大小、未提交改动数、是否已推送，并要求输入仓库名确认。
现状全无 —— 只有一个 `window.confirm`。

### B5. 没有回收站语义（中）

删除只能是 `remove(recursive)`，不可恢复。需求要求桌面优先走系统回收站；
浏览器 OPFS 没有回收站，必须在 UI 上明说「不可恢复」。

---

## 修复方案（本轮实施）

### 同步

1. **新增 `src/lib/git/errors.ts`**：`GitErrorKind`（auth / forbidden / not-found / branch / network-dns /
   network-timeout / network-tls / network-proxy / cors-proxy / adaptor / conflict / local / unknown）、
   `GitErrorInfo {kind,title,message,hint,status,url,code,cause,retryable}`、`classifyGitError(err, ctx)`、
   `describeGitError(info)`、`redact(text, token)`（抹掉 PAT、`Authorization` 头、`ghp_*`/`github_pat_*`）。
   分类优先级：显式 `kind` → `err.data.statusCode` → `err.name`（HttpError/MergeConflictError/NotFoundError）→
   `cause.code`（ENOTFOUND/EAI_AGAIN/ECONNREFUSED/ETIMEDOUT/CERT_*）→ message 模式 → unknown。
2. **重写 `http.ts`**：去掉静默回退；Tauri 侧失败抛 `HttpAdaptorError`（带 `stage/url/status/cause`）；
   加 `timeoutMs`（AbortSignal）；返回前把 `status/url` 挂在错误上；`describe()` 供诊断面板用。
3. **`repo.ts`**：所有网络操作经 `runGit()` 统一捕获并 `throw classifyGitError(...)`；
   `pull()` 区分「fetch 失败」「fastForward 失败（可能仅是非快进）」「merge 冲突」；
   把四处 `as unknown as` 收敛成一个 `transportOptions()`，并在注释与单测里钉死「浏览器只给 corsProxy 合法」。
4. **`sync.ts`**：state 增 `errorInfo: GitErrorInfo | null`；`fail()` 用 `classifyGitError`；
   新增 `diagnose()`：① API 鉴权（`GET /repos/{owner}/{repo}`）② remoteUrl/branch/PAT 本地校验
   ③ `listServerRefs` 探测 ④ 汇总成可复制的报告（**不含 PAT**）。
5. **`SyncSection.tsx`**：错误卡显示 `title + message`、`status/url`、`kind` 徽章、下一步建议、
   「复制错误」与「连接诊断」按钮；诊断结果面板可一键复制。

### 删除

6. **Rust 命令 `trash_path`**（`trash` crate）：桌面端优先回收站；失败返回错误由前端降级提示。
7. **新增 `src/lib/vault/delete.ts`**：`planVaultDeletion({entry, fs, resolvedPath})` 做**纯逻辑护栏**：
   禁止 `''`、`.`、盘符根、`/`、`..` 越界、`appConfigDir`、`<appConfigDir>/vaults`、ProgramData\ScholarBox、
   `SCHOLARBOX_HOME`、任何「注册表自身所在目录」、OPFS 根、`content://`（未接 SAF）；
   `inspectVaultFolder()` 统计文件数/字节数/未提交改动/是否已推送。
8. **`vaults.removeVault(id, {deleteFolder})`**：顺序改为
   `flush 编辑器 → 停自动提交定时器 → 若删当前：先切到其他仓库/空态 → 删除目录（回收站/rm） →
   最后写注册表`；失败不改注册表并回滚已切状态，返回残留清单。
9. **`VaultManagerDialog`**：删除弹窗二选一（仅移除记录 / 移除并删除文件夹），
   文件夹模式展示绝对路径、文件数、大小、未提交、已推送状态，输入仓库名才可点「永久删除」。

---

## 验收标准

- 分类单测：DNS / 超时 / TLS / 代理 / 401 / 403 / 404 / 分支 / CORS 代理 / 适配层 / 冲突，各自命中不同 kind；
- `redact()` 抹掉 PAT 与 Authorization；
- `http.ts`：插件失败不再回退、错误带 stage/url；
- 删除护栏单测：危险路径全部拒绝（含 `..`、盘符根、appConfigDir、OPFS 根、content://）；
- 删除流程单测：当前仓库切换顺序、失败回滚注册表、OPFS 递归删除；
- `tsc --noEmit` 0 错、`vitest` 只增不减、`npm run build`、`cargo build` 全绿。


---

## 修复结论（2026-11-17 收尾）

| 编号 | 结论 | 落点 |
| --- | --- | --- |
| P0-A1 错误被压成「网络不通」 | 已修：删除正则归因，改为 `classifyGitError` 的 14 类判定 | `src/lib/git/errors.ts` |
| P0-A2 插件失败静默回退 window.fetch | 已修：失败即抛 `HttpAdaptorError('plugin')`，不再回退 | `src/lib/http.ts` |
| P0-A3 四处 `as unknown as Parameters<...>` | 已修：收敛为 `transportOptions()` 里唯一一处 `NO_HTTP` 断言，并由单测钉住 | `src/lib/git/repo.ts` + `repo-transport.test.ts` |
| P0-A4 分类缺口 | 已修：DNS/超时/TLS/代理/CORS/适配层/冲突/本地状态全覆盖 | `errors.ts` + `errors.test.ts`（16 条） |
| P0-A5 无脱敏、无诊断、无复制 | 已修：`redact()`、`formatErrorReport()`、`describeGitError()`、设置页「连接诊断」 | `errors.ts`、`SyncDiagnostics.tsx` |
| P0-B1 `removeVault` 零文件操作 | 已修：`removeVault(id, { deleteFolder })` + 二选一弹窗 | `src/stores/vaults.ts`、`VaultManagerDialog.tsx` |
| P0-B2 无危险路径护栏 | 已修：`guardDeletePath` 拦截配置目录/ProgramData/盘符根/`..`/其他仓库及其父目录/`vaults.json` | `src/lib/vault/delete.ts` + `delete-guard.test.ts`（12 条） |
| P0-B3 删当前仓库时序错 | 已修：flush → 停自动提交 → 切走 → 删目录 → 最后写注册表 | `vaults.ts` |
| P0-B4 无删除前信息/二次确认 | 已修：`inspectVault()` 体检 + 输入仓库名解锁 | `VaultManagerDialog.tsx` |
| P0-B5 无回收站语义 | 已修：桌面 `trash_path`（`trash` crate）、浏览器明确「不可恢复」 | `src-tauri/src/lib.rs`、`delete.ts` |

**过程中被测试逮到的真 bug（都已修）**

1. `raw.data.response` 里才是服务端原文，只看 `err.message` 会漏掉 `API rate limit exceeded` → 403 被误判成 `forbidden`。
2. 浏览器端 `TypeError: Failed to fetch` 被归到 `network` → 现在归 `cors-proxy`（浏览器所有请求都过代理）。
3. `formatErrorReport()` 会把 `meta` 原样拼进报告，`token` 直接泄露 → 改为过滤敏感键 + 整体 `redact()`。
4. `guardDeletePath` 的包含关系只查了一个方向，导致「配置目录里的路径」和「父目录包含另一个仓库」两种情况漏网。
5. OPFS 根句柄不支持 `removeEntry('')`（`Name is not allowed`）→ 改为拿到**父目录**再按名字删，实测 `OPFS_MyVault_EXISTS=false`。

**验收**

- `tsc --noEmit` 0 error；`vitest` **249 passed**（原 217 + 新增 32）；`npm run build` 通过；`cargo check` 通过（含新命令 `trash_path`）。
- 浏览器实测：删除弹窗二选一、体检数字（18 个文件 · 19 KB · 还不是 Git 仓库）、输入仓库名解锁、删除后 `OPFS://MyVault` 目录确实消失、注册表只剩另一个仓库。
- 未做：真实 GitHub 两端联调（需要用户 PAT 授权）；桌面端回收站路径（`trash_path`）已编译但未在真机点过。
