import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { EditorState, Compartment, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { WidgetType } from '@codemirror/view'
import {
  bracketMatching,
  codeFolding,
  foldEffect,
  foldGutter,
  foldService,
  foldedRanges,
  indentOnInput,
  syntaxHighlighting,
  unfoldEffect,
  defaultHighlightStyle,
} from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { useSettingsStore, type EditorPrefs } from '@/stores/settings'
import { scanMarkdown } from '@/lib/editor/markdown-syntax'
import { blockInsertion } from '@/lib/editor/block-insert'
import { resolveAssetUrl, resolveNoteImagePath } from '@/lib/asset-url'
import { renderMarkdown } from '@/lib/markdown'
import { renderReadingHtml } from '@/lib/notes/reading'
import { applyCallouts } from '@/lib/notes/callout'
import { renderMathHtml, scanMath } from '@/lib/notes/math'
import { parseCalloutMarker } from '@/lib/notes/callout'
import { applyEmbeds, resolveEmbedContent } from '@/lib/notes/embed'
import { blockIdOnLine, extractBlockIds } from '@/lib/notes/blocks'
import { peekMermaidSvg, renderMermaidSvg } from '@/lib/notes/mermaid'
import { isImageFile } from '@/lib/notes/attachments'
import { isNoteEmbedPath, isWikiHref } from '@/lib/notes/wiki'
import { continuationEdit, wikiContext, rankCandidates, type WikiCandidate } from '@/lib/editor/completion'
import { useEmbedResolver } from '@/hooks/useEmbedResolver'

export type EditorMode = 'source' | 'live' | 'read'

export interface MarkdownEditorHandle {
  focus: () => void
  insert: (text: string) => void
  /** 插入一段块级内容（截图）：必要时自己补空行，别把图片塞进句子中间 */
  insertBlock: (text: string) => void
  /** 跳到指定行（1 起）：大纲面板点击定位用 */
  revealLine: (line: number) => void
  /** 定位到块引用 ^block-id 所在行：块链接跳转用 */
  revealBlock: (blockId: string) => void
}

interface MarkdownEditorProps {
  value: string
  mode: EditorMode
  prefs: EditorPrefs
  candidates?: WikiCandidate[]
  placeholder?: string
  handleRef?: React.MutableRefObject<MarkdownEditorHandle | null>
  onChange: (value: string) => void
  onCursorLine?: (line: number) => void
  onOpenWiki?: (path: string, embed: boolean) => void
  /** 图片相对路径的基准目录（文献笔记是 `papers/<dir>`），实时预览解析用 */
  assetBase?: string
  /** 粘贴 / 拖入图片文件时回调（保存到 attachments/ 并插正文由调用方负责） */
  onImageFiles?: (files: File[]) => void
}

const MARK_CLASS: Record<string, string> = {
  bold: 'cm-md-bold',
  italic: 'cm-md-italic',
  strike: 'cm-md-strike',
  highlight: 'cm-md-highlight',
  code: 'cm-md-code',
  link: 'cm-md-link',
  image: 'cm-md-link',
}

/** 整行只有一个图片时的写法：`![alt](assets/x.png)`，实时预览换成真图 */
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/
/** 行内的 `[[链接]]` / `[[路径|别名]]` / `![[嵌入]]`（Obsidian 语法） */
const WIKI_INLINE = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

/**
 * 「实时预览」的核心：光标外的行把语法标记藏起来、给正文套样式；光标所在行保持源码，
 * 这样既能所见即所得，又随时能改语法。
 *
 * 两类「藏起来会丢信息」的标记要换成 widget 补回来：
 * - 任务框 `- [ ]` → 勾选框
 * - 列表 `- ` / `1. ` → 圆点 / 序号（这一条以前漏了，实时预览里列表序号直接消失）
 */
/** 单行块级 HTML（`<p>…</p>`、`<details>…</details>` 这类一行写完的标签） */
function looksLikeHtmlLine(text: string): boolean {
  const t = text.trim()
  if (t.length < 7 || !t.startsWith('<')) return false
  return /^<[a-zA-Z][\w-]*(\s[^<>]*)?>/.test(t) && /<\/[a-zA-Z][\w-]*>\s*$|\/>\s*$/.test(t)
}

function previewDecorations(
  view: EditorView,
  mode: EditorMode,
  assetBase = '',
  openWiki: (path: string, embed: boolean) => void = () => undefined,
  resolveEmbed: (path: string) => string | null = () => null,
  allowHtml = true,
) {
  const active = new Set<number>()
  if (mode === 'live') {
    for (const range of view.state.selection.ranges) {
      const line = view.state.doc.lineAt(range.head).number - 1
      active.add(line)
      active.add(line + 1)
    }
  }

  const doc = view.state.doc
  const text = doc.toString()
  const lines = scanMarkdown(text)
  const visible = view.visibleRanges

  const inView = (from: number, to: number) => visible.some((range) => to >= range.from && from <= range.to)
  const touchesActive = (from: number, to: number) => {
    if (mode !== 'live') return false
    for (let n = doc.lineAt(from).number - 1; n <= doc.lineAt(to).number - 1; n += 1) {
      if (active.has(n)) return true
    }
    return false
  }

  /* 先算「整块替换」的 widget：公式、代码围栏、单行 HTML、图片、列表/任务标记。
     块级 widget 的区间可能跨多行，先占住位置，后面的 marks / hidden 都要避开。 */
  const widgets: { from: number; to: number; widget: WidgetType }[] = []

  // 行内公式：$...$ —— KaTeX 渲染，光标移进去就露源码（和 Obsidian 一致）。
  // 块级 $$…$$ 可能跨行，跨行 replace 不允许放在 plugin 里，归 StateField 管。
  for (const span of scanMath(text)) {
    if (span.display) continue
    if (!inView(span.from, span.to) || touchesActive(span.from, span.to)) continue
    widgets.push({ from: span.from, to: span.to, widget: new MathWidget(span.tex, false) })
  }

  lines.forEach((line, index) => {
    if (mode === 'live' && active.has(index)) return
    if (!inView(line.from, line.to)) return
    if (line.block === 'task' && line.checked !== undefined) {
      const [from, to] = line.hidden[0] ?? []
      if (from !== undefined && to !== undefined) {
        widgets.push({ from, to, widget: new TaskWidget(line.checked) })
      }
      return
    }
    if (line.block === 'list' && line.list) {
      // 缩进和标记一起被藏掉，层级交给行级 CSS 的悬挂缩进
      const [from, to] = line.hidden[0] ?? []
      if (from !== undefined && to !== undefined) {
        widgets.push({ from, to, widget: new ListWidget(line.list.marker, line.list.ordered) })
      }
      return
    }
    // 整行就是一张图：换成真图（截图插入的典型结果）
    const raw = doc.sliceString(line.from, line.to)
    if (line.block === 'hr') {
      widgets.push({ from: line.from, to: line.to, widget: new HrWidget() })
      return
    }
    // 行内 wiki 链接（一行可以有多个）
    WIKI_INLINE.lastIndex = 0
    let wikiMatch: RegExpExecArray | null
    while ((wikiMatch = WIKI_INLINE.exec(raw))) {
      const embed = wikiMatch[1] === '!'
      const path = wikiMatch[2]!.trim()
      const label = (wikiMatch[3] ?? path.split('/').pop() ?? path).trim()
      const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
      const at = { from: line.from + wikiMatch.index, to: line.from + wikiMatch.index + wikiMatch[0].length }
      if (embed && isImage) {
        widgets.push({ ...at, widget: new ImageWidget(path, assetBase, label) })
      } else if (embed && isNoteEmbedPath(path)) {
        // 笔记嵌入：![[笔记]] 内联渲染正文（Obsidian transclusion）
        widgets.push({ ...at, widget: new EmbedWidget(path, resolveEmbed, allowHtml, openWiki) })
      } else {
        widgets.push({ ...at, widget: new WikiLinkWidget(path, label, embed, openWiki) })
      }
    }
    const image = IMAGE_LINE.exec(raw)
    if (image) {
      widgets.push({ from: line.from, to: line.to, widget: new ImageWidget(image[2]!, assetBase, image[1] ?? '') })
      return
    }
    // 单行块级 HTML：直接渲染成真元素
    if (line.block === 'plain' && looksLikeHtmlLine(raw)) {
      widgets.push({ from: line.from, to: line.to, widget: new BlockWidget(raw) })
    }
  })

  // 代码围栏整块（``` 到 ```）与块级 $$…$$ 的渲染在 StateField `blockDecorationsField`
  // 里做：跨行的 replace 装饰不能从 ViewPlugin 出。

  const ranges: Array<ReturnType<Decoration['range']>> = []
  const marks: { from: number; to: number; cls: string }[] = []

  lines.forEach((line, index) => {
    if (mode === 'live' && active.has(index)) return
    if (!inView(line.from, line.to)) return

    // 列表 / 任务的悬挂缩进：padding 撑出层级，text-indent 只抵掉标记宽度，
    // 这样嵌套的圆点本身也跟着缩进，换行后的文字与首行对齐
    if (line.block === 'list' || line.block === 'task') {
      const hang = Math.min(line.indent + 2, 24)
      ranges.push(
        Decoration.line({
          attributes: { style: `padding-left:${hang}ch;text-indent:-2ch` },
        }).range(line.from),
      )
    }

    // callout：`> [!note] 标题` 的引用块，整行着色 + 藏掉 [!type] 标记
    if (line.block === 'quote') {
      const marker = parseCalloutMarker(doc.sliceString(line.from, line.to))
      if (marker) {
        ranges.push(Decoration.line({ class: `cm-md-callout cm-md-callout-${marker.family}` }).range(line.from))
        const markerRaw = doc.sliceString(line.from, line.to)
        const at = markerRaw.indexOf(`[!${marker.type}]`)
        if (at >= 0) {
          marks.push({ from: line.from + at, to: line.from + at + marker.type.length + 3, cls: 'cm-md-taken' })
        }
      }
    }

    const blockClass =
      line.block === 'heading'
        ? `cm-md-h${line.level}`
        : line.block === 'table'
          ? 'cm-md-table'
          : line.block === 'code'
            ? 'cm-md-fence'
            : line.block === 'quote'
              ? 'cm-md-quote'
              : ''
    if (blockClass) marks.push({ from: line.from, to: Math.max(line.from + 1, line.to), cls: blockClass })
    for (const [from, to] of line.hidden) marks.push({ from, to, cls: 'cm-md-taken' })
    for (const span of line.inlines) {
      const cls = MARK_CLASS[span.kind]
      if (cls) marks.push({ from: span.from, to: span.to, cls })
    }
  })

  for (const mark of marks) {
    if (mark.cls !== 'cm-md-taken') {
      ranges.push(Decoration.mark({ class: mark.cls }).range(mark.from, mark.to))
    }
  }

  // replace 不能重叠：widget 区间整段占位，其余要藏的标记避开它们
  const taken = widgets.map((item) => [item.from, item.to] as [number, number])
  // StateField 里的块级 widget（代码围栏、$$ 公式）也要避开
  const fieldDeco = view.state.field(blockDecorationsField, false)?.deco
  if (fieldDeco) {
    const cursor = fieldDeco.iter()
    while (cursor.value) {
      taken.push([cursor.from, cursor.to])
      cursor.next()
    }
  }
  for (const mark of marks) {
    if (mark.cls === 'cm-md-taken' && !taken.some(([a, b]) => mark.from < b && mark.to > a)) {
      ranges.push(Decoration.replace({}).range(mark.from, mark.to))
    }
  }
  for (const item of widgets) {
    ranges.push(Decoration.replace({ widget: item.widget }).range(item.from, item.to))
  }

  return Decoration.set(ranges, true)
}

/** 分割线：`---` 整行换成一个真的 hr（光标进这行就露源码，好删好改） */
class HrWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-md-hr'
    return hr
  }
  ignoreEvent() {
    return false
  }
}

