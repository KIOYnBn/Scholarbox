/**
 * 「把一段块级内容（截图）插进 Markdown」的换行规则。
 *
 * 单独立出来是因为这里全是 off-by-one：光标在行尾、在空行、在列表项下面、
 * 在文档最开头，需要的 `\n` 个数各不相同，写在组件里既难测也难改。
 *
 * 规则（看光标**之前**那部分已经有多少个连续换行）：
 * - 前面什么都没有 → 原样插；
 * - 前面已经空了一行（`\n\n`）→ 原样插，不再多空；
 * - 前面只换了一行（`一段话\n`、`- [ ] \n`）→ 补一个换行凑成空行。
 *   列表项必须走到这一支：`- [ ] ` 后面直接跟图片，会被算成列表项的内容；
 * - 光标还在某行中间（`前半句|后半句`）→ 前后各补，把段落断开而不是劈开。
 *
 * 多于两个连续换行会被吃掉多余的，避免越插越松散。
 */
export interface BlockInsertion {
  from: number
  to: number
  insert: string
}

export function blockInsertion(doc: string, from: number, to: number, block: string): BlockInsertion {
  let start = Math.max(0, Math.min(from, doc.length))
  const end = Math.max(start, Math.min(to, doc.length))

  let lineEnd = doc.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = doc.length
  const after = doc.slice(end, lineEnd)

  const head = doc.slice(0, start)
  const trailing = /\n*$/.exec(head)?.[0].length ?? 0
  const hasBefore = head.trim() !== ''

  let prefix = ''
  if (!hasBefore) {
    prefix = ''
  } else if (trailing >= 2) {
    // 已经空了一行：顺手把多出来的空行收掉，只留一个
    prefix = ''
    start -= trailing - 2
  } else if (trailing === 1) {
    prefix = '\n'
  } else {
    prefix = '\n\n'
  }

  // 后面还有正文：图片后面留一个换行，免得和下一行粘在一起
  const suffix = after.trim() !== '' ? '\n' : ''

  return { from: start, to: end, insert: `${prefix}${block}${suffix}` }
}
