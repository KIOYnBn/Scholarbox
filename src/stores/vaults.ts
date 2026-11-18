import { create } from 'zustand'
import {
  activeVault,
  createVaultEntry,
  emptyRegistry,
  findVault,
  findVaultByPath,
  loadRegistry,
  migrateLegacyRegistry,
  removeVault as removeVaultEntry,
  saveRegistry,
  setActiveVault,
  upsertVault,
  vaultNameFromPath,
  type VaultEntry,
  type VaultRegistry,
  type VaultRootType,
} from '@/lib/vault/registry'
import { appConfigBaseDir, probeVaultPath } from '@/lib/vault/path-check'
import { normalizeRootPath, validateRootPath } from '@/lib/vault/paths'
import {
  DeleteGuardError,
  guardDeletePath,
  inspectVaultFolder,
  removeFolder,
  resolveVaultRoot,
  type FolderReport,
} from '@/lib/vault/delete'
import { BrowserVaultFS } from '@/lib/fs/browser'
import { TauriVaultFS } from '@/lib/fs/tauri'
import type { VaultFS } from '@/lib/fs/types'
import { isTauriRuntime } from '@/lib/fs/tauri'
import { useSettingsStore } from './settings'
import { useVaultStore } from './vault'
import { useLibraryStore } from './library'
import { useStandaloneNotesStore } from './standalone'
import { useReaderStore } from './reader'
import { useUiStore } from './ui'


