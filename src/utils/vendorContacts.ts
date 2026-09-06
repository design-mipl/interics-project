import type { Contact } from '../slices/customers/reducer'
import type { Vendor } from '../slices/vendors/reducer'
import {
  legacyContactsFromEntity,
  getEntityContactsList,
  normalizeContacts,
  primaryFieldsFromPrimaryContact,
  type PrimaryContactFields,
} from './entityContacts'

export { normalizeContacts } from './entityContacts'

export function legacyContactsFromVendor(vendor: Vendor): Contact[] {
  return legacyContactsFromEntity(vendor)
}

export function getVendorContactsList(vendor: Vendor): Contact[] {
  return getEntityContactsList(vendor)
}

/**
 * Single normalization point for vendor Contact Person dropdown options.
 * Dedupes by stable contact id. Drops synthetic `legacy-primary` when any
 * persisted UUID contact is present (list refresh often recreates legacy rows
 * while create responses already include the real contact).
 */
export function normalizeVendorContactsForSelect(contacts: Contact[]): Contact[] {
  const byId = new Map<string, Contact>()
  for (const contact of contacts) {
    if (!contact.id) continue
    byId.set(contact.id, contact)
  }
  const unique = Array.from(byId.values())
  const hasPersisted = unique.some(
    (c) =>
      c.id !== 'legacy-primary' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        c.id,
      ),
  )
  if (!hasPersisted) return unique
  return unique.filter((c) => c.id !== 'legacy-primary')
}

/** Primary for listing/overview (matches Customer pattern naming). */
export function getPrimaryContact(vendor: Vendor): Contact | undefined {
  const normalized = normalizeContacts(getVendorContactsList(vendor))
  return normalized.find((c) => c.isPrimary) ?? normalized[0]
}

export function primaryFieldsFromVendor(primary: Contact | undefined): Pick<
  Vendor,
  'contactPerson' | 'phone' | 'email' | 'designation'
> {
  const f: PrimaryContactFields = primaryFieldsFromPrimaryContact(primary)
  return {
    contactPerson: f.contactPerson,
    phone: f.phone,
    email: f.email,
    designation: f.designation,
  }
}
