import { Copy, Highlighter, Languages, MessageSquarePlus, Strikethrough, Underline } from 'lucide-react'
import { FloatingPopover } from './FloatingPopover'
import { ANNOTATION_COLORS } from '@/lib/vault/annotations'
import type { AnnotationColor, AnnotationKind } from '@/lib/vault/schema'
import { cn } from '@/lib/utils'

interface SelectionToolbarProps {
  at: { x: number; y: number }
  /** current colour, remembered across selections */
  color: AnnotationColor
  onColor: (color: AnnotationColor) => void
  onMark: (kind: AnnotationKind) => void
  onNote: () => void
  onTranslate: () => void
  onCopy: () => void
  onClose: () => void
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  )
}

export function SelectionToolbar({
  at,
  color,
  onColor,
  onMark,
  onNote,
  onTranslate,
  onCopy,
  onClose,
}: SelectionToolbarProps) {
  return (
    <FloatingPopover at={at} onClose={onClose} className="px-1.5 py-1">
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 px-0.5">
          {ANNOTATION_COLORS.map((option) => (
            <button
              key={option.value}
              type="button"
              title={`${option.label}色高亮`}
              aria-label={`${option.label}色高亮`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onColor(option.value)
                onMark('highlight')
              }}
              className={cn(
                'size-[15px] rounded-full ring-offset-1 ring-offset-surface transition',
                color === option.value ? 'ring-2 ring-ink/35' : 'ring-1 ring-black/10',
              )}
              style={{ backgroundColor: option.swatch }}
            />
          ))}
        </div>

        <span className="mx-0.5 h-5 w-px bg-line" />

        <ToolButton label="高亮 (H)" onClick={() => onMark('highlight')}>
          <Highlighter className="size-3.5" />
        </ToolButton>
        <ToolButton label="下划线 (U)" onClick={() => onMark('underline')}>
          <Underline className="size-3.5" />
        </ToolButton>
        <ToolButton label="删除线 (S)" onClick={() => onMark('strikethrough')}>
          <Strikethrough className="size-3.5" />
        </ToolButton>
        <ToolButton label="添加批注 (N)" onClick={onNote}>
          <MessageSquarePlus className="size-3.5" />
        </ToolButton>

        <span className="mx-0.5 h-5 w-px bg-line" />

        <ToolButton label="翻译选中文字 (T)" onClick={onTranslate}>
          <Languages className="size-3.5" />
        </ToolButton>
        <ToolButton label="复制" onClick={onCopy}>
          <Copy className="size-3.5" />
        </ToolButton>
      </div>
    </FloatingPopover>
  )
}
