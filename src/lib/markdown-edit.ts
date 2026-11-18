/**
 * DOM -> Markdown 序列化（所见即所得编辑器的回写路径）。
 *
 * 只有一条铁律：note.md 是唯一真相。所见即所得视图里的每一次修改，都要能
 * 还原成**人能读、git 能 diff** 的 Markdown，而不是退化成 HTML 汤。
 * 因此这里只手写覆盖「笔记里真会出现的那些结构」：标题、段落、加粗/斜体/
 * 行内代码/删除线、链接、图片、有序无序列表（含缩进）、引用、代码块、表格、分割线。
 * 遇到不认识的标签就退化成它的文本内容 —— 丢样式，绝不丢字。
 */

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
])

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)
}

/** 行内序列化：把一段 DOM 摊平成一行 Markdown。 */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // contenteditable 会把换行、&nbsp; 塞进文本节点里，markdown 里一律当空格
    return (node.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const inner = Array.from(el.childNodes).map(inline).join('')

  switch (el.tagName) {
    case 'STRONG':
    case 'B': {
      const text = inner.trim()
      if (!text) return inner
      // 选中文字自带 ** 时不再叠加，避免 ****粗体****
      if (text.startsWith('**') && text.endsWith('**')) return text
      return `**${text}**`
    }
    case 'EM':
    case 'I': {
      const text = inner.trim()
      if (!text) return inner
      if (text.startsWith('*') && text.endsWith('*') && !text.startsWith('**')) return text
      return `*${text}*`
    }
    case 'DEL':
    case 'S':
      return `~~${inner.trim()}~~`
    case 'CODE': {
      const text = inner.replace(/`/g, '')
      return text ? `\`${text}\`` : inner
    }
    case 'A': {
      const href = el.getAttribute('href') ?? ''
      const text = inner.trim()
      if (!text) return ''
      return `[${text}](${href})`
    }
    case 'IMG': {
      const src = el.getAttribute('src') ?? ''
      const alt = el.getAttribute('alt') ?? ''
      // 截图插入后 src 会被改写成 blob:/asset: 供显示，真实相对路径放在 data-path
      const path = el.getAttribute('data-path') || src
      return `![${alt}](${path})`
    }
    case 'BR':
      return '  \n'
    default:
      return inner
  }
}

/** 把 `pre>code` 的文本按原样保留（代码里的空格、换行不能塌）。 */
function codeBlockText(pre: HTMLElement): string {
  const code = pre.querySelector('code') ?? pre
  const lang = code.className.match(/language-([\w+-]+)/)?.[1] ?? ''
  const text = (code.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n+$/, '')
  return `\`\`\`${lang}\n${text}\n\`\`\``
}

function tableMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''
  const cells = (row: Element) =>
    Array.from(row.querySelectorAll('th,td')).map((cell) => inline(cell).trim() || ' ')
  const head = cells(rows[0]!)
  const body = rows.slice(1).map(cells)
  const widths = head.map((_, index) =>
    Math.max(3, head[index]!.length, ...body.map((row) => row[index]?.length ?? 0)),
  )
  const line = (row: string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index] ?? 3)).join(' | ')} |`
  return [line(head), `| ${widths.map((w) => '-'.repeat(Math.max(3, w))).join(' | ')} |`, ...body.map(line)].join(
    '\n',
  )
}

function listMarkdown(list: HTMLElement, indent: string): string {
  const ordered = list.tagName === 'OL'
  const items = Array.from(list.children).filter((child) => child.tagName === 'LI') as HTMLElement[]
  let index = Number(list.getAttribute('start') ?? 1) || 1
  const lines: string[] = []

  for (const item of items) {
    const marker = ordered ? `${index}.` : '-'
    index += 1
    // li 里可能嵌着段落、嵌套列表、代码块
    const parts = Array.from(item.childNodes)
    const nested = parts.filter((node) => {
      const el = node as HTMLElement
      return el.tagName === 'UL' || el.tagName === 'OL'
    }) as HTMLElement[]
    const flat = parts
      .filter((node) => !nested.includes(node as HTMLElement))
      .map((node) => (isBlock(node) ? inline(node) : inline(node)).trim())
      .filter(Boolean)
      .join(' ')

    if (!flat && item.querySelector('input[type="checkbox"]')) {
      const checked = (item.querySelector('input[type="checkbox"]') as HTMLInputElement).checked
      lines.push(`${indent}${marker} [${checked ? 'x' : ' '}] `)
    } else {
      lines.push(`${indent}${marker} ${flat}`.trimEnd())
    }

    for (const child of nested) {
      lines.push(listMarkdown(child, `${indent}  `))
    }
  }
  return lines.join('\n')
}

function block(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = inline(node).trim()
    return text
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag[1])
    const text = inline(el).trim()
    return text ? `${'#'.repeat(level)} ${text}` : ''
  }

  switch (tag) {
    case 'P': {
      const text = inline(el).trim()
      return text
    }
    case 'HR':
      return '---'
    case 'PRE':
      return codeBlockText(el)
    case 'TABLE':
      return tableMarkdown(el)
    case 'UL':
    case 'OL':
      return listMarkdown(el, '')
    case 'BLOCKQUOTE': {
      const inner = serializeChildren(el)
      return inner
        .split('\n')
        .map((line) => (line.trim() ? `> ${line}` : '>'))
        .join('\n')
    }
    case 'IMG':
      return inline(el)
    default: {
      if (BLOCK_TAGS.has(tag)) return serializeChildren(el)
      const text = inline(el).trim()
      return text
    }
  }
}

function serializeChildren(root: Node): string {
  const out: string[] = []
  let buffer: Node[] = []

  const flushInline = () => {
    if (buffer.length === 0) return
    const text = buffer.map(inline).join('').trim()
    if (text) out.push(text)
    buffer = []
  }

  for (const child of Array.from(root.childNodes)) {
    if (isBlock(child)) {
      flushInline()
      const text = block(child)
      if (text) out.push(text)
    } else {
      buffer.push(child)
    }
  }
  flushInline()

  return out.join('\n\n').replace(/\n{3,}/g, '\n\n')
}

/** DOM（或 HTML 字符串）-> Markdown。 */
export function domToMarkdown(source: HTMLElement | string): string {
  const container =
    typeof source === 'string'
      ? (() => {
          const div = document.createElement('div')
          div.innerHTML = source
          return div
        })()
      : source

  const text = serializeChildren(container)
  return `${text.replace(/\n{3,}/g, '\n\n').trim()}\n`
}
