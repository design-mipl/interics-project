import type { VendorPO } from '@/slices/baseline/reducer'
import type { Baseline } from '@/slices/baseline/reducer'
import type { PitchCategory, PitchService } from '@/slices/pitch/reducer'

/** Contractual PO value for common-expense ratio weights (ignores executedValue). */
export function vendorPoContractualValue(po: Pick<VendorPO, 'poValue'>): number {
  return po.poValue
}

export type CommonExpenseSplitMethod = 'proportional_po' | 'equal'

export interface CommonExpenseAllocation {
  vendorId: string
  vendorName: string
  allocationPercent: number
  allocationAmount: number
  includedInRecovery?: boolean
}

export function findServiceInBaseline(baseline: Baseline | null, serviceId: string): PitchService | undefined {
  if (!baseline || !serviceId.trim()) return undefined
  for (const cat of baseline.categories) {
    const s = cat.services.find(
      (svc) => svc.id === serviceId || svc.subcategoryId === serviceId,
    )
    if (s) return s
  }
  return undefined
}

export type BuildVendorWeight = { vendorId: string; vendorName: string; poSum: number }

/** Unique build vendors mapped on the project via vendor POs. */
export function getBuildVendorsFromPOs(
  projectVendorPOs: VendorPO[],
): BuildVendorWeight[] {
  const byVendor = new Map<string, { vendorName: string; poSum: number }>()
  for (const po of projectVendorPOs) {
    if (!po.vendorId) continue
    const cur = byVendor.get(po.vendorId) ?? { vendorName: po.vendorName, poSum: 0 }
    cur.poSum += vendorPoContractualValue(po)
    if (po.vendorName) cur.vendorName = po.vendorName
    byVendor.set(po.vendorId, cur)
  }
  return [...byVendor.entries()]
    .map(([vendorId, v]) => ({
      vendorId,
      vendorName: v.vendorName,
      poSum: v.poSum,
    }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
}

/**
 * Build vendors from baseline pitch vendorMappings (fallback when Live Vendor POs
 * are not yet created for the project).
 */
export function getBuildVendorsFromBaseline(baseline: Baseline | null): BuildVendorWeight[] {
  if (!baseline) return []
  const byVendor = new Map<string, { vendorName: string; poSum: number }>()
  for (const cat of baseline.categories ?? []) {
    for (const svc of cat.services ?? []) {
      for (const mapping of svc.vendorMappings ?? []) {
        if (!mapping.vendorId) continue
        const cur = byVendor.get(mapping.vendorId) ?? {
          vendorName: mapping.vendorName || 'Vendor',
          poSum: 0,
        }
        cur.poSum += Number(mapping.value) || 0
        if (mapping.vendorName) cur.vendorName = mapping.vendorName
        byVendor.set(mapping.vendorId, cur)
      }
    }
  }
  return [...byVendor.entries()]
    .map(([vendorId, v]) => ({
      vendorId,
      vendorName: v.vendorName,
      poSum: v.poSum,
    }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
}

/** Prefer Vendor POs; fall back to baseline vendorMappings so Paid By / Vendor Linked stay usable. */
export function resolveLiveBuildVendors(
  projectVendorPOs: VendorPO[],
  baseline: Baseline | null,
): BuildVendorWeight[] {
  const fromPos = getBuildVendorsFromPOs(projectVendorPOs)
  if (fromPos.length > 0) return fromPos
  return getBuildVendorsFromBaseline(baseline)
}

export type VendorLinkedServiceOption = {
  baselineServiceId: string
  name: string
  adjustedValue: number
}

const RAW_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** True when a label is empty or looks like a stored id (UUID), not a service name. */
export function looksLikeServiceIdLabel(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return true
  if (RAW_ID_RE.test(trimmed)) return true
  return false
}

function pitchServiceDisplayName(svc: PitchService): string | null {
  const candidates = [svc.subcategoryName, svc.name, svc.customName]
  for (const candidate of candidates) {
    const label = (candidate ?? '').trim()
    if (!label || looksLikeServiceIdLabel(label)) continue
    if (label === svc.id || label === svc.subcategoryId) continue
    return label
  }
  return null
}

function serviceMatchesLinkedId(svc: PitchService, linkedId: string): boolean {
  if (!linkedId) return false
  return (
    svc.id === linkedId ||
    svc.subcategoryId === linkedId ||
    (svc.customName != null && svc.customName === linkedId) ||
    (svc.name != null && svc.name === linkedId) ||
    (svc.subcategoryName != null && svc.subcategoryName === linkedId)
  )
}

/** Normalize PO linked-service payloads (array, single string, or JSON string). */
export function normalizeLinkedServiceIds(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value
      .map((id) => String(id ?? '').trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        return normalizeLinkedServiceIds(JSON.parse(trimmed) as unknown)
      } catch {
        return [trimmed]
      }
    }
    return [trimmed]
  }
  return []
}

function findServiceByLinkedId(
  categories: PitchCategory[],
  linkedId: string,
): PitchService | undefined {
  for (const cat of categories) {
    const hit = (cat.services ?? []).find((svc) => serviceMatchesLinkedId(svc, linkedId))
    if (hit) return hit
  }
  return undefined
}

function findServiceByVendorMappingId(
  categories: PitchCategory[],
  mappingId: string,
): PitchService | undefined {
  if (!mappingId.trim()) return undefined
  for (const cat of categories) {
    for (const svc of cat.services ?? []) {
      if ((svc.vendorMappings ?? []).some((m) => m.id === mappingId)) return svc
    }
  }
  return undefined
}

function collectVendorPoLinkedServiceIds(
  vendorId: string,
  projectVendorPOs: VendorPO[],
): string[] {
  const ids = new Set<string>()
  for (const po of projectVendorPOs) {
    if (po.vendorId !== vendorId) continue
    for (const id of normalizeLinkedServiceIds(po.linkedBaselineServiceIds)) {
      ids.add(id)
    }
    const mappingId = po.linkedVendorMappingId?.trim()
    if (mappingId) ids.add(`mapping:${mappingId}`)
    for (const milestone of po.milestones ?? []) {
      const mid = milestone.serviceId?.trim()
      if (mid) ids.add(mid)
    }
  }
  return [...ids]
}

function mergeCategoryCatalogs(
  baseline: Baseline | null,
  extraCategories?: PitchCategory[] | null,
): PitchCategory[] {
  const out: PitchCategory[] = []
  if (baseline?.categories?.length) out.push(...baseline.categories)
  if (extraCategories?.length) out.push(...extraCategories)
  return out
}

/**
 * Services provided by a vendor on the selected project.
 * Options only include resolved human-readable service names (never raw ids).
 */
export function servicesForVendorLinkedExpense(
  baseline: Baseline | null,
  vendorId: string,
  projectVendorPOs: VendorPO[],
  extraCategories?: PitchCategory[] | null,
): VendorLinkedServiceOption[] {
  const categories = mergeCategoryCatalogs(baseline, extraCategories)

  const toOption = (svc: PitchService): VendorLinkedServiceOption | null => {
    const name = pitchServiceDisplayName(svc)
    if (!name) return null
    return {
      baselineServiceId: svc.id,
      name,
      adjustedValue: svc.value,
    }
  }

  const out: VendorLinkedServiceOption[] = []
  const seen = new Set<string>()
  const pushResolved = (svc: PitchService | undefined) => {
    if (!svc || seen.has(svc.id)) return
    const option = toOption(svc)
    if (!option) return
    seen.add(svc.id)
    out.push(option)
  }

  if (!vendorId) {
    for (const cat of categories) {
      for (const svc of cat.services ?? []) {
        pushResolved(svc)
      }
    }
    return out
  }

  for (const token of collectVendorPoLinkedServiceIds(vendorId, projectVendorPOs)) {
    if (token.startsWith('mapping:')) {
      const mappingId = token.slice('mapping:'.length)
      pushResolved(findServiceByVendorMappingId(categories, mappingId))
      continue
    }
    pushResolved(findServiceByLinkedId(categories, token))
  }

  for (const cat of categories) {
    for (const svc of cat.services ?? []) {
      const mapped = (svc.vendorMappings ?? []).some((m) => m.vendorId === vendorId)
      if (mapped) pushResolved(svc)
    }
  }

  return out
}

function distributeRoundedAmounts(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  if (totalWeight <= 0 || weights.length === 0) return []

  const rawPct = weights.map((w) => (w / totalWeight) * 100)
  const floors = rawPct.map((p) => Math.floor(p))
  let rem = 100 - floors.reduce((a, b) => a + b, 0)
  const order = rawPct
    .map((p, i) => ({ i, frac: p - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
  const pct = [...floors]
  for (let k = 0; k < rem; k++) {
    const idx = order[k]?.i
    if (idx !== undefined) pct[idx] += 1
  }

  const roundedAmt = pct.map((p) => Math.round((amount * p) / 100))
  const target = Math.round(amount)
  const drift = target - roundedAmt.reduce((a, b) => a + b, 0)
  if (roundedAmt.length > 0) {
    roundedAmt[roundedAmt.length - 1] = (roundedAmt[roundedAmt.length - 1] ?? 0) + drift
  }
  return roundedAmt
}

export function computeEqualSplitAllocations(
  amount: number,
  vendors: { vendorId: string; vendorName: string }[],
): CommonExpenseAllocation[] {
  if (amount <= 0 || vendors.length === 0) return []
  const weights = vendors.map(() => 1)
  const amounts = distributeRoundedAmounts(amount, weights)
  const pctEach = Math.floor(100 / vendors.length)
  let rem = 100 - pctEach * vendors.length

  return vendors.map((v, i) => ({
    vendorId: v.vendorId,
    vendorName: v.vendorName,
    allocationPercent: pctEach + (i < rem ? 1 : 0),
    allocationAmount: amounts[i] ?? 0,
  }))
}

export interface WeightedVendor {
  vendorId: string
  vendorName: string
  weight: number
}

export function computeProportionalAllocations(
  amount: number,
  vendors: WeightedVendor[],
): CommonExpenseAllocation[] {
  if (amount <= 0 || vendors.length === 0) return []

  const amounts = distributeRoundedAmounts(
    amount,
    vendors.map((v) => v.weight),
  )
  const totalWeight = vendors.reduce((s, v) => s + v.weight, 0)
  if (totalWeight <= 0) return []

  const rawPct = vendors.map((v) => (v.weight / totalWeight) * 100)
  const floors = rawPct.map((p) => Math.floor(p))
  let rem = 100 - floors.reduce((a, b) => a + b, 0)
  const order = rawPct
    .map((p, i) => ({ i, frac: p - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
  const pct = [...floors]
  for (let k = 0; k < rem; k++) {
    const idx = order[k]?.i
    if (idx !== undefined) pct[idx] += 1
  }

  return vendors.map((v, i) => ({
    vendorId: v.vendorId,
    vendorName: v.vendorName,
    allocationPercent: pct[i] ?? 0,
    allocationAmount: amounts[i] ?? 0,
  }))
}

export function computeAllocationsForVendors(
  amount: number,
  vendors: WeightedVendor[],
  method: CommonExpenseSplitMethod,
): CommonExpenseAllocation[] {
  if (amount <= 0 || vendors.length === 0) return []
  if (method === 'equal') {
    return computeEqualSplitAllocations(amount, vendors)
  }
  return computeProportionalAllocations(amount, vendors)
}

export function sameVendorIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  return b.every((id) => setA.has(id))
}

/** Sum contractual PO weight for selected vendors only. */
export function selectedBuildVendorPoWeight(
  buildVendors: BuildVendorWeight[],
  selectedVendorIds: string[],
): number {
  const selected = new Set(selectedVendorIds)
  return buildVendors
    .filter((v) => selected.has(v.vendorId))
    .reduce((s, v) => s + v.poSum, 0)
}

/** Expense-share percentage derived from allocated amount (for display only). */
export function expenseSharePercent(allocationAmount: number, expenseAmount: number): number {
  if (expenseAmount <= 0) return 0
  return Math.round((allocationAmount / expenseAmount) * 100)
}

/**
 * Common-expense rows with fixed PO Ratio (all build vendors) and normalized Expense Share
 * (selected vendors only). allocationPercent = PO Ratio; allocationAmount = Expense Share.
 */
export function computeExpenseShareAllocations(
  amount: number,
  buildVendors: BuildVendorWeight[],
  method: CommonExpenseSplitMethod,
  selectedVendorIds: string[],
): CommonExpenseAllocation[] {
  if (buildVendors.length === 0) return []

  const weighted = buildVendors.map((v) => ({
    vendorId: v.vendorId,
    vendorName: v.vendorName,
    weight: v.poSum,
  }))

  // PO Ratio — unchanged: proportional across ALL build vendors.
  const poRatioRows = computeAllocationsForVendors(100, weighted, method)
  const poRatioById = new Map(poRatioRows.map((r) => [r.vendorId, r.allocationPercent]))

  const selectedSet = new Set(selectedVendorIds)
  const selected = buildVendors.filter((v) => selectedSet.has(v.vendorId))

  const expenseAmountById = new Map<string, number>()
  if (amount > 0 && selected.length > 0) {
    const selectedWeights = selected.map((v) => v.poSum)
    const totalSelectedWeight = selectedWeights.reduce((s, w) => s + w, 0)
    if (totalSelectedWeight > 0) {
      const amounts = distributeRoundedAmounts(amount, selectedWeights)
      selected.forEach((v, i) => {
        expenseAmountById.set(v.vendorId, amounts[i] ?? 0)
      })
    }
  }

  return buildVendors.map((v) => ({
    vendorId: v.vendorId,
    vendorName: v.vendorName,
    allocationPercent: poRatioById.get(v.vendorId) ?? 0,
    allocationAmount: selectedSet.has(v.vendorId) ? (expenseAmountById.get(v.vendorId) ?? 0) : 0,
    includedInRecovery: selectedSet.has(v.vendorId),
  }))
}

export function computeCommonAllocationsFromVendorPOs(
  amount: number,
  projectVendorPOs: VendorPO[],
): CommonExpenseAllocation[] {
  const vendors = getBuildVendorsFromPOs(projectVendorPOs)
  return computeProportionalAllocations(
    amount,
    vendors.map((v) => ({ vendorId: v.vendorId, vendorName: v.vendorName, weight: v.poSum })),
  )
}

/** PO Ratio + Expense Share when all build vendors participate (legacy/full-vendor path). */
export function computeCommonExpenseAllocations(
  amount: number,
  projectVendorPOs: VendorPO[],
  method: CommonExpenseSplitMethod,
): CommonExpenseAllocation[] {
  const vendorIds = getBuildVendorsFromPOs(projectVendorPOs).map((v) => v.vendorId)
  return computeCommonExpenseAllocationsWithSelection(amount, projectVendorPOs, method, vendorIds)
}

export function computeCommonExpenseAllocationsWithSelection(
  amount: number,
  projectVendorPOs: VendorPO[],
  method: CommonExpenseSplitMethod,
  selectedVendorIds: string[],
): CommonExpenseAllocation[] {
  return computeExpenseShareAllocations(
    amount,
    getBuildVendorsFromPOs(projectVendorPOs),
    method,
    selectedVendorIds,
  )
}

/** Preview/submit helper — preserves stored allocations on unchanged edit inputs. */
export function resolveCommonExpenseAllocations(params: {
  amount: number
  buildVendors: BuildVendorWeight[]
  projectVendorPOs?: VendorPO[]
  selectedVendorIds: string[]
  method: CommonExpenseSplitMethod
  preserveWhenUnchanged?: {
    amount: number
    selectedVendorIds: string[]
    vendorAllocations: CommonExpenseAllocation[]
  } | null
}): CommonExpenseAllocation[] {
  const {
    amount,
    buildVendors,
    projectVendorPOs,
    selectedVendorIds,
    method,
    preserveWhenUnchanged,
  } = params

  if (
    preserveWhenUnchanged &&
    amount === preserveWhenUnchanged.amount &&
    sameVendorIdSet(selectedVendorIds, preserveWhenUnchanged.selectedVendorIds) &&
    preserveWhenUnchanged.vendorAllocations.length > 0
  ) {
    const storedById = new Map(
      preserveWhenUnchanged.vendorAllocations.map((a) => [a.vendorId, a]),
    )
    const poRatioRows = computeExpenseShareAllocations(100, buildVendors, method, [])
    const poRatioById = new Map(poRatioRows.map((r) => [r.vendorId, r.allocationPercent]))

    return buildVendors.map((v) => {
      const stored = storedById.get(v.vendorId)
      const isSelected = selectedVendorIds.includes(v.vendorId)
      if (stored) {
        return {
          ...stored,
          allocationPercent: poRatioById.get(v.vendorId) ?? stored.allocationPercent,
          includedInRecovery: isSelected,
        }
      }
      return {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        allocationPercent: poRatioById.get(v.vendorId) ?? 0,
        allocationAmount: 0,
        includedInRecovery: isSelected,
      }
    })
  }

  if (projectVendorPOs && projectVendorPOs.length > 0) {
    return computeCommonExpenseAllocationsWithSelection(
      amount,
      projectVendorPOs,
      method,
      selectedVendorIds,
    )
  }

  return computeExpenseShareAllocations(amount, buildVendors, method, selectedVendorIds)
}
