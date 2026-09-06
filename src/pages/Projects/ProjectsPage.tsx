import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Stack,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  IconButton,
  Menu,
  MenuItem,
  Divider,
  Chip as MuiChip,
  Card as MuiCard,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button as MuiButton,
  Select as MuiSelect,
  FormControl,
  Skeleton,
} from '@mui/material'
import {
  MoreVert,
  PersonOutline,
  CalendarToday,
  EventBusy,
  PlayCircle,
  CheckCircle,
  Visibility,
  Edit,
  LocationOn,
  Archive,
  CancelOutlined,
} from '@mui/icons-material'
import { FolderKanban, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchProjects, fetchProjectFilters, changeProjectStatus, updateProject } from '../../slices/projects/thunk'
import { FilterableSortHeader, type ColumnFilterOption } from '@/components/listing'
import {
  buildProjectsStartEndCellModel,
  mergeProjectsDualDateColFilters,
} from './projectsDatesCell'
import { projectsService, type ProjectFiltersApi } from '@/modules/projects'
import { fetchUsers } from '../../slices/users/thunk'
import { fetchRoles } from '../../slices/roles/thunk'
import { isProjectLeadRole } from './projectManagerRoles'
import {
  setFilters,
  resetFilters,
  setPage,
  setPageSize,
  setSortConfig,
} from '../../slices/projects/reducer'
import type { Project } from '../../slices/projects/reducer'
import { ListingTemplate } from '../../components/templates/ListingTemplate'
import { useToast, ConfirmDialog } from '@/design-system/components'
import { EditProjectDrawer } from './components/EditProjectDrawer'
import { tokens } from '@/design-system/tokens'
import { useTheme } from '@mui/material/styles'
import {
  formatInr,
  formatDate,
  getInitials,
  getAvatarColor,
} from '../../utils/formatters'
import { formatProjectSite } from '../../utils/projectSite'
import { getProjectTypes, PROJECT_TYPE_OPTIONS } from './projectTypes'
import { ProjectTypeTags } from './components/ProjectTypeTags'
import { financeApi } from '@/api/financeApi'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import {
  getStatusMasterChipColors,
  lifecycleStatusForMasterName,
} from '../../utils/masterChipStyles'
import type { StatusMaster } from '../../slices/settings/reducer'
import { usePermission } from '@/hooks/usePermission'

// ─── Column visibility state ──────────────────────────────────────────────────

interface ColumnVisibility {
  projectName: boolean
  status: boolean
  type: boolean
  projectLead: boolean
  dates: boolean
}

/** API list projection keys from Toggle Columns visibility. */
function buildProjectListColumns(cols: ColumnVisibility): string[] {
  return [
    'id',
    'projectCode',
    'projectName',
    'status',
    'statusLabel',
    'customerId',
    'customerName',
    'sector',
    'sectorLabel',
    'location',
    'city',
    'state',
    ...(cols.type ? (['projectTypes'] as const) : []),
    ...(cols.projectLead ? (['projectLeadName'] as const) : []),
    'carpetAreaSqFt',
    ...(cols.dates ? (['expectedStartDate', 'expectedEndDate'] as const) : []),
    'totalDesignFee',
    'totalBuildValue',
    'totalClientPOValue',
    'createdAt',
    'wentLiveAt',
    'completedAt',
    'archivedAt',
    'cancelledAt',
  ]
}

// ─── Project Avatar ───────────────────────────────────────────────────────────

