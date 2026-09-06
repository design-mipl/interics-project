/**
 * Dashboard Revenue tab.
 * KPI cards, detail drawer, filters, and revenue charts are kept together.
 */
import { useEffect, useMemo, useState, type ReactNode, useCallback } from 'react'
import {
  Box,
  Drawer,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select as MuiSelect,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  HandCoins,
  IndianRupee,
  PlayCircle,
  Timer,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import {
  BarChart,
  ChartCard,
  SearchInput,
  StatusBadge,
  isoFromDate,
} from '@/design-system/components'
import type { StatusType } from '@/design-system/components'
import { CHART_COLORS, tokens } from '@/design-system/tokens'
import {
  clampListingPage0Based,
  formatListingShowingLabel,
} from '@/components/listing/listingStandards'
import { FilterableHeaderCell } from '@/components/listing/FilterableSortHeader'
import client from '@/api/client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import { formatCurrency } from '@/utils/formatters'
import { DashboardDateRangeFilter } from '../DashboardDateRangeFilter'
import {
  type DashboardDatePeriod,
  type DashboardDateRange,
} from '../dashboardDateRange'
import { useDashboardReload } from '../useDashboardReload'
import { DashboardKpiCardSkeleton, DashboardSectionLoader } from '../DashboardTabLoader'

interface ChartSeriesLegendItem {
  label: string
  color: string
}

function ChartSeriesLegend({ items }: { items: ChartSeriesLegendItem[] }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 1.5,
      }}
    >
      {items.map((item) => (
        <Box key={item.label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '2px',
              bgcolor: item.color,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: 1.2 }}
          >
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export const DASHBOARD_FILTER_OPTIONS = {
  financialYears: [],
  projects: [],
  clients: [],
  sectors: [],
  projectManagers: [],
} as const

export const REVENUE_TIME_PERIOD_OPTIONS = [
  'This Month',
  'Last 6 Months',
  'This Financial Year',
  'Custom Range',
] as const

export type RevenueTimePeriod = (typeof REVENUE_TIME_PERIOD_OPTIONS)[number]

export const REVENUE_DATE_TYPE_OPTIONS = [
  'PO Date',
  'Invoice Date',
  'Payment Received Date',
] as const

export type RevenueDateType = (typeof REVENUE_DATE_TYPE_OPTIONS)[number]

export type RevenueChartGranularity = 'daily' | 'monthly' | 'yearly'

export interface RevenueKpi {
  id: string
  title: string
  value: number
  subtitle: string
  icon: 'po' | 'live' | 'received' | 'pending' | 'paid' | 'payable' | 'cash' | 'profit'
}

export interface RevenueChartPoint {
  month: string
  revenue?: number
  /** Actual client payments received (cash collections). */
  clientReceived?: number
  /** Actual payments released to vendors. */
  vendorPaid?: number
}

export interface RevenueAnalyticsBundle {
  kpis: RevenueKpi[]
  revenueTrend: RevenueChartPoint[]
  /** Combined month-wise Client Revenue Received vs Vendor Payments. */
  clientReceivedVsVendorPayments: RevenueChartPoint[]
  granularity: RevenueChartGranularity
}

type RevenueDrawerRow = Record<string, string | number>
type RevenueKpiBreakdowns = Record<string, RevenueDrawerRow[]>

export interface RevenueProjectListingRow {
  id: string
  projectName: string
  projectValue: number
  projectSize: number
  teamLead: string
  clientPOAmount: number
  vendorPOAmount: number
  clientReceived: number
  vendorPaid: number
  status: string
}

interface RevenueDashboardResponse {
  kpis: RevenueKpi[]
  charts?: RevenueDashboardChart[]
  data?: {
    kpiBreakdowns?: RevenueKpiBreakdowns
    revenueProjects?: RevenueProjectListingRow[]
  }
}

interface RevenueDashboardChart {
  id: string
  data?: Array<Record<string, unknown>>
}

/** Profit = Amount Received - Amount Paid to Vendors. */
export function computeRevenueProfit(params: {
  amountReceived: number
  amountPaidToVendors: number
}): number {
  return Math.round(params.amountReceived - params.amountPaidToVendors)
}

const BASE_REVENUE_KPI_VALUES = {
  totalPo: 0,
  livePo: 0,
  received: 0,
  pendingClaim: 0,
  clientPending: 0,
  paidVendors: 0,
  payable: 0,
  vendorPending: 0,
  inHand: 0,
} as const

function buildBaseRevenueKpis(factor: number): RevenueKpi[] {
  const totalPo = scale(BASE_REVENUE_KPI_VALUES.totalPo, factor)
  const received = scale(BASE_REVENUE_KPI_VALUES.received, factor)
  const clientPending = Math.max(
    0,
    scale(BASE_REVENUE_KPI_VALUES.clientPending, factor) || totalPo - received,
  )
  const paidVendors = scale(BASE_REVENUE_KPI_VALUES.paidVendors, factor)
  const payable = scale(BASE_REVENUE_KPI_VALUES.payable, factor)
  const vendorPending = Math.max(
    0,
    scale(BASE_REVENUE_KPI_VALUES.vendorPending, factor) || payable - paidVendors,
  )
  const inHand = scale(BASE_REVENUE_KPI_VALUES.inHand, factor)
  const profit = computeRevenueProfit({
    amountReceived: received,
    amountPaidToVendors: paidVendors,
  })

  return [
    {
      id: 'total-po',
      title: 'Total PO Value',
      value: totalPo,
      subtitle: 'Total business received.',
      icon: 'po',
    },
    {
      id: 'live-po',
      title: 'Live PO Value',
      value: scale(BASE_REVENUE_KPI_VALUES.livePo, factor),
      subtitle: 'Current active project value.',
      icon: 'live',
    },
    {
      id: 'received',
      title: 'Amount Received',
      value: received,
      subtitle: 'Payments collected.',
      icon: 'received',
    },
    {
      id: 'pending-claim',
      title: 'Invoice Receivable',
      value: scale(BASE_REVENUE_KPI_VALUES.pendingClaim, factor),
      subtitle: 'Awaiting client payment.',
      icon: 'pending',
    },
    {
      id: 'client-pending',
      title: 'Client Pending',
      value: clientPending,
      subtitle: 'Client PO value pending after received payments.',
      icon: 'pending',
    },
    {
      id: 'paid-vendors',
      title: 'Amount Paid to Vendors',
      value: paidVendors,
      subtitle: 'Payments released.',
      icon: 'paid',
    },
    {
      id: 'payable',
      title: 'Amount Payable',
      value: payable,
      subtitle: 'Outstanding vendor dues.',
      icon: 'payable',
    },
    {
      id: 'vendor-pending',
      title: 'Vendor Pending',
      value: vendorPending,
      subtitle: 'Vendor PO value pending after vendor payments.',
      icon: 'payable',
    },
    {
      id: 'in-hand',
      title: 'Amount in Hand',
      value: inHand,
      subtitle: 'Current available balance.',
      icon: 'cash',
    },
    {
      id: 'profit',
      title: 'Profit',
      value: profit,
      subtitle: 'Net profit after vendor payments and expenses.',
      icon: 'profit',
    },
  ]
}

/** Prefer getRevenueAnalytics — kept for existing imports. */
export const REVENUE_KPIS = buildBaseRevenueKpis(1)

const FY_MONTHS: string[] = []

/** Revenue grouped by client PO date. */
const BASE_REVENUE_BY_PO_DATE: number[] = []

/**
 * Revenue grouped by client invoice date — lags PO bookings (invoices follow POs).
 * Same annual total as PO Date, different monthly distribution.
 */
const BASE_REVENUE_BY_INVOICE_DATE: number[] = []

/**
 * Revenue grouped by payment received date — further lags invoicing (cash collections).
 * Same annual total as PO Date, different monthly distribution.
 */
const BASE_REVENUE_BY_PAYMENT_DATE: number[] = []

const BASE_REVENUE_BY_DATE_TYPE: Record<RevenueDateType, number[]> = {
  'PO Date': BASE_REVENUE_BY_PO_DATE,
  'Invoice Date': BASE_REVENUE_BY_INVOICE_DATE,
  'Payment Received Date': BASE_REVENUE_BY_PAYMENT_DATE,
}

/** Actual client revenue received (cash collected), month-wise. */
const BASE_CLIENT_RECEIVED: number[] = []

/** Actual vendor payments released, month-wise (same timeline as client received). */
const BASE_VENDOR_PAID: number[] = []

/** Prefer getRevenueAnalytics */
export const MONTHLY_REVENUE_TREND = FY_MONTHS.map((month, i) => ({
  month,
  revenue: BASE_REVENUE_BY_PO_DATE[i] ?? 0,
}))

/** Prefer getRevenueAnalytics */
export const CLIENT_RECEIVED_VS_VENDOR_PAYMENTS = FY_MONTHS.map((month, i) => ({
  month,
  clientReceived: BASE_CLIENT_RECEIVED[i] ?? 0,
  vendorPaid: BASE_VENDOR_PAID[i] ?? 0,
}))

export const CASH_POSITION_MONTHLY: Array<{ month: string; inHand: number }> = []

function periodFactor(period: RevenueTimePeriod): number {
  switch (period) {
    case 'This Month':
      return 0.12
    case 'Last 6 Months':
      return 0.5
    case 'This Financial Year':
      return 1
    case 'Custom Range':
      return 0.4
    default:
      return 1
  }
}

function customRangeFactor(customRange?: [Date | null, Date | null]): number {
  const [start, end] = customRange ?? [null, null]
  if (!start || !end) return 0.4
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
  if (days <= 31) return 0.1 + days / 310
  if (days <= 120) return 0.25 + days / 480
  if (days <= 400) return 0.55 + days / 1200
  return Math.min(2.2, 0.9 + days / 1800)
}

function scale(value: number, factor: number): number {
  return Math.round(value * factor)
}

function getGranularity(
  period: RevenueTimePeriod,
  customRange?: [Date | null, Date | null],
): RevenueChartGranularity {
  switch (period) {
    case 'This Month':
      return 'daily'
    case 'Last 6 Months':
    case 'This Financial Year':
      return 'monthly'
    case 'Custom Range': {
      const [start, end] = customRange ?? [null, null]
      if (!start || !end) return 'monthly'
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1)
      if (days <= 45) return 'daily'
      if (days <= 400) return 'monthly'
      return 'yearly'
    }
    default:
      return 'monthly'
  }
}

function wave(index: number, length: number, amplitude = 0.18): number {
  return 1 + Math.sin((index / Math.max(1, length - 1)) * Math.PI * 2) * amplitude
}

function revenueBaseForDateType(dateType: RevenueDateType): number[] {
  return BASE_REVENUE_BY_DATE_TYPE[dateType]
}

function buildDailySeries(
  factor: number,
  dayCount: number,
  dateType: RevenueDateType,
): {
  revenueTrend: RevenueChartPoint[]
  clientReceivedVsVendorPayments: RevenueChartPoint[]
} {
  const revenueTrend: RevenueChartPoint[] = []
  const clientReceivedVsVendorPayments: RevenueChartPoint[] = []

  const revenueSeries = revenueBaseForDateType(dateType)
  if (
    revenueSeries.length === 0 ||
    BASE_CLIENT_RECEIVED.length === 0 ||
    BASE_VENDOR_PAID.length === 0
  ) {
    return { revenueTrend, clientReceivedVsVendorPayments }
  }

  const dailyRevenueBase = (revenueSeries[revenueSeries.length - 1] / 30) * factor
  const dailyClientReceivedBase =
    (BASE_CLIENT_RECEIVED[BASE_CLIENT_RECEIVED.length - 1] / 30) * factor
  const dailyPaidBase = (BASE_VENDOR_PAID[BASE_VENDOR_PAID.length - 1] / 30) * factor

  // Slight phase shift per date type so daily curves differ when switching.
  const phase =
    dateType === 'PO Date' ? 0 : dateType === 'Invoice Date' ? 0.35 : 0.7

  for (let i = 0; i < dayCount; i++) {
    const label = `${i + 1}`
    const w = wave(i + phase * dayCount, dayCount, 0.22)
    revenueTrend.push({ month: label, revenue: scale(dailyRevenueBase * w, 1) })
    clientReceivedVsVendorPayments.push({
      month: label,
      clientReceived: scale(dailyClientReceivedBase * w, 1),
      vendorPaid: scale(dailyPaidBase * w, 1),
    })
  }

  return { revenueTrend, clientReceivedVsVendorPayments }
}

function buildMonthlySeries(
  factor: number,
  months: readonly string[],
  dateType: RevenueDateType,
  offset = 0,
): {
  revenueTrend: RevenueChartPoint[]
  clientReceivedVsVendorPayments: RevenueChartPoint[]
} {
  const revenueSeries = revenueBaseForDateType(dateType)
  if (
    months.length === 0 ||
    revenueSeries.length === 0 ||
    BASE_CLIENT_RECEIVED.length === 0 ||
    BASE_VENDOR_PAID.length === 0
  ) {
    return {
      revenueTrend: [],
      clientReceivedVsVendorPayments: [],
    }
  }

  return {
    revenueTrend: months.map((month, i) => ({
      month,
      revenue: scale(revenueSeries[(i + offset) % 12], factor),
    })),
    clientReceivedVsVendorPayments: months.map((month, i) => ({
      month,
      clientReceived: scale(BASE_CLIENT_RECEIVED[(i + offset) % 12], factor),
      vendorPaid: scale(BASE_VENDOR_PAID[(i + offset) % 12], factor),
    })),
  }
}

function buildYearlySeries(
  factor: number,
  years: string[],
  dateType: RevenueDateType,
): {
  revenueTrend: RevenueChartPoint[]
  clientReceivedVsVendorPayments: RevenueChartPoint[]
} {
  const revenueSeries = revenueBaseForDateType(dateType)
  if (
    revenueSeries.length === 0 ||
    BASE_CLIENT_RECEIVED.length === 0 ||
    BASE_VENDOR_PAID.length === 0
  ) {
    return {
      revenueTrend: [],
      clientReceivedVsVendorPayments: [],
    }
  }

  const yearBaseRevenue = revenueSeries.reduce((a, b) => a + b, 0)
  const yearBaseClientReceived = BASE_CLIENT_RECEIVED.reduce((a, b) => a + b, 0)
  const yearBasePaid = BASE_VENDOR_PAID.reduce((a, b) => a + b, 0)
  const dateTypeAmp =
    dateType === 'PO Date' ? 0.12 : dateType === 'Invoice Date' ? 0.1 : 0.14

  return {
    revenueTrend: years.map((year, i) => ({
      month: year,
      revenue: scale(yearBaseRevenue * wave(i, years.length, dateTypeAmp), factor / years.length),
    })),
    clientReceivedVsVendorPayments: years.map((year, i) => ({
      month: year,
      clientReceived: scale(
        yearBaseClientReceived * wave(i, years.length, 0.12),
        factor / years.length,
      ),
      vendorPaid: scale(yearBasePaid * wave(i, years.length, 0.12), factor / years.length),
    })),
  }
}

function customDayCount(customRange?: [Date | null, Date | null]): number {
  const [start, end] = customRange ?? [null, null]
  if (!start || !end) return 14
  return Math.min(
    60,
    Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1),
  )
}

