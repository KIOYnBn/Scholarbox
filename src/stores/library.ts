import { create } from 'zustand'
import type { PaperMeta, PaperRecord } from '@/lib/vault/schema'
import { folderNameFor } from '@/lib/vault/schema'
import type { NewPaperInput } from '@/lib/vault/repository'
import { EMPTY_ITEM_FILTER, type ItemFilter } from '@/lib/library/filter'
import { markViewed, resetViewedThrottle } from '@/lib/library/recency'
import { useVaultStore } from './vault'

/**
 * 文献库的筛选器就是统一筛选器本身 —— 两个库读的是同一套判定逻辑，
 * 不会出现「文献库认标签交集、笔记库不认」这种分叉。
 */
export type LibraryFilter = ItemFilter

const EMPTY_FILTER: LibraryFilter = { ...EMPTY_ITEM_FILTER }

interface LibraryState {
  papers: PaperRecord[]
  loading: boolean
  error: string | null
  selectedDir: string | null
  filter: LibraryFilter

  load: () => Promise<void>
  refresh: () => Promise<void>
  /** 切仓库时用：清空文献、选中项与筛选，避免上一个仓库的数据漏进新仓库 */
  reset: () => void
  select: (dir: string | null) => void
  setFilter: (patch: Partial<LibraryFilter>) => void
  resetFilter: () => void
  updateMeta: (dir: string, patch: Partial<PaperMeta>) => Promise<void>
  togglePin: (dir: string) => Promise<void>
  markViewed: (dir: string) => Promise<void>
  createPaper: (input: NewPaperInput) => Promise<PaperRecord | null>
  deletePaper: (dir: string) => Promise<void>
  importPdf: (dir: string, bytes: Uint8Array) => Promise<void>
  saveNote: (dir: string, text: string) => Promise<void>
  /** update local state without touching disk (e.g. optimistic progress while scrolling) */
  patchLocal: (dir: string, patch: Partial<PaperMeta>) => void
}

