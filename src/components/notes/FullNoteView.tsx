import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Columns2, FileText, Hash, Pin, PinOff, Search, Trash2, X } from 'lucide-react'
import { NoteSurface } from '@/components/notes/NoteSurface'
import { useOpenWikiTarget } from '@/hooks/useOpenWikiTarget'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Modal } from '@/components/ui/Modal'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useUiStore, type NoteTarget } from '@/stores/ui'
import { noteSurfaceStyle } from '@/lib/notes/appearance'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * 全屏笔记视图：文献笔记与独立笔记共用。
 *
 * 支持双栏对照（`noteTargetB` 非空时左右各一篇）——两栏都是同一个 `NoteSurface`，
 * 各自独立的光标、模式与草稿；选择第二篇时用标题栏的「双栏」按钮。
 */
export function FullNoteView() {
  const target = useUiStore((s) => s.noteTarget)
  const targetB = useUiStore((s) => s.noteTargetB)
  const closeNote = useUiStore((s) => s.closeNote)
  const markViewed = useLibraryStore((s) => s.markViewed)
  const touchViewed = useStandaloneNotesStore((s) => s.touchViewed)

  // 打开全屏笔记就是「看过一次」：文献笔记写 meta.json，独立笔记写 frontmatter
  useEffect(() => {
    if (!target) return
    if (target.kind === 'paper') void markViewed(target.dir)
    else touchViewed(target.file)
  }, [target, markViewed, touchViewed])
  useEffect(() => {
    if (!targetB) return
    if (targetB.kind === 'paper') void markViewed(targetB.dir)
    else touchViewed(targetB.file)
  }, [targetB, markViewed, touchViewed])

  if (!target) {
    return <EmptyNoteState onBack={closeNote} />
  }

  const split = Boolean(targetB)

  return (
    <div className="flex h-full min-h-0">
      <div
        className={cn(
          'flex min-w-0 flex-col bg-surface',
          split ? 'w-1/2 border-r border-line' : 'flex-1',
        )}
        style={noteSurfaceStyle(useSettingsStore.getState().editor.noteBackground)}
      >
        <NotePane target={target} onClose={closeNote} />
      </div>
      {split && targetB ? (
        <div
          className="flex min-w-0 w-1/2 flex-col bg-surface"
          style={noteSurfaceStyle(useSettingsStore.getState().editor.noteBackground)}
        >
          <NotePane target={targetB} onClose={() => useUiStore.getState().closeNoteB()} rightPane />
        </div>
      ) : null}
      <NotePickerDialog />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────── */

interface PaneRecord {
  isPaper: boolean
  paper: ReturnType<typeof useLibraryStore.getState>['papers'][number] | null
  standalone: ReturnType<typeof useStandaloneNotesStore.getState>['notes'][number] | null
}

function useNoteRecord(target: NoteTarget | null): PaneRecord {
  const papers = useLibraryStore((s) => s.papers)
  const notes = useStandaloneNotesStore((s) => s.notes)
  return useMemo(() => {
    if (!target) return { isPaper: false, paper: null, standalone: null }
    if (target.kind === 'paper') {
      return { isPaper: true, paper: papers.find((p) => p.dir === target.dir) ?? null, standalone: null }
    }
    return { isPaper: false, paper: null, standalone: notes.find((n) => n.file === target.file) ?? null }
  }, [target, papers, notes])
}

/**
 * 一栏笔记：标题栏（返回 / 重命名 / 置顶 / 删除 / 双栏开关）+ 编辑器本体。
 * 与右栏内嵌的是同一个 NoteSurface、同一份数据源。
 */
function NotePane({
  target,
  onClose,
  rightPane = false,
}: {
  target: NoteTarget
  /** rightPane 的「返回」只关这一栏；左栏的「返回」关掉整个笔记视图 */
  rightPane?: boolean
  onClose: () => void
}) {
  const openWikiTarget = useOpenWikiTarget()
  const setMainView = useUiStore((s) => s.setMainView)
  const noteTargetB = useUiStore((s) => s.noteTargetB)
  const openNotePicker = useUiStore((s) => s.openNotePicker)
  const closeNoteB = useUiStore((s) => s.closeNoteB)

  const saveNote = useLibraryStore((s) => s.saveNote)
  const select = useLibraryStore((s) => s.select)
  const saveStandalone = useStandaloneNotesStore((s) => s.save)
  const renameNote = useStandaloneNotesStore((s) => s.rename)
  const removeNote = useStandaloneNotesStore((s) => s.remove)
  const toggleNotePinned = useStandaloneNotesStore((s) => s.togglePinned)
  const updateMeta = useLibraryStore((s) => s.updateMeta)

  const { isPaper, paper, standalone } = useNoteRecord(target)

  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  useEffect(() => {
    setRenaming(false)
    setDraftTitle('')
  }, [target])

  const title = isPaper ? (paper?.meta.title ?? '文献笔记') : (standalone?.title ?? '未命名笔记')
  const key = target.kind === 'paper' ? `paper:${target.dir}` : `note:${target.file}`
  const initial = isPaper ? (paper?.note ?? '') : (standalone?.body ?? '')
  const label = target.kind === 'paper' ? 'note.md' : `notes/${target.file}`

  const commitRename = async () => {
    if (!standalone) return
    const next = draftTitle.trim()
    setRenaming(false)
    if (!next || next === standalone.title) return
    const renamed = await renameNote(standalone.file, next)
    if (!renamed) return
    // 重命名可能发生在任何一栏：对应栏的 target 要跟着换文件名
    const ui = useUiStore.getState()
    const current = ui.noteTarget
    if (current?.kind === 'standalone' && current.file === standalone.file) {
      ui.openNote({ kind: 'standalone', file: renamed.file })
    }
    if (ui.noteTargetB?.kind === 'standalone' && ui.noteTargetB.file === standalone.file) {
      ui.openNoteB({ kind: 'standalone', file: renamed.file })
    }
  }

  const remove = async () => {
    if (!standalone) return
    if (!window.confirm(`删除「${standalone.title}」？文件会从 notes/ 里移除。`)) return
    await removeNote(standalone.file)
    // 被删的是哪一栏就关哪一栏；单栏状态下等于关掉整个视图
    if (rightPane) closeNoteB()
    else onClose()
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <button
          type="button"
          onClick={onClose}
          title={rightPane ? '关闭这一栏' : '返回'}
          aria-label={rightPane ? '关闭这一栏' : '返回'}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
        >
          {rightPane ? <X className="size-4" /> : <ArrowLeft className="size-4" />}
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

        {/* 双栏开关：左栏是「打开右栏 / 收起右栏」，右栏显示为「换一篇」 */}
        {!rightPane ? (
          <IconButton
            label={noteTargetB ? '收起双栏对照' : '双栏对照：再打开一篇笔记'}
            size="sm"
            active={Boolean(noteTargetB)}
            onClick={() => {
              if (noteTargetB) closeNoteB()
              else openNotePicker('B')
            }}
          >
            <Columns2 className="size-3.5" />
          </IconButton>
        ) : (
          <IconButton label="换一篇笔记" size="sm" onClick={() => openNotePicker('B')}>
            <Columns2 className="size-3.5" />
          </IconButton>
        )}

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
            paperDir={target.kind === 'paper' ? target.dir : ''}
            captureDir={target.kind === 'paper' ? target.dir : null}
            label={label}
            placeholder="# 新笔记\n\n从这里写起…"
            onOpenWiki={openWikiTarget}
            onSave={(text) => {
              if (target.kind === 'paper') return saveNote(target.dir, text)
              return saveStandalone(target.file, text).then(() => undefined)
            }}
          />
        )}
      </div>
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────── */

/**
 * 笔记选择弹窗：文献笔记 + 独立笔记，带搜索。
 * 为左栏挑（替换当前笔记）或为右栏挑（双栏对照）都走这一个。
 */
function NotePickerDialog() {
  const pickerFor = useUiStore((s) => s.notePickerFor)
  const close = useUiStore((s) => s.closeNotePicker)
  const openNote = useUiStore((s) => s.openNote)
  const openNoteB = useUiStore((s) => s.openNoteB)

  const papers = useLibraryStore((s) => s.papers)
  const notes = useStandaloneNotesStore((s) => s.notes)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (pickerFor) setQuery('')
  }, [pickerFor])

  const q = query.trim().toLowerCase()
  const matchedPapers = useMemo(
    () =>
      papers
        .filter((p) => !q || p.meta.title.toLowerCase().includes(q) || p.dir.toLowerCase().includes(q))
        .slice(0, 40),
    [papers, q],
  )
  const matchedNotes = useMemo(
    () =>
      notes
        .filter((n) => !q || n.title.toLowerCase().includes(q))
        .slice(0, 40),
    [notes, q],
  )

  const pick = (target: NoteTarget) => {
    if (pickerFor === 'B') openNoteB(target)
    else openNote(target)
  }

  return (
    <Modal
      open={pickerFor !== null}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <Columns2 className="size-3.5 text-accent" />
          {pickerFor === 'B' ? '在右栏打开…' : '打开笔记…'}
        </span>
      }
      description={
        pickerFor === 'B'
          ? '右栏与左栏互不干扰：各自独立的光标、模式与草稿，改动即时保存。'
          : undefined
      }
      className="max-w-lg"
    >
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2/50 px-2">
          <Search className="size-3 shrink-0 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </div>

        <div className="sb-scroll max-h-80 min-h-0 overflow-y-auto">
          {matchedPapers.length === 0 && matchedNotes.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-ink-3">没有匹配的笔记</p>
          ) : null}

          {matchedPapers.length > 0 ? (
            <div className="mb-1">
              <p className="px-1 py-1 text-[10px] font-medium text-ink-3">文献笔记</p>
              <ul className="overflow-hidden rounded-lg border border-line">
                {matchedPapers.map((paper, index) => (
                  <li key={paper.dir}>
                    <button
                      type="button"
                      onClick={() => pick({ kind: 'paper', dir: paper.dir })}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink',
                        index > 0 && 'border-t border-line/60',
                      )}
                    >
                      <BookOpen className="size-3 shrink-0 text-accent" />
                      <span className="truncate">{paper.meta.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {matchedNotes.length > 0 ? (
            <div>
              <p className="px-1 py-1 text-[10px] font-medium text-ink-3">独立笔记</p>
              <ul className="overflow-hidden rounded-lg border border-line">
                {matchedNotes.map((note, index) => (
                  <li key={note.file}>
                    <button
                      type="button"
                      onClick={() => pick({ kind: 'standalone', file: note.file })}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink',
                        index > 0 && 'border-t border-line/60',
                      )}
                    >
                      <FileText className="size-3 shrink-0 text-ink-3" />
                      <span className="truncate">{note.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
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
