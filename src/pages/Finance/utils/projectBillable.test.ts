import { describe, expect, it } from 'vitest'
import type { ClientPO } from '@/slices/baseline/reducer'
import type { Invoice } from '@/slices/receivables/reducer'
import {
  flattenClientPoMilestones,
  sumBilledPerBaselineService,
  countSelectedMilestonesWithZeroRemaining,
  remainingMilestoneValue,
  resolveServiceForLine,
  sacCodeForService,
} from './projectBillable'

const po: ClientPO = {
  id: 'po-1',
  projectId: 'p-1',
  poNumber: 'PO-001',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  poValue: 100000,
  documentUrl: null,
  milestones: [
    {
      id: 'ms-1',
      serviceId: 'svc-1',
      serviceName: 'Interior Design',
      name: 'Design deposit',
      percentage: 40,
      value: 40000,
      kind: 'regular',
      retention: { percentage: 10, value: 10000 },
    },
    {
      id: 'cli-ret-2',
      serviceId: 'svc-1',
      serviceName: 'Interior Design',
      name: 'Retention',
      percentage: 10,
      value: 10000,
      kind: 'retention',
    },
  ],
}

describe('flattenClientPoMilestones', () => {
  it('returns PO milestones including regular retention split rows', () => {
    const rows = flattenClientPoMilestones(po)
    expect(rows.map((r) => r.milestoneId)).toEqual(['ms-1', 'ms-1-retention', 'cli-ret-2'])
    expect(rows[0]?.value).toBe(40000)
    expect(rows[1]?.milestoneName).toBe('Design deposit — Retention')
  })

  it('returns an empty list when no PO is selected', () => {
    expect(flattenClientPoMilestones(null)).toEqual([])
  })
})

describe('sumBilledPerBaselineService', () => {
  it('counts milestone-sourced invoice lines toward service billing totals', () => {
    const invoices: Invoice[] = [
      {
        id: 'inv-1',
        invoiceNo: 'INV-1',
        clientId: 'c-1',
        clientName: 'Acme',
        projectId: 'p-1',
        projectName: 'HQ Fitout',
        invoiceDate: '2026-08-01',
        dueDate: '2026-08-31',
        lineItems: [
          {
            id: 'li-1',
            serviceId: 'svc-1',
            serviceName: 'Interior Design',
            sacCode: '',
            amount: 40000,
            gstRate: 18,
            gstAmount: 7200,
            milestoneId: 'ms-1',
            baselineServiceId: 'svc-1',
            lineSource: 'milestone',
          },
        ],
        baseAmount: 40000,
        gstAmount: 7200,
        totalAmount: 47200,
        tdsDeducted: 0,
        totalReceived: 0,
        balance: 47200,
        status: 'sent',
        payments: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]

    expect(sumBilledPerBaselineService(invoices, 'p-1').get('svc-1')).toBe(40000)
  })
})

describe('resolveServiceForLine', () => {
  it('maps pitch/baseline service id to Service Master via subcategoryId', () => {
    const baseline = {
      id: 'b1',
      projectId: 'p-1',
      version: 1,
      createdAt: '2026-01-01',
      categories: [
        {
          id: 'cat-1',
          categoryName: 'Design',
          services: [
            {
              id: 'pitch-astro',
              name: 'Astro',
              subcategoryId: 'master-astro',
              subcategoryName: 'Astro',
              gstRate: 18,
              value: 1000,
            },
          ],
        },
      ],
    } as unknown as import('@/slices/baseline/reducer').Baseline

    const services = [
      {
        id: 'master-astro',
        name: 'Astro',
        categoryId: 'cat-1',
        sacCodeId: 'sac-1',
        sacCode: '991932',
        gstRate: 18,
        allowGSTOverride: false,
        allowVendorMapping: false,
        tags: [],
        status: 'active' as const,
      },
    ]

    const resolved = resolveServiceForLine('pitch-astro', 'Astro', services, baseline)
    expect(resolved?.id).toBe('master-astro')
    expect(sacCodeForService([], resolved)).toBe('991932')
  })
})

describe('countSelectedMilestonesWithZeroRemaining', () => {
  it('returns count of selected milestones with no remaining billable amount', () => {
    const rows = flattenClientPoMilestones(po)
    const billed = new Map([['ms-1', 40000]])
    expect(countSelectedMilestonesWithZeroRemaining(['ms-1', 'cli-ret-2'], rows, billed)).toBe(1)
    expect(remainingMilestoneValue(40000, 40000)).toBe(0)
  })
})
