import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Stack,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableFooter,
  Alert,
  Skeleton,
} from '@mui/material'
import dayjs from 'dayjs'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { FileSpreadsheet, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, Select, StatusBadge, Tag } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { FilterableSortHeader, type ColumnFilterOption } from '@/components/listing'
import { financeApi } from '@/api/financeApi'
import { unwrapApiData, unwrapApiList } from '@/modules/system-settings/shared/api'
import type {
  FillingSummaryChartPoint,
  FillingSummaryKpis,
  FillingSummaryListType,
  FillingSummaryPeriodBreakdown,
  GlobalGstEntry,
  GlobalTdsClientEntry,
  GlobalTdsVendorEntry,
} from '@/slices/finance/types'
import type { ClientInvoice } from '@/slices/live/types'
import { formatDate, formatInr } from '@/utils/formatters'
import { invoiceStatusToBadgeType } from '@/pages/Finance/invoiceStatus'
import {
  currentIndianFyStartYear,
  financialYearSelectOptions,
  indianFyQuarterLabel,
  parseChartPeriod,
  selectedFyHeading,
} from './complianceListingUtils'

const CHART_GST = '#1D9E75'
const CHART_TDS = '#EF9F27'

const TABLE_HEADER_SX = {
  fontSize: 10,
  fontWeight: 700,
  color: tokens.color.neutral[500],
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
  borderBottom: `1px solid ${tokens.color.neutral[100]}`,
  py: '10px',
  px: 2,
}

const TABLE_CELL_SX = {
  fontSize: 12,
  borderBottom: `1px solid ${tokens.color.neutral[50]}`,
  py: '12px',
  px: 2,
}

type PeriodMode = 'monthly' | 'quarterly'
type TableTab = 'all' | 'gst' | 'clientTds' | 'vendorTds'

const TAB_TO_LIST_TYPE: Record<Exclude<TableTab, 'all'>, FillingSummaryListType> = {
  gst: 'gst',
  clientTds: 'client_tds',
  vendorTds: 'vendor_tds',
}

function groupChartByQuarter(rows: FillingSummaryChartPoint[]): FillingSummaryChartPoint[] {
  const map = new Map<string, FillingSummaryChartPoint>()
  for (const row of rows) {
    const parsed = parseChartPeriod(row.period)
    const label = parsed ? indianFyQuarterLabel(parsed) : row.period
    const prev = map.get(label) ?? { period: label, gst: 0, tds: 0 }
    prev.gst += row.gst
    prev.tds += row.tds
    map.set(label, prev)
  }
  return [...map.values()]
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (c: string | number) => {
    const s = String(c)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const body = rows.map((r) => r.map(esc).join(',')).join('\n')
  downloadBlob(new Blob([body], { type: 'text/csv;charset=utf-8;' }), filename)
}

function filenameFromDisposition(header: unknown, fallback: string) {
  if (typeof header !== 'string') return fallback
  const match = header.match(/filename="?([^";]+)"?/i)
  return match?.[1]?.trim() || fallback
}

function axisTickInr(v: number) {
  return `₹${formatInr(v)}`
}

type ListingControls = {
  sortField?: string
  sortDirection: 'asc' | 'desc'
  filters: Record<string, string>
}

function emptyListingControls(): ListingControls {
  return { sortDirection: 'asc', filters: {} }
}

function uniqueFilterOptions(values: Array<string | number>): ColumnFilterOption[] {
  const seen = new Set<string>()
  const out: ColumnFilterOption[] = []
  for (const raw of values) {
    const value = String(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: value })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

function compareListingValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
  const dir = direction === 'asc' ? 1 : -1
  if (typeof left === 'number' || typeof right === 'number') {
    return ((Number(left) || 0) - (Number(right) || 0)) * dir
  }
  return (
    String(left ?? '').localeCompare(String(right ?? ''), undefined, { sensitivity: 'base' }) * dir
  )
}

function matchesExactFilter(filter: string | undefined, value: string | number) {
  if (!filter) return true
  return String(value) === filter
}

function matchesDateFilter(filter: string | undefined, iso: string) {
  if (!filter) return true
  return iso.slice(0, 10) === filter.slice(0, 10)
}

function sortByField<T>(
  rows: T[],
  sortField: string | undefined,
  sortDirection: 'asc' | 'desc',
  resolve: (row: T, field: string) => unknown = (row, field) =>
    (row as unknown as Record<string, unknown>)[field],
) {
  if (!sortField) return rows
  return [...rows].sort((a, b) =>
    compareListingValues(resolve(a, sortField), resolve(b, sortField), sortDirection),
  )
}

type AllMergedRow = {
  id: string
  sortDate: string
  date: string
  ref: string
  projectName: string
  party: string
  type: 'gst' | 'clientTds' | 'vendorTds'
  typeLabel: string
  base: number
  tax: number
  status: string
}

