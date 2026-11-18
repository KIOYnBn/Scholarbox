import { isTauriRuntime } from '@/lib/fs/tauri'

/**
 * 仓库注册表 —— 应用级配置，**永远不放进任何仓库文件夹**。
 *
 * 桌面端写在 Tauri 的 appConfigDir/vaults.json，浏览器端写在 localStorage。
 * 之所以要强调这一点：PAT 是明文，一旦落进仓库目录，下一次 `git push` 就把它
 * 推到 GitHub 上了。注册表必须活在仓库之外。
 */

export type VaultRootType = 'fs' | 'opfs'

export interface VaultEntry {
  id: string
  /** 显示名：默认取文件夹名，用户可改 */
  name: string
  /** fs = 桌面端真实文件夹；opfs = 浏览器沙盒里的子目录 */
  rootType: VaultRootType
  /** fs: 绝对路径；opfs: OPFS 内的目录名 */
  rootPath: string
  /** 形如 https://github.com/owner/repo.git，可空 */
  remoteUrl: string
  branch: string
  /** personal access token，仅本机 */
  pat: string
  /**
   * 浏览器端专用的 CORS 代理地址（桌面端走 Rust HTTP，不经过代理）。
   * 旧 vaults.json 里没有这个键时按默认值处理。
   */
  corsProxy: string
  autoCommitMinutes: number
  lastOpenedAt: number | null
  createdAt: number
}

export interface VaultRegistry {
  version: 1
  activeId: string | null
  vaults: VaultEntry[]
}

/** 与 `src/lib/git/repo.ts` 的 DEFAULT_CORS_PROXY 保持一致（registry 不反向依赖 git 层） */
export const DEFAULT_CORS_PROXY = 'https://cors.isomorphic-git.org'

const REGISTRY_FILENAME = 'vaults.json'
const LS_KEY = 'scholarbox.registry.v1'

export function emptyRegistry(): VaultRegistry {
  return { version: 1, activeId: null, vaults: [] }
}

export function newVaultId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 从路径里取一个像名字的东西：`D:\papers\MyVault` → `MyVault`，`OPFS://MyVault` → `MyVault` */
export function vaultNameFromPath(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '')
  const tail = cleaned.split(/[\\/]/).filter(Boolean).pop()
  return tail && tail !== cleaned ? tail : cleaned.replace(/^OPFS:\/\//, '') || '未命名仓库'
}

export function createVaultEntry(input: {
  name?: string
  rootType: VaultRootType
  rootPath: string
  remoteUrl?: string
  branch?: string
  pat?: string
  corsProxy?: string
  autoCommitMinutes?: number
}): VaultEntry {
  const now = Date.now()
  return {
    id: newVaultId(),
    name: (input.name ?? '').trim() || vaultNameFromPath(input.rootPath),
    rootType: input.rootType,
    rootPath: input.rootPath,
    remoteUrl: (input.remoteUrl ?? '').trim(),
    branch: (input.branch ?? '').trim() || 'main',
    pat: input.pat ?? '',
    corsProxy: (input.corsProxy ?? '').trim() || DEFAULT_CORS_PROXY,
    autoCommitMinutes: clampMinutes(input.autoCommitMinutes),
    lastOpenedAt: now,
    createdAt: now,
  }
}

function clampMinutes(value: unknown): number {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.min(24 * 60, Math.round(minutes))
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeEntry(raw: unknown, index: number): VaultEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const rootPath = str(item.rootPath).trim()
  if (!rootPath) return null
  const rootType: VaultRootType = item.rootType === 'opfs' ? 'opfs' : 'fs'
  const now = Date.now()
  const lastOpened = Number(item.lastOpenedAt)
  const created = Number(item.createdAt)
  return {
    id: str(item.id).trim() || `v-recovered-${index}`,
    name: str(item.name).trim() || vaultNameFromPath(rootPath),
    rootType,
    rootPath,
    remoteUrl: str(item.remoteUrl).trim(),
    branch: str(item.branch).trim() || 'main',
    pat: str(item.pat),
    corsProxy: str(item.corsProxy) || DEFAULT_CORS_PROXY,
    autoCommitMinutes: clampMinutes(item.autoCommitMinutes),
    lastOpenedAt: Number.isFinite(lastOpened) && lastOpened > 0 ? lastOpened : null,
    createdAt: Number.isFinite(created) && created > 0 ? created : now,
  }
}

/**
 * 容错解析：注册表坏掉不应该让应用起不来 —— 逐条归一化，丢掉读不懂的记录，
 * 再去掉重复 id。activeId 指向不存在的仓库时回落到第一条。
 */
export function normalizeRegistry(raw: unknown): VaultRegistry {
  if (!raw || typeof raw !== 'object') return emptyRegistry()
  const data = raw as Record<string, unknown>
  const list = Array.isArray(data.vaults) ? data.vaults : []
  const seen = new Set<string>()
  const vaults: VaultEntry[] = []
  list.forEach((item, index) => {
    const entry = normalizeEntry(item, index)
    if (!entry) return
    if (seen.has(entry.id)) entry.id = `${entry.id}-${index}`
    seen.add(entry.id)
    vaults.push(entry)
  })
  const activeId = str(data.activeId)
  return {
    version: 1,
    activeId: vaults.some((vault) => vault.id === activeId) ? activeId : (vaults[0]?.id ?? null),
    vaults,
  }
}