function ProjectAvatar({ name }: { name: string }) {
  const colors = getAvatarColor(name)
  return (
    <Box
      sx={{
        width: 30,
        height: 30,
        borderRadius: '6px',
        bgcolor: colors.bg,
        color: colors.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </Box>
  )
}

// ─── Progress badge (Status Master colors) ────────────────────────────────────

function ProgressBadge({ label }: { label: string }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const colors = getStatusMasterChipColors(label, mode)
  return (
    <MuiChip
      label={label}
      size="small"
      sx={{
        height: 18,
        fontSize: 10,
        fontWeight: 600,
        bgcolor: colors.bg,
        color: colors.color,
        borderRadius: '4px',
        border: 'none',
        '& .MuiChip-label': { px: '6px' },
      }}
    />
  )
}

// ─── Row actions ──────────────────────────────────────────────────────────────

interface RowActionsProps {
  project: Project
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  showChangeStatus: boolean
  onView: () => void
  onEdit: () => void
  onChangeStatus: () => void
  onComplete: () => void
  onArchive: () => void
  onCancel: () => void
}

function RowActions({
  project,
  canView,
  canEdit,
  canDelete,
  showChangeStatus,
  onView,
  onEdit,
  onChangeStatus,
  onComplete,
  onArchive,
  onCancel,
}: RowActionsProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const showLifecycleActions = canDelete && project.status === 'Live'
  const hasActions = canView || canEdit || showLifecycleActions

  if (!hasActions) return null

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVert sx={{ fontSize: 16 }} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        PaperProps={{ sx: { minWidth: 160 } }}
      >
        {canView ? (
          <MenuItem
            onClick={() => { setAnchor(null); onView() }}
            sx={{ fontSize: 13, gap: 1 }}
          >
            <Visibility sx={{ fontSize: 14 }} /> View
          </MenuItem>
        ) : null}
        {canEdit ? (
          <MenuItem
            onClick={() => { setAnchor(null); onEdit() }}
            sx={{ fontSize: 13, gap: 1 }}
          >
            <Edit sx={{ fontSize: 14 }} /> Edit Basic Info
          </MenuItem>
        ) : null}
        {canEdit && showChangeStatus ? (
          <>
            <Divider />
            <MenuItem
              onClick={() => { setAnchor(null); onChangeStatus() }}
              sx={{ fontSize: 13 }}
            >
              Change Status
            </MenuItem>
          </>
        ) : null}
        {showLifecycleActions ? (
          <>
            <MenuItem
              onClick={() => { setAnchor(null); onComplete() }}
              sx={{ fontSize: 13, gap: 1 }}
            >
              <CheckCircle sx={{ fontSize: 14 }} /> Complete Project
            </MenuItem>
            <MenuItem
              onClick={() => { setAnchor(null); onArchive() }}
              sx={{ fontSize: 13, gap: 1 }}
            >
              <Archive sx={{ fontSize: 14 }} /> Archive Project
            </MenuItem>
            <MenuItem
              onClick={() => { setAnchor(null); onCancel() }}
              sx={{ fontSize: 13, gap: 1, color: 'error.main' }}
            >
              <CancelOutlined sx={{ fontSize: 14 }} /> Cancel Project
            </MenuItem>
          </>
        ) : null}
      </Menu>
    </>
  )
}

// ─── Projects Table ───────────────────────────────────────────────────────────

interface ProjectsTableProps {
  items: Project[]
  loading: boolean
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  columns: ColumnVisibility
  sortField: string | null
  sortDirection: 'asc' | 'desc'
  onSort: (field: string, direction: 'asc' | 'desc') => void
  colFilters: Record<string, string>
  filterOptions: Record<string, ColumnFilterOption[]>
  onColumnFilter: (field: string, value: string) => void
  onDualDateFilter: (start: string, end: string) => void
  statusDateField: 'createdAt' | 'wentLiveAt' | 'completedAt' | 'archivedAt' | 'cancelledAt'
  statusDateLabel: string
  showChangeStatus: boolean
  onView: (project: Project) => void
  onEdit: (project: Project) => void
  onChangeStatus: (project: Project) => void
  onComplete: (project: Project) => void
  onArchive: (project: Project) => void
  onCancel: (project: Project) => void
}

function ProjectsTable({
  items,
  loading,
  canView,
  canEdit,
  canDelete,
  columns,
  sortField,
  sortDirection,
  onSort,
  colFilters,
  filterOptions,
  onColumnFilter,
  onDualDateFilter,
  statusDateField,
  statusDateLabel,
  showChangeStatus,
  onView,
  onEdit,
  onChangeStatus,
  onComplete,
  onArchive,
  onCancel,
}: ProjectsTableProps) {
  const theme = useTheme()
  const hasActions = canView || canEdit || canDelete

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} height={52} sx={{ mb: 1, borderRadius: 1 }} />
        ))}
      </Box>
    )
  }

  if (items.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Box sx={{ color: tokens.color.neutral[300], mb: 1, display: 'flex', justifyContent: 'center' }}>
          <FolderKanban size={40} strokeWidth={1.5} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          No projects found
        </Typography>
      </Box>
    )
  }

  const cellSx = {
    py: '10px',
    px: '12px',
    fontSize: 12,
    borderBottom: `1px solid ${tokens.color.neutral[100]}`,
  }

  const headSx = {
    ...cellSx,
    fontWeight: 600,
    fontSize: 11,
    color: 'text.secondary',
    bgcolor: 'background.default',
    whiteSpace: 'nowrap' as const,
  }

  const actionColWidth = 84
  const actionHeadSx = {
    ...headSx,
    width: actionColWidth,
    minWidth: actionColWidth,
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
  }
  const actionCellSx = {
    ...cellSx,
    width: actionColWidth,
    minWidth: actionColWidth,
    py: '4px',
    px: '12px',
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 640 }}>
        <TableHead>
          <TableRow>
            <FilterableSortHeader
              label="Project"
              field="projectName"
              sortField={sortField ?? undefined}
              sortDirection={sortDirection}
              onSort={onSort}
              filterValue={colFilters.projectName ?? ''}
              filterOptions={filterOptions.projectName ?? []}
              onFilter={(v) => onColumnFilter('projectName', v)}
              sx={headSx}
            />
            {columns.status && (
              <FilterableSortHeader
                label="Status"
                sortable={false}
                filterValue={colFilters.status ?? ''}
                filterOptions={filterOptions.status ?? []}
                onFilter={(v) => onColumnFilter('status', v)}
                sx={headSx}
              />
            )}
            {columns.type && (
              <FilterableSortHeader
                label="Scope"
                sortable={false}
                filterValue={colFilters.projectType ?? ''}
                filterOptions={filterOptions.projectType ?? []}
                onFilter={(v) => onColumnFilter('projectType', v)}
                sx={{ ...headSx, display: { xs: 'none', lg: 'table-cell' } }}
              />
            )}
            {columns.projectLead && (
              <FilterableSortHeader
                label="Project Lead"
                field="projectLeadName"
                sortField={sortField ?? undefined}
                sortDirection={sortDirection}
                onSort={onSort}
                filterValue={colFilters.projectLeadId ?? ''}
                filterOptions={filterOptions.projectLeadId ?? []}
                onFilter={(v) => onColumnFilter('projectLeadId', v)}
                sx={{ ...headSx, display: { xs: 'none', lg: 'table-cell' } }}
              />
            )}
            {columns.dates && (
              <FilterableSortHeader
                label="Start / End Date"
                sortable={false}
                filterMode="dual-date"
                filterDualValue={{
                  start: colFilters.expectedStartDate ?? '',
                  end: colFilters.expectedEndDate ?? '',
                }}
                onFilterDual={({ start, end }) => onDualDateFilter(start, end)}
                dualStartLabel="Expected Start Date"
                dualEndLabel="Expected End Date"
                sx={{ ...headSx, display: { xs: 'none', xl: 'table-cell' } }}
              />
            )}
            <FilterableSortHeader
              label={statusDateLabel}
              field={statusDateField}
              sortField={sortField ?? undefined}
              sortDirection={sortDirection}
              onSort={onSort}
              filterValue={colFilters[statusDateField] ?? ''}
              filterOptions={[]}
              filterMode="date"
              onFilter={(v) => onColumnFilter(statusDateField, v)}
              sx={{ ...headSx, display: { xs: 'none', lg: 'table-cell' } }}
            />
            {hasActions ? <TableCell sx={actionHeadSx}>Action</TableCell> : null}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((project) => {
            const isPastDue =
              project.expectedEndDate &&
              new Date(project.expectedEndDate) < new Date() &&
              project.status !== 'Completed' &&
              project.status !== 'Archived' &&
              project.status !== 'Cancelled'
            const datesCell = buildProjectsStartEndCellModel(
              project.startDate,
              project.expectedEndDate,
            )

            return (
              <TableRow
                key={project.id}
                hover
                onClick={canView ? () => onView(project) : undefined}
                sx={{ cursor: canView ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 } }}
              >
                {/* Project Name */}
                <TableCell sx={cellSx}>
                  <Stack direction="row" alignItems="center" gap={1}>
                    <ProjectAvatar name={project.name} />
                    <Box>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3 }}
                      >
                        {project.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                        {formatProjectSite(project) || project.projectCode}
                      </Typography>
                    </Box>
                  </Stack>
                </TableCell>

                {/* Status */}
                {columns.status && (
                  <TableCell sx={cellSx}>
                    <ProgressBadge label={project.progress} />
                  </TableCell>
                )}

                {/* Type */}
                {columns.type && (
                  <TableCell sx={{ ...cellSx, display: { xs: 'none', lg: 'table-cell' } }}>
                    <ProjectTypeTags types={getProjectTypes(project)} maxVisible={4} />
                  </TableCell>
                )}

                {/* Project Lead */}
                {columns.projectLead && (
                  <TableCell sx={{ ...cellSx, display: { xs: 'none', lg: 'table-cell' } }}>
                    <Stack direction="row" alignItems="center" gap="4px">
                      <PersonOutline sx={{ fontSize: 13, color: 'text.secondary' }} />
                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                        {project.projectManager}
                      </Typography>
                    </Stack>
                  </TableCell>
                )}

                {/* Start / End Date */}
                {columns.dates && (
                  <TableCell sx={{ ...cellSx, display: { xs: 'none', xl: 'table-cell' } }}>
                    <Stack gap="2px">
                      <Stack direction="row" alignItems="center" gap="3px">
                        <CalendarToday sx={{ fontSize: 10, color: 'text.secondary' }} />
                        <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                          {datesCell.startText}
                        </Typography>
                      </Stack>
                      <Stack direction="row" alignItems="center" gap="3px">
                        <EventBusy
                          sx={{
                            fontSize: 10,
                            color: isPastDue ? 'warning.main' : 'text.secondary',
                          }}
                        />
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: 10,
                            color: isPastDue
                              ? theme.palette.warning.main
                              : 'text.secondary',
                          }}
                        >
                          {datesCell.endText}
                        </Typography>
                      </Stack>
                      {datesCell.durationText !== null && (
                        <Typography
                          variant="caption"
                          sx={{ fontSize: 10, color: 'text.secondary', pl: '13px' }}
                        >
                          {datesCell.durationText}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                )}

                <TableCell sx={{ ...cellSx, display: { xs: 'none', lg: 'table-cell' } }}>
                  <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {formatDate(
                      statusDateField === 'createdAt'
                        ? (project.createdAt ?? null)
                        : statusDateField === 'wentLiveAt'
                          ? (project.wentLiveAt ?? null)
                          : statusDateField === 'completedAt'
                            ? (project.completedAt ?? null)
                            : statusDateField === 'archivedAt'
                              ? (project.archivedAt ?? null)
                              : (project.cancelledAt ?? null),
                    )}
                  </Typography>
                </TableCell>

                {/* Actions */}
                {hasActions ? (
                  <TableCell sx={actionCellSx} onClick={(e) => e.stopPropagation()}>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        width: '100%',
                      }}
                    >
                      <RowActions
                        project={project}
                        canView={canView}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        showChangeStatus={showChangeStatus}
                        onView={() => onView(project)}
                        onEdit={() => onEdit(project)}
                        onChangeStatus={() => onChangeStatus(project)}
                        onComplete={() => onComplete(project)}
                        onArchive={() => onArchive(project)}
                        onCancel={() => onCancel(project)}
                      />
                    </Box>
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}

