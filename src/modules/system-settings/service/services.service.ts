import client from '@/api/client'
import { compactQueryParams, toUiStatus, unwrapApiData, unwrapApiListWithMeta, type ListResult } from '../shared/api'
import { withInflight } from '../shared/inflight'
import type { Category, SACCode, Service } from '@/slices/settings/reducer'
import type { ColumnFilterOption } from '@/components/listing'

type ServiceApi = {
  id: string
  name: string
  category?: string
  categoryId?: string
  sacCode: string
  gstRate: number
  isActive?: boolean
}

const BASE = '/system-settings/services'

function toService(
  api: ServiceApi,
  categories: Category[],
  sacCodes: SACCode[],
): Service {
  const categoryId =
    api.categoryId ??
    categories.find((c) => c.name === api.category)?.id ??
    ''
  const sacCodeId = sacCodes.find((s) => s.code === api.sacCode)?.id ?? null

  return {
    id: api.id,
    name: api.name,
    categoryId,
    sacCodeId,
    sacCode: typeof api.sacCode === 'string' ? api.sacCode.trim() : '',
    gstRate: Number(api.gstRate),
    allowGSTOverride: false,
    allowVendorMapping: false,
    tags: [],
    status: toUiStatus(api.isActive),
  }
}

function toPayload(data: Omit<Service, 'id'>, sacCodes: SACCode[]) {
  const sacCode =
    sacCodes.find((s) => s.id === data.sacCodeId)?.code ??
    (typeof data.sacCodeId === 'string' ? data.sacCodeId : '')

  return {
    name: data.name,
    categoryId: data.categoryId,
    sacCode,
    gstRate: data.gstRate,
  }
}

export type ServiceListParams = {
  search?: string
  name?: string
  categoryId?: string
  sacCode?: string
  gstRate?: string
  isActive?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  limit?: number
}

type ServiceFilters = {
  name?: ColumnFilterOption[]
  categoryId?: ColumnFilterOption[]
  sacCode?: ColumnFilterOption[]
  gstRate?: ColumnFilterOption[]
  isActive?: ColumnFilterOption[]
}

export const servicesService = {
  async getAll(
    categories: Category[],
    sacCodes: SACCode[],
    params: ServiceListParams = {},
  ): Promise<ListResult<Service>> {
    const query = compactQueryParams({
      page: params.page ?? 1,
      limit: params.limit ?? 10,
      search: params.search,
      name: params.name,
      categoryId: params.categoryId,
      sacCode: params.sacCode,
      gstRate: params.gstRate,
      isActive: params.isActive,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    })
    return withInflight(`services:list:${JSON.stringify(query)}`, async () => {
      const res = await client.get(BASE, { params: query })
      const { items, meta } = unwrapApiListWithMeta<ServiceApi>(res.data)
      return {
        items: items.map((item) => toService(item, categories, sacCodes)),
        meta,
      }
    })
  },

  /** Page through the list API (limit ≤ 100) until every service is loaded. */
  async getAllPages(
    categories: Category[],
    sacCodes: SACCode[],
    params: Omit<ServiceListParams, 'page' | 'limit'> = {},
  ): Promise<ListResult<Service>> {
    const pageLimit = 100
    const items: Service[] = []
    let page = 1
    let total = Number.POSITIVE_INFINITY
    while (items.length < total) {
      const result = await servicesService.getAll(categories, sacCodes, {
        ...params,
        page,
        limit: pageLimit,
      })
      items.push(...result.items)
      total = result.meta.total ?? items.length
      if (result.items.length === 0 || result.items.length < pageLimit) break
      page += 1
      if (page > 100) break
    }
    return { items, meta: { total: items.length } }
  },

  async getFilters(): Promise<ServiceFilters> {
    const res = await client.get(`${BASE}/filters`)
    return unwrapApiData<ServiceFilters>(res.data)
  },

  async create(
    data: Omit<Service, 'id'>,
    categories: Category[],
    sacCodes: SACCode[],
  ): Promise<Service> {
    const res = await client.post(BASE, toPayload(data, sacCodes))
    const created = toService(unwrapApiData<ServiceApi>(res.data), categories, sacCodes)
    if (data.status === 'inactive') {
      return servicesService.toggle(created.id, false, categories, sacCodes)
    }
    return created
  },

  async update(
    id: string,
    data: Omit<Service, 'id'>,
    categories: Category[],
    sacCodes: SACCode[],
  ): Promise<Service> {
    const res = await client.put(`${BASE}/${id}`, toPayload(data, sacCodes))
    const updated = toService(unwrapApiData<ServiceApi>(res.data), categories, sacCodes)
    if (data.status && data.status !== updated.status) {
      return servicesService.toggle(id, data.status === 'active', categories, sacCodes)
    }
    return updated
  },

  async toggle(
    id: string,
    nextActive: boolean,
    categories: Category[],
    sacCodes: SACCode[],
  ): Promise<Service> {
    const res = await client.patch(`${BASE}/${id}/status`, { isActive: nextActive })
    return toService(unwrapApiData<ServiceApi>(res.data), categories, sacCodes)
  },
}