/** 拿某个仓库的 FS：当前仓库复用已打开的实例，其他仓库临时构造一个 */
async function fsForEntry(entry: VaultEntry): Promise<VaultFS> {
  const state = useVaultStore.getState()
  if (state.entry?.id === entry.id && state.fs) return state.fs
  if (entry.rootType === 'opfs') return BrowserVaultFS.open(entry.rootPath.replace(/^OPFS:\/\//, ''))
  return new TauriVaultFS(await resolveVaultRoot(entry))
}

/**
 * 多仓库（对标 Obsidian 的 vault）。注册表放在应用配置目录，不在任何仓库内。
 *
 * 切换仓库是这里唯一有状态副作用的操作：先提交、再拆、再建、再重载。
 */

interface VaultsState {
  registry: VaultRegistry
  ready: boolean
  busy: boolean
  error: string | null

  init: () => Promise<void>
  /** 桌面端弹目录选择器并注册；浏览器端创建一个 OPFS 子目录 */
  createVault: (input?: { name?: string; rootPath?: string }) => Promise<VaultEntry | null>
  /** 「打开已有文件夹」：已注册就切过去，没注册就注册后打开 */
  openFolder: (rootPath?: string) => Promise<VaultEntry | null>
  /** 只改注册表里的字段（不含 rootPath —— 路径变更走 updateVaultPath） */
  updateVault: (id: string, patch: Partial<Omit<VaultEntry, 'rootPath'>>) => Promise<void>
  /** 修改仓库文件夹路径：校验 → 探磁盘 → 必要时自动提交 → 重开 */
  updateVaultPath: (id: string, rawPath: string) => Promise<boolean>
  /** 删除仓库。`deleteFolder` 为真时把磁盘上的文件夹一起删掉（默认只删记录） */
  removeVault: (id: string, options?: { deleteFolder?: boolean }) => Promise<boolean>
  /** 删除前的体检：绝对路径、文件数、体积、未提交改动、是否已推送 */
  inspectVault: (id: string) => Promise<FolderReport | null>
  switchTo: (id: string) => Promise<boolean>
  /** 打开失败后重试当前仓库 */
  retry: () => Promise<void>
  clearError: () => void
  touchActive: () => Promise<void>
}

/** 切换/改路径后必须丢掉上一个仓库的 Git 状态，否则历史与远端会串仓 */
async function resetSyncState() {
  const { useSyncStore } = await import('./sync')
  useSyncStore.setState({
    connected: false,
    branch: null,
    remote: null,
    changes: { added: 0, modified: 0, deleted: 0, files: [] },
    history: [],
    busy: null,
    error: null,
    hint: null,
    notice: null,
    lastSyncAt: null,
  })
}

function persist(registry: VaultRegistry) {
  void saveRegistry(registry).catch((err) => console.warn('[vaults] 保存注册表失败', err))
}

async function defaultDesktopPath(): Promise<string> {
  try {
    const { documentDir, join } = await import('@tauri-apps/api/path')
    return await join(await documentDir(), 'ScholarBox', 'MyVault')
  } catch {
    return 'ScholarBox/MyVault'
  }
}

export const useVaultsStore = create<VaultsState>()((set, get) => ({
  registry: emptyRegistry(),
  ready: false,
  busy: false,
  error: null,

  async init() {
    if (get().ready) return
    set({ busy: true, error: null })
    try {
      const desktop = isTauriRuntime()
      const settings = useSettingsStore.getState()
      const stored = await loadRegistry()
      const defaultRoot = desktop ? await defaultDesktopPath() : 'MyVault'

      let { registry, migrated } = migrateLegacyRegistry(
        stored,
        { vaultPath: settings.vaultPath, github: settings.github },
        { desktop, defaultPath: defaultRoot },
      )

      // 全新安装：注册一个默认仓库，避免首屏没东西可开
      if (registry.vaults.length === 0) {
        const rootPath = defaultRoot
        const entry = createVaultEntry({
          name: vaultNameFromPath(rootPath),
          rootType: desktop ? 'fs' : 'opfs',
          rootPath,
        })
        registry = { version: 1, activeId: entry.id, vaults: [entry] }
        migrated = true
      }

      if (migrated) await saveRegistry(registry)
      set({ registry })

      const entry = activeVault(registry)
      if (!entry) {
        set({ ready: true, busy: false })
        return
      }
      const ok = await useVaultStore.getState().openEntry(entry)
      set({ ready: true, busy: false, error: ok ? null : useVaultStore.getState().error })
      if (ok) await get().touchActive()
    } catch (err) {
      set({
        busy: false,
        ready: true,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  async createVault(input) {
    if (get().busy) return null
    const desktop = isTauriRuntime()
    const rootType: VaultRootType = desktop ? 'fs' : 'opfs'
    let raw = input?.rootPath?.trim() ?? ''

    if (!raw) {
      if (desktop) {
        const picked = await useVaultStore.getState().pickFolder()
        if (!picked) return null
        raw = picked
      } else {
        // 浏览器端用 OPFS 子目录模拟多仓库：默认起个不重名的
        const existing = new Set(get().registry.vaults.map((vault) => vault.rootPath.toLowerCase()))
        let index = get().registry.vaults.length + 1
        let candidate = `Vault-${index}`
        while (existing.has(candidate.toLowerCase())) {
          index += 1
          candidate = `Vault-${index}`
        }
        raw = candidate
      }
    }

    const validation = validateRootPath({
      raw,
      rootType,
      desktop,
      registry: get().registry,
    })
    if (!validation.ok) {
      set({ error: validation.reason ?? '路径不合法' })
      return null
    }

    set({ busy: true })
    let probe: Awaited<ReturnType<typeof probeVaultPath>>
    try {
      probe = await probeVaultPath({ rootType, path: validation.path })
    } finally {
      set({ busy: false })
    }
    if (!probe.ok) {
      set({ error: probe.reason ?? '这个路径不可用' })
      return null
    }

    const entry = createVaultEntry({
      name: input?.name,
      rootType,
      rootPath: validation.path,
    })
    const registry = upsertVault(get().registry, entry)
    set({ registry, error: null })
    await saveRegistry(registry)
    return entry
  },

  async openFolder(rootPath) {
    let path = rootPath?.trim() ?? ''
    if (!path) {
      path = (await useVaultStore.getState().pickFolder()) ?? ''
      if (!path) return null
    }
    const normalized = normalizeRootPath(path, {
      rootType: isTauriRuntime() ? 'fs' : 'opfs',
      desktop: isTauriRuntime(),
    })
    if (normalized.ok) path = normalized.path
    const existing = findVaultByPath(get().registry, path)
    const entry = existing ?? (await get().createVault({ rootPath: path }))
    if (!entry) return null
    if (entry.id !== get().registry.activeId) await get().switchTo(entry.id)
    return entry
  },

  async updateVault(id, patch) {
    const current = findVault(get().registry, id)
    if (!current) return
    const next: VaultEntry = {
      ...current,
      ...patch,
      id: current.id,
      rootPath: current.rootPath,
      branch: (patch.branch ?? current.branch).trim() || 'main',
    }
    const registry = upsertVault(get().registry, next)
    set({ registry, error: null })
    await saveRegistry(registry)
  },

  async updateVaultPath(id, rawPath) {
    if (get().busy) return false
    const current = findVault(get().registry, id)
    if (!current) return false
    const desktop = isTauriRuntime()

    const validation = validateRootPath({
      raw: rawPath,
      rootType: current.rootType,
      desktop,
      registry: get().registry,
      ignoreId: id,
    })
    if (!validation.ok) {
      set({ error: validation.reason ?? '路径不合法' })
      return false
    }
    if (validation.path === current.rootPath) return true

    set({ busy: true, error: null })
    let probe: Awaited<ReturnType<typeof probeVaultPath>>
    try {
      probe = await probeVaultPath({ rootType: current.rootType, path: validation.path })
    } finally {
      set({ busy: false })
    }
    if (!probe.ok) {
      set({ error: probe.reason ?? '这个路径不可用' })
      return false
    }

    set({ busy: true, error: null })
    const isActive = get().registry.activeId === id

    try {
      // 改路径前先把当前仓库的未提交改动落盘，否则历史会和文件对不上
      if (isActive) {
        const { useSyncStore } = await import('./sync')
        const sync = useSyncStore.getState()
        const dirty = sync.changes.added + sync.changes.modified + sync.changes.deleted
        if (sync.connected && dirty > 0) {
          await sync.commit('改仓库路径前自动提交 · ' + new Date().toLocaleString('zh-CN'))
        }
        useVaultStore.getState().close()
        useLibraryStore.getState().reset()
        useStandaloneNotesStore.getState().reset()
        await resetSyncState()
      }

      const moved: VaultEntry = { ...current, rootPath: validation.path }
      const registry = upsertVault(get().registry, moved)
      set({ registry, error: null })
      await saveRegistry(registry)

      if (isActive) {
        const ok = await useVaultStore.getState().openEntry(moved)
        if (!ok) {
          const reason = useVaultStore.getState().error ?? '新路径打不开'
          // 回滚：先把注册表指回旧路径，再重新打开，避免仓库「丢了」
          const restored = upsertVault(get().registry, current)
          set({ registry: restored })
          try {
            await saveRegistry(restored)
          } catch (err) {
            console.warn('[vaults] 回滚注册表写入失败', err)
          }
          const reopened = await useVaultStore.getState().openEntry(current)
          set({
            busy: false,
            error: reopened
              ? `新路径打不开（${reason}），已回滚到原来的位置`
              : `新路径打不开（${reason}），回滚也失败了：请检查「${current.rootPath}」是否还在`,
          })
          return false
        }
        await useLibraryStore.getState().load()
        await useStandaloneNotesStore.getState().load()
        await get().touchActive()
      }
      set({ busy: false })
      return true
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  async inspectVault(id) {
    const entry = findVault(get().registry, id)
    if (!entry) return null
    try {
      const fs = await fsForEntry(entry)
      return await inspectVaultFolder(fs, entry)
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  async removeVault(id, options = {}) {
    const { deleteFolder = false } = options
    const registry = get().registry
    const entry = findVault(registry, id)
    if (!entry) return false
    if (get().busy) return false

    set({ busy: true, error: null })
    try {
      const wasActive = registry.activeId === id

      // ── 1. 先把该写的东西写回磁盘：笔记有 700ms 防抖、进度 2.5s、标注 500ms ──
      if (wasActive) {
        const dir = useLibraryStore.getState().selectedDir
        if (dir) {
          const { flushProgress } = await import('./reader')
          const { flushAnnotations } = await import('./annotations')
          try {
            flushProgress(dir)
            await flushAnnotations(dir)
          } catch {
            // 冲刷失败不该阻止用户删除，但下面会提示可能丢失最后几秒的编辑
          }
        }
      }

      // ── 2. 停掉自动提交：把 sync 的 busy 位占住，60s 定时器下一次就会短路 ──
      const { useSyncStore } = await import('./sync')
      useSyncStore.setState({ busy: 'commit' })

      // ── 3. 要删文件夹时先算路径与护栏，再决定要不要动注册表 ──
      let resolved: string | null = null
      if (deleteFolder) {
        const fs = await fsForEntry(entry)
        resolved = await resolveVaultRoot(entry)
        const others = registry.vaults.filter((vault) => vault.id !== id).map((vault) => vault.rootPath)
        const guard = guardDeletePath(resolved, {
          configDir: await appConfigBaseDir(),
          homeOverride: null,
          otherRoots: others,
        })
        if (!guard.ok) throw new DeleteGuardError(guard.reason, '换一个位置，或先用系统文件管理器手动处理')
        void fs
      }

      // ── 4. 删目录（回收站优先）—— 失败就保持注册表原样，什么都不丢 ──
      if (deleteFolder && resolved) {
        const fs = await fsForEntry(entry)
        await removeFolder(fs, entry.rootType, resolved)
      }

      // ── 5. 切走：现在才把当前仓库从「使用中」摘下来 ──
      if (wasActive) {
        useVaultStore.getState().close()
        useLibraryStore.getState().reset()
        useStandaloneNotesStore.getState().reset()
        useReaderStore.getState().close()
        await resetSyncState()
      }

      // ── 6. 最后写注册表（记录移除）──
      const nextRegistry = removeVaultEntry(registry, id)
      set({ registry: nextRegistry })
      await saveRegistry(nextRegistry)

      if (wasActive) {
        const next = activeVault(nextRegistry)
        if (next) {
          const ok = await useVaultStore.getState().openEntry(next)
          if (ok) {
            await useLibraryStore.getState().load()
            await useStandaloneNotesStore.getState().load()
          }
        }
      }

      set({ busy: false })
      return true
    } catch (err) {
      // 失败：注册表没动过（要么还没写，要么在写之前就抛了），把错误如实报出来
      const message = err instanceof Error ? err.message : String(err)
      const hint = err instanceof DeleteGuardError ? (err.hint ?? null) : null
      set({ busy: false, error: hint ? `${message} —— ${hint}` : message })
      return false
    } finally {
      const { useSyncStore } = await import('./sync')
      if (useSyncStore.getState().busy === 'commit' && !useSyncStore.getState().error) {
        useSyncStore.setState({ busy: null })
      }
    }
  },

  async switchTo(id) {
    const { registry, busy } = get()
    if (busy) return false
    if (registry.activeId === id) return true
    const entry = findVault(registry, id)
    if (!entry) return false

    set({ busy: true, error: null })
    try {
      // 1. 有未提交改动先自动提交，避免切换时丢失「刚写的笔记」
      const { useSyncStore } = await import('./sync')
      const sync = useSyncStore.getState()
      if (sync.connected) {
        await sync.refresh()
        const dirty =
          useSyncStore.getState().changes.added +
          useSyncStore.getState().changes.modified +
          useSyncStore.getState().changes.deleted
        if (dirty > 0) await sync.commit(`切换仓库前自动提交 · ${new Date().toLocaleString('zh-CN')}`)
      }

      // 2. 拆掉旧的：文件系统、文献库、阅读器、Git 状态、筛选条件
      useVaultStore.getState().close()
      useLibraryStore.getState().reset()
      useLibraryStore.getState().resetFilter()
      useStandaloneNotesStore.getState().reset()
      useUiStore.getState().resetNotesFilter()
      useReaderStore.getState().close()
      useSettingsStore.getState().set({ lastPaperDir: null })
      await resetSyncState()

      // 3. 写注册表 + 打开新仓库
      const nextRegistry = setActiveVault(registry, id)
      set({ registry: nextRegistry })
      await saveRegistry(nextRegistry)

      const ok = await useVaultStore.getState().openEntry(entry)
      if (!ok) {
        set({ busy: false, error: useVaultStore.getState().error })
        return false
      }

      // 4. 重载文献 + 独立笔记 + Git 状态
      await useLibraryStore.getState().load()
      await useStandaloneNotesStore.getState().load()
      await useSyncStore.getState().refresh()
      await useSyncStore.getState().loadHistory()
      await get().touchActive()
      set({ busy: false })
      return true
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : String(err) })
      return false
    }
  },

  clearError() {
    set({ error: null })
  },

  async retry() {
    const entry = activeVault(get().registry)
    if (!entry) return
    set({ error: null })
    const ok = await useVaultStore.getState().openEntry(entry)
    if (!ok) {
      set({ error: useVaultStore.getState().error })
      return
    }
    await useLibraryStore.getState().load()
    await useStandaloneNotesStore.getState().load()
  },

  async touchActive() {
    const entry = activeVault(get().registry)
    if (!entry) return
    const registry = upsertVault(get().registry, { ...entry, lastOpenedAt: Date.now() })
    set({ registry })
    persist(registry)
  },
}))
