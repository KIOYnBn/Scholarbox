import { create } from 'zustand'
import { NotesRepository, type NoteMetaPatch, type StandaloneNote } from '@/lib/notes/repository'
import type { NoteStatus } from '@/lib/library/item'
import { markViewed } from '@/lib/library/recency'
import { useVaultStore } from './vault'

interface StandaloneState {
  notes: StandaloneNote[]
  loading: boolean
  error: string | null
  /** 笔记库的搜索词 */
  query: string
  /** 标签筛选（null = 全部，保留给旧调用点） */
  tag: string | null

  load: () => Promise<void>
  create: (title?: string) => Promise<StandaloneNote | null>
  rename: (file: string, title: string) => Promise<StandaloneNote | null>
  remove: (file: string) => Promise<void>
  save: (file: string, text: string) => Promise<string>
  updateMeta: (file: string, patch: NoteMetaPatch) => Promise<void>
  togglePinned: (file: string) => Promise<void>
  setStatus: (file: string, status: NoteStatus) => Promise<void>
  touchViewed: (file: string) => void
  setQuery: (query: string) => void
  setTag: (tag: string | null) => void
  reset: () => void
}

function repository(): NotesRepository | null {
  const fs = useVaultStore.getState().fs
  return fs ? new NotesRepository(fs) : null
}

export const useStandaloneNotesStore = create<StandaloneState>((set, get) => ({
  notes: [],
  loading: false,
  error: null,
  query: '',
  tag: null,

  async load() {
    const repo = repository()
    if (!repo) return
    set({ loading: true, error: null })
    try {
      const notes = await repo.list()
      set({ notes, loading: false })
    } catch (err) {
      console.error('[notes] 列表读取失败', err)
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  async create(title) {
    const repo = repository()
    if (!repo) return null
    try {
      const note = await repo.create({ title })
      set({ notes: sortNotes([note, ...get().notes.filter((item) => item.file !== note.file)]) })
      return note
    } catch (err) {
      console.error('[notes] 新建失败', err)
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  async rename(file, title) {
    const repo = repository()
    if (!repo) return null
    try {
      const note = await repo.rename(file, title)
      set({
        notes: sortNotes([note, ...get().notes.filter((item) => item.file !== file && item.file !== note.file)]),
      })
      return note
    } catch (err) {
      console.error('[notes] 重命名失败', err)
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  async remove(file) {
    const repo = repository()
    if (!repo) return
    try {
      await repo.remove(file)
      set({ notes: get().notes.filter((note) => note.file !== file) })
    } catch (err) {
      console.error('[notes] 删除失败', err)
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  async save(file, text) {
    const repo = repository()
    if (!repo) throw new Error('文献库还没打开')
    const next = await repo.save(file, text)
    // 保存后回填 frontmatter 的 updated 与标题，侧栏排序才不会停在旧位置
    set({
      notes: sortNotes(
        get().notes.map((note) =>
          note.file === file
            ? {
                ...note,
                title: extractTitle(next, note.slug),
                updatedAt: new Date().toISOString(),
                mtime: new Date().toISOString(),
                body: next,
              }
            : note,
        ),
      ),
    })
    return next
  },

  async updateMeta(file, patch) {
    const repo = repository()
    if (!repo) return
    try {
      const note = await repo.updateMeta(file, patch)
      set({ notes: sortNotes(get().notes.map((item) => (item.file === file ? note : item))) })
    } catch (err) {
      console.error('[notes] 元信息写入失败', err)
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  async togglePinned(file) {
    const current = get().notes.find((note) => note.file === file)
    if (!current) return
    await get().updateMeta(file, { pinned: !current.pinned })
  },

  async setStatus(file, status) {
    await get().updateMeta(file, { status })
  },

  /** 只记「最近查看」，失败也不吵用户；同一篇 60 秒内只写一次盘 */
  touchViewed(file) {
    const repo = repository()
    if (!repo) return
    const at = new Date().toISOString()
    void markViewed(`note:${file}`, async () => {
      await repo.touchViewed(file)
      set({
        notes: get().notes.map((note) => (note.file === file ? { ...note, lastViewedAt: at } : note)),
      })
    }).catch(() => undefined)
  },

  setQuery(query) {
    set({ query })
  },

  setTag(tag) {
    set({ tag })
  },

  reset() {
    set({ notes: [], loading: false, error: null, query: '', tag: null })
  },
}))

function extractTitle(text: string, slug: string): string {
  // 复用 repository 里同一套解析：frontmatter 之后的第一个标题
  const body = text.replace(/^---[\s\S]*?\n---[ \t]*\r?\n?/, '')
  const match = body.match(/^#\s+(.+?)\s*$/m)
  return match ? match[1]! : slug
}

function sortNotes(notes: StandaloneNote[]): StandaloneNote[] {
  return [...notes].sort((a, b) => (b.updatedAt ?? b.mtime ?? '').localeCompare(a.updatedAt ?? a.mtime ?? ''))
}

/** 侧栏用：搜索 + 标签交集筛选 */
export function filterNotes(
  notes: StandaloneNote[],
  query: string,
  tag: string | null,
): StandaloneNote[] {
  const needle = query.trim().toLowerCase()
  return notes.filter((note) => {
    if (tag && !note.tags.includes(tag)) return false
    if (!needle) return true
    return (
      note.title.toLowerCase().includes(needle) ||
      note.slug.toLowerCase().includes(needle) ||
      note.body.toLowerCase().includes(needle) ||
      note.tags.some((item) => item.toLowerCase().includes(needle))
    )
  })
}

export function tagFacets(notes: StandaloneNote[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const note of notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
