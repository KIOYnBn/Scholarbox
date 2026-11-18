import { join, normalize } from '@/lib/path'
import { NOTES_DIR } from './repository'
import type { WikiCandidate } from '@/lib/editor/completion'

/**
 * 仓库文件索引：给 `[[ ]]` 补全用。
 * 只做一次浅层遍历（papers/ 两层、notes/、assets/、模板目录），不做全文检索。
 */
export interface VaultFile {
  path: string
  label: string
  kind: WikiCandidate['kind']
}

export async function collectVaultFiles(
  list: (dir: string) => Promise<Array<{ name: string; path: string; kind: 'file' | 'dir' }>>,
): Promise<VaultFile[]> {
  const files: VaultFile[] = []
  const walkPapers = async (dir: string) => {
    const entries = await list(dir).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'dir') {
        await walkPapers(entry.path)
        continue
      }
      const lower = entry.name.toLowerCase()
      if (lower.endsWith('.pdf')) files.push({ path: entry.path, label: entry.name, kind: 'paper' })
      else if (lower.endsWith('.md')) files.push({ path: entry.path, label: `${entry.name}（文献笔记）`, kind: 'note' })
      else if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) files.push({ path: entry.path, label: entry.name, kind: 'asset' })
    }
  }

  await walkPapers('papers')

  const notes = await list(NOTES_DIR).catch(() => [])
  for (const entry of notes) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    files.push({ path: normalize(join(NOTES_DIR, entry.name)), label: entry.name, kind: 'note' })
  }

  const templates = await list('.scholarbox/templates').catch(() => [])
  for (const entry of templates) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.md')) continue
    files.push({ path: normalize(join('.scholarbox/templates', entry.name)), label: entry.name, kind: 'template' })
  }

  return files
}

export function toCandidates(files: VaultFile[]): WikiCandidate[] {
  return files.map((file) => ({ path: file.path, label: file.label, kind: file.kind }))
}
