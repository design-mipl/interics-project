import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import {
  fetchInvoices,
  fetchInvoiceById,
  createInvoice,
  updateInvoice,
  convertDraftToTax,
  recordPayment,
  sendInvoice,
  deleteInvoice,
} from './thunk'

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'unpaid'
  | 'partially_paid'
  | 'overdue'
  | 'paid'
  | 'uploaded'
  | 'tax'

export type LineSource = 'milestone' | 'service' | 'manual'

export interface LineItem {
  id: string
  serviceId: string
  serviceName: string
  sacCode: string
  amount: number
  labourCessRate?: number
  labourCessAmount?: number
  taxableAmount?: number
  gstRate: number
  gstAmount: number
  tdsAmount?: number
  netAmount?: number
  milestoneId?: string
  /** Baseline service row id when lineSource is service */
  baselineServiceId?: string
  lineSource?: LineSource
}

export interface Payment {
  id: string
  date: string
  amountReceived: number
  tdsDeducted: number
  netReceived: number
  paymentMode: 'bank_transfer' | 'cheque' | 'upi' | 'other'
  reference?: string
  recordedAt: string
  allocations?: Array<{ milestoneId: string; allocatedAmount: number }>
}

export interface Invoice {
  id: string
  invoiceNo: string
  clientId: string
  clientName: string
  projectId: string
  projectName: string
  invoiceDate: string
  dueDate: string
  lineItems: LineItem[]
  baseAmount: number
  labourCessAmount?: number
  taxableAmount?: number
  gstAmount: number
  totalAmount: number
  tdsDeducted: number
  tdsRate?: number | null
  totalReceived: number
  balance: number
  status: InvoiceStatus
  payments: Payment[]
  notes?: string
  clientPoId?: string
  milestoneId?: string
  milestoneName?: string
  serviceId?: string
  serviceName?: string
  documentUrl?: string | null
  fileName?: string | null
  pendingGeneration?: boolean
  /** UI-only: show partially-paid badge alongside mapped tab status */
  showPartialPaid?: boolean
  createdAt: string
  updatedAt: string
}

export interface ReceivablesFilters {
  statusTab: string
  search: string
  clientId: string
  projectId: string
  dateFrom: string
  dateTo: string
  amountMin: string
  amountMax: string
}

export interface SortConfig {
  field: string | null
  direction: 'asc' | 'desc'
}

interface Pagination {
  page: number
  pageSize: number
  total: number
}

interface ReceivablesState {
  items: Invoice[]
  selectedItem: Invoice | null
  loading: boolean
  detailLoading: boolean
  saving: boolean
  error: string | null
  filters: ReceivablesFilters
  sortConfig: SortConfig
  pagination: Pagination
  listRequestId: string | null
}

const initialState: ReceivablesState = {
  items: [],
  selectedItem: null,
  loading: false,
  detailLoading: false,
  saving: false,
  error: null,
  filters: {
    statusTab: 'all',
    search: '',
    clientId: '',
    projectId: '',
    dateFrom: '',
    dateTo: '',
    amountMin: '',
    amountMax: '',
  },
  sortConfig: { field: null, direction: 'desc' },
  pagination: { page: 1, pageSize: 10, total: 0 },
  listRequestId: null,
}

