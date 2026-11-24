import { FileText, Pencil } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { NoteEditor } from '@/components/notes/NoteEditor'
import { PaperDetails } from '@/components/notes/PaperDetails'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'

/**
 * 书库里的两个「独立窗口」：笔记和元信息。
 *
 * 没有做成 Tauri 多窗口是有意的 —— 多窗口要处理窗口间同步（一边改了
 * note.md，另一边得知道），而文献库本来就是文件，谁写谁赢。这里用一个
 * 覆盖层把三栏布局暂时让出来，效果等价，且桌面 / 平板 / 浏览器行为一致。
 */

function usePaper(dir: string | null) {
  return useLibraryStore((s) => (dir ? s.papers.find((paper) => paper.dir === dir) ?? null : null))
}

export function StandaloneNoteDialog() {
  const dir = useUiStore((s) => s.noteDialogDir)
  const close = useUiStore((s) => s.openNoteDialog)
  const paper = usePaper(dir)

  return (
    <Modal
      open={Boolean(dir && paper)}
      onClose={() => close(null)}
      title={
        <span className="flex items-center gap-2">
          <FileText className="size-3.5 text-accent" />
          笔记 · <span className="truncate font-serif">{paper?.meta.title ?? ''}</span>
        </span>
      }
      description="独立窗口：只写笔记，不占阅读器。改动会自动保存到这篇文献的笔记文件（以标题命名）。"
      className="max-w-4xl"
    >
      <div className="h-[70vh]">
        {paper ? <NoteEditor key={paper.dir} paper={paper} /> : null}
      </div>
    </Modal>
  )
}

export function MetaDialog() {
  const dir = useUiStore((s) => s.metaDialogDir)
  const close = useUiStore((s) => s.openMetaDialog)
  const paper = usePaper(dir)

  return (
    <Modal
      open={Boolean(dir && paper)}
      onClose={() => close(null)}
      title={
        <span className="flex items-center gap-2">
          <Pencil className="size-3.5 text-accent" />
          编辑元信息 · <span className="truncate font-serif">{paper?.meta.title ?? ''}</span>
        </span>
      }
      description="改完失焦即写入这篇文献的 meta.json，书脊和书架会立刻跟着变。"
      className="max-w-2xl"
    >
      {paper ? (
        <div className="-mx-1">
          <PaperDetails key={paper.dir} paper={paper} />
        </div>
      ) : null}
    </Modal>
  )
}
