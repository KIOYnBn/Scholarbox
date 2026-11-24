import { describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { relative } from '@/lib/path'
import { rewritePathReferences, renameVaultFileWithLinks, updateFileReferences } from '../links'

describe('文件改名 → 引用同步改写', () => {
  it('rewritePathReferences 带边界检查，不误伤更长路径', () => {
    const { text, changed } = rewritePathReferences(
      '![a](attachments/p.png) 与 ![b](attachments/p.png.bak) 与 ![c](xattachments/p.png) 与 ![d](attachments/p.png2)',
      [{ from: 'attachments/p.png', to: 'attachments/q.png' }],
    )
    expect(changed).toBe(true)
    expect(text).toBe('![a](attachments/q.png) 与 ![b](attachments/p.png.bak) 与 ![c](xattachments/p.png) 与 ![d](attachments/p.png2)')
  })

  it('wiki 完整路径与相对路径都能命中', () => {
    const { text, changed } = rewritePathReferences(
      '![[attachments/实验.png]] 和 ![相对](../attachments/实验.png)',
      [
        { from: 'attachments/实验.png', to: 'attachments/ renamed.png' },
        { from: '../attachments/实验.png', to: '../attachments/ renamed.png' },
      ],
    )
    expect(changed).toBe(true)
    expect(text).toContain('![[attachments/ renamed.png]]')
    expect(text).toContain('../attachments/ renamed.png')
  })

  it('relative 计算相对路径', () => {
    expect(relative('notes', 'attachments/a.png')).toBe('../attachments/a.png')
    expect(relative('papers/d', 'papers/d/assets/a.png')).toBe('assets/a.png')
    expect(relative('papers/d', 'papers/other/a.png')).toBe('../other/a.png')
  })

  it('updateFileReferences：全路径 / 相对 / 同目录裸文件名三种写法都改写', async () => {
    const fs = new MemoryVaultFS()
    await fs.mkdir('attachments')
    await fs.mkdir('notes')
    await fs.mkdir('papers/d')
    await fs.mkdir('papers/d/assets')
    await fs.mkdir('papers/e')
    await fs.writeText('attachments/fig.png', 'binary')
    await fs.writeText(
      'notes/a.md',
      '全路径 ![1](attachments/fig.png) 相对 ![2](../attachments/fig.png) wiki ![[attachments/fig.png]]',
    )
    await fs.writeText('papers/d/note.md', '相对 ![3](../../attachments/fig.png)')
    // 别的目录里恰好有同名裸文件名 —— 不能被误改
    await fs.writeText('papers/d/assets/fig.png', 'binary2')
    await fs.writeText('papers/e/n.md', '这里的 ![x](fig.png) 指向自己的 assets，别动')

    const updated = await updateFileReferences(fs, 'attachments/fig.png', 'attachments/装置图.png')
    expect(updated).toBe(2)
    const a = await fs.readText('notes/a.md')
    expect(a).toContain('attachments/装置图.png')
    expect(a).not.toContain('attachments/fig.png')
    const d = await fs.readText('papers/d/note.md')
    expect(d).toContain('../../attachments/装置图.png')
    expect(d).not.toContain('fig.png')
    // 别处同名不受影响
    const e = await fs.readText('papers/e/n.md')
    expect(e).toContain('fig.png')
  })

  it('renameVaultFileWithLinks：改名 + 引用联动，目标冲突抛错', async () => {
    const fs = new MemoryVaultFS()
    await fs.mkdir('attachments')
    await fs.mkdir('notes')
    await fs.writeBytes('attachments/old.png', new Uint8Array([1]))
    await fs.writeText('notes/b.md', '![o](attachments/old.png)')
    await fs.writeBytes('attachments/other.png', new Uint8Array([2]))

    const updated = await renameVaultFileWithLinks(fs, 'attachments/old.png', 'attachments/new.png')
    expect(updated).toBe(1)
    expect(await fs.exists('attachments/old.png')).toBe(false)
    expect(await fs.exists('attachments/new.png')).toBe(true)
    expect(await fs.readText('notes/b.md')).toBe('![o](attachments/new.png)')

    // 目标已存在
    await expect(renameVaultFileWithLinks(fs, 'attachments/new.png', 'attachments/other.png')).rejects.toThrow(
      '目标文件已存在',
    )
  })
})
