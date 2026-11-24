import {
  DEFAULT_PAPER_TEMPLATE,
  defaultTemplate,
  renderTemplate,
  templatePathFor,
  varsFromPaper,
  type TemplateKind,
} from '@/lib/notes/templates'
import { join, sanitizeSegment, uniqueName } from '@/lib/path'
import { isNotFound, type VaultFS } from '@/lib/fs/types'
import {
  folderNameFor,
  metaFromFolder,
  normalizeMeta,
  parseMeta,
  serializeMeta,
  type PaperMeta,
  type PaperRecord,
} from './schema'
import { updateFileReferences, updateLinksAfterRename } from '@/lib/notes/links'

export const PAPERS_DIR = 'papers'
export const ASSETS_DIR = 'assets'
export const PDF_NAME = 'origin.pdf'
export const NOTE_NAME = 'note.md'
export const META_NAME = 'meta.json'

/** 这篇文献的笔记文件名：meta 里记录的优先，老库回落 note.md */
export function noteFileOf(meta: Pick<PaperMeta, 'noteName'> | null | undefined): string {
  return meta?.noteName?.trim() || NOTE_NAME
}
export const VAULT_CONFIG = 'vault.json'

export interface VaultConfig {
  name: string
  version: number
  createdAt: string
  /** ISO timestamp of the last successful sync, if any */
  lastSyncAt?: string | null
}

export interface NewPaperInput {
  title: string
  authors?: string[]
  year?: number | null
  venue?: string
  impactFactor?: number | null
  field?: string
  tags?: string[]
  importance?: number
  doi?: string
  url?: string
  abstract?: string
  pdf?: Uint8Array | null
}

function uniqueDir(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i += 1
  return `${base}-${i}`
}

/**
 * Files-as-database repository. Every operation maps to plain files:
 *
 *   papers/{作者_年份_标题}/origin.pdf | note.md | meta.json | assets/**
 *
 * Nothing is cached outside the vault, so a diff of the folder *is* the change log.
 */
export class VaultRepository {
  /** 仓库显示名，写进 vault.json；由注册表传进来，不再硬编码 MyVault */
  readonly name: string

  constructor(
    readonly fs: VaultFS,
    options: { name?: string } = {},
  ) {
    this.name = options.name?.trim() || 'ScholarBox Vault'
  }

  get root(): string {
    return this.fs.root
  }

  paperPath(dir: string): string {
    return join(PAPERS_DIR, dir)
  }

  async ensureStructure(): Promise<{ created: boolean }> {
    let created = false
    if (!(await this.fs.exists(PAPERS_DIR))) {
      await this.fs.mkdir(PAPERS_DIR)
      created = true
    }
    if (!(await this.fs.exists(VAULT_CONFIG))) {
      const config: VaultConfig = {
        name: this.name,
        version: 1,
        createdAt: new Date().toISOString(),
        lastSyncAt: null,
      }
      await this.fs.writeText(VAULT_CONFIG, `${JSON.stringify(config, null, 2)}\n`)
      created = true
    }
    return { created }
  }

  async readConfig(): Promise<VaultConfig | null> {
    try {
      return JSON.parse(await this.fs.readText(VAULT_CONFIG)) as VaultConfig
    } catch {
      return null
    }
  }

