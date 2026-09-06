import { describe, expect, it } from 'vitest'
import type { Contact } from '@/slices/customers/reducer'
import { normalizeVendorContactsForSelect } from './vendorContacts'

describe('normalizeVendorContactsForSelect', () => {
  it('dedupes by contact id', () => {
    const contacts: Contact[] = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Ada',
        phone: '9876543210',
        email: 'a@b.com',
        designation: '',
        isPrimary: true,
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Ada Dup',
        phone: '9876543210',
        email: 'a@b.com',
        designation: '',
        isPrimary: false,
      },
    ]
    expect(normalizeVendorContactsForSelect(contacts)).toHaveLength(1)
  })

  it('drops legacy-primary when a persisted UUID contact exists', () => {
    const contacts: Contact[] = [
      {
        id: 'legacy-primary',
        name: 'Ada',
        phone: '9876543210',
        email: 'a@b.com',
        designation: '',
        isPrimary: true,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        name: 'Ada',
        phone: '9876543210',
        email: 'a@b.com',
        designation: '',
        isPrimary: true,
      },
    ]
    const result = normalizeVendorContactsForSelect(contacts)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('keeps legacy-primary when it is the only option', () => {
    const contacts: Contact[] = [
      {
        id: 'legacy-primary',
        name: 'Ada',
        phone: '9876543210',
        email: 'a@b.com',
        designation: '',
        isPrimary: true,
      },
    ]
    expect(normalizeVendorContactsForSelect(contacts)).toHaveLength(1)
  })
})
