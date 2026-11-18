import type { LibraryItem } from '@/lib/library/item'
import { compareItems, type ItemSort } from '@/lib/library/filter'
import {
  NOTE_STATUS_LABELS,
  NOTE_STATUS_ORDER,
  PAPER_STATUS_LABELS,
  PAPER_STATUS_ORDER,
  statusLabel,
} from '@/lib/library/item'

/**
 * 书架（书库 / 笔记库共用）的纯逻辑：分架分组 + 伪封面参数。
 *
 * 只吃 `LibraryItem`，所以文献和笔记走的是同一套分组规则 ——
 * 这也是「笔记库和文献库同级」最实在的落点：加一个分架维度只改这里。
 */

export type ShelfDimension = 'field' | 'status' | 'importance' | 'tag'

export type ShelfTone = 'teal' | 'sand' | 'plum' | 'moss' | 'slate' | 'clay' | 'ink' | 'amber'

export interface ShelfGroup {
  /** 原始分组键：领域名 / 状态值 / 星级 */
  key: string
  label: string
  tone: ShelfTone
  items: LibraryItem[]
}

/** 书脊高度统一，宽度随重要性微调 —— 越重要越「厚」 */
export const SPINE_HEIGHT = 168
export const SPINE_MIN_WIDTH = 84
export const SPINE_MAX_WIDTH = 120
const SPINE_STEP = 9

export const UNCATEGORIZED = '未分类'

/** 兼容旧引用：文献的阅读状态顺序 */
export const STATUS_ORDER = PAPER_STATUS_ORDER
export const STATUS_LABELS = PAPER_STATUS_LABELS

export const SHELF_TONES: ShelfTone[] = ['teal', 'sand', 'plum', 'moss', 'slate', 'clay', 'ink', 'amber']

export const DIMENSION_LABELS: Record<ShelfDimension, string> = {
  field: '领域',
  status: '状态',
  importance: '重要性',
  tag: '标签',
}

/** 笔记书架的默认分架维度；文献书架用领域 */
export const NOTE_DIMENSIONS: ShelfDimension[] = ['field', 'tag']
export const PAPER_DIMENSIONS: ShelfDimension[] = ['field', 'status', 'importance']

export const UNTAGGED = '无标签'

/**
 * 用字符串哈希挑主题色：同一个领域名永远同色，换台机器也一样，
 * 不需要在 meta.json 里存颜色。
 */
export function shelfTone(key: string): ShelfTone {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100_000
  }
  return SHELF_TONES[hash % SHELF_TONES.length] ?? 'teal'
}

/** 1–5 星映射到书脊宽度；越界与脏数据都夹到合法区间 */
export function spineWidth(importance: number): number {
  const stars = Number.isFinite(importance) ? Math.round(importance) : 3
  const clamped = Math.min(5, Math.max(1, stars))
  return SPINE_MIN_WIDTH + (clamped - 1) * SPINE_STEP
}

export function spineTitle(item: LibraryItem): string {
  return item.title?.trim() || (item.type === 'note' ? '未命名笔记' : '未命名文献')
}

/** 书脊上只放第一作者；多作者时加「等」省空间 */
export function spineAuthor(item: LibraryItem): string {
  const authors = item.paper ? item.paper.meta.authors : item.authors
  const first = authors?.[0]?.trim()
  if (!first) return item.type === 'note' ? '' : '佚名'
  return authors.length > 1 ? `${first} 等` : first
}

/**
 * 书脊副行：文献给第一作者，笔记给分类名。
 * 这里按 `type` 判而不是按「有没有 paper」——文献笔记也有 paper，
 * 但它出现在笔记书架上，副行要显示分类，不是作者。
 */
export function spineSubtitle(item: LibraryItem): string {
  if (item.type === 'paper') return spineAuthor(item)
  return item.field?.trim() || UNCATEGORIZED
}

