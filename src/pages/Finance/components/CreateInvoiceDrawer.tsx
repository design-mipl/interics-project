import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stack, Box, Typography } from '@mui/material'
import dayjs from 'dayjs'
import { DrawerForm, FormSection, FormField } from '@/components/templates'
import {
  AutocompleteField,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Select,
  Textarea,
  useToast,
} from '@/design-system/components'
import { receivablesApi } from '@/api/receivablesApi'
import { dropdownsApi, type ProjectDropdownOption } from '@/api/dropdownsApi'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { createInvoice, updateInvoice, sendInvoice } from '@/slices/receivables/thunk'
import { fetchClientPO, fetchClientPoById, fetchBaseline } from '@/slices/baseline/thunk'
import { baselineService } from '@/modules/projects/baseline.service'
import { fetchServices, fetchSACCodes } from '@/slices/settings/thunk'
import type { Invoice } from '@/slices/receivables/reducer'
import type { Project } from '@/slices/projects/reducer'
import type { ClientPO } from '@/slices/baseline/reducer'
import { InvoiceLineItems, type DraftLineItem } from './InvoiceLineItems'
import {
  computeLineItemTaxBreakdown,
  rollupsFromLineItems,
} from '@/pages/Projects/tabs/live/clientInvoiceUtils'
import {
  countSelectedMilestonesWithZeroRemaining,
  flattenBaselineMilestones,
  flattenClientPoMilestones,
  milestoneBillStatus,
  remainingMilestoneValue,
  resolveServiceForLine,
  sacCodeForService,
  sumBilledPerMilestone,
} from '@/pages/Finance/utils/projectBillable'
import { buildAutoDraftLines } from '@/pages/Finance/utils/financeReceivableDraftLines'
import { tokens } from '@/design-system/tokens'
import { formatInr } from '@/utils/formatters'

function toIsoDate(d: Date | null): string {
  if (!d) return ''
  return dayjs(d).format('YYYY-MM-DD')
}

function parsePaymentTermDays(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  return n
}

function addDaysToDate(base: Date, days: number): Date {
  return dayjs(base).add(days, 'day').toDate()
}

function invoiceLinesToDraft(items: Invoice['lineItems']): DraftLineItem[] {
  return items.map((li) => {
    const breakdown = computeLineItemTaxBreakdown(li.amount, li.labourCessRate ?? 0, li.gstRate)
    return {
      id: li.id,
      serviceId: li.serviceId,
      serviceName: li.serviceName,
      sacCode: li.sacCode,
      amount: li.amount,
      labourCessRate: li.labourCessRate ?? 0,
      labourCessAmount: li.labourCessAmount ?? breakdown.labourCessAmount,
      taxableAmount: li.taxableAmount ?? breakdown.taxableAmount,
      gstRate: li.gstRate,
      gstAmount: li.gstAmount,
      milestoneId: li.milestoneId,
      baselineServiceId: li.baselineServiceId,
      lineSource: li.lineSource ?? (li.milestoneId ? 'milestone' : li.baselineServiceId ? 'service' : 'manual'),
      maxAmount: undefined,
    }
  })
}

function dropdownOptionToProject(option: ProjectDropdownOption): Project {
  return stubProject({
    id: option.value,
    name: option.projectName || option.label,
    customerId: option.customerId,
    customerName: option.customerName,
    projectCode: option.projectCode,
  })
}

function stubProject(opts: {
  id: string
  name: string
  customerId: string
  customerName: string
  projectCode?: string
}): Project {
  return {
    id: opts.id,
    name: opts.name,
    customerId: opts.customerId,
    customerName: opts.customerName,
    projectCode: opts.projectCode ?? '',
    projectTypes: [],
    status: 'Live',
    progress: '',
    location: '',
    carpetArea: null,
    headcount: null,
    projectManager: '',
    projectManagerId: '',
    startDate: null,
    expectedEndDate: null,
    projectValue: 0,
    totalClientPOValue: 0,
    totalVendorPOValue: 0,
    invoicedAmount: 0,
    paidVendorAmount: 0,
    createdAt: '',
  }
}

export type CreateInvoicePreset = {
  projectId: string
  projectName?: string
  clientId?: string
  clientName?: string
  clientPoId?: string
  milestoneId?: string
}

