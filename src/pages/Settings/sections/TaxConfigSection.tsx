import { useEffect, useState } from 'react'
import {
  Box, Typography, Tabs, Tab,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  TextField, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Skeleton,
} from '@mui/material'
import { Plus } from 'lucide-react'
import { Button, Modal, useToast } from '@/design-system/components'
import {
  FilterableSortHeader,
  SettingsSearchBar,
  StatusColumnToggle,
  useListingQuery,
  type ColumnFilterOption,
} from '@/components/listing'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  fetchGSTRates, createGSTRate, updateGSTRate, toggleGSTRateStatus,
  fetchTDSSections, createTDSSection, updateTDSSection, toggleTDSSectionStatus,
} from '@/slices/settings/thunk'
import type { GSTRate, TDSSection } from '@/slices/settings/reducer'
import { taxConfigurationService } from '@/modules/system-settings/tax/tax-configuration.service'
import {
  SETTINGS_TABLE_CELL_ACTION_SX,
  SETTINGS_TABLE_CELL_SX,
  SETTINGS_TABLE_HEADER_ACTION_SX,
  SETTINGS_TABLE_HEADER_CELL_SX,
  SETTINGS_TABLE_SX,
  settingsDataColWidth,
} from '../components/settingsTableStyles'
import SettingsDescriptionCell from '../components/SettingsDescriptionCell'
import { SettingsEditAction, SettingsTableActionsCell } from '../components/SettingsTableActions'
import {
  requiredText,
  optionalMaxLength,
  requiredGstRateInput,
  requiredRateInput,
  collectErrors,
  hasErrors,
  firstErrorMessage,
} from '@/modules/system-settings/shared/settings-validation'
import { parseSettingsApiError, clearFieldError } from '@/modules/system-settings/shared/api-errors'
import { LISTING_DEFAULT_PAGE_SIZE } from '@/components/listing/listingStandards'
import { SettingsListingPagination } from '../components/SettingsListingPagination'

type GSTForm = Omit<GSTRate, 'id'>
type TDSForm = Omit<TDSSection, 'id'>

const defaultGSTForm: GSTForm = { slabName: '', rate: 0, description: '', status: 'active' }
const defaultTDSForm: TDSForm = { section: '', description: '', defaultRate: 0, status: 'active' }
const GST_DATA_COL_COUNT = 4
const TDS_DATA_COL_COUNT = 4
const gstDataColWidth = settingsDataColWidth(GST_DATA_COL_COUNT)
const tdsDataColWidth = settingsDataColWidth(TDS_DATA_COL_COUNT)
type GSTFilterOptions = {
  slabName: ColumnFilterOption[]
  ratePercent: ColumnFilterOption[]
  status: ColumnFilterOption[]
}
type TDSFilterOptions = {
  sectionCode: ColumnFilterOption[]
  description: ColumnFilterOption[]
  defaultRatePercent: ColumnFilterOption[]
  status: ColumnFilterOption[]
}

