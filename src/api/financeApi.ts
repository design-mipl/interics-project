import client from './client'
import type {
  ClientInvoice,
  CreateExpenseBody,
  Expense,
  FillingSummaryChartPoint,
  FillingSummaryKpis,
  FillingSummaryListParams,
  FillingSummaryPeriodBreakdown,
  GstChartPoint,
  GstListParams,
  GstPeriodBreakdown,
  GstSummary,
  Reimbursement,
  TdsChartPoint,
  TdsListParams,
  TdsPeriodBreakdown,
  TdsSummary,
  VendorPayment,
} from '@/slices/finance/types'
import type { CreateClientInvoiceBody } from '@/api/liveApi'

export type FinanceCreateInvoiceBody = CreateClientInvoiceBody & { projectId: string }

export const financeApi = {
  getInvoices: (params?: Record<string, string | undefined>) =>
    client.get<ClientInvoice[]>('/invoices', { params }),

  createInvoice: (data: FinanceCreateInvoiceBody) =>
    client.post<ClientInvoice>('/invoices', data),

  getExpenses: (params?: Record<string, string | undefined>) =>
    client.get('/finance/expenses', { params }),

  getExpenseFilters: (params?: Record<string, string | undefined>) =>
    client.get('/finance/expenses/filters', { params }),

  getExpensesSummary: (params?: Record<string, string | undefined>) =>
    client.get('/finance/expenses/summary', { params }),

  createExpense: (data: CreateExpenseBody) => client.post<Expense>('/expenses', data),

  getPayments: (params?: Record<string, string | undefined>) =>
    client.get<VendorPayment[]>('/payments', { params }),

  getPayables: (params?: Record<string, string | number | undefined>) =>
    client.get('/finance/payables', { params }),

  getPayableFilters: () => client.get('/finance/payables/filters'),

  getReimbursements: (params?: Record<string, string | undefined>) =>
    client.get<Reimbursement[]>('/reimbursements', { params }),

  getFillingSummary: (params?: Record<string, string | undefined>) =>
    client.get<FillingSummaryKpis>('/finance/compliance/filling-summary/summary', { params }),

  getFillingSummaryChart: (params?: Record<string, string | undefined>) =>
    client.get<FillingSummaryChartPoint[]>('/finance/compliance/filling-summary/chart', {
      params,
    }),

  getFillingSummaryPeriodBreakdown: (params?: Record<string, string | undefined>) =>
    client.get<FillingSummaryPeriodBreakdown>(
      '/finance/compliance/filling-summary/period-breakdown',
      { params },
    ),

  getFillingSummaryList: (params: FillingSummaryListParams) =>
    client.get('/finance/compliance/filling-summary', { params }),

  exportFillingSummary: (params: FillingSummaryListParams) =>
    client.get('/finance/compliance/filling-summary/export', {
      params,
      responseType: 'blob',
    }),

  getGstSummary: (params?: Record<string, string | undefined>) =>
    client.get<GstSummary>('/finance/compliance/gst/summary', { params }),

  getGstChart: (params?: Record<string, string | undefined>) =>
    client.get<GstChartPoint[]>('/finance/compliance/gst/chart', { params }),

  getGstPeriodBreakdown: (params?: Record<string, string | undefined>) =>
    client.get<GstPeriodBreakdown>('/finance/compliance/gst/period-breakdown', { params }),

  getGstList: (params: GstListParams) => client.get('/finance/compliance/gst', { params }),

  exportGst: (params: GstListParams) =>
    client.get('/finance/compliance/gst/export', {
      params,
      responseType: 'blob',
    }),

  getTdsSummary: (params?: Record<string, string | undefined>) =>
    client.get<TdsSummary>('/finance/compliance/tds/summary', { params }),

  getTdsChart: (params?: Record<string, string | undefined>) =>
    client.get<TdsChartPoint[]>('/finance/compliance/tds/chart', { params }),

  getTdsPeriodBreakdown: (params?: Record<string, string | undefined>) =>
    client.get<TdsPeriodBreakdown>('/finance/compliance/tds/period-breakdown', { params }),

  getTdsList: (params: TdsListParams) => client.get('/finance/compliance/tds', { params }),

  exportTds: (params: TdsListParams) =>
    client.get('/finance/compliance/tds/export', {
      params,
      responseType: 'blob',
    }),

  getProjectDropdown: () => client.get('/dropdowns/projects'),

  getReceivablesSummary: (params?: {
    dateFrom?: string
    dateTo?: string
    clientId?: string
    projectId?: string
    search?: string
  }) => client.get('/finance/receivables/summary', { params }),

  /** Golden-master Draft/Tax Invoice (.xlsx) — authenticated binary download. */
  downloadInvoiceDocument: (invoiceId: string, options?: { heading?: 'draft' | 'tax' }) =>
    client.get(`/invoices/${invoiceId}/document`, {
      responseType: 'blob',
      params: options?.heading === 'tax' ? { heading: 'tax' } : undefined,
    }),

  getProjectsSummary: () => client.get('/projects/summary'),

  getTeamSummary: () => client.get('/teams/summary'),
}
