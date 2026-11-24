import { extractWikiLinks, splitWikiRef } from './wiki'
import type { NoteDoc } from './links'
import type { VaultFS } from '@/lib/fs/types'

/**
 * 关系图谱的数据层：节点 = 文献笔记 + 独立笔记（+ 未解析的引用目标），
 * 边 = 笔记之间的 `[[链接]]` / `![[嵌入]]` / 块引用。
 * 关系线文字（边的标注）集中存在 `.scholarbox/graph.json`，不污染笔记正文。
 */

export interface GraphNode {
  /** 文献笔记：`papers/<dir>/<noteName>`；独立笔记：`notes/<file>`；未解析：`unresolved:<raw>` */
  id: string
  kind: 'paper' | 'note' | 'unresolved'
  label: string
  doc?: NoteDoc
}

export interface GraphEdge {
  /** `${sourceId}|${targetId}`，同时也是关系线标注的 key */
  id: string
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 解析一个引用路径 → 指向的笔记文档（规则与链接跳转一致，大小写不敏感） */
export function resolveWikiTarget(pathPart: string, docs: NoteDoc[]): NoteDoc | null {
  const clean = pathPart.replace(/^\.\//, '').trim().toLowerCase()
  if (!clean) return null
  for (const doc of docs) {
    if (doc.dir) {
      if (clean === doc.dir.toLowerCase()) return doc
      if (clean === `papers/${doc.dir}`.toLowerCase()) return doc
      if (clean === `papers/${doc.dir}/${(doc.file.split('/').pop() ?? '').toLowerCase()}`) return doc
    }
    if (clean === doc.file.toLowerCase()) return doc
    if (clean === doc.file.replace(/\.md$/i, '').toLowerCase()) return doc
    const base = (doc.file.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase()
    if (base && clean === base) return doc
    if (clean === doc.title.toLowerCase()) return doc
  }
  return null
}

/** 构建图谱：全库笔记的链接关系（含未解析目标，虚心节点显示） */
export function buildGraph(docs: NoteDoc[]): GraphData {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()

  for (const doc of docs) {
    nodes.set(doc.file, {
      id: doc.file,
      kind: doc.kind === 'standalone' ? 'note' : 'paper',
      label: doc.title,
      doc,
    })
  }

  for (const doc of docs) {
    for (const ref of extractWikiLinks(doc.body ?? '')) {
      const { path: pathPart } = splitWikiRef(ref.path)
      if (!pathPart.trim()) continue
      const resolved = resolveWikiTarget(pathPart, docs)
      const targetId = resolved?.file ?? `unresolved:${pathPart.trim().toLowerCase()}`
      if (targetId === doc.file) continue
      if (!nodes.has(targetId)) {
        nodes.set(targetId, { id: targetId, kind: 'unresolved', label: pathPart.trim() })
      }
      const edgeId = `${doc.file}|${targetId}`
      if (!edges.has(edgeId)) {
        edges.set(edgeId, { id: edgeId, source: doc.file, target: targetId })
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/* ── 关系线标注的存取 ────────────────────────────────────────────────── */

const GRAPH_FILE = '.scholarbox/graph.json'

export function edgeLabelKey(sourceId: string, targetId: string): string {
  return `${sourceId}|${targetId}`
}

export async function loadGraphLabels(fs: VaultFS): Promise<Record<string, string>> {
  try {
    const text = await fs.readText(GRAPH_FILE)
    const parsed = JSON.parse(text) as { labels?: Record<string, unknown> }
    const labels: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed.labels ?? {})) {
      if (typeof value === 'string' && value.trim()) labels[key] = value.trim()
    }
    return labels
  } catch {
    return {}
  }
}

export async function saveGraphLabels(fs: VaultFS, labels: Record<string, string>): Promise<void> {
  const dir = GRAPH_FILE.slice(0, GRAPH_FILE.lastIndexOf('/'))
  if (!(await fs.exists(dir))) await fs.mkdir(dir)
  await fs.writeText(GRAPH_FILE, `${JSON.stringify({ version: 1, labels }, null, 2)}\n`)
}