/**
 * 实时预览里的笔记嵌入：`![[笔记]]` 内联渲染整篇正文（Obsidian transclusion）。
 * 渲染走完整阅读管线（wiki / 公式 / callout / 嵌套嵌入），防环靠 visited。
 */
class EmbedWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly resolve: (path: string) => string | null,
    readonly allowHtml: boolean,
    readonly openWiki: (path: string, embed: boolean) => void,
  ) {
    super()
  }
  eq(other: EmbedWidget) {
    return other.path === this.path
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-embed'
    const visited = new Set<string>()
    const body = resolveEmbedContent(this.path, this.resolve, visited)
    if (body === null) {
      wrap.classList.add('md-embed-missing')
      wrap.textContent = `找不到要嵌入的笔记：${this.path}`
      return wrap
    }
    const { html } = renderReadingHtml(body, { allowHtml: this.allowHtml })
    const inner = document.createElement('div')
    inner.innerHTML = html
    applyCallouts(inner)
    applyEmbeds(inner, '', this.resolve, { depth: 1, visited, allowHtml: this.allowHtml })
    while (inner.firstChild) wrap.appendChild(inner.firstChild)
    // 嵌入内容里的相对图片补真实地址（异步）
    for (const img of Array.from(wrap.querySelectorAll('img'))) {
      const rawSrc = img.getAttribute('src') ?? ''
      if (!rawSrc || /^(https?:|data:|blob:|file:)/i.test(rawSrc)) continue
      void resolveAssetUrl(resolveNoteImagePath(rawSrc, ''))
        .then((url) => {
          if (url) img.src = url
        })
        .catch(() => undefined)
    }
    // 嵌入内容里的 wiki 链接可点：走和外部一样的跳转
    wrap.addEventListener('click', (event) => {
      const anchor = (event.target as HTMLElement).closest('a')
      if (!anchor) return
      const target = isWikiHref(anchor.getAttribute('href'))
      if (!target) return
      event.preventDefault()
      this.openWiki(target, false)
    })
    return wrap
  }
  ignoreEvent() {
    // 嵌入内容是可交互的（链接点击），不让 CodeMirror 接管
    return true
  }
}

