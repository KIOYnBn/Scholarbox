import { sanitizeSegment } from '@/lib/path'
import { normalizeAnnotations, normalizeStyles } from './annotations'

/** Bumped when the on-disk shape changes; readers are tolerant, writers are strict. */
export const META_VERSION = 1 as const

export type PaperStatus = 'todo' | 'reading' | 'done' | 'archived'

/* ── PDF 标注 ─────────────────────────────────────────────────────────── */

/** 文本类标注 + 框选。`note` 指「只有批注、没有可见标记」的挂点。 */
export type AnnotationKind = 'highlight' | 'underline' | 'strikethrough' | 'note' | 'rect'

/** 旧文件里叫 `strike`，读取时迁移（见 normalizeAnnotations） */
export type LegacyAnnotationKind = 'strike'

export interface HighlightStyle {
  /** 底色（十六进制，来自 AnnotationColor 或自定义） */
  color: string
  /** 0..1 */
  opacity: number
  /** 上下各外扩多少「行高的比例」，0 = 紧贴字形 */
  paddingY: number
}

export interface LineStyle {
  color: string
  opacity: number
  /** 线宽，px */
  width: number
  /** 0..1，沿盒高的位置：下划线默认贴底，删除线默认中线 */
  offset: number
}

export interface AnnotationStyles {
  highlight: HighlightStyle
  underline: LineStyle
  strikethrough: LineStyle
  note: LineStyle
}

/** 单条标注对某类样式的覆盖（只存改动过的键） */
export interface AnnotationStyleOverride {
  color?: string
  opacity?: number
  width?: number
  offset?: number
  paddingY?: number
}

export const ANNOTATION_STYLE_VERSION = 2

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

/** 归一化到页框的矩形：0..1，与缩放无关。 */
export interface AnnotationRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Annotation {
  id: string
  kind: AnnotationKind
  /** 1-based，和 PDF 页码一致 */
  page: number
  color: AnnotationColor
  /** 一行文本一个矩形；框选只有一条 */
  rects: AnnotationRect[]
  /** 选中的原文，框选时为空 */
  text: string
  /** 自己写的批注 */
  note: string
  createdAt: string
  /** 单条覆盖：颜色 / 透明度 / 线宽 / 偏移 / 高亮 padding */
  style?: AnnotationStyleOverride
}

export interface PaperMeta {
  version: typeof META_VERSION
  id: string
  title: string
  authors: string[]
  year: number | null
  /** journal / conference */
  venue: string
  impactFactor: number | null
  /** 领域 — a plain string so it maps 1:1 onto a folder or a filter */
  field: string
  tags: string[]
  /** 重要性 1-5 星 */
  importance: 1 | 2 | 3 | 4 | 5
  /** 阅读进度 0-100 */
  progress: number
  status: PaperStatus
  doi: string
  url: string
  abstract: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string | null
  /** 最近一次真正看过（阅读器 / 全屏笔记 / 详情面板），用于「最近查看」排序与筛选 */
  lastViewedAt: string | null
  /** 置顶：只影响排序，不动文件 */
  pinned: boolean
  /** 笔记文件名（papers/<目录>/ 下的 .md）：跟随标题命名，标题改名时文件跟着改。老库为 null（note.md） */
  noteName: string | null
  /** page index -> scroll ratio, enables "resume where I left off" */
  lastPage: number
  /** PDF 高亮 / 下划线 / 删除线 / 框选标注，与文献同目录保存 */
  annotations: Annotation[]
  /** 标注样式版本：2 起样式写进 meta.json（旧文件读时补默认） */
  annotationStyleVersion: number
  /** 这篇文献的标注默认样式 */
  styles: AnnotationStyles
}

