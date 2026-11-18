import { memo } from 'react'
import { NotebookPen, Paperclip, Pin } from 'lucide-react'
import type { LibraryItem } from '@/lib/library/item'
import { statusKindOf, statusLabel } from '@/lib/library/item'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Stars } from '@/components/ui/Stars'
import { formatImpactFactor, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ItemRowProps {
  item: LibraryItem
  selected: boolean
  onSelect: (item: LibraryItem) => void
  onOpenNote?: (item: LibraryItem) => void
  onTogglePin?: (item: LibraryItem) => void
}

/**
 * 列表行（文献库与笔记库共用）。
 *
 * 两者的元数据来源本来就不同 —— 文献读 `meta.json`，独立笔记读 frontmatter ——
 * 但在这里已经统一成 `LibraryItem`，所以行内布局只有一份：文献显示作者/年份/进度，
 * 笔记显示标签/更新时间；文献笔记两者都有（它就是那篇文献）。
 */
export const ItemRow = memo(function ItemRow({ item, selected, onSelect, onOpenNote, onTogglePin }: ItemRowProps) {
  const impact = formatImpactFactor(item.impactFactor)
  const isNote = item.type === 'note'
  const authorLine = item.authors.length === 0
    ? isNote
      ? ''
      : '未填写作者'
    : item.authors.length > 2
      ? `${item.authors.slice(0, 2).join(', ')} 等`
      : item.authors.join(', ')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(item)
        }
      }}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group relative w-full cursor-pointer border-l-2 py-2.5 pl-2.5 pr-3 text-left transition-colors',
        selected
          ? 'border-accent bg-surface'
          : 'border-transparent hover:border-line hover:bg-surface-2/50',
      )}
    >
      <div className="absolute right-2 top-2 flex items-center gap-1">
        {onTogglePin ? (
          <button
            type="button"
            title={item.pinned ? '取消置顶' : '置顶'}
            aria-label={item.pinned ? '取消置顶' : '置顶'}
            aria-pressed={item.pinned}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin(item)
            }}
            className={cn(
              'rounded-md border border-line bg-surface/90 p-1 shadow-sm transition-opacity hover:text-warn',
              item.pinned ? 'text-warn opacity-100' : 'text-ink-3 opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
            )}
          >
            <Pin className={cn('size-3', item.pinned ? 'fill-current' : '')} />
          </button>
        ) : null}
        {onOpenNote ? (
          <button
            type="button"
            title={isNote ? '独立打开' : '独立打开笔记'}
            aria-label={isNote ? '独立打开' : '独立打开笔记'}
            onClick={(event) => {
              event.stopPropagation()
              onOpenNote(item)
            }}
            className="rounded-md border border-line bg-surface/90 p-1 text-ink-3 opacity-0 shadow-sm transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
          >
            <NotebookPen className="size-3" />
          </button>
        ) : null}
      </div>

      <h3
        className={cn(
          'line-clamp-2 pr-6 text-[12.5px] font-medium leading-[1.35] tracking-[-0.01em]',
          selected ? 'text-ink' : 'text-ink/90',
        )}
      >
        {item.pinned ? <Pin className="mr-1 inline size-2.5 -translate-y-px fill-warn text-warn" /> : null}
        {item.title}
      </h3>

      {authorLine ? <p className="mt-1 truncate text-[10.5px] text-ink-3">{authorLine}</p> : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10.5px]">
        <Stars value={item.importance} size={9} className="shrink-0" />
        {item.venue ? (
          <span className="max-w-[120px] truncate text-ink-2" title={item.venue}>
            {item.venue}
          </span>
        ) : null}
        {item.year ? <span className="tabular-nums text-ink-3">{item.year}</span> : null}
        {impact ? (
          <span className="rounded bg-warn/12 px-1 py-px text-[9.5px] font-medium text-warn">IF {impact}</span>
        ) : null}
        {item.assetCount > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-ink-3">
            <Paperclip className="size-3" />
            {item.assetCount}
          </span>
        ) : null}
        {isNote ? (
          <span className="text-ink-3" title={`更新于 ${formatRelative(item.updatedAt ?? '')}`}>
            {formatRelative(item.updatedAt ?? item.createdAt ?? '')}
          </span>
        ) : (
          <span className="text-ink-3">{statusLabel(statusKindOf(item), item.status)}</span>
        )}
      </div>

      {isNote && item.tags.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded bg-surface-2 px-1 py-0.5 text-[9.5px] text-ink-2">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {item.progress > 0 ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ProgressBar value={item.progress} thin tone={item.progress >= 100 ? 'muted' : 'accent'} />
          </div>
          <span className="shrink-0 text-[9.5px] tabular-nums text-ink-3">{item.progress}%</span>
        </div>
      ) : null}
    </div>
  )
})
