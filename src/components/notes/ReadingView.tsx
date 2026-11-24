import { useEffect, useMemo, useRef } from 'react'
import { resolveAssetUrl, resolveNoteImagePath } from '@/lib/asset-url'
import { renderReadingHtml } from '@/lib/notes/reading'
import { applyCallouts } from '@/lib/notes/callout'
import { applyEmbeds } from '@/lib/notes/embed'
import { isWikiHref } from '@/lib/notes/wiki'
import { useEmbedResolver } from '@/hooks/useEmbedResolver'
import { useSettingsStore } from '@/stores/settings'

interface ReadingViewProps {
  markdown: string
  /** 文献笔记的仓库内目录；独立笔记为空串 */
  paperDir: string
  onOpenWiki?: (path: string) => void
  /** 正文字号（跟编辑器共用同一个设置，阅读时也能用「Aa」调） */
  fontSize?: number
  lineHeight?: number
}

/**
 * 阅读模式：走 marked + DOMPurify 一条渲染路径，`[[wiki]]` 已在上游展开成
 * `scholarbox-wiki:` 链接，这里负责把点击接住、把图片换成真实地址。
 */
export function ReadingView({ markdown, paperDir, onOpenWiki, fontSize, lineHeight }: ReadingViewProps) {
  const allowHtml = useSettingsStore((s) => s.editor.html)
  const fontFamily = useSettingsStore((s) => s.editor.previewFontFamily)
  const resolveEmbed = useEmbedResolver()
  const containerRef = useRef<HTMLDivElement>(null)
  const { html, targets } = useMemo(
    () => renderReadingHtml(markdown, { allowHtml }),
    [markdown, allowHtml],
  )

  /* 图片：`![[assets/x.png]]` 与普通 `![alt](assets/x.png)` 都要能显示。
     后者是截图插入的写法，路径相对文献目录 —— 以前只认 `scholarbox-wiki:`，
     于是阅读模式里截图全是裂图。 */
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    // callout：`> [!note] 标题` 的引用块转成色块（Obsidian 样式）
    applyCallouts(root)
    // 嵌入：`![[笔记]]` 占位换成内联渲染的正文（防环，深度 3）
    applyEmbeds(root, paperDir, resolveEmbed, { allowHtml })
    let cancelled = false
    const images = Array.from(root.querySelectorAll('img'))
    void Promise.all(
      images.map(async (img) => {
        const raw = img.getAttribute('src') ?? ''
        if (!raw || /^(https?:|data:|blob:|file:)/i.test(raw)) return
        const url = await resolveAssetUrl(resolveNoteImagePath(raw, paperDir)).catch(() => null)
        if (cancelled) return
        if (url) img.src = url
        else img.setAttribute('data-missing', 'true')
      }),
    )
    return () => {
      cancelled = true
    }
  }, [html, paperDir, resolveEmbed, allowHtml])

  return (
    <div
      ref={containerRef}
      className="md-body h-full overflow-auto px-4 py-4"
      style={{
        fontFamily,
        ...(fontSize ? { fontSize: `${fontSize}px` } : {}),
        ...(lineHeight ? { lineHeight: String(lineHeight) } : {}),
      }}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a')
        if (!anchor) return
        const path = isWikiHref(anchor.getAttribute('href'))
        if (!path) return
        event.preventDefault()
        onOpenWiki?.(targets.get(anchor.getAttribute('href') ?? '') ?? path)
      }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
