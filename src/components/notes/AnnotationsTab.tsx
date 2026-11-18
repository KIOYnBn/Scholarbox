import { useMemo, useState } from 'react'
import { ArrowRight, Download, Highlighter, SquareDashed, StickyNote, Strikethrough, Trash2, Underline } from 'lucide-react'
import { COLOR_HEX, annotationsToMarkdown } from '@/lib/vault/annotations'
import type { Annotation, PaperRecord } from '@/lib/vault/schema'
import { removeAnnotation } from '@/stores/annotations'
import { useLibraryStore } from '@/stores/library'
import { useReaderStore } from '@/stores/reader'
import { cn } from '@/lib/utils'

interface AnnotationsTabProps {
  paper: PaperRecord
}

const KIND_META: Record<
  Annotation['kind'],
  { label: string; Icon: typeof Highlighter }
> = {
  highlight: { label: '高亮', Icon: Highlighter },
  underline: { label: '下划线', Icon: Underline },
  note: { label: '批注', Icon: StickyNote },
  strikethrough: { label: '删除线', Icon: Strikethrough },
  rect: { label: '框选', Icon: SquareDashed },
}

export function AnnotationsTab({ paper }: AnnotationsTabProps) {
  const annotations = paper.meta.annotations ?? []
  const setPage = useReaderStore((s) => s.setPage)
  const openAnnotationEditor = useReaderStore((s) => s.openAnnotationEditor)
  const saveNote = useLibraryStore((s) => s.saveNote)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const sorted = useMemo(
    () =>
      [...annotations].sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page
        return (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0)
      }),
    [annotations],
  )

  const exportToNote = async () => {
    if (!sorted.length || busy) return
    setBusy(true)
    try {
      const md = annotationsToMarkdown(sorted, paper.meta)
      const existing = paper.note.trimEnd()
      await saveNote(paper.dir, `${existing}\n\n${md}`)
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    } finally {
      setBusy(false)
    }
  }

  if (!sorted.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="flex size-9 items-center justify-center rounded-full bg-surface-2">
          <Highlighter className="size-4 text-ink-3" />
        </div>
        <p className="text-[12.5px] font-medium text-ink">还没有标注</p>
        <p className="max-w-[240px] text-[11px] leading-relaxed text-ink-3">
          在 PDF 里选中文字会弹出工具条：高亮、下划线、写批注或翻译。也可以开启框选模式，框住一张图再写说明。
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] text-ink-3">{sorted.length} 条标注</span>
        <button
          type="button"
          onClick={() => void exportToNote()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          <Download className="size-3" />
          {done ? '已写入 note.md' : '导出到笔记'}
        </button>
      </div>

      <div className="sb-scroll flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1.5">
          {sorted.map((annotation) => {
            const meta = KIND_META[annotation.kind]
            return (
              <li
                key={annotation.id}
                className="group rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-line hover:bg-surface-2/40"
              >
                <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: COLOR_HEX[annotation.color] }}
                  />
                  <meta.Icon className="size-3" />
                  <span>{meta.label}</span>
                  <span>· p.{annotation.page}</span>
                  <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      title="跳到这一页"
                      aria-label="跳到这一页"
                      onClick={() => setPage(annotation.page)}
                      className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink"
                    >
                      <ArrowRight className="size-3" />
                    </button>
                    <button
                      type="button"
                      title="删除标注"
                      aria-label="删除标注"
                      onClick={() => removeAnnotation(paper.dir, annotation.id)}
                      className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPage(annotation.page)
                    openAnnotationEditor(annotation.id)
                  }}
                  className="block w-full text-left"
                  title="编辑这条标注"
                >
                  {annotation.text.trim() ? (
                    <p className="line-clamp-2 font-serif text-[12px] leading-snug text-ink-2">
                      {annotation.text}
                    </p>
                  ) : (
                    <p className="text-[11.5px] text-ink-3">框选区域 · 点击编辑批注</p>
                  )}
                </button>
                {annotation.note.trim() && (
                  <p
                    className={cn(
                      'mt-1 rounded border-l-2 border-warn/60 bg-warn/[0.06] px-1.5 py-1 text-[11.5px] leading-snug text-ink',
                    )}
                  >
                    {annotation.note}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
