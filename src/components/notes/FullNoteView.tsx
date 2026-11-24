import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Columns2, FileText, Hash, Link2, ListTree, Pin, PinOff, Search, Trash2, X } from 'lucide-react'
import { NoteSurface } from '@/components/notes/NoteSurface'
import type { MarkdownEditorHandle } from '@/components/notes/MarkdownEditor'
import { useOpenWikiTarget } from '@/hooks/useOpenWikiTarget'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Modal } from '@/components/ui/Modal'
import { useLibraryStore } from '@/stores/library'
import { paperNoteFile } from '@/lib/library/item'
import { useSettingsStore } from '@/stores/settings'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useUiStore, type NoteTarget } from '@/stores/ui'
import { noteSurfaceStyle } from '@/lib/notes/appearance'
import { extractOutline, type OutlineEntry } from '@/lib/notes/outline'
import { findBacklinks, type NoteDoc } from '@/lib/notes/links'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

type DrawerTab = 'outline' | 'backlinks'

/**
 * 全屏笔记视图：文献笔记与独立笔记共用。
 *
 * 支持双栏对照（`noteTargetB` 非空时左右各一篇）——两栏都是同一个 `NoteSurface`，
 * 各自独立的光标、模式与草稿；选择第二篇时用标题栏的「双栏」按钮。
 */
