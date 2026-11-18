import type { ShelfTone } from '@/lib/shelf'

/**
 * 书脊配色。用深度饱和的「书封纸」色调而不是 UI 强调色 —— 书架要像书架，
 * 不是一堆按钮。每层书架取一个色调，层内所有书脊共享，靠书脊上的文字区分。
 */
export interface ToneStyle {
  /** 书脊正面 */
  bg: string
  /** 两侧的书脊折痕，渐变用 */
  edge: string
  /** 分组标题前的圆点（Tailwind 类，方便和文字色一起用） */
  dot: string
}

export const TONE_STYLES: Record<ShelfTone, ToneStyle> = {
  teal: { bg: '#2f6159', edge: '#234b45', dot: 'bg-[#2f6159]' },
  sand: { bg: '#a8834f', edge: '#866741', dot: 'bg-[#a8834f]' },
  plum: { bg: '#7a5570', edge: '#61445a', dot: 'bg-[#7a5570]' },
  moss: { bg: '#5c7149', edge: '#495a3a', dot: 'bg-[#5c7149]' },
  slate: { bg: '#56637a', edge: '#445065', dot: 'bg-[#56637a]' },
  clay: { bg: '#a2624a', edge: '#834e3b', dot: 'bg-[#a2624a]' },
  ink: { bg: '#4b4a52', edge: '#3b3a41', dot: 'bg-[#4b4a52]' },
  amber: { bg: '#a67c2e', edge: '#876325', dot: 'bg-[#a67c2e]' },
}

export function toneStyle(tone: ShelfTone): ToneStyle {
  return TONE_STYLES[tone] ?? TONE_STYLES.teal
}

/** 书脊的立体感全靠这道横向渐变：中间亮、两侧暗，像真的书脊 */
export function spineGradient(style: ToneStyle): string {
  return `linear-gradient(100deg, ${style.edge} 0%, ${style.bg} 16%, ${style.bg} 84%, ${style.edge} 100%)`
}
