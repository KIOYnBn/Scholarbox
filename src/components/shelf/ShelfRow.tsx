import { ChevronDown } from 'lucide-react'
import type { LibraryItem } from '@/lib/library/item'
import type { ShelfGroup } from '@/lib/shelf'
import { SpineCard } from './SpineCard'
import { toneStyle } from './shelf-tones'
import { cn } from '@/lib/utils'

interface ShelfRowProps {
  group: ShelfGroup
  collapsed: boolean
  onToggle: (key: string) => void
  selectedKey: string | null
  onOpen: (item: LibraryItem) => void
  onHover: (item: LibraryItem | null, rect: DOMRect | null) => void
  onContextMenu: (item: LibraryItem, at: { x: number; y: number }) => void
  onTogglePin?: (item: LibraryItem) => void
  unit?: string
}

/** 一层书架：标题条（可折叠）+ 横向排列的书脊 + 一块「隔板」 */
export function ShelfRow({
  group,
  collapsed,
  onToggle,
  selectedKey,
  onOpen,
  onHover,
  onContextMenu,
  onTogglePin,
  unit = '篇',
}: ShelfRowProps) {
  const style = toneStyle(group.tone)

  return (
    <section className="select-none">
      <button
        type="button"
        onClick={() => onToggle(group.key)}
        aria-expanded={!collapsed}
        className="group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-2/60"
      >
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-ink-3 transition-transform', collapsed && '-rotate-90')}
        />
        <span className={cn('size-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
        <span className="text-[12px] font-medium text-ink">{group.label}</span>
        <span className="text-[10.5px] tabular-nums text-ink-3">{group.items.length} {unit}</span>
        <span className="ml-auto text-[10px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">
          {collapsed ? '展开' : '收起'}
        </span>
      </button>

      {collapsed ? null : (
        <div className="mt-1">
          <div className="sb-scroll flex items-end gap-2 overflow-x-auto px-1 pb-1.5 pt-1">
            {group.items.map((item) => (
              <SpineCard
                key={item.key}
                item={item}
                tone={group.tone}
                selected={item.key === selectedKey}
                onOpen={onOpen}
                onHover={onHover}
                onContextMenu={onContextMenu}
              onTogglePin={onTogglePin}
              />
            ))}
            <div className="w-2 shrink-0" aria-hidden="true" />
          </div>
          {/* 隔板：一条逐渐淡出的木条，让书脊「站」在东西上 */}
          <div
            className="mx-1 h-[5px] rounded-b-[2px] bg-gradient-to-r from-line via-surface-3 to-line/40 shadow-[0_2px_2px_-1px_rgba(30,25,18,0.18)]"
            aria-hidden="true"
          />
        </div>
      )}
    </section>
  )
}
