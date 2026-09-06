import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { openAuthenticatedDocument } from '@/utils/openAuthenticatedDocument'

/** Document upload categories (aligned with Documents tab). */
export type UploadCategory =
  | 'client_documents'
  | 'vendor_documents'
  | 'project_documents'
  | 'client_quotation'
  | 'client_po'
  | 'vendor_quotation'
  | 'vendor_po'
  | 'vendor_invoice_doc'
  | 'internal_requirements'
  | 'internal_attachments'
  | 'other'

/** Former "Internal" tab uploads — surfaced under Project Documents (not Others). */
export const LEGACY_INTERNAL_UPLOAD_CATEGORIES: UploadCategory[] = [
  'internal_requirements',
  'internal_attachments',
]

export function isLegacyInternalUploadCategory(
  category: UploadCategory,
): boolean {
  return LEGACY_INTERNAL_UPLOAD_CATEGORIES.includes(category)
}

export interface UploadedProjectDocument {
  id: string
  projectId: string
  displayName: string
  category: UploadCategory
  fileName: string
  sizeBytes: number
  uploadedAt: string
  uploadedBy: string
  uploadedByUserId: string
  notes: string
  blobUrl: string
}

const uploadsByProject = new Map<string, UploadedProjectDocument[]>()
/** Original files for in-session re-open when blob URLs are stale or revoked. */
const fileByUploadId = new Map<string, File>()
/** All blob URLs created for an upload — revoked only when the upload is removed. */
const blobUrlsByUploadId = new Map<string, Set<string>>()
const listeners = new Set<() => void>()

/** Stable empty snapshot for useSyncExternalStore (must not allocate per read). */
const EMPTY_UPLOADS: UploadedProjectDocument[] = []

function inferMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const mimeByExt: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return mimeByExt[ext] ?? 'application/octet-stream'
}

function toTypedFile(file: File): File {
  const type = file.type || inferMimeType(file.name)
  if (file.type === type) return file
  return new File([file], file.name, { type, lastModified: file.lastModified })
}

function trackBlobUrl(uploadId: string, url: string): void {
  const existing = blobUrlsByUploadId.get(uploadId)
  if (existing) {
    existing.add(url)
    return
  }
  blobUrlsByUploadId.set(uploadId, new Set([url]))
}

function revokeTrackedBlobUrls(uploadId: string): void {
  const urls = blobUrlsByUploadId.get(uploadId)
  if (!urls) return
  urls.forEach((url) => URL.revokeObjectURL(url))
  blobUrlsByUploadId.delete(uploadId)
}

function createBlobUrlForFile(file: File, uploadId?: string): string {
  const url = URL.createObjectURL(toTypedFile(file))
  if (uploadId) trackBlobUrl(uploadId, url)
  return url
}

function cacheUploadFile(id: string, file: File): void {
  fileByUploadId.set(id, file)
}

function discardUploadFile(id: string): void {
  fileByUploadId.delete(id)
  revokeTrackedBlobUrls(id)
}

