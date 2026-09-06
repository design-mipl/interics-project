import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Stack,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Skeleton,
  FormControl,
  Select,
  MenuItem,
  Divider,
  IconButton as MuiIconButton,
  Menu,
  MenuItem as MuiMenuItem,
} from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { useTheme, alpha } from '@mui/material/styles'
import { Receipt, Plus, Wallet, Layers, Link2, Users, Building2 } from 'lucide-react'
import { ListingTemplate } from '@/components/templates'
import { financeApi } from '@/api/financeApi'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import type { FilterField, ColumnItem } from '@/components/templates/ListingTemplate'
import { FilterableSortHeader, type ColumnFilterOption } from '@/components/listing'
import {
  isInvalidDateRange,
  LISTING_DEFAULT_PAGE_SIZE,
  clampListingPage0Based,
} from '@/components/listing/listingStandards'
import { Modal, Button, useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchProjects } from '@/slices/projects/thunk'
import { deleteExpense } from '@/slices/live/thunk'
import type { Expense, ExpenseType } from '@/slices/live/types'
import { formatDate, formatInr } from '@/utils/formatters'
import { GlobalExpenseDrawer } from '@/components/expenses/GlobalExpenseDrawer'
import { downloadCsv } from '@/api/downloadCsv'
import {
  ExpenseTypeBadge,
  ViewExpenseModal,
  expenseServiceCell,
  expenseTypeFilterLabel,
  expenseVendorCell,
} from '@/components/expenses/expenseShared'
import { usePermission } from '@/hooks/usePermission'

type TypeTab = 'all' | ExpenseType
type ExpensesSortField =
  | 'type'
  | 'description'
  | 'projectName'
  | 'vendorName'
  | 'service'
  | 'amount'
  | 'date'

type VisibleCols = {
  type: boolean
  description: boolean
  project: boolean
  vendor: boolean
  service: boolean
  amount: boolean
  date: boolean
}

const CANONICAL_TYPE_FILTER_OPTIONS: ColumnFilterOption[] = [
  { value: 'additional', label: 'Additional' },
  { value: 'vendor_linked', label: 'Vendor Linked' },
  { value: 'common', label: 'Common' },
  { value: 'office_expenses', label: 'Office Expenses' },
  { value: 'reimbursable_expenses', label: 'Reimbursable Expenses' },
]

function showsVendorServiceColumns(type: TypeTab): boolean {
  return type === 'all' || type === 'vendor_linked'
}

function listingVisibleColumns(visible: VisibleCols, type: TypeTab): VisibleCols {
  if (showsVendorServiceColumns(type)) return visible
  return { ...visible, vendor: false, service: false }
}

function buildExpenseListColumns(visible: VisibleCols): string[] {
  return [
    'id',
    ...(visible.type ? (['type'] as const) : []),
    ...(visible.description ? (['description'] as const) : []),
    ...(visible.project ? (['project', 'projectId', 'projectName'] as const) : []),
    ...(visible.vendor ? (['vendor', 'vendorId', 'vendorName'] as const) : []),
    ...(visible.service ? (['service'] as const) : []),
    ...(visible.amount ? (['amount'] as const) : []),
    ...(visible.date ? (['date'] as const) : []),
  ]
}

type ExpenseColumnFilters = {
  description: string
  vendorId: string
  service: string
  amount: string
  date: string
}

function toColumnFilterOptions(
  options?: Array<{ value: string | number | boolean; label: string }>,
): ColumnFilterOption[] {
  return (options ?? []).map((option) => ({
    value: String(option.value),
    label: option.label,
  }))
}

