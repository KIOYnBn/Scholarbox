import type { PaperRecord, PaperStatus } from '@/lib/vault/schema'
import type { StandaloneNote } from '@/lib/notes/repository'

/**
 * 统一条目模型。
 *
 * 文献和笔记在这层之后没有区别：筛选、排序、书架分组、列表行、右键菜单
 * 全部只认 `LibraryItem`。差异只体现在两个地方 ——
 *  `type`（决定状态枚举、能否删除/重命名）与 `paper` / `file`
 *  （决定「打开」时是进阅读器还是进全屏编辑器）。
 *
 * 关键约定：文献笔记（`papers/<目录>/<标题>.md`，meta.json 的 noteName 记录文件名，
 * 老库兼容 note.md）的元数据**不复制**，
 * 它的 field/tags/importance/status/progress 全部来自同目录 `meta.json`。
 * 所以 `itemFromPaper()` 永远是「现算」的 —— 改了 meta.json，
 * 文献列表和笔记库看到的是同一个值，不可能不同步。
 */

/** 文献笔记的仓库内路径：papers/<目录>/<标题>.md（老库回落 note.md） */
export function paperNoteFile(paper: PaperRecord): string {
  return `papers/${paper.dir}/${paper.meta.noteName?.trim() || 'note.md'}`
}

export type ItemType = 'paper' | 'note'

/** 独立笔记的状态枚举：和阅读状态完全分开 */
export type NoteStatus = 'draft' | 'active' | 'archived'

export type ItemStatus = PaperStatus | NoteStatus

/** 文献 / 文献笔记沿用阅读状态；独立笔记用自己的三态 */
export function statusOptionsFor(type: ItemType): ItemStatus[] {
  return type === 'note' ? [...NOTE_STATUS_ORDER] : [...PAPER_STATUS_ORDER]
}

export const PAPER_STATUS_ORDER: PaperStatus[] = ['reading', 'todo', 'done', 'archived']

export const NOTE_STATUS_ORDER: NoteStatus[] = ['active', 'draft', 'archived']

export const PAPER_STATUS_LABELS: Record<PaperStatus, string> = {
  reading: '在读',
  todo: '待读',
  done: '已读',
  archived: '归档',
}

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  active: '在写',
  draft: '草稿',
  archived: '归档',
}

/**
 * 状态枚举跟着「条目从哪来」，而不是跟着「它出现在哪个库」：
 * 文献笔记虽然列在笔记库里，它的状态仍然是阅读状态（存在 meta.json），
 * 独立笔记才用草稿/在写/归档。
 */
export type StatusKind = 'paper' | 'note'

export function statusKindOf(item: Pick<LibraryItem, 'paper'>): StatusKind {
  return item.paper ? 'paper' : 'note'
}

export function statusLabel(kind: StatusKind, status: string): string {
  if (kind === 'paper') return PAPER_STATUS_LABELS[status as PaperStatus] ?? status
  return NOTE_STATUS_LABELS[status as NoteStatus] ?? status
}

export function statusOrderFor(kind: StatusKind): ItemStatus[] {
  return kind === 'note' ? [...NOTE_STATUS_ORDER] : [...PAPER_STATUS_ORDER]
}

/** 兼容：按条目类型取状态枚举（独立笔记=note，其余=paper） */
export function statusOrderForType(type: ItemType): ItemStatus[] {
  return statusOrderFor(type === 'note' ? 'note' : 'paper')
}

export interface LibraryItem {
  /** 全局唯一：`paper:<dir>` / `note:<file>` */
  key: string
  type: ItemType
  /** 文献是目录名，独立笔记是文件名 */
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string
  impactFactor: number | null
  field: string
  tags: string[]
  importance: number
  status: ItemStatus
  /** 阅读进度 0–100（独立笔记恒为 0） */
  progress: number
  pinned: boolean
  createdAt: string | null
  updatedAt: string | null
  lastViewedAt: string | null
  /** 文献才有 */
  hasPdf: boolean
  pdfSize: number
  assetCount: number
  /** 正文预览（笔记行/搜素用） */
  excerpt: string
  /** 文献（文献笔记也带上，用于展示期刊/IF/打开阅读器） */
  paper: PaperRecord | null
  /** 独立笔记的文件名 */
  file: string | null
}

/**
 * 文献 → 条目。`type` 决定它出现在「文献库」还是「笔记库」，
 * 但元数据始终取自 `meta.json`。
 */
export function itemFromPaper(paper: PaperRecord, type: ItemType = 'paper'): LibraryItem {
  const { meta } = paper
  return {
    key: type === 'note' ? `note:paper:${paper.dir}` : `paper:${paper.dir}`,
    type,
    id: paper.dir,
    title: meta.title?.trim() || '未命名文献',
    authors: meta.authors ?? [],
    year: meta.year,
    venue: meta.venue,
    impactFactor: meta.impactFactor,
    field: meta.field?.trim() || '',
    tags: meta.tags ?? [],
    importance: meta.importance,
    status: meta.status,
    progress: meta.progress,
    pinned: meta.pinned === true,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    lastViewedAt: meta.lastViewedAt ?? meta.lastOpenedAt ?? null,
    hasPdf: paper.hasPdf,
    pdfSize: paper.pdfSize,
    assetCount: paper.assets.length,
    excerpt: headOfMarkdown(paper.note),
    paper,
    file: null,
  }
}

export function itemFromNote(note: StandaloneNote): LibraryItem {
  return {
    key: `note:${note.file}`,
    type: 'note',
    id: note.file,
    title: note.title?.trim() || '未命名笔记',
    authors: [],
    year: null,
    venue: '',
    impactFactor: null,
    field: note.field?.trim() || '',
    tags: note.tags ?? [],
    importance: note.importance,
    status: note.status,
    progress: 0,
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    lastViewedAt: note.lastViewedAt,
    hasPdf: false,
    pdfSize: 0,
    assetCount: 0,
    excerpt: headOfMarkdown(note.body),
    paper: null,
    file: note.file,
  }
}

/** 去掉 frontmatter / 一级标题后的前几十个字，做列表预览与搜索 */
export function headOfMarkdown(text: string, limit = 120): string {
  const cleaned = text
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/^#\s+.*$/m, '')
    .replace(/[#>*`_\[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, limit)
}

export function itemAuthorLine(item: LibraryItem): string {
  if (item.type === 'note') return item.paper ? item.paper.meta.authors.join(', ') : ''
  const { authors } = item
  if (authors.length === 0) return '未填写作者'
  if (authors.length > 2) return `${authors.slice(0, 2).join(', ')} 等`
  return authors.join(', ')
}
