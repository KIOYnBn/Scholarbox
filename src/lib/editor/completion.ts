/** 编辑器的补全/续写/H 包裹逻辑，全部是纯函数，方便单测。 */

export interface TextEdit {
  from: number
  to: number
  insert: string
  /** 插入后光标相对 insert 起点的偏移 */
  caret?: number
}

const TASK_LINE = /^(\s*)([-*+])\s+\[( |x|X)\]\s/
const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s/
const QUOTE_LINE = /^(\s*)>\s?/

function lineStartOf(text: string, pos: number): number {
  const index = text.lastIndexOf('\n', Math.max(0, pos - 1))
  return index < 0 ? 0 : index + 1
}

/** 回车时续写列表 / 任务 / 引用；空项再回车则结束列表。 */
export function continuationEdit(text: string, pos: number): TextEdit | null {
  const start = lineStartOf(text, pos)
  const line = text.slice(start, pos)
  if (line.trim() === '') return null

  const task = TASK_LINE.exec(line)
  if (task) {
    const indent = task[1] ?? ''
    const bullet = task[2] ?? '-'
    // 空任务项：回车直接退出列表，避免一直挂着空 checkbox
    if (!line.slice(task[0].length).trim()) {
      return { from: start, to: pos, insert: '' }
    }
    return { from: pos, to: pos, insert: `\n${indent}${bullet} [ ] `, caret: 1000 }
  }

  const list = LIST_LINE.exec(line)
  if (list) {
    const indent = list[1] ?? ''
    const marker = list[2] ?? '-'
    if (!line.slice(list[0].length).trim()) {
      return { from: start, to: pos, insert: '' }
    }
    const ordered = /^(\d+)[.)]$/.exec(marker)
    const next = ordered ? `${Number(ordered[1]) + 1}.` : marker
    return { from: pos, to: pos, insert: `\n${indent}${next} `, caret: 1000 }
  }

  const quote = QUOTE_LINE.exec(line)
  if (quote) {
    return { from: pos, to: pos, insert: `\n${quote[1] ?? ''}> `, caret: 1000 }
  }

  return null
}

/** 用一对标记包裹选区（选区为空时插入占位并选中它）。 */
export function wrapSelection(
  text: string,
  from: number,
  to: number,
  open: string,
  close = open,
  placeholder = '',
): TextEdit {
  const selected = text.slice(from, to)
  const inner = selected || placeholder
  return { from, to, insert: `${open}${inner}${close}`, caret: open.length }
}

/** 链接：`[文字](url)`，选区当文字。 */
export function linkEdit(text: string, from: number, to: number): TextEdit {
  const selected = text.slice(from, to) || '链接文字'
  return { from, to, insert: `[${selected}]()`, caret: selected.length + 3 }
}

/** 光标是否在 `[[ ... ` 或 `![[ ... ` 里（用于弹文件候选）。 */
export function wikiContext(
  text: string,
  pos: number,
): { from: number; to: number; query: string; embed: boolean } | null {
  const start = lineStartOf(text, pos)
  const before = text.slice(start, pos)
  const open = before.lastIndexOf('[[')
  if (open < 0) return null
  const embed = open > 0 && before[open - 1] === '!'
  const query = before.slice(open + 2)
  if (query.includes(']]')) return null
  const from = start + open
  const close = text.indexOf(']]', pos)
  return { from, to: close < 0 ? pos : close + 2, query, embed }
}

export interface WikiCandidate {
  /** 相对仓库根的路径，写进 `[[...]]` 的就是它 */
  path: string
  label: string
  kind: 'paper' | 'note' | 'asset' | 'template'
}

/**
 * 模糊匹配：先看整串包含（中文友好），再退化成「按顺序出现」的子序列匹配。
 * 分数只用于排序，不追求精妙。
 */
export function scoreCandidate(path: string, query: string): number {
  if (!query) return 1
  const haystack = path.toLowerCase()
  const needle = query.toLowerCase()
  if (haystack.endsWith(needle)) return 100
  const substring = haystack.indexOf(needle)
  if (substring >= 0) return 60 - Math.min(30, substring)

  let score = 0
  let cursor = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor)
    if (found < 0) return 0
    score += 1
    cursor = found + 1
  }
  return Math.max(1, score - 4)
}

export function rankCandidates(candidates: WikiCandidate[], query: string, limit = 8): WikiCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate.path, query) || scoreCandidate(candidate.label, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.label.localeCompare(b.candidate.label, 'zh-Hans-CN'))
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

/** `[[papers/x/origin.pdf]]` 这类引用取扩展名，用于决定是图片嵌入还是笔记卡片。 */
export function embedKindOf(path: string): 'image' | 'pdf' | 'note' {
  const lower = path.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return 'image'
  if (lower.endsWith('.pdf')) return 'pdf'
  return 'note'
}
