import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookMarked,
  BookOpen,
  Grid2x2,
  History,
  NotebookPen,
  Pin,
  Plus,
  Settings2,
} from 'lucide-react'
import { useLibraryStore, selectFilteredPapers } from '@/stores/library'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { buildShelves, PAPER_DIMENSIONS, type ShelfDimension } from '@/lib/shelf'
import { itemFromNote, itemFromPaper, type ItemStatus, type LibraryItem } from '@/lib/library/item'
import { recentlyViewed } from '@/lib/library/filter'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { formatRelative } from '@/lib/format'
import { ShelfRow } from './ShelfRow'
import { PaperPreview } from './PaperPreview'
import { ShelfContextMenu } from './ShelfContextMenu'
import { MetaDialog, StandaloneNoteDialog } from './PaperDialogs'
import { LibraryPanel } from '@/components/library/LibraryPanel'
import { LibraryTopBar } from './LibraryTopBar'
import { ShelfBoard, ShelfToolbar } from './ShelfToolbar'
import { ItemHoverCard } from './ItemHoverCard'
import { ProgressBar } from '@/components/ui/ProgressBar'

/** 文献书库主界面（启动默认页）。骨架与笔记书架共用 LibraryTopBar / ShelfToolbar / ShelfBoard。 */
export function LibraryHome() {
  const papers = useLibraryStore((s) => s.papers)
  const filter = useLibraryStore((s) => s.filter)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const resetFilter = useLibraryStore((s) => s.resetFilter)
  const select = useLibraryStore((s) => s.select)
  const selectedDir = useLibraryStore((s) => s.selectedDir)
  const updateMeta = useLibraryStore((s) => s.updateMeta)
  const removePaper = useLibraryStore((s) => s.deletePaper)
  const loading = useLibraryStore((s) => s.loading)

  const homeMode = useUiStore((s) => s.homeMode)
  const setHomeMode = useUiStore((s) => s.setHomeMode)
  const dimension = useUiStore((s) => s.shelfDimension)
  const sortBy = useSettingsStore((s) => s.sortBy)
  const setDimension = useUiStore((s) => s.setShelfDimension)
  const shelfZoom = useUiStore((s) => s.shelfZoom)
  const setShelfZoom = useUiStore((s) => s.setShelfZoom)
  const pinnedShelves = useUiStore((s) => s.pinnedShelves)
  const toggleShelfPin = useUiStore((s) => s.toggleShelfPin)
  const setMainView = useUiStore((s) => s.setMainView)
  const openNoteDialog = useUiStore((s) => s.openNoteDialog)
  const openMetaDialog = useUiStore((s) => s.openMetaDialog)
  const openAddPaper = useUiStore((s) => s.openAddPaper)
  const openSettings = useUiStore((s) => s.openSettings)

  const section = useSettingsStore((s) => s.homeSection)
  const setHomeSection = useSettingsStore((s) => s.setHomeSection)

  const [collapsed, setCollapsed] = useState<string[]>([])
  const [hover, setHover] = useState<{ item: LibraryItem; rect: DOMRect } | null>(null)
  const [menu, setMenu] = useState<{ item: LibraryItem; at: { x: number; y: number } } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 书架和列表共用同一份筛选结果：搜索、领域、星级、标签、状态全部生效
  const filtered = useMemo(() => selectFilteredPapers({ papers, filter }), [papers, filter])
  const items = useMemo(() => filtered.map((paper) => itemFromPaper(paper, 'paper')), [filtered])
  // 书架每层内部按当前排序键排，置顶只在所属层里靠前
  const builtShelves = useMemo(() => buildShelves(items, dimension, sortBy), [items, dimension, sortBy])
  // 用户置顶的层排在最前面（稳定排序：未置顶的保持原来的分架顺序）
  const shelves = useMemo(() => {
    if (pinnedShelves.length === 0) return builtShelves
    const rank = (key: string) => (pinnedShelves.includes(key) ? 0 : 1)
    return [...builtShelves].sort((a, b) => rank(a.key) - rank(b.key))
  }, [builtShelves, pinnedShelves])

  const hasFilter =
    filter.query.trim().length > 0 ||
    filter.field !== null ||
    filter.tags.length > 0 ||
    filter.status !== 'all' ||
    filter.minImportance > 1 ||
    filter.recent !== 'all'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (homeMode !== 'list') return
    if (!selectedDir && filtered.length > 0) select(filtered[0]!.dir)
  }, [homeMode, selectedDir, filtered, select])

  const openReader = (item: LibraryItem) => {
    if (!item.paper) return
    select(item.paper.dir)
    setMainView('workspace')
  }

  const togglePin = (item: LibraryItem) => {
    if (item.paper) void updateMeta(item.paper.dir, { pinned: !item.pinned })
  }

  const standaloneNotes = useStandaloneNotesStore((s) => s.notes)
  const continueReading = useMemo(() => {
    const paperItems = papers.map((paper) => itemFromPaper(paper, 'paper'))
    const noteItems = standaloneNotes.map(itemFromNote)
    return recentlyViewed([...paperItems, ...noteItems], 'month', 8)
  }, [papers, standaloneNotes])

  const openRecent = (item: LibraryItem) => {
    if (item.paper) {
      select(item.paper.dir)
      setMainView('workspace')
    } else if (item.file) {
      useUiStore.getState().openNote({ kind: 'standalone', file: item.file })
    }
  }

  const setStatus = (item: LibraryItem, status: ItemStatus) => {
    if (!item.paper) return
    void updateMeta(item.paper.dir, { status: status as never })
  }

  const remove = (item: LibraryItem) => {
    if (!item.paper) return
    if (window.confirm(`删除「${item.title}」？整个文件夹（PDF、笔记、图片）都会从磁盘移除。`)) {
      void removePaper(item.paper.dir)
    }
  }

  const openNoteFor = (item: LibraryItem) => {
    if (item.paper) openNoteDialog(item.paper.dir)
  }

  const editMetaFor = (item: LibraryItem) => {
    if (item.paper) openMetaDialog(item.paper.dir)
  }

  const toggleShelf = (key: string) => {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  const allCollapsed = shelves.length > 0 && shelves.every((shelf) => collapsed.includes(shelf.key))

  return (
    <div className="flex h-full flex-col bg-canvas">
      <LibraryTopBar
        icon={<BookMarked className="size-4" strokeWidth={2} />}
        subtitle={`书库 · ${papers.length} 篇`}
        search={filter.query}
        onSearch={(query) => setFilter({ query })}
        searchPlaceholder="搜索标题、作者、期刊、标签"
        searchRef={searchRef}
        mode={homeMode}
        onMode={setHomeMode}
        section={section}
        onSection={setHomeSection}
        actions={
          <>
            <button
              type="button"
              onClick={openAddPaper}
              title="添加文献"
              aria-label="添加文献"
              className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-white transition hover:bg-accent/90"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => openSettings()}
              title="设置"
              aria-label="设置"
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition hover:bg-surface-2 hover:text-ink"
            >
              <Settings2 className="size-4" />
            </button>
          </>
        }
      />

      {homeMode === 'shelf' ? (
        <>
          <ShelfToolbar
            dimensions={PAPER_DIMENSIONS}
            dimension={dimension}
            onDimension={(value: ShelfDimension) => setDimension(value)}
            summary={`${shelves.length} 层 · ${filtered.length} 篇`}
            hasFilter={hasFilter}
            onResetFilter={resetFilter}
            collapsible={shelves.length > 0}
            allCollapsed={allCollapsed}
            onToggleAll={() => setCollapsed(allCollapsed ? [] : shelves.map((shelf) => shelf.key))}
            zoom={shelfZoom}
            onZoomIn={() => setShelfZoom(shelfZoom + 0.1)}
            onZoomOut={() => setShelfZoom(shelfZoom - 0.1)}
            onZoomReset={() => setShelfZoom(1)}
          />

          <ShelfBoard
            showEmpty={shelves.length === 0}
            empty={
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <Grid2x2 className="size-6 text-ink-3/60" />
                <p className="text-[12px] text-ink-2">
                  {loading && papers.length === 0
                    ? '正在读取文献库…'
                    : hasFilter
                      ? '没有符合筛选条件的文献'
                      : '书架还是空的'}
                </p>
                {!loading ? (
                  <div className="mt-1 flex items-center gap-2">
                    {hasFilter ? (
                      <button type="button" onClick={resetFilter} className="text-[11px] text-accent hover:underline">
                        清除筛选
                      </button>
                    ) : (
                      <button type="button" onClick={openAddPaper} className="text-[11px] text-accent hover:underline">
                        添加第一篇文献
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            }
            highlight={
              continueReading.length > 0 ? (
                <section className="select-none">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <History className="size-3.5 text-ink-3" />
                    <h2 className="text-[12px] font-medium text-ink">最近继续读</h2>
                    <span className="text-[10.5px] text-ink-3">文献与笔记混排 · 按查看时间</span>
                  </div>
                  <div className="sb-scroll flex gap-2 overflow-x-auto px-1 pb-1">
                    {continueReading.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => openRecent(item)}
                        className="group flex w-56 shrink-0 flex-col gap-1 rounded-lg border border-line bg-surface p-2.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-2/40"
                      >
                        <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
                          {item.paper ? <BookOpen className="size-3" /> : <NotebookPen className="size-3" />}
                          {item.paper ? '文献' : '笔记'}
                          {item.pinned ? <Pin className="size-2.5 text-warn" /> : null}
                          <span className="ml-auto">{formatRelative(item.lastViewedAt)}</span>
                        </div>
                        <div className="line-clamp-2 font-serif text-[12px] leading-snug text-ink">
                          {item.title}
                        </div>
                        {item.progress > 0 ? (
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <ProgressBar value={item.progress} />
                            <span className="shrink-0 text-[9.5px] tabular-nums text-ink-3">{item.progress}%</span>
                          </div>
                        ) : (
                          <div className="truncate text-[10px] text-ink-3">
                            {item.paper
                              ? [item.venue, item.year].filter(Boolean).join(' · ')
                              : item.tags.slice(0, 3).join(' · ') || '独立笔记'}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null
            }
          >
            {shelves.map((shelf) => (
              <ShelfRow
                key={shelf.key}
                group={shelf}
                collapsed={collapsed.includes(shelf.key)}
                onToggle={toggleShelf}
                selectedKey={`paper:${selectedDir ?? ''}`}
                zoom={shelfZoom}
                pinned={pinnedShelves.includes(shelf.key)}
                onTogglePinShelf={toggleShelfPin}
                onOpen={openReader}
                onHover={(item, rect) => setHover(item && rect ? { item, rect } : null)}
                onContextMenu={(item, at) => setMenu({ item, at })}
                onTogglePin={(item) => void togglePin(item)}
                unit="篇"
              />
            ))}
          </ShelfBoard>
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-[360px] shrink-0 border-r border-line">
            <LibraryPanel hideHeader />
          </div>
          <div className="min-w-0 flex-1">
            <PaperPreview
              paper={papers.find((paper) => paper.dir === selectedDir) ?? null}
              onOpen={(dir) => {
                select(dir)
                setMainView('workspace')
              }}
              onOpenNote={openNoteDialog}
              onEditMeta={openMetaDialog}
            />
          </div>
        </div>
      )}

      {hover ? <ItemHoverCard item={hover.item} rect={hover.rect} /> : null}

      {menu ? (
        <ShelfContextMenu
          item={menu.item}
          at={menu.at}
          onClose={() => setMenu(null)}
          onOpen={openNoteFor}
          onEditMeta={editMetaFor}
          onSetStatus={setStatus}
          onTogglePin={togglePin}
          onDelete={remove}
        />
      ) : null}

      <StandaloneNoteDialog />
      <MetaDialog />
    </div>
  )
}
