/**
 * Mermaid 图表渲染（```mermaid 代码块）。
 *
 * mermaid 体积很大，按需动态 import：只有笔记里真的出现 mermaid 块时才加载。
 * 渲染结果按源码缓存 —— 实时预览每次按键都会重算装饰，不能反复重渲染。
 */

/** mermaid 的最小结构类型（包的类型导出与 TS 解析模式不完全兼容，自声明够用的部分） */
type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, text: string, container?: HTMLElement) => Promise<{ svg: string }>
}

let api: MermaidApi | null = null
let loading: Promise<MermaidApi> | null = null
let seq = 0
const cache = new Map<string, string>()

async function ensureMermaid(): Promise<MermaidApi> {
  if (api) return api
  if (!loading) {
    loading = import('mermaid').then((mod) => {
      const mermaid = mod.default as MermaidApi
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        // 内容来自用户自己的笔记；loose 才支持 HTML 标签的流程图节点
        securityLevel: 'loose',
        fontFamily: 'var(--sb-font, sans-serif)',
      })
      api = mermaid
      return mermaid
    })
  }
  return loading
}

/** 渲染 mermaid 源码 → svg 字符串；语法错误或环境不支持时返回 null */
export async function renderMermaidSvg(source: string): Promise<string | null> {
  const key = source.replace(/\r\n/g, '\n').trim()
  if (!key) return null
  const hit = cache.get(key)
  if (hit) return hit
  try {
    const mermaid = await ensureMermaid()
    const id = `sb-mermaid-${Date.now()}-${(seq += 1)}`
    const { svg } = await mermaid.render(id, key)
    if (cache.size > 60) {
      const oldest = cache.keys().next().value
      if (oldest) cache.delete(oldest)
    }
    cache.set(key, svg)
    return svg
  } catch {
    return null
  }
}

/** 已缓存的结果（同步取，实时预览 widget 首帧直接上屏避免闪烁） */
export function peekMermaidSvg(source: string): string | null {
  return cache.get(source.replace(/\r\n/g, '\n').trim()) ?? null
}

/** 阅读模式 DOM 后处理：把 ```mermaid 的 <pre><code> 块换成渲染出的图 */
export function applyMermaid(root: HTMLElement): void {
  const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid'))
  for (const code of blocks) {
    const pre = code.parentElement
    if (!pre) continue
    const source = code.textContent ?? ''
    const holder = document.createElement('div')
    holder.className = 'md-mermaid'
    // 先放源码占位，渲染成功后整个换掉；失败保留源码并标错误样式
    holder.textContent = source
    pre.replaceWith(holder)
    void renderMermaidSvg(source).then((svg) => {
      if (svg) {
        holder.innerHTML = svg
      } else {
        holder.classList.add('md-mermaid-error')
        holder.title = 'Mermaid 语法有误，检查图表定义'
      }
    })
  }
}