export default function FilingSummaryPage() {
  const navigate = useNavigate()

  const [filterProjectId, setFilterProjectId] = useState('')
  const [projectOptions, setProjectOptions] = useState<Array<{ label: string; value: string }>>([])
  const [kpis, setKpis] = useState<FillingSummaryKpis | null>(null)
  const [monthlyChart, setMonthlyChart] = useState<FillingSummaryChartPoint[]>([])
  const [breakdown, setBreakdown] = useState<FillingSummaryPeriodBreakdown | null>(null)
  const [gstEntries, setGstEntries] = useState<GlobalGstEntry[]>([])
  const [clientTdsEntries, setClientTdsEntries] = useState<GlobalTdsClientEntry[]>([])
  const [vendorTdsEntries, setVendorTdsEntries] = useState<GlobalTdsVendorEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly')
  const [fyStartYear, setFyStartYear] = useState(() => currentIndianFyStartYear())
  const fyOptions = useMemo(() => financialYearSelectOptions(), [])
  const [tableTab, setTableTab] = useState<TableTab>('gst')
  const [listingControlsByTab, setListingControlsByTab] = useState<Record<TableTab, ListingControls>>(
    () => ({
      all: emptyListingControls(),
      gst: emptyListingControls(),
      clientTds: emptyListingControls(),
      vendorTds: emptyListingControls(),
    }),
  )

  const listingControls = listingControlsByTab[tableTab]
  const invoiceSortField = listingControls.sortField
  const invoiceSortDirection = listingControls.sortDirection
  const invoiceColFilters = listingControls.filters

  const scopeParams = useMemo(() => {
    const p: Record<string, string | undefined> = {}
    if (filterProjectId) p.projectId = filterProjectId
    return p
  }, [filterProjectId])

  const chartParams = useMemo(
    () => ({ ...scopeParams, fyStartYear: String(fyStartYear) }),
    [scopeParams, fyStartYear],
  )

  useEffect(() => {
    void (async () => {
      try {
        const res = await financeApi.getProjectDropdown()
        const items = unwrapApiList<{ value: string; label: string }>(res.data)
        setProjectOptions(items.map((item) => ({ value: item.value, label: item.label })))
      } catch {
        setProjectOptions([])
      }
    })()
  }, [])

  const loadOverview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryRes, chartRes, breakdownRes] = await Promise.all([
        financeApi.getFillingSummary(scopeParams),
        financeApi.getFillingSummaryChart(chartParams),
        financeApi.getFillingSummaryPeriodBreakdown(chartParams),
      ])
      setKpis(unwrapApiData<FillingSummaryKpis>(summaryRes.data))
      setMonthlyChart(unwrapApiList<FillingSummaryChartPoint>(chartRes.data))
      setBreakdown(unwrapApiData<FillingSummaryPeriodBreakdown>(breakdownRes.data))
    } catch {
      setError('Could not load compliance data.')
      setKpis(null)
      setMonthlyChart([])
      setBreakdown(null)
    } finally {
      setLoading(false)
    }
  }, [scopeParams, chartParams])

  const loadTable = useCallback(async () => {
    try {
      const listParams = { ...scopeParams, limit: 100 }
      if (tableTab === 'gst') {
        const gstRes = await financeApi.getFillingSummaryList({ ...listParams, type: 'gst' })
        setGstEntries(unwrapApiList<GlobalGstEntry>(gstRes.data))
        setClientTdsEntries([])
        setVendorTdsEntries([])
        return
      }
      if (tableTab === 'clientTds') {
        const clientRes = await financeApi.getFillingSummaryList({
          ...listParams,
          type: 'client_tds',
        })
        setClientTdsEntries(unwrapApiList<GlobalTdsClientEntry>(clientRes.data))
        setGstEntries([])
        setVendorTdsEntries([])
        return
      }
      if (tableTab === 'vendorTds') {
        const vendorRes = await financeApi.getFillingSummaryList({
          ...listParams,
          type: 'vendor_tds',
        })
        setVendorTdsEntries(unwrapApiList<GlobalTdsVendorEntry>(vendorRes.data))
        setGstEntries([])
        setClientTdsEntries([])
        return
      }
      const [gstRes, clientRes, vendorRes] = await Promise.all([
        financeApi.getFillingSummaryList({ ...listParams, type: 'gst' }),
        financeApi.getFillingSummaryList({ ...listParams, type: 'client_tds' }),
        financeApi.getFillingSummaryList({ ...listParams, type: 'vendor_tds' }),
      ])
      setGstEntries(unwrapApiList<GlobalGstEntry>(gstRes.data))
      setClientTdsEntries(unwrapApiList<GlobalTdsClientEntry>(clientRes.data))
      setVendorTdsEntries(unwrapApiList<GlobalTdsVendorEntry>(vendorRes.data))
    } catch {
      setError('Could not load compliance data.')
      setGstEntries([])
      setClientTdsEntries([])
      setVendorTdsEntries([])
    }
  }, [scopeParams, tableTab])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadTable()
  }, [loadTable])

  const gstCollected = kpis?.totalGst ?? 0
  const clientTds = kpis?.clientTdsTotal ?? 0
  const vendorTds = kpis?.vendorTdsTotal ?? 0
  const netTax = gstCollected - clientTds - vendorTds
  const netPositive = netTax >= 0

  const fyTotals = useMemo(() => {
    const periods = breakdown?.periods ?? []
    const fyGst = periods.reduce((s, p) => s + p.gst, 0)
    const fyClientTds = periods.reduce((s, p) => s + p.clientTds, 0)
    const fyVendorTds = periods.reduce((s, p) => s + p.vendorTds, 0)
    return {
      fyGst,
      fyClientTds,
      fyVendorTds,
      fyNet: fyGst - fyClientTds - fyVendorTds,
    }
  }, [breakdown])

  const chartData = useMemo(
    () => (periodMode === 'monthly' ? monthlyChart : groupChartByQuarter(monthlyChart)),
    [monthlyChart, periodMode],
  )

  const gstFilterOptions = useMemo(
    () => ({
      invoiceNumber: uniqueFilterOptions(gstEntries.map((e) => e.invoiceNumber)),
      projectName: uniqueFilterOptions(gstEntries.map((e) => e.projectName)),
      clientName: uniqueFilterOptions(gstEntries.map((e) => e.clientName)),
      invoiceDate: uniqueFilterOptions(gstEntries.map((e) => e.invoiceDate.slice(0, 10))),
      baseAmount: uniqueFilterOptions(gstEntries.map((e) => e.baseAmount)),
      gstRate: uniqueFilterOptions(gstEntries.map((e) => e.gstRate)).map((opt) => ({
        value: opt.value,
        label: `${opt.value}%`,
      })),
      gstAmount: uniqueFilterOptions(gstEntries.map((e) => e.gstAmount)),
      status: uniqueFilterOptions(gstEntries.map((e) => e.status)),
    }),
    [gstEntries],
  )

  const clientTdsFilterOptions = useMemo(
    () => ({
      invoiceNumber: uniqueFilterOptions(clientTdsEntries.map((e) => e.invoiceNumber)),
      projectName: uniqueFilterOptions(clientTdsEntries.map((e) => e.projectName)),
      clientName: uniqueFilterOptions(clientTdsEntries.map((e) => e.clientName)),
      invoiceDate: uniqueFilterOptions(clientTdsEntries.map((e) => e.invoiceDate.slice(0, 10))),
      grossAmount: uniqueFilterOptions(clientTdsEntries.map((e) => e.grossAmount)),
      tdsRate: uniqueFilterOptions(clientTdsEntries.map((e) => e.tdsRate)).map((opt) => ({
        value: opt.value,
        label: `${opt.value}%`,
      })),
      tdsAmount: uniqueFilterOptions(clientTdsEntries.map((e) => e.tdsAmount)),
      status: uniqueFilterOptions(clientTdsEntries.map((e) => e.status)),
    }),
    [clientTdsEntries],
  )

  const vendorTdsFilterOptions = useMemo(() => {
    const refs = vendorTdsEntries.map(
      (e) => e.invoiceNumber?.trim() || e.referenceNumber?.trim() || '—',
    )
    return {
      invoiceNumber: uniqueFilterOptions(refs),
      projectName: uniqueFilterOptions(vendorTdsEntries.map((e) => e.projectName)),
      vendorName: uniqueFilterOptions(vendorTdsEntries.map((e) => e.vendorName)),
      paymentDate: uniqueFilterOptions(vendorTdsEntries.map((e) => e.paymentDate.slice(0, 10))),
      invoiceTotal: uniqueFilterOptions(vendorTdsEntries.map((e) => e.invoiceTotal)),
      tdsRate: uniqueFilterOptions(vendorTdsEntries.map((e) => e.tdsRate)).map((opt) => ({
        value: opt.value,
        label: `${opt.value}%`,
      })),
      tdsAmount: uniqueFilterOptions(vendorTdsEntries.map((e) => e.tdsAmount)),
      status: uniqueFilterOptions(vendorTdsEntries.map((e) => e.status || 'paid')),
    }
  }, [vendorTdsEntries])

  const allMergedRows = useMemo(() => {
    const out: AllMergedRow[] = []
    for (const e of gstEntries) {
      out.push({
        id: `g-${e.invoiceId}`,
        sortDate: e.invoiceDate,
        date: e.invoiceDate,
        ref: e.invoiceNumber,
        projectName: e.projectName,
        party: e.clientName,
        type: 'gst',
        typeLabel: 'GST',
        base: e.baseAmount,
        tax: e.gstAmount,
        status: e.status,
      })
    }
    for (const e of clientTdsEntries) {
      out.push({
        id: `c-${e.invoiceId}`,
        sortDate: e.invoiceDate,
        date: e.invoiceDate,
        ref: e.invoiceNumber,
        projectName: e.projectName,
        party: e.clientName,
        type: 'clientTds',
        typeLabel: 'Client TDS',
        base: e.grossAmount,
        tax: e.tdsAmount,
        status: e.status,
      })
    }
    for (const e of vendorTdsEntries) {
      out.push({
        id: `v-${e.paymentId}`,
        sortDate: e.paymentDate,
        date: e.paymentDate,
        ref: e.invoiceNumber?.trim() || e.referenceNumber?.trim() || '—',
        projectName: e.projectName,
        party: e.vendorName,
        type: 'vendorTds',
        typeLabel: 'Vendor TDS',
        base: e.invoiceTotal,
        tax: e.tdsAmount,
        status: e.status || 'paid',
      })
    }
    out.sort((a, b) => b.sortDate.localeCompare(a.sortDate))
    return out
  }, [gstEntries, clientTdsEntries, vendorTdsEntries])

  const allFilterOptions = useMemo(
    () => ({
      date: uniqueFilterOptions(allMergedRows.map((e) => e.date.slice(0, 10))),
      ref: uniqueFilterOptions(allMergedRows.map((e) => e.ref)),
      projectName: uniqueFilterOptions(allMergedRows.map((e) => e.projectName)),
      party: uniqueFilterOptions(allMergedRows.map((e) => e.party)),
      type: uniqueFilterOptions(allMergedRows.map((e) => e.typeLabel)),
      base: uniqueFilterOptions(allMergedRows.map((e) => e.base)),
      tax: uniqueFilterOptions(allMergedRows.map((e) => e.tax)),
      status: uniqueFilterOptions(allMergedRows.map((e) => e.status)),
    }),
    [allMergedRows],
  )

  const displayedGstEntries = useMemo(() => {
    const f = listingControlsByTab.gst.filters
    const rows = gstEntries.filter(
      (e) =>
        matchesExactFilter(f.invoiceNumber, e.invoiceNumber) &&
        matchesExactFilter(f.projectName, e.projectName) &&
        matchesExactFilter(f.clientName, e.clientName) &&
        matchesDateFilter(f.invoiceDate, e.invoiceDate) &&
        matchesExactFilter(f.baseAmount, e.baseAmount) &&
        matchesExactFilter(f.gstRate, e.gstRate) &&
        matchesExactFilter(f.gstAmount, e.gstAmount) &&
        matchesExactFilter(f.status, e.status),
    )
    return sortByField(rows, listingControlsByTab.gst.sortField, listingControlsByTab.gst.sortDirection)
  }, [gstEntries, listingControlsByTab.gst])

  const displayedClientTdsEntries = useMemo(() => {
    const f = listingControlsByTab.clientTds.filters
    const rows = clientTdsEntries.filter(
      (e) =>
        matchesExactFilter(f.invoiceNumber, e.invoiceNumber) &&
        matchesExactFilter(f.projectName, e.projectName) &&
        matchesExactFilter(f.clientName, e.clientName) &&
        matchesDateFilter(f.invoiceDate, e.invoiceDate) &&
        matchesExactFilter(f.grossAmount, e.grossAmount) &&
        matchesExactFilter(f.tdsRate, e.tdsRate) &&
        matchesExactFilter(f.tdsAmount, e.tdsAmount) &&
        matchesExactFilter(f.status, e.status),
    )
    return sortByField(
      rows,
      listingControlsByTab.clientTds.sortField,
      listingControlsByTab.clientTds.sortDirection,
    )
  }, [clientTdsEntries, listingControlsByTab.clientTds])

  const displayedVendorTdsEntries = useMemo(() => {
    const f = listingControlsByTab.vendorTds.filters
    const rows = vendorTdsEntries.filter((e) => {
      const ref = e.invoiceNumber?.trim() || e.referenceNumber?.trim() || '—'
      return (
        matchesExactFilter(f.invoiceNumber, ref) &&
        matchesExactFilter(f.projectName, e.projectName) &&
        matchesExactFilter(f.vendorName, e.vendorName) &&
        matchesDateFilter(f.paymentDate, e.paymentDate) &&
        matchesExactFilter(f.invoiceTotal, e.invoiceTotal) &&
        matchesExactFilter(f.tdsRate, e.tdsRate) &&
        matchesExactFilter(f.tdsAmount, e.tdsAmount) &&
        matchesExactFilter(f.status, e.status || 'paid')
      )
    })
    return sortByField(
      rows,
      listingControlsByTab.vendorTds.sortField,
      listingControlsByTab.vendorTds.sortDirection,
      (row, field) => {
        if (field === 'invoiceNumber') {
          return row.invoiceNumber?.trim() || row.referenceNumber?.trim() || '—'
        }
        if (field === 'status') return row.status || 'paid'
        return (row as unknown as Record<string, unknown>)[field]
      },
    )
  }, [vendorTdsEntries, listingControlsByTab.vendorTds])

  const displayedAllMergedRows = useMemo(() => {
    const f = listingControlsByTab.all.filters
    const rows = allMergedRows.filter(
      (e) =>
        matchesDateFilter(f.date, e.date) &&
        matchesExactFilter(f.ref, e.ref) &&
        matchesExactFilter(f.projectName, e.projectName) &&
        matchesExactFilter(f.party, e.party) &&
        matchesExactFilter(f.type, e.typeLabel) &&
        matchesExactFilter(f.base, e.base) &&
        matchesExactFilter(f.tax, e.tax) &&
        matchesExactFilter(f.status, e.status),
    )
    return sortByField(
      rows,
      listingControlsByTab.all.sortField,
      listingControlsByTab.all.sortDirection,
      (row, field) => {
        if (field === 'type') return row.typeLabel
        return (row as unknown as Record<string, unknown>)[field]
      },
    )
  }, [allMergedRows, listingControlsByTab.all])

  const gstFooterTotals = useMemo(
    () => ({
      base: displayedGstEntries.reduce((s, e) => s + e.baseAmount, 0),
      gst: displayedGstEntries.reduce((s, e) => s + e.gstAmount, 0),
    }),
    [displayedGstEntries],
  )

  const clientTdsFooter = useMemo(
    () => ({
      invoice: displayedClientTdsEntries.reduce((s, e) => s + e.grossAmount, 0),
      tds: displayedClientTdsEntries.reduce((s, e) => s + e.tdsAmount, 0),
    }),
    [displayedClientTdsEntries],
  )

  const vendorTdsFooter = useMemo(
    () => ({
      invoice: displayedVendorTdsEntries.reduce((s, e) => s + e.invoiceTotal, 0),
      tds: displayedVendorTdsEntries.reduce((s, e) => s + e.tdsAmount, 0),
    }),
    [displayedVendorTdsEntries],
  )

  async function exportCurrentTab() {
    const stamp = dayjs().format('YYYY-MM-DD')
    if (tableTab === 'all') {
      downloadCsv(`filing-all-entries-${stamp}.csv`, [
        ['Date', 'Invoice/Ref', 'Project', 'Party', 'Type', 'Base amount', 'GST / TDS amount', 'Status'],
        ...displayedAllMergedRows.map((r) => [
          r.date,
          r.ref,
          r.projectName,
          r.party,
          r.typeLabel,
          r.base,
          r.tax,
          r.status,
        ]),
      ])
      return
    }
    try {
      const type = TAB_TO_LIST_TYPE[tableTab]
      const sortField = listingControlsByTab[tableTab].sortField
      const sortDirection = listingControlsByTab[tableTab].sortDirection
      const res = await financeApi.exportFillingSummary({
        type,
        ...(filterProjectId ? { projectId: filterProjectId } : {}),
        ...(sortField ? { sortBy: sortField, sortOrder: sortDirection } : {}),
      })
      downloadBlob(
        res.data as Blob,
        filenameFromDisposition(res.headers['content-disposition'], `filling-summary-${type}.csv`),
      )
    } catch {
      setError('Could not export filling summary.')
    }
  }

  function handleInvoiceSort(field: string, direction: 'asc' | 'desc') {
    setListingControlsByTab((prev) => ({
      ...prev,
      [tableTab]: { ...prev[tableTab], sortField: field, sortDirection: direction },
    }))
  }

  function handleInvoiceColumnFilter(field: string) {
    return (value: string) => {
      setListingControlsByTab((prev) => {
        const current = prev[tableTab]
        const nextFilters = { ...current.filters }
        if (!value) delete nextFilters[field]
        else nextFilters[field] = value
        return {
          ...prev,
          [tableTab]: { ...current, filters: nextFilters },
        }
      })
    }
  }

  function resetInvoiceListingControls() {
    setListingControlsByTab((prev) => ({
      ...prev,
      [tableTab]: emptyListingControls(),
    }))
  }

  const hasInvoiceListingControls =
    Boolean(invoiceSortField) || Object.keys(invoiceColFilters).length > 0

  const pillSx = (active: boolean) => ({
    border: '1px solid',
    borderColor: active ? tokens.color.primary[500] : tokens.color.neutral[200],
    bgcolor: active ? tokens.color.primary[50] : 'background.paper',
    color: 'text.primary',
    px: 2,
    py: 0.75,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  })

  return (
    <Box sx={{ p: { xs: 2, md: 3, lg: 4 }, maxWidth: 1920, mx: 'auto' }}>
      <Stack direction="row" alignItems="flex-start" gap={2} sx={{ mb: 3 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            bgcolor: tokens.color.primary[100],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ShieldCheck size={20} strokeWidth={1.75} color={tokens.color.primary[600]} />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, fontSize: { xs: 20, md: 22 } }}>
            Filing Summary
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Overall GST and TDS position across all projects
          </Typography>
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        {loading
          ? [0, 1, 2, 3].map((i) => (
              <Box
                key={i}
                sx={{
                  p: 2,
                  border: `1px solid ${tokens.color.neutral[100]}`,
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                }}
              >
                <Skeleton width="60%" height={14} />
                <Skeleton width="80%" height={28} sx={{ mt: 1 }} />
              </Box>
            ))
          : [
              { label: 'GST Collected', value: gstCollected, valueColor: undefined as string | undefined },
              { label: 'Client TDS Deducted', value: clientTds, valueColor: undefined },
              { label: 'Vendor TDS Deducted', value: vendorTds, valueColor: undefined },
              {
                label: 'Net Tax Position',
                value: netTax,
                valueColor: netPositive ? 'success.main' : 'error.main',
              },
            ].map((m) => (
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
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                fontSize: 15,
                mt: 0.5,
                color: m.valueColor ?? 'text.primary',
              }}
            >
              ₹{formatInr(m.value)}
            </Typography>
          </Box>
        ))}
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ mb: 3 }} alignItems="stretch">
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            p: 2,
            border: `1px solid ${tokens.color.neutral[100]}`,
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Monthly trend
            </Typography>
            <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap">
              <Select
                size="sm"
                value={String(fyStartYear)}
                onChange={(v) => {
                  const next = Number(v)
                  if (Number.isInteger(next)) setFyStartYear(next)
                }}
                options={fyOptions}
                sx={{ minWidth: 180 }}
              />
              <Box
                component="button"
                type="button"
                onClick={() => setPeriodMode('monthly')}
                sx={pillSx(periodMode === 'monthly')}
              >
                Monthly
              </Box>
              <Box
                component="button"
                type="button"
                onClick={() => setPeriodMode('quarterly')}
                sx={pillSx(periodMode === 'quarterly')}
              >
                Quarterly
              </Box>
            </Stack>
          </Stack>
          <Box sx={{ width: 1, height: 360 }}>
            {loading ? (
              <Skeleton variant="rounded" width="100%" height="100%" />
            ) : chartData.length === 0 ? (
              <Stack height="100%" alignItems="center" justifyContent="center">
                <Typography variant="body2" color="text.secondary">
                  No period data for this selection.
                </Typography>
              </Stack>
            ) : (
              <ResponsiveContainer
                key={`${periodMode}-${filterProjectId || 'all'}-${fyStartYear}`}
                width="100%"
                height="100%"
              >
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.neutral[200]} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={axisTickInr} width={56} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v, name) => [`₹${formatInr(Number(v ?? 0))}`, String(name)]}
                    labelStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="gst" name="GST" fill={CHART_GST} />
                  <Bar dataKey="tds" name="TDS" fill={CHART_TDS} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            p: 2,
            border: `1px solid ${tokens.color.neutral[100]}`,
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            Period breakdown
          </Typography>
          <Stack spacing={1} sx={{ mb: 2 }}>
            <Select
              size="sm"
              fullWidth
              value={String(fyStartYear)}
              onChange={(v) => {
                const next = Number(v)
                if (Number.isInteger(next)) setFyStartYear(next)
              }}
              options={fyOptions}
            />
            <Select
              placeholder="All"
              size="sm"
              fullWidth
              clearable
              value={filterProjectId}
              onChange={(v) => setFilterProjectId(v ? String(v) : '')}
              options={projectOptions}
            />
          </Stack>
          <Stack gap={1}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                GST on client invoices
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(gstCollected)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                TDS deducted by clients
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(clientTds)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                TDS deducted on vendors
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(vendorTds)}
              </Typography>
            </Stack>
            <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, my: 1 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                Net tax position
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: netPositive ? 'success.main' : 'error.main',
                }}
              >
                ₹{formatInr(netTax)}
              </Typography>
            </Stack>
          </Stack>

          {(breakdown?.periods.length ?? 0) > 0 ? (
            <>
              <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, my: 2 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
                Monthly breakdown
              </Typography>
              <Stack gap={0.75} sx={{ mt: 1, maxHeight: 160, overflow: 'auto' }}>
                {breakdown?.periods.map((row) => (
                  <Stack key={`${row.year}-${row.month}`} direction="row" justifyContent="space-between" gap={1}>
                    <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {row.period}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600 }}>
                      GST ₹{formatInr(row.gst)} · TDS ₹{formatInr(row.clientTds + row.vendorTds)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </>
          ) : !loading ? (
            <>
              <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, my: 2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                No monthly breakdown data for this selection.
              </Typography>
            </>
          ) : null}

          <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, my: 2 }} />

          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
            {selectedFyHeading(fyStartYear)}
          </Typography>
          <Stack gap={1} sx={{ mt: 1 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                GST on client invoices
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(fyTotals.fyGst)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                TDS deducted by clients
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(fyTotals.fyClientTds)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                TDS deducted on vendors
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(fyTotals.fyVendorTds)}
              </Typography>
            </Stack>
            <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, my: 1 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                Net tax position
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: fyTotals.fyNet >= 0 ? 'success.main' : 'error.main',
                }}
              >
                ₹{formatInr(fyTotals.fyNet)}
              </Typography>
            </Stack>
          </Stack>
        </Box>
      </Stack>

      <Box
        sx={{
          border: `1px solid ${tokens.color.neutral[100]}`,
          borderRadius: 2,
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
          sx={{ p: 2, borderBottom: `1px solid ${tokens.color.neutral[100]}` }}
        >
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {(
              [
                ['all', 'All Entries'],
                ['gst', 'GST'],
                ['clientTds', 'Client TDS'],
                ['vendorTds', 'Vendor TDS'],
              ] as const
            ).map(([id, label]) => (
              <Box
                key={id}
                component="button"
                type="button"
                onClick={() => setTableTab(id)}
                sx={pillSx(tableTab === id)}
              >
                {label}
              </Box>
            ))}
          </Stack>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            {hasInvoiceListingControls ? (
              <Button
                size="sm"
                variant="outlined"
                color="secondary"
                label="Reset filters"
                onClick={resetInvoiceListingControls}
              />
            ) : null}
            <Button
              size="sm"
              variant="outlined"
              color="primary"
              label="Export CSV"
              startIcon={<FileSpreadsheet size={14} strokeWidth={2} />}
              onClick={() => void exportCurrentTab()}
            />
          </Stack>
        </Stack>

        <Table size="small">
          {tableTab === 'all' && (
            <>
              <TableHead>
                <TableRow>
                  <FilterableSortHeader
                    label="Date"
                    field="date"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterMode="date"
                    filterValue={invoiceColFilters.date ?? ''}
                    filterOptions={allFilterOptions.date}
                    onFilter={handleInvoiceColumnFilter('date')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice/Ref"
                    field="ref"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.ref ?? ''}
                    filterOptions={allFilterOptions.ref}
                    onFilter={handleInvoiceColumnFilter('ref')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.projectName ?? ''}
                    filterOptions={allFilterOptions.projectName}
                    onFilter={handleInvoiceColumnFilter('projectName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Party"
                    field="party"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.party ?? ''}
                    filterOptions={allFilterOptions.party}
                    onFilter={handleInvoiceColumnFilter('party')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Type"
                    field="type"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.type ?? ''}
                    filterOptions={allFilterOptions.type}
                    onFilter={handleInvoiceColumnFilter('type')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Base amount"
                    field="base"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.base ?? ''}
                    filterOptions={allFilterOptions.base}
                    onFilter={handleInvoiceColumnFilter('base')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="GST / TDS amount"
                    field="tax"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.tax ?? ''}
                    filterOptions={allFilterOptions.tax}
                    onFilter={handleInvoiceColumnFilter('tax')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="Status"
                    field="status"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.status ?? ''}
                    filterOptions={allFilterOptions.status}
                    onFilter={handleInvoiceColumnFilter('status')}
                    sx={TABLE_HEADER_SX}
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading &&
                  [...Array(6)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(8)].map((__, j) => (
                        <TableCell key={j} sx={TABLE_CELL_SX}>
                          <Skeleton height={20} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {!loading &&
                  displayedAllMergedRows.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell sx={TABLE_CELL_SX}>{formatDate(r.date)}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{r.ref}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{r.projectName}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{r.party}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>
                        {r.type === 'gst' && (
                          <Tag label="GST" size="sm" color={tokens.color.success[500]} />
                        )}
                        {r.type === 'clientTds' && (
                          <Tag label="Client TDS" size="sm" color={tokens.color.warning[500]} />
                        )}
                        {r.type === 'vendorTds' && (
                          <Tag label="Vendor TDS" size="sm" color={tokens.color.info[600]} />
                        )}
                      </TableCell>
                      <TableCell sx={TABLE_CELL_SX} align="right">
                        ₹{formatInr(r.base)}
                      </TableCell>
                      <TableCell sx={TABLE_CELL_SX} align="right">
                        ₹{formatInr(r.tax)}
                      </TableCell>
                      <TableCell sx={TABLE_CELL_SX}>
                        <StatusBadge
                          status={invoiceStatusToBadgeType(r.status as ClientInvoice['status'])}
                          label={r.status}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                {!loading && displayedAllMergedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                      No entries
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </>
          )}

          {tableTab === 'gst' && (
            <>
              <TableHead>
                <TableRow>
                  <FilterableSortHeader
                    label="Invoice no."
                    field="invoiceNumber"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.invoiceNumber ?? ''}
                    filterOptions={gstFilterOptions.invoiceNumber}
                    onFilter={handleInvoiceColumnFilter('invoiceNumber')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.projectName ?? ''}
                    filterOptions={gstFilterOptions.projectName}
                    onFilter={handleInvoiceColumnFilter('projectName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Client"
                    field="clientName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.clientName ?? ''}
                    filterOptions={gstFilterOptions.clientName}
                    onFilter={handleInvoiceColumnFilter('clientName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice date"
                    field="invoiceDate"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterMode="date"
                    filterValue={invoiceColFilters.invoiceDate ?? ''}
                    filterOptions={gstFilterOptions.invoiceDate}
                    onFilter={handleInvoiceColumnFilter('invoiceDate')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Base amount"
                    field="baseAmount"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.baseAmount ?? ''}
                    filterOptions={gstFilterOptions.baseAmount}
                    onFilter={handleInvoiceColumnFilter('baseAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="GST rate"
                    field="gstRate"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.gstRate ?? ''}
                    filterOptions={gstFilterOptions.gstRate}
                    onFilter={handleInvoiceColumnFilter('gstRate')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="GST amount"
                    field="gstAmount"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.gstAmount ?? ''}
                    filterOptions={gstFilterOptions.gstAmount}
                    onFilter={handleInvoiceColumnFilter('gstAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="Status"
                    field="status"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.status ?? ''}
                    filterOptions={gstFilterOptions.status}
                    onFilter={handleInvoiceColumnFilter('status')}
                    sx={TABLE_HEADER_SX}
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading
                  ? [...Array(6)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(8)].map((__, j) => (
                          <TableCell key={j} sx={TABLE_CELL_SX}>
                            <Skeleton height={20} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : displayedGstEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                          No invoices
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedGstEntries.map((e) => (
                  <TableRow key={e.invoiceId} hover>
                    <TableCell sx={TABLE_CELL_SX}>
                      <Typography
                        component="button"
                        type="button"
                        onClick={() => navigate('/finance/receivables')}
                        sx={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: tokens.color.success[600],
                          cursor: 'pointer',
                          border: 'none',
                          bgcolor: 'transparent',
                          p: 0,
                          textAlign: 'left',
                          textDecoration: 'underline',
                        }}
                      >
                        {e.invoiceNumber}
                      </Typography>
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{e.projectName}</TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{e.clientName}</TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{formatDate(e.invoiceDate)}</TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      ₹{formatInr(e.baseAmount)}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      {e.gstRate}%
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      ₹{formatInr(e.gstAmount)}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX}>
                      <StatusBadge
                        status={invoiceStatusToBadgeType(e.status as ClientInvoice['status'])}
                        label={e.status}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                      ))
                    )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ ...TABLE_CELL_SX, fontWeight: 700 }}>
                    Total
                  </TableCell>
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700 }} align="right">
                    ₹{formatInr(gstFooterTotals.base)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700 }} align="right">
                    ₹{formatInr(gstFooterTotals.gst)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                </TableRow>
              </TableFooter>
            </>
          )}

          {tableTab === 'clientTds' && (
            <>
              <TableHead>
                <TableRow>
                  <FilterableSortHeader
                    label="Invoice no."
                    field="invoiceNumber"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.invoiceNumber ?? ''}
                    filterOptions={clientTdsFilterOptions.invoiceNumber}
                    onFilter={handleInvoiceColumnFilter('invoiceNumber')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.projectName ?? ''}
                    filterOptions={clientTdsFilterOptions.projectName}
                    onFilter={handleInvoiceColumnFilter('projectName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Client"
                    field="clientName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.clientName ?? ''}
                    filterOptions={clientTdsFilterOptions.clientName}
                    onFilter={handleInvoiceColumnFilter('clientName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice date"
                    field="invoiceDate"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterMode="date"
                    filterValue={invoiceColFilters.invoiceDate ?? ''}
                    filterOptions={clientTdsFilterOptions.invoiceDate}
                    onFilter={handleInvoiceColumnFilter('invoiceDate')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice amount"
                    field="grossAmount"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.grossAmount ?? ''}
                    filterOptions={clientTdsFilterOptions.grossAmount}
                    onFilter={handleInvoiceColumnFilter('grossAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS rate"
                    field="tdsRate"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.tdsRate ?? ''}
                    filterOptions={clientTdsFilterOptions.tdsRate}
                    onFilter={handleInvoiceColumnFilter('tdsRate')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS amount"
                    field="tdsAmount"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.tdsAmount ?? ''}
                    filterOptions={clientTdsFilterOptions.tdsAmount}
                    onFilter={handleInvoiceColumnFilter('tdsAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="Status"
                    field="status"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.status ?? ''}
                    filterOptions={clientTdsFilterOptions.status}
                    onFilter={handleInvoiceColumnFilter('status')}
                    sx={TABLE_HEADER_SX}
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading
                  ? [...Array(6)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(8)].map((__, j) => (
                          <TableCell key={j} sx={TABLE_CELL_SX}>
                            <Skeleton height={20} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : displayedClientTdsEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                          No invoices
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedClientTdsEntries.map((e) => (
                  <TableRow key={e.invoiceId} hover>
                    <TableCell sx={TABLE_CELL_SX}>
                      <Typography
                        component="button"
                        type="button"
                        onClick={() => navigate('/finance/receivables')}
                        sx={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: tokens.color.success[600],
                          cursor: 'pointer',
                          border: 'none',
                          bgcolor: 'transparent',
                          p: 0,
                          textAlign: 'left',
                          textDecoration: 'underline',
                        }}
                      >
                        {e.invoiceNumber}
                      </Typography>
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{e.projectName}</TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{e.clientName}</TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{formatDate(e.invoiceDate)}</TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      ₹{formatInr(e.grossAmount)}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      {e.tdsRate}%
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      ₹{formatInr(e.tdsAmount)}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX}>
                      <StatusBadge
                        status={invoiceStatusToBadgeType(e.status as ClientInvoice['status'])}
                        label={e.status}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                      ))
                    )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ ...TABLE_CELL_SX, fontWeight: 700 }}>
                    Total
                  </TableCell>
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700 }} align="right">
                    ₹{formatInr(clientTdsFooter.invoice)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700 }} align="right">
                    ₹{formatInr(clientTdsFooter.tds)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                </TableRow>
              </TableFooter>
            </>
          )}

          {tableTab === 'vendorTds' && (
            <>
              <TableHead>
                <TableRow>
                  <FilterableSortHeader
                    label="Invoice/Ref"
                    field="invoiceNumber"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.invoiceNumber ?? ''}
                    filterOptions={vendorTdsFilterOptions.invoiceNumber}
                    onFilter={handleInvoiceColumnFilter('invoiceNumber')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.projectName ?? ''}
                    filterOptions={vendorTdsFilterOptions.projectName}
                    onFilter={handleInvoiceColumnFilter('projectName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Vendor"
                    field="vendorName"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.vendorName ?? ''}
                    filterOptions={vendorTdsFilterOptions.vendorName}
                    onFilter={handleInvoiceColumnFilter('vendorName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Payment date"
                    field="paymentDate"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterMode="date"
                    filterValue={invoiceColFilters.paymentDate ?? ''}
                    filterOptions={vendorTdsFilterOptions.paymentDate}
                    onFilter={handleInvoiceColumnFilter('paymentDate')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice total"
                    field="invoiceTotal"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.invoiceTotal ?? ''}
                    filterOptions={vendorTdsFilterOptions.invoiceTotal}
                    onFilter={handleInvoiceColumnFilter('invoiceTotal')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS rate"
                    field="tdsRate"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.tdsRate ?? ''}
                    filterOptions={vendorTdsFilterOptions.tdsRate}
                    onFilter={handleInvoiceColumnFilter('tdsRate')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS amount"
                    field="tdsAmount"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.tdsAmount ?? ''}
                    filterOptions={vendorTdsFilterOptions.tdsAmount}
                    onFilter={handleInvoiceColumnFilter('tdsAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="Status"
                    field="status"
                    sortField={invoiceSortField}
                    sortDirection={invoiceSortDirection}
                    onSort={handleInvoiceSort}
                    filterValue={invoiceColFilters.status ?? ''}
                    filterOptions={vendorTdsFilterOptions.status}
                    onFilter={handleInvoiceColumnFilter('status')}
                    sx={TABLE_HEADER_SX}
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading
                  ? [...Array(6)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(8)].map((__, j) => (
                          <TableCell key={j} sx={TABLE_CELL_SX}>
                            <Skeleton height={20} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : displayedVendorTdsEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                          No invoices
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedVendorTdsEntries.map((e) => (
                  <TableRow key={e.paymentId} hover>
                    <TableCell sx={TABLE_CELL_SX}>
                      {e.invoiceNumber?.trim() || e.referenceNumber?.trim() || '—'}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{e.projectName}</TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{e.vendorName}</TableCell>
                    <TableCell sx={TABLE_CELL_SX}>{formatDate(e.paymentDate)}</TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      ₹{formatInr(e.invoiceTotal)}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      {e.tdsRate}%
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX} align="right">
                      ₹{formatInr(e.tdsAmount)}
                    </TableCell>
                    <TableCell sx={TABLE_CELL_SX}>
                      <StatusBadge
                        status={invoiceStatusToBadgeType((e.status || 'paid') as ClientInvoice['status'])}
                        label={e.status || 'paid'}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                      ))
                    )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ ...TABLE_CELL_SX, fontWeight: 700 }}>
                    Total
                  </TableCell>
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700 }} align="right">
                    ₹{formatInr(vendorTdsFooter.invoice)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700 }} align="right">
                    ₹{formatInr(vendorTdsFooter.tds)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                </TableRow>
              </TableFooter>
            </>
          )}
        </Table>
      </Box>
    </Box>
  )
}
