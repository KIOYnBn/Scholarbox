import { useEffect, useState } from 'react'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { NOTE_STATUS_LABELS, NOTE_STATUS_ORDER, type NoteStatus } from '@/lib/library/item'
import { Modal } from '@/components/ui/Modal'
import { Field, TextInput, Select } from '@/components/ui/Field'
import { Stars } from '@/components/ui/Stars'
import { Button } from '@/components/ui/Button'

interface NoteMetaDialogProps {
  file: string | null
  onClose: () => void
}

/**
 * 独立笔记的元信息编辑。
 *
 * 这些值都写在 frontmatter 里（不像文献那样有 meta.json），
 * 所以「分类/重要性/置顶」永远只是元数据 —— 不会移动或重命名文件。
 */
export function NoteMetaDialog({ file, onClose }: NoteMetaDialogProps) {
  const notes = useStandaloneNotesStore((s) => s.notes)
  const updateMeta = useStandaloneNotesStore((s) => s.updateMeta)
  const note = file ? notes.find((item) => item.file === file) ?? null : null

  const [field, setField] = useState('')
  const [tags, setTags] = useState('')
  const [importance, setImportance] = useState(3)
  const [status, setStatus] = useState<NoteStatus>('active')
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (!note) return
    setField(note.field)
    setTags(note.tags.join(', '))
    setImportance(note.importance)
    setStatus(note.status)
    setPinned(note.pinned)
  }, [note?.file]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!note) return null

  const commit = async () => {
    await updateMeta(note.file, {
      field: field.trim(),
      tags: tags
        .split(/[,，、]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      importance,
      status,
      pinned,
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="编辑笔记元信息" description={`notes/${note.file}`}>
      <div className="space-y-3">
        <Field label="领域">
          <TextInput value={field} onChange={(event) => setField(event.target.value)} placeholder="例如 信息检索" />
        </Field>
        <Field label="标签" hint="逗号分隔">
          <TextInput value={tags} onChange={(event) => setTags(event.target.value)} placeholder="方法, 待整理" />
        </Field>
        <div className="flex items-end justify-between gap-4">
          <Field label="重要性">
            <Stars value={importance} onChange={setImportance} />
          </Field>
          <Field label="状态">
            <Select value={status} onChange={(event) => setStatus(event.target.value as NoteStatus)} className="w-28">
              {NOTE_STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {NOTE_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
            className="size-3.5 accent-[var(--color-accent)]"
          />
          置顶到笔记库最前
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void commit()}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}
