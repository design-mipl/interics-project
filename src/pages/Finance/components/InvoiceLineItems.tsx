import { useState } from 'react'
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton as MuiIconButton,
  Typography,
} from '@mui/material'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Input, Select } from '@/design-system/components'
import type { LineItem, LineSource } from '@/slices/receivables/reducer'
import type { Service, SACCode } from '@/slices/settings/reducer'
import type { Baseline } from '@/slices/baseline/reducer'
import { tokens } from '@/design-system/tokens'
import { formatInr } from '@/utils/formatters'
import { computeLineItemTaxBreakdown } from '@/pages/Projects/tabs/live/clientInvoiceUtils'
import { DEFAULT_GST_RATE } from '@/config/billingRates'
import {
  resolveServiceForLine,
  sacCodeForService,
} from '@/pages/Finance/utils/projectBillable'

export interface DraftLineItem {
  id: string
  serviceId: string
  serviceName: string
  sacCode: string
  amount: number
  labourCessRate: number
  labourCessAmount: number
  taxableAmount: number
  gstRate: number
  gstAmount: number
  milestoneId?: string
  baselineServiceId?: string
  lineSource?: LineSource
  /** Expected milestone remaining amount; used for warnings only, not a hard cap */
  maxAmount?: number
}

function amountVsMilestone(amount: number, milestoneAmount: number): 'over' | 'under' | null {
  const delta = Math.round((amount - milestoneAmount) * 100) / 100
  if (delta > 0.01) return 'over'
  if (delta < -0.01) return 'under'
  return null
}

function applyLineTaxes(line: DraftLineItem): DraftLineItem {
  const amount = line.amount
  const breakdown = computeLineItemTaxBreakdown(amount, line.labourCessRate, line.gstRate)
  return {
    ...line,
    amount,
    labourCessAmount: breakdown.labourCessAmount,
    taxableAmount: breakdown.taxableAmount,
    gstAmount: breakdown.gstAmount,
  }
}

function resolveSac(sacCodes: SACCode[], service: Service | undefined): string {
  const code = sacCodeForService(sacCodes, service)
  return code || '—'
}

/** Prefer stored SAC; otherwise resolve from settings service / baseline service. */
function displaySacCode(
  row: LineItem | DraftLineItem,
  services: Service[],
  sacCodes: SACCode[],
  baseline?: Baseline | null,
): string {
  const stored = row.sacCode?.trim()
  if (stored && stored !== '—') return stored

  const baselineServiceId =
    'baselineServiceId' in row && typeof row.baselineServiceId === 'string'
      ? row.baselineServiceId
      : undefined

  const serviceLabel = row.serviceName.includes(' — ')
    ? row.serviceName.split(' — ').slice(-1)[0]?.trim()
    : row.serviceName

  const service =
    resolveServiceForLine(row.serviceId, serviceLabel, services, baseline) ??
    resolveServiceForLine(baselineServiceId, serviceLabel, services, baseline)

  return resolveSac(sacCodes, service)
}

export interface InvoiceLineItemsProps {
  mode: 'edit' | 'read'
  lines: DraftLineItem[] | LineItem[]
  services: Service[]
  sacCodes: SACCode[]
  /** Project baseline — used to map pitch service ids → Service Master for SAC. */
  baseline?: Baseline | null
  onChange?: (lines: DraftLineItem[]) => void
  error?: string
  /** When set, renders a read-only TDS % column next to GST %. */
  showTdsColumn?: boolean
  /** TDS rate (%) applied to the entire client PO/invoice. */
  tdsRate?: number | null
  /** When true, milestone/service rows show description as text and cannot be deleted; manual rows use Select + delete. */
  projectSourced?: boolean
  /** Allow zero lines (project flow before selection). */
  allowEmpty?: boolean
  /** Collapsed "Add manual line" until expanded */
  manualAddCollapsed?: boolean
  /** Hide SAC Code column (project generate-invoice flow) */
  hideSacColumn?: boolean
  /** Show Labour cess % column between Amount and GST % */
  showLabourCessColumn?: boolean
  /** In read mode, render Labour cess % as an editable input (Generate Invoice flow). */
  editableLabourCessInReadMode?: boolean
  /** Disable adding manual lines from UI actions. */
  allowManualAdd?: boolean
}

