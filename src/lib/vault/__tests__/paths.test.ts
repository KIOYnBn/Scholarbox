import { describe, expect, it } from 'vitest'
import {
  defaultVaultName,
  isAbsolutePath,
  normalizeRootPath,
  PathError,
  resolveRootPath,
  validateRootPath,
  displayRootPath,
} from '@/lib/vault/paths'
import { createVaultEntry, emptyRegistry, parseRegistry, serializeRegistry, upsertVault } from '@/lib/vault/registry'

const desktop = { rootType: 'fs' as const, desktop: true }
const browser = { rootType: 'opfs' as const, desktop: false }

describe('normalizeRootPath', () => {
  it('去掉末尾斜杠，统一分隔符', () => {
    expect(normalizeRootPath('D:\\papers\\MyVault\\', desktop).path).toBe('D:/papers/MyVault')
    expect(normalizeRootPath('/home/me/vault/', desktop).path).toBe('/home/me/vault')
  })

  it('保留盘符与 UNC 前缀', () => {
    expect(normalizeRootPath('c:/Vault', desktop).path).toBe('c:/Vault')
    expect(normalizeRootPath('\\\\server\\share\\vault', desktop).path).toBe('//server/share/vault')
  })

  it('相对路径原样保留（后续按 appConfigDir 解析）', () => {
    expect(normalizeRootPath('papers/2026/my-vault', desktop).path).toBe('papers/2026/my-vault')
  })

  it('剥掉 OPFS:// 前缀', () => {
    expect(normalizeRootPath('OPFS://MyVault', browser).path).toBe('MyVault')
  })

  it('拒绝空路径', () => {
    const result = normalizeRootPath('   ', desktop)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('路径不能为空')
  })

  it('拒绝 .. 越界', () => {
    expect(normalizeRootPath('../etc', desktop).ok).toBe(false)
    expect(normalizeRootPath('a/../../b', browser).ok).toBe(false)
    expect(normalizeRootPath('..', browser).reason).toContain('OPFS')
  })

  it('浏览器端拒绝系统绝对路径（不伪装）', () => {
    const result = normalizeRootPath('D:/papers/MyVault', browser)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('OPFS')
  })

  it('清理 ./ 与重复斜杠', () => {
    expect(normalizeRootPath('./a//b/./c', browser).path).toBe('a/b/c')
  })
})

describe('isAbsolutePath', () => {
  it('识别盘符、UNC、posix 绝对路径', () => {
    expect(isAbsolutePath('D:\\a')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share')).toBe(true)
    expect(isAbsolutePath('/home/me')).toBe(true)
    expect(isAbsolutePath('relative/path')).toBe(false)
    expect(isAbsolutePath('OPFS://x')).toBe(false)
  })
})

describe('resolveRootPath', () => {
  it('绝对路径原样返回', () => {
    expect(resolveRootPath('D:/papers/v', { desktop: true, baseDir: 'C:/app' })).toBe('D:/papers/v')
  })

  it('相对路径挂到 baseDir 下的 vaults/ 子目录', () => {
    expect(resolveRootPath('my-vault', { desktop: true, baseDir: 'C:/Users/me/AppData/scholarbox' })).toBe(
      'C:/Users/me/AppData/scholarbox/vaults/my-vault',
    )
  })

  it('Windows 风格 baseDir 用反斜杠拼接', () => {
    expect(resolveRootPath('my-vault', { desktop: true, baseDir: 'C:\\AppData\\scholarbox' })).toBe(
      'C:\\AppData\\scholarbox\\vaults\\my-vault',
    )
  })

  it('SAF URI 原样返回', () => {
    expect(resolveRootPath('content://com.android/tree/1', { desktop: false, baseDir: '/' })).toBe(
      'content://com.android/tree/1',
    )
  })

  it('baseDir 为空时抛错，绝不退化成 `/vaults/x`', () => {
    // 曾经的实现会拼出 `/vaults/my-vault`，然后把仓库建到磁盘根目录
    expect(() => resolveRootPath('my-vault', { desktop: true, baseDir: '' })).toThrow(PathError)
    expect(() => resolveRootPath('my-vault', { desktop: true, baseDir: '' })).toThrow(/appConfigDir/)
  })

  it('baseDir 为空但路径是绝对的，仍然正常返回', () => {
    expect(resolveRootPath('F:/papers/v', { desktop: true, baseDir: '' })).toBe('F:/papers/v')
  })
})

describe('validateRootPath', () => {
  const registry = upsertVault(
    emptyRegistry(),
    createVaultEntry({ name: '主库', rootType: 'fs', rootPath: 'D:/papers/main' }),
  )
  const existing = registry.vaults[0]!

  it('合法路径通过并返回规范化结果', () => {
    const result = validateRootPath({ raw: 'D:\\papers\\second\\', registry, ...desktop })
    expect(result.ok).toBe(true)
    expect(result.path).toBe('D:/papers/second')
  })

  it('与已有仓库重复时报错并带上名字', () => {
    const result = validateRootPath({ raw: 'd:/papers/main/', registry, ...desktop })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('主库')
  })

  it('修改自己时不与自己重复', () => {
    const result = validateRootPath({
      raw: 'D:/papers/main',
      registry,
      ignoreId: existing.id,
      ...desktop,
    })
    expect(result.ok).toBe(true)
  })

  it('空路径给出具体原因', () => {
    expect(validateRootPath({ raw: '', registry, ...desktop }).reason).toBe('路径不能为空')
  })
})

describe('displayRootPath / defaultVaultName', () => {
  it('OPFS 仓库显示 OPFS:// 前缀', () => {
    expect(displayRootPath({ rootPath: 'MyVault', rootType: 'opfs' })).toBe('OPFS://MyVault')
    expect(displayRootPath({ rootPath: 'D:/p', rootType: 'fs' })).toBe('D:/p')
  })

  it('从路径末段取名', () => {
    expect(defaultVaultName('D:/papers/MyVault')).toBe('MyVault')
    expect(defaultVaultName('my-vault/')).toBe('my-vault')
  })
})

describe('旧注册表兼容', () => {
  it('旧记录缺 lastViewed 相关字段也能读，rootPath 原样保留', () => {
    const legacy = {
      version: 1,
      activeId: 'v-old',
      vaults: [
        {
          id: 'v-old',
          name: '旧库',
          rootType: 'fs',
          rootPath: 'D:\\old\\vault',
          remoteUrl: '',
          branch: 'main',
          pat: '',
          autoCommitMinutes: 0,
        },
      ],
    }
    const registry = parseRegistry(JSON.stringify(legacy))
    expect(registry.vaults).toHaveLength(1)
    expect(registry.vaults[0]?.rootPath).toBe('D:\\old\\vault')
    expect(registry.vaults[0]?.createdAt).toBeTypeOf('number')
    expect(registry.activeId).toBe('v-old')
  })

  it('序列化再解析保持 rootPath 不变', () => {
    const entry = createVaultEntry({ rootType: 'fs', rootPath: 'D:/x/y' })
    const text = serializeRegistry(upsertVault(emptyRegistry(), entry))
    expect(parseRegistry(text).vaults[0]?.rootPath).toBe('D:/x/y')
  })
})