// ─── Project Grid Card ────────────────────────────────────────────────────────

interface ProjectGridCardProps {
  project: Project
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  showChangeStatus: boolean
  onView: (project: Project) => void
  onEdit: (project: Project) => void
  onChangeStatus: (project: Project) => void
  onComplete: (project: Project) => void
  onArchive: (project: Project) => void
  onCancel: (project: Project) => void
}

function ProjectGridCard({
  project,
  canView,
  canEdit,
  canDelete,
  showChangeStatus,
  onView,
  onEdit,
  onChangeStatus,
  onComplete,
  onArchive,
  onCancel,
}: ProjectGridCardProps) {
  const theme = useTheme()
  const gridColors = getAvatarColor(project.name)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const showLifecycleActions = canDelete && project.status === 'Live'
  const hasActions = canView || canEdit || showLifecycleActions

  return (
    <MuiCard
      elevation={0}
      onClick={canView ? () => onView(project) : undefined}
      sx={{
        p: 2,
        border: `1px solid ${tokens.color.neutral[100]}`,
        borderRadius: 2,
        cursor: canView ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s',
        '&:hover': { boxShadow: tokens.shadow.md },
      }}
    >
      {/* Top row */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              bgcolor: gridColors.bg,
              color: gridColors.text,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {getInitials(project.name)}
          </Box>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {project.name}
          </Typography>
        </Stack>
        {hasActions ? (
          <>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget) }}
              sx={{ flexShrink: 0, ml: 0.5 }}
            >
              <MoreVert sx={{ fontSize: 16 }} />
            </IconButton>
            <Menu
              anchorEl={anchor}
              open={Boolean(anchor)}
              onClose={() => setAnchor(null)}
              PaperProps={{ sx: { minWidth: 160 } }}
              onClick={(e) => e.stopPropagation()}
            >
              {canView ? (
                <MenuItem onClick={() => { setAnchor(null); onView(project) }} sx={{ fontSize: 13, gap: 1 }}>
                  <Visibility sx={{ fontSize: 14 }} /> View
                </MenuItem>
              ) : null}
              {canEdit ? (
                <MenuItem onClick={() => { setAnchor(null); onEdit(project) }} sx={{ fontSize: 13, gap: 1 }}>
                  <Edit sx={{ fontSize: 14 }} /> Edit
                </MenuItem>
              ) : null}
              {canEdit && showChangeStatus ? (
                <>
                  <Divider />
                  <MenuItem onClick={() => { setAnchor(null); onChangeStatus(project) }} sx={{ fontSize: 13 }}>
                    Change Status
                  </MenuItem>
                </>
              ) : null}
              {showLifecycleActions ? (
                <>
                  <MenuItem onClick={() => { setAnchor(null); onComplete(project) }} sx={{ fontSize: 13, gap: 1 }}>
                    <CheckCircle sx={{ fontSize: 14 }} /> Complete Project
                  </MenuItem>
                  <MenuItem onClick={() => { setAnchor(null); onArchive(project) }} sx={{ fontSize: 13, gap: 1 }}>
                    <Archive sx={{ fontSize: 14 }} /> Archive Project
                  </MenuItem>
                  <MenuItem
                    onClick={() => { setAnchor(null); onCancel(project) }}
                    sx={{ fontSize: 13, gap: 1, color: 'error.main' }}
                  >
                    <CancelOutlined sx={{ fontSize: 14 }} /> Cancel Project
                  </MenuItem>
                </>
              ) : null}
            </Menu>
          </>
        ) : null}
      </Stack>

      {/* Project code */}
      <Typography variant="caption" sx={{ color: tokens.color.neutral[400], fontSize: 10, mt: '4px', display: 'block' }}>
        {formatProjectSite(project) || project.projectCode}
      </Typography>

      {/* Status row */}
      <Stack direction="row" alignItems="center" gap="6px" sx={{ mt: 1 }}>
        <ProgressBadge label={project.progress} />
      </Stack>

      <Divider sx={{ my: '10px' }} />

      {/* Info rows */}
      <Stack gap="6px">
        <Stack direction="row" alignItems="center" gap="5px">
          <PersonOutline sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary' }}>
            Lead: {project.projectManager}
          </Typography>
        </Stack>
        {project.location && (
          <Stack direction="row" alignItems="center" gap="5px">
            <LocationOn sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} />
            <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.location}
            </Typography>
          </Stack>
        )}
        <Box sx={{ mt: 0.5 }}>
          <ProjectTypeTags types={getProjectTypes(project)} maxVisible={3} />
        </Box>
      </Stack>

      <Divider sx={{ my: '10px' }} />

      {/* Value + dates */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 14, color: theme.palette.primary.main }}>
          ₹{formatInr(project.totalClientPOValue)}
        </Typography>
        {(project.startDate || project.expectedEndDate) && (
          <Typography variant="caption" sx={{ fontSize: 10, color: tokens.color.neutral[400] }}>
            {formatDate(project.startDate)} → {formatDate(project.expectedEndDate)}
          </Typography>
        )}
      </Stack>
    </MuiCard>
  )
}

