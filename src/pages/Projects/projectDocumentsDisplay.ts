import type { ClientPO, VendorPO } from '../../slices/baseline/reducer'
import type { PitchVersion, VendorMapping } from '../../slices/pitch/reducer'
import type { Project, ProjectDocumentFile } from '../../slices/projects/reducer'
import { formatDate } from '../../utils/formatters'
import { openAuthenticatedDocument } from '@/utils/openAuthenticatedDocument'
import { parseHttpUrl } from './projectCreateHelpers'

export interface ProjectDocumentColumnRow {
  id: string
  name: string
  typeLabel: string
  uploadedBy: string
  dateStr: string
  sizeStr: string | null
  isUpload: boolean
  blobUrl?: string
  fileName?: string
  canDelete: boolean
  onView: () => void
  onDownload?: () => void
  /** When set, the name renders as an external link. */
  href?: string
}

export interface ProjectDocumentSection {
  title: string
  rows: ProjectDocumentColumnRow[]
}

/** Canonical Create Project → Project Documents categories. */
export const PROJECT_DOCUMENT_CATEGORY_TITLES = [
  'Requirements',
  'Final Layout',
  'Final RCP',
  'Final Views',
  'Final Photographs',
  'Final Handover Documents',
] as const

export type ProjectDocumentCategoryTitle = (typeof PROJECT_DOCUMENT_CATEGORY_TITLES)[number]

const HANDOVER_SECTION_TITLE: ProjectDocumentCategoryTitle = 'Final Handover Documents'

