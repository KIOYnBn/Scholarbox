import type { ReactNode } from 'react'
import { ChevronsDownUp, ChevronsUpDown, ZoomIn, ZoomOut } from 'lucide-react'
import { DIMENSION_LABELS, type ShelfDimension } from '@/lib/shelf'
import { cn } from '@/lib/utils'

export interface ShelfToolbarProps {
  dimensions: ShelfDimension[]
  dimension: ShelfDimension
  onDimension: (dimension: ShelfDimension) => void
  /** 如「6 层 · 8 篇」；标签分架时会大于条目总数，这是预期的 */
  summary: string
  hasFilter: boolean
  onResetFilter: () => void
  collapsible: boolean
  allCollapsed: boolean
  onToggleAll: () => void
  /** 书架缩放（书脊大小）；传了才显示缩放控件 */
  zoom?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomReset?: () => void
}

/** 书架模式下那条「分架 / 层数 / 清除筛选 / 全部收起」的工具条，两个书库共用 */
export function ShelfToolbar({
  dimensions,
  dimension,
  onDimension,
  summary,
  hasFilter,
  onResetFilter,
  collapsible,
  allCollapsed,
  onToggleAll,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ShelfToolbarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface/50 px-4">
      <span className="text-[10.5px] text-ink-3">分架</span>
      <div className="flex items-center gap-0.5 rounded-lg bg-surface-3/60 p-0.5">
        {dimensions.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onDimension(value)}
            aria-pressed={dimension === value}
            className={cn(
              'rounded-[5px] px-2 py-[3px] text-[10.5px] transition-colors',
              dimension === value
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {DIMENSION_LABELS[value]}
          </button>
        ))}
      </div>
      <span className="text-[10.5px] tabular-nums text-ink-3">{summary}</span>

      <div className="ml-auto flex items-center gap-2">
        {typeof zoom === 'number' && onZoomIn && onZoomOut ? (
          <div className="flex items-center gap-0.5 rounded-lg bg-surface-3/60 p-0.5">
            <button
              type="button"
              onClick={onZoomOut}
              disabled={zoom <= 0.7}
              title="缩小书脊"
              aria-label="缩小书脊"
              className="inline-flex size-5 items-center justify-center rounded-[5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-30"
            >
              <ZoomOut className="size-3" />
            </button>
            <button
              type="button"
              onClick={onZoomReset}
              title="点击恢复默认大小"
              className="min-w-[3em] rounded-[5px] px-1 text-center text-[10.5px] tabular-nums text-ink-2 transition-colors hover:text-ink"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={onZoomIn}
              disabled={zoom >= 1.6}
              title="放大书脊"
              aria-label="放大书脊"
              className="inline-flex size-5 items-center justify-center rounded-[5px] text-ink-2 transition-colors hover:bg-surface hover:text-ink disabled:opacity-30"
            >
              <ZoomIn className="size-3" />
            </button>
          </div>
        ) : null}
        {hasFilter ? (
          <button
            type="button"
            onClick={onResetFilter}
            className="text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            清除筛选
          </button>
        ) : null}
        {collapsible ? (
          <button
            type="button"
            onClick={onToggleAll}
            className="inline-flex items-center gap-1 text-[10.5px] text-ink-3 hover:text-ink"
          >
            {allCollapsed ? <ChevronsUpDown className="size-3" /> : <ChevronsDownUp className="size-3" />}
            {allCollapsed ? '全部展开' : '全部收起'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export interface ShelfBoardProps {
  children: ReactNode
  highlight?: ReactNode
  empty: ReactNode
  showEmpty: boolean
}

/** 书架区域的滚动容器 + 居中列宽 + 空状态，两个书库共用 */
export function ShelfBoard({ children, highlight, empty, showEmpty }: ShelfBoardProps) {
  return (
    <main className="sb-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {showEmpty ? (
        empty
      ) : (
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {highlight}
          {children}
        </div>
      )}
    </main>
  )
}