function buildSeriesForPeriod(
  period: RevenueTimePeriod,
  factor: number,
  granularity: RevenueChartGranularity,
  dateType: RevenueDateType,
  customRange?: [Date | null, Date | null],
): {
  revenueTrend: RevenueChartPoint[]
  clientReceivedVsVendorPayments: RevenueChartPoint[]
} {
  if (granularity === 'daily') {
    const days = period === 'This Month' ? 30 : customDayCount(customRange)
    return buildDailySeries(factor, days, dateType)
  }

  if (granularity === 'yearly') {
    return buildYearlySeries(factor, ['FY23', 'FY24', 'FY25'], dateType)
  }

  if (period === 'Last 6 Months' || period === 'Custom Range') {
    return buildMonthlySeries(factor, ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'], dateType, 0)
  }

  return buildMonthlySeries(factor, FY_MONTHS, dateType, 0)
}

export function getRevenueAnalytics(
  period: RevenueTimePeriod,
  customRange?: [Date | null, Date | null],
  dateType: RevenueDateType = 'PO Date',
): RevenueAnalyticsBundle {
  const factor =
    period === 'Custom Range' ? customRangeFactor(customRange) : periodFactor(period)
  const granularity = getGranularity(period, customRange)
  const series = buildSeriesForPeriod(period, factor, granularity, dateType, customRange)

  return {
    kpis: buildBaseRevenueKpis(factor),
    revenueTrend: series.revenueTrend,
    clientReceivedVsVendorPayments: series.clientReceivedVsVendorPayments,
    granularity,
  }
}

export interface FinancialRevenueYearPoint {
  month: string
  poValue: number
  invoiceValue: number
  amountReceived: number
}

export interface FinancialRevenueYearAnalytics {
  chartData: FinancialRevenueYearPoint[]
  totals: {
    poValue: number
    invoiceValue: number
    amountReceived: number
  }
}

function financialRevenueYearAnalyticsFromData(
  chartData: FinancialRevenueYearPoint[],
): FinancialRevenueYearAnalytics {
  return {
    chartData,
    totals: {
      poValue: chartData.reduce((sum, row) => sum + row.poValue, 0),
      invoiceValue: chartData.reduce((sum, row) => sum + row.invoiceValue, 0),
      amountReceived: chartData.reduce((sum, row) => sum + row.amountReceived, 0),
    },
  }
}

/** Month-wise PO, invoice, and received amounts for the Financial Revenue Year chart. */
export function getFinancialRevenueYearAnalytics(
  period: RevenueTimePeriod,
  customRange?: [Date | null, Date | null],
): FinancialRevenueYearAnalytics {
  const factor =
    period === 'Custom Range' ? customRangeFactor(customRange) : periodFactor(period)

  const chartData = FY_MONTHS.map((month, i) => ({
    month,
    poValue: scale(BASE_REVENUE_BY_PO_DATE[i], factor),
    invoiceValue: scale(BASE_REVENUE_BY_INVOICE_DATE[i], factor),
    amountReceived: scale(BASE_REVENUE_BY_PAYMENT_DATE[i], factor),
  }))

  return {
    ...financialRevenueYearAnalyticsFromData(chartData),
  }
}

function asRevenueChartData(value: unknown): RevenueChartPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      return {
        month: String(record.month ?? ''),
        revenue: Number(record.revenue ?? 0),
        clientReceived: Number(record.clientReceived ?? 0),
        vendorPaid: Number(record.vendorPaid ?? 0),
      }
    })
    .filter((row) => row.month)
}

