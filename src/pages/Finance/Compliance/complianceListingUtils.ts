import type { ColumnFilterOption } from '@/components/listing'

export type ListingControls = {
  sortField?: string
  sortDirection: 'asc' | 'desc'
  filters: Record<string, string>
}

export function emptyListingControls(): ListingControls {
  return { sortDirection: 'asc', filters: {} }
}

export function uniqueFilterOptions(values: Array<string | number>): ColumnFilterOption[] {
  const seen = new Set<string>()
  const out: ColumnFilterOption[] = []
  for (const raw of values) {
    const value = String(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: value })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export function compareListingValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
  const dir = direction === 'asc' ? 1 : -1
  if (typeof left === 'number' || typeof right === 'number') {
    return ((Number(left) || 0) - (Number(right) || 0)) * dir
  }
  return (
    String(left ?? '').localeCompare(String(right ?? ''), undefined, { sensitivity: 'base' }) * dir
  )
}

export function matchesExactFilter(filter: string | undefined, value: string | number) {
  if (!filter) return true
  return String(value) === filter
}

export function matchesDateFilter(filter: string | undefined, iso: string) {
  if (!filter) return true
  return iso.slice(0, 10) === filter.slice(0, 10)
}

export function listingFieldValue(row: object, field: string): unknown {
  return (row as unknown as Record<string, unknown>)[field]
}

export function sortByField<T>(
  rows: T[],
  sortField: string | undefined,
  sortDirection: 'asc' | 'desc',
  resolve: (row: T, field: string) => unknown = (row, field) =>
    listingFieldValue(row as object, field),
) {
  if (!sortField) return rows
  return [...rows].sort((a, b) =>
    compareListingValues(resolve(a, sortField), resolve(b, sortField), sortDirection),
  )
}

export function hasActiveListingControls(controls: ListingControls) {
  return Boolean(controls.sortField) || Object.keys(controls.filters).length > 0
}

export function percentFilterOptions(values: number[]): ColumnFilterOption[] {
  return uniqueFilterOptions(values).map((opt) => ({
    value: opt.value,
    label: `${opt.value}%`,
  }))
}

export function currentIndianFyStartYear(now = new Date()) {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

export function indianFyLabel(startYear: number) {
  return `FY ${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function financialYearSelectOptions(now = new Date(), yearsBack = 4) {
  const current = currentIndianFyStartYear(now)
  return Array.from({ length: yearsBack + 1 }, (_, i) => {
    const startYear = current - i
    return {
      value: String(startYear),
      label: i === 0 ? 'This Financial Year' : indianFyLabel(startYear),
    }
  })
}

export function selectedFyHeading(startYear: number, now = new Date()) {
  return startYear === currentIndianFyStartYear(now) ? 'This Financial Year' : indianFyLabel(startYear)
}

export function parseChartPeriod(period: string): Date | null {
  const match = period.trim().match(/^([A-Za-z]{3})\s+(\d{2})$/)
  if (!match) return null
  const parsed = new Date(`${match[1]} 1, 20${match[2]}`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Indian FY quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export function indianFyQuarterLabel(date: Date): string {
  const month = date.getMonth()
  const quarter = month >= 3 ? Math.floor((month - 3) / 3) + 1 : 4
  return `Q${quarter}`
}
