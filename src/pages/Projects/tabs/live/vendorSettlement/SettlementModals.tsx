import { Divider, Stack, Typography } from '@mui/material'
import { Modal } from '@/design-system/components'
import type { Expense, VendorInvoice, VendorPayment } from '@/slices/live/types'
import { formatCurrency, formatDate } from '@/utils/formatters'
import { itemsSummary, resolveVendorInvoiceDisplayDate } from './utils'

export function VendorInvoiceDetailModal({
  open,
  invoice,
  expenses = [],
  onClose,
}: {
  open: boolean
  invoice: VendorInvoice | null
  expenses?: Expense[]
  onClose: () => void
}) {
  if (!invoice) return null

  const linkedExpenses = (invoice.linkedExpenseIds ?? [])
    .map((id) => expenses.find((e) => e.id === id))
    .filter((e): e is Expense => Boolean(e))

  return (
    <Modal open={open} onClose={onClose} title="Vendor invoice" size="sm">
      <Stack gap={1} sx={{ py: 1 }}>
        <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
          {invoice.invoiceNumber}
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          Milestone: {invoice.milestoneName}
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          Date: {formatDate(resolveVendorInvoiceDisplayDate(invoice))}
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          Invoice amount: ₹{formatCurrency(invoice.baseAmount)}
        </Typography>
        {invoice.gstAmount != null && invoice.gstAmount > 0 ? (
          <Typography variant="body2" sx={{ fontSize: 12 }}>
            GST ({invoice.gstRate ?? 0}%): ₹{formatCurrency(invoice.gstAmount)}
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ fontSize: 12 }}>
          TDS ({invoice.tdsRate}%): ₹{formatCurrency(invoice.tdsAmount)}
        </Typography>
        {(invoice.expenseDeductions ?? 0) > 0 ? (
          <>
            <Divider sx={{ my: 0.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              Linked expenses
            </Typography>
            {linkedExpenses.map((exp) => (
              <Typography key={exp.id} variant="body2" sx={{ fontSize: 12 }}>
                {exp.description} · −₹{formatCurrency(exp.amount)}
              </Typography>
            ))}
            <Typography variant="body2" sx={{ fontSize: 12 }}>
              Total deductions: ₹{formatCurrency(invoice.expenseDeductions ?? 0)}
            </Typography>
          </>
        ) : null}
        <Divider sx={{ my: 0.5 }} />
        <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
          Net payable: ₹{formatCurrency(invoice.netPayable)}
        </Typography>
      </Stack>
    </Modal>
  )
}

export function PaymentDetailModal({
  open,
  payment,
  onClose,
}: {
  open: boolean
  payment: VendorPayment | null
  onClose: () => void
}) {
  if (!payment) return null
  return (
    <Modal open={open} onClose={onClose} title="Payment details" size="sm">
      <Stack gap={1.5} sx={{ py: 1 }}>
        <Typography variant="body2" sx={{ fontSize: 13 }}>
          <strong>{payment.vendorName}</strong>
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
          Date: {formatDate(payment.paymentDate)}
        </Typography>
        <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
          Reference: {payment.referenceNumber ?? '—'}
        </Typography>
        <Divider sx={{ my: 1 }} />
        <Stack gap={0.5}>
          <Typography variant="body2" sx={{ fontSize: 12 }}>
            Invoice total: ₹{formatCurrency(payment.invoiceTotal)}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: 12 }}>
            Expense deductions: ₹{formatCurrency(payment.expenseDeductions)}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: 12 }}>
            TDS (on invoices): ₹{formatCurrency(payment.tdsDeducted)}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: 12 }}>
            Reimbursements: ₹{formatCurrency(payment.reimbursementAdditions)}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700, mt: 1 }}>
            Net paid: ₹{formatCurrency(payment.netPaid)}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {itemsSummary(payment)}
        </Typography>
      </Stack>
    </Modal>
  )
}
