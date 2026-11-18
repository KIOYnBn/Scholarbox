import { isNotFound, type VaultFS } from '@/lib/fs/types'
import { FsError } from '@/lib/fs/types'
import { changeSummary, isRepo, log, remoteUrl } from '@/lib/git/repo'
import { resolveRootPath } from './paths'
import { appConfigBaseDir } from './path-check'
import type { VaultEntry } from './registry'

/**
 * 删除仓库文件夹的所有「危险动作」都收在这个文件里。
 *
 * 原则：
 * 1. 只删注册表里那个仓库自己的根目录 —— 不删它的父目录、不删任何配置目录。
 * 2. 删除前先把「要删的是什么」算清楚（绝对路径、文件数、大小、未提交改动），
 *    让用户在确认框里看到的是事实，不是一句「确定删除吗？」。
 * 3. 调用方必须复用 `resolveRootPath()` 解析路径 —— 与 `openEntry()` 走同一条，
 *    否则「打开的是 A、删的是 B」这种事故只差一个 `..`。
 */

export interface FolderReport {
  /** 解析后的绝对路径（opfs 显示 `OPFS://<dir>`） */
  resolved: string
  rootType: VaultEntry['rootType']
  files: number
  bytes: number
  /** 未提交改动数（不是 Git 仓库时为 0） */
  dirty: number
  isRepo: boolean
  lastCommitAt: number | null
  remote: string | null
  /** 本地分支是否已全部推送；`unknown` = 没有远端/没令牌，不联网判断 */
  pushed: 'yes' | 'no' | 'unknown'
}

export class DeleteGuardError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'DeleteGuardError'
  }
}

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]?$/
const UNC_ROOT = /^[\\/]{2}[^\\/]+[\\/]?[^\\/]*[\\/]?$/

function stripTrailing(value: string): string {
  return value.replace(/[\\/]+$/, '')
}

function samePath(a: string, b: string): boolean {
  return stripTrailing(a).replace(/\\/g, '/').toLowerCase() === stripTrailing(b).replace(/\\/g, '/').toLowerCase()
}

function contains(parent: string, child: string): boolean {
  const p = stripTrailing(parent).replace(/\\/g, '/').toLowerCase()
  const c = stripTrailing(child).replace(/\\/g, '/').toLowerCase()
  return c === p || c.startsWith(`${p}/`)
}

export interface GuardContext {
  /** 应用配置目录（vaults.json 就在里面） */
  configDir: string | null
  /** SCHOLARBOX_HOME 之类的环境变量根 */
  homeOverride?: string | null
  /** 其他已注册仓库（不允许把别人的目录删掉） */
  otherRoots: string[]
}

/**
 * 危险路径护栏。返回 ok=true 才允许真正删除。
 * 这里只做「字符串层面」判断，不做 IO —— 纯函数好测。
 */
export function guardDeletePath(
  resolved: string,
  ctx: GuardContext,
): { ok: true } | { ok: false; reason: string } {
  const path = resolved.trim()

  if (!path) return { ok: false, reason: '路径为空' }
  if (path === '.' || path === '..' || path === './') return { ok: false, reason: '路径不能是当前目录或上级目录' }
  if (path.split(/[\\/]/).some((segment) => segment === '..')) {
    return { ok: false, reason: '路径里不能出现 `..`' }
  }
  if (WINDOWS_DRIVE.test(path)) return { ok: false, reason: '不能删除盘符根目录' }
  if (UNC_ROOT.test(path) && stripTrailing(path).split(/[\\/]/).filter(Boolean).length <= 2) {
    return { ok: false, reason: '不能删除网络共享的根目录' }
  }
  if (path === '/' || path === '\\') return { ok: false, reason: '不能删除根目录' }
  if (/^content:\/\//i.test(path)) {
    return { ok: false, reason: 'content:// 目录暂不支持删除（Android SAF 尚未接入）' }
  }
  if (/^[a-zA-Z]:[\\/]?$/i.test(stripTrailing(path))) {
    return { ok: false, reason: '不能删除盘符根目录' }
  }

  if (/(^|[\\/])vaults\.json$/i.test(path)) {
    return { ok: false, reason: '这是注册表文件本身，不能当作仓库目录删除' }
  }

  if (ctx.configDir) {
    if (samePath(path, ctx.configDir)) {
      return { ok: false, reason: '这是应用配置目录（里面存着 vaults.json 与令牌），不能删除' }
    }
    if (contains(path, ctx.configDir)) {
      return { ok: false, reason: '这个目录包含应用配置（vaults.json），删除会丢失所有仓库的记录' }
    }
    if (contains(ctx.configDir, path)) {
      return { ok: false, reason: '这是应用配置目录里的路径（vaults.json 与令牌就在旁边），不能删除' }
    }
  }

  if (ctx.homeOverride && contains(path, ctx.homeOverride) && !samePath(path, ctx.homeOverride)) {
    return { ok: false, reason: '这个目录包含 SCHOLARBOX_HOME 运行时数据' }
  }
  if (ctx.homeOverride && contains(ctx.homeOverride, path) && !samePath(path, ctx.homeOverride)) {
    return { ok: false, reason: '这是 SCHOLARBOX_HOME 里面的路径，不能删除' }
  }
  if (ctx.homeOverride && samePath(path, ctx.homeOverride)) {
    return { ok: false, reason: '不能删除 SCHOLARBOX_HOME 目录本身' }
  }

  // ProgramData\ScholarBox 是 WebView2 数据的落点之一（含它下面的所有子路径）
  if (contains('C:\\ProgramData\\ScholarBox', path)) {
    return { ok: false, reason: '这是 ScholarBox 的运行时数据目录，不能删除' }
  }

  for (const other of ctx.otherRoots) {
    if (!other.trim()) continue
    if (samePath(path, other)) return { ok: false, reason: '这个目录正被另一个仓库使用' }
    if (contains(path, other)) {
      return { ok: false, reason: '这个目录包含另一个仓库，删除会连带删掉它' }
    }
    if (contains(other, path)) {
      return { ok: false, reason: '这个目录在另一个仓库里面，不能单独删除' }
    }
  }

  return { ok: true }
}