// ─── Projects Grid ────────────────────────────────────────────────────────────

interface ProjectsGridProps {
  items: Project[]
  loading: boolean
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  showChangeStatus: boolean
  onView: (project: Project) => void
  onEdit: (project: Project) => void
  onChangeStatus: (project: Project) => void
  onComplete: (project: Project) => void
  onArchive: (project: Project) => void
  onCancel: (project: Project) => void
}

function ProjectsGrid({
  items,
  loading,
  canView,
  canEdit,
  canDelete,
  showChangeStatus,
  onView,
  onEdit,
  onChangeStatus,
  onComplete,
  onArchive,
  onCancel,
}: ProjectsGridProps) {
  if (loading) {
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(1,1fr)', md: 'repeat(2,1fr)', xl: 'repeat(3,1fr)' },
          gap: '12px',
          p: 2,
        }}
      >
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
        ))}
      </Box>
    )
  }

  if (items.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Box sx={{ color: tokens.color.neutral[300], mb: 1, display: 'flex', justifyContent: 'center' }}>
          <FolderKanban size={40} strokeWidth={1.5} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          No projects found
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(1,1fr)', md: 'repeat(2,1fr)', xl: 'repeat(3,1fr)' },
        gap: '12px',
        p: 2,
      }}
    >
      {items.map((project) => (
        <ProjectGridCard
          key={project.id}
          project={project}
          canView={canView}
          canEdit={canEdit}
          canDelete={canDelete}
          showChangeStatus={showChangeStatus}
          onView={onView}
          onEdit={onEdit}
          onChangeStatus={onChangeStatus}
          onComplete={onComplete}
          onArchive={onArchive}
          onCancel={onCancel}
        />
      ))}
    </Box>
  )
}

