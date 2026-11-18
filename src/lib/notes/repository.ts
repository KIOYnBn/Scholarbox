import { join, sanitizeSegment } from '@/lib/path'
import type { VaultFS } from '@/lib/fs/types'
import type { NoteStatus } from '@/lib/library/item'
import {
  DEFAULT_IMPORTANCE,
  nowIso,
  noteTitle,
  parseNote,
  stringifyNote,
  withFrontmatter,
  type FrontmatterData,
} from './frontmatter'

export const NOTES_DIR = 'notes'

export interface StandaloneNote {
  /** `notes/` 下的文件名，含 `.md` */
  file: string
  /** 去掉 `.md` 的名字，用于标题兜底 */
  slug: string
  title: string
  tags: string[]
  field: string
  importance: number
  status: NoteStatus
  pinned: boolean
  createdAt: string | null
  updatedAt: string | null
  lastViewedAt: string | null
  /** frontmatter 之后的正文 */
  body: string
  /** 磁盘上的修改时间（ISO），用于排序兜底 */
  mtime: string | null
}

/** 可以单独改的元信息（对应 frontmatter 里的键） */
export interface NoteMetaPatch {
  field?: string
  tags?: string[]
  importance?: number
  status?: NoteStatus
  pinned?: boolean
  lastViewedAt?: string | null
}

export interface NoteDraft {
  title?: string
  tags?: string[]
  field?: string
  importance?: number
  status?: NoteStatus
  body?: string
}

/**
 * `notes/` 目录的读写。独立笔记跟文献笔记的差别只有位置：
 * 一个在 `papers/<dir>/note.md`，一个在 `notes/<slug>.md`，都是纯 Markdown。
 */
export class NotesRepository {
  constructor(readonly fs: VaultFS) {}

  async ensureDir(): Promise<void> {
    if (!(await this.fs.exists(NOTES_DIR))) await this.fs.mkdir(NOTES_DIR)
  }

  async list(): Promise<StandaloneNote[]> {
    if (!(await this.fs.exists(NOTES_DIR))) return []
    const entries = await this.fs.list(NOTES_DIR)
    const notes: StandaloneNote[] = []
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
      try {
        const text = await this.fs.readText(join(NOTES_DIR, entry.name))
        const stat = await this.fs.stat(join(NOTES_DIR, entry.name)).catch(() => null)
        const mtime = stat?.mtimeMs != null ? new Date(stat.mtimeMs).toISOString() : null
        notes.push(toNote(entry.name, text, mtime))
      } catch (err) {
        console.warn('[notes] 读取失败，已跳过', entry.name, err)
      }
    }
    return notes.sort((a, b) => (b.updatedAt ?? b.mtime ?? '').localeCompare(a.updatedAt ?? a.mtime ?? ''))
  }

  async read(file: string): Promise<string> {
    return this.fs.readText(join(NOTES_DIR, file))
  }

  /**
   * 写入正文。调用方通常只传正文（标题栏之外的编辑器不显示 frontmatter），
   * 所以 `created` 与 `tags` 从磁盘上的旧文件里继承，别把元信息抹掉。
   */
  async save(file: string, text: string): Promise<string> {
    const existing = parseNote(await this.read(file).catch(() => ''))
    const { data, body } = parseNote(text)
    const next = stringifyNote(
      {
        createdAt: data.createdAt ?? existing.data.createdAt ?? nowIso(),
        updatedAt: nowIso(),
        lastViewedAt: data.lastViewedAt ?? existing.data.lastViewedAt ?? null,
        // 编辑器只交正文，元信息一律以磁盘旧文件为准
        tags: existing.data.tags,
        field: existing.data.field,
        importance: existing.data.importance,
        status: existing.data.status,
        pinned: existing.data.pinned,
        extra: { ...existing.data.extra, ...data.extra },
      },
      body,
    )
    await this.fs.writeText(join(NOTES_DIR, file), next)
    return next
  }

  /** 新建：文件名取标题的 slug，重名自动 `-2` */
  async create(draft: NoteDraft = {}): Promise<StandaloneNote> {
    await this.ensureDir()
    const title = draft.title?.trim() || '未命名笔记'
    const file = await this.uniqueFile(title)
    const stamp = nowIso()
    const data: FrontmatterData = {
      createdAt: stamp,
      updatedAt: stamp,
      lastViewedAt: stamp,
      tags: draft.tags ?? [],
      field: draft.field ?? '',
      importance: draft.importance ?? DEFAULT_IMPORTANCE,
      status: draft.status ?? 'active',
      pinned: false,
      extra: {},
    }
    const body = draft.body ?? `# ${title}\n\n`
    const text = stringifyNote(data, body)
    await this.fs.writeText(join(NOTES_DIR, file), text)
    return toNote(file, text, stamp)
  }

  /** 重命名：改文件名 + 同步正文里的一级标题（标题与文件名保持一致） */
  async rename(file: string, nextTitle: string): Promise<StandaloneNote> {
    const title = nextTitle.trim() || '未命名笔记'
    const text = await this.read(file)
    const { data, body } = parseNote(text)
    const renamed = /^#\s+/m.test(body)
      ? body.replace(/^#\s+.*$/m, `# ${title}`)
      : `# ${title}\n\n${body}`
    const target = await this.uniqueFile(title, file)
    const next = stringifyNote({ ...data, updatedAt: nowIso() }, renamed)
    await this.fs.writeText(join(NOTES_DIR, target), next)
    if (target !== file) await this.fs.remove(join(NOTES_DIR, file))
    return toNote(target, next, nowIso())
  }

  async remove(file: string): Promise<void> {
    await this.fs.remove(join(NOTES_DIR, file))
  }

  async setTags(file: string, tags: string[]): Promise<StandaloneNote> {
    return this.updateMeta(file, { tags })
  }

  /** 只改元信息：field / tags / importance / status / pinned */
  async updateMeta(file: string, patch: NoteMetaPatch): Promise<StandaloneNote> {
    const text = await this.read(file)
    const next = withFrontmatter(text, { ...patch, updatedAt: nowIso() })
    await this.fs.writeText(join(NOTES_DIR, file), next)
    return toNote(file, next, nowIso())
  }

  /** 记一次「最近查看」——不改内容，只动 lastViewedAt */
  async touchViewed(file: string): Promise<void> {
    const text = await this.read(file).catch(() => null)
    if (text === null) return
    const next = withFrontmatter(text, { lastViewedAt: nowIso() })
    await this.fs.writeText(join(NOTES_DIR, file), next)
  }

  /** `title` → `notes/<slug>.md`，撞名就 `-2`、`-3`… */
  private async uniqueFile(title: string, ignore?: string): Promise<string> {
    const base = sanitizeSegment(title, 'note').replace(/\s+/g, ' ').slice(0, 80).trim() || 'note'
    const files = new Set((await this.list().catch(() => [])).map((note) => note.file))
    let candidate = `${base}.md`
    let index = 2
    while (files.has(candidate) && candidate !== ignore) {
      candidate = `${base}-${index}.md`
      index += 1
    }
    return candidate
  }
}

export function toNote(file: string, text: string, mtime: string | null): StandaloneNote {
  const { data, body } = parseNote(text)
  const slug = file.replace(/\.md$/i, '')
  return {
    file,
    slug,
    title: noteTitle(body, slug),
    tags: data.tags,
    field: data.field,
    importance: data.importance,
    status: data.status,
    pinned: data.pinned,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    lastViewedAt: data.lastViewedAt,
    body,
    mtime,
  }
}
