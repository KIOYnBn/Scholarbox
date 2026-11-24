import { describe, expect, it } from 'vitest'
import { MemoryVaultFS } from '@/lib/fs/memory'
import { ATTACHMENTS_DIR, sanitizeImageName, saveNoteImage, uniqueImageName } from '../attachments'
import { resolveNoteImagePath } from '@/lib/asset-url'

describe('笔记附件 attachments/', () => {
  it('sanitizeImageName 清掉路径与非法字符', () => {
    expect(sanitizeImageName('../../evil/../img<1>.png')).toBe('img_1_.png')
    expect(sanitizeImageName('a:b*c?.png')).toBe('a_b_c_.png')
    expect(sanitizeImageName('')).toBe('image.png')
  })

  it('saveNoteImage 存到 attachments/，撞名自动加序号且不覆盖', async () => {
    const fs = new MemoryVaultFS()
    const bytes = new Uint8Array([1, 2, 3])
    const first = await saveNoteImage(fs, bytes, 'p.png')
    expect(first).toBe('attachments/p.png')
    const second = await saveNoteImage(fs, bytes, 'p.png')
    expect(second).toBe('attachments/p-2.png')
    const third = await saveNoteImage(fs, bytes, 'p.png')
    expect(third).toBe('attachments/p-3.png')
    // 已有文件内容未被覆盖
    const stored = await fs.readBytes('attachments/p.png')
    expect(Array.from(stored)).toEqual([1, 2, 3])
  })

  it('没有扩展名按 .png 处理；目录只建一次', async () => {
    const fs = new MemoryVaultFS()
    const rel = await saveNoteImage(fs, new Uint8Array([9]), 'shot')
    expect(rel).toBe(`${ATTACHMENTS_DIR}/shot.png`)
  })

  it('uniqueImageName 对已有文件正确避让', async () => {
    const fs = new MemoryVaultFS()
    await fs.mkdir('attachments')
    await fs.writeBytes('attachments/x-2.png', new Uint8Array([1]))
    const name = await uniqueImageName(fs, 'x.png')
    // x.png 不存在可用；x-2.png 已存在会被避让
    expect(name).toBe('x.png')
    await fs.writeBytes('attachments/x.png', new Uint8Array([1]))
    expect(await uniqueImageName(fs, 'x.png')).toBe('x-3.png')
    expect(await uniqueImageName(fs, 'no-ext')).toBe('no-ext.png')
  })

  it('attachments/ 开头的图片路径不被拼进 notes/ 或 papers/', () => {
    expect(resolveNoteImagePath('attachments/p.png', '')).toBe('attachments/p.png')
    expect(resolveNoteImagePath('attachments/p.png', 'some-paper')).toBe('attachments/p.png')
    // 相对写法仍然保持原行为
    expect(resolveNoteImagePath('assets/a.png', 'some-paper')).toBe('papers/some-paper/assets/a.png')
  })
})
