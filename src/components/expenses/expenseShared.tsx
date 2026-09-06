import type { ReactNode } from 'react'
import {
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { FileText } from 'lucide-react'
import { Modal, StatusBadge, Button, useToast } from '@/design-system/components'
import type { StatusType } from '@/design-system/components'
import {
  downloadAuthenticatedDocument,
  openAuthenticatedDocument,
} from '@/utils/openAuthenticatedDocument'
import {
  expenseDocumentDisplayName,
  expenseDocumentViewUrl,
  isExpenseDocumentDownloadable,
  isExpenseDocumentLocalOnly,
} from '@/components/expenses/expenseDocumentUtils'
import { tokens, TREND_COLORS } from '@/design-system/tokens'
import type { CommonExpenseSplitMethod, Expense, ExpenseType } from '@/slices/live/types'
import { formatCurrency, formatDate } from '@/utils/formatters'

const FIELD_LABEL_COLOR = TREND_COLORS.neutral.color

const SECTION_TITLE_SX = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.8px',
  color: FIELD_LABEL_COLOR,
  textTransform: 'uppercase' as const,
  display: 'block',
  mb: 1,
} as const

const ALLOCATION_HEADER_SX = {
  fontSize: 10,
  fontWeight: 700,
  color: tokens.color.neutral[500],
  letterSpacing: 0.5,
  py: 0.75,
  px: 1.25,
  borderBottom: `1px solid ${tokens.color.neutral[100]}`,
} as const

const ALLOCATION_CELL_SX = {
  fontSize: 12,
  py: 0.75,
  px: 1.25,
  borderBottom: `1px solid ${tokens.color.neutral[50]}`,
  verticalAlign: 'middle' as const,
} as const

export function expenseStatusDisplay(
  status: Expense['status'],
): { status: StatusType; label: string } {
  switch (status) {
    case 'pending':
      return { status: 'pending', label: 'Pending' }
    case 'adjusted':
      return { status: 'adjusted', label: 'Adjusted' }
    case 'included_in_payment':
      return { status: 'included_in_payment', label: 'Included in Payment' }
  }
}

export function ExpenseTypeBadge({ type }: { type: ExpenseType }) {
  switch (type) {
    case 'additional':
      return <StatusBadge status="additional" size="small" />
    case 'vendor_linked':
      return <StatusBadge status="vendor_linked" size="small" />
    case 'common':
      return <StatusBadge status="common" size="small" />
    case 'office_expenses':
      return <StatusBadge status="draft" label="Office Expenses" size="small" />
    case 'reimbursable_expenses':
      return <StatusBadge status="sent" label="Reimbursable Expenses" size="small" />
  }
}

export function expenseTypeFilterLabel(type: string): string {
  switch (type) {
    case 'additional':
      return 'Additional'
    case 'vendor_linked':
      return 'Vendor Linked'
    case 'common':
      return 'Common'
    case 'office_expenses':
      return 'Office Expenses'
    case 'reimbursable_expenses':
      return 'Reimbursable Expenses'
    default:
      return type
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
  }
}

export function expenseVendorCell(e: Expense): string {
  if (e.type === 'additional' || e.type === 'office_expenses') return '—'
  if (e.type === 'vendor_linked' || e.type === 'reimbursable_expenses') return e.vendorName?.trim() || '—'
  const n = e.vendorAllocations?.length ?? 0
  return n === 0 ? '—' : `${n} vendors`
}

function expenseServiceLabel(e: Expense): string {
  const extra = e as Expense & { service?: unknown }
  const fromName = e.serviceName?.trim()
  const fromService = typeof extra.service === 'string' ? extra.service.trim() : ''
  return fromName || fromService || ''
}

export function expenseServiceCell(e: Expense): string {
  return expenseServiceLabel(e) || '—'
}

function splitMethodLabel(method?: CommonExpenseSplitMethod): string {
  if (!method) return '—'
  return method === 'equal' ? 'Equal Split' : 'Proportional by PO Value'
}

function expenseVendorServiceDetail(expense: Expense): string {
  if (expense.type === 'vendor_linked' || expense.type === 'reimbursable_expenses') {
    return `${expense.vendorName?.trim() || '—'} · ${expenseServiceLabel(expense) || '—'}`
  }
  if (expense.type === 'common') {
    const count = expense.vendorAllocations?.length ?? 0
    return count === 0 ? '—' : `${count} vendors (common split)`
  }
  return '—'
}

