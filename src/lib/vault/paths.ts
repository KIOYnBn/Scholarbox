import type { VaultEntry, VaultRegistry, VaultRootType } from './registry'
import { findVaultByPath } from './registry'

/**
 * 仓库根路径的规范化与校验。
 *
 * rootPath 在注册表里统一存字符串，但三种后端语义不同：
 * - 桌面端（fs）：绝对路径，或相对 appConfigDir 的相对路径
 * - 浏览器（opfs）：一定是 OPFS 下的相对子目录，绝不会是系统路径
 * - Android（预留 SAF URI）：目前按字符串原样保存，不在这里改写
 *
 * 这一层只做纯字符串与注册表层面的判断（方便单测），
 * 真正的「能不能读写」由 `path-check.ts` 去磁盘/OPFS 上探。
 */

/** 相对路径的落点：appConfigDir 下的子目录 */
export const RELATIVE_BASE_SUBDIR = 'vaults'

/** 路径解析/校验的错误类型：调用方可以直接把 message 显示给用户 */
export class PathError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message)
    this.name = 'PathError'
  }
}

/** `D:\papers\Vault` / `\\server\share` / `/home/me/vault` */
export function isAbsolutePath(path: string): boolean {
  const value = path.trim()
  if (!value) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true
  if (/^[\\/]{2}[^\\/]/.test(value)) return true
  if (value.startsWith('/')) return true
  return false
}

/** 预留：Android 的 SAF 文档 URI */
export function isContentUri(path: string): boolean {
  return /^content:\/\//i.test(path.trim())
}

export interface NormalizeOptions {
  rootType: VaultRootType
  /** 桌面端为 true —— 决定是否允许系统绝对路径 */
  desktop: boolean
}

export interface NormalizedPath {
  ok: boolean
  /** 规范化之后的路径（ok 为 false 时是尽力而为的结果，仅供显示） */
  path: string
  reason?: string
}

/**
 * 规范化用户输入的根路径。
 * 不碰文件系统，只把写法统一：分隔符、末尾斜杠、`OPFS://` 前缀、`.`、`..`、空段。
 */
export function normalizeRootPath(raw: string, options: NormalizeOptions): NormalizedPath {
  let value = (raw ?? '').trim()
  if (!value) return { ok: false, path: '', reason: '路径不能为空' }

  if (value.startsWith('OPFS://')) value = value.slice('OPFS://'.length)

  if (isContentUri(value)) {
    return { ok: true, path: value }
  }

  const wasAbsolute = isAbsolutePath(value)
  const segments = value.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')

  if (segments.some((segment) => segment === '..')) {
    return {
      ok: false,
      path: value,
      reason: options.rootType === 'opfs' ? '不能用 .. 跳出 OPFS 目录' : '路径里不能出现 ..（请写完整路径）',
    }
  }

  if (options.rootType === 'opfs') {
    // 浏览器里没有「系统路径」这回事，写绝对路径只会误导用户
    if (wasAbsolute) {
      return {
        ok: false,
        path: segments.join('/'),
        reason: '浏览器模式只接受 OPFS 相对目录，不能填系统路径',
      }
    }
    const joined = segments.join('/')
    if (!joined) return { ok: false, path: '', reason: '路径不能为空' }
    return { ok: true, path: joined }
  }

  if (!options.desktop && wasAbsolute) {
    return {
      ok: false,
      path: segments.join('/'),
      reason: '当前环境不能使用系统绝对路径',
    }
  }

  if (wasAbsolute) {
    const prefix = /^[a-zA-Z]:/.exec(value)?.[0] ?? ''
    const unc = value.startsWith('\\\\')
    const base = prefix ? `${prefix}/` : unc ? '//' : '/'
    return { ok: true, path: base + segments.slice(prefix ? 1 : 0).join('/') }
  }

  const joined = segments.join('/')
  if (!joined) return { ok: false, path: '', reason: '路径不能为空' }
  return { ok: true, path: joined }
}

/** 把注册表里的 rootPath 换成实际使用的绝对路径（相对路径挂到 baseDir 下） */
export function resolveRootPath(
  rootPath: string,
  options: { desktop: boolean; baseDir: string },
): string {
  const value = rootPath.trim()
  if (!value) return ''
  if (isContentUri(value)) return value
  if (isAbsolutePath(value)) return value
  // baseDir 拿不到时不能退化成 `/vaults/x` —— 那会把仓库建到磁盘根目录，
  // 而且看起来「成功了」。宁可抛错，让调用方给出可读的失败原因。
  const base = options.baseDir.replace(/[\\/]+$/, '')
  if (!base) {
    throw new PathError('appConfigDir 不可用，无法解析相对路径的仓库根目录')
  }
  const joiner = base.includes('\\') ? '\\' : '/'
  return `${base}${joiner}${RELATIVE_BASE_SUBDIR}${joiner}${value.replace(/[\\/]+/g, joiner)}`
}

/** 展示用：相对路径前面加个 `~/`，让用户看得出它不是绝对路径 */
export function displayRootPath(entry: Pick<VaultEntry, 'rootPath' | 'rootType'>): string {
  if (entry.rootType === 'opfs') return `OPFS://${entry.rootPath}`
  return entry.rootPath
}

export interface ValidatePathInput
  extends NormalizeOptions {
  raw: string
  registry: VaultRegistry
  /** 校验「修改现有仓库」时传自己的 id，避免和自己重复 */
  ignoreId?: string
}

export interface PathValidation {
  ok: boolean
  path: string
  reason?: string
}

/** 纯注册表层面的校验：非空、写法合法、不与已有仓库重复 */
export function validateRootPath(input: ValidatePathInput): PathValidation {
  const normalized = normalizeRootPath(input.raw, input)
  if (!normalized.ok) return { ok: false, path: normalized.path, reason: normalized.reason }

  const duplicated = findVaultByPath(input.registry, normalized.path)
  if (duplicated && duplicated.id !== input.ignoreId) {
    return {
      ok: false,
      path: normalized.path,
      reason: `这个路径已经注册为「${duplicated.name}」了`,
    }
  }

  return { ok: true, path: normalized.path }
}

/** 新建时的默认名字：路径末段 */
export function defaultVaultName(path: string): string {
  const tail = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop()
  return tail ?? '未命名仓库'
}
