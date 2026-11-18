import {
  DEFAULT_PAPER_TEMPLATE,
  defaultTemplate,
  renderTemplate,
  templatePathFor,
  varsFromPaper,
  type TemplateKind,
} from '@/lib/notes/templates'
import { join } from '@/lib/path'
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

export const PAPERS_DIR = 'papers'
export const ASSETS_DIR = 'assets'
export const PDF_NAME = 'origin.pdf'
export const NOTE_NAME = 'note.md'
export const META_NAME = 'meta.json'
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
    try {
      note = await this.fs.readText(join(base, NOTE_NAME))
    } catch {
      note = ''
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
    await this.fs.writeText(join(base, META_NAME), serializeMeta(meta))
    await this.fs.writeText(join(base, NOTE_NAME), await this.noteBodyFor(meta))

    return this.read(dir)
  }

  async saveMeta(dir: string, meta: PaperMeta): Promise<PaperMeta> {
    const next: PaperMeta = { ...meta, updatedAt: new Date().toISOString() }
    await this.fs.writeText(join(this.paperPath(dir), META_NAME), serializeMeta(next))
    return next
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
    await this.fs.writeText(join(this.paperPath(dir), NOTE_NAME), note)
  }

  async readNote(dir: string): Promise<string> {
    try {
      return await this.fs.readText(join(this.paperPath(dir), NOTE_NAME))
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
