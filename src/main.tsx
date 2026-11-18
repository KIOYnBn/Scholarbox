import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 开发期探针：在 WebView 里验证 Rust 侧 HTTP 通道是否真的可用
if (import.meta.env.DEV) {
  void import('@/lib/http').then(({ httpFetch, isTauriRuntime }) => {
    ;(window as unknown as Record<string, unknown>).__probeHttp = async (url: string) => {
      try {
        const res = await httpFetch(url)
        return `ok ${res.status} tauri=${isTauriRuntime()}`
      } catch (err) {
        return `fail ${String(err)}`
      }
    }
  })
}
