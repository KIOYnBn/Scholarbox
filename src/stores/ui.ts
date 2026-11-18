import { create } from 'zustand'
import type { ShelfDimension } from '@/lib/shelf'
import { EMPTY_ITEM_FILTER, type ItemFilter, type ItemSort } from '@/lib/library/filter'

export type SettingsSection = 'general' | 'appearance' | 'sync' | 'translation' | 'about'

/** 书库首页的两副面孔：书架 / 列表（列表直接复用三栏视图里的文献列表与全部筛选） */
export type HomeMode = 'shelf' | 'list'

/** 顶层三态：书库 / 三栏工作区 / 全屏笔记 */
export type MainView = 'home' | 'workspace' | 'note'

/** 侧栏两个页签：文献库 / 笔记 */
export type SidebarTab = 'library' | 'notes'

/** 全屏笔记的目标：某篇文献的 note.md，或 notes/ 下的独立笔记 */
export type NoteTarget = { kind: 'paper'; dir: string } | { kind: 'standalone'; file: string }

interface UiState {
  mainView: MainView
  homeMode: HomeMode
  sidebarTab: SidebarTab
  /** 全屏笔记当前打开的目标 */
  noteTarget: NoteTarget | null
  /** 从书库「独立打开」时记住来处，返回时回到原页面 */
  noteReturnView: MainView
  shelfDimension: ShelfDimension
  /** 笔记库自己的视图状态（与文献库互不影响） */
  notesFilter: ItemFilter
  notesSort: ItemSort
  notesMode: 'list' | 'shelf'
  /** 笔记书架主界面（非侧栏）的视图模式 */
  homeNotesMode: 'shelf' | 'list'
  /** 列表视图是否按分类分组（组内置顶最前） */
  papersGrouped: boolean
  notesGrouped: boolean
  notesDimension: ShelfDimension
  /** 「独立打开笔记」弹窗里的文献 */
  noteDialogDir: string | null
  /** 「编辑元信息」弹窗里的文献 */
  metaDialogDir: string | null
  sidebarOpen: boolean
  notesOpen: boolean
  settingsOpen: boolean
  settingsSection: SettingsSection
  vaultManagerOpen: boolean
  addPaperOpen: boolean
  filterFocus: number
  setMainView: (view: MainView) => void
  setSidebarTab: (tab: SidebarTab) => void
  openNote: (target: NoteTarget) => void
  closeNote: () => void
  setHomeMode: (mode: HomeMode) => void
  setShelfDimension: (dimension: ShelfDimension) => void
  setNotesFilter: (patch: Partial<ItemFilter>) => void
  resetNotesFilter: () => void
  setNotesSort: (sort: ItemSort) => void
  setHomeNotesMode: (mode: 'shelf' | 'list') => void
  setPapersGrouped: (value: boolean) => void
  setNotesGrouped: (value: boolean) => void
  setNotesMode: (mode: 'list' | 'shelf') => void
  setNotesDimension: (dimension: ShelfDimension) => void
  openNoteDialog: (dir: string | null) => void
  openMetaDialog: (dir: string | null) => void
  toggleSidebar: (open?: boolean) => void
  toggleNotes: (open?: boolean) => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  openVaultManager: () => void
  closeVaultManager: () => void
  openAddPaper: () => void
  closeAddPaper: () => void
  focusFilter: () => void
}

export const useUiStore = create<UiState>((set, get) => ({
  mainView: 'home',
  homeMode: 'shelf',
  sidebarTab: 'library',
  noteTarget: null,
  noteReturnView: 'home',
  shelfDimension: 'field',
  notesFilter: { ...EMPTY_ITEM_FILTER },
  notesSort: 'updated',
  notesMode: 'list',
  homeNotesMode: 'shelf',
  papersGrouped: false,
  notesGrouped: false,
  notesDimension: 'field',
  noteDialogDir: null,
  metaDialogDir: null,
  sidebarOpen: true,
  notesOpen: false,
  settingsOpen: false,
  settingsSection: 'general',
  vaultManagerOpen: false,
  addPaperOpen: false,
  filterFocus: 0,
  setMainView: (view) => set({ mainView: view }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  openNote: (target) =>
    set((state) => ({
      noteTarget: target,
      noteReturnView: state.mainView === 'note' ? state.noteReturnView : state.mainView,
      mainView: 'note',
    })),
  closeNote: () => set((state) => ({ mainView: state.noteReturnView, noteTarget: null })),
  setHomeMode: (mode) => set({ homeMode: mode }),
  setShelfDimension: (dimension) => set({ shelfDimension: dimension }),
  setNotesFilter: (patch) => set((state) => ({ notesFilter: { ...state.notesFilter, ...patch } })),
  resetNotesFilter: () => set({ notesFilter: { ...EMPTY_ITEM_FILTER } }),
  setNotesSort: (sort) => set({ notesSort: sort }),
  setHomeNotesMode: (mode: 'shelf' | 'list') => set({ homeNotesMode: mode }),
  setPapersGrouped: (value) => set({ papersGrouped: value }),
  setNotesGrouped: (value) => set({ notesGrouped: value }),
  setNotesMode: (mode) => set({ notesMode: mode }),
  setNotesDimension: (dimension) => set({ notesDimension: dimension }),
  openNoteDialog: (dir) => set({ noteDialogDir: dir }),
  openMetaDialog: (dir) => set({ metaDialogDir: dir }),
  toggleSidebar: (open) => set({ sidebarOpen: open ?? !get().sidebarOpen }),
  toggleNotes: (open) => set({ notesOpen: open ?? !get().notesOpen }),
  openSettings: (section) =>
    set(section ? { settingsOpen: true, settingsSection: section } : { settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openVaultManager: () => set({ vaultManagerOpen: true }),
  closeVaultManager: () => set({ vaultManagerOpen: false }),
  openAddPaper: () => set({ addPaperOpen: true }),
  closeAddPaper: () => set({ addPaperOpen: false }),
  focusFilter: () => set({ filterFocus: get().filterFocus + 1 }),
}))
