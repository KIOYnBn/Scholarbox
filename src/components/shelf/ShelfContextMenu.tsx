import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, FileText, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import type { LibraryItem, ItemStatus } from '@/lib/library/item'
import { statusKindOf, statusLabel, statusOrderFor } from '@/lib/library/item'
import { cn } from '@/lib/utils'

interface ShelfContextMenuProps {
  item: LibraryItem
  at: { x: number; y: number }
  onClose: () => void
  onOpen: (item: LibraryItem) => void
  onEditMeta: (item: LibraryItem) => void
  onSetStatus: (item: LibraryItem, status: ItemStatus) => void
  onTogglePin?: (item: LibraryItem) => void
  onDelete?: (item: LibraryItem) => void
}

const MENU_WIDTH = 208

/**
 * 书脊右键菜单（书库与笔记库共用）。
 *
 * 状态项按条目类型注入：文献给「在读/待读/已读/归档」，独立笔记给「在写/草稿/归档」——
 * 两套枚举不会互相污染。
 */
export function ShelfContextMenu({
  item,
  at,
  onClose,
  onOpen,
  onEditMeta,
  onSetStatus,
  onTogglePin,
  onDelete,
}: ShelfContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: at.x, top: at.y })

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 280
    const left = Math.min(at.x, window.innerWidth - MENU_WIDTH - 8)
    const top = Math.min(at.y, window.innerHeight - height - 8)
    setPosition({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [at.x, at.y])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // 延后一拍，避免触发菜单的那次 right-click 立刻把它关掉
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
      className="fixed z-[60] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[var(--sb-shadow)]"
    >
      <div className="truncate px-2.5 pb-1 pt-1.5 font-serif text-[11.5px] text-ink" title={item.title}>
        {item.title}
      </div>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onOpen(item)
          onClose()
        }}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <FileText className="size-3.5" />
        独立打开
      </button>

      {onTogglePin ? (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={item.pinned}
          onClick={() => {
            onTogglePin(item)
            onClose()
          }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          {item.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {item.pinned ? '取消置顶' : '置顶'}
        </button>
      ) : null}

      <div className="my-1 border-t border-line" />
      <div className="px-2.5 pb-1 text-[10px] text-ink-3">标记状态</div>
      <div className="grid grid-cols-2 gap-1 px-2 pb-1">
        {statusOrderFor(statusKindOf(item)).map((status) => {
          const active = item.status === status
          return (
            <button
              key={status}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => {
                onSetStatus(item, status)
                onClose()
              }}
              className={cn(
                'inline-flex items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[10.5px] transition-colors',
                active
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-line text-ink-2 hover:border-accent/30 hover:text-ink',
              )}
            >
              {active ? <Check className="size-2.5" /> : null}
              {statusLabel(statusKindOf(item), status)}
            </button>
          )
        })}
      </div>

      <div className="my-1 border-t border-line" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onEditMeta(item)
          onClose()
        }}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <Pencil className="size-3.5" />
        编辑元信息
      </button>
      {onDelete ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onDelete(item)
            onClose()
          }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-danger hover:bg-danger/10"
        >
          <Trash2 className="size-3.5" />
          删除这条{item.file ? '笔记' : '文献'}
        </button>
      ) : null}
    </div>,
    document.body,
  )
}
