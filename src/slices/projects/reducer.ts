import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import {
  fetchProjects,
  fetchProjectById,
  createProject,
  updateProject,
  addProjectVendorAssociation,
  changeProjectStatus,
} from './thunk'

export interface ContactInfo {
  id?: string
  name?: string
  designation?: string
  email?: string
  phone?: string
  company?: string
  contact?: string
  /** Distinguishes customer vs vendor contacts in Client Team UI. */
  source?: 'customer' | 'vendor'
  /** Set when assigning a vendor contact to a project (not persisted on display-only rows). */
  vendorId?: string
}

export interface ProjectTeamMember {
  userId: string
  name: string
  roleLabel?: string
}

export interface ProjectDocumentFile {
  id: string
  fileName: string
  sizeBytes: number
  uploadedAt: string
  blobUrl: string
}

export interface ProjectDocuments {
  finalLayoutDescription?: string
  finalLayoutLink?: string
  finalRcpDescription?: string
  finalRcpLink?: string
  finalViewsDescription?: string
  finalViewsLink?: string
  finalPhotographsDescription?: string
  finalPhotographsLink?: string
  finalHandoverDescription?: string
  finalHandoverLink?: string
  finalLayoutFile?: ProjectDocumentFile
  finalRcpFile?: ProjectDocumentFile
  finalViewsFile?: ProjectDocumentFile
  finalPhotographsFile?: ProjectDocumentFile
  finalHandoverFile?: ProjectDocumentFile
  finalHandoverDocuments?: ProjectDocumentFile[]
}

export interface Project {
  id: string
  projectCode: string
  name: string
  customerId: string
  customerName: string
  projectTypes: string[]
  status: 'Pitch' | 'Live' | 'Completed' | 'Cancelled' | 'Archived'
  progress: string
  building?: string
  location: string
  /** Street / site address line. */
  address?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  pincode?: string | null
  floor?: string
  carpetArea: number | null
  headcount: number | null
  workstationSize?: string | null
  meetingRoomCount?: number | null
  /** Optional space-planning notes from Create Project → Project Details. */
  workstations?: string | null
  cabins?: string | null
  meetingRooms?: string | null
  services?: string | null
  supportFunction?: string | null
  serverRoomDetails?: string | null
  upsCapacity?: string | null
  receptionDetails?: string | null
  pantryDetails?: string | null
  projectManager: string
  projectManagerId: string
  assignedTeam?: ProjectTeamMember[]
  startDate: string | null
  expectedEndDate: string | null
  projectValue: number
  totalClientPOValue: number
  totalVendorPOValue: number
  invoicedAmount: number
  paidVendorAmount: number
  totalDesignServiceValue?: number
  feePerSqftCategories?: Array<{
    category: string
    clientPOAmount: number
  }>
  createdAt: string
  wentLiveAt?: string | null
  completedAt?: string | null
  archivedAt?: string | null
  cancelledAt?: string | null
  // Extended metadata
  sector?: string
  gstNumber?: string
  projectScope?: string
  chargeableArea?: number | null
  // Linked vendor (legacy singular — primary/first; prefer vendorContacts / vendors[])
  vendorId?: string | null
  vendorName?: string | null
  vendorContacts?: ContactInfo[]
  /** Grouped vendors with contacts when API returns `vendors`. */
  vendors?: Array<{
    vendorId: string
    vendorName: string
    contacts: ContactInfo[]
  }>
  // Team contacts
  clientTeam?: ContactInfo[]
  projectTeam?: ContactInfo[]
  designTeam?: ContactInfo[]
  // External consultants
  externalConsultants?: {
    hvac?: string
    lighting?: string
    approvals?: string
  }
  // Build vendors
  buildVendors?: {
    civilInterior?: string
    electrical?: string
    fireFighting?: string
    av?: string
  }
  // Commercial per-sqft values
  buildValuePerSqft?: number | null
  buildValuePerSqftLevel2?: number | null
  designFeePerSqft?: number | null
  designFeePerSqftLevel2?: number | null
  projectDocuments?: ProjectDocuments
}

