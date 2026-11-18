import './polyfill'
import git from 'isomorphic-git'

import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git'
import type { VaultFS } from '@/lib/fs/types'
import { createGitFs } from './fs'
import { gitHttpFetch, isTauriRuntime } from '@/lib/http'
import { logSync } from '@/lib/log'
import {
  classifyGitError,
  GitOperationError,
  type GitAction,
  type GitErrorInfo,
} from './errors'

/**
 * Git 同步的薄封装。刻意只暴露「文献库同步」需要的操作：
 * 提交全部改动、推送、拉取、读历史。不做分支管理、不做 merge 策略选择 ——
 * 这是个人文献库，不是协作仓库。
 */

const REMOTE = 'origin'

/** 浏览器里直连 GitHub 会被 CORS 拦掉，走官方公共代理；桌面端用 Rust 侧 http 插件 */
export const DEFAULT_CORS_PROXY = 'https://cors.isomorphic-git.org'

export interface GitIdentity {
  name: string
  email: string
}

export interface GitRemoteConfig {
  /** 形如 https://github.com/owner/repo.git */
  url: string
  branch: string
  token: string
  /** 仅在浏览器端生效；桌面端走 Rust HTTP，不经过代理 */
  corsProxy?: string
}

export interface GitChangeSummary {
  added: number
  modified: number
  deleted: number
  /** 有未提交改动的文件路径（最多 50 条，用于界面展示） */
  files: string[]
}

export interface CommitSummary {
  oid: string
  short: string
  message: string
  author: string
  email: string
  timestamp: number
  files: number
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

function fsOf(vault: VaultFS) {
  return createGitFs(vault)
}

type GitFs = ReturnType<typeof fsOf>

function stamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 本地 HEAD 的提交；仓库刚 init、还没有第一个 commit 时返回 null */
async function headOid(fs: GitFs): Promise<string | null> {
  try {
    const oid = await git.resolveRef({ fs, dir: '', ref: 'HEAD' })
    return oid || null
  } catch {
    return null
  }
}

/** `ancestor` 是不是 `oid` 的祖先（相等也算） */
async function isAncestorOf(fs: GitFs, ancestor: string, oid: string): Promise<boolean> {
  if (ancestor === oid) return true
  try {
    return await git.isDescendent({ fs, dir: '', oid, ancestor, depth: -1 })
  } catch {
    return false
  }
}

/** 远端分支不存在（首次推送）≠ 网络错误，这里必须分开 */
function isMissingRef(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  const code = String((err as { code?: string } | null)?.code ?? '')
  return name === 'NotFoundError' || /NotFoundError/.test(code)
}

function isPushRejected(err: unknown): boolean {
  const raw = err as { name?: string; code?: string; message?: string } | null
  if (!raw) return false
  if (raw.name === 'PushRejectedError' || raw.code === 'PushRejectedError') return true
  return /not a simple fast-forward|non-fast-forward/i.test(raw.message ?? '')
}

function isMergeConflict(err: unknown): boolean {
  const raw = err as { name?: string; code?: string } | null
  return raw?.name === 'MergeConflictError' || raw?.code === 'MergeConflictError'
}

/** 桌面端：把 Rust side 的 fetch 包成 isomorphic-git 要的异步流式响应 */
function httpClient(): HttpClient {
  return {
    async request(request: GitHttpRequest): Promise<GitHttpResponse> {
      const chunks: Uint8Array[] = []
      if (request.body) {
        for await (const chunk of request.body) chunks.push(chunk)
      }
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const payload = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        payload.set(chunk, offset)
        offset += chunk.byteLength
      }
      const response = await gitHttpFetch(request.url, {
        method: request.method ?? 'GET',
        headers: request.headers ?? {},
        body: payload.byteLength > 0 ? payload : undefined,
      })
      const buffer = new Uint8Array(await response.arrayBuffer())
      return {
        url: request.url,
        method: request.method ?? 'GET',
        headers: Object.fromEntries(response.headers.entries()),
        body: (async function* () {
          yield buffer
        })(),
        statusCode: response.status,
        statusMessage: response.statusText,
      }
    },
  }
}

function authFor(token: string) {
  return () => ({ username: 'x-access-token', password: token })
}

interface TransportOptions {
  http: HttpClient
  corsProxy?: string
}

/**
 * 浏览器端没有 Rust HTTP：isomorphic-git 在 `http` 为 falsy 时会自动改用 `corsProxy`。
 * isomorphic-git 的类型把 `http` 标成必填，所以这里必须放一个 `undefined`。
 *
 * **全项目只允许这一个断言**（上一轮四处 `as unknown as Parameters<typeof git.push>[0]`
 * 会把真正的参数错误掩盖掉）。行为由 `repo-transport.test.ts` 钉住：
 * - 桌面端：给 `http`，不给 `corsProxy`（绝不走代理）
 * - 浏览器端：`http` 为 undefined，给 `corsProxy`
 */
