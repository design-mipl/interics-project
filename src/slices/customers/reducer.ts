import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { getCustomerContactsList } from '@/utils/customerContacts'
import {
  fetchCustomers,
  fetchCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createCustomerContact,
  updateCustomerContact,
  setCustomerActive,
  fetchCustomerFilters,
} from './thunk'
import type { CustomerFiltersApi } from '@/modules/customers'

function payloadMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Request failed'
}

export interface Contact {
  id: string
  name: string
  designation: string
  phone: string
  email: string
  isPrimary: boolean
}

export type ActivityType =
  | 'record_created'
  | 'profile_edited'
  | 'contact_added'
  | 'contact_removed'
  | 'primary_changed'
  | 'document_uploaded'
  | 'status_changed'
  | 'financial'

export interface ActivityEntry {
  id: string
  type: ActivityType
  description: string
  user: string
  timestamp: string
}

export interface CustomerFinancialDetails {
  totalBilled: number
  amountReceived: number
  outstanding: number
  tdsWithheld: number
  activeProjects: number
  completedProjects: number
  totalProjectValue: number
  lastInvoiceDate: string
  paymentTerms: string
  creditLimit: number | null
  gstStatus: string
}

export interface Customer {
  id: string
  name: string
  gstStatus: 'Registered' | 'Unregistered' | 'Composition' | 'SEZ'
  gstin: string | null
  pan: string | null
  contactPerson: string
  designation?: string | null
  phone: string
  email: string
  city: string
  state: string
  address: string | null
  pincode?: string | null
  tags: string[]
  sector?: string
  msmeRegistered?: boolean
  notes: string | null
  status: 'Active' | 'Inactive'
  activeProjects: number
  totalReceivables: number
  createdAt: string
  contacts?: Contact[]
  gstDocument?: { name: string; url: string } | null
  panDocument?: { name: string; url: string } | null
  activityLog?: ActivityEntry[]
  financialDetails?: CustomerFinancialDetails
}

interface Pagination {
  page: number
  pageSize: number
  total: number
}

interface Filters {
  search: string
  status: string
  gstStatus?: string
  state?: string
  sector?: string
  projectStatus?: string
}

interface SortConfig {
  field: string | null
  direction: 'asc' | 'desc'
}

interface CustomersState {
  items: Customer[]
  selectedItem: Customer | null
  loading: boolean
  saving: boolean
  error: string | null
  pagination: Pagination
  filters: Filters
  sortConfig: SortConfig
  filterOptions: CustomerFiltersApi | null
}

const initialState: CustomersState = {
  items: [],
  selectedItem: null,
  loading: false,
  saving: false,
  error: null,
  pagination: { page: 1, pageSize: 10, total: 0 },
  filters: { search: '', status: '' },
  sortConfig: { field: null, direction: 'asc' },
  filterOptions: null,
}

