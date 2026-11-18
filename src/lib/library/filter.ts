import type { LibraryItem } from './item'
import { withinRecent, type RecentWindow } from './recency'

/**
 * 统一的筛选器。文献库与笔记库都走这一份：
 * 两个库如果各写一套「标签怎么算交集」，迟早会不一致。
 */

export interface ItemFilter {
  query: string
  field: string | null
  /** 多选，取交集（全部命中） */
  tags: string[]
  /** 重要性下限，1 表示不限 */
  minImportance: number
  /** 'all' 或某个状态值（含义随 itemType 变） */
  status: string
  /** 最近查看窗口：今天 / 7 天 / 30 天 / 全部 */
  recent: RecentWindow
}

export const EMPTY_ITEM_FILTER: ItemFilter = {
  query: '',
  field: null,
  tags: [],
  minImportance: 1,
  status: 'all',
  recent: 'all',
}

export function isEmptyFilter(filter: ItemFilter): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.field !== null ||
    filter.tags.length > 0 ||
    filter.status !== 'all' ||
    filter.minImportance > 1 ||
    filter.recent !== 'all'
  )
}

/** 搜索命中：标题、作者、期刊、领域、标签、正文预览 */
function matchesQuery(item: LibraryItem, needle: string): boolean {
  const haystack = [
    item.title,
    item.authors.join(' '),
    item.venue,
    item.field,
    item.tags.join(' '),
    item.excerpt,
    item.year ? String(item.year) : '',
  ]
    .join(' ')
    .toLowerCase()
  return needle.split(/\s+/).every((token) => haystack.includes(token))
}

export function matchesFilter(item: LibraryItem, filter: ItemFilter, now = Date.now()): boolean {
  const needle = filter.query.trim().toLowerCase()
  if (needle && !matchesQuery(item, needle)) return false

  if (filter.field !== null && item.field !== filter.field) return false

  if (filter.tags.length > 0 && !filter.tags.every((tag) => item.tags.includes(tag))) return false

  if (filter.minImportance > 1 && item.importance < filter.minImportance) return false

  if (filter.status !== 'all' && item.status !== filter.status) return false

  // 归档默认不出现：只有显式切到「归档」才显示
  if (filter.status === 'all' && item.status === 'archived') return false

  if (filter.recent !== 'all' && !withinRecent(item.lastViewedAt, filter.recent, now)) return false

  return true
}

export function filterItems(items: LibraryItem[], filter: ItemFilter, now = Date.now()): LibraryItem[] {
  return items.filter((item) => matchesFilter(item, filter, now))
}

/** 只看最近查看过的东西（书库首页「最近继续读」用的就是它） */
export function recentlyViewed(items: LibraryItem[], window: RecentWindow = 'month', limit = 12): LibraryItem[] {
  return items
    .filter((item) => withinRecent(item.lastViewedAt, window))
    .sort((a, b) => timeOf(b.lastViewedAt) - timeOf(a.lastViewedAt))
    .slice(0, limit)
}

/** 领域分面（数量倒序），空领域归到「未分类」 */
export function fieldFacets(items: LibraryItem[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = item.field || '未分类'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
}

/** 标签分面（数量倒序） */
export function tagFacets(items: LibraryItem[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
}

export type ItemSort = 'recent' | 'added' | 'updated' | 'title' | 'importance' | 'progress'

export const ITEM_SORTS: { value: ItemSort; label: string }[] = [
  { value: 'recent', label: '最近查看' },
  { value: 'updated', label: '最近修改' },
  { value: 'added', label: '最近添加' },
  { value: 'title', label: '标题' },
  { value: 'importance', label: '重要性' },
  { value: 'progress', label: '阅读进度' },
]

function timeOf(value: string | null | undefined): number {
  return value ? new Date(value).getTime() || 0 : 0
}

export interface CompareOptions {
  /**
   * 组内置顶：置顶项排在**所属分组**最前。
   * 书架每一层、列表的分组模式都用 true；非分组的平铺列表用 false ——
   * 平铺时没有「所属组」，置顶就不该再影响顺序。
   */
  pinnedFirst?: boolean
}

/**
 * 唯一的一条排序规则：先比 pinned（同组才有效），再比所选排序键。
 * 书架和列表都走这里，避免两套「谁在前」的定义打架。
 */
export function compareItems(a: LibraryItem, b: LibraryItem, sort: ItemSort, options: CompareOptions = {}): number {
  if (options.pinnedFirst !== false && a.pinned !== b.pinned) return a.pinned ? -1 : 1
  switch (sort) {
    case 'title':
      return a.title.localeCompare(b.title, 'zh')
    case 'importance':
      return b.importance - a.importance || a.title.localeCompare(b.title, 'zh')
    case 'progress':
      return b.progress - a.progress
    case 'added':
      return timeOf(b.createdAt) - timeOf(a.createdAt)
    case 'updated':
      return timeOf(b.updatedAt) - timeOf(a.updatedAt)
    case 'recent':
    default:
      return (
        timeOf(b.lastViewedAt ?? b.updatedAt ?? b.createdAt) -
          timeOf(a.lastViewedAt ?? a.updatedAt ?? a.createdAt) ||
        timeOf(b.updatedAt) - timeOf(a.updatedAt)
      )
  }
}

/** 排序数组版本；`pinnedFirst: false` 用于不分组的平铺列表 */
export function sortItems(items: LibraryItem[], sort: ItemSort, options: CompareOptions = {}): LibraryItem[] {
  return [...items].sort((a, b) => compareItems(a, b, sort, options))
}

export const NO_FIELD = '未分类'

export interface ItemFieldGroup {
  key: string
  label: string
  items: LibraryItem[]
}

/**
 * 列表视图的「按分类分组」：同一组内置顶最前，组间按条目数降序。
 * 和书架用的是同一个 `compareItems`，所以列表分组和书架分层的顺序完全一致。
 */
export function groupByField(items: LibraryItem[], sort: ItemSort): ItemFieldGroup[] {
  const buckets = new Map<string, LibraryItem[]>()
  for (const item of items) {
    const key = item.field?.trim() || NO_FIELD
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  const groups: ItemFieldGroup[] = []
  for (const [key, bucket] of buckets) {
    bucket.sort((a, b) => compareItems(a, b, sort))
    groups.push({ key, label: key, items: bucket })
  }
  return groups.sort(
    (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'zh-Hans-CN'),
  )
}
