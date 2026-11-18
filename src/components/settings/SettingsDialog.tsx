import {
  BookOpenText,
  Cloud,
  FolderOpen,
  Info,
  Languages,
  Palette,
  Settings2,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { SyncSection } from './SyncSection'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Field'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useVaultStore } from '@/stores/vault'
import {
  backgroundPreset,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  NOTE_BACKGROUNDS,
  NOTE_WIDTHS,
  noteWidthLabel,
} from '@/lib/notes/appearance'
import { cn } from '@/lib/utils'

type Section = 'general' | 'appearance' | 'sync' | 'translation' | 'about'

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: '通用', icon: <Settings2 className="size-3.5" /> },
  { id: 'appearance', label: '外观', icon: <Palette className="size-3.5" /> },
  { id: 'sync', label: '同步', icon: <Cloud className="size-3.5" /> },
  { id: 'translation', label: '翻译', icon: <Languages className="size-3.5" /> },
  { id: 'about', label: '关于', icon: <Info className="size-3.5" /> },
]

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const onClose = useUiStore((s) => s.closeSettings)
  // 分栏状态放到 store 里：状态栏的同步按钮要能直接跳到「同步」页
  const section = useUiStore((s) => s.settingsSection) as Section
  const setSection = (next: Section) => useUiStore.setState({ settingsSection: next })

  return (
    <Modal open={open} onClose={onClose} title="设置" description="所有配置保存在本机，不会写入文献库" className="max-w-2xl">
      <div className="flex min-h-[360px]">
        <nav className="w-36 shrink-0 space-y-0.5 border-r border-line p-2">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                section === item.id
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-ink-2 hover:bg-surface-2',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 px-5 py-4">
          {section === 'general' && <GeneralSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'sync' && <SyncSection />}
          {section === 'translation' && <TranslationSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </Modal>
  )
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{hint}</p> : null}
    </div>
  )
}

function GeneralSection() {
  const entry = useVaultStore((s) => s.entry)
  const kind = useVaultStore((s) => s.kind)
  const openVaultManager = useUiStore((s) => s.openVaultManager)
  const refresh = useLibraryStoreRefresh()

  const rootLabel =
    entry?.rootType === 'opfs' ? `OPFS://${entry.rootPath}` : (entry?.rootPath ?? '尚未选择')

  return (
    <div className="space-y-4">
      <SectionTitle
        title="当前仓库"
        hint="ScholarBox 直接读写这个文件夹，文件夹本身就是数据库：papers/{作者_年份_标题}/origin.pdf + note.md + meta.json。"
      />

      <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-3.5 shrink-0 text-ink-3" />
          <span className="shrink-0 text-[11.5px] font-medium text-ink-2">{entry?.name ?? '未打开'}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3" title={rootLabel}>
            {rootLabel}
          </code>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" onClick={openVaultManager}>
            仓库管理 / 切换
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            重新扫描
          </Button>
          <span className="self-center text-[10.5px] text-ink-3">
            {kind === 'browser' ? '浏览器模式（OPFS）' : '桌面端（真实文件夹）'}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-line/70 p-2.5 text-[11px] leading-relaxed text-ink-3">
        <p className="mb-1 font-medium text-ink-2">文件夹结构</p>
        <pre className="overflow-x-auto font-mono text-[10.5px] leading-relaxed">{`<仓库>/
├── .git/              ← 这个仓库自己的历史
└── papers/
    └── Vaswani_2017_Attention_Is_All_You_Need/
        ├── origin.pdf
        ├── note.md
        ├── meta.json
        └── assets/`}</pre>
        <p className="mt-2 text-[10.5px]">
          仓库注册表（含远端地址与 PAT）存在应用配置目录，不在这个文件夹里。
        </p>
      </div>
    </div>
  )
}


