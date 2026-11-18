import { describe, expect, it } from 'vitest'
import {
  SPINE_MAX_WIDTH,
  SPINE_MIN_WIDTH,
  STATUS_ORDER,
  UNCATEGORIZED,
  UNTAGGED,
  buildShelves,
  shelfTone,
  spineAuthor,
  spineTitle,
  spineWidth,
  spineSubtitle,
  spineYear,
} from '@/lib/shelf'
import { normalizeMeta, type PaperMeta, type PaperRecord, type PaperStatus } from '@/lib/vault/schema'
import { itemFromPaper, type LibraryItem } from '@/lib/library/item'

function paper(partial: Partial<PaperMeta> & { dir?: string }): PaperRecord {
  const { dir, ...rest } = partial
  const meta = normalizeMeta(rest, {})
  return {
    dir: dir ?? `papers/${meta.title}`,
    meta,
    metaOk: true,
    note: '',
    hasPdf: false,
    pdfSize: 0,
    assets: [],
    path: `papers/${dir ?? meta.title}`,
  }
}

function byStatus(status: PaperStatus, title: string): PaperRecord {
  return paper({ title, status })
}

/** 分架只吃 LibraryItem，测试里做一次适配，避免到处写 18 个字段 */
function item(partial: Partial<PaperMeta> & { dir?: string }): LibraryItem {
  return itemFromPaper(paper(partial))
}

describe('buildShelves · 领域', () => {
  const papers = [
    paper({ title: 'A', field: '信息检索' }),
    paper({ title: 'B', field: '信息检索' }),
    paper({ title: 'C', field: '机器翻译' }),
    paper({ title: 'D' }),
  ]

  it('按领域分组，计数多的排前面', () => {
    // 组内顺序现在由排序键决定（默认 recent），这里显式用 title 让断言稳定
    const shelves = buildShelves(papers.map((paper) => itemFromPaper(paper)), 'field', 'title')
    expect(shelves.map((shelf) => shelf.label)).toEqual(['信息检索', '机器翻译', UNCATEGORIZED])
    expect(shelves[0]?.items.map((item) => item.title)).toEqual(['A', 'B'])
  })

  it('没有领域的文献归到「未分类」，空分组不出现', () => {
    const shelves = buildShelves([item({ title: 'X' })], 'field')
    expect(shelves).toHaveLength(1)
    expect(shelves[0]?.key).toBe(UNCATEGORIZED)
  })

  it('空输入得到空书架，而不是一个空分组', () => {
    expect(buildShelves([], 'field')).toEqual([])
  })

  it('相邻两层不会撞色', () => {
    const many = ['甲', '乙', '丙', '丁', '戊', '己'].flatMap((field) =>
      Array.from({ length: 6 }, (_, index) => paper({ title: `${field}-${index}`, field })),
    )
    const shelves = buildShelves(many.map((paper) => itemFromPaper(paper)), 'field')
    for (let index = 1; index < shelves.length; index += 1) {
      expect(shelves[index]!.tone).not.toBe(shelves[index - 1]!.tone)
    }
  })

  it('同一个领域名永远同一个主题色', () => {
    const first = buildShelves(papers.map((paper) => itemFromPaper(paper)), 'field')[0]!
    const again = buildShelves([...papers].reverse().map((paper) => itemFromPaper(paper)), 'field').find((shelf) => shelf.key === first.key)!
    expect(again.tone).toBe(first.tone)
  })
})

describe('buildShelves · 阅读状态', () => {
  it('按「在读 → 待读 → 已读 → 归档」固定顺序，与数量无关', () => {
    const shelves = buildShelves(
      [byStatus('done', 'd1'), byStatus('archived', 'a1'), byStatus('reading', 'r1'), byStatus('todo', 't1'), byStatus('todo', 't2')].map(
        (paper) => itemFromPaper(paper),
      ),
      'status',
    )
    expect(shelves.map((shelf) => shelf.key)).toEqual(['reading', 'todo', 'done', 'archived'])
    expect(shelves.map((shelf) => shelf.label)).toEqual(['在读', '待读', '已读', '归档'])
    expect(STATUS_ORDER).toEqual(['reading', 'todo', 'done', 'archived'])
  })

  it('只保留实际存在的状态', () => {
    const shelves = buildShelves([itemFromPaper(byStatus('reading', 'r1'))], 'status')
    expect(shelves).toHaveLength(1)
    expect(shelves[0]?.key).toBe('reading')
  })

  it('未知状态不会崩，落到末尾并按原值展示', () => {
    const weird = paper({ title: 'w' })
    weird.meta = { ...weird.meta, status: 'lost' as PaperStatus }
    const shelves = buildShelves([itemFromPaper(weird), itemFromPaper(byStatus('reading', 'r'))], 'status')
    expect(shelves.map((shelf) => shelf.key)).toEqual(['reading', 'lost'])
  })
})

