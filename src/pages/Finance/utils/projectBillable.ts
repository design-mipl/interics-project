import type { Baseline, ClientPO } from '@/slices/baseline/reducer'
import type { Invoice, LineItem } from '@/slices/receivables/reducer'
import type { Service, SACCode } from '@/slices/settings/reducer'

export interface FlatMilestone {
  milestoneId: string
  milestoneName: string
  baselineServiceId: string
  baselineServiceName: string
  value: number
}

export interface FlatBaselineServiceRow {
  baselineServiceId: string
  name: string
  adjustedValue: number
}

/** Map baseline service label to settings master (name match + fallbacks). */
export function resolveServiceForBaseline(
  baselineServiceName: string,
  services: Service[],
): Service | undefined {
  const n = baselineServiceName.trim().toLowerCase()
  const direct = services.find((s) => s.name.trim().toLowerCase() === n)
  if (direct) return direct
  const aliases: Record<string, string> = {
    'interior design': 'Interior Design',
    'civil works': 'Construction / Build Services',
  }
  const aliasTarget = aliases[n]
  if (aliasTarget) {
    const byAlias = services.find((s) => s.name.trim().toLowerCase() === aliasTarget.toLowerCase())
    if (byAlias) return byAlias
  }
  return services.find(
    (s) =>
      s.name.toLowerCase().includes(n) ||
      n.includes(s.name.toLowerCase()),
  )
}

export function resolveServiceForLine(
  serviceId: string | undefined,
  serviceName: string | undefined,
  services: Service[],
): Service | undefined {
  if (serviceId) {
    const byId = services.find((s) => s.id === serviceId)
    if (byId) return byId
  }
  if (serviceName?.trim()) return resolveServiceForBaseline(serviceName, services)
  return undefined
}

export function flattenClientPoMilestones(po: ClientPO | null | undefined): FlatMilestone[] {
  if (!po) return []
  const out: FlatMilestone[] = []
  for (const m of po.milestones ?? []) {
    if (!m.name?.trim()) continue
    const serviceId = m.serviceId?.trim() || m.serviceName?.trim() || ''
    const serviceName = m.serviceName?.trim() || m.serviceId || ''
    const pushRow = (milestoneId: string, milestoneName: string, value: number) => {
      out.push({
        milestoneId,
        milestoneName,
        baselineServiceId: serviceId,
        baselineServiceName: serviceName,
        value,
      })
    }

    if (m.kind === 'retention' || m.id.startsWith('cli-ret-')) {
      pushRow(m.id, m.name, m.value)
      continue
    }

    pushRow(m.id, m.name, m.value)
    if (m.retention && (m.retention.value > 0 || m.retention.percentage > 0)) {
      pushRow(`${m.id}-retention`, `${m.name} — Retention`, m.retention.value)
    }
  }
  return out
}

export function flattenPoServicesFromMilestones(milestones: FlatMilestone[]): FlatBaselineServiceRow[] {
  const seen = new Map<string, FlatBaselineServiceRow>()
  for (const m of milestones) {
    const key = m.baselineServiceId || m.baselineServiceName
    if (!key) continue
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, {
        baselineServiceId: key,
        name: m.baselineServiceName || key,
        adjustedValue: m.value,
      })
    } else {
      existing.adjustedValue += m.value
    }
  }
  return [...seen.values()]
}

export function flattenBaselineMilestones(baseline: Baseline | null): FlatMilestone[] {
  if (!baseline) return []
  const categories = Array.isArray(baseline.categories) ? baseline.categories : []
  const out: FlatMilestone[] = []
  for (const cat of categories) {
    for (const svc of cat.services ?? []) {
      for (const m of svc.clientMilestones ?? []) {
        out.push({
          milestoneId: m.id,
          milestoneName: m.name,
          baselineServiceId: svc.id,
          baselineServiceName: svc.name,
          value: m.value,
        })
      }
    }
  }
  return out
}

export function flattenBaselineServices(baseline: Baseline | null): FlatBaselineServiceRow[] {
  if (!baseline) return []
  const categories = Array.isArray(baseline.categories) ? baseline.categories : []
  const out: FlatBaselineServiceRow[] = []
  for (const cat of categories) {
    for (const svc of cat.services ?? []) {
      const name = (svc.subcategoryName ?? svc.name ?? svc.customName ?? '').trim() || 'Service'
      out.push({
        baselineServiceId: svc.id,
        name,
        adjustedValue: svc.value,
      })
    }
  }
  return out
}

function lineItemsForProject(invoices: Invoice[], projectId: string): LineItem[] {
  return invoices.filter((i) => i.projectId === projectId).flatMap((i) => i.lineItems)
}

export function sumBilledPerMilestone(
  invoices: Invoice[],
  projectId: string,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const li of lineItemsForProject(invoices, projectId)) {
    if (!li.milestoneId) continue
    map.set(li.milestoneId, (map.get(li.milestoneId) ?? 0) + li.amount)
  }
  return map
}

export function sumBilledPerBaselineService(
  invoices: Invoice[],
  projectId: string,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const li of lineItemsForProject(invoices, projectId)) {
    if (!li.baselineServiceId) continue
    map.set(li.baselineServiceId, (map.get(li.baselineServiceId) ?? 0) + li.amount)
  }
  return map
}

export type MilestoneBillStatus = 'unbilled' | 'partial' | 'billed'

export function milestoneBillStatus(billed: number, value: number): MilestoneBillStatus {
  if (billed <= 0) return 'unbilled'
  if (billed >= value - 0.01) return 'billed'
  return 'partial'
}

export function remainingMilestoneValue(billed: number, value: number): number {
  return Math.max(0, Math.round((value - billed) * 100) / 100)
}

/** Count selected milestones that have no remaining billable amount (for invoice draft UX). */
export function countSelectedMilestonesWithZeroRemaining(
  selectedMilestoneIds: string[],
  flatMilestones: FlatMilestone[],
  billedByMilestone: Map<string, number>,
): number {
  let count = 0
  for (const id of selectedMilestoneIds) {
    const m = flatMilestones.find((x) => x.milestoneId === id)
    if (!m) continue
    if (remainingMilestoneValue(billedByMilestone.get(id) ?? 0, m.value) <= 0) count++
  }
  return count
}

export function remainingServiceValue(billed: number, adjustedValue: number): number {
  return Math.max(0, Math.round((adjustedValue - billed) * 100) / 100)
}

export function sacCodeForService(sacCodes: SACCode[], service: Service | undefined): string {
  if (!service?.sacCodeId) return ''
  return sacCodes.find((s) => s.id === service.sacCodeId)?.code ?? ''
}