function EditorSection() {
  const editor = useSettingsStore((s) => s.editor)
  const setEditor = useSettingsStore((s) => s.setEditor)
  const toggles: Array<[keyof typeof editor, string, string]> = [
    ['autocomplete', '自动补全', '`[[` 候选、列表续写、括号配对'],
    ['listContinuation', '列表续写', '回车自动续写 `- `、`1. `、`- [ ]`、`> `'],
    ['html', '阅读模式允许 HTML', '关闭后阅读视图按纯文本显示，不渲染任何标签'],
    ['folding', '可折叠标题', '标题左侧出现折叠箭头'],
    ['lineNumbers', '显示行号', ''],
    ['guides', '缩进参考线', '只在当前行显示，标出每 2 个字符的列'],
    ['softWrap', '源码自动换行', '关闭后长行横向滚动'],
  ]

  return (
    <div className="space-y-4">
      {/* 最常改的三样放最上面：底色、版心宽度、字号 */}
      <Field label="笔记底色" hint={backgroundPreset(editor.noteBackground).label}>
        <div className="flex flex-wrap gap-1.5">
          {NOTE_BACKGROUNDS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setEditor({ noteBackground: preset.id })}
              title={preset.label}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition',
                editor.noteBackground === preset.id
                  ? 'border-accent/60 bg-accent-soft/50 text-ink'
                  : 'border-line text-ink-2 hover:text-ink',
              )}
            >
              <span
                className="size-3.5 rounded-[4px] border border-line-strong/60"
                style={{ background: preset.swatch }}
              />
              {preset.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="版心宽度" hint={noteWidthLabel(editor.noteWidth)}>
        <Segmented
          value={editor.noteWidth}
          onChange={(value) => setEditor({ noteWidth: value })}
          options={NOTE_WIDTHS.map((preset) => ({ value: preset.id, label: preset.label, title: preset.hint }))}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="字号" hint={`${editor.fontSize}px · 笔记里也能拖`}>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={FONT_SIZE_STEP}
            value={editor.fontSize}
            onChange={(event) => setEditor({ fontSize: Number(event.target.value) })}
            className="w-full cursor-ew-resize accent-[var(--color-accent)]"
          />
        </Field>
        <Field label="行高" hint={editor.lineHeight.toFixed(2)}>
          <input
            type="range"
            min={1.3}
            max={2.4}
            step={0.05}
            value={editor.lineHeight}
            onChange={(event) => setEditor({ lineHeight: Number(event.target.value) })}
            className="w-full accent-[var(--color-accent)]"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="编辑器字体" hint="等宽，影响源码与实时预览">
          <TextInput
            value={editor.fontFamily}
            onChange={(event) => setEditor({ fontFamily: event.target.value })}
            placeholder='"JetBrains Mono", ui-monospace, monospace'
          />
        </Field>
        <Field label="阅读视图字体" hint="阅读模式用">
          <TextInput
            value={editor.previewFontFamily}
            onChange={(event) => setEditor({ previewFontFamily: event.target.value })}
            placeholder='"Inter", "PingFang SC", system-ui, sans-serif'
          />
        </Field>
      </div>

      <div className="grid gap-1.5">
        {toggles.map(([key, label, hint]) => (
          <label
            key={key}
            className="flex items-start gap-2 rounded-lg border border-line/70 bg-surface/60 px-2.5 py-1.5"
          >
            <input
              type="checkbox"
              checked={Boolean(editor[key])}
              onChange={(event) => setEditor({ [key]: event.target.checked } as never)}
              className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[12px] text-ink">{label}</span>
              {hint ? <span className="block text-[10.5px] text-ink-3">{hint}</span> : null}
            </span>
          </label>
        ))}
      </div>

      <p className="text-[11px] text-ink-3">
        字体与开关是应用级设置，跨仓库共用；笔记模板是仓库文件（<code>.scholarbox/templates/</code>），
        直接打开编辑器改就行，会跟着 Git 一起提交。
      </p>
    </div>
  )
}

