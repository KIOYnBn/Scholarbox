import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  anchoredScrollTop,
  computeLayout,
  pageAtOffset,
  ratioWithinPage,
  zoomFromWheel,
} from '../layout'

const sizes = [
  { width: 600, height: 800 },
  { width: 600, height: 800 },
  { width: 600, height: 800 },
]

describe('computeLayout', () => {
  it('页面之间留 PAGE_GAP、顶部留 STACK_PAD_Y', () => {
    const layout = computeLayout(sizes, null, 1)
    expect(layout.offsets).toEqual([26, 26 + 800 + 18, 26 + (800 + 18) * 2])
    expect(layout.heights).toEqual([800, 800, 800])
    expect(layout.total).toBe(26 + (800 + 18) * 3 - 18 + 26)
  })

  it('缩放只改高度与总高，偏移按比例一起变', () => {
    const layout = computeLayout(sizes, null, 2)
    expect(layout.heights[0]).toBe(1600)
    expect(layout.offsets[1]).toBe(26 + 1600 + 18)
  })

  it('未测量页用 estimate 兜底', () => {
    const layout = computeLayout([sizes[0]!, null], { width: 500, height: 1000 }, 1)
    expect(layout.heights[1]).toBe(1000)
  })
})

describe('pageAtOffset', () => {
  it('探针落在页内返回该页（1-based）', () => {
    const { offsets } = computeLayout(sizes, null, 1)
    expect(pageAtOffset(offsets, 0)).toBe(1)
    expect(pageAtOffset(offsets, 30)).toBe(1)
    expect(pageAtOffset(offsets, 26 + 800 + 18 + 5)).toBe(2)
  })

  it('空布局返回 1', () => {
    expect(pageAtOffset([], 500)).toBe(1)
  })
})

describe('锚点缩放', () => {
  it('缩放后光标下的点仍在原处', () => {
    const before = computeLayout(sizes, null, 1)
    const after = computeLayout(sizes, null, 2)
    // 光标停在第 2 页中间：scrollTop 让它进入视口
    const scrollTop = before.offsets[1]!
    const anchorY = 200
    const page = pageAtOffset(before.offsets, scrollTop + anchorY)
    const ratio = ratioWithinPage(scrollTop, anchorY, before.offsets[page - 1]!, before.heights[page - 1]!)
    const next = anchoredScrollTop({ page, ratio, before, after, anchorY })

    // 缩放后同一页、同一相对位置落回光标处
    const newPage = pageAtOffset(after.offsets, next + anchorY)
    expect(newPage).toBe(2)
    const newRatio = ratioWithinPage(next, anchorY, after.offsets[1]!, after.heights[1]!)
    expect(newRatio).toBeCloseTo(ratio, 6)
  })

  it('缩放前后页码保持不变（不跳页）', () => {
    const before = computeLayout(sizes, null, 1)
    const after = computeLayout(sizes, null, 0.5)
    const scrollTop = before.offsets[2]! + 100
    const anchorY = 300
    const page = pageAtOffset(before.offsets, scrollTop + anchorY)
    const ratio = ratioWithinPage(scrollTop, anchorY, before.offsets[page - 1]!, before.heights[page - 1]!)
    const next = anchoredScrollTop({ page, ratio, before, after, anchorY })
    expect(pageAtOffset(after.offsets, next + anchorY)).toBe(page)
  })

  it('ratio 被夹在 0..1，负 scrollTop 不出现', () => {
    expect(ratioWithinPage(-500, 10, 0, 800)).toBe(0)
    expect(ratioWithinPage(10_000, 10, 0, 800)).toBe(1)
    const after = computeLayout(sizes, null, 4)
    expect(anchoredScrollTop({ page: 1, ratio: 0, before: after, after, anchorY: 9999 })).toBe(0)
  })
})

describe('zoomFromWheel', () => {
  it('向上滚放大、向下滚缩小', () => {
    expect(zoomFromWheel(1, -100)).toBeGreaterThan(1)
    expect(zoomFromWheel(1, 100)).toBeLessThan(1)
  })

  it('夹在 50%–400%', () => {
    expect(zoomFromWheel(MIN_ZOOM, 10_000)).toBe(MIN_ZOOM)
    expect(zoomFromWheel(MAX_ZOOM, -10_000)).toBe(MAX_ZOOM)
  })

  it('反复放大不会越过上限', () => {
    let zoom = 1
    for (let i = 0; i < 200; i += 1) zoom = zoomFromWheel(zoom, -200)
    expect(zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })
})
