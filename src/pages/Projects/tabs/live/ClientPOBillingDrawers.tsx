import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Button as MuiButton,
} from '@mui/material'
import { Upload } from '@mui/icons-material'
import {
  PODocumentLinkField,
} from '@/components/documents/PODocumentLinkField'
import { Button, DatePicker, dateFromIso, isoFromDate, useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { uploadProjectDocumentFile } from '@/api/uploadFileApi'
import { DrawerForm, FormField } from '../../../../components/templates'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import {
  deleteClientPO,
  fetchClientPoById,
  fetchClientPO,
  updateClientPO,
  uploadClientPO,
} from '../../../../slices/baseline/thunk'
import { fetchInvoices } from '../../../../slices/live/thunk'
import type { ClientInvoice } from '../../../../slices/live/types'
import type { ClientPO, ClientPOMilestone } from '../../../../slices/baseline/reducer'
import { formatCurrency, formatDate } from '../../../../utils/formatters'
import {
  type ClientPOServiceOption,
  dropdownClientPOServiceOptions,
  resolveClientPOMilestoneServiceOption,
} from './clientPOServiceOptions'
import { dropdownsApi, type TdsDropdownOption } from '@/api/dropdownsApi'
import {
  ClientPOMilestoneEditor,
  milestonePayloadFromEditor,
  validateNamedMilestones,
  applyPoValueToMilestones,
} from './ClientPOMilestoneEditor'
import {
  canDeleteClientPO,
  clientPOHasBilledMilestone,
  effectiveExecutedValue,
  mergeClientPOUpdate,
  recalculateClientPOMilestonesForExecutedValue,
} from './poExecutedValueRules'
import {
  clientMilestonePaymentStatus,
  clientRetentionPaymentStatus,
  clientMilestoneIsLocked,
  type MilestonePaymentStatusLabel,
} from './milestonePaymentStatus'
import { fetchBaseline } from '../../../../slices/baseline/thunk'
import { fetchServices } from '@/slices/settings/thunk'
import type { Baseline } from '../../../../slices/baseline/reducer'
import type { Service } from '@/slices/settings/reducer'
import {
  clientMilestoneTaxDisplay,
  clientRetentionTaxDisplay,
  formatGstRateLabel,
} from './poTaxDisplay'
import { PoMilestoneTaxLines } from './PoMilestoneTaxLines'

const PO_SECTION_TITLE_SX = {
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.8px',
  color: 'text.secondary',
  textTransform: 'uppercase' as const,
} as const

const TABLE_HEADER_SX = {
  fontSize: 10,
  fontWeight: 700,
  color: tokens.color.neutral[500],
  letterSpacing: 0.5,
  py: 1,
  px: 1.5,
} as const

const TABLE_CELL_SX = {
  fontSize: 12,
  py: 1,
  px: 1.5,
  boxSizing: 'border-box' as const,
} as const

const CLIENT_PO_MILESTONE_COL_COUNT = 5
const CLIENT_PO_MILESTONE_COL_WIDTH = `${100 / CLIENT_PO_MILESTONE_COL_COUNT}%`

const MILESTONE_STATUS_HEADER_SX = {
  ...TABLE_HEADER_SX,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
}

const MILESTONE_STATUS_CELL_SX = {
  ...TABLE_CELL_SX,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
}

function useClientPOServiceOptions(open: boolean): { serviceOptions: ClientPOServiceOption[] } {
  const [serviceOptions, setServiceOptions] = useState<ClientPOServiceOption[]>([])

  useEffect(() => {
    if (!open) {
      setServiceOptions([])
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const [categories, services] = await Promise.all([
          dropdownsApi.getCategories(),
          dropdownsApi.getServices(),
        ])
        const out = dropdownClientPOServiceOptions(categories, services)
        if (!cancelled) setServiceOptions(out)
      } catch {
        if (!cancelled) setServiceOptions([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  return { serviceOptions }
}

function useTdsOptions(open: boolean): TdsDropdownOption[] {
  const [options, setOptions] = useState<TdsDropdownOption[]>([])
  useEffect(() => {
    if (!open) return
    void dropdownsApi.getTdsSections().then(setOptions).catch(() => setOptions([]))
  }, [open])
  return options
}

function useClientPoTaxPreviewContext(
  open: boolean,
  projectId: string,
): { baseline: Baseline | null; settingsServices: Service[] } {
  const dispatch = useAppDispatch()
  const baseline = useAppSelector((s) => s.baseline.baseline)
  const reduxServices = useAppSelector((s) => s.settings.services)
  const [dropdownGstServices, setDropdownGstServices] = useState<Service[]>([])

  useEffect(() => {
    if (!open) {
      setDropdownGstServices([])
      return
    }
    void dispatch(fetchBaseline(projectId))
    void dispatch(fetchServices({ force: true, all: true }))
    let cancelled = false
    void dropdownsApi
      .getServices()
      .then((rows) => {
        if (cancelled) return
        setDropdownGstServices(
          rows.map((row) => ({
            id: row.value,
            name: row.label,
            categoryId: row.categoryId,
            sacCodeId: null,
            gstRate: Number(row.gstRate),
            allowGSTOverride: false,
            allowVendorMapping: false,
            tags: [],
            status: 'active' as const,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setDropdownGstServices([])
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId, dispatch])

  return useMemo(() => {
    const byId = new Map<string, Service>()
    for (const svc of reduxServices) {
      byId.set(svc.id, svc)
    }
    for (const svc of dropdownGstServices) {
      const existing = byId.get(svc.id)
      if (!existing) {
        byId.set(svc.id, svc)
      } else if (existing.gstRate == null || Number.isNaN(existing.gstRate)) {
        byId.set(svc.id, { ...existing, gstRate: svc.gstRate })
      }
    }
    return {
      baseline,
      settingsServices: [...byId.values()],
    }
  }, [baseline, reduxServices, dropdownGstServices])
}

function isRetentionRow(milestone: ClientPOMilestone): boolean {
  return milestone.kind === 'retention' || milestone.id.startsWith('cli-ret-')
}

/** Filter out standalone retention rows and keep nested retention. */
function clientPOMilestonesForEditor(milestones: ClientPOMilestone[]): ClientPOMilestone[] {
  return milestones.filter((m) => !isRetentionRow(m))
}

function MilestoneStatusCell({ status }: { status: MilestonePaymentStatusLabel }) {
  return (
    <Typography
      variant="body2"
      sx={{
        fontSize: 12,
        fontWeight: 600,
        color:
          status === 'Paid' ? 'success.main' : status === 'Billed' ? 'warning.main' : 'text.secondary',
      }}
    >
      {status}
    </Typography>
  )
}

function ClientPOMilestonesTable({
  milestones,
  projectInvoices,
  globalTdsRate = null,
  taxPreviewContext,
}: {
  milestones: ClientPOMilestone[]
  projectInvoices: ClientInvoice[]
  globalTdsRate?: number | null
  taxPreviewContext?: {
    baseline: Baseline | null
    settingsServices: Service[]
  }
}) {
  if (milestones.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, py: 2, textAlign: 'center' }}>
        No milestones recorded for this PO.
      </Typography>
    )
  }

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          {Array.from({ length: CLIENT_PO_MILESTONE_COL_COUNT }, (_, index) => (
            <col key={index} style={{ width: CLIENT_PO_MILESTONE_COL_WIDTH }} />
          ))}
        </colgroup>
        <TableHead>
          <TableRow sx={{ bgcolor: tokens.color.neutral[50] }}>
            <TableCell sx={TABLE_HEADER_SX}>Service Name</TableCell>
            <TableCell sx={TABLE_HEADER_SX}>Name</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_SX}>
              Percentage (%)
            </TableCell>
            <TableCell sx={MILESTONE_STATUS_HEADER_SX}>Status</TableCell>
            <TableCell align="right" sx={TABLE_HEADER_SX}>
              Value (₹)
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {milestones.map((m) => {
            const status =
              m.status ??
              clientMilestonePaymentStatus(projectInvoices, m.id, m.serviceId, m.name)
            const milestoneTax = clientMilestoneTaxDisplay(m, globalTdsRate, taxPreviewContext)
            const retentionTax =
              m.retention && m.serviceId
                ? clientRetentionTaxDisplay(m.retention, m.serviceId, globalTdsRate, taxPreviewContext)
                : null
            return (
            <Fragment key={m.id}>
              <TableRow hover>
                <TableCell sx={TABLE_CELL_SX}>
                  <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {m.serviceName || '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={TABLE_CELL_SX}>
                  <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                    {isRetentionRow(m) ? `${m.name} (Retention)` : m.name || '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={TABLE_CELL_SX}>
                  {m.percentage}%
                </TableCell>
                <TableCell sx={MILESTONE_STATUS_CELL_SX}>
                  <MilestoneStatusCell status={status} />
                </TableCell>
                <TableCell align="right" sx={{ ...TABLE_CELL_SX, fontWeight: 600 }}>
                  ₹{formatCurrency(m.value)}
                </TableCell>
              </TableRow>
              {milestoneTax ? (
                <TableRow>
                  <TableCell colSpan={CLIENT_PO_MILESTONE_COL_COUNT} sx={{ py: 0.5, px: 1.5, borderBottom: 'none' }}>
                    <PoMilestoneTaxLines tax={milestoneTax} variant="client" />
                  </TableCell>
                </TableRow>
              ) : null}
              {m.retention && !isRetentionRow(m) ? (
                <>
                <TableRow key={`${m.id}-retention`} sx={{ bgcolor: tokens.color.neutral[50] }}>
                  <TableCell sx={TABLE_CELL_SX}>
                    <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {m.serviceName || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ ...TABLE_CELL_SX, pl: 3 }}>
                    <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                      ↳ Retention
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={TABLE_CELL_SX}>
                    {m.retention.percentage}%
                  </TableCell>
                  <TableCell sx={MILESTONE_STATUS_CELL_SX}>
                    <MilestoneStatusCell
                      status={
                        m.retention.status ??
                        clientRetentionPaymentStatus(projectInvoices, m.id)
                      }
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ ...TABLE_CELL_SX, fontWeight: 600 }}>
                    ₹{formatCurrency(m.retention.value)}
                  </TableCell>
                </TableRow>
                {retentionTax ? (
                  <TableRow>
                    <TableCell colSpan={CLIENT_PO_MILESTONE_COL_COUNT} sx={{ py: 0.5, px: 1.5, borderBottom: 'none' }}>
                      <PoMilestoneTaxLines tax={retentionTax} variant="client" />
                    </TableCell>
                  </TableRow>
                ) : null}
                </>
              ) : null}
            </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}

interface AddClientPODrawerProps {
  open: boolean
  onClose: () => void
  projectId: string
}

export function AddClientPODrawer({ open, onClose, projectId }: AddClientPODrawerProps) {
  const dispatch = useAppDispatch()
  const { saving } = useAppSelector((s) => s.baseline)
  const toast = useToast((s) => s.showToast)
  const { serviceOptions } = useClientPOServiceOptions(open)
  const tdsOptions = useTdsOptions(open)
  const taxPreviewContext = useClientPoTaxPreviewContext(open, projectId)
  const [poFormData, setPoFormData] = useState({
    poNumber: '',
    startDate: '',
    poValue: '',
    executedValue: '',
    file: null as File | null,
    tdsSectionId: '',
    tdsRate: null as number | null,
  })
  const [milestones, setMilestones] = useState<ClientPOMilestone[]>([])

  useEffect(() => {
    if (!open) {
      setPoFormData({
        poNumber: '',
        startDate: '',
        poValue: '',
        executedValue: '',
        file: null,
        tdsSectionId: '',
        tdsRate: null,
      })
      setMilestones([])
    } else {
      setPoFormData((prev) => ({
        ...prev,
        startDate: prev.startDate || isoFromDate(new Date()),
      }))
    }
  }, [open])

  const poValueNumber = Number(poFormData.poValue) || 0
  const executedValueNumber = poFormData.executedValue
    ? Number(poFormData.executedValue)
    : poValueNumber
  const milestoneBaseValue = executedValueNumber

  useEffect(() => {
    if (milestoneBaseValue <= 0) return
    setMilestones((prev) => applyPoValueToMilestones(prev, milestoneBaseValue))
  }, [milestoneBaseValue])

  useEffect(() => {
    if (serviceOptions.length === 0) return
    const first = serviceOptions[0]
    setMilestones((prev) =>
      prev.map((m) => {
        const keep = serviceOptions.some((o) => o.id === m.serviceId)
        if (keep) return m
        if (!first) return m
        return { ...m, serviceId: first.id, serviceName: first.label }
      }),
    )
  }, [serviceOptions])

  const handlePoChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setPoFormData((prev) => ({ ...prev, [field]: e.target.value }))
  }

  function handlePoValueChange(value: string) {
    setPoFormData((prev) => {
      const oldPo = Number(prev.poValue) || 0
      const oldExec = prev.executedValue ? Number(prev.executedValue) : oldPo
      const syncExec = !prev.executedValue || oldExec === oldPo
      return {
        ...prev,
        poValue: value,
        executedValue: syncExec ? value : prev.executedValue,
      }
    })
  }

  async function handleSubmit() {
    if (!poFormData.poNumber || !poFormData.poValue || !poFormData.startDate) {
      toast({ title: 'Please fill in all required fields', variant: 'error' })
      return
    }
    if (!validateNamedMilestones(milestones, (msg) => toast({ title: msg, variant: 'error' }), true)) {
      return
    }
    const milestonePayload = milestonePayloadFromEditor(milestones)
    if (milestonePayload.length === 0) {
      toast({ title: 'Add at least one milestone entry', variant: 'error' })
      return
    }

    const executedValueNumberSave = poFormData.executedValue
      ? Number(poFormData.executedValue)
      : null

    try {
      let documentUrl: string | null = null
      let fileName: string | undefined
      let uploadedAt: string | undefined
      if (poFormData.file) {
        const uploaded = await uploadProjectDocumentFile(poFormData.file)
        documentUrl = uploaded.viewUrl
        fileName = uploaded.originalName || poFormData.file.name
        uploadedAt = new Date().toISOString()
      }

      await dispatch(
        uploadClientPO({
          projectId,
          data: {
            poNumber: poFormData.poNumber,
            startDate: poFormData.startDate,
            endDate: '',
            poValue: poValueNumber,
            executedValue: executedValueNumberSave,
            documentUrl,
            fileName,
            uploadedAt,
            milestones: milestonePayload,
            tdsSectionId: poFormData.tdsSectionId || null,
            tdsRate: poFormData.tdsRate,
          },
        }),
      ).unwrap()
      void dispatch(fetchClientPO(projectId))
      toast({ title: 'PO saved successfully', variant: 'success' })
      onClose()
    } catch (err) {
      const message =
        typeof err === 'string' && err.trim()
          ? err
          : 'Failed to save PO'
      toast({ title: message, variant: 'error' })
    }
  }

  return (
    <DrawerForm
      open={open}
      onClose={onClose}
      title="Add Client PO"
      subtitle="Record the client purchase order details"
      onSubmit={handleSubmit}
      submitLoading={saving}
      submitLabel="Save PO"
    >
      <Box sx={{ mb: 0 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: poFormData.file ? 0.5 : '12px' }}
        >
          <Typography component="span" variant="overline" sx={PO_SECTION_TITLE_SX}>
            PO Details
          </Typography>
          <MuiButton
            variant="outlined"
            component="label"
            size="small"
            startIcon={<Upload />}
            sx={{ fontSize: 12 }}
          >
            Upload PO Document
            <input
              type="file"
              hidden
              accept=".pdf,.doc,.docx"
              onChange={(e) =>
                setPoFormData((prev) => ({ ...prev, file: e.target.files?.[0] ?? null }))
              }
            />
          </MuiButton>
        </Stack>
        {poFormData.file ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: '12px', textAlign: 'right', fontSize: 11 }}
          >
            {poFormData.file.name}
          </Typography>
        ) : null}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
          }}
        >
          <FormField label="PO Number" required>
            <TextField
              fullWidth
              size="small"
              value={poFormData.poNumber}
              onChange={handlePoChange('poNumber')}
              placeholder="PO-CLI-2024-001"
            />
          </FormField>
          <FormField label="PO Date" required>
            <DatePicker
              value={dateFromIso(poFormData.startDate)}
              onChange={(d) =>
                setPoFormData((prev) => ({ ...prev, startDate: isoFromDate(d) }))
              }
            />
          </FormField>
          <FormField label="PO Value (₹)" required>
            <TextField
              fullWidth
              size="small"
              type="number"
              value={poFormData.poValue}
              onChange={(e) => handlePoValueChange(e.target.value)}
              placeholder="0"
            />
          </FormField>
          <FormField label="Executed Value (₹)">
            <TextField
              fullWidth
              size="small"
              type="number"
              value={poFormData.executedValue}
              onChange={handlePoChange('executedValue')}
              placeholder="0"
            />
          </FormField>
          <FormField label="TDS Section">
            <Select
              fullWidth
              size="small"
              displayEmpty
              value={poFormData.tdsSectionId}
              onChange={(e) => {
                const id = e.target.value
                const opt = tdsOptions.find((o) => o.value === id)
                setPoFormData((prev) => ({
                  ...prev,
                  tdsSectionId: id,
                  tdsRate: opt?.rate ?? null,
                }))
              }}
              sx={{ fontSize: 12 }}
            >
              <MenuItem value="" sx={{ fontSize: 12 }}>None</MenuItem>
              {tdsOptions.map((o) => (
                <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12 }}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormField>
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <ClientPOMilestoneEditor
        poValue={milestoneBaseValue}
        milestones={milestones}
        onChange={setMilestones}
        serviceOptions={serviceOptions}
        disabled={serviceOptions.length === 0}
        globalTdsRate={poFormData.tdsRate}
        taxPreviewContext={taxPreviewContext}
      />
    </DrawerForm>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 500, mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  )
}

function useClientPODetail(
  open: boolean,
  projectId: string,
  poId: string | null,
  poSeed: ClientPO | null,
) {
  const dispatch = useAppDispatch()
  const toast = useToast((s) => s.showToast)
  const { invoices } = useAppSelector((s) => s.live)
  const [po, setPo] = useState<ClientPO | null>(poSeed)
  const [loadingPo, setLoadingPo] = useState(false)

  const projectInvoices = useMemo(
    () => invoices.filter((i) => i.projectId === projectId),
    [invoices, projectId],
  )

  useEffect(() => {
    if (!open || !poId) {
      setPo(null)
      setLoadingPo(false)
      return
    }
    let cancelled = false
    setPo((prev) => (prev?.id === poId ? prev : poSeed?.id === poId ? poSeed : null))
    setLoadingPo(true)
    void dispatch(fetchClientPoById({ projectId, poId }))
      .unwrap()
      .then((detail) => {
        if (!cancelled) setPo(detail)
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: typeof err === 'string' ? err : 'Failed to load PO',
            variant: 'error',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPo(false)
      })
    void dispatch(fetchInvoices(projectId))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poId, projectId, dispatch, toast])

  return { po, setPo, loadingPo, projectInvoices }
}

interface ClientPODrawerBaseProps {
  open: boolean
  onClose: () => void
  projectId: string
  poId: string | null
  poSeed?: ClientPO | null
}

export function ViewClientPODrawer({
  open,
  onClose,
  projectId,
  poId,
  poSeed = null,
}: ClientPODrawerBaseProps) {
  const toast = useToast((s) => s.showToast)
  const { po, loadingPo, projectInvoices } = useClientPODetail(open, projectId, poId, poSeed)

  function handlePoDocumentOpenFailed() {
    toast({
      title: 'Unable to open document',
      description: 'The PO file is no longer available in this session.',
      variant: 'error',
    })
  }

  return (
    <DrawerForm
      open={open}
      onClose={onClose}
      title={po?.poNumber ?? 'Client PO'}
      subtitle="Purchase order details"
      hideFooter
    >
      {loadingPo && !po ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, py: 4, textAlign: 'center' }}>
          Loading PO…
        </Typography>
      ) : null}
      {po ? (
        <Stack spacing={2.5}>
          <Box>
            <Typography component="span" variant="overline" sx={{ ...PO_SECTION_TITLE_SX, display: 'block', mb: 1.5 }}>
              PO Details
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              <ReadOnlyField label="PO Number" value={po.poNumber} />
              <ReadOnlyField
                label="PO Date"
                value={po.startDate ? formatDate(po.startDate) : '—'}
              />
              <ReadOnlyField label="PO Value" value={`₹${formatCurrency(po.poValue)}`} />
              <ReadOnlyField label="Executed Value" value={`₹${formatCurrency(effectiveExecutedValue(po))}`} />
              <ReadOnlyField
                label="TDS Rate"
                value={po.tdsRate != null ? formatGstRateLabel(po.tdsRate) : '—'}
              />
              <PODocumentLinkField
                fileName={po.fileName}
                documentUrl={po.documentUrl}
                onOpenFailed={handlePoDocumentOpenFailed}
                emptyLabel="No document uploaded"
              />
            </Box>
          </Box>
          <Divider sx={{ my: 0.5 }} />
          <Box>
            <Typography component="span" variant="overline" sx={{ ...PO_SECTION_TITLE_SX, display: 'block', mb: 1.5 }}>
              Milestones
            </Typography>
            <ClientPOMilestonesTable
              milestones={po.milestones ?? []}
              projectInvoices={projectInvoices}
              globalTdsRate={po.tdsRate}
            />
          </Box>
        </Stack>
      ) : null}
    </DrawerForm>
  )
}

export function EditClientPODrawer({
  open,
  onClose,
  projectId,
  poId,
  poSeed = null,
}: ClientPODrawerBaseProps) {
  const dispatch = useAppDispatch()
  const { saving } = useAppSelector((s) => s.baseline)
  const toast = useToast((s) => s.showToast)
  const { po, loadingPo, projectInvoices } = useClientPODetail(open, projectId, poId, poSeed)
  const { serviceOptions } = useClientPOServiceOptions(open)
  const tdsOptions = useTdsOptions(open)
  const taxPreviewContext = useClientPoTaxPreviewContext(open, projectId)
  const [poNumber, setPoNumber] = useState('')
  const [startDate, setStartDate] = useState('')
  const [poValue, setPoValue] = useState('')
  const [executedValue, setExecutedValue] = useState('')
  const [milestones, setMilestones] = useState<ClientPOMilestone[]>([])
  const [newFile, setNewFile] = useState<File | null>(null)
  const [tdsSectionId, setTdsSectionId] = useState('')
  const [tdsRate, setTdsRate] = useState<number | null>(null)

  const hasBilled = useMemo(
    () => (po ? clientPOHasBilledMilestone(po.milestones ?? [], projectInvoices) : false),
    [po, projectInvoices],
  )

  const lockedMilestoneIds = useMemo(() => {
    if (!po) return new Set<string>()
    const ids = new Set<string>()
    for (const m of po.milestones ?? []) {
      if (clientMilestoneIsLocked(projectInvoices, m.id, m.serviceId, m.name)) {
        ids.add(m.id)
      }
    }
    return ids
  }, [po, projectInvoices])

  const lockedRetentionIds = useMemo(() => {
    if (!po) return new Set<string>()
    const ids = new Set<string>()
    for (const m of po.milestones ?? []) {
      if (isRetentionRow(m)) continue
      if (!m.retention) continue
      const retStatus = clientRetentionPaymentStatus(projectInvoices, m.id)
      if (retStatus === 'Paid' || retStatus === 'Billed') {
        ids.add(m.id)
      }
    }
    return ids
  }, [po, projectInvoices])

  useEffect(() => {
    if (!open || !po) return
    setPoNumber(po.poNumber)
    setStartDate(po.startDate || '')
    setPoValue(String(po.poValue))
    setExecutedValue(String(effectiveExecutedValue(po)))
    setNewFile(null)
    setMilestones(clientPOMilestonesForEditor(po.milestones ?? []))
    setTdsSectionId(po.tdsSectionId ?? '')
    setTdsRate(po.tdsRate ?? null)
  }, [open, po?.id, po])

  useEffect(() => {
    if (serviceOptions.length === 0) return
    setMilestones((prev) =>
      prev.map((m) => {
        if (lockedMilestoneIds.has(m.id)) return m
        const resolved = resolveClientPOMilestoneServiceOption(m.serviceId, serviceOptions)
        if (!resolved) return m
        if (m.serviceId === resolved.id && m.serviceName === resolved.label) return m
        return { ...m, serviceId: resolved.id, serviceName: resolved.label }
      }),
    )
  }, [serviceOptions, lockedMilestoneIds])

  const milestoneBaseValue = useMemo(() => {
    const n = Number(executedValue)
    return Number.isFinite(n) && n > 0 ? n : po ? effectiveExecutedValue(po) : 0
  }, [executedValue, po])

  async function handleSave() {
    if (!po) return
    const poValueNum = Number(poValue)
    const executedValueNum = Number(executedValue)
    if (!poNumber.trim() || !Number.isFinite(poValueNum) || poValueNum <= 0) {
      toast({ title: 'Enter valid PO number and value', variant: 'error' })
      return
    }
    if (!startDate.trim()) {
      toast({ title: 'PO Date is required', variant: 'error' })
      return
    }
    if (!Number.isFinite(executedValueNum) || executedValueNum <= 0) {
      toast({ title: 'Enter a valid executed value', variant: 'error' })
      return
    }
    if (!validateNamedMilestones(milestones, (msg) => toast({ title: msg, variant: 'error' }), true)) {
      return
    }

    const milestonePayload = milestonePayloadFromEditor(milestones)

    const recalculated = recalculateClientPOMilestonesForExecutedValue(
      milestonePayload,
      executedValueNum,
      projectInvoices,
    )

    let documentUrl = po.documentUrl
    let fileName = po.fileName
    let uploadedAt = po.uploadedAt
    if (newFile) {
      const uploaded = await uploadProjectDocumentFile(newFile)
      documentUrl = uploaded.viewUrl
      fileName = uploaded.originalName || newFile.name
      uploadedAt = new Date().toISOString()
    }

    const body: Partial<ClientPO> = {
      poNumber: poNumber.trim(),
      startDate: startDate.trim(),
      poValue: hasBilled ? po.poValue : poValueNum,
      executedValue: executedValueNum,
      milestones: recalculated,
      documentUrl,
      fileName,
      uploadedAt,
      tdsSectionId: tdsSectionId || null,
      tdsRate,
    }

    const merged = mergeClientPOUpdate(po, body, { invoices: projectInvoices })
    if (!merged.ok) {
      toast({ title: merged.message, variant: 'error' })
      return
    }

    try {
      await dispatch(updateClientPO({ projectId, poId: po.id, data: merged.po })).unwrap()
      void dispatch(fetchClientPO(projectId))
      toast({ title: 'PO updated', variant: 'success' })
      onClose()
    } catch (err) {
      toast({ title: typeof err === 'string' ? err : 'Failed to update PO', variant: 'error' })
    }
  }

  return (
    <DrawerForm
      open={open}
      onClose={onClose}
      title={po?.poNumber ? `Edit ${po.poNumber}` : 'Edit Client PO'}
      subtitle={
        hasBilled
          ? 'Milestones are billed or paid — only Executed Value can be changed'
          : 'Update purchase order details'
      }
      footer={
        <Stack direction="row" justifyContent="flex-end" gap={1} sx={{ px: 2.5, py: 1.75, width: '100%' }}>
          <Button variant="text" size="sm" label="Cancel" onClick={onClose} />
          <Button
            size="sm"
            variant="contained"
            color="primary"
            label={saving ? 'Saving…' : 'Save'}
            onClick={() => void handleSave()}
            disabled={saving || loadingPo}
          />
        </Stack>
      }
    >
      {loadingPo && !po ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, py: 4, textAlign: 'center' }}>
          Loading PO…
        </Typography>
      ) : null}
      {po ? (
        <Stack spacing={2.5}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <FormField label="PO Number" required>
              <TextField
                fullWidth
                size="small"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                disabled={hasBilled}
              />
            </FormField>
            <FormField label="PO Date" required>
              <DatePicker
                value={dateFromIso(startDate)}
                onChange={(d) => setStartDate(isoFromDate(d))}
                disabled={hasBilled}
              />
            </FormField>
            <FormField label="PO Value (₹)" required>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={poValue}
                onChange={(e) => setPoValue(e.target.value)}
                disabled={hasBilled}
              />
            </FormField>
            <FormField label="Executed Value (₹)" required>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={executedValue}
                onChange={(e) => setExecutedValue(e.target.value)}
              />
            </FormField>
            <FormField label="TDS Section">
              <Select
                fullWidth
                size="small"
                displayEmpty
                value={tdsSectionId}
                disabled={hasBilled}
                onChange={(e) => {
                  const id = e.target.value
                  const opt = tdsOptions.find((o) => o.value === id)
                  setTdsSectionId(id)
                  setTdsRate(opt?.rate ?? null)
                }}
                sx={{ fontSize: 12 }}
              >
                <MenuItem value="" sx={{ fontSize: 12 }}>None</MenuItem>
                {tdsOptions.map((o) => (
                  <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12 }}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormField>
            <FormField label="PO Document">
              <MuiButton
                variant="outlined"
                component="label"
                size="small"
                startIcon={<Upload />}
                sx={{ fontSize: 12 }}
                disabled={hasBilled}
              >
                {newFile ? newFile.name : po.fileName ? 'Replace document' : 'Upload document'}
                <input
                  type="file"
                  hidden
                  accept=".pdf,.doc,.docx"
                  disabled={hasBilled}
                  onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                />
              </MuiButton>
            </FormField>
          </Box>
          <Divider />

          <ClientPOMilestoneEditor
            poValue={milestoneBaseValue}
            milestones={milestones}
            onChange={setMilestones}
            serviceOptions={serviceOptions}
            lockedMilestoneIds={lockedMilestoneIds}
            lockedRetentionIds={lockedRetentionIds}
            allowAddMilestone={false}
            disabled={hasBilled || serviceOptions.length === 0}
            globalTdsRate={tdsRate}
            taxPreviewContext={taxPreviewContext}
          />
        </Stack>
      ) : null}
    </DrawerForm>
  )
}

export function DeleteClientPODialog({
  open,
  po,
  projectId,
  onClose,
  onDeleted,
}: {
  open: boolean
  po: ClientPO | null
  projectId: string
  onClose: () => void
  onDeleted?: () => void
}) {
  const dispatch = useAppDispatch()
  const { saving } = useAppSelector((s) => s.baseline)
  const toast = useToast((s) => s.showToast)

  async function handleDelete() {
    if (!po) return
    try {
      await dispatch(deleteClientPO({ projectId, poId: po.id })).unwrap()
      void dispatch(fetchClientPO(projectId))
      toast({ title: 'PO deleted', variant: 'success' })
      onDeleted?.()
      onClose()
    } catch {
      toast({ title: 'Failed to delete PO', variant: 'error' })
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>Delete client PO?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ fontSize: 13 }}>
          This will permanently remove {po?.poNumber}. This action cannot be undone.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <MuiButton size="small" onClick={onClose}>Cancel</MuiButton>
        <MuiButton size="small" variant="contained" color="error" disabled={saving} onClick={() => void handleDelete()}>
          Delete
        </MuiButton>
      </DialogActions>
    </Dialog>
  )
}

export { canDeleteClientPO }