export const useLibraryStore = create<LibraryState>()((set, get) => ({
  papers: [],
  loading: false,
  error: null,
  selectedDir: null,
  filter: { ...EMPTY_FILTER },

  async load() {
    const repo = useVaultStore.getState().repo
    if (!repo) return
    set({ loading: true, error: null })
    try {
      const papers = await repo.list()
      set({ papers, loading: false })
      const { selectedDir } = get()
      if (!selectedDir && papers.length > 0) {
        set({ selectedDir: papers[0].dir })
      }
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  async refresh() {
    await get().load()
  },

  reset() {
    // 切仓库时清掉「刚写过」的记忆，否则新仓库里同类条目会被误判为已写过
    resetViewedThrottle()
    set({ papers: [], selectedDir: null, filter: { ...EMPTY_FILTER }, error: null, loading: false })
  },

  select(dir) {
    set({ selectedDir: dir })
  },

  setFilter(patch) {
    set((state) => ({ filter: { ...state.filter, ...patch } }))
  },

  resetFilter() {
    set({ filter: { ...EMPTY_FILTER } })
  },

  async updateMeta(dir, patch) {
    const repo = useVaultStore.getState().repo
    if (!repo) return
    const current = get().papers.find((p) => p.dir === dir)
    if (!current) return
    const next: PaperMeta = { ...current.meta, ...patch }
    set((state) => ({
      papers: state.papers.map((p) => (p.dir === dir ? { ...p, meta: next } : p)),
    }))
    const saved = await repo.saveMeta(dir, next)

    // renaming the folder when title/author/year changes would break open readers,
    // so we only rename when the user explicitly asks (see renamePaper below).
    set((state) => ({
      papers: state.papers.map((p) => (p.dir === dir ? { ...p, meta: saved } : p)),
    }))
  },

  async togglePin(dir) {
    const current = get().papers.find((p) => p.dir === dir)
    if (!current) return
    await get().updateMeta(dir, { pinned: !current.meta.pinned })
  },

  /**
   * 记一次「看过」。同一篇 60 秒内只写一次盘 —— 打开一篇文献会同时
   * 触发阅读器、详情面板、窗口聚焦好几个入口，不去重就是连环写。
   */
  async markViewed(dir) {
    const current = get().papers.find((p) => p.dir === dir)
    if (!current) return
    await markViewed(`paper:${dir}`, async () => {
      const at = new Date().toISOString()
      get().patchLocal(dir, { lastViewedAt: at, lastOpenedAt: at })
      const repo = useVaultStore.getState().repo
      if (repo) {
        const paper = get().papers.find((p) => p.dir === dir)
        if (paper) await repo.saveMeta(dir, { ...paper.meta, lastViewedAt: at, lastOpenedAt: at })
      }
    })
  },

  patchLocal(dir, patch) {
    set((state) => ({
      papers: state.papers.map((p) =>
        p.dir === dir ? { ...p, meta: { ...p.meta, ...patch } } : p,
      ),
    }))
  },

  async createPaper(input) {
    const repo = useVaultStore.getState().repo
    if (!repo) return null
    try {
      const record = await repo.create(input)
      set((state) => ({ papers: [record, ...state.papers], selectedDir: record.dir }))
      return record
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  async deletePaper(dir) {
    const repo = useVaultStore.getState().repo
    if (!repo) return
    await repo.deletePaper(dir)
    set((state) => ({
      papers: state.papers.filter((p) => p.dir !== dir),
      selectedDir: state.selectedDir === dir ? null : state.selectedDir,
    }))
  },

  async importPdf(dir, bytes) {
    const repo = useVaultStore.getState().repo
    if (!repo) return
    await repo.replacePdf(dir, bytes)
    const stat = await repo.fs.stat(`${repo.paperPath(dir)}/origin.pdf`)
    set((state) => ({
      papers: state.papers.map((p) =>
        p.dir === dir ? { ...p, hasPdf: true, pdfSize: stat?.size ?? bytes.byteLength } : p,
      ),
    }))
  },

  async saveNote(dir, text) {
    const repo = useVaultStore.getState().repo
    if (!repo) return
    await repo.saveNote(dir, text)
    set((state) => ({
      papers: state.papers.map((p) => (p.dir === dir ? { ...p, note: text } : p)),
    }))
  },
}))

/** `folderNameFor` is re-exported for the "rename folder to match meta" action. */
export { folderNameFor }

export function selectFilteredPapers(state: {
  papers: PaperRecord[]
  filter: LibraryFilter
}): PaperRecord[] {
  const { papers, filter } = state
  const q = filter.query.trim().toLowerCase()
  return papers.filter((paper) => {
    const { meta } = paper
    if (filter.status !== 'all' && meta.status !== filter.status) return false
    if (meta.status === 'archived' && filter.status !== 'archived') return false
    if (meta.importance < filter.minImportance) return false
    if (filter.field && meta.field !== filter.field) return false
    if (filter.tags.length > 0 && !filter.tags.every((tag) => meta.tags.includes(tag))) return false
    if (!q) return true
    const haystack = [
      meta.title,
      meta.authors.join(' '),
      meta.venue,
      meta.field,
      meta.tags.join(' '),
      String(meta.year ?? ''),
      paper.dir,
    ]
      .join(' ')
      .toLowerCase()
    return q.split(/\s+/).every((token) => haystack.includes(token))
  })
}

export function selectFacets(papers: PaperRecord[]) {
  const fields = new Map<string, number>()
  const tags = new Map<string, number>()
  for (const { meta } of papers) {
    if (meta.field) fields.set(meta.field, (fields.get(meta.field) ?? 0) + 1)
    for (const tag of meta.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
  }
  return {
    fields: [...fields.entries()].sort((a, b) => b[1] - a[1]),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]),
  }
}