export function parseRegistry(text: string | null | undefined): VaultRegistry {
  if (!text || !text.trim()) return emptyRegistry()
  try {
    return normalizeRegistry(JSON.parse(text))
  } catch {
    // 手改坏了就当没有注册表，下次写入会重建
    console.warn('[registry] vaults.json 解析失败，已重置')
    return emptyRegistry()
  }
}

export function serializeRegistry(registry: VaultRegistry): string {
  return `${JSON.stringify(registry, null, 2)}\n`
}

export function upsertVault(registry: VaultRegistry, entry: VaultEntry): VaultRegistry {
  const index = registry.vaults.findIndex((vault) => vault.id === entry.id)
  const vaults =
    index === -1
      ? [...registry.vaults, entry]
      : registry.vaults.map((vault) => (vault.id === entry.id ? entry : vault))
  return { ...registry, vaults }
}

/** 只删注册表记录，绝不动磁盘上的文件 */
export function removeVault(registry: VaultRegistry, id: string): VaultRegistry {
  const vaults = registry.vaults.filter((vault) => vault.id !== id)
  const activeId = registry.activeId === id ? (vaults[0]?.id ?? null) : registry.activeId
  return { ...registry, vaults, activeId }
}

export function setActiveVault(registry: VaultRegistry, id: string | null): VaultRegistry {
  if (id !== null && !registry.vaults.some((vault) => vault.id === id)) return registry
  return { ...registry, activeId: id }
}

export function findVault(registry: VaultRegistry, id: string | null): VaultEntry | null {
  if (!id) return null
  return registry.vaults.find((vault) => vault.id === id) ?? null
}

export function activeVault(registry: VaultRegistry): VaultEntry | null {
  return findVault(registry, registry.activeId)
}

/** 同一路径只能注册一次（否则两个仓库会指向同一批文件） */
export function findVaultByPath(registry: VaultRegistry, rootPath: string): VaultEntry | null {
  const normalized = rootPath.replace(/[\\/]+$/, '').toLowerCase()
  return (
    registry.vaults.find((vault) => vault.rootPath.replace(/[\\/]+$/, '').toLowerCase() === normalized) ??
    null
  )
}

export interface LegacyVaultConfig {
  /** 旧版单仓库设置里的路径（桌面端绝对路径） */
  vaultPath?: string
  github?: {
    owner?: string
    repo?: string
    branch?: string
    token?: string
    autoCommitMinutes?: number
  }
}

/**
 * 首次启动迁移：把旧的「单仓库 + 全局 GitHub 配置」折算成一条注册表记录。
 * 已经有多条记录时原样返回 —— 迁移只发生一次。
 */
export function migrateLegacyRegistry(
  registry: VaultRegistry,
  legacy: LegacyVaultConfig,
  opts: { desktop: boolean; defaultPath?: string },
): { registry: VaultRegistry; migrated: boolean } {
  if (registry.vaults.length > 0) return { registry, migrated: false }

  const github = legacy.github ?? {}
  const remoteUrl =
    github.owner && github.repo ? `https://github.com/${github.owner}/${github.repo}.git` : ''

  const legacyPath = legacy.vaultPath?.trim() ?? ''
  // 全新安装时不要落一个相对路径到 appConfigDir 里 —— 那对用户是不可见的，
  // 而「文件夹即数据库」的前提是用户能自己找到那些文件。
  const rootPath = opts.desktop
    ? legacyPath || opts.defaultPath || 'ScholarBox/MyVault'
    : legacyPath.replace(/^OPFS:\/\//, '') || opts.defaultPath || 'MyVault'

  const entry = createVaultEntry({
    name: vaultNameFromPath(rootPath),
    rootType: opts.desktop ? 'fs' : 'opfs',
    rootPath,
    remoteUrl,
    branch: github.branch,
    pat: github.token,
    autoCommitMinutes: github.autoCommitMinutes,
  })

  return {
    registry: { version: 1, activeId: entry.id, vaults: [entry] },
    migrated: true,
  }
}

/* ------------------------------------------------------------------ */
/* IO：桌面端 appConfigDir/vaults.json，浏览器 localStorage            */
/* ------------------------------------------------------------------ */

async function readRaw(): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      return await readTextFile(REGISTRY_FILENAME, { baseDir: BaseDirectory.AppConfig })
    } catch {
      return null
    }
  }
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

async function writeRaw(text: string): Promise<void> {
  if (isTauriRuntime()) {
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir('', { baseDir: BaseDirectory.AppConfig, recursive: true }).catch(() => undefined)
    await writeTextFile(REGISTRY_FILENAME, text, { baseDir: BaseDirectory.AppConfig })
    return
  }
  localStorage.setItem(LS_KEY, text)
}

export async function loadRegistry(): Promise<VaultRegistry> {
  return parseRegistry(await readRaw())
}

export async function saveRegistry(registry: VaultRegistry): Promise<void> {
  await writeRaw(serializeRegistry(registry))
}
