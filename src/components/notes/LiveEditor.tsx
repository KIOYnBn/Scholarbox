import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { domToMarkdown } from '@/lib/markdown-edit'
import { hydrateImages } from '@/lib/asset-url'

/** 光标所在的那个顶层块（root 的直接子节点）。 */
function topLevelOf(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node
  while (current && current.parentNode !== root) current = current.parentNode
  return (current as HTMLElement | null) ?? null
}

export interface LiveEditorHandle {
  /** run a rich-text command at the caret (bold / italic / h2 / list / quote / code) */
  command: (name: LiveCommand) => void
  /** insert rendered markdown at the caret — used by the screenshot flow */
  insertImage: (args: { path: string; alt?: string; url?: string | null }) => void
  insertMarkdown: (markdown: string) => void
  focus: () => void
}

export type LiveCommand = 'bold' | 'italic' | 'strike' | 'code' | 'h2' | 'ul' | 'ol' | 'quote' | 'link'

interface LiveEditorProps {
  value: string
  paperDir: string
  /** vault-relative dir of the paper, needed to resolve `assets/…` images */
  onChange: (markdown: string) => void
  onDirty?: () => void
  handleRef: RefObject<LiveEditorHandle | null>
}

const DEBOUNCE = 320

function toggleEmpty(root: HTMLElement) {
  const empty = !root.textContent?.trim() && !root.querySelector('img')
  if (empty) root.setAttribute('data-empty', 'true')
  else root.removeAttribute('data-empty')
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

/**
 * 所见即所得编辑器。
 *
 * 渲染用 marked（和预览完全同一套），编辑用 contenteditable，回写用
 * `domToMarkdown`。三条规则保证它不会把笔记搞坏：
 * 1. 打字时只做「DOM -> markdown」的序列化，**不回渲染**，光标不跳；
 * 2. 只有外部改了 `value`（切文献、导出标注）才重渲染，且编辑器没聚焦时才动 DOM；
 * 3. 序列化结果和上一次相同就不回调，避免和自动保存互相触发。
 */
export function LiveEditor({ value, paperDir, onChange, onDirty, handleRef }: LiveEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  // 记住最后一次落在编辑器里的光标，截图/工具栏操作之后还能补回原位
  const lastRangeRef = useRef<Range | null>(null)

  useEffect(() => {
    const track = () => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root || !selection || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      if (root.contains(range.startContainer)) lastRangeRef.current = range.cloneRange()
    }
    document.addEventListener('selectionchange', track)
    return () => document.removeEventListener('selectionchange', track)
  }, [])
  /** markdown 文本 -> 我们最后一次渲染/回写的那一版，用来识别「外部修改」 */
  const lastSyncedRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paint = useCallback(
    (markdown: string) => {
      const root = rootRef.current
      if (!root) return
      root.innerHTML = renderMarkdown(markdown)
      toggleEmpty(root)
      void hydrateImages(root, paperDir)
      lastSyncedRef.current = markdown
    },
    [paperDir],
  )

  // 初次挂载 + 外部内容变化（切文献 / 导出标注 / 撤销）
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (value === lastSyncedRef.current) return
    // 正在这里打字时不要重绘，否则光标会跳回开头
    if (document.activeElement === root) {
      lastSyncedRef.current = value
      return
    }
    paint(value)
  }, [value, paint])

  const flush = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const markdown = domToMarkdown(root)
    if (markdown === lastSyncedRef.current) return
    lastSyncedRef.current = markdown
    onChange(markdown)
  }, [onChange])

  const schedule = useCallback(() => {
    onDirty?.()
    if (rootRef.current) toggleEmpty(rootRef.current)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE)
  }, [flush, onDirty])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const insertHtml = useCallback(
    (html: string) => {
      const root = rootRef.current
      if (!root) return
      const template = document.createElement('template')
      template.innerHTML = html
      const nodes = Array.from(template.content.childNodes)
      if (nodes.length === 0) return

      // 光标位置：优先用「最后一次真实光标」（截图时焦点跑到 PDF 上，window
      // selection 已经不在了，但用户脑子里的插入点还留在原处）。没有就追加到末尾
      // ——不要 focus() 了再插，Chrome 会把光标放到开头。
      const saved = lastRangeRef.current
      const usable =
        saved && saved.startContainer.isConnected && root.contains(saved.startContainer) ? saved : null

      if (usable) {
        // 图片是块级内容：塞进句子中间会把这段话劈成两半，塞进引用/列表里还会
        // 多出一堆空的 > 行。所以统一插在「光标所在的那个顶层块」后面，
        // 文字一个字都不动。
        const anchor = topLevelOf(usable.startContainer, root)
        if (anchor && anchor !== root) anchor.after(template.content)
        else if (anchor === root) {
          // 光标直接在根上（空文档）
          root.appendChild(template.content)
        }
      } else {
        root.appendChild(template.content)
      }
      const last = nodes[nodes.length - 1]
      if (last.isConnected) {
        const after = document.createRange()
        after.setStartAfter(last)
        after.collapse(true)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(after)
        lastRangeRef.current = after.cloneRange()
        root.focus({ preventScroll: true })
      }
      toggleEmpty(root)
      schedule()
    },
    [schedule],
  )

  useImperativeHandle(
    handleRef,
    (): LiveEditorHandle => ({
      command(name) {
        const root = rootRef.current
        if (!root) return
        root.focus()
        switch (name) {
          case 'bold':
            document.execCommand('bold')
            break
          case 'italic':
            document.execCommand('italic')
            break
          case 'strike':
            document.execCommand('strikeThrough')
            break
          case 'h2':
            document.execCommand('formatBlock', false, 'h2')
            break
          case 'ul':
            document.execCommand('insertUnorderedList')
            break
          case 'ol':
            document.execCommand('insertOrderedList')
            break
          case 'quote':
            document.execCommand('formatBlock', false, 'blockquote')
            break
          case 'code': {
            const selection = window.getSelection()
            const text = selection?.toString() ?? ''
            insertHtml(`<code>${escapeHtml(text || 'code')}</code>`)
            break
          }
          case 'link': {
            const selection = window.getSelection()
            const text = selection?.toString() || '链接文字'
            insertHtml(`<a href="https://">${escapeHtml(text)}</a>`)
            break
          }
        }
        schedule()
      },
      insertImage({ path, alt = 'image', url }) {
        // data-path 保真原始相对路径，src 只是显示用的（asset / blob）
        insertHtml(
          `<p><img src="${escapeHtml(url || path)}" data-path="${escapeHtml(path)}" alt="${escapeHtml(alt)}"></p>`,
        )
        void hydrateImages(rootRef.current!, paperDir)
      },
      insertMarkdown(markdown) {
        insertHtml(renderMarkdown(markdown))
      },
      focus() {
        rootRef.current?.focus()
      },
    }),
    [insertHtml, paperDir, schedule],
  )

  return (
    <div
      ref={rootRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="笔记编辑器"
      spellCheck={false}
      data-placeholder={'# 阅读笔记\n\n从这里开始记录…'}
      onInput={schedule}
      onBlur={flush}
      onPaste={(event) => {
        // 一律按纯文本粘贴：从网页复制的富文本会把笔记变成 HTML 汤
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
        schedule()
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          flush()
        }
      }}
      className="md-body md-live sb-scroll h-full overflow-y-auto px-4 py-3.5 focus:outline-none"
    />
  )
}