function AppearanceSection() {
  const theme = useSettingsStore((s) => s.theme)
  const set = useSettingsStore((s) => s.set)
  return (
    <div className="space-y-4">
      <SectionTitle title="主题" hint="学术风格默认使用暖白阅读底色，深色模式适合夜间阅读。" />
      <Field label="界面主题">
        <Segmented
          value={theme}
          onChange={(value) => set({ theme: value })}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
            { value: 'system', label: '跟随系统' },
          ]}
        />
      </Field>
      <Field label="文献列表排序" hint="也可在侧栏右上角快速切换">
        <Select
          value={useSettingsStore.getState().sortBy}
          onChange={(event) => set({ sortBy: event.target.value as never })}
        >
          <option value="recent">最近阅读</option>
          <option value="added">最近添加</option>
          <option value="title">标题</option>
          <option value="importance">重要性</option>
          <option value="progress">阅读进度</option>
        </Select>
      </Field>

      <div className="border-t border-line/70 pt-4">
        <SectionTitle title="编辑器" hint="右栏、全屏笔记、独立笔记、文献笔记共用同一套设置。" />
        <EditorSection />
      </div>
    </div>
  )
}

function TranslationSection() {
  const translation = useSettingsStore((s) => s.translation)
  const setTranslation = useSettingsStore((s) => s.setTranslation)
  return (
    <div className="space-y-3">
      <SectionTitle
        title="划词翻译"
        hint="在 PDF 中选中文字后自动弹出译文。Google 免费接口无需配置，DeepL / OpenAI 需要填写 Key。"
      />
      <Field label="服务">
        <Select
          value={translation.provider}
          onChange={(event) => setTranslation({ provider: event.target.value as never })}
        >
          <option value="mymemory">MyMemory（免费，无需 Key，国内可直连）</option>
          <option value="google-free">Google 翻译（免费接口，需能访问 Google）</option>
          <option value="deepl">DeepL</option>
          <option value="openai">OpenAI 兼容接口</option>
          <option value="none">关闭</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="目标语言">
          <Select
            value={translation.targetLang}
            onChange={(event) => setTranslation({ targetLang: event.target.value })}
          >
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </Select>
        </Field>
        <Field label="API Key" hint="免费接口可留空">
          <TextInput
            type="password"
            defaultValue={translation.apiKey}
            onBlur={(event) => setTranslation({ apiKey: event.target.value.trim() })}
          />
        </Field>
      </div>
      <Field label="自定义接口" hint="OpenAI 兼容时填 baseURL，如 https://api.openai.com/v1">
        <TextInput
          defaultValue={translation.endpoint}
          onBlur={(event) => setTranslation({ endpoint: event.target.value.trim() })}
          placeholder="https://"
        />
      </Field>
      <div className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-3">
        划词弹窗与翻译请求在下一阶段接入，本页配置项已持久化到本机。
      </div>
    </div>
  )
}

function AboutSection() {
  return (
    <div className="space-y-3 text-[11.5px] leading-relaxed text-ink-2">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-white">
          <BookOpenText className="size-4.5" />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-ink">ScholarBox</div>
          <div className="text-[10.5px] text-ink-3">本地优先的文献阅读工作台 · v0.1.0</div>
        </div>
      </div>
      <p>
        Tauri 2 + React 19 + TypeScript + Tailwind 4 + PDF.js + Zustand + isomorphic-git。桌面端（Windows /
        macOS / Linux）与 Android 平板共用一套界面，窄屏自动切换为抽屉式布局。
      </p>
      <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
        <p className="mb-1 font-medium text-ink-2">设计原则</p>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>文件即数据库：不生成隐藏的 .sqlite，一切以磁盘上的文件夹为准。</li>
          <li>PDF.js 虚拟渲染：只挂载视口内的页面，500MB 文档也能滚动。</li>
          <li>Git 即同步：note.md / meta.json 用固定键序与 2 空格缩进，diff 干净可读。</li>
        </ul>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-ink-3">快捷键</dt>
        <dd className="font-mono text-[10.5px]">/ 搜索 · PageUp/PageDown 翻页 · Ctrl+S 保存笔记</dd>
        <dt className="text-ink-3">数据位置</dt>
        <dd className="font-mono text-[10.5px]">由仓库注册表决定（appConfigDir/vaults.json）</dd>
      </dl>
    </div>
  )
}

function useLibraryStoreRefresh() {
  // imported lazily to keep this file free of a circular import at module load
  const refresh = () => import('@/stores/library').then((mod) => mod.useLibraryStore.getState().refresh())
  return refresh
}
