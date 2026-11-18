import { useCallback, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { consolidateRects, resolveAnnotationStyle } from '@/lib/vault/annotations'
import type { Annotation, AnnotationRect, AnnotationStyles } from '@/lib/vault/schema'
import { cn } from '@/lib/utils'

interface AnnotationMarksProps {
  pageNumber: number
  /** rendered page box in CSS pixels */
  width: number
  height: number
  annotations: Annotation[]
  styles: AnnotationStyles
  rectMode: boolean
  activeId: string | null
  onOpen: (annotation: Annotation, at: { x: number; y: number }) => void
  onCreateRect: (rect: AnnotationRect) => void
}

/**
 * 页面上的标注层。
 *
 * 布局上刻意把高亮放在「文本层下面」（z-index 1 < 2），这样高亮过的文字
 * 依然可以划词、复制 —— 高亮本身不接收鼠标事件，只有带批注的小圆点可以点。
 * 框选出来的矩形是「覆盖物」，可以点开编辑。
 */
export function AnnotationMarks({
  pageNumber,
  width,
  height,
  annotations,
  styles,
  rectMode,
  activeId,
  onOpen,
  onCreateRect,
}: AnnotationMarksProps) {
  const [draft, setDraft] = useState<AnnotationRect | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)

  const toNormalized = useCallback(
    (clientX: number, clientY: number) => {
      const el = layerRef.current
      if (!el) return { x: 0, y: 0 }
      const box = el.getBoundingClientRect()
      return {
        x: Math.min(1, Math.max(0, (clientX - box.left) / box.width)),
        y: Math.min(1, Math.max(0, (clientY - box.top) / box.height)),
      }
    },
    [],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!rectMode || event.button !== 0) return
    const point = toNormalized(event.clientX, event.clientY)
    startRef.current = point
    setDraft({ x: point.x, y: point.y, w: 0, h: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    if (!start) return
    const point = toNormalized(event.clientX, event.clientY)
    setDraft({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current
    startRef.current = null
    if (!start) return
    const point = toNormalized(event.clientX, event.clientY)
    const rect: AnnotationRect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      w: Math.abs(point.x - start.x),
      h: Math.abs(point.y - start.y),
    }
    setDraft(null)
    // A click without a drag is not a rectangle.
    if (rect.w > 0.012 && rect.h > 0.008) onCreateRect(rect)
  }

  return (
    <>
      {/* 高亮层：纯 rgba 背景，不再用 multiply —— 叠色只会来自样式透明度本身 */}
      <div ref={layerRef} className="pdf-annotation-layer pdf-highlight-layer" aria-hidden>
        {annotations.map((annotation) =>
          annotation.kind === 'highlight'
            ? consolidateRects(annotation.rects).map((rect, index) => {
                const style = resolveAnnotationStyle(annotation, styles)
                const pad = style.kind === 'highlight' ? style.paddingY * rect.h : 0
                return (
                  <div
                    key={`${annotation.id}-hl-${index}`}
                    className={cn('pdf-mark', 'pdf-mark-highlight', activeId === annotation.id && 'pdf-mark-active')}
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${(rect.y - pad) * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${(rect.h + pad * 2) * 100}%`,
                      backgroundColor: style.color,
                      opacity: style.opacity,
                    }}
                  />
                )
              })
            : null,
        )}
      </div>

      {/* 线条层：下划线与删除线是两套实现 —— 下划线贴底、删除线走中线 */}
      <div className="pdf-annotation-layer pdf-line-layer" aria-hidden>
        {annotations.map((annotation) => {
          if (annotation.kind !== 'underline' && annotation.kind !== 'strikethrough') return null
          const style = resolveAnnotationStyle(annotation, styles)
          if (style.kind === 'highlight') return null
          return consolidateRects(annotation.rects).map((rect, index) => {
            const lineTop = rect.y + rect.h * style.offset
            return (
              <div
                key={`${annotation.id}-ln-${index}`}
                className={cn(
                  'pdf-mark',
                  annotation.kind === 'underline' ? 'pdf-mark-underline' : 'pdf-mark-strikethrough',
                  activeId === annotation.id && 'pdf-mark-active',
                )}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `calc(${lineTop * 100}% - ${style.width / 2}px)`,
                  width: `${rect.w * 100}%`,
                  height: `${style.width}px`,
                  backgroundColor: style.color,
                  opacity: style.opacity,
                }}
              />
            )
          })
        })}
      </div>

      {/* 框选：图形/空白区域的矩形批注，可以点开 */}
      <div className="pdf-annotation-layer" aria-hidden>
        {annotations.map((annotation) => {
          if (annotation.kind !== 'rect' && annotation.kind !== 'note') return null
          const style = resolveAnnotationStyle(annotation, styles)
          const borderColor = style.color
          return annotation.rects.map((rect, index) => (
            <div
              key={`${annotation.id}-rc-${index}`}
              className={cn('pdf-mark', 'pdf-mark-rect', activeId === annotation.id && 'pdf-mark-active')}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
                borderColor,
                backgroundColor: `${borderColor}1f`,
              }}
              onClick={(event) => {
                event.stopPropagation()
                const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                onOpen(annotation, { x: box.left + box.width / 2, y: box.top })
              }}
            />
          ))
        })}
      </div>

      {/* 批注气泡单独一层，浮在文本层上面才点得到 */}
      <div className="pointer-events-none absolute inset-0 z-[3]">
        {annotations.map((annotation) => {
          const merged = consolidateRects(annotation.rects)
          const last = merged[merged.length - 1]
          if (!last) return null
          const hasNote = Boolean(annotation.note.trim())
          return (
            <button
              key={`note-${annotation.id}`}
              type="button"
              title={hasNote ? annotation.note : '添加批注'}
              onClick={(event) => {
                event.stopPropagation()
                const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                onOpen(annotation, { x: box.left + box.width / 2, y: box.top })
              }}
              className={cn(
                'pointer-events-auto absolute flex size-[15px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition hover:scale-110',
                hasNote
                  ? 'border-warn bg-warn/90 text-white'
                  : 'border-accent/60 bg-surface text-accent/70',
              )}
              style={{
                left: `${(last.x + last.w) * 100}%`,
                top: `${last.y * 100}%`,
              }}
            >
              <MessageSquare className="size-2.5" />
            </button>
          )
        })}
      </div>

      {rectMode && (
        <div
          className="absolute inset-0 z-[4] cursor-crosshair"
          style={{ width, height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {draft && (
            <div
              className="absolute rounded-[2px] border border-dashed border-accent bg-accent/10"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.w * 100}%`,
                height: `${draft.h * 100}%`,
              }}
            />
          )}
        </div>
      )}

      <span className="sr-only">第 {pageNumber} 页，{annotations.length} 条标注</span>
    </>
  )
}
