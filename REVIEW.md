# 上线前缺陷审计（v0.1.x）

审计方式：只读代码 + 现有测试（`vitest` 168/168 全绿）。先出清单，再修 P0/P1。
下面每条都标了**是否已验证**——凡是没有在本机跑通的，一律写「未验证」，不写「逻辑上应该没问题」。

---

## 修复清单（逐条结论）

| 编号 | 结论 | 回归测试 |
| --- | --- | --- |
| P0-1 回滚 | 已修 | `src/stores/__tests__/vaults-path-rollback.test.ts`（3 条） |
| P0-2 探针先授权 | 已修 | `src/lib/vault/__tests__/path-check.test.ts`（4 条） |
| P1-1 mymemory 白名单 | 已修 | 无单测（配置文件；**未验证**：需 `tauri build`） |
| P1-2 appconfig 权限 | 已修 | 无单测（配置文件；**未验证**：需 `tauri build`） |
| P1-3 content:// 提示 | 已修 | `src/stores/__tests__/vault-entry.test.ts`（5 条） |
| P1-4 改路径清 Git 状态 | 已修 | `vaults-path-rollback.test.ts`（2 条） |
| P1-5 并发保护 | 已修 | `vaults-path-rollback.test.ts`（1 条） |
| P2-1 ~ P2-3 | **已修**（2026-11-17 收尾） | 见下方各条的「状态」 |
| P2-4 ~ P2-6 | 审计确认无问题 | — |

---

## P0（丢数据 / 崩溃）

### P0-1 改仓库路径失败后，注册表停留在坏路径，仓库等于丢了

- `src/stores/vaults.ts:247-259`（`updateVaultPath`）
- 复现：桌面端 M 仓库路径为 `D:\ok`，用户改成 `E:\moved`（探针通过，因为目录可写）→ 写入 `vaults.json` →
  `openEntry` 因为目录里 `papers/` 创建失败 / scope 被拒 / 权限变化而返回 `false` →
  注册表里 `rootPath` 已经是 `E:\moved`，`activeId` 仍指向它，但内存里的 `VaultFS` 已经 `close()`。
  用户重启后仍是坏路径，只能手改 `vaults.json` 才能回到 `D:\ok`。
- 影响：单仓库用户「丢仓库」；多仓库用户需要手工编辑注册表。
- 修复建议：`saveRegistry` 之后 `openEntry` 失败时，把 `vaults.json` 回滚为旧 entry 并重新打开旧路径；
  回滚本身再失败时，至少把内存 registry 回滚并把错误抛给 UI。
- 状态：**已修**（回滚 + 旧路径重开 + 回滚失败时保留内存旧值）。回归测试 `vaults-path-rollback.test.ts`。

### P0-2 桌面端 `probe` 在授权之前跑，自定义绝对路径会被误判为「不可写」

- `src/lib/vault/path-check.ts:39-56`（`probeDesktop`）、`src/stores/vaults.ts:142`、`:230`（调用点）
- 复现：桌面端新建仓库填 `D:\papers\MyVault`。探针直接调 `mkdir/writeTextFile`，
  但此时 `allow_vault_scope` 还没执行（它只在 `openEntry` 里跑），
  `fs:scope` 只放开 `$HOME/$DOCUMENT/$DESKTOP/$DOWNLOAD`，于是抛 `forbidden path`，
  UI 显示「目录不可写」，而实际上用户完全有权限。
- 影响：**桌面端自定义路径功能整体不可用**，且错误信息误导。
- 根本原因：探针和 `openEntry` 没有共用「先授权、再访问」的顺序。
- 修复建议：把 scope 授权抽成 `grantFsScope(path)`，probe 在 `mkdir` 之前先授权。
- 状态：**已修**（`src/lib/fs/tauri.ts` 新增 `grantFsScope`，`probeDesktop` 先授权）。回归测试 `path-check.test.ts`。

---

## P1（功能错误）

### P1-1 capabilities 缺 `api.mymemory.translated.net`，桌面端默认翻译服务被拦

- `src-tauri/capabilities/default.json:36-45`（`http:default` 白名单）
- 复现：桌面端划词翻译，默认 provider 是 `mymemory`（`src/lib/translate.ts:87`），
  请求 `https://api.mymemory.translated.net/get`，不在 http scope 内 → 被插件拒绝。
  浏览器模式同样请求，但走 `window.fetch`，不受 Tauri 限制，所以**浏览器永远测不出这个 bug**。