export function spineYear(item: LibraryItem): string {
  if (item.year) return String(item.year)
  return item.type === 'note' ? '' : '——'
}

/** 书脊右下角显示「更新于」的短日期 */
export function spineDate(item: LibraryItem): string {
  const stamp = item.updatedAt ?? item.createdAt
  if (!stamp) return ''
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}/${day}`
}

function fieldOf(item: LibraryItem): string {
  const field = item.field?.trim()
  return field || UNCATEGORIZED
}

function statusRankKey(item: LibraryItem): number {
  const order = item.type === 'note' ? NOTE_STATUS_ORDER : PAPER_STATUS_ORDER
  const index = order.indexOf(item.status as never)
  return index === -1 ? order.length : index
}

function sortByCountThenLabel(a: ShelfGroup, b: ShelfGroup): number {
  if (b.items.length !== a.items.length) return b.items.length - a.items.length
  return a.label.localeCompare(b.label, 'zh-Hans-CN')
}

/**
 * 相邻两层撞色很刺眼（两个琥珀色书架挨着），所以顺序定下来之后做一次
 * 「邻居去重」：只往后顺延一位，保持可复现。
 */
function avoidAdjacentTones(groups: ShelfGroup[]): ShelfGroup[] {
  let previous: ShelfTone | null = null
  return groups.map((group) => {
    let tone = group.tone
    if (tone === previous) {
      const index = (SHELF_TONES.indexOf(tone) + 1) % SHELF_TONES.length
      tone = SHELF_TONES[index] ?? tone
    }
    previous = tone
    return { ...group, tone }
  })
}

/**
 * 分架。空分组直接丢掉（一层空书架没有信息量），
 * 传进来的 items 应当已经过筛选 —— 书架和列表共用同一份筛选状态。
 */
export function buildShelves(items: LibraryItem[], dimension: ShelfDimension, sort: ItemSort = 'recent'): ShelfGroup[] {
  if (items.length === 0) return []

  const buckets = new Map<string, LibraryItem[]>()

  for (const item of items) {
    // 标签分架：一篇笔记有多个标签就出现在多个架里（这是标签和领域的关键差别，
    // 领域是单值、标签是多值）。没有标签的归到「无标签」，不静默丢掉。
    const keys =
      dimension === 'tag'
        ? item.tags.length > 0
          ? item.tags
          : [UNTAGGED]
        : [
            dimension === 'field'
              ? fieldOf(item)
              : dimension === 'status'
                ? item.status
                : String(clampStars(item.importance)),
          ]
    for (const key of keys) {
      const bucket = buckets.get(key)
      if (bucket) bucket.push(item)
      else buckets.set(key, [item])
    }
  }

  const groups: ShelfGroup[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.length === 0) continue
    // 组内置顶：置顶只在「所属的那一层」最前，不再全局抢位置
    bucket.sort((a, b) => compareItems(a, b, sort))
    const type = bucket[0]!.type
    const label =
      dimension === 'field' || dimension === 'tag'
        ? key
        : dimension === 'status'
          ? statusLabel(type, key)
          : `${key} 星`
    groups.push({ key, label, tone: shelfTone(dimension === 'field' || dimension === 'tag' ? key : label), items: bucket })
  }

  if (dimension === 'status') {
    return avoidAdjacentTones(
      groups.sort((a, b) => statusRankKey(a.items[0]!) - statusRankKey(b.items[0]!)),
    )
  }

  if (dimension === 'importance') {
    // 重要的先看到：5 星在上，1 星沉底
    return avoidAdjacentTones(groups.sort((a, b) => Number(b.key) - Number(a.key)))
  }

  return avoidAdjacentTones(groups.sort(sortByCountThenLabel))
}

function clampStars(value: number): number {
  const stars = Number.isFinite(value) ? Math.round(value) : 3
  return Math.min(5, Math.max(1, stars))
}

export { NOTE_STATUS_LABELS }
