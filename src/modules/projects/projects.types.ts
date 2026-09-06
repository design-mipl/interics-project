import type { Project, ProjectTeamMember } from '@/slices/projects/reducer'

export type ProjectStatusApi = 'PITCH' | 'LIVE' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED'

export interface ProjectListItemApi {
  id: string
  projectCode?: string
  projectName?: string
  status?: ProjectStatusApi
  statusLabel?: string
  customerId?: string
  customerName?: string
  sector?: string
  sectorLabel?: string
  location?: string | null
  city?: string | null
  state?: string | null
  projectTypes?: string[]
  projectLeadName?: string
  carpetAreaSqFt?: number | null
  expectedStartDate?: string | null
  expectedEndDate?: string | null
  totalDesignFee?: number | null
  totalBuildValue?: number | null
  totalClientPOValue?: number | null
  totalVendorPOValue?: number | null
  createdAt?: string
  wentLiveAt?: string | null
  completedAt?: string | null
  archivedAt?: string | null
  cancelledAt?: string | null
}

export interface ProjectDetailApi {
  id: string
  projectCode: string
  projectName: string
  status: ProjectStatusApi
  statusLabel?: string
  wentLiveAt?: string | null
  completedAt?: string | null
  archivedAt?: string | null
  cancelledAt?: string | null
  customer: {
    id: string
    customerName: string
    sector?: string
    city?: string | null
    state?: string | null
  }
  contacts: Array<{
    id: string
    name: string
    designation?: string | null
    phone?: string | null
    email?: string | null
    contactType?: string
    isPrimary?: boolean
  }>
  vendor?: {
    id: string
    vendorName: string
  } | null
  vendorContacts?: Array<{
    id: string
    name: string
    designation?: string | null
    phone?: string | null
    email?: string | null
    contactType?: string
    isPrimary?: boolean
    vendorId?: string
    vendorName?: string | null
  }>
  /** Grouped multi-vendor Client Team associations (preferred for display). */
  vendors?: Array<{
    vendorId: string
    vendorName: string
    contacts: Array<{
      id: string
      name: string
      designation?: string | null
      phone?: string | null
      email?: string | null
      contactType?: string
      isPrimary?: boolean
    }>
  }>
  requirements?: {
    notes?: string | null
    document?: unknown
  }
  setup: {
    projectTypes: string[]
    sector: string
    location?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    pincode?: string | null
    carpetAreaSqFt?: number | null
    headcount?: number | null
    workstations?: string | null
    cabins?: string | null
    meetingRooms?: string | null
    services?: string | null
    supportFunction?: string | null
    expectedStartDate?: string | null
    expectedEndDate?: string | null
    designFeePerSqFt?: number | null
    buildValuePerSqFt?: number | null
    totalDesignFee?: number | null
    totalBuildValue?: number | null
  }
  team: {
    projectLead: {
      id: string
      name: string
      email?: string
      employeeCode?: string
    }
    members: Array<{
      id: string
      name: string
      email?: string
      employeeCode?: string
    }>
  }
  documents?: unknown
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
  /** Canonical Client PO amount (Live Overview semantics); optional on detail. */
  totalClientPOValue?: number | null
  /** Canonical Vendor Offer amount (Live Overview semantics); optional on detail. */
  totalVendorPOValue?: number | null
}

export interface ProjectCreateFormInput {
  customerId: string
  customerName?: string
  name: string
  contactIds: string[]
  vendorId?: string
  vendorIds?: string[]
  vendorContactIds?: string[]
  projectTypes: string[]
  sector: string
  address?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  location?: string
  carpetArea?: number | null
  headcount?: number | null
  workstations?: string | null
  cabins?: string | null
  meetingRooms?: string | null
  services?: string | null
  supportFunction?: string | null
  designFeePerSqft?: number | null
  buildValuePerSqft?: number | null
  startDate?: string | null
  expectedEndDate?: string | null
  projectManagerId: string
  projectManager?: string
  assignedTeam?: ProjectTeamMember[]
  progress?: string
}

export interface ProjectListParams {
  page?: number
  limit?: number
  search?: string
  status?: string
  customerId?: string
  sector?: string
  projectLeadId?: string
  projectName?: string
  projectType?: string
  expectedStartDate?: string
  expectedEndDate?: string
  createdAt?: string
  wentLiveAt?: string
  completedAt?: string
  archivedAt?: string
  cancelledAt?: string
  columns?: string[]
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface ProjectListResult {
  items: Project[]
  total: number
  page: number
  pageSize: number
}

export interface ProjectFiltersApi {
  projectName?: Array<{ value: string; label: string }>
  status?: Array<{ value: string; label: string }>
  sectors?: Array<{ value: string; label: string }>
  projectType?: Array<{ value: string; label: string }>
  type?: Array<{ value: string; label: string }>
  projectLeadId?: Array<{ value: string; label: string }>
  expectedStartDate?: Array<{ value: string; label: string }>
  expectedEndDate?: Array<{ value: string; label: string }>
  createdAt?: Array<{ value: string; label: string }>
  wentLiveAt?: Array<{ value: string; label: string }>
  completedAt?: Array<{ value: string; label: string }>
  archivedAt?: Array<{ value: string; label: string }>
  cancelledAt?: Array<{ value: string; label: string }>
}

export type ProjectCreateApiPayload = {
  customerId: string
  contactIds: string[]
  vendorId?: string
  vendorIds?: string[]
  vendorContactIds?: string[]
  projectName: string
  projectTypes: string[]
  sector: string
  location?: string
  address?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  carpetAreaSqFt?: number
  headcount?: number
  workstations?: string
  cabins?: string
  meetingRooms?: string
  services?: string
  supportFunction?: string
  expectedStartDate?: string
  expectedEndDate?: string
  designFeePerSqFt?: number
  buildValuePerSqFt?: number
  projectLeadId: string
  teamMemberIds?: string[]
}
