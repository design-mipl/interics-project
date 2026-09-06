import { useState, useEffect, useMemo, type HTMLAttributes } from 'react'
import {
  Box,
  Stack,
  Typography,
  Autocomplete,
  TextField,
  Chip as MuiChip,
  Select as MuiSelect,
  MenuItem,
  FormControl,
  Button as MuiButton,
  Divider,
} from '@mui/material'
import { Add, PersonOutline } from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import {
  fetchCustomers,
  createCustomerContact,
  fetchCustomerById,
} from '../../slices/customers/thunk'
import { fetchUsers, toUiUser } from '../../slices/users/thunk'
import { fetchRoles } from '../../slices/roles/thunk'
import { usersApi } from '../../api/usersApi'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import { normalizeArrayResponse } from '@/utils/normalizeListResponse'
import { createVendorContact, fetchVendorById, fetchVendors } from '../../slices/vendors/thunk'
import type { Vendor } from '../../slices/vendors/reducer'
import { isProjectLeadRole, PROJECT_LEAD_ROLE_KEY } from './projectManagerRoles'
import { ContactPersonAutocomplete } from './components/ContactPersonAutocomplete'
import {
  AddNewPersonModal,
  type NewPersonForm,
  type VendorOption as VendorSelectOption,
} from './components/CreateContactPersonModal'
import { VendorSelectFieldMulti } from './components/VendorSelectFieldMulti'
import { CustomerDrawer } from '../Customers/CustomerDrawer'
import { QuickAddVendorModal } from './components/QuickAddVendorModal'
import { sanitizeMobileInput } from '@/utils/mobile'
import {
  ProjectDetailsFields,
  ProjectSetupFields,
  validateProjectSetupForm,
} from './components/ProjectSetupFormFields'
import { createProject } from '../../slices/projects/thunk'
import type { Customer } from '../../slices/customers/reducer'
import type { User } from '../../slices/users/reducer'
import { FullPageForm, FullPageFormSection } from '../../components/templates/FullPageForm'
import { FormField } from '../../components/templates/DrawerForm'
import { useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { getInitials, getAvatarColor } from '../../utils/formatters'
import { alpha } from '@mui/material/styles'
import { fetchSectors, fetchStatuses } from '../../slices/settings/thunk'
import { formatAddressLine } from '@/constants/locations'
import {
  getContactsForCustomer,
  getDefaultContactIds,
  getVendorContactsForProjectCreate,
  isPersistedContactId,
  findContactsByIds,
  clientTeamFromContacts,
  buildProjectDocumentsFromForm,
  buildProjectSetupPayload,
  FORM_CONTROL_INPUT_SX,
} from './projectCreateHelpers'
import { normalizeContacts } from '../../utils/entityContacts'
import { buildAssignedTeamPayload } from '@/utils/projectAssignedTeam'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardFormData {
  // Step 1 — Customer
  customerId: string
  customerName: string
  contactIds: string[]
  // Step 1 — Vendor (optional, multi)
  vendorId: string
  vendorIds: string[]
  vendorContactIds: string[]
  // Step 2 — Project Setup
  name: string
  projectTypes: string[]
  sector: string
  startDate: string
  expectedEndDate: string
  // Step 3 — Project Details (optional)
  workstations: string
  cabins: string
  meetingRooms: string
  services: string
  supportFunction: string
  // Kept for payload compatibility / documents
  location: string
  address: string
  city: string
  state: string
  country: string
  pincode: string
  carpetArea: string
  buildValuePerSqft: string
  designFeePerSqft: string
  headcount: string
  workstationSize: string
  meetingRoomCount: string
  serverRoomDetails: string
  upsCapacity: string
  receptionDetails: string
  pantryDetails: string
  requirementFile: File | null
  requirementNotes: string
  // Step 4 — Team
  projectManagerId: string
  projectManagerName: string
  teamMembers: User[]
  // Documents (unused in wizard UI but still submitted)
  finalLayoutDescription: string
  finalLayoutLink: string
  finalRcpDescription: string
  finalRcpLink: string
  finalViewsDescription: string
  finalViewsLink: string
  finalPhotographsDescription: string
  finalPhotographsLink: string
  finalHandoverDescription: string
  finalHandoverLink: string
  finalLayoutFile: File | null
  finalRcpFile: File | null
  finalViewsFile: File | null
  finalPhotographsFile: File | null
  finalHandoverFiles: File[]
}

interface StepErrors {
  customerId?: string
  contactId?: string
  vendorId?: string
  vendorContactId?: string
  name?: string
  projectTypes?: string
  sector?: string
  address?: string
  city?: string
  state?: string
  country?: string
  pincode?: string
  startDate?: string
  expectedEndDate?: string
  projectManagerId?: string
}

// ─── Step 1 — Customer Selection ─────────────────────────────────────────────

function filterCustomers(options: Customer[], { inputValue }: { inputValue: string }) {
  const q = inputValue.trim().toLowerCase()
  if (!q) return options
  return options.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.contactPerson.toLowerCase().includes(q),
  )
}

