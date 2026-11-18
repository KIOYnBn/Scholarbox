import type { PDFPageProxy } from 'pdfjs-dist'

export interface CaptureRegion {
  /** CSS 像素，相对页面左上角 */
  x: number
  y: number
  w: number
  h: number
}

export interface CapturedImage {
  bytes: Uint8Array
  width: number
  height: number
}

const MAX_OUTPUT_WIDTH = 2400
const MAX_PIXELS = 12_000_000

/**
 * 把 PDF 页面的一块区域截成 PNG。
 *
 * 关键点是**重新渲染**而不是从屏幕画布上抠像素：屏幕上的画布是按当前缩放和
 * devicePixelRatio 画的，直接抠出来放大就糊；这里按目标像素宽度重新计算
 * pdf.js 的 scale 再渲染一次，导出的图放在笔记里放大看依然是清晰的。
 */
export async function capturePageRegion(
  page: PDFPageProxy,
  region: CaptureRegion,
  displayedWidth: number,
): Promise<CapturedImage> {
  const base = page.getViewport({ scale: 1 })
  const cssToPdf = base.width / Math.max(displayedWidth, 1)

  // 输出宽度：屏幕宽度的 2 倍（高清屏不糊），但别无限大
  const targetWidth = Math.min(Math.max(Math.round(region.w * 2), 240), MAX_OUTPUT_WIDTH)
  let scale = targetWidth / Math.max(region.w * cssToPdf, 1e-6)

  // 整页画布可能非常大，按总像素上限再收一次
  const pagePixels = base.width * scale * base.height * scale
  if (pagePixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pagePixels)

  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('无法创建画布上下文')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, canvasContext: context, viewport }).promise

  // 屏幕坐标 -> 输出画布坐标
  const ratio = canvas.width / Math.max(displayedWidth, 1)
  const sx = Math.round(region.x * ratio)
  const sy = Math.round(region.y * ratio)
  const sw = Math.max(1, Math.round(region.w * ratio))
  const sh = Math.max(1, Math.round(region.h * ratio))

  const output = document.createElement('canvas')
  output.width = Math.min(sw, canvas.width - Math.max(sx, 0))
  output.height = Math.min(sh, canvas.height - Math.max(sy, 0))
  const outContext = output.getContext('2d', { alpha: false })
  if (!outContext) throw new Error('无法创建画布上下文')
  outContext.fillStyle = '#ffffff'
  outContext.fillRect(0, 0, output.width, output.height)
  outContext.drawImage(
    canvas,
    Math.max(sx, 0),
    Math.max(sy, 0),
    output.width,
    output.height,
    0,
    0,
    output.width,
    output.height,
  )

  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('导出 PNG 失败')

  // 大图用完立刻释放，平板上内存很紧
  canvas.width = 0
  canvas.height = 0

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: output.width,
    height: output.height,
  }
}

/** `assets/p3-20261116-130412.png` */
export function captureFileName(page: number, now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `p${page}-${stamp}.png`
}
