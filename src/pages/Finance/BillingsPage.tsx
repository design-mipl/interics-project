import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Stack,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Skeleton,
  IconButton as MuiIconButton,
  Menu,
  MenuItem,
  Divider,
  Alert,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RequestQuoteIcon from '@mui/icons-material/RequestQuote'
import DraftsIcon from '@mui/icons-material/Drafts'
import { useTheme, alpha } from '@mui/material/styles'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { TrendingUp, Plus } from 'lucide-react'
import dayjs from 'dayjs'
import { ListingTemplate, KpiStatCard } from '@/components/templates'
import type { FilterField, ColumnItem } from '@/components/templates/ListingTemplate'
import {
  FilterableSortHeader,
  isInvalidDateRange,
  clampListingPage1Based,
  type ColumnFilterOption,
} from '@/components/listing'
import { StatusBadge, Modal, Button, DatePicker, Select, useToast } from '@/design-system/components'
import type { StatusType } from '@/design-system/components'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  setFilters,
  setSortConfig,
  clearSelected,
  clearListResults,
  setPage,
  setPageSize,
} from '@/slices/receivables/reducer'
import { convertDraftToTax, deleteInvoice, fetchInvoiceById, fetchInvoices, sendInvoice } from '@/slices/receivables/thunk'
import { fetchCustomers } from '@/slices/customers/thunk'
import type { Invoice } from '@/slices/receivables/reducer'
import { formatInr } from '@/utils/formatters'
import { financeApi } from '@/api/financeApi'
import { tokens } from '@/design-system/tokens'
import { CreateInvoiceDrawer } from './components/CreateInvoiceDrawer'
import { InvoiceDetailDrawer } from './components/InvoiceDetailDrawer'
import { FinanceRecordClientInvoicePaymentModal } from './components/FinanceRecordClientInvoicePaymentModal'
import type { ReceivableSummaryKpis } from './utils/receivableSummary'
import {
  resolveReceivableKpiDateRange,
  mergeReceivableListDateParams,
  type ReceivableKpiPeriod,
} from './utils/receivableKpiDateRange'
import { receivablesApi } from '@/api/receivablesApi'
import { dropdownsApi } from '@/api/dropdownsApi'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import { downloadCsv } from '@/api/downloadCsv'
import { invoiceStatusToBadgeType, mapInvoiceStatus, showPartialPaidAlongsideTabStatus } from './invoiceStatus'
import { financeReceivableNetAmount, financeReceivableOutstanding } from './utils/financeReceivableListingAmounts'
import { usePermission } from '@/hooks/usePermission'
import { downloadClientInvoiceDocument } from '@/pages/Projects/tabs/live/downloadClientInvoice'

const KPI_PERIOD_OPTIONS: { label: string; value: ReceivableKpiPeriod }[] = [
  { label: 'Today', value: 'Today' },
  { label: 'This Week', value: 'This Week' },
  { label: 'This Month', value: 'This Month' },
  { label: 'This Year', value: 'This Year' },
  { label: 'Custom Date Range', value: 'Custom Date Range' },
]

function isPendingGeneration(inv: Pick<Invoice, 'id' | 'pendingGeneration'>): boolean {
  return Boolean(inv.pendingGeneration) || inv.id.startsWith('pending:')
}

function invoiceMilestoneLabel(inv: Invoice): string {
  if (inv.milestoneName?.trim()) return inv.milestoneName.trim()
  const fromLines = (inv.lineItems ?? [])
    .map((li) => {
      const raw = (li.serviceName ?? '').trim()
      if (!raw) return ''
      const parts = raw.split(' — ')
      return (parts[0] || raw).trim()
    })
    .filter(Boolean)
  const unique = [...new Set(fromLines)]
  return unique.length ? unique.slice(0, 2).join(', ') : '—'
}

function formatListingDate(value: string | undefined): string {
  if (!value?.trim()) return '—'
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('DD MMM YYYY') : '—'
}

function isDueOverdue(inv: Invoice): boolean {
  if (inv.balance <= 0) return false
  return dayjs(inv.dueDate).isBefore(dayjs(), 'day')
}

/** Togglable columns (invoice no. + actions are always shown). */
type ReceivablesVisibleColumns = {
  clientName: boolean
  projectName: boolean
  milestoneName: boolean
  invoiceDate: boolean
  dueDate: boolean
  baseAmount: boolean
  gstAmount: boolean
  totalAmount: boolean
  totalReceived: boolean
  balance: boolean
  status: boolean
}

type ReceivablesColumnFilters = {
  invoiceNo: string
  clientId: string
  projectId: string
  invoiceDate: string
  dueDate: string
  baseAmount: string
  gstAmount: string
  totalAmount: string
  received: string
  netReceivable: string
  status: string
}

function toColumnFilterOptions(
  options?: Array<{ value: string | number | boolean; label: string }>,
): ColumnFilterOption[] {
  return (options ?? []).map((option) => ({
    value: String(option.value),
    label: option.label,
  }))
}

function toExactNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function mainInvoiceTableColumnCount(v: ReceivablesVisibleColumns): number {
  const toggles = Object.values(v).filter(Boolean).length
  return 1 + toggles + 1
}

function buildReceivablesListColumns(visible: ReceivablesVisibleColumns): string[] {
  return [
    'id',
    'invoiceNo',
    ...(visible.clientName ? (['clientName', 'clientId'] as const) : []),
    ...(visible.projectName ? (['projectName', 'projectId'] as const) : []),
    ...(visible.milestoneName ? (['milestoneName', 'milestoneId'] as const) : []),
    ...(visible.invoiceDate ? (['invoiceDate'] as const) : []),
    ...(visible.dueDate ? (['dueDate'] as const) : []),
    ...(visible.baseAmount ? (['baseAmount'] as const) : []),
    ...(visible.gstAmount ? (['gstAmount'] as const) : []),
    ...(visible.totalAmount ? (['totalAmount'] as const) : []),
    ...(visible.totalReceived ? (['totalReceived', 'received'] as const) : []),
    ...(visible.balance ? (['balance', 'netReceivable'] as const) : []),
    ...(visible.status ? (['status'] as const) : []),
  ]
}

