import { useEffect, useMemo, useRef } from 'react'
import { Layers, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { FilterPopover } from './FilterPopover'
import { NotesLibrary } from '@/components/notes/NotesLibrary'
import { ItemRow } from './ItemRow'
import { SidebarHeader } from './SidebarHeader'
import { useLibraryStore, selectFacets } from '@/stores/library'
import { itemFromPaper } from '@/lib/library/item'
import { filterItems, groupByField, sortItems } from '@/lib/library/filter'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { PaperStatus } from '@/lib/vault/schema'

const STATUS_TABS: { value: 'all' | PaperStatus; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'todo', label: '待读' },
  { value: 'reading', label: '在读' },
  { value: 'done', label: '已读' },
]

const SORTS = [
  { value: 'recent', label: '最近阅读' },
  { value: 'added', label: '最近添加' },
  { value: 'title', label: '标题' },
  { value: 'importance', label: '重要性' },
  { value: 'progress', label: '阅读进度' },
] as const

export function LibraryPanel({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const papers = useLibraryStore((s) => s.papers)
  const filter = useLibraryStore((s) => s.filter)
  const setFilter = useLibraryStore((s) => s.setFilter)
  const resetFilter = useLibraryStore((s) => s.resetFilter)
  const selectedDir = useLibraryStore((s) => s.selectedDir)
  const select = useLibraryStore((s) => s.select)
  const togglePin = useLibraryStore((s) => s.togglePin)
  const loading = useLibraryStore((s) => s.loading)

  const sortBy = useSettingsStore((s) => s.sortBy)
  const setSettings = useSettingsStore((s) => s.set)
  const focusToken = useUiStore((s) => s.filterFocus)
  const sidebarTab = useUiStore((s) => s.sidebarTab)
  const grouped = useUiStore((s) => s.papersGrouped)
  const setGrouped = useUiStore((s) => s.setPapersGrouped)
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)
  // 笔记页签的数字 = 独立笔记 + 写了内容的文献笔记
  const standaloneCount = useStandaloneNotesStore((s) => s.notes.length)
  const noteCount = papers.filter((paper) => paper.note.trim().length > 0).length + standaloneCount

  const searchRef = useRef<HTMLInputElement>(null)

  // 文献库和笔记库共用同一份筛选/排序实现（见 lib/library/filter.ts）
  const items = useMemo(() => papers.map((paper) => itemFromPaper(paper, 'paper')), [papers])
  const filtered = useMemo(() => filterItems(items, filter), [items, filter])
  const facets = useMemo(() => selectFacets(papers), [papers])

  // 平铺列表里 pinned 不参与排序（没有「所属组」可比）；分组时每组内部置顶最前
  const sorted = useMemo(() => sortItems(filtered, sortBy, { pinnedFirst: false }), [filtered, sortBy])
  const groups = useMemo(() => groupByField(filtered, sortBy), [filtered, sortBy])
  const archivedCount = useMemo(() => papers.filter((p) => p.meta.status === 'archived').length, [papers])

  useEffect(() => {
    if (focusToken > 0) searchRef.current?.focus()
  }, [focusToken])

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

  const hasFilter =
    filter.query.trim().length > 0 ||
    filter.field !== null ||
    filter.tags.length > 0 ||
    filter.status !== 'all' ||
    filter.minImportance > 1 ||
    filter.recent !== 'all'

  return (
    <aside className="flex h-full flex-col overflow-hidden border-r border-line bg-surface-2/35">
      {hideHeader ? null : <SidebarHeader />}

      <div className="flex shrink-0 items-center gap-0.5 px-2.5 pb-1 pt-1.5">
        <div className="flex w-full items-center gap-0.5 rounded-lg bg-surface-3/60 p-0.5">
        {(
          [
            { value: 'library', label: '文献', count: papers.length },
            { value: 'notes', label: '笔记', count: noteCount },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setSidebarTab(tab.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-[5px] px-2 py-[3px] text-[11px] transition-colors',
              sidebarTab === tab.value
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-ink-3 hover:text-ink',
            )}
          >
            {tab.label}
            <span className="ml-1 text-[9.5px] text-ink-3 tabular-nums">{tab.count}</span>
          </button>
        ))}
        </div>
      </div>

      {sidebarTab === 'notes' ? (
        <NotesLibrary />
      ) : (
        <>
      {/* search */}
      <div className="px-2.5 pb-1 pt-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            ref={searchRef}
            value={filter.query}
            onChange={(event) => setFilter({ query: event.target.value })}
            placeholder="搜索标题、作者、期刊、标签"
            className="h-8 w-full rounded-lg border border-line bg-surface pl-7 pr-7 text-[11.5px] text-ink placeholder:text-ink-3/80 focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
          {filter.query ? (
            <button
              type="button"
              onClick={() => setFilter({ query: '' })}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label="清空搜索"
            >
              <X className="size-3" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-surface-2 px-1 text-[9px] text-ink-3">
              /
            </kbd>
          )}
        </div>
      </div>

      {/* status + sort */}
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-surface-3/60 p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter({ status: tab.value })}
              className={cn(
                'flex-1 rounded-[5px] px-1 py-[3px] text-[10.5px] transition-colors',
                filter.status === tab.value
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                  : 'text-ink-2 hover:text-ink',
              )}
            >
              {tab.label}
            </button>
          ))}
          {archivedCount > 0 ? (
            <button
              type="button"
              onClick={() => setFilter({ status: filter.status === 'archived' ? 'all' : 'archived' })}
              className={cn(
                'rounded-[5px] px-1 py-[3px] text-[10.5px] transition-colors',
                filter.status === 'archived' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
              )}
              title="归档"
            >
              归档
            </button>
          ) : null}
        </div>
      </div>

      {/* facets + sort */}
      <div className="flex items-center gap-1 px-2.5 pb-2">
        <div className="sb-scroll -mx-0.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-0.5">
          <FacetChip active={filter.field === null} onClick={() => setFilter({ field: null })}>
            全部领域
          </FacetChip>
          {facets.fields.slice(0, 8).map(([value, count]) => (
            <FacetChip
              key={value}
              active={filter.field === value}
              onClick={() => setFilter({ field: filter.field === value ? null : value })}
            >
              {value}
              <span className="ml-1 opacity-50">{count}</span>
            </FacetChip>
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
        <label
          className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
          title="排序"
        >
          <SlidersHorizontal className="size-3.5" />
          <select
            value={sortBy}
            onChange={(event) => setSettings({ sortBy: event.target.value as typeof sortBy })}
            className="absolute inset-0 cursor-pointer appearance-none opacity-0"
            aria-label="排序方式"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* list */}
      <div className="sb-scroll min-h-0 flex-1 overflow-y-auto border-t border-line/70">
        {loading && papers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[11.5px] text-ink-3">
            <Loader2 className="size-3.5 animate-spin" />
            正在读取文献库…
          </div>
        ) : sorted.length === 0 ? (
          <EmptyLibrary hasFilter={hasFilter} onReset={resetFilter} />
        ) : grouped ? (
          <div>
            {groups.map((group) => (
              <section key={group.key}>
                <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line/70 bg-surface-2/85 px-2.5 py-1 text-[10.5px] text-ink-3 backdrop-blur">
                  <span className="font-medium text-ink-2">{group.label}</span>
                  <span className="tabular-nums">{group.items.length} 篇</span>
                </div>
                {group.items.map((item) => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    selected={item.id === selectedDir}
                    onSelect={(next) => select(next.id)}
                    onTogglePin={(next) => void togglePin(next.id)}
                  />
                ))}
              </section>
            ))}
            <div className="h-4" />
          </div>
        ) : (
          <div>
            {sorted.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                selected={item.id === selectedDir}
                onSelect={(next) => select(next.id)}
                onTogglePin={(next) => void togglePin(next.id)}
              />
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-2.5 text-[10px] text-ink-3">
        <span className="tabular-nums">
          {sorted.length === papers.length
            ? `${papers.length} 篇文献`
            : `${sorted.length} / ${papers.length} 篇`}
        </span>
        <div className="flex items-center gap-2">
          {facets.tags.length > 0 ? <span>{facets.tags.length} 个标签</span> : null}
          {hasFilter ? (
            <button type="button" onClick={resetFilter} className="text-accent hover:underline">
              清除筛选
            </button>
          ) : null}
        </div>
      </div>
        </>
      )}
    </aside>
  )
}

function FacetChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-2 py-[3px] text-[10px] transition-colors',
        active
          ? 'border-accent/30 bg-accent-soft text-accent'
          : 'border-transparent bg-surface-2 text-ink-2 hover:border-line hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

function EmptyLibrary({ hasFilter, onReset }: { hasFilter: boolean; onReset: () => void }) {
  const openAddPaper = useUiStore((s) => s.openAddPaper)
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border border-dashed border-line bg-surface text-ink-3">
        <Search className="size-4" />
      </div>
      <p className="text-[12px] font-medium text-ink">
        {hasFilter ? '没有符合筛选条件的文献' : '文献库还是空的'}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-3">
        {hasFilter ? '换个关键词，或清除筛选条件' : '把 PDF 拖进窗口，或点击下方按钮添加'}
      </p>
      {hasFilter ? (
        <Button size="sm" className="mt-1" onClick={onReset}>
          清除筛选
        </Button>
      ) : (
        <Button size="sm" variant="primary" className="mt-1" onClick={openAddPaper}>
          添加文献
        </Button>
      )}
    </div>
  )
}
