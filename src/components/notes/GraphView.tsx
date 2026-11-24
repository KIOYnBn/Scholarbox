import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Network, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLibraryStore } from '@/stores/library'
import { useStandaloneNotesStore } from '@/stores/standalone'
import { useVaultStore } from '@/stores/vault'
import { useUiStore, type NoteTarget } from '@/stores/ui'
import {
  buildGraph,
  loadGraphLabels,
  saveGraphLabels,
  type GraphEdge,
  type GraphNode,
} from '@/lib/notes/graph'
import type { NoteDoc } from '@/lib/notes/links'

/**
 * 关系图谱：节点 = 文献笔记 / 独立笔记（未解析的引用目标显示为虚心节点），
 * 边 = 笔记之间的 `[[链接]]` / `![[嵌入]]` / 块引用。
 * 在 Obsidian 图谱之上加了「关系线文字」：点击一条边可以给这层关系命名，
 * 标注集中存在 `.scholarbox/graph.json`，不污染笔记正文。
 */

const WIDTH = 860
const HEIGHT = 560

interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  fixed: boolean
}

/** 力导向布局一轮迭代：斥力 + 弹簧 + 向心力，返回是否还需要继续 */
function simulate(nodes: SimNode[], edges: GraphEdge[], alpha: number): boolean {
  const n = nodes.length
  if (n === 0) return false
  // 斥力（O(n²)，笔记库的量级完全够用）
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = nodes[i]!
      const b = nodes[j]!
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dist2 = dx * dx + dy * dy
      if (dist2 < 1) {
        dx = (Math.random() - 0.5) * 2
        dy = (Math.random() - 0.5) * 2
        dist2 = 4
      }
      const force = (26000 / dist2) * alpha
      const dist = Math.sqrt(dist2)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      if (!a.fixed) {
        a.vx += fx
        a.vy += fy
      }
      if (!b.fixed) {
        b.vx -= fx
        b.vy -= fy
      }
    }
  }
  // 弹簧：相连的节点拉到理想距离
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const edge of edges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
    const force = ((dist - 150) / dist) * 0.06 * alpha
    if (!a.fixed) {
      a.vx += dx * force
      a.vy += dy * force
    }
    if (!b.fixed) {
      b.vx -= dx * force
      b.vy -= dy * force
    }
  }
  // 向心力 + 阻尼 + 积分
  let moving = false
  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx += (WIDTH / 2 - node.x) * 0.012 * alpha
    node.vy += (HEIGHT / 2 - node.y) * 0.012 * alpha
    node.vx *= 0.82
    node.vy *= 0.82
    node.x += node.vx
    node.y += node.vy
    node.x = Math.max(30, Math.min(WIDTH - 30, node.x))
    node.y = Math.max(26, Math.min(HEIGHT - 40, node.y))
    if (Math.abs(node.vx) + Math.abs(node.vy) > 0.6) moving = true
  }
  return moving
}

function initPositions(count: number, seed: number): SimNode[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / Math.max(count, 1)) * Math.PI * 2 + seed
    const radius = Math.min(WIDTH, HEIGHT) * 0.32
    return {
      id: '',
      x: WIDTH / 2 + Math.cos(angle) * radius * (0.7 + (index % 3) * 0.15),
      y: HEIGHT / 2 + Math.sin(angle) * radius * (0.7 + ((index + 1) % 3) * 0.15),
      vx: 0,
      vy: 0,
      fixed: false,
    }
  })
}