function asFinancialRevenueYearData(value: unknown): FinancialRevenueYearPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      return {
        month: String(record.month ?? ''),
        poValue: Number(record.poValue ?? 0),
        invoiceValue: Number(record.invoiceValue ?? 0),
        amountReceived: Number(record.amountReceived ?? 0),
      }
    })
    .filter((row) => row.month)
}

function asRevenueKpiBreakdowns(value: unknown): RevenueKpiBreakdowns {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const output: RevenueKpiBreakdowns = {}
  for (const [key, rows] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue
    output[key] = rows
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object' && !Array.isArray(row),
      )
      .map((row) => {
        const cleanRow: RevenueDrawerRow = {}
        for (const [cellKey, cellValue] of Object.entries(row)) {
          if (typeof cellValue === 'string' || typeof cellValue === 'number') {
            cleanRow[cellKey] = cellValue
          }
        }
        return cleanRow
      })
  }
  return output
}

function asRevenueProjectListingRows(value: unknown): RevenueProjectListingRow[] {
  if (!Array.isArray(value)) return []

  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      return {
        id: String(record.id ?? ''),
        projectName: String(record.projectName ?? 'Untitled Project'),
        projectValue: Number(record.projectValue ?? 0),
        projectSize: Number(record.projectSize ?? 0),
        teamLead: String(record.teamLead ?? 'Unassigned'),
        clientPOAmount: Number(record.clientPOAmount ?? 0),
        vendorPOAmount: Number(record.vendorPOAmount ?? 0),
        clientReceived: Number(record.clientReceived ?? 0),
        vendorPaid: Number(record.vendorPaid ?? 0),
        status: String(record.status ?? ''),
      }
    })
    .filter((row) => row.id)
}


