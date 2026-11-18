import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Grid2x2,
  Layers,
  LayoutList,
  NotebookPen,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { useLibraryStore } from '@/stores/library'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import {
  itemFromNote,
  itemFromPaper,
  statusKindOf,
  statusLabel,
  type ItemStatus,
  type LibraryItem,
} from '@/lib/library/item'
import {
  ITEM_SORTS,
  filterItems,
  fieldFacets,
  groupByField,
  sortItems,
  tagFacets,
} from '@/lib/library/filter'
import { DIMENSION_LABELS, NOTE_DIMENSIONS, buildShelves } from '@/lib/shelf'
import { ShelfRow } from '@/components/shelf/ShelfRow'
import { LibraryTopBar } from '@/components/shelf/LibraryTopBar'
import { ShelfBoard, ShelfToolbar } from '@/components/shelf/ShelfToolbar'
import { ItemHoverCard } from '@/components/shelf/ItemHoverCard'
import { ShelfContextMenu } from '@/components/shelf/ShelfContextMenu'
import { ItemRow } from '@/components/library/ItemRow'
import { FilterPopover } from '@/components/library/FilterPopover'
import { NoteMetaDialog } from './NoteMetaDialog'
import { MetaDialog } from '@/components/shelf/PaperDialogs'
import { cn } from '@/lib/utils'

const DIMENSIONS = NOTE_DIMENSIONS

/**
 * 笔记库。
 *
 * 和文献库是同一套东西：同样的筛选器（`filterItems`）、同样的排序器（`sortItems`）、
 * 同样的书架（`buildShelves` + `ShelfRow`），差别只有「条目从哪来」——
 * 文献笔记从 `papers/<dir>/note.md`，独立笔记从 `notes/<file>.md`。
 *
 * 注意文献笔记的元数据不是副本：`itemFromPaper` 每次都现读 `meta.json`，
 * 所以在这里改星级/领域/状态，文献库里立刻就是同一个值。
 */
