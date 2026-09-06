import client from './client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import type { Invoice } from '@/slices/receivables/reducer'
import type {
  ClientInvoice,
  ClientInvoicePaymentMode,
  ComplianceData,
  Expense,
  Reimbursement,
  VendorInvoice,
  VendorPayableControl,
  VendorPayment,
} from '@/slices/live/types'

const root = (projectId: string) => `/projects/${projectId}`

export type CreateClientInvoiceBody = Omit<ClientInvoice, 'id' | 'projectId'>
export type UpdateClientInvoiceBody = Partial<ClientInvoice>

export type RecordClientInvoicePaymentBody = {
  date: string
  amountReceived: number
  paymentMode: ClientInvoicePaymentMode
  reference?: string
  allocationMode?: 'project_live' | 'finance'
  targetMilestoneId?: string
}

export type CreateVendorInvoiceBody = Omit<VendorInvoice, 'id' | 'projectId'>
export type CreateExpenseBody = Omit<Expense, 'id' | 'projectId'>
export type CreateVendorPaymentBody = Omit<VendorPayment, 'id' | 'projectId'>
export type CreateReimbursementBody = Omit<Reimbursement, 'id' | 'projectId'>
export type FinancialInvoiceRow = {
  id: string
  invoiceNumber: string
  party: string
  invoiceType: 'Client' | 'Vendor'
  amount: number
  invoiceDate: string
  uploadedDate?: string
  documentUrl?: string
}

export type FinancialOverviewDto = {
  commercialRates: {
    buildValuePerSqft: number | null
    designFeePerSqft: number | null
  }
  summary: {
    revenue: number
    cost: number
    grossProfit: number
    marginPct: number
  }
  tracking: {
    amountReceived: number
    invoicesUnderProcess: number
    unbilledAmount: number
    vendorPaymentAmount: number
    unbilledVendorPayments: number
    expenses: number
  }
}

export type TaxComplianceDto = {
  summary: {
    gstCollected: number
    labourCessCollected: number
    labourCessPayable: number
  }
  details: {
    gstOnClientInvoices: Array<{
      id: string
      invoiceNumber: string
      milestoneName: string
      serviceName: string
      invoiceDate: string
      baseAmount: number
      gstRateLabel: string
      gstAmount: number
    }>
    labourCessOnClientInvoices: Array<{
      id: string
      invoiceNumber: string
      milestoneName: string
      serviceName: string
      invoiceDate: string
      baseAmount: number
      labourCessRateLabel: string
      labourCessAmount: number
    }>
    tdsDeductedByClient: Array<{
      id: string
      invoiceNumber: string
      clientName: string
      invoiceDate: string
      grossAmount: number
      tdsRateLabel: string
      tdsAmount: number
    }>
    tdsDeductedOnVendors: Array<{
      id: string
      invoiceNumber: string
      referenceNumber: string | null
      vendorName: string
      paymentDate: string
      invoiceTotal: number
      tdsRateLabel: string
      tdsAmount: number
      status: string
    }>
  }
  totals: {
    gstTotal: number
    labourCessTotal: number
    clientTdsTotal: number
    vendorTdsTotal: number
  }
}
export type ProjectActivityApiType = 'all' | 'status' | 'financial' | 'document' | 'team'
export type ProjectActivityApiItem = {
  id: string
  type: string
  category: string
  action: string
  description: string
  createdAt: string
  actorUserId: string | null
  actorName: string
  payload: Record<string, unknown> | null
}

export type ProjectDocumentDoctype =
  | 'all'
  | 'client'
  | 'vendor'
  | 'project'
  | 'client_quotation'
  | 'vendor_quotation'
  | 'client_po'
  | 'vendor_po'
  | 'vendor_invoice'
  | 'requirement'
  | 'final_layout'
  | 'final_rcp'
  | 'final_views'
  | 'final_photographs'
  | 'handover'
  | string

export type ProjectDocumentListItem = {
  id: string
  projectId: string
  doctype: string
  name: string
  fileName: string | null
  sizeBytes: number | null
  uploadedAt: string
  uploadedBy: string | null
  source: 'pitch' | 'live' | 'project'
  viewUrl: string | null
  downloadUrl: string | null
}

