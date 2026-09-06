import { formatAddressLine } from '@/constants/locations'
import type { Project, ProjectTeamMember } from '@/slices/projects/reducer'
import { getProjectAssignedMembers } from '@/utils/projectAssignedTeam'
import type {
  ProjectCreateApiPayload,
  ProjectCreateFormInput,
  ProjectDetailApi,
  ProjectListItemApi,
} from './projects.types'

function toUiStatus(status?: string): Project['status'] {
  if (!status) return 'Pitch'
  const normalized = status.toUpperCase()
  if (normalized === 'LIVE') return 'Live'
  if (normalized === 'PITCH') return 'Pitch'
  if (status === 'Live' || status === 'Pitch' || status === 'Completed' || status === 'Cancelled' || status === 'Archived') {
    return status
  }
  return 'Pitch'
}

function toApiStatus(
  status?: string,
): 'PITCH' | 'LIVE' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED' | undefined {
  if (!status) return undefined
  const normalized = status.toUpperCase()
  if (normalized === 'LIVE' || status === 'Live') return 'LIVE'
  if (normalized === 'PITCH' || status === 'Pitch') return 'PITCH'
  if (normalized === 'COMPLETED' || status === 'Completed') return 'COMPLETED'
  if (normalized === 'ARCHIVED' || status === 'Archived') return 'ARCHIVED'
  if (normalized === 'CANCELLED' || status === 'Cancelled') return 'CANCELLED'
  return undefined
}

function dateOnly(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10)
}

function optionalNumber(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return value
}

function optionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function buildAssignedTeamFromDetail(api: ProjectDetailApi): ProjectTeamMember[] {
  const lead = api.team?.projectLead
  const members: ProjectTeamMember[] = []
  if (lead?.id) {
    members.push({
      userId: lead.id,
      name: lead.name,
      roleLabel: 'Project Lead',
    })
  }
  for (const member of api.team?.members ?? []) {
    if (!member.id || member.id === lead?.id) continue
    members.push({
      userId: member.id,
      name: member.name,
      roleLabel: 'Team Member',
    })
  }
  return members
}

export function toProjectFromListItem(api: ProjectListItemApi): Project {
  const name = api.projectName ?? ''
  const project: Project = {
    id: api.id,
    projectCode: api.projectCode ?? '',
    name,
    customerId: api.customerId ?? '',
    customerName: api.customerName ?? '',
    projectTypes: api.projectTypes ?? [],
    status: toUiStatus(api.status ?? api.statusLabel),
    progress: api.statusLabel ?? (api.status === 'LIVE' ? 'Live' : 'Pitch'),
    location: api.location ?? formatAddressLine({ city: api.city, state: api.state }),
    city: api.city ?? null,
    state: api.state ?? null,
    carpetArea: api.carpetAreaSqFt ?? null,
    headcount: null,
    projectManager: api.projectLeadName ?? '',
    projectManagerId: '',
    startDate: dateOnly(api.expectedStartDate) ?? null,
    expectedEndDate: dateOnly(api.expectedEndDate) ?? null,
    projectValue: Number(api.totalBuildValue ?? api.totalDesignFee ?? 0),
    totalClientPOValue: Number(api.totalClientPOValue ?? 0),
    totalVendorPOValue: Number(api.totalVendorPOValue ?? 0),
    invoicedAmount: 0,
    paidVendorAmount: 0,
    createdAt: api.createdAt ?? new Date().toISOString(),
    wentLiveAt: api.wentLiveAt ?? null,
    completedAt: api.completedAt ?? null,
    archivedAt: api.archivedAt ?? null,
    cancelledAt: api.cancelledAt ?? null,
    sector: api.sectorLabel ?? api.sector,
  }
  return {
    ...project,
    assignedTeam: getProjectAssignedMembers(project),
  }
}

