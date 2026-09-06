import {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import {
  Autocomplete,
  Box,
  TextField,
  FormControl,
  Select as MuiSelect,
  MenuItem,
  Divider,
  ListSubheader,
  Button as MuiButton,
  Stack,
  Typography,
} from '@mui/material'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  createCustomerContact,
  updateCustomerContact,
} from '@/slices/customers/thunk'
import {
  createVendorContact,
  updateVendorContact,
  fetchVendors,
  fetchVendorById,
} from '@/slices/vendors/thunk'
import type { Contact } from '@/slices/customers/reducer'
import type { ContactInfo } from '@/slices/projects/reducer'
import type { Vendor } from '@/slices/vendors/reducer'
import { Button, Modal, useToast } from '@/design-system/components'
import { DrawerForm } from '@/components/templates'
import { getVendorContactsList, normalizeVendorContactsForSelect } from '@/utils/vendorContacts'
import { isActiveVendorContact, isPendingVendor } from '@/utils/vendorProfileStatus'
import {
  contactPhoneExists,
  normalizePhoneNumber,
  isPersistedContactId,
  type ProjectContactSource,
} from '../projectCreateHelpers'
import {
  filterContacts,
  renderContactAutocompleteOption,
} from './ContactPersonAutocomplete'
import { QuickAddVendorModal } from './QuickAddVendorModal'
import { parseSettingsApiError } from '@/modules/system-settings/shared/api-errors'
import { isValidIndianMobileDigits, MOBILE_VALIDATION_MESSAGE, sanitizeMobileInput } from '@/utils/mobile'
import { validateAddNewPersonForm } from '../createContactPersonValidation'

interface CreateContactPersonModalProps {
  open: boolean
  onClose: () => void
  customerId: string
  /** When set, linked vendors are resolved for this project (and customer). */
  projectId?: string
  existingCustomerContacts: Contact[]
  /** Prefill Contact Type when the drawer opens. */
  initialContactType?: ProjectContactSource
  /** Called only when a customer contact is saved (added to project dropdown). */
  onSaved?: (contact: Contact) => void
  /** Called after any contact is saved — for assigning to project client team. */
  onAssigned?: (info: ContactInfo) => void | Promise<void>
}

export interface VendorOption {
  id: string
  label: string
}

interface FormState {
  contactType: ProjectContactSource
  vendorId: string
  selectedContactId: string
  name: string
  phone: string
  email: string
  designation: string
}

interface FormErrors {
  contactType?: string
  vendor?: string
  selectedContactId?: string
  name?: string
  phone?: string
  email?: string
}

export interface NewPersonForm {
  name: string
  phone: string
  email: string
  designation: string
}

function phoneDigits(value: string): string {
  return sanitizeMobileInput(value)
}

const EMPTY_FORM: FormState = {
  contactType: 'customer',
  vendorId: '',
  selectedContactId: '',
  name: '',
  phone: '',
  email: '',
  designation: '',
}

const EMPTY_NEW_PERSON: NewPersonForm = {
  name: '',
  phone: '',
  email: '',
  designation: '',
}

const CONTACT_TYPE_OPTIONS: { value: ProjectContactSource; label: string }[] = [
  { value: 'customer', label: 'Client Contact' },
  { value: 'vendor', label: 'Vendor Contact' },
]

function contactDetailsFrom(contact: Contact): Pick<
  FormState,
  'name' | 'phone' | 'email' | 'designation'
> {
  return {
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    designation: contact.designation,
  }
}

function clearContactDetails(): Pick<
  FormState,
  'selectedContactId' | 'name' | 'phone' | 'email' | 'designation'
> {
  return {
    selectedContactId: '',
    name: '',
    phone: '',
    email: '',
    designation: '',
  }
}

