/**
 * Project detail Documents tab — grouped by Project, Client, and Vendor document sets.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { FileUp, Trash2 } from 'lucide-react'
import { DrawerForm, FormField } from '../../../components/templates/DrawerForm'
import {
  Badge,
  Button,
  IconButton,
  Input,
  Select,
  useToast,
} from '@/design-system/components'
import { DocumentUploadFormBody } from '@/components/forms/DocumentUploadFormBody'
import { tokens } from '@/design-system/tokens'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import type { Project } from '../../../slices/projects/reducer'
import { fetchClientPO, fetchVendorPOs } from '../../../slices/baseline/thunk'
import { fetchVersions } from '../../../slices/pitch/thunk'
import { formatDate } from '../../../utils/formatters'
import {
  TABLE_CELL_SX,
  TABLE_HEADER_SX,
} from './live/vendorSettlement/utils'
import { liveApi, type ProjectDocumentListItem } from '@/api/liveApi'
import { openAuthenticatedDocument } from '@/utils/openAuthenticatedDocument'
import { parseSettingsApiError } from '@/modules/system-settings/shared/api-errors'
import { ProjectTabSkeleton } from '../components/ProjectTabSkeleton'
import {
  isLegacyInternalUploadCategory,
  openProjectUploadInNewTab,
  useProjectDocumentUploads,
  type UploadCategory,
  type UploadedProjectDocument,
} from '../projectDocumentUploads'
import {
  buildProjectDocumentSections,
  clientPOToDocumentRow,
  collectPitchVendorQuotationRows,
  countProjectDocumentRows,
  filterDocumentRowsBySearch,
  filterProjectDocumentSectionsBySearch,
  mergeApiRowsIntoProjectDocumentSections,
  mergeDocumentRows,
  mergeLegacyInternalUploadRows,
  resolveProjectForDocuments,
  vendorPOToDocumentRow,
  PROJECT_DOCTYPE_SECTION_TITLE,
  type ProjectDocumentColumnRow,
} from '../projectDocumentsDisplay'

// ─── Types ───────────────────────────────────────────────────────────────────

type DocumentFilter = 'all' | 'client' | 'vendor' | 'project' | string

type CategoryOption = { value: string; label: string }

/** Fixed column widths — must sum to 100% for consistent alignment across all document tables. */
const DOCUMENTS_COL_WIDTH = {
  name: '28%',
  type: '14%',
  uploadedBy: '16%',
  date: '14%',
  size: '12%',
  action: '16%',
} as const

const DOCUMENTS_HEADER_SX = {
  ...TABLE_HEADER_SX,
  px: 2,
  py: 1.5,
  verticalAlign: 'middle',
} as const

const DOCUMENTS_CELL_SX = {
  ...TABLE_CELL_SX,
  px: 2,
  py: 1.5,
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const

const BUILTIN_CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'client_documents', label: 'Client Documents' },
  { value: 'vendor_documents', label: 'Vendor Documents' },
  { value: 'project_documents', label: 'Project Documents' },
  { value: 'other', label: 'Others' },
]

const BUILTIN_TYPE_LABELS: Record<string, string> = {
  client_documents: 'Client Documents',
  vendor_documents: 'Vendor Documents',
  project_documents: 'Project Documents',
  client_quotation: 'Client Quotation',
  client_po: 'Client PO',
  vendor_quotation: 'Vendor Quotation',
  vendor_po: 'Vendor PO',
  vendor_invoice: 'Vendor Invoice',
  vendor_invoice_doc: 'Vendor Invoice',
  internal_requirements: 'Requirements',
  internal_attachments: 'Attachment',
  requirement: 'Requirements',
  final_layout: 'Final Layout',
  final_rcp: 'Final RCP',
  final_views: 'Final Views',
  final_photographs: 'Final Photographs',
  handover: 'Handover',
  other: 'Others',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function typeLabelForUpload(cat: UploadCategory, customCategories: CategoryOption[]): string {
  const custom = customCategories.find((c) => c.value === cat)
  if (custom) return custom.label
  return BUILTIN_TYPE_LABELS[cat] ?? cat
}

function matchesSearch(text: string, q: string): boolean {
  if (!q.trim()) return true
  return text.toLowerCase().includes(q.trim().toLowerCase())
}

// ─── Subsection tables ───────────────────────────────────────────────────────

type ColumnRow = ProjectDocumentColumnRow

function RowActions({
  row,
  onDelete,
}: {
  row: ColumnRow
  onDelete?: (id: string) => void
}) {
  const deleteEnabled = Boolean(row.canDelete && onDelete)

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="flex-end"
      gap={0.5}
      sx={{ width: '100%', minWidth: 0 }}
    >
      <Button variant="soft" color="primary" size="sm" onClick={row.onView}>
        View
      </Button>
      <IconButton
        size="sm"
        variant="outlined"
        color="default"
        icon={<Trash2 size={14} strokeWidth={1.75} />}
        tooltip="Delete document"
        disabled={!deleteEnabled}
        onClick={() => {
          if (deleteEnabled && onDelete) onDelete(row.id)
        }}
      />
    </Stack>
  )
}

