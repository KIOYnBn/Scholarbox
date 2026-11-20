import { useRef, useState } from 'react'
import { Pin, Star } from 'lucide-react'
import type { LibraryItem } from '@/lib/library/item'
import type { ShelfTone } from '@/lib/shelf'
import {
  SPINE_HEIGHT,
  spineDate,
  spineSubtitle,
  spineTitle,
  spineWidth,
  spineYear,
} from '@/lib/shelf'
import { spineGradient, toneStyle } from './shelf-tones'
import { cn } from '@/lib/utils'

interface SpineCardProps {
  item: LibraryItem
  tone: ShelfTone
  selected: boolean
  /** 书架缩放比例（1 = 默认书脊大小） */
  zoom?: number
  onOpen: (item: LibraryItem) => void
  onHover: (item: LibraryItem | null, rect: DOMRect | null) => void
  onContextMenu: (item: LibraryItem, at: { x: number; y: number }) => void
  /** 传了才显示置顶按钮 */
  onTogglePin?: (item: LibraryItem) => void
}

/**
 * 书脊卡片（书库与笔记库共用）。
 *
 * 没有真实封面（很多 PDF 压根没有首页图像），所以「伪封面」用已有的元数据生成：
 * 分组主题色底 + 标题 + 作者/时间 + 星级 + 底部进度条。
 * 宽度随重要性 1–5 星小幅变化，一架子书看过去有厚薄节奏。
 *
 * 文献与笔记的差别只在「标题下面放什么」：文献放第一作者和年份，
 * 笔记放标签和更新日期 —— 两种内容用同一个骨架。
 */
export function SpineCard({ item, tone, selected, zoom = 1, onOpen, onHover, onContextMenu, onTogglePin }: SpineCardProps) {
  const style = toneStyle(tone)
  const width = Math.round(spineWidth(item.importance) * zoom)
  const height = Math.round(SPINE_HEIGHT * zoom)
  const progress = Math.min(100, Math.max(0, item.progress))
  const ref = useRef<HTMLButtonElement>(null)
  const [raised, setRaised] = useState(false)

  const hoverProps = {
    onMouseEnter: () => {
      setRaised(true)
      onHover(item, ref.current?.getBoundingClientRect() ?? null)
    },
    onMouseLeave: () => {
      setRaised(false)
      onHover(null, null)
    },
  }

  // 文献给第一作者；笔记没有作者，给分类名（要求里的「分类主题色底 + 标题 + 分类名」）
  const subtitle = spineSubtitle(item)
  const footer = item.type === 'note' ? spineDate(item) : spineYear(item)

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(item)}
      onContextMenu={(event) => {
        event.preventDefault()
        onHover(null, null)
        onContextMenu(item, { x: event.clientX, y: event.clientY })
      }}
      {...hoverProps}
      title={`${spineTitle(item)}${subtitle ? ` · ${subtitle}` : ''}`}
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-[3px] text-left ring-1 ring-black/15',
        'shadow-[2px_3px_6px_-1px_rgba(30,25,18,0.35)]',
        'transition-[transform,box-shadow] duration-150 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        raised && '-translate-y-1 shadow-[3px_10px_18px_-6px_rgba(30,25,18,0.55)]',
        selected && 'ring-2 ring-accent translate-y-[-2px]',
      )}
      style={{
        width,
        height,
        background: spineGradient(style),
      }}
    >
      {/* 书脊折痕高光 */}
      <span className="pointer-events-none absolute inset-y-1.5 left-[5px] w-px bg-white/25" aria-hidden="true" />
      <span className="pointer-events-none absolute inset-y-1.5 right-[5px] w-px bg-black/25" aria-hidden="true" />

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
            'absolute left-1 top-1 rounded p-0.5 transition-opacity',
            item.pinned
              ? 'text-[#f2d08a] opacity-100'
              : 'text-white/60 opacity-0 hover:text-[#f2d08a] focus-visible:opacity-100 group-hover:opacity-100',
          )}
        >
          <Pin className={cn('size-2.5', item.pinned ? 'fill-current' : '')} strokeWidth={item.pinned ? 0 : 1.6} />
        </button>
      ) : item.pinned ? (
        <span className="absolute left-1 top-1 text-[#f2d08a]" title="已置顶">
          <Pin className="size-2.5 fill-current" strokeWidth={0} />
        </span>
      ) : null}

      <span className="flex h-full flex-col justify-between px-2.5 py-2.5">
        <span className="line-clamp-5 font-serif text-[11.5px] leading-[1.4] text-[#f8f4ea] drop-shadow-sm">
          {spineTitle(item)}
        </span>

        <span className="min-w-0 space-y-0.5">
          {item.importance >= 4 ? (
            <span className="flex items-center gap-0.5 text-[8px] text-[#f2d08a]">
              {Array.from({ length: Math.round(item.importance) }).map((_, index) => (
                <Star key={index} className="size-2 fill-current" strokeWidth={0} />
              ))}
            </span>
          ) : null}
          {subtitle ? (
            <span className="block truncate text-[9.5px] leading-tight text-white/75">{subtitle}</span>
          ) : null}
          {footer ? (
            <span className="block text-[9px] leading-tight tabular-nums text-white/50">{footer}</span>
          ) : null}
        </span>
      </span>

      {/* 底部细色条 = 阅读进度（笔记没有进度，自然不显示） */}
      {progress > 0 ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-black/25" aria-hidden="true">
          <span
            className="block h-full bg-[#f6efdd]/80 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </span>
      ) : null}
    </button>
  )
}
