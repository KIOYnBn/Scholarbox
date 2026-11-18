import { create } from 'zustand'
import { BrowserVaultFS } from '@/lib/fs/browser'
import { isTauriRuntime, TauriVaultFS } from '@/lib/fs/tauri'
import { FsError, type FsKind, type VaultFS } from '@/lib/fs/types'
import { VaultRepository } from '@/lib/vault/repository'
import type { VaultEntry } from '@/lib/vault/registry'
import { appConfigBaseDir } from '@/lib/vault/path-check'
import { isContentUri, resolveRootPath } from '@/lib/vault/paths'

export type VaultStatus = 'idle' | 'opening' | 'ready' | 'error'

interface VaultState {
  fs: VaultFS | null
  repo: VaultRepository | null
  status: VaultStatus
  error: string | null
  kind: FsKind | null
  /** 当前打开的仓库记录（来自注册表） */
  entry: VaultEntry | null
  /** temporary toast-ish message */
  notice: string | null

  openEntry: (entry: VaultEntry) => Promise<boolean>
  pickFolder: () => Promise<string | null>
  close: () => void
  clearNotice: () => void
  setNotice: (message: string | null) => void
}

export function isDesktop() {
  return isTauriRuntime()
}

/**
 * 打开仓库前的静态检查：在不碰文件系统的前提下，判断这个 rootPath 当前后端能不能用。
 * 返回 null 表示可以继续；返回字符串则是给用户看的、具体的原因。
 */
export function rootSupportError(
  entry: Pick<VaultEntry, 'rootPath' | 'rootType'>,
  desktop = isTauriRuntime(),
): string | null {
  if (isContentUri(entry.rootPath)) {
    return '当前后端未接入 SAF：Android 的 content:// 仓库还不能直接打开（需要先接 DocumentFile 桥接）'
  }
  if (entry.rootType === 'fs' && !desktop) {
    return '浏览器模式打不开本地文件夹，请用「浏览器仓库」'
  }
  return null
}

/**
 * 打开一个仓库。所有文件系统访问都以注册表里的 rootPath 为准 ——
 * 这里不再有任何 "MyVault" 之类的默认路径。
 */
export const useVaultStore = create<VaultState>()((set) => ({
  fs: null,
  repo: null,
  status: 'idle',
  error: null,
  kind: null,
  entry: null,
  notice: null,

  async openEntry(entry) {
    set({ status: 'opening', error: null, notice: null })
    try {
      let fs: VaultFS

      const unsupported = rootSupportError(entry)
      if (unsupported) throw new FsError(unsupported, 'denied')

      if (entry.rootType === 'fs') {
        // 注册表里允许存相对路径（相对 appConfigDir），打开时才解析成绝对路径；
        // baseDir 拿不到时 resolveRootPath 会抛 PathError，下面统一转成 FsError
        let absolute: string
        try {
          absolute = resolveRootPath(entry.rootPath, {
            desktop: true,
            baseDir: await appConfigBaseDir(),
          })
        } catch (err) {
          throw new FsError(err instanceof Error ? err.message : String(err), 'denied', entry.rootPath)
        }
        const tauriFs = new TauriVaultFS(absolute)
        await tauriFs.grantScope()
        if (!(await tauriFs.exists(''))) await tauriFs.mkdir('')
        fs = tauriFs
      } else {
        fs = await BrowserVaultFS.open(entry.rootPath.replace(/^OPFS:\/\//, ''))
      }

      const repo = new VaultRepository(fs, { name: entry.name })
    // 模板是可选的：第一次打开某个仓库时铺一份默认模板，之后完全由用户编辑
    await repo.ensureTemplates().catch((err) => console.warn('[templates] 初始化失败', err))
      await repo.ensureStructure()

      set({ fs, repo, status: 'ready', kind: fs.kind, error: null, entry })
      return true
    } catch (err) {
      const message =
        err instanceof FsError ? err.message : err instanceof Error ? err.message : String(err)
      console.error('[vault] open failed', err)
      set({ status: 'error', error: message, fs: null, repo: null, entry })
      return false
    }
  },

  /** 只负责选文件夹并返回路径；是否注册成仓库由 vaults store 决定 */
  async pickFolder() {
    if (!isTauriRuntime()) return null
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false, title: '选择仓库文件夹' })
      return typeof picked === 'string' && picked ? picked : null
    } catch (err) {
      console.warn('[vault] pick folder failed', err)
      return null
    }
  },

  close() {
    set({ fs: null, repo: null, status: 'idle', kind: null, entry: null })
  },

  clearNotice() {
    set({ notice: null })
  },

  setNotice(message) {
    set({ notice: message })
  },
}))
