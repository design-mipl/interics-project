import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { ActivityEntry, Contact } from '../customers/reducer'
import { getVendorContactsList, normalizeVendorContactsForSelect } from '@/utils/vendorContacts'
import { applyVendorRecordPatch } from '@/utils/vendorComplianceDocuments'
import {
  fetchVendors,
  fetchVendorById,
  createVendor,
  updateVendor,
  setVendorActive,
  deleteVendor,
  createVendorContact,
  updateVendorContact,
  deleteVendorContact,
  createPendingVendor,
} from './thunk'

function payloadMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Something went wrong'
}

export interface VendorFinancialDetails {
  totalPayables: number
  amountPaid: number
  outstanding: number
  tdsDeducted: number
  activeProjects: number
  completedProjects: number
  totalContractValue: number
  lastPaymentDate: string
  paymentTerms: string
  vendorType: string
  gstStatus: string
}

export type VendorDocumentType =
  | 'Catalogue'
  | 'Brochure'
  | 'Certificate'
  | 'Compliance'
  | 'Product'

export type VendorComplianceDocumentType =
  | 'gst'
  | 'pan'
  | 'bank_cheque'
  | 'insurance'
  | 'catalogue'

export interface VendorComplianceDocument {
  documentType?: VendorComplianceDocumentType
  name: string
  url: string
  description?: string | null
  uploadedBy?: string | null
  uploadedOn?: string | null
  lastUpdatedOn?: string | null
  expiryDate?: string | null
}

export interface VendorDocument {
  id: string
  name: string
  type: VendorDocumentType
  uploadedAt: string
  expiryDate?: string | null
  url: string
  description?: string | null
  uploadedBy?: string | null
  lastUpdatedOn?: string | null
}

export interface VendorAdditionalComplianceDoc {
  id: string
  name: string
  url: string
  fileName?: string | null
  description?: string | null
  uploadedBy?: string | null
  uploadedOn?: string | null
  lastUpdatedOn?: string | null
  expiryDate?: string | null
}

export type ComplianceChipStatus = 'verified' | 'missing' | 'expired' | 'expiring_soon'

export interface VendorCompliance {
  gst?: ComplianceChipStatus
  pan?: ComplianceChipStatus
  bankCheque?: ComplianceChipStatus
  insurance?: { status: ComplianceChipStatus; expiryDate?: string | null }
}

export interface Vendor {
  id: string
  name: string
  gstin: string | null
  pan: string | null
  gstStatus: 'Registered' | 'Unregistered'
  website?: string | null
  contactPerson: string
  designation?: string | null
  phone: string
  email: string
  city: string
  state: string
  address: string | null
  pincode?: string | null
  bankAccountNumber?: string | null
  ifscCode?: string | null
  bankBranchName?: string | null
  tags: string[]
  paymentTerms?: string | null
  notes: string | null
  status: 'Active' | 'Inactive'
  /** When pending, only basic contact fields are captured until the vendor profile is completed. */
  profileStatus?: 'pending' | 'complete'
  /** Vendor rating from Rating Master (e.g. Premium); null when not yet rated. */
  rating: string | null
  activeProjects: number
  totalPayables: number
  createdAt: string
  contacts?: Contact[]
  gstDocument?: VendorComplianceDocument | null
  panDocument?: VendorComplianceDocument | null
  bankChequeDocument?: VendorComplianceDocument | null
  insuranceDocument?: VendorComplianceDocument | null
  activityLog?: ActivityEntry[]
  financialDetails?: VendorFinancialDetails
  documents?: VendorDocument[]
  additionalComplianceDocuments?: VendorAdditionalComplianceDoc[]
  compliance?: VendorCompliance
}

interface Pagination {
  page: number
  pageSize: number
  total: number
}

interface Filters {
  search: string
  status: string
  gstStatus: string
  state: string
}

interface SortConfig {
  field: string | null
  direction: 'asc' | 'desc'
}

interface VendorsState {
  items: Vendor[]
  selectedItem: Vendor | null
  loading: boolean
  saving: boolean
  error: string | null
  pagination: Pagination
  filters: Filters
  sortConfig: SortConfig
}

const initialState: VendorsState = {
  items: [],
  selectedItem: null,
  loading: false,
  saving: false,
  error: null,
  pagination: { page: 1, pageSize: 10, total: 0 },
  filters: { search: '', status: '', gstStatus: '', state: '' },
  sortConfig: { field: null, direction: 'asc' },
}