const menuItemSx = { fontSize: 12, minHeight: 32, py: 0.5 }
const LISTING_EDGE_PAD = '14px'
const ACTION_WIDTH_PX = 72

const CENTER_CELL_CONTENT_SX = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: 1,
} as const

const HEADER_CELL_SX = {
  fontSize: 11,
  fontWeight: 600,
  color: 'text.secondary',
  py: 1,
  px: 1.75,
  borderBottom: `2px solid ${tokens.color.neutral[100]}`,
}
const BODY_CELL_SX = { fontSize: 12, py: 1, px: 1.75 }

const HEADER_ACTION_SX = {
  width: ACTION_WIDTH_PX,
  minWidth: ACTION_WIDTH_PX,
  maxWidth: ACTION_WIDTH_PX,
  ...HEADER_CELL_SX,
  whiteSpace: 'nowrap',
  position: 'sticky',
  right: 0,
  bgcolor: 'background.default',
  zIndex: 2,
  textAlign: 'center',
  verticalAlign: 'middle',
  pl: 0,
  pr: LISTING_EDGE_PAD,
}

const BODY_ACTION_SX = {
  ...BODY_CELL_SX,
  width: ACTION_WIDTH_PX,
  minWidth: ACTION_WIDTH_PX,
  maxWidth: ACTION_WIDTH_PX,
  position: 'sticky',
  right: 0,
  bgcolor: 'background.paper',
  zIndex: 1,
  textAlign: 'center',
  verticalAlign: 'middle',
  pl: 0,
  pr: LISTING_EDGE_PAD,
}

function isDraftEquivalentInvoice(inv: Pick<Invoice, 'status'>): boolean {
  return inv.status === 'draft' || inv.status === 'uploaded'
}

