import { tokens } from '@/design-system/tokens'
import type {
  Expense,
  Reimbursement,
  VendorInvoice,
  VendorPayableControl,
  VendorPayment,
} from '@/slices/live/types'
import type { Baseline, VendorPO } from '@/slices/baseline/reducer'
import type { PitchService, VendorMilestone } from '@/slices/pitch/reducer'
import { mappingMilestonesWithRetention } from '@/utils/vendorMilestones'
import { vendorHasLinkedExpenseOnInvoice } from '@/utils/commonExpensePayables'
import { commonExpenseInvoiceDeduction } from '@/utils/commonExpenseDeduction'
import { findVendorInvoiceForMilestone } from '@/pages/Projects/tabs/live/milestonePaymentStatus'

export {
  commonExpenseVendorsNeedingInvoiceLink,
  invoiceLinksExpense,
  isCommonExpenseFullyLinkedOnInvoices,
  vendorHasLinkedExpenseOnInvoice,
} from '@/utils/commonExpensePayables'

export {
  commonExpenseAmountForVendor,
  commonExpenseInvoiceDeduction,
  isVendorIncludedInCommonRecovery,
} from '@/utils/commonExpenseDeduction'

export interface VendorServiceRow {
  vendorId: string
  vendorName: string
  serviceId: string
  serviceName: string
}

export const DEFAULT_TDS_PERCENT = 10

export const TDS_RATE_OPTIONS = [0, 1, 2, 5, 10, 20] as const

export function calcVendorInvoiceTdsAmount(baseAmount: number, tdsRate: number): number {
  return Math.round((baseAmount * tdsRate) / 100)
}

export function calcVendorInvoiceNetPayable(
  baseAmount: number,
  expenseDeductions: number,
  tdsRate: number,
  expenseAdditions = 0,
): number {
  const subtotal = baseAmount + expenseAdditions - expenseDeductions
  return Math.max(0, subtotal - calcVendorInvoiceTdsAmount(baseAmount, tdsRate))
}

/** Net payable for a vendor milestone base slice (no GST). */
export function vendorMilestoneNetPayable(baseAmount: number, tdsRate: number): number {
  return calcVendorInvoiceNetPayable(baseAmount, 0, tdsRate, 0)
}

export const TABLE_HEADER_SX = {
  fontSize: 10,
  fontWeight: 700,
  color: tokens.color.neutral[500],
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
  borderBottom: `1px solid ${tokens.color.neutral[100]}`,
  py: '10px',
  px: 2,
}

export const TABLE_CELL_SX = {
  fontSize: 12,
  borderBottom: `1px solid ${tokens.color.neutral[50]}`,
  py: '12px',
  px: 2,
}

export function vendorServiceKey(row: VendorServiceRow): string {
  return `${row.vendorId}::${row.serviceId}`
}

export function globalVendorContextKey(projectId: string, row: VendorServiceRow): string {
  return `${projectId}::${row.vendorId}::${row.serviceId}`
}

export function baselineVendorServiceRows(baseline: Baseline | null): VendorServiceRow[] {
  if (!baseline) return []
  const categories = Array.isArray(baseline.categories) ? baseline.categories : []
  const rows: VendorServiceRow[] = []
  for (const cat of categories) {
    for (const svc of cat.services ?? []) {
      for (const m of svc.vendorMappings ?? []) {
        rows.push({
          vendorId: m.vendorId,
          vendorName: m.vendorName,
          serviceId: svc.id,
          serviceName: svc.name,
        })
      }
    }
  }
  return rows.sort((a, b) => {
    const c = a.vendorName.localeCompare(b.vendorName)
    return c !== 0 ? c : a.serviceName.localeCompare(b.serviceName)
  })
}