function mergeContactsById(base: Contact[], extras: Contact[]): Contact[] {
  const map = new Map<string, Contact>()
  for (const c of base) map.set(c.id, c)
  for (const c of extras) map.set(c.id, c)
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Vendor dropdown options: id-dedupe + drop legacy-primary when real contacts exist. */
function mergeVendorContactsForSelect(base: Contact[], extras: Contact[]): Contact[] {
  return normalizeVendorContactsForSelect(mergeContactsById(base, extras)).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

function validateForm(
  form: FormState,
  existingCustomerContacts: Contact[],
  existingVendorContacts: Contact[],
  existingVendorPhones: string[],
): FormErrors {
  const errors: FormErrors = {}
  if (!form.contactType) errors.contactType = 'Contact type is required'

  if (form.contactType === 'vendor' && !form.vendorId.trim()) {
    errors.vendor = 'Vendor is required.'
  }

  if (!form.selectedContactId.trim()) {
    errors.selectedContactId = 'Select a contact person'
  }

  const trimmedPhone = form.phone.trim()
  if (!trimmedPhone) {
    errors.phone = 'Mobile number is required.'
  } else if (!isValidIndianMobileDigits(trimmedPhone)) {
    errors.phone = MOBILE_VALIDATION_MESSAGE
  } else {
    const peers =
      form.contactType === 'vendor'
        ? existingVendorContacts
        : existingCustomerContacts
    const others = peers.filter((c) => c.id !== form.selectedContactId)
    const phoneTaken = contactPhoneExists(others, trimmedPhone)

    if (form.contactType === 'vendor') {
      const vendorPhoneTaken = existingVendorPhones.some(
        (p) =>
          normalizePhoneNumber(p) === normalizePhoneNumber(trimmedPhone) &&
          normalizePhoneNumber(p) !==
            normalizePhoneNumber(
              peers.find((c) => c.id === form.selectedContactId)?.phone ?? '',
            ),
      )
      if (phoneTaken || vendorPhoneTaken) {
        errors.phone = 'A contact with this mobile number already exists.'
      }
    } else if (phoneTaken) {
      errors.phone =
        'A contact with this mobile number already exists for this customer.'
    }
  }

  return errors
}

function validateNewPerson(
  form: NewPersonForm,
  peers: Contact[],
  existingVendorPhones: string[],
  isVendor: boolean,
): Partial<Record<keyof NewPersonForm, string>> {
  return validateAddNewPersonForm(form, peers, existingVendorPhones, isVendor)
}

export function CreateContactPersonModal({
  open,
  onClose,
  customerId,
  projectId: _projectId,
  existingCustomerContacts,
  initialContactType = 'customer',
  onSaved,
  onAssigned,
}: CreateContactPersonModalProps) {
  const dispatch = useAppDispatch()
  const { showToast } = useToast()
  const vendors = useAppSelector((s) => s.vendors.items ?? [])
  const vendorsLoading = useAppSelector((s) => s.vendors.loading)

  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    contactType: initialContactType,
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [addVendorOpen, setAddVendorOpen] = useState(false)
  const [addPersonOpen, setAddPersonOpen] = useState(false)
  const [localCustomerContacts, setLocalCustomerContacts] = useState<Contact[]>([])
  const [localVendorContacts, setLocalVendorContacts] = useState<Contact[]>([])

  const activeVendorOptions = useMemo<VendorOption[]>(
    () =>
      vendors
        // Active + inactive vendors (Pending Contacts uses profileStatus, not isActive).
        .filter(
          (v) =>
            (v.status === 'Active' && isActiveVendorContact(v)) ||
            v.status === 'Inactive' ||
            isPendingVendor(v),
        )
        .map((v) => ({ id: v.id, label: v.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [vendors],
  )

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === form.vendorId) ?? null,
    [vendors, form.vendorId],
  )

  const existingVendorContacts = useMemo(
    () =>
      selectedVendor
        ? normalizeVendorContactsForSelect(getVendorContactsList(selectedVendor))
        : [],
    [selectedVendor],
  )

  const selectableContacts = useMemo(() => {
    if (form.contactType === 'vendor') {
      return mergeVendorContactsForSelect(existingVendorContacts, localVendorContacts)
    }
    return mergeContactsById(existingCustomerContacts, localCustomerContacts)
  }, [
    form.contactType,
    existingVendorContacts,
    existingCustomerContacts,
    localVendorContacts,
    localCustomerContacts,
  ])

  const selectedContact = useMemo(
    () =>
      selectableContacts.find((c) => c.id === form.selectedContactId) ?? null,
    [selectableContacts, form.selectedContactId],
  )

  const existingVendorPhones = useMemo(
    () => vendors.map((v) => v.phone.trim()).filter(Boolean),
    [vendors],
  )

  const showVendorField = form.contactType === 'vendor'
  const showContactPersonField = !showVendorField || Boolean(form.vendorId)

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_FORM, contactType: initialContactType })
      setErrors({})
      setSaving(false)
      setAddVendorOpen(false)
      setAddPersonOpen(false)
      setLocalCustomerContacts([])
      setLocalVendorContacts([])
      return
    }

    setForm({
      ...EMPTY_FORM,
      contactType: initialContactType,
    })
    setLocalCustomerContacts([])
    setLocalVendorContacts([])

    void dispatch(
      fetchVendors({
        pageSize: 500,
      }),
    )
  }, [open, dispatch, initialContactType])

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }

      if (key === 'contactType') {
        next.vendorId = ''
        Object.assign(next, clearContactDetails())
        setLocalVendorContacts([])
      }

      if (key === 'vendorId') {
        Object.assign(next, clearContactDetails())
        setLocalVendorContacts([])
      }

      return next
    })

    setErrors((prev) => {
      const cleared = { ...prev }
      delete cleared[key as keyof FormErrors]
      if (key === 'contactType' || key === 'vendorId') {
        delete cleared.vendor
        delete cleared.selectedContactId
        delete cleared.name
        delete cleared.phone
        delete cleared.email
      }
      return cleared
    })
  }

  function applySelectedContact(contact: Contact) {
    setForm((prev) => ({
      ...prev,
      selectedContactId: contact.id,
      ...contactDetailsFrom(contact),
    }))
    setErrors((prev) => ({
      ...prev,
      selectedContactId: undefined,
      name: undefined,
      phone: undefined,
      email: undefined,
    }))
  }

  function handleSelectExistingContact(contact: Contact | null) {
    if (!contact) {
      setForm((prev) => ({ ...prev, ...clearContactDetails() }))
      setErrors((prev) => ({ ...prev, selectedContactId: undefined }))
      return
    }
    applySelectedContact(contact)
  }

  async function refreshVendors() {
    await dispatch(
      fetchVendors({
        pageSize: 500,
      }),
    )
  }

  async function loadVendorDetail(vendorId: string): Promise<Vendor | null> {
    try {
      return await dispatch(fetchVendorById(vendorId)).unwrap()
    } catch {
      return null
    }
  }

  function selectVendorAndPrimaryContact(vendor: Vendor) {
    const contacts = normalizeVendorContactsForSelect(getVendorContactsList(vendor)).filter((c) =>
      isPersistedContactId(c.id),
    )
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null

    setForm((prev) => ({
      ...prev,
      contactType: 'vendor',
      vendorId: vendor.id,
      ...(primary
        ? { selectedContactId: primary.id, ...contactDetailsFrom(primary) }
        : clearContactDetails()),
    }))
    // Contacts already live on the vendor — do not mirror into local extras
    // (avoids duplicating with legacy-primary after a list refresh).
    setLocalVendorContacts([])
    setErrors({})
  }

  function detailsChangedFromOriginal(original: Contact): boolean {
    return (
      form.phone.trim() !== original.phone.trim() ||
      form.email.trim() !== original.email.trim() ||
      form.designation.trim() !== original.designation.trim()
    )
  }

  async function handleCreateNewPerson(person: NewPersonForm): Promise<boolean> {
    const peers =
      form.contactType === 'vendor'
        ? selectableContacts
        : mergeContactsById(existingCustomerContacts, localCustomerContacts)
    const personErrors = validateNewPerson(
      person,
      peers,
      existingVendorPhones,
      form.contactType === 'vendor',
    )
    if (Object.keys(personErrors).length > 0) {
      return false
    }

    const payload = {
      name: person.name.trim(),
      phone: phoneDigits(person.phone),
      email: person.email.trim(),
      designation: person.designation.trim(),
    }

    try {
      if (form.contactType === 'customer') {
        const result = await dispatch(
          createCustomerContact({
            customerId,
            data: {
              ...payload,
              isPrimary: selectableContacts.length === 0,
            },
          }),
        ).unwrap()
        setLocalCustomerContacts((prev) => mergeContactsById(prev, [result.contact]))
        applySelectedContact(result.contact)
        onSaved?.(result.contact)
      } else {
        const vendor = selectedVendor
        if (!vendor) {
          setErrors((prev) => ({ ...prev, vendor: 'Vendor is required.' }))
          return false
        }
        const result = await dispatch(
          createVendorContact({
            vendorId: vendor.id,
            data: {
              ...payload,
              isPrimary: selectableContacts.length === 0,
            },
          }),
        ).unwrap()
        // Prefer detail reload over list refresh so contacts[] stays authoritative.
        const detail = await loadVendorDetail(vendor.id)
        if (detail) {
          setLocalVendorContacts([])
        } else {
          setLocalVendorContacts((prev) =>
            mergeVendorContactsForSelect(prev, [result.contact]),
          )
        }
        applySelectedContact(result.contact)
      }

      showToast({ title: 'Contact person created', variant: 'success' })
      setAddPersonOpen(false)
      return true
    } catch (err: unknown) {
      const message =
        typeof err === 'string' ? err : 'Failed to create contact person'
      showToast({ title: message, variant: 'error' })
      return false
    }
  }

  async function handleSave() {
    const allCustomerPeers = mergeContactsById(
      existingCustomerContacts,
      localCustomerContacts,
    )
    const allVendorPeers = mergeVendorContactsForSelect(
      existingVendorContacts,
      localVendorContacts,
    )
    const nextErrors = validateForm(
      form,
      allCustomerPeers,
      allVendorPeers,
      existingVendorPhones,
    )
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const payload = {
      name: form.name.trim(),
      phone: phoneDigits(form.phone),
      email: form.email.trim(),
      designation: form.designation.trim(),
    }

    try {
      setSaving(true)

      let assigned: ContactInfo = {
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        designation: payload.designation,
      }

      if (form.contactType === 'customer') {
        let contact: Contact

        if (selectedContact) {
          if (detailsChangedFromOriginal(selectedContact)) {
            const result = await dispatch(
              updateCustomerContact({
                customerId,
                contactId: selectedContact.id,
                data: {
                  phone: payload.phone,
                  email: payload.email,
                  designation: payload.designation,
                },
              }),
            ).unwrap()
            contact = result.contact
          } else {
            contact = selectedContact
          }
        } else {
          setErrors((prev) => ({
            ...prev,
            selectedContactId: 'Select a contact person',
          }))
          return
        }

        onSaved?.(contact)
        assigned = {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          designation: contact.designation,
          source: 'customer',
        }
      } else {
        const vendor = selectedVendor
        if (!vendor) {
          setErrors((prev) => ({ ...prev, vendor: 'Vendor is required.' }))
          return
        }

        // Authoritative vendor contacts — list rows can be stale right after QuickAdd.
        const detail = (await loadVendorDetail(vendor.id)) ?? vendor
        const vendorContacts = mergeVendorContactsForSelect(
          normalizeVendorContactsForSelect(getVendorContactsList(detail)),
          localVendorContacts,
        ).filter((c) => isPersistedContactId(c.id))

        let contact: Contact | null =
          vendorContacts.find((c) => c.id === form.selectedContactId) ?? null

        if (!contact && selectedContact && isPersistedContactId(selectedContact.id)) {
          contact = vendorContacts.find((c) => c.id === selectedContact.id) ?? null
        }

        if (!contact && form.phone.trim()) {
          const phoneKey = normalizePhoneNumber(form.phone)
          contact =
            vendorContacts.find(
              (c) => normalizePhoneNumber(c.phone) === phoneKey && phoneKey.length > 0,
            ) ?? null
        }

        if (!contact) {
          setErrors((prev) => ({
            ...prev,
            selectedContactId:
              'Selected contact is not available for this vendor yet. Re-select the contact and try again.',
            vendor: 'Vendor contacts may still be loading. Re-select the vendor if needed.',
          }))
          return
        }

        if (contact.id !== 'legacy-primary' && detailsChangedFromOriginal(contact)) {
          const result = await dispatch(
            updateVendorContact({
              vendorId: detail.id,
              contactId: contact.id,
              data: {
                phone: payload.phone,
                email: payload.email,
                designation: payload.designation,
              },
            }),
          ).unwrap()
          contact = result.contact
        } else {
          contact = {
            ...contact,
            phone: payload.phone,
            email: payload.email,
            designation: payload.designation,
          }
        }

        if (!isPersistedContactId(contact.id)) {
          setErrors((prev) => ({
            ...prev,
            selectedContactId: 'Select a saved vendor contact before assigning to the project.',
          }))
          return
        }

        assigned = {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          designation: contact.designation,
          company: detail.name,
          source: 'vendor',
          vendorId: detail.id,
        }
      }

      await onAssigned?.(assigned)
      showToast({ title: 'Contact person saved', variant: 'success' })
      onClose()
    } catch (err: unknown) {
      const parsed = parseSettingsApiError(err, 'Failed to save contact person')
      setErrors((prev) => ({
        ...prev,
        phone: parsed.fieldErrors.phone ?? parsed.fieldErrors.mobile ?? prev.phone,
        email: parsed.fieldErrors.email ?? prev.email,
      }))
      showToast({ title: parsed.message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DrawerForm
        open={open}
        onClose={onClose}
        title="Add Contact Person"
        subtitle="Add a contact for this project"
        onSubmit={() => void handleSave()}
        submitLabel="Save Contact"
        cancelLabel="Cancel"
        submitLoading={saving}
        width={480}
        disableEnforceFocus={addVendorOpen || addPersonOpen}
      >
        <Box display="flex" flexDirection="column" gap={1.5}>
          <SelectField
            label="Contact Type"
            required
            value={form.contactType}
            onChange={(v) => setField('contactType', v as ProjectContactSource)}
            error={errors.contactType}
            options={CONTACT_TYPE_OPTIONS}
          />

          {showVendorField ? (
            <VendorSelectField
              value={form.vendorId}
              options={activeVendorOptions}
              onChange={(vendorId) => setField('vendorId', vendorId)}
              onAddNewVendor={() => setAddVendorOpen(true)}
              error={errors.vendor}
              loading={vendorsLoading}
              required
            />
          ) : null}

          {showContactPersonField ? (
            <>
              <ContactPersonSelectField
                contacts={selectableContacts}
                value={selectedContact}
                onChange={handleSelectExistingContact}
                onAddNewPerson={() => setAddPersonOpen(true)}
                error={errors.selectedContactId}
              />

              {selectedContact ? (
                <Box
                  display="grid"
                  sx={{
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                  }}
                >
                  <TypographyField
                    label="Mobile Number"
                    required
                    value={form.phone}
                    onChange={(v) => setField('phone', phoneDigits(v))}
                    error={errors.phone}
                    placeholder="9876543210"
                  />
                  <TypographyField
                    label="Email Address"
                    value={form.email}
                    onChange={(v) => setField('email', v)}
                    error={errors.email}
                    placeholder="name@company.com"
                  />
                  <Box sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }}>
                    <TypographyField
                      label="Designation"
                      value={form.designation}
                      onChange={(v) => setField('designation', v)}
                      placeholder="e.g. Managing Director"
                    />
                  </Box>
                </Box>
              ) : null}
            </>
          ) : null}
        </Box>
      </DrawerForm>

      <AddNewPersonModal
        open={addPersonOpen}
        onClose={() => setAddPersonOpen(false)}
        onSave={handleCreateNewPerson}
        peers={selectableContacts}
        existingVendorPhones={existingVendorPhones}
        isVendor={form.contactType === 'vendor'}
      />

      <QuickAddVendorModal
        open={addVendorOpen}
        onClose={() => setAddVendorOpen(false)}
        onCreated={(vendor) => {
          void (async () => {
            await refreshVendors()
            // Detail merge restores real contact UUIDs after list refresh drops contacts[].
            const detail = (await loadVendorDetail(vendor.id)) ?? vendor
            selectVendorAndPrimaryContact(detail)
            setAddVendorOpen(false)
          })()
        }}
      />
    </>
  )
}

