import client from '@/api/client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import type { Baseline, VendorPO } from '@/slices/baseline/reducer'
import type { VendorInvoice } from '@/slices/live/types'
import type { PayableSummaryKpis } from '@/pages/Finance/utils/payableSummary'

export type PayablesSummaryApi = {
  totalVendorOfferValue: number
  paidTillDate: number
  remainingPayment: number
}

export type PayablesWorkspaceApi = {
  vendorPOs: VendorPO[]
  vendorInvoices: VendorInvoice[]
  baselines: Baseline[]
}

export type PayablesListItem = {
  id: string
  invoiceId: string
  projectId: string
  projectName: string
  vendorId: string
  vendorName: string
  milestone: string
  milestoneNames: string[]
  milestoneId?: string
  invoiceNo: string
  invoiceDate: string
  gstAmount: number
  totalAmount: number
  /** Net payable (base + GST − TDS). */
  invoiceAmount: number
  tdsAmount: number
  paymentStatus: 'settled' | 'partial_payment' | 'not_paid'
  invoiceStatus: string
  service?: string
  serviceNames: string[]
  lineCount: number
}

export type PayablesListResult = {
  items: PayablesListItem[]
  total: number
  page: number
  pageSize: number
  pendingCount: number
  completedCount: number
}

type PayablesFilterOption = { value: string; label: string }

export type PayablesFiltersApi = {
  vendors?: PayablesFilterOption[]
  projects?: PayablesFilterOption[]
  milestones?: PayablesFilterOption[]
  invoiceNos?: PayablesFilterOption[]
  invoiceDates?: PayablesFilterOption[]
  gstAmounts?: PayablesFilterOption[]
  totalAmounts?: PayablesFilterOption[]
  invoiceAmounts?: PayablesFilterOption[]
  tdsAmounts?: PayablesFilterOption[]
  paymentStatuses?: PayablesFilterOption[]
}

export function toPayableSummaryKpis(data: PayablesSummaryApi): PayableSummaryKpis {
  return {
    totalVendorPoValue: data.totalVendorOfferValue,
    paidTillDate: data.paidTillDate,
    pendingPayment: data.remainingPayment,
  }
}

export const payablesService = {
  async getSummary(params?: {
    projectId?: string
    vendorId?: string
    dateFrom?: string
    dateTo?: string
  }): Promise<PayablesSummaryApi> {
    const res = await client.get('/finance/payables/summary', { params })
    return (
      unwrapApiData<PayablesSummaryApi>(res.data) ?? {
        totalVendorOfferValue: 0,
        paidTillDate: 0,
        remainingPayment: 0,
      }
    )
  },

  async getWorkspace(): Promise<PayablesWorkspaceApi> {
    const res = await client.get('/finance/payables/workspace')
    const data = unwrapApiData<PayablesWorkspaceApi>(res.data)
    return {
      vendorPOs: Array.isArray(data?.vendorPOs) ? data.vendorPOs : [],
      vendorInvoices: Array.isArray(data?.vendorInvoices) ? data.vendorInvoices : [],
      baselines: Array.isArray(data?.baselines) ? data.baselines : [],
    }
  },

  async listVendorPos(params?: {
    projectId?: string
    vendorId?: string
    pendingInvoiceOnly?: boolean
  }): Promise<VendorPO[]> {
    const res = await client.get('/finance/payables/vendor-pos', {
      params: {
        ...(params?.projectId ? { projectId: params.projectId } : {}),
        ...(params?.vendorId ? { vendorId: params.vendorId } : {}),
        ...(params?.pendingInvoiceOnly ? { pendingInvoiceOnly: true } : {}),
      },
    })
    return unwrapApiData<VendorPO[]>(res.data) ?? []
  },

  async getList(params: {
    page?: number
    limit?: number
    search?: string
    vendorId?: string
    projectId?: string
    milestone?: string
    invoiceNo?: string
    invoiceDate?: string
    gstAmount?: number
    totalAmount?: number
    invoiceAmount?: number
    tdsAmount?: number
    paymentStatus?: string
    dateFrom?: string
    dateTo?: string
    columns?: string[] | string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }): Promise<PayablesListResult> {
    const { columns, ...rest } = params
    const res = await client.get('/finance/payables', {
      params: {
        ...rest,
        ...(columns
          ? { columns: Array.isArray(columns) ? columns.join(',') : columns }
          : {}),
      },
    })
    const data = unwrapApiData<PayablesListItem[]>(res.data)
    const meta =
      res.data && typeof res.data === 'object' && 'meta' in res.data
        ? (res.data.meta as Record<string, unknown>)
        : {}
    return {
      items: Array.isArray(data) ? data : [],
      total: typeof meta.total === 'number' ? meta.total : Array.isArray(data) ? data.length : 0,
      page: typeof meta.page === 'number' ? meta.page : params.page ?? 1,
      pageSize: typeof meta.limit === 'number' ? meta.limit : params.limit ?? 20,
      pendingCount: typeof meta.pendingCount === 'number' ? meta.pendingCount : 0,
      completedCount: typeof meta.completedCount === 'number' ? meta.completedCount : 0,
    }
  },

  async getFilters(params?: { paymentStatus?: string }): Promise<PayablesFiltersApi> {
    const res = await client.get('/finance/payables/filters', {
      params: {
        ...(params?.paymentStatus ? { paymentStatus: params.paymentStatus } : {}),
      },
    })
    return unwrapApiData<PayablesFiltersApi>(res.data) ?? {}
  },
}
