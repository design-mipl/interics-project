// ProjectDetailPage
import { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button as MuiButton,
  Select as MuiSelect,
  MenuItem,
  FormControl,
  Skeleton,
} from '@mui/material'
import {
  GridView,
  Analytics,
  PlayCircle as PlayCircleIcon,
  BarChart as BarChartIcon,
  FilePresent,
  History,
  AccountTree,
  Edit,
  Lock,
} from '@mui/icons-material'

import { useParams, useNavigate, useLocation } from 'react-router-dom'
import PitchTab from './tabs/PitchTab'
import LiveTab from './tabs/LiveTab'
import { convertProjectToLive } from './convertProjectToLive'
import FinancialsTab from './tabs/FinancialsTab'
import DocumentsTab from './tabs/DocumentsTab'
import ActivityTab from './tabs/ActivityTab'
import ProjectManagementTab from './tabs/ProjectManagementTab'
import { store } from '@/store'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { fetchProjects, fetchProjectById, updateProject, changeProjectStatus } from '../../slices/projects/thunk'
import {
  lifecycleStatusForMasterName,
} from '../../utils/masterChipStyles'
import type { StatusMaster } from '../../slices/settings/reducer'
import { EditProjectDrawer } from './components/EditProjectDrawer'
import { ProjectOverviewTab } from './components/ProjectOverviewTab'
import { clearSelected } from '../../slices/projects/reducer'
import type { Project } from '../../slices/projects/reducer'
import {
  WorkspaceDetail,
  WorkspaceSection,
} from '../../components/templates'
import {
  useToast,
  Toggle,
} from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { alpha } from '@mui/material/styles'
import {
  getInitials,
  getAvatarColor,
  fromSlug,
} from '../../utils/formatters'
import { usePermission } from '@/hooks/usePermission'

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <Box>
      <Skeleton height={20} width={220} sx={{ mb: 1.5 }} />
      <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2, mb: 1 }} />
      <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 2, mb: 2 }} />
      <Skeleton variant="rectangular" height={340} sx={{ borderRadius: 2 }} />
    </Box>
  )
}

// ─── Not found ────────────────────────────────────────────────────────────────

function NotFound() {
  const navigate = useNavigate()
  return (
    <Box sx={{ py: 8, textAlign: 'center' }}>
      <Typography variant="h6" fontWeight={600}>
        Project not found
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
        The project you're looking for doesn't exist or has been removed.
      </Typography>
      <Box
        component="span"
        onClick={() => navigate('/projects')}
        sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}
      >
        ← Back to Projects
      </Box>
    </Box>
  )
}

// ─── Tab config ───────────────────────────────────────────────────────────────

interface TabConfig {
  label: string
  value: ProjectTabValue
  icon: React.ReactNode
  locked: boolean
  lockReason: string | null
}

type ProjectTabValue =
  | 'overview'
  | 'pitch'
  | 'live'
  | 'financials'
  | 'documents'
  | 'activity'
  | 'project-management'

function getTabConfig(status: string): TabConfig[] {
  const isLiveProject = status === 'Live'
  return [
    {
      label: 'Overview',
      value: 'overview',
      icon: <GridView sx={{ fontSize: 14 }} />,
      locked: false,
      lockReason: null,
    },
    {
      label: 'Pitch',
      value: 'pitch',
      icon: <Analytics sx={{ fontSize: 14 }} />,
      locked: false,
      lockReason: null,
    },
    {
      label: 'Live',
      value: 'live',
      icon: <PlayCircleIcon sx={{ fontSize: 14 }} />,
      locked: !isLiveProject,
      lockReason: 'Use Convert Live on the Pitch tab to unlock',
    },
    {
      label: 'Financials',
      value: 'financials',
      icon: <BarChartIcon sx={{ fontSize: 14 }} />,
      locked: false,
      lockReason: null,
    },
    {
      label: 'Documents',
      value: 'documents',
      icon: <FilePresent sx={{ fontSize: 14 }} />,
      locked: false,
      lockReason: null,
    },
    {
      label: 'Activity',
      value: 'activity',
      icon: <History sx={{ fontSize: 14 }} />,
      locked: false,
      lockReason: null,
    },
    {
      label: 'Project Management',
      value: 'project-management',
      icon: <AccountTree sx={{ fontSize: 14 }} />,
      locked: false,
      lockReason: null,
    },
  ]
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Box sx={{ py: 6, textAlign: 'center' }}>
      <Box sx={{ color: tokens.color.primary[300], mb: 1 }}>{icon}</Box>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 340, mx: 'auto' }}>
        {description}
      </Typography>
      {action}
    </Box>
  )
}

