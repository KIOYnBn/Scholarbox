// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import type { NoteDoc } from '../links'
import { buildGraph, edgeLabelKey, loadGraphLabels, saveGraphLabels } from '../graph'
import { resolveWikiTarget } from '../links'

const docs: NoteDoc[] = [
  { kind: 'standalone', file: 'notes/甲.md', title: '甲', body: '链到 [[乙]] 和 [[不存在]]' },
  { kind: 'standalone', file: 'notes/乙.md', title: '乙', body: '回到 [[甲]]，也嵌 ![[甲]]' },
  { kind: 'paper', file: 'papers/p1/文献.md', dir: 'p1', title: '文献一', body: '引 [[甲]]' },
]

describe('图谱构建', () => {
  it('节点含文献笔记 / 独立笔记 / 未解析目标', () => {
    const { nodes } = buildGraph(docs)
    const kinds = new Map(nodes.map((node) => [node.id, node.kind]))
    expect(kinds.get('notes/甲.md')).toBe('note')
    expect(kinds.get('papers/p1/文献.md')).toBe('paper')
    expect(kinds.get('unresolved:不存在')).toBe('unresolved')
  })

  it('边：链接 / 嵌入 / 块引用都算，自链去掉，重复边去重', () => {
    const { edges } = buildGraph(docs)
    const ids = edges.map((edge) => edge.id)
    expect(ids).toContain('notes/甲.md|notes/乙.md')
    expect(ids).toContain('notes/乙.md|notes/甲.md')
    expect(ids).toContain('papers/p1/文献.md|notes/甲.md')
    // 甲只有一条到乙的链接，不因重复提及而多边
    expect(ids.filter((id) => id === 'notes/甲.md|notes/乙.md')).toHaveLength(1)
  })

  it('resolveWikiTarget：标题 / 目录名 / 文件名 / 路径都能对上', () => {
    expect(resolveWikiTarget('文献一', docs)?.file).toBe('papers/p1/文献.md')
    expect(resolveWikiTarget('p1', docs)?.file).toBe('papers/p1/文献.md')
    expect(resolveWikiTarget('甲', docs)?.file).toBe('notes/甲.md')
    expect(resolveWikiTarget('notes/甲', docs)?.file).toBe('notes/甲.md')
    expect(resolveWikiTarget('不存在', docs)).toBeNull()
  })
})

describe('关系线标注存取', () => {
  let fs: MemoryVaultFS
  beforeEach(() => {
    fs = new MemoryVaultFS('/mem-vault')
  })

  it('保存后能读回来，空标注被忽略', async () => {
    const key = edgeLabelKey('notes/甲.md', 'notes/乙.md')
    await saveGraphLabels(fs, { [key]: '同一领域', empty: '   ' })
    const labels = await loadGraphLabels(fs)
    expect(labels[key]).toBe('同一领域')
    expect(labels.empty).toBeUndefined()
  })

  it('没有文件时返回空表', async () => {
    expect(await loadGraphLabels(fs)).toEqual({})
  })
})
