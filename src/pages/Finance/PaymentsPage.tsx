import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Stack,
  Typography,
  Table,
  TableContainer,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  MenuItem,
  IconButton,
  Menu,
  Skeleton,
  Alert,
} from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { Banknote, Upload } from 'lucide-react'
import { ListingTemplate } from '@/components/templates'
import type { ColumnItem, TabItem } from '@/components/templates/ListingTemplate'
import {
  FilterableSortHeader,
  clampListingPage0Based,
  type ColumnFilterOption,
} from '@/components/listing'
import { Avatar, Badge, Button, Modal, useToast, DatePicker, Select as DsSelect } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { formatDate, formatInr } from '@/utils/formatters'
import { downloadCsv } from '@/api/downloadCsv'
import { fetchProjects } from '@/slices/projects/thunk'
import { dropdownsApi } from '@/api/dropdownsApi'
import {
  payablesService,
  toPayableSummaryKpis,
  type PayablesListItem,
} from '@/modules/finance/payables.service'
import type { PayableSummaryKpis } from '@/pages/Finance/utils/payableSummary'
import {
  mergeReceivableListDateParams,
  resolveReceivableKpiDateRange,
  type ReceivableKpiPeriod,
} from '@/pages/Finance/utils/receivableKpiDateRange'
import { isDraftEquivalentVendorInvoiceStatus } from '@/pages/Finance/utils/invoiceLifecycle'
import {
  fetchExpenses,
  fetchPayments,
  fetchReimbursements,
  fetchVendorInvoices,
  fetchVendorPayableControls,
  deleteVendorInvoice,
} from '@/slices/live/thunk'
import { hydrateVendorInvoices } from '@/slices/live/reducer'
import type { Baseline, VendorPO } from '@/slices/baseline/reducer'
import {
  baselineVendorMilestoneEntries,
  mergeMilestoneEntriesWithVendorPO,
  vendorInvoiceMilestoneEntries,
  vendorPOVendorMilestoneEntries,
  globalVendorContextKey,
  payableStatusBadgeColor,
  payableStatusLabel,
  SettlementSummaryStrip,
  UploadVendorInvoiceDrawer,
  buildProjectVendorOptionsFromVendorPOs,
  VendorPayableWorkflowDrawer,
  type PayablePaymentStatus,
  type UploadVendorInvoiceInitialSelection,
  type VendorMilestoneEntry,
  type VendorPayableDrawerFocus,
} from '@/pages/Projects/tabs/live/vendorSettlement'
import { usePermission } from '@/hooks/usePermission'

interface PaymentTableRow {
  key: string
  vendorKey: string
  entry: VendorMilestoneEntry
  payableSt: PayablePaymentStatus
  invoiceStatus: string
  invoiceId: string
  invoiceNumber: string
  invoiceDate: string
  gstAmount: number
  totalAmount: number
  invoiceAmount: number
  tdsAmount: number
}

/** Equal-width data columns + fixed Action; padding matches listing toolbar (14px). */
const PAY_ACTION_WIDTH_PX = 84
const PAY_CELL_PAD_X = '14px'

type PayablesVisibleColumns = {
  vendorName: boolean
  projectName: boolean
  milestone: boolean
  invoiceNo: boolean
  invoiceDate: boolean
  gstAmount: boolean
  totalAmount: boolean
  tdsAmount: boolean
  invoiceAmount: boolean
  paymentStatus: boolean
}

const DEFAULT_PAYABLES_VISIBLE: PayablesVisibleColumns = {
  vendorName: true,
  projectName: true,
  milestone: true,
  invoiceNo: true,
  invoiceDate: true,
  gstAmount: true,
  totalAmount: true,
  tdsAmount: true,
  invoiceAmount: true,
  paymentStatus: true,
}

function payablesVisibleColCount(v: PayablesVisibleColumns): number {
  return Object.values(v).filter(Boolean).length
}

function buildPayablesListColumns(v: PayablesVisibleColumns): string[] {
  return [
    'id',
    ...(v.vendorName ? (['vendorName', 'vendorId'] as const) : []),
    ...(v.projectName ? (['projectName', 'projectId'] as const) : []),
    ...(v.milestone ? (['milestone', 'milestoneId'] as const) : []),
    ...(v.invoiceNo ? (['invoiceNo'] as const) : []),
    ...(v.invoiceDate ? (['invoiceDate'] as const) : []),
    ...(v.gstAmount ? (['gstAmount'] as const) : []),
    ...(v.totalAmount ? (['totalAmount'] as const) : []),
    ...(v.tdsAmount ? (['tdsAmount'] as const) : []),
    ...(v.invoiceAmount ? (['invoiceAmount'] as const) : []),
    ...(v.paymentStatus ? (['paymentStatus'] as const) : []),
  ]
}

const PAY_HEADER_PADDING = {
  '&.MuiTableCell-sizeSmall': {
    paddingTop: '8px',
    paddingBottom: '8px',
    paddingLeft: PAY_CELL_PAD_X,
    paddingRight: PAY_CELL_PAD_X,
  },
} as const

const PAY_BODY_PADDING = {
  '&.MuiTableCell-sizeSmall': {
    paddingTop: '7px',
    paddingBottom: '7px',
    paddingLeft: PAY_CELL_PAD_X,
    paddingRight: PAY_CELL_PAD_X,
  },
} as const

const PAY_HEADER_ACTION_PADDING = {
  '&.MuiTableCell-sizeSmall': {
    paddingTop: '8px',
    paddingBottom: '8px',
    paddingLeft: 0,
    paddingRight: PAY_CELL_PAD_X,
  },
} as const

const PAY_BODY_ACTION_PADDING = {
  '&.MuiTableCell-sizeSmall': {
    paddingTop: '7px',
    paddingBottom: '7px',
    paddingLeft: 0,
    paddingRight: PAY_CELL_PAD_X,
  },
} as const

