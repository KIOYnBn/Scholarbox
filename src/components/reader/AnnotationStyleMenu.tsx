import { useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import { FloatingPopover } from './FloatingPopover'
import { StyleControls } from './StyleControls'
import { updateStyles } from '@/stores/annotations'
import type { AnnotationStyles, PaperRecord } from '@/lib/vault/schema'
import { cn } from '@/lib/utils'

type StyleKey = 'highlight' | 'underline' | 'strikethrough'

const KINDS: { kind: StyleKey; label: string }[] = [
  { kind: 'highlight', label: '高亮' },
  { kind: 'underline', label: '下划线' },
  { kind: 'strikethrough', label: '删除线' },
]

interface AnnotationStyleMenuProps {
  paper: PaperRecord
}

/**
 * 这篇文献的**默认**标注样式。单条覆盖在标注编辑器里改，
 * 两者独立：改这里不会覆盖已经单独设过样式的标注。
 */
export function AnnotationStyleMenu({ paper }: AnnotationStyleMenuProps) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [kind, setKind] = useState<StyleKey>('highlight')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const styles: AnnotationStyles = paper.meta.styles

  const patch = (next: Partial<AnnotationStyles[StyleKey]>) => {
    updateStyles(paper.dir, { [kind]: { ...styles[kind], ...next } } as Partial<AnnotationStyles>)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="标注样式（这篇文献的默认值）"
        aria-label="标注样式"
        onClick={() => {
          const box = triggerRef.current?.getBoundingClientRect()
          if (box) setAt({ x: box.left + box.width / 2, y: box.bottom + 6 })
          setOpen((value) => !value)
        }}
        className={cn(
          'flex size-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink',
          open && 'bg-accent-soft text-accent',
        )}
      >
        <Palette className="size-3.5" />
      </button>

      {open && at && (
        <FloatingPopover at={at} placement="below" onClose={() => setOpen(false)} className="w-[248px]">
          <div className="flex items-center gap-1 border-b border-line bg-surface-2/60 px-2 py-1.5">
            {KINDS.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                onClick={() => setKind(entry.kind)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] transition',
                  kind === entry.kind
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-3 hover:text-ink',
                )}
              >
                {entry.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-ink-3">这篇文献的默认值</span>
          </div>
          <StyleControls
            compact
            kind={kind}
            value={styles[kind]}
            onChange={patch}
          />
        </FloatingPopover>
      )}
    </>
  )
}