const NO_HTTP = undefined as unknown as HttpClient

/** 传输层选择：桌面走 Rust HTTP（无 CORS），浏览器走可配置的 corsProxy。
 *  导出是为了让单测钉住「桌面不给 corsProxy / 浏览器不给 http」这条规则。 */
export function transportOptions(remote: GitRemoteConfig): TransportOptions {
  if (isTauriRuntime()) return { http: httpClient() }
  return { http: NO_HTTP, corsProxy: remote.corsProxy?.trim() || DEFAULT_CORS_PROXY }
}

function contextOf(remote: GitRemoteConfig, action: GitAction) {
  return {
    action,
    url: remote.url,
    corsProxy: remote.corsProxy ?? (isTauriRuntime() ? null : DEFAULT_CORS_PROXY),
    runtime: (isTauriRuntime() ? 'tauri' : 'browser') as 'tauri' | 'browser',
    token: remote.token,
    branch: remote.branch,
  }
}

/** 统一出口：任何 Git/网络错误都转成带分类的 `GitOperationError` */
function toGitError(err: unknown, remote: GitRemoteConfig, action: GitAction): never {
  if (err instanceof GitError) throw err
  throw new GitOperationError(classifyGitError(err, contextOf(remote, action)))
}

export function repoUrl(owner: string, repo: string): string {
  const clean = (value: string) => value.trim().replace(/^\/+|\/+$/g, '')
  if (!owner || !repo) throw new GitError('仓库地址不完整', '需要 owner 和 repo 两段，例如 octocat/MyVault')
  return `https://github.com/${clean(owner)}/${clean(repo)}.git`
}

export async function isRepo(vault: VaultFS): Promise<boolean> {
  return vault.exists('.git/HEAD')
}

/** 初始化仓库并绑定 origin / 分支 */
export async function initRepo(vault: VaultFS, remote: GitRemoteConfig): Promise<void> {
  const fs = fsOf(vault)
  try {
    if (!(await isRepo(vault))) {
      await git.init({ fs, dir: '', defaultBranch: remote.branch || 'main' })
      // 让 git 自己也能忽略这些：桌面端的 .git 同样可能被用户用命令行操作
      const ignore = ['node_modules/', '.DS_Store', 'Thumbs.db', '*.tmp', ''].join('\n')
      if (!(await vault.exists('.gitignore'))) await vault.writeText('.gitignore', ignore)
    }
    await git.setConfig({ fs, dir: '', path: `remote.${REMOTE}.url`, value: remote.url })
    const branch = remote.branch || 'main'
    const head = (await git.currentBranch({ fs, dir: '', fullname: false })) || null
    if (head !== branch) {
      const branches = await git.listBranches({ fs, dir: '' })
      if (branches.includes(branch)) await git.checkout({ fs, dir: '', ref: branch })
    }
  } catch (err) {
    if (err instanceof GitError) throw err
    // git.init / setConfig 这类本地操作失败基本都是仓库状态问题，不归网络
    throw new GitOperationError(
      classifyGitError(err, { ...contextOf(remote, 'connect'), action: 'connect' }),
    )
  }
}

/** 本地有没有未提交改动 */
export async function changeSummary(vault: VaultFS): Promise<GitChangeSummary> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) return { added: 0, modified: 0, deleted: 0, files: [] }
  const rows = await git.statusMatrix({ fs, dir: '' })
  const files: string[] = []
  let added = 0
  let modified = 0
  let deleted = 0
  for (const [filepath, head, workdir, stage] of rows) {
    if (head === 0 && workdir === 2) {
      added += 1
      files.push(filepath)
      continue
    }
    if (head === 1 && workdir === 0) {
      deleted += 1
      files.push(filepath)
      continue
    }
    // 工作区和暂存区/HEAD 有一个不一样就算改动
    if (workdir === 0 || head !== workdir || stage !== workdir) {
      modified += 1
      files.push(filepath)
    }
  }
  return { added, modified, deleted, files: files.slice(0, 50) }
}

export interface CommitResult {
  oid: string
  files: number
}

/**
 * 把工作区所有改动一次性提交。没有改动时返回 null —— 调用方据此决定要不要提示。
 */
