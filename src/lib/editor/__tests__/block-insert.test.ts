import { describe, expect, it } from 'vitest'
import { blockInsertion } from '../block-insert'

const IMG = '![image](assets/p1-x.png)'

/** 把插入结果应用回文档，方便直接断言最终文本 */
function apply(doc: string, from: number, to: number, block = IMG): string {
  const edit = blockInsertion(doc, from, to, block)
  return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to)
}

describe('blockInsertion', () => {
  it('空文档原样插入，不补空行', () => {
    expect(apply('', 0, 0)).toBe(IMG)
  })

  it('光标在段落中间：前后各补空行，不劈开句子', () => {
    const doc = '前半句后半句'
    const out = apply(doc, 3, 3)
    expect(out).toBe(`前半句\n\n${IMG}\n后半句`)
  })

  it('光标在段落末尾：先结束这行，再空一行', () => {
    const doc = '一段话'
    expect(apply(doc, doc.length, doc.length)).toBe(`一段话\n\n${IMG}`)
  })

  it('站在末尾的空行上：补成「一个」空行，不多不少', () => {
    const doc = '一段话\n'
    expect(apply(doc, doc.length, doc.length)).toBe(`一段话\n\n${IMG}`)
  })

  it('列表项之后必须隔一个空行，否则图片会被算进列表', () => {
    const doc = '- [ ] \n'
    const out = apply(doc, doc.length, doc.length)
    expect(out).toBe(`- [ ] \n\n${IMG}`)
    // 列表项与图片之间确实空了一行
    expect(out.split('\n')[1]).toBe('')
  })

  it('连续截两张：第二张接在第一张下面，中间空一行', () => {
    const first = apply('- [ ] \n', 7, 7)
    const second = apply(first, first.length, first.length)
    expect(second).toBe(`- [ ] \n\n${IMG}\n\n${IMG}`)
  })

  it('标题下方插入：标题和图片之间留空行', () => {
    const doc = '## 我的批注\n'
    const out = apply(doc, doc.length, doc.length)
    expect(out).toBe(`## 我的批注\n\n${IMG}`)
  })

  it('换行符收敛：不会出现三个以上连续空行', () => {
    const doc = '正文\n\n'
    expect(apply(doc, doc.length, doc.length)).toBe(`正文\n\n${IMG}`)
    const loose = '正文\n\n\n\n'
    expect(apply(loose, loose.length, loose.length)).toBe(`正文\n\n${IMG}`)
  })
})