const CENTER_CELL_CONTENT_SX = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: 1,
} as const

const PAY_HEADER_SX = {
  fontSize: 11,
  fontWeight: 600,
  color: 'text.secondary',
  borderBottom: `2px solid ${tokens.color.neutral[100]}`,
  verticalAlign: 'middle' as const,
  lineHeight: 1.35,
  boxSizing: 'border-box' as const,
  minWidth: 0,
  whiteSpace: 'nowrap' as const,
  ...PAY_HEADER_PADDING,
}

const PAY_HEADER_ACTION_SX = {
  ...PAY_HEADER_SX,
  width: PAY_ACTION_WIDTH_PX,
  minWidth: PAY_ACTION_WIDTH_PX,
  maxWidth: PAY_ACTION_WIDTH_PX,
  whiteSpace: 'nowrap' as const,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  ...PAY_HEADER_ACTION_PADDING,
}

const PAY_CELL_SX = {
  fontSize: 12,
  verticalAlign: 'top' as const,
  boxSizing: 'border-box' as const,
  minWidth: 0,
  overflow: 'hidden',
  ...PAY_BODY_PADDING,
}

const PAY_CELL_CHIP_SX = {
  ...PAY_CELL_SX,
  verticalAlign: 'middle' as const,
  textAlign: 'center' as const,
}

const PAY_HEADER_CHIP_SX = {
  ...PAY_HEADER_SX,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
}

const PAY_HEADER_STATUS_SX = {
  ...PAY_HEADER_CHIP_SX,
}

const PAY_CELL_STATUS_SX = {
  ...PAY_CELL_CHIP_SX,
}

const PAY_CELL_ACTION_SX = {
  ...PAY_CELL_SX,
  width: PAY_ACTION_WIDTH_PX,
  minWidth: PAY_ACTION_WIDTH_PX,
  maxWidth: PAY_ACTION_WIDTH_PX,
  verticalAlign: 'middle' as const,
  textAlign: 'center' as const,
  overflow: 'visible',
  ...PAY_BODY_ACTION_PADDING,
}

/** Vendor / Project — wrap like Vendors name column (wordBreak, no single-line ellipsis). */
const PAY_TEXT_WRAP_SX = {
  fontSize: 12,
  lineHeight: 1.35,
  wordBreak: 'break-word',
} as const

const PAY_TEXT_BODY_SX = {
  fontSize: 12,
  lineHeight: 1.35,
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
}

const PAY_PAGE_SIZE = 10
const MIN_PAYABLES_VISIBLE_COLUMNS = 5

const KPI_PERIOD_OPTIONS: { label: string; value: ReceivableKpiPeriod }[] = [
  { label: 'Today', value: 'Today' },
  { label: 'This Week', value: 'This Week' },
  { label: 'This Month', value: 'This Month' },
  { label: 'This Year', value: 'This Year' },
  { label: 'Custom Date Range', value: 'Custom Date Range' },
]

const menuItemSx = { fontSize: 12, minHeight: 32, py: 0.5 }

type PayableStatusTab = 'pending' | 'completed'
type PayablesSortField =
  | 'vendorName'
  | 'projectName'
  | 'milestone'
  | 'invoiceNo'
  | 'invoiceDate'
  | 'gstAmount'
  | 'totalAmount'
  | 'invoiceAmount'
  | 'tdsAmount'
  | 'paymentStatus'

function actionMenuItemsForStatus(
  status: PayablePaymentStatus,
  invoiceStatus: string,
  canDelete: boolean,
): readonly string[] {
  const items: string[] = ['View Details']
  if (status !== 'settled') items.push('Release Payment')
  if (canDelete && isDraftEquivalentVendorInvoiceStatus(invoiceStatus)) {
    items.push('Delete')
  }
  return items
}

