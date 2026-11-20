import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, FileWarning, Loader2 } from 'lucide-react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import {
  CSS_UNITS,
  disposePdfDocument,
  loadPdfDocument,
  measurePage,
  renderTextLayer,
} from '@/lib/pdf'
import type { PageSize } from '@/lib/pdf'
import { ASSETS_DIR } from '@/lib/vault/repository'
import { join } from '@/lib/path'
import { PDF_NAME } from '@/lib/vault/repository'
import { newAnnotationId, selectionToRects } from '@/lib/vault/annotations'
import type { Annotation, AnnotationRect, AnnotationStyles, PaperRecord } from '@/lib/vault/schema'
import { TauriVaultFS } from '@/lib/fs/tauri'
import { captureFileName, capturePageRegion } from '@/lib/pdf-capture'
import { resolveAssetUrl } from '@/lib/asset-url'
import { useNotesStore } from '@/stores/notes'
import { useLibraryStore } from '@/stores/library'
import { useReaderStore } from '@/stores/reader'
import { useVaultStore } from '@/stores/vault'
import { addAnnotation, removeAnnotation, updateAnnotation } from '@/stores/annotations'
import { AnnotationMarks } from './AnnotationMarks'
import {
  anchoredScrollTop,
  computeLayout,
  pageAtOffset,
  ratioWithinPage,
  zoomFromWheel,
} from '@/lib/pdf-view/layout'
import { SelectionToolbar } from './SelectionToolbar'
import { AnnotationEditor } from './AnnotationEditor'
import { TranslationCard } from './TranslationCard'
import { cn } from '@/lib/utils'

/** How many page boxes we read before the first paint (the rest are estimated). */
const EAGER_MEASURE = 4

interface PdfViewerProps {
  paper: PaperRecord
  className?: string
}

interface SelectionState {
  page: number
  rects: AnnotationRect[]
  text: string
  at: { x: number; y: number }
}