// ─── Change Status Dialog ─────────────────────────────────────────────────────

interface ChangeStatusDialogProps {
  project: Project | null
  statusOptions: StatusMaster[]
  onClose: () => void
  onConfirm: (statusName: string) => void
}

function ChangeStatusDialog({ project, statusOptions, onClose, onConfirm }: ChangeStatusDialogProps) {
  const [selected, setSelected] = useState('')
  const activeOptions = statusOptions.filter((s) => s.status === 'active')

  useEffect(() => {
    setSelected(project?.progress ?? '')
  }, [project])

  if (!project) return null

  return (
    <Dialog open={Boolean(project)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600, pb: 1 }}>
        Change Project Status
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Current status:{' '}
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {project.progress || '—'}
          </Box>
        </Typography>

        {activeOptions.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
            No active statuses in Status Master. Add statuses in Settings.
          </Typography>
        ) : (
          <FormControl fullWidth size="small">
            <MuiSelect
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              displayEmpty
              sx={{ fontSize: 13 }}
            >
              <MenuItem value="" sx={{ fontSize: 13 }}>
                Select new status…
              </MenuItem>
              {activeOptions.map((s) => (
                <MenuItem key={s.id} value={s.name} sx={{ fontSize: 13 }}>
                  {s.name}
                </MenuItem>
              ))}
            </MuiSelect>
          </FormControl>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <MuiButton size="small" onClick={onClose}>
          Cancel
        </MuiButton>
        <MuiButton
          size="small"
          variant="contained"
          disabled={!selected || selected === project.progress}
          onClick={() => selected && onConfirm(selected)}
        >
          Confirm
        </MuiButton>
      </DialogActions>
    </Dialog>
  )
}