function mergeTypeFilterOptions(
  options?: Array<{ value: string | number | boolean; label: string }>,
): ColumnFilterOption[] {
  const byValue = new Map(CANONICAL_TYPE_FILTER_OPTIONS.map((opt) => [opt.value, opt]))
  for (const option of options ?? []) {
    const value = String(option.value)
    const rawLabel = option.label
    byValue.set(value, {
      value,
      label: rawLabel.includes('_') ? expenseTypeFilterLabel(value) : rawLabel,
    })
  }
  const canonical = CANONICAL_TYPE_FILTER_OPTIONS.map((opt) => byValue.get(opt.value)!)
  const extras = [...byValue.values()].filter(
    (opt) => !CANONICAL_TYPE_FILTER_OPTIONS.some((c) => c.value === opt.value),
  )
  return [...canonical, ...extras]
}

/** Mirrors VendorsPage TABLE_HEADER_CELL_SX / TABLE_CELL_SX. */
const EXP_ACTION_WIDTH_PX = 72
const EXP_CELL_PAD_X = '14px'
const LISTING_EDGE_PAD = EXP_CELL_PAD_X

const CENTER_CELL_CONTENT_SX = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: 1,
} as const

const STICKY_ACTION_SX = {
  position: 'sticky' as const,
  right: 0,
  zIndex: 1,
}

const HEADER_SX = {
  fontSize: 11,
  fontWeight: 600,
  color: 'text.secondary',
  py: '8px',
  px: EXP_CELL_PAD_X,
  borderBottom: `2px solid ${tokens.color.neutral[100]}`,
  verticalAlign: 'bottom' as const,
  boxSizing: 'border-box' as const,
}

const HEADER_ACTION_SX = {
  ...HEADER_SX,
  ...STICKY_ACTION_SX,
  width: EXP_ACTION_WIDTH_PX,
  minWidth: EXP_ACTION_WIDTH_PX,
  maxWidth: EXP_ACTION_WIDTH_PX,
  whiteSpace: 'nowrap' as const,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  pl: 0,
  pr: LISTING_EDGE_PAD,
  bgcolor: 'background.default',
  zIndex: 2,
}

const CELL_SX = {
  fontSize: 12,
  py: '7px',
  px: EXP_CELL_PAD_X,
  verticalAlign: 'top' as const,
  boxSizing: 'border-box' as const,
}

const CELL_ACTION_SX = {
  py: '7px',
  pl: 0,
  pr: LISTING_EDGE_PAD,
  width: EXP_ACTION_WIDTH_PX,
  minWidth: EXP_ACTION_WIDTH_PX,
  maxWidth: EXP_ACTION_WIDTH_PX,
  verticalAlign: 'middle' as const,
  textAlign: 'center' as const,
  boxSizing: 'border-box' as const,
  bgcolor: 'background.paper',
  ...STICKY_ACTION_SX,
}

const menuItemSx = { fontSize: 12, minHeight: 32, py: 0.5 }

function visibleColCount(v: VisibleCols): number {
  return Object.values(v).filter(Boolean).length + 1
}

