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
