import katex from 'katex'
// KaTeX 自己的样式（字体 + 排版），不引入的话公式会渲染成一堆没对齐的 span
import 'katex/dist/katex.min.css'

/**
 * 行内 / 块级公式的识别与渲染。
 *
 * 规则和 Obsidian 一致：
 * - `$...$` 行内公式（不能跨行，`$` 后面不能是空格，避免把「$5 和 $10」当成公式）；
 * - `$$...$$` 块级公式，可以跨行；
 * - 代码围栏与行内代码里的 `$` 不算公式。
 *
 * 渲染失败不抛错：把原文原样显示出来 —— 打错一个括号就把整篇笔记渲染崩掉太糟糕了。
 */

export interface MathSpan {
  /** 在原文里的起止（含 `$` 定界符） */
  from: number
  to: number
  tex: string
  display: boolean
}

const FENCE = /^```|^~~~/

/**
 * 扫出所有公式区间。返回的顺序按 from 升序。
 * `text` 是整篇文档（含换行）。
 */
export function scanMath(text: string): MathSpan[] {
  const spans: MathSpan[] = []
  const lines = text.split('\n')
  let cursor = 0
  let inFence = false
  let blockStart = -1
  let blockBody: string[] = []

  for (const raw of lines) {
    const lineFrom = cursor
    cursor += raw.length + 1

    if (FENCE.test(raw.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // 续上上一行的块级公式
    if (blockStart >= 0) {
      const close = raw.indexOf('$$')
      if (close >= 0) {
        blockBody.push(raw.slice(0, close))
        const tex = blockBody.join('\n').trim()
        if (tex) {
          spans.push({ from: blockStart, to: lineFrom + close + 2, tex, display: true })
        }
        blockStart = -1
        blockBody = []
        // 闭合之后同一行若还有行内公式，交给下面的行内扫描
        const rest = raw.slice(close + 2)
        if (rest.includes('$')) scanInlineMath(rest, lineFrom + close + 2, spans)
      } else {
        blockBody.push(raw)
      }
      continue
    }

    const openBlock = raw.indexOf('$$')
    if (openBlock >= 0) {
      const close = raw.indexOf('$$', openBlock + 2)
      if (close >= 0) {
        const tex = raw.slice(openBlock + 2, close).trim()
        if (tex) spans.push({ from: lineFrom + openBlock, to: lineFrom + close + 2, tex, display: true })
        const rest = raw.slice(close + 2)
        if (rest.includes('$')) scanInlineMath(rest, lineFrom + close + 2, spans)
      } else {
        blockStart = lineFrom + openBlock
        blockBody = [raw.slice(openBlock + 2)]
      }
      continue
    }

    if (raw.includes('$')) scanInlineMath(raw, lineFrom, spans)
  }

  return spans.sort((a, b) => a.from - b.from)
}

/** 行内的 `$...$`：`$` 后不能紧跟空格，闭合的 `$` 前也不能是空格 */
function scanInlineMath(line: string, lineFrom: number, out: MathSpan[]) {
  // 先挖掉行内代码，避免 `` `$x$` `` 被当成公式
  const masked = line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
  let index = 0
  while (index < masked.length) {
    const open = masked.indexOf('$', index)
    if (open < 0) break
    if (masked[open + 1] === '$') {
      index = open + 2
      continue
    }
    if (open + 1 >= masked.length || masked[open + 1] === ' ') {
      index = open + 1
      continue
    }
    let close = -1
    for (let i = open + 1; i < masked.length; i += 1) {
      if (masked[i] !== '$') continue
      if (masked[i - 1] === ' ' || masked[i - 1] === '\\') continue
      if (masked[i + 1] === '$') continue
      close = i
      break
    }
    if (close < 0) break
    const tex = line.slice(open + 1, close)
    out.push({ from: lineFrom + open, to: lineFrom + close + 1, tex, display: false })
    index = close + 1
  }
}

/** 渲染成 HTML；出错就把原文交回去，不抛 */
export function renderMathHtml(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      // 只要 HTML 输出：MathML 会被 DOMPurify 洗掉，反而两边都不显示
      output: 'html',
      strict: false,
      trust: false,
    })
  } catch {
    return escapeHtml(display ? `$$${tex}$$` : `$${tex}$`)
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 给 marked 之前用：把公式换成占位符，渲染完再塞回 KaTeX 的 HTML。
 * 这样不用给 marked 写扩展，也不用担心它把 `_` `*` 当成强调语法。
 */
export function maskMath(markdown: string): { masked: string; restore: (html: string) => string } {
  const spans = scanMath(markdown)
  if (!spans.length) return { masked: markdown, restore: (html) => html }

  let masked = ''
  let cursor = 0
  const pieces: string[] = []
  spans.forEach((span, index) => {
    masked += markdown.slice(cursor, span.from)
    const token = `MATHPLACEHOLDER${index}X`
    masked += token
    pieces.push(renderMathHtml(span.tex, span.display))
    cursor = span.to
  })
  masked += markdown.slice(cursor)

  return {
    masked,
    restore: (html) => {
      let out = html
      pieces.forEach((piece, index) => {
        // marked 可能把占位符包进 <p>，块级公式要把那层 <p> 去掉
        out = out.replace(new RegExp(`<p>\\s*MATHPLACEHOLDER${index}X\\s*</p>`, 'g'), piece)
        out = out.split(`MATHPLACEHOLDER${index}X`).join(piece)
      })
      return out
    },
  }
}
