// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DeleteGuardError, guardDeletePath, inspectVaultFolder, removeFolder } from '../delete'
import { MemoryVaultFS } from '@/lib/fs/memory'
import type { VaultEntry } from '../registry'

const CONFIG = 'C:\\Users\\me\\AppData\\Roaming\\app.scholarbox.desktop'

const check = (target: string, extra: Partial<Parameters<typeof guardDeletePath>[1]> = {}) =>
  guardDeletePath(target, { configDir: CONFIG, homeOverride: null, otherRoots: [], ...extra })

describe('guardDeletePath — 该拒的必须拒', () => {
  it('空路径 / 只有空白', () => {
    expect(check('').ok).toBe(false)
    expect(check('   ').ok).toBe(false)
  })

  it('.. 越界', () => {
    const result = check('F:\\vaults\\..\\..\\Windows')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/\.\./)
  })

  it('盘符根', () => {
    expect(check('F:\\').ok).toBe(false)
    expect(check('F:/').ok).toBe(false)
  })

  it('把 appConfigDir 自己删了', () => {
    expect(check(CONFIG).ok).toBe(false)
    expect(check(`${CONFIG}\\vaults\\x`).ok).toBe(false)
  })

  it('配置目录里含 vaults.json 的路径', () => {
    expect(check('F:\\vaults\\vaults.json').ok).toBe(false)
  })

  it('ProgramData 下的应用目录', () => {
    expect(check('C:\\ProgramData\\ScholarBox\\Webview2').ok).toBe(false)
  })

  it('与另一个仓库重叠（父/子都不行）', () => {
    expect(check('F:\\papers', { otherRoots: ['F:\\papers'] }).ok).toBe(false)
    expect(check('F:\\papers', { otherRoots: ['F:\\papers\\sub'] }).ok).toBe(false)
    expect(check('F:\\papers\\sub', { otherRoots: ['F:\\papers'] }).ok).toBe(false)
  })

  it('用户主目录本身', () => {
    expect(check('C:\\Users\\me', { homeOverride: 'C:\\Users\\me' }).ok).toBe(false)
  })

  it('合法仓库目录通过', () => {
    expect(check('F:\\sb-vault').ok).toBe(true)
    expect(check('C:\\Users\\me\\Documents\\ScholarBox\\MyVault').ok).toBe(true)
  })

  it('DeleteGuardError 带中文提示', () => {
    const error = new DeleteGuardError('不能删这里', '换一个位置')
    expect(error.message).toBe('不能删这里')
    expect(error.hint).toBe('换一个位置')
  })
})

describe('inspectVaultFolder + removeFolder', () => {
  const entry = { id: 'v1', name: 't', rootType: 'opfs', rootPath: '/mem-vault' } as VaultEntry

  it('统计文件数与体积，跳过 .git', async () => {
    const fs = new MemoryVaultFS('/mem-vault')
    await fs.mkdir('papers')
    await fs.writeText('papers/a.md', '# hi')
    await fs.writeText('vault.json', '{}')
    await fs.mkdir('.git')
    await fs.writeText('.git/config', 'x'.repeat(1000))
    const report = await inspectVaultFolder(fs, entry)
    expect(report.files).toBe(2)
    expect(report.bytes).toBeLessThan(1000)
    expect(report.resolved).toContain('mem-vault')
  })

  it('OPFS 递归删除会清空目录', async () => {
    const fs = new MemoryVaultFS('/mem-vault')
    await fs.mkdir('papers/x')
    await fs.writeText('papers/x/note.md', 'hi')
    await removeFolder(fs, 'opfs', '/mem-vault')
    // 根目录被删后就读不到了 —— 这本身就是「删干净了」
    const rest = await fs.list('').catch(() => [])
    expect(rest.length).toBe(0)
  })
})
