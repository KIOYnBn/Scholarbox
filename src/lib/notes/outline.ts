/**
 * 笔记大纲：抽出标题层级，给「大纲面板」用。
 * 跳过 frontmatter 与代码围栏 —— 围栏里的 `#` 注释不是标题。
 */

export interface OutlineEntry {
  /** 标题级别 1..6 */
  level: number
  text: string
  /** 行号（1 起，编辑器里可直接定位） */
  line: number
}

export function extractOutline(markdown: string): OutlineEntry[] {
  const lines = markdown.split(/\r?\n/)
  const out: OutlineEntry[] = []
  let inFence = false
  let inFrontmatter = lines[0]?.trim() === '---'

  lines.forEach((raw, index) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    if (inFrontmatter) {
      if (index > 0 && raw.trim() === '---') inFrontmatter = false
      return
    }
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(raw)
    if (match) out.push({ level: match[1]!.length, text: match[2]!, line: index + 1 })
  })

  return out
}

/**
 * 给渲染好的阅读视图标题打上源行号锚点（data-outline-line），
 * 阅读模式下大纲面板点击就能滚动定位。
 *
 * 按出现顺序与 extractOutline 的条目一一对应；嵌入块（.md-embed）里的
 * 标题来自别的笔记，跳过不打。
 */
export function applyOutlineAnchors(root: HTMLElement, markdown: string): void {
  const entries = extractOutline(markdown)
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !el.closest('.md-embed'),
  )
  const count = Math.min(headings.length, entries.length)
  for (let index = 0; index < count; index += 1) {
    headings[index]!.dataset.outlineLine = String(entries[index]!.line)
  }
}
