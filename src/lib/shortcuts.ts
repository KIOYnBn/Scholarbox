/** 只关心三栏折叠的两个快捷键，抽成纯函数便于单测与避免组件里写错修饰键组合。 */
export interface ShortcutEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export type LayoutShortcut = 'sidebar' | 'notes'

/**
 * Ctrl/⌘+B 收左栏；Ctrl/⌘+Alt+B 收右栏。
 * 带 Shift 的组合不接管（留给浏览器/输入法），避免与其它快捷键打架。
 */
export function layoutShortcutFor(event: ShortcutEventLike): LayoutShortcut | null {
  if (!(event.ctrlKey || event.metaKey)) return null
  if (event.shiftKey) return null
  if (event.key.toLowerCase() !== 'b') return null
  return event.altKey ? 'notes' : 'sidebar'
}
