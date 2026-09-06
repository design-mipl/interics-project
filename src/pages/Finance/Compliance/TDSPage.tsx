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
} from '@mui/material'
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
import { Landmark } from 'lucide-react'
import { Button, Drawer, Select, StatusBadge } from '@/design-system/components'
import type { StatusType } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { FilterableSortHeader } from '@/components/listing'
import { financeApi } from '@/api/financeApi'
import { unwrapApiData, unwrapApiList } from '@/modules/system-settings/shared/api'
import type {
  GlobalTdsClientEntry,
  GlobalTdsVendorEntry,
  TdsChartPoint,
  TdsListType,
  TdsPeriodBreakdown,
  TdsSummary,
} from '@/slices/finance/types'
import { formatDate, formatInr } from '@/utils/formatters'
import {
  currentIndianFyStartYear,
  emptyListingControls,
  financialYearSelectOptions,
  hasActiveListingControls,
  indianFyQuarterLabel,
  listingFieldValue,
  matchesDateFilter,
  matchesExactFilter,
  parseChartPeriod,
  percentFilterOptions,
  selectedFyHeading,
  sortByField,
  uniqueFilterOptions,
  type ListingControls,
} from './complianceListingUtils'

const CHART_CLIENT_TDS = '#EF9F27'
const CHART_VENDOR_TDS = '#7F77DD'
const LINK_TEAL = '#1D9E75'

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

