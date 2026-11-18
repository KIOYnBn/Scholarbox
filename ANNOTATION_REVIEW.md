# 标注渲染审计（PDF 高亮 / 下划线 / 删除线）

> 结论全部来自实测，不是推断。测量方法：用 headless Edge 打开示例论文，选中摘要里跨 3 行的文本（偏移 1055–1400），点「高亮」，然后读 DOM 里 `.pdf-mark` 的 `getBoundingClientRect()` 与 `getComputedStyle()`。

## 现象 1：多行标注「除首尾外更重」

实测数据（一次 3 行高亮）：

```
COUNT=12            ← 3 行文本生成了 12 个 rect
OVERLAPS=5          ← 有 5 对 rect 互相重叠
```

前 8 个 rect 的高度/位置（像素）：

| # | left | top | width | height |
| --- | --- | --- | --- | --- |
| 2 | 445 | -648.67 | 490.70 | **12.88** |
| 3 | 445 | -652.67 | 490.70 | **18.98** |
| 4 | 445 | -564.72 | 116.69 | **18.30** |
| 5 | 445 | -568.72 | 116.69 | **25.98** |
| 6 | 445 | -537.73 | 316.73 | **14.05** |
| 7 | 445 | -540.73 | 316.73 | **19.98** |

**根因：同一行被画了两遍，且两遍不是同一个盒子。**

- `Range.getClientRects()` 在跨 `span` 选中时，既返回**文本节点自己的盒子**（紧贴字形，高 12.9 / 14.1 / 18.3 px），又返回**所属行盒/容器的盒子**（含行距，高 19.0 / 20.0 / 26.0 px，且 top 向上偏 3–4 px）。
- 这两个盒子纵向重叠 9–13 px，而高亮层用的是 `mix-blend-mode: multiply; opacity: .42`：重叠区域被**二次合成**，颜色明显更深。
- 为什么「中间行更重」：首行只有下侧重叠、尾行只有上侧重叠、中间行**上下都被邻行/兄弟盒子压了一遍**，重叠面积最大。
- 顺带：`selectionToRects()` 的合并条件只处理「同一行被切成两段（水平相邻）」的情况（`|Δy|<0.004 && |Δh|<0.004 && |prev.right-new.left|<0.01`），对「同一行的两个不同高度盒子」完全不生效 —— 高度差 6–8 px，条件直接不成立。

复现证据保存在审计过程的截图里（选中 3 行 → 高亮 → `COUNT=12 / OVERLAPS=5`）。

## 现象 2：删除线和下划线「一样」

实测两条 CSS（`src/styles/index.css:291-303`）：

```css
.pdf-mark-underline { border-bottom: 2px solid … }   /* 画在行盒子的底边 */
.pdf-mark-strike    { border-top:    1.5px solid … } /* 画在行盒子的顶边 */
```

两者都只是给**同一个行盒**加一条外边线，区别只是上下：

- 下划线落在行盒底边 ≈ 字形基线下方 2–3 px，观感正常。
- 删除线落在行盒**顶边**，比文字中线高 6–10 px；跨行时它紧贴上一行的字底，读起来就像「上一行的下划线」。
- 因为两条都是 `border-*: solid`、都是 2 px 左右的实线、都贴着盒子边缘，视觉上自然「看起来一样」，而不是一条穿过文字中间的删除线。

根因是**没有中线概念**：删除线需要 `top: 50%` 的独立直线元素（或渐变），不能复用下划线的 border 实现。

## 次要问题（一并修）

1. `AnnotationKind` 用的是 `'strike'`，而需求/导出语义是 `strikethrough`；`'rect'`（框选）与文本类标注混在同一个枚举里，渲染分支靠 `kind ===` 串联，新增类型容易漏。
2. 颜色/透明度/线宽全部写死在 CSS（`.pdf-mark-text{opacity:.42}`、`.pdf-mark-underline{border-bottom:2px}`），`meta.json` 里只存颜色名，**无法按篇或按条调整**。
3. 深色模式用一条 `mix-blend-mode: normal` 覆盖，等于换了一套语义；改成显式 rgba 后不再需要特例。
4. 导出 Markdown 只写「高亮 · p.N」，没有样式信息，跨设备/跨版本复现不出一致外观。

## 修复方案

1. **rect 归一化**（`consolidateRects`）：按纵向中心聚成「行」，每行只留一个 rect —— 取最紧的盒子作为高度与顶边，横向取该行的并集；不同行之间保证不重叠；渲染前再跑一次，旧数据（已存了重复 rect 的 meta.json）也一并被纠正。
2. **分层绘制**：高亮层（纯 `rgba` 背景 + `isolation: isolate`，不再 multiply）、下划线层、删除线层各自独立容器；删除线用**独立中线元素**（`top: 50%` + `translateY(-50%)`），与下划线实现分开。
3. **类型枚举**：`highlight | underline | strikethrough | note`（外加既有的 `rect` 框选），旧 `strike` 在 `normalizeMeta` 里迁移为 `strikethrough`；`underline` 绝不被迁移成删除线。
4. **样式入 meta**：`annotationStyleVersion: 2` + `styles`（每篇默认：颜色/透明度/线宽/偏移/高亮 padding），单条标注可覆盖；旧文件缺字段时补默认，不改变既有外观太多。
5. **UI**：工具栏新增「标注样式」弹层（全局默认），选中标注的编辑器里提供同组滑块（单独覆盖），改动即时预览并落盘。
6. **导出**：Markdown 里补上类型、页码、原文、样式摘要（颜色/透明度/线宽）。

## 修复后的验证（同一套测量）

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 一次跨行高亮生成的 `.pdf-mark` 数量 | 12 | **7**（= 实际行数） |
| rect 互相重叠的对数 | 5 | **0** |
| 高亮合成方式 | `multiply` + `opacity .42`（重叠处二次合成） | 纯 `rgba` 背景 + `isolation:isolate` |
| 删除线实现 | `border-top`（盒顶，比中线高 6–10px） | 独立中线元素（`top: rect.y + h*offset`，默认 50%） |
| 每条标注样式 | 写死在 CSS | `meta.json` 的 `styles` + 单条 `style` 覆盖 |

实测命令（截取）：跨行选中 §1 前 5 行 → 高亮 → `N=7 OVERLAPS=0`；把默认透明度滑到 15% 后，所有高亮元素 `getComputedStyle().opacity === "0.15"`。

## 兼容与迁移

- 旧 `meta.json` 里 `kind: "strike"` 读盘时升级为 `strikethrough`；`underline` 不做任何迁移（有单测钉住）。
- 旧文件没有 `styles` / `annotationStyleVersion` 时补默认值，`normalizeMeta` 不批量改写磁盘，等下一次保存才写回。
- 旧标注里已经存了「重复 rect」的，渲染时会再跑一次 `consolidateRects`，不需要改数据。