const DOCUMENTS_TABLE_COLUMNS: { key: keyof typeof DOCUMENTS_COL_WIDTH; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'uploadedBy', label: 'Uploaded by' },
  { key: 'date', label: 'Date' },
  { key: 'size', label: 'Size' },
  { key: 'action', label: 'Action' },
]

function DocumentsTable({
  rows,
  onDelete,
}: {
  rows: ColumnRow[]
  onDelete?: (id: string) => void
}) {
  return (
    <Table
      size="small"
      sx={{
        tableLayout: 'fixed',
        width: '100%',
        '& .MuiTableCell-root': { boxSizing: 'border-box' },
      }}
    >
      <TableHead>
        <TableRow>
          {DOCUMENTS_TABLE_COLUMNS.map(({ key, label }) => (
            <TableCell
              key={key}
              sx={{
                ...DOCUMENTS_HEADER_SX,
                width: DOCUMENTS_COL_WIDTH[key],
                textAlign: key === 'action' ? 'right' : 'left',
              }}
            >
              {label}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} sx={{ ...DOCUMENTS_CELL_SX, color: 'text.secondary' }}>
              No documents in this category.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell
                sx={{
                  ...DOCUMENTS_CELL_SX,
                  width: DOCUMENTS_COL_WIDTH.name,
                  fontWeight: 500,
                }}
              >
                {row.onView ? (
                  <Typography
                    component="button"
                    type="button"
                    onClick={row.onView}
                    variant="body2"
                    sx={{
                      p: 0,
                      border: 0,
                      bgcolor: 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      fontWeight: 500,
                      color: 'primary.main',
                      textDecoration: 'none',
                      wordBreak: 'break-word',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {row.name}
                  </Typography>
                ) : (
                  <Typography variant="body2" component="span" sx={{ wordBreak: 'break-word' }}>
                    {row.name}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ ...DOCUMENTS_CELL_SX, width: DOCUMENTS_COL_WIDTH.type }}>
                <Badge label={row.typeLabel} color="neutral" size="sm" variant="outlined" />
              </TableCell>
              <TableCell sx={{ ...DOCUMENTS_CELL_SX, width: DOCUMENTS_COL_WIDTH.uploadedBy }}>
                {row.uploadedBy}
              </TableCell>
              <TableCell sx={{ ...DOCUMENTS_CELL_SX, width: DOCUMENTS_COL_WIDTH.date }}>
                {row.dateStr}
              </TableCell>
              <TableCell sx={{ ...DOCUMENTS_CELL_SX, width: DOCUMENTS_COL_WIDTH.size }}>
                {row.sizeStr ?? '—'}
              </TableCell>
              <TableCell
                sx={{
                  ...DOCUMENTS_CELL_SX,
                  width: DOCUMENTS_COL_WIDTH.action,
                  textAlign: 'right',
                }}
              >
                <RowActions row={row} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function SubsectionBlock({
  title,
  rows,
  onDelete,
}: {
  title: string
  rows: ColumnRow[]
  onDelete?: (id: string) => void
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography
        variant="overline"
        sx={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          color: 'text.secondary',
          display: 'block',
          mb: 1,
        }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          maxWidth: '100%',
        }}
      >
        <DocumentsTable rows={rows} onDelete={onDelete} />
      </Box>
    </Box>
  )
}

function DocumentGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, color: 'text.primary' }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

// ─── Main tab ────────────────────────────────────────────────────────────────

interface DocumentsTabProps {
  project: Project
}

export default function DocumentsTab({ project }: DocumentsTabProps) {
  const dispatch = useAppDispatch()
  const toast = useToast((s) => s.showToast)
  const authUser = useAppSelector((s) => s.auth.user)
  const listProjects = useAppSelector((s) => s.projects.items ?? [])
  const clientPOs = useAppSelector((s) => s.baseline.clientPOs)
  const vendorPOList = useAppSelector((s) => s.baseline.vendorPOs)
  const pitchActiveVersion = useAppSelector((s) => s.pitch.activeVersion)

  const projectForDocuments = useMemo(
    () => resolveProjectForDocuments(project, listProjects),
    [project, listProjects],
  )

  const { uploads, removeUpload } = useProjectDocumentUploads(project.id)
  const [apiDocuments, setApiDocuments] = useState<ProjectDocumentListItem[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [filter, setFilter] = useState<DocumentFilter>('all')
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [customCategories, setCustomCategories] = useState<CategoryOption[]>([])
  const [uploading, setUploading] = useState(false)

  const [docName, setDocName] = useState('')
  const [category, setCategory] = useState<UploadCategory | ''>('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [notes, setNotes] = useState('')
  const [formErrors, setFormErrors] = useState<{
    name?: string
    category?: string
  }>({})

  useEffect(() => {
    void dispatch(fetchClientPO(project.id))
    void dispatch(fetchVendorPOs(project.id))
    void dispatch(fetchVersions(project.id))
  }, [dispatch, project.id])

  useEffect(() => {
    let cancelled = false
    setDocsLoading(true)
    void (async () => {
      try {
        const doctypeParam =
          filter === 'all'
            ? undefined
            : filter === 'client' || filter === 'vendor' || filter === 'project'
              ? filter
              : (filter as string)
        const [rows, doctypes] = await Promise.all([
          liveApi.getProjectDocuments(project.id, {
            doctype: doctypeParam,
          }),
          liveApi.getDocumentDoctypes(project.id),
        ])
        if (cancelled) return
        setApiDocuments(rows)
        setCustomCategories(
          doctypes
            .filter((d) => {
              const label = d.label.trim().toLowerCase()
              const value = d.value.trim().toLowerCase()
              return label !== 'others' && label !== 'other' && value !== 'other' && value !== 'others'
            })
            .map((d) => ({ value: d.value, label: d.label })),
        )
      } catch {
        if (!cancelled) {
          setApiDocuments([])
        }
      } finally {
        if (!cancelled) setDocsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project.id, filter])

  const openDocumentUrl = useCallback(
    (url: string | null | undefined) => {
      if (!url?.trim()) {
        toast({
          title: 'Unable to open document',
          description: 'No document URL is available.',
          variant: 'error',
        })
        return
      }
      void openAuthenticatedDocument(url, () => {
        toast({
          title: 'Unable to open document',
          description: 'The document could not be opened. Try again or re-upload the file.',
          variant: 'error',
        })
      })
    },
    [toast],
  )

  const apiRowsByDoctype = useCallback(
    (doctype: string | string[]): ColumnRow[] => {
      const set = Array.isArray(doctype) ? doctype : [doctype]
      return apiDocuments
        .filter((doc) => set.includes(doc.doctype))
        .map(
          (doc): ColumnRow => ({
            id: `api-${doc.doctype}-${doc.id}`,
            name: doc.name,
            typeLabel: BUILTIN_TYPE_LABELS[doc.doctype] ?? doc.doctype.replaceAll('_', ' '),
            uploadedBy: doc.uploadedBy ?? '—',
            dateStr: formatDate(doc.uploadedAt),
            sizeStr: doc.sizeBytes != null ? formatBytes(doc.sizeBytes) : '—',
            isUpload: false,
            canDelete: doc.source === 'project',
            onView: () => {
              openDocumentUrl(doc.viewUrl)
            },
            onDownload: () => {
              openDocumentUrl(doc.downloadUrl)
            },
          }),
        )
    },
    [apiDocuments, openDocumentUrl],
  )

  const categoryOptions = useMemo(() => {
    const builtinValues = new Set(BUILTIN_CATEGORY_OPTIONS.map((o) => o.value.toLowerCase()))
    const extras = customCategories.filter(
      (c) => !builtinValues.has(c.value.toLowerCase()) && c.label.trim().toLowerCase() !== 'others',
    )
    return [...BUILTIN_CATEGORY_OPTIONS, ...extras]
  }, [customCategories])

  const uploadsFiltered = useMemo(() => {
    const q = search
    return uploads.filter((u) => {
      if (u.projectId !== project.id) return false
      const typeLabel = typeLabelForUpload(u.category, customCategories)
      const blob = [u.displayName, u.fileName, u.notes, typeLabel, u.uploadedBy].join(' ')
      return matchesSearch(blob, q)
    })
  }, [uploads, project.id, search, customCategories])

  const buildUploadColumnRow = (u: UploadedProjectDocument): ColumnRow => ({
    id: u.id,
    name: u.displayName,
    typeLabel: typeLabelForUpload(u.category, customCategories),
    uploadedBy: u.uploadedBy.trim().split(/\s+/)[0] || u.uploadedBy || '—',
    dateStr: formatDate(u.uploadedAt),
    sizeStr: formatBytes(u.sizeBytes),
    isUpload: true,
    blobUrl: u.blobUrl,
    fileName: u.fileName,
    canDelete: Boolean(authUser?.id && u.uploadedByUserId === authUser.id),
    onView: () => {
      const opened = openProjectUploadInNewTab(u)
      if (!opened) {
        toast({
          title: 'Unable to open document',
          description: 'The uploaded file is no longer available in this session.',
          variant: 'error',
        })
      }
    },
    onDownload: () => {
      const a = document.createElement('a')
      a.href = u.blobUrl
      a.download = u.fileName
      a.click()
    },
  })

  const pickUploads = (cat: UploadCategory | UploadCategory[]) => {
    const set = Array.isArray(cat) ? cat : [cat]
    return uploadsFiltered.filter((u) => set.includes(u.category))
  }

  const clientQuotations = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          pickUploads('client_quotation').map(buildUploadColumnRow),
          apiRowsByDoctype('client_quotation'),
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, search, apiRowsByDoctype, customCategories],
  )

  const clientDocumentUploads = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          pickUploads('client_documents').map(buildUploadColumnRow),
          apiRowsByDoctype('client_documents'),
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, search, apiRowsByDoctype, customCategories],
  )

  const baselineClientPORows = useMemo(() => {
    const fromBaseline = clientPOs
      .filter((po) => po.projectId === project.id)
      .map(clientPOToDocumentRow)
      .filter((row): row is ProjectDocumentColumnRow => row !== null)
    const fromApi = apiDocuments
      .filter((doc) => doc.doctype === 'client_po')
      .map(
        (doc): ProjectDocumentColumnRow => ({
          id: `api-client-po-${doc.id}`,
          name: doc.name,
          typeLabel: 'Client PO',
          uploadedBy: doc.uploadedBy ?? 'System',
          dateStr: formatDate(doc.uploadedAt),
          sizeStr: doc.sizeBytes != null ? formatBytes(doc.sizeBytes) : null,
          isUpload: false,
          canDelete: false,
          onView: () => {
            openDocumentUrl(doc.viewUrl)
          },
        }),
      )
    return filterDocumentRowsBySearch(
      mergeDocumentRows(fromApi, fromBaseline),
      search,
      matchesSearch,
    )
  }, [clientPOs, project.id, search, apiDocuments, openDocumentUrl])

  const clientPO = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          baselineClientPORows,
          pickUploads('client_po').map(buildUploadColumnRow),
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, baselineClientPORows, search, customCategories],
  )

  const baselineVendorPORows = useMemo(() => {
    const fromBaseline = vendorPOList
      .filter((po) => po.projectId === project.id)
      .map(vendorPOToDocumentRow)
      .filter((row): row is ProjectDocumentColumnRow => row !== null)
    const fromApi = apiDocuments
      .filter((doc) => doc.doctype === 'vendor_po')
      .map(
        (doc): ProjectDocumentColumnRow => ({
          id: `api-vendor-po-${doc.id}`,
          name: doc.name,
          typeLabel: 'Vendor PO',
          uploadedBy: doc.uploadedBy ?? 'System',
          dateStr: formatDate(doc.uploadedAt),
          sizeStr: doc.sizeBytes != null ? formatBytes(doc.sizeBytes) : null,
          isUpload: false,
          canDelete: false,
          onView: () => {
            openDocumentUrl(doc.viewUrl)
          },
        }),
      )
    return filterDocumentRowsBySearch(
      mergeDocumentRows(fromApi, fromBaseline),
      search,
      matchesSearch,
    )
  }, [vendorPOList, project.id, search, apiDocuments, openDocumentUrl])

  const pitchVendorQuotationRows = useMemo(() => {
    const rows = collectPitchVendorQuotationRows(pitchActiveVersion, project.id)
    return filterDocumentRowsBySearch(rows, search, matchesSearch)
  }, [pitchActiveVersion, project.id, search])

  const vendorQuotations = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          pickUploads('vendor_quotation').map(buildUploadColumnRow),
          pitchVendorQuotationRows,
          apiRowsByDoctype('vendor_quotation'),
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, pitchVendorQuotationRows, search, apiRowsByDoctype, customCategories],
  )

  const vendorPORows = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          pickUploads('vendor_po').map(buildUploadColumnRow),
          baselineVendorPORows,
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, baselineVendorPORows, search, customCategories],
  )

  const vendorDocumentUploads = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          pickUploads('vendor_documents').map(buildUploadColumnRow),
          apiRowsByDoctype(['vendor_documents', 'vendor_invoice']),
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, search, apiRowsByDoctype, customCategories],
  )

  const othersDocumentRows = useMemo(
    () =>
      filterDocumentRowsBySearch(
        mergeDocumentRows(
          pickUploads('other').map(buildUploadColumnRow),
          apiRowsByDoctype('other'),
        ),
        search,
        matchesSearch,
      ),
    [uploadsFiltered, search, apiRowsByDoctype, customCategories],
  )

  const legacyInternalUploadRows = useMemo(() => {
    return uploads
      .filter(
        (u) =>
          u.projectId === project.id &&
          (isLegacyInternalUploadCategory(u.category) || u.category === 'project_documents') &&
          matchesSearch(
            [
              u.displayName,
              u.fileName,
              u.notes,
              typeLabelForUpload(u.category, customCategories),
              u.uploadedBy,
            ].join(' '),
            search,
          ),
      )
      .map(buildUploadColumnRow)
  }, [uploads, project.id, search, customCategories])

  const projectDocumentSections = useMemo(() => {
    const withPersisted = buildProjectDocumentSections(projectForDocuments, {
      alwaysShowSections: true,
    })
    const withLegacy = mergeLegacyInternalUploadRows(
      withPersisted,
      legacyInternalUploadRows,
    )
    const withApi = mergeApiRowsIntoProjectDocumentSections(withLegacy, {
      Requirements: apiRowsByDoctype('requirement'),
      'Final Layout': apiRowsByDoctype('final_layout'),
      'Final RCP': apiRowsByDoctype('final_rcp'),
      'Final Views': apiRowsByDoctype('final_views'),
      'Final Photographs': apiRowsByDoctype('final_photographs'),
      'Final Handover Documents': apiRowsByDoctype(['handover', 'project_documents']),
    })
    return filterProjectDocumentSectionsBySearch(withApi, search, matchesSearch)
  }, [projectForDocuments, search, legacyInternalUploadRows, apiRowsByDoctype])

  /** Rows from Create Project → Project Documents (not manual drawer uploads). */
  const projectFinalDocumentCount = useMemo(() => {
    const local = countProjectDocumentRows(buildProjectDocumentSections(projectForDocuments))
    const fromApi = apiDocuments.filter(
      (d) => Boolean(PROJECT_DOCTYPE_SECTION_TITLE[d.doctype]),
    ).length
    return Math.max(local, fromApi)
  }, [projectForDocuments, apiDocuments])

  const handleDelete = (id: string) => {
    void (async () => {
      const apiMatch = apiDocuments.find(
        (doc) => doc.id === id || `api-${doc.doctype}-${doc.id}` === id,
      )

      // Persisted project uploads must always hit DELETE — never local-only short-circuit.
      if (apiMatch) {
        if (apiMatch.source !== 'project') {
          toast({
            title: 'Unable to delete document',
            description: 'This document cannot be deleted from here.',
            variant: 'error',
          })
          return
        }
        try {
          await liveApi.deleteProjectDocument(project.id, apiMatch.id)
          setApiDocuments((prev) => prev.filter((doc) => doc.id !== apiMatch.id))
          removeUpload(apiMatch.id)
          removeUpload(id)
          toast({ title: 'Document deleted', variant: 'success' })
          try {
            const rows = await liveApi.getProjectDocuments(project.id, {
              doctype:
                filter === 'all'
                  ? undefined
                  : filter === 'client' || filter === 'vendor' || filter === 'project'
                    ? filter
                    : (filter as string),
            })
            setApiDocuments(rows)
          } catch {
            // Optimistic removal already applied
          }
        } catch (err) {
          toast({
            title: 'Unable to delete document',
            description: parseSettingsApiError(err, 'The delete request failed. Try again.').message,
            variant: 'error',
          })
        }
        return
      }

      const isLocal = uploads.some((u) => u.id === id)
      if (isLocal) {
        removeUpload(id)
        toast({ title: 'Document deleted', variant: 'success' })
        return
      }

      toast({
        title: 'Unable to delete document',
        description: 'This document cannot be deleted from here.',
        variant: 'error',
      })
    })()
  }

  const openDrawer = () => {
    setFormErrors({})
    setDrawerOpen(true)
  }

  const closeDrawer = () => setDrawerOpen(false)

  const baselineDocumentCount = useMemo(() => {
    const clientCount = clientPOs.filter(
      (po) => po.projectId === project.id && (po.documentUrl || po.fileName),
    ).length
    const vendorCount = vendorPOList.filter(
      (po) => po.projectId === project.id && (po.documentUrl || po.fileName),
    ).length
    const pitchCount = collectPitchVendorQuotationRows(pitchActiveVersion, project.id).length
    const apiPoCount = apiDocuments.filter((d) =>
      d.doctype === 'client_po' || d.doctype === 'vendor_po',
    ).length
    return Math.max(clientCount + vendorCount + pitchCount, apiPoCount + pitchCount)
  }, [clientPOs, vendorPOList, pitchActiveVersion, project.id, apiDocuments])

  const totalCount = useMemo(() => {
    const uploadCount = uploads.filter((u) => u.projectId === project.id).length
    const localCount = uploadCount + projectFinalDocumentCount + baselineDocumentCount
    return Math.max(localCount, apiDocuments.length)
  }, [uploads, project.id, projectFinalDocumentCount, baselineDocumentCount, apiDocuments.length])

  const showProject = filter === 'all' || filter === 'project'
  const showClient = filter === 'all' || filter === 'client'
  const showVendor = filter === 'all' || filter === 'vendor'
  const isCustomFilter = customCategories.some((c) => c.value === filter)

  const projectRowCount = projectDocumentSections.reduce((sum, s) => sum + s.rows.length, 0)
  const clientRowCount = clientQuotations.length + clientPO.length + clientDocumentUploads.length
  const vendorRowCount = vendorQuotations.length + vendorPORows.length + vendorDocumentUploads.length
  const othersRowCount = othersDocumentRows.length
  const showOthers = filter === 'all' && !isCustomFilter

  const customCategorySections = useMemo(
    () =>
      customCategories.map((cat) => {
        const rows = filterDocumentRowsBySearch(
          mergeDocumentRows(
            pickUploads(cat.value as UploadCategory).map(buildUploadColumnRow),
            apiRowsByDoctype(cat.value),
          ),
          search,
          matchesSearch,
        )
        return { ...cat, rows }
      }),
    [customCategories, uploadsFiltered, search, apiRowsByDoctype],
  )

  const customRowCount = useMemo(() => {
    if (filter === 'all') {
      return customCategorySections.reduce((sum, s) => sum + s.rows.length, 0)
    }
    if (isCustomFilter) {
      return customCategorySections.find((s) => s.value === filter)?.rows.length ?? 0
    }
    return 0
  }, [customCategorySections, filter, isCustomFilter])

  const visibleRowCount = useMemo(() => {
    let n = 0
    if (!isCustomFilter) {
      if (showProject) n += projectRowCount
      if (showClient) n += clientRowCount
      if (showVendor) n += vendorRowCount
      if (showOthers) n += othersRowCount
    }
    n += customRowCount
    return n
  }, [
    showProject,
    showClient,
    showVendor,
    showOthers,
    isCustomFilter,
    projectRowCount,
    clientRowCount,
    vendorRowCount,
    othersRowCount,
    customRowCount,
  ])

  const showProjectSections =
    showProject && !isCustomFilter && (filter === 'project' || projectRowCount > 0)

  // On All, hide empty project category tables; keep only sections that have rows.
  const projectDocumentContent = (
    filter === 'all'
      ? projectDocumentSections.filter((section) => section.rows.length > 0)
      : projectDocumentSections
  ).map((section) => (
    <SubsectionBlock
      key={section.title}
      title={section.title}
      rows={section.rows}
      onDelete={handleDelete}
    />
  ))

  const clientDocumentContent = (
    <>
      {clientDocumentUploads.length > 0 ? (
        <SubsectionBlock title="Uploads" rows={clientDocumentUploads} onDelete={handleDelete} />
      ) : null}
      <SubsectionBlock title="Client Quotations" rows={clientQuotations} onDelete={handleDelete} />
      <SubsectionBlock title="Client POs" rows={clientPO} onDelete={handleDelete} />
    </>
  )

  const vendorDocumentContent = (
    <>
      {vendorDocumentUploads.length > 0 ? (
        <SubsectionBlock title="Uploads" rows={vendorDocumentUploads} onDelete={handleDelete} />
      ) : null}
      <SubsectionBlock title="Vendor Quotations" rows={vendorQuotations} onDelete={handleDelete} />
      <SubsectionBlock title="Vendor POs" rows={vendorPORows} onDelete={handleDelete} />
    </>
  )

  const showCustomCategory = (value: string) =>
    filter === 'all' || filter === value

  const globalEmpty = totalCount === 0
  const hasActiveSearch = search.trim().length > 0
  const noMatches = !globalEmpty && visibleRowCount === 0 && hasActiveSearch

  useEffect(() => {
    if (!drawerOpen) {
      setDocName('')
      setCategory('')
      setSelectedFiles([])
      setNotes('')
      setFormErrors({})
    }
  }, [drawerOpen])

  if (docsLoading) {
    return <ProjectTabSkeleton rows={5} />
  }

  const handleSubmit = async () => {
    const err: typeof formErrors = {}
    if (!docName.trim()) err.name = 'Document name is required'
    if (!category) err.category = 'Category is required'
    setFormErrors(err)
    if (Object.keys(err).length > 0) return

    const file = selectedFiles[0]
    if (!file) {
      setFormErrors((prev) => ({ ...prev, name: 'Please choose a file to upload' }))
      return
    }

    setUploading(true)
    try {
      const uploaded = await liveApi.uploadProjectDocument(project.id, {
        doctype: category as string,
        displayName: docName.trim(),
        notes: notes.trim() || undefined,
        file,
      })
      if (uploaded) {
        setApiDocuments((prev) => [uploaded, ...prev])
      }
      closeDrawer()
    } catch {
      setFormErrors((prev) => ({
        ...prev,
        name: 'Failed to upload document. Try again.',
      }))
    } finally {
      setUploading(false)
    }
  }

  const filterToolbar = (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      alignItems={{ xs: 'stretch', sm: 'center' }}
      justifyContent="space-between"
      gap={2}
      sx={{ mb: 2 }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems={{ md: 'center' }} flex={1}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, v: DocumentFilter | null) => v && setFilter(v)}
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: 12,
              textTransform: 'none',
              px: 1.5,
            },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="client">Client Documents</ToggleButton>
          <ToggleButton value="vendor">Vendor Documents</ToggleButton>
          <ToggleButton value="project">Project Documents</ToggleButton>
          {customCategories.map((cat) => (
            <ToggleButton key={cat.value} value={cat.value}>
              {cat.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ minWidth: { md: 220 }, flex: 1 }}>
          <Input
            placeholder="Search documents…"
            value={search}
            onChange={setSearch}
            size="sm"
          />
        </Box>
      </Stack>
      <Button
        variant="contained"
        color="primary"
        size="sm"
        startIcon={<FileUp size={16} strokeWidth={1.75} />}
        onClick={openDrawer}
      >
        Upload Document
      </Button>
    </Stack>
  )

  if (globalEmpty) {
    return (
      <Box>
        {filterToolbar}
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Box sx={{ color: tokens.color.primary[300], mb: 1, display: 'flex', justifyContent: 'center' }}>
            <FileUp size={48} strokeWidth={1.25} />
          </Box>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
            No documents yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 360, mx: 'auto' }}>
            Upload project documents to keep everything in one place.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="sm"
            startIcon={<FileUp size={16} strokeWidth={1.75} />}
            onClick={openDrawer}
          >
            Upload Document
          </Button>
        </Box>

        <DrawerForm
          open={drawerOpen}
          onClose={closeDrawer}
          title="Upload Document"
          width={480}
          submitLabel="Upload"
          cancelLabel="Cancel"
          submitLoading={uploading}
          onSubmit={handleSubmit}
        >
          <UploadFormBody
            docName={docName}
            setDocName={setDocName}
            category={category}
            setCategory={setCategory}
            categoryOptions={categoryOptions}
            setSelectedFiles={setSelectedFiles}
            notes={notes}
            setNotes={setNotes}
            formErrors={formErrors}
          />
        </DrawerForm>
      </Box>
    )
  }

  return (
    <Box>
      {filterToolbar}

      {noMatches && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No matching documents for this filter or search.
        </Typography>
      )}

      <Stack gap={1}>
        {showProjectSections && (
          <DocumentGroup title="Project Documents">{projectDocumentContent}</DocumentGroup>
        )}

        {showClient && !isCustomFilter && (
          <DocumentGroup title="Client Documents">{clientDocumentContent}</DocumentGroup>
        )}

        {showVendor && !isCustomFilter && (
          <DocumentGroup title="Vendor Documents">{vendorDocumentContent}</DocumentGroup>
        )}

        {showOthers && othersRowCount > 0 && (
          <DocumentGroup title="Others">
            <SubsectionBlock
              title="Uploads"
              rows={othersDocumentRows}
              onDelete={handleDelete}
            />
          </DocumentGroup>
        )}

        {customCategorySections.map((section) => {
          if (!showCustomCategory(section.value)) return null
          if (section.rows.length === 0 && filter === 'all') return null
          return (
            <DocumentGroup key={section.value} title={section.label}>
              <SubsectionBlock
                title="Uploads"
                rows={section.rows}
                onDelete={handleDelete}
              />
            </DocumentGroup>
          )
        })}
      </Stack>

      <DrawerForm
        open={drawerOpen}
        onClose={closeDrawer}
        title="Upload Document"
        width={480}
        submitLabel="Upload"
        cancelLabel="Cancel"
        submitLoading={uploading}
        onSubmit={handleSubmit}
      >
        <UploadFormBody
          docName={docName}
          setDocName={setDocName}
          category={category}
          setCategory={setCategory}
          categoryOptions={categoryOptions}
          setSelectedFiles={setSelectedFiles}
          notes={notes}
          setNotes={setNotes}
          formErrors={formErrors}
        />
      </DrawerForm>
    </Box>
  )
}

function UploadFormBody({
  docName,
  setDocName,
  category,
  setCategory,
  categoryOptions,
  setSelectedFiles,
  notes,
  setNotes,
  formErrors,
  uploadResetKey,
}: {
  docName: string
  setDocName: (v: string) => void
  category: UploadCategory | ''
  setCategory: (v: UploadCategory | '') => void
  categoryOptions: CategoryOption[]
  setSelectedFiles: (f: File[]) => void
  notes: string
  setNotes: (v: string) => void
  formErrors: { name?: string; category?: string }
  uploadResetKey?: number
}) {
  return (
    <DocumentUploadFormBody
      docName={docName}
      onDocNameChange={setDocName}
      onFilesChange={setSelectedFiles}
      notes={notes}
      onNotesChange={setNotes}
      nameError={formErrors.name}
      uploadResetKey={uploadResetKey}
      middleSlot={
        <FormField label="Category" required error={formErrors.category}>
          <Select
            placeholder="Select category"
            value={category || undefined}
            onChange={(v) => {
              setCategory(v as UploadCategory)
            }}
            options={categoryOptions.map((o) => ({ label: o.label, value: o.value }))}
            size="sm"
            fullWidth
          />
        </FormField>
      }
    />
  )
}
