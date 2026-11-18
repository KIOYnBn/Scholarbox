import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import { EMPTY_ITEM_FILTER } from '@/lib/library/filter'

/**
 * 切仓库时筛选条件必须回到默认值。
 *
 * 这不是洁癖：新仓库里明明有文献，界面上却因为继承了上一个仓库的搜索词/标签而空白，
 * 用户会以为「数据丢了」。书架/列表这类视图偏好可以留，筛选不行。
 */
describe('切换仓库时重置筛选', () => {
  beforeEach(() => {
    useLibraryStore.getState().resetFilter()
    useUiStore.getState().resetNotesFilter()
  })

  it('文献库筛选回到空条件', () => {
    useLibraryStore.getState().setFilter({ query: 'attention', tags: ['llm'], minImportance: 4, recent: 'week' })
    expect(useLibraryStore.getState().filter.query).toBe('attention')

    useLibraryStore.getState().resetFilter()
    const filter = useLibraryStore.getState().filter
    expect(filter.query).toBe('')
    expect(filter.tags).toEqual([])
    expect(filter.minImportance).toBe(EMPTY_ITEM_FILTER.minImportance)
    expect(filter.recent).toBe('all')
    expect(filter.status).toBe('all')
  })

  it('笔记库筛选回到空条件', () => {
    useUiStore.getState().setNotesFilter({ query: '方法', tags: ['rag'], minImportance: 3 })
    expect(useUiStore.getState().notesFilter.query).toBe('方法')

    useUiStore.getState().resetNotesFilter()
    expect(useUiStore.getState().notesFilter).toEqual(EMPTY_ITEM_FILTER)
  })

  it('两个库的筛选互不影响（重置一个不动另一个）', () => {
    useLibraryStore.getState().setFilter({ query: 'bert' })
    useUiStore.getState().setNotesFilter({ query: '笔记' })

    useLibraryStore.getState().resetFilter()
    expect(useLibraryStore.getState().filter.query).toBe('')
    expect(useUiStore.getState().notesFilter.query).toBe('笔记')
  })
})