  async writeConfig(patch: Partial<VaultConfig>): Promise<VaultConfig> {
    const current = (await this.readConfig()) ?? {
      name: this.name,
      version: 1,
      createdAt: new Date().toISOString(),
      lastSyncAt: null,
    }
    const next = { ...current, ...patch }
    await this.fs.writeText(VAULT_CONFIG, `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  async paperDirs(): Promise<string[]> {
    try {
      const entries = await this.fs.list(PAPERS_DIR)
      return entries.filter((e) => e.kind === 'dir').map((e) => e.name)
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }

  async read(dir: string): Promise<PaperRecord> {
    const base = this.paperPath(dir)
    let meta: PaperMeta
    let metaOk = false
    try {
      meta = parseMeta(await this.fs.readText(join(base, META_NAME)), { title: dir })
      metaOk = true
    } catch {
      meta = metaFromFolder(dir)
    }

    let note = ''
    const noteFile = noteFileOf(meta)
    try {
      note = await this.fs.readText(join(base, noteFile))
    } catch {
      if (noteFile !== NOTE_NAME) {
        // 迁移没跑完 / noteName 指向的文件丢了：回落到老文件名
        try {
          note = await this.fs.readText(join(base, NOTE_NAME))
        } catch {
          note = ''
        }
      }
    }

    let hasPdf = false
    let pdfSize = 0
    const pdfStat = await this.fs.stat(join(base, PDF_NAME))
    if (pdfStat && !pdfStat.isDir) {
      hasPdf = true
      pdfSize = pdfStat.size
    }

    let assets: string[] = []
    try {
      assets = (await this.fs.list(join(base, ASSETS_DIR)))
        .filter((e) => e.kind === 'file')
        .map((e) => join(base, ASSETS_DIR, e.name))
    } catch {
      assets = []
    }

    return { dir, meta, metaOk, note, hasPdf, pdfSize, assets, path: base }
  }

  async list(): Promise<PaperRecord[]> {
    // 老库迁移：把 papers/<dir>/note.md 改名为 <标题>.md（双链需要唯一的文件名）
    await this.migrateNoteNames()
    const dirs = await this.paperDirs()
    const records = await Promise.all(
      dirs.map(async (dir) => {
        try {
          return await this.read(dir)
        } catch (err) {
          console.warn(`[vault] failed to read ${dir}`, err)
          return null
        }
      }),
    )
    return records.filter((r): r is PaperRecord => r !== null)
  }

  async create(input: NewPaperInput): Promise<PaperRecord> {
    const meta = normalizeMeta(
      {
        title: input.title,
        authors: input.authors ?? [],
        year: input.year ?? null,
        venue: input.venue ?? '',
        impactFactor: input.impactFactor ?? null,
        field: input.field ?? '',
        tags: input.tags ?? [],
        importance: input.importance ?? 3,
        doi: input.doi ?? '',
        url: input.url ?? '',
        abstract: input.abstract ?? '',
        status: 'todo',
        progress: 0,
      },
      {},
    )

    const taken = new Set(await this.paperDirs())
    const dir = uniqueDir(folderNameFor(meta), taken)
    const base = this.paperPath(dir)

    await this.fs.mkdir(base)
    await this.fs.mkdir(join(base, ASSETS_DIR))
    if (input.pdf) await this.fs.writeBytes(join(base, PDF_NAME), input.pdf)
    // 笔记文件名跟随标题（唯一文件名是双链的前提）
    const noteName = `${sanitizeSegment(meta.title, 'note')}.md`
    const nextMeta: PaperMeta = { ...meta, noteName }
    await this.fs.writeText(join(base, META_NAME), serializeMeta(nextMeta))
    await this.fs.writeText(join(base, noteName), await this.noteBodyFor(nextMeta))

    return this.read(dir)
  }

  async saveMeta(dir: string, meta: PaperMeta): Promise<PaperMeta> {
    const current = await this.readMetaLite(dir)
    const oldTitle = current.title
    const oldNoteFile = noteFileOf(current)
    const next: PaperMeta = { ...meta, updatedAt: new Date().toISOString() }

    // 标题改了 → 笔记文件跟着改名（文件名 = 标题，双链靠它区分文献）
    let renamedTo: string | null = null
    if (next.title !== oldTitle && next.title.trim()) {
      const base = this.paperPath(dir)
      const candidate = `${sanitizeSegment(next.title, 'note')}.md`
      const oldPath = join(base, oldNoteFile)
      if (candidate !== oldNoteFile && (await this.fs.exists(oldPath))) {
        const existing = new Set(
          (await this.fs.list(base).catch(() => []))
            .map((entry) => entry.name)
            .filter((name) => name !== oldNoteFile),
        )
        const target = uniqueName(existing, candidate)
        await this.fs.rename(oldPath, join(base, target))
        renamedTo = target
        next.noteName = target
      }
    }
    // 兜底：写盘后 noteName 一定有值，下次不用再迁移
    if (!next.noteName?.trim()) next.noteName = oldNoteFile

    await this.fs.writeText(join(this.paperPath(dir), META_NAME), serializeMeta(next))

    // 全库引用联动：[[旧标题]] / [[papers/<dir>/<旧文件>]] 改写到新名字
    if (renamedTo) {
      await updateLinksAfterRename(
        this.fs,
        { kind: 'paper', file: `papers/${dir}/${oldNoteFile}`, title: oldTitle, dir },
        next.title,
        `papers/${dir}/${renamedTo.replace(/\.md$/i, '')}`,
      ).catch((err) => console.warn('[repo] 引用改写失败', err))
      // markdown 形式的路径引用（](papers/<dir>/旧文件.md)）也一并改写
      await updateFileReferences(
        this.fs,
        join(this.paperPath(dir), oldNoteFile),
        join(this.paperPath(dir), renamedTo),
      ).catch((err) => console.warn('[repo] 路径引用改写失败', err))
    }
    return next
  }

  private async readMetaLite(dir: string): Promise<PaperMeta> {
    const base = this.paperPath(dir)
    try {
      return parseMeta(await this.fs.readText(join(base, META_NAME)), { title: dir })
    } catch {
      return metaFromFolder(dir)
    }
  }

  /**
   * 老库迁移：papers/<dir>/note.md → papers/<dir>/<标题>.md，meta.json 记下 noteName。
   * 双链要求唯一的文件名 —— 全库都叫 note.md 时按名字引用无从谈起。
   * 每次读库跑一遍，已迁移的（noteName 非空）直接跳过。
   */
  private async migrateNoteNames(): Promise<void> {
    const dirs = await this.paperDirs().catch(() => [])
    for (const dir of dirs) {
      try {
        const base = this.paperPath(dir)
        const meta = await this.readMetaLite(dir)
        if (meta.noteName?.trim()) continue
        const legacy = join(base, NOTE_NAME)
        if (!(await this.fs.exists(legacy))) continue
        const existing = new Set(
          (await this.fs.list(base).catch(() => []))
            .map((entry) => entry.name)
            .filter((name) => name !== NOTE_NAME),
        )
        const target = uniqueName(existing, `${sanitizeSegment(meta.title, 'note')}.md`)
        await this.fs.rename(legacy, join(base, target))
        await this.fs.writeText(join(base, META_NAME), serializeMeta({ ...meta, noteName: target }))
        // 老的路径写法链接跟着改（标题写法不受影响，不用动）
        await updateLinksAfterRename(
          this.fs,
          { kind: 'paper', file: `papers/${dir}/${NOTE_NAME}`, title: meta.title, dir },
          meta.title,
          `papers/${dir}/${target.replace(/\.md$/i, '')}`,
        ).catch(() => undefined)
        await updateFileReferences(
          this.fs,
          join(base, NOTE_NAME),
          join(base, target),
        ).catch(() => undefined)
      } catch (err) {
        console.warn('[vault] 笔记文件迁移失败', dir, err)
      }
    }
  }

  /**
   * 建笔记时的正文：仓库里有 `.scholarbox/templates/paper-note.md` 就用它渲染，
   * 没有就退回内置模板。**只用于新建** —— 已存在的 note.md 永远不会被覆盖。
   */
  async noteBodyFor(meta: PaperMeta): Promise<string> {
    const custom = await this.readTemplate('paper-note')
    const vars = varsFromPaper(meta)
    if (custom !== null) return renderTemplate(custom, vars)
    return renderTemplate(DEFAULT_PAPER_TEMPLATE, vars)
  }

  /** 首次打开仓库时铺默认模板；已有文件绝不覆盖 */
  async ensureTemplates(): Promise<void> {
    for (const kind of ['paper-note', 'note'] as const) {
      const existing = await this.readTemplate(kind)
      if (existing === null) await this.writeTemplate(kind, defaultTemplate(kind))
    }
  }

  /** 读模板文件；不存在返回 null（不报错，模板是可选的） */
  async readTemplate(kind: TemplateKind): Promise<string | null> {
    const path = templatePathFor(kind)
    try {
      return await this.fs.readText(path)
    } catch {
      return null
    }
  }

  /** 写模板；目录不存在会自动建。模板文件在仓库里，会跟着 Git 一起提交 */
  async writeTemplate(kind: TemplateKind, text: string): Promise<void> {
    await this.ensureStructure()
    const path = templatePathFor(kind)
    const dir = path.slice(0, path.lastIndexOf('/'))
    await this.fs.mkdir(dir).catch(() => undefined)
    await this.fs.writeText(path, text)
  }

  async saveNote(dir: string, note: string): Promise<void> {
    const meta = await this.readMetaLite(dir)
    await this.fs.writeText(join(this.paperPath(dir), noteFileOf(meta)), note)
  }

  async readNote(dir: string): Promise<string> {
    const meta = await this.readMetaLite(dir)
    try {
      return await this.fs.readText(join(this.paperPath(dir), noteFileOf(meta)))
    } catch {
      return ''
    }
  }

  async writeAsset(dir: string, filename: string, bytes: Uint8Array): Promise<string> {
    const assetsDir = join(this.paperPath(dir), ASSETS_DIR)
    if (!(await this.fs.exists(assetsDir))) await this.fs.mkdir(assetsDir)
    const rel = join(assetsDir, filename)
    await this.fs.writeBytes(rel, bytes)
    return rel
  }

  async readAsset(relPath: string): Promise<Uint8Array> {
    return this.fs.readBytes(relPath)
  }

  async replacePdf(dir: string, bytes: Uint8Array): Promise<void> {
    const base = this.paperPath(dir)
    if (!(await this.fs.exists(base))) await this.fs.mkdir(base)
    await this.fs.writeBytes(join(base, PDF_NAME), bytes)
  }

  async renamePaper(dir: string, nextDir: string): Promise<string> {
    const taken = new Set(await this.paperDirs())
    taken.delete(dir)
    const target = uniqueDir(nextDir, taken)
    await this.fs.rename(this.paperPath(dir), this.paperPath(target))
    return target
  }

  async deletePaper(dir: string): Promise<void> {
    await this.fs.remove(this.paperPath(dir), { recursive: true })
  }
}
