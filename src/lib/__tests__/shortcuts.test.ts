import { describe, expect, it } from 'vitest'
import { layoutShortcutFor } from '../shortcuts'

const ev = (patch: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  key: 'b',
  ...patch,
})

describe('三栏折叠快捷键', () => {
  it('Ctrl+B 收左栏，Ctrl+Alt+B 收右栏', () => {
    expect(layoutShortcutFor(ev({ ctrlKey: true }))).toBe('sidebar')
    expect(layoutShortcutFor(ev({ ctrlKey: true, altKey: true }))).toBe('notes')
  })

  it('macOS 的 ⌘ 同样生效', () => {
    expect(layoutShortcutFor(ev({ metaKey: true, key: 'B' }))).toBe('sidebar')
    expect(layoutShortcutFor(ev({ metaKey: true, altKey: true }))).toBe('notes')
  })

  it('裸按 B 不是快捷键（不影响输入）', () => {
    expect(layoutShortcutFor(ev({}))).toBeNull()
  })

  it('带 Shift 的组合不接管', () => {
    expect(layoutShortcutFor(ev({ ctrlKey: true, shiftKey: true }))).toBeNull()
  })

  it('其它键不触发', () => {
    expect(layoutShortcutFor(ev({ ctrlKey: true, key: 'j' }))).toBeNull()
  })
})
