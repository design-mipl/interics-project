import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Box,
  Stack,
  Typography,
  MenuItem,
  Select,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import type { PitchVersion, PlannedExpense, PitchService, VendorMapping } from '@/slices/pitch/reducer'
import type { Baseline, VendorPO } from '@/slices/baseline/reducer'
import type { ExpenseType, Expense } from '@/slices/live/types'
import type { CreateExpenseBody } from '@/api/liveApi'
import { uploadProjectDocumentFile } from '@/api/uploadFileApi'
import { Input, FileUpload, DatePicker, dateFromIso, isoFromDate, useToast } from '@/design-system/components'
import { FormField, FormSection } from '@/components/templates/DrawerForm'
import { tokens } from '@/design-system/tokens'
import { formatCurrency } from '@/utils/formatters'
import { flattenBaselineMilestones, flattenBaselineServices } from '@/pages/Finance/utils/projectBillable'
import { vendorValueTotalsByVendorId } from '@/utils/pitchPlannedExpenses'
import {
  buildVendorSelectOptions,
  vendorIdAfterBuildVendorChange,
  paidByVendorIdAfterBuildVendorChange,
  shouldResetLiveProjectDependentFields,
  sortActiveVendorOptions,
} from '@/components/forms/expenseFormStateUtils'
import {
  resolveCommonExpenseAllocations,
  expenseSharePercent,
  findServiceInBaseline,
  getBuildVendorsFromPOs,
  resolveLiveBuildVendors,
  servicesForVendorLinkedExpense,
  selectedBuildVendorPoWeight,
  type CommonExpenseAllocation,
} from '@/components/forms/expenseFormUtils'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchVendors } from '@/slices/vendors/thunk'

function findServiceInPitchVersion(
  version: PitchVersion | null | undefined,
  serviceId: string,
): PitchService | undefined {
  if (!version) return undefined
  for (const cat of version.categories) {
    const s = cat.services.find((svc) => svc.id === serviceId)
    if (s) return s
  }
  return undefined
}

function findVendorMappingForPlannedEdit(
  v: PitchVersion,
  ed: PlannedExpense,
): { serviceId: string; mappingId: string } | null {
  if (ed.type !== 'vendor' || !ed.vendorId) return null
  if (ed.serviceId) {
    const svc = findServiceInPitchVersion(v, ed.serviceId)
    const map = svc?.vendorMappings.find((m) => m.vendorId === ed.vendorId)
    if (svc && map) return { serviceId: svc.id, mappingId: map.id }
  }
  for (const cat of v.categories) {
    for (const s of cat.services) {
      const map = s.vendorMappings.find((m) => m.vendorId === ed.vendorId)
      if (map) return { serviceId: s.id, mappingId: map.id }
    }
  }
  return null
}

export type ExpenseFormData =
  | { mode: 'live_expense'; projectId: string; data: CreateExpenseBody }
  | { mode: 'planned_expense'; expense: PlannedExpense }

export interface ExpenseFormProps {
  context: 'pitch' | 'live' | 'global'
  projectId?: string
  pitchVersionId?: string
  pitchVersion?: PitchVersion | null
  baseline?: Baseline | null
  vendorPOs?: VendorPO[]
  projectOptions?: { id: string; label: string }[]
  selectedProjectId?: string
  onSelectedProjectIdChange?: (projectId: string) => void
  editingPlannedExpense?: PlannedExpense | null
  /** Live/global expense being edited (Finance or Project Live). */
  editingExpense?: Expense | null
  open?: boolean
  onSubmit: (data: ExpenseFormData) => void
  onCancel: () => void
  onValidityChange?: (valid: boolean) => void
  onSubmitLabelChange?: (label: string) => void
}

export type ExpenseFormHandle = {
  submit: () => void | Promise<void>
}

type PitchExpenseType = PlannedExpense['type']

const EXPENSE_TYPE_OPTIONS = {
  additional: 'Additional Expense',
  vendorLinked: 'Vendor Linked Expense',
  common: 'Common Expense (Split Across Build Vendors)',
  officeExpenses: 'Office Expenses',
} as const

const COMMON_EXPENSE_SPLIT_METHOD = 'proportional_po' as const

type BuildVendorOption = { vendorId: string; vendorName: string; poSum: number }