export function toProjectFromDetail(api: ProjectDetailApi): Project {
  const assignedTeam = buildAssignedTeamFromDetail(api)
  const setup = api.setup ?? ({} as ProjectDetailApi['setup'])
  const customer = api.customer ?? { id: '', customerName: '' }
  const teamLead = api.team?.projectLead ?? { id: '', name: '' }
  return {
    id: api.id,
    projectCode: api.projectCode,
    name: api.projectName,
    customerId: customer.id,
    customerName: customer.customerName,
    projectTypes: setup.projectTypes ?? [],
    status: toUiStatus(api.status),
    progress: api.statusLabel ?? (api.status === 'LIVE' ? 'Live' : 'Pitch'),
    location:
      setup.location ??
      formatAddressLine({
        address: setup.address,
        city: setup.city,
        state: setup.state,
        pincode: setup.pincode,
        country: setup.country,
      }),
    address: setup.address ?? null,
    city: setup.city ?? null,
    state: setup.state ?? null,
    country: setup.country ?? null,
    pincode: setup.pincode ?? null,
    carpetArea: setup.carpetAreaSqFt ?? null,
    headcount: setup.headcount ?? null,
    workstations: setup.workstations ?? null,
    cabins: setup.cabins ?? null,
    meetingRooms: setup.meetingRooms ?? null,
    services: setup.services ?? null,
    supportFunction: setup.supportFunction ?? null,
    projectManager: teamLead.name,
    projectManagerId: teamLead.id,
    assignedTeam,
    startDate: dateOnly(setup.expectedStartDate) ?? null,
    expectedEndDate: dateOnly(setup.expectedEndDate) ?? null,
    projectValue: Number(setup.totalBuildValue ?? setup.totalDesignFee ?? 0),
    totalClientPOValue: Number(api.totalClientPOValue ?? 0),
    totalVendorPOValue: Number(api.totalVendorPOValue ?? 0),
    invoicedAmount: 0,
    paidVendorAmount: 0,
    createdAt: api.createdAt ?? new Date().toISOString(),
    wentLiveAt: api.wentLiveAt ?? null,
    completedAt: api.completedAt ?? null,
    archivedAt: api.archivedAt ?? null,
    cancelledAt: api.cancelledAt ?? null,
    sector: setup.sector,
    designFeePerSqft: setup.designFeePerSqFt ?? null,
    buildValuePerSqft: setup.buildValuePerSqFt ?? null,
    vendorId: api.vendor?.id ?? null,
    vendorName: api.vendor?.vendorName ?? null,
    vendorContacts: (api.vendorContacts ?? []).map((contact) => ({
      id: contact.id,
      name: contact.name,
      designation: contact.designation ?? undefined,
      phone: contact.phone ?? undefined,
      email: contact.email ?? undefined,
      company: contact.vendorName ?? api.vendor?.vendorName,
      source: 'vendor' as const,
      vendorId: contact.vendorId,
    })),
    vendors: (api.vendors ?? []).map((group) => ({
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      contacts: group.contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        designation: contact.designation ?? undefined,
        phone: contact.phone ?? undefined,
        email: contact.email ?? undefined,
        company: group.vendorName,
        source: 'vendor' as const,
        vendorId: group.vendorId,
      })),
    })),
    clientTeam: (api.contacts ?? []).map((contact) => ({
      id: contact.id,
      name: contact.name,
      designation: contact.designation ?? undefined,
      phone: contact.phone ?? undefined,
      email: contact.email ?? undefined,
      company: customer.customerName,
      source: 'customer' as const,
    })),
  }
}

export function toCreatePayload(form: ProjectCreateFormInput): ProjectCreateApiPayload {
  const leadId = form.projectManagerId.trim()
  const teamMemberIds = [
    ...new Set(
      (form.assignedTeam ?? [])
        .map((member) => member.userId?.trim())
        .filter((id): id is string => Boolean(id) && id !== leadId),
    ),
  ]

  const location =
    optionalText(form.location) ??
    formatAddressLine({
      address: form.address,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
      country: form.country,
    })

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const vendorContactIds = [...new Set((form.vendorContactIds ?? []).filter((id) => uuidRe.test(id)))]
  const vendorIds = [...new Set((form.vendorIds ?? []).filter((id) => Boolean(id?.trim())))]
  const vendorId = form.vendorId?.trim() || vendorIds[0] || undefined

  return {
    customerId: form.customerId,
    contactIds: form.contactIds,
    ...(vendorId ? { vendorId } : {}),
    ...(vendorIds.length ? { vendorIds } : {}),
    ...(vendorContactIds.length ? { vendorContactIds } : {}),
    projectName: form.name.trim(),
    projectTypes: form.projectTypes,
    sector: form.sector.trim(),
    ...(optionalText(location) ? { location: optionalText(location) } : {}),
    ...(optionalText(form.address) ? { address: optionalText(form.address) } : {}),
    ...(optionalText(form.city) ? { city: optionalText(form.city) } : {}),
    ...(optionalText(form.state) ? { state: optionalText(form.state) } : {}),
    ...(optionalText(form.country) ? { country: optionalText(form.country) } : {}),
    ...(optionalText(form.pincode) ? { pincode: optionalText(form.pincode) } : {}),
    ...(optionalNumber(form.carpetArea) !== undefined
      ? { carpetAreaSqFt: optionalNumber(form.carpetArea) }
      : {}),
    ...(optionalNumber(form.headcount) !== undefined ? { headcount: optionalNumber(form.headcount) } : {}),
    ...(optionalText(form.workstations) ? { workstations: optionalText(form.workstations) } : {}),
    ...(optionalText(form.cabins) ? { cabins: optionalText(form.cabins) } : {}),
    ...(optionalText(form.meetingRooms) ? { meetingRooms: optionalText(form.meetingRooms) } : {}),
    ...(optionalText(form.services) ? { services: optionalText(form.services) } : {}),
    ...(optionalText(form.supportFunction)
      ? { supportFunction: optionalText(form.supportFunction) }
      : {}),
    ...(dateOnly(form.startDate) ? { expectedStartDate: dateOnly(form.startDate) } : {}),
    ...(dateOnly(form.expectedEndDate) ? { expectedEndDate: dateOnly(form.expectedEndDate) } : {}),
    ...(optionalNumber(form.designFeePerSqft) !== undefined
      ? { designFeePerSqFt: optionalNumber(form.designFeePerSqft) }
      : {}),
    ...(optionalNumber(form.buildValuePerSqft) !== undefined
      ? { buildValuePerSqFt: optionalNumber(form.buildValuePerSqft) }
      : {}),
    projectLeadId: leadId,
    ...(teamMemberIds.length ? { teamMemberIds } : {}),
  }
}

