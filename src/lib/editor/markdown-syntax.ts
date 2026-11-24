/**
 * 一个够用的 Markdown 行扫描器：给「实时预览」算需要隐藏的语法标记与需要套样式的区间。
 *
 * 不追求 100% CommonMark —— 它只服务于「光标外的行按渲染样式显示、光标所在行露源码」
 * 这一个用途，所以宁可少认几种语法，也不要因为一个正则把整行吃错。
 *
 * 2026-11-18：行内标记（`**`、`` ` ``、`[..](..)`）现在也进 `hidden`。
 * 之前只给内容套样式、标记照旧显示，于是实时预览里看到的是「**加粗**」而不是「加粗」，
 * 和 Obsidian 差得远。列表的 `- ` / `1. ` 也改成保留缩进、由渲染层换成圆点/序号。
 */

export type BlockKind = 'heading' | 'quote' | 'list' | 'task' | 'code' | 'table' | 'hr' | 'plain'

export interface InlineSpan {
  from: number
  to: number
  kind: 'bold' | 'italic' | 'strike' | 'highlight' | 'code' | 'link' | 'image'
}

/** 列表项：实时预览要把标记换成圆点/序号，所以得知道原文是什么 */
export interface ListMarker {
  ordered: boolean
  /** 原文里的标记，例如 `-`、`1.`、`a)` */
  marker: string
}

export interface LineInfo {
  /** 行在整篇文档里的起点 */
  from: number
  /** 行尾（不含换行符） */
  to: number
  block: BlockKind
  /** 标题级别 1..6，非标题为 0 */
  level: number
  /** 任务项是否已勾选（block === 'task' 时有效） */
  checked?: boolean
  /** 列表项信息（block === 'list' 时有效） */
  list?: ListMarker
  /** 缩进宽度（空格数，制表符按 2 计）；标题/正文为 0 */
  indent: number
  /** 需要隐藏的标记区间（绝对偏移），例如 `## `、`- `、`**` */
  hidden: Array<[number, number]>
  /** 行内需要套样式的区间 */
  inlines: InlineSpan[]
}