function formatAxisAmount(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return `₹${formatCurrency(n)}`
}

function chartSubtitle(granularity: 'daily' | 'monthly' | 'yearly', base: string): string {
  if (granularity === 'daily') {
    return base.replace('month-wise', 'day-wise').replace('Monthly', 'Daily')
  }
  if (granularity === 'yearly') {
    return base.replace('month-wise', 'year-wise').replace('Monthly', 'Yearly')
  }
  return base
}

const ICON_MAP: Record<RevenueKpi['icon'], { node: ReactNode; color: string }> = {
  po: {
    node: <IndianRupee size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.teal,
  },
  live: {
    node: <PlayCircle size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.blue,
  },
  received: {
    node: <CircleDollarSign size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.green,
  },
  pending: {
    node: <Timer size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.amber,
  },
  paid: {
    node: <HandCoins size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.purple,
  },
  payable: {
    node: <Banknote size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.red,
  },
  cash: {
    node: <Wallet size={18} strokeWidth={1.75} />,
    color: tokens.color.primary[600],
  },
  profit: {
    node: <TrendingUp size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.green,
  },
}

interface RevenueKpiCardProps {
  kpi: RevenueKpi
  onClick?: () => void
  loading?: boolean
}

export function RevenueKpiCard({ kpi, onClick, loading = false }: RevenueKpiCardProps) {
  const theme = useTheme()
  const iconMeta = ICON_MAP[kpi.icon]

  return (
    <Paper
      elevation={0}
      onClick={loading ? undefined : onClick}
      sx={{
        height: '100%',
        p: 2,
        borderRadius: '10px',
        border: `1px solid ${tokens.color.neutral[200]}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: 'background.paper',
        ...(!loading &&
          onClick && {
            cursor: 'pointer',
            transition: 'border-color 0.15s, box-shadow 0.15s',
            '&:hover': {
              borderColor: tokens.color.primary[300],
              boxShadow: `0 2px 8px rgba(0,0,0,0.08)`,
            },
          }),
      }}
    >
      {loading ? (
        <DashboardKpiCardSkeleton />
      ) : (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={600}
              sx={{
                fontSize: 11,
                letterSpacing: 0.3,
                lineHeight: 1.35,
                pr: 0.5,
              }}
            >
              {kpi.title}
            </Typography>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: '8px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(iconMeta.color, theme.palette.mode === 'dark' ? 0.2 : 0.1),
                color: iconMeta.color,
              }}
            >
              {iconMeta.node}
            </Box>
          </Box>

          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ fontSize: { xs: 20, md: 22 }, lineHeight: 1.2, letterSpacing: -0.3 }}
          >
            ₹{formatCurrency(kpi.value)}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, mt: 'auto' }}>
            {kpi.subtitle}
          </Typography>
        </>
      )}
    </Paper>
  )
}


export type ClickableKpiId =
  | 'total-po'
  | 'live-po'
  | 'received'
  | 'pending-claim'
  | 'client-pending'
  | 'paid-vendors'
  | 'payable'
  | 'vendor-pending'

export const CLICKABLE_KPI_IDS: Set<string> = new Set<string>([
  'total-po',
  'live-po',
  'received',
  'pending-claim',
  'client-pending',
  'paid-vendors',
  'payable',
  'vendor-pending',
])

interface DrawerColumn {
  key: string
  label: string
  align?: 'left' | 'right'
  format?: 'currency' | 'date' | 'status'
  width?: string
  /** Extra left padding (theme spacing); defaults to shared table `px`. */
  pl?: number
  /** Extra right padding (theme spacing); defaults to shared table `px`. */
  pr?: number
}

interface DrawerConfig {
  columns: DrawerColumn[]
  rows: RevenueDrawerRow[]
  totalKey: string
}

const TOTAL_PO_ROWS: RevenueDrawerRow[] = []

const LIVE_PO_ROWS: RevenueDrawerRow[] = []

const RECEIVED_ROWS: RevenueDrawerRow[] = []

const PENDING_CLAIM_ROWS: RevenueDrawerRow[] = []

const CLIENT_PENDING_ROWS: RevenueDrawerRow[] = []

const PAID_VENDORS_ROWS: RevenueDrawerRow[] = []

const PAYABLE_ROWS: RevenueDrawerRow[] = []

const VENDOR_PENDING_ROWS: RevenueDrawerRow[] = []

function getDrawerRows(
  rowsByKpi: RevenueKpiBreakdowns | null,
  kpiId: ClickableKpiId,
  fallbackRows: RevenueDrawerRow[],
): RevenueDrawerRow[] {
  const rows = rowsByKpi?.[kpiId]
  return Array.isArray(rows) ? rows : fallbackRows
}

function getDrawerConfig(
  kpiId: ClickableKpiId,
  rowsByKpi: RevenueKpiBreakdowns | null = null,
): DrawerConfig {
  if (kpiId === 'received') {
    return {
      columns: [
        { key: 'client', label: 'Client', width: '28%' },
        { key: 'project', label: 'Project', width: '34%' },
        { key: 'amount', label: 'Amount', align: 'right', format: 'currency', width: '20%' },
        { key: 'status', label: 'Status', format: 'status', width: '18%' },
      ],
      rows: getDrawerRows(rowsByKpi, kpiId, RECEIVED_ROWS),
      totalKey: 'amount',
    }
  }

  if (kpiId === 'paid-vendors') {
    return {
      columns: [
        { key: 'vendor', label: 'Vendor', width: '38%' },
        { key: 'project', label: 'Project', width: '38%' },
        { key: 'paid', label: 'Payable Amount', align: 'right', format: 'currency', width: '24%' },
      ],
      rows: getDrawerRows(rowsByKpi, kpiId, PAID_VENDORS_ROWS),
      totalKey: 'paid',
    }
  }

  if (kpiId === 'payable') {
    return {
      columns: [
        { key: 'vendor', label: 'Vendor', width: '28%' },
        { key: 'project', label: 'Project', width: '28%' },
        { key: 'payable', label: 'Payable Amount', align: 'right', format: 'currency', width: '18%' },
        { key: 'dueDate', label: 'Due Date', format: 'date', width: '13%' },
        { key: 'status', label: 'Status', format: 'status', width: '13%' },
      ],
      rows: getDrawerRows(rowsByKpi, kpiId, PAYABLE_ROWS),
      totalKey: 'payable',
    }
  }

  switch (String(kpiId) as ClickableKpiId) {
    case 'total-po':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '48%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '22%' },
          { key: 'poValue', label: 'Total PO Value', align: 'right', format: 'currency', width: '30%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, TOTAL_PO_ROWS),
        totalKey: 'poValue',
      }
    case 'live-po':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '48%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '22%' },
          { key: 'poValue', label: 'Live PO Value', align: 'right', format: 'currency', width: '30%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, LIVE_PO_ROWS),
        totalKey: 'poValue',
      }
    case 'received':
      return {
        columns: [
          { key: 'client', label: 'Client', width: '58%' },
          { key: 'projectCount', label: 'Projects', align: 'right', width: '18%' },
          // Extra pr/pl so Amount↔Status has the same breathing room as Client↔Project
          { key: 'status', label: 'Project Status', format: 'status', width: '18%' },
          { key: 'amount', label: 'Amount Received', align: 'right', format: 'currency', width: '22%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, RECEIVED_ROWS),
        totalKey: 'amount',
      }
    case 'pending-claim':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '34%' },
          { key: 'client', label: 'Client', width: '26%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '18%' },
          { key: 'pending', label: 'Pending Amount', align: 'right', format: 'currency', width: '22%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, PENDING_CLAIM_ROWS),
        totalKey: 'pending',
      }
    case 'client-pending':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '26%' },
          { key: 'client', label: 'Client', width: '20%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '15%' },
          { key: 'poValue', label: 'PO Value', align: 'right', format: 'currency', width: '13%' },
          { key: 'received', label: 'Received', align: 'right', format: 'currency', width: '13%' },
          { key: 'pending', label: 'Client Pending', align: 'right', format: 'currency', width: '13%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, CLIENT_PENDING_ROWS),
        totalKey: 'pending',
      }
    case 'paid-vendors':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '34%' },
          { key: 'client', label: 'Client', width: '26%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '18%' },
          { key: 'paid', label: 'Amount Paid', align: 'right', format: 'currency', width: '22%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, PAID_VENDORS_ROWS),
        totalKey: 'paid',
      }
    case 'payable':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '34%' },
          { key: 'client', label: 'Client', width: '26%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '18%' },
          { key: 'payable', label: 'Payable Amount', align: 'right', format: 'currency', width: '22%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, PAYABLE_ROWS),
        totalKey: 'payable',
      }
    case 'vendor-pending':
      return {
        columns: [
          { key: 'project', label: 'Project Name', width: '26%' },
          { key: 'client', label: 'Client', width: '20%' },
          { key: 'status', label: 'Project Status', format: 'status', width: '15%' },
          { key: 'payable', label: 'Vendor PO Amount', align: 'right', format: 'currency', width: '13%' },
          { key: 'paid', label: 'Vendor Paid', align: 'right', format: 'currency', width: '13%' },
          { key: 'pending', label: 'Vendor Pending', align: 'right', format: 'currency', width: '13%' },
        ],
        rows: getDrawerRows(rowsByKpi, kpiId, VENDOR_PENDING_ROWS),
        totalKey: 'pending',
      }
  }
}

const STATUS_TYPE_BY_LABEL: Record<string, StatusType> = {
  Live: 'live',
  Completed: 'completed',
  Archived: 'archived',
  Cancelled: 'cancelled',
  Overdue: 'overdue',
  Pending: 'pending',
  Paid: 'paid',
  Due: 'payment_pending',
  Upcoming: 'issued',
}

function formatCell(value: string | number, format?: DrawerColumn['format']): string {
  if (format === 'currency' && typeof value === 'number') return `₹${formatCurrency(value)}`
  if (format === 'date') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }
  }
  return String(value)
}

function renderCell(value: string | number, format?: DrawerColumn['format']) {
  if (format === 'status') {
    const label = String(value)
    const status = STATUS_TYPE_BY_LABEL[label] ?? 'draft'
    return <StatusBadge status={status} label={label} size="small" />
  }
  return formatCell(value, format)
}

function getColumnAlign(col: DrawerColumn): 'left' | 'right' {
  return col.align ?? (col.format === 'currency' ? 'right' : 'left')
}

function getColumnCellSx(col: DrawerColumn) {
  return {
    width: col.width,
    minWidth: col.width,
    pl: col.pl ?? 2,
    pr: col.pr ?? 2,
  }
}

export interface RevenueKpiDrawerProps {
  open: boolean
  onClose: () => void
  kpi: RevenueKpi | null
  rowsByKpi?: RevenueKpiBreakdowns | null
}

export function RevenueKpiDrawer({
  open,
  onClose,
  kpi,
  rowsByKpi = null,
}: RevenueKpiDrawerProps) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    setSearch('')
  }, [kpi?.id])

  const config = useMemo(() => {
    if (!kpi || !CLICKABLE_KPI_IDS.has(kpi.id)) return null
    return getDrawerConfig(kpi.id as ClickableKpiId, rowsByKpi)
  }, [kpi, rowsByKpi])

  const visibleRows = useMemo(() => {
    if (!config) return []
    const query = search.trim().toLowerCase()

    if (!query) return config.rows

    return config.rows.filter((row) =>
      config.columns.some((col) => {
        if (col.format === 'currency') return false
        return String(row[col.key] ?? '').toLowerCase().includes(query)
      }),
    )
  }, [config, search])

  if (!kpi || !config) return null

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      slotProps={{
        backdrop: { sx: { backgroundColor: 'rgba(0,0,0,0.18)' } },
      }}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '88%', md: 1120 },
          maxWidth: '96vw',
          minWidth: { sm: 720 },
          boxShadow: '-4px 0 24px rgba(0,0,0,0.10)',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          px: 3,
          pt: 2.5,
          pb: 2,
          flexShrink: 0,
        }}
      >
        <Box sx={{ pr: 2 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'text.primary', lineHeight: 1.4 }}>
            {kpi.title}
          </Typography>
          <Typography
            sx={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: -0.4,
              lineHeight: 1.2,
              mt: 0.5,
            }}
          >
            ₹{formatCurrency(kpi.value)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, mt: 0.5 }}>
            {kpi.subtitle}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close" sx={{ mt: -0.5 }}>
          <X size={18} />
        </IconButton>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
          px: 3,
          pb: 2,
          flexShrink: 0,
        }}
      >
        <SearchInput
          size="sm"
          placeholder="Search..."
          value={search}
          onChange={setSearch}
          debounce={200}
          sx={{ flex: '1 1 180px', minWidth: 160, maxWidth: 280 }}
        />
      </Box>

      <Box sx={{ px: 3, pb: 3, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <TableContainer
          sx={{
            overflowX: 'auto',
            overflowY: 'auto',
            minHeight: 0,
            border: `1px solid ${tokens.color.neutral[200]}`,
            borderRadius: 1,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
          }}
        >
          <Table
            size="small"
            stickyHeader
            sx={{
              width: '100%',
              tableLayout: 'fixed',
              '& .MuiTableCell-head': {
                fontSize: 12,
                fontWeight: 600,
                color: 'text.secondary',
                bgcolor: tokens.color.neutral[50],
                borderBottom: `1px solid ${tokens.color.neutral[200]}`,
                py: 1,
                whiteSpace: 'nowrap',
                lineHeight: 1.35,
              },
              '& .MuiTableCell-body': {
                fontSize: 13,
                py: 1,
                borderBottom: `1px solid ${tokens.color.neutral[100]}`,
                whiteSpace: 'nowrap',
                color: 'text.primary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }}
          >
            <TableHead>
              <TableRow>
                {config.columns.map((col) => (
                  <TableCell
                    key={col.key}
                    align={getColumnAlign(col)}
                    sx={getColumnCellSx(col)}
                  >
                    {col.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row, idx) => (
                <TableRow key={idx} hover={false}>
                  {config.columns.map((col) => (
                    <TableCell
                      key={col.key}
                      align={getColumnAlign(col)}
                      sx={getColumnCellSx(col)}
                    >
                      {renderCell(row[col.key], col.format)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={config.columns.length} sx={{ py: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No records match the current filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Drawer>
  )
}

const REVENUE_PROJECT_COLUMNS: Array<{
  key: keyof RevenueProjectListingRow
  label: string
  align?: 'left' | 'right'
  format?: 'currency' | 'area' | 'status'
  width?: string
}> = [
  { key: 'projectName', label: 'Project Name', width: '18%' },
  {
    key: 'projectValue',
    label: 'Project Value (Total PO Value)',
    format: 'currency',
    width: '14%',
  },
  {
    key: 'projectSize',
    label: 'Project Size (Area)',
    format: 'area',
    width: '12%',
  },
  { key: 'teamLead', label: 'Team Lead', width: '13%' },
  {
    key: 'clientPOAmount',
    label: 'Client PO Amount',
    format: 'currency',
    width: '12%',
  },
  {
    key: 'vendorPOAmount',
    label: 'Vendor PO Amount',
    format: 'currency',
    width: '12%',
  },
  {
    key: 'clientReceived',
    label: 'Client Received',
    format: 'currency',
    width: '11%',
  },
  {
    key: 'vendorPaid',
    label: 'Vendor Paid',
    format: 'currency',
    width: '10%',
  },
  { key: 'status', label: 'Status', format: 'status', width: '8%' },
]

function formatArea(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 sq.ft'
  return `${Math.round(value).toLocaleString('en-IN')} sq.ft`
}

function renderRevenueProjectCell(
  row: RevenueProjectListingRow,
  column: (typeof REVENUE_PROJECT_COLUMNS)[number],
) {
  const value = row[column.key]

  if (column.format === 'currency') return `₹${formatCurrency(Number(value ?? 0))}`
  if (column.format === 'area') return formatArea(Number(value ?? 0))
  if (column.format === 'status') {
    const label = String(value || 'Draft')
    const status = STATUS_TYPE_BY_LABEL[label] ?? 'draft'
    return <StatusBadge status={status} label={label} size="small" />
  }

  return String(value ?? '')
}

const REVENUE_PROJECT_PAGE_SIZE_OPTIONS = [10, 25, 50, 75, 100] as const

function RevenueProjectListingTable({
  rows,
  loading = false,
}: {
  rows: RevenueProjectListingRow[]
  loading?: boolean
}) {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [statusFilter, setStatusFilter] = useState('')

  const statusOptions = useMemo(() => {
    const values = Array.from(
      new Set(rows.map((row) => String(row.status ?? '').trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b))
    return values.map((value) => ({ value, label: value }))
  }, [rows])

  const filteredRows = useMemo(() => {
    if (!statusFilter) return rows
    return rows.filter((row) => String(row.status ?? '') === statusFilter)
  }, [rows, statusFilter])

  const safePage = clampListingPage0Based(page, filteredRows.length, rowsPerPage)
  const visibleRows = useMemo(
    () => filteredRows.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage),
    [filteredRows, rowsPerPage, safePage],
  )
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage))

  useEffect(() => {
    const nextPage = clampListingPage0Based(page, filteredRows.length, rowsPerPage)
    if (nextPage !== page) setPage(nextPage)
  }, [filteredRows.length, page, rowsPerPage])

  function handleStatusFilter(value: string) {
    setStatusFilter(value)
    setPage(0)
  }

  return (
    <ChartCard
      title="Revenue Project Listing"
      subtitle="Project-wise PO, area, collections, and vendor payment details"
    >
      <Box
        sx={{
          overflow: 'hidden',
          border: `1px solid ${tokens.color.neutral[200]}`,
          borderRadius: 1,
        }}
      >
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table
            size="small"
            sx={{
              minWidth: 1280,
              '& .MuiTableCell-head': {
                fontSize: 12,
                fontWeight: 600,
                color: 'text.secondary',
                bgcolor: tokens.color.neutral[50],
                borderBottom: `1px solid ${tokens.color.neutral[200]}`,
                py: 1.1,
                px: 1.5,
                whiteSpace: 'nowrap',
                lineHeight: 1.35,
                textAlign: 'left',
              },
              '& .MuiTableCell-body': {
                fontSize: 13,
                py: 1.15,
                px: 1.5,
                borderBottom: `1px solid ${tokens.color.neutral[100]}`,
                whiteSpace: 'nowrap',
                color: 'text.primary',
                textAlign: 'left',
              },
            }}
          >
            <TableHead>
              <TableRow>
                {REVENUE_PROJECT_COLUMNS.map((column) =>
                  column.key === 'status' ? (
                    <FilterableHeaderCell
                      key={column.key}
                      label={column.label}
                      filterValue={statusFilter}
                      filterOptions={statusOptions}
                      onFilter={handleStatusFilter}
                      sx={{ width: column.width }}
                    />
                  ) : (
                    <TableCell key={column.key} align="left" sx={{ width: column.width }}>
                      {column.label}
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={REVENUE_PROJECT_COLUMNS.length}
                    sx={{
                      py: 0,
                      borderBottom: 'none',
                      '&.MuiTableCell-body': { textAlign: 'center' },
                    }}
                  >
                    <DashboardSectionLoader minHeight={180} />
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id} hover={false}>
                      {REVENUE_PROJECT_COLUMNS.map((column) => (
                        <TableCell key={column.key} align="left">
                          {renderRevenueProjectCell(row, column)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={REVENUE_PROJECT_COLUMNS.length}
                        sx={{
                          py: 4,
                          '&.MuiTableCell-body': {
                            textAlign: 'center',
                            whiteSpace: 'normal',
                          },
                        }}
                      >
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ width: '100%', textAlign: 'center' }}
                        >
                          {rows.length === 0
                            ? 'No revenue projects found.'
                            : 'No projects match the selected status.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {!loading ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            p: '10px 16px',
            borderTop: `1px solid ${tokens.color.neutral[100]}`,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {formatListingShowingLabel(safePage, rowsPerPage, filteredRows.length)}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Rows per page:
              </Typography>
              <MuiSelect
                size="small"
                value={rowsPerPage}
                onChange={(event) => {
                  setRowsPerPage(Number(event.target.value))
                  setPage(0)
                }}
                sx={{
                  fontSize: 12,
                  height: 28,
                  bgcolor: tokens.color.neutral[50],
                  borderRadius: '4px',
                  '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                }}
              >
                {REVENUE_PROJECT_PAGE_SIZE_OPTIONS.map((size) => (
                  <MenuItem key={size} value={size} sx={MENU_ITEM_SX}>
                    {size}
                  </MenuItem>
                ))}
              </MuiSelect>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton
                size="small"
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft size={16} />
              </IconButton>
              <Typography variant="caption" color="text.secondary">
                {safePage + 1} / {pageCount}
              </Typography>
              <IconButton
                size="small"
                disabled={(safePage + 1) * rowsPerPage >= filteredRows.length}
                onClick={() =>
                  setPage((current) =>
                    clampListingPage0Based(current + 1, filteredRows.length, rowsPerPage),
                  )
                }
              >
                <ChevronRight size={16} />
              </IconButton>
            </Box>
          </Box>
        </Box>
        ) : null}
      </Box>
    </ChartCard>
  )
}


function SummaryStat({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: '10px',
        border: `1px solid ${tokens.color.neutral[200]}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        sx={{ fontSize: 11, letterSpacing: 0.3, display: 'block', mb: 0.75 }}
      >
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ fontSize: { xs: 18, md: 20 } }}>
        ₹{formatCurrency(value)}
      </Typography>
    </Paper>
  )
}