interface ContactListboxProps extends HTMLAttributes<HTMLUListElement> {
  children?: ReactNode
  onAddNewPerson?: () => void
}

const ContactPersonListbox = forwardRef<HTMLUListElement, ContactListboxProps>(
  function ContactPersonListbox({ children, onAddNewPerson, ...props }, ref) {
    return (
      <ul ref={ref} {...props} style={{ ...props.style, padding: 0, margin: 0 }}>
        {children}
        {onAddNewPerson ? (
          <>
            <Divider component="li" sx={{ my: 0.5, listStyle: 'none' }} />
            <Box component="li" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              <MuiButton
                fullWidth
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onAddNewPerson()
                }}
                sx={{
                  justifyContent: 'flex-start',
                  px: 2,
                  py: 1,
                  fontSize: 13,
                  textTransform: 'none',
                  fontWeight: 600,
                  color: 'primary.main',
                }}
              >
                + Add New Person
              </MuiButton>
            </Box>
          </>
        ) : null}
      </ul>
    )
  },
)

function ContactPersonSelectField({
  contacts,
  value,
  onChange,
  onAddNewPerson,
  error,
}: {
  contacts: Contact[]
  value: Contact | null
  onChange: (contact: Contact | null) => void
  onAddNewPerson: () => void
  error?: string
}) {
  const ListboxWithCreate = useMemo(
    () =>
      forwardRef<HTMLUListElement, HTMLAttributes<HTMLUListElement>>(
        function Listbox(listboxProps, ref) {
          return (
            <ContactPersonListbox
              {...listboxProps}
              ref={ref}
              onAddNewPerson={onAddNewPerson}
            />
          )
        },
      ),
    [onAddNewPerson],
  )

  return (
    <Box>
      <FieldLabel label="Contact Person" required />
      <Autocomplete
        fullWidth
        size="small"
        options={contacts}
        filterOptions={filterContacts}
        getOptionLabel={(c) => c.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        value={value}
        onChange={(_, contact) => onChange(contact)}
        renderOption={renderContactAutocompleteOption}
        noOptionsText="No contacts found"
        slots={{ listbox: ListboxWithCreate }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Search by name…"
            error={Boolean(error)}
            helperText={error}
            sx={{ '& input': { fontSize: 13 } }}
          />
        )}
      />
    </Box>
  )
}

