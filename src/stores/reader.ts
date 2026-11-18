import { create } from 'zustand'
import { useLibraryStore } from './library'
import { useSettingsStore } from './settings'
import { MAX_ZOOM, MIN_ZOOM } from '@/lib/pdf-view/layout'

export type FitMode = 'fit-width' | 'fit-page' | 'custom'

/** 'rect' = 框选模式：鼠标在页面上拖出一个矩形标注 */
export type AnnotateMode = 'none' | 'rect'

interface ReaderState {
  dir: string | null
  numPages: number
  currentPage: number
  zoom: number
  fit: FitMode
  loading: boolean
  error: string | null
  /** bump to force the viewer to reload the document from disk */
  reloadToken: number
  annotateMode: AnnotateMode
  /** hide all highlights (e.g. to read the figures underneath) */
  showAnnotations: boolean
  /** annotation whose editor popover is open, plus where to pin it */
  editingAnnotation: { id: string; at: { x: number; y: number } } | null
  /** 框选截图模式：在 PDF 上拖出一个矩形存成 assets/ 里的 PNG */
  captureMode: boolean

  open: (dir: string) => void
  close: () => void
  setNumPages: (n: number) => void
  setPage: (page: number) => void
  setZoom: (zoom: number) => void
  /** used by the viewer when a fit mode recomputes the scale — keeps `fit` untouched */
  applyFitZoom: (zoom: number) => void
  setFit: (fit: FitMode) => void
  zoomIn: () => void
  zoomOut: () => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reload: () => void
  setAnnotateMode: (mode: AnnotateMode) => void
  toggleAnnotations: () => void
  openAnnotationEditor: (id: string, at?: { x: number; y: number }) => void
  closeAnnotationEditor: () => void
  setCaptureMode: (value: boolean) => void
  recordProgress: (page: number, numPages: number) => void
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4]

/** 缩放范围：50%–400%，与 Ctrl+滚轮共用同一对边界 */
export { MAX_ZOOM, MIN_ZOOM } from '@/lib/pdf-view/layout'

export const useReaderStore = create<ReaderState>()((set, get) => ({
  dir: null,
  numPages: 0,
  currentPage: 1,
  zoom: 1,
  fit: 'fit-width',
  loading: false,
  error: null,
  reloadToken: 0,
  annotateMode: 'none',
  showAnnotations: true,
  editingAnnotation: null,
  captureMode: false,

  open(dir) {
    const paper = useLibraryStore.getState().papers.find((p) => p.dir === dir)
    set({
      dir,
      numPages: 0,
      currentPage: Math.max(1, (paper?.meta.lastPage ?? 0) + 1 || 1),
      loading: true,
      error: null,
      annotateMode: 'none',
      editingAnnotation: null,
      captureMode: false,
    })
    useSettingsStore.getState().set({ lastPaperDir: dir })
    // 「最近查看」由此开始记；60 秒去重在 markViewed 里
    void useLibraryStore.getState().markViewed(dir)
  },

  close() {
    set({ dir: null, numPages: 0, currentPage: 1, error: null, loading: false })
  },

  setNumPages(numPages) {
    const { currentPage } = get()
    set({ numPages, currentPage: Math.min(currentPage, Math.max(1, numPages)) })
  },

  setPage(page) {
    const { numPages } = get()
    const next = Math.min(Math.max(1, Math.round(page)), Math.max(1, numPages))
    if (next === get().currentPage) return
    set({ currentPage: next })
    get().recordProgress(next, numPages || 1)
  },

  setZoom(zoom) {
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), fit: 'custom' })
  },

  applyFitZoom(zoom) {
    if (Math.abs(get().zoom - zoom) < 0.0005) return
    set({ zoom })
  },

  setFit(fit) {
    set({ fit })
  },

  zoomIn() {
    const { zoom } = get()
    const next = ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? Math.min(MAX_ZOOM, zoom + 0.25)
    get().setZoom(next)
  },

  zoomOut() {
    const { zoom } = get()
    const next =
      [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? Math.max(MIN_ZOOM, zoom - 0.25)
    get().setZoom(next)
  },

  setLoading(loading) {
    set({ loading })
  },

  setError(error) {
    set({ error, loading: false })
  },

  reload() {
    set((state) => ({ reloadToken: state.reloadToken + 1, loading: true, error: null }))
  },

  setAnnotateMode(mode) {
    set({ annotateMode: mode })
  },

  toggleAnnotations() {
    set((state) => ({ showAnnotations: !state.showAnnotations }))
  },

  openAnnotationEditor(id, at) {
    set({
      editingAnnotation: {
        id,
        at: at ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 },
      },
    })
  },

  closeAnnotationEditor() {
    set({ editingAnnotation: null })
  },

  setCaptureMode(value) {
    set({ captureMode: value })
  },

  recordProgress(page, numPages) {
    const { dir } = get()
    if (!dir) return
    const progress = Math.min(100, Math.max(0, Math.round((page / Math.max(1, numPages)) * 100)))
    useLibraryStore.getState().patchLocal(dir, {
      lastPage: page - 1,
      progress,
      lastOpenedAt: new Date().toISOString(),
      status: progress >= 98 ? 'done' : progress > 0 ? 'reading' : 'todo',
    })
    scheduleMetaFlush(dir)
  },
}))

/**
 * Progress is written to meta.json at most once every 2.5s — scrolling a 500 page
 * PDF must not turn into 500 disk writes (and 500 git commits).
 */
const pendingFlush = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleMetaFlush(dir: string) {
  const existing = pendingFlush.get(dir)
  if (existing) clearTimeout(existing)
  pendingFlush.set(
    dir,
    setTimeout(() => {
      pendingFlush.delete(dir)
      const record = useLibraryStore.getState().papers.find((p) => p.dir === dir)
      if (!record) return
      void useLibraryStore.getState().updateMeta(dir, {
        lastPage: record.meta.lastPage,
        progress: record.meta.progress,
        lastOpenedAt: record.meta.lastOpenedAt,
        status: record.meta.status,
      })
    }, 2500),
  )
}

export function flushProgress(dir: string) {
  const timer = pendingFlush.get(dir)
  if (timer) {
    clearTimeout(timer)
    pendingFlush.delete(dir)
  }
}
