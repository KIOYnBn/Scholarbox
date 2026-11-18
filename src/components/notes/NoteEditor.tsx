import { Maximize2 } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { NoteSurface } from '@/components/notes/NoteSurface'
import { useLibraryStore } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { useOpenWikiTarget } from '@/hooks/useOpenWikiTarget'
import type { PaperRecord } from '@/lib/vault/schema'

/**
 * 右栏里的文献笔记。真正的编辑器在 `NoteSurface`，这里只负责把
 * `papers/<dir>/note.md` 接上 —— 全屏的「独立打开」用的是同一个组件。
 */
export function NoteEditor({ paper }: { paper: PaperRecord }) {
  const saveNote = useLibraryStore((s) => s.saveNote)
  const openWikiTarget = useOpenWikiTarget()
  const openNote = useUiStore((s) => s.openNote)

  return (
    <NoteSurface
      noteKey={paper.dir}
      initial={paper.note}
      paperDir={paper.dir}
      captureDir={paper.dir}
      label="note.md"
      compact
      onSave={(text) => saveNote(paper.dir, text)}
      onOpenWiki={openWikiTarget}
      actions={
        <IconButton
          label="独立打开"
          size="xs"
          onClick={() => openNote({ kind: 'paper', dir: paper.dir })}
        >
          <Maximize2 className="size-3.5" />
        </IconButton>
      }
    />
  )
}
