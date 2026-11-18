import { useState } from 'react'
import { Camera, Highlighter, FileText, Info, Maximize2, PanelRightClose } from 'lucide-react'
import { AnnotationsTab } from './AnnotationsTab'
import { NoteEditor } from './NoteEditor'
import { PaperDetails } from './PaperDetails'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { IconButton } from '@/components/ui/IconButton'
import { noteSurfaceStyle } from '@/lib/notes/appearance'
import { cn } from '@/lib/utils'

type Tab = 'note' | 'annotations' | 'info'

export function NotesPane() {
  const selectedDir = useLibraryStore((s) => s.selectedDir)
  const paper = useLibraryStore((s) => s.papers.find((item) => item.dir === selectedDir) ?? null)
  const [tab, setTab] = useState<Tab>('note')
  const openNote = useUiStore((s) => s.openNote)
  const toggleNotes = useUiStore((s) => s.toggleNotes)
  const noteBackground = useSettingsStore((s) => s.editor.noteBackground)

  return (
    <aside
      className="flex h-full flex-col overflow-hidden border-l border-line bg-surface"
      style={noteSurfaceStyle(noteBackground)}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2/70 p-0.5">
          <TabButton active={tab === 'note'} onClick={() => setTab('note')} icon={<FileText className="size-3" />}>
            笔记
          </TabButton>
          <TabButton
            active={tab === 'annotations'}
            onClick={() => setTab('annotations')}
            icon={<Highlighter className="size-3" />}
          >
            标注
          </TabButton>
          <TabButton active={tab === 'info'} onClick={() => setTab('info')} icon={<Info className="size-3" />}>
            详情
          </TabButton>
        </div>
        <div className="flex-1" />
        {paper ? (
          <IconButton
            label="独立打开笔记"
            size="xs"
            onClick={() => openNote({ kind: 'paper', dir: paper.dir })}
          >
            <Maximize2 className="size-3" />
          </IconButton>
        ) : null}
        {paper ? (
          <span className="truncate text-[10px] text-ink-3" title={paper.dir}>
            {paper.dir}
          </span>
        ) : null}
        {/* 截图入口（另一处在 PDF 标题栏）：截完直接插到这篇笔记的光标处 */}
        {paper ? (
          <IconButton
            label="截图插入笔记 · Shift+X"
            size="xs"
            onClick={() => window.dispatchEvent(new Event('scholarbox:capture'))}
          >
            <Camera className="size-3" />
          </IconButton>
        ) : null}
        {/* 收起笔记栏：把中间的 PDF 让出来，右侧会浮出「笔记」按钮，一点就回来 */}
        <IconButton
          label="收起笔记栏 · Ctrl+Alt+B"
          size="xs"
          onClick={() => toggleNotes(false)}
        >
          <PanelRightClose className="size-3" />
        </IconButton>
      </div>

      {paper ? (
        tab === 'note' ? (
          <NoteEditor key={paper.dir} paper={paper} />
        ) : tab === 'annotations' ? (
          <AnnotationsTab paper={paper} />
        ) : (
          <PaperDetails key={paper.dir} paper={paper} />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            选中一篇文献后，这里会显示
            <br />
            <span className="font-mono text-[10.5px]">note.md</span> 与{' '}
            <span className="font-mono text-[10.5px]">meta.json</span>
          </p>
        </div>
      )}
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-2 py-[3px] text-[11px] transition-colors',
        active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-2 hover:text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
