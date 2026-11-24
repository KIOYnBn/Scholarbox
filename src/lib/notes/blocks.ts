/**
 * 块引用（Obsidian 的 `^block-id`）：
 * 行尾追加 ` ^block-id` 即给该块一个可链接的身份，`[[笔记#^block-id]]` 跳转、
 * `![[笔记#^block-id]]` 只嵌入那一块。这里只做行级块——段落/列表项/标题一行算一块。
 */

const BLOCK_ID_LINE = /^([\s\S]*\S)\s+\^([a-zA-Z0-9][a-zA-Z0-9-]*)\s*$/

/** 一行末尾的块 id；没有返回 null */
export function blockIdOnLine(raw: string): string | null {
  const match = BLOCK_ID_LINE.exec(raw.trimEnd())
  return match ? match[2]! : null
}

/** 该行的正文（去掉行尾的 ^id） */
export function stripBlockId(raw: string): string {
  const match = BLOCK_ID_LINE.exec(raw.trimEnd())
  return match ? match[1]! : raw.trimEnd()
}

export interface BlockEntry {
  id: string
  /** 行号（1 起） */
  line: number
  /** 该行正文（去掉 ^id），给补全列表当摘要 */
  excerpt: string
}

/** 扫出全篇的块 id（跳过 frontmatter 与代码围栏） */
export function extractBlockIds(body: string): BlockEntry[] {
  const out: BlockEntry[] = []
  const lines = body.split(/\r?\n/)
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
    const id = blockIdOnLine(raw)
    if (id) out.push({ id, line: index + 1, excerpt: stripBlockId(raw).slice(0, 60) })
  })
  return out
}

/** 找块 id 所在行（1 起）；找不到返回 null */
export function findBlockLine(body: string, blockId: string): number | null {
  for (const entry of extractBlockIds(body)) {
    if (entry.id === blockId) return entry.line
  }
  return null
}

/** 取块内容：该行去掉行尾 ^id；找不到返回 null */
export function extractBlock(body: string, blockId: string): string | null {
  const lines = body.split(/\r?\n/)
  let inFence = false
  let inFrontmatter = lines[0]?.trim() === '---'
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (inFrontmatter) {
      if (index > 0 && raw.trim() === '---') inFrontmatter = false
      continue
    }
    if (blockIdOnLine(raw) === blockId) return stripBlockId(raw)
  }
  return null
}