export async function commitAll(
  vault: VaultFS,
  message: string,
  author: GitIdentity,
): Promise<CommitResult | null> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) throw new GitError('这个文献库还没有初始化 Git', '先在同步设置里点「连接仓库」')
  const rows = await git.statusMatrix({ fs, dir: '' })
  let changes = 0
  for (const [filepath, head, workdir, stage] of rows) {
    if (workdir === 0) {
      if (head !== 0) {
        await git.remove({ fs, dir: '', filepath })
        changes += 1
      }
      continue
    }
    if (head === 1 && workdir === 1 && stage === 1) continue
    if (filepath.startsWith('.git/')) continue
    await git.add({ fs, dir: '', filepath })
    changes += 1
  }
  if (changes === 0) return null
  const oid = await git.commit({
    fs,
    dir: '',
    message,
    author: { name: author.name, email: author.email },
  })
  if (!oid) return null
  return { oid, files: changes }
}

export async function currentBranch(vault: VaultFS): Promise<string | null> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) return null
  const branch = await git.currentBranch({ fs, dir: '', fullname: false })
  return branch || null
}

/**
 * 校验「设置里的分支」在本地真实存在。
 *
 * 这个检查很土，但能挡掉最常见的一类「同步没反应」：设置里把分支名填成 `master`，
 * 本地却只有 `main` —— isomorphic-git 解析 refs/heads/master 直接抛 NotFoundError，
 * 既不写 ref 也不产生任何可见痕迹，用户只会看到「不行」。
 */
async function assertLocalBranch(fs: GitFs, branch: string): Promise<void> {
  const local = await git.listBranches({ fs, dir: '' })
  if (local.length === 0) return // 还没有第一条提交，首次推送会创建分支
  if (local.includes(branch)) return
  const current = (await git.currentBranch({ fs, dir: '', fullname: false })) || local[0]
  throw new GitError(
    `设置里的分支「${branch}」在本地不存在`,
    `本地现在有：${local.join('、')}（当前在「${current}」）。把设置里的分支改成「${current}」，或者先去「分支」里新建「${branch}」。`,
  )
}

/**
 * 问一次远端：把远端分支的 tip 拉回本地对象库，返回它的 oid。
 * 分支还不存在（远端空仓库）返回 null —— 首次推送会创建它，不是错误。
 */
async function fetchRemoteTip(vault: VaultFS, remote: GitRemoteConfig): Promise<string | null> {
  const fs = fsOf(vault)
  const branch = remote.branch || 'main'
  await assertLocalBranch(fs, branch)
  logSync('fetch.start', { url: remote.url, branch, runtime: isTauriRuntime() ? 'tauri' : 'browser' })
  try {
    const result = await git.fetch({
      fs,
      dir: '',
      remote: REMOTE,
      // 显式给 url：`.git/config` 里的 remote.origin.url 可能是旧的/被改坏的，
      // 以前 fetch 只认 config，配置一错就报「requires a remote OR url」。
      url: remote.url,
      ref: branch,
      singleBranch: true,
      onAuth: authFor(remote.token),
      ...transportOptions(remote),
    })
    logSync('fetch.ok', { branch, fetchHead: result.fetchHead ?? null })
    return result.fetchHead ?? null
  } catch (err) {
    if (isMissingRef(err)) {
      logSync('fetch.no-branch', { branch })
      return null
    }
    logSync('fetch.fail', { branch, error: (err as Error)?.message ?? String(err) })
    toGitError(err, remote, 'fetch')
  }
}

/**
 * 把远端树里本地还没有的文件补到工作区（只补缺的，绝不覆盖本地内容）。
 *
 * 「本地没有」在这里既可能是「用户从没同步过」也可能是「用户删掉了」，
 * 无法区分；修复历史时一律按「补回来」处理 —— 多发一个文件，比悄悄删掉远端文件安全。
 */
async function materializeMissing(vault: VaultFS, tip: string): Promise<string[]> {
  const fs = fsOf(vault)
  const written: string[] = []
  await git.walk({
    fs,
    dir: '',
    trees: [git.TREE({ ref: tip })],
    map: async (filepath, entries) => {
      const entry = entries?.[0]
      if (!entry || filepath === '.') return
      if ((await entry.type()) !== 'blob') return
      if (await vault.exists(filepath)) return
      const content = await entry.content()
      if (!content) return
      const slash = filepath.lastIndexOf('/')
      if (slash > 0) await vault.mkdir(filepath.slice(0, slash))
      await vault.writeBytes(filepath, content)
      written.push(filepath)
      return
    },
  })
  return written
}

export interface AdoptResult {
  branch: string
  /** 修复后产生的提交；本地内容和远端历史完全一致时是 null（不造空提交） */
  oid: string | null
  /** 从远端补下来的文件（本地原本没有的） */
  materialized: string[]
  /** 旧本地 HEAD 被备份到哪个引用（`refs/scholarbox/backup/*`），没有旧提交时为 null */
  backupRef: string | null
}