/** Map list-API doctypes into Project Documents section titles. */
export const PROJECT_DOCTYPE_SECTION_TITLE: Record<string, ProjectDocumentCategoryTitle> = {
  requirement: 'Requirements',
  final_layout: 'Final Layout',
  final_rcp: 'Final RCP',
  final_views: 'Final Views',
  final_photographs: 'Final Photographs',
  handover: 'Final Handover Documents',
  project_documents: 'Final Handover Documents',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileToRow(
  file: ProjectDocumentFile,
  typeLabel: string,
  rowId: string,
): ProjectDocumentColumnRow {
  return {
    id: rowId,
    name: file.fileName,
    typeLabel,
    uploadedBy: 'System',
    dateStr: formatDate(file.uploadedAt),
    sizeStr: formatBytes(file.sizeBytes),
    isUpload: false,
    blobUrl: file.blobUrl,
    fileName: file.fileName,
    canDelete: false,
    onView: () => {
      void openAuthenticatedDocument(file.blobUrl)
    },
    onDownload: () => {
      const a = document.createElement('a')
      a.href = file.blobUrl
      a.download = file.fileName
      a.click()
    },
  }
}

function linkToRow(
  rowId: string,
  url: string,
  description: string | undefined,
  projectCreatedAt: string,
): ProjectDocumentColumnRow {
  const label = description?.trim() && description.trim() !== url ? description.trim() : url
  return {
    id: rowId,
    name: label,
    typeLabel: 'Link',
    uploadedBy: 'System',
    dateStr: formatDate(projectCreatedAt),
    sizeStr: null,
    isUpload: false,
    canDelete: false,
    href: url,
    onView: () => window.open(url, '_blank', 'noopener,noreferrer'),
  }
}

function notesOnlyRow(
  rowId: string,
  notes: string,
  projectCreatedAt: string,
): ProjectDocumentColumnRow {
  return {
    id: rowId,
    name: notes.trim(),
    typeLabel: 'Notes',
    uploadedBy: 'System',
    dateStr: formatDate(projectCreatedAt),
    sizeStr: null,
    isUpload: false,
    canDelete: false,
    onView: () => {},
  }
}

interface CategorySource {
  title: ProjectDocumentCategoryTitle
  link?: string
  description?: string
  file?: ProjectDocumentFile
  extraFiles?: ProjectDocumentFile[]
}

function rowsForCategory(
  key: string,
  source: CategorySource,
  projectCreatedAt: string,
): ProjectDocumentColumnRow[] {
  const rows: ProjectDocumentColumnRow[] = []
  const desc = source.description?.trim()
  const url = source.link?.trim() || (desc ? parseHttpUrl(desc) : undefined)

  if (url) {
    rows.push(linkToRow(`project-doc-link-${key}`, url, desc, projectCreatedAt))
  } else if (desc) {
    rows.push(notesOnlyRow(`project-doc-notes-${key}`, desc, projectCreatedAt))
  }

  if (source.file) {
    rows.push(fileToRow(source.file, 'Uploaded file', `project-doc-file-${key}-${source.file.id}`))
  }

  for (const file of source.extraFiles ?? []) {
    rows.push(
      fileToRow(file, 'Uploaded file', `project-doc-file-${key}-${file.id}`),
    )
  }

  return rows
}

function categorySourcesFromDocs(docs: NonNullable<Project['projectDocuments']>): CategorySource[] {
  const handoverFiles: ProjectDocumentFile[] = []
  const seen = new Set<string>()
  const pushHandover = (f: ProjectDocumentFile | undefined) => {
    if (!f || seen.has(f.id)) return
    seen.add(f.id)
    handoverFiles.push(f)
  }
  pushHandover(docs.finalHandoverFile)
  for (const f of docs.finalHandoverDocuments ?? []) {
    pushHandover(f)
  }

  return [
    {
      title: 'Final Layout',
      link: docs.finalLayoutLink,
      description: docs.finalLayoutDescription,
      file: docs.finalLayoutFile,
    },
    {
      title: 'Final RCP',
      link: docs.finalRcpLink,
      description: docs.finalRcpDescription,
      file: docs.finalRcpFile,
    },
    {
      title: 'Final Views',
      link: docs.finalViewsLink,
      description: docs.finalViewsDescription,
      file: docs.finalViewsFile,
    },
    {
      title: 'Final Photographs',
      link: docs.finalPhotographsLink,
      description: docs.finalPhotographsDescription,
      file: docs.finalPhotographsFile,
    },
    {
      title: 'Final Handover Documents',
      link: docs.finalHandoverLink,
      description: docs.finalHandoverDescription,
      extraFiles: handoverFiles,
    },
  ]
}

export interface BuildProjectDocumentSectionsOptions {
  /** When true, always return all five category sections (including empty tables). */
  alwaysShowSections?: boolean
}

/** Prefer persisted projectDocuments from detail fetch, then list cache after create. */
export function resolveProjectForDocuments(
  project: Project,
  listItems: Project[],
): Project {
  if (project.projectDocuments) return project
  const listed = listItems.find((p) => p.id === project.id)
  if (!listed?.projectDocuments) return project
  return { ...project, projectDocuments: listed.projectDocuments }
}

/** Build per-category document sections from persisted project create data. */
export function buildProjectDocumentSections(
  project: Project,
  options?: BuildProjectDocumentSectionsOptions,
): ProjectDocumentSection[] {
  const alwaysShow = options?.alwaysShowSections ?? false
  const docs = project.projectDocuments
  const createdAt = project.createdAt

  const categories = docs ? categorySourcesFromDocs(docs) : []

  const built = (categories.length > 0 ? categories : []).map((cat) => ({
    title: cat.title,
    rows: rowsForCategory(
      cat.title.toLowerCase().replace(/\s+/g, '-'),
      cat,
      createdAt,
    ),
  }))

  const byTitle = new Map(built.map((s) => [s.title, s]))

  const sections = PROJECT_DOCUMENT_CATEGORY_TITLES.map((title) => {
    const existing = byTitle.get(title)
    return existing ?? { title, rows: [] }
  })

  if (alwaysShow) return sections

  return sections.filter((section) => section.rows.length > 0)
}

/** Attach legacy Internal-tab uploads to Final Handover Documents. */
export function mergeLegacyInternalUploadRows(
  sections: ProjectDocumentSection[],
  legacyRows: ProjectDocumentColumnRow[],
): ProjectDocumentSection[] {
  if (legacyRows.length === 0) return sections

  return sections.map((section) =>
    section.title === HANDOVER_SECTION_TITLE
      ? { ...section, rows: mergeDocumentRows(section.rows, legacyRows) }
      : section,
  )
}

/**
 * Merge documents list API rows (requirement / final_* / handover / project_documents)
 * into the Project Documents category sections so All + Project tabs both show them.
 */
export function mergeApiRowsIntoProjectDocumentSections(
  sections: ProjectDocumentSection[],
  rowsBySectionTitle: Partial<
    Record<ProjectDocumentCategoryTitle, ProjectDocumentColumnRow[]>
  >,
): ProjectDocumentSection[] {
  return sections.map((section) => {
    const title = section.title as ProjectDocumentCategoryTitle
    const extra = rowsBySectionTitle[title]
    if (!extra?.length) return section
    return { ...section, rows: mergeDocumentRows(section.rows, extra) }
  })
}

export function countProjectDocumentRows(sections: ProjectDocumentSection[]): number {
  return sections.reduce((sum, s) => sum + s.rows.length, 0)
}

export function filterProjectDocumentSectionsBySearch(
  sections: ProjectDocumentSection[],
  search: string,
  matchesSearch: (text: string, q: string) => boolean,
): ProjectDocumentSection[] {
  const q = search
  return sections.map((section) => ({
    ...section,
    rows: section.rows.filter((row) =>
      matchesSearch(
        `${row.name} ${row.typeLabel} ${row.uploadedBy} ${section.title}`,
        q,
      ),
    ),
  }))
}

function poDocumentLabel(poNumber: string, fileName?: string | null): string {
  if (fileName?.trim()) return fileName.trim()
  return poNumber
}

function openExternalDocument(url: string): void {
  void openAuthenticatedDocument(url)
}

/** Client PO file from Live / Transition baseline. */
export function clientPOToDocumentRow(po: ClientPO): ProjectDocumentColumnRow | null {
  if (!po.documentUrl && !po.fileName?.trim()) return null
  const href = po.documentUrl ?? undefined
  return {
    id: `baseline-client-po-${po.id}`,
    name: poDocumentLabel(po.poNumber, po.fileName),
    typeLabel: 'Client PO',
    uploadedBy: 'System',
    dateStr: formatDate(po.uploadedAt ?? po.startDate),
    sizeStr: null,
    isUpload: false,
    href,
    canDelete: false,
    onView: () => {
      if (po.documentUrl) openExternalDocument(po.documentUrl)
    },
  }
}

/** Vendor PO file from Live baseline. */
export function vendorPOToDocumentRow(po: VendorPO): ProjectDocumentColumnRow | null {
  if (!po.documentUrl && !po.fileName?.trim()) return null
  const href = po.documentUrl ?? undefined
  return {
    id: `baseline-vendor-po-${po.id}`,
    name: poDocumentLabel(po.poNumber, po.fileName),
    typeLabel: 'Vendor PO',
    uploadedBy: 'System',
    dateStr: formatDate(po.poDate),
    sizeStr: null,
    isUpload: false,
    href,
    canDelete: false,
    onView: () => {
      if (po.documentUrl) openExternalDocument(po.documentUrl)
    },
  }
}

/** Vendor quotation uploaded on the Pitch tab. */
export function vendorQuotationToDocumentRow(
  mapping: VendorMapping,
  serviceName: string,
): ProjectDocumentColumnRow | null {
  const quotation = mapping.quotation
  if (!quotation?.fileUrl) return null
  return {
    id: `pitch-vendor-quotation-${mapping.id}`,
    name: quotation.fileName || `${mapping.vendorName} — ${serviceName}`,
    typeLabel: 'Vendor Quotation',
    uploadedBy: 'System',
    dateStr: formatDate(quotation.uploadedAt),
    sizeStr: null,
    isUpload: false,
    href: quotation.fileUrl,
    canDelete: false,
    onView: () => openExternalDocument(quotation.fileUrl),
  }
}

export function collectPitchVendorQuotationRows(
  version: PitchVersion | null | undefined,
  projectId: string,
): ProjectDocumentColumnRow[] {
  if (!version || version.projectId !== projectId) return []
  const rows: ProjectDocumentColumnRow[] = []
  for (const category of version.categories) {
    for (const service of category.services) {
      for (const mapping of service.vendorMappings) {
        const row = vendorQuotationToDocumentRow(mapping, service.name)
        if (row) rows.push(row)
      }
    }
  }
  return rows
}

/** Merge document rows without duplicating the same file URL, blob, or stable document ID. */
export function mergeDocumentRows(
  ...groups: ProjectDocumentColumnRow[][]
): ProjectDocumentColumnRow[] {
  const seen = new Set<string>()
  const seenEntityIds = new Set<string>()
  const merged: ProjectDocumentColumnRow[] = []

  const entityIdFromRowId = (id: string): string | null => {
    const known = [
      'baseline-client-po-',
      'baseline-vendor-po-',
      'api-client-po-',
      'api-vendor-po-',
    ]
    for (const prefix of known) {
      if (id.startsWith(prefix)) return id.slice(prefix.length)
    }
    const apiGeneric = /^api-[a-z0-9_]+-(.+)$/i.exec(id)
    if (apiGeneric?.[1]) return apiGeneric[1]
    // Bare UUID / upload id
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return id
    }
    return null
  }

  for (const group of groups) {
    for (const row of group) {
      const entityId = entityIdFromRowId(row.id)
      if (entityId && seenEntityIds.has(entityId)) continue
      const key = row.href ?? row.blobUrl ?? row.id
      if (seen.has(key)) continue
      seen.add(key)
      if (entityId) seenEntityIds.add(entityId)
      merged.push(row)
    }
  }
  return merged
}

export function filterDocumentRowsBySearch(
  rows: ProjectDocumentColumnRow[],
  search: string,
  matchesSearch: (text: string, q: string) => boolean,
): ProjectDocumentColumnRow[] {
  return rows.filter((row) =>
    matchesSearch(`${row.name} ${row.typeLabel} ${row.uploadedBy}`, search),
  )
}
