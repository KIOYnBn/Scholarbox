import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { appStorage } from '@/lib/storage'

export type ThemeMode = 'light' | 'dark' | 'system'
export type HomeSection = 'papers' | 'notes'
export type TranslationProvider = 'mymemory' | 'google-free' | 'deepl' | 'openai' | 'none'

export interface GithubConfig {
  owner: string
  repo: string
  branch: string
  /** personal access token with `repo` scope; kept in app data, never in the vault */
  token: string
  authorName: string
  authorEmail: string
  /** minutes between auto-commits, 0 disables */
  autoCommitMinutes: number
}

/** 三栏布局在每个仓库下的记忆（按 activeVault 隔离） */
export interface VaultUiPrefs {
  sidebarOpen: boolean
  notesOpen: boolean
  sidebarWidth: number
  notesWidth: number
}

export const DEFAULT_VAULT_UI: VaultUiPrefs = {
  sidebarOpen: true,
  notesOpen: true,
  sidebarWidth: 320,
  notesWidth: 420,
}

/** 编辑器的行为开关与字体（对右栏、全屏笔记、独立笔记、文献笔记一视同仁） */
export type NoteBackground = 'theme' | 'paper' | 'sepia' | 'mint' | 'slate' | 'ink'
export type NoteWidth = 'narrow' | 'normal' | 'wide' | 'full'

export interface EditorPrefs {
  autocomplete: boolean
  livePreview: boolean
  html: boolean
  lineNumbers: boolean
  guides: boolean
  ruler: boolean
  folding: boolean
  listContinuation: boolean
  embedPreview: boolean
  softWrap: boolean
  fontSize: number
  lineHeight: number
  fontFamily: string
  previewFontFamily: string
  /** 笔记底色（只影响笔记区域，不动整个界面主题） */
  noteBackground: NoteBackground
  /** 笔记版心宽度：以前固定 max-w-4xl，单独开笔记时左右空白太大 */
  noteWidth: NoteWidth
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  autocomplete: true,
  livePreview: true,
  html: true,
  lineNumbers: false,
  guides: true,
  ruler: true,
  folding: true,
  listContinuation: true,
  embedPreview: true,
  softWrap: true,
  fontSize: 15,
  lineHeight: 1.7,
  fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
  previewFontFamily: '"Inter", "PingFang SC", system-ui, sans-serif',
  noteBackground: 'theme',
  noteWidth: 'wide',
}

export interface SettingsState {
  theme: ThemeMode
  /** absolute folder on desktop; empty until the user picks one */
  vaultPath: string
  /** last opened paper folder */
  lastPaperDir: string | null
  zoomMode: 'fit-width' | 'fit-page' | 'custom'
  zoomValue: number
  sidebarWidth: number
  notesWidth: number
  libraryView: 'list' | 'grid'
  /** 主界面停在文献书库还是笔记书架；持久化，下次启动沿用 */
  homeSection: HomeSection
  sortBy: 'recent' | 'added' | 'title' | 'importance' | 'progress'
  showArchived: boolean
  /** vaultId -> 三栏折叠状态与栏宽；切仓库时各用各的 */
  vaultUi: Record<string, VaultUiPrefs>
  /** 编辑器偏好：应用级，不随仓库变 */
  editor: EditorPrefs
  github: GithubConfig
  translation: {
    provider: TranslationProvider
    targetLang: string
    apiKey: string
    endpoint: string
  }
  set: (patch: Partial<SettingsState>) => void
  setHomeSection: (section: HomeSection) => void
  /** 合并写入某个仓库的布局偏好（未知仓库时自动建一条默认值） */
  setVaultUi: (vaultId: string, patch: Partial<VaultUiPrefs>) => void
  setEditor: (patch: Partial<EditorPrefs>) => void
  setGithub: (patch: Partial<GithubConfig>) => void
  setTranslation: (patch: Partial<SettingsState['translation']>) => void
}

export const DEFAULT_GITHUB: GithubConfig = {
  owner: '',
  repo: '',
  branch: 'main',
  token: '',
  authorName: 'ScholarBox',
  authorEmail: 'scholarbox@localhost',
  autoCommitMinutes: 0,
}

/** 读某个仓库的布局偏好（缺省项自动补默认值）。 */
export function vaultUiPrefs(vaultId: string | null | undefined): VaultUiPrefs {
  if (!vaultId) return { ...DEFAULT_VAULT_UI }
  return { ...DEFAULT_VAULT_UI, ...useSettingsStore.getState().vaultUi[vaultId] }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      vaultPath: '',
      lastPaperDir: null,
      zoomMode: 'fit-width',
      zoomValue: 1,
      sidebarWidth: 320,
      notesWidth: 420,
      libraryView: 'list',
      homeSection: 'papers',
      sortBy: 'recent',
      showArchived: false,
      github: { ...DEFAULT_GITHUB },
      translation: {
        provider: 'mymemory',
        targetLang: 'zh-CN',
        apiKey: '',
        endpoint: '',
      },
      vaultUi: {},
      editor: DEFAULT_EDITOR_PREFS,
      setEditor: (patch) => set((state) => ({ editor: { ...state.editor, ...patch } })),
      set: (patch) => set(patch),
      setHomeSection: (section) => set({ homeSection: section }),
      setVaultUi: (vaultId, patch) =>
        set((state) => ({
          vaultUi: {
            ...state.vaultUi,
            [vaultId]: { ...DEFAULT_VAULT_UI, ...state.vaultUi[vaultId], ...patch },
          },
        })),
      setGithub: (patch) => set((state) => ({ github: { ...state.github, ...patch } })),
      setTranslation: (patch) =>
        set((state) => ({ translation: { ...state.translation, ...patch } })),
    }),
    {
      name: 'scholarbox.settings.v1',
      version: 1,
      storage: createJSONStorage(() => appStorage),
      // 新增偏好（底色、版心宽度…）时老用户的存档里没有这些键。zustand 默认是浅合并，
      // 会把整个 `editor` 覆盖成旧对象，新字段一律 undefined —— 这里按组深合并一次。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...saved,
          editor: { ...DEFAULT_EDITOR_PREFS, ...(saved.editor ?? {}) },
          github: { ...current.github, ...(saved.github ?? {}) },
          translation: { ...current.translation, ...(saved.translation ?? {}) },
          vaultUi: saved.vaultUi ?? current.vaultUi,
        }
      },
      partialize: (state) => {
        const { set: _set, setGithub: _sg, setTranslation: _st, ...rest } = state
        return rest
      },
    },
  ),
)
