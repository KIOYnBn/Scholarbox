import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  backgroundPreset,
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  NOTE_BACKGROUNDS,
  NOTE_WIDTHS,
  noteWidthLabel,
} from '@/lib/notes/appearance'
import type { NoteBackground, NoteWidth } from '@/stores/settings'
import { cn } from '@/lib/utils'

/**
 * 「笔记外观」浮层：字号 + 底色 + 版心宽度。
 *
 * 为什么放在笔记里而不是只放设置：写字的时候才会发现「这行太小」「两边太空」「底色刺眼」，
 * 跑去设置面板改完再回来太折腾。字号滑杆可以**用鼠标拖**，拖动即时生效。
 */
export function FontSizeControl({
  value,
  onChange,
  background,
  onBackground,
  width,
  onWidth,
  className,
}: {
  value: number
  onChange: (value: number) => void
  background?: NoteBackground
  onBackground?: (value: NoteBackground) => void
  width?: NoteWidth
  onWidth?: (value: NoteWidth) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const set = (next: number) => onChange(clampFontSize(next))
  const showLook = Boolean(onBackground && onWidth)

  return (
    <div ref={rootRef} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        title="外观：字号 / 底色 / 版心"
        aria-label="外观"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-6 items-center justify-center gap-0.5 rounded-md px-1.5 transition',
          open ? 'bg-surface text-accent shadow-sm' : 'text-ink-3 hover:text-ink',
        )}
      >
        <span className="text-[12px] font-semibold leading-none">A</span>
        <span className="text-[9px] leading-none">a</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-7 z-50 w-64 rounded-lg border border-line bg-surface p-2.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)]">
          <div className="flex items-baseline justify-between">
            <span className="text-[10.5px] font-medium text-ink-2">字号</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-3">{value}px</span>
          </div>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={FONT_SIZE_STEP}
            value={value}
            onChange={(event) => set(Number(event.target.value))}
            className="mt-1.5 w-full cursor-ew-resize accent-[var(--color-accent)]"
            aria-label="拖动调整字号"
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-ink-3">
            <button type="button" onClick={() => set(value - 1)} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink">
              A−
            </button>
            <button type="button" onClick={() => set(15)} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink">
              重置
            </button>
            <button type="button" onClick={() => set(value + 1)} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink">
              A+
            </button>
          </div>

          {showLook && background ? (
            <>
              <div className="mt-2 border-t border-line/60 pt-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10.5px] font-medium text-ink-2">底色</span>
                  <span className="text-[10px] text-ink-3">{backgroundPreset(background).label}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {NOTE_BACKGROUNDS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.label}
                      aria-label={`底色 ${preset.label}`}
                      onClick={() => onBackground?.(preset.id)}
                      className={cn(
                        'flex size-6 items-center justify-center rounded-md border transition',
                        background === preset.id ? 'border-accent ring-2 ring-accent/25' : 'border-line hover:border-line-strong',
                      )}
                      style={{ background: preset.swatch }}
                    >
                      {background === preset.id ? <Check className="size-3 text-accent" /> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-2 border-t border-line/60 pt-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10.5px] font-medium text-ink-2">版心宽度</span>
                  <span className="text-[10px] text-ink-3">{noteWidthLabel(width ?? 'wide')}</span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  {NOTE_WIDTHS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.hint}
                      aria-label={`版心 ${preset.label}`}
                      onClick={() => onWidth?.(preset.id)}
                      className={cn(
                        'flex-1 rounded border px-1 py-0.5 text-[10px] transition',
                        width === preset.id
                          ? 'border-accent/60 bg-accent-soft/60 text-ink'
                          : 'border-line text-ink-3 hover:text-ink',
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
