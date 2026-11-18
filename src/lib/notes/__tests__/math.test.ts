import { describe, expect, it } from 'vitest'
import { maskMath, scanMath } from '../math'

describe('scanMath：识别 $…$ 与 $$…$$（Obsidian 语法）', () => {
  it('行内公式', () => {
    const spans = scanMath('行内公式 $E = mc^2$ 结束。')
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ tex: 'E = mc^2', display: false })
    // 区间含定界符：「行内公式 」5 个字符后是 `$`
    expect(spans[0]!.from).toBe(5)
    expect(spans[0]!.to).toBe(15)
  })

  it('「$5 和 $10」不是公式：$ 后跟空格 / 前面是空格都不算', () => {
    expect(scanMath('价格 $5 和 $10 之间')).toHaveLength(0)
    expect(scanMath('售价 $ 5 元')).toHaveLength(0)
  })

  it('行内代码里的 $ 不算公式', () => {
    expect(scanMath('用 `$x$` 表示变量')).toHaveLength(0)
  })

  it('块级公式 $$…$$ 可以跨行', () => {
    const doc = '前文\n$$\n\\frac{a}{b} = \\sqrt{c}\n$$\n后文'
    const spans = scanMath(doc)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.display).toBe(true)
    expect(spans[0]!.tex).toBe('\\frac{a}{b} = \\sqrt{c}')
  })

  it('代码围栏里的 $ 不算公式', () => {
    const doc = '```\nconst price = $amount\n```'
    expect(scanMath(doc)).toHaveLength(0)
  })

  it('单个 $ 不闭合就当普通文字', () => {
    expect(scanMath('一个孤零零的 $ 符号')).toHaveLength(0)
  })
})

describe('maskMath：占位符替换与还原', () => {
  it('把公式换成占位符，restore 塞回 KaTeX HTML', () => {
    const { masked, restore } = maskMath('有 $x^2$ 公式')
    expect(masked).not.toContain('$')
    expect(masked).toContain('MATHPLACEHOLDER0X')
    const html = restore(`<p>有 MATHPLACEHOLDER0X 公式</p>`)
    expect(html).toContain('katex')
    expect(html).not.toContain('MATHPLACEHOLDER0X')
  })

  it('没有公式时原样返回', () => {
    const { masked, restore } = maskMath('普通文字')
    expect(masked).toBe('普通文字')
    expect(restore('<p>普通文字</p>')).toBe('<p>普通文字</p>')
  })

  it('公式里的下划线不会被 marked 当成强调：占位符替换在渲染之前', () => {
    const spans = scanMath('$a_b + c^d$')
    expect(spans).toHaveLength(1)
  })
})