- 状态：**已修**（白名单补 `api.mymemory.translated.net`，同时补 `api.mymemory.translated.net` 的宽路径）。

### P1-2 注册表写入 `$APPCONFIG` 缺显式权限

- `src/lib/vault/registry.ts` 的 `readRaw/writeRaw` 用 `baseDir: BaseDirectory.AppConfig`；
  `src-tauri/capabilities/default.json` 只给了 `fs:default` + `$HOME/$DOCUMENT/...` 的 path scope，
  没有 app-config 的读写权限与 `$APPCONFIG/**` scope。
- 影响：桌面端 `vaults.json` 可能写不进去 → 每次启动都回到「迁移默认仓库」。
  相对路径仓库解析到 `appConfigDir/vaults/<name>` 时，目录创建也会被 scope 拒绝。
- 状态：**已修**（补 `fs:allow-appconfig-*` 与 `$APPCONFIG/**`）。**未验证**：本机无 Rust 工具链，
  未能 `cargo build` 验证权限标识符是否被 Tauri 2 接受；若标识符拼写有出入，`tauri build` 会直接报错，不会静默放行。

### P1-3 `content://` 仓库没有明确提示

- `src/stores/vault.ts:46-70`（`openEntry`）
- 复现：注册表里存了 `content://com.android/tree/x`（Android SAF 预留），当前后端没有 SAF 桥接 →
  `new TauriVaultFS('content://…')` → `invoke('allow_vault_scope')` 参数非法 → 后续 `mkdir('')` 抛插件错误，
  用户看到的是 `forbidden path` 之类，不知道是「没接 SAF」。
- 状态：**已修**（入口处识别 `content://` 直接抛「当前后端未接入 SAF」）。回归测试 `vault-entry.test.ts`。

### P1-4 改路径后 Git 状态没重置，同步面板会显示上一个目录的历史

- `src/stores/vaults.ts:247-266`：`updateVaultPath` 只 `close()` + `reset()` 了 vault/library/notes，
  没有像 `switchTo` 那样清空 `useSyncStore`（`connected/branch/remote/history/lastSyncAt`）。
- 复现：MyVault 连过仓库、有 3 条历史 → 改路径为 MyVault-2026（空目录）→ 同步面板仍显示「已连接 · main」
  与旧历史；点「提交」会在新目录里 `initRepo`，历史串台。
- 状态：**已修**（抽出 `resetSyncState()`，`switchTo` 与 `updateVaultPath` 共用）。回归测试同上。

### P1-5 两个入口没有并发保护

- `src/stores/vaults.ts:116`（`createVault`）、`:206`（`updateVaultPath`）
- 复现：连续点两次「应用路径」/「创建仓库」，第二次在第一次 `probe` 期间进入，
  两次都会写注册表，最后一次赢——中间那次已经 `close()` 了 FS 但没重开，UI 空白。
- 状态：**已修**（入口 `if (get().busy) return false`，并 `set({busy:true})` 提前到 probe 之前）。

---

## P2（不影响数据，记录待办）

- **P2-1** `src/lib/vault/paths.ts`（`resolveRootPath`）：`baseDir` 为空字符串时拼出 `/vaults/x`，
  会指向根目录。当前 `appConfigBaseDir()` 失败时回落到 `documentDir()`，两个都失败才会触发，概率极低。
  - 状态：**已修**。新增 `PathError`，相对路径分支在拼 `vaults/` 前 `if (!baseDir) throw`；两个调用方各自转成
    `{ok:false, reason}` / `FsError`，绝不再「看起来成功」。回归：`paths.test.ts` 23 条（新增 2 条）。
- **P2-2** `src/lib/vault/path-check.ts`：失败的探针文件只在「读失败」分支删除；
  若 `write` 成功但进程被杀，会在用户目录留下 `.scholarbox-path-probe`（无害，下次覆盖）。
  - 状态：**已修**。`probeDesktop` 改成 `try/finally`：写成功就一定尝试删除（读失败也删），删除失败只 warn 不改结论，
    写都没成功则完全不去碰那个目录。回归：`path-check.test.ts` 8 条（新增 4 条）。
- **P2-3** `src/stores/ui.ts`：`notesFilter/notesSort`、`library filter` 在切换仓库时不重置，
  新仓库会继承上一个仓库的筛选条件（会让用户以为「新仓库是空的」）。属体验问题。
  - 状态：**已修**。`src/stores/vaults.ts` 的 `switchTo` / `updateVaultPath` 在重载前调用
    `useLibraryStore.getState().resetFilter()`、`useUiStore.getState().resetNotesFilter()`，
    并清空搜索框与分组状态（`papersGrouped/notesGrouped` 保持用户习惯，属视图偏好不属筛选）。
