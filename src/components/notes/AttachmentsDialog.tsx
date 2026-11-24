import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { renameVaultFileWithLinks } from '@/lib/notes/links'
import { useVaultStore } from '@/stores/vault'
import { useUiStore } from '@/stores/ui'
import { extname, sanitizeSegment, stem } from '@/lib/path'

/**
 * 附件管理：列出 attachments/ 下的文件，重命名时全库引用
 * （markdown 路径 / wiki 完整路径）一并改写。
 */

interface AttachEntry {
  name: string
  size: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentsDialog() {
  const open = useUiStore((s) => s.attachmentsOpen)
  const close = useUiStore((s) => s.closeAttachments)
  const fs = useVaultStore((s) => s.fs)

  const [entries, setEntries] = useState<AttachEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 正在重命名的文件名；null = 没有进行中的重命名 */
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  /** 刚改完名的文件 → 更新了多少处引用（展示一轮反馈） */
  const [lastResult, setLastResult] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!fs) return
    setLoading(true)
    setError(null)
    try {
      const list = await fs.list('attachments').catch(() => [])
      const withSize: AttachEntry[] = []
      for (const entry of list) {
        if (entry.kind !== 'file') continue
        const stat = await fs.stat(`attachments/${entry.name}`).catch(() => null)
        withSize.push({ name: entry.name, size: stat?.size ?? 0 })
      }
      withSize.sort((a, b) => a.name.localeCompare(b.name))
      setEntries(withSize)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [fs])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const startRename = (entry: AttachEntry) => {
    setRenaming(entry.name)
    setDraft(stem(entry.name))
    setLastResult(null)
  }

  const commitRename = async () => {
    if (!fs || !renaming || busy) return
    const ext = extname(renaming) || '.png'
    const base = draft.trim().replace(/[\\/:*?"<>|]/g, '_')
    if (!base) return
    const next = `${sanitizeSegment(base, stem(renaming))}${ext}`
    if (next === renaming) {
      setRenaming(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await renameVaultFileWithLinks(fs, `attachments/${renaming}`, `attachments/${next}`)
      setLastResult(`已重命名「${renaming}」→「${next}」，更新了 ${updated} 个文件里的引用`)
      setRenaming(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="附件管理"
      description="attachments/ 下的图片等文件；重命名会同步更新全库引用"
      className="max-w-xl"
    >
      <div className="sb-scroll max-h-[440px] min-h-[120px] space-y-1.5 overflow-y-auto pr-1">
        {loading ? (
          <p className="flex items-center gap-2 px-1 py-4 text-[12px] text-ink-3">
            <Loader2 className="size-3.5 animate-spin" /> 读取中…
          </p>
        ) : entries.length === 0 ? (
          <p className="px-1 py-4 text-[12px] text-ink-3">attachments/ 还是空的——插入图片后会出现在这里</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5"
            >
              {renaming === entry.name ? (
                <>
                  <input
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitRename()
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                    className="h-7 min-w-0 flex-1 rounded-md border border-accent/40 bg-surface px-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/15"
                  />
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">{extname(entry.name) || '.png'}</span>
                  <button
                    type="button"
                    aria-label={`确认重命名 ${entry.name}`}
                    disabled={busy}
                    onClick={() => void commitRename()}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-white transition hover:bg-accent/90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    aria-label="取消重命名"
                    onClick={() => setRenaming(null)}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{formatSize(entry.size)}</span>
                  <button
                    type="button"
                    aria-label={`重命名 ${entry.name}`}
                    title="重命名（引用同步更新）"
                    onClick={() => startRename(entry)}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-accent"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
      {error ? <p className="mt-2 px-1 text-[11.5px] text-red-500">{error}</p> : null}
      {lastResult ? <p className="mt-2 px-1 text-[11.5px] text-emerald-600">{lastResult}</p> : null}
    </Modal>
  )
}
