import type { VaultFS } from '@/lib/fs/types'

/**
 * isomorphic-git 的文件系统适配层。
 *
 * isomorphic-git 不直接用 Node 的 `fs`，而是吃一个「promises 形状」的对象：
 * readFile / writeFile / readdir / mkdir / rmdir / unlink / stat / lstat。
 * 这里把它整体映射到 `VaultFS` 上 —— 于是同一套 Git 代码在桌面端（真文件系统）、
 * 浏览器端（OPFS）、以及测试里（内存）都能跑，`.git` 就落在文献库根目录下，
 * 用户用系统的 `git log` 或 GitHub Desktop 也能直接看。
 */

type Errno = 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'EACCES' | 'EPERM' | 'ENOTEMPTY'

interface FsErrorLike extends Error {
  code: Errno
  errno: number
  path: string
  syscall: string
}

const ERRNO: Record<Errno, number> = {
  EPERM: -1,
  ENOENT: -2,
  EACCES: -13,
  EEXIST: -17,
  ENOTDIR: -20,
  EISDIR: -21,
  ENOTEMPTY: -39,
}

export function gitFsError(code: Errno, path: string, syscall = 'open'): FsErrorLike {
  const error = new Error(`${code}: ${syscall} '${path}'`) as FsErrorLike
  error.code = code
  error.errno = ERRNO[code]
  error.path = path
  error.syscall = syscall
  return error
}

/** isomorphic-git 传进来的路径可能带前导 `/` 或 `./`，统一成 VaultFS 的相对路径 */
export function toVaultPath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
}

interface GitStats {
  type: 'file' | 'dir'
  mode: number
  size: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  uid: number
  gid: number
  dev: number
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}

function makeStats(size: number, mtimeMs: number, isDir: boolean): GitStats {
  const mtime = mtimeMs || Date.now()
  return {
    type: isDir ? 'dir' : 'file',
    mode: isDir ? 0o040000 : 0o100644,
    size,
    ino: 0,
    mtimeMs: mtime,
    ctimeMs: mtime,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  }
}

export interface GitPromiseFs {
  readFile(path: string, options?: { encoding?: string } | string): Promise<Uint8Array | string>
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  unlink(path: string, options?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<string[]>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rmdir(path: string): Promise<void>
  stat(path: string): Promise<GitStats>
  lstat(path: string): Promise<GitStats>
  readlink(path: string): Promise<string>
  symlink(target: string, path: string): Promise<void>
  chmod(path: string, mode: number): Promise<void>
}

export interface GitFsClient {
  promises: GitPromiseFs
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * 把 VaultFS 包装成 isomorphic-git 能用的 fs。
 * `dir` 一律传 `''`（仓库根 = 文献库根），所以这里不需要处理 dir 拼接。
 */
export function createGitFs(vault: VaultFS): GitFsClient {
  const promises: GitPromiseFs = {
    async readFile(path, options) {
      const rel = toVaultPath(path)
      const encoding = typeof options === 'string' ? options : options?.encoding
      try {
        if (encoding === 'utf8' || encoding === 'utf-8') return await vault.readText(rel)
        return await vault.readBytes(rel)
      } catch (err) {
        throw gitFsError('ENOENT', rel, 'open')
      }
    },

    async writeFile(path, data) {
      const rel = toVaultPath(path)
      const bytes = typeof data === 'string' ? encoder.encode(data) : data
      await vault.writeBytes(rel, bytes)
    },

    async unlink(path) {
      const rel = toVaultPath(path)
      const info = await vault.stat(rel)
      if (!info) throw gitFsError('ENOENT', rel, 'unlink')
      if (info.isDir) throw gitFsError('EISDIR', rel, 'unlink')
      await vault.remove(rel)
    },

    async readdir(path) {
      const rel = toVaultPath(path)
      const info = rel === '' ? { isDir: true } : await vault.stat(rel)
      if (!info) throw gitFsError('ENOENT', rel, 'scandir')
      if (!info.isDir) throw gitFsError('ENOTDIR', rel, 'scandir')
      const entries = await vault.list(rel)
      return entries.map((entry) => entry.name)
    },

    async mkdir(path) {
      const rel = toVaultPath(path)
      if (rel === '') return
      const info = await vault.stat(rel)
      if (info?.isDir) return
      await vault.mkdir(rel)
    },

    async rmdir(path) {
      const rel = toVaultPath(path)
      const info = await vault.stat(rel)
      if (!info) throw gitFsError('ENOENT', rel, 'rmdir')
      await vault.remove(rel, { recursive: false })
    },

    async stat(path) {
      const rel = toVaultPath(path)
      if (rel === '') return makeStats(0, Date.now(), true)
      const info = await vault.stat(rel)
      if (!info) throw gitFsError('ENOENT', rel, 'stat')
      return makeStats(info.size, info.mtimeMs ?? Date.now(), info.isDir)
    },

    async lstat(path) {
      return promises.stat(path)
    },

    async readlink(path) {
      // 文献库里没有符号链接；git 只在极少数路径上探测它
      throw gitFsError('ENOENT', toVaultPath(path), 'readlink')
    },

    async symlink(_target, path) {
      throw gitFsError('EPERM', toVaultPath(path), 'symlink')
    },

    async chmod() {
      // 权限位对「文件夹即数据库」没有意义
    },
  }

  return { promises }
}

export const decoderUtf8 = decoder
