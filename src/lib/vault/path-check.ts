import { appConfigDir, documentDir, join } from '@tauri-apps/api/path'
import { mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { grantFsScope, isTauriRuntime } from '@/lib/fs/tauri'
import type { VaultRootType } from './registry'
import { resolveRootPath } from './paths'

/**
 * 「这个路径能不能真的当仓库用」——去磁盘 / OPFS 上实际探一次。
 *
 * 只做四件事：建目录 → 写一个探针文件 → 读回来 → 删掉。
 * 探针文件名固定且以 `.` 开头，失败也不会留下垃圾（能删就删，删不掉也只是个小文件）。
 */
const PROBE_FILE = '.scholarbox-path-probe'

export interface ProbeResult {
  ok: boolean
  reason?: string
  /** 实际使用的绝对路径（桌面端相对路径会被解析到 appConfigDir 下） */
  resolved: string
}

export async function appConfigBaseDir(): Promise<string> {
  try {
    return await appConfigDir()
  } catch {
    try {
      return await documentDir()
    } catch {
      return ''
    }
  }
}

async function probeDesktop(resolved: string): Promise<ProbeResult> {
  const probe = await join(resolved, PROBE_FILE)
  // 必须先放行，否则写探针会被静态 scope 拒绝（见 REVIEW P0-2）
  await grantFsScope(resolved)
  try {
    await mkdir(resolved, { recursive: true })
  } catch (err) {
    return { ok: false, resolved, reason: `无法创建目录：${messageOf(err)}` }
  }

  // 探针文件必须保证不留痕迹：写一次、读一次，无论成败都在 finally 里删掉。
  // 之前写失败的分支没有删（虽然文件也没建成），读失败分支删了但忽略了错误，
  // 结果在某些权限下 `.scholarbox-path-probe` 会残留在用户的仓库目录里。
  let wrote = false
  try {
    try {
      await writeTextFile(probe, 'ok')
      wrote = true
    } catch (err) {
      return { ok: false, resolved, reason: `目录不可写：${messageOf(err)}` }
    }

    try {
      await readTextFile(probe)
    } catch (err) {
      return { ok: false, resolved, reason: `目录不可读：${messageOf(err)}` }
    }

    return { ok: true, resolved }
  } finally {
    if (wrote) {
      await remove(probe).catch((err) => {
        // 删不掉不算失败（文件已经证明目录可读写），但要留下线索而不是静默吞掉
        console.warn('[probe] 探针文件未能删除，请手动清理：', probe, err)
      })
    }
  }
}

async function probeOpfs(resolved: string): Promise<ProbeResult> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return { ok: false, resolved, reason: '当前浏览器不支持 OPFS 存储' }
  }
  try {
    let dir = await navigator.storage.getDirectory()
    for (const segment of resolved.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    const handle = await dir.getFileHandle(PROBE_FILE, { create: true })
    const writable = await handle.createWritable()
    await writable.write('ok')
    await writable.close()
    await (await handle.getFile()).text()
    await dir.removeEntry(PROBE_FILE).catch(() => undefined)
    return { ok: true, resolved }
  } catch (err) {
    return { ok: false, resolved, reason: `OPFS 目录不可用：${messageOf(err)}` }
  }
}

export interface ProbeOptions {
  rootType: VaultRootType
  /** 已规范化的路径（绝对或相对） */
  path: string
}

export async function probeVaultPath(options: ProbeOptions): Promise<ProbeResult> {
  const desktop = isTauriRuntime()

  if (options.rootType === 'opfs' || !desktop) {
    return probeOpfs(options.path)
  }

  let resolved: string
  try {
    resolved = resolveRootPath(options.path, { desktop, baseDir: await appConfigBaseDir() })
  } catch (err) {
    // baseDir 拿不到（某些 Linux 环境没有 appConfigDir）：给出可读原因，别建到根目录
    return { ok: false, resolved: options.path, reason: messageOf(err) }
  }
  return probeDesktop(resolved)
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return '未知错误'
}
