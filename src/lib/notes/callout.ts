/**
 * Obsidian 的 callout 提示块：`> [!note] 标题` 开头的引用块。
 * 阅读模式把 <blockquote> 后处理成带色块的 callout；实时预览给行加着色。
 */

/** Obsidian 的 callout 类型 → 归一化的色系（同色系共用一个 CSS 类） */
const CALLOUT_FAMILIES: Record<string, string> = {
  note: 'note',
  info: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  warn: 'warning',
  attention: 'warning',
  danger: 'danger',
  error: 'danger',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  bug: 'danger',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
}

const DEFAULT_TITLES: Record<string, string> = {
  note: 'Note',
  abstract: 'Abstract',
  tip: 'Tip',
  question: 'Question',
  warning: 'Warning',
  danger: 'Danger',
  example: 'Example',
  quote: 'Quote',
}

export interface CalloutMarker {
  /** 原始类型名，如 `note`、`WARNING` */
  type: string
  /** 归一化色系，CSS 类名后缀 */
  family: string
  /** 标题：标记行上跟在类型后面的文字，没有就用类型默认标题 */
  title: string
}

/** 解析一行 callout 标记：`> [!warning] 小心` → { type: 'warning', family: 'warning', title: '小心' }。
 * `>` 可选（阅读模式后处理拿到的是剥掉引用前缀的文本）；只看首行，多行文本的其余部分是正文。 */
export function parseCalloutMarker(raw: string): CalloutMarker | null {
  const firstLine = (raw.trim().split(/\r?\n/)[0] ?? '').trim()
  const match = /^>?\s*\[!(\w+)\]\s*(.*)$/.exec(firstLine)
  if (!match) return null
  const type = match[1]!
  const family = CALLOUT_FAMILIES[type.toLowerCase()] ?? 'note'
  const title = match[2]!.trim() || DEFAULT_TITLES[family] || type
  return { type, family, title }
}

/** 阅读模式渲染后的 DOM 后处理：把含 callout 标记的 <blockquote> 转成色块 */
export function applyCallouts(root: HTMLElement): number {
  let count = 0
  for (const quote of Array.from(root.querySelectorAll('blockquote'))) {
    const firstP = quote.querySelector('p')
    if (!firstP) continue
    const lines = (firstP.textContent ?? '').split(/\r?\n/)
    const marker = parseCalloutMarker(lines[0] ?? '')
    if (!marker) continue
    quote.classList.add('md-callout', `md-callout-${marker.family}`)
    const title = document.createElement('div')
    title.className = 'md-callout-title'
    title.textContent = marker.title
    quote.prepend(title)
    // marked 会把标题行和正文塞进同一个 <p>：标题行抽走，剩余行还原成正文段落
    const rest = lines.slice(1).join('\n').trim()
    if (rest) {
      const bodyP = document.createElement('p')
      bodyP.textContent = rest
      firstP.replaceWith(bodyP)
    } else {
      firstP.remove()
    }
    count += 1
  }
  return count
}
