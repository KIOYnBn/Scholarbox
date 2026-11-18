import { dirname, normalize } from '@/lib/path'
import { MemoryVaultFS } from './memory'
import { FsError, toFsError, type DirEntry, type FileStat, type VaultFS } from './types'

/**
 * Browser backend — Origin Private File System (OPFS).
 *
 * Purpose: the entire UI (library, reader, notes, sync) must be developable and
 * testable in a plain browser tab, without a Rust toolchain or an emulator.
 * OPFS gives us real, persistent, path-addressed files, so the same repository
 * code runs unchanged in `pnpm dev` and inside Tauri (where TauriVaultFS takes over).
 */
export class BrowserVaultFS implements VaultFS {
  readonly kind = 'browser' as const
  readonly root: string
  private constructor(
    private base: FileSystemDirectoryHandle,
    rootLabel: string,
  ) {
    this.root = rootLabel
  }

  static async open(folderName = 'MyVault'): Promise<VaultFS> {
    const fallback = async (reason: unknown): Promise<VaultFS> => {
      console.warn('[fs] OPFS unavailable, falling back to memory vault', reason)
      const memory = new MemoryVaultFS('/browser-vault')
      await memory.mkdir('papers')
      return memory
    }

    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return fallback('navigator.storage.getDirectory missing')
    }

    try {
      // Some headless / hardened environments expose the API but never settle the
      // promise, which would leave the app stuck on the boot screen forever.
      // A short race keeps startup deterministic.
      const base = await Promise.race([
        (async () => {
          const opfsRoot = await navigator.storage.getDirectory()
          return opfsRoot.getDirectoryHandle(folderName, { create: true })
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OPFS open timed out')), 4000),
        ),
      ])
      return new BrowserVaultFS(base, `OPFS://${folderName}`)
    } catch (err) {
      return fallback(err)
    }
  }

  private async dirHandle(rel: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.base
    const norm = normalize(rel)
    if (!norm) return dir
    for (const segment of norm.split('/')) {
      dir = await dir.getDirectoryHandle(segment, { create })
    }
    return dir
  }

  private async fileHandle(rel: string, create = false): Promise<FileSystemFileHandle> {
    const norm = normalize(rel)
    if (!norm) throw new FsError('空文件路径', 'io')
    const parent = await this.dirHandle(dirname(norm), create)
    try {
      return await parent.getFileHandle(norm.slice(dirname(norm).length + (dirname(norm) ? 1 : 0)), {
        create,
      })
    } catch (err) {
      throw toFsError(err, norm)
    }
  }

  async readText(rel: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(rel))
  }

  async readBytes(rel: string): Promise<Uint8Array> {
    try {
      const handle = await this.fileHandle(rel)
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async writeText(rel: string, data: string): Promise<void> {
    await this.writeBytes(rel, new TextEncoder().encode(data))
  }

  async writeBytes(rel: string, data: Uint8Array): Promise<void> {
    try {
      const handle = await this.fileHandle(rel, true)
      const writable = await handle.createWritable()
      await writable.write(data as unknown as BufferSource)
      await writable.close()
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async exists(rel: string): Promise<boolean> {
    return (await this.stat(rel)) !== null
  }

  async stat(rel: string): Promise<FileStat | null> {
    try {
      const handle = await this.fileHandle(rel)
      const file = await handle.getFile()
      return { size: file.size, mtimeMs: file.lastModified, isDir: false }
    } catch {
      try {
        await this.dirHandle(rel)
        return { size: 0, mtimeMs: null, isDir: true }
      } catch {
        return null
      }
    }
  }

  async mkdir(rel: string): Promise<void> {
    try {
      await this.dirHandle(rel, true)
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async list(rel: string): Promise<DirEntry[]> {
    try {
      const dir = await this.dirHandle(rel)
      const out: DirEntry[] = []
      // @ts-expect-error — async iterator is present in Chromium but missing from lib.dom
      for await (const [name, handle] of dir.entries()) {
        const entry = handle as FileSystemHandle
        out.push({
          name,
          path: normalize(`${rel}/${name}`),
          kind: entry.kind === 'directory' ? 'dir' : 'file',
        })
      }
      return out.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
      )
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async remove(rel: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const norm = normalize(rel)
    const parent = await this.dirHandle(dirname(norm))
    try {
      await parent.removeEntry(norm.slice(dirname(norm).length + (dirname(norm) ? 1 : 0)), {
        recursive: opts.recursive ?? false,
      })
    } catch (err) {
      throw toFsError(err, rel)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    // OPFS has no rename; copy then delete.
    const stat = await this.stat(from)
    if (!stat) throw new FsError(`路径不存在: ${from}`, 'not_found', from)
    if (stat.isDir) throw new FsError('浏览器模式暂不支持目录重命名', 'io', from)
    await this.writeBytes(to, await this.readBytes(from))
    await this.remove(from)
  }
}