export function emptyDraftLine(): DraftLineItem {
  return {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    serviceId: '',
    serviceName: '',
    sacCode: '',
    amount: 0,
    labourCessRate: 0,
    labourCessAmount: 0,
    taxableAmount: 0,
    gstRate: DEFAULT_GST_RATE,
    gstAmount: 0,
    lineSource: 'manual',
  }
}

export function InvoiceLineItems({
  mode,
  lines,
  services,
  sacCodes,
  baseline = null,
  onChange,
  error,
  projectSourced = false,
  allowEmpty = false,
  manualAddCollapsed = false,
  hideSacColumn = false,
  showLabourCessColumn = false,
  editableLabourCessInReadMode = false,
  showTdsColumn = false,
  tdsRate = null,
  allowManualAdd = true,
}: InvoiceLineItemsProps) {
  const activeServices = services.filter((s) => s.status === 'active')
  const [manualOpen, setManualOpen] = useState(!manualAddCollapsed)

  function updateLine(index: number, patch: Partial<DraftLineItem>) {
    if (!onChange) return
    const next = [...(lines as DraftLineItem[])]
    const cur = { ...next[index], ...patch }
    if (patch.serviceId !== undefined) {
      const svc = activeServices.find((s) => s.id === patch.serviceId)
      cur.serviceName = svc?.name ?? ''
      cur.gstRate = svc?.gstRate ?? DEFAULT_GST_RATE
      cur.sacCode = sacCodeForService(sacCodes, svc)
    }
    if (
      patch.amount !== undefined ||
      patch.gstRate !== undefined ||
      patch.labourCessRate !== undefined ||
      patch.serviceId !== undefined
    ) {
      next[index] = applyLineTaxes(cur)
    } else {
      next[index] = cur
    }
    onChange(next)
  }

  function removeLine(index: number) {
    if (!onChange) return
    const row = (lines as DraftLineItem[])[index]
    if (projectSourced && row.lineSource && row.lineSource !== 'manual') return
    const next = (lines as DraftLineItem[]).filter((_, i) => i !== index)
    if (!allowEmpty && next.length === 0) {
      onChange([emptyDraftLine()])
    } else {
      onChange(next)
    }
  }

  function addManualLine() {
    if (!onChange) return
    onChange([...(lines as DraftLineItem[]), emptyDraftLine()])
    setManualOpen(true)
  }

  const baseTotal = lines.reduce((s, l) => s + l.amount, 0)
  const gstTotal = lines.reduce((s, l) => s + l.gstAmount, 0)

  const descLabel = projectSourced ? 'Service / milestone' : 'Service'
  const isCompactProjectTable = projectSourced && hideSacColumn
  const emptyColSpan =
    1 +
    (hideSacColumn ? 0 : 1) +
    1 +
    (showLabourCessColumn ? 1 : 0) +
    2 + // GST % + GST Amt
    (showTdsColumn ? 1 : 0) +
    (mode === 'edit' ? 1 : 0)

  const serviceColSx = isCompactProjectTable
    ? { width: '34%', pl: 1.5, pr: 0.25 }
    : undefined
  const amountColSx = isCompactProjectTable
    ? { width: 96, pl: 0.25, pr: 1 }
    : { width: 120 }

  const tdsRateLabel = tdsRate != null ? `${tdsRate}%` : '—'

  return (
    <Box>
      <TableContainer>
        <Table
          size="small"
          sx={isCompactProjectTable ? { width: '100%', tableLayout: 'fixed' } : undefined}
        >
          <TableHead>
            <TableRow sx={{ bgcolor: tokens.color.neutral[50] }}>
              <TableCell
                sx={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'text.secondary',
                  ...serviceColSx,
                }}
              >
                {descLabel}
              </TableCell>
              {!hideSacColumn ? (
                <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', width: 100 }}>
                  SAC Code
                </TableCell>
              ) : null}
              <TableCell
                sx={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'text.secondary',
                  ...amountColSx,
                }}
              >
                Amount
              </TableCell>
              {showLabourCessColumn ? (
                <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', width: 96 }}>
                  Labour Cess %
                </TableCell>
              ) : null}
              <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', width: 88 }}>
                GST %
              </TableCell>
              {showTdsColumn ? (
                <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', width: 88 }}>
                  TDS %
                </TableCell>
              ) : null}
              <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', width: 100 }}>
                GST Amt
              </TableCell>
              {mode === 'edit' && <TableCell sx={{ width: 48 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.length === 0 && mode === 'edit' ? (
              <TableRow>
                <TableCell colSpan={emptyColSpan}>
                  <Typography variant="body2" color="text.secondary">
                    No lines yet — select milestones above.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
            {lines.map((row, index) => {
              const draft = row as DraftLineItem
              const isManual = !projectSourced || draft.lineSource === 'manual' || !draft.lineSource
              const amountMismatch =
                draft.maxAmount !== undefined && draft.maxAmount >= 0
                  ? amountVsMilestone(draft.amount, draft.maxAmount)
                  : null
              return mode === 'read' ? (
                <TableRow key={row.id}>
                  <TableCell sx={{ fontSize: 12, ...serviceColSx }}>{row.serviceName}</TableCell>
                  {!hideSacColumn ? (
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {displaySacCode(row, services, sacCodes, baseline)}
                    </TableCell>
                  ) : null}
                  <TableCell sx={{ fontSize: 12, ...amountColSx }}>₹{formatInr(row.amount)}</TableCell>
                  {showLabourCessColumn ? (
                    <TableCell
                      sx={{
                        fontSize: 12,
                        py: editableLabourCessInReadMode ? 1.5 : undefined,
                        verticalAlign: editableLabourCessInReadMode ? 'top' : undefined,
                      }}
                    >
                      {editableLabourCessInReadMode && onChange ? (
                        <Input
                          size="sm"
                          type="number"
                          value={draft.labourCessRate ? String(draft.labourCessRate) : ''}
                          onChange={(v) => updateLine(index, { labourCessRate: Number(v) || 0 })}
                          fullWidth
                          placeholder="0"
                        />
                      ) : (
                        `${(row as DraftLineItem).labourCessRate ?? 0}%`
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell sx={{ fontSize: 12 }}>{row.gstRate}%</TableCell>
                  {showTdsColumn ? <TableCell sx={{ fontSize: 12 }}>{tdsRateLabel}</TableCell> : null}
                  <TableCell sx={{ fontSize: 12 }}>₹{formatInr(row.gstAmount)}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.id}>
                  <TableCell sx={{ py: 1.5, verticalAlign: 'top', ...serviceColSx }}>
                    {isManual ? (
                      <Select
                        size="sm"
                        placeholder="Select service"
                        value={draft.serviceId}
                        onChange={(v) => updateLine(index, { serviceId: String(v) })}
                        options={activeServices.map((s) => ({ label: s.name, value: s.id }))}
                        fullWidth
                      />
                    ) : (
                      <Typography variant="body2" sx={{ py: 0.5 }}>
                        {draft.serviceName}
                      </Typography>
                    )}
                  </TableCell>
                  {!hideSacColumn ? (
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace', verticalAlign: 'middle' }}>
                      {displaySacCode(draft, services, sacCodes, baseline)}
                    </TableCell>
                  ) : null}
                  <TableCell sx={{ py: 1.5, verticalAlign: 'top', ...amountColSx }}>
                    <Input
                      size="sm"
                      type="number"
                      value={row.amount ? String(row.amount) : ''}
                      onChange={(v) => updateLine(index, { amount: Number(v) || 0 })}
                      fullWidth
                    />
                    {amountMismatch && draft.maxAmount !== undefined && (
                      <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.25 }}>
                        {amountMismatch === 'over'
                          ? `Amount exceeds the milestone value of ₹${formatInr(draft.maxAmount)}`
                          : `Amount is less than the milestone value of ₹${formatInr(draft.maxAmount)}`}
                      </Typography>
                    )}
                  </TableCell>
                  {showLabourCessColumn ? (
                    <TableCell sx={{ py: 1.5, verticalAlign: 'top' }}>
                      <Input
                        size="sm"
                        type="number"
                        value={draft.labourCessRate ? String(draft.labourCessRate) : ''}
                        onChange={(v) => updateLine(index, { labourCessRate: Number(v) || 0 })}
                        fullWidth
                        placeholder="0"
                      />
                    </TableCell>
                  ) : null}
                  <TableCell sx={{ verticalAlign: 'middle' }}>
                    <Badge label={`${row.gstRate}%`} size="sm" color="neutral" variant="soft" />
                  </TableCell>
                  {showTdsColumn ? (
                    <TableCell sx={{ verticalAlign: 'middle' }}>
                      <Badge label={tdsRateLabel} size="sm" color="neutral" variant="soft" />
                    </TableCell>
                  ) : null}
                  <TableCell sx={{ fontSize: 12, verticalAlign: 'middle' }}>
                    ₹{formatInr(row.gstAmount)}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'middle' }}>
                    <MuiIconButton
                      size="small"
                      onClick={() => removeLine(index)}
                      disabled={
                        (projectSourced && draft.lineSource !== 'manual' && draft.lineSource !== undefined) ||
                        (!allowEmpty && lines.length <= 1 && draft.lineSource === 'manual')
                      }
                      sx={{ color: tokens.color.neutral[400] }}
                    >
                      <Trash2 size={14} />
                    </MuiIconButton>
                  </TableCell>
                </TableRow>
              )
            })}
            {mode === 'read' && lines.length > 0 && (
              <TableRow sx={{ bgcolor: tokens.color.neutral[50] }}>
                <TableCell sx={{ fontSize: 12, fontWeight: 700 }}>Subtotal</TableCell>
                {!hideSacColumn ? <TableCell>—</TableCell> : null}
                <TableCell sx={{ fontSize: 12, fontWeight: 700 }}>₹{formatInr(baseTotal)}</TableCell>
                {showLabourCessColumn ? <TableCell>—</TableCell> : null}
                <TableCell>—</TableCell>
                {showTdsColumn ? <TableCell>{tdsRateLabel}</TableCell> : null}
                <TableCell sx={{ fontSize: 12, fontWeight: 700 }}>₹{formatInr(gstTotal)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {mode === 'edit' && allowManualAdd && projectSourced && manualAddCollapsed && !manualOpen ? (
        <Box sx={{ mt: 2 }}>
          <Button variant="outlined" size="sm" color="primary" onClick={() => setManualOpen(true)} label="Add manual line" />
        </Box>
      ) : null}
      {mode === 'edit' && allowManualAdd && (!projectSourced || !manualAddCollapsed || manualOpen) ? (
        <Box sx={{ mt: 2 }}>
          <Button variant="outlined" size="sm" color="primary" startIcon={<Plus size={14} />} onClick={addManualLine}>
            Add manual line
          </Button>
        </Box>
      ) : null}
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
          {error}
        </Typography>
      )}
    </Box>
  )
}

export function computeGst(amount: number, gstRate: number): number {
  return computeLineItemTaxBreakdown(amount, 0, gstRate).gstAmount
}
