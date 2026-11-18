import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { VaultRepository } from '@/lib/vault/repository'
import { normalizeMeta, type PaperMeta, type PaperRecord } from '@/lib/vault/schema'
import { itemFromPaper } from '@/lib/library/item'
import { sortItems } from '@/lib/library/filter'
import {
  markViewed,
  resetViewedThrottle,
  shouldMarkViewed,
  withinRecent,
  windowMs,
} from '@/lib/library/recency'

const DAY = 24 * 60 * 60 * 1000

function iso(daysAgo: number, now: number): string {
  return new Date(now - daysAgo * DAY).toISOString()
}

function record(patch: Partial<PaperMeta> & { dir?: string } = {}): PaperRecord {
  const { dir, ...rest } = patch
  return {
    dir: dir ?? 'demo',
    meta: normalizeMeta(rest, {}),
    metaOk: true,
    note: '# 笔记\n\n正文',
    hasPdf: true,
    pdfSize: 1,
    assets: [],
    path: `papers/${dir ?? 'demo'}`,
  }
}

describe('「今天/7 天/30 天」窗口', () => {
  const now = new Date('2026-11-16T12:00:00').getTime()

  it('all 永远算命中，空值永远不算', () => {
    expect(withinRecent(null, 'all')).toBe(true)
    expect(withinRecent(null, 'week')).toBe(false)
    expect(withinRecent(iso(400, now), 'all')).toBe(true)
  })

  it('今天 / 7 天 / 30 天各自收紧', () => {
    expect(withinRecent(iso(0, now), 'today', now)).toBe(true)
    expect(withinRecent(iso(2, now), 'today', now)).toBe(false)
    expect(withinRecent(iso(2, now), 'week', now)).toBe(true)
    expect(withinRecent(iso(9, now), 'week', now)).toBe(false)
    expect(withinRecent(iso(20, now), 'month', now)).toBe(true)
    expect(withinRecent(iso(40, now), 'month', now)).toBe(false)
  })

  it('「今天」按自然日算，凌晨看的东西早上还在今天里', () => {
    const earlyMorning = new Date('2026-11-16T01:00:00').getTime()
    const eightAm = new Date('2026-11-16T08:00:00').getTime()
    expect(withinRecent(new Date(earlyMorning).toISOString(), 'today', eightAm)).toBe(true)
    // 昨天 23:50 的就不算了
    expect(withinRecent(new Date('2026-11-15T23:50:00').toISOString(), 'today', eightAm)).toBe(false)
  })

  it('windowMs 给 all 返回 null（表示不限）', () => {
    expect(windowMs('all')).toBeNull()
    expect(windowMs('week')).toBe(7 * DAY)
  })
})

describe('lastViewedAt 写盘去重', () => {
  beforeEach(() => resetViewedThrottle())

  it('同一项 60 秒内只写一次', () => {
    expect(shouldMarkViewed('paper:a', 1_000)).toBe(true)
    expect(shouldMarkViewed('paper:a', 1_000 + 59_999)).toBe(false)
    expect(shouldMarkViewed('paper:a', 1_000 + 60_000)).toBe(true)
  })

  it('不同条目互不影响', () => {
    expect(shouldMarkViewed('paper:a', 5_000)).toBe(true)
    expect(shouldMarkViewed('paper:b', 5_001)).toBe(true)
    expect(shouldMarkViewed('note:x.md', 5_002)).toBe(true)
  })

  it('markViewed 只在通过节流时调用 writer', async () => {
    let writes = 0
    await markViewed('paper:a', () => {
      writes += 1
    })
    await markViewed('paper:a', () => {
      writes += 1
    })
    expect(writes).toBe(1)
  })

  it('resetViewedThrottle 让切换仓库后能立刻记录', () => {
    expect(shouldMarkViewed('paper:a')).toBe(true)
    expect(shouldMarkViewed('paper:a')).toBe(false)
    resetViewedThrottle()
    expect(shouldMarkViewed('paper:a')).toBe(true)
  })
})

describe('置顶排序优先级', () => {
  const items = [
    itemFromPaper(record({ dir: 'a', title: '未置顶高重要', importance: 5 })),
    itemFromPaper(record({ dir: 'b', title: '置顶低重要', importance: 1, pinned: true })),
    itemFromPaper(record({ dir: 'c', title: '置顶新近', importance: 3, pinned: true, lastViewedAt: '2026-11-16T00:00:00.000Z' })),
  ]

  it('任何排序下置顶都在前，组内再按所选键', () => {
    expect(sortItems(items, 'importance').map((item) => item.title)).toEqual([
      '置顶新近',
      '置顶低重要',
      '未置顶高重要',
    ])
    // 标题按中文排序：置顶两项内部仍按标题排，未置顶的永远在后
    expect(sortItems(items, 'title').map((item) => item.title)).toEqual([
      '置顶低重要',
      '置顶新近',
      '未置顶高重要',
    ])
  })

  it('最近查看排序按 lastViewedAt 倒序，置顶仍优先', () => {
    // 三者里只有「置顶新近」有 lastViewedAt，其余回落 updatedAt（都是刚建）
    const recentFirst = sortItems(
      [
        itemFromPaper(record({ dir: 'old', title: '很久以前', lastViewedAt: '2026-01-01T00:00:00.000Z' })),
        itemFromPaper(record({ dir: 'new', title: '刚刚看过', lastViewedAt: '2026-11-16T10:00:00.000Z' })),
        itemFromPaper(record({ dir: 'pin', title: '置顶的老东西', pinned: true, lastViewedAt: '2025-01-01T00:00:00.000Z' })),
      ],
      'recent',
    )
    expect(recentFirst.map((item) => item.title)).toEqual(['置顶的老东西', '刚刚看过', '很久以前'])
  })
})

describe('仓库隔离', () => {
  it('两个仓库的 pinned / lastViewedAt 各自独立', async () => {
    const alpha = new VaultRepository(new MemoryVaultFS('/alpha'), { name: 'A' })
    const beta = new VaultRepository(new MemoryVaultFS('/beta'), { name: 'B' })
    await alpha.ensureStructure()
    await beta.ensureStructure()

    const a = await alpha.create({ title: '甲' })
    const b = await beta.create({ title: '乙' })

    const at = '2026-11-16T10:00:00.000Z'
    const aRec = await alpha.read(a.dir)
    await alpha.saveMeta(a.dir, { ...aRec.meta, pinned: true, lastViewedAt: at })

    expect(itemFromPaper(await alpha.read(a.dir)).pinned).toBe(true)
    expect(itemFromPaper(await beta.read(b.dir)).pinned).toBe(false)
    expect(itemFromPaper(await beta.read(b.dir)).lastViewedAt).toBeNull()

    const bRec = await beta.read(b.dir)
    expect(bRec.meta.pinned).toBe(false)
  })
})

describe('meta.json 缺字段自动补默认值', () => {
  it('老文件没有 pinned / lastViewedAt 时按 false / lastOpenedAt 兜底', () => {
    const legacy = normalizeMeta({ lastOpenedAt: '2026-03-01T00:00:00.000Z' }, {})
    expect(legacy.pinned).toBe(false)
    expect(legacy.lastViewedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(itemFromPaper(record({ dir: 'x', lastOpenedAt: '2026-03-01T00:00:00.000Z' })).lastViewedAt).toBe(
      '2026-03-01T00:00:00.000Z',
    )
  })
})