const vendorsSlice = createSlice({
  name: 'vendors',
  initialState,
  reducers: {
    setFilters(state, action: PayloadAction<Partial<Filters>>) {
      state.filters = { ...state.filters, ...action.payload }
    },
    resetFilters(state) {
      state.filters = { search: state.filters.search, status: state.filters.status, gstStatus: '', state: '' }
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
    applyVendorPatch(
      state,
      action: PayloadAction<{ id: string; patch: Partial<Vendor> }>,
    ) {
      const { id, patch } = action.payload
      const idx = state.items.findIndex((v) => v.id === id)
      if (idx !== -1) {
        state.items[idx] = applyVendorRecordPatch(state.items[idx], patch)
      }
      if (state.selectedItem?.id === id) {
        state.selectedItem = applyVendorRecordPatch(state.selectedItem, patch)
      }
    },
    reset() {
      return initialState
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchVendors.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchVendors.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.items ?? []
        const total = action.payload.total ?? 0
        state.pagination.total = total
        if (typeof action.payload.pageSize === 'number') {
          state.pagination.pageSize = action.payload.pageSize
        }
        const requestedPage =
          typeof action.payload.page === 'number' ? action.payload.page : state.pagination.page
        const size = state.pagination.pageSize || 10
        const maxPage = total <= 0 ? 1 : Math.max(1, Math.ceil(total / size))
        state.pagination.page = Math.min(Math.max(1, requestedPage), maxPage)
      })
      .addCase(fetchVendors.rejected, (state, action) => {
        state.loading = false
        state.error = payloadMessage(action.payload)
      })
      .addCase(fetchVendorById.fulfilled, (state, action) => {
        state.selectedItem = action.payload
        const idx = state.items.findIndex((v) => v.id === action.payload.id)
        if (idx !== -1) {
          const prev = state.items[idx]
          state.items[idx] = {
            ...prev,
            ...action.payload,
            rating: action.payload.rating ?? prev.rating,
            activeProjects: action.payload.activeProjects || prev.activeProjects,
            totalPayables: action.payload.totalPayables || prev.totalPayables,
            contacts: action.payload.contacts?.length
              ? action.payload.contacts
              : prev.contacts,
          }
        } else {
          state.items.unshift(action.payload)
        }
      })
      .addCase(createVendor.pending, (state) => {
        state.saving = true
      })
      .addCase(createVendor.fulfilled, (state, action) => {
        state.saving = false
        state.items.unshift(action.payload)
        state.pagination.total += 1
      })
      .addCase(createVendor.rejected, (state, action) => {
        state.saving = false
        state.error = payloadMessage(action.payload)
      })
      .addCase(updateVendor.pending, (state) => {
        state.saving = true
      })
      .addCase(updateVendor.fulfilled, (state, action) => {
        state.saving = false
        const updated = action.payload
        const idx = state.items.findIndex((v) => v.id === updated.id)
        if (idx !== -1) {
          const prev = state.items[idx]
          state.items[idx] = {
            ...updated,
            rating: updated.rating ?? prev.rating,
          }
        }
        if (state.selectedItem?.id === updated.id) {
          const prev = state.selectedItem
          state.selectedItem = {
            ...updated,
            rating: updated.rating ?? prev.rating,
            gstDocument: updated.gstDocument ?? prev.gstDocument,
            panDocument: updated.panDocument ?? prev.panDocument,
            bankChequeDocument: updated.bankChequeDocument ?? prev.bankChequeDocument,
            insuranceDocument: updated.insuranceDocument ?? prev.insuranceDocument,
          }
        }
      })
      .addCase(updateVendor.rejected, (state, action) => {
        state.saving = false
        state.error = payloadMessage(action.payload)
      })
      .addCase(setVendorActive.fulfilled, (state, action) => {
        const idx = state.items.findIndex((v) => v.id === action.payload.id)
        if (idx !== -1) {
          state.items[idx] = {
            ...state.items[idx],
            ...action.payload,
            rating: action.payload.rating ?? state.items[idx].rating,
          }
        }
        if (state.selectedItem?.id === action.payload.id) {
          state.selectedItem = {
            ...state.selectedItem,
            ...action.payload,
            rating: action.payload.rating ?? state.selectedItem.rating,
          }
        }
      })
      .addCase(deleteVendor.fulfilled, (state, action) => {
        state.items = state.items.filter((v) => v.id !== action.payload)
        state.pagination.total -= 1
      })
      .addCase(deleteVendor.rejected, (state, action) => {
        state.error = payloadMessage(action.payload)
      })
      .addCase(createVendorContact.fulfilled, (state, action) => {
        const { vendorId, contact } = action.payload
        const applyContacts = (vendor: Vendor, baseContacts: Contact[]): Vendor => {
          const nextContacts = contact.isPrimary
            ? [...baseContacts.map((c) => ({ ...c, isPrimary: false })), contact]
            : [...baseContacts, contact]
          const primary = nextContacts.find((c) => c.isPrimary) ?? nextContacts[0]
          return {
            ...vendor,
            contacts: nextContacts,
            ...(primary
              ? {
                  contactPerson: primary.name,
                  designation: primary.designation || null,
                  phone: primary.phone,
                  email: primary.email,
                }
              : {}),
          }
        }

        const idx = state.items.findIndex((v) => v.id === vendorId)
        if (idx !== -1) {
          const vendor = state.items[idx]
          const baseContacts = normalizeVendorContactsForSelect(
            vendor.contacts?.length ? vendor.contacts : getVendorContactsList(vendor),
          ).filter((c) => c.id !== 'legacy-primary')
          state.items[idx] = applyContacts(vendor, baseContacts)
        }
        if (state.selectedItem?.id === vendorId) {
          const vendor = state.selectedItem
          const baseContacts = normalizeVendorContactsForSelect(
            vendor.contacts?.length ? vendor.contacts : getVendorContactsList(vendor),
          ).filter((c) => c.id !== 'legacy-primary')
          state.selectedItem = applyContacts(vendor, baseContacts)
        }
      })
      .addCase(updateVendorContact.fulfilled, (state, action) => {
        const { vendorId, contact } = action.payload
        const patchContacts = (contacts: Contact[]) =>
          contacts.map((c) => {
            if (c.id === contact.id) return contact
            if (contact.isPrimary) return { ...c, isPrimary: false }
            return c
          })

        const applyPrimaryListing = (vendor: Vendor, nextContacts: Contact[]): Vendor => {
          const primary = nextContacts.find((c) => c.isPrimary) ?? nextContacts[0]
          if (!primary) return { ...vendor, contacts: nextContacts }
          return {
            ...vendor,
            contacts: nextContacts,
            contactPerson: primary.name,
            designation: primary.designation || null,
            phone: primary.phone,
            email: primary.email,
          }
        }

        const idx = state.items.findIndex((v) => v.id === vendorId)
        if (idx !== -1) {
          const vendor = state.items[idx]
          const baseContacts = normalizeVendorContactsForSelect(
            vendor.contacts?.length ? vendor.contacts : getVendorContactsList(vendor),
          ).filter((c) => c.id !== 'legacy-primary')
          state.items[idx] = applyPrimaryListing(vendor, patchContacts(baseContacts))
        }
        if (state.selectedItem?.id === vendorId) {
          const vendor = state.selectedItem
          const baseContacts = normalizeVendorContactsForSelect(
            vendor.contacts?.length ? vendor.contacts : getVendorContactsList(vendor),
          ).filter((c) => c.id !== 'legacy-primary')
          state.selectedItem = applyPrimaryListing(vendor, patchContacts(baseContacts))
        }
      })
      .addCase(deleteVendorContact.fulfilled, (state, action) => {
        const { vendorId, contactId } = action.payload
        const removeContact = (contacts: Contact[]) => contacts.filter((c) => c.id !== contactId)

        const idx = state.items.findIndex((v) => v.id === vendorId)
        if (idx !== -1) {
          const vendor = state.items[idx]
          const baseContacts = vendor.contacts?.length
            ? vendor.contacts
            : getVendorContactsList(vendor)
          state.items[idx] = { ...vendor, contacts: removeContact(baseContacts) }
        }
        if (state.selectedItem?.id === vendorId) {
          const vendor = state.selectedItem
          const baseContacts = vendor.contacts?.length
            ? vendor.contacts
            : getVendorContactsList(vendor)
          state.selectedItem = { ...vendor, contacts: removeContact(baseContacts) }
        }
      })
      .addCase(createPendingVendor.pending, (state) => {
        state.saving = true
      })
      .addCase(createPendingVendor.fulfilled, (state, action) => {
        state.saving = false
        state.items.unshift(action.payload)
        state.pagination.total += 1
      })
      .addCase(createPendingVendor.rejected, (state, action) => {
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
  applyVendorPatch,
  reset,
} = vendorsSlice.actions
export default vendorsSlice.reducer
