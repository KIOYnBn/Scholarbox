import { describe, expect, it } from 'vitest'
import { rootSupportError } from '@/stores/vault'

describe('rootSupportError（REVIEW P1-3）', () => {
  it('content:// 仓库明确提示未接入 SAF', () => {
    const message = rootSupportError({ rootPath: 'content://com.android/tree/1', rootType: 'fs' }, true)
    expect(message).toContain('SAF')
    expect(message).toContain('content://')
  })

  it('浏览器环境打不开本地文件夹', () => {
    expect(rootSupportError({ rootPath: 'D:/papers/x', rootType: 'fs' }, false)).toContain('浏览器模式')
  })

  it('桌面端的普通绝对路径可以通过', () => {
    expect(rootSupportError({ rootPath: 'D:/papers/x', rootType: 'fs' }, true)).toBeNull()
  })

  it('OPFS 仓库在任何环境都不报错（由浏览器后端决定）', () => {
    expect(rootSupportError({ rootPath: 'MyVault', rootType: 'opfs' }, false)).toBeNull()
  })

  it('大小写不敏感（CHROME 里可能被写成大写）', () => {
    expect(rootSupportError({ rootPath: 'Content://com.android/x', rootType: 'fs' }, true)).toContain('SAF')
  })
})
