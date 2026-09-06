import client from '@/api/client'
import { compactQueryParams, toUiStatus, unwrapApiData, unwrapApiListWithMeta, type ListResult } from '../shared/api'
import { withInflight } from '../shared/inflight'
import type { SACCode } from '@/slices/settings/reducer'
import type { ColumnFilterOption } from '@/components/listing'

type SacApi = {
  id: string
  sacCode: string
  description: string
  gstSlabId: string
  gstSlab?: { ratePercent?: string | number } | null
  status?: string
}

const BASE = '/system-settings/sac/sac-codes'

function toSacCode(api: SacApi): SACCode {
  const gstRate =
    api.gstSlab?.ratePercent !== undefined && api.gstSlab?.ratePercent !== null
      ? Number(api.gstSlab.ratePercent)
      : undefined

  return {
    id: api.id,
    code: api.sacCode,
    description: api.description ?? '',
    gstRateId: api.gstSlabId,
    ...(gstRate !== undefined && !Number.isNaN(gstRate) ? { gstRate } : {}),
    status: toUiStatus(api.status),
  }
}

function toPayload(data: Omit<SACCode, 'id'> | Partial<SACCode>) {
  return {
    ...(data.code !== undefined && { sacCode: data.code }),
    ...(data.description !== undefined && { description: data.description ?? '' }),
    ...(data.gstRateId !== undefined && { gstSlabId: data.gstRateId }),
    ...(data.status !== undefined && {
      status: data.status === 'active' ? 'ACTIVE' : 'INACTIVE',
    }),
  }
}

export type SacListParams = {
  search?: string
  limit?: number
  page?: number
  sacCode?: string
  description?: string
  gstSlabId?: string
  status?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

type SacFilters = {
  sacCode?: ColumnFilterOption[]
  description?: ColumnFilterOption[]
  gstSlabId?: ColumnFilterOption[]
  status?: ColumnFilterOption[]
}

export const sacCodesService = {
  async getAll(params: SacListParams = {}): Promise<ListResult<SACCode>> {
    const query = compactQueryParams({
      page: params.page ?? 1,
      limit: params.limit ?? 10,
      search: params.search,
      sacCode: params.sacCode,
      description: params.description,
      gstSlabId: params.gstSlabId,
      status:
        params.status === 'active'
          ? 'ACTIVE'
          : params.status === 'inactive'
            ? 'INACTIVE'
            : params.status,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    })
    return withInflight(`sac-codes:list:${JSON.stringify(query)}`, async () => {
      const res = await client.get(BASE, { params: query })
      const { items, meta } = unwrapApiListWithMeta<SacApi>(res.data)
      return { items: items.map(toSacCode), meta }
    })
  },

  /** Page through the list API (limit ≤ 100) until every SAC row is loaded. */
  async getAllPages(params: Omit<SacListParams, 'page' | 'limit'> = {}): Promise<ListResult<SACCode>> {
    const pageLimit = 100
    const items: SACCode[] = []
    let page = 1
    let total = Number.POSITIVE_INFINITY
    while (items.length < total) {
      const result = await sacCodesService.getAll({ ...params, page, limit: pageLimit })
      items.push(...result.items)
      total = result.meta.total ?? items.length
      if (result.items.length === 0 || result.items.length < pageLimit) break
      page += 1
      if (page > 100) break
    }
    return { items, meta: { total: items.length } }
  },

  async getFilters(): Promise<SacFilters> {
    const res = await client.get(`${BASE}/filters`)
    return unwrapApiData<SacFilters>(res.data)
  },

  async create(data: Omit<SACCode, 'id'>): Promise<SACCode> {
    const res = await client.post(BASE, toPayload(data))
    return toSacCode(unwrapApiData<SacApi>(res.data))
  },

  async update(id: string, data: Omit<SACCode, 'id'>): Promise<SACCode> {
    const res = await client.put(`${BASE}/${id}`, toPayload(data))
    return toSacCode(unwrapApiData<SacApi>(res.data))
  },

  async toggle(id: string, nextStatus: SACCode['status']): Promise<SACCode> {
    const res = await client.patch(`${BASE}/${id}/status`, {
      status: nextStatus === 'active' ? 'ACTIVE' : 'INACTIVE',
    })
    return toSacCode(unwrapApiData<SacApi>(res.data))
  },
}