const HEADING = /^(#{1,6})\s+/
const QUOTE = /^>\s?/
const TASK = /^(\s*)([-*+])\s+\[( |x|X)\]\s/
const LIST = /^(\s*)([-*+]|\d+[.)])\s/
const FENCE = /^\s*(```|~~~)/
const TABLE_ROW = /^\s*\|.*\|\s*$/
/** 分割线（Obsidian 的 `---`）：`---`、`***`、`___`，允许最多 3 个前导空格 */
const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/

/** 逐行扫描；`text` 是整篇文档（含换行）。 */
export function scanMarkdown(text: string): LineInfo[] {
  const lines: LineInfo[] = []
  let cursor = 0
  let inFence = false
  // frontmatter（开头连续的 `---` 包住的区域）不是分割线，原样保留
  let inFrontmatter = false

  for (const raw of text.split('\n')) {
    const from = cursor
    const to = cursor + raw.length
    cursor = to + 1

    if (FENCE.test(raw)) {
      inFence = !inFence
      lines.push({ from, to, block: 'code', level: 0, indent: 0, hidden: [], inlines: [] })
      continue
    }
    if (inFence) {
      lines.push({ from, to, block: 'code', level: 0, indent: 0, hidden: [], inlines: [] })
      continue
    }

    const hidden: Array<[number, number]> = []
    let block: BlockKind = 'plain'
    let level = 0
    let checked: boolean | undefined
    let list: ListMarker | undefined
    let indent = 0
    let bodyStart = from

    if (lines.length === 0 && raw.trim() === '---') {
      // 文档第一行的 `---` 是 frontmatter 开头，不是分割线
      inFrontmatter = true
    } else if (inFrontmatter && raw.trim() === '---') {
      inFrontmatter = false
    } else if (HR.test(raw) && !inFrontmatter) {
      block = 'hr'
    }

    const heading = HEADING.exec(raw)
    if (heading) {
      block = 'heading'
      level = heading[1]!.length
      hidden.push([from, from + heading[0].length])
      bodyStart = from + heading[0].length
    } else if (TABLE_ROW.test(raw)) {
      block = 'table'
    } else if (TASK.test(raw)) {
      block = 'task'
      const m = TASK.exec(raw)!
      checked = m[3] !== ' '
      // 缩进也一起藏：层级交给行级 CSS（padding + text-indent）做悬挂缩进，
      // 否则「2 个空格 = 2ch」的缩进在换行后不会跟着走
      indent = m[1]!.replace(/\t/g, '  ').length
      hidden.push([from, from + m[0].length])
      bodyStart = from + m[0].length
    } else if (LIST.test(raw)) {
      block = 'list'
      const m = LIST.exec(raw)!
      indent = m[1]!.replace(/\t/g, '  ').length
      hidden.push([from, from + m[0].length])
      bodyStart = from + m[0].length
      list = { ordered: /\d/.test(m[2]!), marker: m[2]! }
    } else if (QUOTE.test(raw)) {
      block = 'quote'
      const m = QUOTE.exec(raw)!
      hidden.push([from, from + m[0].length])
      bodyStart = from + m[0].length
    }

    const inline = scanInline(raw, from, bodyStart)
    lines.push({
      from,
      to,
      block,
      level,
      checked,
      list,
      indent,
      hidden: [...hidden, ...inline.hidden],
      inlines: inline.spans,
    })
  }

  return lines
}

interface InlineRule {
  kind: InlineSpan['kind']
  pattern: RegExp
  /** 从一次匹配里读出「正文区间」与「需要藏掉的标记区间」（相对该行 body 的偏移） */
  parse: (match: RegExpExecArray) => { contentStart: number; contentEnd: number; markers: Array<[number, number]> } | null
}

const INLINE_RULES: InlineRule[] = [
  {
    kind: 'image',
    pattern: /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g,
    parse: (m) => {
      const altStart = m.index + 2
      const altEnd = altStart + (m[1] ?? '').length
      return {
        contentStart: altStart,
        contentEnd: altEnd,
        markers: [
          [m.index, m.index + 2],
          [altEnd, m.index + m[0].length],
        ],
      }
    },
  },
  {
    kind: 'link',
    pattern: /\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g,
    parse: (m) => {
      const textStart = m.index + 1
      const textEnd = textStart + (m[1] ?? '').length
      return {
        contentStart: textStart,
        contentEnd: textEnd,
        markers: [
          [m.index, m.index + 1],
          [textEnd, m.index + m[0].length],
        ],
      }
    },
  },
  {
    kind: 'bold',
    pattern: /\*\*([^*]+)\*\*/g,
    parse: (m) => {
      const start = m.index + 2
      const end = start + (m[1] ?? '').length
      return { contentStart: start, contentEnd: end, markers: [[m.index, start], [end, end + 2]] }
    },
  },
  {
    kind: 'strike',
    pattern: /~~([^~]+)~~/g,
    parse: (m) => {
      const start = m.index + 2
      const end = start + (m[1] ?? '').length
      return { contentStart: start, contentEnd: end, markers: [[m.index, start], [end, end + 2]] }
    },
  },
  {
    // Obsidian 的 ==高亮==
    kind: 'highlight',
    pattern: /==([^=\n]+)==/g,
    parse: (m) => {
      const start = m.index + 2
      const end = start + (m[1] ?? '').length
      return { contentStart: start, contentEnd: end, markers: [[m.index, start], [end, end + 2]] }
    },
  },
  {
    kind: 'italic',
    pattern: /(^|[^*_])([*_])([^*_\n]+)\2/g,
    parse: (m) => {
      const prefix = (m[1] ?? '').length
      // 开标记紧跟在可选前缀后面，长度 1；闭标记在正文之后同样 1 个字符
      const openAt = m.index + prefix
      const start = openAt + 1
      const end = start + (m[3] ?? '').length
      return { contentStart: start, contentEnd: end, markers: [[openAt, start], [end, end + 1]] }
    },
  },
  {
    kind: 'code',
    pattern: /`([^`\n]+)`/g,
    parse: (m) => {
      const start = m.index + 1
      const end = start + (m[1] ?? '').length
      return { contentStart: start, contentEnd: end, markers: [[m.index, start], [end, end + 1]] }
    },
  },
]

function scanInline(
  raw: string,
  lineFrom: number,
  bodyStart: number,
): { spans: InlineSpan[]; hidden: Array<[number, number]> } {
  const spans: InlineSpan[] = []
  const hidden: Array<[number, number]> = []
  const body = raw.slice(bodyStart - lineFrom)

  for (const rule of INLINE_RULES) {
    rule.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = rule.pattern.exec(body))) {
      const parsed = rule.parse(match)
      if (!parsed) continue
      const from = bodyStart + parsed.contentStart
      const to = bodyStart + parsed.contentEnd
      if (to <= from) continue
      spans.push({ from, to, kind: rule.kind })
      for (const [a, b] of parsed.markers) {
        if (b > a) hidden.push([bodyStart + a, bodyStart + b])
      }
    }
  }

  return { spans: spans.sort((a, b) => a.from - b.from), hidden }
}

/**
 * 实时预览要把「光标外的行」上的标记藏掉。返回要隐藏的区间与要套样式的区间，
 * 两者都按行过滤 —— 光标所在行原样显示，方便直接改语法。
 *
 * `Decoration.replace` 不接受重叠区间（`***x***` 这种嵌套会算出交叉的标记），
 * 所以这里顺手做一次排序 + 去重叠。
 */
export function decorationsForLines(
  lines: LineInfo[],
  activeLineNumbers: ReadonlySet<number>,
): { hidden: Array<[number, number]>; inlines: InlineSpan[] } {
  const hidden: Array<[number, number]> = []
  const inlines: InlineSpan[] = []
  lines.forEach((line, index) => {
    if (activeLineNumbers.has(index)) return
    hidden.push(...line.hidden)
    inlines.push(...line.inlines)
  })
  return { hidden: dedupeRanges(hidden), inlines }
}

/** 排序 + 丢掉与前一段重叠的区间（后者整段跳过，宁可少藏也不要让 CM 抛错） */
export function dedupeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Array<[number, number]> = []
  let lastEnd = -1
  for (const range of sorted) {
    if (range[0] < lastEnd) continue
    out.push(range)
    lastEnd = range[1]
  }
  return out
}