/**
 * 把「本地这段历史」与远端 tip 接起来 —— 造一个双父提交（父 = 远端 tip + 本地 HEAD）。
 *
 * 用在两边**没有共同祖先**的时候（典型场景：GitHub 上建仓库时勾了 README，
 * 而本机的 `.git` 是新建的）。Git 会拒绝这种推送（`PushRejectedError`），
 * isomorphic-git 的 merge 也不支持合并无关历史，所以这里手工造那个「合并提交」：
 * 第一父是远端 tip（推送因此变成快进），第二父是本地 HEAD（本地历史照样可追溯）。
 *
 * 三条安全线：
 * 1. 远端有、本地没有的文件先补到工作区，提交时它们不会被删掉；
 * 2. 本地有、远端也有的文件，保留本地内容（本地优先，用户看到的就是本地的）；
 * 3. 旧的本地 HEAD 备份到 `refs/scholarbox/backup/<时间戳>`，历史随时能找回。
 */
export async function adoptRemoteHistory(
  vault: VaultFS,
  tip: string,
  author: GitIdentity,
  message = `接上远端历史 · ${stamp()}`,
): Promise<AdoptResult> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) throw new GitError('这个文献库还没有初始化 Git', '先在同步设置里点「连接仓库」')
  const head = await headOid(fs)
  const branch = (await git.currentBranch({ fs, dir: '', fullname: false })) || 'main'

  // 幂等：本地历史里已经有远端 tip 了，什么都不用做
  if (head && (await isAncestorOf(fs, tip, head))) {
    return { branch, oid: null, materialized: [], backupRef: null }
  }

  let backupRef: string | null = null
  if (head) {
    backupRef = `refs/scholarbox/backup/${Date.now()}`
    try {
      await git.writeRef({ fs, dir: '', ref: backupRef, value: head, force: true })
    } catch {
      backupRef = null
    }
  }

  const materialized = await materializeMissing(vault, tip)

  // 索引里还是旧本地提交的树。按工作区当前内容整体重建，避免提交出「半新半旧」的快照。
  const rows = await git.statusMatrix({ fs, dir: '' })
  const dirty = rows.some(([, head0, workdir, stage]) => head0 !== 1 || workdir !== 1 || stage !== 1)
  for (const [filepath, , workdir] of rows) {
    if (filepath.startsWith('.git/')) continue
    if (workdir === 0) await git.remove({ fs, dir: '', filepath })
    else await git.add({ fs, dir: '', filepath })
  }

  // 本地还没有任何提交、工作区也和远端一致：直接把分支指过去就行，不造空提交
  if (!head && !dirty) {
    await git.writeRef({ fs, dir: '', ref: `refs/heads/${branch}`, value: tip, force: true })
    return { branch, oid: null, materialized, backupRef }
  }

  const created = await git.commit({
    fs,
    dir: '',
    message,
    author: { name: author.name, email: author.email },
    parent: head ? [tip, head] : [tip],
  })

  return { branch, oid: created || null, materialized, backupRef }
}

export type IntegrateOutcome = 'up-to-date' | 'fast-forward' | 'merged' | 'adopted'

export interface IntegrateResult {
  outcome: IntegrateOutcome
  adopt?: AdoptResult
}

/**
 * 把远端的提交接到本地（拉取 / 推送被拒后的修复都走这里）。
 *
 * - 本地已经包含远端 tip → up-to-date
 * - 有共同祖先 → 正常合并（本地落后时直接快进）
 * - 没有共同祖先 → `adoptRemoteHistory()` 把远端历史接成本地基底
 */
export async function integrateRemote(
  vault: VaultFS,
  remote: GitRemoteConfig,
  author: GitIdentity,
): Promise<IntegrateResult> {
  const fs = fsOf(vault)
  const branch = remote.branch || 'main'
  const tip = await fetchRemoteTip(vault, remote)
  if (!tip) return { outcome: 'up-to-date' }

  const head = await headOid(fs)
  if (head && (await isAncestorOf(fs, tip, head))) return { outcome: 'up-to-date' }

  const bases = head ? await git.findMergeBase({ fs, dir: '', oids: [head, tip] }) : []
  if (head && bases.length > 0) {
    try {
      const result = await git.merge({
        fs,
        dir: '',
        ours: branch,
        theirs: tip,
        fastForward: true,
        fastForwardOnly: false,
        author: { name: author.name, email: author.email },
        message: `合并远端 ${branch} · ${stamp()}`,
      })
      // ⚠️ merge 只写 ref 和索引，不动工作区；不 checkout 的话下一次提交会把远端改动「改回去」
      await git.checkout({ fs, dir: '', ref: branch })
      return { outcome: result.fastForward ? 'fast-forward' : 'merged' }
    } catch (err) {
      const info = classifyGitError(err, contextOf(remote, 'pull'))
      if (isMergeConflict(err) || info.kind === 'conflict' || info.kind === 'unknown') {
        throw new GitOperationError({
          ...info,
          kind: 'conflict',
          title: '拉取冲突',
          hint: '本地和远端都改过同一批文件。先提交本地改动，再拉取并手动合并 —— ScholarBox 不会替你丢弃任何一边。',
          retryable: false,
        })
      }
      throw new GitOperationError(info)
    }
  }

  const adopt = await adoptRemoteHistory(vault, tip, author)
  logSync('integrate.adopted', { tip, materialized: adopt.materialized.length, oid: adopt.oid })
  return { outcome: 'adopted', adopt }
}

