import { useVaultStore } from '@/stores/vault'
import type { PaperStatus } from './schema'

interface DemoPaper {
  title: string
  authors: string[]
  year: number
  venue: string
  impactFactor: number | null
  field: string
  tags: string[]
  importance: 1 | 2 | 3 | 4 | 5
  status: PaperStatus
  progress: number
  doi?: string
  abstract: string
  note: string
  withPdf?: boolean
}

const DEMO: DemoPaper[] = [
  {
    title: 'A Hybrid Lexical–Dense Index for Scientific Literature Retrieval',
    authors: ['Mira Halvorsen', 'Daniel Okonkwo', 'Lin Wei', 'Sofia Fernández'],
    year: 2025,
    venue: 'arXiv preprint',
    impactFactor: null,
    field: '信息检索',
    tags: ['hybrid-search', 'retrieval', 'index'],
    importance: 4,
    status: 'reading',
    progress: 42,
    doi: '10.48550/arXiv.2501.00042',
    abstract:
      'Retrieval over scientific corpora is dominated by two failure modes: lexical systems miss paraphrase, while dense encoders flatten rare terminology into generic regions of the embedding space. We describe HX-Index, a hybrid structure that preserves an auditable token index for long-tail terms and adds a small set of learned projections for semantic recall.',
    withPdf: true,
    note: `# HX-Index 阅读笔记

> 目标：判断这套「词法 + 稠密」混合索引能不能直接接到我们的文献库检索上。

## 一句话总结
用倒排索引兜住长尾术语，再用 256 维的冻结编码器补语义召回，代价大约 6% 的额外存储。

## 方法
- 每篇文档保留两个视图：词法视图（倒排 + 位置载荷）/ 稠密视图（int8 平铺文件）
- 查询时两路分别打分，再用调好的权重合并
- 增量更新不需要重建整个索引 —— 这点对本地文献库很关键

## 关键结论

| 指标 | BM25 | Dense | HX-Index |
| --- | --- | --- | --- |
| recall@10 | 0.71 | 0.78 | **0.84** |
| 中位延迟 | 42 ms | 118 ms | 61 ms |

## 我的批注
论文没有给出编码器的内存占用。按 1M 文档粗算 \`1M × 256B ≈ 256MB\`，在平板上偏重，
如果要落地，大概得换成 64 维 + 量化。

## 待办
- [ ] 看看开源的实现有没有 Rust 版本
- [ ] 对比一下 SQLite FTS5 的 recall，可能够用
`,
  },
  {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'],
    year: 2017,
    venue: 'NeurIPS',
    impactFactor: null,
    field: '深度学习',
    tags: ['transformer', 'attention', '经典'],
    importance: 5,
    status: 'done',
    progress: 100,
    doi: '10.48550/arXiv.1706.03762',
    abstract:
      'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
    note: `# Attention Is All You Need

## 为什么重要
把序列建模从「循环」换成了「全局注意力」，并行度一下子打开了，之后所有大模型都建立在这上面。

## 核心公式
注意力就是带权平均，权重由 query 和 key 的点积给出：

\`\`\`text
Attention(Q, K, V) = softmax(QKᵀ / √d_k) V
\`\`\`

- 多头：把表示切成 h 份分别做注意力，再拼起来
- 位置编码：正弦函数，让模型知道词的顺序
- 残差 + LayerNorm：训练深层的必需品

## 摘录
> We suspect that for large values of d_k, the dot products grow large in magnitude,
> pushing the softmax function into regions where it has extremely small gradients.
`,
  },
  {
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: ['Patrick Lewis', 'Ethan Perez', 'Aleksandra Piktus'],
    year: 2020,
    venue: 'NeurIPS',
    impactFactor: null,
    field: '信息检索',
    tags: ['rag', 'retrieval', 'llm'],
    importance: 4,
    status: 'reading',
    progress: 68,
    doi: '10.48550/arXiv.2005.11401',
    abstract:
      'Large pre-trained language models store factual knowledge in their parameters, but their ability to access and precisely manipulate knowledge is still limited. We explore a general-purpose fine-tuning recipe for retrieval-augmented generation.',
    note: `# RAG 笔记

## 读到哪里
第 4 节实验部分，RAG-Sequence 和 RAG-Token 的区别看明白了。

## 疑问
- 检索器（DPR）是冻结的，那文档分布变化之后怎么办？
- top-k 取 5 还是 10，论文里对结果影响有多大？
`,
  },
  {
    title: 'Deep Residual Learning for Image Recognition',
    authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'],
    year: 2016,
    venue: 'CVPR',
    impactFactor: null,
    field: '计算机视觉',
    tags: ['resnet', '经典'],
    importance: 4,
    status: 'done',
    progress: 100,
    abstract:
      'Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.',
    note: `# ResNet

残差连接解决的是退化问题，不是过拟合。

\`\`\`text
y = F(x) + x
\`\`\`

> 学 \`F(x) = H(x) - x\` 比直接学 \`H(x)\` 容易，因为恒等映射在优化上更平滑。
`,
  },
  {
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    authors: ['Jacob Devlin', 'Ming-Wei Chang', 'Kenton Lee', 'Kristina Toutanova'],
    year: 2019,
    venue: 'NAACL',
    impactFactor: null,
    field: '自然语言处理',
    tags: ['bert', 'pretraining'],
    importance: 5,
    status: 'done',
    progress: 100,
    abstract:
      'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers.',
    note: `# BERT

两个预训练任务：Masked LM + Next Sentence Prediction。

- MLM 让模型学会双向上下文
- NSP 后来被证明用处不大（RoBERTa）
`,
  },
  {
    title: 'A Survey on Large Language Model based Autonomous Agents',
    authors: ['Lei Wang', 'Chen Ma', 'Xueyang Feng'],
    year: 2024,
    venue: 'Frontiers of Computer Science',
    impactFactor: 4.3,
    field: '智能体',
    tags: ['agent', 'survey', 'llm'],
    importance: 3,
    status: 'todo',
    progress: 0,
    abstract:
      'This paper presents a comprehensive survey of LLM-based autonomous agents, covering construction, application and evaluation.',
    note: `# 待读

综述，先看第 3 节（agent 的构造：profile / memory / planning / action）。
`,
  },
  {
    title: 'Dense Passage Retrieval for Open-Domain Question Answering',
    authors: ['Vladimir Karpukhin', 'Barlas Oğuz', 'Sewon Min'],
    year: 2020,
    venue: 'EMNLP',
    impactFactor: null,
    field: '信息检索',
    tags: ['dpr', 'retrieval'],
    importance: 3,
    status: 'done',
    progress: 100,
    abstract:
      'Open-domain question answering relies on efficient passage retrieval to select candidate contexts. We show that retrieval can be practically implemented using dense representations alone.',
    note: '',
  },
  {
    title: 'Neural Machine Translation by Jointly Learning to Align and Translate',
    authors: ['Dzmitry Bahdanau', 'Kyunghyun Cho', 'Yoshua Bengio'],
    year: 2015,
    venue: 'ICLR',
    impactFactor: null,
    field: '机器翻译',
    tags: ['attention', 'nmt'],
    importance: 4,
    status: 'reading',
    progress: 15,
    abstract:
      'Neural machine translation is a recently proposed approach to machine translation. We conjecture that the use of a fixed-length vector is a bottleneck and propose to extend this by allowing a model to automatically search for parts of a source sentence that are relevant.',
    note: '# Bahdanau Attention\n\n注意力机制的前身，先看第 3 节的对齐模型。\n',
  },
]

