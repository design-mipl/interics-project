import { describe, expect, it } from 'vitest'
import type { VendorPO } from '@/slices/baseline/reducer'
import type { Baseline } from '@/slices/baseline/reducer'
import type { PitchCategory } from '@/slices/pitch/reducer'
import type { Expense } from '@/slices/live/types'
import {
  computeCommonExpenseAllocations,
  computeCommonExpenseAllocationsWithSelection,
  computeExpenseShareAllocations,
  expenseSharePercent,
  getBuildVendorsFromPOs,
  resolveCommonExpenseAllocations,
  resolveLiveBuildVendors,
  servicesForVendorLinkedExpense,
  vendorPoContractualValue,
} from './expenseFormUtils'
import {
  commonExpenseAmountForVendor,
  commonExpenseInvoiceDeduction,
} from '@/utils/commonExpenseDeduction'

function makePo(
  overrides: Partial<VendorPO> & Pick<VendorPO, 'vendorId' | 'vendorName' | 'poValue'>,
): VendorPO {
  return {
    id: overrides.id ?? `po-${overrides.vendorId}`,
    projectId: overrides.projectId ?? 'project-1',
    poNumber: overrides.poNumber ?? 'PO-1',
    poDate: overrides.poDate ?? '2026-01-01',
    milestones: overrides.milestones ?? [],
    status: overrides.status ?? 'Issued',
    ...overrides,
  }
}

const POS_ABC = [
  makePo({ vendorId: 'v-a', vendorName: 'Vendor A', poValue: 50 }),
  makePo({ vendorId: 'v-b', vendorName: 'Vendor B', poValue: 25 }),
  makePo({ vendorId: 'v-c', vendorName: 'Vendor C', poValue: 25 }),
]

function rowMap(rows: ReturnType<typeof computeExpenseShareAllocations>) {
  return Object.fromEntries(
    rows.map((r) => [
      r.vendorId,
      {
        poRatio: r.allocationPercent,
        amount: r.allocationAmount,
        includedInRecovery: r.includedInRecovery,
      },
    ]),
  )
}

function expenseFromRows(amount: number, rows: ReturnType<typeof computeExpenseShareAllocations>): Expense {
  return {
    id: 'exp-1',
    projectId: 'project-1',
    type: 'common',
    description: 'Common expense',
    amount,
    date: '2026-01-01',
    status: 'pending',
    vendorAllocations: rows,
  }
}

describe('vendorPoContractualValue', () => {
  it('uses poValue and ignores executedValue', () => {
    expect(vendorPoContractualValue({ poValue: 50 })).toBe(50)
    expect(
      vendorPoContractualValue({
        poValue: 50,
        executedValue: 80,
      } as Pick<VendorPO, 'poValue'>),
    ).toBe(50)
  })
})

describe('PO Ratio (unchanged)', () => {
  it('splits 50/25/25 PO weights when all vendors participate on ₹10,000', () => {
    const rows = computeCommonExpenseAllocations(10_000, POS_ABC, 'proportional_po')
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(50)
    expect(map['v-b']?.poRatio).toBe(25)
    expect(map['v-c']?.poRatio).toBe(25)
    expect(map['v-a']?.amount).toBe(5000)
    expect(map['v-b']?.amount).toBe(2500)
    expect(map['v-c']?.amount).toBe(2500)
    expect(rows.reduce((s, r) => s + r.allocationAmount, 0)).toBe(10_000)
  })

  it('keeps PO Ratio unchanged when selection changes', () => {
    const all = rowMap(
      computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
        'v-a',
        'v-b',
        'v-c',
      ]),
    )
    const ab = rowMap(
      computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
        'v-a',
        'v-b',
      ]),
    )
    const aOnly = rowMap(
      computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', ['v-a']),
    )

    expect(ab['v-a']?.poRatio).toBe(50)
    expect(ab['v-b']?.poRatio).toBe(25)
    expect(ab['v-c']?.poRatio).toBe(25)
    expect(aOnly['v-a']?.poRatio).toBe(50)
    expect(aOnly['v-b']?.poRatio).toBe(25)
    expect(aOnly['v-c']?.poRatio).toBe(25)
    expect(all['v-a']?.poRatio).toBe(50)
  })
})

