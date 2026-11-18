import { describe, expect, it } from 'vitest'
import { captureFileName } from '@/lib/pdf-capture'

describe('captureFileName', () => {
  const at = new Date(2026, 10, 16, 13, 4, 5) // 2026-11-16 13:04:05 本地时间

  it('以页码开头，便于在 assets/ 里按页排序', () => {
    expect(captureFileName(3, at)).toMatch(/^p3-/)
  })

  it('时间戳到秒，且不含文件名非法字符', () => {
    const name = captureFileName(2, at)
    expect(name).toBe('p2-20261116-130405.png')
    expect(name).not.toMatch(/[\\/:*?"<>|\s]/)
  })

  it('补零到两位，月份 / 日期 / 时分秒都对齐', () => {
    const early = new Date(2026, 0, 2, 3, 4, 5)
    expect(captureFileName(1, early)).toBe('p1-20260102-030405.png')
  })

  it('两次截图最多可能同名 —— 同秒内靠调用方去重，文件名本身不带随机数', () => {
    expect(captureFileName(1, at)).toBe(captureFileName(1, new Date(at.getTime())))
  })
})
