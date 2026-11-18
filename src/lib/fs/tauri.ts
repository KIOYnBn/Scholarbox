import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import * as tauriFs from '@tauri-apps/plugin-fs'
import { join, normalize } from '@/lib/path'
import { FsError, toFsError, type DirEntry, type FileStat, type VaultFS } from './types'

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return isTauri()
  } catch {
    return false
  }
}

/**
 * Real-folder backend (desktop).
 *
 * The vault root is an absolute directory chosen by the user. Because Tauri's
 * fs scope is static at build time, the Rust side exposes `allow_vault_scope`
 * which whitelists the picked directory at runtime — the same trick Obsidian
 * uses when you "open folder as vault".
 */
/**
 * 把某个目录加入本次会话的 fs scope。
 *
 * Tauri 的 capability scope 是构建期静态的，用户选的仓库可能在任意盘符，
 * 所以必须靠 Rust 侧 `allow_vault_scope` 在运行时放行。
 * 探针（写入测试）也必须先调这个，否则会以 `forbidden path` 失败。
 */
export async function grantFsScope(path: string): Promise<void> {
  try {
    await invoke('allow_vault_scope', { path })
  } catch (err) {
    // 静态 capability 可能已经覆盖该位置，失败不致命
    console.warn('[fs] allow_vault_scope failed', err)
  }
}

export class TauriVaultFS implements VaultFS {
  readonly kind = 'tauri' as const

  constructor(readonly root: string) {}

  /** Grant the Rust fs plugin access to this folder for the current session. */
  async grantScope(): Promise<void> {
    await grantFsScope(this.root)
  }

  private abs(rel: string): string {
    return join(this.root, normalize(rel))
  }

  absolute(rel: string): string {
    return this.abs(rel)
  }

  assetUrl(rel: string): string {
    return convertFileSrc(this.abs(rel))
  }

  async readText(rel: string): Promise<string> {
    try {
      return await tauriFs.readTextFile(this.abs(rel))
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async readBytes(rel: string): Promise<Uint8Array> {
    try {
      const bytes = await tauriFs.readFile(this.abs(rel))
      return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async writeText(rel: string, data: string): Promise<void> {
    try {
      await tauriFs.writeTextFile(this.abs(rel), data)
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async writeBytes(rel: string, data: Uint8Array): Promise<void> {
    try {
      await tauriFs.writeFile(this.abs(rel), data)
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async exists(rel: string): Promise<boolean> {
    try {
      return await tauriFs.exists(this.abs(rel))
    } catch {
      return false
    }
  }

  async stat(rel: string): Promise<FileStat | null> {
    try {
      const info = await tauriFs.stat(this.abs(rel))
      return {
        size: info.size,
        mtimeMs: info.mtime ? info.mtime.getTime() : null,
        isDir: info.isDirectory,
      }
    } catch {
      return null
    }
  }

  async mkdir(rel: string): Promise<void> {
    try {
      await tauriFs.mkdir(this.abs(rel), { recursive: true })
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async list(rel: string): Promise<DirEntry[]> {
    try {
      const entries = await tauriFs.readDir(this.abs(rel))
      return entries
        .map((entry) => ({
          name: entry.name,
          path: join(rel, entry.name),
          kind: entry.isDirectory ? ('dir' as const) : ('file' as const),
        }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async remove(rel: string, opts: { recursive?: boolean } = {}): Promise<void> {
    try {
      await tauriFs.remove(this.abs(rel), { recursive: opts.recursive ?? false })
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    try {
      await tauriFs.rename(this.abs(from), this.abs(to))
    } catch (err) {
      throw new FsError(`重命名失败: ${from} -> ${to}`, 'io', from)
    }
  }
}
