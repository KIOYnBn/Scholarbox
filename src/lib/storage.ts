import type { StateStorage } from 'zustand/middleware'
import { isTauriRuntime } from '@/lib/fs/tauri'

/**
 * App-level preferences (theme, vault path, sync credentials) are NOT vault
 * content, so they live in the platform's app-data area:
 *  - Tauri  -> plugin-store JSON file under the app config dir
 *  - browser -> localStorage (dev only)
 */

let tauriStore: Promise<import('@tauri-apps/plugin-store').Store> | null = null

async function getTauriStore() {
  if (!tauriStore) {
    tauriStore = import('@tauri-apps/plugin-store').then((m) => m.load('settings.json', { autoSave: true }))
  }
  return tauriStore
}

export const appStorage: StateStorage = {
  async getItem(name) {
    if (isTauriRuntime()) {
      try {
        const store = await getTauriStore()
        return (await store.get<string>(name)) ?? null
      } catch (err) {
        console.warn('[storage] tauri store read failed', err)
      }
    }
    return globalThis.localStorage?.getItem(name) ?? null
  },

  async setItem(name, value) {
    if (isTauriRuntime()) {
      try {
        const store = await getTauriStore()
        await store.set(name, value)
        await store.save()
        return
      } catch (err) {
        console.warn('[storage] tauri store write failed', err)
      }
    }
    globalThis.localStorage?.setItem(name, value)
  },

  async removeItem(name) {
    if (isTauriRuntime()) {
      try {
        const store = await getTauriStore()
        await store.delete(name)
        await store.save()
      } catch {
        /* ignore */
      }
    }
    globalThis.localStorage?.removeItem(name)
  },
}