/**
 * 实时预览里的 `[[wiki 链接]]`：藏掉双方括号，显示成可点的链接（Obsidian 样式）。
 * 点击直接跳转：笔记进全屏编辑，PDF 回阅读器 —— 和阅读视图里的行为一致。
 * 图片嵌入 `![[x.png]]` 走 ImageWidget 渲染成真图。
 */
class WikiLinkWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly label: string,
    readonly embed: boolean,
    readonly open: (path: string, embed: boolean) => void,
  ) {
    super()
  }
  eq(other: WikiLinkWidget) {
    return other.path === this.path && other.label === this.label && other.embed === this.embed
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-md-wikilink'
    span.textContent = this.embed ? `📄 ${this.label}` : this.label
    span.title = `打开 ${this.path}`
    span.addEventListener('click', (event) => {
      event.preventDefault()
      this.open(this.path, this.embed)
    })
    return span
  }
  ignoreEvent() {
    return false
  }
}

/**
 * 实时预览里的公式：`$E=mc^2$` / `$$…$$` 用 KaTeX 渲染。
 * 光标移到公式所在行就自动露源码（active 行不走 widget），和 Obsidian 的行为一致。
 */
class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super()
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-md-math' : 'cm-md-math-inline'
    el.innerHTML = renderMathHtml(this.tex, this.display)
    return el
  }
  ignoreEvent() {
    return false
  }
}