export function AddNewPersonModal({
  open,
  onClose,
  onSave,
  peers,
  existingVendorPhones,
  isVendor,
}: {
  open: boolean
  onClose: () => void
  onSave: (person: NewPersonForm) => Promise<boolean>
  peers: Contact[]
  existingVendorPhones: string[]
  isVendor: boolean
}) {
  const [form, setForm] = useState<NewPersonForm>(EMPTY_NEW_PERSON)
  const [errors, setErrors] = useState<Partial<Record<keyof NewPersonForm, string>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_NEW_PERSON)
    setErrors({})
    setSaving(false)
  }, [open])

  function setField<K extends keyof NewPersonForm>(key: K, value: NewPersonForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  async function handleSave() {
    const nextErrors = validateNewPerson(form, peers, existingVendorPhones, isVendor)
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setSaving(true)
    try {
      const ok = await onSave(form)
      if (!ok) {
        const revalidate = validateNewPerson(form, peers, existingVendorPhones, isVendor)
        if (Object.keys(revalidate).length > 0) setErrors(revalidate)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add New Person"
      size="sm"
      loading={saving}
      footer={
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ width: 1 }}>
          <Button
            variant="outlined"
            color="secondary"
            size="sm"
            label="Cancel"
            onClick={onClose}
            disabled={saving}
          />
          <Button
            variant="contained"
            color="primary"
            size="sm"
            label={saving ? 'Saving…' : 'Save'}
            onClick={() => void handleSave()}
            disabled={saving}
          />
        </Stack>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Create a contact without leaving this drawer.
      </Typography>
      <Box
        display="grid"
        sx={{ gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}
      >
        <Box sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }}>
          <TypographyField
            label="Contact Person Name"
            required
            value={form.name}
            onChange={(v) => setField('name', v)}
            error={errors.name}
            placeholder="Full name"
          />
        </Box>
        <TypographyField
          label="Mobile Number"
          required
          value={form.phone}
          onChange={(v) => setField('phone', phoneDigits(v))}
          error={errors.phone}
          placeholder="9876543210"
        />
        <TypographyField
          label="Email Address"
          value={form.email}
          onChange={(v) => setField('email', v)}
          error={errors.email}
          placeholder="name@company.com"
        />
        <Box sx={{ gridColumn: { xs: '1', sm: '1 / -1' } }}>
          <TypographyField
            label="Designation"
            value={form.designation}
            onChange={(v) => setField('designation', v)}
            placeholder="e.g. Managing Director"
          />
        </Box>
      </Box>
    </Modal>
  )
}