export function invoiceMatchesRow(
  inv: VendorInvoice,
  row: VendorServiceRow,
  vendorPoId?: string,
): boolean {
  if (inv.vendorId !== row.vendorId) return false
  if (vendorPoId?.trim() && inv.vendorPoId?.trim() === vendorPoId.trim()) return true
  if (inv.serviceId === row.serviceId) return true
  return (inv.lineItems ?? []).some((li) => li.serviceId === row.serviceId)
}

export function findPitchService(baseline: Baseline | null, serviceId: string): PitchService | undefined {
  if (!baseline) return undefined
  const categories = Array.isArray(baseline.categories) ? baseline.categories : []
  for (const cat of categories) {
    const s = (cat.services ?? []).find((svc) => svc.id === serviceId)
    if (s) return s
  }
  return undefined
}

export function findVendorMapping(baseline: Baseline | null, vendorId: string, serviceId: string) {
  const svc = findPitchService(baseline, serviceId)
  return svc?.vendorMappings.find((m) => m.vendorId === vendorId)
}

export function vendorPOAppliesToServiceRow(po: VendorPO, row: VendorServiceRow): boolean {
  if (po.vendorId !== row.vendorId) return false
  const linked = po.linkedBaselineServiceIds
  if (!linked?.length) return false
  return linked.includes(row.serviceId)
}

function vendorPOMilestonesFromPOs(vendorPOs: VendorPO[], row: VendorServiceRow): VendorMilestone[] {
  return vendorPOs
    .filter((po) => vendorPOAppliesToServiceRow(po, row))
    .flatMap((po) =>
      po.milestones.map((m) => ({
        id: m.id,
        name: m.name,
        percentage: m.percentage,
        value: m.value,
      })),
    )
}

/** Vendor PO milestones take precedence; baseline mapping is the fallback. */
export function resolveVendorMilestonesForRow(
  vendorPOs: VendorPO[],
  baseline: Baseline | null,
  row: VendorServiceRow,
): VendorMilestone[] {
  const fromPO = vendorPOMilestonesFromPOs(vendorPOs, row)
  if (fromPO.length > 0) return fromPO
  const mapping = findVendorMapping(baseline, row.vendorId, row.serviceId)
  if (!mapping) return []
  return mappingMilestonesWithRetention(mapping, row.serviceId)
}

export function findInvoiceForMilestone(
  scopedInvoices: VendorInvoice[],
  vm: VendorMilestone,
  options?: { vendorPoId?: string; serviceId?: string },
): VendorInvoice | undefined {
  const invoices = options?.vendorPoId
    ? scopedInvoices.filter(
        (inv) => !inv.vendorPoId?.trim() || inv.vendorPoId === options.vendorPoId,
      )
    : scopedInvoices
  return findVendorInvoiceForMilestone(
    invoices,
    vm.id,
    options?.serviceId ?? '',
    vm.name,
  )
}

export type MilestoneRowState = 1 | 2 | 3

export function milestoneRowState(inv: VendorInvoice | undefined): MilestoneRowState {
  if (!inv) return 1
  if (inv.status === 'paid') return 3
  return 2
}

export function reimbMatchesRow(r: Reimbursement, row: VendorServiceRow): boolean {
  return r.vendorId === row.vendorId && r.serviceId === row.serviceId
}

export function vendorLinkedExpenseMatchesRow(e: Expense, row: VendorServiceRow): boolean {
  if (e.type !== 'vendor_linked') return false
  if (e.vendorId !== row.vendorId) return false
  if (e.serviceId === row.serviceId) return true
  return e.serviceId === undefined || e.serviceId === ''
}

/** Full common-expense amount reimbursed to the Paid By vendor on their invoice. */
export function commonExpenseInvoiceAddition(e: Expense, vendorId: string): number {
  if (e.type !== 'common') return 0
  if (e.paidByVendorId !== vendorId) return 0
  return Math.max(0, e.amount)
}

export type CommonExpenseExpenseRole = 'payer_credit' | 'vendor_debit'

