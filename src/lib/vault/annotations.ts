import type {
  Annotation,
  AnnotationColor,
  AnnotationKind,
  AnnotationRect,
  AnnotationStyles,
  LineStyle,
  PaperMeta,
} from './schema'

/**
 * PDF 标注存在 `meta.json` 里，跟着文献文件夹一起走。
 *
 * 坐标系是「页框归一化坐标」：x/y/w/h ∈ [0,1]，相对于页面本身的宽高。
 * 这样缩放、换设备、导出成图片都不用重算；渲染时乘上当前像素尺寸即可。
 */

export const ANNOTATION_COLORS: { value: AnnotationColor; label: string; swatch: string }[] = [
  { value: 'yellow', label: '黄', swatch: '#f2c94c' },
  { value: 'green', label: '绿', swatch: '#7bbf8e' },
  { value: 'blue', label: '蓝', swatch: '#7aa7d8' },
  { value: 'pink', label: '粉', swatch: '#e79ab0' },
  { value: 'purple', label: '紫', swatch: '#b39ddb' },
]

export const COLOR_HEX: Record<AnnotationColor, string> = {
  yellow: '#f2c94c',
  green: '#7bbf8e',
  blue: '#7aa7d8',
  pink: '#e79ab0',
  purple: '#b39ddb',
}

const KINDS: AnnotationKind[] = ['highlight', 'underline', 'strikethrough', 'note', 'rect']
/** 旧文件里写的是 `strike`，读盘时升级；`underline` 绝不能被误迁移 */
const LEGACY_KINDS: Record<string, AnnotationKind> = { strike: 'strikethrough' }
const COLORS = ANNOTATION_COLORS.map((c) => c.value)

export function newAnnotationId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function normalizeRect(raw: unknown): AnnotationRect | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const x = Number(src.x)
  const y = Number(src.y)
  const w = Number(src.w)
  const h = Number(src.h)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  // clamp the box, not just the origin: a rect that starts on the page but
  // runs off the right edge must be trimmed, not left hanging outside
  const nx = clamp01(x)
  const ny = clamp01(y)
  const rect = {
    x: nx,
    y: ny,
    w: clamp01(x + w) - nx,
    h: clamp01(y + h) - ny,
  }
  // zero-area rects are useless and usually a sign of a broken selection
  if (rect.w < 0.0005 || rect.h < 0.0002) return null
  return rect
}

/** Tolerant reader: anything hand-edited or half-written must not break the app. */
export function normalizeAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return []
  const out: Annotation[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const src = item as Record<string, unknown>
    const rects = Array.isArray(src.rects)
      ? src.rects.map(normalizeRect).filter((r): r is AnnotationRect => Boolean(r))
      : []
    if (!rects.length) continue
    const page = Math.round(Number(src.page))
    if (!Number.isFinite(page) || page < 1) continue
    const rawKind = String(src.kind || '')
    const kind: AnnotationKind =
      LEGACY_KINDS[rawKind] ?? (KINDS.includes(rawKind as AnnotationKind) ? (rawKind as AnnotationKind) : 'highlight')
    const color = COLORS.includes(src.color as AnnotationColor)
      ? (src.color as AnnotationColor)
      : 'yellow'
    out.push({
      id: String(src.id || newAnnotationId()),
      kind,
      page,
      color,
      rects,
      text: typeof src.text === 'string' ? src.text.slice(0, 4000) : '',
      note: typeof src.note === 'string' ? src.note.slice(0, 2000) : '',
      createdAt: typeof src.createdAt === 'string' ? src.createdAt : new Date().toISOString(),
    })
  }
  return out
}

/** Converts browser selection rects into page-normalised rects (dedupes line overlap). */
export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

export function selectionToRects(
  clientRects: ClientRectLike[],
  pageBox: ClientRectLike,
): AnnotationRect[] {
  if (pageBox.width <= 0 || pageBox.height <= 0) return []
  const rects: AnnotationRect[] = []
  for (const raw of clientRects) {
    if (raw.width < 1 || raw.height < 1) continue
    const x = (raw.left - pageBox.left) / pageBox.width
    const y = (raw.top - pageBox.top) / pageBox.height
    const w = raw.width / pageBox.width
    const h = raw.height / pageBox.height
    // clip to the page — a selection that runs past the edge would draw outside the canvas
    const nx = clamp01(x)
    const ny = clamp01(y)
    const nw = clamp01(x + w) - nx
    const nh = clamp01(y + h) - ny
    if (nw < 0.001 || nh < 0.0005) continue
    const prev = rects[rects.length - 1]
    // Same visual line split into two segments → merge, otherwise it looks striped.
    if (
      prev &&
      Math.abs(prev.y - ny) < 0.004 &&
      Math.abs(prev.h - nh) < 0.004 &&
      Math.abs(prev.x + prev.w - nx) < 0.01
    ) {
      prev.w = clamp01(nx + nw) - prev.x
      continue
    }
    rects.push({ x: nx, y: ny, w: nw, h: nh })
  }
  // 浏览器对跨行选择会同时给出「字形盒」和「行盒」，这里按行归一后再存盘，
  // 避免把重复 rect 写进 meta.json（旧数据在渲染时也会再过一遍）。
  return consolidateRects(rects)
}

