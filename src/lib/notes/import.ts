import { useStandaloneNotesStore } from '@/stores/standalone'
import { useVaultStore } from '@/stores/vault'
import { NOTE_STATUS_ORDER, type NoteStatus } from '@/lib/library/item'
import { parseNote } from './frontmatter'
import { NotesRepository, type StandaloneNote } from './repository'

/** 导入的 Markdown 笔记：`.md` / `.markdown` */
export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

/**
 * 弹一个文件选择器拿 `.md` 文件。用 `<input type="file">` 而不是 Tauri 的
 * 对话框插件：后者返回的是磁盘路径，读外部文件要过 fs 权限作用域；
 * 前者在桌面 WebView 和浏览器里都能直接拿到文件内容，零权限配置。
 */
export function pickMarkdownFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,text/markdown'
    input.multiple = true
    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    // 用户点取消不触发 change：留一个保底，避免 Promise 悬着
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => resolve(Array.from(input.files ?? [])), 200)
        input.remove()
      },
      { once: true },
    )
    input.click()
  })
}

const VALID_STATUS = new Set<string>(NOTE_STATUS_ORDER)

/**
 * 把外部 Markdown 文件导入成独立笔记。
 *
 * - 显示名 / 文件名取源文件名（去扩展名），撞名自动 `-2`；
 * - 源文件里已有的 YAML frontmatter（tags / field / status / pinned）会被
   解析进笔记的元信息，正文原样保留；
 * - 没有 frontmatter 就整篇当正文。
 */
export async function importMarkdownFiles(files: File[]): Promise<StandaloneNote[]> {
  const fs = useVaultStore.getState().fs
  if (!fs) throw new Error('文献库还没打开')
  const repo = new NotesRepository(fs)
  const created: StandaloneNote[] = []

  for (const file of files.filter((item) => isMarkdownFile(item.name))) {
    const text = await file.text()
    const { data, body } = parseNote(text)
    const title = file.name.replace(/\.(md|markdown)$/i, '').trim() || '未命名笔记'
    const note = await repo.create({
      title,
      body,
      tags: data.tags.length > 0 ? data.tags : undefined,
      field: data.field.trim() || undefined,
      status: VALID_STATUS.has(data.status) ? (data.status as NoteStatus) : undefined,
    })
    created.push(note)
  }

  // 从磁盘重读，让侧栏 / 书架立即看到导入的笔记
  await useStandaloneNotesStore.getState().load()
  return created
}
