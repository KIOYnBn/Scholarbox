import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  Loader2,
  Pencil,
  Quote,
  SquarePen,
  Strikethrough,
  Type,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { MarkdownEditor, type EditorMode, type MarkdownEditorHandle } from '@/components/notes/MarkdownEditor'
import { ReadingView } from '@/components/notes/ReadingView'
import { FontSizeControl } from '@/components/notes/FontSizeControl'
import { useSettingsStore } from '@/stores/settings'
import { useNotesStore } from '@/stores/notes'
import { countWords } from '@/lib/markdown'
import { wrapSelection, linkEdit, type TextEdit } from '@/lib/editor/completion'
import type { WikiCandidate } from '@/lib/editor/completion'
import { noteSurfaceStyle, noteWidthClass } from '@/lib/notes/appearance'
import { cn } from '@/lib/utils'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface NoteSurfaceProps {
  noteKey: string
  initial: string
  /** 图片相对路径按这个目录解析（当前由 CodeMirror 渲染层处理，保留字段以兼容调用方） */
  paperDir?: string
  captureDir: string | null
  label: string
  onSave: (text: string) => Promise<void>
  placeholder?: string
  actions?: ReactNode
  /** `[[ ]]` 补全用的仓库文件索引 */
  candidates?: WikiCandidate[]
  /** 阅读模式里点了 `[[笔记]]` / `[[PDF]]` 要跳到哪 */
  onOpenWiki?: (path: string) => void
  /** 嵌在右栏这类窄容器里：模式按钮只留图标，避免把工具栏挤爆 */
  compact?: boolean
  /** 把编辑器句柄透传给外层（大纲面板点击定位用） */
  handleRef?: { current: MarkdownEditorHandle | null }
  /** 内容变化时回传（外层的大纲 / 反链要跟着刷新） */
  onValueChange?: (text: string) => void
}

/**
 * 笔记编辑器本体 —— 文献笔记、独立笔记、全屏笔记共用这一份。
 * 底层统一是 CodeMirror 6（`MarkdownEditor`），三种模式：源码 / 实时预览 / 阅读。
 */
