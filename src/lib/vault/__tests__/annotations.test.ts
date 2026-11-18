import { describe, expect, it } from 'vitest'
import {
  annotationsForPage,
  annotationsToMarkdown,
  consolidateRects,
  normalizeAnnotations,
  normalizeStyles,
  resolveAnnotationStyle,
  selectionToRects,
} from '@/lib/vault/annotations'
import { normalizeMeta, parseMeta, serializeMeta } from '@/lib/vault/schema'
import type { Annotation } from '@/lib/vault/schema'

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
const clientRect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
})

describe('normalizeAnnotations', () => {
  it('drops entries without usable geometry', () => {
    const out = normalizeAnnotations([
      { page: 1, rects: [], text: 'no rects' },
      { page: 0, rects: [rect(0.1, 0.1, 0.2, 0.01)] },
      { page: 2, rects: [rect(0.1, 0.1, 0, 0)] },
      { page: 3, rects: [rect(0.2, 0.2, 0.3, 0.02)], text: 'keep me' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.page).toBe(3)
    expect(out[0]?.text).toBe('keep me')
  })

  it('falls back to safe defaults for unknown kind/colour and clamps coordinates', () => {
    const [annotation] = normalizeAnnotations([
      {
        page: 1,
        kind: 'scribble',
        color: 'chartreuse',
        rects: [rect(0.9, 0.1, 0.5, 0.02)],
      },
    ])
    expect(annotation?.kind).toBe('highlight')
    expect(annotation?.color).toBe('yellow')
    expect(annotation?.rects[0]?.x).toBeCloseTo(0.9, 5)
    expect(annotation?.rects[0]?.y).toBeCloseTo(0.1, 5)
    expect(annotation?.rects[0]?.w).toBeCloseTo(0.1, 5)
  })

  it('survives a non-array payload', () => {
    expect(normalizeAnnotations(null)).toEqual([])
    expect(normalizeAnnotations({ page: 1 })).toEqual([])
  })
})

describe('selectionToRects', () => {
  const pageBox = { left: 100, top: 200, width: 400, height: 800 }

  it('normalises client rects into page space', () => {
    const rects = selectionToRects(
      [clientRect(200, 240, 200, 16), clientRect(100, 260, 200, 16)],
      pageBox,
    )
    expect(rects[0]?.x).toBeCloseTo(0.25, 5)
    expect(rects[0]?.y).toBeCloseTo(0.05, 5)
    expect(rects[0]?.w).toBeCloseTo(0.5, 5)
    expect(rects[0]?.h).toBeCloseTo(0.02, 5)
  })

  it('merges two segments of the same visual line', () => {
    const rects = selectionToRects(
      [clientRect(100, 200, 100, 16), clientRect(203, 200, 97, 16)],
      pageBox,
    )
    expect(rects).toHaveLength(1)
    expect(rects[0]?.w).toBeCloseTo(0.5, 2)
  })

  it('clips a selection that runs past the page edge', () => {
    const rects = selectionToRects([clientRect(400, 900, 300, 16)], pageBox)
    expect(rects[0]?.x).toBeCloseTo(0.75, 3)
    expect((rects[0]?.x ?? 0) + (rects[0]?.w ?? 0)).toBeLessThanOrEqual(1)
  })

  it('ignores zero-size and off-page rects', () => {
    const rects = selectionToRects(
      [clientRect(100, 200, 0, 0), clientRect(900, 200, 40, 16)],
      pageBox,
    )
    expect(rects).toEqual([])
  })
})

describe('annotationsToMarkdown', () => {
  it('groups by page, quotes the text and keeps the note', () => {
    const md = annotationsToMarkdown(
      [
        { id: 'b', kind: 'highlight', page: 2, color: 'yellow', rects: [rect(0.1, 0.1, 0.2, 0.01)], text: 'second page text', note: '我的看法', createdAt: '' },
        { id: 'a', kind: 'underline', page: 1, color: 'blue', rects: [rect(0.1, 0.5, 0.2, 0.01)], text: 'first page text', note: '', createdAt: '' },
      ],
      { title: 'Demo' },
    )
    expect(md).toContain('## PDF 标注 · Demo')
    expect(md.indexOf('### 第 1 页')).toBeLessThan(md.indexOf('### 第 2 页'))
    expect(md).toContain('> first page text')
    expect(md).toContain('*下划线 · p.1*')
    expect(md).toContain('我的看法')
  })

  it('is empty when there is nothing to export', () => {
    expect(annotationsToMarkdown([], { title: 'Demo' })).toBe('')
  })
})

describe('meta round-trip', () => {
  it('keeps annotations through serialize → parse', () => {
    const annotations = [
      { id: 'a1', kind: 'rect' as const, page: 1, color: 'pink' as const, rects: [rect(0.2, 0.3, 0.4, 0.2)], text: '', note: '图 1 是重点', createdAt: '2025-01-01T00:00:00.000Z' },
    ]
    const meta = normalizeMeta({ title: 'T', annotations })
    const roundTrip = parseMeta(serializeMeta(meta))
    expect(roundTrip.annotations).toHaveLength(1)
    expect(roundTrip.annotations[0]?.note).toBe('图 1 是重点')
    expect(annotationsForPage(roundTrip.annotations, 1)).toHaveLength(1)
    expect(annotationsForPage(roundTrip.annotations, 2)).toHaveLength(0)
  })

  it('defaults to an empty list when meta.json predates annotations', () => {
    expect(normalizeMeta({ title: 'T' }).annotations).toEqual([])
  })
})

describe('consolidateRects', () => {
  it('collapses the "glyph box + line box" pair of one line into a single rect', () => {
    // 真实测量值：同一行的两个盒子，高度差 6px、纵向重叠 10px
    const merged = consolidateRects([
      { x: 0.1, y: 0.2, w: 0.5, h: 0.02 },
      { x: 0.1, y: 0.194, w: 0.5, h: 0.032 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.h).toBeCloseTo(0.02, 6)
  })

  it('keeps three visual lines as three rects and never lets them overlap', () => {
    const merged = consolidateRects([
      { x: 0.1, y: 0.2, w: 0.4, h: 0.022 },
      { x: 0.1, y: 0.195, w: 0.4, h: 0.034 },
      { x: 0.1, y: 0.24, w: 0.5, h: 0.022 },
      { x: 0.1, y: 0.235, w: 0.5, h: 0.034 },
      { x: 0.1, y: 0.28, w: 0.3, h: 0.022 },
    ])
    expect(merged).toHaveLength(3)
    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i]!.y).toBeGreaterThanOrEqual(merged[i - 1]!.y + merged[i - 1]!.h - 1e-6)
    }
  })

  it('takes the union of the horizontal extent of a line', () => {
    const merged = consolidateRects([
      { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
      { x: 0.35, y: 0.2, w: 0.2, h: 0.02 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.x).toBeCloseTo(0.1, 6)
    expect(merged[0]!.x + merged[0]!.w).toBeCloseTo(0.55, 6)
  })

  it('passes a single rect through untouched and drops degenerate ones', () => {
    expect(consolidateRects([{ x: 0.2, y: 0.3, w: 0.1, h: 0.02 }])).toHaveLength(1)
    expect(consolidateRects([{ x: 0.2, y: 0.3, w: 0, h: 0.02 }])).toHaveLength(0)
  })

  it('makes selectionToRects store a de-duplicated list', () => {
    const pageBox = { left: 0, top: 0, width: 500, height: 700 }
    const rects = selectionToRects(
      [
        { left: 50, top: 100, width: 200, height: 14 },
        { left: 50, top: 96, width: 200, height: 22 },
      ],
      pageBox,
    )
    expect(rects).toHaveLength(1)
  })
})

describe('annotation styles', () => {
  it('fills defaults for a meta.json written before styles existed', () => {
    const styles = normalizeStyles(undefined)
    expect(styles.highlight.opacity).toBeGreaterThan(0)
    expect(styles.strikethrough.offset).toBeCloseTo(0.5, 6)
    expect(styles.underline.offset).toBeCloseTo(0.9, 6)
  })

  it('clamps out-of-range values instead of trusting the file', () => {
    const styles = normalizeStyles({
      highlight: { opacity: 9, paddingY: -1 },
      underline: { width: 40, offset: 3 },
    })
    expect(styles.highlight.opacity).toBe(1)
    expect(styles.highlight.paddingY).toBe(0)
    expect(styles.underline.width).toBe(8)
    expect(styles.underline.offset).toBe(1)
  })

  it('migrates legacy "strike" to strikethrough but never touches underline', () => {
    const list = normalizeAnnotations([
      { id: 'a1', kind: 'strike', page: 1, rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] },
      { id: 'a2', kind: 'underline', page: 1, rects: [{ x: 0.1, y: 0.2, w: 0.2, h: 0.02 }] },
    ])
    expect(list.map((a) => a.kind)).toEqual(['strikethrough', 'underline'])
  })

  it('merges code default → paper default → per-annotation override', () => {
    const base = normalizeStyles({
      highlight: { color: '#112233', opacity: 0.5, paddingY: 0.02 },
    })
    const plain: Annotation = {
      id: 'a1',
      kind: 'highlight',
      page: 1,
      color: 'yellow',
      rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }],
      text: '',
      note: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const paperLevel = resolveAnnotationStyle(plain, base)
    expect(paperLevel).toMatchObject({ kind: 'highlight', color: '#112233', opacity: 0.5 })

    const overridden = resolveAnnotationStyle({ ...plain, style: { color: '#445566', opacity: 0.9 } }, base)
    expect(overridden).toMatchObject({ color: '#445566', opacity: 0.9, paddingY: 0.02 })
  })

  it('describes the style in the exported markdown', () => {
    const styles = normalizeStyles({ highlight: { color: '#f2c94c', opacity: 0.4 } })
    const md = annotationsToMarkdown(
      [
        {
          id: 'a1',
          kind: 'highlight',
          page: 2,
          color: 'yellow',
          rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }],
          text: '原文一句话',
          note: '我的批注',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      { title: '测试', styles },
      new Date('2026-01-02T00:00:00.000Z'),
    )
    expect(md).toContain('高亮 · p.2')
    expect(md).toContain('透明')
    expect(md).toContain('我的批注')
  })
})