export interface PushResult {
  /** 推送前是否顺手修过历史；false 表示一次就推上去了 */
  repaired: false | IntegrateOutcome
  adopt?: AdoptResult
}

/** 只推一次，不做任何修复 —— 失败原样抛出，由 `push()` 决定要不要修 */
async function pushOnce(vault: VaultFS, remote: GitRemoteConfig): Promise<void> {
  const fs = fsOf(vault)
  const branch = remote.branch || 'main'
  await assertLocalBranch(fs, branch)
  logSync('push.start', { url: remote.url, branch })
  try {
    await git.push({
      fs,
      dir: '',
      remote: REMOTE,
      // 同上：用注册表里的地址，不信 `.git/config` 里可能过期的值
      url: remote.url,
      ref: branch,
      onAuth: authFor(remote.token),
      ...transportOptions(remote),
    })
    logSync('push.ok', { branch })
  } catch (err) {
    toGitError(err, remote, 'push')
  }
}

/**
 * 这个推送错误是不是「非快进」—— 需要先接上远端历史再重试。
 *
 * 必须同时认两种形状：`pushOnce` 会把原始错误包成 `GitOperationError`（带分类），
 * 只看 `err.name === 'PushRejectedError'` 会漏掉包装后的那一层，
 * 于是「自动修复」永远不触发（这正是修复前推送一直失败的原因）。
 */
export function needsRemoteHistoryMerge(err: unknown): boolean {
  if (err instanceof GitOperationError) return err.info.kind === 'push-rejected'
  return isPushRejected(err)
}

/**
 * 推送。被 Git 以「非快进」拒绝时**自动修复再重试一次**：
 * 拉回远端 tip → 接到本地历史后面 → 重新推送。
 *
 * 之前这里直接把 `PushRejectedError` 抛给用户，而仓库的实际情况（远端有
 * 本地没有的历史）用户几乎不可能自己判断，于是「推送」永远是坏的。
 */
export async function push(
  vault: VaultFS,
  remote: GitRemoteConfig,
  author?: GitIdentity,
): Promise<PushResult> {
  try {
    await pushOnce(vault, remote)
    return { repaired: false }
  } catch (err) {
    logSync('push.rejected', {
      error: (err as Error)?.message ?? String(err),
      kind: err instanceof GitOperationError ? err.info.kind : 'raw',
    })
    if (!needsRemoteHistoryMerge(err)) throw err
  }

  const writer = author ?? { name: 'ScholarBox', email: 'scholarbox@localhost' }
  logSync('push.repair.start', { url: remote.url, branch: remote.branch })
  const integrated = await integrateRemote(vault, remote, writer)
  await pushOnce(vault, remote)
  logSync('push.repair.ok', { outcome: integrated.outcome })
  return { repaired: integrated.outcome, adopt: integrated.adopt }
}

export interface RemoteCheck {
  id: string
  label: string
  ok: boolean
  detail: string
}

/**
 * 连仓库时顺手验证一下远端能不能访问。
 * 不做这一步的话，`connect()` 只是本地 `git.init`，错 Token 要等到第一次 push 才暴露，
 * 用户会以为「连接成功」了。这里只列分支（`listServerRefs`），不搬数据，很轻。
 */
export async function verifyRemote(
  _vault: VaultFS,
  remote: GitRemoteConfig,
): Promise<RemoteCheck[]> {
  if (!remote.url) return [{ id: 'remote-url', label: '远端地址', ok: false, detail: '还没有填写远端地址' }]
  return diagnoseRemote(remote)
}

/**
 * 四步诊断，返回逐条结果而不是抛错 —— 「连接诊断」面板直接渲染它。
 * 桌面端额外问一次 GitHub API（带 Authorization 也不会踩 CORS）。
 */
