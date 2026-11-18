import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface FloatingPopoverProps {
  /** anchor point in *client* coordinates */
  at: { x: number; y: number }
  /** prefer opening above the anchor (for selection toolbars) */
  placement?: 'above' | 'below'
  onClose?: () => void
  className?: string
  children: React.ReactNode
}

/**
 * Small popup pinned to a point on screen, used by the selection toolbar and
 * the translation card. It flips itself when it would leave the viewport and
 * closes on outside click / Escape.
 */
export function FloatingPopover({
  at,
  placement = 'above',
  onClose,
  className,
  children,
}: FloatingPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox({ width: el.offsetWidth, height: el.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!onClose) return
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // defer so the click that opened the popover doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const margin = 10
  const width = box.width || 220
  const height = box.height || 44
  const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 768 : window.innerHeight

  let left = at.x - width / 2
  left = Math.min(Math.max(margin, left), viewportW - width - margin)

  const preferredTop = placement === 'above' ? at.y - height - 12 : at.y + 12
  const flippedTop = placement === 'above' ? at.y + 12 : at.y - height - 12
  const fits = placement === 'above' ? preferredTop >= margin : preferredTop + height <= viewportH - margin
  const top = Math.min(
    Math.max(margin, fits ? preferredTop : flippedTop),
    viewportH - height - margin,
  )

  return createPortal(
    <div
      ref={ref}
      style={{ left, top }}
      className={cn(
        'fixed z-[60] rounded-xl border border-line bg-surface shadow-[0_10px_34px_-12px_rgba(34,31,26,0.35)]',
        className,
      )}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  )
}
