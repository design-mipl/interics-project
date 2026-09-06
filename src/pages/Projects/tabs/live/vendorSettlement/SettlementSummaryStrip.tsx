import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { Banknote, CircleCheck, Clock } from 'lucide-react'
import { KpiStatCard } from '@/components/templates/KpiStatCard'
import type { VendorPO } from '@/slices/baseline/reducer'
import type { VendorPayment } from '@/slices/live/reducer'
import { formatInr } from '@/utils/formatters'
import {
  computePayableSummaryKpis,
  type PayableSummaryKpis,
} from '@/pages/Finance/utils/payableSummary'

export function SettlementSummaryStrip({
  kpis: kpisProp,
  vendorPOs,
  payments,
  loading = false,
}: {
  /** Prefer server summary from GET /finance/payables/summary. */
  kpis?: PayableSummaryKpis | null
  vendorPOs?: VendorPO[]
  payments?: VendorPayment[]
  /** Per-card value loader while summary is fetching. */
  loading?: boolean
}) {
  const kpis =
    kpisProp ??
    (loading
      ? { totalVendorPoValue: 0, paidTillDate: 0, pendingPayment: 0 }
      : computePayableSummaryKpis(vendorPOs ?? [], payments ?? []))

  const metrics: {
    label: string
    value: string
    variant: 'default' | 'success' | 'warning'
    icon: ReactNode
  }[] = [
    {
      label: 'Total Vendor Offer',
      value: `₹${formatInr(kpis.totalVendorPoValue)}`,
      variant: 'default',
      icon: <Banknote size={24} strokeWidth={1.75} />,
    },
    {
      label: 'Paid Till Date',
      value: `₹${formatInr(kpis.paidTillDate)}`,
      variant: 'success',
      icon: <CircleCheck size={24} strokeWidth={1.75} />,
    },
    {
      label: 'Remaining',
      value: `₹${formatInr(kpis.pendingPayment)}`,
      variant: 'warning',
      icon: <Clock size={24} strokeWidth={1.75} />,
    },
  ]

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        gap: 2,
        mb: 2,
      }}
    >
      {metrics.map((m) => (
        <KpiStatCard
          key={m.label}
          label={m.label}
          value={m.value}
          variant={m.variant}
          icon={m.icon}
          loading={loading}
        />
      ))}
    </Box>
  )
}