- **P2-4** `src/lib/git/repo.ts`：`isomorphic-git` 没有模块级缓存（每次调用都经 `createGitFs(vault)`），
  `polyfill.ts` 有 `typeof` 守卫，重复导入安全 —— 本次审计**确认没有**「dir 缓存旧 vault」与「polyfill 执行多次」的问题。
- **P2-5** PAT：代码里没有把 token 写进任何 `console.*` 调用（`repo.ts` 无日志），
  `onAuth` 只把 token 交给 isomorphic-git；注册表落盘在 `$APPCONFIG`（不进仓库）。本次审计**确认无泄露**。
- **P2-6** 文献笔记元数据缓存：`papers` 由 `library.reset()+load()` 整体重建，
  `pinned/lastViewedAt` 存在各自仓库的 `meta.json` 里 → 天然隔离；`resetViewedThrottle()` 在 `library.reset()` 首行调用。本次审计**确认无串仓**。

---

## 验证记录

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit` | 通过（0 错误） |
| `vitest run` | **186 passed**（16 文件，原 168 + 新增 18） |
| `npm run build` | 通过（993 ms） |
| 桌面端 `cargo build` | **未运行**：本机没有 Rust 工具链 |
| 桌面端真实自定义路径 | **未验证**：同上，仅完成浏览器端与单元测试 |

## 桌面端实测（本次补齐，Rust 工具链装好后）

前一轮这些结论都标注为「未验证」，现在全部在真机跑过：

| 项 | 结论 |
|---|---|
| P0-2 探针前先授权 | ✅ 用 `F:\sb-vault` 建仓库时探针通过，目录自动生出 `papers/` + `vault.json` |
| P1-2 `$APPCONFIG` 写权限 | ✅ `%APPDATA%\app.scholarbox.desktop\vaults.json` 正常落盘 |
| `fs:allow-appconfig-mkdir` | ❌ 该标识符**不存在**（实测 `cargo check` 报 `Permission ... not found`），已删掉，改用它承认的 `read/write(-recursive)` |
| 自定义绝对路径 | ✅ `F:\sb-vault` / `F:/sb-vault-b` 都能建、能切、能读 |
| 相对路径解析 | ✅ 生成在 `<appConfigDir>\vaults\SchemaBox\MyVault`（走 `defaultPath` 那条分支） |

### 本轮新发现并修掉的问题

1. **WebView2 在非 ASCII 应用目录下无法初始化** —— exe 放在 `F:\项目\AI AGENT\文献阅读app开发` 里报 `HRESULT(0x8000FFFF) 灾难性故障`，拷到 `F:\sb-ascii-test\` 就正常。打包时必须强制 ASCII 安装路径。
2. **`tauri-plugin-http` 默认开 `cookies`**，启动时往缓存目录写 `.cookies` 失败 → 整个 app 起不来。改为 `default-features = false`。
3. **`lib.rs` 里 store 插件一直是注释状态** → 设置从未写进 `settings.json`，静默退回 localStorage。已启用。
4. **http 白名单用 `https://github.com/*`（单星不跨段）** → git 的 `info/refs` 全被 CORS 拦。改 `/**` 后走 Rust 侧 HTTP。
5. **`connect()` 只做本地 `git.init`**，错 Token 要等 push 才暴露（用户以为连上了）。现在 `verifyRemote()` 会拿 `api.github.com/repos/{owner}/{repo}` 真验一次，401/404 当场给出明确文案。

### 一个**误报**，记在这里免得后人重踩

先前我判定「推送后中文文件名为 GBK 乱码」，实际是**我的控制台按 GBK 打印 UTF-8 字节**造成的假象。字节级复核：

- 本地提交对象：`zlib.decompress(.git/objects/…)` → 消息字节 `e7ac94 e8aeb0 e69bb4 e696b0` = 「笔记更新」✅
- GitHub 上 `note.md` 内容 sha256 与本地一致、`notes/未命名笔记.md` 路径字节 `e69caa e591bd e5908d e7ac94 e8aeb0` = 「未命名笔记」✅
- 推送后的远端 HEAD 与本地 `refs/heads/main` **同一个 SHA**（`8148e9a…`）→ 传输字节完全一致

结论：Git 同步对 UTF-8 是无损的，不需要修。
