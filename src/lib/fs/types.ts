/**
 * VaultFS — the single storage abstraction for ScholarBox.
 *
 * Local-first rule: every byte the app owns lives in a *plain folder on disk*
 * that the user picked. There is no hidden database. Each backend implements
 * this interface with the same semantics (paths are relative, `/` separated).
 */

export type FsKind = 'tauri' | 'browser' | 'memory'

export interface DirEntry {
  name: string
  /** path relative to the vault root */
  path: string
  kind: 'file' | 'dir'
  size?: number
}

export interface FileStat {
  size: number
  mtimeMs: number | null
  isDir: boolean
}

export interface VaultFS {
  readonly kind: FsKind
  /** human readable root (absolute path on desktop, pseudo path in browser) */
  readonly root: string

  readText(rel: string): Promise<string>
  readBytes(rel: string): Promise<Uint8Array>
  writeText(rel: string, data: string): Promise<void>
  writeBytes(rel: string, data: Uint8Array): Promise<void>
  exists(rel: string): Promise<boolean>
  stat(rel: string): Promise<FileStat | null>
  mkdir(rel: string): Promise<void>
  list(rel: string): Promise<DirEntry[]>
  remove(rel: string, opts?: { recursive?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** absolute path for the same file, when the backend can address files by URL */
  absolute?(rel: string): string
}

export class FsError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'denied' | 'exists' | 'io' | 'unknown' = 'unknown',
    readonly path?: string,
  ) {
    super(message)
    this.name = 'FsError'
  }
}

export function isNotFound(err: unknown): boolean {
  if (err instanceof FsError) return err.code === 'not_found'
  const message = err instanceof Error ? err.message : String(err)
  return /not found|no such file|ENOENT|could not be found|找不到/i.test(message)
}

export function toFsError(err: unknown, path?: string): FsError {
  if (err instanceof FsError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (/not found|no such file|ENOENT|could not be found|找不到/i.test(message)) {
    return new FsError(message, 'not_found', path)
  }
  if (/permission|denied|forbidden|EACCES|scope/i.test(message)) {
    return new FsError(message, 'denied', path)
  }
  return new FsError(message, 'io', path)
}