export type ProjectDocumentDoctypeApi = {
  id: string
  projectId: string
  value: string
  label: string
  createdAt: string
}

export type GeneratedVendorDocumentApi = {
  id: string
  projectId: string
  documentName: string
  vendorId: string
  vendorName: string
  vendorPoId: string
  poNumber: string
  template: 'trade_contract' | 'supply_installation'
  generatedAt: string
  generatedBy: string
  fileName: string
  viewUrl: string
  downloadUrl: string
  versions: Array<{
    id: string
    version: number
    fileName: string
    fileId: string
    viewUrl: string
    downloadUrl: string
    createdAt: string
    createdBy: string
    source: 'generated' | 'upload'
  }>
}

/** Global B1 client invoices — same store as Finance → Billings. */
export const liveApi = {
  getInvoices: async (projectId: string) => {
    const res = await client.get('/invoices', {
      params: { projectId, pageSize: 500 },
    })
    return unwrapApiData<{ items: Invoice[]; total: number }>(res.data)
  },

  createInvoice: async (body: Record<string, unknown>) => {
    const res = await client.post('/invoices', body)
    return unwrapApiData<Invoice>(res.data)
  },

  updateInvoice: async (_projectId: string, invoiceId: string, data: Record<string, unknown>) => {
    const res = await client.put(`/invoices/${invoiceId}`, data)
    return unwrapApiData<Invoice>(res.data)
  },

  recordInvoicePayment: async (
    _projectId: string,
    invoiceId: string,
    data: Record<string, unknown>,
  ) => {
    const res = await client.post(`/invoices/${invoiceId}/payments`, data)
    return unwrapApiData<Invoice>(res.data)
  },

  getVendorInvoices: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/vendor-invoices`)
    return unwrapApiData<VendorInvoice[]>(res.data) ?? []
  },

  getFinancialInvoices: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/financial/invoices`)
    return unwrapApiData<FinancialInvoiceRow[]>(res.data) ?? []
  },

  getFinancialOverview: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/financial/overview`)
    return unwrapApiData<FinancialOverviewDto>(res.data)
  },

  getTaxCompliance: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/financial/tax-compliance`)
    return unwrapApiData<TaxComplianceDto>(res.data)
  },

  updateLabourCessPayable: async (projectId: string, amount: number) => {
    const res = await client.patch(`${root(projectId)}/financial/tax-compliance/labour-cess-payable`, {
      amount,
    })
    return unwrapApiData<{
      gstCollected: number
      labourCessCollected: number
      labourCessPayable: number
    }>(res.data)
  },

  getProjectActivity: async (
    projectId: string,
    params?: { type?: ProjectActivityApiType; from?: string; to?: string; page?: number; limit?: number },
  ) => {
    const res = await client.get(`${root(projectId)}/activity`, { params })
    return unwrapApiData<{ items: ProjectActivityApiItem[]; page: number; limit: number }>(res.data)
  },

  getProjectDocuments: async (
    projectId: string,
    params?: { doctype?: ProjectDocumentDoctype },
  ) => {
    const res = await client.get(`${root(projectId)}/documents`, {
      params:
        params?.doctype && params.doctype !== 'all'
          ? { doctype: params.doctype }
          : undefined,
    })
    return unwrapApiData<ProjectDocumentListItem[]>(res.data) ?? []
  },

  getDocumentDoctypes: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/document-doctypes`)
    return unwrapApiData<ProjectDocumentDoctypeApi[]>(res.data) ?? []
  },

  createDocumentDoctype: async (projectId: string, data: { label: string; value?: string }) => {
    const res = await client.post(`${root(projectId)}/document-doctypes`, data)
    return unwrapApiData<ProjectDocumentDoctypeApi>(res.data)
  },

  uploadProjectDocument: async (
    projectId: string,
    input: { doctype: string; displayName: string; notes?: string; file: File },
  ) => {
    const form = new FormData()
    form.append('file', input.file)
    form.append('doctype', input.doctype)
    form.append('displayName', input.displayName)
    if (input.notes?.trim()) form.append('notes', input.notes.trim())
    const res = await client.post(`${root(projectId)}/document-uploads`, form, {
      headers: { 'Content-Type': undefined },
      timeout: 60_000,
    })
    return unwrapApiData<ProjectDocumentListItem>(res.data)
  },

  deleteProjectDocument: async (projectId: string, documentId: string) => {
    await client.delete(`${root(projectId)}/document-uploads/${documentId}`)
  },

  getGeneratedDocuments: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/generated-documents`)
    return unwrapApiData<GeneratedVendorDocumentApi[]>(res.data) ?? []
  },

  generateVendorDocument: async (
    projectId: string,
    data: { vendorPoId: string; template: 'trade_contract' | 'supply_installation' },
  ) => {
    const res = await client.post(`${root(projectId)}/generated-documents`, data)
    return unwrapApiData<GeneratedVendorDocumentApi>(res.data)
  },

  uploadGeneratedDocumentVersion: async (
    projectId: string,
    documentId: string,
    file: File,
  ) => {
    const form = new FormData()
    form.append('file', file)
    const res = await client.post(
      `${root(projectId)}/generated-documents/${documentId}/versions`,
      form,
      {
        headers: { 'Content-Type': undefined },
        timeout: 60_000,
      },
    )
    return unwrapApiData<GeneratedVendorDocumentApi>(res.data)
  },

  deleteGeneratedDocument: async (projectId: string, documentId: string) => {
    await client.delete(`${root(projectId)}/generated-documents/${documentId}`)
  },

  getProjectManagementSelections: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/project-management-selections`)
    return unwrapApiData<
      Array<{
        settingsCategoryId: string
        selectedCheckpointIds: string[]
        checkpointProgress: Record<string, { completed: boolean; completedAt: string | null }>
      }>
    >(res.data) ?? []
  },

  saveProjectManagementSelections: async (
    projectId: string,
    selections: Array<{
      settingsCategoryId: string
      selectedCheckpointIds: string[]
      checkpointProgress: Record<string, { completed: boolean; completedAt: string | null }>
    }>,
  ) => {
    const res = await client.put(`${root(projectId)}/project-management-selections`, { selections })
    return unwrapApiData<
      Array<{
        settingsCategoryId: string
        selectedCheckpointIds: string[]
        checkpointProgress: Record<string, { completed: boolean; completedAt: string | null }>
      }>
    >(res.data) ?? []
  },

  uploadVendorInvoice: async (projectId: string, data: CreateVendorInvoiceBody) => {
    const res = await client.post(`${root(projectId)}/vendor-invoices`, data)
    return unwrapApiData<VendorInvoice>(res.data)
  },

  updateVendorInvoice: async (
    projectId: string,
    invoiceId: string,
    data: Partial<CreateVendorInvoiceBody>,
  ) => {
    const res = await client.put(`${root(projectId)}/vendor-invoices/${invoiceId}`, data)
    return unwrapApiData<VendorInvoice>(res.data)
  },

  deleteVendorInvoice: async (projectId: string, invoiceId: string) => {
    const res = await client.delete(`${root(projectId)}/vendor-invoices/${invoiceId}`)
    return unwrapApiData<null>(res.data)
  },

  getVendorPayableControls: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/vendor-payable-controls`)
    return unwrapApiData<VendorPayableControl[]>(res.data) ?? []
  },

  updateVendorPayableControl: async (projectId: string, data: VendorPayableControl) => {
    const res = await client.put(`${root(projectId)}/vendor-payable-controls`, data)
    return unwrapApiData<VendorPayableControl>(res.data)
  },

  getPayments: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/payments`)
    return unwrapApiData<VendorPayment[]>(res.data) ?? []
  },

  createPayment: async (projectId: string, data: CreateVendorPaymentBody) => {
    const res = await client.post(`${root(projectId)}/payments`, data)
    return unwrapApiData<VendorPayment>(res.data)
  },

  getExpenses: async (projectId: string, type?: string) => {
    const res = await client.get(`${root(projectId)}/expenses`, {
      params: type && type !== 'all' ? { type } : undefined,
    })
    return unwrapApiData<Expense[]>(res.data) ?? []
  },

  getExpenseSummary: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/expenses/summary`)
    return (
      unwrapApiData<{
        total: number
        additional: number
        vendorLinked: number
        common: number
      }>(res.data) ?? { total: 0, additional: 0, vendorLinked: 0, common: 0 }
    )
  },

  createExpense: async (projectId: string, data: CreateExpenseBody) => {
    const res = await client.post(`${root(projectId)}/expenses`, data)
    return unwrapApiData<Expense>(res.data)
  },

  updateExpense: async (projectId: string, expenseId: string, data: CreateExpenseBody) => {
    const res = await client.patch(`${root(projectId)}/expenses/${expenseId}`, data)
    return unwrapApiData<Expense>(res.data)
  },

  deleteExpense: async (projectId: string, expenseId: string) => {
    await client.delete(`${root(projectId)}/expenses/${expenseId}`)
  },

  getTaxComplianceSummary: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/tax-compliance/summary`)
    return unwrapApiData<{
      gstCollected: number
      labourCessCollected: number
      labourCessPayable: number
    }>(res.data)
  },

  getTaxComplianceDetails: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/tax-compliance/details`)
    return unwrapApiData<{
      gstOnClientInvoices: Array<{
        id: string
        invoiceNumber: string
        milestoneName: string
        serviceName: string
        invoiceDate: string
        baseAmount: number
        gstRateLabel: string
        gstAmount: number
      }>
      labourCessOnClientInvoices: Array<{
        id: string
        invoiceNumber: string
        milestoneName: string
        serviceName: string
        invoiceDate: string
        baseAmount: number
        labourCessRateLabel: string
        labourCessAmount: number
      }>
      tdsDeductedByClient: Array<{
        id: string
        invoiceNumber: string
        clientName: string
        invoiceDate: string
        grossAmount: number
        tdsRateLabel: string
        tdsAmount: number
      }>
      tdsDeductedOnVendors: Array<{
        id: string
        invoiceNumber: string
        referenceNumber: string | null
        vendorName: string
        paymentDate: string
        invoiceTotal: number
        tdsRateLabel: string
        tdsAmount: number
        status: string
      }>
    }>(res.data)
  },

  getReimbursements: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/reimbursements`)
    return unwrapApiData<Reimbursement[]>(res.data) ?? []
  },

  createReimbursement: async (projectId: string, data: CreateReimbursementBody) => {
    const res = await client.post(`${root(projectId)}/reimbursements`, data)
    return unwrapApiData<Reimbursement>(res.data)
  },

  deleteReimbursement: async (projectId: string, reimbursementId: string) => {
    await client.delete(`${root(projectId)}/reimbursements/${reimbursementId}`)
  },

  getCompliance: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/compliance`)
    return unwrapApiData<ComplianceData>(res.data)
  },

  getLiveOverview: async (projectId: string) => {
    const res = await client.get(`${root(projectId)}/overview`)
    return unwrapApiData<LiveOverviewDto>(res.data)
  },
}

export interface LiveOverviewMetrics {
  clientPOAmount: number
  clientReceived: number
  pendingReceived: number
  vendorPOAmount: number
  vendorPaid: number
  pendingPaid: number
  projectedProfitPct: number | null
  actualProfitPct: number | null
}

export interface LiveOverviewWorkstreamRow extends LiveOverviewMetrics {
  id: string
  workstreamName: string
  kind: 'service' | 'expense'
}

export interface LiveOverviewCategoryGroup {
  id: string
  name: string
  kind: 'category' | 'expenses'
  children: LiveOverviewWorkstreamRow[]
  subtotal: LiveOverviewMetrics
}

export interface LiveOverviewDto {
  groups: LiveOverviewCategoryGroup[]
  total: LiveOverviewMetrics
  /** Persisted Project.officeExpenseTotal */
  officeExpenseTotal: number
  /** Persisted Project.clientPoMinusOfficeExpense */
  clientPoMinusOfficeExpense: number
}
