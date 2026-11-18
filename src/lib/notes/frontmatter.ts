/**
 * 独立笔记的 frontmatter。故意只支持一小撮 YAML：
 *
 * ```
 * ---
 * createdAt: 2026-11-16T19:30:00.000Z
 * updatedAt: 2026-11-16T19:42:11.000Z
 * lastViewedAt: 2026-11-16T19:45:02.000Z
 * field: 信息检索
 * tags: [方法, 待整理]
 * importance: 3
 * status: active
 * pinned: false
 * ---
 * ```
 *
 * 理由：这些文件要能被 Obsidian / 任意编辑器打开，格式必须是标准 YAML；
 * 但我们只写自己认识的那几个键，解析时也不引第三方 YAML 库（体积 + 供应链）。
 * 认不出的键原样保留（`extra`），不会因为多写一行就丢数据。
 *
 * 兼容：早期版本写的是 `created` / `updated` 两个键，读的时候按别名处理，
 * 保存时自动迁移成 `createdAt` / `updatedAt`。
 */

import type { NoteStatus } from '@/lib/library/item'

export interface FrontmatterData {
  createdAt: string | null
  updatedAt: string | null
  lastViewedAt: string | null
  tags: string[]
  field: string
  importance: number
  status: NoteStatus
  pinned: boolean
  /** 其他键原样保留，写回时按插入顺序输出 */
  extra: Record<string, string>
}

export interface ParsedNote {
  data: FrontmatterData
  /** frontmatter 之后的正文（保留原有换行） */
  body: string
}

const FENCE = /^---[ \t]*\r?\n/

export const DEFAULT_IMPORTANCE = 3
export const NOTE_STATUSES: NoteStatus[] = ['draft', 'active', 'archived']

export function emptyFrontmatter(): FrontmatterData {
  return {
    createdAt: null,
    updatedAt: null,
    lastViewedAt: null,
    tags: [],
    field: '',
    importance: DEFAULT_IMPORTANCE,
    status: 'active',
    pinned: false,
    extra: {},
  }
}

export function parseTags(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim()
  if (!text) return []

  // [a, "b", 'c'] / a, b / a b
  const inner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  return dedupe(
    inner
      .split(/[,，、]/)
      .flatMap((part) => part.split(/\s+/))
      .map(stripQuotes)
      .map((part) => part.trim())
      .filter(Boolean),
  )
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

export function dedupe(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

function parseStatus(raw: string): NoteStatus {
  const value = raw.trim().toLowerCase()
  if (value === 'draft' || value === 'archived' || value === 'active') return value
  // 旧文件里可能抄了文献的状态
  if (value === 'todo' || value === 'reading') return 'active'
  if (value === 'done') return 'archived'
  return 'active'
}

const TRUE = new Set(['true', 'yes', '1', 'on'])

/**
 * 解析 `.md` 文本：有 `---` 头就当 frontmatter，没有就整篇都是正文。
 * 手写坏了（没闭合）也当正文处理 —— 内容比元信息重要。
 */
export function parseNote(text: string): ParsedNote {
  const data = emptyFrontmatter()
  if (!FENCE.test(text)) return { data, body: text }

  const rest = text.replace(FENCE, '')
  const lines = rest.split(/\r?\n/)
  let end = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { data, body: text }

  let listKey: string | null = null
  for (const line of lines.slice(0, end)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // YAML 列表续行：`  - tag`
    if (/^-\s+/.test(trimmed) && listKey) {
      const value = trimmed.replace(/^-\s+/, '')
      if (listKey === 'tags') data.tags.push(...parseTags(value))
      else data.extra[listKey] = `${data.extra[listKey] ?? ''} ${value}`.trim()
      continue
    }

    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    listKey = value === '' ? key : null

    switch (key) {
      case 'tags':
        data.tags.push(...parseTags(value))
        break
      case 'created':
      case 'createdAt':
        data.createdAt = value || null
        break
      case 'updated':
      case 'updatedAt':
        data.updatedAt = value || null
        break
      case 'lastViewedAt':
        data.lastViewedAt = value || null
        break
      case 'field':
        data.field = stripQuotes(value)
        break
      case 'importance': {
        const parsed = Number(value)
        data.importance = Number.isFinite(parsed)
          ? Math.min(5, Math.max(1, Math.round(parsed)))
          : DEFAULT_IMPORTANCE
        break
      }
      case 'status':
        data.status = parseStatus(value)
        break
      case 'pinned':
        data.pinned = TRUE.has(value.toLowerCase())
        break
      default:
        if (value) data.extra[key] = stripQuotes(value)
    }
  }

  data.tags = dedupe(data.tags)
  return { data, body: lines.slice(end + 1).join('\n').replace(/^\r?\n/, '') }
}

export function stringifyNote(data: FrontmatterData, body: string): string {
  // 一个键都没有时不要写一对空的 `---`
  const hasMeta =
    Boolean(data.createdAt) ||
    Boolean(data.updatedAt) ||
    Boolean(data.lastViewedAt) ||
    Boolean(data.field) ||
    data.importance !== DEFAULT_IMPORTANCE ||
    data.status !== 'active' ||
    data.pinned ||
    data.tags.length > 0 ||
    Object.keys(data.extra).length > 0
  if (!hasMeta) return body

  const lines = ['---']
  if (data.createdAt) lines.push(`createdAt: ${data.createdAt}`)
  if (data.updatedAt) lines.push(`updatedAt: ${data.updatedAt}`)
  if (data.lastViewedAt) lines.push(`lastViewedAt: ${data.lastViewedAt}`)
  if (data.field) lines.push(`field: ${quoteIfNeeded(data.field)}`)
  if (data.tags.length > 0) lines.push(`tags: [${data.tags.map(quoteIfNeeded).join(', ')}]`)
  if (data.importance !== DEFAULT_IMPORTANCE) lines.push(`importance: ${data.importance}`)
  if (data.status !== 'active') lines.push(`status: ${data.status}`)
  if (data.pinned) lines.push('pinned: true')
  for (const [key, value] of Object.entries(data.extra)) lines.push(`${key}: ${value}`)
  lines.push('---', '')
  return `${lines.join('\n')}${body.replace(/^\n+/, '')}`
}

function quoteIfNeeded(value: string): string {
  return /[,\[\]:"'#]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/** 只改元信息，正文原样返回（旧版字段名在这里完成迁移） */
export function withFrontmatter(text: string, patch: Partial<Omit<FrontmatterData, 'extra'> & { extra?: Record<string, string> }>): string {
  const { data, body } = parseNote(text)
  const next: FrontmatterData = {
    createdAt: patch.createdAt !== undefined ? patch.createdAt : data.createdAt,
    updatedAt: patch.updatedAt !== undefined ? patch.updatedAt : data.updatedAt,
    lastViewedAt: patch.lastViewedAt !== undefined ? patch.lastViewedAt : data.lastViewedAt,
    tags: patch.tags ?? data.tags,
    field: patch.field ?? data.field,
    importance: patch.importance ?? data.importance,
    status: patch.status ?? data.status,
    pinned: patch.pinned ?? data.pinned,
    extra: { ...data.extra, ...(patch.extra ?? {}) },
  }
  return stringifyNote(next, body)
}

/** 正文里的第一个 `# 标题`，没有就用文件名兜底 */
export function noteTitle(body: string, fallback = '未命名笔记'): string {
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*$/)
    if (match) return match[1]!
    if (line.trim() && !line.startsWith('#')) break
  }
  return fallback
}

export function nowIso(): string {
  return new Date().toISOString()
}
