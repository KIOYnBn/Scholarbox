import { describe, expect, it } from 'vitest'
import { NO_FIELD, groupByField, sortItems } from '@/lib/library/filter'
import { UNCATEGORIZED, buildShelves } from '@/lib/shelf'
import { itemFromPaper } from '@/lib/library/item'
import { normalizeMeta, type PaperMeta, type PaperRecord } from '@/lib/vault/schema'

/**
 * 置顶的语义是「分类内置顶」，不是「全局置顶」。
 *
 * 这三组测试锁的是同一条规则：pinned 只在与「同组条目」比较时生效，
 * 平铺列表里没有组，它就不该影响顺序。
 */

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

function item(partial: Partial<PaperMeta> & { dir?: string }) {
  return itemFromPaper(paper(partial))
}

describe('列表视图 · 按分类分组', () => {
  const items = [
    item({ title: 'A-普通', field: '信息检索', importance: 4 }),
    item({ title: 'A-置顶', field: '信息检索', importance: 1, pinned: true }),
    item({ title: 'B-普通', field: '机器翻译', importance: 5 }),
    item({ title: '无分类-置顶', field: '', pinned: true }),
  ]

  it('组内置顶最前，组间按条数降序', () => {
    const groups = groupByField(items, 'importance')
    expect(groups.map((group) => group.label)).toEqual(['信息检索', '机器翻译', NO_FIELD])

    // 信息检索组里，1 星但置顶的排在 4 星前面 —— 置顶只在组内说话
    expect(groups[0]!.items.map((entry) => entry.title)).toEqual(['A-置顶', 'A-普通'])
  })

  it('分类为空的项归入「未分类」组，置顶在其中照常生效', () => {
    const groups = groupByField(
      [item({ title: '裸的', field: '', importance: 5 }), item({ title: '裸的置顶', field: '', pinned: true })],
      'importance',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe(NO_FIELD)
    expect(groups[0]!.items.map((entry) => entry.title)).toEqual(['裸的置顶', '裸的'])
  })

  it('置顶不会把条目拉到别的组去', () => {
    const groups = groupByField(items, 'importance')
    const titlesInRetrieval = groups[0]!.items.map((entry) => entry.title)
    expect(titlesInRetrieval).not.toContain('无分类-置顶')
    expect(titlesInRetrieval).not.toContain('B-普通')
  })
})

describe('列表视图 · 不分组时置顶不影响排序', () => {
  const items = [
    item({ title: '旧的', importance: 1, pinned: true }),
    item({ title: '重的', importance: 5 }),
  ]

  it('平铺按重要性排，pinned 不插队', () => {
    const flat = sortItems(items, 'importance', { pinnedFirst: false })
    expect(flat.map((entry) => entry.title)).toEqual(['重的', '旧的'])
  })

  it('同一条规则在分组时反过来了 —— 这就是「组内置顶」的全部含义', () => {
    const groups = groupByField(items, 'importance')
    const flat = groups.flatMap((group) => group.items.map((entry) => entry.title))
    expect(flat).toEqual(['旧的', '重的'])
  })
})

describe('书架 · 置顶只在所属层最前', () => {
  const items = [
    item({ title: '检索-普通', field: '信息检索', importance: 4 }),
    item({ title: '检索-置顶', field: '信息检索', importance: 2, pinned: true }),
    item({ title: '翻译-普通', field: '机器翻译', importance: 5 }),
    item({ title: '翻译-置顶', field: '机器翻译', importance: 1, pinned: true }),
  ]

  it('每一层各自把置顶排前，层间不受影响', () => {
    const shelves = buildShelves(items, 'field', 'importance')
    const byLabel = new Map(shelves.map((shelf) => [shelf.label, shelf.items.map((entry) => entry.title)]))
    expect(byLabel.get('信息检索')).toEqual(['检索-置顶', '检索-普通'])
    expect(byLabel.get('机器翻译')).toEqual(['翻译-置顶', '翻译-普通'])
  })

  it('按阅读状态分架时同样只在本组内生效', () => {
    const shelves = buildShelves(
      [
        item({ title: '在读-普通', field: '信息检索', status: 'reading' }),
        item({ title: '在读-置顶', field: '信息检索', status: 'reading', pinned: true }),
        item({ title: '已读-置顶', field: '信息检索', status: 'done', pinned: true }),
      ],
      'status',
      'importance',
    )
    const byLabel = new Map(shelves.map((shelf) => [shelf.label, shelf.items.map((entry) => entry.title)]))
    expect(byLabel.get('在读')).toEqual(['在读-置顶', '在读-普通'])
    expect(byLabel.get('已读')).toEqual(['已读-置顶'])
  })

  it('未分类那一层里的置顶也生效', () => {
    const shelves = buildShelves(
      [item({ title: '未分类-普通' }), item({ title: '未分类-置顶', pinned: true })],
      'field',
    )
    expect(shelves).toHaveLength(1)
    expect(shelves[0]!.key).toBe(UNCATEGORIZED)
    expect(shelves[0]!.items[0]!.title).toBe('未分类-置顶')
  })
})