describe('spineWidth · 书脊厚度', () => {
  it('重要性越高越宽，且单调不减', () => {
    const widths = [1, 2, 3, 4, 5].map(spineWidth)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
    expect(widths[0]).toBe(SPINE_MIN_WIDTH)
    expect(widths[4]).toBe(SPINE_MAX_WIDTH)
    expect(new Set(widths).size).toBe(5)
  })

  it('越界和脏数据都夹到合法范围', () => {
    expect(spineWidth(0)).toBe(SPINE_MIN_WIDTH)
    expect(spineWidth(9)).toBe(SPINE_MAX_WIDTH)
    expect(spineWidth(Number.NaN)).toBe(spineWidth(3))
    expect(spineWidth(2.6)).toBe(spineWidth(3))
  })
})

describe('书脊文案', () => {
  it('标题为空时给占位文案', () => {
    expect(spineTitle(item({}))).toBe('未命名文献')
  })

  it('多作者只显示第一作者并加「等」', () => {
    expect(spineAuthor(item({ title: 't', authors: ['Vaswani, A.'] }))).toBe('Vaswani, A.')
    expect(spineAuthor(item({ title: 't', authors: ['Vaswani, A.', 'Shazeer, N.'] }))).toBe(
      'Vaswani, A. 等',
    )
    expect(spineAuthor(item({ title: 't' }))).toBe('佚名')
  })

  it('缺年份用破折号而不是 "null"', () => {
    expect(spineYear(item({ title: 't' }))).toBe('——')
    expect(spineYear(item({ title: 't', year: 2024 }))).toBe('2024')
  })
})

describe('shelfTone', () => {
  it('稳定、可复现，且不会返回 undefined', () => {
    const key = '信息检索与问答系统'
    expect(shelfTone(key)).toBe(shelfTone(key))
    expect(shelfTone('')).toBeTruthy()
    expect(shelfTone('a')).toBeTruthy()
  })

  it('不同领域能落到不同色调上（不是永远一个色）', () => {
    const tones = new Set(['信息检索', '机器翻译', '计算机视觉', '强化学习', '数据库'].map(shelfTone))
    expect(tones.size).toBeGreaterThan(1)
  })
})

describe('标签分架（笔记书架）', () => {
  it('一篇多标签的笔记出现在多个架里', () => {
    const a = item({ title: 'A', field: '信息检索', tags: ['retrieval', 'agent'] })
    const b = item({ title: 'B', field: '信息检索', tags: ['retrieval'] })
    // 显式给排序键：默认的 'recent' 看 createdAt/lastViewedAt，两条数据同一毫秒内
    // 构造时顺序不稳定（曾让这条测试偶发失败）
    const shelves = buildShelves([a, b], 'tag', 'title')
    const byKey = new Map(shelves.map((shelf) => [shelf.key, shelf]))

    expect(byKey.get('retrieval')?.items.map((entry) => entry.title)).toEqual(['A', 'B'])
    expect(byKey.get('agent')?.items.map((entry) => entry.title)).toEqual(['A'])
    // 多归属：条目数之和可以大于条目总数
    expect(shelves.reduce((total, shelf) => total + shelf.items.length, 0)).toBe(3)
  })

  it('没有标签的笔记归到「无标签」，不会被静默丢掉', () => {
    const shelves = buildShelves([item({ title: '无标签的' })], 'tag')
    expect(shelves).toHaveLength(1)
    expect(shelves[0]!.label).toBe(UNTAGGED)
    expect(shelves[0]!.items).toHaveLength(1)
  })

  it('标签架按数量降序，同数量按标签名', () => {
    const shelves = buildShelves(
      [
        item({ title: 'A', tags: ['b', 'a'] }),
        item({ title: 'B', tags: ['a'] }),
      ],
      'tag',
    )
    expect(shelves.map((shelf) => shelf.label)).toEqual(['a', 'b'])
  })

  it('同一个标签永远同一个色（跨调用稳定）', () => {
    const first = buildShelves([item({ title: 'A', tags: ['retrieval'] })], 'tag')[0]!
    const second = buildShelves([item({ title: 'B', tags: ['retrieval'] })], 'tag')[0]!
    expect(first.tone).toBe(second.tone)
  })
})

describe('笔记书脊副行', () => {
  it('笔记显示分类名，文献显示第一作者', () => {
    const note = itemFromPaper(paper({ title: 'n', field: '机器翻译' }), 'note')
    expect(spineSubtitle(itemFromPaper(paper({ title: 'p', authors: ['Vaswani, A.'] })))).toBe('Vaswani, A.')
    expect(spineSubtitle(note)).toBe('机器翻译')
  })

  it('笔记没有分类时给「未分类」，不返回空串', () => {
    expect(spineSubtitle(itemFromPaper(paper({ title: 'n' }), 'note'))).toBe(UNCATEGORIZED)
  })
})