/** Resolve a blob URL that remains valid for the lifetime of the upload. */
function resolveViewUrl(doc: UploadedProjectDocument): string | null {
  const cachedFile = fileByUploadId.get(doc.id)
  if (cachedFile) {
    if (doc.blobUrl?.startsWith('blob:')) {
      return doc.blobUrl
    }
    return createBlobUrlForFile(cachedFile, doc.id)
  }
  if (doc.blobUrl?.startsWith('blob:')) return doc.blobUrl
  if (doc.blobUrl?.trim()) return doc.blobUrl.trim()
  return null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isBrowserViewableInTab(fileName: string): boolean {
  const mime = inferMimeType(fileName)
  return mime === 'application/pdf' || mime.startsWith('image/')
}

function isBrowserViewableDoc(doc: UploadedProjectDocument): boolean {
  const cachedFile = fileByUploadId.get(doc.id)
  if (cachedFile?.type) {
    if (cachedFile.type === 'application/pdf' || cachedFile.type.startsWith('image/')) {
      return true
    }
  }
  return isBrowserViewableInTab(doc.fileName)
}

function openViaAnchor(url: string): boolean {
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}

function openInEmbeddedViewer(url: string, fileName: string, title: string): boolean {
  const mime = inferMimeType(fileName)
  const viewer = window.open('about:blank', '_blank')
  if (!viewer) return false

  const safeTitle = escapeHtml(title)
  viewer.document.open()
  viewer.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #525659; }
      iframe { border: 0; width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <iframe src="${url}" title="${safeTitle}" type="${mime}"></iframe>
  </body>
</html>`)
  viewer.document.close()
  return true
}

/**
 * Open an uploaded project document in a new browser tab.
 * Blob URLs must not be passed to window.open() directly — Chrome may treat them as search queries.
 * API file URLs require auth and are opened via authenticated fetch.
 */
export function openProjectUploadInNewTab(doc: UploadedProjectDocument): boolean {
  const url = resolveViewUrl(doc)
  if (!url) return false

  const title = doc.displayName || doc.fileName

  if (url.includes('/files/') && (url.includes('/view') || url.includes('/download'))) {
    void openAuthenticatedDocument(url)
    return true
  }

  if (isBrowserViewableDoc(doc)) {
    if (openInEmbeddedViewer(url, doc.fileName, title)) {
      return true
    }
  }

  return openViaAnchor(url)
}

/** Download an uploaded project document using the original file name. */
export function downloadProjectUpload(doc: UploadedProjectDocument): boolean {
  const url = resolveViewUrl(doc)
  if (!url) return false

  const link = document.createElement('a')
  link.href = url
  link.download = doc.fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}

function notify(): void {
  listeners.forEach((l) => l())
}

function snapshotForProject(projectId: string): UploadedProjectDocument[] {
  return uploadsByProject.get(projectId) ?? EMPTY_UPLOADS
}

export function getProjectUploads(projectId: string): UploadedProjectDocument[] {
  return [...snapshotForProject(projectId)]
}

export function addProjectUpload(doc: UploadedProjectDocument, file?: File | null): void {
  let nextDoc = doc
  if (file) {
    cacheUploadFile(doc.id, file)
    const blobUrl = createBlobUrlForFile(file, doc.id)
    nextDoc = {
      ...doc,
      blobUrl,
      fileName: file.name,
      sizeBytes: file.size,
    }
  } else if (doc.blobUrl) {
    trackBlobUrl(doc.id, doc.blobUrl)
  }
  const list = uploadsByProject.get(nextDoc.projectId) ?? []
  uploadsByProject.set(nextDoc.projectId, [...list, nextDoc])
  notify()
}

export function updateProjectUpload(
  id: string,
  updates: {
    displayName?: string
    notes?: string
    file?: File
    uploadedBy?: string
    uploadedByUserId?: string
  },
): UploadedProjectDocument | undefined {
  for (const [projectId, list] of uploadsByProject.entries()) {
    const idx = list.findIndex((u) => u.id === id)
    if (idx === -1) continue
    const prev = list[idx]
    let blobUrl = prev.blobUrl
    let fileName = prev.fileName
    let sizeBytes = prev.sizeBytes
    let uploadedAt = prev.uploadedAt
    if (updates.file) {
      revokeTrackedBlobUrls(id)
      if (prev.blobUrl) URL.revokeObjectURL(prev.blobUrl)
      blobUrl = createBlobUrlForFile(updates.file, id)
      fileName = updates.file.name
      sizeBytes = updates.file.size
      uploadedAt = new Date().toISOString()
      cacheUploadFile(id, updates.file)
    }
    const next: UploadedProjectDocument = {
      ...prev,
      displayName: updates.displayName?.trim() ?? prev.displayName,
      notes: updates.notes !== undefined ? updates.notes.trim() : prev.notes,
      fileName,
      sizeBytes,
      blobUrl,
      uploadedAt,
      uploadedBy: updates.uploadedBy ?? prev.uploadedBy,
      uploadedByUserId: updates.uploadedByUserId ?? prev.uploadedByUserId,
    }
    const newList = [...list]
    newList[idx] = next
    uploadsByProject.set(projectId, newList)
    notify()
    return next
  }
  return undefined
}

export function removeProjectUpload(id: string): UploadedProjectDocument | undefined {
  for (const [projectId, list] of uploadsByProject.entries()) {
    const found = list.find((u) => u.id === id)
    if (!found) continue
    if (found.blobUrl?.startsWith('blob:')) URL.revokeObjectURL(found.blobUrl)
    discardUploadFile(found.id)
    uploadsByProject.set(
      projectId,
      list.filter((u) => u.id !== id),
    )
    notify()
    return found
  }
  return undefined
}

export function clearProjectUploads(projectId: string): void {
  const list = uploadsByProject.get(projectId) ?? []
  list.forEach((u) => {
    if (u.blobUrl) URL.revokeObjectURL(u.blobUrl)
    discardUploadFile(u.id)
  })
  uploadsByProject.set(projectId, [])
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getServerSnapshot(): UploadedProjectDocument[] {
  return EMPTY_UPLOADS
}

export function useProjectDocumentUploads(projectId: string): {
  uploads: UploadedProjectDocument[]
  setUploads: Dispatch<SetStateAction<UploadedProjectDocument[]>>
  addUpload: (doc: UploadedProjectDocument, file?: File | null) => void
  removeUpload: (id: string) => void
} {
  const uploads = useSyncExternalStore(
    subscribe,
    () => snapshotForProject(projectId),
    getServerSnapshot,
  )

  const setUploads = useCallback(
    (action: SetStateAction<UploadedProjectDocument[]>) => {
      const prev = snapshotForProject(projectId)
      const next = typeof action === 'function' ? action(prev) : action
      prev
        .filter((u) => !next.some((n) => n.id === u.id))
        .forEach((u) => {
          if (u.blobUrl) URL.revokeObjectURL(u.blobUrl)
          discardUploadFile(u.id)
        })
      uploadsByProject.set(projectId, next)
      notify()
    },
    [projectId],
  )

  const addUpload = useCallback((doc: UploadedProjectDocument, file?: File | null) => {
    addProjectUpload(doc, file)
  }, [])

  const removeUpload = useCallback((id: string) => {
    removeProjectUpload(id)
  }, [])

  return { uploads, setUploads, addUpload, removeUpload }
}

export interface RegisterVendorQuotationInput {
  projectId: string
  file: File
  vendorName: string
  serviceName: string
  notes?: string
  uploadedBy: string
  uploadedByUserId: string
  /** When provided (API-persisted file), prefer this over a session blob URL. */
  viewUrl?: string
}

/** Register a vendor quotation file for the Documents tab (Vendor Quotations subsection). */
export function registerVendorQuotationUpload(input: RegisterVendorQuotationInput): UploadedProjectDocument {
  const id = crypto.randomUUID()
  const blobUrl = input.viewUrl?.trim() || createBlobUrlForFile(input.file, id)
  const doc: UploadedProjectDocument = {
    id,
    projectId: input.projectId,
    displayName: `${input.vendorName} — ${input.serviceName}`,
    category: 'vendor_quotation',
    fileName: input.file.name,
    sizeBytes: input.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    uploadedByUserId: input.uploadedByUserId,
    notes: input.notes?.trim() ?? '',
    blobUrl,
  }
  addProjectUpload(doc, input.viewUrl ? null : input.file)
  return doc
}

export interface RegisterClientQuotationInput {
  projectId: string
  file: File
  displayName: string
  notes?: string
  uploadedBy: string
  uploadedByUserId: string
}

/** Register a client quotation for the Documents tab (Client Quotations subsection). */
export function registerClientQuotationUpload(
  input: RegisterClientQuotationInput,
): UploadedProjectDocument {
  const id = crypto.randomUUID()
  const blobUrl = createBlobUrlForFile(input.file, id)
  const doc: UploadedProjectDocument = {
    id,
    projectId: input.projectId,
    displayName: input.displayName.trim(),
    category: 'client_quotation',
    fileName: input.file.name,
    sizeBytes: input.file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    uploadedByUserId: input.uploadedByUserId,
    notes: input.notes?.trim() ?? '',
    blobUrl,
  }
  addProjectUpload(doc, input.file)
  return doc
}