export {
  expenseDocumentDisplayName,
  expenseDocumentViewUrl,
  isExpenseDocumentDownloadable,
  isExpenseDocumentLocalOnly,
} from '@/components/expenses/expenseDocumentUtils'

function DetailField({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ fontSize: 11, display: 'block', color: FIELD_LABEL_COLOR }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontSize: 13,
          fontWeight: 500,
          mt: 0.25,
          color: value === '—' ? 'text.secondary' : 'text.primary',
          ...(multiline ? { whiteSpace: 'pre-wrap' as const } : {}),
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

function ExpenseSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography component="span" variant="overline" sx={SECTION_TITLE_SX}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

export function ExpenseSummaryStrip({
  expenses,
  summary,
}: {
  expenses?: Expense[]
  summary?: {
    total: number
    additional: number
    vendorLinked: number
    common: number
  } | null
}) {
  const total = summary?.total ?? expenses?.reduce((s, e) => s + e.amount, 0) ?? 0
  const additional =
    summary?.additional ??
    expenses?.filter((e) => e.type === 'additional').reduce((s, e) => s + e.amount, 0) ??
    0
  const vendorLinked =
    summary?.vendorLinked ??
    expenses?.filter((e) => e.type === 'vendor_linked').reduce((s, e) => s + e.amount, 0) ??
    0
  const common =
    summary?.common ??
    expenses?.filter((e) => e.type === 'common').reduce((s, e) => s + e.amount, 0) ??
    0

  const metrics = [
    { label: 'Total Expenses', value: total },
    { label: 'Additional', value: additional },
    { label: 'Vendor Linked', value: vendorLinked },
    { label: 'Common', value: common },
  ]

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
        gap: 2,
        mb: 2,
      }}
    >
      {metrics.map((m) => (
        <Box
          key={m.label}
          sx={{
            p: 2,
            border: `1px solid ${tokens.color.neutral[100]}`,
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Typography
            variant="overline"
            sx={{ fontSize: 10, color: 'text.secondary', display: 'block', letterSpacing: 0.6 }}
          >
            {m.label}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 15, mt: 0.5 }}>
            ₹{formatCurrency(m.value)}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export function ViewExpenseModal({
  open,
  expense,
  onClose,
  projectName,
}: {
  open: boolean
  expense: Expense | null
  onClose: () => void
  /** When set (e.g. global expenses page), shown in details */
  projectName?: string
}) {
  const { showToast } = useToast()
  if (!expense) return null

  const locked = expense.status === 'included_in_payment' || expense.status === 'adjusted'
  const statusDisplay = expenseStatusDisplay(expense.status)
  const documentName = expenseDocumentDisplayName(expense.documentUrl)
  const documentViewUrl = expenseDocumentViewUrl(expense.documentUrl)
  const documentDownloadable = isExpenseDocumentDownloadable(expense.documentUrl)
  const documentLocalOnly = isExpenseDocumentLocalOnly(expense.documentUrl)
  const showVendorService =
    expense.type === 'vendor_linked' ||
    expense.type === 'reimbursable_expenses' ||
    expense.type === 'common'
  const showPaidByOrSplit = expense.type === 'common'
  const milestoneLabel = expense.milestoneName ?? expense.milestoneId ?? null
  const allocationRows = expense.vendorAllocations ?? []

  return (
    <Modal open={open} onClose={onClose} title="Expense details" size="sm">
      <Stack gap={1.25} sx={{ py: 0 }}>
        {locked ? (
          <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.45 }}>
            This expense is included in a payment run and cannot be edited.
          </Typography>
        ) : null}

        <Box
          sx={{
            border: `1px solid ${tokens.color.neutral[100]}`,
            borderRadius: 2,
            bgcolor: tokens.color.neutral[50],
            p: 1.5,
          }}
        >
          <Typography
            variant="body1"
            sx={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              color: 'text.primary',
              mb: 1,
            }}
          >
            {expense.description}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 1.25,
            }}
          >
            <Box>
              <Typography variant="caption" sx={{ fontSize: 11, display: 'block', color: FIELD_LABEL_COLOR }}>
                Amount
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 14, fontWeight: 700, mt: 0.25 }}>
                ₹{formatCurrency(expense.amount)}
              </Typography>
            </Box>
            <DetailField label="Date" value={formatDate(expense.date)} />
            <Box>
              <Typography variant="caption" sx={{ fontSize: 11, display: 'block', color: FIELD_LABEL_COLOR }}>
                Status
              </Typography>
              <Box sx={{ mt: 0.25 }}>
                <StatusBadge status={statusDisplay.status} label={statusDisplay.label} size="small" />
              </Box>
            </Box>
          </Box>
        </Box>

        <ExpenseSection title="Expense Information">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 1.25,
              rowGap: 1,
            }}
          >
            {projectName != null && projectName !== '' ? (
              <DetailField label="Project" value={projectName} />
            ) : null}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ fontSize: 11, display: 'block', color: FIELD_LABEL_COLOR }}>
                Document
              </Typography>
              {documentName && documentDownloadable ? (
                <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                  <Box sx={{ color: tokens.color.primary[500], flexShrink: 0, display: 'flex' }}>
                    <FileText size={16} strokeWidth={2} color={tokens.color.primary[500]} />
                  </Box>
                  <Typography
                    variant="body2"
                    title={documentName}
                    sx={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'text.primary',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {documentName}
                  </Typography>
                  <Button
                    variant="text"
                    color="primary"
                    size="sm"
                    label="View"
                    onClick={() => {
                      void openAuthenticatedDocument(documentViewUrl!, () => {
                        showToast({ title: 'Failed to open document', variant: 'error' })
                      })
                    }}
                  />
                  <Button
                    variant="text"
                    color="primary"
                    size="sm"
                    label="Download"
                    onClick={() => {
                      void downloadAuthenticatedDocument(documentViewUrl!, documentName ?? undefined, () => {
                        showToast({ title: 'Failed to download document', variant: 'error' })
                      })
                    }}
                  />
                </Stack>
              ) : documentName ? (
                <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0, mt: 0.25 }}>
                  <Box sx={{ color: tokens.color.neutral[400], flexShrink: 0, display: 'flex' }}>
                    <FileText size={16} strokeWidth={2} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      title={documentName}
                      sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'text.primary',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {documentName}
                    </Typography>
                    {documentLocalOnly ? (
                      <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', display: 'block' }}>
                        Document unavailable — file was not uploaded to storage.
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
                  No document uploaded.
                </Typography>
              )}
            </Box>
            {showPaidByOrSplit ? (
              <DetailField label="Paid By" value={expense.paidByVendorName ?? '—'} />
            ) : null}
            {showPaidByOrSplit ? (
              <DetailField label="Split Method" value={splitMethodLabel(expense.splitMethod)} />
            ) : null}
            {showVendorService ? (
              <DetailField label="Vendor / Service" value={expenseVendorServiceDetail(expense)} />
            ) : null}
            {milestoneLabel ? (
              <DetailField label="Milestone (reference)" value={milestoneLabel} />
            ) : null}
          </Box>
        </ExpenseSection>

        {expense.type === 'common' && allocationRows.length > 0 ? (
          <ExpenseSection title="Allocation">
            <Box
              sx={{
                border: `1px solid ${tokens.color.neutral[100]}`,
                borderRadius: 2,
                overflow: 'hidden',
                bgcolor: 'background.paper',
              }}
            >
              <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '30%' }} />
                </colgroup>
                <TableHead>
                  <TableRow sx={{ bgcolor: tokens.color.neutral[50] }}>
                    <TableCell sx={ALLOCATION_HEADER_SX}>Allocated</TableCell>
                    <TableCell sx={ALLOCATION_HEADER_SX}>Vendor</TableCell>
                    <TableCell align="right" sx={ALLOCATION_HEADER_SX}>
                      PO Ratio (%)
                    </TableCell>
                    <TableCell align="right" sx={ALLOCATION_HEADER_SX}>
                      Expense Share
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allocationRows.map((row) => {
                    const included = row.includedInRecovery !== false
                    return (
                      <TableRow key={row.vendorId} hover sx={{ opacity: included ? 1 : 0.65 }}>
                        <TableCell sx={ALLOCATION_CELL_SX}>
                          <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                            {included ? 'Yes' : 'No'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={ALLOCATION_CELL_SX}>
                          <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                            {row.vendorName}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={ALLOCATION_CELL_SX}>
                          {row.allocationPercent}%
                        </TableCell>
                        <TableCell align="right" sx={{ ...ALLOCATION_CELL_SX, fontWeight: 600 }}>
                          ₹{formatCurrency(row.allocationAmount)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          </ExpenseSection>
        ) : null}
      </Stack>
    </Modal>
  )
}