function renderCustomerOption(props: HTMLAttributes<HTMLLIElement>, option: Customer) {
  const colors = getAvatarColor(option.name)
  return (
    <Box component="li" {...props} sx={{ gap: 1, alignItems: 'flex-start !important', py: '8px !important' }}>
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: '6px',
          bgcolor: alpha(colors.bg, 0.15),
          color: colors.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          fontWeight: 700,
          flexShrink: 0,
          mt: '2px',
        }}
      >
        {getInitials(option.name)}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35 }}>{option.name}</Typography>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.35 }}>
          {option.contactPerson}
        </Typography>
      </Box>
    </Box>
  )
}

function Step1Customer({
  formData,
  setFormData,
  customers,
  loadingCustomers,
  errors,
  setErrors,
}: {
  formData: WizardFormData
  setFormData: React.Dispatch<React.SetStateAction<WizardFormData>>
  customers: Customer[]
  loadingCustomers: boolean
  errors: StepErrors
  setErrors: React.Dispatch<React.SetStateAction<StepErrors>>
}) {
  const dispatch = useAppDispatch()
  const toast = useToast()

  const [addPersonOpen, setAddPersonOpen] = useState(false)
  const [addVendorPersonOpen, setAddVendorPersonOpen] = useState(false)
  const [addVendorOpen, setAddVendorOpen] = useState(false)
  const [showInlineCustomer, setShowInlineCustomer] = useState(false)
  const [vendorDetailsById, setVendorDetailsById] = useState<Record<string, Vendor>>({})

  const selectedCustomerDetail = useAppSelector((s) => s.customers.selectedItem)
  // Prefer detail/selectedItem contacts when they match the form selection — list DTOs omit contact UUIDs.
  const selectedCustomer =
    (selectedCustomerDetail?.id === formData.customerId ? selectedCustomerDetail : null) ??
    customers.find((c) => c.id === formData.customerId) ??
    null
  // Only real contact UUIDs from customer detail — never legacy list placeholders.
  const customerContacts = useMemo(
    () => normalizeContacts(selectedCustomer?.contacts ?? []),
    [selectedCustomer],
  )
  const selectedContacts = useMemo(
    () => customerContacts.filter((c) => formData.contactIds.includes(c.id)),
    [customerContacts, formData.contactIds],
  )

  const vendors = useAppSelector((s) => s.vendors.items ?? [])
  const vendorsLoading = useAppSelector((s) => s.vendors.loading)
  const vendorDetail = useAppSelector((s) => s.vendors.selectedItem)

  useEffect(() => {
    for (const vendorId of formData.vendorIds) {
      if (vendorDetailsById[vendorId]) continue
      void dispatch(fetchVendorById(vendorId))
        .unwrap()
        .then((detail) => {
          setVendorDetailsById((prev) => ({ ...prev, [vendorId]: detail }))
        })
        .catch(() => undefined)
    }
  }, [dispatch, formData.vendorIds, vendorDetailsById])

  useEffect(() => {
    if (vendorDetail?.id && formData.vendorIds.includes(vendorDetail.id)) {
      setVendorDetailsById((prev) => ({ ...prev, [vendorDetail.id]: vendorDetail }))
    }
  }, [vendorDetail, formData.vendorIds])

  const vendorContacts = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof getVendorContactsForProjectCreate>[number]>()
    for (const vendorId of formData.vendorIds) {
      const detail =
        vendorDetailsById[vendorId] ??
        (vendorDetail?.id === vendorId ? vendorDetail : undefined) ??
        vendors.find((v) => v.id === vendorId)
      for (const contact of getVendorContactsForProjectCreate(detail)) {
        byId.set(contact.id, contact)
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [formData.vendorIds, vendorDetailsById, vendorDetail, vendors])

  const selectedVendorContacts = useMemo(
    () => vendorContacts.filter((c) => formData.vendorContactIds.includes(c.id)),
    [vendorContacts, formData.vendorContactIds],
  )
  const vendorOptions = useMemo<VendorSelectOption[]>(
    () =>
      vendors
        .map((v) => ({ id: v.id, label: v.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [vendors],
  )
  const existingVendorPhones = useMemo(
    () => vendors.map((v) => v.phone.trim()).filter(Boolean),
    [vendors],
  )

  async function handleCustomerCreated(created: { id: string; name: string }) {
    try {
      const full = await dispatch(fetchCustomerById(created.id)).unwrap()
      // Refresh list for Autocomplete options, but do not await in a way that blocks
      // contact UI — reducer preserves contacts for the selected/detail customer.
      void dispatch(fetchCustomers({}))
      const contacts = getContactsForCustomer(full)
      setFormData((prev) => ({
        ...prev,
        customerId: full.id,
        customerName: full.name,
        contactIds: getDefaultContactIds(contacts),
      }))
      setShowInlineCustomer(false)
      toast.success('Customer created')
    } catch {
      toast.error('Customer created but failed to load details')
    }
  }

  return (
    <>
    <FullPageFormSection
      title="Select Customer"
      subtitle="Choose an existing client and contact persons"
      columns={2}
    >
      <FormField label="Customer" required error={errors.customerId}>
        <Autocomplete
          fullWidth
          size="small"
          loading={loadingCustomers}
          options={customers}
          filterOptions={filterCustomers}
          getOptionLabel={(c) => c.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          value={selectedCustomer}
          onChange={(_, val) => {
            if (!val) {
              setFormData((prev) => ({
                ...prev,
                customerId: '',
                customerName: '',
                contactIds: [],
              }))
              return
            }
            setFormData((prev) => ({
              ...prev,
              customerId: val.id,
              customerName: val.name,
              contactIds: [],
            }))
            void dispatch(fetchCustomerById(val.id))
              .unwrap()
              .then((detail) => {
                const contacts = getContactsForCustomer(detail)
                setFormData((prev) => ({
                  ...prev,
                  customerId: detail.id,
                  customerName: detail.name,
                  contactIds: getDefaultContactIds(contacts),
                }))
              })
              .catch(() => {
                toast.error('Failed to load customer contacts')
              })
          }}
          renderOption={renderCustomerOption}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              placeholder="Search by name…"
              error={Boolean(errors.customerId)}
              sx={FORM_CONTROL_INPUT_SX}
            />
          )}
        />
      </FormField>

      <FormField label="Contact Person" required error={errors.contactId}>
        <ContactPersonAutocomplete
          contacts={formData.customerId ? customerContacts : []}
          value={formData.customerId ? selectedContacts : []}
          error={errors.contactId}
          placeholder={
            formData.customerId ? 'Search contacts…' : 'Select a customer first…'
          }
          onChange={(val) => {
            setFormData((prev) => ({ ...prev, contactIds: val.map((c) => c.id) }))
            setErrors((prev) => ({ ...prev, contactId: undefined }))
          }}
          onCreateClick={
            formData.customerId ? () => setAddPersonOpen(true) : undefined
          }
        />
      </FormField>

      <Box>
        <VendorSelectFieldMulti
          value={formData.vendorIds}
          options={vendorOptions}
          loading={vendorsLoading}
          error={errors.vendorId}
          onAddNewVendor={() => setAddVendorOpen(true)}
          onChange={(vendorIds) => {
            const uniqueIds = [...new Set(vendorIds.filter(Boolean))]
            setFormData((prev) => {
              const allowedContactIds = new Set(
                uniqueIds.flatMap((id) => {
                  const detail =
                    vendorDetailsById[id] ??
                    (vendorDetail?.id === id ? vendorDetail : undefined) ??
                    vendors.find((v) => v.id === id)
                  return getVendorContactsForProjectCreate(detail).map((c) => c.id)
                }),
              )
              return {
                ...prev,
                vendorIds: uniqueIds,
                vendorId: uniqueIds[0] ?? '',
                vendorContactIds: prev.vendorContactIds.filter((id) => allowedContactIds.has(id)),
              }
            })
            setErrors((prev) => ({ ...prev, vendorId: undefined, vendorContactId: undefined }))
            for (const vendorId of uniqueIds) {
              if (vendorDetailsById[vendorId]) continue
              void dispatch(fetchVendorById(vendorId))
                .unwrap()
                .then((detail) => {
                  setVendorDetailsById((prev) => ({ ...prev, [vendorId]: detail }))
                })
                .catch(() => {
                  toast.error('Failed to load vendor contacts')
                })
            }
          }}
        />
      </Box>

      <FormField label="Vendor Contact Person" error={errors.vendorContactId}>
        <ContactPersonAutocomplete
          contacts={formData.vendorIds.length > 0 ? vendorContacts : []}
          value={formData.vendorIds.length > 0 ? selectedVendorContacts : []}
          error={errors.vendorContactId}
          placeholder={
            formData.vendorIds.length > 0
              ? 'Search vendor contacts…'
              : 'Select a vendor first…'
          }
          onChange={(val) => {
            setFormData((prev) => ({
              ...prev,
              vendorContactIds: val.map((c) => c.id).filter(isPersistedContactId),
            }))
            setErrors((prev) => ({ ...prev, vendorContactId: undefined }))
          }}
          onCreateClick={
            formData.vendorIds.length > 0 ? () => setAddVendorPersonOpen(true) : undefined
          }
        />
      </FormField>

      <Box sx={{ gridColumn: '1 / -1' }}>
        <Divider sx={{ my: 2 }} />
                <Box display="flex" flexWrap="wrap" gap={1}>
          <MuiButton
            variant="outlined"
            size="small"
            startIcon={<Add />}
            sx={{ fontSize: 13 }}
            onClick={() => setShowInlineCustomer(true)}
          >
            Create New Customer
          </MuiButton>
          <MuiButton
            variant="outlined"
            size="small"
            startIcon={<Add />}
            sx={{ fontSize: 13 }}
            onClick={() => setAddVendorOpen(true)}
          >
            Create New Vendor
          </MuiButton>
        </Box>
      </Box>
    </FullPageFormSection>

    <CustomerDrawer
      open={showInlineCustomer}
      onClose={() => setShowInlineCustomer(false)}
      mode="add"
      onSuccess={(customer) => {
        void handleCustomerCreated(customer)
      }}
    />

    <AddNewPersonModal
      open={addPersonOpen}
      onClose={() => setAddPersonOpen(false)}
      peers={customerContacts}
      existingVendorPhones={[]}
      isVendor={false}
      onSave={async (person: NewPersonForm) => {
        const customerId = formData.customerId
        if (!customerId) return false

        try {
          const phone = sanitizeMobileInput(person.phone)

          const result = await dispatch(
            createCustomerContact({
              customerId,
              data: {
                name: person.name.trim(),
                phone,
                email: person.email.trim(),
                designation: person.designation.trim(),
                isPrimary: customerContacts.length === 0,
              },
            }),
          ).unwrap()

          const full = await dispatch(fetchCustomerById(customerId)).unwrap()
          void dispatch(fetchCustomers({}))

          setFormData((prev) => ({
            ...prev,
            customerId: full.id,
            customerName: full.name,
            contactIds: [...new Set([...prev.contactIds, result.contact.id])],
          }))
          setErrors((prev) => ({ ...prev, contactId: undefined }))
          setAddPersonOpen(false)

          return true
        } catch (err: unknown) {
          const message =
            typeof err === 'string'
              ? err
              : err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
                ? String((err as { message: string }).message)
                : 'Failed to create contact person'
          toast.error(message)
          return false
        }
      }}
    />

    <AddNewPersonModal
      open={addVendorPersonOpen}
      onClose={() => setAddVendorPersonOpen(false)}
      peers={vendorContacts}
      existingVendorPhones={existingVendorPhones}
      isVendor={true}
      onSave={async (person: NewPersonForm) => {
        // Prefer last selected vendor (most recently added), else first.
        const vendorId =
          formData.vendorIds[formData.vendorIds.length - 1] ??
          formData.vendorIds[0] ??
          ''
        if (!vendorId) return false

        try {
          const phone = sanitizeMobileInput(person.phone)

          const result = await dispatch(
            createVendorContact({
              vendorId,
              data: {
                name: person.name.trim(),
                phone,
                email: person.email.trim(),
                designation: person.designation.trim(),
                isPrimary: vendorContacts.length === 0,
              },
            }),
          ).unwrap()

          // Refresh this vendor's contacts into list+selectedItem (do not replace
          // the whole list first — that would drop contacts from list rows).
          const detail = await dispatch(fetchVendorById(vendorId)).unwrap()
          setVendorDetailsById((prev) => ({ ...prev, [vendorId]: detail }))

          setFormData((prev) => ({
            ...prev,
            vendorIds: prev.vendorIds.includes(vendorId)
              ? prev.vendorIds
              : [...prev.vendorIds, vendorId],
            vendorId: prev.vendorIds[0] ?? vendorId,
            vendorContactIds: [
              ...new Set(
                [...prev.vendorContactIds, result.contact.id].filter(isPersistedContactId),
              ),
            ],
          }))
          setErrors((prev) => ({ ...prev, vendorContactId: undefined }))
          setAddVendorPersonOpen(false)
          return true
        } catch (err: unknown) {
          const message =
            typeof err === 'string'
              ? err
              : err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
                ? String((err as { message: string }).message)
                : 'Failed to create vendor contact person'
          toast.error(message)
          return false
        }
      }}
    />

    <QuickAddVendorModal
      open={addVendorOpen}
      onClose={() => setAddVendorOpen(false)}
      onCreated={(vendor) => {
        const createdVendorId = vendor.id
        setFormData((prev) => {
          const vendorIds = [...new Set([...prev.vendorIds, createdVendorId])]
          return {
            ...prev,
            vendorIds,
            vendorId: vendorIds[0] ?? '',
            // Keep existing vendor contacts; do not clear on add.
          }
        })
        setErrors((prev) => ({ ...prev, vendorId: undefined, vendorContactId: undefined }))
        setAddVendorOpen(false)

        void dispatch(fetchVendorById(createdVendorId))
          .unwrap()
          .then((detail) => {
            setVendorDetailsById((prev) => ({ ...prev, [createdVendorId]: detail }))
            const defaultIds = getDefaultContactIds(getVendorContactsForProjectCreate(detail))
            if (defaultIds.length === 0) return
            setFormData((prev) => ({
              ...prev,
              vendorContactIds: [
                ...new Set(
                  [...prev.vendorContactIds, ...defaultIds].filter(isPersistedContactId),
                ),
              ],
            }))
          })
          .catch(() => {
            toast.error('Failed to load vendor contacts')
          })
      }}
    />
    </>
  )
}

// ─── Step 2 — Project Setup ───────────────────────────────────────────────────

function Step2ProjectSetup({
  formData,
  setFormData,
  errors,
}: {
  formData: WizardFormData
  setFormData: React.Dispatch<React.SetStateAction<WizardFormData>>
  errors: StepErrors
}) {
  return (
    <FullPageFormSection title="Project Setup" subtitle="Basic project information" columns={2}>
      <ProjectSetupFields
        values={formData}
        errors={errors}
        onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
      />
    </FullPageFormSection>
  )
}

// ─── Step 3 — Project Details (optional) ──────────────────────────────────────

function Step3ProjectDetails({
  formData,
  setFormData,
}: {
  formData: WizardFormData
  setFormData: React.Dispatch<React.SetStateAction<WizardFormData>>
}) {
  return (
    <FullPageFormSection
      title="Project Details"
      subtitle="Optional space and requirement details — you can skip this step"
      columns={2}
    >
      <ProjectDetailsFields
        values={formData}
        onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
      />
    </FullPageFormSection>
  )
}

// ─── Step 4 — Assign Team ─────────────────────────────────────────────────────

function Step4Team({
  formData,
  setFormData,
  allUsers,
  managers,
  getRoleLabel,
  errors,
}: {
  formData: WizardFormData
  setFormData: React.Dispatch<React.SetStateAction<WizardFormData>>
  allUsers: User[]
  managers: User[]
  getRoleLabel: (roleId: string) => string
  errors: StepErrors
}) {
  const teamOptions = allUsers.filter(
    (u) => u.status === 'active' && u.id !== formData.projectManagerId,
  )

  function resolveUserDisplayName(userId: string, fallbackName?: string): string {
    const fromManagers = managers.find((m) => m.id === userId)?.name?.trim()
    if (fromManagers) return fromManagers
    const fromTeam = allUsers.find((u) => u.id === userId)?.name?.trim()
    if (fromTeam) return fromTeam
    const stored = fallbackName?.trim()
    if (stored && stored !== userId) return stored
    return 'Selected user'
  }

  function resolveRoleChipLabel(roleId: string): string | null {
    const label = getRoleLabel(roleId)?.trim()
    if (!label || label === roleId) return null
    return label
  }

  return (
    <FullPageFormSection
      title="Team"
      subtitle="Select a project lead, then assign additional team members"
      columns={2}
    >
      <FormField label="Project Lead" required error={errors.projectManagerId}>
        <FormControl fullWidth size="small" error={Boolean(errors.projectManagerId)} sx={{ minWidth: 0 }}>
          <MuiSelect
            value={formData.projectManagerId}
            onChange={(e) => {
              const mgr = managers.find((m) => m.id === e.target.value)
              setFormData((prev) => ({
                ...prev,
                projectManagerId: e.target.value,
                projectManagerName: mgr?.name ?? '',
                teamMembers: prev.teamMembers.filter((m) => m.id !== e.target.value),
              }))
            }}
            displayEmpty
            fullWidth
            MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
            sx={{ fontSize: 13 }}
            renderValue={(val) => {
              if (!val) {
                return (
                  <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>
                    {managers.length === 0 ? 'No project leads available…' : 'Select project lead…'}
                  </Typography>
                )
              }
              const displayName = resolveUserDisplayName(val, formData.projectManagerName)
              return (
                <Stack direction="row" alignItems="center" gap={1}>
                  <PersonOutline sx={{ fontSize: 14 }} />
                  <Typography sx={{ fontSize: 13 }}>{displayName}</Typography>
                </Stack>
              )
            }}
          >
            <MenuItem value="" sx={{ fontSize: 13 }}>
              Select project lead…
            </MenuItem>
            {managers.map((m) => {
              const roleLabel = resolveRoleChipLabel(m.role)
              return (
                <MenuItem key={m.id} value={m.id} sx={{ fontSize: 13, gap: 1 }}>
                  <PersonOutline sx={{ fontSize: 14 }} />
                  {m.name}
                  {roleLabel ? (
                    <MuiChip
                      label={roleLabel}
                      size="small"
                      sx={{ height: 16, fontSize: 10, ml: 'auto', '& .MuiChip-label': { px: '6px' } }}
                    />
                  ) : null}
                </MenuItem>
              )
            })}
          </MuiSelect>
        </FormControl>
      </FormField>

      <FormField label="Add Team Members">
        <Autocomplete
          multiple
          size="small"
          options={teamOptions}
          disabled={!formData.projectManagerId}
          getOptionLabel={(u) => u.name}
          value={formData.teamMembers}
          onChange={(_, val) =>
            setFormData((prev) => ({ ...prev, teamMembers: val }))
          }
          renderOption={(props, option) => {
            const roleLabel = resolveRoleChipLabel(option.role)
            return (
            <Box component="li" {...props} sx={{ gap: 1 }}>
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  bgcolor: alpha(getAvatarColor(option.name).bg, 0.15),
                  color: getAvatarColor(option.name).text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {getInitials(option.name)}
              </Box>
              <Box>
                <Typography sx={{ fontSize: 13 }}>{option.name}</Typography>
              </Box>
              {roleLabel ? (
                <MuiChip
                  label={roleLabel}
                  size="small"
                  sx={{ height: 16, fontSize: 10, ml: 'auto', '& .MuiChip-label': { px: '6px' } }}
                />
              ) : null}
            </Box>
            )
          }}
          renderTags={(selected, getTagProps) =>
            selected.map((option, index) => (
              <MuiChip
                {...getTagProps({ index })}
                key={option.id}
                label={option.name}
                size="small"
                avatar={
                  <Box
                    sx={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      bgcolor: alpha(getAvatarColor(option.name).bg, 0.25),
                      color: getAvatarColor(option.name).bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '9px',
                      fontWeight: 700,
                    }}
                  >
                    {getInitials(option.name)}
                  </Box>
                }
                sx={{ height: 24, fontSize: 12 }}
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={
                formData.projectManagerId ? 'Search users…' : 'Select a project lead first…'
              }
              sx={{ '& input': { fontSize: 13 } }}
            />
          )}
        />
      </FormField>

      {formData.teamMembers.length > 0 && (
        <Box
          sx={{
            gridColumn: '1 / -1',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
            gap: 2,
          }}
        >
          {formData.teamMembers.map((member) => (
            <Box
              key={member.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: '10px 12px',
                border: `1px solid ${tokens.color.neutral[100]}`,
                borderRadius: '8px',
              }}
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: alpha(getAvatarColor(member.name).bg, 0.15),
                  color: getAvatarColor(member.name).text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {getInitials(member.name)}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}
                >
                  {member.name}
                </Typography>
              </Box>
              <MuiButton
                size="small"
                variant="text"
                sx={{ minWidth: 0, p: '2px 6px', fontSize: 11, color: 'text.secondary' }}
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    teamMembers: prev.teamMembers.filter((m) => m.id !== member.id),
                  }))
                }
              >
                ✕
              </MuiButton>
            </Box>
          ))}
        </Box>
      )}
    </FullPageFormSection>
  )
}