/**
 * 实时预览里的代码围栏 / 单行 HTML：整块交给 renderMarkdown（marked + DOMPurify）
 * 渲染成真元素。挂 `md-body` 类直接复用阅读视图的样式，光标进块内露源码。
 */
class BlockWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(other: BlockWidget) {
    return other.source === this.source
  }
  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-md-block md-body'
    div.innerHTML = renderMarkdown(this.source)
    return div
  }
  ignoreEvent() {
    return false
  }
}

/** 实时预览里的 mermaid 块：光标在块外时渲染成图，点进去露源码（Obsidian 行为） */
class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(other: MermaidWidget) {
    return other.source === this.source
  }
  toDOM() {
    const div = document.createElement('div')
    div.className = 'cm-md-mermaid'
    const cached = peekMermaidSvg(this.source)
    if (cached) {
      div.innerHTML = cached
    } else {
      void renderMermaidSvg(this.source).then((svg) => {
        if (!div.isConnected) return
        if (svg) div.innerHTML = svg
        else {
          div.classList.add('md-mermaid-error')
          div.textContent = this.source
          div.title = 'Mermaid 语法有误，检查图表定义'
        }
      })
    }
    return div
  }
  ignoreEvent() {
    return false
  }
}

/** 列表圆点 / 序号 */
class ListWidget extends WidgetType {
  constructor(
    readonly marker: string,
    readonly ordered: boolean,
  ) {
    super()
  }
  eq(other: ListWidget) {
    return other.marker === this.marker && other.ordered === this.ordered
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.ordered ? 'cm-md-listmark cm-md-listmark-ordered' : 'cm-md-listmark'
    span.textContent = this.ordered ? this.marker : '•'
    return span
  }
  ignoreEvent() {
    return false
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM() {
    const box = document.createElement('span')
    box.className = this.checked ? 'cm-task cm-task-done' : 'cm-task'
    box.textContent = this.checked ? '✓' : ''
    box.setAttribute('aria-checked', String(this.checked))
    box.setAttribute('role', 'checkbox')
    return box
  }
  ignoreEvent() {
    return false
  }
}

/**
 * 实时预览里的图片：`![alt](assets/x.png)`（截图插入就是这种）整行替换成真图。
 *
 * 不这么做的话，标记被藏起来之后只剩一个裸的 alt 文字 —— 截了图却看不出截了什么。
 * 地址解析是异步的，先把 img 挂上去再回填 src；解析失败就退回原始 markdown 文本。
 */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly base: string,
    readonly alt: string,
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.base === this.base && other.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.alt = this.alt
    img.loading = 'lazy'
    img.setAttribute('data-cm-image', this.src)
    wrap.appendChild(img)

