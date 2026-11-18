import { useEffect, useRef, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { FloatingPopover } from './FloatingPopover'
import { resolveAnnotationStyle } from '@/lib/vault/annotations'
import { StyleControls } from './StyleControls'
import type {
  Annotation,
  AnnotationStyleOverride,
  AnnotationStyles,
} from '@/lib/vault/schema'

interface AnnotationEditorProps {
  at: { x: number; y: number }
  annotation: Annotation
  styles: AnnotationStyles
  onChange: (patch: Partial<Annotation>) => void
  onDelete: () => void
  onClose: () => void
}

const KIND_LABEL: Record<Annotation['kind'], string> = {
  highlight: '高亮',
  underline: '下划线',
  rect: '框选',
  strikethrough: '删除线',
  note: '批注',
}

export function AnnotationEditor({
  at,
  annotation,
  styles,
  onChange,
  onDelete,
  onClose,
}: AnnotationEditorProps) {
  const [note, setNote] = useState(annotation.note)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  const save = () => {
    onChange({ note })
    onClose()
  }

  return (
    <FloatingPopover at={at} placement="below" onClose={onClose} className="w-[300px] overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/60 px-3 py-1.5 text-[11px] text-ink-2">
        <span className="font-medium">{KIND_LABEL[annotation.kind]}</span>
        <span className="text-ink-3">· 第 {annotation.page} 页</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="删除标注"
            aria-label="删除标注"
            onClick={() => {
              onDelete()
              onClose()
            }}
            className="flex size-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="size-3" />
          </button>
          <button
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2.5">
        {annotation.text.trim() && (
          <p className="mb-2 line-clamp-3 border-l-2 border-line pl-2 text-[11px] leading-relaxed text-ink-3">
            {annotation.text}
          </p>
        )}

        <textarea
          ref={areaRef}
          value={note}
          rows={3}
          placeholder="写点批注…（⌘/Ctrl + Enter 保存）"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
          }}
          className="w-full resize-none rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent/60"
        />

        <div className="mt-2 rounded-lg border border-line/70 bg-surface-2/40">
          <StyleControls
            kind={annotation.kind}
            compact
            value={{
              ...(resolveAnnotationStyle(annotation, styles) as AnnotationStyleOverride),
              ...(annotation.style ?? {}),
            }}
            onChange={(patch) => onChange({ style: { ...(annotation.style ?? {}), ...patch } })}
          />
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] text-white transition hover:bg-accent/90"
          >
            <Check className="size-3" />
            保存
          </button>
        </div>
      </div>
    </FloatingPopover>
  )
}