/** 递归统计文件数与体积（跳过 `.git` 内部的松散对象，免得把对象库算成用户文档） */
async function walk(fs: VaultFS, rel: string, acc: { files: number; bytes: number }, depth = 0): Promise<void> {
  if (depth > 24) return
  let entries
  try {
    entries = await fs.list(rel)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.kind === 'dir') {
      if (entry.name === '.git') continue
      await walk(fs, entry.path, acc, depth + 1)
      continue
    }
    acc.files += 1
    try {
      const stat = await fs.stat(entry.path)
      acc.bytes += stat?.size ?? 0
    } catch {
      // 统计不到大小不影响删除，只是数字偏小
    }
  }
}

export async function resolveVaultRoot(entry: VaultEntry): Promise<string> {
  if (entry.rootType === 'opfs') return entry.rootPath.replace(/^OPFS:\/\//, '')
  const base = await appConfigBaseDir()
  return resolveRootPath(entry.rootPath, { desktop: true, baseDir: base })
}

/** 删除前给用户看的事实清单 */
export async function inspectVaultFolder(fs: VaultFS, entry: VaultEntry): Promise<FolderReport> {
  const resolved = await resolveVaultRoot(entry)
  const acc = { files: 0, bytes: 0 }
  await walk(fs, '', acc)

  const repo = await isRepo(fs).catch(() => false)
  let dirty = 0
  let lastCommitAt: number | null = null
  let remote: string | null = null
  let pushed: FolderReport['pushed'] = 'unknown'

  if (repo) {
    try {
      const summary = await changeSummary(fs)
      dirty = summary.added + summary.modified + summary.deleted
      const entries = await log(fs, 1)
      lastCommitAt = entries[0]?.timestamp ?? null
      // 有未提交改动，就一定不是「已全部推送」
      pushed = dirty > 0 ? 'no' : lastCommitAt === null ? 'unknown' : 'yes'
      remote = await remoteUrl(fs)
    } catch {
      // .git 损坏时也允许删除 —— 用户往往正是想清掉这个坏仓库
    }
  }

  return {
    resolved: entry.rootType === 'opfs' ? `OPFS://${resolved}` : resolved,
    rootType: entry.rootType,
    files: acc.files,
    bytes: acc.bytes,
    dirty,
    isRepo: repo,
    lastCommitAt,
    remote,
    pushed,
  }
}

/**
 * 删掉 OPFS 下的一个目录。`fs.remove('')` 在根句柄上会抛
 * `Name is not allowed`（removeEntry 不接受空名字），所以这里必须拿到**父目录**
 * 再按名字删。
 */
async function removeOpfsDir(dirPath: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new FsError('这个浏览器不支持 OPFS，无法删除目录', 'io', dirPath)
  }
  const segments = dirPath
    .replace(/^OPFS:\/\//, '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  if (segments.length === 0) throw new FsError('不能删除 OPFS 根目录', 'denied', dirPath)

  let parent = await navigator.storage.getDirectory()
  for (const segment of segments.slice(0, -1)) {
    parent = await parent.getDirectoryHandle(segment)
  }
  const name = segments[segments.length - 1] as string
  try {
    await parent.removeEntry(name, { recursive: true })
  } catch (err) {
    if (isNotFound(err)) return
    throw err
  }
}

export async function removeFolder(
  fs: VaultFS,
  rootType: VaultEntry['rootType'],
  target: string,
): Promise<void> {
  // 桌面端优先走系统回收站（Rust 侧 `trash_path`），浏览器端 OPFS 没有回收站
  if (rootType === 'fs' && fs.kind === 'tauri') {
    const trashed = await trashViaRust(fs.root)
    if (trashed) return
  }
  if (rootType === 'opfs' && fs.kind === 'browser') {
    await removeOpfsDir(target)
    return
  }
  try {
    await fs.remove('', { recursive: true })
  } catch (err) {
    // 目录本来就不存在（用户手动删过了）不算失败
    if (!isNotFound(err)) throw err
  }
}

async function trashViaRust(absolutePath: string): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('trash_path', { path: absolutePath })
    return true
  } catch (err) {
    // 回收站不可用（非 Windows / 跨卷 / 权限）时退回真删除，但把原因留给调用方展示
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('unavailable')) return false
    throw new FsError(`移入回收站失败：${message}`, 'io', absolutePath)
  }
}