export function commonExpenseAdjustmentsForVendor(
  e: Expense,
  vendorId: string,
  projectInvoices: VendorInvoice[] = [],
): { amount: number; role: CommonExpenseExpenseRole }[] {
  if (e.type !== 'common' || e.status === 'included_in_payment') return []
  // Still show while pending, or while partially linked across vendors (status may stay pending).
  if (e.status !== 'pending' && e.status !== 'adjusted') return []
  if (vendorHasLinkedExpenseOnInvoice(projectInvoices, vendorId, e.id)) return []
  const out: { amount: number; role: CommonExpenseExpenseRole }[] = []
  const addition = commonExpenseInvoiceAddition(e, vendorId)
  if (addition > 0) {
    out.push({ amount: -addition, role: 'payer_credit' })
  }
  const deduction = commonExpenseInvoiceDeduction(e, vendorId)
  if (deduction > 0) {
    out.push({ amount: deduction, role: 'vendor_debit' })
  }
  return out
}

/** @deprecated Prefer commonExpenseAdjustmentsForVendor — a vendor may be both payer and allocated. */
export function commonExpensePayableAmount(
  e: Expense,
  vendorId: string,
  projectInvoices: VendorInvoice[] = [],
): { amount: number; role: CommonExpenseExpenseRole } | null {
  const adj = commonExpenseAdjustmentsForVendor(e, vendorId, projectInvoices)
  if (adj.length === 0) return null
  if (adj.length === 1) return adj[0]!
  const net = adj.reduce((s, a) => s + a.amount, 0)
  if (net < 0) return { amount: net, role: 'payer_credit' }
  if (net > 0) return { amount: net, role: 'vendor_debit' }
  return null
}

export interface VendorPayableBreakdown {
  invoicePayable: number
  reimbursementPending: number
  debitedCommonExpenses: number
  commonExpenseCredit: number
  finalPayable: number
}

export function computeVendorPayableBreakdown(
  baselineForProject: Baseline | null,
  projectInvoices: VendorInvoice[],
  projectExpenses: Expense[],
  projectReimb: Reimbursement[],
  row: VendorServiceRow,
  vendorPOs: VendorPO[] = [],
): VendorPayableBreakdown {
  const scoped = projectInvoices.filter((inv) => invoiceMatchesRow(inv, row))
  const invoicePayable = scoped
    .filter((i) => i.status !== 'paid')
    .reduce((s, i) => s + i.netPayable, 0)
  const rmbs = projectReimb.filter((r) => reimbMatchesRow(r, row))
  const reimbursementPending = rmbs
    .filter((r) => r.status === 'pending')
    .reduce((s, r) => s + r.amount, 0)

  let debitedCommonExpenses = 0
  let commonExpenseCredit = 0
  for (const e of projectExpenses) {
    for (const adj of commonExpenseAdjustmentsForVendor(e, row.vendorId, projectInvoices)) {
      if (adj.role === 'payer_credit') commonExpenseCredit += Math.abs(adj.amount)
      else debitedCommonExpenses += adj.amount
    }
  }

  const counts = computeVendorCardCounts(
    baselineForProject,
    projectInvoices,
    projectExpenses,
    projectReimb,
    row,
    vendorPOs,
  )

  return {
    invoicePayable,
    reimbursementPending,
    debitedCommonExpenses,
    commonExpenseCredit,
    finalPayable: counts.outstanding,
  }
}

export function expenseRowsForVendor(
  expenses: Expense[],
  row: VendorServiceRow,
  projectInvoices: VendorInvoice[] = [],
): {
  expense: Expense
  amount: number
  kind: 'vendor_linked' | 'common'
  commonRole?: CommonExpenseExpenseRole
}[] {
  const out: {
    expense: Expense
    amount: number
    kind: 'vendor_linked' | 'common'
    commonRole?: CommonExpenseExpenseRole
  }[] = []
  for (const e of expenses) {
    if (e.status === 'included_in_payment') continue
    // Reimbursable expenses sync to Reimbursement and settle as payment additions, not deductions.
    if (e.type === 'reimbursable_expenses') continue
    if (e.type === 'vendor_linked') {
      if (e.status !== 'pending') continue
      if (vendorLinkedExpenseMatchesRow(e, row)) {
        out.push({ expense: e, amount: e.amount, kind: 'vendor_linked' })
      }
      continue
    }
    if (e.type === 'common') {
      for (const adj of commonExpenseAdjustmentsForVendor(e, row.vendorId, projectInvoices)) {
        out.push({
          expense: e,
          amount: adj.amount,
          kind: 'common',
          commonRole: adj.role,
        })
      }
    }
  }
  return out
}