const customersSlice = createSlice({
  name: 'customers',
  initialState,
  reducers: {
    setFilters(state, action: PayloadAction<Partial<Filters>>) {
      state.filters = { ...state.filters, ...action.payload }
    },
    resetFilters(state) {
      state.filters = { search: state.filters.search, status: state.filters.status }
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
    reset() {
      return initialState
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCustomers.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchCustomers.fulfilled, (state, action) => {
        state.loading = false
        const prevById = new Map(state.items.map((c) => [c.id, c]))
        const listItems = action.payload.items ?? []
        state.items = listItems.map((item) => {
          const prev = prevById.get(item.id)
          const detail =
            state.selectedItem?.id === item.id ? state.selectedItem : null
          const contacts =
            detail?.contacts?.length
              ? detail.contacts
              : prev?.contacts?.length
                ? prev.contacts
                : item.contacts
          return contacts?.length ? { ...item, contacts } : item
        })
        // Keep a freshly loaded detail customer in the list if the page omitted it.
        if (
          state.selectedItem &&
          !state.items.some((c) => c.id === state.selectedItem!.id)
        ) {
          state.items.unshift(state.selectedItem)
        }
        const total = action.payload.total ?? 0
        state.pagination.total = total
        if (action.payload.pageSize) state.pagination.pageSize = action.payload.pageSize
        const requestedPage = action.payload.page || state.pagination.page
        const size = state.pagination.pageSize || 10
        const maxPage = total <= 0 ? 1 : Math.max(1, Math.ceil(total / size))
        state.pagination.page = Math.min(Math.max(1, requestedPage), maxPage)
      })
      .addCase(fetchCustomers.rejected, (state, action) => {
        state.loading = false
        state.error = payloadMessage(action.payload)
      })
      .addCase(fetchCustomerFilters.fulfilled, (state, action) => {
        state.filterOptions = action.payload
      })
      .addCase(fetchCustomerById.fulfilled, (state, action) => {
        state.selectedItem = action.payload
        const idx = state.items.findIndex((c) => c.id === action.payload.id)
        if (idx !== -1) {
          const prev = state.items[idx]
          state.items[idx] = {
            ...prev,
            ...action.payload,
            activeProjects: action.payload.activeProjects || prev.activeProjects,
            totalReceivables: action.payload.totalReceivables || prev.totalReceivables,
          }
        } else {
          state.items.unshift(action.payload)
        }
      })
      .addCase(createCustomer.pending, (state) => {
        state.saving = true
      })
      .addCase(createCustomer.fulfilled, (state, action) => {
        state.saving = false
        state.items.unshift(action.payload)
        state.pagination.total += 1
      })
      .addCase(createCustomer.rejected, (state, action) => {
        state.saving = false
        state.error = payloadMessage(action.payload)
      })
      .addCase(updateCustomer.pending, (state) => {
        state.saving = true
      })
      .addCase(updateCustomer.fulfilled, (state, action) => {
        state.saving = false
        const idx = state.items.findIndex((c) => c.id === action.payload.id)
        if (idx !== -1) state.items[idx] = action.payload
        if (state.selectedItem?.id === action.payload.id) {
          const prev = state.selectedItem
          state.selectedItem = {
            ...action.payload,
            // Keep existing docs if update response omitted file metadata
            gstDocument: action.payload.gstDocument ?? prev.gstDocument,
            panDocument: action.payload.panDocument ?? prev.panDocument,
            contacts: action.payload.contacts?.length ? action.payload.contacts : prev.contacts,
            activeProjects: action.payload.activeProjects || prev.activeProjects,
          }
        }
      })
      .addCase(updateCustomer.rejected, (state, action) => {
        state.saving = false
        state.error = payloadMessage(action.payload)
      })
      .addCase(setCustomerActive.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id)
        if (idx !== -1) state.items[idx] = { ...state.items[idx], ...action.payload }
        if (state.selectedItem?.id === action.payload.id) {
          state.selectedItem = { ...state.selectedItem, ...action.payload }
        }
      })
      .addCase(createCustomerContact.fulfilled, (state, action) => {
        const { customerId, contact } = action.payload
        const idx = state.items.findIndex((c) => c.id === customerId)
        if (idx !== -1) {
          const customer = state.items[idx]
          const baseContacts = customer.contacts?.length
            ? customer.contacts
            : getCustomerContactsList(customer)
          state.items[idx] = { ...customer, contacts: [...baseContacts, contact] }
        }
        if (state.selectedItem?.id === customerId) {
          const customer = state.selectedItem
          const baseContacts = customer.contacts?.length
            ? customer.contacts
            : getCustomerContactsList(customer)
          state.selectedItem = { ...customer, contacts: [...baseContacts, contact] }
        }
      })
      .addCase(updateCustomerContact.fulfilled, (state, action) => {
        const { customerId, contact } = action.payload
        const patchContacts = (contacts: Contact[]) =>
          contacts.map((c) => (c.id === contact.id ? contact : c))

        const idx = state.items.findIndex((c) => c.id === customerId)
        if (idx !== -1) {
          const customer = state.items[idx]
          const baseContacts = customer.contacts?.length
            ? customer.contacts
            : getCustomerContactsList(customer)
          state.items[idx] = { ...customer, contacts: patchContacts(baseContacts) }
        }
        if (state.selectedItem?.id === customerId) {
          const customer = state.selectedItem
          const baseContacts = customer.contacts?.length
            ? customer.contacts
            : getCustomerContactsList(customer)
          state.selectedItem = { ...customer, contacts: patchContacts(baseContacts) }
        }
      })
      .addCase(deleteCustomer.fulfilled, (state, action) => {
        state.items = state.items.filter((c) => c.id !== action.payload)
        state.pagination.total -= 1
      })
      .addCase(deleteCustomer.rejected, (state, action) => {
        state.error = payloadMessage(action.payload)
      })
  },
})

export const { setFilters, resetFilters, setPage, setPageSize, setSortConfig, clearSelected, reset } =
  customersSlice.actions
export default customersSlice.reducer
