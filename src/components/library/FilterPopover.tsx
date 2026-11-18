import { useEffect, useRef, useState } from 'react'
import { Check, RotateCcw, SlidersHorizontal, Tag, X } from 'lucide-react'
import { RECENT_WINDOWS, type RecentWindow } from '@/lib/library/recency'
import { cn } from '@/lib/utils'

/**
 * 领域之外的筛选项：重要性（≥N 星）和标签（多选交集）。
 *
 * 放在下拉里而不是常驻一栏，是因为标签可能有几十个 —— 常驻会把文献列表挤到
 * 看不见。触发器上显示当前激活了几个条件，收起状态也能一眼看出「有筛选」。
 */
interface FilterPopoverProps {
  minImportance: number
  tags: string[]
  /** 最近查看窗口 */
  recent: RecentWindow
  /** [标签, 数量] */
  facets: [string, number][]
  onChange: (patch: { minImportance?: number; tags?: string[]; recent?: RecentWindow }) => void
  onReset: () => void
}

export function FilterPopover({ minImportance, tags, recent, facets, onChange, onReset }: FilterPopoverProps) {

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const activeCount = (minImportance > 1 ? 1 : 0) + tags.length + (recent !== 'all' ? 1 : 0)

  const toggleTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]
    onChange({ tags: next })
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="按重要性 / 标签筛选"
        aria-label="按重要性 / 标签筛选"
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md transition-colors',
          activeCount > 0 ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
          open && 'bg-surface-2 text-ink',
        )}
      >
        <SlidersHorizontal className="size-3.5" />
        {activeCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-[8px] font-medium text-white">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-30 w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink">筛选</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label="关闭筛选"
            >
              <X className="size-3" />
            </button>
          </div>

          <div className="mb-3">
            <div className="mb-1.5 text-[10.5px] text-ink-3">重要性</div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => {
                const active = minImportance >= value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onChange({ minImportance: minImportance === value ? 1 : value })}
                    title={`${value} 星及以上`}
                    aria-label={`${value} 星及以上`}
                    className="rounded p-0.5 hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        'block size-3.5',
                        active ? 'text-warn' : 'text-ink-3/40',
                      )}
                    >
                      ★
                    </span>
                  </button>
                )
              })}
              <span className="ml-1 text-[10.5px] text-ink-3">
                {minImportance > 1 ? `${minImportance} 星及以上` : '不限'}
              </span>
            </div>
          </div>

          <div className="mb-3">
            <div className="mb-1.5 text-[10.5px] text-ink-3">最近查看</div>
            <div className="flex items-center gap-1">
              {RECENT_WINDOWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ recent: option.value })}
                  className={cn(
                    'rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors',
                    recent === option.value
                      ? 'border-accent/40 bg-accent-soft text-accent'
                      : 'border-line text-ink-2 hover:border-accent/30 hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[10.5px] text-ink-3">
              <Tag className="size-3" />
              标签
              <span className="opacity-60">（多选取交集）</span>
            </div>
            {facets.length === 0 ? (
              <div className="py-2 text-[10.5px] text-ink-3">还没有任何标签</div>
            ) : (
              <div className="sb-scroll flex max-h-36 flex-wrap gap-1 overflow-y-auto">
                {facets.map(([tag, count]) => {
                  const active = tags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors',
                        active
                          ? 'border-accent/40 bg-accent-soft text-accent'
                          : 'border-line bg-surface text-ink-2 hover:border-accent/30 hover:text-ink',
                      )}
                    >
                      {active ? <Check className="size-2.5" /> : null}
                      {tag}
                      <span className="opacity-50">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 text-[10.5px] text-ink-3 hover:text-ink"
            >
              <RotateCcw className="size-3" />
              清除全部
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="sb-btn sb-btn-primary h-6 px-2 text-[10.5px]"
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
