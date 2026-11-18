import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { NotesRepository, NOTES_DIR } from '../repository'
import { parseNote } from '../frontmatter'

let fs: MemoryVaultFS
let repo: NotesRepository

beforeEach(async () => {
  fs = new MemoryVaultFS('/mem-vault')
  repo = new NotesRepository(fs)
  await repo.ensureDir()
})

describe('NotesRepository', () => {
  it('create 写入 notes/<title>.md 并带 frontmatter', async () => {
    const note = await repo.create({ title: '检索笔记' })
    expect(note.file).toBe('检索笔记.md')
    const raw = await fs.readText(`${NOTES_DIR}/${note.file}`)
    const parsed = parseNote(raw)
    expect(parsed.data.createdAt).toBeTruthy()
    expect(parsed.data.updatedAt).toBeTruthy()
    expect(parsed.body.startsWith('# 检索笔记')).toBe(true)
  })

  it('同名标题自动加后缀，不覆盖已有文件', async () => {
    await repo.create({ title: '重复' })
    const second = await repo.create({ title: '重复' })
    expect(second.file).toBe('重复-2.md')
    expect(await fs.exists(`${NOTES_DIR}/重复.md`)).toBe(true)
  })

  it('title 里的非法字符会被清掉', async () => {
    const note = await repo.create({ title: 'a/b:c*d?' })
    expect(note.file).not.toMatch(/[/:*?]/)
  })

  it('save 保留 created 与 tags，只更新 updated', async () => {
    const created = await repo.create({ title: '保留测试', tags: ['rag'] })
    const before = parseNote(await fs.readText(`${NOTES_DIR}/${created.file}`))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await repo.save(created.file, '# 保留测试\n\n新正文\n')

    const after = parseNote(await fs.readText(`${NOTES_DIR}/${created.file}`))
    expect(after.data.createdAt).toBe(before.data.createdAt)
    expect(after.data.tags).toEqual(['rag'])
    expect(after.data.updatedAt).not.toBe(before.data.updatedAt)
    expect(after.body).toContain('新正文')
  })

  it('list 按更新时间倒序', async () => {
    const a = await repo.create({ title: 'A' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const b = await repo.create({ title: 'B' })
    const notes = await repo.list()
    expect(notes.map((note) => note.file)).toEqual([b.file, a.file])
  })

  it('rename 改文件名并替换正文一级标题', async () => {
    const note = await repo.create({ title: '旧名字' })
    const renamed = await repo.rename(note.file, '新名字')
    expect(renamed.file).toBe('新名字.md')
    expect(await fs.exists(`${NOTES_DIR}/旧名字.md`)).toBe(false)
    const raw = await fs.readText(`${NOTES_DIR}/新名字.md`)
    expect(raw).toContain('# 新名字')
    expect(raw).not.toContain('# 旧名字')
  })

  it('rename 到已存在的名字时加后缀', async () => {
    await repo.create({ title: '占位' })
    const other = await repo.create({ title: '另一个' })
    const renamed = await repo.rename(other.file, '占位')
    expect(renamed.file).toBe('占位-2.md')
  })

  it('remove 删除文件并让 list 少一条', async () => {
    const note = await repo.create({ title: '待删除' })
    await repo.remove(note.file)
    expect(await fs.exists(`${NOTES_DIR}/${note.file}`)).toBe(false)
    expect(await repo.list()).toHaveLength(0)
  })

  it('setTags 写回 frontmatter', async () => {
    const note = await repo.create({ title: '标签' })
    await repo.setTags(note.file, ['a', 'b'])
    const parsed = parseNote(await fs.readText(`${NOTES_DIR}/${note.file}`))
    expect(parsed.data.tags).toEqual(['a', 'b'])
  })

  it('notes/ 里的非 md 文件被忽略', async () => {
    await repo.create({ title: '真的笔记' })
    await fs.writeText(`${NOTES_DIR}/cover.png`, 'not markdown')
    const notes = await repo.list()
    expect(notes).toHaveLength(1)
  })

  it('list 在 notes/ 不存在时返回空数组', async () => {
    const empty = new NotesRepository(new MemoryVaultFS('/empty'))
    expect(await empty.list()).toEqual([])
  })
})
