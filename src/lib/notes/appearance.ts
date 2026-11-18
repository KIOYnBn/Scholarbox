import type { CSSProperties } from 'react'
import type { NoteBackground, NoteWidth } from '@/stores/settings'

/**
 * 笔记的外观（底色 / 版心宽度）。
 *
 * 底色不是简单换个 `background-color`：笔记里还有代码块、引用、表格、行内代码，
 * 它们都读 `--sb-*` 变量（见 `styles/index.css` 的 `.md-body` 与 CM 主题）。
 * 所以这里整体覆盖一小撮变量，选中「米黄」时连 `code` 的底色一起变 —— 否则
 * 白底代码块压在米黄纸上，比不改还难看。
 */

export interface BackgroundPreset {
  id: NoteBackground
  label: string
  /** 设置面板里的色块预览色 */
  swatch: string
  /** null = 跟随主题，不做任何覆盖 */
  vars: Record<string, string> | null
}

export const NOTE_BACKGROUNDS: BackgroundPreset[] = [
  { id: 'theme', label: '跟随主题', swatch: 'var(--sb-surface)', vars: null },
  {
    id: 'paper',
    label: '纯白纸',
    swatch: '#ffffff',
    vars: {
      '--sb-surface': '#ffffff',
      '--sb-surface-2': '#f4f2ed',
      '--sb-surface-3': '#eae7df',
      '--sb-line': '#e5e1d7',
      '--sb-line-strong': '#d5cfc2',
      '--sb-ink': '#23201b',
      '--sb-ink-2': '#5a544a',
      '--sb-ink-3': '#8f897e',
    },
  },
  {
    id: 'sepia',
    label: '米黄',
    swatch: '#f8efd9',
    vars: {
      '--sb-surface': '#f8efd9',
      '--sb-surface-2': '#f1e5cb',
      '--sb-surface-3': '#e7d9bd',
      '--sb-line': '#e2d4b7',
      '--sb-line-strong': '#d0bf9e',
      '--sb-ink': '#3a3323',
      '--sb-ink-2': '#6a5f48',
      '--sb-ink-3': '#9b8e74',
    },
  },
  {
    id: 'mint',
    label: '护眼绿',
    swatch: '#e6f0e0',
    vars: {
      '--sb-surface': '#e6f0e0',
      '--sb-surface-2': '#dbe8d4',
      '--sb-surface-3': '#cdddc5',
      '--sb-line': '#c9dcc0',
      '--sb-line-strong': '#b2caa8',
      '--sb-ink': '#26301f',
      '--sb-ink-2': '#4d5c43',
      '--sb-ink-3': '#7b8a6f',
    },
  },
  {
    id: 'slate',
    label: '冷灰',
    swatch: '#f7f8fa',
    vars: {
      '--sb-surface': '#f7f8fa',
      '--sb-surface-2': '#eceef2',
      '--sb-surface-3': '#e0e4ea',
      '--sb-line': '#dee2e8',
      '--sb-line-strong': '#cbd1d9',
      '--sb-ink': '#22262c',
      '--sb-ink-2': '#4f5762',
      '--sb-ink-3': '#7d8794',
    },
  },
  {
    id: 'ink',
    label: '深墨',
    swatch: '#191c21',
    vars: {
      '--sb-surface': '#191c21',
      '--sb-surface-2': '#22262d',
      '--sb-surface-3': '#2b313a',
      '--sb-line': '#2f343c',
      '--sb-line-strong': '#3d444e',
      '--sb-ink': '#e6e9ee',
      '--sb-ink-2': '#aab2bd',
      '--sb-ink-3': '#7c8493',
    },
  },
]

export function backgroundPreset(id: NoteBackground): BackgroundPreset {
  return NOTE_BACKGROUNDS.find((preset) => preset.id === id) ?? NOTE_BACKGROUNDS[0]!
}

/** 套在笔记容器上：覆盖 CSS 变量即可，所有子元素（含 CodeMirror、markdown 正文）自动跟随 */
export function noteSurfaceStyle(background: NoteBackground): CSSProperties {
  const vars = backgroundPreset(background).vars
  return (vars ?? {}) as CSSProperties
}

export interface WidthPreset {
  id: NoteWidth
  label: string
  /** 版心最大宽度 */
  className: string
  /** 设置面板里的一行说明 */
  hint: string
}

export const NOTE_WIDTHS: WidthPreset[] = [
  { id: 'narrow', label: '窄', className: 'max-w-[40rem]', hint: '40 字宽，接近书籍单栏' },
  { id: 'normal', label: '中', className: 'max-w-[48rem]', hint: '48rem，阅读最舒适' },
  { id: 'wide', label: '宽', className: 'max-w-[62rem]', hint: '62rem，写长文少换行' },
  { id: 'full', label: '满宽', className: 'max-w-none', hint: '铺满整个区域，不再留白' },
]

export function noteWidthClass(width: NoteWidth): string {
  return (NOTE_WIDTHS.find((preset) => preset.id === width) ?? NOTE_WIDTHS[2]!).className
}

export function noteWidthLabel(width: NoteWidth): string {
  return (NOTE_WIDTHS.find((preset) => preset.id === width) ?? NOTE_WIDTHS[2]!).label
}

/** 正文字号范围：设置面板与笔记里的滑杆共用一套边界 */
export const FONT_SIZE_MIN = 11
export const FONT_SIZE_MAX = 28
export const FONT_SIZE_STEP = 0.5

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return 15
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value))
}
