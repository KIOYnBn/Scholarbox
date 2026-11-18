import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, FileText, Hash, Pin, PinOff, Trash2 } from 'lucide-react'
import { NoteSurface } from '@/components/notes/NoteSurface'
import { useOpenWikiTarget } from '@/hooks/useOpenWikiTarget'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useUiStore } from '@/stores/ui'
import { noteSurfaceStyle } from '@/lib/notes/appearance'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * 全屏笔记视图：文献笔记与独立笔记共用。
 * 编辑器本体是 `NoteSurface` —— 与右栏内嵌的是同一个组件、同一份数据源，
 * 这里只补一层「标题栏 + 元信息」。
 */
export function FullNoteView() {
  const target = useUiStore((s) => s.noteTarget)
  const openWikiTarget = useOpenWikiTarget()
  const closeNote = useUiStore((s) => s.closeNote)
  const setMainView = useUiStore((s) => s.setMainView)
  const notePrefs = useSettingsStore((s) => s.editor)

  const papers = useLibraryStore((s) => s.papers)
  const saveNote = useLibraryStore((s) => s.saveNote)
  const select = useLibraryStore((s) => s.select)

  const notes = useStandaloneNotesStore((s) => s.notes)
  const saveStandalone = useStandaloneNotesStore((s) => s.save)
  const renameNote = useStandaloneNotesStore((s) => s.rename)
  const removeNote = useStandaloneNotesStore((s) => s.remove)
  const toggleNotePinned = useStandaloneNotesStore((s) => s.togglePinned)
  const touchViewed = useStandaloneNotesStore((s) => s.touchViewed)
  const updateMeta = useLibraryStore((s) => s.updateMeta)
  const markViewed = useLibraryStore((s) => s.markViewed)

  const paper = useMemo(
    () => (target?.kind === 'paper' ? papers.find((item) => item.dir === target.dir) ?? null : null),
    [papers, target],
  )
  const standalone = useMemo(
    () => (target?.kind === 'standalone' ? notes.find((item) => item.file === target.file) ?? null : null),
    [notes, target],
  )

  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  useEffect(() => {
    setRenaming(false)
    setDraftTitle('')
  }, [target])

  // 打开全屏笔记就是「看过一次」：文献笔记写 meta.json，独立笔记写 frontmatter
  useEffect(() => {
    if (!target) return
    if (target.kind === 'paper') void markViewed(target.dir)
    else touchViewed(target.file)
  }, [target, markViewed, touchViewed])

  if (!target) {
    return <EmptyNoteState onBack={closeNote} />
  }

  const isPaper = target.kind === 'paper'
  const title = isPaper ? (paper?.meta.title ?? '文献笔记') : (standalone?.title ?? '未命名笔记')
  const key = isPaper ? `paper:${target.dir}` : `note:${target.file}`
  const initial = isPaper ? (paper?.note ?? '') : (standalone?.body ?? '')
  const label = isPaper ? 'note.md' : `notes/${target.file}`

  const commitRename = async () => {
    if (!standalone) return
    const next = draftTitle.trim()
    setRenaming(false)
    if (!next || next === standalone.title) return
    const renamed = await renameNote(standalone.file, next)
    if (renamed) useUiStore.getState().openNote({ kind: 'standalone', file: renamed.file })
  }

  const remove = async () => {
    if (!standalone) return
    if (!window.confirm(`删除「${standalone.title}」？文件会从 notes/ 里移除。`)) return
    await removeNote(standalone.file)
    closeNote()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" style={noteSurfaceStyle(notePrefs.noteBackground)}>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <button
          type="button"
          onClick={closeNote}
          title="返回"
          aria-label="返回"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" />
        </button>

        <span
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
            isPaper ? 'bg-accent-soft text-accent' : 'bg-surface-3/70 text-ink-2',
          )}
        >
          {isPaper ? <BookOpen className="size-4" /> : <FileText className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          {renaming && standalone ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitRename()
                if (event.key === 'Escape') {
                  setRenaming(false)
                  setDraftTitle('')
                }
              }}
              className="h-6 w-full max-w-md rounded-md border border-accent/40 bg-surface px-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!standalone) return
                setDraftTitle(standalone.title)
                setRenaming(true)
              }}
              disabled={!standalone}
              title={standalone ? '点击重命名' : undefined}
              className={cn(
                'block max-w-full truncate text-left text-[13px] font-semibold leading-tight tracking-tight text-ink',
                standalone && 'hover:text-accent',
              )}
            >
              {title}
            </button>
          )}

          <div className="flex items-center gap-2 text-[10px] leading-tight text-ink-3">
            <span>{isPaper ? '文献笔记' : '独立笔记'}</span>
            {isPaper && paper ? (
              <>
                <span>·</span>
                <span className="truncate">
                  {paper.meta.venue || '未填期刊'} · {paper.meta.year ?? '——'}
                </span>
              </>
            ) : null}
            {standalone ? (
              <>
                <span>·</span>
                <span className="truncate font-mono">{label}</span>
                {standalone.updatedAt ? (
                  <>
                    <span>·</span>
                    <span>更新于 {formatRelative(standalone.updatedAt)}</span>
                  </>
                ) : null}
              </>
            ) : null}
            {standalone && standalone.tags.length > 0 ? (
              <span className="flex items-center gap-1 truncate">
                <Hash className="size-2.5" />
                {standalone.tags.join(' · ')}
              </span>
            ) : null}
          </div>
        </div>

        {isPaper && paper ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              select(paper.dir)
              setMainView('workspace')
            }}
          >
            在阅读器中打开
          </Button>
        ) : null}

        {/* 置顶：文献笔记写 meta.json，独立笔记写 frontmatter，都是元数据 */}
        {isPaper && paper ? (
          <IconButton
            label={paper.meta.pinned ? '取消置顶' : '置顶'}
            size="sm"
            active={paper.meta.pinned}
            onClick={() => void updateMeta(paper.dir, { pinned: !paper.meta.pinned })}
          >
            {paper.meta.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </IconButton>
        ) : null}
        {standalone ? (
          <IconButton
            label={standalone.pinned ? '取消置顶' : '置顶'}
            size="sm"
            active={standalone.pinned}
            onClick={() => void toggleNotePinned(standalone.file)}
          >
            {standalone.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </IconButton>
        ) : null}
        {standalone ? (
          <IconButton label="删除这篇笔记" size="sm" onClick={() => void remove()}>
            <Trash2 className="size-3.5" />
          </IconButton>
        ) : null}
      </header>

      {/* 版心宽度交给 NoteSurface（设置里的「行宽」），这里不再写死 max-w-4xl —— 
          单独打开笔记时那 4xl 会在两边留出大片空白 */}
      <div className="flex min-h-0 w-full flex-1 flex-col px-2">
        {isPaper && !paper ? (
          <p className="py-10 text-center text-[12px] text-ink-3">这篇文献已经不在库里了</p>
        ) : !isPaper && !standalone ? (
          <p className="py-10 text-center text-[12px] text-ink-3">这篇笔记已经被删除了</p>
        ) : (
          <NoteSurface
            noteKey={key}
            initial={initial}
            paperDir={isPaper ? target.dir : ''}
            captureDir={isPaper ? target.dir : null}
            label={label}
            placeholder="# 新笔记\n\n从这里写起…"
            onOpenWiki={openWikiTarget}
            onSave={(text) =>
              isPaper ? saveNote(target.dir, text) : saveStandalone(target.file, text).then(() => undefined)
            }
          />
        )}
      </div>
    </div>
  )
}

function EmptyNoteState({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas text-ink-3">
      <FileText className="size-8" />
      <p className="text-[12.5px]">没有打开任何笔记</p>
      <Button size="sm" onClick={onBack}>
        返回
      </Button>
    </div>
  )
}
