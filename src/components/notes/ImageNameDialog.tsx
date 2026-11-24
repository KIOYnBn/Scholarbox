import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { sanitizeImageName } from '@/lib/notes/attachments'

/**
 * 图片插入前的命名弹窗：粘贴 / 拖拽 / 选择器拿到的文件先在这里确认名字，
 * 再落到 attachments/。名字不含扩展名（扩展名取自原文件，只读展示）。
 */

interface PendingImage {
  file: File
  previewUrl: string
  /** 原文件名去掉扩展名（已清理非法字符） */
  defaultName: string
  /** 只读展示的扩展名（含点；无扩展名按 .png） */
  ext: string
}

function splitName(raw: string): { base: string; ext: string } {
  const clean = sanitizeImageName(raw)
  const match = /\.[a-z0-9]+$/i.exec(clean)
  if (!match) return { base: clean, ext: '.png' }
  return { base: clean.slice(0, clean.length - match[0].length) || 'image', ext: match[0].toLowerCase() }
}

export function ImageNameDialog({
  files,
  onConfirm,
  onCancel,
}: {
  files: File[] | null
  onConfirm: (names: string[]) => void
  onCancel: () => void
}) {
  const [names, setNames] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  const pending = useMemo<PendingImage[]>(() => {
    if (!files || files.length === 0) return []
    return files.map((file) => {
      const { base, ext } = splitName(file.name || 'image.png')
      return { file, previewUrl: URL.createObjectURL(file), defaultName: base, ext }
    })
  }, [files])

  // files 变化时重置输入
  useEffect(() => {
    if (files && files.length > 0) {
      setNames(pending.map((entry) => entry.defaultName))
      window.setTimeout(() => firstInputRef.current?.focus(), 50)
    }
  }, [files, pending])

  // 弹窗关闭时释放预览用的 object URL
  useEffect(() => {
    if (files) return
    return () => undefined
  }, [files])
  useEffect(() => {
    return () => {
      for (const entry of pending) URL.revokeObjectURL(entry.previewUrl)
    }
  }, [pending])

  const commit = () => {
    if (busy) return
    setBusy(true)
    const finalNames = names.map((name, index) => {
      const trimmed = name.trim().replace(/[\\/:*?"<>|]/g, '_')
      return `${trimmed || pending[index]?.defaultName || 'image'}${pending[index]?.ext ?? '.png'}`
    })
    onConfirm(finalNames)
  }

  const open = Boolean(files && files.length > 0)
  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="插入图片"
      description={pending.length > 1 ? `${pending.length} 张图片将存入 attachments/，请为它们命名` : '图片将存入 attachments/'}
      footer={
        <>
          <button type="button" onClick={onCancel} className="sb-btn h-8 px-3 text-[12.5px]">
            取消
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="sb-btn sb-btn-primary h-8 px-3 text-[12.5px] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            插入
          </button>
        </>
      }
    >
      <div className="sb-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {pending.map((entry, index) => (
          <div key={`${entry.previewUrl}-${index}`} className="flex items-center gap-3 rounded-lg border border-line p-2.5">
            <img
              src={entry.previewUrl}
              alt={entry.defaultName}
              className="size-14 shrink-0 rounded-md border border-line object-cover"
            />
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`img-name-${index}`}>
                图片名称
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  id={`img-name-${index}`}
                  ref={index === 0 ? firstInputRef : undefined}
                  value={names[index] ?? ''}
                  onChange={(event) =>
                    setNames((current) => current.map((item, i) => (i === index ? event.target.value : item)))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commit()
                    }
                  }}
                  placeholder={entry.defaultName}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[13px] text-ink focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
                />
                <span className="shrink-0 font-mono text-[11px] text-ink-3">{entry.ext}</span>
              </div>
              <p className="mt-1 truncate text-[10.5px] text-ink-3">原名：{sanitizeImageName(entry.file.name)}</p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
