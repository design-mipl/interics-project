import type { LineSource } from '@/slices/receivables/reducer'
import type { Baseline, ClientPO } from '@/slices/baseline/reducer'
import type { Invoice } from '@/slices/receivables/reducer'
import type { Service, SACCode } from '@/slices/settings/reducer'
import {
  resolveClientPoMilestoneGstRate,
  previewClientInvoiceLineTax,
} from '@/pages/Projects/tabs/live/clientInvoiceUtils'
import {
  type FlatMilestone,
  remainingMilestoneValue,
  resolveServiceForLine,
  sacCodeForService,
  sumBilledPerMilestone,
} from './projectBillable'

export interface ReceivableDraftLineItem {
  id: string
  serviceId: string
  serviceName: string
  sacCode: string
  amount: number
  labourCessRate: number
  labourCessAmount: number
  taxableAmount: number
  gstRate: number
  gstAmount: number
  milestoneId?: string
  baselineServiceId?: string
  lineSource?: LineSource
  maxAmount?: number
}

export function buildAutoDraftLines(
  selectedMilestoneIds: string[],
  sourceMilestones: FlatMilestone[],
  projectInvoices: Invoice[],
  projectId: string,
  services: Service[],
  sacCodes: SACCode[],
  selectedPo: ClientPO | null,
  poTdsRate: number | null | undefined,
  baseline: Baseline | null,
): ReceivableDraftLineItem[] {
  if (selectedMilestoneIds.length === 0) return []
  const mSet = new Set(selectedMilestoneIds)
  const billedM = sumBilledPerMilestone(projectInvoices, projectId)
  const out: ReceivableDraftLineItem[] = []

  for (const m of sourceMilestones) {
    if (!mSet.has(m.milestoneId)) continue
    const billed = billedM.get(m.milestoneId) ?? 0
    const remaining = remainingMilestoneValue(billed, m.value)
    if (remaining <= 0) continue
    const settingsSvc = resolveServiceForLine(
      m.baselineServiceId,
      m.baselineServiceName,
      services,
      baseline,
    )
    const sac = sacCodeForService(sacCodes, settingsSvc)
    const gstRate = resolveClientPoMilestoneGstRate(selectedPo, m.milestoneId, {
      serviceId: m.baselineServiceId,
      baseline,
      settingsServices: services,
    })
    const taxed = previewClientInvoiceLineTax(remaining, 0, gstRate, poTdsRate)
    out.push({
      id: `tmp-ms-${m.milestoneId}`,
      serviceId: settingsSvc?.id ?? m.baselineServiceId,
      serviceName: `${m.milestoneName} — ${m.baselineServiceName}`,
      sacCode: sac,
      amount: remaining,
      labourCessRate: 0,
      labourCessAmount: taxed.labourCessAmount,
      taxableAmount: taxed.taxableAmount,
      gstRate,
      gstAmount: taxed.gstAmount,
      milestoneId: m.milestoneId,
      baselineServiceId: m.baselineServiceId,
      lineSource: 'milestone',
      maxAmount: remaining,
    })
  }
  return out
}