export function NotesLibrary({
  onClose,
  variant = 'panel',
}: {
  onClose?: () => void
  /** panel = 三栏侧栏里的紧凑面板；page = 独立主界面（复用同一套筛选/书架） */
  variant?: 'panel' | 'page'
}) {
  const papers = useLibraryStore((s) => s.papers)
  const updateMeta = useLibraryStore((s) => s.updateMeta)
  const select = useLibraryStore((s) => s.select)
  const notes = useStandaloneNotesStore((s) => s.notes)
  const createNote = useStandaloneNotesStore((s) => s.create)
  const removeNote = useStandaloneNotesStore((s) => s.remove)
  const togglePinned = useStandaloneNotesStore((s) => s.togglePinned)
  const setNoteStatus = useStandaloneNotesStore((s) => s.setStatus)

  const filter = useUiStore((s) => s.notesFilter)
  const setFilter = useUiStore((s) => s.setNotesFilter)
  const resetFilter = useUiStore((s) => s.resetNotesFilter)
  const sort = useUiStore((s) => s.notesSort)
  const setSort = useUiStore((s) => s.setNotesSort)
  const mode = useUiStore((s) => s.notesMode)
  const setMode = useUiStore((s) => s.setNotesMode)
  const dimension = useUiStore((s) => s.notesDimension)
  const setDimension = useUiStore((s) => s.setNotesDimension)
  const homeMode = useUiStore((s) => s.homeNotesMode)
  const grouped = useUiStore((s) => s.notesGrouped)
  const setGrouped = useUiStore((s) => s.setNotesGrouped)
  const setHomeMode = useUiStore((s) => s.setHomeNotesMode)
  const section = useSettingsStore((s) => s.homeSection)
  const setHomeSection = useSettingsStore((s) => s.setHomeSection)
  const openSettings = useUiStore((s) => s.openSettings)
  const openNote = useUiStore((s) => s.openNote)
  const setMainView = useUiStore((s) => s.setMainView)

  const [collapsed, setCollapsed] = useState<string[]>([])
  const [hover, setHover] = useState<{ item: LibraryItem; rect: DOMRect } | null>(null)
  const [menu, setMenu] = useState<{ item: LibraryItem; at: { x: number; y: number } } | null>(null)
  const [metaFile, setMetaFile] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 文献笔记：只收「写了内容」的那些，空模板不算笔记
  const items = useMemo<LibraryItem[]>(() => {
    const paperNotes = papers
      .filter((paper) => paper.note.trim().length > 0)
      .map((paper) => itemFromPaper(paper, 'note'))
    return [...paperNotes, ...notes.map(itemFromNote)]
  }, [papers, notes])

  const matched = useMemo(() => filterItems(items, filter), [items, filter])
  // 平铺列表不看置顶；分组/书架时组内才让置顶靠前
  const filtered = useMemo(() => sortItems(matched, sort, { pinnedFirst: false }), [matched, sort])
  const groups = useMemo(() => groupByField(matched, sort), [matched, sort])
  const shelves = useMemo(() => buildShelves(matched, dimension, sort), [matched, dimension, sort])
  const facets = useMemo(() => ({ fields: fieldFacets(items), tags: tagFacets(items) }), [items])

  // 状态页签：文献笔记用阅读状态，独立笔记用草稿/在写/归档，两类并存时都列出来
  const statusTabs = useMemo(() => {
    const seen = new Map<ItemStatus, { label: string; count: number }>()
    for (const item of items) {
      if (item.status === 'archived') continue
      const current = seen.get(item.status)
      if (current) current.count += 1
      else seen.set(item.status, { label: statusLabel(statusKindOf(item), item.status), count: 1 })
    }
    return [...seen.entries()]
  }, [items])

  const hasFilter =
    filter.query.trim().length > 0 ||
    filter.field !== null ||
    filter.tags.length > 0 ||
    filter.minImportance > 1 ||
    filter.status !== 'all'

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

  const togglePin = (item: LibraryItem) => {
    if (item.paper) void useLibraryStore.getState().togglePin(item.paper.dir)
    else if (item.file) void togglePinned(item.file)
  }

  const open = (item: LibraryItem) => {
    if (item.paper) {
      openNote({ kind: 'paper', dir: item.paper.dir })
    } else if (item.file) {
      useStandaloneNotesStore.getState().touchViewed(item.file)
      openNote({ kind: 'standalone', file: item.file })
    }
  }

  const create = async () => {
    const note = await createNote()
    if (note) openNote({ kind: 'standalone', file: note.file })
  }

  const setStatus = (item: LibraryItem, status: ItemStatus) => {
    if (item.paper) void updateMeta(item.paper.dir, { status: status as never })
    else if (item.file) void setNoteStatus(item.file, status as never)
  }

  const remove = (item: LibraryItem) => {
    if (!item.file) return
    if (window.confirm(`删除笔记「${item.title}」？文件会从 notes/ 里移除。`)) {
      void removeNote(item.file)
    }
  }

  const toggleShelf = (key: string) => {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  const statusTabsNode = (
    <div className="sb-scroll flex items-center gap-1 overflow-x-auto pb-0.5">
      <StatusTab
        active={filter.status === 'all'}
        label="全部"
        count={items.filter((item) => item.status !== 'archived').length}
        onClick={() => setFilter({ status: 'all' })}
      />
      {statusTabs.map(([status, meta]) => (
        <StatusTab
          key={status}
          active={filter.status === status}
          label={meta.label}
          count={meta.count}
          onClick={() => setFilter({ status })}
        />
      ))}
    </div>
  )

  const facetNode = (
    <div className="flex items-center gap-1">
      <div className="sb-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
        <FacetChip active={filter.field === null} label="全部领域" onClick={() => setFilter({ field: null })} />
        {facets.fields.slice(0, 8).map(([field, count]) => (
          <FacetChip
            key={field}
            active={filter.field === field}
            label={field}
            count={count}
            onClick={() => setFilter({ field: filter.field === field ? null : field })}
          />
        ))}
      </div>
      <FilterPopover
        minImportance={filter.minImportance}
        tags={filter.tags}
        recent={filter.recent}
        facets={facets.tags}
        onChange={(patch) => setFilter(patch)}
        onReset={resetFilter}
      />
      <button
        type="button"
        onClick={() => setGrouped(!grouped)}
        title={grouped ? '取消分组' : '按分类分组'}
        aria-label={grouped ? '取消分组' : '按分类分组'}
        aria-pressed={grouped}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
          grouped ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
        )}
      >
        <Layers className="size-3.5" />
      </button>
      <SortButton sort={sort} setSort={setSort} />
    </div>
  )

  const dimensionNode = (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-ink-3">分架</span>
      {DIMENSIONS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => setDimension(value)}
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors',
            dimension === value ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
          )}
        >
          {DIMENSION_LABELS[value]}
        </button>
      ))}
      <span className="ml-auto flex items-center gap-0.5 text-ink-3">
        <button
          type="button"
          title="全部展开"
          aria-label="全部展开"
          onClick={() => setCollapsed([])}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink"
        >
          <ChevronsUpDown className="size-3.5" />
        </button>
        <button
          type="button"
          title="全部收起"
          aria-label="全部收起"
          onClick={() => setCollapsed(shelves.map((shelf) => shelf.key))}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-surface-2 hover:text-ink"
        >
          <ChevronsDownUp className="size-3.5" />
        </button>
      </span>
    </div>
  )

  const emptyNode = (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <NotebookPen className="size-6 text-ink-3/60" />
      <p className="text-[11.5px] text-ink-2">
        {items.length === 0 ? '还没有任何笔记' : '没有符合条件的笔记'}
      </p>
      {hasFilter ? (
        <button type="button" onClick={resetFilter} className="text-[11px] text-accent hover:underline">
          清除筛选
        </button>
      ) : (
        <button type="button" onClick={() => void create()} className="text-[11px] text-accent hover:underline">
          新建第一篇笔记
        </button>
      )}
    </div>
  )

  const shelfNode = (
    <div className="flex flex-col gap-5 px-2 py-2">
      {shelves.map((shelf) => (
        <ShelfRow
          key={shelf.key}
          group={shelf}
          collapsed={collapsed.includes(shelf.key)}
          onToggle={toggleShelf}
          selectedKey={null}
          onOpen={open}
          onHover={(item, rect) => setHover(item && rect ? { item, rect } : null)}
          onContextMenu={(item, at) => setMenu({ item, at })}
          onTogglePin={togglePin}
          unit="篇"
        />
      ))}
    </div>
  )

  const rowOf = (item: LibraryItem) => (
    <ItemRow
      key={item.key}
      item={item}
      selected={false}
      onSelect={() => open(item)}
      onTogglePin={togglePin}
      onOpenNote={() => {
        open(item)
        setMainView('note')
      }}
    />
  )

  const listNode = grouped ? (
    <div>
      {groups.map((group) => (
        <section key={group.key}>
          <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line/70 bg-surface-2/85 px-2.5 py-1 text-[10.5px] text-ink-3 backdrop-blur">
            <span className="font-medium text-ink-2">{group.label}</span>
            <span className="tabular-nums">{group.items.length} 篇</span>
          </div>
          {group.items.map(rowOf)}
        </section>
      ))}
    </div>
  ) : (
    <div className="divide-y divide-line/60">
      {filtered.map((item) => (
        <ItemRow
          key={item.key}
          item={item}
          selected={false}
          onSelect={() => open(item)}
          onTogglePin={togglePin}
          onOpenNote={() => {
            open(item)
            setMainView('note')
          }}
        />
      ))}
    </div>
  )

  const overlay = (
    <>
      {hover ? <ItemHoverCard item={hover.item} rect={hover.rect} /> : null}

      {menu ? (
        // 文献笔记的置顶写的是所属文献的 meta.json，独立笔记写自己的 frontmatter ——
        // 两种情况都该能置顶，所以 onTogglePin 不设条件；删除只对独立笔记开放。
        <ShelfContextMenu
          item={menu.item}
          at={menu.at}
          onClose={() => setMenu(null)}
          onOpen={(item) => {
            open(item)
            setMainView('note')
          }}
          onEditMeta={(item) => {
            if (item.paper) {
              select(item.paper.dir)
              setMainView('workspace')
              useUiStore.getState().openMetaDialog(item.paper.dir)
            } else if (item.file) {
              setMetaFile(item.file)
            }
          }}
          onSetStatus={setStatus}
          onTogglePin={togglePin}
          onDelete={menu.item.file ? remove : undefined}
        />
      ) : null}

      <NoteMetaDialog file={metaFile} onClose={() => setMetaFile(null)} />
      <MetaDialog />
    </>
  )

  // 主界面：和文献书库共用 LibraryTopBar / ShelfToolbar / ShelfBoard
  if (variant === 'page') {
    return (
      <div className="flex h-full flex-col bg-canvas">
        <LibraryTopBar
          icon={<NotebookPen className="size-4" strokeWidth={2} />}
          subtitle={`笔记 · ${items.length} 篇`}
          search={filter.query}
          onSearch={(query) => setFilter({ query })}
          searchPlaceholder="搜索笔记标题或正文"
          searchRef={searchRef}
          mode={homeMode}
          onMode={setHomeMode}
          section={section}
          onSection={setHomeSection}
          actions={
            <>
              <button
                type="button"
                onClick={() => void create()}
                title="新建笔记"
                aria-label="新建笔记"
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
              dimensions={DIMENSIONS}
              dimension={dimension}
              onDimension={setDimension}
              summary={`${shelves.length} 层 · ${filtered.length} 篇`}
              hasFilter={hasFilter}
              onResetFilter={resetFilter}
              collapsible={shelves.length > 0}
              allCollapsed={shelves.length > 0 && shelves.every((shelf) => collapsed.includes(shelf.key))}
              onToggleAll={() =>
                setCollapsed(
                  shelves.length > 0 && shelves.every((shelf) => collapsed.includes(shelf.key))
                    ? []
                    : shelves.map((shelf) => shelf.key),
                )
              }
            />
            <ShelfBoard showEmpty={shelves.length === 0} empty={emptyNode}>
              {shelves.map((shelf) => (
                <ShelfRow
                  key={shelf.key}
                  group={shelf}
                  collapsed={collapsed.includes(shelf.key)}
                  onToggle={toggleShelf}
                  selectedKey={null}
                  onOpen={open}
                  onHover={(item, rect) => setHover(item && rect ? { item, rect } : null)}
                  onContextMenu={(item, at) => setMenu({ item, at })}
                  onTogglePin={togglePin}
                  unit="篇"
                />
              ))}
            </ShelfBoard>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-1.5 border-b border-line bg-surface/50 px-4 py-2">
              {statusTabsNode}
              {facetNode}
            </div>
            <div className="sb-scroll min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? emptyNode : listNode}
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-1 text-[10px] text-ink-3">
              <span>
                {filtered.length} / {items.length} 篇
              </span>
              {hasFilter ? (
                <button type="button" onClick={resetFilter} className="hover:text-ink">
                  清除筛选
                </button>
              ) : (
                <span>{facets.tags.length} 个标签</span>
              )}
            </div>
          </div>
        )}

        {overlay}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5">
        <span className="text-[11.5px] font-medium text-ink">笔记库</span>
        <span className="text-[10px] tabular-nums text-ink-3">
          {filtered.length} / {items.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title={mode === 'shelf' ? '列表视图' : '书架视图'}
            aria-label={mode === 'shelf' ? '列表视图' : '书架视图'}
            onClick={() => setMode(mode === 'shelf' ? 'list' : 'shelf')}
            className="inline-flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {mode === 'shelf' ? <LayoutList className="size-3.5" /> : <Grid2x2 className="size-3.5" />}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭笔记库"
              className="inline-flex size-6 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5 px-2.5 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            ref={searchRef}
            value={filter.query}
            onChange={(event) => setFilter({ query: event.target.value })}
            placeholder="搜索笔记标题或正文"
            className="sb-input h-7 pl-7 text-[11.5px]"
          />
        </div>

        <button
          type="button"
          onClick={() => void create()}
          className="sb-btn sb-btn-primary h-7 w-full justify-center text-[11.5px]"
        >
          <Plus className="size-3.5" />
          新建笔记
        </button>

        {statusTabsNode}
        {facetNode}
        {mode === 'shelf' ? dimensionNode : null}
      </div>

      <div className="sb-scroll min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? emptyNode : mode === 'shelf' ? shelfNode : listNode}
      </div>

      <div className="flex items-center justify-between border-t border-line px-2.5 py-1 text-[10px] text-ink-3">
        <span>
          {filtered.length} / {items.length} 篇
        </span>
        {hasFilter ? (
          <button type="button" onClick={resetFilter} className="hover:text-ink">
            清除筛选
          </button>
        ) : (
          <span>{facets.tags.length} 个标签</span>
        )}
      </div>

      {overlay}
    </div>
  )
}

/** 排序按钮：图标 + 覆盖在上的透明 select（和侧栏里的写法一致） */
function SortButton({
  sort,
  setSort,
}: {
  sort: string
  setSort: (value: never) => void
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        title="排序"
        aria-label="排序"
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <NotebookPen className="size-3.5" />
      </button>
      <select
        value={sort}
        onChange={(event) => setSort(event.target.value as never)}
        aria-label="排序方式"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {ITEM_SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function StatusTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors',
        active ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
      )}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  )
}

function FacetChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors',
        active
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-2 hover:border-accent/30 hover:text-ink',
      )}
    >
      {label}
      {count !== undefined ? <span className="opacity-50">{count}</span> : null}
    </button>
  )
}