export default function ExpensesPage() {
  const dispatch = useAppDispatch()
  const theme = useTheme()
  const { showToast } = useToast()
  const canCreateExpense = usePermission('expenses', 'create')
  const canEditExpense = usePermission('expenses', 'edit')
  const canDeleteExpense = usePermission('expenses', 'delete')
  const hoverBg = alpha(theme.palette.primary.main, 0.04)

  const projects = useAppSelector((s) => s.projects.items ?? [])
  const saving = useAppSelector((s) => s.live.saving)
  const [items, setItems] = useState<Expense[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const [filterOptions, setFilterOptions] = useState<Record<string, Array<{ value: string; label: string }>> | null>(null)

  const [financeLoaded, setFinanceLoaded] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [viewExpense, setViewExpense] = useState<Expense | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)

  const [search, setSearch] = useState('')
  const [typeTab, setTypeTab] = useState<TypeTab>('all')
  const [filterProjectId, setFilterProjectId] = useState('')
  const [activeFilters, setActiveFilters] = useState<Record<string, unknown>>({
    dateFrom: '',
    dateTo: '',
  })
  const [columnFilters, setColumnFilters] = useState<ExpenseColumnFilters>({
    description: '',
    vendorId: '',
    service: '',
    amount: '',
    date: '',
  })
  const [visibleColumns, setVisibleColumns] = useState<VisibleCols>({
    type: true,
    description: true,
    project: true,
    vendor: true,
    service: true,
    amount: true,
    date: true,
  })

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(LISTING_DEFAULT_PAGE_SIZE)
  const [sortConfig, setSortConfig] = useState<{
    field: ExpensesSortField | null
    direction: 'asc' | 'desc'
  }>({ field: null, direction: 'asc' })

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuExpense, setMenuExpense] = useState<Expense | null>(null)

  useEffect(() => {
    void dispatch(fetchProjects({ pageSize: 100 }))
  }, [dispatch])

  const reloadExpenses = useCallback(
    async (overrides: {
      page?: number
      typeTab?: TypeTab
      filterProjectId?: string
      columnFilters?: Partial<ExpenseColumnFilters>
      visibleColumns?: VisibleCols
    } = {}) => {
      const nextPage = overrides.page ?? page
      const nextType = overrides.typeTab ?? typeTab
      const nextProjectId =
        overrides.filterProjectId !== undefined ? overrides.filterProjectId : filterProjectId
      const nextCols = { ...columnFilters, ...overrides.columnFilters }
      const visibility = listingVisibleColumns(overrides.visibleColumns ?? visibleColumns, nextType)
      const vendorServiceCols = showsVendorServiceColumns(nextType)
      const dateFrom = String(activeFilters.dateFrom ?? '')
      const dateTo = String(activeFilters.dateTo ?? '')
      if (isInvalidDateRange(dateFrom, dateTo)) {
        setListError('Date from must be on or before date to')
        return
      }
      const sortField =
        !vendorServiceCols && (sortConfig.field === 'vendorName' || sortConfig.field === 'service')
          ? null
          : sortConfig.field
      const seq = ++requestSeq.current
      setListLoading(true)
      try {
        const res = await financeApi.getExpenses({
          page: String(nextPage + 1),
          limit: String(pageSize),
          search: search.trim() || undefined,
          type: nextType === 'all' ? undefined : nextType,
          projectId: nextProjectId || undefined,
          dateFrom: nextCols.date || dateFrom || undefined,
          dateTo: nextCols.date || dateTo || undefined,
          description: nextCols.description || undefined,
          vendorId: vendorServiceCols ? nextCols.vendorId || undefined : undefined,
          service: vendorServiceCols ? nextCols.service || undefined : undefined,
          amount: nextCols.amount ? String(Number(nextCols.amount)) : undefined,
          columns: buildExpenseListColumns(visibility).join(','),
          sortBy: sortField || undefined,
          sortOrder: sortField ? sortConfig.direction : undefined,
        })
        if (seq !== requestSeq.current) return
        const data = unwrapApiData<Expense[]>(res.data)
        const meta =
          res.data && typeof res.data === 'object' && 'meta' in res.data
            ? (res.data.meta as Record<string, unknown>)
            : {}
        const total = typeof meta.total === 'number' ? meta.total : Array.isArray(data) ? data.length : 0
        setItems(Array.isArray(data) ? data : [])
        setTotalCount(total)
        setListError(null)
        const clamped = clampListingPage0Based(nextPage, total, pageSize)
        if (clamped !== nextPage) {
          setPage(clamped)
          return
        }
      } catch (err) {
        if (seq !== requestSeq.current) return
        setListError(err instanceof Error ? err.message : 'Failed to load expenses')
      } finally {
        if (seq === requestSeq.current) {
          setListLoading(false)
          setFinanceLoaded(true)
        }
      }
    },
    [
      activeFilters,
      columnFilters,
      filterProjectId,
      page,
      pageSize,
      search,
      sortConfig.field,
      sortConfig.direction,
      typeTab,
      visibleColumns,
    ],
  )

  useEffect(() => {
    void financeApi
      .getExpenseFilters({ type: typeTab === 'all' ? undefined : typeTab })
      .then((res) => {
        setFilterOptions(
          unwrapApiData<Record<string, Array<{ value: string; label: string }>>>(res.data) ?? null,
        )
      })
      .catch(() => setFilterOptions(null))
  }, [typeTab])

  useEffect(() => {
    void reloadExpenses()
  }, [reloadExpenses])

  const projectNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of projects) m[p.id] = p.name
    return m
  }, [projects])

  const handleSearchChange = (v: string) => {
    setSearch(v)
    setPage(0)
  }

  const filterConfig: FilterField[] = useMemo(
    () => [
      { field: 'dateFrom', label: 'Date from', type: 'date' },
      { field: 'dateTo', label: 'Date to', type: 'date' },
    ],
    [],
  )

  const [kpis, setKpis] = useState({
    total: 0,
    additional: 0,
    vendorLinked: 0,
    common: 0,
    officeExpenses: 0,
  })

  const refreshExpenseSummary = useCallback(() => {
    void financeApi
      .getExpensesSummary({ type: typeTab === 'all' ? undefined : typeTab })
      .then((res) => {
        const data = unwrapApiData<{
          total?: number
          additional?: number
          vendorLinked?: number
          common?: number
          office?: number
        }>(res.data)
        if (data) {
          setKpis({
            total: data.total ?? 0,
            additional: data.additional ?? 0,
            vendorLinked: data.vendorLinked ?? 0,
            common: data.common ?? 0,
            officeExpenses: data.office ?? 0,
          })
        }
      })
      .catch(() => undefined)
  }, [typeTab])

  useEffect(() => {
    refreshExpenseSummary()
  }, [refreshExpenseSummary])

  const statCards = [
    {
      label: 'Total Expenses',
      value: `₹${formatInr(kpis.total)}`,
      variant: 'default' as const,
      icon: <Wallet size={24} strokeWidth={1.75} />,
    },
    {
      label: 'Additional',
      value: `₹${formatInr(kpis.additional)}`,
      variant: 'purple' as const,
      icon: <Layers size={24} strokeWidth={1.75} />,
    },
    {
      label: 'Vendor Linked',
      value: `₹${formatInr(kpis.vendorLinked)}`,
      variant: 'info' as const,
      icon: <Link2 size={24} strokeWidth={1.75} />,
    },
    {
      label: 'Common',
      value: `₹${formatInr(kpis.common)}`,
      variant: 'teal' as const,
      icon: <Users size={24} strokeWidth={1.75} />,
    },
    {
      label: 'Office Expenses',
      value: `₹${formatInr(kpis.officeExpenses)}`,
      variant: 'warning' as const,
      icon: <Building2 size={24} strokeWidth={1.75} />,
    },
  ]

  const tabs = [
    { label: 'All', value: 'all' },
    { label: 'Additional', value: 'additional' },
    { label: 'Vendor Linked', value: 'vendor_linked' },
    { label: 'Common', value: 'common' },
    { label: 'Office Expenses', value: 'office_expenses' },
  ]

  const displayColumns = useMemo(
    () => listingVisibleColumns(visibleColumns, typeTab),
    [visibleColumns, typeTab],
  )

  const columnsConfig: ColumnItem[] = useMemo(() => {
    const cols: ColumnItem[] = [
      { field: 'type', label: 'Type', visible: visibleColumns.type },
      { field: 'description', label: 'Description', visible: visibleColumns.description },
      { field: 'project', label: 'Project', visible: visibleColumns.project },
    ]
    if (showsVendorServiceColumns(typeTab)) {
      cols.push(
        { field: 'vendor', label: 'Vendor', visible: visibleColumns.vendor },
        { field: 'service', label: 'Service', visible: visibleColumns.service },
      )
    }
    cols.push(
      { field: 'amount', label: 'Amount', visible: visibleColumns.amount },
      { field: 'date', label: 'Date', visible: visibleColumns.date },
    )
    return cols
  }, [visibleColumns, typeTab])

  function handleColumnVisibilityChange(field: string, visible: boolean) {
    const k = field as keyof VisibleCols
    if (!(k in visibleColumns)) return
    setVisibleColumns((prev) => ({ ...prev, [k]: visible }))
    setPage(0)
  }

  const mainColCount = useMemo(() => visibleColCount(displayColumns), [displayColumns])

  const visibleDataColCount = useMemo(
    () => Object.values(displayColumns).filter(Boolean).length,
    [displayColumns],
  )

  const dataColWidth = useMemo(
    () => `calc((100% - ${EXP_ACTION_WIDTH_PX}px) / ${Math.max(visibleDataColCount, 1)})`,
    [visibleDataColCount],
  )

  const loading = listLoading || (!financeLoaded && items.length === 0)

  async function handleExport() {
    try {
      await downloadCsv(
        '/finance/expenses/export',
        {
          search: search.trim() || undefined,
          type: typeTab === 'all' ? undefined : typeTab,
          projectId: filterProjectId || undefined,
          dateFrom: columnFilters.date || String(activeFilters.dateFrom ?? '') || undefined,
          dateTo: columnFilters.date || String(activeFilters.dateTo ?? '') || undefined,
          description: columnFilters.description || undefined,
          vendorId: showsVendorServiceColumns(typeTab) ? columnFilters.vendorId || undefined : undefined,
          service: showsVendorServiceColumns(typeTab) ? columnFilters.service || undefined : undefined,
          amount: columnFilters.amount ? Number(columnFilters.amount) : undefined,
          sortBy: sortConfig.field || undefined,
          sortOrder: sortConfig.field ? sortConfig.direction : undefined,
        },
        `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      )
      showToast({ title: 'Export started', variant: 'success' })
    } catch {
      showToast({ title: 'Failed to export expenses', variant: 'error' })
    }
  }

  function clearVendorServiceFiltersIfNeeded(nextType: TypeTab) {
    if (showsVendorServiceColumns(nextType)) return
    setColumnFilters((prev) =>
      prev.vendorId || prev.service ? { ...prev, vendorId: '', service: '' } : prev,
    )
    setSortConfig((prev) =>
      prev.field === 'vendorName' || prev.field === 'service'
        ? { field: null, direction: 'asc' }
        : prev,
    )
  }

  function handleTabChange(v: string) {
    const nextType = v as TypeTab
    setTypeTab(nextType)
    clearVendorServiceFiltersIfNeeded(nextType)
    setPage(0)
  }

  function handleFilterChange(next: Record<string, unknown>) {
    setActiveFilters(next)
    setPage(0)
  }

  function handleFilterReset() {
    setActiveFilters({ dateFrom: '', dateTo: '' })
    setPage(0)
  }

  function handleSort(field: string, direction: 'asc' | 'desc') {
    setSortConfig({ field: field as ExpensesSortField, direction })
    setPage(0)
  }

  function openMenu(e: React.MouseEvent<HTMLElement>, exp: Expense) {
    e.stopPropagation()
    setMenuAnchor(e.currentTarget)
    setMenuExpense(exp)
  }

  function closeMenu() {
    setMenuAnchor(null)
    setMenuExpense(null)
  }

  function openAddDrawer() {
    setEditingExpense(null)
    setDrawerOpen(true)
  }

  function openEditDrawer(exp: Expense) {
    setEditingExpense(exp)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setEditingExpense(null)
  }

  async function confirmDelete() {
    if (!canDeleteExpense) return
    if (!deleteTarget) return
    try {
      await dispatch(
        deleteExpense({ projectId: deleteTarget.projectId, expenseId: deleteTarget.id }),
      ).unwrap()
      showToast({ title: 'Expense deleted', variant: 'success' })
      const nextPage = clampListingPage0Based(page, Math.max(0, totalCount - 1), pageSize)
      if (nextPage !== page) setPage(nextPage)
      await reloadExpenses({ page: nextPage })
    } catch (err) {
      showToast({ title: String(err), variant: 'error' })
    }
    setDeleteTarget(null)
  }

  const typeOptions = mergeTypeFilterOptions(filterOptions?.types)
  const descriptionOptions = toColumnFilterOptions(filterOptions?.descriptions)
  const projectOptions = toColumnFilterOptions(filterOptions?.projects)
  const vendorOptions = toColumnFilterOptions(filterOptions?.vendors)
  const serviceOptions = toColumnFilterOptions(filterOptions?.services)
  const amountOptions = toColumnFilterOptions(filterOptions?.amounts)

  function handleColumnFilter(
    field:
      | 'type'
      | 'description'
      | 'projectId'
      | 'vendorId'
      | 'service'
      | 'amount'
      | 'date',
    value: string,
  ) {
    setPage(0)
    if (field === 'type') {
      const nextType = (value || 'all') as TypeTab
      setTypeTab(nextType)
      clearVendorServiceFiltersIfNeeded(nextType)
      void reloadExpenses({
        page: 0,
        typeTab: nextType,
        columnFilters: showsVendorServiceColumns(nextType) ? undefined : { vendorId: '', service: '' },
      })
      return
    }
    if (field === 'projectId') {
      setFilterProjectId(value)
      void reloadExpenses({ page: 0, filterProjectId: value })
      return
    }
    setColumnFilters((prev) => ({ ...prev, [field]: value }))
    void reloadExpenses({ page: 0, columnFilters: { [field]: value } })
  }

  function handleResetAll() {
    setSearch('')
    setFilterProjectId('')
    setActiveFilters({ dateFrom: '', dateTo: '' })
    setColumnFilters({
      description: '',
      vendorId: '',
      service: '',
      amount: '',
      date: '',
    })
    setSortConfig({ field: null, direction: 'asc' })
    setPage(0)
  }

  const viewModalProjectName =
    viewExpense != null
      ? (viewExpense.projectName ?? projectNameById[viewExpense.projectId] ?? viewExpense.projectId)
      : undefined

  const toolbarAfterSearch = (
    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
      <FormControl size="small" sx={{ minWidth: { xs: 1, sm: 160 } }}>
        <Select
          displayEmpty
          value={filterProjectId}
          onChange={(e) => {
            setFilterProjectId(String(e.target.value))
            setPage(0)
          }}
          sx={{ fontSize: 12, height: 32 }}
        >
          <MenuItem value="" sx={{ fontSize: 12 }}>
            All projects
          </MenuItem>
          {projectOptions.map((p) => (
            <MenuItem key={p.value} value={p.value} sx={{ fontSize: 12 }}>
              {p.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  )

  return (
    <>
      <ListingTemplate
        icon={<Receipt size={20} strokeWidth={1.75} />}
        title="Expenses"
        subtitle="Cross-project expense tracking"
        primaryAction={
          canCreateExpense
            ? {
                label: 'Add Expense',
                onClick: openAddDrawer,
                startIcon: <Plus size={16} strokeWidth={2} />,
              }
            : undefined
        }
        statCards={statCards}
        tabs={tabs}
        activeTab={typeTab}
        onTabChange={handleTabChange}
        searchPlaceholder="Search description, project, vendor…"
        searchValue={search}
        onSearchChange={handleSearchChange}
        toolbarAfterSearch={toolbarAfterSearch}
        filterConfig={filterConfig}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onFilterReset={handleFilterReset}
        onResetAll={handleResetAll}
        columns={columnsConfig}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        showExport
        onExport={handleExport}
        pageSize={pageSize}
        totalCount={totalCount}
        page={page}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(0)
        }}
      >
        {listError ? (
          <Alert severity="error" sx={{ mx: 2, mt: 2, mb: 0, fontSize: 12 }}>
            {listError}
          </Alert>
        ) : null}
        <TableContainer sx={{ overflowX: 'auto', width: '100%' }}>
          <Table size="small" sx={{ tableLayout: 'fixed', width: '100%', minWidth: 0 }}>
            <colgroup>
              {displayColumns.type && <col style={{ width: dataColWidth }} />}
              {displayColumns.description && <col style={{ width: dataColWidth }} />}
              {displayColumns.project && <col style={{ width: dataColWidth }} />}
              {displayColumns.vendor && <col style={{ width: dataColWidth }} />}
              {displayColumns.service && <col style={{ width: dataColWidth }} />}
              {displayColumns.amount && <col style={{ width: dataColWidth }} />}
              {displayColumns.date && <col style={{ width: dataColWidth }} />}
              <col style={{ width: EXP_ACTION_WIDTH_PX }} />
            </colgroup>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.text.primary, 0.02) }}>
                {displayColumns.type && (
                  <FilterableSortHeader
                    label="Type"
                    field="type"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={typeTab === 'all' ? '' : typeTab}
                    filterOptions={typeOptions}
                    onFilter={(value) => handleColumnFilter('type', value)}
                    sx={HEADER_SX}
                  />
                )}
                {displayColumns.description && (
                  <FilterableSortHeader
                    label="Description"
                    field="description"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={columnFilters.description}
                    filterOptions={descriptionOptions}
                    onFilter={(value) => handleColumnFilter('description', value)}
                    sx={HEADER_SX}
                  />
                )}
                {displayColumns.project && (
                  <FilterableSortHeader
                    label="Project"
                    field="projectName"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={filterProjectId}
                    filterOptions={projectOptions}
                    onFilter={(value) => handleColumnFilter('projectId', value)}
                    sx={HEADER_SX}
                  />
                )}
                {displayColumns.vendor && (
                  <FilterableSortHeader
                    label="Vendor"
                    field="vendorName"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={columnFilters.vendorId}
                    filterOptions={vendorOptions}
                    onFilter={(value) => handleColumnFilter('vendorId', value)}
                    sx={HEADER_SX}
                  />
                )}
                {displayColumns.service && (
                  <FilterableSortHeader
                    label="Service"
                    field="service"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={columnFilters.service}
                    filterOptions={serviceOptions}
                    onFilter={(value) => handleColumnFilter('service', value)}
                    sx={HEADER_SX}
                  />
                )}
                {displayColumns.amount && (
                  <FilterableSortHeader
                    label="Amount"
                    field="amount"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={columnFilters.amount}
                    filterOptions={amountOptions}
                    onFilter={(value) => handleColumnFilter('amount', value)}
                    sx={HEADER_SX}
                  />
                )}
                {displayColumns.date && (
                  <FilterableSortHeader
                    label="Date"
                    field="date"
                    sortField={sortConfig.field ?? undefined}
                    sortDirection={sortConfig.direction}
                    onSort={handleSort}
                    filterValue={columnFilters.date}
                    filterOptions={[]}
                    filterMode="date"
                    onFilter={(value) => handleColumnFilter('date', value)}
                    sx={HEADER_SX}
                  />
                )}
                <TableCell sx={HEADER_ACTION_SX}>
                  <Box sx={CENTER_CELL_CONTENT_SX}>Action</Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading &&
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(mainColCount)].map((__, j) => (
                      <TableCell key={j} sx={CELL_SX}>
                        <Skeleton height={20} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!loading && projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={mainColCount} sx={{ ...CELL_SX, textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No projects loaded
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {!loading && projects.length > 0 && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={mainColCount} sx={{ ...CELL_SX, textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No expenses match the filters
                    </Typography>
                  </TableCell>
                </TableRow>
              )}

              {!loading &&
                items.map((exp) => {
                  const projectLabel = exp.projectName ?? projectNameById[exp.projectId] ?? exp.projectId
                  return (
                    <TableRow
                      key={exp.id}
                      hover
                      sx={{
                        '& td': { height: 44 },
                        '&:hover': { bgcolor: hoverBg },
                        '&:hover td': { bgcolor: hoverBg },
                      }}
                    >
                      {displayColumns.type && (
                        <TableCell sx={CELL_SX}>
                          <ExpenseTypeBadge type={exp.type} />
                        </TableCell>
                      )}
                      {displayColumns.description && (
                        <TableCell sx={CELL_SX}>
                          <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                            {exp.description}
                          </Typography>
                        </TableCell>
                      )}
                      {displayColumns.project && (
                        <TableCell sx={CELL_SX}>
                          <Typography variant="body2" sx={{ fontSize: 12 }}>
                            {projectLabel}
                          </Typography>
                        </TableCell>
                      )}
                      {displayColumns.vendor && (
                        <TableCell sx={CELL_SX}>{expenseVendorCell(exp)}</TableCell>
                      )}
                      {displayColumns.service && (
                        <TableCell sx={CELL_SX}>{expenseServiceCell(exp)}</TableCell>
                      )}
                      {displayColumns.amount && (
                        <TableCell sx={CELL_SX}>₹{formatInr(exp.amount)}</TableCell>
                      )}
                      {displayColumns.date && (
                        <TableCell sx={CELL_SX}>{formatDate(exp.date)}</TableCell>
                      )}
                      <TableCell sx={CELL_ACTION_SX} onClick={(e) => e.stopPropagation()}>
                        <Box sx={CENTER_CELL_CONTENT_SX}>
                          <MuiIconButton size="small" aria-label="More" onClick={(e) => openMenu(e, exp)} sx={{ p: 0.25 }}>
                            <MoreVertIcon sx={{ fontSize: 14 }} />
                          </MuiIconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
        </TableContainer>
      </ListingTemplate>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor) && menuExpense != null}
        onClose={closeMenu}
        slotProps={{ paper: { elevation: 2 } }}
      >
        <MuiMenuItem
          sx={menuItemSx}
          onClick={() => {
            if (menuExpense) setViewExpense(menuExpense)
            closeMenu()
          }}
        >
          View
        </MuiMenuItem>
        {menuExpense?.status === 'pending' && (canEditExpense || canDeleteExpense) && (
          <>
            <Divider />
            {canEditExpense ? (
              <MuiMenuItem
                sx={menuItemSx}
                onClick={() => {
                  if (menuExpense) openEditDrawer(menuExpense)
                  closeMenu()
                }}
              >
                Edit
              </MuiMenuItem>
            ) : null}
            {canDeleteExpense ? (
              <MuiMenuItem
                sx={{ ...menuItemSx, color: 'error.main' }}
                onClick={() => {
                  if (menuExpense) setDeleteTarget(menuExpense)
                  closeMenu()
                }}
              >
                Delete
              </MuiMenuItem>
            ) : null}
          </>
        )}
      </Menu>

      <GlobalExpenseDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        editingExpense={editingExpense}
        onSuccess={() => {
          void reloadExpenses()
          refreshExpenseSummary()
        }}
      />

      <ViewExpenseModal
        open={!!viewExpense}
        expense={viewExpense}
        onClose={() => setViewExpense(null)}
        projectName={viewModalProjectName}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete expense?"
        size="xs"
        footer={
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button variant="outlined" size="sm" onClick={() => setDeleteTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="contained" color="error" size="sm" onClick={confirmDelete} loading={saving}>
              Delete
            </Button>
          </Stack>
        }
      >
        <Typography variant="body2">
          Remove <strong>{deleteTarget?.description}</strong>? This cannot be undone.
        </Typography>
      </Modal>
    </>
  )
}