interface Pagination {
  page: number
  pageSize: number
  total: number
}

interface Filters {
  search: string
  status: string
  type: string
  projectManager: string
  expectedStartDate: string
  expectedEndDate: string
}

interface SortConfig {
  field: string | null
  direction: 'asc' | 'desc'
}

interface ProjectsState {
  items: Project[]
  selectedItem: Project | null
  loading: boolean
  saving: boolean
  error: string | null
  listRequestId: string | null
  pagination: Pagination
  filters: Filters
  sortConfig: SortConfig
}

const initialState: ProjectsState = {
  items: [],
  selectedItem: null,
  loading: false,
  saving: false,
  error: null,
  listRequestId: null,
  pagination: { page: 1, pageSize: 10, total: 0 },
  filters: {
    search: '',
    status: '',
    type: '',
    projectManager: '',
    expectedStartDate: '',
    expectedEndDate: '',
  },
  sortConfig: { field: null, direction: 'asc' },
}

const projectsSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {
    setFilters(state, action: PayloadAction<Partial<Filters>>) {
      state.filters = { ...state.filters, ...action.payload }
      state.pagination.page = 1
    },
    resetFilters(state) {
      state.filters = initialState.filters
      state.pagination.page = 1
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
      .addCase(fetchProjects.pending, (state, action) => {
        state.listRequestId = action.meta.requestId
        if (state.items.length === 0) state.loading = true
        state.error = null
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) return
        state.loading = false
        state.items = action.payload.items ?? []
        const total = action.payload.total ?? 0
        state.pagination.total = total
        const size = state.pagination.pageSize || 10
        const maxPage = total <= 0 ? 1 : Math.max(1, Math.ceil(total / size))
        if (state.pagination.page > maxPage) state.pagination.page = maxPage
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        if (state.listRequestId !== action.meta.requestId) return
        state.loading = false
        state.error = action.payload as string
      })
      .addCase(fetchProjectById.fulfilled, (state, action) => {
        state.selectedItem = action.payload
      })
      .addCase(createProject.pending, (state) => {
        state.saving = true
      })
      .addCase(createProject.fulfilled, (state, action) => {
        state.saving = false
        state.items.unshift(action.payload)
        state.pagination.total += 1
      })
      .addCase(createProject.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(updateProject.pending, (state) => {
        state.saving = true
      })
      .addCase(updateProject.fulfilled, (state, action) => {
        state.saving = false
        const idx = state.items.findIndex((p) => p.id === action.payload.id)
        if (idx !== -1) state.items[idx] = action.payload
        if (state.selectedItem?.id === action.payload.id) {
          state.selectedItem = action.payload
        }
      })
      .addCase(updateProject.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(addProjectVendorAssociation.pending, (state) => {
        state.saving = true
      })
      .addCase(addProjectVendorAssociation.fulfilled, (state, action) => {
        state.saving = false
        const idx = state.items.findIndex((p) => p.id === action.payload.id)
        if (idx !== -1) state.items[idx] = action.payload
        if (state.selectedItem?.id === action.payload.id) {
          state.selectedItem = action.payload
        }
      })
      .addCase(addProjectVendorAssociation.rejected, (state, action) => {
        state.saving = false
        state.error = action.payload as string
      })
      .addCase(changeProjectStatus.fulfilled, (state, action) => {
        const idx = state.items.findIndex((p) => p.id === action.payload.id)
        if (idx !== -1) state.items[idx] = action.payload
        if (state.selectedItem?.id === action.payload.id) {
          state.selectedItem = action.payload
        }
      })
  },
})

export const { setFilters, resetFilters, setPage, setPageSize, setSortConfig, clearSelected, reset } = projectsSlice.actions
export default projectsSlice.reducer