export function GraphDialog() {
  const open = useUiStore((s) => s.graphOpen)
  const closeGraph = useUiStore((s) => s.closeGraph)
  const openNote = useUiStore((s) => s.openNote)
  const papers = useLibraryStore((s) => s.papers)
  const notes = useStandaloneNotesStore((s) => s.notes)
  const docs = useMemo<NoteDoc[]>(
    () => [
      ...papers.map((item) => ({
        kind: 'paper' as const,
        file: `papers/${item.dir}/${item.meta.noteName?.trim() || 'note.md'}`,
        title: item.meta.title,
        dir: item.dir,
        body: item.note ?? '',
      })),
      ...notes.map((item) => ({
        kind: 'standalone' as const,
        file: `notes/${item.file}`,
        title: item.title,
        body: item.body,
      })),
    ],
    [papers, notes],
  )

  const graph = useMemo(() => buildGraph(docs), [docs])

  const [labels, setLabels] = useState<Record<string, string>>({})
  const [labelsLoading, setLabelsLoading] = useState(false)
  const fs = useVaultStore((s) => s.fs)
  useEffect(() => {
    if (!open || !fs) return
    setLabelsLoading(true)
    void loadGraphLabels(fs)
      .then(setLabels)
      .finally(() => setLabelsLoading(false))
  }, [open, fs])

  const persistLabel = useCallback(
    async (key: string, text: string) => {
      if (!fs) return
      const next = { ...labels }
      if (text.trim()) next[key] = text.trim()
      else delete next[key]
      setLabels(next)
      await saveGraphLabels(fs, next).catch(() => undefined)
    },
    [fs, labels],
  )

  /* ── 力导向模拟 ───────────────────────────────────────────────────── */
  const simRef = useRef<SimNode[]>([])
  const alphaRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [, setTick] = useState(0)
  const graphKey = graph.nodes.map((n) => n.id).join('|')

  useEffect(() => {
    if (!open) return
    const seed = graphKey.length % 7
    const positions = initPositions(graph.nodes.length, seed)
    simRef.current = graph.nodes.map((node, index) => ({ ...positions[index]!, id: node.id }))
    alphaRef.current = 1
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const step = () => {
      const moving = simulate(simRef.current, graph.edges, alphaRef.current)
      alphaRef.current = Math.max(alphaRef.current * 0.986, 0.06)
      setTick((t) => t + 1)
      if (moving || alphaRef.current > 0.061) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, graphKey])

  /* ── 交互：拖节点 / 点节点打开 / 点边标注 ─────────────────────────── */
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ id: string; moved: boolean; dx: number; dy: number } | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [hoverId, setHoverId] = useState<string | null>(null)

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    }
  }, [])

  const reheat = () => {
    alphaRef.current = Math.max(alphaRef.current, 0.45)
    if (rafRef.current === null) {
      const step = () => {
        const moving = simulate(simRef.current, graph.edges, alphaRef.current)
        alphaRef.current = Math.max(alphaRef.current * 0.986, 0.06)
        setTick((t) => t + 1)
        if (moving || alphaRef.current > 0.061) rafRef.current = requestAnimationFrame(step)
        else rafRef.current = null
      }
      rafRef.current = requestAnimationFrame(step)
    }
  }

  const onNodePointerDown = (event: React.PointerEvent, id: string) => {
    event.preventDefault()
    const node = simRef.current.find((item) => item.id === id)
    if (!node) return
    const point = toSvg(event.clientX, event.clientY)
    dragRef.current = { id, moved: false, dx: point.x - node.x, dy: point.y - node.y }
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const point = toSvg(event.clientX, event.clientY)
    const node = simRef.current.find((item) => item.id === drag.id)
    if (!node) return
    const nx = point.x - drag.dx
    const ny = point.y - drag.dy
    if (Math.abs(nx - node.x) + Math.abs(ny - node.y) > 2) drag.moved = true
    node.x = Math.max(30, Math.min(WIDTH - 30, nx))
    node.y = Math.max(26, Math.min(HEIGHT - 40, ny))
    node.fixed = true
    reheat()
    setTick((t) => t + 1)
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag) {
      const node = simRef.current.find((item) => item.id === drag.id)
      if (node) node.fixed = false
      if (!drag.moved) {
        // 点击（没拖动）：打开对应笔记
        const node = graph.nodes.find((item) => item.id === drag.id)
        const doc = node?.doc
        if (doc) {
          const target: NoteTarget =
            doc.kind === 'paper' ? { kind: 'paper', dir: doc.dir! } : { kind: 'standalone', file: doc.file.slice('notes/'.length) }
          openNote(target)
        }
      }
    }
  }

  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph])
  const neighbors = useMemo(() => {
    if (!hoverId) return null
    const set = new Set<string>([hoverId])
    for (const edge of graph.edges) {
      if (edge.source === hoverId) set.add(edge.target)
      if (edge.target === hoverId) set.add(edge.source)
    }
    return set
  }, [graph, hoverId])

  const nodeRadius = (node: GraphNode) => (node.kind === 'paper' ? 10 : node.kind === 'note' ? 8 : 6)
  const nodeColor = (node: GraphNode) =>
    node.kind === 'paper' ? '#0d9488' : node.kind === 'note' ? '#8b5cf6' : 'transparent'

  const positions = simRef.current
  const posById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions, graphKey, positions.length])

  return (
    <Modal
      open={open}
      onClose={closeGraph}
      title={
        <span className="flex items-center gap-2">
          <Network className="size-3.5 text-accent" />
          关系图谱
        </span>
      }
      description="节点 = 笔记（实心）与未解析的引用目标（虚线空心）；连线 = [[链接]] / 嵌入 / 块引用。点击节点打开笔记，点击连线可以给它加关系文字。"
      className="max-w-5xl"
    >
      <div className="flex flex-col gap-2">
        <div className="relative overflow-hidden rounded-xl border border-line bg-surface-2/40">
          {graph.nodes.length === 0 ? (
            <div className="flex h-[420px] items-center justify-center text-[12px] text-ink-3">
              {labelsLoading ? <Loader2 className="size-4 animate-spin text-ink-3" /> : '还没有可以连成图的笔记'}
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-[480px] w-full touch-none select-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* 边 */}
              {graph.edges.map((edge) => {
                const a = posById.get(edge.source)
                const b = posById.get(edge.target)
                if (!a || !b) return null
                const label = labels[edge.id]
                const dim = neighbors ? !(neighbors.has(edge.source) && neighbors.has(edge.target)) : false
                return (
                  <g key={edge.id} opacity={dim ? 0.15 : 1}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="var(--sb-line)"
                      strokeWidth={selectedEdge?.id === edge.id ? 2.5 : 1.2}
                    />
                    {/* 加粗的透明命中区：点这条粗线选中边 */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={12}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedEdge(edge)
                        setLabelDraft(labels[edge.id] ?? '')
                      }}
                    />
                    {label ? (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 5}
                        textAnchor="middle"
                        className="fill-accent text-[10px] font-medium"
                        stroke="var(--sb-surface)"
                        strokeWidth={3}
                        paintOrder="stroke"
                        onClick={() => {
                          setSelectedEdge(edge)
                          setLabelDraft(label)
                        }}
                      >
                        {label}
                      </text>
                    ) : null}
                  </g>
                )
              })}
              {/* 节点 */}
              {graph.nodes.map((node) => {
                const p = posById.get(node.id)
                if (!p) return null
                const dim = neighbors ? !neighbors.has(node.id) : false
                const r = nodeRadius(node)
                return (
                  <g
                    key={node.id}
                    opacity={dim ? 0.25 : 1}
                    className="cursor-pointer"
                    onPointerDown={(event) => onNodePointerDown(event, node.id)}
                    onMouseEnter={() => setHoverId(node.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    {node.kind === 'unresolved' ? (
                      <circle cx={p.x} cy={p.y} r={r} fill="transparent" stroke="var(--sb-ink-3)" strokeWidth={1.4} strokeDasharray="3 2" />
                    ) : (
                      <circle cx={p.x} cy={p.y} r={r} fill={nodeColor(node)} />
                    )}
                    <text
                      x={p.x}
                      y={p.y + r + 12}
                      textAnchor="middle"
                      className="pointer-events-none fill-ink-2 text-[10.5px]"
                      stroke="var(--sb-surface-2)"
                      strokeWidth={2.5}
                      paintOrder="stroke"
                    >
                      {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {/* 关系线标注编辑 */}
        {selectedEdge ? (
          <div className="rounded-lg border border-accent/30 bg-accent-soft/30 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <Network className="size-3 text-accent" />
              <span className="truncate font-medium">{byId.get(selectedEdge.source)?.label ?? selectedEdge.source}</span>
              <span className="text-ink-3">──▶</span>
              <span className="truncate font-medium">{byId.get(selectedEdge.target)?.label ?? selectedEdge.target}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                autoFocus
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void persistLabel(selectedEdge.id, labelDraft)
                    setSelectedEdge(null)
                  }
                  if (event.key === 'Escape') setSelectedEdge(null)
                }}
                placeholder="这条关系是什么？例如：引用了它的方法 / 同一领域 / 后续工作…"
                className="sb-input h-7 flex-1 text-[11.5px]"
              />
              <button
                type="button"
                onClick={() => {
                  void persistLabel(selectedEdge.id, labelDraft)
                  setSelectedEdge(null)
                }}
                className="sb-btn sb-btn-primary h-7 px-2.5 text-[11px]"
              >
                保存
              </button>
              {labels[selectedEdge.id] ? (
                <button
                  type="button"
                  onClick={() => {
                    void persistLabel(selectedEdge.id, '')
                    setSelectedEdge(null)
                  }}
                  className="text-[10.5px] text-ink-3 hover:text-ink"
                >
                  删除标注
                </button>
              ) : null}
              <button type="button" onClick={() => setSelectedEdge(null)} className="text-[10.5px] text-ink-3 hover:text-ink">
                <X className="size-3" />
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3 px-1 text-[10px] text-ink-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-[#0d9488]" /> 文献笔记
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-[#8b5cf6]" /> 独立笔记
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full border border-dashed border-ink-3" /> 未解析的引用
          </span>
          <span className="ml-auto">拖动节点整理布局 · 悬停高亮邻接 · 点击节点打开笔记</span>
        </div>
      </div>
    </Modal>
  )
}
