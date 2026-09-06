/**
 * Project detail — Project Management tab.
 * Fixed-height checklist view; Vendor PO Documents unchanged.
 */
import { useEffect, useMemo, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import dayjs from 'dayjs'
import { FolderKanban, Plus } from 'lucide-react'
import { WorkspaceSection } from '../../../components/templates'
import { Button, Checkbox, Divider, useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { fetchProjectManagementCategories } from '../../../slices/settings/thunk'
import type { Project } from '../../../slices/projects/reducer'
import type { ProjectManagementCheckpoint } from '../../../slices/settings/reducer'
import { CategoryDrawer, type CategoryDrawerSavePayload } from './CategoryDrawer'
import {
  buildProgressMap,
  type CheckpointProgress,
  type ProjectManagementCategory,
} from './projectManagementCheckpoints'
import { VendorPODocumentsSection } from './VendorPODocumentsSection'
import { liveApi } from '@/api/liveApi'
import { ProjectTabSkeleton } from '../components/ProjectTabSkeleton'

export type { ProjectManagementCategory }

/** Fixed section height so Vendor PO Documents stays visible below. */
const PROJECT_MANAGEMENT_SECTION_HEIGHT = 480

interface ProjectManagementTabProps {
  project: Project
}

type DraftMap = Record<string, Record<string, boolean>>

function formatCompletedOn(iso: string): { date: string; time: string } {
  const d = dayjs(iso)
  return {
    date: d.format('DD MMM YYYY'),
    time: d.format('hh:mm A'),
  }
}

function buildDraftFromCategories(categories: ProjectManagementCategory[]): DraftMap {
  const next: DraftMap = {}
  for (const category of categories) {
    const row: Record<string, boolean> = {}
    for (const id of category.selectedCheckpointIds) {
      row[id] = category.checkpointProgress[id]?.completed ?? false
    }
    next[category.id] = row
  }
  return next
}

function CategoryChecklistSection({
  category,
  checkpoints,
  draft,
  isEditing,
  onToggle,
}: {
  category: ProjectManagementCategory
  checkpoints: ProjectManagementCheckpoint[]
  draft: Record<string, boolean>
  isEditing: boolean
  onToggle: (checkpointId: string, checked: boolean) => void
}) {
  return (
    <Box>
      <Typography
        variant="subtitle1"
        sx={{ fontWeight: 600, fontSize: 15, lineHeight: 1.4, mb: 1 }}
      >
        {category.name}
      </Typography>

      <Divider sx={{ mb: 1.5 }} />

      {checkpoints.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, py: 1 }}>
          No checkpoints selected. Use Add Category to add checkpoints for this category.
        </Typography>
      ) : (
        <Stack gap={0.5}>
          {checkpoints.map((cp) => {
            const checked = draft[cp.id] ?? false
            const savedCompleted = category.checkpointProgress[cp.id]?.completed ?? false
            const savedAt = category.checkpointProgress[cp.id]?.completedAt
            // Show completion stamp only for already-submitted completions while still checked.
            const showCompletedOn = checked && savedCompleted && savedAt

            return (
              <Stack
                key={cp.id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                gap={2}
              >
                <Checkbox
                  label={cp.name}
                  checked={checked}
                  onChange={(next) => onToggle(cp.id, next)}
                  disabled={!isEditing}
                  size="sm"
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    '& .MuiFormControlLabel-root': { m: 0 },
                    '& .MuiFormControlLabel-label': {
                      fontSize: 13,
                      fontWeight: checked ? 500 : 400,
                    },
                  }}
                />
                {showCompletedOn ? (
                  <Typography
                    variant="caption"
                    sx={{
                      flexShrink: 0,
                      fontSize: 12,
                      color: tokens.color.neutral[600],
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatCompletedOn(savedAt).date} · {formatCompletedOn(savedAt).time}
                  </Typography>
                ) : null}
              </Stack>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}

function CategoriesEmptyState() {
  return (
    <Box sx={{ py: 6, textAlign: 'center' }}>
      <Box
        sx={{
          color: tokens.color.primary[300],
          mb: 1,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <FolderKanban size={48} strokeWidth={1.25} />
      </Box>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
        No categories yet
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340, mx: 'auto' }}>
        Add a category from Settings master data to start tracking project checkpoints.
      </Typography>
    </Box>
  )
}

export default function ProjectManagementTab({ project }: ProjectManagementTabProps) {
  const dispatch = useAppDispatch()
  const success = useToast((s) => s.success)
  const masterCategories = useAppSelector((s) => s.settings.projectManagementCategories)

  const [categories, setCategories] = useState<ProjectManagementCategory[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<DraftMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void dispatch(fetchProjectManagementCategories())
  }, [dispatch])

  useEffect(() => {
    if (!project.id) return
    if (masterCategories.length === 0) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const selections = await liveApi.getProjectManagementSelections(project.id)
        if (cancelled) return
        const mapped: ProjectManagementCategory[] = selections
          .map((selection) => {
            const master = masterCategories.find((c) => c.id === selection.settingsCategoryId)
            if (!master) return null
            return {
              id: selection.settingsCategoryId,
              settingsCategoryId: selection.settingsCategoryId,
              name: master.name,
              selectedCheckpointIds: selection.selectedCheckpointIds,
              checkpointProgress: selection.checkpointProgress ?? {},
            }
          })
          .filter((row): row is ProjectManagementCategory => row != null)
        setCategories(mapped)
        setDraft(buildDraftFromCategories(mapped))
      } catch {
        if (!cancelled) {
          setCategories([])
          setDraft({})
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project.id, masterCategories])

  // Reset project-scoped category selections when navigating between projects.
  useEffect(() => {
    setCategories([])
    setDraft({})
    setIsEditing(false)
    setDrawerOpen(false)
  }, [project.id])

  const activeMasterCategories = useMemo(
    () => masterCategories.filter((c) => c.status === 'active'),
    [masterCategories],
  )

  const masterById = useMemo(() => {
    const map = new Map(masterCategories.map((c) => [c.id, c]))
    return map
  }, [masterCategories])

  const totalCheckpoints = useMemo(
    () => categories.reduce((sum, c) => sum + c.selectedCheckpointIds.length, 0),
    [categories],
  )

  const isDirty = useMemo(() => {
    return categories.some((category) => {
      const row = draft[category.id] ?? {}
      return category.selectedCheckpointIds.some((id) => {
        const saved = category.checkpointProgress[id]?.completed ?? false
        return (row[id] ?? false) !== saved
      })
    })
  }, [categories, draft])

  function resolveCheckpoints(category: ProjectManagementCategory): ProjectManagementCheckpoint[] {
    const master = masterById.get(category.settingsCategoryId)
    if (!master) {
      return category.selectedCheckpointIds.map((id) => ({ id, name: id }))
    }
    const byId = new Map(master.checkpoints.map((cp) => [cp.id, cp]))
    return category.selectedCheckpointIds
      .map((id) => byId.get(id))
      .filter((cp): cp is ProjectManagementCheckpoint => Boolean(cp))
  }

  function openAdd() {
    void dispatch(fetchProjectManagementCategories())
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
  }

  async function handleSave(payloads: CategoryDrawerSavePayload[]) {
    const prevBySettingsId = new Map(categories.map((c) => [c.settingsCategoryId, c]))
    const next: ProjectManagementCategory[] = []

    for (const payload of payloads) {
      const existing = prevBySettingsId.get(payload.settingsCategoryId)
      if (existing) {
        next.push({
          ...existing,
          name: payload.name,
          selectedCheckpointIds: payload.selectedCheckpointIds,
          checkpointProgress: buildProgressMap(
            payload.selectedCheckpointIds,
            existing.checkpointProgress,
          ),
        })
      } else {
        next.push({
          id: crypto.randomUUID(),
          settingsCategoryId: payload.settingsCategoryId,
          name: payload.name,
          selectedCheckpointIds: payload.selectedCheckpointIds,
          checkpointProgress: buildProgressMap(payload.selectedCheckpointIds),
        })
      }
    }

    setCategories(next)
    setDraft(buildDraftFromCategories(next))
    // Newly added checkpoints stay locked until Update is clicked.
    setIsEditing(false)
    await liveApi.saveProjectManagementSelections(
      project.id,
      next.map((category) => ({
        settingsCategoryId: category.settingsCategoryId,
        selectedCheckpointIds: category.selectedCheckpointIds,
        checkpointProgress: category.checkpointProgress,
      })),
    )
    success(payloads.length === 1 ? 'Category saved' : 'Categories saved')
    closeDrawer()
  }

  function handleToggle(categoryId: string, checkpointId: string, checked: boolean) {
    if (!isEditing) return
    setDraft((prev) => ({
      ...prev,
      [categoryId]: {
        ...(prev[categoryId] ?? {}),
        [checkpointId]: checked,
      },
    }))
  }

  function handleUpdate() {
    setDraft(buildDraftFromCategories(categories))
    setIsEditing(true)
  }

  async function handleSubmit() {
    const now = new Date().toISOString()

    const next = categories.map((category) => {
      const row = draft[category.id] ?? {}
      const nextProgress: Record<string, CheckpointProgress> = {}

      for (const id of category.selectedCheckpointIds) {
        const checked = row[id] ?? false
        const prevProgress = category.checkpointProgress[id]
        if (checked) {
          const wasCompleted = prevProgress?.completed ?? false
          nextProgress[id] = {
            completed: true,
            completedAt:
              wasCompleted && prevProgress?.completedAt ? prevProgress.completedAt : now,
          }
        } else {
          nextProgress[id] = { completed: false, completedAt: null }
        }
      }

      return { ...category, checkpointProgress: nextProgress }
    })

    setCategories(next)
    setDraft(buildDraftFromCategories(next))
    setIsEditing(false)
    await liveApi.saveProjectManagementSelections(
      project.id,
      next.map((category) => ({
        settingsCategoryId: category.settingsCategoryId,
        selectedCheckpointIds: category.selectedCheckpointIds,
        checkpointProgress: category.checkpointProgress,
      })),
    )
    success('Progress saved')
  }

  if (loading) {
    return (
      <Stack spacing={2}>
        <WorkspaceSection title="Project Management">
          <ProjectTabSkeleton rows={4} />
        </WorkspaceSection>
        <WorkspaceSection title="Vendor PO Documents">
          <ProjectTabSkeleton rows={3} />
        </WorkspaceSection>
      </Stack>
    )
  }

  return (
    <Stack spacing={0}>
      <WorkspaceSection
        title="Project Management"
        action={
          <Button
            variant="contained"
            color="primary"
            size="sm"
            label="Add Category"
            startIcon={<Plus size={14} strokeWidth={2} />}
            onClick={openAdd}
          />
        }
        noPadding
        sx={{
          height: PROJECT_MANAGEMENT_SECTION_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        contentSx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {categories.length === 0 ? (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              px: 2,
            }}
          >
            <CategoriesEmptyState />
          </Box>
        ) : (
          <>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                px: 2,
                pt: 2,
                pb: 1,
              }}
            >
              <Stack spacing={2.5}>
                {categories.map((category) => (
                  <CategoryChecklistSection
                    key={category.id}
                    category={category}
                    checkpoints={resolveCheckpoints(category)}
                    draft={draft[category.id] ?? {}}
                    isEditing={isEditing}
                    onToggle={(checkpointId, checked) =>
                      handleToggle(category.id, checkpointId, checked)
                    }
                  />
                ))}
              </Stack>
            </Box>

            <Stack
              direction="row"
              justifyContent="flex-end"
              alignItems="center"
              gap={1}
              sx={{
                flexShrink: 0,
                px: 2,
                py: 1.5,
                borderTop: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Button
                variant="outlined"
                color="secondary"
                size="sm"
                label="Cancel"
                onClick={() => {
                  setDraft(buildDraftFromCategories(categories))
                  setIsEditing(false)
                }}
                disabled={!isEditing}
                sx={{ height: 32 }}
              />
              <Button
                variant="outlined"
                color="secondary"
                size="sm"
                label="Update"
                onClick={handleUpdate}
                disabled={totalCheckpoints === 0 || isEditing}
                sx={{ height: 32 }}
              />
              <Button
                variant="contained"
                color="primary"
                size="sm"
                label="Submit"
                onClick={() => void handleSubmit()}
                disabled={!isEditing || totalCheckpoints === 0 || !isDirty}
              />
            </Stack>
          </>
        )}
      </WorkspaceSection>

      <VendorPODocumentsSection project={project} />

      <CategoryDrawer
        open={drawerOpen}
        categoryOptions={activeMasterCategories}
        projectCategories={categories}
        onClose={closeDrawer}
        onSave={(payloads) => void handleSave(payloads)}
      />
    </Stack>
  )
}
