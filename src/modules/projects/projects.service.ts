import client from '@/api/client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import type { Project } from '@/slices/projects/reducer'
import {
  PROJECT_FIELD_ALIASES,
  toCreatePayload,
  toListStatusParam,
  toProjectFromDetail,
  toProjectFromListItem,
  toUpdatePayload,
} from './projects.mapper'
import type {
  ProjectCreateFormInput,
  ProjectDetailApi,
  ProjectFiltersApi,
  ProjectListItemApi,
  ProjectListParams,
  ProjectListResult,
} from './projects.types'

const BASE = '/projects'

const DEFAULT_LIST_COLUMNS = [
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
  'projectTypes',
  'projectLeadName',
  'carpetAreaSqFt',
  'expectedStartDate',
  'expectedEndDate',
  'totalDesignFee',
  'totalBuildValue',
  'createdAt',
  'wentLiveAt',
  'completedAt',
  'archivedAt',
  'cancelledAt',
] as const

function unwrapListPayload(payload: unknown): {
  items: ProjectListItemApi[]
  total: number
  page: number
  pageSize: number
} {
  const data = unwrapApiData<unknown>(payload)
  if (Array.isArray(data)) {
    return { items: data as ProjectListItemApi[], total: data.length, page: 1, pageSize: data.length }
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const items = Array.isArray(record.items) ? (record.items as ProjectListItemApi[]) : []
    const pagination =
      record.pagination && typeof record.pagination === 'object'
        ? (record.pagination as Record<string, unknown>)
        : {}
    const total =
      typeof pagination.total === 'number'
        ? pagination.total
        : typeof record.total === 'number'
          ? record.total
          : items.length
    const page = typeof pagination.page === 'number' ? pagination.page : 1
    const pageSize = typeof pagination.limit === 'number' ? pagination.limit : items.length || 20
    return { items, total, page, pageSize }
  }
  return { items: [], total: 0, page: 1, pageSize: 20 }
}

function isCreateFormInput(data: unknown): data is ProjectCreateFormInput {
  return (
    data != null &&
    typeof data === 'object' &&
    'customerId' in data &&
    'name' in data &&
    'projectManagerId' in data &&
    'projectTypes' in data &&
    'sector' in data
  )
}

export const projectsService = {
  fieldAliases: PROJECT_FIELD_ALIASES,

  async getFilters(): Promise<ProjectFiltersApi> {
    const res = await client.get(`${BASE}/filters`)
    return unwrapApiData<ProjectFiltersApi>(res.data)
  },

  async getAll(params: ProjectListParams = {}): Promise<ProjectListResult> {
    const res = await client.get(BASE, {
      params: {
        page: params.page,
        limit: params.limit,
        search: params.search || undefined,
        status: toListStatusParam(params.status),
        customerId: params.customerId || undefined,
        sector: params.sector || undefined,
        projectLeadId: params.projectLeadId || undefined,
        projectName: params.projectName || undefined,
        projectType: params.projectType || undefined,
        expectedStartDate: params.expectedStartDate || undefined,
        expectedEndDate: params.expectedEndDate || undefined,
        createdAt: params.createdAt || undefined,
        wentLiveAt: params.wentLiveAt || undefined,
        completedAt: params.completedAt || undefined,
        archivedAt: params.archivedAt || undefined,
        cancelledAt: params.cancelledAt || undefined,
        columns: (params.columns ?? DEFAULT_LIST_COLUMNS).join(','),
        sortBy: params.sortBy || undefined,
        sortOrder: params.sortOrder || undefined,
      },
    })
    const list = unwrapListPayload(res.data)
    return {
      items: list.items.map(toProjectFromListItem),
      total: list.total,
      page: list.page,
      pageSize: list.pageSize,
    }
  },

  async getById(id: string): Promise<Project> {
    const res = await client.get(`${BASE}/${id}`)
    const data = unwrapApiData<ProjectDetailApi>(res.data)
    return toProjectFromDetail(data)
  },

  async create(data: ProjectCreateFormInput | Record<string, unknown>): Promise<Project> {
    const payload = isCreateFormInput(data)
      ? toCreatePayload(data)
      : toCreatePayload(data as unknown as ProjectCreateFormInput)
    const res = await client.post(BASE, payload)
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },

  async update(
    id: string,
    data: Partial<Project> & { contactIds?: string[]; vendorContactIds?: string[] },
  ): Promise<Project> {
    const res = await client.put(`${BASE}/${id}`, toUpdatePayload(data))
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },

  /** Additive: attach vendor + contacts without replacing other project vendors. */
  async addVendorAssociation(
    id: string,
    data: { vendorId: string; vendorContactIds: string[] },
  ): Promise<Project> {
    const res = await client.post(`${BASE}/${id}/vendors`, {
      vendorId: data.vendorId,
      vendorContactIds: data.vendorContactIds,
    })
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },

  async markLive(id: string): Promise<Project> {
    const res = await client.patch(`${BASE}/${id}/live`)
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },

  async markCompleted(id: string): Promise<Project> {
    const res = await client.patch(`${BASE}/${id}/complete`)
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },

  async markArchived(id: string): Promise<Project> {
    const res = await client.patch(`${BASE}/${id}/archive`)
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },

  async markCancelled(id: string): Promise<Project> {
    const res = await client.patch(`${BASE}/${id}/cancel`)
    return toProjectFromDetail(unwrapApiData<ProjectDetailApi>(res.data))
  },
}
