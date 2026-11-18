import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface PanelResizerProps {
  value: number
  min: number
  max: number
  /** true when the panel sits to the right of the handle (drag left = wider) */
  invert?: boolean
  onChange: (value: number) => void
  label?: string
}

export function PanelResizer({ value, min, max, invert, onChange, label }: PanelResizerProps) {
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, value })
  const latest = useRef(value)
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    latest.current = value
  }, [value])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = { x: event.clientX, value: latest.current }
      setDragging(true)
    },
    [],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const delta = (event.clientX - start.current.x) * (invert ? -1 : 1)
      const next = Math.round(Math.min(max, Math.max(min, start.current.value + delta)))
      change.current(next)
    },
    [dragging, invert, max, min],
  )

  const end = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label ?? '拖拽调整面板宽度'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => change.current(invert ? 420 : 320)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 12
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          change.current(Math.max(min, latest.current + (invert ? step : -step)))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          change.current(Math.min(max, latest.current + (invert ? -step : step)))
        }
      }}
      className={cn(
        'group relative z-10 -mx-[3px] w-[7px] shrink-0 cursor-col-resize select-none',
        'focus:outline-none',
      )}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-[3px] w-px transition-colors',
          dragging ? 'bg-accent' : 'bg-line group-hover:bg-accent/50 group-focus-visible:bg-accent',
        )}
      />
    </div>
  )
}
