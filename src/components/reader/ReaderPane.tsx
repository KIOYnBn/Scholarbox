import { useMemo } from 'react'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileQuestion,
  Maximize2,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCw,
  ScanLine,
  SearchX,
  SquareDashed,
} from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { PdfViewer } from './PdfViewer'
import { AnnotationStyleMenu } from './AnnotationStyleMenu'
import { useLibraryStore } from '@/stores/library'
import { useReaderStore } from '@/stores/reader'
import { useUiStore } from '@/stores/ui'
import { cn } from '@/lib/utils'

export function ReaderPane() {
  const papers = useLibraryStore((s) => s.papers)
  const selectedDir = useLibraryStore((s) => s.selectedDir)

  const numPages = useReaderStore((s) => s.numPages)
  const currentPage = useReaderStore((s) => s.currentPage)
  const setPage = useReaderStore((s) => s.setPage)
  const zoom = useReaderStore((s) => s.zoom)
  const fit = useReaderStore((s) => s.fit)
  const setFit = useReaderStore((s) => s.setFit)
  const zoomIn = useReaderStore((s) => s.zoomIn)
  const zoomOut = useReaderStore((s) => s.zoomOut)
  const reload = useReaderStore((s) => s.reload)
  const loading = useReaderStore((s) => s.loading)
  const annotateMode = useReaderStore((s) => s.annotateMode)
  const setAnnotateMode = useReaderStore((s) => s.setAnnotateMode)
  const showAnnotations = useReaderStore((s) => s.showAnnotations)
  const toggleAnnotations = useReaderStore((s) => s.toggleAnnotations)
  const captureMode = useReaderStore((s) => s.captureMode)
  const setCaptureMode = useReaderStore((s) => s.setCaptureMode)

  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleNotes = useUiStore((s) => s.toggleNotes)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const notesOpen = useUiStore((s) => s.notesOpen)

  const paper = useMemo(
    () => papers.find((item) => item.dir === selectedDir) ?? null,
    [papers, selectedDir],
  )

  if (!paper) {
    return (
      <section className="relative flex min-w-0 flex-1 items-center justify-center bg-canvas">
        <div className="flex max-w-[300px] flex-col items-center gap-3 px-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface shadow-sm">
            <SearchX className="size-5 text-ink-3" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink">还没有打开文献</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
              从左侧列表选择一篇论文，或把 PDF 文件直接拖到窗口里。
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-surface/80 px-2 backdrop-blur">
        {/* 两侧栏的开关：以前只在窄屏出现，桌面上想收起目录/笔记只能靠快捷键 */}
        <IconButton
          label={sidebarOpen ? '收起目录栏 · Ctrl+B' : '展开目录栏 · Ctrl+B'}
          active={sidebarOpen}
          onClick={() => toggleSidebar()}
        >
          <PanelLeft className="size-4" />
        </IconButton>

        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-[13px] leading-tight text-ink">{paper.meta.title}</div>
          <div className="truncate text-[10.5px] leading-tight text-ink-3">
            {[paper.meta.venue, paper.meta.year].filter(Boolean).join(' · ') || paper.dir}
          </div>
        </div>

        {paper.hasPdf ? (
          <>
            <div className="mx-1 flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-surface px-0.5">
              <IconButton label="上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft className="size-3.5" />
              </IconButton>
              <input
                value={currentPage}
                inputMode="numeric"
                aria-label="当前页"
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10)
                  if (Number.isFinite(next)) setPage(next)
                }}
                className="h-6 w-8 rounded border-0 bg-transparent text-center text-[11.5px] tabular-nums text-ink focus:bg-surface-2"
              />
              <span className="pr-1 text-[11px] tabular-nums text-ink-3">/ {numPages || '—'}</span>
              <IconButton
                label="下一页"
                disabled={numPages > 0 && currentPage >= numPages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight className="size-3.5" />
              </IconButton>
            </div>

            <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
              <IconButton label="缩小" onClick={zoomOut}>
                <Minus className="size-3.5" />
              </IconButton>
              <button
                type="button"
                onClick={() => setFit(fit === 'fit-width' ? 'fit-page' : 'fit-width')}
                className="h-6 w-[46px] shrink-0 whitespace-nowrap rounded px-1 text-[11px] tabular-nums text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                title={`缩放 ${Math.round(zoom * 100)}% · 点击切换宽度/整页`}
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton label="放大" onClick={zoomIn}>
                <Plus className="size-3.5" />
              </IconButton>
              <IconButton
                label="适应宽度"
                active={fit === 'fit-width'}
                onClick={() => setFit(fit === 'fit-width' ? 'custom' : 'fit-width')}
              >
                <Maximize2 className="size-3.5" />
              </IconButton>
              <IconButton
                label="适应整页"
                active={fit === 'fit-page'}
                onClick={() => setFit(fit === 'fit-page' ? 'custom' : 'fit-page')}
              >
                <ScanLine className="size-3.5" />
              </IconButton>
              <IconButton label="重新载入" onClick={reload}>
                <RotateCw className={cn('size-3.5', loading && 'animate-spin')} />
              </IconButton>
            </div>

            <div className="ml-1 flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-surface px-0.5">
              {/* 框选截图：截完直接存进本文献的 assets/ 并插到笔记光标处。
                  以前只有 Shift+X 一个入口，界面上连个按钮都没有，等于不存在。 */}
              <IconButton
                label="截图插入笔记 · Shift+X"
                active={captureMode}
                onClick={() => setCaptureMode(!captureMode)}
              >
                <Camera className="size-3.5" />
              </IconButton>
              <IconButton
                label={annotateMode === 'rect' ? '退出框选' : '框选标注（框住图表写说明）'}
                active={annotateMode === 'rect'}
                onClick={() => setAnnotateMode(annotateMode === 'rect' ? 'none' : 'rect')}
              >
                <SquareDashed className="size-3.5" />
              </IconButton>
              <IconButton
                label={showAnnotations ? '隐藏标注' : '显示标注'}
                active={!showAnnotations}
                onClick={toggleAnnotations}
              >
                {showAnnotations ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </IconButton>
              <AnnotationStyleMenu paper={paper} />
            </div>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3">
            <FileQuestion className="size-3" />
            缺少 PDF
          </span>
        )}

        <IconButton
          label={notesOpen ? '收起笔记栏 · Ctrl+Alt+B' : '展开笔记栏 · Ctrl+Alt+B'}
          active={notesOpen}
          onClick={() => toggleNotes()}
        >
          <PanelRight className="size-4" />
        </IconButton>
      </header>

      <div className="relative min-h-0 flex-1">
        <PdfViewer paper={paper} />
      </div>
    </section>
  )
}
