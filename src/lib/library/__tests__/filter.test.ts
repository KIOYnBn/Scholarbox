import { describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { VaultRepository } from '@/lib/vault/repository'
import { normalizeMeta, type PaperMeta, type PaperRecord } from '@/lib/vault/schema'
import type { StandaloneNote } from '@/lib/notes/repository'
import { itemFromNote, itemFromPaper, statusLabel, statusOrderFor } from '@/lib/library/item'
import {
  EMPTY_ITEM_FILTER,
  filterItems,
  isEmptyFilter,
  fieldFacets,
  sortItems,
  tagFacets,
  type ItemFilter,
} from '@/lib/library/filter'

function paperRecord(meta: Partial<PaperMeta> & { dir?: string } = {}): PaperRecord {
  const { dir, ...rest } = meta
  const normalized = normalizeMeta(rest, {})
  return {
    dir: dir ?? 'papers/demo',
    meta: normalized,
    metaOk: true,
    note: '# 笔记\n\n正文',
    hasPdf: true,
    pdfSize: 1024,
    assets: [],
    path: `papers/${dir ?? 'demo'}`,
  }
}

function noteRecord(partial: Partial<StandaloneNote> = {}): StandaloneNote {
  return {
    file: 'demo.md',
    slug: 'demo',
    title: '示例笔记',
    tags: [],
    field: '',
    importance: 3,
    status: 'active',
    pinned: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    lastViewedAt: null,
    body: '# 示例笔记\n\n正文',
    mtime: null,
    ...partial,
  }
}

const filter = (patch: Partial<ItemFilter> = {}): ItemFilter => ({ ...EMPTY_ITEM_FILTER, ...patch })

describe('统一筛选器', () => {
  const papers = [
    itemFromPaper(paperRecord({ dir: 'a', title: 'Hybrid Index', field: '信息检索', tags: ['retrieval', 'index'], importance: 4 })),
    itemFromPaper(paperRecord({ dir: 'b', title: 'Attention', field: '深度学习', tags: ['transformer'], importance: 5 })),
  ]
  const notes = [
    itemFromNote(noteRecord({ file: 'n1.md', title: '方法比较', field: '信息检索', tags: ['retrieval'], importance: 2, status: 'draft' })),
  ]
  const all = [...papers, ...notes]

  it('文献和笔记走同一个判定：标签取交集', () => {
    const hit = filterItems(all, filter({ tags: ['retrieval'] }))
    expect(hit.map((item) => item.title)).toEqual(['Hybrid Index', '方法比较'])

    const both = filterItems(all, filter({ tags: ['retrieval', 'index'] }))
    expect(both.map((item) => item.title)).toEqual(['Hybrid Index'])
  })

  it('领域与重要性下限对两类条目一视同仁', () => {
    expect(filterItems(all, filter({ field: '信息检索' }))).toHaveLength(2)
    expect(filterItems(all, filter({ minImportance: 4 })).map((item) => item.title)).toEqual([
      'Hybrid Index',
      'Attention',
    ])
  })

  it('状态值按条目类型各自生效，互不串台', () => {
    expect(filterItems(all, filter({ status: 'draft' })).map((item) => item.title)).toEqual(['方法比较'])
    expect(filterItems(all, filter({ status: 'reading' }))).toHaveLength(0)
  })

  it('归档默认隐藏，只有显式筛选才出现', () => {
    const archived = itemFromNote(noteRecord({ file: 'x.md', title: '旧笔记', status: 'archived' }))
    const list = [...all, archived]
    expect(filterItems(list, filter()).some((item) => item.title === '旧笔记')).toBe(false)
    expect(filterItems(list, filter({ status: 'archived' })).map((item) => item.title)).toEqual(['旧笔记'])
  })

  it('搜索命中正文预览与作者', () => {
    expect(filterItems(all, filter({ query: '正文' }))).toHaveLength(3)
    expect(filterItems(all, filter({ query: 'hybrid' }))).toHaveLength(1)
  })

  it('isEmptyFilter 只把真正生效的条件算作筛选', () => {
    expect(isEmptyFilter(filter())).toBe(false)
    expect(isEmptyFilter(filter({ minImportance: 1 }))).toBe(false)
    expect(isEmptyFilter(filter({ minImportance: 2 }))).toBe(true)
    expect(isEmptyFilter(filter({ tags: ['x'] }))).toBe(true)
  })

  it('分面统计覆盖两类条目', () => {
    expect(fieldFacets(all)).toEqual([
      ['信息检索', 2],
      ['深度学习', 1],
    ])
    const tags = tagFacets(all)
    expect(tags[0]).toEqual(['retrieval', 2])
  })
})

describe('统一排序器', () => {
  const items = [
    itemFromNote(noteRecord({ file: 'a.md', title: 'B 笔记', importance: 2, updatedAt: '2026-11-03T00:00:00.000Z' })),
    itemFromNote(noteRecord({ file: 'b.md', title: 'A 笔记', importance: 5, updatedAt: '2026-11-01T00:00:00.000Z' })),
  ]

  it('置顶永远排最前，即使重要性更低', () => {
    const pinned = [{ ...items[0]!, pinned: true }, items[1]!]
    expect(sortItems(pinned, 'importance').map((item) => item.title)).toEqual(['B 笔记', 'A 笔记'])
  })

  it('按标题/重要性/修改时间排序', () => {
    expect(sortItems(items, 'title').map((item) => item.title)).toEqual(['A 笔记', 'B 笔记'])
    expect(sortItems(items, 'importance').map((item) => item.title)).toEqual(['A 笔记', 'B 笔记'])
    expect(sortItems(items, 'updated').map((item) => item.title)).toEqual(['B 笔记', 'A 笔记'])
  })
})

describe('文献笔记的元数据不复制', () => {
  it('同一篇文献作为「文献」和「笔记」时元数据完全一致', () => {
    const record = paperRecord({ dir: 'p1', title: 'T', field: '信息检索', tags: ['a'], importance: 4, status: 'reading' })
    const asPaper = itemFromPaper(record, 'paper')
    const asNote = itemFromPaper(record, 'note')
    expect(asNote.key).not.toBe(asPaper.key)
    expect(asNote.field).toBe(asPaper.field)
    expect(asNote.tags).toEqual(asPaper.tags)
    expect(asNote.importance).toBe(asPaper.importance)
    expect(asNote.status).toBe(asPaper.status)
    expect(asNote.progress).toBe(asPaper.progress)
  })

  it('改 meta.json 后两种视图都立刻反映新值（唯一真源）', async () => {
    const fs = new MemoryVaultFS('/vault')
    const repo = new VaultRepository(fs, { name: 'T' })
    await repo.ensureStructure()
    const created = await repo.create({ title: '同步测试', field: '旧领域', tags: ['old'], importance: 2 })
    const before = itemFromPaper(await repo.read(created.dir), 'note')
    expect(before.field).toBe('旧领域')

    const record = await repo.read(created.dir)
    await repo.saveMeta(created.dir, { ...record.meta, field: '新领域', tags: ['new'], importance: 5, status: 'done' })

    const after = await repo.read(created.dir)
    expect(itemFromPaper(after, 'note').field).toBe('新领域')
    expect(itemFromPaper(after, 'paper').importance).toBe(5)
    expect(itemFromPaper(after, 'note').status).toBe('done')
  })
})

describe('状态枚举按条目类型注入', () => {
  it('文献用阅读状态，独立笔记用草稿/在写/归档', () => {
    expect(statusOrderFor('paper')).toEqual(['reading', 'todo', 'done', 'archived'])
    expect(statusOrderFor('note')).toEqual(['active', 'draft', 'archived'])
    expect(statusLabel('paper', 'reading')).toBe('在读')
    expect(statusLabel('note', 'active')).toBe('在写')
    expect(itemFromNote(noteRecord()).type).toBe('note')
  })
})