function FieldLabel({
  label,
  required,
}: {
  label: string
  required?: boolean
}) {
  return (
    <Box
      component="span"
      sx={{ fontWeight: 500, display: 'block', mb: '4px', fontSize: 12 }}
    >
      {label}
      {required ? (
        <Box component="span" sx={{ color: 'error.main' }}>
          {' '}
          *
        </Box>
      ) : null}
    </Box>
  )
}

function TypographyField({
  label,
  required,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
}) {
  return (
    <Box>
      <FieldLabel label={label} required={required} />
      <TextField
        fullWidth
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        error={Boolean(error)}
        helperText={error}
        sx={{ '& input': { fontSize: 13 } }}
      />
    </Box>
  )
}

function SelectField({
  label,
  required,
  value,
  onChange,
  error,
  options,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  error?: string
  options: { value: string; label: string }[]
}) {
  return (
    <Box>
      <FieldLabel label={label} required={required} />
      <FormControl fullWidth size="small" error={Boolean(error)}>
        <MuiSelect
          value={value}
          onChange={(e) => onChange(e.target.value)}
          displayEmpty
          sx={{ fontSize: 13, minHeight: 40 }}
        >
          {options.map((opt) => (
            <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: 13 }}>
              {opt.label}
            </MenuItem>
          ))}
        </MuiSelect>
        {error ? (
          <Box component="span" sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
            {error}
          </Box>
        ) : null}
      </FormControl>
    </Box>
  )
}

