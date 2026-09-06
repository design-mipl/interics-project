import client from './client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'

export type ProjectDropdownOption = {
  value: string
  label: string
  projectName: string
  projectCode: string
  customerId: string
  customerName: string
}

export type TdsDropdownOption = {
  value: string
  label: string
  rate: number
}

export type DropdownOption = {
  value: string
  label: string
}

export type ServiceDropdownOption = DropdownOption & {
  categoryId: string
  gstRate: number
}

export const dropdownsApi = {
  getLiveProjects: async (params?: { search?: string; customerId?: string }) => {
    const res = await client.get('/dropdowns/projects', {
      params: { status: 'LIVE', ...params },
    })
    return unwrapApiData<ProjectDropdownOption[]>(res.data) ?? []
  },
  getTdsSections: async () => {
    const res = await client.get('/dropdowns/tds', {
      params: { includeRate: 'true' },
    })
    return unwrapApiData<TdsDropdownOption[]>(res.data) ?? []
  },
  getCategories: async () => {
    const res = await client.get('/dropdowns/categories')
    return unwrapApiData<DropdownOption[]>(res.data) ?? []
  },
  getServices: async (categoryId?: string) => {
    const res = await client.get('/dropdowns/services', {
      params: categoryId ? { categoryId } : undefined,
    })
    return unwrapApiData<ServiceDropdownOption[]>(res.data) ?? []
  },
}