// ─── CreateProjectPage ────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Customer', description: 'Select client' },
  { label: 'Project Setup', description: 'Basic details' },
  { label: 'Project Details', description: 'Space & requirements' },
  { label: 'Team', description: 'Assign users' },
]

const INITIAL_FORM: WizardFormData = {
  customerId: '',
  customerName: '',
  contactIds: [],
  vendorId: '',
  vendorIds: [],
  vendorContactIds: [],
  name: '',
  projectTypes: [],
  sector: '',
  startDate: '',
  expectedEndDate: '',
  workstations: '',
  cabins: '',
  meetingRooms: '',
  services: '',
  supportFunction: '',
  location: '',
  address: '',
  city: '',
  state: '',
  country: 'India',
  pincode: '',
  carpetArea: '',
  buildValuePerSqft: '',
  designFeePerSqft: '',
  headcount: '',
  workstationSize: '',
  meetingRoomCount: '',
  serverRoomDetails: '',
  upsCapacity: '',
  receptionDetails: '',
  pantryDetails: '',
  requirementFile: null,
  requirementNotes: '',
  projectManagerId: '',
  projectManagerName: '',
  teamMembers: [],
  finalLayoutDescription: '',
  finalLayoutLink: '',
  finalRcpDescription: '',
  finalRcpLink: '',
  finalViewsDescription: '',
  finalViewsLink: '',
  finalPhotographsDescription: '',
  finalPhotographsLink: '',
  finalHandoverDescription: '',
  finalHandoverLink: '',
  finalLayoutFile: null,
  finalRcpFile: null,
  finalViewsFile: null,
  finalPhotographsFile: null,
  finalHandoverFiles: [],
}