export interface CreateInvoiceDrawerProps {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  invoice?: Invoice | null
  onSaved: () => void
  preset?: CreateInvoicePreset | null
  /** When true, project is fixed (e.g. Project Live context). Finance usage omits this. */
  lockProject?: boolean
}

export function CreateInvoiceDrawer({
  open,
  onClose,
  mode,
  invoice,
  onSaved,
  preset,
  lockProject = false,
}: CreateInvoiceDrawerProps) {
  const dispatch = useAppDispatch()
  const { showToast } = useToast()
  const saving = useAppSelector((s) => s.receivables.saving)
  const { services, sacCodes } = useAppSelector((s) => s.settings)
  const clientPOs = useAppSelector((s) => s.baseline.clientPOs)
  const baseline = useAppSelector((s) => s.baseline.baseline)
  const baselineLoading = useAppSelector((s) => s.baseline.loading)

  const [liveProjects, setLiveProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [posLoading, setPosLoading] = useState(false)
  const [project, setProject] = useState<Project | null>(null)
  const [selectedPoId, setSelectedPoId] = useState('')
  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<string[]>([])
  const [projectInvoices, setProjectInvoices] = useState<Invoice[]>([])
  const [billablePos, setBillablePos] = useState<ClientPO[]>([])
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState<Date | null>(new Date())
  const [paymentTermDays, setPaymentTermDays] = useState('30')
  const [dueDate, setDueDate] = useState<Date | null>(null)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLineItem[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [lineError, setLineError] = useState('')
  const projectSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const projectFetchIdRef = useRef(0)
  const milestoneSelectionTouchedRef = useRef(false)
  const poSelectionTouchedRef = useRef(false)
  const presetMilestoneSeededRef = useRef(false)
  const presetSessionAppliedRef = useRef(false)

  function applyDueDateFromTerms(nextInvoiceDate: Date | null, nextDays: string) {
    if (!nextInvoiceDate) return
    const days = parsePaymentTermDays(nextDays)
    if (days == null) return
    setDueDate(addDaysToDate(nextInvoiceDate, days))
  }

  function handleInvoiceDateChange(next: Date | null) {
    setInvoiceDate(next)
    if (errors.invoiceDate) setErrors((prev) => ({ ...prev, invoiceDate: '' }))
    applyDueDateFromTerms(next, paymentTermDays)
  }

  function handlePaymentTermDaysChange(value: string) {
    setPaymentTermDays(value)
    applyDueDateFromTerms(invoiceDate, value)
  }

  function handleDueDateChange(next: Date | null) {
    setDueDate(next)
    if (errors.dueDate) setErrors((prev) => ({ ...prev, dueDate: '' }))
  }

  const presetProject = useMemo<Project | null>(() => {
    if (!preset?.projectId) return null
    return (
      liveProjects.find((p) => p.id === preset.projectId) ??
      stubProject({
        id: preset.projectId,
        name: preset.projectName ?? 'Project',
        customerId: preset.clientId ?? '',
        customerName: preset.clientName ?? '',
      })
    )
  }, [preset, liveProjects])

  const projectOptions = useMemo(() => {
    if (mode === 'edit' && invoice && !liveProjects.some((p) => p.id === invoice.projectId)) {
      return [
        stubProject({
          id: invoice.projectId,
          name: invoice.projectName,
          customerId: invoice.clientId,
          customerName: invoice.clientName,
        }),
        ...liveProjects,
      ]
    }
    if (mode === 'create' && presetProject && !liveProjects.some((p) => p.id === presetProject.id)) {
      return [presetProject, ...liveProjects]
    }
    return liveProjects
  }, [mode, invoice, liveProjects, presetProject])

  const projectPos = useMemo(() => {
    if (!project) return []
    // Prefer listClientPos results; edit falls back to redux clientPOs if still loading.
    if (billablePos.length > 0 || mode === 'create' || posLoading) {
      return billablePos.filter((p) => p.projectId === project.id)
    }
    return clientPOs.filter((p) => p.projectId === project.id)
  }, [billablePos, clientPOs, mode, posLoading, project])

  const selectedPo = useMemo(() => {
    if (!selectedPoId || !project) return null
    const fromBillable = projectPos.find((p) => p.id === selectedPoId) ?? null
    const fromRedux = clientPOs.find((p) => p.id === selectedPoId && p.projectId === project.id) ?? null
    if (fromRedux?.milestones?.length) return fromRedux
    return fromBillable ?? fromRedux
  }, [projectPos, selectedPoId, project, clientPOs])

  useEffect(() => {
    if (!open) return
    void (async () => {
      // Load SAC list first so Service Master rows can resolve sacCodeId; services carry sacCode string either way.
      await dispatch(fetchSACCodes({ force: true, all: true }))
      await dispatch(fetchServices({ force: true, all: true }))
    })()
  }, [open, dispatch])

  useEffect(() => {
    if (!open) {
      setLiveProjects([])
      setProjectSearch('')
      setProjectsLoading(false)
      return
    }
    const fetchId = ++projectFetchIdRef.current
    setProjectsLoading(true)
    void dropdownsApi
      .getLiveProjects({ search: projectSearch.trim() || undefined })
      .then((options) => {
        if (fetchId !== projectFetchIdRef.current) return
        setLiveProjects(options.map(dropdownOptionToProject))
      })
      .catch(() => {
        if (fetchId !== projectFetchIdRef.current) return
        setLiveProjects([])
      })
      .finally(() => {
        if (fetchId !== projectFetchIdRef.current) return
        setProjectsLoading(false)
      })
  }, [open, projectSearch])

  useEffect(() => {
    return () => {
      if (projectSearchTimeoutRef.current) clearTimeout(projectSearchTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open || !project) {
      setProjectInvoices([])
      setBillablePos([])
      setPosLoading(false)
      return
    }
    let cancelled = false
    setPosLoading(true)
    // Create mode: listClientPos(pendingInvoiceOnly) alone supplies billable POs.
    // Edit mode: fetch all client POs so the existing PO remains selectable.
    if (mode === 'edit') {
      dispatch(fetchClientPO(project.id))
    }
    dispatch(fetchBaseline(project.id))
    void baselineService
      .listClientPos(project.id, mode === 'create' ? { pendingInvoiceOnly: true } : undefined)
      .then((pos) => {
        if (!cancelled) setBillablePos(pos)
      })
      .catch(() => {
        if (!cancelled) setBillablePos([])
      })
      .finally(() => {
        if (!cancelled) setPosLoading(false)
      })
    // Project invoices are needed for remaining-milestone calculations (not PO list).
    void receivablesApi
      .getAll({ projectId: project.id, pageSize: 500 })
      .then((r) => {
        if (!cancelled) setProjectInvoices(r.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setProjectInvoices([])
      })
    return () => {
      cancelled = true
    }
  }, [open, project?.id, mode, dispatch])

  useEffect(() => {
    if (!open || !project?.id || !selectedPoId) return
    void dispatch(fetchClientPoById({ projectId: project.id, poId: selectedPoId }))
  }, [open, project?.id, selectedPoId, dispatch])

  useEffect(() => {
    if (!open || mode !== 'create') return
    milestoneSelectionTouchedRef.current = false
    poSelectionTouchedRef.current = false
    presetMilestoneSeededRef.current = false
    presetSessionAppliedRef.current = false
    setProject(null)
    setSelectedPoId('')
    setSelectedMilestoneIds([])
    setLines([])
    setInvoiceNo('')
    setInvoiceDate(new Date())
    setPaymentTermDays('30')
    setDueDate(addDaysToDate(new Date(), 30))
    setNotes('')
    setErrors({})
    setLineError('')
  }, [open, mode])

  useEffect(() => {
    if (!open || mode !== 'create' || !preset?.projectId) return
    if (presetSessionAppliedRef.current) return
    const p = presetProject
    if (!p) return
    presetSessionAppliedRef.current = true
    setProject(p)
    if (!poSelectionTouchedRef.current) {
      setSelectedPoId(preset.clientPoId ?? '')
    }
    if (
      preset.milestoneId &&
      !milestoneSelectionTouchedRef.current &&
      !presetMilestoneSeededRef.current
    ) {
      presetMilestoneSeededRef.current = true
      setSelectedMilestoneIds([preset.milestoneId])
    }
  }, [
    open,
    mode,
    preset?.projectId,
    preset?.clientPoId,
    preset?.milestoneId,
    presetProject,
  ])

  useEffect(() => {
    if (!open || mode !== 'edit' || !invoice) return
    const p =
      liveProjects.find((x) => x.id === invoice.projectId) ??
      stubProject({
        id: invoice.projectId,
        name: invoice.projectName,
        customerId: invoice.clientId,
        customerName: invoice.clientName,
      })
    setProject(p)
    setSelectedPoId(invoice.clientPoId ?? '')
    setInvoiceNo(invoice.invoiceNo ?? '')
    const nextInvoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date()
    const nextDueDate = invoice.dueDate ? new Date(invoice.dueDate) : null
    setInvoiceDate(nextInvoiceDate)
    setDueDate(nextDueDate)
    if (nextInvoiceDate && nextDueDate) {
      const diff = dayjs(nextDueDate).startOf('day').diff(dayjs(nextInvoiceDate).startOf('day'), 'day')
      setPaymentTermDays(String(Math.max(0, diff)))
    } else {
      setPaymentTermDays('30')
    }
    setNotes(invoice.notes ?? '')
    setLines(invoiceLinesToDraft(invoice.lineItems))
    const ms = invoice.lineItems.map((l) => l.milestoneId).filter(Boolean) as string[]
    setSelectedMilestoneIds([...new Set(ms)])
    setErrors({})
    setLineError('')
  }, [open, mode, invoice?.id, liveProjects])

  const milestoneKey = selectedMilestoneIds.slice().sort().join(',')

  useEffect(() => {
    if (!open || mode !== 'create' || !project) return
    setLines((prev) => {
      const manual = prev.filter((l) => l.lineSource === 'manual')
      const auto = buildAutoDraftLines(
        selectedMilestoneIds,
        selectedPo ? flattenClientPoMilestones(selectedPo) : flattenBaselineMilestones(baseline),
        projectInvoices,
        project.id,
        services,
        sacCodes,
        selectedPo,
        selectedPo?.tdsRate ?? null,
        baseline,
      )
      if (selectedMilestoneIds.length === 0) return manual
      return [...auto, ...manual]
    })
  }, [
    open,
    mode,
    project?.id,
    milestoneKey,
    selectedPo,
    baseline,
    projectInvoices,
    services,
    sacCodes,
  ])

  const onProjectChange = useCallback((p: Project | null) => {
    setProject(p)
    setSelectedPoId('')
    setSelectedMilestoneIds([])
    setLines([])
  }, [])

  const onPoChange = useCallback((value: string) => {
    poSelectionTouchedRef.current = true
    milestoneSelectionTouchedRef.current = false
    presetMilestoneSeededRef.current = false
    setSelectedPoId(value)
    setSelectedMilestoneIds([])
    setLines((prev) => prev.filter((l) => l.lineSource === 'manual'))
  }, [])

  const toggleMilestone = (id: string) => {
    if (mode === 'edit') return
    milestoneSelectionTouchedRef.current = true
    setSelectedMilestoneIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const poMilestones = useMemo(() => flattenClientPoMilestones(selectedPo), [selectedPo])
  const flatMilestones = useMemo(
    () => (selectedPo ? poMilestones : flattenBaselineMilestones(baseline)),
    [selectedPo, poMilestones, baseline],
  )
  const billedByMilestone = useMemo(
    () => (project ? sumBilledPerMilestone(projectInvoices, project.id) : new Map()),
    [project, projectInvoices],
  )
  const skippedZeroRemainingCount = useMemo(
    () =>
      countSelectedMilestonesWithZeroRemaining(selectedMilestoneIds, flatMilestones, billedByMilestone),
    [selectedMilestoneIds, flatMilestones, billedByMilestone],
  )

  function validate(): boolean {
    const e: Record<string, string> = {}
    let le = ''
    if (!invoiceNo.trim()) e.invoiceNo = 'Invoice number is required'
    if (!project) e.project = 'Project is required'
    if (!invoiceDate) e.invoiceDate = 'Invoice date is required'
    if (!dueDate) e.dueDate = 'Due date is required'
    else if (invoiceDate && dueDate < invoiceDate) e.dueDate = 'Due date must be on or after invoice date'
    if (lines.length < 1) le = 'At least one line item is required'
    else if (lines.some((l) => !l.serviceId || l.amount <= 0)) {
      le = 'Each line needs a service and amount greater than 0'
    }
    setLineError(le)
    setErrors(e)
    return Object.keys(e).length === 0 && !le
  }

  function buildPayload(sendNow: boolean): Record<string, unknown> {
    const payloadLines = lines.map((l, idx) => {
      const taxed = computeLineItemTaxBreakdown(l.amount, l.labourCessRate ?? 0, l.gstRate)
      const serviceLabel = l.serviceName.includes(' — ')
        ? l.serviceName.split(' — ').slice(-1)[0]?.trim()
        : l.serviceName
      const settingsSvc =
        resolveServiceForLine(l.serviceId, serviceLabel, services, baseline) ??
        resolveServiceForLine(l.baselineServiceId, serviceLabel, services, baseline)
      const storedSac = l.sacCode?.trim()
      const sacCode =
        storedSac && storedSac !== '—'
          ? storedSac
          : sacCodeForService(sacCodes, settingsSvc)
      return {
        id: l.id.startsWith('tmp-') ? `li-new-${idx}` : l.id,
        serviceId: settingsSvc?.id ?? l.serviceId,
        serviceName: l.serviceName,
        sacCode,
        amount: l.amount,
        labourCessRate: l.labourCessRate ?? 0,
        labourCessAmount: taxed.labourCessAmount,
        taxableAmount: taxed.taxableAmount,
        gstRate: l.gstRate,
        gstAmount: taxed.gstAmount,
        milestoneId: l.milestoneId,
        baselineServiceId: l.baselineServiceId,
        lineSource: l.lineSource,
      }
    })
    return {
      invoiceNo: invoiceNo.trim(),
      clientId: project!.customerId,
      clientName: project!.customerName,
      projectId: project!.id,
      projectName: project!.name,
      invoiceDate: toIsoDate(invoiceDate),
      dueDate: toIsoDate(dueDate),
      notes: notes.trim() || undefined,
      lineItems: payloadLines,
      sendNow,
      clientPoId: selectedPoId || undefined,
      milestoneId: selectedMilestoneIds[0] || payloadLines.find((l) => l.milestoneId)?.milestoneId,
      milestoneName:
        selectedMilestoneIds.length === 1
          ? flattenClientPoMilestones(selectedPo).find((m) => m.milestoneId === selectedMilestoneIds[0])
              ?.milestoneName
          : undefined,
    }
  }

  async function handleSaveDraft() {
    if (!validate()) return
    try {
      if (mode === 'edit' && invoice) {
        await dispatch(updateInvoice({ id: invoice.id, data: buildPayload(false) })).unwrap()
        showToast({ title: 'Invoice saved', variant: 'success' })
      } else {
        await dispatch(createInvoice(buildPayload(false))).unwrap()
        showToast({ title: 'Draft saved', variant: 'success' })
      }
      onSaved()
      onClose()
    } catch (err) {
      showToast({ title: String(err), variant: 'error' })
    }
  }

  async function handleSaveSend() {
    if (!validate()) return
    try {
      let invId = invoice?.id;
      if (mode === 'edit' && invoice) {
        const result = await dispatch(updateInvoice({ id: invoice.id, data: buildPayload(false) })).unwrap()
        invId = result.id || invoice.id;
      } else {
        const result = await dispatch(createInvoice(buildPayload(false))).unwrap()
        invId = result.id;
      }
      
      if (invId) {
        await dispatch(sendInvoice(invId)).unwrap()
        showToast({ title: mode === 'edit' ? 'Invoice updated and sent' : 'Invoice created and sent', variant: 'success' })
      }
      onSaved()
      onClose()
    } catch (err) {
      showToast({ title: String(err), variant: 'error' })
    }
  }

  const minDue = invoiceDate ?? undefined
  const roll = useMemo(
    () =>
      rollupsFromLineItems(
        lines.map((l) => ({
          id: l.id,
          serviceId: l.serviceId,
          serviceName: l.serviceName,
          sacCode: l.sacCode,
          amount: l.amount,
          labourCessRate: l.labourCessRate,
          labourCessAmount: l.labourCessAmount,
          taxableAmount: l.taxableAmount,
          gstRate: l.gstRate,
          gstAmount: l.gstAmount,
        })),
      ),
    [lines],
  )

  function formatLabourCessPercent(rate: number | null): string {
    if (rate === null) return '—'
    const rounded = Math.round(rate * 100) / 100
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}%`
  }

  const footer = (
    <Stack direction="row" justifyContent="flex-end" gap={1} sx={{ px: 5, py: 3.5 }}>
      <Button variant="outlined" size="sm" onClick={handleSaveDraft} loading={saving} label="Draft invoice" />
      <Button variant="contained" size="sm" onClick={handleSaveSend} loading={saving} label="Tax Invoice" />
    </Stack>
  )

  const headerSubtitle =
    mode === 'edit' && invoice ? (
      <Stack spacing={0.25}>
        <Typography variant="body2" color="text.secondary">
          {invoice.clientName} · {invoice.projectName}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {invoice.invoiceNo}
        </Typography>
      </Stack>
    ) : null

  const poSelectOptions: { label: string; value: string }[] = [
    { label: 'Select a client PO', value: '' },
    ...projectPos.map((po: ClientPO) => ({
      label: `${po.poNumber} — ₹${formatInr(po.poValue)} (${po.startDate} → ${po.endDate})`,
      value: po.id,
    })),
  ]

  const readOnlyPickers = mode === 'edit'

  return (
    <DrawerForm
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit Invoice' : 'Create Invoice'}
      hideHeaderDivider
      headerSx={{ py: 1.5, alignItems: 'center' }}
      width={600}
      footer={footer}
    >
      <Stack spacing={3} sx={{ pt: 1 }}>
        {headerSubtitle && <Box>{headerSubtitle}</Box>}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: -1 }}
        >
          <Typography
            variant="overline"
            sx={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.8px',
              color: 'text.secondary',
              textTransform: 'uppercase',
            }}
          >
            Project selection
          </Typography>
          <Button
            variant="outlined"
            size="sm"
            onClick={() =>
              showToast({
                title: invoice ? 'PDF download (placeholder)' : 'Draft preview download (placeholder)',
                variant: 'success',
              })
            }
            label="Download PDF"
          />
        </Stack>
        <FormSection title="" divider={false}>
          <Stack spacing={2}>
            <FormField label="Project" required error={errors.project}>
              <AutocompleteField<Project>
                options={projectOptions}
                getOptionLabel={(o) => (o.projectCode ? `${o.name} (${o.projectCode})` : o.name)}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                value={project}
                onChange={onProjectChange}
                disabled={mode === 'edit' || lockProject}
                loading={projectsLoading}
                filterOptions={(opts) => opts}
                onInputChange={(value, reason) => {
                  if (mode === 'edit' || lockProject || reason === 'reset') return
                  if (projectSearchTimeoutRef.current) clearTimeout(projectSearchTimeoutRef.current)
                  projectSearchTimeoutRef.current = setTimeout(() => {
                    setProjectSearch(value)
                  }, 300)
                }}
                placeholder="Search live project"
                error={!!errors.project}
                size="sm"
              />
            </FormField>
            {project && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: tokens.color.neutral[50],
                  border: `1px solid ${tokens.color.neutral[200]}`,
                }}
              >
                <Typography variant="caption" color="text.secondary" display="block">
                  Client
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {project.customerName}
                </Typography>
              </Box>
            )}
          </Stack>
        </FormSection>

        {project && (
          <FormSection title="PO selection">
            <FormField label="Client PO">
              <Select
                size="sm"
                placeholder="Select a client PO"
                value={selectedPoId}
                onChange={(v) => onPoChange(String(v))}
                options={poSelectOptions}
                fullWidth
                disabled={mode === 'edit'}
              />
            </FormField>
            {posLoading && (
              <Typography variant="body2" color="text.secondary">
                Loading client POs…
              </Typography>
            )}
            {projectPos.length === 0 && !posLoading && !baselineLoading && (
              <Typography variant="body2" color="text.secondary">
                No client POs found for this project.
              </Typography>
            )}
          </FormSection>
        )}

        {project && (
          <FormSection title="Bill from project">
            {!selectedPoId && (
              <Typography variant="body2" color="text.secondary">
                Select a client PO to load its milestones.
              </Typography>
            )}
            {selectedPoId && baselineLoading && (
              <Typography variant="body2" color="text.secondary">
                Loading PO milestones…
              </Typography>
            )}
            {selectedPo && (
              <Stack spacing={2}>
                {flatMilestones.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No milestones found on this PO.
                  </Typography>
                ) : (
                  <Box>
                    <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Milestones
                    </Typography>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {flatMilestones.map((m) => {
                        const billed = billedByMilestone.get(m.milestoneId) ?? 0
                        const rem = remainingMilestoneValue(billed, m.value)
                        const st = milestoneBillStatus(billed, m.value)
                        return (
                          <Checkbox
                            key={m.milestoneId}
                            size="sm"
                            label={`${m.milestoneName} — ${m.baselineServiceName} · ₹${formatInr(m.value)} · Remaining ₹${formatInr(rem)} · ${st}`}
                            checked={selectedMilestoneIds.includes(m.milestoneId)}
                            onChange={() => toggleMilestone(m.milestoneId)}
                            disabled={readOnlyPickers || rem <= 0}
                          />
                        )
                      })}
                    </Stack>
                  </Box>
                )}
                {skippedZeroRemainingCount > 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontSize: 12 }}>
                    {skippedZeroRemainingCount} selected milestone
                    {skippedZeroRemainingCount === 1 ? '' : 's'} ha
                    {skippedZeroRemainingCount === 1 ? 's' : 've'} no remaining billable amount and will not
                    be added to the invoice.
                  </Typography>
                ) : null}
              </Stack>
            )}
          </FormSection>
        )}

        <FormSection title="Line items">
          <InvoiceLineItems
            mode="edit"
            lines={lines}
            services={services}
            sacCodes={sacCodes}
            baseline={baseline}
            onChange={setLines}
            error={lineError}
            projectSourced={!!project && (!!selectedPo || !!baseline)}
            allowEmpty
            allowManualAdd={false}
            showLabourCessColumn
          />
        </FormSection>

        <FormSection title="Invoice details">
          <Stack spacing={2}>
            <FormField label="Invoice number" required error={errors.invoiceNo}>
              <Input
                value={invoiceNo}
                onChange={(v) => {
                  setInvoiceNo(v)
                  if (errors.invoiceNo) setErrors((prev) => ({ ...prev, invoiceNo: '' }))
                }}
                placeholder="e.g. INV-2026-001"
                size="sm"
                error={!!errors.invoiceNo}
              />
            </FormField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormField label="Invoice date" required error={errors.invoiceDate}>
                <DatePicker value={invoiceDate} onChange={handleInvoiceDateChange} fullWidth size="sm" />
              </FormField>
              <FormField label="Due date" required error={errors.dueDate}>
                <DatePicker
                  value={dueDate}
                  onChange={handleDueDateChange}
                  minDate={minDue}
                  fullWidth
                  size="sm"
                />
              </FormField>
            </Stack>
            <FormField
              label="Payment Duration"
              required
              hint={!invoiceDate ? 'Select an invoice date first' : 'Number of days from invoice date'}
            >
              <Input
                type="number"
                value={paymentTermDays}
                onChange={handlePaymentTermDaysChange}
                placeholder="e.g. 30"
                size="sm"
                disabled={!invoiceDate}
              />
            </FormField>
            <FormField label="Notes">
              <Textarea
                minRows={2}
                fullWidth
                value={notes}
                onChange={setNotes}
                placeholder="Optional notes"
              />
            </FormField>
          </Stack>
        </FormSection>

        <FormSection title="Summary" divider={false}>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              border: `1px solid ${tokens.color.neutral[200]}`,
              bgcolor: tokens.color.neutral[50],
            }}
          >
            <Stack spacing={0.5}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Base amount
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  ₹{formatInr(roll.baseAmount)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Labour cess (%)
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {formatLabourCessPercent(roll.labourCessRatePercent)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Labour cess amount
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  ₹{formatInr(roll.labourCessAmount)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  Taxable amount
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  ₹{formatInr(roll.taxableAmount)}
                </Typography>
              </Stack>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" color="text.secondary">
                  GST amount
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  ₹{formatInr(roll.gstAmount)}
                </Typography>
              </Stack>
              <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[200]}`, my: 1 }} />
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" fontWeight={700}>
                  Final invoice amount
                </Typography>
                <Typography variant="body2" fontWeight={700}>
                  ₹{formatInr(roll.grossAmount)}
                </Typography>
              </Stack>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
              TDS will be captured during payment.
            </Typography>
          </Box>
        </FormSection>
      </Stack>
    </DrawerForm>
  )
}
