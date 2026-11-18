import { useState } from 'react'
import { FilePlus2, Upload } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, TextInput } from '@/components/ui/Field'
import { Stars } from '@/components/ui/Stars'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { guessMetadataFromFilename } from '@/lib/pdf'

export function NewPaperDialog() {
  const open = useUiStore((s) => s.addPaperOpen)
  const close = useUiStore((s) => s.closeAddPaper)
  const createPaper = useLibraryStore((s) => s.createPaper)

  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState('')
  const [venue, setVenue] = useState('')
  const [impactFactor, setImpactFactor] = useState('')
  const [field, setField] = useState('')
  const [tags, setTags] = useState('')
  const [importance, setImportance] = useState<1 | 2 | 3 | 4 | 5>(3)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setTitle('')
    setAuthors('')
    setYear('')
    setVenue('')
    setImpactFactor('')
    setField('')
    setTags('')
    setImportance(3)
    setFile(null)
    setError(null)
    setBusy(false)
  }

  const onPickPdf = (picked: File | null) => {
    setFile(picked)
    if (picked && !title.trim()) {
      const guess = guessMetadataFromFilename(picked.name)
      setTitle(guess.title)
      if (guess.year && !year) setYear(String(guess.year))
    }
  }

  const submit = async () => {
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const pdf = file ? new Uint8Array(await file.arrayBuffer()) : null
      const parsedYear = Number.parseInt(year, 10)
      const parsedImpact = Number.parseFloat(impactFactor)
      const record = await createPaper({
        title: title.trim(),
        authors: authors
          .split(/[,;，、]/)
          .map((name) => name.trim())
          .filter(Boolean),
        year: Number.isFinite(parsedYear) ? parsedYear : null,
        venue: venue.trim(),
        impactFactor: Number.isFinite(parsedImpact) ? parsedImpact : null,
        field: field.trim(),
        tags: tags
          .split(/[,;，、]/)
          .map((tag) => tag.trim().replace(/^#/, ''))
          .filter(Boolean),
        importance,
        pdf,
      })
      if (record) {
        reset()
        close()
      } else {
        setError('创建失败，请检查文献库权限')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        close()
      }}
      title="添加文献"
      description="会在 papers/ 下自动建好 origin.pdf、note.md、meta.json 与 assets/"
      footer={
        <div className="flex items-center justify-between gap-2">
          {error ? <span className="text-[11px] text-danger">{error}</span> : <span />}
          <div className="flex gap-1.5">
            <Button onClick={close}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submit()}>
              {busy ? '创建中…' : '创建'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-line bg-surface-2/40 px-3 py-2.5 transition hover:border-accent/40 hover:bg-accent-soft/30">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-ink-3">
            {file ? <FilePlus2 className="size-4 text-accent" /> : <Upload className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-ink">
              {file ? file.name : '选择 PDF 文件（可稍后再导入）'}
            </div>
            <div className="text-[10.5px] text-ink-3">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)} MB · 将作为 origin.pdf 保存`
                : '支持把 PDF 直接拖进主窗口'}
            </div>
          </div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => onPickPdf(event.target.files?.[0] ?? null)}
          />
        </label>

        <Field label="标题" hint="必填">
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="论文标题"
            autoFocus
          />
        </Field>

        <Field label="作者" hint="逗号分隔">
          <TextInput
            value={authors}
            onChange={(event) => setAuthors(event.target.value)}
            placeholder="Vaswani, A., Shazeer, N."
          />
        </Field>

        <div className="grid grid-cols-3 gap-2.5">
          <Field label="年份">
            <TextInput value={year} inputMode="numeric" onChange={(event) => setYear(event.target.value)} placeholder="2024" />
          </Field>
          <Field label="期刊 / 会议">
            <TextInput value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="NeurIPS" />
          </Field>
          <Field label="影响因子">
            <TextInput
              value={impactFactor}
              inputMode="decimal"
              onChange={(event) => setImpactFactor(event.target.value)}
              placeholder="12.4"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="领域">
            <TextInput value={field} onChange={(event) => setField(event.target.value)} placeholder="信息检索" />
          </Field>
          <Field label="标签" hint="逗号分隔">
            <TextInput value={tags} onChange={(event) => setTags(event.target.value)} placeholder="retrieval, rag" />
          </Field>
        </div>

        <Field label="重要性">
          <div className="flex h-8 items-center gap-2">
            <Stars value={importance} size={16} onChange={setImportance} />
            <span className="text-[11px] text-ink-3">{importance} / 5</span>
          </div>
        </Field>
      </div>
    </Modal>
  )
}