export const ExpenseForm = forwardRef<ExpenseFormHandle, ExpenseFormProps>(function ExpenseForm(
  {
    context,
    projectId,
    pitchVersion,
    baseline,
    vendorPOs = [],
    projectOptions = [],
    selectedProjectId,
    onSelectedProjectIdChange,
    editingPlannedExpense,
    editingExpense,
    open = true,
    onSubmit,
    onValidityChange,
    onSubmitLabelChange,
  },
  ref,
) {
  const isPitch = context === 'pitch'
  const isLiveOrGlobal = context === 'live' || context === 'global'
  const toast = useToast()
  const dispatch = useAppDispatch()
  const vendorItems = useAppSelector((s) => s.vendors.items ?? [])

  const effectiveProjectId =
    context === 'global' ? (selectedProjectId ?? '') : (projectId ?? '')

  const prevEffectiveProjectIdRef = useRef<string | undefined>(undefined)
  const initialCommonEditRef = useRef<{
    amount: number
    selectedVendorIds: string[]
    vendorAllocations: CommonExpenseAllocation[]
  } | null>(null)

  const [liveType, setLiveType] = useState<ExpenseType>('common')
  const [pitchType, setPitchType] = useState<PitchExpenseType>('common')

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [documentUrl, setDocumentUrl] = useState<string | undefined>(undefined)
  const [pendingDocumentFile, setPendingDocumentFile] = useState<File | null>(null)

  const isEditMode = Boolean(editingExpense)

  const [serviceId, setServiceId] = useState('')
  const [mappingId, setMappingId] = useState('')
  const [liveVendorId, setLiveVendorId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')

  const [paidByVendorId, setPaidByVendorId] = useState('')
  const [allocatedVendorIds, setAllocatedVendorIds] = useState<string[]>([])
  const [fieldErrors, setFieldErrors] = useState<{
    projectId?: string
    description?: string
    amount?: string
    date?: string
    serviceId?: string
    mappingId?: string
    commonVendors?: string
  }>({})

  const liveTypeOptions: { value: ExpenseType; label: string }[] = [
    { value: 'additional', label: EXPENSE_TYPE_OPTIONS.additional },
    { value: 'vendor_linked', label: EXPENSE_TYPE_OPTIONS.vendorLinked },
    { value: 'common', label: EXPENSE_TYPE_OPTIONS.common },
    { value: 'office_expenses', label: EXPENSE_TYPE_OPTIONS.officeExpenses },
  ]
  const pitchTypeOptions: { value: PitchExpenseType; label: string }[] = [
    { value: 'additional', label: EXPENSE_TYPE_OPTIONS.additional },
    { value: 'vendor', label: EXPENSE_TYPE_OPTIONS.vendorLinked },
    { value: 'common', label: EXPENSE_TYPE_OPTIONS.common },
    { value: 'office_expenses', label: EXPENSE_TYPE_OPTIONS.officeExpenses },
  ]

  const baselineServices = useMemo(() => flattenBaselineServices(baseline ?? null), [baseline])
  const projectVendorPOs = useMemo(() => {
    if (!effectiveProjectId) return [] as typeof vendorPOs
    const matched = vendorPOs.filter((p) => p.projectId === effectiveProjectId)
    // listVendorPos is fetched per project and replaces store state; if projectId is
    // missing on a row, still treat the current payload as belonging to this project.
    if (matched.length > 0) return matched
    if (vendorPOs.length > 0 && vendorPOs.every((p) => !p.projectId || p.projectId === effectiveProjectId)) {
      return vendorPOs
    }
    return matched
  }, [vendorPOs, effectiveProjectId])

  const vendorLinkedServiceOptions = useMemo(() => {
    if (liveType !== 'vendor_linked') return baselineServices
    const options = servicesForVendorLinkedExpense(
      baseline ?? null,
      liveVendorId,
      projectVendorPOs,
      !isPitch ? pitchVersion?.categories : undefined,
    )
    if (serviceId && !options.some((s) => s.baselineServiceId === serviceId)) {
      const current = baselineServices.find((s) => s.baselineServiceId === serviceId)
      if (current) return [current, ...options]
    }
    return options
  }, [
    baseline,
    baselineServices,
    isPitch,
    liveType,
    liveVendorId,
    pitchVersion?.categories,
    projectVendorPOs,
    serviceId,
  ])
  const milestonesForService = useMemo(() => {
    const all = flattenBaselineMilestones(baseline ?? null)
    if (!serviceId) return []
    return all.filter((m) => m.baselineServiceId === serviceId)
  }, [baseline, serviceId])

  const activeVendorOptions = useMemo(
    () => sortActiveVendorOptions(vendorItems),
    [vendorItems],
  )

  const pitchServicesFlat = useMemo(() => {
    if (!pitchVersion) return [] as { id: string; name: string }[]
    const out: { id: string; name: string }[] = []
    for (const cat of pitchVersion.categories) {
      for (const s of cat.services) {
        out.push({ id: s.id, name: s.name })
      }
    }
    return out
  }, [pitchVersion])

  const selectedPitchService = useMemo(() => {
    return findServiceInPitchVersion(pitchVersion ?? null, serviceId)
  }, [pitchVersion, serviceId])

  const vendorMappingOptionsPitch = useMemo((): (VendorMapping & { serviceName: string })[] => {
    if (!selectedPitchService) return []
    return selectedPitchService.vendorMappings.map((m) => ({
      ...m,
      serviceName: selectedPitchService.name,
    }))
  }, [selectedPitchService])

  const selectedMappingPitch = useMemo(() => {
    return vendorMappingOptionsPitch.find((m) => m.id === mappingId)
  }, [vendorMappingOptionsPitch, mappingId])

  const buildVendors = useMemo(
    () => resolveLiveBuildVendors(projectVendorPOs, baseline ?? null),
    [projectVendorPOs, baseline],
  )

  const pitchBuildVendors = useMemo(() => {
    if (projectVendorPOs.length > 0) {
      return getBuildVendorsFromPOs(projectVendorPOs)
    }
    if (!pitchVersion) return [] as BuildVendorOption[]
    return [...vendorValueTotalsByVendorId(pitchVersion).entries()]
      .filter(([, v]) => v.value > 0)
      .map(([vendorId, v]) => ({
        vendorId,
        vendorName: v.name,
        poSum: v.value,
      }))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
  }, [projectVendorPOs, pitchVersion])

  const isCommonExpense = isPitch ? pitchType === 'common' : liveType === 'common'
  const commonVendors = isPitch ? pitchBuildVendors : buildVendors

  const paidByVendorOptions = useMemo(
    () => buildVendorSelectOptions(commonVendors),
    [commonVendors],
  )

  /** Project build vendors — shared by Common Expense Paid By and Vendor Linked. */
  const projectBuildVendorOptions = useMemo(
    () => buildVendorSelectOptions(buildVendors),
    [buildVendors],
  )

  const selectedLiveVendor = useMemo(() => {
    if (liveType === 'vendor_linked') {
      const hit = projectBuildVendorOptions.find((v) => v.id === liveVendorId)
      return hit ? { id: hit.id, name: hit.name } : undefined
    }
    return activeVendorOptions.find((v) => v.id === liveVendorId)
  }, [liveType, projectBuildVendorOptions, activeVendorOptions, liveVendorId])

  const commonPreview = useMemo(() => {
    const vendors = isPitch ? pitchBuildVendors : buildVendors
    if (vendors.length === 0) return []

    const n = Number(amount)
    const calcAmount = Number.isFinite(n) && n > 0 ? n : 0
    const previewAmount = calcAmount > 0 ? calcAmount : 1

    const editingCommon =
      (isPitch && editingPlannedExpense?.type === 'common') ||
      (!isPitch && editingExpense?.type === 'common')

    const rows = resolveCommonExpenseAllocations({
      amount: previewAmount,
      buildVendors: vendors,
      projectVendorPOs: !isPitch && projectVendorPOs.length > 0 ? projectVendorPOs : undefined,
      selectedVendorIds: allocatedVendorIds,
      method: COMMON_EXPENSE_SPLIT_METHOD,
      preserveWhenUnchanged:
        editingCommon && calcAmount > 0 ? initialCommonEditRef.current : null,
    })

    return calcAmount > 0 ? rows : rows.map((r) => ({ ...r, allocationAmount: 0 }))
  }, [
    amount,
    isPitch,
    projectVendorPOs,
    pitchBuildVendors,
    buildVendors,
    allocatedVendorIds,
    editingExpense,
    editingPlannedExpense,
  ])

  const totalCommonWeight = useMemo(
    () => commonVendors.reduce((s, v) => s + v.poSum, 0),
    [commonVendors],
  )

  const selectedCommonWeight = useMemo(
    () => selectedBuildVendorPoWeight(commonVendors, allocatedVendorIds),
    [commonVendors, allocatedVendorIds],
  )

  const recoveredPreviewTotal = useMemo(
    () =>
      commonPreview
        .filter((row) => allocatedVendorIds.includes(row.vendorId))
        .reduce((s, r) => s + r.allocationAmount, 0),
    [commonPreview, allocatedVendorIds],
  )

  const amountNum = typeof amount === 'number' ? amount : Number(amount) || 0

  const resetLiveDependent = useCallback((next: ExpenseType) => {
    setServiceId('')
    setMappingId('')
    setLiveVendorId('')
    setMilestoneId('')
    setPaidByVendorId('')
    setAllocatedVendorIds([])
    setFieldErrors((prev) => ({
      ...prev,
      serviceId: undefined,
      mappingId: undefined,
      commonVendors: undefined,
    }))
    void next
  }, [])

  const resetPitchDependent = useCallback((next: PitchExpenseType) => {
    setServiceId('')
    setMappingId('')
    setMilestoneId('')
    setPaidByVendorId('')
    setAllocatedVendorIds([])
    setFieldErrors((prev) => ({
      ...prev,
      serviceId: undefined,
      mappingId: undefined,
      commonVendors: undefined,
    }))
    void next
  }, [])

  function toggleAllocatedVendor(vendorId: string) {
    setAllocatedVendorIds((prev) =>
      prev.includes(vendorId) ? prev.filter((id) => id !== vendorId) : [...prev, vendorId],
    )
  }

  function handlePaidByChange(vendorId: string) {
    setPaidByVendorId(vendorId)
  }

  useEffect(() => {
    if (!open || !isCommonExpense) return
    setPaidByVendorId((current) =>
      paidByVendorIdAfterBuildVendorChange(
        current,
        commonVendors.map((v) => v.vendorId),
      ),
    )
  }, [open, isCommonExpense, commonVendors])

  useEffect(() => {
    if (!open || !isLiveOrGlobal || liveType !== 'vendor_linked') return
    setLiveVendorId((current) =>
      vendorIdAfterBuildVendorChange(
        current,
        buildVendors.map((v) => v.vendorId),
      ),
    )
  }, [open, isLiveOrGlobal, liveType, buildVendors])

  useEffect(() => {
    if (!open || !isPitch) return
    const v = pitchVersion
    const ed = editingPlannedExpense
    if (!v) return
    if (ed) {
      setPitchType(ed.type)
      setDescription(ed.name)
      setAmount(String(ed.amount))
      if (ed.type === 'vendor' && ed.vendorId) {
        const vm = findVendorMappingForPlannedEdit(v, ed)
        if (vm) {
          setServiceId(vm.serviceId)
          setMappingId(vm.mappingId)
        } else {
          setServiceId(ed.serviceId ?? '')
          setMappingId('')
        }
      } else {
        setServiceId(ed.serviceId ?? '')
        setMappingId('')
      }
      if (ed.type === 'common') {
        setPaidByVendorId(ed.paidByVendorId ?? '')
        if (ed.vendorSplits?.length) {
          const selectedIds = ed.vendorSplits
            .filter((s) => s.includedInRecovery !== false)
            .map((s) => s.vendorId)
          setAllocatedVendorIds(selectedIds)
          initialCommonEditRef.current = {
            amount: ed.amount,
            selectedVendorIds: selectedIds,
            vendorAllocations: ed.vendorSplits.map((s) => ({
              vendorId: s.vendorId,
              vendorName:
                pitchBuildVendors.find((v) => v.vendorId === s.vendorId)?.vendorName ?? s.vendorId,
              allocationPercent: s.percentage,
              allocationAmount: s.amount,
              includedInRecovery: s.includedInRecovery !== false,
            })),
          }
        } else {
          // Explicit selection required — do not pre-check Paid By or other vendors.
          setAllocatedVendorIds([])
          initialCommonEditRef.current = null
        }
      } else {
        setPaidByVendorId('')
        setAllocatedVendorIds([])
        initialCommonEditRef.current = null
      }
    } else {
      setPitchType('common')
      setDescription('')
      setAmount('')
      setDate('')
      setDocumentUrl(undefined)
      setServiceId('')
      setMappingId('')
      setMilestoneId('')
      setPaidByVendorId('')
      setAllocatedVendorIds([])
      initialCommonEditRef.current = null
    }
    setFieldErrors({})
  }, [open, isPitch, pitchVersion, editingPlannedExpense, pitchBuildVendors])

  useEffect(() => {
    if (!open || !isLiveOrGlobal) return
    void dispatch(fetchVendors({ pageSize: 100, status: 'Active' }))
  }, [open, isLiveOrGlobal, dispatch])

  useEffect(() => {
    if (!open || isPitch) return
    if (editingExpense) {
      setLiveType(editingExpense.type)
      setDescription(editingExpense.description)
      setAmount(String(editingExpense.amount))
      setDate(editingExpense.date)
      setDocumentUrl(editingExpense.documentUrl)
      setPendingDocumentFile(null)
      setServiceId(editingExpense.serviceId ?? '')
      setMilestoneId(editingExpense.milestoneId ?? '')
      setMappingId('')
      setLiveVendorId(editingExpense.vendorId ?? '')
      setPaidByVendorId(editingExpense.paidByVendorId ?? '')
      const selectedIds =
        editingExpense.vendorAllocations
          ?.filter((a) => a.includedInRecovery !== false)
          .map((a) => a.vendorId) ?? []
      setAllocatedVendorIds(selectedIds)
      if (editingExpense.type === 'common') {
        initialCommonEditRef.current = {
          amount: editingExpense.amount,
          selectedVendorIds: selectedIds,
          vendorAllocations: (editingExpense.vendorAllocations ?? []).map((a) => ({
            vendorId: a.vendorId,
            vendorName: a.vendorName,
            allocationPercent: a.allocationPercent,
            allocationAmount: a.allocationAmount,
            includedInRecovery: a.includedInRecovery !== false,
          })),
        }
      } else {
        initialCommonEditRef.current = null
      }
    } else {
      setLiveType('common')
      setDescription('')
      setAmount('')
      setDate('')
      setDocumentUrl(undefined)
      setPendingDocumentFile(null)
      setServiceId('')
      setMappingId('')
      setLiveVendorId('')
      setMilestoneId('')
      setPaidByVendorId('')
      setAllocatedVendorIds([])
      initialCommonEditRef.current = null
    }
    setFieldErrors({})
    prevEffectiveProjectIdRef.current = effectiveProjectId
  }, [open, isPitch, editingExpense])

  useEffect(() => {
    if (!open || isPitch || editingExpense) return

    const prev = prevEffectiveProjectIdRef.current
    if (!shouldResetLiveProjectDependentFields(prev, effectiveProjectId)) {
      if (prev === undefined) {
        prevEffectiveProjectIdRef.current = effectiveProjectId
      }
      return
    }

    prevEffectiveProjectIdRef.current = effectiveProjectId

    setServiceId('')
    setMappingId('')
    setLiveVendorId('')
    setMilestoneId('')
    setPaidByVendorId('')
    setAllocatedVendorIds([])
    setFieldErrors((prevErrors) => ({
      ...prevErrors,
      serviceId: undefined,
      mappingId: undefined,
      commonVendors: undefined,
    }))
  }, [open, isPitch, editingExpense, effectiveProjectId])

  useEffect(() => {
    if (isPitch) {
      onSubmitLabelChange?.(pitchType === 'reimbursable_expenses' ? 'Add Reimbursement' : 'Save')
      return
    }
    if (!isLiveOrGlobal) return
    if (editingExpense) {
      onSubmitLabelChange?.('Update Expense')
      return
    }
    onSubmitLabelChange?.(liveType === 'reimbursable_expenses' ? 'Add Reimbursement' : 'Save')
  }, [isPitch, pitchType, isLiveOrGlobal, liveType, editingExpense, onSubmitLabelChange])

  function handleLiveTypeChange(next: ExpenseType) {
    setLiveType(next)
    resetLiveDependent(next)
  }

  function handlePitchTypeChange(next: PitchExpenseType) {
    setPitchType(next)
    resetPitchDependent(next)
  }

  const canSubmit = useMemo(() => {
    if (context === 'global' && !selectedProjectId) return false
    if (isLiveOrGlobal && !effectiveProjectId) return false
    if (isPitch && !pitchVersion) return false

    const descriptionOk = description.trim().length > 0

    if (isPitch) {
      const amtOk = amountNum > 0
      if (!descriptionOk || !amtOk) return false
      if (pitchType === 'additional' || pitchType === 'office_expenses') {
        return true
      }
      if (pitchType === 'vendor') return Boolean(serviceId && selectedMappingPitch)
      if (pitchType === 'reimbursable_expenses') return Boolean(serviceId && selectedMappingPitch)
      if (pitchType === 'common') {
        return pitchBuildVendors.length > 0 && totalCommonWeight > 0
      }
      return false
    }

    if (!descriptionOk) return false
    if (amountNum <= 0) return false
    if (!date.trim()) return false
    if (liveType === 'vendor_linked') {
      return Boolean(selectedLiveVendor && serviceId)
    }
    if (liveType === 'reimbursable_expenses') {
      return Boolean(serviceId && selectedLiveVendor)
    }
    if (liveType === 'common') {
      return buildVendors.length > 0 && totalCommonWeight > 0
    }
    return true
  }, [
    context,
    selectedProjectId,
    isLiveOrGlobal,
    effectiveProjectId,
    isPitch,
    pitchVersion,
    description,
    amountNum,
    date,
    pitchType,
    liveType,
    serviceId,
    selectedMappingPitch,
    selectedLiveVendor,
    totalCommonWeight,
    pitchBuildVendors.length,
    buildVendors.length,
  ])

  useEffect(() => {
    onValidityChange?.(canSubmit)
  }, [canSubmit, onValidityChange])

  const validateForm = useCallback((): boolean => {
    const next: typeof fieldErrors = {}

    if (context === 'global' && !selectedProjectId) {
      next.projectId = 'Project is required'
    }
    if (isLiveOrGlobal && !effectiveProjectId) {
      next.projectId = 'Project is required'
    }
    if (isPitch && !pitchVersion) {
      toast.error('No active pitch version available')
      return false
    }

    if (isPitch) {
      if (!description.trim()) next.description = 'Expense name is required'
      if (!amount.trim()) next.amount = 'Amount is required'
      else if (!(amountNum > 0)) next.amount = 'Enter a valid amount greater than 0'

      if (pitchType === 'vendor' || pitchType === 'reimbursable_expenses') {
        if (!serviceId) next.serviceId = 'Service is required'
        if (!selectedMappingPitch) next.mappingId = 'Vendor is required'
      }
      if (pitchType === 'common') {
        if (pitchBuildVendors.length === 0) {
          next.commonVendors = 'No mapped vendors on this version. Add vendor mappings first.'
        } else if (totalCommonWeight <= 0) {
          next.commonVendors = 'No vendor PO values for proportional split. Add vendor PO values first.'
        } else if (allocatedVendorIds.length > 0 && selectedCommonWeight <= 0) {
          next.commonVendors =
            'Selected vendors have no PO values for proportional split.'
        }
      }
    } else {
      if (!description.trim()) next.description = 'Description is required'
      if (!amount.trim()) next.amount = 'Amount is required'
      else if (!(amountNum > 0)) next.amount = 'Enter a valid amount greater than 0'
      if (!date.trim()) next.date = 'Date is required'

      if (liveType === 'vendor_linked') {
        if (!selectedLiveVendor) next.mappingId = 'Vendor is required'
        if (!serviceId) next.serviceId = 'Service is required'
      } else if (liveType === 'reimbursable_expenses') {
        if (!serviceId) next.serviceId = 'Service is required'
        if (!selectedLiveVendor) next.mappingId = 'Vendor is required'
      }
      if (liveType === 'common') {
        if (buildVendors.length === 0) {
          next.commonVendors = 'No mapped build vendors for this project. Add vendor POs first.'
        } else if (totalCommonWeight <= 0) {
          next.commonVendors = 'No vendor PO values for proportional split. Add vendor PO values first.'
        } else if (allocatedVendorIds.length > 0 && selectedCommonWeight <= 0) {
          next.commonVendors =
            'Selected vendors have no PO values for proportional split.'
        }
      }
    }

    setFieldErrors(next)
    const keys = Object.keys(next)
    if (keys.length > 0) {
      toast.error(next.commonVendors ?? 'Please fill in all required fields')
      return false
    }
    return true
  }, [
    context,
    selectedProjectId,
    isLiveOrGlobal,
    effectiveProjectId,
    isPitch,
    pitchVersion,
    description,
    amount,
    amountNum,
    date,
    pitchType,
    liveType,
    serviceId,
    selectedMappingPitch,
    selectedLiveVendor,
    pitchBuildVendors.length,
    buildVendors.length,
    totalCommonWeight,
    selectedCommonWeight,
    allocatedVendorIds.length,
    toast,
  ])

  const submit = useCallback(async () => {
    if (!validateForm()) return

    if (isPitch && pitchVersion) {
      const baseId = editingPlannedExpense?.id ?? `pe-${Date.now()}`
      let expense: PlannedExpense
      if (pitchType === 'additional' || pitchType === 'office_expenses') {
        expense = {
          id: baseId,
          type: pitchType,
          name: description.trim(),
          amount: amountNum,
          date: date || undefined,
          documentUrl,
        }
      } else if (pitchType === 'vendor' || pitchType === 'reimbursable_expenses') {
        const map = selectedMappingPitch
        const svc = selectedPitchService
        if (!map || !svc) return
        expense = {
          id: baseId,
          type: pitchType,
          name: description.trim(),
          amount: amountNum,
          vendorId: map.vendorId,
          serviceId: svc.id,
          serviceName: svc.name,
          milestoneId: milestoneId || undefined,
          milestoneName:
            milestonesForService.find((m) => m.milestoneId === milestoneId)?.milestoneName ?? undefined,
          date: date || undefined,
          documentUrl,
        }
      } else {
        const allocations = resolveCommonExpenseAllocations({
          amount: amountNum,
          buildVendors: pitchBuildVendors,
          projectVendorPOs: projectVendorPOs.length > 0 ? projectVendorPOs : undefined,
          selectedVendorIds: allocatedVendorIds,
          method: COMMON_EXPENSE_SPLIT_METHOD,
          preserveWhenUnchanged:
            editingPlannedExpense?.type === 'common' ? initialCommonEditRef.current : null,
        })
        if (allocations.length === 0) return
        const payer = paidByVendorId
          ? pitchBuildVendors.find((v) => v.vendorId === paidByVendorId)
          : undefined
        const vendorSplits = allocations.map((a) => ({
          vendorId: a.vendorId,
          percentage: a.allocationPercent,
          amount: a.allocationAmount,
          includedInRecovery: a.includedInRecovery,
        }))
        expense = {
          id: baseId,
          type: 'common',
          name: description.trim(),
          amount: amountNum,
          vendorSplits,
          splitMethod: COMMON_EXPENSE_SPLIT_METHOD,
          paidByVendorId: payer?.vendorId,
          paidByVendorName: payer?.vendorName,
        }
      }
      onSubmit({ mode: 'planned_expense', expense })
      return
    }

    const pid = effectiveProjectId
    if (!pid) return

    let finalDocumentUrl = documentUrl
    if (pendingDocumentFile) {
      try {
        const uploaded = await uploadProjectDocumentFile(pendingDocumentFile)
        finalDocumentUrl = uploaded.viewUrl
      } catch {
        toast.error('Failed to upload document')
        return
      }
    }

    if (liveType === 'vendor_linked') {
      if (!selectedLiveVendor) return
      const svc = findServiceInBaseline(baseline ?? null, serviceId)
      const data: CreateExpenseBody = {
        type: 'vendor_linked',
        description: description.trim(),
        amount: amountNum,
        date: date || '',
        documentUrl: finalDocumentUrl,
        vendorId: selectedLiveVendor.id,
        vendorName: selectedLiveVendor.name,
        serviceId: serviceId || undefined,
        serviceName:
          (svc?.subcategoryName ?? svc?.name ?? svc?.customName)?.trim() ||
          vendorLinkedServiceOptions.find((s) => s.baselineServiceId === serviceId)?.name ||
          undefined,
        status: 'pending',
      }
      onSubmit({ mode: 'live_expense', projectId: pid, data })
      return
    }

    if (liveType === 'reimbursable_expenses') {
      const svc = findServiceInBaseline(baseline ?? null, serviceId)
      const ms = milestonesForService.find((m) => m.milestoneId === milestoneId)
      if (!selectedLiveVendor) return
      const data: CreateExpenseBody = {
        type: liveType,
        description: description.trim(),
        amount: amountNum,
        date: date || '',
        documentUrl: finalDocumentUrl,
        serviceId,
        serviceName: svc?.name ?? '',
        vendorId: selectedLiveVendor.id,
        vendorName: selectedLiveVendor.name,
        milestoneId: ms ? ms.milestoneId : undefined,
        milestoneName: ms ? ms.milestoneName : undefined,
        status: 'pending',
      }
      onSubmit({ mode: 'live_expense', projectId: pid, data })
      return
    }

    if (liveType === 'common') {
      const allocations = resolveCommonExpenseAllocations({
        amount: amountNum,
        buildVendors,
        projectVendorPOs: projectVendorPOs.length > 0 ? projectVendorPOs : undefined,
        selectedVendorIds: allocatedVendorIds,
        method: COMMON_EXPENSE_SPLIT_METHOD,
        preserveWhenUnchanged:
          editingExpense?.type === 'common' ? initialCommonEditRef.current : null,
      })
      if (allocations.length === 0) return
      const payer = paidByVendorId
        ? commonVendors.find((v) => v.vendorId === paidByVendorId)
        : undefined
      const data: CreateExpenseBody = {
        type: 'common',
        description: description.trim(),
        amount: amountNum,
        date: date || '',
        documentUrl: finalDocumentUrl,
        splitMethod: COMMON_EXPENSE_SPLIT_METHOD,
        paidByVendorId: payer?.vendorId,
        paidByVendorName: payer?.vendorName,
        vendorAllocations: allocations,
        status: 'pending',
      }
      onSubmit({ mode: 'live_expense', projectId: pid, data })
      return
    }

    const data: CreateExpenseBody = {
      type: liveType === 'office_expenses' ? 'office_expenses' : 'additional',
      description: description.trim(),
      amount: amountNum,
      date: date || '',
      documentUrl: finalDocumentUrl,
      status: editingExpense?.status ?? 'pending',
    }
    onSubmit({ mode: 'live_expense', projectId: pid, data })
  }, [
    validateForm,
    isPitch,
    pitchVersion,
    pitchType,
    editingPlannedExpense,
    description,
    amountNum,
    selectedMappingPitch,
    selectedPitchService,
    pitchBuildVendors,
    liveType,
    effectiveProjectId,
    baseline,
    serviceId,
    date,
    documentUrl,
    pendingDocumentFile,
    selectedLiveVendor,
    milestonesForService,
    vendorLinkedServiceOptions,
    projectVendorPOs,
    paidByVendorId,
    allocatedVendorIds,
    buildVendors,
    commonVendors,
    activeVendorOptions,
    editingExpense,
    onSubmit,
    toast,
  ])

  useImperativeHandle(ref, () => ({ submit }), [submit])

  const showDateDoc =
    isLiveOrGlobal ||
    (isPitch && (pitchType === 'office_expenses' || pitchType === 'reimbursable_expenses'))
  const showLiveDateDoc = isLiveOrGlobal
  const isReimbursable = !isPitch && liveType === 'reimbursable_expenses'
  const isPitchReimbursable = isPitch && pitchType === 'reimbursable_expenses'

  return (
    <Stack gap={0}>
      <FormSection title="Expense Type" columns={1} divider={false}>
        <FormField label="Type" required>
          {isPitch ? (
            <Select
              size="small"
              value={pitchType}
              onChange={(e) => handlePitchTypeChange(e.target.value as PitchExpenseType)}
              fullWidth
              sx={{ fontSize: 12 }}
            >
              {pitchTypeOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 12 }}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          ) : (
            <Select
              size="small"
              value={liveType}
              onChange={(e) => handleLiveTypeChange(e.target.value as ExpenseType)}
              fullWidth
              sx={{ fontSize: 12 }}
            >
              {liveTypeOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 12 }}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          )}
        </FormField>
        {isCommonExpense && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, display: 'block', mt: -0.5 }}>
            PO Ratio reflects each vendor&apos;s share of total project PO value. Expense Share
            normalizes only among selected vendors.
          </Typography>
        )}
        {(isPitch ? pitchType === 'vendor' : liveType === 'vendor_linked') && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, display: 'block', mt: -0.5 }}>
            Link this expense directly to the selected vendor.
          </Typography>
        )}
        {(isPitch ? pitchType === 'additional' : liveType === 'additional') && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, display: 'block', mt: -0.5 }}>
            Project-level expense without vendor allocation.
          </Typography>
        )}
        {(isPitch ? pitchType === 'office_expenses' : liveType === 'office_expenses') && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, display: 'block', mt: -0.5 }}>
            Absorbed internally without vendor debit.
          </Typography>
        )}
      </FormSection>

      <FormSection title="Expense Details" columns={2}>
        {context === 'global' && (
          <FormField label="Project" required error={fieldErrors.projectId}>
            <Select
              size="small"
              displayEmpty
              value={selectedProjectId ?? ''}
              onChange={(e) => {
                onSelectedProjectIdChange?.(e.target.value)
                setFieldErrors((prev) => ({ ...prev, projectId: undefined }))
              }}
              fullWidth
              disabled={isEditMode}
              error={Boolean(fieldErrors.projectId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select project
              </MenuItem>
              {projectOptions.map((p) => (
                <MenuItem key={p.id} value={p.id} sx={{ fontSize: 12 }}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormField>
        )}
        <FormField
          label={isPitch ? 'Expense name' : 'Description'}
          required
          error={fieldErrors.description}
        >
          <Input
            value={description}
            onChange={(v) => {
              setDescription(v)
              setFieldErrors((prev) => ({ ...prev, description: undefined }))
            }}
            size="sm"
            error={Boolean(fieldErrors.description)}
          />
        </FormField>
        <FormField label="Amount" required error={fieldErrors.amount}>
          <Input
            type="number"
            value={amount}
            onChange={(v) => {
              setAmount(v)
              setFieldErrors((prev) => ({ ...prev, amount: undefined }))
            }}
            size="sm"
            error={Boolean(fieldErrors.amount)}
            startAdornment={<Typography sx={{ fontSize: 12 }}>₹</Typography>}
          />
        </FormField>
        {(showLiveDateDoc || showDateDoc) && (
          <FormField
            label={isReimbursable || isPitchReimbursable ? 'Date vendor made the payment' : 'Date'}
            required={isLiveOrGlobal}
            error={fieldErrors.date}
          >
            <DatePicker
              value={dateFromIso(date)}
              onChange={(d) => {
                setDate(isoFromDate(d))
                setFieldErrors((prev) => ({ ...prev, date: undefined }))
              }}
              fullWidth
              size="sm"
              error={Boolean(fieldErrors.date)}
            />
          </FormField>
        )}
      </FormSection>

      {isPitch && (pitchType === 'vendor' || pitchType === 'reimbursable_expenses') && pitchVersion && (
        <FormSection title="Scope" columns={1}>
          <FormField label="Service" required error={fieldErrors.serviceId}>
            <Select
              size="small"
              displayEmpty
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value)
                setMappingId('')
                setMilestoneId('')
                setFieldErrors((prev) => ({
                  ...prev,
                  serviceId: undefined,
                  mappingId: undefined,
                }))
              }}
              fullWidth
              error={Boolean(fieldErrors.serviceId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select service
              </MenuItem>
              {pitchServicesFlat.map((s) => (
                <MenuItem key={s.id} value={s.id} sx={{ fontSize: 12 }}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </FormField>
          <FormField label="Vendor" required error={fieldErrors.mappingId}>
            <Select
              size="small"
              displayEmpty
              value={mappingId}
              onChange={(e) => {
                setMappingId(e.target.value)
                setFieldErrors((prev) => ({ ...prev, mappingId: undefined }))
              }}
              fullWidth
              disabled={!serviceId || vendorMappingOptionsPitch.length === 0}
              error={Boolean(fieldErrors.mappingId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select vendor
              </MenuItem>
              {vendorMappingOptionsPitch.map((m) => (
                <MenuItem key={m.id} value={m.id} sx={{ fontSize: 12 }}>
                  {m.vendorName}
                </MenuItem>
              ))}
            </Select>
          </FormField>
          <FormField
            label={isPitchReimbursable ? 'Milestone Reference' : 'Milestone (reference only)'}
            hint={
              isPitchReimbursable
                ? 'For reference only — does not affect payment grouping'
                : 'This is for tracking only, not payment grouping'
            }
          >
            <Select
              size="small"
              displayEmpty
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              fullWidth
              disabled={!serviceId}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                None
              </MenuItem>
              {milestonesForService.map((m) => (
                <MenuItem key={m.milestoneId} value={m.milestoneId} sx={{ fontSize: 12 }}>
                  {m.milestoneName}
                </MenuItem>
              ))}
            </Select>
          </FormField>
        </FormSection>
      )}

      {!isPitch && liveType === 'vendor_linked' && (
        <FormSection title="Vendor" columns={1}>
          <FormField label="Vendor" required error={fieldErrors.mappingId}>
            <Select
              size="small"
              displayEmpty
              value={liveVendorId}
              onChange={(e) => {
                setLiveVendorId(e.target.value)
                setServiceId('')
                setFieldErrors((prev) => ({
                  ...prev,
                  mappingId: undefined,
                  serviceId: undefined,
                }))
              }}
              fullWidth
              disabled={projectBuildVendorOptions.length === 0}
              error={Boolean(fieldErrors.mappingId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select vendor
              </MenuItem>
              {projectBuildVendorOptions.map((v) => (
                <MenuItem key={v.id} value={v.id} sx={{ fontSize: 12 }}>
                  {v.name}
                </MenuItem>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Service"
            required
            error={fieldErrors.serviceId}
            hint={
              liveVendorId && vendorLinkedServiceOptions.length === 0
                ? 'No services linked to this vendor on the selected project'
                : !liveVendorId
                  ? 'Select a vendor to load their project services'
                  : undefined
            }
          >
            <Select
              size="small"
              displayEmpty
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value)
                setFieldErrors((prev) => ({ ...prev, serviceId: undefined }))
              }}
              fullWidth
              disabled={!liveVendorId || vendorLinkedServiceOptions.length === 0}
              error={Boolean(fieldErrors.serviceId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select service
              </MenuItem>
              {vendorLinkedServiceOptions.map((s) => (
                <MenuItem key={s.baselineServiceId} value={s.baselineServiceId} sx={{ fontSize: 12 }}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </FormField>
        </FormSection>
      )}

      {!isPitch && liveType === 'reimbursable_expenses' && (
        <FormSection title="Scope" columns={1}>
          <FormField label="Service" required error={fieldErrors.serviceId}>
            <Select
              size="small"
              displayEmpty
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value)
                setLiveVendorId('')
                setMilestoneId('')
                setFieldErrors((prev) => ({
                  ...prev,
                  serviceId: undefined,
                  mappingId: undefined,
                }))
              }}
              fullWidth
              error={Boolean(fieldErrors.serviceId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select service
              </MenuItem>
              {baselineServices.map((s) => (
                <MenuItem key={s.baselineServiceId} value={s.baselineServiceId} sx={{ fontSize: 12 }}>
                  {s.name}
                </MenuItem>
              ))}
            </Select>
          </FormField>
          <FormField label="Vendor" required error={fieldErrors.mappingId}>
            <Select
              size="small"
              displayEmpty
              value={liveVendorId}
              onChange={(e) => {
                setLiveVendorId(e.target.value)
                setFieldErrors((prev) => ({ ...prev, mappingId: undefined }))
              }}
              fullWidth
              disabled={activeVendorOptions.length === 0}
              error={Boolean(fieldErrors.mappingId)}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select vendor
              </MenuItem>
              {activeVendorOptions.map((v) => (
                <MenuItem key={v.id} value={v.id} sx={{ fontSize: 12 }}>
                  {v.name}
                </MenuItem>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Milestone Reference"
            hint="For reference only — does not affect payment grouping"
          >
            <Select
              size="small"
              displayEmpty
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
              fullWidth
              disabled={!serviceId}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                None
              </MenuItem>
              {milestonesForService.map((m) => (
                <MenuItem key={m.milestoneId} value={m.milestoneId} sx={{ fontSize: 12 }}>
                  {m.milestoneName}
                </MenuItem>
              ))}
            </Select>
          </FormField>
        </FormSection>
      )}

      {isCommonExpense && (isPitch ? pitchVersion : true) && (
        <FormSection title="Allocation Preview" columns={1}>
          <Box
            sx={{
              border: `1px solid ${tokens.color.neutral[100]}`,
              borderRadius: 2,
              p: 2,
              bgcolor: tokens.color.neutral[50],
            }}
          >
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography variant="overline" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>
                Build Vendors
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                ₹{formatCurrency(amountNum > 0 ? amountNum : 0)}
              </Typography>
            </Stack>

            <Typography variant="caption" sx={{ fontSize: 11, display: 'block', mb: 1, color: 'text.secondary' }}>
              Check vendors to recover from. PO Ratio stays fixed; Expense Share normalizes among
              selected vendors. Paid By is not auto-selected.
            </Typography>

            {fieldErrors.commonVendors ? (
              <Typography variant="body2" sx={{ fontSize: 12, color: 'error.main', mb: 1 }}>
                {fieldErrors.commonVendors}
              </Typography>
            ) : null}

            {commonVendors.length === 0 ? (
              <Typography variant="body2" sx={{ fontSize: 12, color: 'error.main' }}>
                {isPitch && projectVendorPOs.length === 0
                  ? 'No mapped vendors on this version. Add vendor mappings first.'
                  : 'No mapped build vendors for this project. Add vendor POs first.'}
              </Typography>
            ) : totalCommonWeight <= 0 ? (
              <Typography variant="body2" sx={{ fontSize: 12, color: 'error.main' }}>
                No vendor PO values for proportional split. Add vendor PO values first.
              </Typography>
            ) : commonPreview.length === 0 ? (
              <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                No build vendors available for allocation.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" sx={{ py: 1 }} />
                      <TableCell sx={{ fontSize: 11, fontWeight: 600, py: 1 }}>Vendor Name</TableCell>
                      <TableCell align="right" sx={{ fontSize: 11, fontWeight: 600, py: 1 }}>
                        PO Ratio (%)
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: 11, fontWeight: 600, py: 1 }}>
                        Expense Share
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {commonPreview.map((row) => {
                      const selected = allocatedVendorIds.includes(row.vendorId)
                      const isPayer = row.vendorId === paidByVendorId
                      return (
                        <TableRow
                          key={row.vendorId}
                          hover
                          sx={{ opacity: selected ? 1 : 0.65 }}
                        >
                          <TableCell padding="checkbox" sx={{ py: 0.5 }}>
                            <Checkbox
                              size="small"
                              checked={selected}
                              onChange={() => toggleAllocatedVendor(row.vendorId)}
                            />
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, py: 1 }}>
                            {row.vendorName}
                            {isPayer ? (
                              <Typography
                                component="span"
                                sx={{ fontSize: 10, color: 'text.secondary', ml: 1 }}
                              >
                                (Paid By)
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell align="right" sx={{ fontSize: 12, py: 1 }}>
                            {row.allocationPercent}%
                          </TableCell>
                          <TableCell align="right" sx={{ fontSize: 12, fontWeight: 600, py: 1 }}>
                            {selected ? (
                              <>
                                {expenseSharePercent(row.allocationAmount, amountNum)}%
                                <Typography
                                  component="span"
                                  sx={{ fontSize: 11, color: 'text.secondary', ml: 0.75 }}
                                >
                                  (₹{formatCurrency(row.allocationAmount)})
                                </Typography>
                              </>
                            ) : (
                              <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary' }}>
                                0% (₹{formatCurrency(0)})
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        sx={{
                          fontSize: 12,
                          fontWeight: 700,
                          borderTop: `2px solid ${tokens.color.neutral[200]}`,
                        }}
                      >
                        Recovered from selected
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontSize: 12,
                          fontWeight: 700,
                          borderTop: `2px solid ${tokens.color.neutral[200]}`,
                        }}
                      >
                        {commonPreview
                          .filter((r) => allocatedVendorIds.includes(r.vendorId))
                          .reduce(
                            (s, r) => s + expenseSharePercent(r.allocationAmount, amountNum),
                            0,
                          )}
                        %
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontSize: 12,
                          fontWeight: 700,
                          borderTop: `2px solid ${tokens.color.neutral[200]}`,
                        }}
                      >
                        ₹{formatCurrency(recoveredPreviewTotal)}
                      </TableCell>
                    </TableRow>
                    {allocatedVendorIds.length === 0 && amountNum > 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} sx={{ fontSize: 11, color: 'text.secondary', py: 1 }}>
                          No vendors selected for recovery
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 11, color: 'text.secondary', py: 1 }}>
                          ₹{formatCurrency(amountNum)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </FormSection>
      )}

      {isCommonExpense && (isPitch ? pitchVersion : true) && (
        <FormSection title="Paid By" columns={1}>
          <FormField label="Paid By">
            <Select
              size="small"
              displayEmpty
              value={paidByVendorId}
              onChange={(e) => handlePaidByChange(e.target.value)}
              fullWidth
              disabled={paidByVendorOptions.length === 0}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>
                Select vendor
              </MenuItem>
              {paidByVendorOptions.map((v) => (
                <MenuItem key={v.id} value={v.id} sx={{ fontSize: 12 }}>
                  {v.name}
                </MenuItem>
              ))}
            </Select>
          </FormField>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            Optional. If set, this vendor gets the full amount as an Expense Addition on their
            invoice.
          </Typography>
        </FormSection>
      )}

      {(showLiveDateDoc || showDateDoc) && (
        <FormSection title="Attach Document" columns={1}>
          {isLiveOrGlobal && documentUrl && !pendingDocumentFile ? (
            <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', display: 'block', mb: 1 }}>
              Current document:{' '}
              {documentUrl.startsWith('local://')
                ? documentUrl.slice('local://'.length)
                : documentUrl.split('/').pop() ?? documentUrl}
              {pendingDocumentFile ? '' : ' — upload a new file to replace'}
            </Typography>
          ) : null}
          <FileUpload
            accept="image/*,.pdf"
            label={isReimbursable || isPitchReimbursable ? 'Supporting receipt / proof' : 'Attach document (optional)'}
            onUpload={(files) => {
              if (isPitch) {
                const f = files[0]
                setDocumentUrl(f ? `local://${f.name}` : undefined)
                return
              }
              const f = files[0]
              setPendingDocumentFile(f ?? null)
            }}
          />
        </FormSection>
      )}
    </Stack>
  )
})
