import { useLibraryStore } from '@/stores/library'
import { useVaultStore } from '@/stores/vault'
import { guessMetadataFromFilename, isPdfFile } from '@/lib/pdf'
import type { PaperRecord } from '@/lib/vault/schema'

export interface ImportOptions {
  field?: string
  tags?: string[]
}

/**
 * Drops one or more PDFs into the vault. The folder name comes from the file name
 * (`vaswani_2017_attention.pdf` → `Vaswani_2017_Attention`) and meta.json is filled
 * with a best-effort guess that the user can correct in the details panel.
 */
export async function importPdfFiles(
  files: File[],
  options: ImportOptions = {},
): Promise<PaperRecord[]> {
  const pdfs = files.filter((file) => isPdfFile(file.name))
  const created: PaperRecord[] = []

  for (const file of pdfs) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const guess = guessMetadataFromFilename(file.name)
    const record = await useLibraryStore.getState().createPaper({
      title: guess.title,
      year: guess.year,
      field: options.field ?? '',
      tags: options.tags ?? [],
      pdf: bytes,
    })
    if (record) created.push(record)
  }

  if (created.length > 0) {
    useVaultStore.setState({ notice: `已导入 ${created.length} 篇文献` })
  }
  return created
}