const ADD_VENDOR_VALUE = '__add_new_vendor__'

export function VendorSelectField({
  value,
  options,
  onChange,
  onAddNewVendor,
  error,
  loading,
  required = false,
}: {
  value: string
  options: VendorOption[]
  onChange: (vendorId: string) => void
  onAddNewVendor?: () => void
  error?: string
  loading?: boolean
  required?: boolean
}) {
  const selectedLabel = options.find((opt) => opt.id === value)?.label

  function openAddNewVendor() {
    // Defer so the Select menu can close before the create-vendor UI opens
    // (same QuickAddVendorModal path as Create Project).
    queueMicrotask(() => onAddNewVendor?.())
  }

  return (
    <Box>
      <FieldLabel label="Vendor" required={required} />
      <FormControl fullWidth size="small" error={Boolean(error)}>
        <MuiSelect
          value={value}
          displayEmpty
          disabled={loading}
          onChange={(e) => {
            const next = e.target.value
            if (next === ADD_VENDOR_VALUE) {
              openAddNewVendor()
              return
            }
            onChange(next)
          }}
          renderValue={(selected) => {
            if (!selected || selected === ADD_VENDOR_VALUE) {
              return (
                <Box component="span" sx={{ color: 'text.secondary', fontSize: 13 }}>
                  {loading ? 'Loading vendors…' : 'Select vendor…'}
                </Box>
              )
            }
            return (
              <Box component="span" sx={{ fontSize: 13 }}>
                {selectedLabel ?? selected}
              </Box>
            )
          }}
          sx={{ fontSize: 13, minHeight: 40 }}
          MenuProps={{
            PaperProps: {
              sx: { maxHeight: 320 },
            },
          }}
        >
          {[
            ...(options.length === 0
              ? [
                  <MenuItem key="__empty__" disabled sx={{ fontSize: 13 }}>
                    {loading ? 'Loading…' : 'No vendors found'}
                  </MenuItem>,
                ]
              : [
                  ...(!required
                    ? [
                        <MenuItem
                          key="__none__"
                          value=""
                          sx={{ fontSize: 13, color: 'text.secondary' }}
                        >
                          No vendor
                        </MenuItem>,
                      ]
                    : []),
                  ...options.map((opt) => (
                    <MenuItem key={opt.id} value={opt.id} sx={{ fontSize: 13 }}>
                      {opt.label}
                    </MenuItem>
                  )),
                ]),
            ...(onAddNewVendor
              ? [
                  <ListSubheader key="__add_vendor_divider__" sx={{ lineHeight: '8px', height: 8, p: 0 }}>
                    <Divider />
                  </ListSubheader>,
                  <MenuItem
                    key="__add_new_vendor__"
                    value={ADD_VENDOR_VALUE}
                    onClick={(e) => {
                      e.preventDefault()
                      openAddNewVendor()
                    }}
                    sx={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'primary.main',
                    }}
                  >
                    + Add New Vendor
                  </MenuItem>,
                ]
              : []),
          ]}
        </MuiSelect>
        {error ? (
          <Box component="span" sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
            {error}
          </Box>
        ) : null}
      </FormControl>
    </Box>
  )
}