describe('Expense Share (normalized among selected vendors)', () => {
  it('A+B selected: PO Ratio 50/25/25, Expense Share 67/33/0 on ₹1,000', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-a',
      'v-b',
    ])
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(50)
    expect(map['v-b']?.poRatio).toBe(25)
    expect(map['v-c']?.poRatio).toBe(25)
    expect(map['v-a']?.amount).toBe(670)
    expect(map['v-b']?.amount).toBe(330)
    expect(map['v-c']?.amount).toBe(0)
    expect(expenseSharePercent(map['v-a']!.amount, 1000)).toBe(67)
    expect(expenseSharePercent(map['v-b']!.amount, 1000)).toBe(33)
    expect(rows.reduce((s, r) => s + r.allocationAmount, 0)).toBe(1000)
  })

  it('A only selected: PO Ratio A=50%, Expense Share A=100%', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-a',
    ])
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(50)
    expect(map['v-b']?.poRatio).toBe(25)
    expect(map['v-c']?.poRatio).toBe(25)
    expect(map['v-a']?.amount).toBe(1000)
    expect(expenseSharePercent(map['v-a']!.amount, 1000)).toBe(100)
  })

  it('all selected: Expense Share matches PO Ratio amounts', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(10_000, POS_ABC, 'proportional_po', [
      'v-a',
      'v-b',
      'v-c',
    ])
    const map = rowMap(rows)

    expect(map['v-a']).toMatchObject({ poRatio: 50, amount: 5000 })
    expect(map['v-b']).toMatchObject({ poRatio: 25, amount: 2500 })
    expect(map['v-c']).toMatchObject({ poRatio: 25, amount: 2500 })
  })

  it('B+C selected: PO Ratio 50/25/25, Expense Share B=50%, C=50%', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-b',
      'v-c',
    ])
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(50)
    expect(map['v-b']?.poRatio).toBe(25)
    expect(map['v-c']?.poRatio).toBe(25)
    expect(map['v-b']?.amount).toBe(500)
    expect(map['v-c']?.amount).toBe(500)
    expect(expenseSharePercent(map['v-b']!.amount, 1000)).toBe(50)
    expect(expenseSharePercent(map['v-c']!.amount, 1000)).toBe(50)
  })

  it('A+C selected: Expense Share 67/33/0', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-a',
      'v-c',
    ])
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(50)
    expect(map['v-c']?.poRatio).toBe(25)
    expect(map['v-a']?.amount).toBe(670)
    expect(map['v-c']?.amount).toBe(330)
  })

  it('sums multiple POs per vendor before expense share (67/33)', () => {
    const pos = [
      makePo({ id: 'po-a1', vendorId: 'v-a', vendorName: 'Vendor A', poValue: 30 }),
      makePo({ id: 'po-a2', vendorId: 'v-a', vendorName: 'Vendor A', poValue: 20 }),
      makePo({ id: 'po-b1', vendorId: 'v-b', vendorName: 'Vendor B', poValue: 25 }),
    ]
    const rows = computeCommonExpenseAllocationsWithSelection(10_000, pos, 'proportional_po', [
      'v-a',
      'v-b',
    ])
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(67)
    expect(map['v-b']?.poRatio).toBe(33)
    expect(map['v-a']?.amount).toBe(6700)
    expect(map['v-b']?.amount).toBe(3300)
  })

  it('zero PO vendor keeps PO Ratio 0 and Expense Share 0 when selected with others', () => {
    const pos = [
      makePo({ vendorId: 'v-a', vendorName: 'Vendor A', poValue: 100 }),
      makePo({ vendorId: 'v-z', vendorName: 'Vendor Zero', poValue: 0 }),
    ]
    const rows = computeCommonExpenseAllocationsWithSelection(1000, pos, 'proportional_po', [
      'v-a',
      'v-z',
    ])
    const map = rowMap(rows)

    expect(map['v-a']?.poRatio).toBe(100)
    expect(map['v-z']?.poRatio).toBe(0)
    expect(map['v-a']?.amount).toBe(1000)
    expect(map['v-z']?.amount).toBe(0)
  })

  it('returns zero expense shares when no vendors are selected', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [])
    expect(rows.every((r) => r.allocationAmount === 0)).toBe(true)
    expect(rows.map((r) => r.allocationPercent)).toEqual([50, 25, 25])
  })
})

describe('getBuildVendorsFromPOs', () => {
  it('sums contractual poValue across multiple POs per vendor', () => {
    const vendors = getBuildVendorsFromPOs([
      makePo({ id: 'po-a1', vendorId: 'v-a', vendorName: 'Vendor A', poValue: 30 }),
      makePo({ id: 'po-a2', vendorId: 'v-a', vendorName: 'Vendor A', poValue: 20, executedValue: 99 }),
      makePo({ id: 'po-b1', vendorId: 'v-b', vendorName: 'Vendor B', poValue: 25 }),
    ])
    expect(vendors.find((v) => v.vendorId === 'v-a')?.poSum).toBe(50)
    expect(vendors.find((v) => v.vendorId === 'v-b')?.poSum).toBe(25)
  })
})