export function toUpdatePayload(
  data: Partial<Project> & { contactIds?: string[]; vendorContactIds?: string[] },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  if (data.name !== undefined) payload.projectName = data.name.trim()
  if (data.customerId !== undefined) payload.customerId = data.customerId
  if (data.contactIds !== undefined) payload.contactIds = data.contactIds
  if (data.projectTypes !== undefined) payload.projectTypes = data.projectTypes
  if (data.sector !== undefined) payload.sector = data.sector

  // Match create: optional text as string (empty clears); never send null
  if (data.address !== undefined) payload.address = optionalText(data.address) ?? ''
  if (data.city !== undefined) payload.city = optionalText(data.city) ?? ''
  if (data.state !== undefined) payload.state = optionalText(data.state) ?? ''
  if (data.country !== undefined) payload.country = optionalText(data.country) ?? ''
  if (data.pincode !== undefined) payload.pincode = optionalText(data.pincode) ?? ''
  if (
    data.address !== undefined ||
    data.city !== undefined ||
    data.state !== undefined ||
    data.country !== undefined ||
    data.pincode !== undefined ||
    data.location !== undefined
  ) {
    payload.location =
      optionalText(data.location) ??
      formatAddressLine({
        address: data.address,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        country: data.country,
      }) ??
      ''
  }
  if (data.carpetArea !== undefined) {
    payload.carpetAreaSqFt = optionalNumber(data.carpetArea) ?? null
  }
  if (data.headcount !== undefined) {
    payload.headcount = optionalNumber(data.headcount) ?? null
  }
  if (data.workstations !== undefined) payload.workstations = optionalText(data.workstations) ?? ''
  if (data.cabins !== undefined) payload.cabins = optionalText(data.cabins) ?? ''
  if (data.meetingRooms !== undefined) payload.meetingRooms = optionalText(data.meetingRooms) ?? ''
  if (data.services !== undefined) payload.services = optionalText(data.services) ?? ''
  if (data.supportFunction !== undefined) {
    payload.supportFunction = optionalText(data.supportFunction) ?? ''
  }
  if (data.startDate !== undefined) {
    payload.expectedStartDate = dateOnly(data.startDate) ?? null
  }
  if (data.expectedEndDate !== undefined) {
    payload.expectedEndDate = dateOnly(data.expectedEndDate) ?? null
  }
  if (data.designFeePerSqft !== undefined) {
    payload.designFeePerSqFt = optionalNumber(data.designFeePerSqft) ?? null
  }
  if (data.buildValuePerSqft !== undefined) {
    payload.buildValuePerSqFt = optionalNumber(data.buildValuePerSqft) ?? null
  }
  if (data.projectManagerId !== undefined) payload.projectLeadId = data.projectManagerId

  if (data.vendorId !== undefined) {
    payload.vendorId = data.vendorId === null || data.vendorId === '' ? null : data.vendorId
  }
  if (data.vendorContactIds !== undefined) {
    payload.vendorContactIds = data.vendorContactIds
  }

  if (data.assignedTeam !== undefined || data.projectManagerId !== undefined) {
    const leadId = (data.projectManagerId ?? '').trim()
    const teamMemberIds = [
      ...new Set(
        (data.assignedTeam ?? [])
          .map((member) => member.userId?.trim())
          .filter((id): id is string => Boolean(id) && id !== leadId),
      ),
    ]
    payload.teamMemberIds = teamMemberIds
  }

  return payload
}

export function toListStatusParam(status?: string): string | undefined {
  return toApiStatus(status)
}

export const PROJECT_FIELD_ALIASES: Record<string, string> = {
  projectName: 'name',
  projectLeadId: 'projectManagerId',
  teamMemberIds: 'teamMembers',
  carpetAreaSqFt: 'carpetArea',
  expectedStartDate: 'startDate',
  designFeePerSqFt: 'designFeePerSqft',
  buildValuePerSqFt: 'buildValuePerSqft',
  contactIds: 'contactId',
}