// ─── ProjectsPage ─────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const toast = useToast()

  const { items: rawItems, loading, saving, filters, pagination, sortConfig } = useAppSelector(
    (s) => s.projects
  )
  const items = rawItems ?? []
  const users = useAppSelector((s) => s.users.items ?? [])
  const roles = useAppSelector((s) => s.roles.items ?? [])
  const statusMasters = useAppSelector((s) => s.settings.statuses)
  const canViewProjectModule = usePermission('projects', 'view')
  const canViewProjectOverview = usePermission('projectOverview', 'view')
  const canViewProjectPitch = usePermission('projectPitch', 'view')
  const canViewProjectLive = usePermission('projectLive', 'view')
  const canViewProjectFinancials = usePermission('projectFinancials', 'view')
  const canViewProjectDocuments = usePermission('projectDocuments', 'view')
  const canViewProjectActivity = usePermission('projectActivity', 'view')
  const canViewProjectManagement = usePermission('projectManagement', 'view')
  const canViewAnyProjectTab =
    canViewProjectOverview ||
    canViewProjectPitch ||
    canViewProjectLive ||
    canViewProjectFinancials ||
    canViewProjectDocuments ||
    canViewProjectActivity ||
    canViewProjectManagement
  const canViewProject = canViewProjectModule || canViewAnyProjectTab
  const canCreateProject = usePermission('projects', 'create')
  const canEditProject = usePermission('projects', 'edit')
  const canDeleteProject = usePermission('projects', 'delete')

  // Local state
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    projectName: true,
    status: false,
    type: true,
    projectLead: true,
    dates: true,
  })
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [statusDialogProject, setStatusDialogProject] = useState<Project | null>(null)
  const [lifecycleConfirm, setLifecycleConfirm] = useState<{
    project: Project
    status: 'Completed' | 'Archived' | 'Cancelled'
  } | null>(null)
  const [lifecycleSaving, setLifecycleSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table')
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [projectFilterOptions, setProjectFilterOptions] = useState<Record<string, ColumnFilterOption[]>>({})
  const [searchInput, setSearchInput] = useState(filters.search)

  // Debounce timer
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load users + project filter options (no `/settings/statuses` — route removed)
  useEffect(() => {
    dispatch(fetchUsers({}))
    dispatch(fetchRoles(undefined))
    void dispatch(fetchProjectFilters())
      .unwrap()
      .then((data: ProjectFiltersApi) => {
        setProjectFilterOptions({
          projectName: data.projectName ?? [],
          status: data.status ?? [],
          projectType: data.projectType ?? data.type ?? [],
          projectLeadId: data.projectLeadId ?? [],
          expectedStartDate: data.expectedStartDate ?? [],
          expectedEndDate: data.expectedEndDate ?? [],
          createdAt: data.createdAt ?? [],
          wentLiveAt: data.wentLiveAt ?? [],
          completedAt: data.completedAt ?? [],
          archivedAt: data.archivedAt ?? [],
          cancelledAt: data.cancelledAt ?? [],
        })
      })
      .catch(() => undefined)
  }, [dispatch])


  useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])

  const refetch = useCallback(
    (
      overrides: {
        page?: number
        colFilters?: Record<string, string>
        columnVisibility?: ColumnVisibility
      } = {},
    ) => {
      const nextCols = { ...colFilters, ...overrides.colFilters }
      const nextPage = overrides.page ?? pagination.page
      const statusParam = nextCols.status || filters.status || undefined
      const visibility = overrides.columnVisibility ?? columnVisibility
      dispatch(
        fetchProjects({
          page: nextPage,
          pageSize: pagination.pageSize || 10,
          search: filters.search || undefined,
          status: statusParam,
          type: nextCols.projectType || filters.type || undefined,
          projectManager: nextCols.projectLeadId || filters.projectManager || undefined,
          projectName: nextCols.projectName || undefined,
          expectedStartDate: nextCols.expectedStartDate || filters.expectedStartDate || undefined,
          expectedEndDate: nextCols.expectedEndDate || filters.expectedEndDate || undefined,
          createdAt: nextCols.createdAt || undefined,
          wentLiveAt: nextCols.wentLiveAt || undefined,
          completedAt: nextCols.completedAt || undefined,
          archivedAt: nextCols.archivedAt || undefined,
          cancelledAt: nextCols.cancelledAt || undefined,
          columns: buildProjectListColumns(visibility),
          sortBy: sortConfig.field || undefined,
          sortOrder: sortConfig.field ? sortConfig.direction : undefined,
        }),
      )
    },
    [
      dispatch,
      pagination.page,
      pagination.pageSize,
      filters,
      colFilters,
      columnVisibility,
      sortConfig.field,
      sortConfig.direction,
    ],
  )

  useEffect(() => {
    refetch()
  }, [refetch])

  // ── Computed ─────────────────────────────────────────────────────────────

  const [projectSummary, setProjectSummary] = useState({
    total: 0,
    all: 0,
    live: 0,
    pitch: 0,
    completed: 0,
    cancelled: 0,
    archived: 0,
  })

  const refreshProjectSummary = useCallback(() => {
    void financeApi
      .getProjectsSummary()
      .then((res) => {
        const data = unwrapApiData<{
          total?: number
          all?: number
          live?: number
          pitch?: number
          completed?: number
          cancelled?: number
          archived?: number
        }>(res.data)
        if (data) {
          setProjectSummary({
            total: data.total ?? data.all ?? 0,
            all: data.all ?? data.total ?? 0,
            live: data.live ?? 0,
            pitch: data.pitch ?? 0,
            completed: data.completed ?? 0,
            cancelled: data.cancelled ?? 0,
            archived: data.archived ?? 0,
          })
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshProjectSummary()
  }, [refreshProjectSummary])

  const statCards = [
    {
      label: 'TOTAL PROJECTS',
      value: projectSummary.total || pagination.total,
      variant: 'default' as const,
      icon: <FolderKanban size={24} strokeWidth={1.75} />,
    },
    {
      label: 'LIVE PROJECTS',
      value: projectSummary.live,
      variant: 'success' as const,
      icon: <PlayCircle sx={{ fontSize: 24 }} />,
    },
    {
      label: 'COMPLETED',
      value: projectSummary.completed,
      variant: 'info' as const,
      icon: <CheckCircle sx={{ fontSize: 24 }} />,
    },
  ]

  const tabs = [
    { label: 'All', value: 'all', count: projectSummary.all },
    { label: 'Pitch', value: 'Pitch', count: projectSummary.pitch },
    { label: 'Live', value: 'Live', count: projectSummary.live },
    { label: 'Completed', value: 'Completed', count: projectSummary.completed },
    { label: 'Cancelled', value: 'Cancelled', count: projectSummary.cancelled },
    { label: 'Archived', value: 'Archived', count: projectSummary.archived },
  ]

  const activeTab = filters.status || 'all'
  const statusDateConfig =
    activeTab === 'Live'
      ? { field: 'wentLiveAt' as const, label: 'Live Date' }
      : activeTab === 'Completed'
        ? { field: 'completedAt' as const, label: 'Completed Date' }
        : activeTab === 'Archived'
          ? { field: 'archivedAt' as const, label: 'Archived Date' }
          : activeTab === 'Cancelled'
            ? { field: 'cancelledAt' as const, label: 'Cancelled Date' }
            : { field: 'createdAt' as const, label: 'Created Date' }

  const managerOptions = users
    .filter((u) => isProjectLeadRole(u.role, roles))
    .map((u) => ({ value: u.id, label: u.name }))

  const filterConfig = [
    {
      field: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { label: 'All', value: '' },
        { label: 'Pitch', value: 'Pitch' },
        { label: 'Live', value: 'Live' },
        { label: 'Completed', value: 'Completed' },
        { label: 'Cancelled', value: 'Cancelled' },
        { label: 'Archived', value: 'Archived' },
      ],
    },
    {
      field: 'type',
      label: 'Project Scope',
      type: 'select' as const,
      options: [
        { label: 'All', value: '' },
        ...PROJECT_TYPE_OPTIONS.map((t) => ({ label: t, value: t })),
      ],
    },
    {
      field: 'projectManager',
      label: 'Project Lead',
      type: 'select' as const,
      options: [
        { label: 'All', value: '' },
        ...managerOptions.map((o) => ({ label: o.label, value: o.value })),
      ],
    },
    {
      field: 'expectedStartDate',
      label: 'Start Date',
      type: 'date' as const,
    },
    {
      field: 'expectedEndDate',
      label: 'End Date',
      type: 'date' as const,
    },
  ]

  const columnItems = [
    { field: 'type', label: 'Scope', visible: columnVisibility.type },
    { field: 'projectLead', label: 'Project Lead', visible: columnVisibility.projectLead },
    { field: 'dates', label: 'Start / End Date', visible: columnVisibility.dates },
  ]

  const activeFilterCount = [
    filters.status,
    filters.type,
    filters.projectManager,
    filters.expectedStartDate,
    filters.expectedEndDate,
  ].filter(Boolean).length

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSearch(value: string) {
    setSearchInput(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      dispatch(setFilters({ search: value }))
    }, 300)
  }

  function handleFilterChange(vals: Record<string, unknown>) {
    dispatch(
      setFilters({
        status: (vals.status as string) ?? '',
        type: (vals.type as string) ?? '',
        projectManager: (vals.projectManager as string) ?? '',
        expectedStartDate: (vals.expectedStartDate as string) ?? '',
        expectedEndDate: (vals.expectedEndDate as string) ?? '',
      })
    )
  }

  function handleFilterReset() {
    dispatch(resetFilters())
  }

  function handleTabChange(tab: string) {
    if (tab !== 'all') {
      dispatch(setFilters({ status: tab }))
    } else {
      dispatch(setFilters({ status: '' }))
    }
  }

  function handleSort(field: string, direction: 'asc' | 'desc') {
    dispatch(setSortConfig({ field, direction }))
    dispatch(setPage(1))
  }

  function handleColumnToggle(field: string, visible: boolean) {
    setColumnVisibility((prev) => ({ ...prev, [field]: visible }))
    dispatch(setPage(1))
  }

  function handlePageChange(zeroBasedPage: number) {
    dispatch(setPage(zeroBasedPage + 1))
  }

  function handlePageSizeChange(size: number) {
    dispatch(setPageSize(size))
  }

  function handleResetAll() {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setSearchInput('')
    dispatch(resetFilters())
    setColFilters({})
    dispatch(setSortConfig({ field: null, direction: 'asc' }))
    dispatch(setPage(1))
  }

  function handleView(project: Project) {
    navigate(`/projects/${project.id}`)
  }

  async function handleEdit(project: Project) {
    setEditLoading(true)
    setEditingProject(project)
    setEditDrawerOpen(true)
    try {
      const full = await projectsService.getById(project.id)
      setEditingProject(full)
    } catch {
      toast.error('Failed to load project')
      setEditDrawerOpen(false)
      setEditingProject(null)
    } finally {
      setEditLoading(false)
    }
  }

  async function handleEditSave(data: Partial<Project>) {
    if (!editingProject) return
    try {
      await dispatch(updateProject({ id: editingProject.id, data })).unwrap()
      toast.success('Project updated')
      setEditDrawerOpen(false)
      setEditingProject(null)
    } catch {
      toast.error('Failed to update project')
    }
  }

  async function handleStatusConfirm(statusName: string) {
    if (!statusDialogProject) return
    try {
      const lifecycle = lifecycleStatusForMasterName(statusName)
      await dispatch(
        updateProject({
          id: statusDialogProject.id,
          data: { progress: statusName },
        })
      ).unwrap()
      if (lifecycle && lifecycle !== statusDialogProject.status) {
        await dispatch(
          changeProjectStatus({ id: statusDialogProject.id, status: lifecycle })
        ).unwrap()
      }
      toast.success(`Status changed to ${statusName}`)
      setStatusDialogProject(null)
      refreshProjectSummary()
    } catch {
      toast.error('Failed to change status')
    }
  }

  async function handleLifecycleConfirm() {
    if (!lifecycleConfirm) return
    const { project, status } = lifecycleConfirm
    setLifecycleSaving(true)
    try {
      await dispatch(changeProjectStatus({ id: project.id, status })).unwrap()
      toast.success(
        status === 'Archived'
          ? 'Project archived'
          : status === 'Completed'
            ? 'Project completed'
            : 'Project cancelled',
      )
      setLifecycleConfirm(null)
      refreshProjectSummary()
    } catch {
      toast.error(
        status === 'Archived'
          ? 'Failed to archive project'
          : status === 'Completed'
            ? 'Failed to complete project'
            : 'Failed to cancel project',
      )
    } finally {
      setLifecycleSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <ListingTemplate
        icon={<FolderKanban size={20} strokeWidth={1.75} />}
        title="Projects"
        subtitle="Track and manage all design projects"
        primaryAction={
          canCreateProject
            ? {
                label: 'Create Project',
                onClick: () => navigate('/projects/create'),
                startIcon: <Plus size={16} strokeWidth={2} />,
              }
            : undefined
        }
        statCards={statCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        searchPlaceholder="Search projects…"
        searchValue={searchInput}
        onSearchChange={handleSearch}
        filterConfig={filterConfig}
        activeFilters={{
          status: filters.status,
          type: filters.type,
          projectManager: filters.projectManager,
          expectedStartDate: filters.expectedStartDate,
          expectedEndDate: filters.expectedEndDate,
        }}
        onFilterChange={handleFilterChange}
        onFilterReset={handleFilterReset}
        onResetAll={handleResetAll}
        filterCount={activeFilterCount}
        columns={columnItems}
        onColumnVisibilityChange={handleColumnToggle}
        showViewToggle={true}
        onViewModeChange={(mode) => setViewMode(mode === 'grid' ? 'grid' : 'table')}
        page={Math.max(0, pagination.page - 1)}
        pageSize={pagination.pageSize}
        totalCount={pagination.total}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      >
        {viewMode === 'grid' ? (
          <ProjectsGrid
            items={items}
            loading={loading}
            canView={canViewProject}
            canEdit={canEditProject}
            canDelete={canDeleteProject}
            showChangeStatus={activeTab !== 'all'}
            onView={handleView}
            onEdit={handleEdit}
            onChangeStatus={(p) => setStatusDialogProject(p)}
            onComplete={(p) => setLifecycleConfirm({ project: p, status: 'Completed' })}
            onArchive={(p) => setLifecycleConfirm({ project: p, status: 'Archived' })}
            onCancel={(p) => setLifecycleConfirm({ project: p, status: 'Cancelled' })}
          />
        ) : (
          <ProjectsTable
            items={items}
            loading={loading}
            canView={canViewProject}
            canEdit={canEditProject}
            canDelete={canDeleteProject}
            columns={columnVisibility}
            sortField={sortConfig.field}
            sortDirection={sortConfig.direction}
            onSort={handleSort}
            colFilters={colFilters}
            filterOptions={projectFilterOptions}
            onColumnFilter={(field, value) => {
              setColFilters((prev) => ({ ...prev, [field]: value }))
              dispatch(setPage(1))
              refetch({ page: 1, colFilters: { [field]: value } })
            }}
            onDualDateFilter={(start, end) => {
              setColFilters((prev) => mergeProjectsDualDateColFilters(prev, start, end))
              dispatch(setPage(1))
              refetch({
                page: 1,
                colFilters: { expectedStartDate: start, expectedEndDate: end },
              })
            }}
            statusDateField={statusDateConfig.field}
            statusDateLabel={statusDateConfig.label}
            showChangeStatus={activeTab !== 'all'}
            onView={handleView}
            onEdit={handleEdit}
            onChangeStatus={(p) => setStatusDialogProject(p)}
            onComplete={(p) => setLifecycleConfirm({ project: p, status: 'Completed' })}
            onArchive={(p) => setLifecycleConfirm({ project: p, status: 'Archived' })}
            onCancel={(p) => setLifecycleConfirm({ project: p, status: 'Cancelled' })}
          />
        )}
      </ListingTemplate>

      {/* Edit Project Drawer */}
      <EditProjectDrawer
        open={editDrawerOpen}
        project={editingProject}
        onClose={() => {
          setEditDrawerOpen(false)
          setEditingProject(null)
          setEditLoading(false)
        }}
        onSave={handleEditSave}
        saving={saving}
        loading={editLoading}
      />

      {/* Change Status Dialog */}
      <ChangeStatusDialog
        project={statusDialogProject}
        statusOptions={statusMasters}
        onClose={() => setStatusDialogProject(null)}
        onConfirm={handleStatusConfirm}
      />

      <ConfirmDialog
        open={Boolean(lifecycleConfirm)}
        onClose={() => {
          if (lifecycleSaving) return
          setLifecycleConfirm(null)
        }}
        onConfirm={handleLifecycleConfirm}
        loading={lifecycleSaving}
        variant={lifecycleConfirm?.status === 'Cancelled' ? 'destructive' : 'default'}
        title={
          lifecycleConfirm?.status === 'Archived'
            ? 'Archive Project?'
            : lifecycleConfirm?.status === 'Completed'
              ? 'Complete Project?'
              : 'Cancel Project?'
        }
        description={
          lifecycleConfirm?.status === 'Archived'
            ? `“${lifecycleConfirm.project.name}” will be moved to the Archived tab. All project data will be preserved.`
            : lifecycleConfirm?.status === 'Completed'
              ? `“${lifecycleConfirm.project.name}” will be moved to the Completed tab. All project data will be preserved.`
              : `“${lifecycleConfirm?.project.name ?? ''}” will be moved to the Cancelled tab. All project data will be preserved for historical records.`
        }
        confirmLabel={
          lifecycleConfirm?.status === 'Archived'
            ? 'Archive Project'
            : lifecycleConfirm?.status === 'Completed'
              ? 'Complete Project'
              : 'Cancel Project'
        }
        cancelLabel="Keep Project"
      />
    </>
  )
}