describe('resolveCommonExpenseAllocations edit preservation', () => {
  it('preserves stored expense shares when amount and selection are unchanged', () => {
    const buildVendors = getBuildVendorsFromPOs(POS_ABC)
    const stored = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-a',
      'v-b',
    ])

    const rows = resolveCommonExpenseAllocations({
      amount: 1000,
      buildVendors,
      projectVendorPOs: POS_ABC,
      selectedVendorIds: ['v-a', 'v-b'],
      method: 'proportional_po',
      preserveWhenUnchanged: {
        amount: 1000,
        selectedVendorIds: ['v-a', 'v-b'],
        vendorAllocations: stored,
      },
    })

    expect(rows).toEqual(stored)
  })
})

describe('commonExpenseInvoiceDeduction', () => {
  it('uses Expense Share (allocationAmount), not PO Ratio amount', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-a',
      'v-b',
    ])
    const expense = expenseFromRows(1000, rows)

    expect(commonExpenseAmountForVendor(expense, 'v-a')).toBe(670)
    expect(commonExpenseAmountForVendor(expense, 'v-b')).toBe(330)
    expect(commonExpenseInvoiceDeduction(expense, 'v-a')).toBe(670)
    expect(commonExpenseInvoiceDeduction(expense, 'v-b')).toBe(330)
    expect(commonExpenseInvoiceDeduction(expense, 'v-c')).toBe(0)
  })

  it('does not deduct PO-ratio amounts (₹500/₹250) when A+B selected on ₹1,000', () => {
    const rows = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', [
      'v-a',
      'v-b',
    ])
    const expense = expenseFromRows(1000, rows)

    expect(commonExpenseInvoiceDeduction(expense, 'v-a')).not.toBe(500)
    expect(commonExpenseInvoiceDeduction(expense, 'v-b')).not.toBe(250)
  })
})

describe('shared Finance and Project Live entry point', () => {
  it('produces identical allocation for same PO data and selection', () => {
    const selected = ['v-a', 'v-b']
    const a = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', selected)
    const b = computeCommonExpenseAllocationsWithSelection(1000, POS_ABC, 'proportional_po', selected)
    expect(a).toEqual(b)
  })
})

describe('resolveLiveBuildVendors', () => {
  const baselineWithMappings = {
    id: 'b1',
    projectId: 'project-1',
    categories: [
      {
        id: 'c1',
        categoryId: 'cat-1',
        categoryName: 'Build',
        totalValue: 100,
        services: [
          {
            id: 'svc-baseline-1',
            name: 'Civil',
            subcategoryId: 'master-civil',
            subcategoryName: 'Civil Works',
            customName: null,
            value: 100,
            clientMilestones: [],
            vendorMappings: [
              { id: 'm1', vendorId: 'v-map', vendorName: 'Mapped Vendor', value: 40 },
            ],
            milestonesTotal: 0,
          },
        ],
      },
    ],
  } as unknown as Baseline

  it('uses Vendor POs when present', () => {
    const vendors = resolveLiveBuildVendors(POS_ABC, baselineWithMappings)
    expect(vendors.map((v) => v.vendorId).sort()).toEqual(['v-a', 'v-b', 'v-c'])
  })

  it('falls back to baseline vendorMappings when no POs', () => {
    const vendors = resolveLiveBuildVendors([], baselineWithMappings)
    expect(vendors).toEqual([
      { vendorId: 'v-map', vendorName: 'Mapped Vendor', poSum: 40 },
    ])
  })
})