const receivablesSlice = createSlice({
  name: 'receivables',
  initialState,
  reducers: {
    setFilters(state, action: PayloadAction<Partial<ReceivablesFilters>>) {
      state.filters = { ...state.filters, ...action.payload }
    },
    resetFilters(state) {
      state.filters = {
        ...initialState.filters,
        search: state.filters.search,
        statusTab: state.filters.statusTab,
      }
    },
    setPage(state, action: PayloadAction<number>) {
      state.pagination.page = action.payload
    },
    setPageSize(state, action: PayloadAction<number>) {
      state.pagination.pageSize = action.payload
      state.pagination.page = 1
    },
    setSortConfig(state, action: PayloadAction<SortConfig>) {
      state.sortConfig = action.payload
    },
    clearSelected(state) {
      state.selectedItem = null
    },
    setSelectedItem(state, action: PayloadAction<Invoice | null>) {
      state.selectedItem = action.payload
    },
    /** Empty list without an API call (e.g. global ∩ toolbar date range is empty). */
    clearListResults(state) {
      state.items = []
      state.pagination.total = 0
      state.loading = false
      state.error = null
      state.listRequestId = null
    },
    reset() {
      return initialState
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchInvoices.pending, (state, action) => {
        state.listRequestId = action.meta.requestId
        state.loading = true
        state.error = null
      })
      .addCase(fetchInvoices.fulfilled, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) return
        state.loading = false
        state.items = action.payload.items ?? []
        const total = action.payload.total ?? 0
        state.pagination.total = total
        const size = state.pagination.pageSize || 10
        const maxPage = total <= 0 ? 1 : Math.max(1, Math.ceil(total / size))
        if (state.pagination.page > maxPage) state.pagination.page = maxPage
      })
      .addCase(fetchInvoices.rejected, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) return
        state.loading = false
        state.error = action.payload as string
      })
      .addCase(fetchInvoiceById.pending, (state) => {
        state.detailLoading = true
        state.error = null
      })
      .addCase(fetchInvoiceById.fulfilled, (state, action) => {
        state.detailLoading = false
        state.selectedItem = action.payload
      })
      .addCase(fetchInvoiceById.rejected, (state, action) => {
        state.detailLoading = false
        state.error = action.payload as string
      })
      .addCase(createInvoice.pending, (state) => {
        state.saving = true
        state.error = null
      })
      .addCase(createInvoice.fulfilled, (state) => {
        state.saving = false
      })
      .addCase(createInvoice.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(updateInvoice.pending, (state) => {
        state.saving = true
        state.error = null
      })
      .addCase(updateInvoice.fulfilled, (state, action) => {
        state.saving = false
        const inv = action.payload
        const i = state.items.findIndex((x) => x.id === inv.id)
        if (i >= 0) state.items[i] = inv
        if (state.selectedItem?.id === inv.id) state.selectedItem = inv
      })
      .addCase(updateInvoice.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(recordPayment.pending, (state) => {
        state.saving = true
        state.error = null
      })
      .addCase(recordPayment.fulfilled, (state, action) => {
        state.saving = false
        const inv = action.payload
        const i = state.items.findIndex((x) => x.id === inv.id)
        if (i >= 0) state.items[i] = inv
        if (state.selectedItem?.id === inv.id) state.selectedItem = inv
      })
      .addCase(recordPayment.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(sendInvoice.pending, (state) => {
        state.saving = true
        state.error = null
      })
      .addCase(sendInvoice.fulfilled, (state, action) => {
        state.saving = false
        const inv = action.payload
        const i = state.items.findIndex((x) => x.id === inv.id)
        if (i >= 0) state.items[i] = inv
        if (state.selectedItem?.id === inv.id) state.selectedItem = inv
      })
      .addCase(sendInvoice.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(convertDraftToTax.pending, (state) => {
        state.saving = true
        state.error = null
      })
      .addCase(convertDraftToTax.fulfilled, (state, action) => {
        state.saving = false
        const inv = action.payload
        const i = state.items.findIndex((x) => x.id === inv.id)
        if (i >= 0) state.items[i] = inv
        if (state.selectedItem?.id === inv.id) state.selectedItem = inv
      })
      .addCase(convertDraftToTax.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(deleteInvoice.pending, (state) => {
        state.saving = true
        state.error = null
      })
      .addCase(deleteInvoice.fulfilled, (state, action) => {
        state.saving = false
        const id = action.payload
        state.items = state.items.filter((x) => x.id !== id)
        state.pagination.total = Math.max(0, state.pagination.total - 1)
        if (state.selectedItem?.id === id) state.selectedItem = null
      })
      .addCase(deleteInvoice.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
  },
})

export const {
  setFilters,
  resetFilters,
  setPage,
  setPageSize,
  setSortConfig,
  clearSelected,
  setSelectedItem,
  clearListResults,
  reset,
} = receivablesSlice.actions
export default receivablesSlice.reducer