export function annotationsForPage(annotations: Annotation[], page: number): Annotation[] {
  return annotations.filter((a) => a.page === page)
}

export function annotationCount(meta: Pick<PaperMeta, 'annotations'>): number {
  return meta.annotations?.length ?? 0
}

const KIND_LABEL: Record<AnnotationKind, string> = {
  highlight: '高亮',
  underline: '下划线',
  strikethrough: '删除线',
  note: '批注',
  rect: '框选',
}

/**
 * Markdown 导出：同一页的标注合并成一个 `> 引用`，批注另起一行，
 * 顺序按页码 + 纵向位置，读起来就像抄了一遍原文。
 */
export function annotationsToMarkdown(
  annotations: Annotation[],
  meta: { title: string; styles?: AnnotationStyles },
  date = new Date(),
): string {
  if (!annotations.length) return ''
  const sorted = [...annotations].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    return (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0)
  })
  const lines: string[] = [
    `## PDF 标注 · ${meta.title}`,
    '',
    `> 由 ScholarBox 于 ${date.toLocaleString('zh-CN', { hour12: false })} 导出，共 ${sorted.length} 条。`,
    '',
  ]
  let currentPage = 0
  for (const item of sorted) {
    if (item.page !== currentPage) {
      currentPage = item.page
      lines.push(`### 第 ${currentPage} 页`, '')
    }
    const label = KIND_LABEL[item.kind] ?? '标注'
    const summary = meta.styles ? ` · ${styleSummary(item, meta.styles)}` : ''
    if (item.text.trim()) {
      const quoted = item.text.trim().replace(/\s*\n\s*/g, ' ')
      lines.push(`> ${quoted}`, '')
      lines.push(`*${label} · p.${item.page}${summary}*`, '')
    } else {
      lines.push(`*${label} · p.${item.page}${summary}*`, '')
    }
    if (item.note.trim()) {
      lines.push(item.note.trim(), '')
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

/* ------------------------------------------------------------------ *
 * 样式：颜色 / 透明度 / 线宽 / 偏移
 *
 * 之前这些值写死在 CSS 里（`.pdf-mark-text{opacity:.42}`），既不能按篇调，
 * 也不能按条调。现在默认值跟着 meta.json 走。
 * ------------------------------------------------------------------ */

export const DEFAULT_STYLES: AnnotationStyles = {
  highlight: { color: COLOR_HEX.yellow, opacity: 0.38, paddingY: 0.04 },
  underline: { color: COLOR_HEX.yellow, opacity: 1, width: 2, offset: 0.9 },
  strikethrough: { color: COLOR_HEX.yellow, opacity: 1, width: 1.6, offset: 0.5 },
  note: { color: COLOR_HEX.yellow, opacity: 1, width: 1.6, offset: 0.5 },
}

const clampNum = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const isHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)

function normalizeLineStyle(raw: unknown, base: LineStyle): LineStyle {
  if (!raw || typeof raw !== 'object') return { ...base }
  const src = raw as Record<string, unknown>
  return {
    color: isHex(src.color) ? src.color : base.color,
    opacity: clampNum(src.opacity, 0.05, 1, base.opacity),
    width: clampNum(src.width, 0.5, 8, base.width),
    offset: clampNum(src.offset, 0, 1, base.offset),
  }
}

/** 读盘时的样式归一化：缺字段补默认，越界夹紧 */
export function normalizeStyles(raw: unknown): AnnotationStyles {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const highlightRaw = (
    src.highlight && typeof src.highlight === 'object' ? src.highlight : {}
  ) as Record<string, unknown>
  return {
    highlight: {
      color: isHex(highlightRaw.color) ? highlightRaw.color : DEFAULT_STYLES.highlight.color,
      opacity: clampNum(highlightRaw.opacity, 0.05, 1, DEFAULT_STYLES.highlight.opacity),
      paddingY: clampNum(highlightRaw.paddingY, 0, 0.3, DEFAULT_STYLES.highlight.paddingY),
    },
    underline: normalizeLineStyle(src.underline, DEFAULT_STYLES.underline),
    strikethrough: normalizeLineStyle(src.strikethrough, DEFAULT_STYLES.strikethrough),
    note: normalizeLineStyle(src.note, DEFAULT_STYLES.note),
  }
}

export interface ResolvedHighlight {
  kind: 'highlight'
  color: string
  opacity: number
  paddingY: number
}

export interface ResolvedLine {
  kind: 'underline' | 'strikethrough' | 'note'
  color: string
  opacity: number
  width: number
  offset: number
}

/**
 * 三层合并：代码默认 → 这篇文献的默认 → 单条覆盖。
 * 单条只存改过的键，所以不能整体替换。
 */
export function resolveAnnotationStyle(
  annotation: Annotation,
  styles: AnnotationStyles,
): ResolvedHighlight | ResolvedLine {
  const override = annotation.style ?? {}
  const fallbackColor = COLOR_HEX[annotation.color] ?? COLOR_HEX.yellow
  if (annotation.kind === 'highlight') {
    const base = styles.highlight
    return {
      kind: 'highlight',
      color: override.color ?? base.color ?? fallbackColor,
      opacity: clampNum(override.opacity, 0.05, 1, base.opacity),
      paddingY: clampNum(override.paddingY, 0, 0.3, base.paddingY),
    }
  }
  const kind = annotation.kind === 'rect' ? 'note' : annotation.kind
  const base = styles[kind] ?? styles.underline
  return {
    kind,
    color: override.color ?? base.color ?? fallbackColor,
    opacity: clampNum(override.opacity, 0.05, 1, base.opacity),
    width: clampNum(override.width, 0.5, 8, base.width),
    offset: clampNum(override.offset, 0, 1, base.offset),
  }
}

/** 导出到 note.md 的一行样式摘要 */
export function styleSummary(annotation: Annotation, styles: AnnotationStyles): string {
  const resolved = resolveAnnotationStyle(annotation, styles)
  const color = resolved.color.replace('#', '').slice(0, 6)
  if (resolved.kind === 'highlight') {
    return `底色 #${color} · 透明度 ${Math.round(resolved.opacity * 100)}%`
  }
  return `#${color} · ${resolved.width.toFixed(1)}px · 透明度 ${Math.round(resolved.opacity * 100)}%`
}

/* ------------------------------------------------------------------ *
 * rect 归一化
 *
 * 浏览器给跨行选择的 `getClientRects()` 会同时返回「文本节点盒子」和
 * 「行盒/容器盒子」：同一行两个盒子高度差 6–8 px、纵向重叠 9–13 px。
 * 直接画两次就会 alpha 叠加，多行高亮于是「中间最重」。这里按行聚合并
 * 只留一个 rect（横向取并集、高度取最紧的盒子），行与行之间再夹一刀。
 * ------------------------------------------------------------------ */

export function consolidateRects(rects: AnnotationRect[]): AnnotationRect[] {
  const clean = rects.filter((r) => r.w > 0.0005 && r.h > 0.0005)
  if (clean.length <= 1) return clean.map((r) => ({ ...r }))

  const sorted = [...clean].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
  const lines: { rects: AnnotationRect[]; center: number; height: number }[] = []

  for (const rect of sorted) {
    const center = rect.y + rect.h / 2
    const line = lines.find((candidate) => {
      const delta = Math.abs(candidate.center - center)
      return delta < Math.min(candidate.height, rect.h) * 0.6
    })
    if (line) {
      line.rects.push(rect)
      const tightest = line.rects.reduce((a, b) => (b.h < a.h ? b : a))
      line.center = tightest.y + tightest.h / 2
      line.height = tightest.h
    } else {
      lines.push({ rects: [rect], center, height: rect.h })
    }
  }

  const merged = lines.map((line) => {
    const tightest = line.rects.reduce((a, b) => (b.h < a.h ? b : a))
    const left = Math.min(...line.rects.map((r) => r.x))
    const right = Math.max(...line.rects.map((r) => r.x + r.w))
    return { x: left, y: tightest.y, w: Math.max(0.001, right - left), h: tightest.h }
  })

  merged.sort((a, b) => a.y - b.y)
  for (let i = 1; i < merged.length; i += 1) {
    const prev = merged[i - 1]!
    const current = merged[i]!
    const prevBottom = prev.y + prev.h
    if (current.y < prevBottom - 0.0005) {
      const bottom = current.y + current.h
      current.y = prevBottom
      current.h = Math.max(0.001, bottom - prevBottom)
    }
  }

  return merged
}