function RowActions({
  inv,
  onView,
  onPay,
  onSend,
  onConvertTax,
  onPdf,
  canEdit,
  onDelete,
  canDelete,
}: {
  inv: Invoice
  onView: () => void
  onPay: () => void
  onSend: () => void
  onConvertTax: () => void
  onPdf: () => void
  canEdit: boolean
  onDelete: () => void
  canDelete: boolean
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const canRecordPayment = inv.status !== 'draft' && inv.status !== 'paid' && inv.balance > 0
  const canMarkSent = inv.status === 'draft'
  const canConvertTax = inv.status === 'draft'
  const canDeleteInvoice = canDelete && isDraftEquivalentInvoice(inv)
  const showEditActions = canEdit && (canRecordPayment || canConvertTax || canMarkSent)
  const showRestrictedActions = showEditActions || canDeleteInvoice

  return (
    <Box sx={CENTER_CELL_CONTENT_SX}>
      <MuiIconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation()
          setAnchor(e.currentTarget)
        }}
        aria-label="More actions"
        sx={{ p: 0.25 }}
      >
        <MoreVertIcon sx={{ fontSize: 14 }} />
      </MuiIconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
        slotProps={{ paper: { elevation: 2 } }}
      >
        <MenuItem
          sx={menuItemSx}
          onClick={() => {
            onView()
            setAnchor(null)
          }}
        >
          View
        </MenuItem>
        {canEdit && canRecordPayment && (
          <MenuItem
            sx={menuItemSx}
            onClick={() => {
              onPay()
              setAnchor(null)
            }}
          >
            Record Payment
          </MenuItem>
        )}
        <MenuItem
          sx={menuItemSx}
          onClick={() => {
            onPdf()
            setAnchor(null)
          }}
        >
          Download Invoice
        </MenuItem>
        {showRestrictedActions && (
          <>
            <Divider />
            {canEdit && canConvertTax && (
              <MenuItem
                sx={menuItemSx}
                onClick={() => {
                  onConvertTax()
                  setAnchor(null)
                }}
              >
                Convert as tax invoice
              </MenuItem>
            )}
            {canEdit && canMarkSent && (
              <MenuItem
                sx={menuItemSx}
                onClick={() => {
                  onSend()
                  setAnchor(null)
                }}
              >
                Mark as Sent
              </MenuItem>
            )}
            {canDeleteInvoice && (
              <MenuItem
                sx={{ ...menuItemSx, color: 'error.main' }}
                onClick={() => {
                  onDelete()
                  setAnchor(null)
                }}
              >
                Delete
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </Box>
  )
}

export default function BillingsPage() {
  const dispatch = useAppDispatch()
  const { showToast } = useToast()
  const theme = useTheme()
  const canCreateReceivable = usePermission('receivables', 'create')
  const canEditReceivable = usePermission('receivables', 'edit')
  const canDeleteReceivable = usePermission('receivables', 'delete')
  const hoverBg = alpha(theme.palette.primary.main, 0.04)

  const { items: rawItems, loading, filters, sortConfig, pagination, saving, error: listError } =
    useAppSelector((s) => s.receivables)

  async function downloadInvoiceDocument(inv: Invoice) {
    try {
      let invoice = inv
      if (!invoice.lineItems?.length) {
        const loaded = await dispatch(fetchInvoiceById(invoice.id)).unwrap()
        invoice = {
          ...loaded,
          status: mapInvoiceStatus(loaded) as Invoice['status'],
          showPartialPaid: showPartialPaidAlongsideTabStatus(loaded),
        }
      }
      downloadClientInvoiceDocument({
        invoiceNumber: invoice.invoiceNo,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        projectName: invoice.projectName,
        clientName: invoice.clientName,
        notes: invoice.notes,
        milestoneName: invoice.milestoneName,
        serviceName: invoice.serviceName,
        lineItems: (invoice.lineItems ?? []).map((l) => ({
          serviceName: l.serviceName,
          amount: l.amount,
          labourCessRate: l.labourCessRate,
          gstRate: l.gstRate,
          labourCessAmount: l.labourCessAmount,
          taxableAmount: l.taxableAmount,
          gstAmount: l.gstAmount,
        })),
      })
    } catch {
      showToast({ title: 'Failed to download invoice', variant: 'error' })
    }
  }

  const items = useMemo(
    () =>
      (rawItems ?? []).map((inv) => ({
        ...inv,
        status: mapInvoiceStatus(inv) as Invoice['status'],
        showPartialPaid: showPartialPaidAlongsideTabStatus(inv),
      })),
    [rawItems],
  )
  const customers = useAppSelector((s) => s.customers.items ?? [])
  const [liveProjectOptions, setLiveProjectOptions] = useState<Array<{ value: string; label: string }>>([])
  const [filterOptions, setFilterOptions] = useState<Record<string, Array<{ value: string; label: string }>> | null>(null)

  const [drawerCreate, setDrawerCreate] = useState(false)
  const [generatePreset, setGeneratePreset] = useState<{
    projectId: string
    projectName?: string
    clientId?: string
    clientName?: string
    clientPoId?: string
    milestoneId?: string
  } | null>(null)
  const [drawerEdit, setDrawerEdit] = useState<Invoice | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [paymentInv, setPaymentInv] = useState<Invoice | null>(null)
  const [sendTarget, setSendTarget] = useState<Invoice | null>(null)
  const [convertTaxTarget, setConvertTaxTarget] = useState<Invoice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Invoice | null>(null)
  const [activeFilters, setActiveFilters] = useState<Record<string, unknown>>({})
  const [searchInput, setSearchInput] = useState(filters.search)
  const [columnFilters, setColumnFilters] = useState<ReceivablesColumnFilters>({
    invoiceNo: '',
    clientId: '',
    projectId: '',
    invoiceDate: '',
    dueDate: '',
    baseAmount: '',
    gstAmount: '',
    totalAmount: '',
    received: '',
    netReceivable: '',
    status: '',
  })
  const [kpiPeriod, setKpiPeriod] = useState<ReceivableKpiPeriod>('This Month')
  const [kpiCustomFrom, setKpiCustomFrom] = useState<Date | null>(null)
  const [kpiCustomTo, setKpiCustomTo] = useState<Date | null>(null)
  const [kpis, setKpis] = useState<ReceivableSummaryKpis>({
    totalPoValue: 0,
    receivedTillDate: 0,
    pending: 0,
    taxInvoiceRaised: 0,
    draftInvoiceSent: 0,
  })
  const [kpiLoading, setKpiLoading] = useState(true)
  const kpiDateBounds = useMemo(
    () => resolveReceivableKpiDateRange(kpiPeriod, kpiCustomFrom, kpiCustomTo),
    [kpiPeriod, kpiCustomFrom, kpiCustomTo],
  )
  const kpiQueryParams = useMemo(() => {
    if (!kpiDateBounds) return null
    const listDates = mergeReceivableListDateParams(
      kpiDateBounds,
      filters.dateFrom,
      filters.dateTo,
    )
    if (listDates.emptyIntersection) return { emptyIntersection: true as const }
    return {
      dateFrom: listDates.dateFrom,
      dateTo: listDates.dateTo,
      clientId: columnFilters.clientId || filters.clientId || undefined,
      projectId: columnFilters.projectId || filters.projectId || undefined,
      search: filters.search || undefined,
    }
  }, [
    kpiDateBounds,
    filters.dateFrom,
    filters.dateTo,
    filters.clientId,
    filters.projectId,
    filters.search,
    columnFilters.clientId,
    columnFilters.projectId,
  ])
  const kpiCustomIncomplete =
    kpiPeriod === 'Custom Date Range' && (!kpiCustomFrom || !kpiCustomTo)
  const kpiCustomInvalid =
    kpiPeriod === 'Custom Date Range' &&
    Boolean(kpiCustomFrom && kpiCustomTo) &&
    kpiDateBounds === null
  const [visibleColumns, setVisibleColumns] = useState<ReceivablesVisibleColumns>({
    clientName: true,
    projectName: true,
    milestoneName: true,
    invoiceDate: true,
    dueDate: true,
    baseAmount: false,
    gstAmount: false,
    totalAmount: true,
    totalReceived: false,
    balance: true,
    status: true,
  })
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const columnsConfig: ColumnItem[] = useMemo(
    () => [
      { field: 'clientName', label: 'Client', visible: visibleColumns.clientName },
      { field: 'projectName', label: 'Project', visible: visibleColumns.projectName },
      { field: 'milestoneName', label: 'Milestone', visible: visibleColumns.milestoneName },
      { field: 'invoiceDate', label: 'Invoice date', visible: visibleColumns.invoiceDate },
      { field: 'dueDate', label: 'Due date', visible: visibleColumns.dueDate },
      { field: 'baseAmount', label: 'Base', visible: visibleColumns.baseAmount },
      { field: 'gstAmount', label: 'GST', visible: visibleColumns.gstAmount },
      { field: 'totalAmount', label: 'Net Amount', visible: visibleColumns.totalAmount },
      { field: 'totalReceived', label: 'Received', visible: visibleColumns.totalReceived },
      { field: 'balance', label: 'Pending Amount', visible: visibleColumns.balance },
      { field: 'status', label: 'Status', visible: visibleColumns.status },
    ],
    [visibleColumns],
  )

  function handleColumnVisibilityChange(field: string, visible: boolean) {
    const key = field as keyof ReceivablesVisibleColumns
    if (!(key in visibleColumns)) return
    setVisibleColumns((prev) => ({ ...prev, [key]: visible }))
    dispatch(setPage(1))
  }

  const mainColCount = useMemo(() => mainInvoiceTableColumnCount(visibleColumns), [visibleColumns])

  function reload(overrides: {
    page?: number
    columnFilters?: Partial<ReceivablesColumnFilters>
    statusTab?: string
    clientId?: string
    projectId?: string
    visibleColumns?: ReceivablesVisibleColumns
    /** When true, list by newest created (ignore current column sort). */
    newestFirst?: boolean
  } = {}) {
    if (isInvalidDateRange(filters.dateFrom, filters.dateTo)) return
    const nextCols = { ...columnFilters, ...overrides.columnFilters }
    const rawPage = overrides.page ?? pagination.page
    const nextPage = clampListingPage1Based(rawPage, pagination.total, pagination.pageSize)
    if (nextPage !== pagination.page) dispatch(setPage(nextPage))
    const statusTab = overrides.statusTab ?? filters.statusTab
    const toolbarClientId = overrides.clientId !== undefined ? overrides.clientId : filters.clientId
    const toolbarProjectId =
      overrides.projectId !== undefined ? overrides.projectId : filters.projectId
    const visibility = overrides.visibleColumns ?? visibleColumns
    const listDates = mergeReceivableListDateParams(
      kpiDateBounds,
      filters.dateFrom,
      filters.dateTo,
    )
    if (listDates.emptyIntersection) {
      dispatch(clearListResults())
      return
    }
    const newestFirst = Boolean(overrides.newestFirst)
    dispatch(
      fetchInvoices({
        page: nextPage,
        pageSize: pagination.pageSize,
        status: nextCols.status || (statusTab === 'all' ? undefined : statusTab),
        search: filters.search || undefined,
        clientId: nextCols.clientId || toolbarClientId || undefined,
        projectId: nextCols.projectId || toolbarProjectId || undefined,
        dateFrom: listDates.dateFrom,
        dateTo: listDates.dateTo,
        amountMin: filters.amountMin || undefined,
        amountMax: filters.amountMax || undefined,
        invoiceNo: nextCols.invoiceNo || undefined,
        invoiceDate: nextCols.invoiceDate || undefined,
        dueDate: nextCols.dueDate || undefined,
        baseAmount: toExactNumber(nextCols.baseAmount),
        gstAmount: toExactNumber(nextCols.gstAmount),
        totalAmount: toExactNumber(nextCols.totalAmount),
        received: toExactNumber(nextCols.received),
        netReceivable: toExactNumber(nextCols.netReceivable),
        columns: buildReceivablesListColumns(visibility),
        sortBy: newestFirst ? undefined : sortConfig.field || undefined,
        sortOrder: newestFirst ? undefined : sortConfig.field ? sortConfig.direction : undefined,
      }),
    )
  }

  function refreshKpis() {
    if (!kpiQueryParams) {
      setKpiLoading(false)
      return
    }
    if ('emptyIntersection' in kpiQueryParams) {
      setKpiLoading(false)
      setKpis({
        totalPoValue: 0,
        receivedTillDate: 0,
        pending: 0,
        taxInvoiceRaised: 0,
        draftInvoiceSent: 0,
      })
      return
    }
    setKpiLoading(true)
    void financeApi
      .getReceivablesSummary(kpiQueryParams)
      .then((res) => {
        const data = unwrapApiData<ReceivableSummaryKpis>(res.data)
        if (data) setKpis(data)
      })
      .catch(() => undefined)
      .finally(() => setKpiLoading(false))
  }

  function reloadAfterMutation(options?: { showNewestFirst?: boolean }) {
    if (options?.showNewestFirst) {
      dispatch(setSortConfig({ field: null, direction: 'desc' }))
      dispatch(setPage(1))
      reload({ page: 1, newestFirst: true })
    } else {
      reload()
    }
    refreshKpis()
  }

  function openGenerateInvoice(inv: Invoice) {
    if (!canCreateReceivable) return
    setGeneratePreset({
      projectId: inv.projectId,
      projectName: inv.projectName,
      clientId: inv.clientId,
      clientName: inv.clientName,
      clientPoId: inv.clientPoId,
      milestoneId: inv.milestoneId,
    })
    setDrawerCreate(true)
  }

  function handleInvoiceRowClick(inv: Invoice) {
    if (isPendingGeneration(inv) && canCreateReceivable) {
      openGenerateInvoice(inv)
      return
    }
    setDetailId(inv.id)
  }

  const actionColSx = {
    ...HEADER_ACTION_SX,
    ...(filters.statusTab === 'draft'
      ? { width: 148, minWidth: 148, maxWidth: 148 }
      : {}),
  }
  const actionBodySx = {
    ...BODY_ACTION_SX,
    ...(filters.statusTab === 'draft'
      ? { width: 148, minWidth: 148, maxWidth: 148 }
      : {}),
  }

  useEffect(() => {
    dispatch(fetchCustomers({}))
    void dropdownsApi
      .getLiveProjects()
      .then((options) => setLiveProjectOptions(options.map((o) => ({ value: o.value, label: o.label }))))
      .catch(() => setLiveProjectOptions([]))
    void receivablesApi.getFilters().then(setFilterOptions).catch(() => setFilterOptions(null))
    setActiveFilters({
      clientId: '',
      projectId: '',
      dateFrom: '',
      dateTo: '',
      amountMin: '',
      amountMax: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pagination.page,
    pagination.pageSize,
    filters.statusTab,
    filters.search,
    filters.clientId,
    filters.projectId,
    filters.dateFrom,
    filters.dateTo,
    filters.amountMin,
    filters.amountMax,
    columnFilters.invoiceNo,
    columnFilters.clientId,
    columnFilters.projectId,
    columnFilters.invoiceDate,
    columnFilters.dueDate,
    columnFilters.baseAmount,
    columnFilters.gstAmount,
    columnFilters.totalAmount,
    columnFilters.received,
    columnFilters.netReceivable,
    columnFilters.status,
    sortConfig.field,
    sortConfig.direction,
    visibleColumns,
    kpiDateBounds,
  ])

  /** Global Date Range change always restarts listing at page 1. */
  useEffect(() => {
    dispatch(setPage(1))
  }, [kpiDateBounds, dispatch])

  useEffect(() => {
    if (!kpiQueryParams) {
      setKpiLoading(false)
      return
    }
    if ('emptyIntersection' in kpiQueryParams) {
      setKpiLoading(false)
      setKpis({
        totalPoValue: 0,
        receivedTillDate: 0,
        pending: 0,
        taxInvoiceRaised: 0,
        draftInvoiceSent: 0,
      })
      return
    }
    let cancelled = false
    setKpiLoading(true)
    void financeApi
      .getReceivablesSummary(kpiQueryParams)
      .then((res) => {
        const data = unwrapApiData<ReceivableSummaryKpis>(res.data)
        if (!cancelled && data) setKpis(data)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setKpiLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kpiQueryParams])

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])

  const clientOpts = useMemo(
    () => [{ label: 'All clients', value: '' }, ...customers.map((c) => ({ label: c.name, value: c.id }))],
    [customers],
  )
  const projectOpts = useMemo(
    () => [{ label: 'All projects', value: '' }, ...liveProjectOptions],
    [liveProjectOptions],
  )

  const filterConfig: FilterField[] = useMemo(
    () => [
      { field: 'clientId', label: 'Client', type: 'select', options: clientOpts },
      { field: 'projectId', label: 'Project', type: 'select', options: projectOpts },
      { field: 'dateFrom', label: 'Date from', type: 'date' },
      { field: 'dateTo', label: 'Date to', type: 'date' },
      { field: 'amountMin', label: 'Amount min', type: 'text' },
      { field: 'amountMax', label: 'Amount max', type: 'text' },
    ],
    [clientOpts, projectOpts],
  )

  const statCards = [
    {
      label: 'Total PO Value',
      value: `₹${formatInr(kpis.totalPoValue)}`,
      variant: 'default' as const,
      icon: <RequestQuoteIcon sx={{ fontSize: 24 }} />,
    },
    {
      label: 'Draft Invoice Sent',
      value: `₹${formatInr(kpis.draftInvoiceSent)}`,
      variant: 'purple' as const,
      icon: <DraftsIcon sx={{ fontSize: 24 }} />,
    },
    {
      label: 'Tax Invoice Raised',
      value: `₹${formatInr(kpis.taxInvoiceRaised)}`,
      variant: 'info' as const,
      icon: <ReceiptLongIcon sx={{ fontSize: 24 }} />,
    },
    {
      label: 'Received Till Date',
      value: `₹${formatInr(kpis.receivedTillDate)}`,
      variant: 'success' as const,
      icon: <CheckCircleIcon sx={{ fontSize: 24 }} />,
    },
    {
      label: 'Pending Invoiced Amount',
      value: `₹${formatInr(kpis.pending)}`,
      variant: 'warning' as const,
      icon: <WarningAmberIcon sx={{ fontSize: 24 }} />,
    },
  ]

  const kpiSummary = (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="flex-end"
        gap={1.5}
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.text.primary, 0.02),
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          gap={1}
          flexWrap="wrap"
          justifyContent="flex-end"
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}
          >
            Date Range
          </Typography>
          <Box sx={{ minWidth: { xs: '100%', sm: 180 } }}>
            <Select
              size="sm"
              value={kpiPeriod}
              onChange={(v) => {
                const next = String(v) as ReceivableKpiPeriod
                setKpiPeriod(next)
                if (next !== 'Custom Date Range') {
                  setKpiCustomFrom(null)
                  setKpiCustomTo(null)
                }
              }}
              options={KPI_PERIOD_OPTIONS}
              fullWidth
            />
          </Box>
          {kpiPeriod === 'Custom Date Range' ? (
            <>
              <DatePicker
                label="From"
                value={kpiCustomFrom}
                onChange={setKpiCustomFrom}
                size="sm"
              />
              <DatePicker label="To" value={kpiCustomTo} onChange={setKpiCustomTo} size="sm" />
            </>
          ) : null}
        </Stack>
      </Stack>

      <Box sx={{ p: 2 }}>
        {kpiCustomIncomplete ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Select a start and end date to update KPI values.
          </Typography>
        ) : null}
        {kpiCustomInvalid ? (
          <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
            End date must be on or after the start date.
          </Typography>
        ) : null}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              lg: `repeat(${Math.min(statCards.length, 5)}, 1fr)`,
            },
            gap: '12px',
          }}
        >
          {statCards.map((card) => (
            <KpiStatCard
              key={card.label}
              label={card.label}
              value={card.value}
              variant={card.variant}
              icon={card.icon}
              loading={kpiLoading}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )

  const tabs = [
    { label: 'All', value: 'all' },
    { label: 'Draft', value: 'draft' },
    { label: 'Tax', value: 'tax' },
    { label: 'Overdue', value: 'overdue' },
    { label: 'Paid', value: 'paid' },
  ]

  function handleSearchChange(v: string) {
    setSearchInput(v)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      dispatch(setPage(1))
      dispatch(setFilters({ search: v }))
    }, 300)
  }

  function handleFilterChange(next: Record<string, unknown>) {
    setActiveFilters(next)
    setColumnFilters((prev) => ({
      ...prev,
      clientId: String(next.clientId ?? ''),
      projectId: String(next.projectId ?? ''),
    }))
    dispatch(setPage(1))
    dispatch(
      setFilters({
        clientId: String(next.clientId ?? ''),
        projectId: String(next.projectId ?? ''),
        dateFrom: String(next.dateFrom ?? ''),
        dateTo: String(next.dateTo ?? ''),
        amountMin: String(next.amountMin ?? ''),
        amountMax: String(next.amountMax ?? ''),
      }),
    )
  }

  function handleFilterReset() {
    setActiveFilters({})
    setColumnFilters((prev) => ({ ...prev, clientId: '', projectId: '' }))
    dispatch(setPage(1))
    dispatch(
      setFilters({
        clientId: '',
        projectId: '',
        dateFrom: '',
        dateTo: '',
        amountMin: '',
        amountMax: '',
      }),
    )
  }

  function handleTabChange(v: string) {
    dispatch(setFilters({ statusTab: v }))
    dispatch(setPage(1))
  }

  function handleSort(field: string, direction: 'asc' | 'desc') {
    dispatch(setSortConfig({ field, direction }))
    dispatch(setPage(1))
  }

  const invoiceNoOptions = toColumnFilterOptions(filterOptions?.invoiceNos)
  const clientOptions = toColumnFilterOptions(filterOptions?.clients)
  const projectOptions = toColumnFilterOptions(filterOptions?.projects)
  const invoiceDateOptions = toColumnFilterOptions(filterOptions?.invoiceDates)
  const dueDateOptions = toColumnFilterOptions(filterOptions?.dueDates)
  const baseAmountOptions = toColumnFilterOptions(filterOptions?.baseAmounts)
  const gstAmountOptions = toColumnFilterOptions(filterOptions?.gstAmounts)
  const totalAmountOptions = toColumnFilterOptions(filterOptions?.totalAmounts)
  const receivedOptions = toColumnFilterOptions(filterOptions?.receivedAmounts)
  const netReceivableOptions = toColumnFilterOptions(filterOptions?.netReceivables)
  const statusOptions = toColumnFilterOptions(filterOptions?.statuses)

  function handleColumnFilter(field: keyof ReceivablesColumnFilters, value: string) {
    setColumnFilters((prev) => ({ ...prev, [field]: value }))
    dispatch(setPage(1))
    if (field === 'clientId' || field === 'projectId') {
      setActiveFilters((prev) => ({ ...prev, [field]: value }))
      dispatch(setFilters({ [field]: value }))
    }
    if (field === 'status') {
      dispatch(setFilters({ statusTab: value || 'all' }))
    }
    reload({
      page: 1,
      columnFilters: { [field]: value },
      ...(field === 'status' ? { statusTab: value || 'all' } : {}),
      ...(field === 'clientId' ? { clientId: value } : {}),
      ...(field === 'projectId' ? { projectId: value } : {}),
    })
  }

  function handleResetAll() {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    setSearchInput('')
    setActiveFilters({})
    setColumnFilters({
      invoiceNo: '',
      clientId: '',
      projectId: '',
      invoiceDate: '',
      dueDate: '',
      baseAmount: '',
      gstAmount: '',
      totalAmount: '',
      received: '',
      netReceivable: '',
      status: '',
    })
    dispatch(
      setFilters({
        search: '',
        clientId: '',
        projectId: '',
        dateFrom: '',
        dateTo: '',
        amountMin: '',
        amountMax: '',
      }),
    )
    dispatch(setSortConfig({ field: null, direction: 'asc' }))
    dispatch(setPage(1))
    setKpiPeriod('This Month')
    setKpiCustomFrom(null)
    setKpiCustomTo(null)
  }

  async function confirmSend() {
    if (!sendTarget) return
    try {
      await dispatch(sendInvoice(sendTarget.id)).unwrap()
      showToast({ title: 'Invoice sent', variant: 'success' })
      reloadAfterMutation()
    } catch (e) {
      showToast({ title: String(e), variant: 'error' })
    }
    setSendTarget(null)
  }

  async function confirmConvertTax() {
    if (!convertTaxTarget) return
    try {
      await dispatch(convertDraftToTax(convertTaxTarget.id)).unwrap()
      showToast({ title: 'Converted to tax invoice', variant: 'success' })
      reloadAfterMutation()
    } catch (e) {
      showToast({ title: String(e), variant: 'error' })
    }
    setConvertTaxTarget(null)
  }

  async function confirmDeleteInvoice() {
    if (!deleteTarget || !canDeleteReceivable) return
    try {
      await dispatch(deleteInvoice(deleteTarget.id)).unwrap()
      showToast({ title: 'Invoice deleted', variant: 'success' })
      const nextPage = clampListingPage1Based(
        pagination.page,
        Math.max(0, pagination.total - 1),
        pagination.pageSize,
      )
      reload({ page: nextPage })
      refreshKpis()
    } catch (e) {
      showToast({ title: String(e), variant: 'error' })
    }
    setDeleteTarget(null)
  }

  const detailOpen = Boolean(detailId)

  async function handleExport() {
    const listDates = mergeReceivableListDateParams(
      kpiDateBounds,
      filters.dateFrom,
      filters.dateTo,
    )
    if (listDates.emptyIntersection) {
      showToast({ title: 'No invoices to export for the selected dates', variant: 'error' })
      return
    }
    try {
      await downloadCsv(
        '/invoices/export',
        {
          status: columnFilters.status || (filters.statusTab === 'all' ? undefined : filters.statusTab),
          search: filters.search || undefined,
          clientId: columnFilters.clientId || filters.clientId || undefined,
          projectId: columnFilters.projectId || filters.projectId || undefined,
          dateFrom: listDates.dateFrom,
          dateTo: listDates.dateTo,
          invoiceNo: columnFilters.invoiceNo || undefined,
          invoiceDate: columnFilters.invoiceDate || undefined,
          dueDate: columnFilters.dueDate || undefined,
          baseAmount: toExactNumber(columnFilters.baseAmount),
          gstAmount: toExactNumber(columnFilters.gstAmount),
          totalAmount: toExactNumber(columnFilters.totalAmount),
          received: toExactNumber(columnFilters.received),
          netReceivable: toExactNumber(columnFilters.netReceivable),
          sortBy: sortConfig.field || undefined,
          sortOrder: sortConfig.field ? sortConfig.direction : undefined,
        },
        `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      )
      showToast({ title: 'Export started', variant: 'success' })
    } catch {
      showToast({ title: 'Failed to export invoices', variant: 'error' })
    }
  }

  return (
    <>
      {listError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {listError}
        </Alert>
      ) : null}
      <ListingTemplate
        icon={<TrendingUp size={20} />}
        title="Receivable"
        subtitle="Cross-project client invoices and payments"
        primaryAction={
          canCreateReceivable
            ? {
                label: 'Create Invoice',
                onClick: () => {
                  setGeneratePreset(null)
                  setDrawerCreate(true)
                },
                startIcon: <Plus size={16} />,
              }
            : undefined
        }
        customSummary={kpiSummary}
        tabs={tabs}
        activeTab={filters.statusTab}
        onTabChange={handleTabChange}
        searchPlaceholder="Invoice no. / client / project…"
        searchValue={searchInput}
        onSearchChange={handleSearchChange}
        filterConfig={filterConfig}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onFilterReset={handleFilterReset}
        onResetAll={handleResetAll}
        showExport
        onExport={handleExport}
        pageSize={pagination.pageSize}
        totalCount={pagination.total}
        page={pagination.page - 1}
        onPageChange={(p) => dispatch(setPage(p + 1))}
        onPageSizeChange={(s) => dispatch(setPageSize(s))}
        columns={columnsConfig}
        onColumnVisibilityChange={handleColumnVisibilityChange}
      >
          <TableContainer sx={{ overflowX: 'auto', width: '100%' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
                  <FilterableSortHeader
                    label="Invoice no."
                    field="invoiceNo"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={columnFilters.invoiceNo}
                    filterOptions={invoiceNoOptions}
                    onFilter={(value) => handleColumnFilter('invoiceNo', value)}
                    sx={HEADER_CELL_SX}
                  />
                  {visibleColumns.clientName && (
                    <FilterableSortHeader
                      label="Client"
                      field="clientName"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.clientId}
                      filterOptions={clientOptions}
                      onFilter={(value) => handleColumnFilter('clientId', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.projectName && (
                    <FilterableSortHeader
                      label="Project"
                      field="projectName"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.projectId}
                      filterOptions={projectOptions}
                      onFilter={(value) => handleColumnFilter('projectId', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.milestoneName && (
                    <TableCell sx={HEADER_CELL_SX}>Milestone</TableCell>
                  )}
                  {visibleColumns.invoiceDate && (
                    <FilterableSortHeader
                      label="Invoice date"
                      field="invoiceDate"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterMode="date"
                      filterValue={columnFilters.invoiceDate}
                      filterOptions={invoiceDateOptions}
                      onFilter={(value) => handleColumnFilter('invoiceDate', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.dueDate && (
                    <FilterableSortHeader
                      label="Due date"
                      field="dueDate"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterMode="date"
                      filterValue={columnFilters.dueDate}
                      filterOptions={dueDateOptions}
                      onFilter={(value) => handleColumnFilter('dueDate', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.baseAmount && (
                    <FilterableSortHeader
                      label="Base"
                      field="baseAmount"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.baseAmount}
                      filterOptions={baseAmountOptions}
                      onFilter={(value) => handleColumnFilter('baseAmount', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.gstAmount && (
                    <FilterableSortHeader
                      label="GST"
                      field="gstAmount"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.gstAmount}
                      filterOptions={gstAmountOptions}
                      onFilter={(value) => handleColumnFilter('gstAmount', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.totalAmount && (
                    <FilterableSortHeader
                      label="Net Amount"
                      field="totalAmount"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.totalAmount}
                      filterOptions={totalAmountOptions}
                      onFilter={(value) => handleColumnFilter('totalAmount', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.totalReceived && (
                    <FilterableSortHeader
                      label="Received"
                      field="received"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.received}
                      filterOptions={receivedOptions}
                      onFilter={(value) => handleColumnFilter('received', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.balance && (
                    <FilterableSortHeader
                      label="Pending Amount"
                      field="netReceivable"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.netReceivable}
                      filterOptions={netReceivableOptions}
                      onFilter={(value) => handleColumnFilter('netReceivable', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  {visibleColumns.status && (
                    <FilterableSortHeader
                      label="Status"
                      field="status"
                      sortField={sortConfig.field ?? undefined}
                      sortDirection={sortConfig.direction}
                      onSort={handleSort}
                      filterValue={columnFilters.status}
                      filterOptions={statusOptions}
                      onFilter={(value) => handleColumnFilter('status', value)}
                      sx={HEADER_CELL_SX}
                    />
                  )}
                  <TableCell sx={actionColSx}>
                    <Box sx={CENTER_CELL_CONTENT_SX}>Action</Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading
                  ? [...Array(6)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(mainColCount)].map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton height={24} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={mainColCount} sx={{ ...BODY_CELL_SX, textAlign: 'center', color: 'text.secondary', py: 4 }}>
                          {filters.statusTab === 'draft'
                            ? 'No draft invoices found.'
                            : 'No invoices found.'}
                        </TableCell>
                      </TableRow>
                    )
                  : items.map((inv) => {
                      const pendingRow = isPendingGeneration(inv)
                      const dueRed = !pendingRow && (inv.status === 'overdue' || isDueOverdue(inv))
                      return (
                        <TableRow
                          key={inv.id}
                          hover
                          sx={{
                            cursor: 'pointer',
                            '& td': { height: 44 },
                            '&:hover': { bgcolor: hoverBg },
                            '&:hover td': { bgcolor: hoverBg },
                          }}
                          onClick={() => handleInvoiceRowClick(inv)}
                        >
                          <TableCell sx={{ ...BODY_CELL_SX, fontFamily: pendingRow ? 'inherit' : 'monospace' }}>
                            {pendingRow ? (
                              <Typography variant="body2" color="text.secondary">
                                —
                              </Typography>
                            ) : (
                              <Typography
                                component="button"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailId(inv.id)
                                }}
                                sx={{
                                  border: 'none',
                                  background: 'none',
                                  p: 0,
                                  cursor: 'pointer',
                                  color: 'primary.main',
                                  fontFamily: 'monospace',
                                  fontSize: 12,
                                  textAlign: 'left',
                                }}
                              >
                                {inv.invoiceNo}
                              </Typography>
                            )}
                          </TableCell>
                          {visibleColumns.clientName && <TableCell sx={BODY_CELL_SX}>{inv.clientName}</TableCell>}
                          {visibleColumns.projectName && (
                            <TableCell sx={BODY_CELL_SX}>
                              <Typography variant="body2" fontWeight={500}>
                                {inv.projectName}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.milestoneName && (
                            <TableCell sx={BODY_CELL_SX}>{invoiceMilestoneLabel(inv)}</TableCell>
                          )}
                          {visibleColumns.invoiceDate && (
                            <TableCell sx={BODY_CELL_SX}>{formatListingDate(inv.invoiceDate)}</TableCell>
                          )}
                          {visibleColumns.dueDate && (
                            <TableCell sx={{ ...BODY_CELL_SX, color: dueRed ? 'error.main' : 'text.primary' }}>
                              {formatListingDate(inv.dueDate)}
                            </TableCell>
                          )}
                          {visibleColumns.baseAmount && (
                            <TableCell sx={BODY_CELL_SX}>₹{formatInr(inv.baseAmount)}</TableCell>
                          )}
                          {visibleColumns.gstAmount && (
                            <TableCell sx={BODY_CELL_SX}>₹{formatInr(inv.gstAmount)}</TableCell>
                          )}
                          {visibleColumns.totalAmount && (
                            <TableCell sx={{ ...BODY_CELL_SX, fontWeight: 700 }}>
                              ₹{formatInr(financeReceivableNetAmount(inv))}
                            </TableCell>
                          )}
                          {visibleColumns.totalReceived && (
                            <TableCell sx={{ ...BODY_CELL_SX, color: pendingRow ? 'text.secondary' : 'success.main' }}>
                              {pendingRow ? '—' : `₹${formatInr(inv.totalReceived)}`}
                            </TableCell>
                          )}
                          {visibleColumns.balance && (
                            <TableCell
                              sx={{
                                ...BODY_CELL_SX,
                                color:
                                  financeReceivableOutstanding(inv) > 0
                                    ? 'error.main'
                                    : 'text.primary',
                              }}
                            >
                              ₹{formatInr(financeReceivableOutstanding(inv))}
                            </TableCell>
                          )}
                          {visibleColumns.status && (
                            <TableCell sx={BODY_CELL_SX}>
                              <Stack direction="row" gap={0.5} flexWrap="wrap" useFlexGap alignItems="center">
                                {pendingRow ? (
                                  <StatusBadge status="invoice_draft" label="Pending invoice" />
                                ) : (
                                  <>
                                    <StatusBadge status={invoiceStatusToBadgeType(inv.status) as StatusType} />
                                    {inv.showPartialPaid ? <StatusBadge status="partially_paid" /> : null}
                                  </>
                                )}
                              </Stack>
                            </TableCell>
                          )}
                          <TableCell
                            sx={actionBodySx}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {pendingRow ? (
                              canCreateReceivable ? (
                                <Box sx={CENTER_CELL_CONTENT_SX}>
                                  <Button
                                    size="sm"
                                    variant="contained"
                                    label="Generate Invoice"
                                    onClick={() => openGenerateInvoice(inv)}
                                  />
                                </Box>
                              ) : null
                            ) : (
                              <RowActions
                                inv={inv}
                                canEdit={canEditReceivable}
                                canDelete={canDeleteReceivable}
                                onView={() => setDetailId(inv.id)}
                                onPay={() => setPaymentInv(inv)}
                                onSend={() => setSendTarget(inv)}
                                onConvertTax={() => setConvertTaxTarget(inv)}
                                onPdf={() => void downloadInvoiceDocument(inv)}
                                onDelete={() => setDeleteTarget(inv)}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
              </TableBody>
            </Table>
          </TableContainer>
      </ListingTemplate>

      <Modal
        open={!!sendTarget}
        onClose={() => setSendTarget(null)}
        title="Send invoice?"
        size="xs"
        footer={
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button variant="outlined" size="sm" onClick={() => setSendTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="contained" size="sm" onClick={confirmSend} loading={saving}>
              Send
            </Button>
          </Stack>
        }
      >
        <Typography variant="body2">
          Mark <strong>{sendTarget?.invoiceNo}</strong> as sent? The client will see this as issued.
        </Typography>
      </Modal>

      <Modal
        open={!!convertTaxTarget}
        onClose={() => setConvertTaxTarget(null)}
        title="Convert as tax invoice?"
        size="xs"
        footer={
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button
              variant="outlined"
              size="sm"
              onClick={() => setConvertTaxTarget(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="contained" size="sm" onClick={confirmConvertTax} loading={saving}>
              Convert
            </Button>
          </Stack>
        }
      >
        <Typography variant="body2">
          Convert <strong>{convertTaxTarget?.invoiceNo}</strong> to a tax invoice? This cannot be undone.
        </Typography>
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete draft invoice?"
        size="xs"
        footer={
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button
              variant="outlined"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              size="sm"
              color="error"
              onClick={confirmDeleteInvoice}
              loading={saving}
            >
              Delete
            </Button>
          </Stack>
        }
      >
        <Typography variant="body2">
          Delete draft invoice <strong>{deleteTarget?.invoiceNo}</strong>? This cannot be undone.
        </Typography>
      </Modal>

      <CreateInvoiceDrawer
        open={drawerCreate}
        onClose={() => {
          setDrawerCreate(false)
          setGeneratePreset(null)
        }}
        mode="create"
        preset={generatePreset}
        onSaved={() => {
          setGeneratePreset(null)
          reloadAfterMutation({ showNewestFirst: true })
        }}
      />
      <CreateInvoiceDrawer
        open={!!drawerEdit}
        onClose={() => setDrawerEdit(null)}
        mode="edit"
        invoice={drawerEdit}
        onSaved={reloadAfterMutation}
      />

      <InvoiceDetailDrawer
        open={detailOpen}
        onClose={() => {
          setDetailId(null)
          dispatch(clearSelected())
        }}
        invoiceId={detailId}
        onEdit={
          canEditReceivable
            ? (inv) => {
                setDetailId(null)
                dispatch(clearSelected())
                setDrawerEdit(inv)
              }
            : undefined
        }
        onRecordPayment={canEditReceivable ? (inv) => setPaymentInv(inv) : undefined}
        onConvertTax={canEditReceivable ? (inv) => setConvertTaxTarget(inv) : undefined}
        onDownloadPdf={(inv) => {
          void downloadInvoiceDocument(inv)
        }}
      />

      <FinanceRecordClientInvoicePaymentModal
        open={!!paymentInv}
        onClose={() => setPaymentInv(null)}
        invoice={paymentInv}
        onRecorded={reloadAfterMutation}
      />
    </>
  )
}