export function FullNoteView() {
  const target = useUiStore((s) => s.noteTarget)
  const targetB = useUiStore((s) => s.noteTargetB)
  const drawer = useUiStore((s) => s.noteDrawer)
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
  const [paneText, setPaneText] = useState<{ A: string; B: string }>({ A: '', B: '' })
  const handleA = useRef<MarkdownEditorHandle | null>(null)
  const handleB = useRef<MarkdownEditorHandle | null>(null)
  // 大纲跳转（模式感知）：阅读模式滚动渲染视图，编辑模式 revealLine
  const jumpA = useRef<((line: number) => void) | null>(null)
  const jumpB = useRef<((line: number) => void) | null>(null)

  return (
    <div className="flex h-full min-h-0">
      <div
        className={cn(
          'flex min-w-0 flex-col bg-surface',
          split ? 'w-1/2 border-r border-line' : 'flex-1',
        )}
        style={noteSurfaceStyle(useSettingsStore.getState().editor.noteBackground)}
      >
        <NotePane
          target={target}
          pane="A"
          onClose={closeNote}
          paneHandle={handleA}
          jumpRef={jumpA}
          onValueChange={(text) => setPaneText((current) => ({ ...current, A: text }))}
        />
      </div>
      {split && targetB ? (
        <div
          className="flex min-w-0 w-1/2 flex-col bg-surface"
          style={noteSurfaceStyle(useSettingsStore.getState().editor.noteBackground)}
        >
          <NotePane
            target={targetB}
            pane="B"
            rightPane
            onClose={() => useUiStore.getState().closeNoteB()}
            paneHandle={handleB}
            jumpRef={jumpB}
            onValueChange={(text) => setPaneText((current) => ({ ...current, B: text }))}
          />
        </div>
      ) : null}
      {drawer ? (
        <NoteDrawer
          pane={drawer.pane}
          tab={drawer.tab}
          target={drawer.pane === 'B' && targetB ? targetB : target}
          text={drawer.pane === 'B' ? paneText.B : paneText.A}
          jump={drawer.pane === 'B' ? jumpB : jumpA}
        />
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
 * 一栏笔记：标题栏（返回 / 重命名 / 置顶 / 删除 / 双栏开关 / 大纲 / 反链）+ 编辑器本体。
 * 与右栏内嵌的是同一个 NoteSurface、同一份数据源。
 */
function NotePane({
  target,
  pane,
  onClose,
  rightPane = false,
  paneHandle,
  jumpRef,
  onValueChange,
}: {
  target: NoteTarget
  pane: 'A' | 'B'
  /** rightPane 的「返回」只关这一栏；左栏的「返回」关掉整个笔记视图 */
  rightPane?: boolean
  onClose: () => void
  /** 编辑器句柄（外层持有，抽屉跳行用） */
  paneHandle: { current: MarkdownEditorHandle | null }
  /** 大纲跳转（模式感知） */
  jumpRef: { current: ((line: number) => void) | null }
  onValueChange?: (text: string) => void
}) {
  const openWikiTarget = useOpenWikiTarget()
  const setMainView = useUiStore((s) => s.setMainView)
  const noteTargetB = useUiStore((s) => s.noteTargetB)
  const openNotePicker = useUiStore((s) => s.openNotePicker)
  const closeNoteB = useUiStore((s) => s.closeNoteB)
  const noteDrawer = useUiStore((s) => s.noteDrawer)
  const toggleNoteDrawer = useUiStore((s) => s.toggleNoteDrawer)
  const drawerActive = noteDrawer && noteDrawer.pane === pane ? noteDrawer.tab : null

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

  // 初值也回传：大纲 / 反链面板不用等用户编辑一次才有数据
  useEffect(() => {
    onValueChange?.(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  // 块引用跳转：[[笔记#^id]] 打开后滚动定位到那一块
  useEffect(() => {
    if (!target.blockId) return
    const timer = setTimeout(() => paneHandle.current?.revealBlock(target.blockId!), 350)
    return () => clearTimeout(timer)
  }, [target])
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

        {/* 大纲 / 反链抽屉开关（Obsidian 右侧栏的那两个面板） */}
        <IconButton
          label="大纲"
          size="sm"
          active={drawerActive === 'outline'}
          onClick={() => toggleNoteDrawer(pane, 'outline')}
        >
          <ListTree className="size-3.5" />
        </IconButton>
        <IconButton
          label="反向链接"
          size="sm"
          active={drawerActive === 'backlinks'}
          onClick={() => toggleNoteDrawer(pane, 'backlinks')}
        >
          <Link2 className="size-3.5" />
        </IconButton>

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
            jumpRef={jumpRef}
            noteKey={key}
            initial={initial}
            paperDir={target.kind === 'paper' ? target.dir : ''}
            captureDir={target.kind === 'paper' ? target.dir : null}
            label={label}
            placeholder="# 新笔记\n\n从这里写起…"
            onOpenWiki={openWikiTarget}
            handleRef={paneHandle}
            onValueChange={(text) => {
              onValueChange?.(text)
            }}
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

/**
 * 笔记右侧抽屉：大纲（点击跳到对应标题行）与反向链接（谁链到了这篇笔记）。
 * Obsidian 右侧栏的那两个核心面板。
 */
function NoteDrawer({
  pane,
  tab,
  target,
  text,
  jump,
}: {
  pane: 'A' | 'B'
  tab: DrawerTab
  target: NoteTarget
  text: string
  /** 模式感知的跳转（阅读模式滚动渲染视图） */
  jump: { current: ((line: number) => void) | null }
}) {
  const closeNoteDrawer = useUiStore((s) => s.closeNoteDrawer)
  const toggleNoteDrawer = useUiStore((s) => s.toggleNoteDrawer)
  const papers = useLibraryStore((s) => s.papers)
  const notes = useStandaloneNotesStore((s) => s.notes)

  const docs = useMemo<NoteDoc[]>(
    () => [
      ...papers.map((item) => ({
        kind: 'paper' as const,
        file: paperNoteFile(item),
        title: item.meta.title,
        dir: item.dir,
        body: item.note ?? '',
      })),
      ...notes.map((item) => ({
        kind: 'standalone' as const,
        file: `notes/${item.file}`,
        title: item.title,
        body: item.body,
      })),
    ],
    [papers, notes],
  )

  const targetDoc = useMemo(() => {
    const papers = docs.filter((doc) => doc.kind === 'paper')
    const targetDoc =
      target.kind === 'paper'
        ? papers.find((doc) => doc.dir === target.dir)
        : docs.find((doc) => doc.file === `notes/${target.file}`)
    return targetDoc ?? null
  }, [docs, target])
  const outline = useMemo(() => extractOutline(text), [text])
  const backlinks = useMemo(
    () => (targetDoc ? findBacklinks(targetDoc, docs) : []),
    [docs, targetDoc],
  )

  const jumpToDoc = (doc: NoteDoc) => {
    const ui = useUiStore.getState()
    const next: NoteTarget =
      doc.kind === 'paper' ? { kind: 'paper', dir: doc.dir! } : { kind: 'standalone', file: doc.file.slice('notes/'.length) }
    if (pane === 'B') ui.openNoteB(next)
    else ui.openNote(next)
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
        {(
          [
            ['outline', ListTree, '大纲'],
            ['backlinks', Link2, '反链'],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => toggleNoteDrawer(pane, value)}
            aria-pressed={tab === value}
            className={cn(
              'flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium transition',
              tab === value ? 'bg-surface-2 text-accent' : 'text-ink-3 hover:text-ink',
            )}
          >
            <Icon className="size-3" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={closeNoteDrawer}
          aria-label="收起面板"
          className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="sb-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tab === 'outline' ? (
          outline.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-ink-3">还没有标题</p>
          ) : (
            <ul className="space-y-0.5">
              {outline.map((entry: OutlineEntry, index) => (
                <li key={`${entry.line}-${index}`}>
                  <button
                    type="button"
                    onClick={() => jump.current?.(entry.line)}
                    title={`跳到第 ${entry.line} 行`}
                    className="block w-full truncate rounded-md px-1.5 py-1 text-left text-[11.5px] text-ink-2 transition hover:bg-surface-2 hover:text-ink"
                    style={{ paddingLeft: `${(entry.level - 1) * 12 + 6}px` }}
                  >
                    <span className="mr-1 font-mono text-[9px] text-ink-3">H{entry.level}</span>
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : backlinks.length === 0 ? (
          <p className="px-1 py-3 text-[11px] text-ink-3">还没有笔记链接到这里</p>
        ) : (
          <ul className="space-y-1.5">
            {backlinks.map((entry, index) => (
              <li key={`${entry.source.file}-${entry.line}-${index}`}>
                <button
                  type="button"
                  onClick={() => jumpToDoc(entry.source)}
                  className="block w-full rounded-lg border border-line px-2 py-1.5 text-left transition hover:border-accent/40 hover:bg-surface-2/60"
                >
                  <span className="block truncate text-[11.5px] font-medium text-ink">
                    {entry.source.kind === 'paper' ? '📄 ' : '📝 '}
                    {entry.source.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-ink-3">{entry.excerpt || `第 ${entry.line} 行`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

    </aside>
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
