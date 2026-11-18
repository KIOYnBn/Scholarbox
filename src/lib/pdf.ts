import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
// Vite rewrites this to a hashed asset URL, so the worker always matches the
// installed pdfjs-dist version (a mismatch is the classic "PDF.js is broken" bug).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** 96 CSS px per inch ÷ 72 PDF points — a zoom of 1 means "actual size". */
export const CSS_UNITS = 96 / 72

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type { PDFDocumentProxy, PDFPageProxy }

export interface LoadOptions {
  onProgress?: (loaded: number, total: number) => void
}

/**
 * Opens a PDF from a URL (desktop: Tauri asset protocol) or from bytes
 * (browser/OPFS mode). Range requests are left enabled so a 500 MB file is
 * fetched on demand instead of being buffered whole.
 */
export async function loadPdfDocument(
  source: string | Uint8Array,
  options: LoadOptions = {},
): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    ...(typeof source === 'string' ? { url: source } : { data: source }),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    useSystemFonts: true,
  })

  if (options.onProgress) {
    task.onProgress = (progress: { loaded: number; total: number }) =>
      options.onProgress?.(progress.loaded, progress.total)
  }

  return task.promise
}

/**
 * PDFDocumentProxy.destroy() exists at runtime but is missing from the v6 type
 * definitions, so go through a narrow structural cast instead of `any`.
 */
export function disposePdfDocument(doc: PDFDocumentProxy | null | undefined) {
  if (!doc) return
  const destroyable = doc as unknown as { destroy?: () => Promise<void> }
  try {
    void destroyable.destroy?.()
  } catch (err) {
    console.warn('[pdf] destroy failed', err)
  }
}

export interface PageSize {
  width: number
  height: number
}

/** Reads the page box of a single page (used by the lazy scroller). */
export async function measurePage(doc: PDFDocumentProxy, pageNumber: number): Promise<PageSize> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  page.cleanup()
  return { width: viewport.width, height: viewport.height }
}

/**
 * Reads every page box up front so the virtual scroller knows the exact total
 * height (no jumpy re-layout). For very long documents we sample page 1 instead —
 * the layout is then uniform, which is true for virtually every journal PDF.
 */
export async function measurePageSizes(
  doc: PDFDocumentProxy,
  sampleLimit = 400,
): Promise<PageSize[]> {
  if (doc.numPages > sampleLimit) {
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    return Array.from({ length: doc.numPages }, () => ({
      width: viewport.width,
      height: viewport.height,
    }))
  }

  const sizes = new Array<PageSize>(doc.numPages)
  let cursor = 0

  const worker = async () => {
    while (cursor < doc.numPages) {
      const index = cursor++
      const page = await doc.getPage(index + 1)
      const viewport = page.getViewport({ scale: 1 })
      sizes[index] = { width: viewport.width, height: viewport.height }
      page.cleanup()
    }
  }

  await Promise.all(Array.from({ length: Math.min(10, doc.numPages) }, worker))
  return sizes
}

/** Renders the invisible, selectable text layer on top of the canvas. */
export async function renderTextLayer(
  page: PDFPageProxy,
  container: HTMLDivElement,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
): Promise<unknown | null> {
  container.replaceChildren()
  container.style.setProperty('--scale-factor', String(viewport.scale))
  container.style.setProperty('--total-scale-factor', String(viewport.scale))

  // pdfjs-dist ≥ 5 exposes the TextLayer class; the old renderTextLayer() helper
  // was removed, so feature-detect instead of pinning to one API.
  const TextLayerCtor = (pdfjs as unknown as Record<string, unknown>)['TextLayer'] as
    | (new (params: {
        textContentSource: unknown
        container: HTMLElement
        viewport: unknown
      }) => { render: () => Promise<void>; cancel?: () => void })
    | undefined

  if (!TextLayerCtor) return null

  try {
    const layer = new TextLayerCtor({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    })
    await layer.render()
    return layer
  } catch (err) {
    console.warn('[pdf] text layer failed', err)
    return null
  }
}

export function isPdfFile(name: string): boolean {
  return /\.pdf$/i.test(name)
}

/** Reasonable default metadata from a filename like `vaswani_2017_attention.pdf`. */
export function guessMetadataFromFilename(filename: string) {
  const base = filename.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim()
  const year = base.match(/\b(19|20)\d{2}\b/)?.[0]
  const cleaned = base
    .replace(/^\s*(19|20)\d{2}\s*[-_.]?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    title: cleaned.charAt(0).toUpperCase() + cleaned.slice(1) || '未命名文献',
    year: year ? Number(year) : null,
  }
}
