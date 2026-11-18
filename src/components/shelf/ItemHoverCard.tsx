import { BookOpen, NotebookPen, Pin } from 'lucide-react'
import type { LibraryItem } from '@/lib/library/item'
import { statusKindOf, statusLabel } from '@/lib/library/item'
import { formatImpactFactor, formatRelative } from '@/lib/format'
import { spineSubtitle } from '@/lib/shelf'
import { FloatingPopover } from '@/components/reader/FloatingPopover'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Stars } from '@/components/ui/Stars'

export interface ItemHoverCardProps {
  item: LibraryItem
  rect: DOMRect
}

/**
 * 悬停浮层（书库 / 笔记书架共用）。
 *
 * 文献：期刊 · 年份 · IF、星级 + 状态、进度、标签。
 * 笔记：分类、星级 + 状态、标签、更新时间；文献笔记还会多一行「来源文献」。
 */
export function ItemHoverCard({ item, rect }: ItemHoverCardProps) {
  const isPaper = item.type === 'paper'
  const sourceTitle = item.paper?.meta.title ?? null

  return (
    <FloatingPopover
      at={{ x: rect.left + rect.width / 2, y: rect.top - 6 }}
      placement="above"
      className="pointer-events-none w-56 p-2.5"
    >
      <div className="flex items-center gap-1 text-[9.5px] text-ink-3">
        {isPaper ? <BookOpen className="size-3" /> : <NotebookPen className="size-3" />}
        {isPaper ? '文献' : item.paper ? '文献笔记' : '独立笔记'}
        {item.pinned ? <Pin className="size-2.5 text-warn" /> : null}
        <span className="ml-auto">{formatRelative(item.updatedAt ?? item.createdAt)}</span>
      </div>

      <div className="mt-1 line-clamp-2 font-serif text-[12px] leading-snug text-ink">{item.title}</div>

      {isPaper ? (
        <div className="mt-1 text-[10.5px] text-ink-3">
          {[item.venue, item.year ? String(item.year) : null].filter(Boolean).join(' · ') || '未填期刊'}
          {item.impactFactor ? (
            <span className="ml-1.5 rounded bg-warn/12 px-1 py-0.5 text-[9.5px] font-medium text-warn">
              IF {formatImpactFactor(item.impactFactor)}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 truncate text-[10.5px] text-ink-3">{spineSubtitle(item)}</div>
      )}

      {!isPaper && sourceTitle ? (
        <div className="mt-1 truncate text-[10px] text-ink-3">
          来源：<span className="text-ink-2">{sourceTitle}</span>
        </div>
      ) : null}

      <div className="mt-1.5 flex items-center gap-2">
        <Stars value={item.importance} />
        <span className="text-[9.5px] text-ink-3">{statusLabel(statusKindOf(item), item.status)}</span>
      </div>

      {isPaper ? (
        <div className="mt-1.5 flex items-center gap-2">
          <ProgressBar value={item.progress} />
          <span className="shrink-0 text-[9.5px] tabular-nums text-ink-3">{item.progress}%</span>
        </div>
      ) : null}

      {item.tags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded bg-surface-2 px-1 py-0.5 text-[9.5px] text-ink-2">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </FloatingPopover>
  )
}