export interface PaperRecord {
  /** folder name, relative to `<vault>/papers/`, also the stable human handle */
  dir: string
  meta: PaperMeta
  /** whether meta.json existed and parsed cleanly on disk */
  metaOk: boolean
  note: string
  hasPdf: boolean
  pdfSize: number
  assets: string[]
  /** absolute-ish path for display */
  path: string
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Author strings arrive in every shape imaginable ("A, B and C", "张三、李四",
 * "Vaswani, A.; Shazeer, N."). When a strong separator (; or 、) is present we
 * split on it only, so "Vaswani, A." stays one author; otherwise commas split.
 */
function splitAuthors(input: string): string[] {
  const trimmed = input.trim()
  const strong = /\s*[;；、]\s*|\s+and\s+/i
  const parts = strong.test(trimmed)
    ? trimmed.split(strong)
    : trimmed.split(/\s*[,，]\s*/)
  return parts.map((part) => part.trim()).filter(Boolean)
}

export function normalizeMeta(raw: unknown, fallback: Partial<PaperMeta> = {}): PaperMeta {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <K extends keyof PaperMeta>(key: K): unknown =>
    src[key] !== undefined && src[key] !== null ? src[key] : fallback[key]

  const authorsRaw = pick('authors')
  const authors = Array.isArray(authorsRaw)
    ? authorsRaw.map((a) => String(a).trim()).filter(Boolean)
    : typeof authorsRaw === 'string' && authorsRaw.trim()
      ? splitAuthors(authorsRaw)
      : []

  const tagsRaw = pick('tags')
  const tags = Array.isArray(tagsRaw)
    ? [...new Set(tagsRaw.map((t) => String(t).trim()).filter(Boolean))]
    : typeof tagsRaw === 'string'
      ? tagsRaw
          .split(/[,，;；\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
      : []

  const yearNum = Number(pick('year'))
  const year = Number.isFinite(yearNum) && yearNum > 1500 && yearNum < 2200 ? Math.round(yearNum) : null

  const ifNum = Number(pick('impactFactor'))
  const impactFactor = Number.isFinite(ifNum) && ifNum >= 0 ? Number(ifNum.toFixed(3)) : null

  const status = pick('status')
  const safeStatus: PaperStatus =
    status === 'todo' || status === 'reading' || status === 'done' || status === 'archived'
      ? status
      : 'todo'

  const now = new Date().toISOString()
  const importance = clampInt(pick('importance'), 1, 5, 3) as PaperMeta['importance']

  return {
    version: META_VERSION,
    id: String(pick('id') || crypto.randomUUID?.() || `p-${Date.now()}`),
    title: String(pick('title') || '未命名文献').trim(),
    authors,
    year,
    venue: String(pick('venue') || '').trim(),
    impactFactor,
    field: String(pick('field') || '').trim(),
    tags,
    importance,
    progress: clampInt(pick('progress'), 0, 100, 0),
    status: safeStatus,
    doi: String(pick('doi') || '').trim(),
    url: String(pick('url') || '').trim(),
    abstract: String(pick('abstract') || '').trim(),
    createdAt: String(pick('createdAt') || now),
    updatedAt: String(pick('updatedAt') || now),
    lastOpenedAt: (pick('lastOpenedAt') as string | null) ?? null,
    // 老 meta.json 没有这两个字段：读的时候补默认值，不批量改写磁盘
    lastViewedAt: (pick('lastViewedAt') as string | null) ?? (pick('lastOpenedAt') as string | null) ?? null,
    pinned: pick('pinned') === true,
    noteName: typeof pick('noteName') === 'string' ? (pick('noteName') as string).trim() || null : null,
    lastPage: clampInt(pick('lastPage'), 0, 100_000, 0),
    annotations: normalizeAnnotations(pick('annotations')),
    annotationStyleVersion: ANNOTATION_STYLE_VERSION,
    styles: normalizeStyles(pick('styles')),
  }
}

export function serializeMeta(meta: PaperMeta): string {
  // stable key order keeps git diffs small and readable
  const ordered: Record<string, unknown> = {
    version: meta.version,
    id: meta.id,
    title: meta.title,
    authors: meta.authors,
    year: meta.year,
    venue: meta.venue,
    impactFactor: meta.impactFactor,
    field: meta.field,
    tags: meta.tags,
    importance: meta.importance,
    progress: meta.progress,
    status: meta.status,
    doi: meta.doi,
    url: meta.url,
    abstract: meta.abstract,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    lastOpenedAt: meta.lastOpenedAt,
    lastViewedAt: meta.lastViewedAt,
    pinned: meta.pinned,
    noteName: meta.noteName ?? null,
    lastPage: meta.lastPage,
    annotations: meta.annotations ?? [],
    annotationStyleVersion: ANNOTATION_STYLE_VERSION,
    styles: meta.styles,
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

export function parseMeta(text: string, fallback: Partial<PaperMeta> = {}): PaperMeta {
  try {
    return normalizeMeta(JSON.parse(text), fallback)
  } catch {
    // A hand-edited or truncated meta.json must never take the library down:
    // fall back to whatever the folder name still tells us.
    return normalizeMeta({}, fallback)
  }
}

/** Last name heuristic that survives "Ashish Vaswani", "Vaswani, A." and 中文姓名. */
export function firstAuthorLastName(authors: string[]): string {
  const first = authors[0]?.trim()
  if (!first) return 'Unknown'
  if (first.includes(',')) {
    const [last] = first.split(',')
    return last.trim()
  }
  const parts = first.split(/\s+/)
  if (parts.length === 1) return parts[0]
  // "van der Waals" style particles stay attached
  return parts[parts.length - 1]
}

/** `{作者}_{年份}_{标题}` folder name — portable across Windows / Android / macOS. */
export function folderNameFor(meta: Pick<PaperMeta, 'authors' | 'year' | 'title'>): string {
  const author = sanitizeSegment(firstAuthorLastName(meta.authors), 'Unknown')
  const year = meta.year ? String(meta.year) : 'YYYY'
  const title = sanitizeSegment(meta.title, 'Untitled').replace(/\s+/g, ' ').slice(0, 60).trim()
  return `${author}_${year}_${title}`
}

/** Best-effort reconstruction when meta.json is missing or broken. */
export function metaFromFolder(dir: string): PaperMeta {
  const match = dir.match(/^(.+?)_(\d{4}|YYYY)_(.*)$/)
  const author = match?.[1] ?? ''
  const yearText = match?.[2]
  const year = yearText && yearText !== 'YYYY' ? Number(yearText) : null
  // Underscores in folder names were spaces in the original title.
  const title = (match?.[3] ?? dir).replace(/_/g, ' ').trim()
  return normalizeMeta({ title, authors: author ? [author] : [], year })
}

export function noteTemplate(meta: PaperMeta): string {
  const authors = meta.authors.join(', ') || '未知作者'
  const line = [authors, meta.venue, meta.year].filter(Boolean).join(' · ')
  return `# ${meta.title}

> ${line}

## 一句话总结

## 研究问题

## 方法

## 关键结论

## 我的批注

## 相关文献
`
}
