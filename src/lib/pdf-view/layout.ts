/**
 * 页面堆叠布局的纯函数。
 *
 * 抽出来的原因：Ctrl+滚轮缩放要「以指针为锚点」重排滚动位置，这件事必须在
 * React 重新渲染**之前**就能算出新的页面偏移量。把这段算术留在组件里就没法
 * 单测，也容易和渲染时的布局算出两份不同的数。
 */

export interface PageSize {
  width: number
  height: number
}

export interface StackLayout {
  /** 每页顶边相对滚动内容顶部的偏移，px */
  offsets: number[]
  /** 每页渲染后的高度（已乘 scale），px */
  heights: number[]
  /** 滚动内容总高度 */
  total: number
}

export const PAGE_GAP = 18
export const STACK_PAD_Y = 26

/** 页面之间留 18px 间隔、上下各留 26px 边距 —— 与渲染时的常量保持一致。 */
export function computeLayout(
  sizes: (PageSize | null | undefined)[],
  estimate: PageSize | null | undefined,
  scale: number,
): StackLayout {
  const offsets: number[] = []
  const heights: number[] = []
  let y = STACK_PAD_Y
  for (const size of sizes) {
    const page = size ?? estimate
    const height = page?.height ?? 800
    offsets.push(y)
    heights.push(height * scale)
    y += height * scale + PAGE_GAP
  }
  return { offsets, heights, total: Math.max(y - PAGE_GAP + STACK_PAD_Y, 0) }
}

/** 视口探针（scrollTop + 视口高度 * 0.34）落在第几页，1-based。 */
export function pageAtOffset(offsets: number[], probe: number): number {
  if (!offsets.length) return 1
  let page = 1
  for (let i = 0; i < offsets.length; i += 1) {
    if ((offsets[i] ?? 0) <= probe) page = i + 1
  }
  return page
}

export interface AnchorInput {
  /** 缩放前：光标所在的 1-based 页码 */
  page: number
  /** 缩放前：光标在该页内的相对位置 0..1 */
  ratio: number
  /** 缩放前布局 */
  before: StackLayout
  /** 缩放后布局 */
  after: StackLayout
  /** 光标相对滚动视口顶部的像素距离 */
  anchorY: number
}

/**
 * 缩放后应该把 scrollTop 设成多少，才能让光标下的那一点停在原地。
 * 页码不变是因为锚点所在的页仍然是同一页 —— 这也顺带保证了「缩放不跳页」。
 */
export function anchoredScrollTop({ page, ratio, after, anchorY }: AnchorInput): number {
  const index = Math.min(Math.max(0, page - 1), after.offsets.length - 1)
  if (index < 0) return 0
  const offset = after.offsets[index] ?? 0
  const height = after.heights[index] ?? 0
  return Math.max(0, offset + ratio * height - anchorY)
}

/** 光标落在某一页内部的位置（0..1），用于缩放前后配对。 */
export function ratioWithinPage(scrollTop: number, anchorY: number, offset: number, height: number): number {
  if (height <= 0) return 0
  const local = scrollTop + anchorY - offset
  return Math.min(1, Math.max(0, local / height))
}

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4

/** Ctrl+滚轮：向上滚（deltaY < 0）放大。指数映射让快慢滚都顺手。 */
export function zoomFromWheel(current: number, deltaY: number, factor = 0.0015): number {
  const next = current * Math.exp(-deltaY * factor)
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next.toFixed(4))))
}
