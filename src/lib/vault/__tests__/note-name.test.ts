import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { VaultRepository, noteFileOf } from '../repository'
import { serializeMeta } from '../schema'
import { extractWikiLinks } from '@/lib/notes/wiki'

describe('文献笔记唯一文件名（noteName）', () => {
  let fs: MemoryVaultFS
  let repo: VaultRepository

  beforeEach(() => {
    fs = new MemoryVaultFS('/mem-vault')
    repo = new VaultRepository(fs, { name: '测试库' })
  })

  it('create：笔记文件名 = 标题，meta.json 记录 noteName', async () => {
    const paper = await repo.create({ title: 'Attention Is All You Need', pdf: undefined })
    expect(paper.meta.noteName).toBe('Attention Is All You Need.md')
    expect(await fs.exists(`papers/${paper.dir}/Attention Is All You Need.md`)).toBe(true)
    expect(await fs.exists(`papers/${paper.dir}/note.md`)).toBe(false)
    // saveNote 写进同一个文件
    await repo.saveNote(paper.dir, '# 改过的正文')
    expect(await repo.readNote(paper.dir)).toBe('# 改过的正文')
  })

  it('老库迁移：note.md 改名为 <标题>.md，meta 记录 noteName', async () => {
    // 手工摆一个「老库」：meta.json 没有 noteName，笔记叫 note.md
    const meta = {
      version: 1,
      id: 'p-1',
      title: '旧版文献',
      noteName: null,
    }
    await fs.mkdir('papers/legacy_paper')
    await fs.writeText('papers/legacy_paper/meta.json', serializeMeta(meta as never))
    await fs.writeText('papers/legacy_paper/note.md', '# 旧笔记\n\n[[另一个]]')

    const papers = await repo.list()
    expect(papers).toHaveLength(1)
    expect(papers[0]!.meta.noteName).toBe('旧版文献.md')
    expect(await fs.exists('papers/legacy_paper/旧版文献.md')).toBe(true)
    expect(await fs.exists('papers/legacy_paper/note.md')).toBe(false)
    // 迁移后再 list 一次是幂等的
    await repo.list()
    expect(await fs.exists('papers/legacy_paper/旧版文献.md')).toBe(true)
  })

  it('改标题：笔记文件跟着改名，全库 [[旧标题]] 引用改写', async () => {
    const paper = await repo.create({ title: '旧标题文献' })
    // 另一篇文献笔记引用了它（标题写法 + 路径写法）
    const refPaper = await repo.create({ title: '引用者' })
    const refFile = noteFileOf(refPaper.meta)
    const refPath = `papers/${refPaper.dir}/${refFile}`
    const targetNote = noteFileOf(paper.meta)
    const refBody = '看 [[旧标题文献]] 和 [[papers/' + paper.dir + '/' + targetNote + ']]'
    await fs.writeText(refPath, refBody)

    const nextMeta = { ...paper.meta, title: '新标题文献' }
    await repo.saveMeta(paper.dir, nextMeta)

    // 文件改名了
    expect(await fs.exists(`papers/${paper.dir}/旧标题文献.md`)).toBe(false)
    expect(await fs.exists(`papers/${paper.dir}/新标题文献.md`)).toBe(true)
    const migrated = await repo.read(paper.dir)
    expect(migrated.meta.noteName).toBe('新标题文献.md')

    // 引用改写：标题写法与路径写法都跟上，别名不动
    const text = await fs.readText(refPath)
    expect(text).toContain('[[新标题文献]]')
    expect(text).toContain(`[[papers/${paper.dir}/新标题文献]]`)
    // 引用者自己的笔记不受影响
    expect(text.startsWith('看 [[')).toBe(true)
  })

  it('改标题后的旧路径写法链接由迁移兜底改写', async () => {
    const paper = await repo.create({ title: '改名前' })
    await repo.saveNote(paper.dir, '正文')
    await repo.saveMeta(paper.dir, { ...paper.meta, title: '改名后' })
    // 文件已是新名字
    const meta = await repo.read(paper.dir)
    expect(meta.meta.noteName).toBe('改名后.md')
    expect(await fs.exists(`papers/${paper.dir}/改名后.md`)).toBe(true)
    expect((await repo.readNote(paper.dir)).trim()).toBe('正文')
  })

  it('noteFileOf：meta 没记就回落 note.md', () => {
    expect(noteFileOf({ noteName: null })).toBe('note.md')
    expect(noteFileOf({ noteName: '  ' })).toBe('note.md')
    expect(noteFileOf({ noteName: 'X.md' })).toBe('X.md')
    expect(noteFileOf(null)).toBe('note.md')
  })

  it('extractWikiLinks：路径写法在迁移场景可用', () => {
    const refs = extractWikiLinks('[[papers/p1/旧标题文献.md]]')
    expect(refs[0]!.path).toBe('papers/p1/旧标题文献.md')
  })
})
