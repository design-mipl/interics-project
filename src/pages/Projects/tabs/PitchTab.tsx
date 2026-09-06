import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button as MuiButton,
  Chip as MuiChip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton as MuiIconButton,
  InputAdornment,
  MenuItem,
  Select as MuiSelect,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Add, Delete, Edit as EditIcon, ExpandMore, Upload } from '@mui/icons-material'
import { useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { LISTING_SEARCH_DEBOUNCE_MS, SearchableSelect } from '@/components/listing'
import { PitchFinancialSidebar } from '@/components/projects/PitchFinancialSidebar'
import { AddExpenseDrawer } from '@/components/expenses/AddExpenseDrawer'
import {
  VendorOfferDrawer,
  type VendorAllocationRow,
  type VendorOfferDraft,
  type VendorOfferServiceOption,
} from '../components/VendorOfferDrawer'
import { PitchQuotationsSection } from '../components/PitchQuotationsSection'
import { UploadedDocumentLink } from '@/components/documents/UploadedDocumentLink'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { dropdownsApi } from '@/api/dropdownsApi'
import { fetchVendors } from '../../../slices/vendors/thunk'
import type {
  PitchCategory,
  PitchService,
  PitchVersion,
  VendorMapping,
  PlannedExpense,
} from '../../../slices/pitch/reducer'
import {
  addCategory,
  addService,
  createVersion,
  deleteCategory,
  deleteService,
  fetchVersionById,
  fetchVersions,
  updateService,
  updateVersion,
  updateVendorMapping,
  updatePlannedExpenses,
} from '../../../slices/pitch/thunk'
import { selectPitchFinancials } from '../../../store/selectors/pitchSelectors'
import { formatInr } from '../../../utils/formatters'
import type { Project } from '../../../slices/projects/reducer'
import { registerVendorQuotationUpload } from '../projectDocumentUploads'
import { pitchService } from '@/modules/projects/pitch.service'
import { parseSettingsApiError } from '@/modules/system-settings/shared/api-errors'
import { deleteExpense, fetchExpenses } from '@/slices/live/thunk'
import { ProjectTabSkeleton } from '../components/ProjectTabSkeleton'
const SECTION_NAMES = ['Design & Diligence', 'Build Services', 'Consultancy'] as const
const CLIENT_OFFER_DRAFT_SERVICE_ID = '__client-offer-draft-service__'
const FINANCIAL_SIDEBAR_WIDTH = 280
const TABLE_CELL_PAD = { py: 1, px: 1.5 } as const
const CLIENT_OFFER_ACTIONS_COL_PX = 84
const CLIENT_OFFER_ACTIONS_CELL_PAD = { py: 1, px: 0.75 } as const
const CLIENT_OFFER_TABLE_SX = {
  width: '100%',
  tableLayout: 'fixed',
  '& .MuiTableCell-root': { boxSizing: 'border-box' },
} as const
const VENDOR_COL_COUNT = 7
const VENDOR_ACTIONS_COL_PX = 84
const VENDOR_COL_WIDTHS = ['16%', '14%', '16%', '12%', '18%', '16%', `${VENDOR_ACTIONS_COL_PX}px`] as const
const VENDOR_TABLE_SX = {
  width: '100%',
  tableLayout: 'fixed',
  '& .MuiTableCell-root': {
    boxSizing: 'border-box',
    py: 1.25,
    px: 1.5,
    fontSize: 12,
    verticalAlign: 'middle',
  },
  '& .MuiTableHead-root .MuiTableCell-root': {
    fontSize: 10,
    fontWeight: 700,
    color: tokens.color.neutral[500],
    bgcolor: tokens.color.neutral[50],
  },
  '& .vendor-offer-actions-cell': {
    width: VENDOR_ACTIONS_COL_PX,
    maxWidth: VENDOR_ACTIONS_COL_PX,
    px: 0.75,
    textAlign: 'center',
  },
} as const

interface ServiceMasterRow {
  id: string
  name: string
  categoryId: string
}

interface VendorOfferRow {
  categoryName: string
  categoryId: string
  serviceId: string
  serviceName: string
  mapping: VendorMapping
}

const ZERO_PITCH_VERSION: PitchVersion = {
  id: '__none__',
  projectId: '',
  versionNumber: 0,
  label: '',
  isActive: false,
  createdAt: '',
  categories: [],
  plannedExpenses: [],
  totalRevenue: 0,
  totalCost: 0,
  profitability: 0,
}

function normalizeName(v: string): string {
  return v.trim().toLowerCase()
}

function draftClientOfferService(): PitchService {
  return {
    id: CLIENT_OFFER_DRAFT_SERVICE_ID,
    name: '',
    subcategoryId: null,
    subcategoryName: null,
    customName: null,
    value: 0,
    clientMilestones: [],
    vendorMappings: [],
    milestonesTotal: 0,
  }
}

function clientOfferDisplayServices(
  category: PitchCategory,
  isExpanded: boolean,
): PitchService[] {
  if (category.services.length > 0) return category.services
  return isExpanded ? [draftClientOfferService()] : []
}

function pct(value: number, total: number): number {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

export default function PitchTab({ project }: { project: Project }) {
  const dispatch = useAppDispatch()
  const { showToast } = useToast()
  const { versions, activeVersion, loading } = useAppSelector((s) => s.pitch)
  const vendorItems = useAppSelector((s) => s.vendors.items)
  const authUser = useAppSelector((s) => s.auth.user)

  const [vendorOfferDrawerOpen, setVendorOfferDrawerOpen] = useState(false)
  const [expenseDrawerOpen, setExpenseDrawerOpen] = useState(false)
  const [expenseEditing, setExpenseEditing] = useState<PlannedExpense | null>(null)
  const [expenseDeleteTarget, setExpenseDeleteTarget] = useState<PlannedExpense | null>(null)
  const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false)
  const [selectedMasterCategoryId, setSelectedMasterCategoryId] = useState('')
  const [expandedClientOffer, setExpandedClientOffer] = useState<Record<string, boolean>>({})
  const [masterCategories, setMasterCategories] = useState<{ id: string; name: string }[]>([])
  const [serviceMaster, setServiceMaster] = useState<ServiceMasterRow[]>([])
  const ensuringServiceRef = useRef<Set<string>>(new Set())
  const creatingVersionRef = useRef(false)
  const serviceSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const serviceSaveSeqRef = useRef<Map<string, number>>(new Map())
  const servicePendingPatchRef = useRef<Map<string, Partial<PitchService>>>(new Map())
  const serviceLatestPatchRef = useRef<Map<string, Partial<PitchService>>>(new Map())
  const draftSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const draftSaveSeqRef = useRef<Map<string, number>>(new Map())
  const draftPendingPatchRef = useRef<Map<string, Partial<PitchService>>>(new Map())
  const [serviceLocalPatches, setServiceLocalPatches] = useState<
    Record<string, Partial<PitchService>>
  >({})

  const loadCategoryAndServiceDropdowns = useCallback(async () => {
    try {
      const [categories, services] = await Promise.all([
        dropdownsApi.getCategories(),
        dropdownsApi.getServices(),
      ])
      setMasterCategories(categories.map((c) => ({ id: c.value, name: c.label })))
      setServiceMaster(
        services.map((s) => ({
          id: s.value,
          name: s.label,
          categoryId: s.categoryId,
        })),
      )
    } catch {
      setMasterCategories([])
      setServiceMaster([])
    }
  }, [])

  useEffect(() => {
    void dispatch(fetchVersions(project.id))
    void loadCategoryAndServiceDropdowns()
    void dispatch(fetchVendors({}))
  }, [dispatch, loadCategoryAndServiceDropdowns, project.id])

  useEffect(() => {
    if (loading || versions.length > 0 || creatingVersionRef.current) return
    creatingVersionRef.current = true
    void dispatch(createVersion({ projectId: project.id, data: { label: 'Version 1' } }))
      .unwrap()
      .catch(() => dispatch(fetchVersions(project.id)))
      .finally(() => {
        creatingVersionRef.current = false
      })
  }, [dispatch, loading, project.id, versions.length])

  // Keep DB `isActive` aligned with the version the UI prefers (has categories/vendors/expenses).
  useEffect(() => {
    if (!activeVersion || activeVersion.isActive) return
    void dispatch(
      updateVersion({
        projectId: project.id,
        versionId: activeVersion.id,
        data: { isActive: true },
      }),
    )
  }, [activeVersion?.id, activeVersion?.isActive, dispatch, project.id])

  const versionForSidebar = activeVersion ?? ZERO_PITCH_VERSION
  const finVersionId = versionForSidebar.id === '__none__' ? null : versionForSidebar.id
  const pitchFinMetrics = useAppSelector((s) => selectPitchFinancials(s, finVersionId))

  const vendorOptions = useMemo(
    () => vendorItems.filter((v) => v.status === 'Active').map((v) => ({ id: v.id, label: v.name })),
    [vendorItems],
  )

  const addedCategoryNames = useMemo(() => {
    const names = new Set<string>()
    for (const cat of activeVersion?.categories ?? []) {
      names.add(normalizeName(cat.categoryName))
    }
    return names
  }, [activeVersion])

  /** Active master categories not yet on this offer. */
  const addablePitchCategories = useMemo(
    () => masterCategories.filter((cat) => !addedCategoryNames.has(normalizeName(cat.name))),
    [masterCategories, addedCategoryNames],
  )

  /** Only categories present on the active pitch version (no empty placeholders). */
  const clientOfferSections = useMemo(() => {
    if (!activeVersion) return []
    const byName = new Map(
      activeVersion.categories.map((c) => [normalizeName(c.categoryName), c]),
    )
    const sections: { key: string; title: string; category: PitchCategory }[] = []
    const seen = new Set<string>()
    for (const name of SECTION_NAMES) {
      const cat = byName.get(normalizeName(name))
      if (cat) {
        sections.push({ key: cat.id, title: cat.categoryName, category: cat })
        seen.add(cat.id)
      }
    }
    for (const cat of activeVersion.categories) {
      if (!seen.has(cat.id)) {
        sections.push({ key: cat.id, title: cat.categoryName, category: cat })
      }
    }
    return sections
  }, [activeVersion])

  const vendorRows = useMemo(() => {
    if (!activeVersion) return [] as VendorOfferRow[]
    const rows: VendorOfferRow[] = []
    for (const category of activeVersion.categories) {
      for (const service of category.services) {
        for (const mapping of service.vendorMappings ?? []) {
          rows.push({
            categoryName: category.categoryName,
            categoryId: category.id,
            serviceId: service.id,
            serviceName: service.name,
            mapping,
          })
        }
      }
    }
    return rows
  }, [activeVersion])

  const vendorCategoryOptions = useMemo(
    () => (activeVersion?.categories ?? []).map((c) => ({ id: c.id, label: c.categoryName })),
    [activeVersion],
  )

  function findServiceCategory(serviceId: string): PitchCategory | null {
    if (!activeVersion) return null
    return activeVersion.categories.find((c) => c.services.some((s) => s.id === serviceId)) ?? null
  }

  async function ensureDefaultServiceRow(category: PitchCategory): Promise<void> {
    if (category.services.length > 0) return
    if (ensuringServiceRef.current.has(category.id)) return
    ensuringServiceRef.current.add(category.id)
    try {
      await addServiceRow(category)
    } finally {
      ensuringServiceRef.current.delete(category.id)
    }
  }

  async function addCategoryFromMaster(): Promise<void> {
    if (!activeVersion || !selectedMasterCategoryId) return
    const master = masterCategories.find((c) => c.id === selectedMasterCategoryId)
    if (!master) return
    if (addedCategoryNames.has(normalizeName(master.name))) {
      showToast({ title: 'Category already added', variant: 'warning' })
      return
    }
    try {
      const version = await dispatch(
        addCategory({
          projectId: project.id,
          versionId: activeVersion.id,
          category: {
            id: `pc-${Date.now()}`,
            categoryId: master.id,
            categoryName: master.name,
          },
        }),
      ).unwrap()
      const newCat =
        version.categories.find(
          (c) =>
            c.categoryId === master.id ||
            normalizeName(c.categoryName) === normalizeName(master.name),
        ) ?? null
      if (!newCat) {
        showToast({ title: 'Category added but could not load section', variant: 'warning' })
        return
      }
      setExpandedClientOffer((prev) => ({ ...prev, [newCat.id]: true }))
      if (newCat) await ensureDefaultServiceRow(newCat)
      showToast({ title: 'Category added', variant: 'success' })
      setAddCategoryDialogOpen(false)
      setSelectedMasterCategoryId('')
    } catch {
      showToast({ title: 'Failed to add category', variant: 'error' })
    }
  }

  function closeAddCategoryDialog(): void {
    setAddCategoryDialogOpen(false)
    setSelectedMasterCategoryId('')
  }

  async function removeCategory(category: PitchCategory, sectionKey: string): Promise<void> {
    if (!activeVersion) return
    try {
      await dispatch(
        deleteCategory({
          projectId: project.id,
          versionId: activeVersion.id,
          categoryId: category.id,
        }),
      ).unwrap()
      setExpandedClientOffer((prev) => {
        const next = { ...prev }
        delete next[sectionKey]
        return next
      })
      showToast({ title: 'Category removed', variant: 'success' })
    } catch {
      showToast({ title: 'Failed to remove category', variant: 'error' })
    }
  }

  async function removeServiceRow(
    sectionKey: string,
    category: PitchCategory,
    serviceId: string,
  ): Promise<void> {
    if (!activeVersion) return
    try {
      const version = await dispatch(
        deleteService({
          projectId: project.id,
          versionId: activeVersion.id,
          categoryId: category.id,
          serviceId,
        }),
      ).unwrap()
      const updatedCat = version.categories.find((c) => c.id === category.id)
      if (updatedCat && expandedClientOffer[sectionKey] && updatedCat.services.length === 0) {
        await ensureDefaultServiceRow(updatedCat)
      }
    } catch {
      showToast({ title: 'Failed to remove service', variant: 'error' })
    }
  }

  function handleClientOfferAccordionChange(
    sectionKey: string,
    category: PitchCategory,
    isExpanded: boolean,
  ): void {
    setExpandedClientOffer((prev) => ({ ...prev, [sectionKey]: isExpanded }))
    if (isExpanded) {
      void ensureDefaultServiceRow(category)
    }
  }

  async function refreshPitchVersion(versionId: string): Promise<void> {
    await dispatch(fetchVersionById({ projectId: project.id, versionId })).unwrap()
  }

  async function persistDraftServiceRow(
    category: PitchCategory,
    patch: Partial<PitchService>,
  ): Promise<void> {
    if (!activeVersion) return
    if (category.services.length > 0) return
    if (ensuringServiceRef.current.has(category.id)) return
    ensuringServiceRef.current.add(category.id)
    try {
      await dispatch(
        addService({
          projectId: project.id,
          versionId: activeVersion.id,
          categoryId: category.id,
          service: {
            name: patch.name ?? '',
            value: patch.value ?? 0,
            subcategoryId: patch.subcategoryId ?? null,
            subcategoryName: patch.subcategoryName ?? null,
            customName: null,
            clientMilestones: [],
            vendorMappings: [],
            milestonesTotal: 0,
          },
        }),
      ).unwrap()
      await refreshPitchVersion(activeVersion.id)
    } catch {
      showToast({ title: 'Failed to add service', variant: 'error' })
    } finally {
      ensuringServiceRef.current.delete(category.id)
    }
  }

  function scheduleDraftServiceSave(
    category: PitchCategory,
    patch: Partial<PitchService>,
  ): void {
    if (!activeVersion) return
    const key = category.id
    const merged = { ...(draftPendingPatchRef.current.get(key) ?? {}), ...patch }
    draftPendingPatchRef.current.set(key, merged)
    setServiceLocalPatches((prev) => ({
      ...prev,
      [CLIENT_OFFER_DRAFT_SERVICE_ID]: {
        ...(prev[CLIENT_OFFER_DRAFT_SERVICE_ID] ?? {}),
        ...patch,
      },
    }))

    const existingTimer = draftSaveTimersRef.current.get(key)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      draftSaveTimersRef.current.delete(key)
      const finalPatch = draftPendingPatchRef.current.get(key)
      draftPendingPatchRef.current.delete(key)
      if (!finalPatch || Object.keys(finalPatch).length === 0) return

      const seq = (draftSaveSeqRef.current.get(key) ?? 0) + 1
      draftSaveSeqRef.current.set(key, seq)

      void (async () => {
        try {
          await persistDraftServiceRow(category, finalPatch)
          if (draftSaveSeqRef.current.get(key) !== seq) return
          setServiceLocalPatches((prev) => {
            if (!(CLIENT_OFFER_DRAFT_SERVICE_ID in prev)) return prev
            const next = { ...prev }
            delete next[CLIENT_OFFER_DRAFT_SERVICE_ID]
            return next
          })
        } catch {
          if (draftSaveSeqRef.current.get(key) !== seq) return
        }
      })()
    }, LISTING_SEARCH_DEBOUNCE_MS)

    draftSaveTimersRef.current.set(key, timer)
  }

  async function addServiceRow(category: PitchCategory): Promise<void> {
    if (!activeVersion) return
    const draftService: Partial<PitchService> = {
      name: '',
      value: 0,
      subcategoryId: null,
      subcategoryName: null,
      customName: null,
      clientMilestones: [],
      vendorMappings: [],
      milestonesTotal: 0,
    }
    try {
      await dispatch(
        addService({
          projectId: project.id,
          versionId: activeVersion.id,
          categoryId: category.id,
          service: draftService,
        }),
      ).unwrap()
    } catch {
      // Fallback keeps UX working even if addService endpoint rejects.
      const nextCategories = activeVersion.categories.map((cat) =>
        cat.id === category.id
          ? {
              ...cat,
              services: [
                ...cat.services,
                {
                  id: `ps-local-${Date.now()}`,
                  name: '',
                  subcategoryId: null,
                  subcategoryName: null,
                  customName: null,
                  value: 0,
                  clientMilestones: [],
                  vendorMappings: [],
                  milestonesTotal: 0,
                },
              ],
            }
          : cat,
      )
      await dispatch(
        updateVersion({
          projectId: project.id,
          versionId: activeVersion.id,
          data: { categories: nextCategories },
        }),
      ).unwrap()
      showToast({ title: 'Service row added (fallback mode)', variant: 'info' })
    }
  }

  async function saveService(
    categoryId: string,
    serviceId: string,
    data: Partial<PitchService>,
  ): Promise<void> {
    if (!activeVersion) return
    await dispatch(
      updateService({
        projectId: project.id,
        versionId: activeVersion.id,
        categoryId,
        serviceId,
        data,
      }),
    ).unwrap()
  }

  function serviceSaveKey(categoryId: string, serviceId: string): string {
    return `${categoryId}::${serviceId}`
  }

  function scheduleServiceSave(
    categoryId: string,
    serviceId: string,
    data: Partial<PitchService>,
  ): void {
    if (!activeVersion) return
    const key = serviceSaveKey(categoryId, serviceId)
    const merged = { ...(servicePendingPatchRef.current.get(key) ?? {}), ...data }
    servicePendingPatchRef.current.set(key, merged)
    serviceLatestPatchRef.current.set(key, {
      ...(serviceLatestPatchRef.current.get(key) ?? {}),
      ...data,
    })
    setServiceLocalPatches((prev) => ({
      ...prev,
      [serviceId]: { ...(prev[serviceId] ?? {}), ...data },
    }))

    const existingTimer = serviceSaveTimersRef.current.get(key)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      serviceSaveTimersRef.current.delete(key)
      const patch = servicePendingPatchRef.current.get(key)
      servicePendingPatchRef.current.delete(key)
      if (!patch || Object.keys(patch).length === 0) return

      const seq = (serviceSaveSeqRef.current.get(key) ?? 0) + 1
      serviceSaveSeqRef.current.set(key, seq)

      void (async () => {
        try {
          await saveService(categoryId, serviceId, patch)
          if (serviceSaveSeqRef.current.get(key) !== seq) {
            // Stale response may have overwritten Redux — re-persist the latest patch.
            if (
              !serviceSaveTimersRef.current.has(key) &&
              !servicePendingPatchRef.current.has(key)
            ) {
              const latest = serviceLatestPatchRef.current.get(key)
              if (latest) scheduleServiceSave(categoryId, serviceId, latest)
            }
            return
          }
          setServiceLocalPatches((prev) => {
            if (!(serviceId in prev)) return prev
            const next = { ...prev }
            delete next[serviceId]
            return next
          })
        } catch {
          if (serviceSaveSeqRef.current.get(key) !== seq) return
          showToast({ title: 'Failed to save service', variant: 'error' })
        }
      })()
    }, LISTING_SEARCH_DEBOUNCE_MS)

    serviceSaveTimersRef.current.set(key, timer)
  }

  useEffect(() => {
    return () => {
      for (const timer of serviceSaveTimersRef.current.values()) clearTimeout(timer)
      serviceSaveTimersRef.current.clear()
      for (const timer of draftSaveTimersRef.current.values()) clearTimeout(timer)
      draftSaveTimersRef.current.clear()
    }
  }, [])

  async function saveMappingsForService(
    serviceId: string,
    mappings: VendorMapping[],
  ): Promise<void> {
    if (!activeVersion) return
    await dispatch(
      updateVendorMapping({
        projectId: project.id,
        versionId: activeVersion.id,
        serviceId,
        mappings,
      }),
    ).unwrap()
    await refreshPitchVersion(activeVersion.id)
  }

  function syncVendorQuotationToDocuments(
    file: File,
    vendorName: string,
    serviceName: string,
    notes?: string,
    viewUrl?: string,
  ): void {
    registerVendorQuotationUpload({
      projectId: project.id,
      file,
      vendorName,
      serviceName,
      notes,
      uploadedBy: authUser?.name ?? 'Unknown',
      uploadedByUserId: authUser?.id ?? 'unknown',
      ...(viewUrl ? { viewUrl } : {}),
    })
  }

  const getClientOfferServiceOptions = useCallback(
    (categoryId: string): VendorOfferServiceOption[] => {
      const category = activeVersion?.categories.find((c) => c.id === categoryId)
      if (!category) return []
      return category.services
        .filter((s) => s.id !== CLIENT_OFFER_DRAFT_SERVICE_ID)
        .filter((s) => s.subcategoryId || s.name)
        .map((s) => ({
          id: s.subcategoryId ?? s.id,
          pitchServiceId: s.id,
          label: s.subcategoryName ?? s.name ?? '—',
          value: s.value,
        }))
    },
    [activeVersion],
  )

  const getExistingVendorAllocationRows = useCallback(
    (categoryId: string, serviceKey: string): VendorAllocationRow[] => {
      const category = activeVersion?.categories.find((c) => c.id === categoryId)
      if (!category) return []
      const service =
        category.services.find((s) => (s.subcategoryId ?? s.id) === serviceKey) ??
        category.services.find((s) => s.id === serviceKey)
      if (!service) return []
      return (service.vendorMappings ?? []).map((m) => ({
        id: m.id,
        vendorId: m.vendorId,
        amount: String(m.value),
        file: null,
        existingFileName: m.quotation?.fileName,
        isMeasurable: m.isMeasurable ?? false,
      }))
    },
    [activeVersion],
  )

  const getNotesForService = useCallback(
    (categoryId: string, serviceKey: string): string => {
      const category = activeVersion?.categories.find((c) => c.id === categoryId)
      if (!category) return ''
      const service =
        category.services.find((s) => (s.subcategoryId ?? s.id) === serviceKey) ??
        category.services.find((s) => s.id === serviceKey)
      if (!service) return ''
      return (service.vendorMappings ?? []).find((m) => m.notes?.trim())?.notes?.trim() ?? ''
    },
    [activeVersion],
  )

  async function saveVendorOfferFromDrawer(draft: VendorOfferDraft): Promise<void> {
    if (!activeVersion || !draft.serviceId || !draft.categoryId || draft.rows.length === 0) return

    const category = activeVersion.categories.find((c) => c.id === draft.categoryId)
    const serviceOpt = getClientOfferServiceOptions(draft.categoryId).find((s) => s.id === draft.serviceId)
    if (!category || !serviceOpt) return

    const vendorIds = draft.rows.map((r) => r.vendorId).filter(Boolean)
    if (new Set(vendorIds).size !== vendorIds.length) {
      showToast({ title: 'Each vendor can only be allocated once per service', variant: 'error' })
      return
    }

    let service =
      category.services.find((s) => s.id === serviceOpt.pitchServiceId) ??
      category.services.find((s) => s.subcategoryId === draft.serviceId)

    if (!service) {
      const serviceName =
        serviceMaster.find((s) => s.id === draft.serviceId)?.name ?? serviceOpt.label
      try {
        const updated = await dispatch(
          addService({
            projectId: project.id,
            versionId: activeVersion.id,
            categoryId: category.id,
            service: {
              name: serviceName,
              value: serviceOpt.value,
              subcategoryId: draft.serviceId,
              subcategoryName: serviceName,
              customName: null,
              clientMilestones: [],
              vendorMappings: [],
              milestonesTotal: 0,
            },
          }),
        ).unwrap()
        const updatedCategory = updated.categories.find((c) => c.id === category.id)
        service =
          updatedCategory?.services.find((s) => s.id === serviceOpt.pitchServiceId) ??
          updatedCategory?.services.find((s) => s.subcategoryId === draft.serviceId)
        await refreshPitchVersion(activeVersion.id)
      } catch {
        showToast({ title: 'Failed to add service for vendor offer', variant: 'error' })
        return
      }
    }
    if (!service) return

    const existingById = new Map((service.vendorMappings ?? []).map((m) => [m.id, m]))
    const existingByVendor = new Map((service.vendorMappings ?? []).map((m) => [m.vendorId, m]))

    const notesValue = draft.notesTags.trim() || undefined

    const uploadedByRowId = new Map<
      string,
      { fileId: string; fileName: string; fileUrl: string; uploadedAt: string; file: File }
    >()

    for (const row of draft.rows) {
      if (!row.file || !row.vendorId) continue
      try {
        const uploaded = await pitchService.uploadPitchFile(project.id, {
          file: row.file,
          kind: 'vendor_offer',
          label: `${vendorOptions.find((v) => v.id === row.vendorId)?.label ?? 'Vendor'} — ${serviceOpt.label}`,
        })
        uploadedByRowId.set(row.id, {
          fileId: uploaded.fileId,
          fileName: uploaded.fileName,
          fileUrl: uploaded.viewUrl,
          uploadedAt: uploaded.uploadedAt,
          file: row.file,
        })
      } catch (err) {
        showToast({
          title: parseSettingsApiError(err, 'Failed to upload vendor offer file').message,
          variant: 'error',
        })
        return
      }
    }

    const next: VendorMapping[] = draft.rows.flatMap((row, index) => {
      const amount = Number(row.amount)
      if (!Number.isFinite(amount) || amount <= 0 || !row.vendorId) {
        return []
      }
      const vendor = vendorOptions.find((v) => v.id === row.vendorId)
      const prev = existingById.get(row.id) ?? existingByVendor.get(row.vendorId)
      const mappingId = row.id.startsWith('new-') ? `vm-${Date.now()}-${index}` : row.id
      const uploaded = uploadedByRowId.get(row.id)
      const quotation = uploaded
        ? {
            fileId: uploaded.fileId,
            fileName: uploaded.fileName,
            fileUrl: uploaded.fileUrl,
            uploadedAt: uploaded.uploadedAt,
          }
        : prev?.quotation
      const notes = draft.notesTags.trim()

      return [
        {
          id: mappingId,
          vendorId: row.vendorId,
          vendorName: vendor?.label ?? prev?.vendorName ?? '',
          value: amount,
          percentage: pct(amount, service.value),
          milestones: prev?.milestones ?? [],
          retention: prev?.retention,
          isMeasurable: row.isMeasurable,
          ...(quotation ? { quotation } : {}),
          ...(notes ? { notes } : {}),
        },
      ]
    })

    await saveMappingsForService(service.id, next)

    for (const row of draft.rows) {
      const uploaded = uploadedByRowId.get(row.id)
      if (!uploaded || !row.vendorId) continue
      const vendor = vendorOptions.find((v) => v.id === row.vendorId)
      syncVendorQuotationToDocuments(
        uploaded.file,
        vendor?.label ?? '',
        serviceOpt.label,
        notesValue,
        uploaded.fileUrl,
      )
    }
  }

  if (loading && versions.length === 0) {
    return <ProjectTabSkeleton rows={6} showKpis />
  }

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: `minmax(0, 1fr) ${FINANCIAL_SIDEBAR_WIDTH}px` },
          gap: { xs: 2, md: 3 },
          alignItems: 'start',
        }}
      >
        <Box sx={{ minWidth: 0, width: '100%' }}>
          <PitchQuotationsSection projectId={project.id} />

          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper', mb: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle1" sx={{ fontSize: 15, fontWeight: 600 }}>Client Offer</Typography>
            </Stack>

            {clientOfferSections.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, py: 1.5 }}>
                No categories on this offer yet. Add one below.
              </Typography>
            ) : null}
            {clientOfferSections.map((section) => {
              const { category } = section
              const isSectionExpanded = expandedClientOffer[section.key] ?? false
              const serviceCount = category.services.length
              const categoryTotal = category.services.reduce((sum, s) => sum + s.value, 0)
              return (
                <Accordion
                  key={section.key}
                  expanded={isSectionExpanded}
                  onChange={(_, expanded) =>
                    handleClientOfferAccordionChange(section.key, category, expanded)
                  }
                  sx={{
                    mb: 1,
                    mt: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: 'none',
                    borderRadius: '8px !important',
                    '&:before': { display: 'none' },
                    '&.Mui-expanded': { margin: '0 0 8px 0' },
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMore sx={{ fontSize: 18 }} />}
                    sx={{
                      minHeight: 40,
                      px: 1.5,
                      '&.Mui-expanded': { minHeight: 40 },
                      '& .MuiAccordionSummary-content': {
                        my: 0.75,
                        '&.Mui-expanded': { my: 0.75 },
                      },
                      '& .MuiAccordionSummary-expandIconWrapper': {
                        ml: 0.5,
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{section.title}</Typography>
                      <Stack direction="row" alignItems="center" gap={0.5} onClick={(e) => e.stopPropagation()}>
                        <MuiChip
                          size="small"
                          label={`₹${formatInr(categoryTotal)} | ${serviceCount} service${serviceCount === 1 ? '' : 's'}`}
                          sx={{ fontSize: 10, height: 20 }}
                        />
                        <MuiIconButton
                          size="small"
                          aria-label={`Delete ${section.title}`}
                          onClick={() => void removeCategory(category, section.key)}
                          sx={{ color: 'error.main', p: 0.5 }}
                        >
                          <Delete sx={{ fontSize: 18 }} />
                        </MuiIconButton>
                      </Stack>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0, overflow: 'hidden' }}>
                    <>
                        <Box sx={{ width: '100%', overflow: 'hidden' }}>
                          <Table size="small" sx={CLIENT_OFFER_TABLE_SX}>
                            <colgroup>
                              <col />
                              <col style={{ width: '36%' }} />
                              <col style={{ width: CLIENT_OFFER_ACTIONS_COL_PX }} />
                            </colgroup>
                            <TableHead>
                              <TableRow sx={{ bgcolor: tokens.color.neutral[50] }}>
                                {[
                                  { h: 'Service Name / Scope', align: 'center' as const },
                                  { h: 'Value', align: 'center' as const },
                                  { h: 'Actions', align: 'center' as const },
                                ].map(({ h, align }) => (
                                  <TableCell
                                    key={h}
                                    align={align}
                                    sx={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      letterSpacing: 0.5,
                                      color: tokens.color.neutral[500],
                                      ...(h === 'Actions' ? CLIENT_OFFER_ACTIONS_CELL_PAD : TABLE_CELL_PAD),
                                      ...(h === 'Actions' && {
                                        width: CLIENT_OFFER_ACTIONS_COL_PX,
                                        maxWidth: CLIENT_OFFER_ACTIONS_COL_PX,
                                        overflow: 'hidden',
                                      }),
                                    }}
                                  >
                                    {h}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {clientOfferDisplayServices(category, isSectionExpanded).map((service) => {
                                const isDraft = service.id === CLIENT_OFFER_DRAFT_SERVICE_ID
                                const serviceOptions = serviceMaster.filter((s) => s.categoryId === category.categoryId)
                                const localPatch = serviceLocalPatches[service.id]
                                const displayService = localPatch ? { ...service, ...localPatch } : service
                                return (
                                  <TableRow key={service.id}>
                                    <TableCell sx={{ fontSize: 12, ...TABLE_CELL_PAD }}>
                                      <FormControl size="small" fullWidth>
                                        <MuiSelect
                                          value={displayService.subcategoryId ?? ''}
                                          displayEmpty
                                          onChange={(e) => {
                                            const m = serviceOptions.find((opt) => opt.id === e.target.value)
                                            const patch = {
                                              subcategoryId: m?.id ?? null,
                                              subcategoryName: m?.name ?? null,
                                              name: m?.name ?? '',
                                            }
                                            if (isDraft) {
                                              scheduleDraftServiceSave(category, patch)
                                              return
                                            }
                                            scheduleServiceSave(category.id, service.id, patch)
                                          }}
                                          sx={{ fontSize: 12, height: 32 }}
                                        >
                                          <MenuItem value="" sx={{ fontSize: 12 }}>Select service</MenuItem>
                                          {serviceOptions.map((opt) => (
                                            <MenuItem key={opt.id} value={opt.id} sx={{ fontSize: 12 }}>
                                              {opt.name}
                                            </MenuItem>
                                          ))}
                                        </MuiSelect>
                                      </FormControl>
                                    </TableCell>
                                    <TableCell sx={{ fontSize: 12, ...TABLE_CELL_PAD }}>
                                      <TextField
                                        size="small"
                                        type="number"
                                        fullWidth
                                        value={displayService.value}
                                        onChange={(e) => {
                                          const value = Number(e.target.value) || 0
                                          if (isDraft) {
                                            scheduleDraftServiceSave(category, { value })
                                            return
                                          }
                                          scheduleServiceSave(category.id, service.id, { value })
                                        }}
                                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                                        sx={{ '& input': { fontSize: 12, textAlign: 'right' }, '& .MuiInputBase-root': { height: 32 } }}
                                      />
                                    </TableCell>
                                    <TableCell
                                      align="center"
                                      sx={{
                                        fontSize: 12,
                                        width: CLIENT_OFFER_ACTIONS_COL_PX,
                                        maxWidth: CLIENT_OFFER_ACTIONS_COL_PX,
                                        ...CLIENT_OFFER_ACTIONS_CELL_PAD,
                                        verticalAlign: 'middle',
                                      }}
                                    >
                                      {isDraft ? null : (
                                        <MuiIconButton
                                          size="small"
                                          onClick={() =>
                                            void removeServiceRow(section.key, category, service.id)
                                          }
                                          sx={{ color: (theme) => alpha(theme.palette.error.main, 0.54) }}
                                        >
                                          <Delete sx={{ fontSize: 16 }} />
                                        </MuiIconButton>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </Box>
                        <Stack direction="row" gap={1} sx={{ p: 1 }}>
                          <MuiButton size="small" variant="outlined" startIcon={<Add fontSize="small" />} sx={{ fontSize: 12 }} onClick={() => addServiceRow(category)}>Add Service</MuiButton>
                        </Stack>
                    </>
                  </AccordionDetails>
                </Accordion>
              )
            })}

            <Box sx={{ pt: 0.5 }}>
              <MuiButton
                size="small"
                variant="contained"
                color="primary"
                startIcon={<Add fontSize="small" />}
                sx={{ fontSize: 12 }}
                disabled={!activeVersion}
                onClick={() => {
                  void loadCategoryAndServiceDropdowns()
                  setAddCategoryDialogOpen(true)
                }}
              >
                Add Category
              </MuiButton>
            </Box>
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${tokens.color.neutral[100]}` }}>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                Total Client Offer: ₹{formatInr(activeVersion?.totalRevenue ?? pitchFinMetrics.clientPOValue)}
              </Typography>
            </Stack>
          </Box>

          <Box sx={{ mt: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ fontSize: 15 }}>
                Vendor Offers
              </Typography>
              <MuiButton
                variant="contained"
                color="primary"
                size="small"
                startIcon={<Add fontSize="small" />}
                onClick={() => setVendorOfferDrawerOpen(true)}
                sx={{ fontSize: 12, fontWeight: 600 }}
              >
                Vendor Offer
              </MuiButton>
            </Stack>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              <Table size="small" sx={VENDOR_TABLE_SX}>
                <colgroup>
                  {VENDOR_COL_WIDTHS.map((width, index) => (
                    <col key={index} style={{ width }} />
                  ))}
                </colgroup>
                <TableHead>
                  <TableRow>
                    {[
                      'Vendor Name',
                      'Category',
                      'Service',
                      'Offer Amount',
                      'Notes / Tags',
                      'Upload Offer',
                      'Actions',
                    ].map((h) => (
                      <TableCell
                        key={h}
                        align={h === 'Actions' ? 'center' : 'left'}
                        className={h === 'Actions' ? 'vendor-offer-actions-cell' : undefined}
                      >
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {vendorRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={VENDOR_COL_COUNT}
                        sx={{ py: 2, textAlign: 'center', color: 'text.secondary' }}
                      >
                        No vendor offers mapped yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {vendorRows.map((row) => {
                    const k = row.mapping.id
                    const service = findServiceCategory(row.serviceId)?.services.find(
                      (s) => s.id === row.serviceId,
                    )
                    const mappings = service?.vendorMappings ?? []
                    const quotation = row.mapping.quotation
                    return (
                      <TableRow key={k}>
                        <TableCell align="left">
                          <Typography variant="body2" sx={{ fontSize: 12 }}>
                            {row.mapping.vendorName || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="left">
                          <Typography variant="body2" sx={{ fontSize: 12 }}>
                            {row.categoryName}
                          </Typography>
                        </TableCell>
                        <TableCell align="left">
                          <Typography variant="body2" sx={{ fontSize: 12 }}>
                            {row.serviceName}
                          </Typography>
                        </TableCell>
                        <TableCell align="left">
                          <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600 }}>
                            ₹{formatInr(row.mapping.value)}
                          </Typography>
                        </TableCell>
                        <TableCell align="left">
                          <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {row.mapping.notes?.trim() || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="left">
                          {quotation?.fileName ? (
                            <UploadedDocumentLink
                              fileName={quotation.fileName}
                              documentUrl={quotation.fileUrl}
                              onOpenFailed={() =>
                                showToast({
                                  title: 'Unable to open document',
                                  description:
                                    'The file is no longer available in this session. Upload it again.',
                                  variant: 'error',
                                })
                              }
                            />
                          ) : (
                            <MuiButton
                              size="small"
                              variant="outlined"
                              component="label"
                              startIcon={<Upload sx={{ fontSize: 14 }} />}
                              sx={{ fontSize: 11, height: 30, minWidth: 92 }}
                            >
                              Upload Offer
                              <input
                                type="file"
                                hidden
                                accept=".pdf,.png,.jpg,.jpeg,.webp"
                                onChange={(e) => {
                                  const f = e.target.files?.[0]
                                  if (!f) return
                                  const input = e.target
                                  void (async () => {
                                    try {
                                      const uploaded = await pitchService.uploadPitchFile(project.id, {
                                        file: f,
                                        kind: 'vendor_offer',
                                        label: `${row.mapping.vendorName} — ${row.serviceName}`,
                                      })
                                      const next = mappings.map((m) =>
                                        m.id === row.mapping.id
                                          ? {
                                              ...m,
                                              quotation: {
                                                fileId: uploaded.fileId,
                                                fileName: uploaded.fileName,
                                                fileUrl: uploaded.viewUrl,
                                                uploadedAt: uploaded.uploadedAt,
                                              },
                                            }
                                          : m,
                                      )
                                      await saveMappingsForService(row.serviceId, next)
                                      syncVendorQuotationToDocuments(
                                        f,
                                        row.mapping.vendorName,
                                        row.serviceName,
                                        row.mapping.notes,
                                        uploaded.viewUrl,
                                      )
                                    } catch (err) {
                                      showToast({
                                        title: parseSettingsApiError(
                                          err,
                                          'Failed to upload vendor offer file',
                                        ).message,
                                        variant: 'error',
                                      })
                                    } finally {
                                      input.value = ''
                                    }
                                  })()
                                }}
                              />
                            </MuiButton>
                          )}
                        </TableCell>
                        <TableCell align="center" className="vendor-offer-actions-cell">
                          <Box
                            sx={{
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center',
                              minHeight: 32,
                            }}
                          >
                            <MuiIconButton
                              size="small"
                              aria-label="Delete vendor offer"
                              onClick={() => {
                                const next = mappings.filter((m) => m.id !== row.mapping.id)
                                saveMappingsForService(row.serviceId, next)
                              }}
                            >
                              <Delete sx={{ fontSize: 16 }} />
                            </MuiIconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${tokens.color.neutral[100]}` }}>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                Total Vendor Offer: ₹{formatInr(pitchFinMetrics.vendorCosts)}
              </Typography>
            </Stack>
          </Box>

          <Box sx={{ mt: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" gap={1}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ fontSize: 15 }}>
                  Expenses
                </Typography>
                <MuiButton
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={<Add fontSize="small" />}
                  disabled={!activeVersion}
                  onClick={() => {
                    setExpenseEditing(null)
                    setExpenseDrawerOpen(true)
                  }}
                  sx={{ fontSize: 12, fontWeight: 600 }}
                >
                  Add Expense
                </MuiButton>
              </Stack>
              <Box>
                <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: tokens.color.neutral[50] }}>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700, color: tokens.color.neutral[500], width: '14%', ...TABLE_CELL_PAD }}>Type</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700, color: tokens.color.neutral[500], width: '28%', ...TABLE_CELL_PAD }}>Name</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700, color: tokens.color.neutral[500], width: '18%', ...TABLE_CELL_PAD }}>Amount</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700, color: tokens.color.neutral[500], width: '32%', ...TABLE_CELL_PAD }}>Vendor(s)</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700, color: tokens.color.neutral[500], width: '8%', ...TABLE_CELL_PAD }} align="right">
                        Actions
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(activeVersion?.plannedExpenses ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ py: 2, color: 'text.disabled', fontSize: 12 }}>
                          No planned expenses yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (activeVersion?.plannedExpenses ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell sx={{ fontSize: 12, ...TABLE_CELL_PAD }}>
                            {row.type === 'additional'
                              ? 'Additional'
                              : row.type === 'vendor'
                                ? 'Vendor'
                                : row.type === 'office_expenses'
                                  ? 'Office Expenses'
                                  : row.type === 'reimbursable_expenses'
                                    ? 'Reimbursable Expenses'
                                    : 'Common'}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, ...TABLE_CELL_PAD }}>{row.name}</TableCell>
                          <TableCell sx={{ fontSize: 12, ...TABLE_CELL_PAD }}>₹{formatInr(row.amount)}</TableCell>
                          <TableCell sx={{ fontSize: 12, ...TABLE_CELL_PAD }}>
                            {(row.type === 'additional' || row.type === 'office_expenses') && '—'}
                            {(row.type === 'vendor' || row.type === 'reimbursable_expenses') &&
                              (vendorItems.find((v) => v.id === row.vendorId)?.name ?? row.vendorId ?? '—')}
                            {row.type === 'common' &&
                              row.vendorSplits?.length &&
                              row.vendorSplits
                                .map(
                                  (s) =>
                                    `${vendorItems.find((v) => v.id === s.vendorId)?.name ?? s.vendorId} (${s.percentage}%)`,
                                )
                                .join(', ')}
                            {row.type === 'common' && !row.vendorSplits?.length && '—'}
                          </TableCell>
                          <TableCell align="right">
                            <MuiIconButton
                              size="small"
                              aria-label="Edit expense"
                              onClick={() => {
                                setExpenseEditing(row)
                                setExpenseDrawerOpen(true)
                              }}
                            >
                              <EditIcon sx={{ fontSize: 16 }} />
                            </MuiIconButton>
                            <MuiIconButton
                              size="small"
                              aria-label="Delete expense"
                              onClick={() => setExpenseDeleteTarget(row)}
                              sx={{ color: 'error.main' }}
                            >
                              <Delete sx={{ fontSize: 16 }} />
                            </MuiIconButton>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Box>
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${tokens.color.neutral[100]}` }}>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>
                  Total Planned Expenses: ₹{formatInr(pitchFinMetrics.plannedExpensesTotal)}
                </Typography>
              </Stack>
            </Box>
        </Box>
        <Box
          sx={{
            width: { md: FINANCIAL_SIDEBAR_WIDTH },
            minWidth: { md: FINANCIAL_SIDEBAR_WIDTH },
            maxWidth: { md: FINANCIAL_SIDEBAR_WIDTH },
            flexShrink: 0,
          }}
        >
          <PitchFinancialSidebar version={versionForSidebar} metrics={pitchFinMetrics} />
        </Box>
      </Box>

      <Dialog open={addCategoryDialogOpen} onClose={closeAddCategoryDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>Add Category</DialogTitle>
        <DialogContent>
          <Stack gap={1.5} sx={{ mt: 1 }}>
            <SearchableSelect
              label="Category"
              fullWidth
              size="small"
              placeholder="Search category…"
              value={selectedMasterCategoryId}
              onChange={setSelectedMasterCategoryId}
              options={addablePitchCategories.map((cat) => ({
                value: cat.id,
                label: cat.name,
              }))}
              disabled={addablePitchCategories.length === 0}
            />
            {addablePitchCategories.length === 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {masterCategories.length === 0
                  ? 'No active categories in Settings. Add categories under Settings → Categories.'
                  : 'All available categories are already on this offer.'}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <MuiButton size="small" onClick={closeAddCategoryDialog}>
            Cancel
          </MuiButton>
          <MuiButton
            size="small"
            variant="contained"
            disabled={!selectedMasterCategoryId}
            onClick={() => void addCategoryFromMaster()}
          >
            Add
          </MuiButton>
        </DialogActions>
      </Dialog>

      <VendorOfferDrawer
        open={vendorOfferDrawerOpen}
        onClose={() => setVendorOfferDrawerOpen(false)}
        vendorOptions={vendorOptions}
        categoryOptions={vendorCategoryOptions}
        getServiceOptions={getClientOfferServiceOptions}
        existingRowsForService={getExistingVendorAllocationRows}
        getNotesForService={getNotesForService}
        onSave={saveVendorOfferFromDrawer}
      />

      <AddExpenseDrawer
        open={expenseDrawerOpen}
        onClose={() => {
          setExpenseDrawerOpen(false)
          setExpenseEditing(null)
        }}
        version={activeVersion}
        projectId={project.id}
        editingExpense={expenseEditing}
      />

      <Dialog open={Boolean(expenseDeleteTarget)} onClose={() => setExpenseDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600, pb: 1 }}>Delete expense</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ fontSize: 13, pt: 0.5 }}>
            Delete this expense?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <MuiButton size="small" onClick={() => setExpenseDeleteTarget(null)}>Cancel</MuiButton>
          <MuiButton
            size="small"
            variant="contained"
            color="error"
            onClick={async () => {
              if (!activeVersion || !expenseDeleteTarget) return
              const next = (activeVersion.plannedExpenses ?? []).filter((e) => e.id !== expenseDeleteTarget.id)
              await dispatch(
                updatePlannedExpenses({
                  projectId: project.id,
                  versionId: activeVersion.id,
                  expenses: next,
                }),
              ).unwrap()

              const syncedLive = (await dispatch(fetchExpenses({ projectId: project.id })).unwrap()).find(
                (e) => e.sourcePlannedExpenseId === expenseDeleteTarget.id,
              )
              if (syncedLive) {
                await dispatch(
                  deleteExpense({
                    projectId: project.id,
                    expenseId: syncedLive.id,
                  }),
                ).unwrap()
                await dispatch(fetchExpenses({ projectId: project.id })).unwrap()
              }
              setExpenseDeleteTarget(null)
            }}
          >
            Delete
          </MuiButton>
        </DialogActions>
      </Dialog>
    </>
  )
}