export async function diagnoseRemote(remote: GitRemoteConfig): Promise<RemoteCheck[]> {
  const checks: RemoteCheck[] = []
  const parsed = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/.exec(remote.url)

  checks.push({
    id: 'remote-url',
    label: '远端地址',
    ok: /^https:\/\/.+\.git$|^https:\/\/.+$/.test(remote.url),
    detail: remote.url || '（空）',
  })
  checks.push({
    id: 'branch',
    label: '分支',
    ok: Boolean(remote.branch),
    detail: remote.branch || '（空）',
  })
  checks.push({
    id: 'token',
    label: '访问令牌',
    ok: remote.token.trim().length >= 20,
    detail: remote.token ? `已填写（${remote.token.trim().length} 字符，不显示内容）` : '（空）',
  })

  if (parsed && remote.token && isTauriRuntime()) {
    const [, owner, repo] = parsed
    try {
      const response = await gitHttpFetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${remote.token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ScholarBox',
        },
      })
      checks.push({
        id: 'api-auth',
        label: 'API 鉴权（GET /repos/{owner}/{repo}）',
        ok: response.ok,
        detail:
          response.status === 401
            ? '401 未通过认证：Token 无效或已过期'
            : response.status === 404
              ? '404：仓库不存在，或 Token 看不到这个私有仓库'
              : `HTTP ${response.status} ${response.statusText}`.trim(),
      })
    } catch (err) {
      const info = classifyGitError(err, {
        action: 'diagnose',
        url: `https://api.github.com/repos/${owner}/${repo}`,
        runtime: 'tauri',
        token: remote.token,
      })
      checks.push({ id: 'api-auth', label: 'API 鉴权', ok: false, detail: `${info.title} · ${info.message}` })
    }
  }

  try {
    const refs = await git.listServerRefs({
      url: remote.url,
      prefix: 'refs/heads/',
      onAuth: authFor(remote.token),
      ...transportOptions(remote),
    })
    const names = refs.map((ref) => ref.ref.replace('refs/heads/', ''))
    checks.push({
      id: 'refs',
      label: '读取远端分支（listServerRefs）',
      ok: true,
      detail: names.length ? `${names.length} 个分支：${names.slice(0, 6).join('、')}` : '远端仓库是空的',
    })
    checks.push({
      id: 'branch-exists',
      label: `分支「${remote.branch || 'main'}」`,
      ok: names.length === 0 || names.includes(remote.branch || 'main'),
      detail: names.length === 0 ? '远端还没有提交，首次推送会创建分支' : names.includes(remote.branch || 'main') ? '存在' : '远端没有这个分支',
    })
  } catch (err) {
    const info = classifyGitError(err, contextOf(remote, 'diagnose'))
    checks.push({ id: 'refs', label: '读取远端分支（listServerRefs）', ok: false, detail: `${info.title} · ${info.message}` })
  }

  return checks
}

export type PullOutcome = IntegrateOutcome

/**
 * 拉取。原来这里「先 fetch 再 fastForward，失败就无差别 merge」：
 * - `fastForward` 内部又 fetch 一次，一次拉取要跑两遍网络；
 * - 分支真的分叉时 `fastForward` 抛错，接着 `merge` 又没有 `allowUnrelatedHistories`，
 *   于是「远端有 README、本地是新建仓库」这种最常见的情况只会得到一句「拉取冲突」；
 * - `merge` 之后没有 checkout，工作区停在旧内容上。
 *
 * 现在统一交给 `integrateRemote()`：快进 / 合并 / 接上远端历史三种情况都有确定结果。
 */
export async function pull(vault: VaultFS, remote: GitRemoteConfig, author: GitIdentity): Promise<PullOutcome> {
  const result = await integrateRemote(vault, remote, author)
  return result.outcome
}

export async function log(vault: VaultFS, depth = 30): Promise<CommitSummary[]> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) return []
  let branch: string | null = null
  try {
    const value = await git.currentBranch({ fs, dir: '', fullname: false })
    branch = value || null
  } catch {
    branch = null
  }
  const ref = branch || 'HEAD'
  try {
    const commits = await git.log({ fs, dir: '', ref, depth })
    return commits.map((entry) => ({
      oid: entry.oid,
      short: entry.oid.slice(0, 7),
      message: (entry.commit.message ?? '').trim().split('\n')[0] ?? '',
      author: entry.commit.author?.name ?? '—',
      email: entry.commit.author?.email ?? '',
      timestamp: (entry.commit.author?.timestamp ?? 0) * 1000,
      files: 0,
    }))
  } catch {
    // 空仓库（还没有第一个 commit）
    return []
  }
}

