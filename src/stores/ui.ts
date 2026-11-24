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

/** 全屏笔记的目标：某篇文献的 note 文件，或 notes/ 下的独立笔记；
 * blockId 带块引用跳转（[[笔记#^id]]），打开后滚动定位到该块 */
export type NoteTarget = ({ kind: 'paper'; dir: string } | { kind: 'standalone'; file: string }) & {
  blockId?: string
}

/** 笔记右侧抽屉：大纲 / 反向链接 */
export type NoteDrawerTab = 'outline' | 'backlinks'
export interface NoteDrawerState {
  pane: 'A' | 'B'
  tab: NoteDrawerTab
}

interface UiState {
  mainView: MainView
  homeMode: HomeMode
  sidebarTab: SidebarTab
  /** 全屏笔记当前打开的目标（左栏；单栏时就是全部） */
  noteTarget: NoteTarget | null
  /** 双栏对照时的右栏笔记；null = 单栏 */
  noteTargetB: NoteTarget | null
  /** 笔记选择弹窗：正在为哪一栏挑选（null = 关闭） */
  notePickerFor: 'A' | 'B' | null
  /** 笔记右侧抽屉（大纲 / 反向链接）；null = 收起 */
  noteDrawer: NoteDrawerState | null
  /** 关系图谱弹窗 */
  graphOpen: boolean
  /** 从书库「独立打开」时记住来处，返回时回到原页面 */
  noteReturnView: MainView
  /** 书架缩放（书脊卡片的比例，1 = 默认），文献书架与笔记书架共用 */
  shelfZoom: number
  /** 置顶的书架分组 key（分架维度名 + 组名），置顶的层排在最上面 */
  pinnedShelves: string[]
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
  /** 在右栏打开一篇笔记（双栏对照） */
  openNoteB: (target: NoteTarget) => void
  /** 关掉右栏，回到单栏 */
  closeNoteB: () => void
  /** 打开笔记选择弹窗，为指定栏挑一篇 */
  openNotePicker: (pane: 'A' | 'B') => void
  closeNotePicker: () => void
  /** 开 / 收右侧抽屉（大纲 / 反链） */
  toggleNoteDrawer: (pane: 'A' | 'B', tab: NoteDrawerTab) => void
  closeNoteDrawer: () => void
  openGraph: () => void
  closeGraph: () => void
  setShelfZoom: (zoom: number) => void
  /** 置顶 / 取消置顶某个书架分组（置顶的层始终排在最上面） */
  toggleShelfPin: (key: string) => void
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

export const SHELF_ZOOM_MIN = 0.7
export const SHELF_ZOOM_MAX = 1.6
export const SHELF_ZOOM_STEP = 0.1

export const useUiStore = create<UiState>((set, get) => ({
  mainView: 'home',
  homeMode: 'shelf',
  sidebarTab: 'library',
  noteTarget: null,
  noteTargetB: null,
  notePickerFor: null,
  noteDrawer: null,
  graphOpen: false,
  noteReturnView: 'home',
  shelfZoom: 1,
  pinnedShelves: [],
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
      notePickerFor: null,
    })),
  closeNote: () =>
    set((state) => ({ mainView: state.noteReturnView, noteTarget: null, noteTargetB: null })),
  openNoteB: (target) => set({ noteTargetB: target, notePickerFor: null }),
  closeNoteB: () => set({ noteTargetB: null }),
  openNotePicker: (pane) => set({ notePickerFor: pane }),
  closeNotePicker: () => set({ notePickerFor: null }),
  toggleNoteDrawer: (pane, tab) =>
    set((state) => {
      const current = state.noteDrawer
      const same = current && current.pane === pane && current.tab === tab
      return { noteDrawer: same ? null : { pane, tab } }
    }),
  closeNoteDrawer: () => set({ noteDrawer: null }),
  openGraph: () => set({ graphOpen: true }),
  closeGraph: () => set({ graphOpen: false }),
  setShelfZoom: (zoom) =>
    set({ shelfZoom: Math.min(SHELF_ZOOM_MAX, Math.max(SHELF_ZOOM_MIN, Math.round(zoom * 100) / 100)) }),
  toggleShelfPin: (key) =>
    set((state) => ({
      pinnedShelves: state.pinnedShelves.includes(key)
        ? state.pinnedShelves.filter((item) => item !== key)
        : [...state.pinnedShelves, key],
    })),
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