export function NoteSurface({
  noteKey,
  initial,
  paperDir,
  captureDir,
  label,
  onSave,
  placeholder = '# 阅读笔记\n\n从这里开始记录…',
  actions,
  candidates = [],
  onOpenWiki,
  compact = false,
  handleRef,
  onValueChange,
}: NoteSurfaceProps) {
  const prefs = useSettingsStore((s) => s.editor)
  const setEditor = useSettingsStore((s) => s.setEditor)
  const [mode, setMode] = useState<EditorMode>('live')
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const savedRef = useRef(initial)
  const valueRef = useRef(value)
  valueRef.current = value
  const editorRef = useRef<MarkdownEditorHandle | null>(null)

  useEffect(() => {
    setValue((current) => (current === savedRef.current ? initial : current))
    if (valueRef.current === savedRef.current) {
      savedRef.current = initial
      setState('idle')
    }
  }, [noteKey, initial])

  const persist = useCallback(
    async (text: string) => {
      if (text === savedRef.current) return
      setState('saving')
      try {
        await onSave(text)
        savedRef.current = text
        setState('saved')
      } catch (err) {
        console.error('[notes] save failed', err)
        setState('error')
      }
    },
    [onSave],
  )

  useEffect(() => {
    if (value === savedRef.current) return
    const timer = setTimeout(() => void persist(value), 700)
    return () => clearTimeout(timer)
  }, [value, persist])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void persist(valueRef.current)
      }
      // Ctrl+E：编辑（实时预览）与阅读之间切换 —— Obsidian 的习惯
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'e') {
        const target = event.target as HTMLElement | null
        if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
        event.preventDefault()
        setMode((current) => (current === 'read' ? 'live' : 'read'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [persist])

  // 把编辑器句柄透传出去（子 effect 先跑，这里挂上时句柄已就位）
  useEffect(() => {
    if (handleRef) handleRef.current = editorRef.current
  })

  /* 截图插入：编辑器里按当前光标插，不抢焦点也能落 */
  const insert = useNotesStore((s) => s.insert)
  const consumeInsert = useNotesStore((s) => s.consumeInsert)
  useEffect(() => {
    if (!insert || !captureDir || insert.dir !== captureDir) return
    // 块级插入：光标在句子中间时先断行，图片不会把段落劈开
    editorRef.current?.insertBlock(insert.markdown)
    consumeInsert()
  }, [insert, captureDir, consumeInsert])

  const applyEdit = (edit: TextEdit) => {
    const next = `${value.slice(0, edit.from)}${edit.insert}${value.slice(edit.to)}`
    setValue(next)
    window.setTimeout(() => editorRef.current?.focus(), 0)
  }

  const wrap = (open: string, close = open, hint = '') => () => applyEdit(wrapSelection(value, 0, 0, open, close, hint))

  const toolbar = (
    <>
      <IconButton label="二级标题" size="xs" onClick={() => applyEdit({ from: 0, to: 0, insert: '' }) }>
        <Heading2 className="size-3.5" />
      </IconButton>
      <IconButton label="加粗 Ctrl+B" size="xs" onClick={wrap('**', '**', '加粗')}>
        <Bold className="size-3.5" />
      </IconButton>
      <IconButton label="斜体 Ctrl+I" size="xs" onClick={wrap('*', '*', '斜体')}>
        <Italic className="size-3.5" />
      </IconButton>
      <IconButton label="删除线" size="xs" onClick={wrap('~~', '~~', '删除线')}>
        <Strikethrough className="size-3.5" />
      </IconButton>
      <IconButton label="行内代码" size="xs" onClick={wrap('`', '`', 'code')}>
        <Code2 className="size-3.5" />
      </IconButton>
      <IconButton label="列表" size="xs" onClick={wrap('- ', '', '')}>
        <List className="size-3.5" />
      </IconButton>
      <IconButton label="引用" size="xs" onClick={wrap('> ', '', '')}>
        <Quote className="size-3.5" />
      </IconButton>
      <IconButton label="链接" size="xs" onClick={() => applyEdit(linkEdit(value, 0, 0))}>
        <Link2 className="size-3.5" />
      </IconButton>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={noteSurfaceStyle(prefs.noteBackground)}>
      {/* 注意：这一行不能加 overflow-hidden —— 字号浮层要能溢出到正文上方 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line/70 px-1.5 text-ink-3">
        {mode !== 'read' ? (
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sb-scroll">{toolbar}</div>
        ) : (
          <span className="min-w-0 flex-1 truncate pl-1 text-[10.5px] text-ink-3">
            {compact ? '只读' : '只读 · 点右上角切回编辑'}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <FontSizeControl
            value={prefs.fontSize}
            onChange={(fontSize) => setEditor({ fontSize })}
            background={prefs.noteBackground}
            onBackground={(noteBackground) => setEditor({ noteBackground })}
            width={prefs.noteWidth}
            onWidth={(noteWidth) => setEditor({ noteWidth })}
          />

          {/* 模式：阅读（只读）/ 源码 / 实时预览 —— 与 Obsidian 一致的三态 */}
          <div className="ml-1 flex items-center gap-0.5 rounded-lg bg-surface-2/70 p-0.5">
            {(
              [
                ['read', Eye, '阅读', '只读，按渲染结果排版'],
                ['source', Pencil, '源码', '显示所有 Markdown 标记'],
                ['live', Type, '实时预览', '标记隐藏、按渲染样式显示；光标所在行露源码'],
              ] as const
            ).map(([next, Icon, label, title]) => (
              <button
                key={next}
                type="button"
                title={title}
                aria-label={label}
                aria-pressed={mode === next}
                onClick={() => setMode(next)}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-md px-1.5 transition',
                  mode === next ? 'bg-surface text-accent shadow-sm' : 'text-ink-3 hover:text-ink',
                )}
              >
                <Icon className="size-3.5" />
              {compact ? null : <span className="text-[10.5px] font-medium">{label}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cn('mx-auto h-full w-full', noteWidthClass(prefs.noteWidth))}>
          {mode === 'read' ? (
            <ReadingView
              markdown={value}
              paperDir={paperDir ?? ''}
              onOpenWiki={onOpenWiki}
              fontSize={prefs.fontSize}
              lineHeight={prefs.lineHeight}
            />
          ) : null}
          <div className={mode === 'read' ? 'hidden' : 'h-full'}>
            <MarkdownEditor
              value={value}
              mode={mode}
              prefs={prefs}
              candidates={candidates}
              placeholder={placeholder}
              handleRef={editorRef}
              assetBase={paperDir ?? ''}
              onOpenWiki={onOpenWiki}
              onChange={(next) => {
                setValue(next)
                onValueChange?.(next)
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line/70 px-2 text-[10.5px] text-ink-3">
        <span>{countWords(value)} 字</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1">
          {state === 'saving' ? <Loader2 className="size-3 animate-spin" /> : null}
          {state === 'saving'
            ? '保存中…'
            : state === 'saved'
              ? `已写入 ${label}`
              : state === 'error'
                ? '保存失败'
                : '自动保存'}
        </span>
        <SquarePen className="hidden size-3" />
      </div>
    </div>
  )
}