export default function CreateProjectPage() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const toast = useToast()

  const customers = useAppSelector((s) => s.customers.items ?? [])
  const loadingCustomers = useAppSelector((s) => s.customers.loading)
  const users = useAppSelector((s) => s.users.items ?? [])
  const roles = useAppSelector((s) => s.roles.items ?? [])
  const saving = useAppSelector((s) => s.projects.saving)
  const statuses = useAppSelector((s) => s.settings.statuses)
  const defaultProgress =
    statuses.find((s) => s.status === 'active')?.name ?? 'Execution Ongoing'

  const [activeStep, setActiveStep] = useState(0)
  const [formData, setFormData] = useState<WizardFormData>(INITIAL_FORM)
  const [errors, setErrors] = useState<StepErrors>({})
  const [projectLeadUsers, setProjectLeadUsers] = useState<User[]>([])

  useEffect(() => {
    dispatch(fetchCustomers({}))
    // Explicit limit so Project Lead/Team options are not limited to a prior Users-page page size.
    dispatch(fetchUsers({ limit: 100 }))
    dispatch(fetchRoles({ limit: 100 }))
    dispatch(fetchVendors({ pageSize: 500 }))
    dispatch(fetchSectors())
    dispatch(fetchStatuses())

    // Dedicated Project Lead options via existing users API role filter (same source as before).
    let cancelled = false
    void usersApi
      .getAll({ limit: 100, status: 'active', role: PROJECT_LEAD_ROLE_KEY })
      .then((response) => {
        if (cancelled) return
        const envelope = response.data as { data?: unknown }
        const raw = normalizeArrayResponse(unwrapApiData(envelope) ?? envelope)
        setProjectLeadUsers(
          raw
            .map((row) => toUiUser(row as Parameters<typeof toUiUser>[0]))
            .filter((u) => u.status === 'active'),
        )
      })
      .catch(() => {
        if (!cancelled) setProjectLeadUsers([])
      })
    return () => {
      cancelled = true
    }
  }, [dispatch])

  const managersFromUsers = useMemo(
    () => users.filter((u) => u.status === 'active' && isProjectLeadRole(u.role, roles)),
    [users, roles],
  )
  /** Prefer role-filtered fetch; fall back to client-side filter of the shared users list. */
  const managers = projectLeadUsers.length > 0 ? projectLeadUsers : managersFromUsers
  const activeUsers = useMemo(() => users.filter((u) => u.status === 'active'), [users])

  function getRoleLabel(roleId: string) {
    return roles.find((r) => r.id === roleId)?.name ?? ''
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validateStep(step: number): boolean {
    const newErrors: StepErrors = {}

    if (step === 0) {
      if (!formData.customerId) newErrors.customerId = 'Please select a customer'
      if (formData.contactIds.length === 0) {
        newErrors.contactId = 'Please select at least one contact person'
      }
      // Vendor + vendor contacts are optional; contacts without a vendor are invalid.
      if (formData.vendorIds.length === 0 && formData.vendorContactIds.length > 0) {
        newErrors.vendorId = 'Vendor is required when vendor contacts are selected'
      }
    }
    if (step === 1) {
      Object.assign(newErrors, validateProjectSetupForm(formData))
    }
    // Step 2 (Project Details) is fully optional — no required validation
    if (step === 3 && !formData.projectManagerId) {
      newErrors.projectManagerId = 'Project lead is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleNext() {
    if (validateStep(activeStep)) {
      setActiveStep((s) => s + 1)
    }
  }

  function handleBack() {
    setActiveStep((s) => s - 1)
    setErrors({})
  }

  async function handleSubmit() {
    if (!validateStep(activeStep)) return

    const customer = customers.find((c) => c.id === formData.customerId) ?? null
    const selectedContacts = findContactsByIds(customer, formData.contactIds)
    const location = formatAddressLine({
      address: formData.address,
      city: formData.city,
      state: formData.state,
      pincode: formData.pincode,
      country: formData.country,
    })
    const payload = {
      customerId: formData.customerId,
      customerName: formData.customerName,
      contactIds: formData.contactIds,
      vendorIds: formData.vendorIds,
      vendorId: formData.vendorIds[0] ?? formData.vendorId,
      vendorContactIds: formData.vendorContactIds,
      name: formData.name,
      location,
      address: formData.address.trim(),
      city: formData.city.trim(),
      state: formData.state.trim(),
      country: formData.country.trim(),
      pincode: formData.pincode.trim(),
      projectTypes: formData.projectTypes,
      sector: formData.sector,
      carpetArea: formData.carpetArea ? Number(formData.carpetArea) : null,
      buildValuePerSqft: formData.buildValuePerSqft ? Number(formData.buildValuePerSqft) : null,
      designFeePerSqft: formData.designFeePerSqft ? Number(formData.designFeePerSqft) : null,
      ...buildProjectSetupPayload(formData),
      clientTeam: clientTeamFromContacts(selectedContacts, formData.customerName),
      projectManagerId: formData.projectManagerId,
      projectManager: formData.projectManagerName,
      assignedTeam: buildAssignedTeamPayload(
        formData.projectManagerId,
        formData.projectManagerName,
        formData.teamMembers.filter((m) => m.status === 'active'),
        getRoleLabel,
      ),
      startDate: formData.startDate || null,
      expectedEndDate: formData.expectedEndDate || null,
      status: 'Pitch' as const,
      progress: defaultProgress,
      projectValue: 0,
      totalClientPOValue: 0,
      totalVendorPOValue: 0,
      invoicedAmount: 0,
      paidVendorAmount: 0,
      projectDocuments: buildProjectDocumentsFromForm(formData),
    }

    try {
      const result = await dispatch(createProject(payload)).unwrap()
      toast.success('Project created successfully')
      navigate(`/projects/${result.id}`)
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : 'Failed to create project'
      toast.error(message)
    }
  }

  // ── Render step content ───────────────────────────────────────────────────

  function renderStep() {
    switch (activeStep) {
      case 0:
        return (
          <Step1Customer
            formData={formData}
            setFormData={setFormData}
            customers={customers}
            loadingCustomers={loadingCustomers}
            errors={errors}
            setErrors={setErrors}
          />
        )
      case 1:
        return (
          <Step2ProjectSetup
            formData={formData}
            setFormData={setFormData}
            errors={errors}
          />
        )
      case 2:
        return (
          <Step3ProjectDetails
            formData={formData}
            setFormData={setFormData}
          />
        )
      case 3:
        return (
          <Step4Team
            formData={formData}
            setFormData={setFormData}
            allUsers={activeUsers}
            managers={managers}
            getRoleLabel={getRoleLabel}
            errors={errors}
          />
        )
      default:
        return null
    }
  }

  const stepTitles = [
    'Who is the client?',
    'Set up the project',
    'Project details',
    'Build the team',
  ]

  const stepSubtitles = [
    'Select the customer and one or more contact persons for this project.',
    'Enter the basic project information to continue.',
    'Add optional space and requirement details, or skip this step.',
    'Choose a project lead, then add team members who will work on this project.',
  ]

  return (
    <FullPageForm
      moduleName="Projects"
      moduleHref="/projects"
      actionName="Create Project"
      title={stepTitles[activeStep]}
      subtitle={stepSubtitles[activeStep]}
      steps={STEPS}
      activeStep={activeStep}
      onCancel={() => navigate('/projects')}
      onBack={handleBack}
      onNext={handleNext}
      onSubmit={handleSubmit}
      isLastStep={activeStep === STEPS.length - 1}
      submitLoading={saving}
      submitLabel="Create Project"
    >
      {renderStep()}
    </FullPageForm>
  )
}