    if (/^(https?:|data:|blob:)/i.test(this.src)) {
      img.src = this.src
      return wrap
    }
    void resolveAssetUrl(resolveNoteImagePath(this.src, this.base))
      .then((url) => {
        if (url) img.src = url
        else wrap.textContent = `![${this.alt}](${this.src})`
      })
      .catch(() => {
        wrap.textContent = `![${this.alt}](${this.src})`
      })
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

/**
 * 标题折叠：按行扫描找下一个同级 / 更高级的标题，不依赖语法树。
 *
 * 为什么不用 markdown 自带的折叠：公式块里单独一行的 `=`（LaTeX 的赋值式）
 * 会被 Markdown 解析成 **setext 标题**（段落 + 下一行 `=` = 一级标题），
 * 把标题的 section 从公式块中间截断 —— 折叠范围到公式就停了，
 * 表现为「收起标题时公式收不起来」。文本扫描不受这个干扰。
 */
const headingFoldService = Prec.high(
  foldService.of((state, lineStart, lineEnd) => {
    const line = state.doc.lineAt(lineStart)
    const m = /^(#{1,6})\s/.exec(line.text)
    if (!m) return null
    const level = m[1].length
    let pos = line.to + 1
    while (pos <= state.doc.length) {
      const next = state.doc.lineAt(pos)
      const hm = /^(#{1,6})\s/.exec(next.text)
      if (hm && hm[1].length <= level) {
        // 折叠到下一个标题之前的空行；紧挨着（没有空行）就没东西可折
        const to = next.from - 1
        return to > lineEnd ? { from: lineEnd, to } : null
      }
      pos = next.to + 1
    }
    return state.doc.length > lineEnd ? { from: lineEnd, to: state.doc.length } : null
  }),
)

/* ── 块级 widget（StateField）：代码围栏整块 + 跨行的 $$…$$ ──
   CodeMirror 的规矩：跨行的 replace 装饰（块 widget）只能从 StateField / facet 出，
   放 ViewPlugin 里整片装饰会直接失效。模式与 assetBase 通过 effect 注入。 */

const setBlockConfig = StateEffect.define<{ mode: EditorMode; assetBase: string }>()

function computeBlockDecorations(state: EditorState, mode: EditorMode): DecorationSet {
  const doc = state.doc
  const text = doc.toString()
  const ranges: Array<ReturnType<Decoration['range']>> = []
  const widgets: { from: number; to: number; widget: WidgetType }[] = []

  const touchesActive = (from: number, to: number) => {
    if (mode !== 'live') return false
    const start = doc.lineAt(from).number - 1
    const end = doc.lineAt(to).number - 1
    for (const range of state.selection.ranges) {
      const head = doc.lineAt(range.head).number - 1
      if (head >= start && head <= end + 1) return true
    }
    return false
  }

  // 已被折叠的范围：块级 widget 必须让位给折叠占位符，
  // 否则「收起标题」后公式 / 代码块仍然孤零零地挂在外面（折叠与块 widget
  // 来自两个 StateField，互不知晓，重叠区间 CM 会把两者都画出来）。
  const folded = foldedRanges(state)
  const overlapsFold = (from: number, to: number) => {
    const cursor = folded.iter()
    while (cursor.value) {
      if (from < cursor.to && cursor.from < to) return true
      cursor.next()
    }
    return false
  }

  // 块级公式：光标进块内露源码
  for (const span of scanMath(text)) {
    if (!span.display || touchesActive(span.from, span.to) || overlapsFold(span.from, span.to)) continue
    widgets.push({ from: span.from, to: span.to, widget: new MathWidget(span.tex, true) })
  }

  // 代码围栏：``` 开到 ``` 整块渲染成代码块；mermaid 围栏渲染成图
  {
    let start: number | null = null
    let lang = ''
    let end = 0
    const flush = () => {
      if (start === null) return
      if (!touchesActive(start, end) && !overlapsFold(start, end)) {
        if (lang === 'mermaid') {
          // 去掉 ```mermaid 开头行与 ``` 收尾行，只留图源
          const fence = doc.sliceString(start, end)
          const lines = fence.split('\n')
          const source = lines.slice(1, lines.length - 1).join('\n').replace(/\n+$/, '')
          widgets.push({ from: start, to: end, widget: new MermaidWidget(source) })
        } else {
          widgets.push({ from: start, to: end, widget: new BlockWidget(doc.sliceString(start, end)) })
        }
      }
      start = null
      lang = ''
    }
    for (const line of scanMarkdown(text)) {
      if (line.block === 'code') {
        if (start === null) {
          start = line.from
          lang = /^```\s*([a-zA-Z0-9_-]+)/.exec(doc.sliceString(line.from, line.to))?.[1]?.toLowerCase() ?? ''
        }
        end = line.to
      } else {
        flush()
      }
    }
    flush()
  }

  for (const item of widgets) {
    ranges.push(Decoration.replace({ widget: item.widget, block: true }).range(item.from, item.to))
  }
  return Decoration.set(ranges, true)
}

const blockDecorationsField = StateField.define<{
  mode: EditorMode
  assetBase: string
  deco: DecorationSet
}>({
  create: () => ({ mode: 'live' as EditorMode, assetBase: '', deco: Decoration.none }),
  update(value, tr) {
    let { mode, assetBase } = value
    let dirty = false
    for (const effect of tr.effects) {
      if (effect.is(setBlockConfig)) {
        mode = effect.value.mode
        assetBase = effect.value.assetBase
        dirty = true
      }
      // 折叠 / 展开也要重算：折叠范围内的块级 widget 要让位给折叠占位符
      if (effect.is(foldEffect) || effect.is(unfoldEffect)) dirty = true
    }
    // 文档 / 选区变化都要重算：前者改内容，后者决定「光标进块露源码」
    if (!dirty && !tr.docChanged && !tr.selection) return value
    return { mode, assetBase, deco: computeBlockDecorations(tr.state, mode) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
})

function buildPlugin(
  mode: EditorMode,
  assetBase = '',
  openWiki?: (path: string, embed: boolean) => void,
  resolveEmbed?: (path: string) => string | null,
  allowHtml = true,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = previewDecorations(view, mode, assetBase, openWiki, resolveEmbed, allowHtml)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = previewDecorations(update.view, mode, assetBase, openWiki, resolveEmbed, allowHtml)
        }
      }
    },
    { decorations: (value) => value.decorations },
  )
}

function buildTheme(prefs: EditorPrefs): Extension {
  return EditorView.theme({
    '&': {
      fontSize: `${prefs.fontSize}px`,
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--sb-ink)',
    },
    '.cm-scroller': {
      fontFamily: prefs.fontFamily,
      lineHeight: String(prefs.lineHeight),
      padding: '4px 0',
    },
    '.cm-content': { padding: '10px 4px', caretColor: 'var(--sb-accent)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--sb-ink-3)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--sb-accent) 6%, transparent)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in oklab, var(--sb-accent) 20%, transparent)',
    },
    '.cm-md-h1': { fontSize: '1.5em', fontWeight: '650', lineHeight: '1.35' },
    '.cm-md-h2': { fontSize: '1.28em', fontWeight: '650', lineHeight: '1.4' },
    '.cm-md-h3': { fontSize: '1.14em', fontWeight: '600' },
    '.cm-md-h4, .cm-md-h5, .cm-md-h6': { fontWeight: '600' },
    '.cm-md-bold': { fontWeight: '650' },
    '.cm-md-italic': { fontStyle: 'italic' },
    '.cm-md-strike': { textDecoration: 'line-through' },
    '.cm-md-code': {
      fontFamily: prefs.fontFamily,
      backgroundColor: 'var(--sb-surface-2)',
      borderRadius: '4px',
      padding: '0 3px',
    },
    '.cm-md-link': { color: 'var(--sb-accent)', textDecoration: 'underline' },
    '.cm-md-highlight': {
      backgroundColor: 'color-mix(in oklab, #facc15 35%, transparent)',
      borderRadius: '0.2em',
      padding: '0 0.15em',
    },
    // callout 行着色（块背景 + 左侧色条；颜色跟随类型）
    '.cm-md-callout-note': { backgroundColor: 'color-mix(in oklab, #3b82f6 7%, transparent)' },
    '.cm-md-callout-abstract': { backgroundColor: 'color-mix(in oklab, #14b8a6 7%, transparent)' },
    '.cm-md-callout-tip': { backgroundColor: 'color-mix(in oklab, #22c55e 7%, transparent)' },
    '.cm-md-callout-question': { backgroundColor: 'color-mix(in oklab, #f59e0b 7%, transparent)' },
    '.cm-md-callout-warning': { backgroundColor: 'color-mix(in oklab, #f59e0b 9%, transparent)' },
    '.cm-md-callout-danger': { backgroundColor: 'color-mix(in oklab, #ef4444 8%, transparent)' },
    '.cm-md-callout-example': { backgroundColor: 'color-mix(in oklab, #8b5cf6 7%, transparent)' },
    '.cm-md-callout-quote': { backgroundColor: 'color-mix(in oklab, #94a3b8 7%, transparent)' },
    '.cm-md-quote': { color: 'var(--sb-ink-2)', borderLeft: '2px solid var(--sb-line)', paddingLeft: '8px', display: 'inline-block' },
    '.cm-md-table': { fontFamily: prefs.fontFamily, color: 'var(--sb-ink-2)' },
    '.cm-md-fence': { fontFamily: prefs.fontFamily, color: 'var(--sb-ink-2)' },
    // 列表符号：实时预览里 `- ` / `1. ` 被换成这个 widget，样式对齐 markdown 渲染结果
    '.cm-md-listmark': {
      color: 'var(--sb-accent)',
      fontWeight: '600',
      paddingRight: '0.35em',
    },
    '.cm-md-listmark-ordered': {
      color: 'var(--sb-ink-2)',
      fontVariantNumeric: 'tabular-nums',
      paddingRight: '0.3em',
    },
  })
}

export function MarkdownEditor({
  value,
  mode,
  prefs,
  candidates = [],
  placeholder,
  handleRef,
  onChange,
  onCursorLine,
  onOpenWiki,
  assetBase = '',
  onImageFiles,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  const imageFilesRef = useRef(onImageFiles)
  imageFilesRef.current = onImageFiles

  /** 粘贴截图 / 拖拽图片文件：文件直接交给上层，文本粘贴不拦（CodeMirror 自己处理） */
  const onPasteCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => isImageFile(f.name) || f.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    imageFilesRef.current?.(files)
  }
  const onDropCapture = (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => isImageFile(f.name) || f.type.startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    imageFilesRef.current?.(files)
  }
  const openWikiRef = useRef(onOpenWiki)
  openWikiRef.current = onOpenWiki
  const resolveEmbed = useEmbedResolver()
  const allowHtml = useSettingsStore((s) => s.editor.html)
  const cursorRef = useRef(onCursorLine)
  cursorRef.current = onCursorLine
  /** 这个编辑器是否被用户碰过：全新打开的笔记光标停在 0，截图不该插到开头 */
  const touchedRef = useRef(false)

  /** `[[` / `![[` 的文件候选：上下文从 ref 里取，所以不需要重建编辑器 */
  const wikiSource = useCallback((context: CompletionContext): CompletionResult | null => {
    const found = wikiContext(context.state.doc.toString(), context.pos)
    if (!found) return null
    // 块引用补全：`[[笔记#^` 列出那篇笔记的全部块 id
    const hashIdx = found.query.indexOf('#^')
    if (hashIdx >= 0) {
      const notePart = found.query.slice(0, hashIdx).trim()
      const idQuery = found.query.slice(hashIdx + 2).toLowerCase()
      const body = resolveEmbed(notePart)
      if (body === null) return null
      const options = extractBlockIds(body)
        .filter((entry) => !idQuery || entry.id.toLowerCase().includes(idQuery))
        .slice(0, 8)
        .map((entry) => ({
          label: `^${entry.id}`,
          detail: entry.excerpt,
          apply: (view: EditorView, _completion: unknown, applyFrom: number) => {
            const prefix = found.embed ? '![[' : '[['
            const insert = `${prefix}${notePart}#^${entry.id}]]`
            view.dispatch({
              changes: { from: applyFrom, to: found.to, insert },
              selection: { anchor: applyFrom + insert.length },
            })
          },
        }))
      if (!options.length) return null
      return { from: found.from, to: found.to, options }
    }
    const options = rankCandidates(candidatesRef.current, found.query).map((candidate) => ({
      label: candidate.path,
      detail: candidate.kind,
      apply: (view: EditorView, _completion: unknown, applyFrom: number) => {
        const prefix = found.embed ? '![[' : '[['
        const insert = `${prefix}${candidate.path}]]`
        view.dispatch({
          changes: { from: applyFrom, to: found.to, insert },
          selection: { anchor: applyFrom + insert.length },
        })
      },
    }))
    if (!options.length) return null
    return { from: found.from, to: found.to, options }
  }, [])

  const extras = useRef({
    mode: new Compartment(),
    options: new Compartment(),
    // editable / readOnly 单独一个 compartment：以前它和主题共用 `options`，
    // 于是「切一次模式」= 把主题、自动换行、列表续写、补全全部重置掉 ——
    // 表现就是切到源码模式字号从 23px 掉回 13.5px 的浏览器默认等宽字体。
    readonly: new Compartment(),
  })

  /** 主题 + 行号 + 折叠 + 换行 + 回车续写 + 补全：建视图时与改设置时共用同一份 */
  const buildOptions = useCallback(
    (current: EditorPrefs): Extension[] => {
      const list: Extension[] = [buildTheme(current)]
      list.push(current.lineNumbers ? lineNumbers() : [])
      list.push(current.folding ? [foldGutter(), codeFolding()] : [])
      list.push(current.softWrap ? EditorView.lineWrapping : [])
      list.push(
        keymap.of([
          {
            key: 'Enter',
            run: (view) => {
              if (!prefsRef.current.listContinuation) return false
              const selection = view.state.selection.main
              if (!selection.empty) return false
              const edit = continuationEdit(view.state.doc.toString(), selection.from)
              if (!edit) return false
              view.dispatch({
                changes: { from: edit.from, to: edit.to, insert: edit.insert },
                selection: { anchor: edit.from + edit.insert.length },
              })
              return true
            },
          },
        ]),
      )
      list.push(
        current.autocomplete
          ? autocompletion({ activateOnTyping: true, override: [wikiSource], icons: false })
          : autocompletion({ activateOnTyping: false, override: [] }),
      )
      return list
    },
    [wikiSource],
  )

  /* 只建一次：内容更新走 dispatch，不重建 EditorView（否则光标、撤销栈都会丢） */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const extensions: Extension[] = [
      markdown({ base: markdownLanguage, addKeymap: true }),
      headingFoldService,
      history(),
      drawSelection(),
      bracketMatching(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.contentAttributes.of({ 'aria-label': placeholder ?? 'Markdown 编辑器' }),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      closeBrackets(),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged && update.view.hasFocus) touchedRef.current = true
        if (update.docChanged) {
          const next = update.state.doc.toString()
          valueRef.current = next
          changeRef.current(next)
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head
          cursorRef.current?.(update.state.doc.lineAt(head).number)
        }
      }),
      extras.current.mode.of(buildPlugin(mode, assetBase, onOpenWiki, resolveEmbed, allowHtml)),
      blockDecorationsField,
      extras.current.options.of(buildOptions(prefsRef.current)),
      extras.current.readonly.of([
        EditorView.editable.of(mode !== 'read'),
        EditorState.readOnly.of(mode === 'read'),
      ]),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    })
    viewRef.current = view
    // 注入块级 widget 的初始配置（模式 + 图片基准目录）
    view.dispatch({ effects: setBlockConfig.of({ mode, assetBase }) })

    if (handleRef) {
      handleRef.current = {
        focus: () => view.focus(),
        revealLine: (line: number) => {
          const doc = view.state.doc
          const target = doc.line(Math.min(Math.max(1, line), doc.lines))
          view.dispatch({
            selection: { anchor: target.from },
            scrollIntoView: true,
          })
          view.focus()
        },
        revealBlock: (blockId: string) => {
          const doc = view.state.doc
          for (let index = 1; index <= doc.lines; index += 1) {
            const line = doc.line(index)
            if (blockIdOnLine(line.text) === blockId) {
              view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
              view.focus()
              return
            }
          }
        },
        insert: (text: string) => {
          const selection = view.state.selection.main
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: text },
            selection: { anchor: selection.from + text.length },
          })
        },
        insertBlock: (text: string) => {
          // 图片是块级内容：换行规则见 `blockInsertion`（纯函数，有单测）。
          // 从没点过编辑器的笔记，光标默认在文档开头（selection = 0），
          // 这时候插到 0 会让图片跑到标题上面去 —— 退化成追加到文末。
          const doc = view.state.doc
          const selection = view.state.selection.main
          const from = touchedRef.current ? selection.from : doc.length
          const to = touchedRef.current ? selection.to : doc.length
          const { insert } = blockInsertion(doc.toString(), from, to, text)
          touchedRef.current = true
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          })
          view.focus()
        },
      }
    }

    return () => {
      view.destroy()
      viewRef.current = null
      if (handleRef) handleRef.current = null
    }
    // 只建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 外部内容变化（切笔记、模板套用、外部导出）才回灌 */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === valueRef.current) return
    valueRef.current = value
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  /* 模式：源码 / 实时预览 / 阅读（assetBase 变了也要重建，图片地址跟着走） */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        extras.current.mode.reconfigure(buildPlugin(mode, assetBase, onOpenWiki, resolveEmbed, allowHtml)),
        // 只切「能不能编辑」，不要碰主题那一格
        extras.current.readonly.reconfigure([
          EditorView.editable.of(mode !== 'read'),
          EditorState.readOnly.of(mode === 'read'),
        ]),
        // 块级 widget（代码围栏 / $$ 公式）也要跟着换模式
        setBlockConfig.of({ mode, assetBase }),
      ],
    })
  }, [mode, assetBase, onOpenWiki, resolveEmbed, allowHtml])

  /* 开关类选项 + 字体：只重配 options 这一格 */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: extras.current.options.reconfigure(buildOptions(prefs)) })
  }, [prefs, buildOptions])

  return (
    <div
      ref={hostRef}
      onPasteCapture={onPasteCapture}
      onDropCapture={onDropCapture}
      className={cn('cm-host h-full min-h-0 overflow-hidden', prefs.guides && 'cm-guides')}
    />
  )
}