function parseRateInput(raw: string): number {
  if (raw.trim() === '') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Keep GST rate field as digits only (no decimals). */
function sanitizeGstRateInput(raw: string): string {
  return raw.replace(/[^\d]/g, '')
}

function isDuplicateGstRate(
  rate: number,
  rates: GSTRate[],
  filterRates: ColumnFilterOption[],
  editingId?: string,
  editingRate?: number,
): boolean {
  if (!Number.isFinite(rate)) return false
  const nextRate = Number(rate)
  const originalRate =
    editingRate !== undefined && editingRate !== null && Number.isFinite(Number(editingRate))
      ? Number(editingRate)
      : undefined

  // Status-only / unchanged rate while editing this row — never treat as a duplicate of itself.
  if (editingId && originalRate !== undefined && originalRate === nextRate) return false

  if (rates.some((row) => row.id !== editingId && Number(row.rate) === nextRate)) return true

  // Filter options cover rates on other pages (create, or edit changing to another slab's rate).
  return filterRates.some((opt) => Number(opt.value) === nextRate)
}

type ToggleTarget =
  | { kind: 'gst'; row: GSTRate }
  | { kind: 'tds'; row: TDSSection }

export default function TaxConfigSection() {
  const dispatch = useAppDispatch()
  const success = useToast((s) => s.success)
  const error = useToast((s) => s.error)
  const { gstRates, gstRatesTotal, tdsSections, tdsSectionsTotal, saving, loading } = useAppSelector(s => s.settings)
  const [tab, setTab] = useState(0)

  const [gstDrawerOpen, setGstDrawerOpen] = useState(false)
  const [editingGST, setEditingGST] = useState<GSTRate | null>(null)
  const [gstForm, setGstForm] = useState<GSTForm>(defaultGSTForm)
  const [gstRateInput, setGstRateInput] = useState('')
  const [gstFieldErrors, setGstFieldErrors] = useState<Record<string, string>>({})

  const [tdsDrawerOpen, setTdsDrawerOpen] = useState(false)
  const [editingTDS, setEditingTDS] = useState<TDSSection | null>(null)
  const [tdsForm, setTdsForm] = useState<TDSForm>(defaultTDSForm)
  const [tdsRateInput, setTdsRateInput] = useState('')
  const [tdsFieldErrors, setTdsFieldErrors] = useState<Record<string, string>>({})

  const [toggleTarget, setToggleTarget] = useState<ToggleTarget | null>(null)
  const [toggling, setToggling] = useState(false)
  const gstListing = useListingQuery({ pageSize: LISTING_DEFAULT_PAGE_SIZE })
  const tdsListing = useListingQuery({ pageSize: LISTING_DEFAULT_PAGE_SIZE })
  const [gstSortField, setGstSortField] = useState<string>()
  const [gstSortDirection, setGstSortDirection] = useState<'asc' | 'desc'>('asc')
  const [tdsSortField, setTdsSortField] = useState<string>()
  const [tdsSortDirection, setTdsSortDirection] = useState<'asc' | 'desc'>('asc')
  const [gstFilterOptions, setGstFilterOptions] = useState<GSTFilterOptions>({
    slabName: [],
    ratePercent: [],
    status: [],
  })
  const [tdsFilterOptions, setTdsFilterOptions] = useState<TDSFilterOptions>({
    sectionCode: [],
    description: [],
    defaultRatePercent: [],
    status: [],
  })
  const gstSearch = gstListing.search.trim()
  const tdsSearch = tdsListing.search.trim()
  const isGstSearchPending = gstSearch.length > 0 && gstSearch !== gstListing.debouncedSearch
  const isTdsSearchPending = tdsSearch.length > 0 && tdsSearch !== tdsListing.debouncedSearch

  const loadGstFilterOptions = () => {
    void taxConfigurationService.getGstFilters()
      .then((data) => {
        setGstFilterOptions({
          slabName: data.slabName ?? [],
          ratePercent: data.ratePercent ?? [],
          status: data.status ?? [],
        })
      })
      .catch(() => undefined)
  }

  const loadTdsFilterOptions = () => {
    void taxConfigurationService.getTdsFilters()
      .then((data) => {
        setTdsFilterOptions({
          sectionCode: data.sectionCode ?? [],
          description: data.description ?? [],
          defaultRatePercent: data.defaultRatePercent ?? [],
          status: data.status ?? [],
        })
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    loadGstFilterOptions()
    loadTdsFilterOptions()
  }, [dispatch])

  useEffect(() => {
    if (tab === 0) loadGstFilterOptions()
    else loadTdsFilterOptions()
  }, [tab])

  const buildGstListParams = () => ({
    force: true as const,
    page: gstListing.apiPage,
    limit: gstListing.pageSize,
    search: gstListing.debouncedSearch || undefined,
    slabName: gstListing.filters.slabName,
    ratePercent: gstListing.filters.ratePercent,
    status: gstListing.filters.status,
    sortBy: gstSortField,
    sortOrder: gstSortField ? gstSortDirection : undefined,
  })

  const buildTdsListParams = () => ({
    force: true as const,
    page: tdsListing.apiPage,
    limit: tdsListing.pageSize,
    search: tdsListing.debouncedSearch || undefined,
    sectionCode: tdsListing.filters.sectionCode,
    description: tdsListing.filters.description,
    defaultRatePercent: tdsListing.filters.defaultRatePercent,
    status: tdsListing.filters.status,
    sortBy: tdsSortField,
    sortOrder: tdsSortField ? tdsSortDirection : undefined,
  })

  useEffect(() => {
    if (isGstSearchPending) return
    void dispatch(fetchGSTRates(buildGstListParams()))
  }, [dispatch, gstListing.debouncedSearch, gstListing.filters, gstListing.page, gstListing.pageSize, gstSearch, gstSortDirection, gstSortField, isGstSearchPending])

  useEffect(() => {
    if (isTdsSearchPending) return
    void dispatch(fetchTDSSections(buildTdsListParams()))
  }, [dispatch, isTdsSearchPending, tdsListing.debouncedSearch, tdsListing.filters, tdsListing.page, tdsListing.pageSize, tdsSearch, tdsSortDirection, tdsSortField])

  const applyGstFilter = (key: string) => (value: string) => {
    gstListing.setFilter(key, value)
  }

  const applyTdsFilter = (key: string) => (value: string) => {
    tdsListing.setFilter(key, value)
  }

  const handleGstSort = (field: string, direction: 'asc' | 'desc') => {
    setGstSortField(field)
    setGstSortDirection(direction)
  }

  const handleTdsSort = (field: string, direction: 'asc' | 'desc') => {
    setTdsSortField(field)
    setTdsSortDirection(direction)
  }

  const closeGstDrawer = () => {
    setGstDrawerOpen(false)
    setEditingGST(null)
    setGstForm(defaultGSTForm)
    setGstRateInput('')
    setGstFieldErrors({})
  }

  const closeTdsDrawer = () => {
    setTdsDrawerOpen(false)
    setEditingTDS(null)
    setTdsForm(defaultTDSForm)
    setTdsRateInput('')
    setTdsFieldErrors({})
  }

  const resetGstListing = () => {
    gstListing.setSearch('')
    gstListing.setFilters({})
    setGstSortField(undefined)
    setGstSortDirection('asc')
  }

  const resetTdsListing = () => {
    tdsListing.setSearch('')
    tdsListing.setFilters({})
    setTdsSortField(undefined)
    setTdsSortDirection('asc')
  }

  const openAddGST = () => {
    setEditingGST(null)
    setGstForm(defaultGSTForm)
    setGstRateInput('')
    setGstFieldErrors({})
    setGstDrawerOpen(true)
  }
  const openEditGST = (row: GSTRate) => {
    setEditingGST(row)
    setGstForm({ slabName: row.slabName, rate: row.rate, description: row.description, status: row.status })
    setGstRateInput(String(row.rate))
    setGstFieldErrors({})
    setGstDrawerOpen(true)
  }
  const handleSaveGST = () => {
    const rateValidator = editingGST
      ? (raw: string) => requiredRateInput(raw, 'Rate')
      : requiredGstRateInput
    const rateValidationError = rateValidator(gstRateInput)
    const rate = parseRateInput(gstRateInput)
    const duplicateRate =
      !rateValidationError &&
      isDuplicateGstRate(
        rate,
        gstRates,
        gstFilterOptions.ratePercent,
        editingGST?.id,
        editingGST?.rate,
      )
    const next = collectErrors([
      ['slabName', requiredText(gstForm.slabName, 'Slab Name', 100)],
      ['rate', rateValidationError ?? (duplicateRate ? 'This GST rate value already exists' : undefined)],
      ['description', optionalMaxLength(gstForm.description, 'Description', 500)],
    ])
    setGstFieldErrors(next)
    if (hasErrors(next)) {
      error(firstErrorMessage(next, 'Please fix the highlighted fields'))
      return
    }
    const payload: GSTForm = {
      ...gstForm,
      slabName: gstForm.slabName.trim(),
      rate,
    }
    const action = editingGST
      ? dispatch(
          updateGSTRate({
            id: editingGST.id,
            slabName: payload.slabName,
            description: payload.description,
            status: payload.status,
            // Keep existing rate when unchanged so status-only edits never re-validate uniqueness.
            rate: Number(editingGST.rate) === rate ? editingGST.rate : rate,
          }),
        )
      : dispatch(createGSTRate(payload))
    action.unwrap()
      .then(() => {
        closeGstDrawer()
        loadGstFilterOptions()
        if (!editingGST) {
          gstListing.setPage(0)
          setGstSortField(undefined)
          setGstSortDirection('asc')
        }
        void dispatch(
          fetchGSTRates({
            ...buildGstListParams(),
            page: editingGST ? gstListing.apiPage : 1,
            sortBy: editingGST ? gstSortField : undefined,
            sortOrder: editingGST && gstSortField ? gstSortDirection : undefined,
          }),
        )
        success(editingGST ? 'GST rate updated' : 'GST rate added')
      })
      .catch((err) => {
        const parsed = parseSettingsApiError(err, 'Failed to save GST rate')
        const fieldErrors = { ...parsed.fieldErrors }
        if (
          !fieldErrors.rate &&
          /gst rate value already exists/i.test(parsed.message)
        ) {
          fieldErrors.rate = 'This GST rate value already exists'
        }
        if (Object.keys(fieldErrors).length) setGstFieldErrors(fieldErrors)
        error(parsed.message)
      })
  }

  const openAddTDS = () => {
    setEditingTDS(null)
    setTdsForm(defaultTDSForm)
    setTdsRateInput('')
    setTdsFieldErrors({})
    setTdsDrawerOpen(true)
  }
  const openEditTDS = (row: TDSSection) => {
    setEditingTDS(row)
    setTdsForm({
      section: row.section,
      description: row.description,
      defaultRate: row.defaultRate,
      status: row.status,
    })
    setTdsRateInput(String(row.defaultRate))
    setTdsFieldErrors({})
    setTdsDrawerOpen(true)
  }
  const handleSaveTDS = () => {
    const next = collectErrors([
      ['section', requiredText(tdsForm.section, 'Section', 50)],
      ['defaultRate', requiredRateInput(tdsRateInput, 'Default Rate')],
      ['description', optionalMaxLength(tdsForm.description, 'Description', 500)],
    ])
    setTdsFieldErrors(next)
    if (hasErrors(next)) {
      error(firstErrorMessage(next, 'Please fix the highlighted fields'))
      return
    }
    const payload: Omit<TDSSection, 'id'> = {
      section: tdsForm.section.trim(),
      description: tdsForm.description,
      defaultRate: parseRateInput(tdsRateInput),
      status: tdsForm.status,
    }
    const action = editingTDS
      ? dispatch(updateTDSSection({ id: editingTDS.id, ...payload }))
      : dispatch(createTDSSection(payload))
    action.unwrap()
      .then(() => {
        closeTdsDrawer()
        loadTdsFilterOptions()
        if (!editingTDS) {
          tdsListing.setPage(0)
          setTdsSortField(undefined)
          setTdsSortDirection('asc')
        }
        void dispatch(
          fetchTDSSections({
            ...buildTdsListParams(),
            page: editingTDS ? tdsListing.apiPage : 1,
            sortBy: editingTDS ? tdsSortField : undefined,
            sortOrder: editingTDS && tdsSortField ? tdsSortDirection : undefined,
          }),
        )
        success(editingTDS ? 'TDS section updated' : 'TDS section added')
      })
      .catch((err) => {
        const parsed = parseSettingsApiError(err, 'Failed to save TDS section')
        if (Object.keys(parsed.fieldErrors).length) setTdsFieldErrors(parsed.fieldErrors)
        error(parsed.message)
      })
  }

  const confirmToggle = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      if (toggleTarget.kind === 'gst') {
        await dispatch(toggleGSTRateStatus(toggleTarget.row.id)).unwrap()
        void dispatch(fetchGSTRates(buildGstListParams()))
        loadGstFilterOptions()
        success(
          toggleTarget.row.status === 'active'
            ? 'GST rate deactivated'
            : 'GST rate activated',
        )
      } else {
        await dispatch(toggleTDSSectionStatus(toggleTarget.row.id)).unwrap()
        void dispatch(fetchTDSSections(buildTdsListParams()))
        loadTdsFilterOptions()
        success(
          toggleTarget.row.status === 'active'
            ? 'TDS section deactivated'
            : 'TDS section activated',
        )
      }
      setToggleTarget(null)
    } catch (err) {
      const parsed = parseSettingsApiError(err, 'Failed to update status')
      error(parsed.message)
    } finally {
      setToggling(false)
    }
  }

  const toggleLabel = toggleTarget
    ? toggleTarget.kind === 'gst'
      ? toggleTarget.row.slabName
      : toggleTarget.row.section
    : ''
  const toggleNextActive = toggleTarget?.row.status !== 'active'

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} mb={0.5}>Tax Configuration</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={2}>
        GST slabs and TDS sections used across invoicing
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: '1px solid #E8EEEC', mb: 3 }}>
        <Tab label="GST Rates" sx={{ textTransform: 'none', fontSize: 13 }} />
        <Tab label="TDS Sections" sx={{ textTransform: 'none', fontSize: 13 }} />
      </Tabs>

      {tab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>Goods & Services Tax (GST) Slabs</Typography>
            <Button variant="contained" color="primary" size="sm" startIcon={<Plus size={14} strokeWidth={2} />} onClick={openAddGST}>
              Add Rate
            </Button>
          </Box>
          <SettingsSearchBar
            placeholder="Search GST rates..."
            value={gstListing.search}
            onChange={gstListing.setSearch}
            onReset={resetGstListing}
          />
          <TableContainer sx={{ width: '100%' }}>
          <Table size="small" sx={SETTINGS_TABLE_SX}>
            <colgroup>
              <col style={{ width: gstDataColWidth }} />
              <col style={{ width: gstDataColWidth }} />
              <col style={{ width: gstDataColWidth }} />
              <col style={{ width: gstDataColWidth }} />
              <col style={{ width: SETTINGS_TABLE_CELL_ACTION_SX.width }} />
            </colgroup>
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFB' }}>
                <FilterableSortHeader
                  label="Slab Name"
                  field="slabName"
                  sortField={gstSortField}
                  sortDirection={gstSortDirection}
                  onSort={handleGstSort}
                  filterValue={gstListing.filters.slabName ?? ''}
                  filterOptions={gstFilterOptions.slabName}
                  onFilter={applyGstFilter('slabName')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <FilterableSortHeader
                  label="Rate %"
                  field="ratePercent"
                  sortField={gstSortField}
                  sortDirection={gstSortDirection}
                  onSort={handleGstSort}
                  filterValue={gstListing.filters.ratePercent ?? ''}
                  filterOptions={gstFilterOptions.ratePercent}
                  onFilter={applyGstFilter('ratePercent')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <FilterableSortHeader
                  label="Description"
                  field="description"
                  sortField={gstSortField}
                  sortDirection={gstSortDirection}
                  onSort={handleGstSort}
                  filterable={false}
                  filterValue=""
                  filterOptions={[]}
                  onFilter={() => {}}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <FilterableSortHeader
                  label="Status"
                  field="status"
                  sortField={gstSortField}
                  sortDirection={gstSortDirection}
                  onSort={handleGstSort}
                  filterValue={gstListing.filters.status ?? ''}
                  filterOptions={gstFilterOptions.status}
                  onFilter={applyGstFilter('status')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <TableCell sx={SETTINGS_TABLE_HEADER_ACTION_SX}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && gstRates.length === 0
                ? [...Array(6)].map((_, i) => (
                    <TableRow key={i} sx={{ height: 44 }}>
                      {[...Array(GST_DATA_COL_COUNT + 1)].map((__, j) => (
                        <TableCell key={j} sx={SETTINGS_TABLE_CELL_SX}>
                          <Skeleton height={20} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : gstRates.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={GST_DATA_COL_COUNT + 1} sx={{ ...SETTINGS_TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                        No records found
                      </TableCell>
                    </TableRow>
                  )
                  : gstRates.map(row => (
                    <TableRow key={row.id} sx={{ height: 44 }}>
                      <TableCell sx={SETTINGS_TABLE_CELL_SX}>{row.slabName}</TableCell>
                      <TableCell sx={SETTINGS_TABLE_CELL_SX}>{row.rate}%</TableCell>
                      <SettingsDescriptionCell value={row.description} />
                      <TableCell sx={SETTINGS_TABLE_CELL_SX}>
                        <StatusColumnToggle
                          active={row.status === 'active'}
                          onToggle={() => setToggleTarget({ kind: 'gst', row })}
                        />
                      </TableCell>
                      <SettingsTableActionsCell>
                        <SettingsEditAction onClick={() => openEditGST(row)} />
                      </SettingsTableActionsCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          </TableContainer>

          <SettingsListingPagination
            page={gstListing.page}
            pageSize={gstListing.pageSize}
            totalCount={gstRatesTotal}
            onPageChange={gstListing.setPage}
            onPageSizeChange={gstListing.setPageSize}
          />
        </Box>
      )}

      {tab === 1 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>TDS Sections</Typography>
            <Button variant="contained" color="primary" size="sm" startIcon={<Plus size={14} strokeWidth={2} />} onClick={openAddTDS}>
              Add Section
            </Button>
          </Box>
          <SettingsSearchBar
            placeholder="Search TDS sections..."
            value={tdsListing.search}
            onChange={tdsListing.setSearch}
            onReset={resetTdsListing}
          />
          <TableContainer sx={{ width: '100%' }}>
          <Table size="small" sx={SETTINGS_TABLE_SX}>
            <colgroup>
              <col style={{ width: tdsDataColWidth }} />
              <col style={{ width: tdsDataColWidth }} />
              <col style={{ width: tdsDataColWidth }} />
              <col style={{ width: tdsDataColWidth }} />
              <col style={{ width: SETTINGS_TABLE_CELL_ACTION_SX.width }} />
            </colgroup>
            <TableHead>
              <TableRow sx={{ bgcolor: '#F8FAFB' }}>
                <FilterableSortHeader
                  label="Section"
                  field="sectionCode"
                  sortField={tdsSortField}
                  sortDirection={tdsSortDirection}
                  onSort={handleTdsSort}
                  filterValue={tdsListing.filters.sectionCode ?? ''}
                  filterOptions={tdsFilterOptions.sectionCode}
                  onFilter={applyTdsFilter('sectionCode')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <FilterableSortHeader
                  label="Description"
                  field="description"
                  sortField={tdsSortField}
                  sortDirection={tdsSortDirection}
                  onSort={handleTdsSort}
                  filterValue={tdsListing.filters.description ?? ''}
                  filterOptions={tdsFilterOptions.description}
                  onFilter={applyTdsFilter('description')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <FilterableSortHeader
                  label="Default Rate %"
                  field="defaultRatePercent"
                  sortField={tdsSortField}
                  sortDirection={tdsSortDirection}
                  onSort={handleTdsSort}
                  filterValue={tdsListing.filters.defaultRatePercent ?? ''}
                  filterOptions={tdsFilterOptions.defaultRatePercent}
                  onFilter={applyTdsFilter('defaultRatePercent')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <FilterableSortHeader
                  label="Status"
                  field="status"
                  sortField={tdsSortField}
                  sortDirection={tdsSortDirection}
                  onSort={handleTdsSort}
                  filterValue={tdsListing.filters.status ?? ''}
                  filterOptions={tdsFilterOptions.status}
                  onFilter={applyTdsFilter('status')}
                  sx={SETTINGS_TABLE_HEADER_CELL_SX}
                />
                <TableCell sx={SETTINGS_TABLE_HEADER_ACTION_SX}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && tdsSections.length === 0
                ? [...Array(6)].map((_, i) => (
                    <TableRow key={i} sx={{ height: 44 }}>
                      {[...Array(TDS_DATA_COL_COUNT + 1)].map((__, j) => (
                        <TableCell key={j} sx={SETTINGS_TABLE_CELL_SX}>
                          <Skeleton height={20} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : tdsSections.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={TDS_DATA_COL_COUNT + 1} sx={{ ...SETTINGS_TABLE_CELL_SX, py: 4, textAlign: 'center' }}>
                        No records found
                      </TableCell>
                    </TableRow>
                  )
                  : tdsSections.map(row => (
                    <TableRow key={row.id} sx={{ height: 44 }}>
                      <TableCell sx={{ ...SETTINGS_TABLE_CELL_SX, fontWeight: 600 }}>{row.section}</TableCell>
                      <SettingsDescriptionCell value={row.description} />
                      <TableCell sx={SETTINGS_TABLE_CELL_SX}>{row.defaultRate}%</TableCell>
                      <TableCell sx={SETTINGS_TABLE_CELL_SX}>
                        <StatusColumnToggle
                          active={row.status === 'active'}
                          onToggle={() => setToggleTarget({ kind: 'tds', row })}
                        />
                      </TableCell>
                      <SettingsTableActionsCell>
                        <SettingsEditAction onClick={() => openEditTDS(row)} />
                      </SettingsTableActionsCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          </TableContainer>

          <SettingsListingPagination
            page={tdsListing.page}
            pageSize={tdsListing.pageSize}
            totalCount={tdsSectionsTotal}
            onPageChange={tdsListing.setPage}
            onPageSizeChange={tdsListing.setPageSize}
          />
        </Box>
      )}

      <Modal
        open={gstDrawerOpen}
        onClose={closeGstDrawer}
        title={editingGST ? 'Edit GST Rate' : 'Add GST Rate'}
        size="xs"
        footer={
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="sm" variant="outlined" color="secondary" onClick={closeGstDrawer}>
              Cancel
            </Button>
            <Button size="sm" variant="contained" color="primary" onClick={handleSaveGST} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </Box>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            size="small"
            label="Slab Name"
            required
            fullWidth
            placeholder="e.g. GST 18%"
            value={gstForm.slabName}
            onChange={e => {
              setGstForm(f => ({ ...f, slabName: e.target.value }))
              setGstFieldErrors(errors => clearFieldError(errors, 'slabName'))
            }}
            error={!!gstFieldErrors.slabName}
            helperText={gstFieldErrors.slabName}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              size="small"
              label="Rate (%)"
              type="text"
              inputMode="numeric"
              required
              fullWidth
              placeholder="e.g. 18"
              value={gstRateInput}
              onChange={e => {
                setGstRateInput(sanitizeGstRateInput(e.target.value))
                setGstFieldErrors(errors => clearFieldError(errors, 'rate'))
              }}
              inputProps={{ min: 0, max: 100, pattern: '[0-9]*' }}
              sx={{ flex: 1, minWidth: 0 }}
              error={!!gstFieldErrors.rate}
              helperText={gstFieldErrors.rate}
            />
            <TextField
              select
              size="small"
              label="Status"
              fullWidth
              value={gstForm.status}
              onChange={e => setGstForm(f => ({ ...f, status: e.target.value as GSTRate['status'] }))}
              sx={{ flex: 1, minWidth: 0 }}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          </Box>
          <TextField
            size="small"
            label="Description"
            fullWidth
            placeholder="e.g. Standard Services Rate"
            value={gstForm.description}
            onChange={e => {
              setGstForm(f => ({ ...f, description: e.target.value }))
              setGstFieldErrors(errors => clearFieldError(errors, 'description'))
            }}
            error={!!gstFieldErrors.description}
            helperText={gstFieldErrors.description}
          />
        </Box>
      </Modal>

      <Modal
        open={tdsDrawerOpen}
        onClose={closeTdsDrawer}
        title={editingTDS ? 'Edit TDS Section' : 'Add TDS Section'}
        size="xs"
        footer={
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="sm" variant="outlined" color="secondary" onClick={closeTdsDrawer}>
              Cancel
            </Button>
            <Button size="sm" variant="contained" color="primary" onClick={handleSaveTDS} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </Box>
        }
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            size="small"
            label="Section"
            required
            fullWidth
            placeholder="e.g. 194C"
            value={tdsForm.section}
            onChange={e => {
              setTdsForm(f => ({ ...f, section: e.target.value }))
              setTdsFieldErrors(errors => clearFieldError(errors, 'section'))
            }}
            error={!!tdsFieldErrors.section}
            helperText={tdsFieldErrors.section}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              size="small"
              label="Default Rate (%)"
              type="number"
              required
              fullWidth
              placeholder="e.g. 10"
              value={tdsRateInput}
              onChange={e => {
                setTdsRateInput(e.target.value)
                setTdsFieldErrors(errors => clearFieldError(errors, 'defaultRate'))
              }}
              inputProps={{ min: 0, max: 100, step: 1 }}
              sx={{ flex: 1, minWidth: 0 }}
              error={!!tdsFieldErrors.defaultRate}
              helperText={tdsFieldErrors.defaultRate}
            />
            <TextField
              select
              size="small"
              label="Status"
              fullWidth
              value={tdsForm.status}
              onChange={e => setTdsForm(f => ({ ...f, status: e.target.value as TDSSection['status'] }))}
              sx={{ flex: 1, minWidth: 0 }}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          </Box>
          <TextField
            size="small"
            label="Description"
            fullWidth
            placeholder="Optional description"
            value={tdsForm.description}
            onChange={e => {
              setTdsForm(f => ({ ...f, description: e.target.value }))
              setTdsFieldErrors(errors => clearFieldError(errors, 'description'))
            }}
            error={!!tdsFieldErrors.description}
            helperText={tdsFieldErrors.description}
          />
        </Box>
      </Modal>

      <Dialog open={!!toggleTarget} onClose={() => !toggling && setToggleTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{toggleNextActive ? 'Activate' : 'Deactivate'}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {toggleNextActive
              ? `Activate "${toggleLabel}"?`
              : `Deactivate "${toggleLabel}"? It will no longer be available for new records.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="sm" variant="outlined" color="secondary" onClick={() => setToggleTarget(null)} disabled={toggling}>
            Cancel
          </Button>
          <Button size="sm" variant="contained" color="primary" onClick={() => void confirmToggle()} disabled={toggling}>
            {toggling ? 'Updating...' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