/**
 * Browser/demo mode ships with a small pre-built library so the UI can be
 * evaluated without a Rust toolchain. Never runs against a real user vault.
 */
export async function seedDemoVault(): Promise<boolean> {
  const { repo, kind, entry } = useVaultStore.getState()
  // Also seeds the in-memory fallback used when OPFS is unavailable.
  if (!repo || kind === 'tauri') return false
  // 只在默认的浏览器示例仓库里播种；用户自己新建的仓库必须是空的
  if (entry && entry.rootPath !== 'MyVault') return false

  const existing = await repo.paperDirs()
  if (existing.length > 0) return false

  let pdfBytes: Uint8Array | null = null
  try {
    const response = await fetch('/demo/Scholarly-Demo-Paper.pdf')
    if (response.ok) pdfBytes = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    console.warn('[demo] sample PDF unavailable', err)
  }

  const now = Date.now()
  let index = 0

  for (const spec of DEMO) {
    const record = await repo.create({
      title: spec.title,
      authors: spec.authors,
      year: spec.year,
      venue: spec.venue,
      impactFactor: spec.impactFactor,
      field: spec.field,
      tags: spec.tags,
      importance: spec.importance,
      doi: spec.doi,
      abstract: spec.abstract,
      pdf: spec.withPdf ? pdfBytes : null,
    })

    const openedAt = new Date(now - index * 36e5 * 7).toISOString()
    const created = new Date(now - (index + 1) * 864e5 * 3).toISOString()

    await repo.saveMeta(record.dir, {
      ...record.meta,
      status: spec.status,
      progress: spec.progress,
      lastPage: Math.max(0, Math.round((spec.progress / 100) * 2)),
      lastOpenedAt: openedAt,
      createdAt: created,
      updatedAt: openedAt,
    })

    if (spec.note) await repo.saveNote(record.dir, spec.note)
    index += 1
  }

  return true
}