describe('servicesForVendorLinkedExpense', () => {
  const baseline = {
    id: 'b1',
    projectId: 'project-1',
    categories: [
      {
        id: 'c1',
        categoryId: 'cat-1',
        categoryName: 'Build',
        totalValue: 200,
        services: [
          {
            id: 'svc-baseline-1',
            name: 'Civil',
            subcategoryId: 'master-civil',
            subcategoryName: 'Civil Works',
            customName: null,
            value: 100,
            clientMilestones: [],
            vendorMappings: [
              { id: 'm1', vendorId: 'v-a', vendorName: 'Vendor A', value: 40 },
            ],
            milestonesTotal: 0,
          },
          {
            id: 'svc-baseline-2',
            name: 'MEP',
            subcategoryId: 'master-mep',
            subcategoryName: 'MEP',
            customName: null,
            value: 100,
            clientMilestones: [],
            vendorMappings: [],
            milestonesTotal: 0,
          },
        ],
      },
    ],
  } as unknown as Baseline

  it('matches PO linked ids via subcategoryId (master id)', () => {
    const pos = [
      makePo({
        vendorId: 'v-b',
        vendorName: 'Vendor B',
        poValue: 50,
        linkedBaselineServiceIds: ['master-mep'],
      }),
    ]
    const options = servicesForVendorLinkedExpense(baseline, 'v-b', pos)
    expect(options.map((o) => o.baselineServiceId)).toEqual(['svc-baseline-2'])
  })

  it('includes services with vendorMappings for the selected vendor', () => {
    const options = servicesForVendorLinkedExpense(baseline, 'v-a', [])
    expect(options.map((o) => o.baselineServiceId)).toEqual(['svc-baseline-1'])
    expect(options[0]?.name).toBe('Civil Works')
  })

  it('returns all services when no vendor is selected', () => {
    const options = servicesForVendorLinkedExpense(baseline, '', [])
    expect(options.map((o) => o.baselineServiceId)).toEqual([
      'svc-baseline-1',
      'svc-baseline-2',
    ])
  })

  it('resolves services via linkedVendorMappingId and milestone.serviceId', () => {
    const pos = [
      makePo({
        vendorId: 'v-c',
        vendorName: 'Vendor C',
        poValue: 10,
        linkedBaselineServiceIds: [],
        linkedVendorMappingId: 'm1',
        milestones: [
          {
            id: 'ms-1',
            name: 'M1',
            percentage: 100,
            value: 10,
            dueDate: null,
            status: 'Pending',
            serviceId: 'master-mep',
          },
        ],
      }),
    ]
    const options = servicesForVendorLinkedExpense(baseline, 'v-c', pos)
    expect(options.map((o) => o.baselineServiceId).sort()).toEqual([
      'svc-baseline-1',
      'svc-baseline-2',
    ])
  })

  it('uses pitch categories as a fallback catalog for vendor mappings', () => {
    const pitchOnlyCategories = [
      {
        id: 'pc1',
        categoryId: 'cat-1',
        categoryName: 'Build',
        totalValue: 50,
        services: [
          {
            id: 'pitch-svc-9',
            name: 'Joinery',
            subcategoryId: 'master-joinery',
            subcategoryName: 'Joinery',
            customName: null,
            value: 50,
            clientMilestones: [],
            vendorMappings: [
              { id: 'm9', vendorId: 'v-pitch', vendorName: 'Pitch Vendor', value: 50 },
            ],
            milestonesTotal: 0,
          },
        ],
      },
    ]
    const options = servicesForVendorLinkedExpense(
      null,
      'v-pitch',
      [],
      pitchOnlyCategories as unknown as PitchCategory[],
    )
    expect(options.map((o) => o.baselineServiceId)).toEqual(['pitch-svc-9'])
    expect(options.map((o) => o.name)).toEqual(['Joinery'])
  })

  it('never shows unresolved raw service ids as dropdown options', () => {
    const pos = [
      makePo({
        vendorId: 'v-z',
        vendorName: 'Vendor Z',
        poValue: 1,
        linkedBaselineServiceIds: ['orphan-service-id', '1c776b1f-ebc0-4e9b-94a9-8e4758482b46'],
      }),
    ]
    const options = servicesForVendorLinkedExpense(null, 'v-z', pos)
    expect(options).toEqual([])
  })

  it('skips services whose only labels are raw ids', () => {
    const idOnlyBaseline = {
      id: 'b1',
      projectId: 'project-1',
      categories: [
        {
          id: 'c1',
          categoryId: 'cat-1',
          categoryName: 'Build',
          totalValue: 10,
          services: [
            {
              id: '1c776b1f-ebc0-4e9b-94a9-8e4758482b46',
              name: '1c776b1f-ebc0-4e9b-94a9-8e4758482b46',
              subcategoryId: 'master-x',
              subcategoryName: null,
              customName: null,
              value: 10,
              clientMilestones: [],
              vendorMappings: [
                { id: 'm-x', vendorId: 'v-x', vendorName: 'Vendor X', value: 10 },
              ],
              milestonesTotal: 0,
            },
          ],
        },
      ],
    } as unknown as Baseline

    expect(servicesForVendorLinkedExpense(idOnlyBaseline, 'v-x', [])).toEqual([])
  })
})
