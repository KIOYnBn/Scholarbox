import { useEffect, useState } from 'react'
import { Copy, ExternalLink, FolderOpen, Hash } from 'lucide-react'
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field'
import { Stars } from '@/components/ui/Stars'
import { formatFileSize, formatRelative } from '@/lib/format'
import { useLibraryStore } from '@/stores/library'
import type { PaperMeta, PaperRecord, PaperStatus } from '@/lib/vault/schema'
import { cn } from '@/lib/utils'

export function PaperDetails({ paper }: { paper: PaperRecord }) {
  const updateMeta = useLibraryStore((s) => s.updateMeta)
  const markViewed = useLibraryStore((s) => s.markViewed)
  const { meta } = paper
  const [copied, setCopied] = useState(false)

  // 看详情也算「看过」；去重在 markViewed 内部（60 秒）
  useEffect(() => {
    void markViewed(paper.dir)
  }, [paper.dir, markViewed])

  const patch = (value: Partial<PaperMeta>) => {
    void updateMeta(paper.dir, value)
  }

  const commitText =
    (key: keyof PaperMeta) =>
    (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value.trim()
      if (String(meta[key] ?? '') !== next) patch({ [key]: next } as Partial<PaperMeta>)
    }

  return (
    <div key={paper.dir} className="sb-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
      <div className="space-y-3">
        <Field label="标题">
          <TextInput defaultValue={meta.title} onBlur={commitText('title')} placeholder="论文标题" />
        </Field>

        <Field label="作者" hint="逗号或分号分隔">
          <TextInput
            defaultValue={meta.authors.join(', ')}
            onBlur={(event) => {
              const authors = event.target.value
                .split(/[,;，、]/)
                .map((name) => name.trim())
                .filter(Boolean)
              patch({ authors })
            }}
            placeholder="Vaswani, A., Shazeer, N."
          />
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="年份">
            <TextInput
              defaultValue={meta.year ?? ''}
              inputMode="numeric"
              onBlur={(event) => {
                const year = Number.parseInt(event.target.value, 10)
                patch({ year: Number.isFinite(year) && year > 1500 ? year : null })
              }}
              placeholder="2024"
            />
          </Field>
          <Field label="影响因子">
            <TextInput
              defaultValue={meta.impactFactor ?? ''}
              inputMode="decimal"
              onBlur={(event) => {
                const value = Number.parseFloat(event.target.value)
                patch({ impactFactor: Number.isFinite(value) ? value : null })
              }}
              placeholder="12.4"
            />
          </Field>
        </div>

        <Field label="期刊 / 会议">
          <TextInput defaultValue={meta.venue} onBlur={commitText('venue')} placeholder="Nature Machine Intelligence" />
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="领域">
            <TextInput defaultValue={meta.field} onBlur={commitText('field')} placeholder="信息检索" />
          </Field>
          <Field label="阅读状态">
            <Select
              value={meta.status}
              onChange={(event) => patch({ status: event.target.value as PaperStatus })}
            >
              <option value="todo">待读</option>
              <option value="reading">在读</option>
              <option value="done">已读完</option>
              <option value="archived">归档</option>
            </Select>
          </Field>
        </div>

        <Field label="重要性">
          <div className="flex h-8 items-center gap-2">
            <Stars value={meta.importance} size={16} onChange={(value) => patch({ importance: value })} />
            <span className="text-[11px] text-ink-3">{meta.importance} / 5</span>
          </div>
        </Field>

        <Field label="标签" hint="逗号分隔">
          <TextInput
            defaultValue={meta.tags.join(', ')}
            onBlur={(event) => {
              const tags = [
                ...new Set(
                  event.target.value
                    .split(/[,;，、]/)
                    .map((tag) => tag.trim().replace(/^#/, ''))
                    .filter(Boolean),
                ),
              ]
              patch({ tags })
            }}
            placeholder="transformer, retrieval"
          />
        </Field>

        {meta.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {meta.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-accent-soft px-2 py-px text-[10px] text-accent"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="DOI">
            <TextInput defaultValue={meta.doi} onBlur={commitText('doi')} placeholder="10.1000/xyz" />
          </Field>
          <Field label="链接">
            <TextInput defaultValue={meta.url} onBlur={commitText('url')} placeholder="https://" />
          </Field>
        </div>

        {meta.doi || meta.url ? (
          <div className="flex flex-wrap gap-1.5">
            {meta.doi ? (
              <a
                href={`https://doi.org/${meta.doi}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-2 hover:border-accent/40 hover:text-accent"
              >
                <Hash className="size-3" /> 在 DOI 打开
              </a>
            ) : null}
            {meta.url ? (
              <a
                href={meta.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-2 hover:border-accent/40 hover:text-accent"
              >
                <ExternalLink className="size-3" /> 原文链接
              </a>
            ) : null}
          </div>
        ) : null}

        <Field label="摘要">
          <TextArea
            defaultValue={meta.abstract}
            rows={4}
            onBlur={commitText('abstract')}
            placeholder="粘贴摘要，方便离线检索"
          />
        </Field>

        <div className="rounded-lg border border-line bg-surface-2/50 p-2.5 text-[10.5px] text-ink-3">
          <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            <FolderOpen className="size-3" />
            文件夹
          </div>
          <div className="flex items-start gap-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-relaxed text-ink-2">
              papers/{paper.dir}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(paper.dir)
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              }}
              className="shrink-0 rounded p-0.5 hover:bg-surface-2 hover:text-ink"
              title="复制文件夹名"
            >
              <Copy className={cn('size-3', copied && 'text-accent')} />
            </button>
          </div>
          <div className="mt-3 border-t border-line/60 pt-2.5">
            <div className="mb-1 flex items-center justify-between text-[10px] text-ink-3">
              <span>阅读进度</span>
              <span className="tabular-nums">{meta.progress}%</span>
            </div>
            <ProgressSlider
              key={`${paper.dir}-${meta.progress}`}
              value={meta.progress}
              onChange={(progress) => patch({ progress })}
            />
            <div className="mt-1.5 flex gap-1">
              {([
                ['未开始', 0],
                ['一半', 50],
                ['读完', 100],
              ] as const).map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => patch({ progress: value })}
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-accent/40 hover:text-ink"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
            <Row label="PDF" value={paper.hasPdf ? formatFileSize(paper.pdfSize) : '未导入'} />
            <Row label="图片" value={paper.assets.length ? `${paper.assets.length} 张` : '—'} />
            <Row label="进度" value={`${meta.progress}%`} />
            <Row label="页数" value={meta.lastPage > 0 ? `读到第 ${meta.lastPage + 1} 页` : '未开始'} />
            <Row label="创建" value={formatRelative(meta.createdAt)} />
            <Row label="修改" value={formatRelative(meta.updatedAt)} />
          </dl>
        </div>

        {!paper.metaOk ? (
          <p className="rounded-md bg-warn/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-warn">
            meta.json 解析失败，以上信息来自文件夹名。修改任意字段会重写一份标准格式的 meta.json。
          </p>
        ) : null}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="flex items-center gap-1">
        <span className="size-1 rounded-full bg-ink-3/40" />
        {label}
      </dt>
      <dd className="truncate text-right text-ink-2">{value}</dd>
    </>
  )
}

/**
 * 拖动时只更新本地状态，松手（或键盘操作）才写 meta.json ——
 * 否则拖一下滑块会触发几十次磁盘写入，还会让 Git 记录一串没意义的中间态。
 */
function ProgressSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value)

  const commit = (next: number) => {
    if (next !== value) onChange(next)
  }

  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      value={draft}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={() => commit(draft)}
      onKeyUp={() => commit(draft)}
      onBlur={() => commit(draft)}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
      aria-label="阅读进度"
    />
  )
}
