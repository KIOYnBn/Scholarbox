import { BookOpen, FileText, Pencil } from 'lucide-react'
import type { PaperRecord } from '@/lib/vault/schema'
import { STATUS_LABELS } from '@/lib/shelf'
import { formatImpactFactor, formatRelative } from '@/lib/format'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Stars } from '@/components/ui/Stars'
import { Button } from '@/components/ui/Button'

interface PaperPreviewProps {
  paper: PaperRecord | null
  onOpen: (dir: string) => void
  onOpenNote: (dir: string) => void
  onEditMeta: (dir: string) => void
}

/** 列表模式右侧的预览：选中哪篇就看哪篇，不打开阅读器也能判断要不要读 */
export function PaperPreview({ paper, onOpen, onOpenNote, onEditMeta }: PaperPreviewProps) {
  if (!paper) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <BookOpen className="size-6 text-ink-3/60" />
        <p className="text-[12px] text-ink-2">选一篇文献看预览</p>
        <p className="max-w-[240px] text-[11px] leading-relaxed text-ink-3">
          双击或点「打开阅读」进入三栏阅读器；书库里单击书脊也可以直接打开。
        </p>
      </div>
    )
  }

  const { meta } = paper
  const excerpt = paper.note.replace(/^---[\s\S]*?---\n/, '').trim()

  return (
    <div className="sb-scroll h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-2xl">
        <div className="mb-1 flex items-center gap-2 text-[10.5px] text-ink-3">
          <span className="rounded bg-surface-2 px-1.5 py-0.5">{meta.field || '未分类'}</span>
          <span>{STATUS_LABELS[meta.status]}</span>
          {meta.year ? <span>{meta.year}</span> : null}
          {paper.metaOk ? null : <span className="text-warn">meta.json 有异常，已按默认值读取</span>}
        </div>

        <h2 className="font-serif text-[19px] leading-snug text-ink">{meta.title || '未命名文献'}</h2>
        <p className="mt-1 text-[11.5px] text-ink-2">
          {meta.authors.length > 0 ? meta.authors.join('、') : '佚名'}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {[meta.venue, meta.year ? String(meta.year) : null].filter(Boolean).join(' · ') || '还没有填写期刊'}
          {meta.impactFactor ? (
            <span className="ml-1.5 rounded bg-warn/12 px-1 py-0.5 text-[10px] font-medium text-warn">
              IF {formatImpactFactor(meta.impactFactor)}
            </span>
          ) : null}
        </p>

        <div className="mt-3 flex items-center gap-4">
          <Stars value={meta.importance} />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ProgressBar value={meta.progress} />
            <span className="shrink-0 text-[10.5px] tabular-nums text-ink-3">{meta.progress}%</span>
          </div>
        </div>

        {meta.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {meta.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-2"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => onOpen(paper.dir)}>
            <BookOpen className="size-3.5" />
            打开阅读
          </Button>
          <Button onClick={() => onOpenNote(paper.dir)}>
            <FileText className="size-3.5" />
            打开笔记
          </Button>
          <Button onClick={() => onEditMeta(paper.dir)}>
            <Pencil className="size-3.5" />
            编辑元信息
          </Button>
        </div>

        <div className="mt-5 rounded-lg border border-line bg-surface p-3">
          <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-ink-3">
            <span>笔记摘要</span>
            <span className="truncate font-mono">{paper.dir}</span>
          </div>
          {excerpt ? (
            <p className="line-clamp-[12] whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-2">
              {excerpt}
            </p>
          ) : (
            <p className="text-[11.5px] text-ink-3">还没有笔记。打开笔记就能边读边写。</p>
          )}
          <div className="mt-2 text-[10px] text-ink-3">最近修改 · {formatRelative(meta.updatedAt)}</div>
        </div>
      </div>
    </div>
  )
}