function groupTdsChartByQuarter(rows: TdsChartPoint[]): TdsChartPoint[] {
  const map = new Map<string, TdsChartPoint>()
  for (const row of rows) {
    const parsed = parseChartPeriod(row.period)
    const label = parsed ? indianFyQuarterLabel(parsed) : row.period
    const prev = map.get(label) ?? { period: label, clientTds: 0, vendorTds: 0 }
    prev.clientTds += row.clientTds
    prev.vendorTds += row.vendorTds
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

function filenameFromDisposition(header: unknown, fallback: string) {
  if (typeof header !== 'string') return fallback
  const match = header.match(/filename="?([^";]+)"?/i)
  return match?.[1]?.trim() || fallback
}

function axisTickInr(v: number) {
  return `₹${formatInr(v)}`
}

function entryStatusToBadge(status: string): StatusType {
  const s = status.replace(/-/g, '_').toLowerCase()
  if (s === 'paid') return 'paid'
  if (s === 'overdue') return 'overdue'
  if (s === 'draft') return 'invoice_draft'
  if (s === 'sent') return 'sent'
  if (s === 'partially_paid') return 'partially_paid'
  if (s === 'unpaid' || s === 'not_paid') return 'unpaid'
  return 'pending'
}

export default function TDSPage() {
  const [filterProjectId, setFilterProjectId] = useState('')
  const [projectOptions, setProjectOptions] = useState<Array<{ label: string; value: string }>>([])
  const [kpis, setKpis] = useState<TdsSummary | null>(null)
  const [monthlyChart, setMonthlyChart] = useState<TdsChartPoint[]>([])
  const [breakdown, setBreakdown] = useState<TdsPeriodBreakdown | null>(null)
  const [clientRows, setClientRows] = useState<GlobalTdsClientEntry[]>([])
  const [vendorRows, setVendorRows] = useState<GlobalTdsVendorEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly')
  const [fyStartYear, setFyStartYear] = useState(() => currentIndianFyStartYear())
  const fyOptions = useMemo(() => financialYearSelectOptions(), [])
  const [tableTab, setTableTab] = useState<TdsListType>('client')
  const [drawerEntry, setDrawerEntry] = useState<GlobalTdsClientEntry | null>(null)
  const [listingControlsByTab, setListingControlsByTab] = useState<
    Record<TdsListType, ListingControls>
  >(() => ({
    client: emptyListingControls(),
    vendor: emptyListingControls(),
  }))

  const listingControls = listingControlsByTab[tableTab]
  const sortField = listingControls.sortField
  const sortDirection = listingControls.sortDirection
  const colFilters = listingControls.filters

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
        financeApi.getTdsSummary(scopeParams),
        financeApi.getTdsChart(chartParams),
        financeApi.getTdsPeriodBreakdown(chartParams),
      ])
      setKpis(unwrapApiData<TdsSummary>(summaryRes.data))
      setMonthlyChart(unwrapApiList<TdsChartPoint>(chartRes.data))
      setBreakdown(unwrapApiData<TdsPeriodBreakdown>(breakdownRes.data))
    } catch {
      setError('Could not load TDS data.')
      setKpis(null)
      setMonthlyChart([])
      setBreakdown(null)
    } finally {
      setLoading(false)
    }
  }, [scopeParams, chartParams])

  const loadTable = useCallback(async () => {
    try {
      const listParams = { ...scopeParams, limit: 100, type: tableTab }
      const res = await financeApi.getTdsList(listParams)
      if (tableTab === 'client') {
        setClientRows(unwrapApiList<GlobalTdsClientEntry>(res.data))
        setVendorRows([])
        return
      }
      setVendorRows(unwrapApiList<GlobalTdsVendorEntry>(res.data))
      setClientRows([])
    } catch {
      setError('Could not load TDS data.')
      setClientRows([])
      setVendorRows([])
    }
  }, [scopeParams, tableTab])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadTable()
  }, [loadTable])

  const chartData = useMemo(
    () => (periodMode === 'monthly' ? monthlyChart : groupTdsChartByQuarter(monthlyChart)),
    [monthlyChart, periodMode],
  )

  const clientFilterOptions = useMemo(
    () => ({
      invoiceNumber: uniqueFilterOptions(clientRows.map((e) => e.invoiceNumber)),
      projectName: uniqueFilterOptions(clientRows.map((e) => e.projectName)),
      clientName: uniqueFilterOptions(clientRows.map((e) => e.clientName)),
      invoiceDate: uniqueFilterOptions(clientRows.map((e) => e.invoiceDate.slice(0, 10))),
      grossAmount: uniqueFilterOptions(clientRows.map((e) => e.grossAmount)),
      tdsRate: percentFilterOptions(clientRows.map((e) => e.tdsRate)),
      tdsAmount: uniqueFilterOptions(clientRows.map((e) => e.tdsAmount)),
      status: uniqueFilterOptions(clientRows.map((e) => e.status)),
    }),
    [clientRows],
  )

  const vendorFilterOptions = useMemo(() => {
    const refs = vendorRows.map(
      (e) => e.invoiceNumber?.trim() || e.referenceNumber?.trim() || '—',
    )
    return {
      invoiceNumber: uniqueFilterOptions(refs),
      projectName: uniqueFilterOptions(vendorRows.map((e) => e.projectName)),
      vendorName: uniqueFilterOptions(vendorRows.map((e) => e.vendorName)),
      paymentDate: uniqueFilterOptions(vendorRows.map((e) => e.paymentDate.slice(0, 10))),
      invoiceTotal: uniqueFilterOptions(vendorRows.map((e) => e.invoiceTotal)),
      tdsRate: percentFilterOptions(vendorRows.map((e) => e.tdsRate)),
      tdsAmount: uniqueFilterOptions(vendorRows.map((e) => e.tdsAmount)),
      status: uniqueFilterOptions(vendorRows.map((e) => e.status || 'paid')),
    }
  }, [vendorRows])

  const displayedClientRows = useMemo(() => {
    const f = listingControlsByTab.client.filters
    const rows = clientRows.filter(
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
      listingControlsByTab.client.sortField,
      listingControlsByTab.client.sortDirection,
    )
  }, [clientRows, listingControlsByTab.client])

  const displayedVendorRows = useMemo(() => {
    const f = listingControlsByTab.vendor.filters
    const rows = vendorRows.filter((e) => {
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
      listingControlsByTab.vendor.sortField,
      listingControlsByTab.vendor.sortDirection,
      (row, field) => {
        if (field === 'invoiceNumber') {
          return row.invoiceNumber?.trim() || row.referenceNumber?.trim() || '—'
        }
        if (field === 'status') return row.status || 'paid'
        return listingFieldValue(row, field)
      },
    )
  }, [vendorRows, listingControlsByTab.vendor])

  const footerClient = useMemo(
    () => ({
      invoice: displayedClientRows.reduce((s, e) => s + e.grossAmount, 0),
      tds: displayedClientRows.reduce((s, e) => s + e.tdsAmount, 0),
    }),
    [displayedClientRows],
  )
  const footerVendor = useMemo(
    () => ({
      invoice: displayedVendorRows.reduce((s, e) => s + e.invoiceTotal, 0),
      tds: displayedVendorRows.reduce((s, e) => s + e.tdsAmount, 0),
    }),
    [displayedVendorRows],
  )

  async function exportCurrentTab() {
    try {
      const res = await financeApi.exportTds({
        type: tableTab,
        ...(filterProjectId ? { projectId: filterProjectId } : {}),
        ...(sortField ? { sortBy: sortField, sortOrder: sortDirection } : {}),
      })
      downloadBlob(
        res.data as Blob,
        filenameFromDisposition(res.headers['content-disposition'], `tds-${tableTab}.csv`),
      )
    } catch {
      setError('Could not export TDS data.')
    }
  }

  function handleSort(field: string, direction: 'asc' | 'desc') {
    setListingControlsByTab((prev) => ({
      ...prev,
      [tableTab]: { ...prev[tableTab], sortField: field, sortDirection: direction },
    }))
  }

  function handleColumnFilter(field: string) {
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

  function resetListingControls() {
    setListingControlsByTab((prev) => ({
      ...prev,
      [tableTab]: emptyListingControls(),
    }))
  }

  const hasListingControls = hasActiveListingControls(listingControls)

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

  const totalTds = kpis?.total ?? (kpis?.clientTdsTotal ?? 0) + (kpis?.vendorTdsTotal ?? 0)

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
          <Landmark size={20} strokeWidth={1.75} color={tokens.color.primary[600]} />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, fontSize: { xs: 20, md: 22 } }}>
            TDS
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            TDS deducted by clients and on vendors
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
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        {[
          { label: 'Client TDS Deducted', value: kpis?.clientTdsTotal ?? 0 },
          { label: 'Vendor TDS Deducted', value: kpis?.vendorTdsTotal ?? 0 },
          { label: 'Total TDS', value: totalTds },
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
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 15, mt: 0.5 }}>
              ₹{formatInr(m.value)}
            </Typography>
          </Box>
        ))}
      </Box>

      <Stack direction={{ xs: 'column', lg: 'row' }} gap={2} sx={{ mb: 3 }} alignItems="stretch">
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
              Client TDS vs Vendor TDS
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
          <Box sx={{ width: 1, height: 340 }}>
            {loading ? (
              <Typography variant="body2" color="text.secondary">
                Loading chart…
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.neutral[200]} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={axisTickInr} width={56} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value, name) => [
                      `₹${formatInr(Number(value ?? 0))}`,
                      String(name),
                    ]}
                    labelStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="clientTds" name="Client TDS" fill={CHART_CLIENT_TDS} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="vendorTds" name="Vendor TDS" fill={CHART_VENDOR_TDS} radius={[2, 2, 0, 0]} />
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
            TDS Breakdown
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

          <Stack spacing={1.25}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: CHART_CLIENT_TDS, fontWeight: 600 }}>
                TDS deducted by clients
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600, color: CHART_CLIENT_TDS }}>
                ₹{formatInr(breakdown?.clientTdsTotal ?? kpis?.clientTdsTotal ?? 0)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: CHART_VENDOR_TDS, fontWeight: 600 }}>
                TDS deducted on vendors
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600, color: CHART_VENDOR_TDS }}>
                ₹{formatInr(breakdown?.vendorTdsTotal ?? kpis?.vendorTdsTotal ?? 0)}
              </Typography>
            </Stack>
            <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, pt: 1 }}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                  Total TDS
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                  ₹{formatInr(breakdown?.total ?? totalTds)}
                </Typography>
              </Stack>
            </Box>
          </Stack>

          <Box sx={{ borderTop: `1px solid ${tokens.color.neutral[100]}`, my: 2 }} />

          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.5 }}>
            {selectedFyHeading(fyStartYear)}
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                TDS deducted by clients
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(breakdown?.fy.clientTds ?? 0)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, color: 'text.secondary' }}>
                TDS deducted on vendors
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>
                ₹{formatInr(breakdown?.fy.vendorTds ?? 0)}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                Total TDS this FY
              </Typography>
              <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700 }}>
                ₹{formatInr(breakdown?.fy.total ?? 0)}
              </Typography>
            </Stack>
          </Stack>
        </Box>
      </Stack>

      <Box
        sx={{
          p: 2,
          border: `1px solid ${tokens.color.neutral[100]}`,
          borderRadius: 2,
          bgcolor: 'background.paper',
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={2} sx={{ mb: 2 }}>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            <Box component="button" type="button" onClick={() => setTableTab('client')} sx={pillSx(tableTab === 'client')}>
              Client TDS
            </Box>
            <Box component="button" type="button" onClick={() => setTableTab('vendor')} sx={pillSx(tableTab === 'vendor')}>
              Vendor TDS
            </Box>
          </Stack>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            {hasListingControls ? (
              <Button variant="outlined" color="secondary" size="sm" onClick={resetListingControls}>
                Reset filters
              </Button>
            ) : null}
            <Button variant="outlined" color="secondary" size="sm" onClick={() => void exportCurrentTab()}>
              Export CSV
            </Button>
          </Stack>
        </Stack>

        <Table size="small">
          {tableTab === 'client' && (
            <>
              <TableHead>
                <TableRow>
                  <FilterableSortHeader
                    label="Invoice no."
                    field="invoiceNumber"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.invoiceNumber ?? ''}
                    filterOptions={clientFilterOptions.invoiceNumber}
                    onFilter={handleColumnFilter('invoiceNumber')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.projectName ?? ''}
                    filterOptions={clientFilterOptions.projectName}
                    onFilter={handleColumnFilter('projectName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Client name"
                    field="clientName"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.clientName ?? ''}
                    filterOptions={clientFilterOptions.clientName}
                    onFilter={handleColumnFilter('clientName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice date"
                    field="invoiceDate"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterMode="date"
                    filterValue={colFilters.invoiceDate ?? ''}
                    filterOptions={clientFilterOptions.invoiceDate}
                    onFilter={handleColumnFilter('invoiceDate')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice amount"
                    field="grossAmount"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.grossAmount ?? ''}
                    filterOptions={clientFilterOptions.grossAmount}
                    onFilter={handleColumnFilter('grossAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS rate"
                    field="tdsRate"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.tdsRate ?? ''}
                    filterOptions={clientFilterOptions.tdsRate}
                    onFilter={handleColumnFilter('tdsRate')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS amount"
                    field="tdsAmount"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.tdsAmount ?? ''}
                    filterOptions={clientFilterOptions.tdsAmount}
                    onFilter={handleColumnFilter('tdsAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="Status"
                    field="status"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.status ?? ''}
                    filterOptions={clientFilterOptions.status}
                    onFilter={handleColumnFilter('status')}
                    sx={TABLE_HEADER_SX}
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4 }}>
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : displayedClientRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                      No client TDS rows.
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedClientRows.map((e) => (
                    <TableRow key={e.invoiceId} hover>
                      <TableCell sx={TABLE_CELL_SX}>
                        <Button
                          variant="text"
                          color="primary"
                          size="sm"
                          onClick={() => setDrawerEntry(e)}
                          sx={{ color: LINK_TEAL, fontWeight: 600, p: 0, minWidth: 0 }}
                        >
                          {e.invoiceNumber}
                        </Button>
                      </TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{e.projectName}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{e.clientName}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{formatDate(e.invoiceDate)}</TableCell>
                      <TableCell sx={{ ...TABLE_CELL_SX, textAlign: 'right' }}>₹{formatInr(e.grossAmount)}</TableCell>
                      <TableCell sx={{ ...TABLE_CELL_SX, textAlign: 'right' }}>{e.tdsRate}%</TableCell>
                      <TableCell sx={{ ...TABLE_CELL_SX, textAlign: 'right' }}>₹{formatInr(e.tdsAmount)}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>
                        <StatusBadge status={entryStatusToBadge(e.status)} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ ...TABLE_CELL_SX, fontWeight: 700 }}>
                    TOTAL
                  </TableCell>
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700, textAlign: 'right' }}>
                    ₹{formatInr(footerClient.invoice)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700, textAlign: 'right' }}>
                    ₹{formatInr(footerClient.tds)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                </TableRow>
              </TableFooter>
            </>
          )}

          {tableTab === 'vendor' && (
            <>
              <TableHead>
                <TableRow>
                  <FilterableSortHeader
                    label="Invoice/Ref"
                    field="invoiceNumber"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.invoiceNumber ?? ''}
                    filterOptions={vendorFilterOptions.invoiceNumber}
                    onFilter={handleColumnFilter('invoiceNumber')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.projectName ?? ''}
                    filterOptions={vendorFilterOptions.projectName}
                    onFilter={handleColumnFilter('projectName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Vendor name"
                    field="vendorName"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.vendorName ?? ''}
                    filterOptions={vendorFilterOptions.vendorName}
                    onFilter={handleColumnFilter('vendorName')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Payment date"
                    field="paymentDate"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterMode="date"
                    filterValue={colFilters.paymentDate ?? ''}
                    filterOptions={vendorFilterOptions.paymentDate}
                    onFilter={handleColumnFilter('paymentDate')}
                    sx={TABLE_HEADER_SX}
                  />
                  <FilterableSortHeader
                    label="Invoice total"
                    field="invoiceTotal"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.invoiceTotal ?? ''}
                    filterOptions={vendorFilterOptions.invoiceTotal}
                    onFilter={handleColumnFilter('invoiceTotal')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS rate"
                    field="tdsRate"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.tdsRate ?? ''}
                    filterOptions={vendorFilterOptions.tdsRate}
                    onFilter={handleColumnFilter('tdsRate')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="TDS amount"
                    field="tdsAmount"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.tdsAmount ?? ''}
                    filterOptions={vendorFilterOptions.tdsAmount}
                    onFilter={handleColumnFilter('tdsAmount')}
                    sx={{ ...TABLE_HEADER_SX, textAlign: 'right' }}
                  />
                  <FilterableSortHeader
                    label="Status"
                    field="status"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    filterValue={colFilters.status ?? ''}
                    filterOptions={vendorFilterOptions.status}
                    onFilter={handleColumnFilter('status')}
                    sx={TABLE_HEADER_SX}
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4 }}>
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : displayedVendorRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ ...TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                      No vendor TDS rows.
                    </TableCell>
                  </TableRow>
                ) : (
                  displayedVendorRows.map((e) => (
                    <TableRow key={e.paymentId} hover>
                      <TableCell sx={TABLE_CELL_SX}>
                        {e.invoiceNumber?.trim() || e.referenceNumber?.trim() || '—'}
                      </TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{e.projectName}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{e.vendorName}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>{formatDate(e.paymentDate)}</TableCell>
                      <TableCell sx={{ ...TABLE_CELL_SX, textAlign: 'right' }}>₹{formatInr(e.invoiceTotal)}</TableCell>
                      <TableCell sx={{ ...TABLE_CELL_SX, textAlign: 'right' }}>{e.tdsRate}%</TableCell>
                      <TableCell sx={{ ...TABLE_CELL_SX, textAlign: 'right' }}>₹{formatInr(e.tdsAmount)}</TableCell>
                      <TableCell sx={TABLE_CELL_SX}>
                        <StatusBadge status={entryStatusToBadge(e.status || 'paid')} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={{ ...TABLE_CELL_SX, fontWeight: 700 }}>
                    TOTAL
                  </TableCell>
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700, textAlign: 'right' }}>
                    ₹{formatInr(footerVendor.invoice)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                  <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 700, textAlign: 'right' }}>
                    ₹{formatInr(footerVendor.tds)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX} />
                </TableRow>
              </TableFooter>
            </>
          )}
        </Table>
      </Box>

      <Drawer
        open={Boolean(drawerEntry)}
        onClose={() => setDrawerEntry(null)}
        title="Invoice"
        subtitle={drawerEntry?.invoiceNumber}
        width={440}
        footer={
          <Stack direction="row" justifyContent="flex-end" sx={{ width: 1 }}>
            <Button variant="outlined" color="secondary" size="sm" onClick={() => setDrawerEntry(null)}>
              Close
            </Button>
          </Stack>
        }
      >
        {drawerEntry && (
          <Stack spacing={2} sx={{ p: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Project
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {drawerEntry.projectName}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Client
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {drawerEntry.clientName}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Invoice date
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                {formatDate(drawerEntry.invoiceDate)}
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <Box flex={1}>
                <Typography variant="caption" color="text.secondary">
                  Invoice amount (gross)
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  ₹{formatInr(drawerEntry.grossAmount)}
                </Typography>
              </Box>
              <Box flex={1}>
                <Typography variant="caption" color="text.secondary">
                  TDS rate
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {drawerEntry.tdsRate}%
                </Typography>
              </Box>
            </Stack>
            <Box>
              <Typography variant="caption" color="text.secondary">
                TDS amount
              </Typography>
              <Typography variant="body2" fontWeight={600}>
                ₹{formatInr(drawerEntry.tdsAmount)}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Status
              </Typography>
              <StatusBadge status={entryStatusToBadge(drawerEntry.status)} />
            </Box>
          </Stack>
        )}
      </Drawer>
    </Box>
  )
}
