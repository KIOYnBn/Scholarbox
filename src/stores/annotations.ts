import { useLibraryStore } from './library'
import type { Annotation, AnnotationStyles } from '@/lib/vault/schema'

/**
 * 标注写入策略：
 * - 内存里立刻改（UI 必须跟手）
 * - `meta.json` 500ms 防抖落盘（连续拖框 / 改颜色只写一次）
 * - 关闭页面前 flush，避免最后一次改动丢失
 */
const pending = new Map<string, Annotation[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const FLUSH_DELAY = 500

export function readAnnotations(dir: string): Annotation[] {
  const paper = useLibraryStore.getState().papers.find((p) => p.dir === dir)
  return paper?.meta.annotations ?? []
}

async function flush(dir: string) {
  const next = pending.get(dir)
  pending.delete(dir)
  const timer = timers.get(dir)
  if (timer) clearTimeout(timer)
  timers.delete(dir)
  if (!next) return
  await useLibraryStore.getState().updateMeta(dir, { annotations: next })
}

export function commitAnnotations(dir: string, next: Annotation[]) {
  useLibraryStore.getState().patchLocal(dir, { annotations: next })
  pending.set(dir, next)
  const existing = timers.get(dir)
  if (existing) clearTimeout(existing)
  timers.set(
    dir,
    setTimeout(() => {
      void flush(dir)
    }, FLUSH_DELAY),
  )
}

export function flushAnnotations(dir?: string) {
  if (dir) {
    void flush(dir)
    return
  }
  for (const key of [...pending.keys()]) void flush(key)
}

export function addAnnotation(dir: string, annotation: Annotation) {
  commitAnnotations(dir, [...readAnnotations(dir), annotation])
  return annotation
}

export function updateAnnotation(dir: string, id: string, patch: Partial<Annotation>) {
  const next = readAnnotations(dir).map((a) => (a.id === id ? { ...a, ...patch } : a))
  commitAnnotations(dir, next)
}

export function removeAnnotation(dir: string, id: string) {
  commitAnnotations(
    dir,
    readAnnotations(dir).filter((a) => a.id !== id),
  )
}

/**
 * 这篇文献的默认标注样式（存在 meta.json 的 `styles`）。
 * 与单条覆盖分开：改默认值只影响「没单独设过」的标注。
 */
export function updateStyles(dir: string, patch: Partial<AnnotationStyles>) {
  const paper = useLibraryStore.getState().papers.find((p) => p.dir === dir)
  const current = paper?.meta.styles
  if (!current) return
  const next = { ...current, ...patch }
  void useLibraryStore.getState().updateMeta(dir, { styles: next })
}

export function annotationsForPage(dir: string, page: number): Annotation[] {
  return readAnnotations(dir).filter((a) => a.page === page)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushAnnotations())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnnotations()
  })
}