export default function PaymentsPage() {
  const dispatch = useAppDispatch()
  const theme = useTheme()
  const { showToast } = useToast()
  const canCreatePayable = usePermission('payables', 'create')
  const canEditPayable = usePermission('payables', 'edit')
  const canDeletePayable = usePermission('projectLive', 'delete')
  const { items: rawProjects, loading: projectsLoading } = useAppSelector((s) => s.projects)
  const [liveProjectIds, setLiveProjectIds] = useState<string[] | null>(null)
  const liveProjectIdSet = useMemo(() => new Set(liveProjectIds ?? []), [liveProjectIds])
  const projects = useMemo(
    () => (rawProjects ?? []).filter((p) => liveProjectIdSet.has(p.id)),
    [rawProjects, liveProjectIdSet],
  )
  const vendorInvoices = useAppSelector((s) => s.live.vendorInvoices ?? [])

  const [baselinesByProject, setBaselinesByProject] = useState<Record<string, Baseline | null>>({})
  const [vendorPOsByProject, setVendorPOsByProject] = useState<Record<string, VendorPO[]>>({})
  const [financeLoaded, setFinanceLoaded] = useState(false)
  const [summaryKpis, setSummaryKpis] = useState<PayableSummaryKpis | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [kpiPeriod, setKpiPeriod] = useState<ReceivableKpiPeriod>('This Month')
  const [kpiCustomFrom, setKpiCustomFrom] = useState<Date | null>(null)
  const [kpiCustomTo, setKpiCustomTo] = useState<Date | null>(null)

  const kpiDateBounds = useMemo(
    () => resolveReceivableKpiDateRange(kpiPeriod, kpiCustomFrom, kpiCustomTo),
    [kpiPeriod, kpiCustomFrom, kpiCustomTo],
  )
  const kpiCustomIncomplete =
    kpiPeriod === 'Custom Date Range' && (!kpiCustomFrom || !kpiCustomTo)
  const kpiCustomInvalid =
    kpiPeriod === 'Custom Date Range' &&
    Boolean(kpiCustomFrom && kpiCustomTo) &&
    kpiDateBounds === null

  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState<PayableStatusTab>('pending')

  const effectiveKpiDates = useMemo(
    () => mergeReceivableListDateParams(kpiDateBounds, '', ''),
    [kpiDateBounds],
  )

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAY_PAGE_SIZE)
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [sortConfig, setSortConfig] = useState<{
    field: PayablesSortField | null
    direction: 'asc' | 'desc'
  }>({ field: null, direction: 'asc' })
  const [payableFilterOptions, setPayableFilterOptions] = useState<Record<string, ColumnFilterOption[]>>({})
  const [listItems, setListItems] = useState<PayablesListItem[]>([])
  const [listTotal, setListTotal] = useState(0)
  const [tabCounts, setTabCounts] = useState({ pending: 0, completed: 0 })
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const listRequestIdRef = useRef(0)
  const [visibleColumns, setVisibleColumns] = useState<PayablesVisibleColumns>(DEFAULT_PAYABLES_VISIBLE)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuContext, setMenuContext] = useState<PaymentTableRow | null>(null)
  const [workflowDrawer, setWorkflowDrawer] = useState<{
    entry: VendorMilestoneEntry
    focus: VendorPayableDrawerFocus
    readOnly: boolean
    invoiceId: string
    invoiceDate: string
    paymentStatus: PayablePaymentStatus
  } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadInitialSelection, setUploadInitialSelection] =
    useState<UploadVendorInvoiceInitialSelection | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PaymentTableRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    void dispatch(fetchProjects({ pageSize: 100 }))
    void dropdownsApi
      .getLiveProjects()
      .then((options) => setLiveProjectIds(options.map((o) => o.value)))
      .catch(() => setLiveProjectIds([]))
  }, [dispatch])

  useEffect(() => {
    let cancelled = false
    setPayableFilterOptions({})
    void payablesService
      .getFilters({ paymentStatus: statusTab })
      .then((data) => {
        if (cancelled) return
        const projects = data.projects ?? []
        const vendors = data.vendors ?? []
        const milestones = data.milestones ?? []
        const invoiceNos = data.invoiceNos ?? []
        const invoiceDates = data.invoiceDates ?? []
        const gstAmounts = data.gstAmounts ?? []
        const totalAmounts = data.totalAmounts ?? []
        const invoiceAmounts = data.invoiceAmounts ?? []
        const tdsAmounts = data.tdsAmounts ?? []
        const paymentStatuses = data.paymentStatuses ?? []
        setPayableFilterOptions({
          vendorId: vendors,
          projectId: projects,
          milestone: milestones,
          invoiceNo: invoiceNos,
          invoiceDate: invoiceDates,
          gstAmount: gstAmounts,
          totalAmount: totalAmounts,
          invoiceAmount: invoiceAmounts,
          tdsAmount: tdsAmounts,
          paymentStatus: paymentStatuses,
        })
        setColFilters((prev) => {
          if (Object.keys(prev).length === 0) return prev
          const next = { ...prev }
          const optionSets: Record<string, { value: string }[]> = {
            vendorId: vendors,
            projectId: projects,
            milestone: milestones,
            invoiceNo: invoiceNos,
            invoiceDate: invoiceDates,
            gstAmount: gstAmounts,
            totalAmount: totalAmounts,
            invoiceAmount: invoiceAmounts,
            tdsAmount: tdsAmounts,
            paymentStatus: paymentStatuses,
          }
          let changed = false
          for (const [field, selected] of Object.entries(next)) {
            const options = optionSets[field]
            if (!options) continue
            if (!options.some((option) => option.value === selected)) {
              delete next[field]
              changed = true
            }
          }
          return changed ? next : prev
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [statusTab])

  // One workspace call replaces N× baseline + vendor-PO + invoice + payments + expenses…
  useEffect(() => {
    let cancelled = false
    setFinanceLoaded(false)
    void (async () => {
      try {
        const workspace = await payablesService.getWorkspace()
        if (cancelled) return

        const poByProject: Record<string, VendorPO[]> = {}
        for (const po of workspace.vendorPOs) {
          const list = poByProject[po.projectId] ?? []
          list.push(po)
          poByProject[po.projectId] = list
        }

        const blByProject: Record<string, Baseline | null> = {}
        for (const bl of workspace.baselines) {
          if (bl?.projectId) blByProject[bl.projectId] = bl
        }

        setVendorPOsByProject(poByProject)
        setBaselinesByProject(blByProject)
        dispatch(hydrateVendorInvoices(workspace.vendorInvoices))
      } catch {
        if (!cancelled) {
          showToast({ title: 'Failed to load payables workspace', variant: 'error' })
        }
      } finally {
        if (!cancelled) setFinanceLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dispatch, showToast])

  // Summary KPIs: Live Overview vendor metrics (poDate) with merged global + toolbar dates
  useEffect(() => {
    if (kpiCustomInvalid) {
      setSummaryLoading(false)
      setSummaryKpis(null)
      return
    }
    if (kpiCustomIncomplete && !effectiveKpiDates.dateFrom && !effectiveKpiDates.dateTo) {
      setSummaryLoading(false)
      setSummaryKpis(null)
      return
    }
    if (effectiveKpiDates.emptyIntersection) {
      setSummaryLoading(false)
      setSummaryKpis(toPayableSummaryKpis({
        totalVendorOfferValue: 0,
        paidTillDate: 0,
        remainingPayment: 0,
      }))
      return
    }
    let cancelled = false
    setSummaryLoading(true)
    void (async () => {
      try {
        const summary = await payablesService.getSummary({
          dateFrom: effectiveKpiDates.dateFrom,
          dateTo: effectiveKpiDates.dateTo,
        })
        if (!cancelled) setSummaryKpis(toPayableSummaryKpis(summary))
      } catch {
        if (!cancelled) setSummaryKpis(null)
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [effectiveKpiDates, kpiCustomInvalid, kpiCustomIncomplete])

  /** Global Date Range change restarts listing at page 0. */
  useEffect(() => {
    setPage(0)
  }, [effectiveKpiDates])

  // Lazy-load drawer-only finance for the selected project
  useEffect(() => {
    if (!workflowDrawer) return
    const projectId = workflowDrawer.entry.projectId
    void dispatch(fetchPayments(projectId))
    void dispatch(fetchExpenses({ projectId }))
    void dispatch(fetchReimbursements(projectId))
    void dispatch(fetchVendorPayableControls(projectId))
  }, [dispatch, workflowDrawer?.entry.projectId, workflowDrawer?.entry.milestone.id])

  const allMilestones = useMemo((): VendorMilestoneEntry[] => {
    const out: VendorMilestoneEntry[] = []
    for (const p of projects) {
      const bl = baselinesByProject[p.id] ?? null
      const vpos = vendorPOsByProject[p.id] ?? []
      const fromVendorPO = vendorPOVendorMilestoneEntries(p.id, p.name, vpos, bl)
      const fromBaseline = baselineVendorMilestoneEntries(p.id, p.name, bl)
      const fromInvoices = vendorInvoiceMilestoneEntries(p.id, p.name, vendorInvoices)
      out.push(...mergeMilestoneEntriesWithVendorPO(fromVendorPO, fromBaseline, fromInvoices))
    }
    return out
  }, [projects, baselinesByProject, vendorPOsByProject, vendorInvoices])

  const fetchPayablesList = useCallback(
    async (
      overrides: {
        page?: number
        pageSize?: number
        colFilters?: Record<string, string>
        visibleColumns?: PayablesVisibleColumns
      } = {},
    ) => {
      const nextPage = overrides.page ?? page
      const nextPageSize = overrides.pageSize ?? pageSize
      const nextCols = { ...colFilters, ...overrides.colFilters }

      const listDates = mergeReceivableListDateParams(kpiDateBounds, '', '')
      if (listDates.emptyIntersection) {
        setListItems([])
        setListTotal(0)
        setTabCounts({ pending: 0, completed: 0 })
        setListLoading(false)
        setListError(null)
        return
      }

      const requestId = ++listRequestIdRef.current
      const visibility = overrides.visibleColumns ?? visibleColumns
      setListLoading(true)
      setListError(null)
      try {
        const result = await payablesService.getList({
          page: nextPage + 1,
          limit: nextPageSize,
          search: search.trim() || undefined,
          vendorId: nextCols.vendorId || undefined,
          projectId: nextCols.projectId || undefined,
          milestone: nextCols.milestone || undefined,
          invoiceNo: nextCols.invoiceNo || undefined,
          invoiceDate: nextCols.invoiceDate || undefined,
          gstAmount: nextCols.gstAmount ? Number(nextCols.gstAmount) : undefined,
          totalAmount: nextCols.totalAmount ? Number(nextCols.totalAmount) : undefined,
          invoiceAmount: nextCols.invoiceAmount ? Number(nextCols.invoiceAmount) : undefined,
          tdsAmount: nextCols.tdsAmount ? Number(nextCols.tdsAmount) : undefined,
          paymentStatus: nextCols.paymentStatus || statusTab,
          dateFrom: listDates.dateFrom,
          dateTo: listDates.dateTo,
          columns: buildPayablesListColumns(visibility),
          sortBy: sortConfig.field || undefined,
          sortOrder: sortConfig.field ? sortConfig.direction : undefined,
        })
        if (requestId !== listRequestIdRef.current) return
        setListItems(result.items)
        setListTotal(result.total)
        setTabCounts({
          pending: result.pendingCount,
          completed: result.completedCount,
        })
        const clamped = clampListingPage0Based(nextPage, result.total, nextPageSize)
        if (clamped !== nextPage) {
          setPage(clamped)
          return
        }
      } catch {
        if (requestId !== listRequestIdRef.current) return
        setListItems([])
        setListTotal(0)
        setTabCounts({ pending: 0, completed: 0 })
        setListError('Failed to load payables')
      } finally {
        if (requestId === listRequestIdRef.current) setListLoading(false)
      }
    },
    [
      page,
      pageSize,
      search,
      colFilters,
      statusTab,
      sortConfig.field,
      sortConfig.direction,
      visibleColumns,
      kpiDateBounds,
    ],
  )

  useEffect(() => {
    void fetchPayablesList()
  }, [fetchPayablesList])

  function handleColumnFilter(field: string, value: string) {
    setColFilters((prev) => ({ ...prev, [field]: value }))
    setPage(0)
    void fetchPayablesList({ page: 0, colFilters: { [field]: value } })
  }

  function handleColumnVisibilityChange(field: string, visible: boolean) {
    const key = field as keyof PayablesVisibleColumns
    if (!(key in visibleColumns)) return
    if (!visible && payablesVisibleColCount(visibleColumns) <= MIN_PAYABLES_VISIBLE_COLUMNS) {
      showToast({ title: 'Keep at least 5 columns visible', variant: 'error' })
      return
    }
    setVisibleColumns((prev) => ({ ...prev, [key]: visible }))
    setPage(0)
  }

  const columnsConfig: ColumnItem[] = useMemo(
    () => [
      { field: 'vendorName', label: 'Vendor', visible: visibleColumns.vendorName },
      { field: 'projectName', label: 'Project', visible: visibleColumns.projectName },
      { field: 'milestone', label: 'Milestone', visible: visibleColumns.milestone },
      { field: 'invoiceNo', label: 'Invoice No.', visible: visibleColumns.invoiceNo },
      { field: 'invoiceDate', label: 'Invoice date', visible: visibleColumns.invoiceDate },
      { field: 'gstAmount', label: 'GST', visible: visibleColumns.gstAmount },
      { field: 'totalAmount', label: 'Total Amount', visible: visibleColumns.totalAmount },
      { field: 'tdsAmount', label: 'TDS', visible: visibleColumns.tdsAmount },
      { field: 'invoiceAmount', label: 'Net payable amount', visible: visibleColumns.invoiceAmount },
      { field: 'paymentStatus', label: 'Payment Status', visible: visibleColumns.paymentStatus },
    ],
    [visibleColumns],
  )

  const dataColCount = Math.max(1, payablesVisibleColCount(visibleColumns))
  const dataColWidth = `calc((100% - ${PAY_ACTION_WIDTH_PX}px) / ${dataColCount})`
  const tableColSpan = dataColCount + 1

  const listingRows = useMemo((): PaymentTableRow[] => {
    return listItems.map((item) => {
      const milestoneLabels = item.milestoneNames?.length ? item.milestoneNames : [item.milestone]
      const serviceLabels = item.serviceNames?.length ? item.serviceNames : item.service ? [item.service] : []
      const match = allMilestones.find((m) => {
        if (m.projectId !== item.projectId || m.row.vendorId !== item.vendorId) return false
        const milestoneOk =
          (item.milestoneId != null && m.milestone.id === item.milestoneId) ||
          milestoneLabels.some((name) => m.milestone.name === name)
        if (!milestoneOk) return false
        if (serviceLabels.length === 0) return true
        return serviceLabels.some(
          (svc) => m.row.serviceId === svc || m.row.serviceName === svc,
        )
      })
      const payableSt = (item.paymentStatus === 'settled' || item.paymentStatus === 'partial_payment' || item.paymentStatus === 'not_paid'
        ? item.paymentStatus
        : 'not_paid') as PayablePaymentStatus
      if (match) {
        return {
          key: item.id,
          vendorKey: globalVendorContextKey(item.projectId, match.row),
          entry: match,
          payableSt,
          invoiceStatus: item.invoiceStatus,
          invoiceId: item.invoiceId ?? item.id,
          invoiceNumber: item.invoiceNo,
          invoiceDate: item.invoiceDate,
          gstAmount: item.gstAmount ?? 0,
          totalAmount: item.totalAmount ?? 0,
          invoiceAmount: item.invoiceAmount,
          tdsAmount: item.tdsAmount,
        }
      }
      return {
        key: item.id,
        vendorKey: `${item.projectId}::${item.vendorId}`,
        entry: {
          projectId: item.projectId,
          projectName: item.projectName,
          milestone: {
            id: item.milestoneId ?? item.id,
            name: item.milestone,
            percentage: 0,
            value: 0,
          },
          row: {
            vendorId: item.vendorId,
            vendorName: item.vendorName,
            serviceId: item.service ?? '',
            serviceName: item.service ?? '',
          },
        },
        payableSt,
        invoiceStatus: item.invoiceStatus,
        invoiceId: item.invoiceId ?? item.id,
        invoiceNumber: item.invoiceNo,
        invoiceDate: item.invoiceDate,
        gstAmount: item.gstAmount ?? 0,
        totalAmount: item.totalAmount ?? 0,
        invoiceAmount: item.invoiceAmount,
        tdsAmount: item.tdsAmount,
      }
    })
  }, [listItems, allMilestones])

  const statusTabs: TabItem[] = useMemo(
    () => [
      { label: 'Pending', value: 'pending', count: tabCounts.pending },
      { label: 'Completed', value: 'completed', count: tabCounts.completed },
    ],
    [tabCounts],
  )

  const isDataLoading = projectsLoading || liveProjectIds === null || !financeLoaded || listLoading

  const paginatedRows = listingRows

  useEffect(() => {
    setPage(0)
  }, [search, statusTab, colFilters, sortConfig.field, sortConfig.direction])

  function openActionMenu(e: React.MouseEvent<HTMLElement>, row: PaymentTableRow) {
    e.stopPropagation()
    setMenuAnchor(e.currentTarget)
    setMenuContext(row)
  }

  function closeActionMenu() {
    setMenuAnchor(null)
    setMenuContext(null)
  }

  const allVendorPOs = useMemo(
    () => Object.values(vendorPOsByProject).flat(),
    [vendorPOsByProject],
  )

  const projectVendorOptions = useMemo(
    () =>
      buildProjectVendorOptionsFromVendorPOs(
        projects.map((p) => ({ id: p.id, name: p.name })),
        vendorPOsByProject,
      ),
    [projects, vendorPOsByProject],
  )

  function openUploadInvoice(selection?: UploadVendorInvoiceInitialSelection | null) {
    if (!canCreatePayable) return
    setUploadInitialSelection(selection ?? null)
    setUploadOpen(true)
  }

  function closeUploadInvoice() {
    setUploadOpen(false)
    setUploadInitialSelection(null)
  }

  async function refreshPayablesSummaryAndList(options?: { projectId?: string; pageOverride?: number }) {
    const nextPage = options?.pageOverride ?? page
    try {
      if (options?.projectId) {
        await dispatch(fetchVendorInvoices(options.projectId)).unwrap()
      }
      const listDates = effectiveKpiDates
      if (listDates.emptyIntersection) {
        setListItems([])
        setListTotal(0)
        setTabCounts({ pending: 0, completed: 0 })
        if (!kpiCustomInvalid && !(kpiCustomIncomplete && !listDates.dateFrom && !listDates.dateTo)) {
          setSummaryLoading(false)
          setSummaryKpis(toPayableSummaryKpis({
            totalVendorOfferValue: 0,
            paidTillDate: 0,
            remainingPayment: 0,
          }))
        }
        return
      }
      const canFetchSummary =
        !kpiCustomInvalid &&
        !(kpiCustomIncomplete && !listDates.dateFrom && !listDates.dateTo)
      if (canFetchSummary) setSummaryLoading(true)
      const summaryPromise = canFetchSummary
        ? payablesService.getSummary({
            dateFrom: listDates.dateFrom,
            dateTo: listDates.dateTo,
          })
        : Promise.resolve(null)
      const [summary, list] = await Promise.all([
        summaryPromise,
        payablesService.getList({
          page: nextPage + 1,
          limit: pageSize,
          search: search.trim() || undefined,
          vendorId: colFilters.vendorId || undefined,
          projectId: colFilters.projectId || undefined,
          milestone: colFilters.milestone || undefined,
          invoiceNo: colFilters.invoiceNo || undefined,
          invoiceDate: colFilters.invoiceDate || undefined,
          gstAmount: colFilters.gstAmount ? Number(colFilters.gstAmount) : undefined,
          totalAmount: colFilters.totalAmount ? Number(colFilters.totalAmount) : undefined,
          invoiceAmount: colFilters.invoiceAmount ? Number(colFilters.invoiceAmount) : undefined,
          tdsAmount: colFilters.tdsAmount ? Number(colFilters.tdsAmount) : undefined,
          paymentStatus: colFilters.paymentStatus || statusTab,
          dateFrom: listDates.dateFrom,
          dateTo: listDates.dateTo,
          sortBy: sortConfig.field || undefined,
          sortOrder: sortConfig.field ? sortConfig.direction : undefined,
        }),
      ])
      if (summary) setSummaryKpis(toPayableSummaryKpis(summary))
      if (canFetchSummary) setSummaryLoading(false)
      setListItems(list.items)
      setListTotal(list.total)
      setTabCounts({
        pending: list.pendingCount,
        completed: list.completedCount,
      })
      const clamped = clampListingPage0Based(nextPage, list.total, pageSize)
      if (clamped !== page) {
        setPage(clamped)
      }
    } catch {
      setSummaryLoading(false)
      // listing or summary may remain stale until next filter change
    }
  }

  async function handleInvoiceUploaded(projectId: string) {
    await refreshPayablesSummaryAndList({ projectId })
  }

  function handleActionMenuItem(label: string) {
    if (!menuContext) return
    const { entry } = menuContext

    closeActionMenu()

    switch (label) {
      case 'Release Payment':
        if (!canEditPayable) return
        setWorkflowDrawer({
          entry,
          focus: 'payment',
          readOnly: false,
          invoiceId: menuContext.invoiceId,
          invoiceDate: menuContext.invoiceDate,
          paymentStatus: menuContext.payableSt,
        })
        break
      case 'Delete':
        if (!canDeletePayable) return
        if (!isDraftEquivalentVendorInvoiceStatus(menuContext.invoiceStatus)) {
          showToast({ title: 'Only draft or uploaded invoices can be deleted', variant: 'error' })
          return
        }
        setDeleteTarget(menuContext)
        break
      case 'View Details':
      default:
        setWorkflowDrawer({
          entry,
          focus: 'details',
          readOnly: true,
          invoiceId: menuContext.invoiceId,
          invoiceDate: menuContext.invoiceDate,
          paymentStatus: menuContext.payableSt,
        })
        break
    }
  }

  async function confirmDeletePayableInvoice() {
    if (!deleteTarget || !canDeletePayable) return
    if (!isDraftEquivalentVendorInvoiceStatus(deleteTarget.invoiceStatus)) {
      showToast({ title: 'Only draft or uploaded invoices can be deleted', variant: 'error' })
      return
    }
    setDeleteLoading(true)
    try {
      await dispatch(
        deleteVendorInvoice({
          projectId: deleteTarget.entry.projectId,
          invoiceId: deleteTarget.invoiceId,
        }),
      ).unwrap()
      showToast({ title: 'Vendor invoice deleted', variant: 'success' })
      const nextPage = clampListingPage0Based(page, Math.max(0, listTotal - 1), pageSize)
      await refreshPayablesSummaryAndList({
        projectId: deleteTarget.entry.projectId,
        pageOverride: nextPage,
      })
    } catch (e) {
      showToast({ title: String(e), variant: 'error' })
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }

  function resolveVendorPoIdForMilestone(
    projectId: string,
    vendorId: string,
    serviceId: string,
    milestoneId: string,
  ): string | undefined {
    for (const po of vendorPOsByProject[projectId] ?? []) {
      if (po.vendorId !== vendorId) continue
      if (!po.linkedBaselineServiceIds?.includes(serviceId)) continue
      if (po.milestones.some((m) => m.id === milestoneId)) return po.id
    }
    return undefined
  }

  function openUploadInvoiceFromWorkflow(milestoneId: string) {
    if (!workflowDrawer) return
    const { entry } = workflowDrawer
    setWorkflowDrawer(null)
    openUploadInvoice({
      projectId: entry.projectId,
      vendorId: entry.row.vendorId,
      vendorPoId: resolveVendorPoIdForMilestone(
        entry.projectId,
        entry.row.vendorId,
        entry.row.serviceId,
        milestoneId,
      ),
      serviceId: entry.row.serviceId,
      milestoneId,
    })
  }

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    setPage(0)
  }, [])

  function handleSort(field: string, direction: 'asc' | 'desc') {
    setSortConfig({ field: field as PayablesSortField, direction })
    setPage(0)
  }

  function handleResetAll() {
    setSearch('')
    setColFilters({})
    setSortConfig({ field: null, direction: 'asc' })
    setVisibleColumns(DEFAULT_PAYABLES_VISIBLE)
    setKpiPeriod('This Month')
    setKpiCustomFrom(null)
    setKpiCustomTo(null)
    setPage(0)
  }

  const hoverBg = alpha(theme.palette.primary.main, 0.04)

  async function handleExport() {
    const listDates = effectiveKpiDates
    try {
      await downloadCsv(
        '/finance/payables/export',
        {
          search: search.trim() || undefined,
          vendorId: colFilters.vendorId || undefined,
          projectId: colFilters.projectId || undefined,
          milestone: colFilters.milestone || undefined,
          invoiceNo: colFilters.invoiceNo || undefined,
          invoiceDate: colFilters.invoiceDate || undefined,
          gstAmount: colFilters.gstAmount ? Number(colFilters.gstAmount) : undefined,
          totalAmount: colFilters.totalAmount ? Number(colFilters.totalAmount) : undefined,
          invoiceAmount: colFilters.invoiceAmount ? Number(colFilters.invoiceAmount) : undefined,
          tdsAmount: colFilters.tdsAmount ? Number(colFilters.tdsAmount) : undefined,
          paymentStatus: colFilters.paymentStatus || statusTab,
          dateFrom: listDates.dateFrom,
          dateTo: listDates.dateTo,
          sortBy: sortConfig.field || undefined,
          sortOrder: sortConfig.field ? sortConfig.direction : undefined,
        },
        `payables-${new Date().toISOString().slice(0, 10)}.csv`,
      )
      showToast({ title: 'Export started', variant: 'success' })
    } catch {
      showToast({ title: 'Failed to export payables', variant: 'error' })
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
          icon={<Banknote size={20} strokeWidth={1.75} />}
          title="Payable"
          subtitle="Cross-project vendor payments and settlement workflow"
          primaryAction={
            canCreatePayable
              ? {
                  label: 'Upload Invoice',
                  onClick: () => openUploadInvoice(),
                  startIcon: <Upload size={16} strokeWidth={1.75} />,
                }
              : undefined
          }
          customSummary={
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
                    <DsSelect
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
                      <DatePicker
                        label="To"
                        value={kpiCustomTo}
                        onChange={setKpiCustomTo}
                        size="sm"
                      />
                    </>
                  ) : null}
                </Stack>
              </Stack>
              <Box sx={{ p: 2 }}>
                {kpiCustomIncomplete ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1.5 }}
                  >
                    Select a start and end date to update KPI values.
                  </Typography>
                ) : null}
                {kpiCustomInvalid ? (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
                    End date must be on or after the start date.
                  </Typography>
                ) : null}
                <SettlementSummaryStrip kpis={summaryKpis} loading={summaryLoading} />
              </Box>
            </Box>
          }
          tabs={statusTabs}
          activeTab={statusTab}
          onTabChange={(v) => {
            setStatusTab(v as PayableStatusTab)
            setColFilters({})
            setPayableFilterOptions({})
            setPage(0)
          }}
          searchValue={search}
          onSearchChange={handleSearchChange}
          onResetAll={handleResetAll}
          columns={columnsConfig}
          onColumnVisibilityChange={handleColumnVisibilityChange}
          showExport
          onExport={handleExport}
          clipCardContent={false}
          pageSize={pageSize}
          totalCount={listTotal}
          page={page}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s)
            setPage(0)
          }}
        >
          <>
              <TableContainer sx={{ overflowX: 'auto', width: '100%' }}>
                <Table size="small" sx={{ tableLayout: 'fixed', width: '100%', minWidth: 1280 }}>
                  <colgroup>
                    {Array.from({ length: dataColCount }, (_, index) => (
                      <col key={index} style={{ width: dataColWidth }} />
                    ))}
                    <col style={{ width: `${PAY_ACTION_WIDTH_PX}px` }} />
                  </colgroup>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
                      {visibleColumns.vendorName && (
                        <FilterableSortHeader label="Vendor" field="vendorName" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.vendorId ?? ''} filterOptions={payableFilterOptions.vendorId ?? []} onFilter={(v) => handleColumnFilter('vendorId', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.projectName && (
                        <FilterableSortHeader label="Project" field="projectName" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.projectId ?? ''} filterOptions={payableFilterOptions.projectId ?? []} onFilter={(v) => handleColumnFilter('projectId', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.milestone && (
                        <FilterableSortHeader label="Milestone" field="milestone" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.milestone ?? ''} filterOptions={payableFilterOptions.milestone ?? []} onFilter={(v) => handleColumnFilter('milestone', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.invoiceNo && (
                        <FilterableSortHeader label="Invoice No." field="invoiceNo" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.invoiceNo ?? ''} filterOptions={payableFilterOptions.invoiceNo ?? []} onFilter={(v) => handleColumnFilter('invoiceNo', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.invoiceDate && (
                        <FilterableSortHeader label="Invoice date" field="invoiceDate" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterMode="date" filterValue={colFilters.invoiceDate ?? ''} filterOptions={payableFilterOptions.invoiceDate ?? []} onFilter={(v) => handleColumnFilter('invoiceDate', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.gstAmount && (
                        <FilterableSortHeader label="GST" field="gstAmount" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.gstAmount ?? ''} filterOptions={payableFilterOptions.gstAmount ?? []} onFilter={(v) => handleColumnFilter('gstAmount', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.totalAmount && (
                        <FilterableSortHeader label="Total Amount" field="totalAmount" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.totalAmount ?? ''} filterOptions={payableFilterOptions.totalAmount ?? []} onFilter={(v) => handleColumnFilter('totalAmount', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.tdsAmount && (
                        <FilterableSortHeader label="TDS" field="tdsAmount" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.tdsAmount ?? ''} filterOptions={payableFilterOptions.tdsAmount ?? []} onFilter={(v) => handleColumnFilter('tdsAmount', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.invoiceAmount && (
                        <FilterableSortHeader label="Net payable amount" field="invoiceAmount" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.invoiceAmount ?? ''} filterOptions={payableFilterOptions.invoiceAmount ?? []} onFilter={(v) => handleColumnFilter('invoiceAmount', v)} sx={PAY_HEADER_SX} />
                      )}
                      {visibleColumns.paymentStatus && (
                        <FilterableSortHeader label="Payment Status" field="paymentStatus" sortField={sortConfig.field ?? undefined} sortDirection={sortConfig.direction} onSort={handleSort} filterValue={colFilters.paymentStatus ?? ''} filterOptions={payableFilterOptions.paymentStatus ?? []} onFilter={(v) => handleColumnFilter('paymentStatus', v)} sx={PAY_HEADER_STATUS_SX} />
                      )}
                      <TableCell sx={PAY_HEADER_ACTION_SX}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {isDataLoading ? (
                      [...Array(6)].map((_, i) => (
                        <TableRow key={i}>
                          {[...Array(tableColSpan)].map((__, j) => (
                            <TableCell key={j} sx={PAY_CELL_SX}>
                              <Skeleton height={24} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : listingRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={tableColSpan} sx={{ ...PAY_CELL_SX, color: 'text.secondary', py: 4 }}>
                          {listTotal === 0
                            ? 'No vendor invoices yet. Upload an invoice to get started.'
                            : statusTab === 'completed'
                              ? 'No completed payments for this filter.'
                              : 'No pending payments for this filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRows.map((row) => (
                        <TableRow
                          key={row.key}
                          hover
                          sx={{
                            '&:hover': { bgcolor: hoverBg },
                            '&:hover td': { bgcolor: hoverBg },
                            '&:last-child td': { border: 0 },
                          }}
                        >
                          {visibleColumns.vendorName && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Stack direction="row" alignItems="center" gap={1.25} sx={{ minWidth: 0 }}>
                                <Box sx={{ flexShrink: 0 }}>
                                  <Avatar name={row.entry.row.vendorName} size="sm" />
                                </Box>
                                <Typography
                                  variant="body2"
                                  sx={{ ...PAY_TEXT_WRAP_SX, fontWeight: 600, flex: 1, minWidth: 0 }}
                                >
                                  {row.entry.row.vendorName}
                                </Typography>
                              </Stack>
                            </TableCell>
                          )}
                          {visibleColumns.projectName && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_WRAP_SX}>
                                {row.entry.projectName}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.milestone && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                {row.entry.milestone.name}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.invoiceNo && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                {row.invoiceNumber || '—'}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.invoiceDate && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                {row.invoiceDate ? formatDate(row.invoiceDate) : '—'}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.gstAmount && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                ₹{formatInr(row.gstAmount)}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.totalAmount && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                ₹{formatInr(row.totalAmount)}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.tdsAmount && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                ₹{formatInr(row.tdsAmount)}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.invoiceAmount && (
                            <TableCell sx={PAY_CELL_SX}>
                              <Typography variant="body2" sx={PAY_TEXT_BODY_SX}>
                                ₹{formatInr(row.invoiceAmount)}
                              </Typography>
                            </TableCell>
                          )}
                          {visibleColumns.paymentStatus && (
                            <TableCell sx={PAY_CELL_STATUS_SX}>
                              <Box sx={CENTER_CELL_CONTENT_SX}>
                                <Badge
                                  label={payableStatusLabel(row.payableSt)}
                                  variant="soft"
                                  color={payableStatusBadgeColor(row.payableSt)}
                                  size="sm"
                                />
                              </Box>
                            </TableCell>
                          )}
                          <TableCell sx={PAY_CELL_ACTION_SX} onClick={(e) => e.stopPropagation()}>
                            <Box sx={CENTER_CELL_CONTENT_SX}>
                              <IconButton
                                size="small"
                                aria-label="Row actions"
                                onClick={(e) => openActionMenu(e, row)}
                              sx={{ p: 0.25 }}
                            >
                              <MoreVertIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
          </>
        </ListingTemplate>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor) && menuContext != null}
          onClose={closeActionMenu}
          onClick={(e) => e.stopPropagation()}
          slotProps={{ paper: { elevation: 2 } }}
        >
          {(menuContext
            ? actionMenuItemsForStatus(
                menuContext.payableSt,
                menuContext.invoiceStatus,
                canDeletePayable,
              )
            : []
          )
            .filter((label) => label !== 'Release Payment' || canEditPayable)
            .map((label) => (
              <MenuItem key={label} sx={menuItemSx} onClick={() => handleActionMenuItem(label)}>
                {label}
              </MenuItem>
            ))}
        </Menu>

        <VendorPayableWorkflowDrawer
          key={
            workflowDrawer
              ? `${workflowDrawer.invoiceId}-${workflowDrawer.entry.milestone.id}-${workflowDrawer.focus}`
              : 'closed'
          }
          open={workflowDrawer != null}
          onClose={() => {
            setWorkflowDrawer(null)
            void refreshPayablesSummaryAndList()
          }}
          entry={workflowDrawer?.entry ?? null}
          baseline={
            workflowDrawer ? baselinesByProject[workflowDrawer.entry.projectId] ?? null : null
          }
          focus={workflowDrawer?.focus}
          readOnly={workflowDrawer?.readOnly}
          invoiceId={workflowDrawer?.invoiceId}
          invoiceDate={workflowDrawer?.invoiceDate}
          paymentStatus={workflowDrawer?.paymentStatus}
          paymentEntryMode="finance"
          onUploadInvoice={openUploadInvoiceFromWorkflow}
        />

        <UploadVendorInvoiceDrawer
          open={uploadOpen}
          onClose={closeUploadInvoice}
          vendorInvoices={vendorInvoices}
          allVendorPOs={allVendorPOs}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          projectVendors={projectVendorOptions}
          initialSelection={uploadInitialSelection}
          onUploaded={(projectId) => void handleInvoiceUploaded(projectId)}
        />

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
                disabled={deleteLoading}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                size="sm"
                color="error"
                onClick={() => void confirmDeletePayableInvoice()}
                loading={deleteLoading}
              >
                Delete
              </Button>
            </Stack>
          }
        >
          <Typography variant="body2">
            Delete draft invoice <strong>{deleteTarget?.invoiceNumber}</strong>? This cannot be
            undone.
          </Typography>
        </Modal>
    </>
  )
}
