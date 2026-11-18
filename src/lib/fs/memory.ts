import { dirname, join, normalize } from '@/lib/path'
import { FsError, type DirEntry, type FileStat, type VaultFS } from './types'

/**
 * In-memory vault. Powers unit tests and acts as the last-resort fallback
 * when even OPFS is unavailable (private windows / ancient webviews).
 */
export class MemoryVaultFS implements VaultFS {
  readonly kind = 'memory' as const
  readonly root: string
  private files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>()
  private dirs = new Set<string>([''])

  constructor(root = '/memory-vault') {
    this.root = root
  }

  /** test helper: list every file path */
  allPaths(): string[] {
    return [...this.files.keys()].sort()
  }

  private ensureParent(rel: string) {
    const parent = dirname(rel)
    if (parent === '') return
    if (!this.dirs.has(parent)) throw new FsError(`目录不存在: ${parent}`, 'not_found', parent)
  }

  async readText(rel: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(rel))
  }

  async readBytes(rel: string): Promise<Uint8Array> {
    const key = normalize(rel)
    const entry = this.files.get(key)
    if (!entry) throw new FsError(`文件不存在: ${key}`, 'not_found', key)
    return entry.bytes.slice()
  }

  async writeText(rel: string, data: string): Promise<void> {
    await this.writeBytes(rel, new TextEncoder().encode(data))
  }

  async writeBytes(rel: string, data: Uint8Array): Promise<void> {
    const key = normalize(rel)
    this.ensureParent(key)
    this.files.set(key, { bytes: data.slice(), mtimeMs: Date.now() })
  }

  async exists(rel: string): Promise<boolean> {
    const key = normalize(rel)
    return this.files.has(key) || this.dirs.has(key)
  }

  async stat(rel: string): Promise<FileStat | null> {
    const key = normalize(rel)
    const file = this.files.get(key)
    if (file) return { size: file.bytes.byteLength, mtimeMs: file.mtimeMs, isDir: false }
    if (this.dirs.has(key)) return { size: 0, mtimeMs: null, isDir: true }
    return null
  }

  async mkdir(rel: string): Promise<void> {
    const key = normalize(rel)
    if (key === '') return
    const segments = key.split('/')
    let acc = ''
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg
      this.dirs.add(acc)
    }
  }

  async list(rel: string): Promise<DirEntry[]> {
    const key = normalize(rel)
    if (!this.dirs.has(key)) throw new FsError(`目录不存在: ${key}`, 'not_found', key)
    const prefix = key === '' ? '' : `${key}/`
    const out = new Map<string, DirEntry>()

    for (const dirPath of this.dirs) {
      if (dirPath === key || !dirPath.startsWith(prefix)) continue
      const rest = dirPath.slice(prefix.length)
      if (rest.includes('/')) continue
      out.set(rest, { name: rest, path: dirPath, kind: 'dir' })
    }
    for (const [filePath, entry] of this.files) {
      if (!filePath.startsWith(prefix)) continue
      const rest = filePath.slice(prefix.length)
      if (rest.includes('/')) continue
      out.set(rest, { name: rest, path: filePath, kind: 'file', size: entry.bytes.byteLength })
    }
    return [...out.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async remove(rel: string, opts: { recursive?: boolean } = {}): Promise<void> {
    const key = normalize(rel)
    if (this.files.delete(key)) return
    if (!this.dirs.has(key)) throw new FsError(`路径不存在: ${key}`, 'not_found', key)
    const prefix = `${key}/`
    const children = [...this.files.keys(), ...this.dirs].filter((p) => p.startsWith(prefix))
    if (children.length > 0 && !opts.recursive) {
      throw new FsError(`目录非空: ${key}`, 'io', key)
    }
    for (const child of children) {
      this.files.delete(child)
      this.dirs.delete(child)
    }
    this.dirs.delete(key)
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalize(from)
    const dst = normalize(to)
    if (this.files.has(src)) {
      const entry = this.files.get(src)!
      this.files.delete(src)
      this.files.set(dst, entry)
      return
    }
    if (!this.dirs.has(src)) throw new FsError(`路径不存在: ${src}`, 'not_found', src)
    const prefix = `${src}/`
    for (const [path, entry] of [...this.files]) {
      if (path === src || path.startsWith(prefix)) {
        this.files.delete(path)
        this.files.set(dst + path.slice(src.length), entry)
      }
    }
    for (const dirPath of [...this.dirs]) {
      if (dirPath === src || dirPath.startsWith(prefix)) {
        this.dirs.delete(dirPath)
        this.dirs.add(dst + dirPath.slice(src.length))
      }
    }
  }

  absolute(rel: string): string {
    return join(this.root, rel)
  }
}