export interface FinancialRevenueYearSectionProps {
  period?: RevenueTimePeriod
  customRange?: [Date | null, Date | null]
  data?: FinancialRevenueYearPoint[] | null
  loading?: boolean
}

export function FinancialRevenueYearSection({
  period = 'This Financial Year',
  customRange = [null, null],
  data,
  loading = false,
}: FinancialRevenueYearSectionProps) {
  const analytics = useMemo(
    () =>
      data != null && data.length > 0
        ? financialRevenueYearAnalyticsFromData(data)
        : getFinancialRevenueYearAnalytics(period, customRange),
    [data, period, customRange],
  )

  return (
    <ChartCard
      title="Financial Revenue Year"
      subtitle="Monthly comparison of PO Value, Invoice Value & Amount Received"
      action={
        <ChartSeriesLegend
          items={[
            { label: 'PO Value', color: CHART_COLORS.teal },
            { label: 'Invoice Value', color: CHART_COLORS.blue },
            { label: 'Amount Received', color: CHART_COLORS.green },
          ]}
        />
      }
    >
      <BarChart
        data={[...analytics.chartData]}
        xKey="month"
        height={280}
        loading={loading}
        showLegend={false}
        bars={[
          { key: 'poValue', label: 'PO Value', color: CHART_COLORS.teal },
          { key: 'invoiceValue', label: 'Invoice Value', color: CHART_COLORS.blue },
          { key: 'amountReceived', label: 'Amount Received', color: CHART_COLORS.green },
        ]}
        formatY={formatAxisAmount}
      />

      <Grid container spacing={2} sx={{ mt: 2.5 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          {loading ? (
            <DashboardSectionLoader minHeight={72} size={22} />
          ) : (
            <SummaryStat label="Total PO Value" value={analytics.totals.poValue} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          {loading ? (
            <DashboardSectionLoader minHeight={72} size={22} />
          ) : (
            <SummaryStat label="Total Invoice Value" value={analytics.totals.invoiceValue} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          {loading ? (
            <DashboardSectionLoader minHeight={72} size={22} />
          ) : (
            <SummaryStat label="Total Amount Received" value={analytics.totals.amountReceived} />
          )}
        </Grid>
      </Grid>
    </ChartCard>
  )
}


const MENU_ITEM_SX = { fontSize: 12 } as const

export function RevenueTab({
  datePeriod,
  dateRange,
  onDatePeriodChange,
  onDateRangeChange,
}: {
  datePeriod: DashboardDatePeriod
  dateRange: DashboardDateRange
  onDatePeriodChange: (period: DashboardDatePeriod) => void
  onDateRangeChange: (range: DashboardDateRange) => void
}) {
  const [drawerKpi, setDrawerKpi] = useState<RevenueKpi | null>(null)
  const [serverKpis, setServerKpis] = useState<RevenueKpi[] | null>(null)
  const [serverClientVsVendorData, setServerClientVsVendorData] = useState<
    RevenueChartPoint[] | null
  >(null)
  const [serverFinancialRevenueYearData, setServerFinancialRevenueYearData] = useState<
    FinancialRevenueYearPoint[] | null
  >(null)
  const [serverKpiBreakdowns, setServerKpiBreakdowns] =
    useState<RevenueKpiBreakdowns | null>(null)
  const [serverRevenueProjects, setServerRevenueProjects] = useState<
    RevenueProjectListingRow[] | null
  >(null)
  const [loading, setLoading] = useState(true)
  const fromIso = isoFromDate(dateRange[0])
  const toIso = isoFromDate(dateRange[1])
  const requestParams = useMemo(
    () => ({
      ...(fromIso ? { from: fromIso } : {}),
      ...(toIso ? { to: toIso } : {}),
    }),
    [fromIso, toIso],
  )

  const localRevenueAnalytics = useMemo(
    () => getRevenueAnalytics('Custom Range', dateRange),
    [dateRange],
  )
  const revenueAnalytics = useMemo(
    () => ({
      ...localRevenueAnalytics,
      kpis:
        serverKpis && serverKpis.length > 0 ? serverKpis : localRevenueAnalytics.kpis,
      clientReceivedVsVendorPayments:
        serverClientVsVendorData && serverClientVsVendorData.length > 0
          ? serverClientVsVendorData
          : localRevenueAnalytics.clientReceivedVsVendorPayments,
    }),
    [localRevenueAnalytics, serverClientVsVendorData, serverKpis],
  )

  const loadRevenueDashboard = useCallback(
    async (isActive: () => boolean) => {
      setLoading(true)
      try {
        const response = await client.get('/dashboard/revenue', {
          params: requestParams,
        })
        const data = unwrapApiData<RevenueDashboardResponse>(response.data)
        const clientVsVendorChart = data.charts?.find(
          (chart) => chart.id === 'client-revenue-vs-vendor-payments',
        )
        const financialRevenueYearChart = data.charts?.find(
          (chart) => chart.id === 'financial-revenue-year',
        )
        if (!isActive()) return
        setServerKpis(Array.isArray(data.kpis) ? data.kpis : [])
        setServerClientVsVendorData(asRevenueChartData(clientVsVendorChart?.data))
        setServerFinancialRevenueYearData(
          asFinancialRevenueYearData(financialRevenueYearChart?.data),
        )
        setServerKpiBreakdowns(asRevenueKpiBreakdowns(data.data?.kpiBreakdowns))
        setServerRevenueProjects(asRevenueProjectListingRows(data.data?.revenueProjects))
      } catch {
        // Keep the last successful payload so a failed/raced refetch cannot blank the UI.
        if (!isActive()) return
      } finally {
        if (isActive()) setLoading(false)
      }
    },
    [requestParams],
  )

  useDashboardReload(loadRevenueDashboard, [loadRevenueDashboard])

  const sectionLoading = loading && serverKpis == null

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 1,
        }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
            Revenue
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: 12, mt: 0.25 }}
          >
            Key commercial metrics for the selected period.
          </Typography>
        </Box>

        <DashboardDateRangeFilter
          period={datePeriod}
          value={dateRange}
          onPeriodChange={onDatePeriodChange}
          onChange={onDateRangeChange}
        />
      </Box>

      <Grid container spacing={2} columns={{ xs: 1, sm: 2, md: 5 }} sx={{ mb: 3 }}>
        {revenueAnalytics.kpis.map((kpi) => (
          <Grid key={kpi.id} size={{ xs: 1, sm: 1, md: 1 }}>
            <RevenueKpiCard
              kpi={kpi}
              loading={sectionLoading}
              onClick={
                !sectionLoading && CLICKABLE_KPI_IDS.has(kpi.id)
                  ? () => setDrawerKpi(kpi)
                  : undefined
              }
            />
          </Grid>
        ))}
      </Grid>

      <RevenueKpiDrawer
        open={!!drawerKpi}
        onClose={() => setDrawerKpi(null)}
        kpi={drawerKpi}
        rowsByKpi={serverKpiBreakdowns}
      />

      <Box sx={{ mb: 3 }}>
        <RevenueProjectListingTable
          rows={serverRevenueProjects ?? []}
          loading={sectionLoading}
        />
      </Box>

      <Typography
        variant="overline"
        color="text.secondary"
        fontWeight={600}
        sx={{ fontSize: 10, letterSpacing: 1, display: 'block', mb: 1.5 }}
      >
        Revenue Analytics
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12 }}>
          <ChartCard
            title="Client Revenue Received vs Vendor Payments"
            subtitle={chartSubtitle(
              revenueAnalytics.granularity,
              'Client collections vs vendor payments month-wise',
            )}
            action={
              <ChartSeriesLegend
                items={[
                  {
                    label: 'Client Revenue Received',
                    color: CHART_COLORS.green,
                  },
                  {
                    label: 'Vendor Payments',
                    color: CHART_COLORS.blue,
                  },
                ]}
              />
            }
          >
            <BarChart
              data={[...revenueAnalytics.clientReceivedVsVendorPayments]}
              xKey="month"
              height={280}
              loading={sectionLoading}
              showLegend={false}
              bars={[
                {
                  key: 'clientReceived',
                  label: 'Client Revenue Received',
                  color: CHART_COLORS.green,
                },
                {
                  key: 'vendorPaid',
                  label: 'Vendor Payments',
                  color: CHART_COLORS.blue,
                },
              ]}
              formatY={formatAxisAmount}
            />
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <FinancialRevenueYearSection
            period="Custom Range"
            customRange={dateRange}
            data={serverFinancialRevenueYearData}
            loading={sectionLoading}
          />
        </Grid>
      </Grid>
    </Box>
  )
}
