import { createAsyncThunk } from '@reduxjs/toolkit'
import { projectsService } from '@/modules/projects'
import { toSettingsRejectPayload } from '@/modules/system-settings/shared/api-errors'
import { PROJECT_FIELD_ALIASES } from '@/modules/projects'
import type { ProjectCreateFormInput, ProjectFiltersApi } from '@/modules/projects'
import type { Project } from './reducer'

function rejectProject(err: unknown, fallback: string) {
  return toSettingsRejectPayload(err, fallback, PROJECT_FIELD_ALIASES)
}

interface FetchProjectsParams {
  page?: number
  pageSize?: number
  limit?: number
  search?: string
  status?: string
  type?: string
  projectManager?: string
  projectLeadId?: string
  projectName?: string
  projectType?: string
  expectedStartDate?: string
  expectedEndDate?: string
  createdAt?: string
  wentLiveAt?: string
  completedAt?: string
  archivedAt?: string
  cancelledAt?: string
  columns?: string[]
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

function isCreateFormInput(data: unknown): data is ProjectCreateFormInput {
  return (
    data != null &&
    typeof data === 'object' &&
    'customerId' in data &&
    'name' in data &&
    'projectManagerId' in data &&
    Array.isArray((data as { contactIds?: unknown }).contactIds)
  )
}

export const fetchProjects = createAsyncThunk(
  'projects/fetchAll',
  async (params: FetchProjectsParams = {}, { rejectWithValue }) => {
    try {
      const result = await projectsService.getAll({
        page: params.page,
        limit: params.limit ?? params.pageSize,
        search: params.search,
        status: params.status,
        projectLeadId: params.projectLeadId ?? params.projectManager,
        projectName: params.projectName,
        projectType: params.projectType ?? params.type,
        expectedStartDate: params.expectedStartDate,
        expectedEndDate: params.expectedEndDate,
        createdAt: params.createdAt,
        wentLiveAt: params.wentLiveAt,
        completedAt: params.completedAt,
        archivedAt: params.archivedAt,
        cancelledAt: params.cancelledAt,
        columns: params.columns,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      })
      return result
    } catch (err: unknown) {
      return rejectWithValue(rejectProject(err, 'Failed to fetch projects'))
    }
  },
)

export const fetchProjectFilters = createAsyncThunk<
  ProjectFiltersApi,
  void,
  { rejectValue: ReturnType<typeof rejectProject> }
>('projects/fetchFilters', async (_, { rejectWithValue }) => {
  try {
    return await projectsService.getFilters()
  } catch (err: unknown) {
    return rejectWithValue(rejectProject(err, 'Failed to fetch project filters'))
  }
})

export const fetchProjectById = createAsyncThunk(
  'projects/fetchById',
  async (id: string, { rejectWithValue }) => {
    try {
      return await projectsService.getById(id)
    } catch (err: unknown) {
      return rejectWithValue(rejectProject(err, 'Failed to fetch project'))
    }
  },
)

export const createProject = createAsyncThunk(
  'projects/create',
  async (
    data: Omit<Project, 'id' | 'projectCode' | 'createdAt'> | ProjectCreateFormInput,
    { rejectWithValue },
  ) => {
    try {
      if (!isCreateFormInput(data)) {
        return rejectWithValue({
          message: 'Invalid project create payload',
          fieldErrors: {},
        })
      }
      return await projectsService.create(data)
    } catch (err: unknown) {
      return rejectWithValue(rejectProject(err, 'Failed to create project'))
    }
  },
)

export const updateProject = createAsyncThunk(
  'projects/update',
  async (
    {
      id,
      data,
    }: { id: string; data: Partial<Project> & { contactIds?: string[]; vendorContactIds?: string[] } },
    { rejectWithValue },
  ) => {
    try {
      return await projectsService.update(id, data)
    } catch (err: unknown) {
      return rejectWithValue(rejectProject(err, 'Failed to update project'))
    }
  },
)

export const addProjectVendorAssociation = createAsyncThunk(
  'projects/addVendorAssociation',
  async (
    {
      id,
      vendorId,
      vendorContactIds,
    }: { id: string; vendorId: string; vendorContactIds: string[] },
    { rejectWithValue },
  ) => {
    try {
      return await projectsService.addVendorAssociation(id, { vendorId, vendorContactIds })
    } catch (err: unknown) {
      return rejectWithValue(rejectProject(err, 'Failed to add project vendor contact'))
    }
  },
)

export const changeProjectStatus = createAsyncThunk(
  'projects/changeStatus',
  async (
    { id, status }: { id: string; status: Project['status'] },
    { rejectWithValue },
  ) => {
    try {
      if (status === 'Live') {
        return await projectsService.markLive(id)
      }
      if (status === 'Completed') {
        return await projectsService.markCompleted(id)
      }
      if (status === 'Archived') {
        return await projectsService.markArchived(id)
      }
      if (status === 'Cancelled') {
        return await projectsService.markCancelled(id)
      }
      return await projectsService.getById(id)
    } catch (err: unknown) {
      return rejectWithValue(rejectProject(err, 'Failed to change project status'))
    }
  },
)