// ─── Tab content ──────────────────────────────────────────────────────────────
// Overview UI lives in ./components/ProjectOverviewTab (shared with Team module).

// ─── Change Status Dialog ─────────────────────────────────────────────────────

interface StatusDialogProps {
  open: boolean
  project: Project
  statusOptions: StatusMaster[]
  onClose: () => void
  onConfirm: (statusName: string) => void
}

function ChangeStatusDialog({ open, project, statusOptions, onClose, onConfirm }: StatusDialogProps) {
  const [selected, setSelected] = useState('')
  const activeOptions = statusOptions.filter((s) => s.status === 'active')

  useEffect(() => {
    setSelected(project.progress ?? '')
  }, [open, project.progress])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600, pb: 1 }}>
        Change Project Status
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Current:{' '}
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
                Select status…
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

// ─── ProjectDetailPage ────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { id: slug } = useParams<{ id: string }>()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const toast = useToast()

  const { items: rawItems, selectedItem: project, loading, saving } = useAppSelector(
    (s) => s.projects
  )
  const items = rawItems ?? []
  const statusMasters = useAppSelector((s) => s.settings.statuses)

  const [activeTab, setActiveTab] = useState('overview')
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [convertingToLive, setConvertingToLive] = useState(false)
  const canEditProject = usePermission('projects', 'edit')
  const projectTabPermissions: Record<ProjectTabValue, boolean> = {
    overview: usePermission('projectOverview', 'view'),
    pitch: usePermission('projectPitch', 'view'),
    live: usePermission('projectLive', 'view'),
    financials: usePermission('projectFinancials', 'view'),
    documents: usePermission('projectDocuments', 'view'),
    activity: usePermission('projectActivity', 'view'),
    'project-management': usePermission('projectManagement', 'view'),
  }

  function isTabAccessible(tabValue: string, status: string): boolean {
    const tab = getTabConfig(status).find((t) => t.value === tabValue)
    return Boolean(tab && !tab.locked && projectTabPermissions[tab.value])
  }

  // Derive tab from hash (block hidden / locked tabs)
  useEffect(() => {
    if (!project) return
    const hash = location.hash.replace('#', '')
    if (hash && hash !== 'transition' && isTabAccessible(hash, project.status)) {
      setActiveTab(hash)
      return
    }
    const params = new URLSearchParams(location.search)
    const tab = params.get('tab')
    if (tab && isTabAccessible(tab, project.status)) {
      setActiveTab(tab)
    }
  }, [location.hash, location.search, project?.status, project?.id])

  // Reset active tab when it becomes hidden or locked
  useEffect(() => {
    if (!project) return
    if (activeTab === 'transition' || !isTabAccessible(activeTab, project.status)) {
      const firstAccessible = getTabConfig(project.status).find(
        (tab) => !tab.locked && projectTabPermissions[tab.value],
      )
      setActiveTab(firstAccessible?.value ?? '')
    }
  }, [project?.status, activeTab, project?.id])

  useEffect(() => {
    // Do not call GET /settings/statuses — route is unused for Project Details.
    dispatch(fetchProjects({})).then((action) => {
      if (fetchProjects.fulfilled.match(action)) {
        const foundId = fromSlug(slug ?? '', action.payload.items)
        if (foundId) {
          dispatch(fetchProjectById(foundId))
        } else {
          // Try direct slug lookup in API
          dispatch(fetchProjectById(slug ?? ''))
        }
      }
    })
    return () => {
      dispatch(clearSelected())
    }
  }, [dispatch, slug])

  async function handleEditSave(data: Partial<Project>) {
    if (!project) return
    try {
      await dispatch(updateProject({ id: project.id, data })).unwrap()
      toast.success('Project updated')
      setEditDrawerOpen(false)
    } catch {
      toast.error('Failed to update project')
    }
  }

  async function handleStatusConfirm(statusName: string) {
    if (!project) return
    try {
      const lifecycle = lifecycleStatusForMasterName(statusName)
      await dispatch(
        updateProject({
          id: project.id,
          data: { progress: statusName },
        })
      ).unwrap()
      if (lifecycle && lifecycle !== project.status) {
        await dispatch(
          changeProjectStatus({ id: project.id, status: lifecycle })
        ).unwrap()
      }
      toast.success(`Status changed to ${statusName}`)
      setStatusDialogOpen(false)
    } catch {
      toast.error('Failed to change status')
    }
  }

  async function handleConvertLive() {
    if (!project) return
    if (project.status === 'Live') {
      setActiveTab('live')
      return
    }
    setConvertingToLive(true)
    try {
      const result = await convertProjectToLive(dispatch, () => store.getState(), project)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      await dispatch(fetchProjectById(project.id)).unwrap()
      toast.success('Project converted to Live')
      setActiveTab('live')
    } catch {
      toast.error('Failed to convert project to Live')
    } finally {
      setConvertingToLive(false)
    }
  }

  // ── Loading / not found ───────────────────────────────────────────────────

  if (loading && !project) return <DetailSkeleton />

  // Check if we have items loaded but no match
  const hasItems = items.length > 0
  if (!loading && hasItems && !project) return <NotFound />

  if (!project) {
    return <DetailSkeleton />
  }

  // ── Tab config ────────────────────────────────────────────────────────────

  const tabConfig = getTabConfig(project.status)
  const workspaceTabs = tabConfig
    .filter((t) => projectTabPermissions[t.value])
    .map((t) => ({
      label: t.label,
      value: t.value,
      icon: t.icon,
      disabled: t.locked,
    }))

  // ── Tab content ───────────────────────────────────────────────────────────

  function renderTabContent() {
    const current = tabConfig.find((t) => t.value === activeTab)
    if (!current || !projectTabPermissions[current.value]) {
      return (
        <WorkspaceSection>
          <EmptyState
            icon={<Lock sx={{ fontSize: 48 }} />}
            title="Access not available"
            description="You do not have permission to view this project section."
          />
        </WorkspaceSection>
      )
    }
    if (current?.locked) {
      return (
        <WorkspaceSection>
          <EmptyState
            icon={<Lock sx={{ fontSize: 48 }} />}
            title="This section is locked"
            description={current.lockReason ?? ''}
          />
        </WorkspaceSection>
      )
    }
    const proj = project!
    switch (activeTab) {
      case 'overview':
        return <ProjectOverviewTab project={proj} />
      case 'pitch':
        return <PitchTab project={proj} />
      case 'live':
        return <LiveTab project={proj} />
      case 'financials':
        return <FinancialsTab project={proj} />
      case 'documents':
        return <DocumentsTab project={proj} />
      case 'activity':
        return <ActivityTab project={proj} />
      case 'project-management':
        return <ProjectManagementTab project={proj} />
      default:
        return <ProjectOverviewTab project={proj} />
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <WorkspaceDetail
        moduleName="Projects"
        moduleHref="/projects"
        recordName={project.name}
        avatarText={getInitials(project.name)}
        avatarColor={alpha(getAvatarColor(project.name).bg, 0.2)}
        title={project.name}
        metaItems={
          project.customerName?.trim()
            ? [{ label: project.customerName.trim() }]
            : []
        }
        primaryAction={
          canEditProject
            ? {
                label: 'Edit Project',
                icon: <Edit sx={{ fontSize: 14 }} />,
                onClick: () => setEditDrawerOpen(true),
              }
            : undefined
        }
        secondaryActions={[]}
        metrics={[]}
        tabs={workspaceTabs}
        activeTab={activeTab}
        onTabChange={(val) => {
          const tab = tabConfig.find((t) => t.value === val)
          if (!tab || tab.locked || !projectTabPermissions[tab.value]) return
          setActiveTab(val)
        }}
        tabsEnd={
          activeTab === 'pitch' && canEditProject ? (
            <Toggle
              label="Convert Live"
              size="sm"
              checked={project.status === 'Live'}
              disabled={convertingToLive || project.status === 'Live'}
              onChange={(checked) => {
                if (checked && project.status !== 'Live') {
                  void handleConvertLive()
                }
              }}
            />
          ) : null
        }
      >
        {renderTabContent()}
      </WorkspaceDetail>

      {/* Edit Drawer */}
      <EditProjectDrawer
        open={editDrawerOpen}
        project={project}
        onClose={() => setEditDrawerOpen(false)}
        onSave={handleEditSave}
        saving={saving}
      />

      {/* Status Dialog */}
      <ChangeStatusDialog
        open={statusDialogOpen}
        project={project}
        statusOptions={statusMasters}
        onClose={() => setStatusDialogOpen(false)}
        onConfirm={handleStatusConfirm}
      />
    </>
  )
}