/** Pending project expenses available for vendor invoice deduction (Pitch + Live). */
export function selectableProjectExpensesForInvoice(
  expenses: Expense[],
  projectId: string,
): Expense[] {
  return expenses.filter(
    (e) =>
      e.projectId === projectId &&
      e.type !== 'reimbursable_expenses' &&
      (e.status === 'pending' || (e.type === 'common' && e.status === 'adjusted')),
  )
}

export function itemsSummary(p: VendorPayment): string {
  const ni = p.linkedInvoiceIds.length
  const ne = p.linkedExpenseIds.length
  const nr = p.linkedReimbursementIds.length
  const parts: string[] = []
  if (ni) parts.push(`${ni} invoice${ni === 1 ? '' : 's'}`)
  if (ne) parts.push(`${ne} expense${ne === 1 ? '' : 's'}`)
  if (nr) parts.push(`${nr} reimbursement${nr === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : '—'
}

export interface CardCounts {
  pendingInv: number
  pendingExp: number
  pendingRmb: number
  pendingExpAmount: number
  pendingRmbAmount: number
  outstanding: number
  allSettled: boolean
  milestoneCount: number
  uninvoicedMilestones: number
  /** All baseline milestones have a vendor invoice uploaded. */
  billSubmitted: boolean
}

export type RowSettlementStatus = 'settled' | 'partially_paid' | 'payment_pending'

export type PayablePaymentStatus =
  | 'awaiting_invoice'
  | 'ready_for_payment'
  | 'partial_payment'
  | 'not_paid'
  | 'settled'

export const DEFAULT_PAYABLE_COMPLIANCE_CHECKS = {
  insurance: false,
  contractSigned: false,
  documentsSubmitted: false,
} as const

export function deriveVendorComplianceStatus(
  checks: VendorPayableControl['complianceChecks'],
): 'complete' | 'pending' {
  return checks.insurance && checks.contractSigned && checks.documentsSubmitted
    ? 'complete'
    : 'pending'
}

export function defaultPayableControl(
  projectId: string,
  row: VendorServiceRow,
): VendorPayableControl {
  return {
    projectId,
    vendorId: row.vendorId,
    serviceId: row.serviceId,
    clientPaymentReceived: false,
    vendorComplianceStatus: 'pending',
    complianceChecks: { ...DEFAULT_PAYABLE_COMPLIANCE_CHECKS },
  }
}

export function getPayableControl(
  controls: VendorPayableControl[],
  projectId: string,
  row: VendorServiceRow,
): VendorPayableControl {
  return (
    controls.find(
      (c) =>
        c.projectId === projectId &&
        c.vendorId === row.vendorId &&
        c.serviceId === row.serviceId,
    ) ?? defaultPayableControl(projectId, row)
  )
}

export function isPayableReleaseAllowed(control: VendorPayableControl): boolean {
  return control.clientPaymentReceived && control.vendorComplianceStatus === 'complete'
}

/** Map a recorded vendor payment outcome onto invoice status. */
export function invoiceStatusFromPaymentStatus(
  paymentStatus: VendorPayment['status'],
): VendorInvoice['status'] {
  if (paymentStatus === 'completed') return 'paid'
  if (paymentStatus === 'partial') return 'partially_paid'
  return 'not_paid'
}

export function computePayablePaymentStatus(
  counts: CardCounts,
  _control?: VendorPayableControl,
): PayablePaymentStatus {
  if (counts.allSettled) return 'settled'
  if (counts.pendingInv > 0 || counts.billSubmitted) return 'not_paid'
  return 'awaiting_invoice'
}

export function payableStatusLabel(status: PayablePaymentStatus): string {
  switch (status) {
    case 'settled':
      return 'Payment done'
    case 'partial_payment':
      return 'Partial payment done'
    case 'not_paid':
    case 'ready_for_payment':
      return 'Not paid'
    case 'awaiting_invoice':
      return 'Not paid'
  }
}

export function invoiceUploadedLabel(inv: VendorInvoice | undefined): 'Uploaded' | 'Pending' {
  return inv ? 'Uploaded' : 'Pending'
}

/** Prefer explicit invoice date; fall back to upload timestamp for display. */
export function resolveVendorInvoiceDisplayDate(
  invoice?: Pick<VendorInvoice, 'invoiceDate' | 'uploadedAt'> | null,
  fallbackDate?: string | null,
): string {
  for (const value of [invoice?.invoiceDate, invoice?.uploadedAt, fallbackDate]) {
    if (typeof value !== 'string' || !value.trim()) continue
    const trimmed = value.trim()
    const day = trimmed.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
    return trimmed
  }
  return ''
}

export function vendorInvoiceDocumentFileName(inv: VendorInvoice): string | null {
  if (inv.fileName?.trim()) return inv.fileName.trim()
  if (!inv.documentUrl) return null
  if (inv.documentUrl.startsWith('local://')) {
    return inv.documentUrl.slice('local://'.length) || null
  }
  try {
    const path = new URL(inv.documentUrl).pathname
    const name = path.split('/').pop()
    return name || inv.documentUrl
  } catch {
    return inv.documentUrl
  }
}

export function vendorInvoiceDocumentOpenUrl(documentUrl: string): string | null {
  if (documentUrl.startsWith('local://')) return null
  return documentUrl
}

export function clientPaymentLabel(control: VendorPayableControl): 'Received' | 'Waiting' {
  return control.clientPaymentReceived ? 'Received' : 'Waiting'
}

export function complianceDisplayLabel(control: VendorPayableControl): 'Complete' | 'Pending' {
  return control.vendorComplianceStatus === 'complete' ? 'Complete' : 'Pending'
}

export function computeMilestonePayableStatus(
  inv: VendorInvoice | undefined,
  _control?: VendorPayableControl,
): PayablePaymentStatus {
  if (!inv) return 'awaiting_invoice'
  const status = String(inv.status ?? '').trim().toLowerCase()
  if (status === 'paid' || status === 'settled') return 'settled'
  if (status === 'partially_paid' || status === 'partial_payment' || status === 'partial') {
    return 'partial_payment'
  }
  return 'not_paid'
}

export interface VendorMilestoneEntry {
  projectId: string
  projectName: string
  row: VendorServiceRow
  milestone: VendorMilestone
}

export function globalMilestoneContextKey(entry: VendorMilestoneEntry): string {
  return `${entry.projectId}::${entry.row.vendorId}::${entry.row.serviceId}::${entry.milestone.id}`
}

export function milestoneEntryKey(entry: VendorMilestoneEntry): string {
  return `${entry.projectId}::${entry.row.vendorId}::${entry.row.serviceId}::${entry.milestone.id}`
}

function sortMilestoneEntries(entries: VendorMilestoneEntry[]): VendorMilestoneEntry[] {
  return [...entries].sort((a, b) => {
    const v = a.row.vendorName.localeCompare(b.row.vendorName)
    if (v !== 0) return v
    const s = a.row.serviceName.localeCompare(b.row.serviceName)
    if (s !== 0) return s
    return a.milestone.name.localeCompare(b.milestone.name)
  })
}

export function baselineVendorMilestoneEntries(
  projectId: string,
  projectName: string,
  baseline: Baseline | null,
): VendorMilestoneEntry[] {
  const out: VendorMilestoneEntry[] = []
  for (const row of baselineVendorServiceRows(baseline)) {
    const mapping = findVendorMapping(baseline, row.vendorId, row.serviceId)
    if (!mapping) continue
    for (const milestone of mappingMilestonesWithRetention(mapping, row.serviceId)) {
      out.push({ projectId, projectName, row, milestone })
    }
  }
  return sortMilestoneEntries(out)
}

export function vendorPOVendorMilestoneEntries(
  projectId: string,
  projectName: string,
  vendorPOs: VendorPO[],
  baseline: Baseline | null,
): VendorMilestoneEntry[] {
  const out: VendorMilestoneEntry[] = []
  const projectPOs = vendorPOs.filter((po) => po.projectId === projectId)
  for (const row of baselineVendorServiceRows(baseline)) {
    for (const milestone of vendorPOMilestonesFromPOs(projectPOs, row)) {
      out.push({ projectId, projectName, row, milestone })
    }
  }
  return sortMilestoneEntries(out)
}

/** Build listing rows from vendor invoices when baseline milestones are unavailable. */
export function vendorInvoiceMilestoneEntries(
  projectId: string,
  projectName: string,
  invoices: VendorInvoice[],
): VendorMilestoneEntry[] {
  const out: VendorMilestoneEntry[] = []
  const seen = new Set<string>()
  for (const inv of invoices) {
    if (inv.projectId !== projectId) continue
    const lines =
      inv.lineItems && inv.lineItems.length > 0
        ? inv.lineItems
        : [
            {
              milestoneId: inv.milestoneId,
              milestoneName: inv.milestoneName,
              serviceId: inv.serviceId,
              serviceName: inv.serviceName,
              amount: inv.baseAmount,
            },
          ]
    for (const li of lines) {
      const milestoneId = li.milestoneId || inv.milestoneId || inv.id
      const row: VendorServiceRow = {
        vendorId: inv.vendorId,
        vendorName: inv.vendorName,
        serviceId: li.serviceId || inv.serviceId,
        serviceName: li.serviceName || inv.serviceName,
      }
      const milestone: VendorMilestone = {
        id: milestoneId,
        name: li.milestoneName || inv.milestoneName || 'Milestone',
        percentage: 0,
        value: Number(li.amount ?? inv.baseAmount ?? 0) || 0,
      }
      const entry: VendorMilestoneEntry = { projectId, projectName, row, milestone }
      const key = milestoneEntryKey(entry)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return sortMilestoneEntries(out)
}

export function mergeMilestoneEntries(
  baselineEntries: VendorMilestoneEntry[],
  invoiceEntries: VendorMilestoneEntry[],
): VendorMilestoneEntry[] {
  const map = new Map<string, VendorMilestoneEntry>()
  for (const e of baselineEntries) map.set(milestoneEntryKey(e), e)
  for (const e of invoiceEntries) {
    if (!map.has(milestoneEntryKey(e))) map.set(milestoneEntryKey(e), e)
  }
  return sortMilestoneEntries([...map.values()])
}

export function mergeMilestoneEntriesWithVendorPO(
  vendorPOEntries: VendorMilestoneEntry[],
  baselineEntries: VendorMilestoneEntry[],
  invoiceEntries: VendorMilestoneEntry[],
): VendorMilestoneEntry[] {
  const map = new Map<string, VendorMilestoneEntry>()
  for (const e of vendorPOEntries) map.set(milestoneEntryKey(e), e)
  for (const e of baselineEntries) {
    if (!map.has(milestoneEntryKey(e))) map.set(milestoneEntryKey(e), e)
  }
  for (const e of invoiceEntries) {
    if (!map.has(milestoneEntryKey(e))) map.set(milestoneEntryKey(e), e)
  }
  return sortMilestoneEntries([...map.values()])
}

export function payableStatusBadgeColor(
  status: PayablePaymentStatus,
): 'success' | 'warning' | 'info' | 'neutral' | 'error' {
  if (status === 'settled') return 'success'
  if (status === 'partial_payment') return 'warning'
  if (status === 'not_paid' || status === 'ready_for_payment') return 'error'
  return 'neutral'
}

export function billSubmittedLabel(counts: CardCounts): string {
  if (counts.milestoneCount === 0) return '—'
  if (counts.billSubmitted) return 'Yes'
  if (counts.uninvoicedMilestones === counts.milestoneCount) return 'No'
  return 'Partial'
}

export function paymentTouchesRow(
  payment: VendorPayment,
  projectId: string,
  row: VendorServiceRow,
  vendorInvoices: VendorInvoice[],
  expenses: Expense[],
  reimbursements: Reimbursement[],
): boolean {
  if (payment.projectId !== projectId || payment.vendorId !== row.vendorId) return false

  for (const id of payment.linkedInvoiceIds) {
    const inv = vendorInvoices.find((i) => i.id === id)
    if (inv && invoiceMatchesRow(inv, row)) return true
  }

  for (const id of payment.linkedExpenseIds) {
    const e = expenses.find((x) => x.id === id)
    if (!e || e.projectId !== projectId) continue
    if (expenseRowsForVendor([e], row, vendorInvoices).length > 0) return true
  }

  for (const id of payment.linkedReimbursementIds) {
    const r = reimbursements.find((x) => x.id === id)
    if (r && reimbMatchesRow(r, row)) return true
  }

  return false
}

export function rowSettlementStatus(
  counts: CardCounts,
  projectId: string,
  row: VendorServiceRow,
  payments: VendorPayment[],
  vendorInvoices: VendorInvoice[],
  expenses: Expense[],
  reimbursements: Reimbursement[],
): RowSettlementStatus {
  if (counts.allSettled) return 'settled'
  const touched = payments.some((p) =>
    paymentTouchesRow(p, projectId, row, vendorInvoices, expenses, reimbursements),
  )
  if (touched) return 'partially_paid'
  return 'payment_pending'
}

export function computeVendorCardCounts(
  baselineForProject: Baseline | null,
  projectInvoices: VendorInvoice[],
  projectExpenses: Expense[],
  projectReimb: Reimbursement[],
  row: VendorServiceRow,
  vendorPOs: VendorPO[] = [],
): CardCounts {
  const milestones = resolveVendorMilestonesForRow(vendorPOs, baselineForProject, row)
  const scoped = projectInvoices.filter((inv) => invoiceMatchesRow(inv, row))
  let uninvoicedM = 0
  let pendingInv = 0
  for (const vm of milestones) {
    const inv = findInvoiceForMilestone(scoped, vm)
    if (!inv) uninvoicedM += 1
    else if (inv.status !== 'paid') pendingInv += 1
  }
  const exRows = expenseRowsForVendor(projectExpenses, row, projectInvoices)
  const pendingExp = exRows.length
  const rmbs = projectReimb.filter((r) => reimbMatchesRow(r, row))
  const pendingRmb = rmbs.filter((r) => r.status === 'pending').length
  const invNet = scoped.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.netPayable, 0)
  const rmbSum = rmbs.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amount, 0)
  const expSum = exRows.reduce((s, x) => s + x.amount, 0)
  const outstanding = Math.max(0, invNet + rmbSum - expSum)
  const milestoneCount = milestones.length
  const allSettled =
    uninvoicedM === 0 && pendingInv === 0 && pendingExp === 0 && pendingRmb === 0
  const billSubmitted = milestoneCount > 0 && uninvoicedM === 0
  return {
    pendingInv,
    pendingExp,
    pendingRmb,
    pendingExpAmount: expSum,
    pendingRmbAmount: rmbSum,
    outstanding,
    allSettled,
    milestoneCount,
    uninvoicedMilestones: uninvoicedM,
    billSubmitted,
  }
}
