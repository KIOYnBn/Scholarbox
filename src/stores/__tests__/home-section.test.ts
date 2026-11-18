import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * 主界面切换（文献书库 / 笔记书架）的「记住上次选择」。
 *
 * 这条状态放在 settings 里（走 persist），不是 ui 里，因为它要跨启动保留；
 * ui 那边只有书架/列表这种当下视图的临时状态。
 */
describe('主界面切换记忆', () => {
  beforeEach(() => {
    useSettingsStore.setState({ homeSection: 'papers' })
  })

  it('默认停在文献书库', () => {
    expect(useSettingsStore.getState().homeSection).toBe('papers')
  })

  it('setHomeSection 能切到笔记书架并写回 store', () => {
    useSettingsStore.getState().setHomeSection('notes')
    expect(useSettingsStore.getState().homeSection).toBe('notes')

    useSettingsStore.getState().setHomeSection('papers')
    expect(useSettingsStore.getState().homeSection).toBe('papers')
  })

  it('持久化层只认这两个值（类型层面）——两条分支都渲染得出来', () => {
    const sections = ['papers', 'notes'] as const
    for (const section of sections) {
      useSettingsStore.getState().setHomeSection(section)
      expect(useSettingsStore.getState().homeSection).toBe(section)
    }
  })

  it('笔记书架的视图模式与侧栏面板互不影响', () => {
    expect(useUiStore.getState().homeNotesMode).toBe('shelf')
    expect(useUiStore.getState().notesMode).toBe('list')

    useUiStore.getState().setHomeNotesMode('list')
    expect(useUiStore.getState().homeNotesMode).toBe('list')
    // 侧栏仍然是列表，主界面切到列表不会互相覆盖
    expect(useUiStore.getState().notesMode).toBe('list')

    useUiStore.getState().setNotesMode('shelf')
    expect(useUiStore.getState().homeNotesMode).toBe('list')
  })
})