export function PdfViewer({ paper, className }: PdfViewerProps) {
  const dir = paper.dir
  const zoom = useReaderStore((s) => s.zoom)
  const fit = useReaderStore((s) => s.fit)
  const currentPage = useReaderStore((s) => s.currentPage)
  const reloadToken = useReaderStore((s) => s.reloadToken)
  const annotateMode = useReaderStore((s) => s.annotateMode)
  const showAnnotations = useReaderStore((s) => s.showAnnotations)
  const editor = useReaderStore((s) => s.editingAnnotation)
  const captureMode = useReaderStore((s) => s.captureMode)
  const setCaptureMode = useReaderStore((s) => s.setCaptureMode)
  const openAnnotationEditor = useReaderStore((s) => s.openAnnotationEditor)
  const closeAnnotationEditor = useReaderStore((s) => s.closeAnnotationEditor)

  const scrollRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<(PageSize | null)[]>([])
  const [viewportBox, setViewportBox] = useState({ width: 0, height: 0 })
  const [visible, setVisible] = useState({ start: 1, end: 2 })
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [sel, setSel] = useState<SelectionState | null>(null)
  const [captureRect, setCaptureRect] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null)
  const [capturing, setCapturing] = useState(false)
  const [translating, setTranslating] = useState<{ text: string; at: { x: number; y: number } } | null>(null)
  const [color, setColor] = useState<Annotation['color']>('yellow')

  const annotations = paper.meta.annotations ?? []
  const scale = zoom * CSS_UNITS

  /* ── load the document ─────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setSizes([])
    setError(null)
    setLoading(true)
    setProgress(0)
    setSel(null)
    setTranslating(null)

    // Nothing to load: the no-PDF state below explains what to do instead of
    // surfacing a scary "file not found" error.
    if (!paper.hasPdf) {
      setLoading(false)
      return
    }

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const fs = useVaultStore.getState().fs
          if (!fs) throw new Error('文献库尚未打开')
          const rel = join(paper.path, PDF_NAME)

          let source: string | Uint8Array
          if (fs instanceof TauriVaultFS) {
            source = fs.assetUrl(rel)
          } else {
            source = await fs.readBytes(rel)
          }

          const document = await loadPdfDocument(source, {
            onProgress: (loaded, total) => {
              if (total > 0) setProgress(Math.round((loaded / total) * 100))
            },
          })

          if (cancelled) {
            disposePdfDocument(document)
            return
          }

          // Measure only the first few pages so a 500 MB / 800-page PDF paints
          // immediately; the rest are estimated and corrected on first sight.
          const count = document.numPages
          const eager = Math.min(EAGER_MEASURE, count)
          const measured = await Promise.all(
            Array.from({ length: eager }, (_, index) => measurePage(document, index + 1)),
          )
          if (cancelled) {
            disposePdfDocument(document)
            return
          }

          const next: (PageSize | null)[] = new Array(count).fill(null)
          measured.forEach((size, index) => {
            next[index] = size
          })

          docRef.current = document
          setDoc(document)
          setSizes(next)
          setLoading(false)
          useReaderStore.getState().setNumPages(count)
          useReaderStore.getState().setLoading(false)
        } catch (err) {
          if (cancelled) return
          console.error('[reader] load failed', err)
          const message = err instanceof Error ? err.message : String(err)
          setError(message)
          setLoading(false)
          useReaderStore.getState().setError(message)
        }
      })()
    }, 30)

    return () => {
      cancelled = true
      clearTimeout(timer)
      const current = docRef.current
      docRef.current = null
      if (current) disposePdfDocument(current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, reloadToken])

  /* ── track the viewport size ───────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      setViewportBox({ width: box.width, height: box.height })
    })
    observer.observe(el)
    setViewportBox({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  /* ── page boxes: measured for the first pages, estimated for the rest ─ */
  const estimate = useMemo<PageSize | null>(() => {
    const known = sizes.filter((size): size is PageSize => Boolean(size))
    if (!known.length) return null
    const middle = known[Math.floor(known.length / 2)] ?? known[0]
    const widths = known.map((s) => s.width).sort((a, b) => a - b)
    const heights = known.map((s) => s.height).sort((a, b) => a - b)
    return {
      // median keeps one landscape page from skewing the whole document
      width: widths[Math.floor(widths.length / 2)] ?? middle!.width,
      height: heights[Math.floor(heights.length / 2)] ?? middle!.height,
    }
  }, [sizes])

  const sizeAt = useCallback(
    (index: number): PageSize | null => sizes[index] ?? estimate,
    [sizes, estimate],
  )

  const onPageMeasured = useCallback((pageNumber: number, size: PageSize) => {
    setSizes((prev) => {
      const index = pageNumber - 1
      const current = prev[index]
      if (current && Math.abs(current.width - size.width) < 1 && Math.abs(current.height - size.height) < 1) {
        return prev
      }
      const next = [...prev]
      next[index] = size
      return next
    })
  }, [])

  /* ── fit modes ─────────────────────────────────────────────────────── */
  const base = sizes[0] ?? estimate
  useEffect(() => {
    if (!base || !viewportBox.width || !viewportBox.height) return
    if (fit === 'custom') return
    const widthScale = (viewportBox.width - 56) / base.width
    const heightScale = (viewportBox.height - 56) / base.height
    const target =
      fit === 'fit-page' ? Math.min(widthScale, heightScale) : Math.max(0.1, widthScale)
    useReaderStore.getState().applyFitZoom(target / CSS_UNITS)
  }, [base, fit, viewportBox.width, viewportBox.height])

  /* ── layout ────────────────────────────────────────────────────────── */
  const layout = useMemo(
    () => computeLayout(sizes, estimate, scale),
    [sizes, estimate, scale],
  )

  const pageAtScroll = useCallback(
    (scrollTop: number, clientHeight: number) => {
      if (!layout.offsets.length) return 1
      return pageAtOffset(layout.offsets, scrollTop + clientHeight * 0.34)
    },
    [layout.offsets],
  )

  /* ── Ctrl/⌘ + 滚轮：以指针为锚点缩放 ───────────────────────────────── */
  // 只记「缩放后应该滚到哪」，真正的赋值留给布局更新之后 —— 那时 scrollHeight
  // 才是新值，提前写会被浏览器夹回去。
  const pendingScrollRef = useRef<number | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      // 必须拦掉浏览器自己的整页缩放
      event.preventDefault()
      const state = useReaderStore.getState()
      const nextZoom = zoomFromWheel(state.zoom, event.deltaY)
      if (Math.abs(nextZoom - state.zoom) < 0.0005) return

      const box = el.getBoundingClientRect()
      const anchorY = Math.min(Math.max(0, event.clientY - box.top), el.clientHeight)
      const page = pageAtOffset(layout.offsets, el.scrollTop + anchorY)
      const index = Math.max(0, page - 1)
      const ratio = ratioWithinPage(
        el.scrollTop,
        anchorY,
        layout.offsets[index] ?? 0,
        layout.heights[index] ?? 0,
      )
      const after = computeLayout(sizes, estimate, nextZoom * CSS_UNITS)
      pendingScrollRef.current = anchoredScrollTop({
        page,
        ratio,
        before: layout,
        after,
        anchorY,
      })
      state.setZoom(nextZoom)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [layout, sizes, estimate])

  /* 布局换到新 scale 之后再把锚点放回去：页码与页面内相对位置都不变。 */
  const syncVisibleRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const target = pendingScrollRef.current
    const el = scrollRef.current
    if (target === null || !el) return
    pendingScrollRef.current = null
    el.scrollTop = target
    syncVisibleRef.current?.()
  }, [scale])

  /* ── recompute which pages to mount ────────────────────────────────── */
  const syncVisible = useCallback(() => {
    const el = scrollRef.current
    if (!el || !layout.offsets.length) return
    const top = el.scrollTop
    const bottom = top + el.clientHeight
    let start = 1
    let end = layout.offsets.length
    for (let i = 0; i < layout.offsets.length; i += 1) {
      const pageTop = layout.offsets[i] ?? 0
      const pageBottom = pageTop + (layout.heights[i] ?? 0)
      if (pageBottom >= top) {
        start = i + 1
        break
      }
    }
    for (let i = start - 1; i < layout.offsets.length; i += 1) {
      const pageTop = layout.offsets[i] ?? 0
      if (pageTop > bottom) {
        end = i
        break
      }
    }
    // one page of slack on each side keeps fast scrolling from flashing blank
    start = Math.max(1, start - 1)
    end = Math.min(layout.offsets.length, end + 1)
    setVisible((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [layout.offsets, layout.heights])

  useEffect(() => {
    syncVisibleRef.current = syncVisible
    syncVisible()
  }, [syncVisible, doc])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    syncVisible()
    const page = pageAtScroll(el.scrollTop, el.clientHeight)
    const store = useReaderStore.getState()
    if (page !== store.currentPage) store.setPage(page)
  }, [pageAtScroll, syncVisible])

  /* ── scroll to the page the store asks for (page nav, restore last read) */
  const jumpTo = useCallback(
    (page: number) => {
      const el = scrollRef.current
      if (!el || !layout.offsets.length) return
      const target = layout.offsets[Math.min(Math.max(1, page), layout.offsets.length) - 1] ?? 0
      el.scrollTo({ top: Math.max(0, target - 8) })
    },
    [layout.offsets],
  )

  useEffect(() => {
    if (!doc || !layout.offsets.length) return
    const el = scrollRef.current
    if (!el) return
    const at = pageAtScroll(el.scrollTop, el.clientHeight)
    if (at !== currentPage) jumpTo(currentPage)
    // only when the store's page changes from outside the scroll handler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, doc, layout.offsets.length])

  /* ── selection → floating toolbar ──────────────────────────────────── */
  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (annotateMode === 'rect') return
      const target = event.target as HTMLElement
      if (target.closest('button')) return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return
      }
      const range = selection.getRangeAt(0)
      const node = range.startContainer
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
      const pageEl = element?.closest('[data-pdf-page]') as HTMLElement | null
      if (!pageEl) return

      const box = pageEl.getBoundingClientRect()
      const rects = selectionToRects(Array.from(range.getClientRects()), {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      })
      const text = selection.toString().replace(/\s+/g, ' ').trim()
      if (!rects.length || !text) return

      const bounds = range.getBoundingClientRect()
      setSel({
        page: Number(pageEl.dataset.pdfPage),
        rects,
        text,
        at: { x: bounds.left + bounds.width / 2, y: bounds.top },
      })
      closeAnnotationEditor()
      setTranslating(null)
    },
    [annotateMode, closeAnnotationEditor],
  )

  const commitSelection = useCallback(
    (kind: Annotation['kind'], withEditor = false) => {
      if (!sel) return
      const annotation: Annotation = {
        id: newAnnotationId(),
        kind,
        page: sel.page,
        color,
        rects: sel.rects,
        text: sel.text,
        note: '',
        createdAt: new Date().toISOString(),
      }
      addAnnotation(dir, annotation)
      window.getSelection()?.removeAllRanges()
      if (withEditor) openAnnotationEditor(annotation.id, sel.at)
      setSel(null)
    },
    [sel, color, dir, openAnnotationEditor],
  )

  const createRect = useCallback(
    (rect: AnnotationRect) => {
      const annotation: Annotation = {
        id: newAnnotationId(),
        kind: 'rect',
        page: useReaderStore.getState().currentPage,
        color,
        rects: [rect],
        text: '',
        note: '',
        createdAt: new Date().toISOString(),
      }
      addAnnotation(dir, annotation)
      useReaderStore.getState().setAnnotateMode('none')
      openAnnotationEditor(annotation.id)
    },
    [color, dir, openAnnotationEditor],
  )

  const openAnnotation = useCallback(
    (annotation: Annotation, at: { x: number; y: number }) => {
      setSel(null)
      setTranslating(null)
      openAnnotationEditor(annotation.id, at)
    },
    [openAnnotationEditor],
  )

  const editorAnnotation = editor ? annotations.find((a) => a.id === editor.id) : null

  /* ── 框选截图 ──────────────────────────────────────────────────────── */
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null)

  const finishCapture = useCallback(async () => {
    const rect = captureRect
    const doc = docRef.current
    const scroll = scrollRef.current
    if (!rect || !doc || !scroll) return

    const left = Math.min(rect.x0, rect.x1)
    const right = Math.max(rect.x0, rect.x1)
    const top = Math.min(rect.y0, rect.y1)
    const bottom = Math.max(rect.y0, rect.y1)
    if (right - left < 8 || bottom - top < 8) {
      setCaptureRect(null)
      return
    }

    // 找出框选范围内覆盖最多的那一页（跨页时取交集大的）
    const scrollBox = scroll.getBoundingClientRect()
    const selection = {
      left: scrollBox.left + left,
      top: scrollBox.top + top,
      right: scrollBox.left + right,
      bottom: scrollBox.top + bottom,
    }

    let best: { page: number; element: HTMLElement; area: number } | null = null
    for (const element of Array.from(scroll.querySelectorAll<HTMLElement>('[data-pdf-page]'))) {
      const box = element.getBoundingClientRect()
      const overlapW = Math.min(box.right, selection.right) - Math.max(box.left, selection.left)
      const overlapH = Math.min(box.bottom, selection.bottom) - Math.max(box.top, selection.top)
      if (overlapW <= 0 || overlapH <= 0) continue
      const area = overlapW * overlapH
      if (!best || area > best.area) {
        best = { page: Number(element.dataset.pdfPage), element, area }
      }
    }
    if (!best) {
      setCaptureRect(null)
      return
    }

    const pageBox = best.element.getBoundingClientRect()
    const region = {
      x: Math.max(0, selection.left - pageBox.left),
      y: Math.max(0, selection.top - pageBox.top),
      w: Math.min(pageBox.width, selection.right - pageBox.left) - Math.max(0, selection.left - pageBox.left),
      h: Math.min(pageBox.height, selection.bottom - pageBox.top) - Math.max(0, selection.top - pageBox.top),
    }

    const repo = useVaultStore.getState().repo
    const notify = useVaultStore.getState().setNotice
    setCaptureRect(null)
    setCapturing(true)
    try {
      const page = await doc.getPage(best.page)
      const image = await capturePageRegion(page, region, pageBox.width)
      const filename = captureFileName(best.page)
      if (!repo) throw new Error('文献库尚未就绪')
      const stored = await repo.writeAsset(paper.dir, filename, image.bytes)
      const url = await resolveAssetUrl(stored)
      // 注意：笔记里写的是「相对文献文件夹」的路径，而不是文献库里的完整路径，
      // 这样整个 papers/xxx 文件夹搬走、改名、被 git 同步到别处都不会断链。
      const rel = `${ASSETS_DIR}/${filename}`
      useNotesStore.getState().requestImage({
        dir: paper.dir,
        markdown: `![image](${rel})`,
        path: rel,
        url,
      })
      notify(`已截图 ${filename} · ${image.width}×${image.height}，已插入笔记`)
      await useLibraryStore.getState().load()
    } catch (err) {
      console.error('[capture] failed', err)
      notify(`截图失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCapturing(false)
      setCaptureMode(false)
    }
  }, [captureRect, paper.dir, setCaptureMode])

  const captureBox = captureRect
    ? {
        left: Math.min(captureRect.x0, captureRect.x1),
        top: Math.min(captureRect.y0, captureRect.y1),
        width: Math.abs(captureRect.x1 - captureRect.x0),
        height: Math.abs(captureRect.y1 - captureRect.y0),
      }
    : null

  /* 进入截图模式时清掉可能残留的选择，Esc 退出 */
  useEffect(() => {
    if (!captureMode) {
      setCaptureRect(null)
      pointerOrigin.current = null
      return
    }
    document.body.style.cursor = 'crosshair'
    setSel(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setCaptureRect(null)
      setCaptureMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [captureMode, setCaptureMode])

  /* ── keyboard shortcuts for the selection toolbar ──────────────────── */
  useEffect(() => {
    if (!sel) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'h' || key === 'u' || key === 's' || key === 'n') {
        event.preventDefault()
        if (key === 'h') commitSelection('highlight')
        if (key === 'u') commitSelection('underline')
        if (key === 's') commitSelection('strikethrough')
        if (key === 'n') commitSelection('highlight', true)
        return
      }
      if (key === 't') {
        event.preventDefault()
        setTranslating({ text: sel.text, at: sel.at })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, commitSelection])

  /* ── render ────────────────────────────────────────────────────────── */
  const mounted: number[] = []
  for (let page = visible.start; page <= visible.end; page += 1) mounted.push(page)

  if (error) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-surface-2', className)}>
        <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
          <FileWarning className="size-6 text-danger" />
          <p className="text-[13px] font-medium text-ink">无法打开 PDF</p>
          <p className="text-[11.5px] leading-relaxed text-ink-3">{error}</p>
        </div>
      </div>
    )
  }

  if (!paper.hasPdf) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-surface-2', className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <FileWarning className="size-6 text-ink-3" />
          <p className="text-[13px] font-medium text-ink">这篇文献还没有 PDF</p>
          <p className="text-[11.5px] text-ink-3">把 PDF 拖到窗口里，或使用「重新绑定 PDF」</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative h-full', className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseUp={handleMouseUp}
        className="sb-scroll sb-paper-bg h-full overflow-auto"
        data-pdf-scroll
      >
        <div style={{ height: layout.total, position: 'relative' }}>
          {doc &&
            mounted.map((pageNumber) => {
              const size = sizeAt(pageNumber - 1)
              if (!size) return null
              return (
                <PdfPageView
                  key={pageNumber}
                  doc={doc}
                  pageNumber={pageNumber}
                  scale={scale}
                  top={layout.offsets[pageNumber - 1] ?? 0}
                  width={size.width * scale}
                  height={(layout.heights[pageNumber - 1] ?? size.height * scale)}
                  annotations={
                    showAnnotations
                      ? annotations.filter((annotation) => annotation.page === pageNumber)
                      : []
                  }
                  styles={paper.meta.styles}
                  rectMode={annotateMode === 'rect'}
                  activeId={editor?.id ?? null}
                  onMeasured={onPageMeasured}
                  onOpen={openAnnotation}
                  onCreateRect={createRect}
                />
              )
            })}
        </div>
      </div>

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/60 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[12px] text-ink-2 shadow-sm">
            <Loader2 className="size-3.5 animate-spin text-accent" />
            正在解析 PDF{progress > 0 && progress < 100 ? ` · ${progress}%` : '…'}
          </div>
        </div>
      )}

      {captureMode && (
        <div
          className="absolute inset-0 z-30 touch-none select-none"
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            pointerOrigin.current = { x: event.clientX - box.left, y: event.clientY - box.top }
            event.currentTarget.setPointerCapture(event.pointerId)
            setCaptureRect({
              x0: pointerOrigin.current.x,
              y0: pointerOrigin.current.y,
              x1: pointerOrigin.current.x,
              y1: pointerOrigin.current.y,
            })
          }}
          onPointerMove={(event) => {
            const origin = pointerOrigin.current
            if (!origin) return
            const box = event.currentTarget.getBoundingClientRect()
            setCaptureRect({
              x0: origin.x,
              y0: origin.y,
              x1: event.clientX - box.left,
              y1: event.clientY - box.top,
            })
          }}
          onPointerUp={(event) => {
            pointerOrigin.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
            void finishCapture()
          }}
          onPointerCancel={() => {
            pointerOrigin.current = null
            setCaptureRect(null)
          }}
        >
          <div className="absolute inset-0 bg-ink/20" />
          {captureBox && (
            <div
              className="absolute border-2 border-accent bg-white/20 shadow-[0_0_0_9999px_rgba(34,31,26,0.12)]"
              style={{
                left: captureBox.left,
                top: captureBox.top,
                width: captureBox.width,
                height: captureBox.height,
              }}
            >
              <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 py-0.5 text-[10px] tabular-nums text-white">
                {Math.round(captureBox.width)} × {Math.round(captureBox.height)}
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[11.5px] text-ink-2 shadow-sm">
            <Camera className="size-3.5 text-accent" />
            拖动框选要截图的区域 · Esc 退出
          </div>
        </div>
      )}

      {capturing && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg/50 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[12px] text-ink-2 shadow-sm">
            <Loader2 className="size-3.5 animate-spin text-accent" />
            正在导出截图…
          </div>
        </div>
      )}

      {sel && (
        <SelectionToolbar
          at={sel.at}
          color={color}
          onColor={setColor}
          onMark={(kind) => commitSelection(kind)}
          onNote={() => commitSelection('highlight', true)}
          onTranslate={() => {
            setTranslating({ text: sel.text, at: sel.at })
            setSel(null)
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(sel.text)
            setSel(null)
          }}
          onClose={() => setSel(null)}
        />
      )}

      {translating && (
        <TranslationCard
          at={translating.at}
          text={translating.text}
          onClose={() => setTranslating(null)}
        />
      )}

      {editor && editorAnnotation && (
        <AnnotationEditor
          at={editor.at}
          annotation={editorAnnotation}
          styles={paper.meta.styles}
          onChange={(patch) => updateAnnotation(dir, editor.id, patch)}
          onDelete={() => removeAnnotation(dir, editor.id)}
          onClose={closeAnnotationEditor}
        />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────── */

interface PdfPageViewProps {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  top: number
  width: number
  height: number
  annotations: Annotation[]
  styles: AnnotationStyles
  rectMode: boolean
  activeId: string | null
  onMeasured: (pageNumber: number, size: PageSize) => void
  onOpen: (annotation: Annotation, at: { x: number; y: number }) => void
  onCreateRect: (rect: AnnotationRect) => void
}

function PdfPageView({
  doc,
  pageNumber,
  scale,
  top,
  width,
  height,
  annotations,
  styles,
  rectMode,
  activeId,
  onMeasured,
  onOpen,
  onCreateRect,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    let page: PDFPageProxy | null = null
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    setRendered(false)
    setRenderFailed(false)

    void (async () => {
      try {
        page = await doc.getPage(pageNumber)
        if (cancelled) return
        const canvas = canvasRef.current
        const textContainer = textRef.current
        if (!canvas || !textContainer) return

        const viewport = page.getViewport({ scale })
        // 画布上限保护：海报 / 大版面页在高缩放 + 高分屏下会超出 Chromium 的
        // 画布尺寸上限（16384px / 总面积 ~2^24），超出时渲染直接报错、整页空白。
        // 策略是把 dpr 压到刚好不超限，宁可糊一点也不给用户一张白纸。
        const MAX_DIM = 16384
        const MAX_AREA = 2 ** 24
        let dpr = Math.min(window.devicePixelRatio || 1, 2)
        const px = viewport.width * viewport.height
        const dimLimit = Math.min(MAX_DIM / Math.max(viewport.width, 1), MAX_AREA / Math.max(px, 1))
        dpr = Math.max(1, Math.min(dpr, dimLimit))

        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        const context = canvas.getContext('2d', { alpha: false })
        if (!context) return
        context.save()
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.restore()

        // report the exact box so the layout stops estimating this page
        onMeasured(pageNumber, {
          width: viewport.width / scale,
          height: viewport.height / scale,
        })

        const renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        })
        task = renderTask as unknown as { cancel: () => void; promise: Promise<void> }
        await (renderTask as unknown as { promise: Promise<void> }).promise

        if (cancelled) return
        setRendered(true)

        // selectable text on top — needed by 划词翻译 and by copy/paste
        await renderTextLayer(page, textContainer, viewport)
      } catch (err) {
        const name = (err as { name?: string })?.name
        if (name !== 'RenderingCancelledException' && !cancelled) {
          console.warn('[pdf] page render failed', pageNumber, err)
          setRenderFailed(true)
        }
      }
    })()

    return () => {
      cancelled = true
      try {
        task?.cancel()
      } catch {
        /* already finished */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, retryToken])

  return (
    <div
      data-pdf-page={pageNumber}
      className="absolute left-1/2 -translate-x-1/2"
      style={{ top, width, height }}
    >
      <div className="relative overflow-hidden rounded-[2px] bg-white shadow-[0_1px_2px_rgba(34,31,26,0.10),0_8px_24px_-12px_rgba(34,31,26,0.28)] ring-1 ring-black/[0.04]">
        <canvas ref={canvasRef} className="block" />
        <AnnotationMarks
          pageNumber={pageNumber}
          width={width}
          height={height}
          annotations={annotations}
          styles={styles}
          rectMode={rectMode}
          activeId={activeId}
          onOpen={onOpen}
          onCreateRect={onCreateRect}
        />
        <div ref={textRef} className="textLayer" />
        {!rendered && !renderFailed && <div className="absolute inset-0 animate-pulse bg-white/70" />}
        {renderFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-2">
            <FileWarning className="size-5 text-ink-3" />
            <p className="text-[12px] text-ink-2">第 {pageNumber} 页渲染失败</p>
            <button
              type="button"
              onClick={() => setRetryToken((n) => n + 1)}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-2 transition hover:border-accent/60 hover:text-accent"
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
