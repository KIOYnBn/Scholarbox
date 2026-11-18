// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CORS_PROXY, transportOptions } from '../repo'

const remote = { url: 'https://github.com/me/repo.git', branch: 'main', token: 'ghp_x' }

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

describe('transportOptions', () => {
  it('桌面端只给 http，不给 corsProxy（绝不走公共代理）', () => {
    ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const options = transportOptions({ ...remote, corsProxy: 'https://cors.example.org' })
    expect(options.http).toBeDefined()
    expect(options.corsProxy).toBeUndefined()
  })

  it('浏览器端只给 corsProxy，http 是 undefined', () => {
    const options = transportOptions(remote)
    expect(options.http).toBeUndefined()
    expect(options.corsProxy).toBe(DEFAULT_CORS_PROXY)
  })

  it('浏览器端可以换成自定义代理', () => {
    const options = transportOptions({ ...remote, corsProxy: 'https://my-proxy.example' })
    expect(options.corsProxy).toBe('https://my-proxy.example')
  })

  it('空白代理配置回落到默认值', () => {
    const options = transportOptions({ ...remote, corsProxy: '   ' })
    expect(options.corsProxy).toBe(DEFAULT_CORS_PROXY)
  })
})