/** 每个 commit 改了多少个文件 —— 只在打开历史面板时按需算，避免每次刷新都走一遍树 */
export async function commitFileCount(vault: VaultFS, oid: string): Promise<number> {
  const fs = fsOf(vault)
  try {
    const commit = await git.readCommit({ fs, dir: '', oid })
    const parent = commit.commit.parent?.[0]
    if (!parent) {
      const tree = await git.readTree({ fs, dir: '', oid: commit.commit.tree })
      return tree.tree.length
    }
    let count = 0
    await git.walk({
      fs,
      dir: '',
      trees: [git.TREE({ ref: parent }), git.TREE({ ref: oid })],
      map: async (filepath, entries) => {
        if (filepath === '.') return
        const [before, after] = entries
        const beforeOid = before ? await before.oid() : undefined
        const afterOid = after ? await after.oid() : undefined
        if (beforeOid !== afterOid) count += 1
        return undefined
      },
    })
    return count
  } catch {
    return 0
  }
}

export async function remoteUrl(vault: VaultFS): Promise<string | null> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) return null
  try {
    const value = (await git.getConfig({ fs, dir: '', path: `remote.${REMOTE}.url` })) as string | undefined
    return value ?? null
  } catch {
    return null
  }
}

/** 供设置页展示：把本地仓库状态集中成一份，不做网络请求 */
export async function localGitState(vault: VaultFS): Promise<{
  isRepo: boolean
  branch: string | null
  remote: string | null
}> {
  return {
    isRepo: await isRepo(vault),
    branch: await currentBranch(vault),
    remote: await remoteUrl(vault),
  }
}

export type { GitErrorInfo }

// ───────────────────────────── 分支 ─────────────────────────────
//
// 个人文献库不需要分支策略，但「试一套整理方式，不行就切回去」很常见，
// 所以这里只做三件事：列、建/切、合并。刻意不做 rebase / 强制推送 / 删除分支 ——
// 那是给协作仓库用的，误操作的代价远大于收益。

export interface BranchInfo {
  current: string | null
  /** 本地分支（refs/heads） */
  local: string[]
  /** 远端分支（refs/remotes/origin，可能还没 fetch 过） */
  remote: string[]
}

/** 分支名里不能出现的东西（git check-ref-format 的实用子集） */
const BRANCH_FORBIDDEN = /[\s~^:?*[\\\x00-\x1f]/

export function branchNameError(name: string): string | null {
  const value = name.trim()
  if (!value) return '分支名不能为空'
  if (value.length > 80) return '分支名太长了（最多 80 个字符）'
  if (BRANCH_FORBIDDEN.test(value)) return '分支名里不能有空格或 ~ ^ : ? * [ \\ 这些字符'
  if (value.includes('..')) return '分支名里不能有连续的 ..'
  if (value.startsWith('-') || value.startsWith('/') || value.startsWith('.')) return '分支名不能以 - 、/ 或 . 开头'
  if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) return '分支名不能以 / 、. 或 .lock 结尾'
  return null
}

export async function branches(vault: VaultFS): Promise<BranchInfo> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) return { current: null, local: [], remote: [] }
  const current = await currentBranch(vault)
  const local = await git.listBranches({ fs, dir: '' })
  let remote: string[] = []
  try {
    remote = await git.listBranches({ fs, dir: '', remote: REMOTE })
  } catch {
    remote = []
  }
  return { current, local, remote }
}

function isCheckoutConflict(err: unknown): boolean {
  const raw = err as { name?: string; code?: string } | null
  return raw?.name === 'CheckoutConflictError' || raw?.code === 'CheckoutConflictError'
}

/** 新建分支并切过去。`from` 默认是当前 HEAD。 */
export async function createBranch(vault: VaultFS, name: string, from?: string): Promise<string> {
  const fs = fsOf(vault)
  if (!(await isRepo(vault))) throw new GitError('这个文献库还没有初始化 Git', '先在同步设置里点「连接仓库」')
  const invalid = branchNameError(name)
  if (invalid) throw new GitError(invalid, '换一个纯字母数字的名字最稳，比如 notes-v2')
  const branch = name.trim()
  const head = await headOid(fs)
  if (!head) throw new GitError('还没有第一条提交', '先点「提交」，再新建分支')
  const existing = await git.listBranches({ fs, dir: '' })
  if (existing.includes(branch)) throw new GitError(`分支「${branch}」已经存在`, '直接在列表里切换过去就行')
  await git.branch({ fs, dir: '', ref: branch, object: from || head })
  await git.checkout({ fs, dir: '', ref: branch })
  logSync('branch.create', { branch, from: from || head })
  return branch
}

