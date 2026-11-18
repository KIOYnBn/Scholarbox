// Visual QA driver.
//   Browser: node scripts/shot.mjs .shots/out.png "[steps]" [url]
//   Desktop: SHOT_CDP=http://127.0.0.1:9222 node scripts/shot.mjs .shots/out.png "[steps]"
// Desktop mode attaches to the running Tauri window's WebView2 (launched by
// scripts/tauri-dev.cmd with --remote-debugging-port=9222) instead of launching Edge.
import puppeteer from 'puppeteer-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const cdp = process.env.SHOT_CDP ?? ''
const [, , outArg = '.shots/out.png', stepsArg = '[]', urlArg = 'http://localhost:4173/'] =
  process.argv

const steps = JSON.parse(stepsArg)

const browser = cdp
  ? await puppeteer.connect({ browserURL: cdp, defaultViewport: null })
  : await puppeteer.launch({
      executablePath: EDGE,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
      defaultViewport: {
        width: Number(process.env.SHOT_W ?? 1680),
        height: Number(process.env.SHOT_H ?? 1000),
        deviceScaleFactor: 1,
      },
    })

const page = cdp ? (await browser.pages()).find((p) => !p.url().startsWith('devtools://')) ?? (await browser.newPage()) : await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

if (!cdp) await page.goto(urlArg, { waitUntil: 'domcontentloaded' })
// Wait until the shell is mounted (boot screen replaced).
await page
  .waitForFunction(() => !document.body.innerText.includes('正在打开文献库'), { timeout: 30000 })
  .catch(() => logs.push('[warn] still on boot screen'))
await new Promise((r) => setTimeout(r, 900))

for (const step of steps) {
  if (step.click) {
    const found = await page.evaluate((text) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const value = (node.nodeValue ?? '').trim()
        if (!value.includes(text)) continue
        const el = node.parentElement
        if (!el) continue
        const target = el.closest('button, a, li, [role="button"]') ?? el
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return true
      }
      return false
    }, step.click)
    if (!found) logs.push(`[warn] click target not found: ${step.click}`)
  }
  if (step.clickSelector) {
    const ok = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return true
    }, step.clickSelector)
    if (!ok) logs.push(`[warn] selector not found: ${step.clickSelector}`)
  }
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait))
  if (step.waitFor) {
    await page.waitForSelector(step.waitFor, { timeout: step.timeout ?? 20000 }).catch(() => {
      logs.push(`[warn] waitFor timeout: ${step.waitFor}`)
    })
  }
  if (step.type) await page.keyboard.type(step.type, { delay: step.delay ?? 10 })
  if (step.key) {
    // "Shift+x" style combos: puppeteer's press() only accepts single key names.
    const parts = step.key.split('+')
    const main = parts.pop()
    for (const mod of parts) await page.keyboard.down(mod)
    await page.keyboard.press(main)
    for (const mod of [...parts].reverse()) await page.keyboard.up(mod)
  }
  if (step.selectRange) {
    // Select [start,end) offsets across the whole text layer (multi-line is fine),
    // then fire the mouseup the viewer listens for.
    const [from, to] = step.selectRange
    const ok = await page.evaluate(
      ({ from, to }) => {
        const layers = [...document.querySelectorAll('.textLayer')]
        for (const layer of layers) {
          const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
          const nodes = []
          let flat = ''
          let node
          while ((node = walker.nextNode())) {
            const value = node.nodeValue ?? ''
            nodes.push({ node, start: flat.length, end: flat.length + value.length })
            flat += value
          }
          const locate = (offset) => {
            for (const entry of nodes) {
              if (offset >= entry.start && offset <= entry.end) {
                return { node: entry.node, offset: offset - entry.start }
              }
            }
            return null
          }
          const start = locate(from)
          const end = locate(to)
          if (!start || !end) continue
          const range = document.createRange()
          range.setStart(start.node, start.offset)
          range.setEnd(end.node, end.offset)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          const page = layer.closest('[data-pdf-page]')
          page?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
          return true
        }
        return false
      },
      { from, to },
    )
    if (!ok) logs.push('[warn] selectRange failed')
    await new Promise((r) => setTimeout(r, 250))
  }
  if (step.selectText) {
    // Select a run of text inside the pdf.js text layer and fire the mouseup
    // that the viewer listens for — the same path a human drag takes.
    const ok = await page.evaluate((text) => {
      const layers = [...document.querySelectorAll('.textLayer')]
      for (const layer of layers) {
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
        const nodes = []
        let flat = ''
        let node
        while ((node = walker.nextNode())) {
          const value = node.nodeValue ?? ''
          nodes.push({ node, start: flat.length, end: flat.length + value.length })
          flat += value
        }
        const index = flat.indexOf(text)
        if (index < 0) continue
        const endIndex = index + text.length
        const locate = (offset) => {
          for (const entry of nodes) {
            if (offset >= entry.start && offset <= entry.end) {
              return { node: entry.node, offset: offset - entry.start }
            }
          }
          return null
        }
        const start = locate(index)
        const end = locate(endIndex)
        if (!start || !end) continue
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        const page = layer.closest('[data-pdf-page]')
        page?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        return true
      }
      return false
    }, step.selectText)
    if (!ok) logs.push(`[warn] selectText not found: ${step.selectText}`)
  }
  if (step.fill) {
    // [selector, text]：点进去、全选、键入、Tab 失焦（表单用的是 onBlur 提交）
    const [selector, text] = step.fill
    await page.click(selector)
    await page.keyboard.down('Control')
    await page.keyboard.press('a')
    await page.keyboard.up('Control')
    await page.keyboard.type(text, { delay: 8 })
    await page.keyboard.press('Tab')
    await new Promise((r) => setTimeout(r, 250))
  }
  if (step.wheel) {
    // [x, y, deltaY, modifiers] —— modifiers 位标志：Alt=1 Ctrl=2 Meta=4 Shift=8
    const [x, y, deltaY, modifiers = 0] = step.wheel
    const cdp = await page.createCDPSession()
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY,
      modifiers,
      pointerType: 'mouse',
    })
    await cdp.detach()
  }
  if (step.drag) {
    const [x1, y1, x2, y2] = step.drag
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 })
    await page.mouse.move(x2, y2, { steps: 5 })
    await page.mouse.up()
  }
  if (step.dragHold) {
    // 只按下并拖动，不松手 —— 用来截「正在框选」的那一帧
    const [x1, y1, x2, y2] = step.dragHold
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 })
    await page.mouse.move(x2, y2, { steps: 5 })
  }
  if (step.viewport) await page.setViewport({ ...step.viewport, deviceScaleFactor: 1 })
  // 包成 IIFE：直接 eval 会把 const 声明在页面全局，第二次同名就 SyntaxError
  if (step.eval) await page.evaluate(`(() => { ${step.eval} })()`)
  if (step.shot) {
    await mkdir(path.dirname(step.shot), { recursive: true })
    await page.screenshot({ path: step.shot })
  }
}

await mkdir(path.dirname(outArg), { recursive: true })
await page.screenshot({ path: outArg })
if (cdp) await browser.disconnect()
else await browser.close()

if (logs.length) console.log(logs.join('\n'))
console.log(`saved ${outArg}`)
