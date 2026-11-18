import { describe, expect, it } from 'vitest'
import { useUiStore } from '@/stores/ui'

/**
 * 列表视图的「按分类分组」开关：文献库和笔记库各有一份，互不影响。
 * 默认都关着 —— 打开分组才启用「组内置顶」，这是这次语义改动的前提。
 */
describe('列表分组开关', () => {
  it('默认不分组', () => {
    expect(useUiStore.getState().papersGrouped).toBe(false)
    expect(useUiStore.getState().notesGrouped).toBe(false)
  })

  it('两个库的开关互相独立', () => {
    useUiStore.getState().setPapersGrouped(true)
    expect(useUiStore.getState().papersGrouped).toBe(true)
    expect(useUiStore.getState().notesGrouped).toBe(false)

    useUiStore.getState().setNotesGrouped(true)
    expect(useUiStore.getState().notesGrouped).toBe(true)

    useUiStore.getState().setPapersGrouped(false)
    expect(useUiStore.getState().notesGrouped).toBe(true)
  })
})