/** 切换本地分支。工作区有冲突改动时会明确报错，不会悄悄覆盖。 */
export async function switchBranch(vault: VaultFS, name: string): Promise<string> {
  const fs = fsOf(vault)
  const branch = name.trim()
  const existing = await git.listBranches({ fs, dir: '' })
  if (!existing.includes(branch)) throw new GitError(`本地没有分支「${branch}」`, '先在列表里新建它')
  try {
    await git.checkout({ fs, dir: '', ref: branch })
  } catch (err) {
    if (isCheckoutConflict(err)) {
      throw new GitError(
        '工作区有未提交的改动，切分支会覆盖它们',
        '先提交一次再切换 —— ScholarBox 不会替你丢弃任何改动',
      )
    }
    throw new GitOperationError(
      classifyGitError(err, { action: 'refresh', runtime: isTauriRuntime() ? 'tauri' : 'browser' }),
    )
  }
  logSync('branch.switch', { branch })
  return branch
}

export interface MergeBranchResult {
  /** 目标分支（当前分支） */
  branch: string
  /** 被合并进来的分支 */
  source: string
  fastForward: boolean
}

/** 把 `source` 合进当前分支。允许合并无关历史；真冲突时整体中止，不留半成品。 */
export async function mergeBranch(
  vault: VaultFS,
  source: string,
  author: GitIdentity,
): Promise<MergeBranchResult> {
  const fs = fsOf(vault)
  const branch = (await git.currentBranch({ fs, dir: '', fullname: false })) || 'main'
  const src = source.trim()
  if (src === branch) throw new GitError('不能把分支合并到它自己', '选另一个分支')
  const existing = await git.listBranches({ fs, dir: '' })
  if (!existing.includes(src)) throw new GitError(`本地没有分支「${src}」`, '先在列表里新建，或从远端拉取')
  try {
    const result = await git.merge({
      fs,
      dir: '',
      ours: branch,
      theirs: src,
      fastForward: true,
      fastForwardOnly: false,
      // 两条互不相干的历史也能合（和各分支各自起步的情况）
      allowUnrelatedHistories: true,
      abortOnConflict: true,
      author: { name: author.name, email: author.email },
      message: `合并分支 ${src} · ${stamp()}`,
    })
    // merge 只写 ref 和索引，不 checkout：不补这一步，工作区会停在旧内容上
    await git.checkout({ fs, dir: '', ref: branch })
    logSync('branch.merge', { branch, source: src, fastForward: Boolean(result.fastForward) })
    return { branch, source: src, fastForward: Boolean(result.fastForward) }
  } catch (err) {
    const info = classifyGitError(err, { action: 'pull', runtime: isTauriRuntime() ? 'tauri' : 'browser' })
    if (info.kind === 'conflict' || info.kind === 'unknown' || info.kind === 'history-unrelated') {
      throw new GitOperationError({
        ...info,
        kind: 'conflict',
        title: '合并冲突',
        hint: '两个分支改过同一批文件。先把冲突的那边整理好（或换个分支名），再合并 —— ScholarBox 不会替你选一边。',
        retryable: false,
      })
    }
    throw new GitOperationError(info)
  }
}

// ─────────────────────── 删除 / 重建本地 Git ───────────────────────

/** 只删本地 `.git`（文件一个不动）。删完这个库就不再是 Git 仓库。 */
export async function deleteLocalGit(vault: VaultFS): Promise<void> {
  if (!(await isRepo(vault))) return
  await vault.remove('.git', { recursive: true })
  logSync('git.delete', { root: vault.root })
}

export interface RebuildResult {
  branch: string
  /** keepRemote 时远端历史接进来的结果；false 表示从空仓库重新开始 */
  adopted: IntegrateOutcome | null
  /** 接回来时补下来的远端文件数 */
  materialized: number
}

/**
 * 重建本地 Git：删掉 `.git` → 重新 init → 按需把远端历史接回来。
 *
 * `keepRemote: true`（默认）等于「以远端为底重建」，重建完推送就是快进；
 * `false` 则是彻底重来（本地历史清空，远端那条历史下次推送会再走一次自动接管）。
 * 两种都不会动文献库里的任何文件。
 */
export async function rebuildLocalGit(
  vault: VaultFS,
  remote: GitRemoteConfig,
  author: GitIdentity,
  opts: { keepRemote?: boolean } = {},
): Promise<RebuildResult> {
  const keepRemote = opts.keepRemote ?? true
  await deleteLocalGit(vault)
  await initRepo(vault, remote)
  if (keepRemote && remote.url) {
    const result = await integrateRemote(vault, remote, author)
    const branch = (await currentBranch(vault)) || remote.branch || 'main'
    logSync('git.rebuild', { branch, adopted: result.outcome, materialized: result.adopt?.materialized.length ?? 0 })
    return { branch, adopted: result.outcome, materialized: result.adopt?.materialized.length ?? 0 }
  }
  await commitAll(vault, `重建本地 Git · ${stamp()}`, author)
  const branch = (await currentBranch(vault)) || remote.branch || 'main'
  logSync('git.rebuild', { branch, adopted: null })
  return { branch, adopted: null, materialized: 0 }
}
