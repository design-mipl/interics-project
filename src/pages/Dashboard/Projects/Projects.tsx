import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import {
  Autocomplete,
  Box,
  Drawer,
  Fade,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Select as MuiSelect,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import {
  Archive,
  Banknote,
  Building2,
  CheckCircle2,
  Clock3,
  IndianRupee,
  Percent,
  PlayCircle,
  Sparkles,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import {
  BarChart,
  ChartCard,
  DonutChart,
  SearchInput,
  StatusBadge,
  type DonutSlice,
} from '@/design-system/components'
import type { StatusType } from '@/design-system/components'
import { useChartTheme } from '@/design-system/components/charts/utils/chartTheme'
import { CHART_COLORS, tokens } from '@/design-system/tokens'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchProjects } from '@/slices/projects/thunk'
import { fetchSectors } from '@/slices/settings/thunk'
import type { Project } from '@/slices/projects/reducer'
import client from '@/api/client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import { formatDate } from '@/utils/formatters'
import { getSectorTagSx } from '@/utils/sectorTagStyles'
import { DashboardDateRangeFilter } from '../DashboardDateRangeFilter'
import {
  type DashboardDatePeriod,
  dashboardDateParams,
  type DashboardDateRange,
} from '../dashboardDateRange'
import { useDashboardReload } from '../useDashboardReload'
import { DashboardKpiCardSkeleton, DashboardSectionLoader } from '../DashboardTabLoader'

/**
 * Project Analytics chart data is derived from the real Projects module state.
 */

interface ProjectsDashboardResponse {
  charts?: Array<{
    id: string
    data?: Array<Record<string, unknown>>
  }>
  data?: {
    projects?: Project[]
    sectorPerformance?: Array<Record<string, unknown>>
  }
}

function asDashboardProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (project): project is Project =>
      Boolean(project) &&
      typeof project === 'object' &&
      typeof (project as Project).id === 'string',
  )
}

function asBackendSectorPerformance(value: unknown): SectorPerformanceRow[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const sector = String(record.sector ?? '').trim()
      const completedCount = Number(record.completedCount ?? 0)
      const avgCompletedSqft = Number(record.avgCompletedSqft ?? 0)
      const safeCompletedCount = Number.isFinite(completedCount) ? completedCount : 0
      const safeAvgCompletedSqft = Number.isFinite(avgCompletedSqft) ? avgCompletedSqft : 0
      if (!sector || safeCompletedCount <= 0) return null
      return {
        sector,
        completedCount: safeCompletedCount,
        avgCompletedSqft: safeAvgCompletedSqft,
      }
    })
    .filter((row): row is SectorPerformanceRow => Boolean(row))
}

interface MonthlyPitchesVsLivePoint {
  month: string
  pitches: number
  live: number
}

interface LiveDurationProjectDetail {
  name: string
  durationDays: number
}

interface LiveDurationByMonthPoint {
  month: string
  /** Live/Active projects already started by this month. */
  liveProjects: number
  /**
   * Average running duration (days) for those projects, measured as of the
   * month end (or today for the current month). Null if none.
   */
  avgDurationDays: number | null
  projects: LiveDurationProjectDetail[]
}

interface LiveProjectDurationPoint {
  project: string
  projectId: string
  durationDays: number
  startMonth: string
}

interface LiveProjectSizePoint {
  project: string
  projectId: string
  sqft: number
}

interface MonthBucket {
  key: string
  label: string
  year: number
  month: number
}

function startOfDay(d: Date): Date {
  const next = new Date(d)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(d: Date): Date {
  const next = new Date(d)
  next.setHours(23, 59, 59, 999)
  return next
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function projectAnchorDate(project: Project): Date | null {
  return parseDate(project.startDate) ?? parseDate(project.createdAt)
}

function getDateRangeBounds(dateRange: string, now = new Date()): { start: Date | null; end: Date } {
  const end = endOfDay(now)
  if (dateRange === 'All Time') return { start: null, end }

  const start = startOfDay(new Date(now))
  if (dateRange === 'This Month') {
    start.setDate(1)
    return { start, end }
  }
  if (dateRange === 'This Quarter') {
    const q = Math.floor(now.getMonth() / 3)
    start.setMonth(q * 3, 1)
    return { start, end }
  }
  // This Year (default) and unknown presets
  start.setMonth(0, 1)
  return { start, end }
}

function filterProjectsForDashboard(
  projects: Project[],
  filters: {
    dateRange?: string
    clientFilter?: string
    statusFilter?: string
    pmFilter?: string
  },
): Project[] {
  const dateRange = filters.dateRange ?? 'This Year'
  const { start, end } = getDateRangeBounds(dateRange)

  return projects.filter((project) => {
    if (filters.statusFilter && filters.statusFilter !== 'All Status') {
      const wanted =
        filters.statusFilter === 'On Hold' ? 'Archived' : filters.statusFilter
      if (project.status !== wanted) return false
    }

    if (filters.clientFilter && filters.clientFilter !== 'All Clients') {
      const client = filters.clientFilter.trim().toLowerCase()
      if ((project.customerName ?? '').trim().toLowerCase() !== client) return false
    }

    if (filters.pmFilter && filters.pmFilter !== 'All Managers') {
      const pm = filters.pmFilter.trim().toLowerCase()
      if ((project.projectManager ?? '').trim().toLowerCase() !== pm) return false
    }

    if (start) {
      const anchor = projectAnchorDate(project)
      if (!anchor) return false
      if (anchor < start || anchor > end) return false
    }

    return true
  })
}

/**
 * Live/active analytics scope: apply dashboard filters, but keep currently Live
 * projects that already started by the end of the selected period (do not require
 * the start date to fall inside the period — long-running Live projects still count).
 */
export function filterProjectsForLiveAnalytics(
  projects: Project[],
  filters: {
    dateRange?: string
    clientFilter?: string
    statusFilter?: string
    pmFilter?: string
  },
): Project[] {
  const dateRange = filters.dateRange ?? 'This Year'
  const { end } = getDateRangeBounds(dateRange)

  return projects.filter((project) => {
    if (filters.statusFilter && filters.statusFilter !== 'All Status') {
      const wanted =
        filters.statusFilter === 'On Hold' ? 'Archived' : filters.statusFilter
      if (project.status !== wanted) return false
    } else if (project.status !== 'Live') {
      return false
    }

    if (filters.clientFilter && filters.clientFilter !== 'All Clients') {
      const client = filters.clientFilter.trim().toLowerCase()
      if ((project.customerName ?? '').trim().toLowerCase() !== client) return false
    }

    if (filters.pmFilter && filters.pmFilter !== 'All Managers') {
      const pm = filters.pmFilter.trim().toLowerCase()
      if ((project.projectManager ?? '').trim().toLowerCase() !== pm) return false
    }

    const start = parseDate(project.startDate)
    if (!start) return false
    if (startOfDay(start) > end) return false

    return true
  })
}

function buildMonthBuckets(count: number, now = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'short' }),
      year: d.getFullYear(),
      month: d.getMonth(),
    })
  }
  return buckets
}

function monthBucketCount(dateRange: string): number {
  if (dateRange === 'This Month') return 1
  if (dateRange === 'This Quarter') return 3
  if (dateRange === 'All Time') return 12
  if (dateRange === 'Last 12 Months') return 12
  return 12
}

/** Running duration for a Live project: days from start to today. */
function liveProjectRunningDays(project: Project, now = new Date()): number | null {
  const start = parseDate(project.startDate)
  if (!start) return null
  const diff = Math.round((endOfDay(now).getTime() - startOfDay(start).getTime()) / 86_400_000)
  return diff >= 0 ? diff : null
}

function projectSqft(project: Project): number | null {
  const area = project.carpetArea ?? project.chargeableArea ?? null
  if (area == null || area <= 0) return null
  return area
}

function formatCompactNumber(value: number): string {
  return Math.round(value).toLocaleString('en-IN')
}

function formatProjectFinancialMoney(value: number): string {
  const amount = Math.round(value)
  const symbol = String.fromCharCode(8377)
  if (amount >= 10_000_000) return formatProjectMoney(value)
  if (amount >= 100_000) return `${symbol}${(amount / 100_000).toFixed(2)} L`
  return formatProjectMoney(value)
}

function formatProjectMoney(value: number): string {
  const amount = Math.round(value)
  if (amount >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)} Cr`
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`
  return `₹${amount.toLocaleString('en-IN')}`
}

function averageProjectSize(projects: Project[]): number {
  if (projects.length === 0) return 0
  const totalSqft = projects.reduce((sum, project) => sum + (projectSqft(project) ?? 0), 0)
  return Math.round(totalSqft / projects.length)
}

function averagePitchToLiveDays(projects: Project[]): number {
  const convertedProjects = projects.filter((project) => project.wentLiveAt)
  if (convertedProjects.length === 0) return 0

  const totalDays = convertedProjects.reduce((sum, project) => {
    const liveDate = parseDate(project.wentLiveAt)
    const pitchDate = parseDate(project.createdAt) ?? parseDate(project.startDate)
    if (!liveDate || !pitchDate) return sum
    const days = Math.round(
      (startOfDay(liveDate).getTime() - startOfDay(pitchDate).getTime()) / 86_400_000,
    )
    return sum + Math.max(0, days)
  }, 0)

  return Math.round(totalDays / convertedProjects.length)
}

function buildProjectsCompletedByYear(projects: Project[]): Array<{ year: string; completed: number }> {
  const counts = new Map<string, number>()
  for (const project of projects) {
    if (project.status !== 'Completed') continue
    const completedDate = parseDate(project.completedAt)
    if (!completedDate) continue
    const year = String(completedDate.getFullYear())
    counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([year, completed]) => ({ year, completed }))
    .sort((a, b) => a.year.localeCompare(b.year))
}

/**
 * Month-wise Pitch vs Live counts (by project start / created date).
 */
export function buildMonthlyPitchesVsLive(
  projects: Project[],
  dateRange = 'This Year',
): MonthlyPitchesVsLivePoint[] {
  const buckets = buildMonthBuckets(monthBucketCount(dateRange))
  return buckets.map((b) => {
    let pitches = 0
    let live = 0
    for (const project of projects) {
      const anchor = projectAnchorDate(project)
      if (!anchor) continue
      if (anchor.getFullYear() !== b.year || anchor.getMonth() !== b.month) continue
      if (project.status === 'Pitch') pitches += 1
      if (project.status === 'Live') live += 1
    }
    return { month: b.label, pitches, live }
  })
}

/**
 * Live / Active projects only — running duration (days) per project since start.
 */
function buildLiveProjectDurations(
  projects: Project[],
  now = new Date(),
): {
  series: LiveProjectDurationPoint[]
  averageDurationDays: number | null
  liveCount: number
} {
  const live = projects.filter((p) => p.status === 'Live')
  const series = live
    .map((project) => {
      const days = liveProjectRunningDays(project, now)
      if (days == null) return null
      const anchor = projectAnchorDate(project)
      const startMonth = anchor
        ? anchor.toLocaleString('en-IN', { month: 'short', year: 'numeric' })
        : '—'
      return {
        project: project.name,
        projectId: project.id,
        durationDays: days,
        startMonth,
      }
    })
    .filter((row): row is LiveProjectDurationPoint => row != null)
    .sort((a, b) => b.durationDays - a.durationDays || a.project.localeCompare(b.project))

  const averageDurationDays =
    series.length > 0
      ? Math.round(series.reduce((s, r) => s + r.durationDays, 0) / series.length)
      : null

  return {
    series,
    averageDurationDays,
    liveCount: live.length,
  }
}

/**
 * Live projects only — month-wise Live Project count + average running duration.
 *
 * For each month in the selected period:
 * - Live Projects = Live/Active projects that had already started by that month’s end
 * - Avg Running Duration = average of (month reference date − project start date)
 */
export function buildLiveDurationByMonth(
  projects: Project[],
  dateRange = 'This Year',
  now = new Date(),
): {
  series: LiveDurationByMonthPoint[]
  averageDurationDays: number | null
  liveCount: number
} {
  const live = projects.filter((p) => p.status === 'Live')
  const perProject = buildLiveProjectDurations(live, now)
  const buckets = buildMonthBuckets(monthBucketCount(dateRange), now)

  const series = buckets.map((b) => {
    const monthEnd = endOfDay(new Date(b.year, b.month + 1, 0))
    const asOf =
      monthEnd.getTime() > endOfDay(now).getTime() ? endOfDay(now) : monthEnd

    const details: LiveDurationProjectDetail[] = []
    for (const project of live) {
      const start = parseDate(project.startDate)
      if (!start) continue
      if (startOfDay(start) > asOf) continue

      const days = Math.round(
        (asOf.getTime() - startOfDay(start).getTime()) / 86_400_000,
      )
      if (days < 0) continue

      details.push({
        name: project.name,
        durationDays: days,
      })
    }

    details.sort(
      (a, b) => b.durationDays - a.durationDays || a.name.localeCompare(b.name),
    )

    return {
      month: b.label,
      liveProjects: details.length,
      avgDurationDays:
        details.length > 0
          ? Math.round(details.reduce((s, p) => s + p.durationDays, 0) / details.length)
          : null,
      projects: details,
    }
  })

  return {
    series,
    averageDurationDays: perProject.averageDurationDays,
    liveCount: live.length,
  }
}

const LIVE_DURATION_DATE_RANGE_OPTIONS = ['Last 12 Months'] as const
export type LiveDurationDateRange = (typeof LIVE_DURATION_DATE_RANGE_OPTIONS)[number]

const ALL_LIVE_PROJECTS_VALUE = 'all'

interface LiveProjectSelectOption {
  value: string
  label: string
}

export function buildLiveProjectSelectOptions(
  projects: Project[],
): LiveProjectSelectOption[] {
  const live = projects
    .filter((p) => p.status === 'Live')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  return [
    { value: ALL_LIVE_PROJECTS_VALUE, label: 'All Live Projects' },
    ...live.map((p) => ({ value: p.id, label: p.name })),
  ]
}

interface LiveProjectTimelinePoint {
  month: string
  monthKey: string
  durationDays: number
  marker: 'start' | 'today' | 'end' | null
}

interface LiveProjectTimelineMeta {
  projectId: string
  name: string
  status: string
  startLabel: string
  todayLabel: string
  endLabel: string
  endIsOngoing: boolean
  runningDays: number
}

interface LiveProjectTimelineBundle {
  series: LiveProjectTimelinePoint[]
  meta: LiveProjectTimelineMeta | null
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Single Live project running-duration timeline from Start → Today (or End Date).
 */
export function buildLiveProjectDurationTimeline(
  project: Project | null | undefined,
  now = new Date(),
): LiveProjectTimelineBundle {
  if (!project || project.status !== 'Live') {
    return { series: [], meta: null }
  }

  const start = parseDate(project.startDate)
  if (!start) {
    return {
      series: [],
      meta: {
        projectId: project.id,
        name: project.name,
        status: project.status,
        startLabel: '—',
        todayLabel: formatDisplayDate(now),
        endLabel: 'Ongoing',
        endIsOngoing: true,
        runningDays: 0,
      },
    }
  }

  const startDay = startOfDay(start)
  const endDate = parseDate(project.expectedEndDate)
  const endIsOngoing = endDate == null
  const endRef = endIsOngoing
    ? endOfDay(now)
    : endOfDay(endDate.getTime() > now.getTime() ? now : endDate)

  const runningDays = Math.max(
    0,
    Math.round((endRef.getTime() - startDay.getTime()) / 86_400_000),
  )

  const series: LiveProjectTimelinePoint[] = []

  // Explicit START point at day 0
  series.push({
    month: startDay.toLocaleString('en-IN', { month: 'short' }),
    monthKey: `${startDay.getFullYear()}-${String(startDay.getMonth() + 1).padStart(2, '0')}-start`,
    durationDays: 0,
    marker: 'start',
  })

  let year = startDay.getFullYear()
  let month = startDay.getMonth()
  const endYear = endRef.getFullYear()
  const endMonth = endRef.getMonth()

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const monthEnd = endOfDay(new Date(year, month + 1, 0))
    const asOf = monthEnd.getTime() > endRef.getTime() ? endRef : monthEnd
    const days = Math.max(
      0,
      Math.round((asOf.getTime() - startDay.getTime()) / 86_400_000),
    )
    const isLast = year === endYear && month === endMonth

    series.push({
      month: new Date(year, month, 1).toLocaleString('en-IN', { month: 'short' }),
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      durationDays: isLast ? runningDays : days,
      marker: isLast ? (endIsOngoing ? 'today' : 'end') : null,
    })

    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }

  return {
    series,
    meta: {
      projectId: project.id,
      name: project.name,
      status: project.status,
      startLabel: formatDisplayDate(startDay),
      todayLabel: formatDisplayDate(now),
      endLabel: endIsOngoing ? 'Ongoing' : formatDisplayDate(endDate!),
      endIsOngoing,
      runningDays,
    },
  }
}

/**
 * Live projects only — size (sqft) per project + average.
 */
export function buildLiveProjectSizes(projects: Project[]): {
  series: LiveProjectSizePoint[]
  averageSqft: number | null
  liveCount: number
  totalSqft: number
} {
  const live = projects.filter((p) => p.status === 'Live')
  const withSize = live
    .map((p) => {
      const sqft = projectSqft(p)
      if (sqft == null) return null
      return {
        project: p.name,
        projectId: p.id,
        sqft: Math.round(sqft),
      }
    })
    .filter((row): row is LiveProjectSizePoint => row != null)
    .sort((a, b) => b.sqft - a.sqft)

  const totalSqft = withSize.reduce((s, r) => s + r.sqft, 0)

  return {
    series: withSize,
    averageSqft: withSize.length > 0 ? Math.round(totalSqft / withSize.length) : null,
    liveCount: live.length,
    totalSqft,
  }
}

type LifecycleEventType = 'Pitch' | 'Live' | 'Completed' | 'Cancelled' | 'Archived'

interface LifecycleEvent {
  id: string
  projectId: string
  projectName: string
  eventType: LifecycleEventType
  date: number
  dateLabel: string
  sqft: number
}

interface LifecycleProjectLine {
  projectId: string
  projectName: string
  events: LifecycleEvent[]
}

function buildProjectLifecycleData(projects: Project[]): {
  lines: LifecycleProjectLine[]
  events: LifecycleEvent[]
} {
  const lines: LifecycleProjectLine[] = []
  const allEvents: LifecycleEvent[] = []

  // Sort projects alphabetically
  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name))

  for (const p of sortedProjects) {
    const sqft = projectSqft(p) ?? 0
    const projEvents: LifecycleEvent[] = []

    const createdDate = parseDate(p.createdAt)
    const liveDate = parseDate(p.wentLiveAt) ?? (p.status !== 'Pitch' ? parseDate(p.startDate) : null)
    const isTerminal = (['Completed', 'Cancelled', 'Archived'] as const).includes(
      p.status as 'Completed' | 'Cancelled' | 'Archived',
    )
    const terminalDate =
      p.status === 'Completed'
        ? parseDate(p.completedAt) ?? parseDate(p.expectedEndDate)
        : p.status === 'Cancelled'
          ? parseDate(p.cancelledAt) ?? parseDate(p.expectedEndDate)
          : p.status === 'Archived'
            ? parseDate(p.archivedAt) ?? parseDate(p.expectedEndDate)
            : null

    const createEvent = (eventType: LifecycleEventType, date: Date): LifecycleEvent => ({
      id: `${p.id}-${eventType.toLowerCase()}`,
      projectId: p.id,
      projectName: p.name,
      eventType,
      date: date.getTime(),
      dateLabel: date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
      sqft,
    })

    /**
     * Pitch only when the project actually had a pitch period:
     * - currently in Pitch, or
     * - createdAt is strictly before Live start (Pitch → Live path).
     * Direct-to-Live / terminal-only projects never get a fabricated Pitch.
     */
    const hasPitchStage =
      createdDate != null &&
      (p.status === 'Pitch' ||
        (liveDate != null && createdDate.getTime() <= liveDate.getTime()) ||
        (terminalDate != null && createdDate.getTime() <= terminalDate.getTime()))

    if (hasPitchStage && createdDate) {
      projEvents.push(createEvent('Pitch', createdDate))
    }

    if (liveDate) {
      projEvents.push(createEvent('Live', liveDate))
    }

    // End event (Completed, Cancelled, Archived) — only when that status is real
    if (isTerminal) {
      const stageDate = terminalDate ?? (!liveDate && !hasPitchStage ? createdDate : null)
      if (stageDate) {
        const priorTs = liveDate?.getTime() ?? (hasPitchStage ? createdDate!.getTime() : null)
        // Allow terminal-only bars when there is no prior stage in history
        if (priorTs == null || stageDate.getTime() >= priorTs) {
          projEvents.push(createEvent(p.status as LifecycleEventType, stageDate))
        }
      }
    }

    if (projEvents.length > 0) {
      projEvents.sort((a, b) => a.date - b.date)
      lines.push({
        projectId: p.id,
        projectName: p.name,
        events: projEvents,
      })
      allEvents.push(...projEvents)
    }
  }

  return { lines, events: allEvents }
}

/**
 * Dashboard Projects Overview module.
 */

interface ProjectOverviewKpi {
  id: string
  title: string
  value: string
  subtitle: string
  icon:
    | 'active'
    | 'completed'
    | 'pipeline'
    | 'cancelled'
    | 'archived'
    | 'size'
    | 'conversion'
}

const PROJECT_OVERVIEW_KPIS: ProjectOverviewKpi[] = [
  {
    id: 'active',
    title: 'Active Projects',
    value: '0',
    subtitle: 'Projects currently in execution.',
    icon: 'active',
  },
  {
    id: 'completed',
    title: 'Completed Projects',
    value: '0',
    subtitle: 'Successfully handed over.',
    icon: 'completed',
  },
  {
    id: 'pipeline',
    title: 'Pipeline Projects',
    value: '0',
    subtitle: 'In pitch or proposal stage.',
    icon: 'pipeline',
  },
  {
    id: 'cancelled',
    title: 'Cancelled Projects',
    value: '0',
    subtitle: 'Closed without delivery.',
    icon: 'cancelled',
  },
  {
    id: 'archived',
    title: 'Archived Projects',
    value: '0',
    subtitle: 'Archived after completion.',
    icon: 'archived',
  },
  {
    id: 'size',
    title: 'Average Project Size',
    value: '0 sqft',
    subtitle: 'Mean carpet area across projects.',
    icon: 'size',
  },
  {
    id: 'conversion',
    title: 'Average Pitch to Live Conversion Time',
    value: '0 days',
    subtitle: 'Avg. time from pitch to live.',
    icon: 'conversion',
  },
]

const KPI_STATUS_MAP: Record<string, Project['status']> = {
  active: 'Live',
  completed: 'Completed',
  pipeline: 'Pitch',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

/** Status KPI counts from the Projects module listing (same source as ProjectsPage tabs). */
function buildProjectOverviewKpis(projects: Project[]): ProjectOverviewKpi[] {
  const averageSize = averageProjectSize(projects)
  const conversionDays = averagePitchToLiveDays(projects)

  return PROJECT_OVERVIEW_KPIS.map((kpi) => {
    const status = KPI_STATUS_MAP[kpi.id]
    if (status) {
      const count = projects.filter((project) => project.status === status).length
      return { ...kpi, value: String(count) }
    }
    if (kpi.id === 'size') {
      return { ...kpi, value: `${formatCompactNumber(averageSize)} sqft` }
    }
    if (kpi.id === 'conversion') {
      return { ...kpi, value: `${formatCompactNumber(conversionDays)} days` }
    }
    return kpi
  })
}

function buildProjectStatusDistribution(projects: Project[]): DonutSlice[] {
  return [
    {
      key: 'pipeline',
      label: 'Pipeline',
      value: projects.filter((project) => project.status === 'Pitch').length,
      color: CHART_COLORS.blue,
    },
    {
      key: 'active',
      label: 'Active',
      value: projects.filter((project) => project.status === 'Live').length,
      color: CHART_COLORS.teal,
    },
    {
      key: 'completed',
      label: 'Completed',
      value: projects.filter((project) => project.status === 'Completed').length,
      color: CHART_COLORS.green,
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      value: projects.filter((project) => project.status === 'Cancelled').length,
      color: CHART_COLORS.red,
    },
    {
      key: 'archived',
      label: 'Archived',
      value: projects.filter((project) => project.status === 'Archived').length,
      color: CHART_COLORS.grey,
    },
  ]
}

/** Sector tag summary — project counts by Sector Master value. */
interface SectorTag {
  id: string
  name: string
  count: number
  color: string
}

const SECTOR_TAG_COLORS = [
  CHART_COLORS.teal,
  CHART_COLORS.blue,
  CHART_COLORS.green,
  CHART_COLORS.amber,
  CHART_COLORS.purple,
  CHART_COLORS.red,
  CHART_COLORS.grey,
] as const

interface SectorMasterLike {
  id: string
  name: string
  status: 'active' | 'inactive' | string
}

/**
 * Builds Sector Tag chips from Settings → Sector Master.
 * Counts projects whose `sector` matches each active master sector name.
 */
function buildSectorTagsFromMaster(
  sectors: SectorMasterLike[],
  projects: Array<{ sector?: string | null; status?: string | null }>,
): SectorTag[] {
  const counts = new Map<string, number>()
  for (const project of projects) {
    if (project.status !== 'Live') continue
    const key = (project.sector ?? '').trim().toLowerCase()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return sectors
    .filter((s) => s.status === 'active' && s.name.trim())
    .flatMap((s, index) => {
      const name = s.name.trim()
      const count = counts.get(name.toLowerCase()) ?? 0
      if (count === 0) return []
      return [{
        id: s.id,
        name,
        count,
        color: SECTOR_TAG_COLORS[index % SECTOR_TAG_COLORS.length],
      }]
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * Dashboard Sector & Project Type Analytics options.
 */


type SectorPerformanceMetric = 'completedCount' | 'avgCompletedSqft'

const SECTOR_FILTER_OPTIONS = [
  { value: 'top5', label: 'Top 5' },
  { value: 'top10', label: 'Top 10' },
  { value: 'top15', label: 'Top 15' },
  { value: 'all', label: 'All Sectors' },
] as const

type SectorFilterValue = (typeof SECTOR_FILTER_OPTIONS)[number]['value']

const SECTOR_PERFORMANCE_METRIC_OPTIONS = [
  {
    value: 'completedCount' as const,
    label: 'Completed Projects',
    xAxisLabel: 'Completed Projects (No.)',
  },
  {
    value: 'avgCompletedSqft' as const,
    label: 'Average Completed Project Size',
    xAxisLabel: 'Average Project Size (sq.ft.)',
  },
] as const

/** Stable sector colors for Sector Performance bars / legend. */
const SECTOR_COLORS: Record<string, string> = {
  Corporate: CHART_COLORS.green,
  Retail: CHART_COLORS.blue,
  Healthcare: CHART_COLORS.orange,
  Hospitality: CHART_COLORS.purple,
  Residential: CHART_COLORS.teal,
  Education: CHART_COLORS.amber,
  'IT / Tech': CHART_COLORS.blue,
  Banking: CHART_COLORS.teal,
  Manufacturing: CHART_COLORS.grey,
  Pharma: CHART_COLORS.purple,
  'F&B': CHART_COLORS.orange,
  Logistics: CHART_COLORS.amber,
  Media: CHART_COLORS.red,
  Automobile: CHART_COLORS.blue,
  Government: CHART_COLORS.grey,
  Sports: CHART_COLORS.green,
  Agriculture: CHART_COLORS.teal,
  Energy: CHART_COLORS.amber,
}

const FALLBACK_SECTOR_COLORS = [
  CHART_COLORS.green,
  CHART_COLORS.blue,
  CHART_COLORS.orange,
  CHART_COLORS.purple,
  CHART_COLORS.teal,
  CHART_COLORS.amber,
  CHART_COLORS.red,
  CHART_COLORS.grey,
]

function sectorColor(sector: string, index = 0): string {
  return SECTOR_COLORS[sector] ?? FALLBACK_SECTOR_COLORS[index % FALLBACK_SECTOR_COLORS.length]!
}

/**
 * Completed-project sector metrics.
 * `completedCount` and `avgCompletedSqft` include completed projects only.
 */
interface SectorPerformanceRow {
  sector: string
  completedCount: number
  avgCompletedSqft: number
}

function buildSectorPerformance(projects: Project[]): SectorPerformanceRow[] {
  const grouped = new Map<string, { completedCount: number; sqft: number[] }>()
  for (const project of projects) {
    const sector = project.sector?.trim() || 'Unassigned'
    const row = grouped.get(sector) ?? { completedCount: 0, sqft: [] }
    if (project.status === 'Completed') {
      row.completedCount += 1
      const sqft = projectSqft(project)
      if (sqft != null) row.sqft.push(sqft)
    }
    grouped.set(sector, row)
  }

  return Array.from(grouped.entries())
    .map(([sector, row]) => ({
      sector,
      completedCount: row.completedCount,
      avgCompletedSqft:
        row.sqft.length > 0
          ? Math.round(row.sqft.reduce((sum, sqft) => sum + sqft, 0) / row.sqft.length)
          : 0,
    }))
    .filter((row) => row.completedCount > 0)
}

function sectorFilterLimit(filter: SectorFilterValue, total: number): number {
  if (filter === 'top5') return 5
  if (filter === 'top10') return 10
  if (filter === 'top15') return 15
  return total
}

function projectTypeLabels(project: Project): string[] {
  return [
    ...project.projectTypes,
    project.projectScope,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.toLowerCase())
}

function buildDesignVsBuildData(projects: Project[]): DonutSlice[] {
  let designOnly = 0
  let designBuild = 0

  for (const project of projects) {
    const labels = projectTypeLabels(project)
    const hasBuild = labels.some((label) => label.includes('build'))
    const hasDesign = labels.some((label) => label.includes('design'))
    if (hasBuild) designBuild += 1
    else if (hasDesign) designOnly += 1
  }

  return [
    { key: 'design_only', label: 'Design Only', value: designOnly },
    { key: 'design_build', label: 'Design & Build', value: designBuild },
  ]
}

interface SectorPerformanceChartRow {
  sector: string
  value: number
  completedCount: number
  avgCompletedSqft: number
  color: string
}

/** Rows sorted highest→lowest for the selected completed-only metric. */
function buildSectorPerformanceChartData(
  projects: Project[],
  filter: SectorFilterValue,
  metric: SectorPerformanceMetric,
  backendRows: SectorPerformanceRow[] = [],
): SectorPerformanceChartRow[] {
  const sourceRows = backendRows.length > 0 ? backendRows : buildSectorPerformance(projects)
  const metricRows = sourceRows.filter((row) => row[metric] > 0)
  const sorted = [...metricRows].sort(
    (a, b) => b[metric] - a[metric] || a.sector.localeCompare(b.sector),
  )
  const limited = sorted.slice(0, sectorFilterLimit(filter, sorted.length))

  return limited.map((row, index) => {
    const value = row[metric]
    return {
      sector: row.sector,
      value,
      completedCount: row.completedCount,
      avgCompletedSqft: row.avgCompletedSqft,
      color: sectorColor(row.sector, index),
    }
  })
}

function getSectorPerformanceMetricMeta(metric: SectorPerformanceMetric) {
  return (
    SECTOR_PERFORMANCE_METRIC_OPTIONS.find((o) => o.value === metric) ??
    SECTOR_PERFORMANCE_METRIC_OPTIONS[0]
  )
}

function sectorPerformanceAxisStep(metric: SectorPerformanceMetric): number {
  return metric === 'avgCompletedSqft' ? 5000 : 5
}

function buildSectorPerformanceAxis(
  data: SectorPerformanceChartRow[],
  metric: SectorPerformanceMetric,
): { domainMax: number; ticks: number[] } {
  const step = sectorPerformanceAxisStep(metric)
  const maxValue = Math.max(...data.map((row) => row.value), 0)
  const domainMax = Math.max(step, Math.ceil(maxValue / step) * step)
  const ticks: number[] = []
  for (let tick = 0; tick <= domainMax; tick += step) {
    ticks.push(tick)
  }
  return { domainMax, ticks }
}

/**
 * Project Design Analytics is derived from the real Projects module state.
 */


type DesignProjectId = string

interface DesignProjectOption {
  id: DesignProjectId
  label: string
}

type DesignFinancialIcon = 'value' | 'payable' | 'profit' | 'fee'

interface DesignProjectDetails {
  projectName: string
  carpetArea: string
  headcount: string
  building: string
  clientSector: string
  projectManager: string
}

interface DesignFinancialKpi {
  id: string
  title: string
  value: string
  subtitle: string
  icon: DesignFinancialIcon
}

/** One fee category for the Fee per Sq.ft chart (data-driven; extras appear automatically). */
interface DesignFeePerSqftRow {
  category: string
  clientPOAmount: number
  feePerSqft: number
}

interface DesignDurationRow {
  label: string
  days: number
}

interface DesignProjectAnalytics {
  details: DesignProjectDetails
  financialSummary: DesignFinancialKpi[]
  feePerSqft: DesignFeePerSqftRow[]
  duration: DesignDurationRow[]
}

function financialSummary(
  totalValue: string,
  vendorsPayable: string,
  profitPct: string,
  designFee: string,
): DesignFinancialKpi[] {
  return [
    {
      id: 'total-value',
      title: 'Total Project Value',
      value: totalValue,
      subtitle: 'Total client PO value for this project.',
      icon: 'value',
    },
    {
      id: 'vendors-payable',
      title: 'Vendors Payable',
      value: vendorsPayable,
      subtitle: 'Total vendor PO amount for this project.',
      icon: 'payable',
    },
    {
      id: 'profit-pct',
      title: 'Profit Percentage',
      value: profitPct,
      subtitle: 'Client PO minus vendor paid, divided by client PO.',
      icon: 'profit',
    },
    {
      id: 'total-design-fee',
      title: 'Total Design Fee',
      value: designFee,
      subtitle: 'Total Design Services client PO value.',
      icon: 'fee',
    },
  ]
}

const FEE_CATEGORY_COLORS: Record<string, string> = {
  Design: CHART_COLORS.teal,
  Build: CHART_COLORS.amber,
  Consultancy: CHART_COLORS.blue,
  'Build Services': CHART_COLORS.teal,
  'Design & Diligence': CHART_COLORS.blue,
  Expenses: CHART_COLORS.orange,
}

const EXTRA_FEE_CATEGORY_COLORS = [
  CHART_COLORS.purple,
  CHART_COLORS.green,
  CHART_COLORS.orange,
  CHART_COLORS.red,
  CHART_COLORS.grey,
]

function feeCategoryColor(category: string, index: number): string {
  return (
    FEE_CATEGORY_COLORS[category] ??
    EXTRA_FEE_CATEGORY_COLORS[index % EXTRA_FEE_CATEGORY_COLORS.length]!
  )
}

function duration(planned: number, actual: number): DesignDurationRow[] {
  return [
    { label: 'Planned Duration', days: planned },
    { label: 'Actual Duration', days: actual },
  ]
}

function projectValue(project: Project): number {
  return project.totalClientPOValue ?? project.projectValue ?? 0
}

function projectDesignFee(project: Project): number {
  if (project.totalDesignServiceValue != null) return project.totalDesignServiceValue
  const sqft = projectSqft(project) ?? 0
  return project.designFeePerSqft ? Math.round(project.designFeePerSqft * sqft) : 0
}

function projectProfitPercent(project: Project): string {
  const clientPoAmount = projectValue(project)
  const vendorPaid = project.paidVendorAmount || 0
  if (clientPoAmount <= 0) return '0%'
  return `${Math.round(((clientPoAmount - vendorPaid) / clientPoAmount) * 1000) / 10}%`
}

function projectFeePerSqft(project: Project, area: number): DesignFeePerSqftRow[] {
  return (project.feePerSqftCategories ?? []).map((row) => {
    const clientPOAmount = Number(row.clientPOAmount ?? 0)
    return {
      category: row.category,
      clientPOAmount,
      feePerSqft: area > 0 ? clientPOAmount / area : 0,
    }
  })
}

function buildDesignProjectAnalytics(project: Project): DesignProjectAnalytics {
  const sqft = projectSqft(project) ?? 0
  const startDate = parseDate(project.startDate)
  const expectedEndDate = parseDate(project.expectedEndDate)
  const plannedDays =
    startDate && expectedEndDate
      ? Math.max(
          0,
          Math.round((startOfDay(expectedEndDate).getTime() - startOfDay(startDate).getTime()) / 86_400_000),
        )
      : 0
  const actualEndDate =
    parseDate(project.completedAt) ??
    parseDate(project.cancelledAt) ??
    parseDate(project.archivedAt) ??
    new Date()
  const actualDays =
    startDate
      ? Math.max(
          0,
          Math.round((startOfDay(actualEndDate).getTime() - startOfDay(startDate).getTime()) / 86_400_000),
        )
      : 0

  return {
    details: {
      projectName: project.name,
      carpetArea: sqft > 0 ? `${formatCompactNumber(sqft)} sqft` : '—',
      headcount: project.headcount != null ? formatCompactNumber(project.headcount) : '—',
      building: project.building || project.location || '—',
      clientSector: project.sector || '—',
      projectManager: project.projectManager || '—',
    },
    financialSummary: financialSummary(
      formatProjectFinancialMoney(projectValue(project)),
      formatProjectFinancialMoney(project.totalVendorPOValue || 0),
      projectProfitPercent(project),
      formatProjectFinancialMoney(projectDesignFee(project)),
    ),
    feePerSqft: projectFeePerSqft(project, sqft),
    duration: duration(plannedDays, actualDays),
  }
}

interface FeePerSqftChartRow {
  category: string
  clientPOAmount: number
  feePerSqft: number
  color: string
}

/** Chart rows from whatever fee categories exist on the project (data-driven). */
function buildFeePerSqftChartData(
  rows: readonly DesignFeePerSqftRow[],
): FeePerSqftChartRow[] {
  return rows
    .filter((r) => r.category.trim().length > 0)
    .map((r, index) => ({
      category: r.category,
      clientPOAmount: r.clientPOAmount,
      feePerSqft: r.feePerSqft,
      color: feeCategoryColor(r.category, index),
    }))
}

interface ChartSeriesLegendItem {
  label: string
  color: string
}

function ChartSeriesLegend({ items }: { items: ChartSeriesLegendItem[] }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 1.5,
      }}
    >
      {items.map((item) => (
        <Box key={item.label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '2px',
              bgcolor: item.color,
              flexShrink: 0,
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: 1.2 }}
          >
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Dashboard — Projects KPI detail drawer.
 * Same right-side listing-table pattern as the Revenue KPI drawer.
 */

type ClickableProjectKpiId =
  | 'active'
  | 'completed'
  | 'pipeline'
  | 'cancelled'
  | 'archived'

const CLICKABLE_PROJECT_KPI_IDS: Set<string> = new Set<string>([
  'active',
  'completed',
  'pipeline',
  'cancelled',
  'archived',
])

const KPI_STATUS: Record<ClickableProjectKpiId, Project['status']> = {
  active: 'Live',
  completed: 'Completed',
  pipeline: 'Pitch',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

interface DrawerColumn {
  key: string
  label: string
  format?: 'status' | 'date'
}

const STATUS_TYPE_BY_LABEL: Record<string, StatusType> = {
  Live: 'live',
  Pitch: 'pitch',
  Completed: 'completed',
  Cancelled: 'cancelled',
  Archived: 'archived',
  'Execution Ongoing': 'execution_ongoing',
  'Quotation Ready': 'quotation_ready',
  'Planning In Progress': 'planning_in_progress',
}

function projectStage(project: Project): string {
  const progress = project.progress?.trim()
  if (progress) return progress
  return project.status
}

function columnsForKpi(
  kpiId: ClickableProjectKpiId,
  includeStartDate: boolean,
): DrawerColumn[] {
  const base: DrawerColumn[] = [
    { key: 'name', label: 'Project Name' },
    { key: 'client', label: 'Client' },
    { key: 'manager', label: 'Project Manager' },
  ]

  if (kpiId === 'active') {
    const cols: DrawerColumn[] = [...base]
    if (includeStartDate) cols.push({ key: 'startDate', label: 'Project Start Date', format: 'date' })
    return cols
  }

  if (kpiId === 'pipeline') {
    return [...base, { key: 'stage', label: 'Stage', format: 'status' }]
  }

  return base
}

function toRow(project: Project): Record<string, string> {
  return {
    id: project.id,
    name: project.name,
    client: project.customerName || '—',
    manager: project.projectManager || '—',
    stage: projectStage(project),
    startDate: project.startDate ? formatDate(project.startDate) : '',
  }
}

function renderCell(value: string, format?: DrawerColumn['format']) {
  if (format === 'status' && value) {
    const status = STATUS_TYPE_BY_LABEL[value] ?? 'in_progress'
    return <StatusBadge status={status} label={value} size="small" />
  }
  return value || '—'
}

interface ProjectKpiDrawerProps {
  open: boolean
  onClose: () => void
  kpi: ProjectOverviewKpi | null
  projects: Project[]
}

function ProjectKpiDrawer({ open, onClose, kpi, projects }: ProjectKpiDrawerProps) {
  const [search, setSearch] = useState('')

  const kpiId = kpi && CLICKABLE_PROJECT_KPI_IDS.has(kpi.id)
    ? (kpi.id as ClickableProjectKpiId)
    : null

  useEffect(() => {
    setSearch('')
  }, [kpi?.id])

  const sourceRows = useMemo(() => {
    if (!kpiId) return []
    const status = KPI_STATUS[kpiId]
    return projects.filter((project) => project.status === status).map(toRow)
  }, [kpiId, projects])

  const includeStartDate = useMemo(
    () => kpiId === 'active' && sourceRows.some((row) => Boolean(row.startDate)),
    [kpiId, sourceRows],
  )

  const columns = kpiId ? columnsForKpi(kpiId, includeStartDate) : []

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sourceRows
    return sourceRows.filter((row) =>
      columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(query)),
    )
  }, [columns, search, sourceRows])

  if (!kpi || !kpiId) return null

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      slotProps={{
        backdrop: { sx: { backgroundColor: 'rgba(0,0,0,0.18)' } },
      }}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: '78%', md: 880 },
          maxWidth: 960,
          minWidth: { sm: 640 },
          boxShadow: '-4px 0 24px rgba(0,0,0,0.10)',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.paper',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          px: 3,
          pt: 2.5,
          pb: 2,
          flexShrink: 0,
        }}
      >
        <Box sx={{ pr: 2 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'text.primary', lineHeight: 1.4 }}>
            {kpi.title}
          </Typography>
          <Typography
            sx={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: -0.4,
              lineHeight: 1.2,
              mt: 0.5,
            }}
          >
            {kpi.value}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, mt: 0.5 }}>
            {kpi.subtitle}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close" sx={{ mt: -0.5 }}>
          <X size={18} />
        </IconButton>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
          px: 3,
          pb: 2,
          flexShrink: 0,
        }}
      >
        <SearchInput
          size="sm"
          placeholder="Search..."
          value={search}
          onChange={setSearch}
          debounce={200}
          sx={{ flex: '1 1 180px', minWidth: 160, maxWidth: 280 }}
        />
      </Box>

      <Box sx={{ px: 3, pb: 3, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <TableContainer
          sx={{
            overflowX: 'auto',
            overflowY: 'auto',
            minHeight: 0,
            border: `1px solid ${tokens.color.neutral[200]}`,
            borderRadius: 1,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
          }}
        >
          <Table
            size="small"
            stickyHeader
            sx={{
              width: '100%',
              tableLayout: 'auto',
              '& .MuiTableCell-head': {
                fontSize: 12,
                fontWeight: 600,
                color: 'text.secondary',
                bgcolor: tokens.color.neutral[50],
                borderBottom: `1px solid ${tokens.color.neutral[200]}`,
                py: 1,
                px: 1.5,
                whiteSpace: 'nowrap',
                lineHeight: 1.35,
              },
              '& .MuiTableCell-body': {
                fontSize: 13,
                py: 1,
                px: 1.5,
                borderBottom: `1px solid ${tokens.color.neutral[100]}`,
                whiteSpace: 'nowrap',
                color: 'text.primary',
              },
            }}
          >
            <TableHead>
              <TableRow>
                {columns.map((col) => (
                  <TableCell key={col.key}>{col.label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id} hover={false}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      {renderCell(row[col.key], col.format)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} sx={{ py: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No projects match the current filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Drawer>
  )
}

/**
 * Dashboard — Projects Overview
 * KPI cards + sector tags + status / design delivery distribution
 */

const DESIGN_VS_BUILD_COLORS = {
  design_only: CHART_COLORS.blue,
  design_build: CHART_COLORS.teal,
} as const

const ICON_MAP: Record<ProjectOverviewKpi['icon'], { node: ReactNode; color: string }> = {
  active: {
    node: <PlayCircle size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.teal,
  },
  completed: {
    node: <CheckCircle2 size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.green,
  },
  pipeline: {
    node: <Sparkles size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.blue,
  },
  cancelled: {
    node: <XCircle size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.red,
  },
  archived: {
    node: <Archive size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.grey,
  },
  size: {
    node: <Building2 size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.amber,
  },
  conversion: {
    node: <Clock3 size={18} strokeWidth={1.75} />,
    color: tokens.color.primary[600],
  },
}

function ProjectOverviewKpiCard({
  kpi,
  onClick,
  loading = false,
}: {
  kpi: ProjectOverviewKpi
  onClick?: () => void
  loading?: boolean
}) {
  const theme = useTheme()
  const iconMeta = ICON_MAP[kpi.icon]

  return (
    <Paper
      elevation={0}
      onClick={loading ? undefined : onClick}
      sx={{
        height: '100%',
        p: 2,
        borderRadius: '10px',
        border: `1px solid ${tokens.color.neutral[200]}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: 'background.paper',
        ...(!loading &&
          onClick && {
            cursor: 'pointer',
            transition: 'border-color 0.15s, box-shadow 0.15s',
            '&:hover': {
              borderColor: tokens.color.primary[300],
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            },
          }),
      }}
    >
      {loading ? (
        <DashboardKpiCardSkeleton />
      ) : (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={600}
              sx={{ fontSize: 11, letterSpacing: 0.3, lineHeight: 1.35, pr: 0.5 }}
            >
              {kpi.title}
            </Typography>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: '8px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(iconMeta.color, theme.palette.mode === 'dark' ? 0.2 : 0.1),
                color: iconMeta.color,
              }}
            >
              {iconMeta.node}
            </Box>
          </Box>

          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ fontSize: { xs: 18, md: 20 }, lineHeight: 1.2, letterSpacing: -0.3 }}
          >
            {kpi.value}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, mt: 'auto' }}>
            {kpi.subtitle}
          </Typography>
        </>
      )}
    </Paper>
  )
}

function StatusLegendItem({ slice }: { slice: DonutSlice }) {
  const projectLabel = slice.value === 1 ? 'Project' : 'Projects'

  return (
    <Stack direction="row" alignItems="center" gap={1.25} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '2px',
          flexShrink: 0,
          bgcolor: slice.color ?? tokens.color.neutral[400],
        }}
      />
      <Typography
        variant="body2"
        sx={{ fontSize: 12, lineHeight: 1.4, color: 'text.primary' }}
      >
        {slice.label} — {slice.value} {projectLabel}
      </Typography>
    </Stack>
  )
}

function SectorTagChip({ tag }: { tag: SectorTag }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const colors = getSectorTagSx(tag.name, isDark ? 'dark' : 'light')

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.75,
        borderRadius: '9999px',
        bgcolor: colors.bg,
        color: colors.color,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {tag.name}
      <Box
        component="span"
        sx={{
          fontWeight: 700,
          opacity: 0.9,
        }}
      >
        ({tag.count})
      </Box>
    </Box>
  )
}

interface ProjectsOverviewSectionProps {
  projects: Project[]
  dateRange?: string
  clientFilter?: string
  statusFilter?: string
  pmFilter?: string
  action?: ReactNode
  loading?: boolean
}

function ProjectsOverviewSection({
  projects,
  dateRange = 'This Year',
  clientFilter = 'All Clients',
  statusFilter = 'All Status',
  pmFilter = 'All Managers',
  action,
  loading = false,
}: ProjectsOverviewSectionProps) {
  const dispatch = useAppDispatch()
  const sectors = useAppSelector((s) => s.settings.sectors)

  const [drawerKpi, setDrawerKpi] = useState<ProjectOverviewKpi | null>(null)

  useEffect(() => {
    void dispatch(fetchSectors())
  }, [dispatch])

  const filteredProjects = useMemo(
    () =>
      filterProjectsForDashboard(projects, {
        dateRange,
        clientFilter,
        statusFilter,
        pmFilter,
      }),
    [projects, dateRange, clientFilter, statusFilter, pmFilter],
  )

  const overviewKpis = useMemo(() => buildProjectOverviewKpis(projects), [projects])

  const projectStatusDistribution = useMemo(
    () => buildProjectStatusDistribution(projects),
    [projects],
  )
  const totalProjects = projectStatusDistribution.reduce((sum, s) => sum + s.value, 0)
  const designBuildDonutData = useMemo(() => buildDesignVsBuildData(projects), [projects])
  const designBuildTotal = designBuildDonutData.reduce((sum, s) => sum + s.value, 0)
  const designBuildDonutSlices = designBuildDonutData.map((s) => ({
    ...s,
    color: DESIGN_VS_BUILD_COLORS[s.key as keyof typeof DESIGN_VS_BUILD_COLORS],
  }))
  const sectorTags = useMemo(
    () => buildSectorTagsFromMaster(sectors, filteredProjects),
    [sectors, filteredProjects],
  )

  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
            Projects Overview
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
            High-level overview of all projects across the portfolio.
          </Typography>
        </Box>

        {action}
      </Box>

      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        {overviewKpis.map((kpi) => (
          <Grid key={kpi.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <ProjectOverviewKpiCard
              kpi={kpi}
              loading={loading}
              onClick={
                !loading && CLICKABLE_PROJECT_KPI_IDS.has(kpi.id)
                  ? () => setDrawerKpi(kpi)
                  : undefined
              }
            />
          </Grid>
        ))}
      </Grid>

      <ProjectKpiDrawer
        open={!!drawerKpi}
        onClose={() => setDrawerKpi(null)}
        kpi={drawerKpi}
        projects={projects}
      />

      <Box sx={{ mb: 2.5 }}>
        <ChartCard
          title="Sector Tag"
          subtitle="Projects grouped by Sector Master"
        >
          {loading ? (
            <DashboardSectionLoader minHeight={80} size={22} />
          ) : (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              alignItems: 'center',
            }}
          >
            {sectorTags.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                No live project sectors found.
              </Typography>
            ) : (
              sectorTags.map((tag) => (
                <SectorTagChip key={tag.id} tag={tag} />
              ))
            )}
          </Box>
          )}
        </ChartCard>
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard
            title="Project Status Distribution"
            subtitle="Quick overview of all project statuses"
          >
            {loading ? (
              <DashboardSectionLoader minHeight={300} />
            ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'stretch', md: 'center' },
                gap: { xs: 3, md: 6 },
              }}
            >
              <Box
                sx={{
                  flex: { xs: '1 1 auto', md: '0 0 40%' },
                  maxWidth: { md: 260 },
                  alignSelf: { md: 'flex-start' },
                  mr: { md: 1 },
                }}
              >
                <DonutChart
                  data={projectStatusDistribution}
                  height={300}
                  showLegend={false}
                  centerValue={String(totalProjects)}
                  centerLabel="Projects"
                />
              </Box>

              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  py: { md: 1 },
                  pl: { md: 2 },
                }}
              >
                <Stack spacing={1.25}>
                  {projectStatusDistribution.map((slice) => (
                    <StatusLegendItem key={slice.key} slice={slice} />
                  ))}
                </Stack>
              </Box>
            </Box>
            )}
          </ChartCard>
        </Grid>

        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard
            title="Design Only vs Design & Build"
            subtitle="Split of project delivery types"
          >
            {loading ? (
              <DashboardSectionLoader minHeight={300} />
            ) : (
            <DonutChart
              data={designBuildDonutSlices}
              height={300}
              centerValue={String(designBuildTotal)}
              centerLabel="Projects"
            />
            )}
          </ChartCard>
        </Grid>
      </Grid>
    </Box>
  )
}

/**
 * Dashboard — Project Analytics
 * Project Lifecycle & Size timeline + yearly completions
 */

/* ─────────────────── constants ─────────────────── */

const FILTER_LABEL_SX = {
  display: 'block',
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  mb: 0.5,
} as const

const AUTOCOMPLETE_SX = {
  minWidth: { xs: '100%', sm: 200 },
  maxWidth: { xs: '100%', sm: 260 },
  '& .MuiOutlinedInput-root': {
    height: 32,
    fontSize: 12,
    bgcolor: 'action.hover',
    '& fieldset': {
      border: 'none',
    },
  },
  '& .MuiInputBase-input': {
    fontSize: 12,
    py: 0,
    color: 'text.primary',
    opacity: 1,
  },
} as const

const ALL_PROJECTS_VALUE = 'ALL_PROJECTS'
const ALL_PROJECTS_OPTION = { value: ALL_PROJECTS_VALUE, label: 'All Projects' }

/** Map event type → fixed color */
const EVENT_COLORS: Record<LifecycleEventType, string> = {
  Pitch: CHART_COLORS.blue,
  Live: CHART_COLORS.teal,
  Completed: CHART_COLORS.green,
  Cancelled: CHART_COLORS.red,
  Archived: CHART_COLORS.orange,
}

const LEGEND_ITEMS = [
  { label: 'Pitch', color: CHART_COLORS.blue },
  { label: 'Live', color: CHART_COLORS.teal },
  { label: 'Completed', color: CHART_COLORS.green },
  { label: 'Cancelled', color: CHART_COLORS.red },
  { label: 'Archived', color: CHART_COLORS.orange },
] as const

/** FY month labels shown on the X-axis (Apr -> Mar, no years). */
const FY_MONTH_SPECS: { month: number; yearOffset: number }[] = [
  { month: 3, yearOffset: 0 },  // Apr
  { month: 4, yearOffset: 0 },  // May
  { month: 5, yearOffset: 0 },  // Jun
  { month: 6, yearOffset: 0 },  // Jul
  { month: 7, yearOffset: 0 },  // Aug
  { month: 8, yearOffset: 0 },  // Sep
  { month: 9, yearOffset: 0 },  // Oct
  { month: 10, yearOffset: 0 }, // Nov
  { month: 11, yearOffset: 0 }, // Dec
  { month: 0, yearOffset: 1 },  // Jan
  { month: 1, yearOffset: 1 },  // Feb
  { month: 2, yearOffset: 1 },  // Mar
]

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

const VISIBLE_ROWS = 6
const ROW_HEIGHT = 58
const BAR_HEIGHT = 18
const BAR_RADIUS = 9
const MIN_SEGMENT_PX = 6
const TERMINAL_SEGMENT_MS = 45 * 24 * 3600 * 1000
/** Tight left gutter: names end just before the plot (was oversized empty gap). */
const SVG_LEFT_MARGIN = 128
const SVG_RIGHT_MARGIN = 20
const SVG_TOP_MARGIN = 8
const SVG_BOTTOM_MARGIN = 48
const NAME_GAP_PX = 8

/* ─────────────────── helpers ─────────────────── */

function formatSqft(value: number): string {
  return Math.round(value).toLocaleString('en-IN')
}

function resolveFyStartYear(refTs: number): number {
  const ref = new Date(refTs)
  const month = ref.getMonth()
  const year = ref.getFullYear()
  // Financial year is Apr Y -> Mar Y+1.
  return month >= 3 ? year : year - 1
}

function buildFyAxis(refTs: number): {
  domainStart: number
  domainEnd: number
  ticks: { ts: number; label: string }[]
} {
  const startYear = resolveFyStartYear(refTs)
  const ticks = FY_MONTH_SPECS.map(({ month, yearOffset }) => {
    const ts = new Date(startYear + yearOffset, month, 1).getTime()
    return { ts, label: MONTH_SHORT[month]! }
  })
  const domainStart = ticks[0]!.ts
  // End of final financial-year month.
  const last = FY_MONTH_SPECS[FY_MONTH_SPECS.length - 1]!
  const domainEnd = new Date(
    startYear + last.yearOffset,
    last.month + 1,
    0,
    23,
    59,
    59,
    999,
  ).getTime()
  return { domainStart, domainEnd, ticks }
}

interface LifecycleSegment {
  event: LifecycleEvent
  start: number
  end: number
}

function buildLifecycleSegments(
  events: LifecycleEvent[],
  now: number,
): LifecycleSegment[] {
  const sorted = [...events].sort((a, b) => a.date - b.date)
  return sorted.map((event, index) => {
    const start = event.date
    let end: number
    if (index < sorted.length - 1) {
      end = sorted[index + 1]!.date
    } else if (event.eventType === 'Pitch' || event.eventType === 'Live') {
      end = Math.max(now, start)
    } else {
      end = start + TERMINAL_SEGMENT_MS
    }
    if (end <= start) {
      end = start + 7 * 24 * 3600 * 1000
    }
    return { event, start, end }
  })
}

/** SVG path for a rect with per-corner radii. */
function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: { tl: number; tr: number; br: number; bl: number },
): string {
  const width = Math.max(w, 0)
  const height = Math.max(h, 0)
  const r = {
    tl: Math.min(radii.tl, width / 2, height / 2),
    tr: Math.min(radii.tr, width / 2, height / 2),
    br: Math.min(radii.br, width / 2, height / 2),
    bl: Math.min(radii.bl, width / 2, height / 2),
  }
  return [
    `M ${x + r.tl} ${y}`,
    `H ${x + width - r.tr}`,
    r.tr > 0 ? `A ${r.tr} ${r.tr} 0 0 1 ${x + width} ${y + r.tr}` : `L ${x + width} ${y}`,
    `V ${y + height - r.br}`,
    r.br > 0 ? `A ${r.br} ${r.br} 0 0 1 ${x + width - r.br} ${y + height}` : `L ${x + width} ${y + height}`,
    `H ${x + r.bl}`,
    r.bl > 0 ? `A ${r.bl} ${r.bl} 0 0 1 ${x} ${y + height - r.bl}` : `L ${x} ${y + height}`,
    `V ${y + r.tl}`,
    r.tl > 0 ? `A ${r.tl} ${r.tl} 0 0 1 ${x + r.tl} ${y}` : `L ${x} ${y}`,
    'Z',
  ].join(' ')
}

function wrapProjectName(name: string, maxChars = 18): string[] {
  if (name.length <= maxChars) return [name]
  const parts = name.split(/\s+[–—-]\s+/)
  if (parts.length >= 2) {
    return [parts[0]!, parts.slice(1).join(' – ')].map((line) =>
      line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line,
    )
  }
  const mid = Math.min(maxChars, name.lastIndexOf(' ', maxChars))
  if (mid > 8) {
    return [name.slice(0, mid), name.slice(mid + 1, mid + 1 + maxChars)]
  }
  return [`${name.slice(0, maxChars - 1)}…`]
}

/* ─────────────────── tooltip ─────────────────── */

interface TooltipState {
  event: LifecycleEvent
  x: number
  y: number
}

function LifecycleChartTooltip({ tip }: { tip: TooltipState }) {
  const { event, x, y } = tip
  const stageColor = EVENT_COLORS[event.eventType]
  return (
    <Box
      sx={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-50%, calc(-100% - 12px))',
        zIndex: 9999,
        bgcolor: tokens.color.neutral[900],
        color: tokens.color.neutral[50],
        borderRadius: '8px',
        boxShadow: `0 8px 24px ${alpha(tokens.color.neutral[900], 0.35)}`,
        px: 1.75,
        py: 1.25,
        minWidth: 200,
        pointerEvents: 'none',
        '&::after': {
          content: '""',
          position: 'absolute',
          left: '50%',
          bottom: -6,
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: `6px solid ${tokens.color.neutral[900]}`,
        },
      }}
    >
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block', mb: 0.5 }}>
        <Box component="span" sx={{ color: tokens.color.neutral[400] }}>
          Project:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: tokens.color.neutral[50] }}>
          {event.projectName}
        </Box>
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block', mb: 0.25 }}>
        <Box component="span" sx={{ color: tokens.color.neutral[400] }}>
          Stage:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 700, color: stageColor }}>
          {event.eventType}
        </Box>
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block', mb: 0.25 }}>
        <Box component="span" sx={{ color: tokens.color.neutral[400] }}>
          Date:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: tokens.color.neutral[50] }}>
          {event.dateLabel}
        </Box>
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block' }}>
        <Box component="span" sx={{ color: tokens.color.neutral[400] }}>
          Project Size:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: tokens.color.neutral[50] }}>
          {event.sqft > 0 ? `${formatSqft(event.sqft)} sq.ft.` : '—'}
        </Box>
      </Typography>
    </Box>
  )
}

/* ─────────────────── custom SVG chart ─────────────────── */

interface LifecycleChartProps {
  lines: LifecycleProjectLine[]
  domainStart: number
  domainEnd: number
  ticks: { ts: number; label: string }[]
  onHover: (tip: TooltipState | null) => void
}

function LifecycleChart({
  lines,
  domainStart,
  domainEnd,
  ticks,
  onHover,
}: LifecycleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(700)
  const now = useMemo(() => Date.now(), [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(el)
    setWidth(el.clientWidth || 700)
    return () => ro.disconnect()
  }, [])

  const svgWidth = width
  const plotWidth = Math.max(svgWidth - SVG_LEFT_MARGIN - SVG_RIGHT_MARGIN, 1)
  /** Cap at configured max; no internal scrollbar — extra projects are not rendered. */
  const visibleLines = lines.slice(0, VISIBLE_ROWS)
  const plotHeight = visibleLines.length * ROW_HEIGHT
  const timeRange = domainEnd - domainStart || 1

  const dateToX = useCallback(
    (ts: number) => SVG_LEFT_MARGIN + ((ts - domainStart) / timeRange) * plotWidth,
    [domainStart, timeRange, plotWidth],
  )

  const handleMouseMove = useCallback(
    (ev: ReactMouseEvent<SVGElement>, event: LifecycleEvent) => {
      onHover({ event, x: ev.clientX, y: ev.clientY })
    },
    [onHover],
  )
  const handleMouseLeave = useCallback(() => onHover(null), [onHover])

  return (
    <Box ref={containerRef} sx={{ width: '100%', overflow: 'hidden' }}>
      <svg
        width="100%"
        height={plotHeight + SVG_TOP_MARGIN}
        style={{ display: 'block' }}
      >
        {ticks.map((tick) => {
          const x = dateToX(tick.ts)
          if (x < SVG_LEFT_MARGIN - 1 || x > svgWidth - SVG_RIGHT_MARGIN + 1) return null
          return (
            <line
              key={`grid-${tick.ts}`}
              x1={x}
              y1={SVG_TOP_MARGIN}
              x2={x}
              y2={SVG_TOP_MARGIN + plotHeight}
              stroke={tokens.color.neutral[200]}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          )
        })}

        {visibleLines.map((line, rowIdx) => {
          const rowTop = SVG_TOP_MARGIN + rowIdx * ROW_HEIGHT
          const barY = rowTop + (ROW_HEIGHT - BAR_HEIGHT) / 2
          const nameLines = wrapProjectName(line.projectName)
          const nameBlockHeight = nameLines.length * 14
          const nameStartY = rowTop + (ROW_HEIGHT - nameBlockHeight) / 2 + 11
          const segments = buildLifecycleSegments(line.events, now)
            .map((seg) => ({
              ...seg,
              start: Math.max(seg.start, domainStart),
              end: Math.min(seg.end, domainEnd),
            }))
            .filter((seg) => seg.end > seg.start)

          return (
            <g key={line.projectId}>
              {nameLines.map((textLine, i) => (
                <text
                  key={`${line.projectId}-name-${i}`}
                  x={SVG_LEFT_MARGIN - NAME_GAP_PX}
                  y={nameStartY + i * 14}
                  textAnchor="end"
                  fontSize={11}
                  fill={tokens.color.neutral[700]}
                  style={{ userSelect: 'none' }}
                >
                  {textLine}
                </text>
              ))}

              {segments.map((seg, segIdx) => {
                const isFirst = segIdx === 0
                const isLast = segIdx === segments.length - 1
                let x = dateToX(seg.start)
                let w = dateToX(seg.end) - x
                if (w < MIN_SEGMENT_PX) {
                  w = MIN_SEGMENT_PX
                  if (x + w > svgWidth - SVG_RIGHT_MARGIN) {
                    x = svgWidth - SVG_RIGHT_MARGIN - w
                  }
                }
                const path = roundedRectPath(x, barY, w, BAR_HEIGHT, {
                  tl: isFirst ? BAR_RADIUS : 0,
                  bl: isFirst ? BAR_RADIUS : 0,
                  tr: isLast ? BAR_RADIUS : 0,
                  br: isLast ? BAR_RADIUS : 0,
                })
                return (
                  <path
                    key={seg.event.id}
                    d={path}
                    fill={EVENT_COLORS[seg.event.eventType]}
                    style={{ cursor: 'pointer' }}
                    onMouseMove={(e) => handleMouseMove(e, seg.event)}
                    onMouseLeave={handleMouseLeave}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>

      {/* Fixed X-axis */}
      <svg
        width="100%"
        height={SVG_BOTTOM_MARGIN}
        style={{ display: 'block' }}
      >
        <line
          x1={SVG_LEFT_MARGIN}
          y1={0}
          x2={svgWidth - SVG_RIGHT_MARGIN}
          y2={0}
          stroke={tokens.color.neutral[200]}
          strokeWidth={1}
        />
        {ticks.map((tick) => {
          const x = dateToX(tick.ts)
          if (x < SVG_LEFT_MARGIN - 1 || x > svgWidth - SVG_RIGHT_MARGIN + 1) return null
          return (
            <text
              key={`label-${tick.ts}`}
              x={x}
              y={18}
              textAnchor="middle"
              fontSize={11}
              fill={tokens.color.neutral[500]}
            >
              {tick.label}
            </text>
          )
        })}
        <text
          x={SVG_LEFT_MARGIN + plotWidth / 2}
          y={38}
          textAnchor="middle"
          fontSize={11}
          fill={tokens.color.neutral[500]}
        >
          Financial Year Months
        </text>
      </svg>
    </Box>
  )
}

/* ─────────────────── section component ─────────────────── */

interface ProjectAnalyticsSectionProps {
  projects: Project[]
  dateRange?: string
  clientFilter?: string
  statusFilter?: string
  pmFilter?: string
}

function ProjectAnalyticsSection({
  projects,
  clientFilter = 'All Clients',
  statusFilter = 'All Status',
  pmFilter = 'All Managers',
}: ProjectAnalyticsSectionProps) {
  const [projectId, setProjectId] = useState(ALL_PROJECTS_VALUE)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // Lifecycle chart ignores date-range filter so spans remain visible.
  const lifecycleProjects = useMemo(
    () =>
      filterProjectsForDashboard(projects, {
        dateRange: 'All Time',
        clientFilter,
        statusFilter,
        pmFilter,
      }),
    [projects, clientFilter, statusFilter, pmFilter],
  )

  const lifecycleData = useMemo(
    () => buildProjectLifecycleData(lifecycleProjects),
    [lifecycleProjects],
  )

  const projectOptions = useMemo(() => {
    const ids = new Set(lifecycleData.events.map((e) => e.projectId))
    return lifecycleProjects
      .filter((p) => ids.has(p.id))
      .map((p) => ({ value: p.id, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [lifecycleProjects, lifecycleData])

  const selectedProjectOption = useMemo(
    () => projectOptions.find((o) => o.value === projectId) ?? ALL_PROJECTS_OPTION,
    [projectOptions, projectId],
  )

  useEffect(() => {
    if (!projectOptions.some((o) => o.value === projectId)) {
      setProjectId(ALL_PROJECTS_VALUE)
    }
  }, [projectOptions, projectId])

  const handleProjectChange = (
    _event: SyntheticEvent,
    value: typeof ALL_PROJECTS_OPTION | null,
  ) => {
    if (value == null) return
    setProjectId(value.value)
  }

  const { lines } = useMemo(() => {
    if (projectId === ALL_PROJECTS_VALUE) return lifecycleData
    return {
      lines: lifecycleData.lines.filter((l) => l.projectId === projectId),
      events: lifecycleData.events.filter((e) => e.projectId === projectId),
    }
  }, [lifecycleData, projectId])

  const visibleEvents = useMemo(() => {
    if (projectId === ALL_PROJECTS_VALUE) return lifecycleData.events
    return lifecycleData.events.filter((e) => e.projectId === projectId)
  }, [lifecycleData, projectId])

  const fyAxis = useMemo(() => {
    const refTs = visibleEvents.length
      ? Math.max(...visibleEvents.map((e) => e.date))
      : Date.now()
    return buildFyAxis(refTs)
  }, [visibleEvents])

  const projectsCompletedByYear = useMemo(
    () => buildProjectsCompletedByYear(projects),
    [projects],
  )

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
          Project Analytics
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
          Overall project performance across duration, size, and conversion.
        </Typography>
      </Box>

      <Grid container spacing={2}>
        {/* ── Project Lifecycle & Size ── */}
        <Grid size={{ xs: 12 }}>
          <ChartCard
            title="Project Lifecycle & Size"
            subtitle="Project lifecycle distribution by project (Pitch → Live → Completed/Cancelled/Archived)."
            action={
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', md: 'row' },
                  alignItems: { xs: 'stretch', md: 'flex-start' },
                  gap: { xs: 1.5, md: 3 },
                }}
              >
                <Box sx={{ pt: { md: 0.5 } }}>
                  <ChartSeriesLegend items={[...LEGEND_ITEMS]} />
                </Box>
                <Box sx={{ width: { xs: '100%', sm: 220 } }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={600}
                    sx={FILTER_LABEL_SX}
                  >
                    Project
                  </Typography>
                  <Autocomplete
                    size="small"
                    disableClearable
                    options={[ALL_PROJECTS_OPTION, ...projectOptions]}
                    value={selectedProjectOption}
                    onChange={handleProjectChange}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, value) => option.value === value.value}
                    filterOptions={(options, state) => {
                      const q = state.inputValue.trim().toLowerCase()
                      if (!q) return options
                      return options.filter((o) => o.label.toLowerCase().includes(q))
                    }}
                    renderInput={(params) => (
                      <TextField {...params} placeholder="Search projects..." />
                    )}
                    slotProps={{
                      paper: {
                        sx: {
                          fontSize: 12,
                          '& .MuiAutocomplete-option': { fontSize: 12, minHeight: 36 },
                        },
                      },
                    }}
                    sx={{ ...AUTOCOMPLETE_SX, maxWidth: '100%' }}
                  />
                </Box>
              </Box>
            }
          >
            {lines.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
              >
                No projects with lifecycle events for the selected filters.
              </Typography>
            ) : (
              <LifecycleChart
                lines={lines}
                domainStart={fyAxis.domainStart}
                domainEnd={fyAxis.domainEnd}
                ticks={fyAxis.ticks}
                onHover={setTooltip}
              />
            )}
            {tooltip && <LifecycleChartTooltip tip={tooltip} />}
          </ChartCard>
        </Grid>

        {/* ── Projects Completed by Year ── */}
        <Grid size={{ xs: 12 }}>
          <ChartCard
            title="Projects Completed by Year"
            subtitle="Yearly completed project count"
          >
            {projectsCompletedByYear.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
              >
                No completed projects with completion dates.
              </Typography>
            ) : (
              <BarChart
                data={projectsCompletedByYear}
                xKey="year"
                height={260}
                bars={[{ key: 'completed', label: 'Completed', color: CHART_COLORS.green }]}
                showLegend={false}
              />
            )}
          </ChartCard>
        </Grid>
      </Grid>
    </Box>
  )
}

/**
 * Dashboard — Sector & Project Type Analytics
 */

const METRIC_SELECT_SX = { minWidth: 220, fontSize: 12, height: 32 } as const
const SELECT_SX = { minWidth: 120, fontSize: 12, height: 32 } as const
const MENU_ITEM_SX = { fontSize: 12 } as const

const SECTOR_FILTER_LABEL_SX = {
  display: 'block',
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  mb: 0.5,
} as const

function formatSectorSqft(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return `${n.toLocaleString('en-IN')} sqft`
}

function formatCompletedCount(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return Math.round(n).toLocaleString('en-IN')
}

function formatBarEndLabel(
  value: number | string,
  metric: SectorPerformanceMetric,
): string {
  if (metric === 'avgCompletedSqft') {
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(n)) return String(value)
    return `${n.toLocaleString('en-IN')} sqft`
  }
  return formatCompletedCount(value)
}

function SectorLimitSelect({
  value,
  onChange,
}: {
  value: SectorFilterValue
  onChange: (value: SectorFilterValue) => void
}) {
  return (
    <MuiSelect
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value as SectorFilterValue)}
      sx={SELECT_SX}
    >
      {SECTOR_FILTER_OPTIONS.map((opt) => (
        <MenuItem key={opt.value} value={opt.value} sx={MENU_ITEM_SX}>
          {opt.label}
        </MenuItem>
      ))}
    </MuiSelect>
  )
}

function SectorPerformanceTooltip({
  active,
  payload,
  metric,
}: TooltipContentProps & { metric: SectorPerformanceMetric }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry) return null
  const row = entry.payload as SectorPerformanceChartRow | undefined
  const sector = String(row?.sector ?? '')
  const raw = typeof row?.value === 'number' ? row.value : Number(row?.value)
  if (Number.isNaN(raw)) return null
  const meta = getSectorPerformanceMetricMeta(metric)

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: `1px solid ${tokens.color.neutral[200]}`,
        borderRadius: '8px',
        boxShadow: tokens.shadow.sm,
        px: 1.5,
        py: 1,
        width: 'max-content',
        minWidth: 160,
        maxWidth: 360,
        whiteSpace: 'nowrap',
      }}
    >
      <Typography variant="caption" fontWeight={600} sx={{ fontSize: 12, display: 'block' }}>
        {sector}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, display: 'block', mt: 0.25 }}>
        {meta.label}:{' '}
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {metric === 'avgCompletedSqft' ? formatSectorSqft(raw) : formatCompletedCount(raw)}
        </Box>
      </Typography>
    </Box>
  )
}

function SectorPerformanceChart({
  data,
  metric,
  xAxisLabel,
  height = 300,
}: {
  data: SectorPerformanceChartRow[]
  metric: SectorPerformanceMetric
  xAxisLabel: string
  height?: number
}) {
  const ct = useChartTheme()
  // Grow with row count so every Y label fits (esp. All Sectors) — no inner scroll.
  const pxPerRow = ct.isMobile ? 34 : 38
  const sizedHeight = Math.max(height, data.length * pxPerRow + 56)
  const h = ct.isMobile ? Math.round(sizedHeight * 0.92) : sizedHeight
  const axis = buildSectorPerformanceAxis(data, metric)
  const formatX =
    metric === 'avgCompletedSqft'
      ? (v: number | string) => {
          const n = typeof v === 'number' ? v : Number(v)
          if (Number.isNaN(n)) return String(v)
          return `${n.toLocaleString('en-IN')} sqft`
        }
      : (v: number | string) => formatCompletedCount(v)

  return (
    <Box sx={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={h}>
        <RechartsBarChart
          key={`${metric}-${xAxisLabel}`}
          data={data}
          layout="vertical"
          barCategoryGap="28%"
          margin={{
            top: 8,
            right: ct.isMobile ? 36 : 48,
            left: ct.isMobile ? 36 : 56,
            bottom: 28,
          }}
        >
          <CartesianGrid
            stroke={ct.gridProps.stroke}
            strokeDasharray={ct.gridProps.strokeDasharray}
            strokeOpacity={ct.gridProps.strokeOpacity}
            horizontal={false}
            vertical
          />
          <XAxis
            type="number"
            domain={[0, axis.domainMax]}
            ticks={axis.ticks}
            allowDecimals={metric !== 'completedCount'}
            tick={ct.axisStyle}
            tickLine={false}
            axisLine={{ stroke: ct.gridProps.stroke }}
            tickFormatter={formatX}
            label={{
              value: xAxisLabel,
              position: 'insideBottom',
              offset: -16,
              style: {
                fill: tokens.color.neutral[500],
                fontSize: 11,
                fontFamily: ct.fontFamily,
              },
            }}
          />
          <YAxis
            type="category"
            dataKey="sector"
            interval={0}
            minTickGap={0}
            tick={{ ...ct.axisStyle, textAnchor: 'end' }}
            tickMargin={8}
            tickLine={false}
            axisLine={{ stroke: ct.gridProps.stroke }}
            width={ct.isMobile ? 96 : 128}
            label={{
              value: 'Sectors',
              angle: -90,
              position: 'insideLeft',
              offset: ct.isMobile ? -24 : -38,
              style: {
                fill: tokens.color.neutral[500],
                fontSize: 11,
                fontFamily: ct.fontFamily,
              },
            }}
          />
          <Tooltip
            isAnimationActive={false}
            animationDuration={0}
            content={(props) => <SectorPerformanceTooltip {...props} metric={metric} />}
            allowEscapeViewBox={{ x: true, y: true }}
            offset={12}
            wrapperStyle={ct.tooltipWrapperStyle}
            cursor={{
              fill: ct.theme.palette.action.hover,
              stroke: 'none',
              fillOpacity: 0.45,
            }}
          />
          <Bar
            dataKey="value"
            name={xAxisLabel}
            radius={[0, 8, 8, 0]}
            maxBarSize={22}
            isAnimationActive={false}
            activeBar={false}
          >
            {data.map((row) => (
              <Cell key={row.sector} fill={row.color} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value) => formatBarEndLabel(value as number | string, metric)}
              style={{
                fill: tokens.color.neutral[700],
                fontSize: 12,
                fontWeight: 600,
                fontFamily: ct.fontFamily,
              }}
            />
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </Box>
  )
}

function SectorAnalyticsSection({
  projects,
  backendSectorPerformance,
}: {
  projects: Project[]
  backendSectorPerformance?: SectorPerformanceRow[]
}) {
  const [performanceFilter, setPerformanceFilter] = useState<SectorFilterValue>('top5')
  const [performanceMetric, setPerformanceMetric] =
    useState<SectorPerformanceMetric>('completedCount')

  const performanceData = useMemo(
    () =>
      buildSectorPerformanceChartData(
        projects,
        performanceFilter,
        performanceMetric,
        backendSectorPerformance,
      ),
    [projects, performanceFilter, performanceMetric, backendSectorPerformance],
  )
  const performanceMeta = getSectorPerformanceMetricMeta(performanceMetric)
  const emptyPerformanceMessage =
    performanceMetric === 'completedCount'
      ? 'No completed projects found for sector performance.'
      : 'No project area data found for sector performance.'

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
          Sector & Project Type Analytics
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
          Project distribution by sector and delivery type.
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12 }}>
          <ChartCard
            title="Sector Performance"
            subtitle="Compare completed projects and average project size by sector."
            action={
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: { xs: 'stretch', sm: 'flex-start' },
                  gap: 1.5,
                }}
              >
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={600}
                    sx={SECTOR_FILTER_LABEL_SX}
                  >
                    Metric
                  </Typography>
                  <MuiSelect
                    size="small"
                    value={performanceMetric}
                    onChange={(e) =>
                      setPerformanceMetric(e.target.value as SectorPerformanceMetric)
                    }
                    sx={METRIC_SELECT_SX}
                  >
                    {SECTOR_PERFORMANCE_METRIC_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value} sx={MENU_ITEM_SX}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </MuiSelect>
                </Box>
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={600}
                    sx={SECTOR_FILTER_LABEL_SX}
                  >
                    Show Top
                  </Typography>
                  <SectorLimitSelect
                    value={performanceFilter}
                    onChange={setPerformanceFilter}
                  />
                </Box>
              </Box>
            }
          >
            {performanceData.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontSize: 12, py: 8, textAlign: 'center' }}
              >
                {emptyPerformanceMessage}
              </Typography>
            ) : (
              <>
                <SectorPerformanceChart
                  data={performanceData}
                  metric={performanceMetric}
                  xAxisLabel={performanceMeta.xAxisLabel}
                  height={300}
                />
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
                  <ChartSeriesLegend
                    items={performanceData.map((row) => ({
                      label: row.sector,
                      color: row.color,
                    }))}
                  />
                </Box>
              </>
            )}
          </ChartCard>
        </Grid>
      </Grid>
    </Box>
  )
}

/**
 * Dashboard — Project Design Analytics
 * Project selector + details, financial summary, fee per sq.ft by category
 */

const FINANCIAL_ICON_MAP: Record<DesignFinancialIcon, { node: ReactNode; color: string }> = {
  value: {
    node: <Wallet size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.teal,
  },
  payable: {
    node: <Banknote size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.amber,
  },
  profit: {
    node: <Percent size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.green,
  },
  fee: {
    node: <IndianRupee size={18} strokeWidth={1.75} />,
    color: CHART_COLORS.blue,
  },
}

const DESIGN_AUTOCOMPLETE_SX = {
  minWidth: { xs: '100%', sm: 240 },
  maxWidth: { xs: '100%', sm: 280 },
  '& .MuiOutlinedInput-root': {
    height: 32,
    fontSize: 12,
    bgcolor: 'action.hover',
    '& fieldset': {
      border: 'none',
    },
  },
  '& .MuiInputBase-input': {
    fontSize: 12,
    py: 0,
    color: 'text.primary',
    opacity: 1,
  },
} as const

function formatFeePerSqft(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return `₹${n.toLocaleString('en-IN')}`
}

function SectionLabel({ title }: { title: string }) {
  return (
    <Typography
      variant="subtitle2"
      fontWeight={600}
      sx={{ fontSize: 13, mb: 1.5 }}
    >
      {title}
    </Typography>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: 'block',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          mb: 0.5,
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}
        title={value}
      >
        {value}
      </Typography>
    </Box>
  )
}

function DesignKpiCard({
  icon,
  iconColor,
  title,
  value,
  subtitle,
}: {
  icon: ReactNode
  iconColor: string
  title: string
  value: string
  subtitle?: string
}) {
  const theme = useTheme()

  return (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        p: 2.5,
        borderRadius: '10px',
        border: `1px solid ${tokens.color.neutral[200]}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          width: '100%',
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          fontWeight={600}
          sx={{
            fontSize: 11,
            letterSpacing: 0.3,
            lineHeight: 1.35,
            pr: 0.5,
          }}
        >
          {title}
        </Typography>
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '8px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(iconColor, theme.palette.mode === 'dark' ? 0.2 : 0.1),
            color: iconColor,
          }}
        >
          {icon}
        </Box>
      </Box>

      <Typography
        variant="h5"
        fontWeight={700}
        sx={{
          fontSize: { xs: 22, md: 26 },
          lineHeight: 1.15,
          letterSpacing: -0.3,
        }}
      >
        {value}
      </Typography>

      {subtitle != null && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: 11, mt: 'auto' }}
        >
          {subtitle}
        </Typography>
      )}
    </Paper>
  )
}

function FeePerSqftTooltip({
  active,
  payload,
  projectName,
}: TooltipContentProps & { projectName: string }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  if (!entry) return null
  const row = entry.payload as FeePerSqftChartRow | undefined
  const category = row?.category ?? String(entry.name ?? '')
  const fee = typeof entry.value === 'number' ? entry.value : Number(entry.value)
  if (Number.isNaN(fee)) return null

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: `1px solid ${tokens.color.neutral[200]}`,
        borderRadius: '8px',
        boxShadow: tokens.shadow.sm,
        px: 1.5,
        py: 1,
        width: 'max-content',
        minWidth: 180,
        maxWidth: 360,
        whiteSpace: 'nowrap',
      }}
    >
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block', mb: 0.25 }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Project Name:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {projectName}
        </Box>
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block', mb: 0.25 }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Fee Category:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {category}
        </Box>
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 12, display: 'block' }}>
        <Box component="span" sx={{ color: 'text.secondary' }}>
          Fee / sq.ft.:{' '}
        </Box>
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {formatFeePerSqft(fee)}
        </Box>
      </Typography>
    </Box>
  )
}

function FeePerSqftCategoryChart({
  data,
  projectName,
  height = 280,
}: {
  data: FeePerSqftChartRow[]
  projectName: string
  height?: number
}) {
  const ct = useChartTheme()
  const h = ct.isMobile ? Math.round(height * 0.85) : height

  return (
    <Box sx={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={h}>
        <RechartsBarChart
          data={data}
          layout="vertical"
          barCategoryGap="28%"
          margin={{
            top: 8,
            right: ct.isMobile ? 16 : 24,
            left: 0,
            bottom: 28,
          }}
        >
          <CartesianGrid
            stroke={ct.gridProps.stroke}
            strokeDasharray={ct.gridProps.strokeDasharray}
            strokeOpacity={ct.gridProps.strokeOpacity}
            horizontal={false}
            vertical
          />
          <XAxis
            type="number"
            domain={[0, 'dataMax']}
            padding={{ left: 0, right: 8 }}
            tick={ct.axisStyle}
            tickLine={false}
            axisLine={{ stroke: ct.gridProps.stroke }}
            tickFormatter={formatFeePerSqft}
            label={{
              value: 'Fee per Sq.ft. (₹)',
              position: 'insideBottom',
              offset: -16,
              style: {
                fill: tokens.color.neutral[500],
                fontSize: 11,
                fontFamily: ct.fontFamily,
              },
            }}
          />
          <YAxis
            type="category"
            dataKey="category"
            tick={{ ...ct.axisStyle, textAnchor: 'end' }}
            tickLine={false}
            axisLine={{ stroke: ct.gridProps.stroke }}
            width={ct.isMobile ? 72 : 88}
            tickMargin={2}
            interval={0}
          />
          <Tooltip
            isAnimationActive={false}
            animationDuration={0}
            content={(props) => (
              <FeePerSqftTooltip {...props} projectName={projectName} />
            )}
            allowEscapeViewBox={{ x: true, y: true }}
            offset={12}
            wrapperStyle={ct.tooltipWrapperStyle}
            cursor={{
              fill: ct.theme.palette.action.hover,
              stroke: 'none',
              fillOpacity: 0.45,
            }}
          />
          <Bar
            dataKey="feePerSqft"
            name="Fee / sq.ft."
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            isAnimationActive={false}
            activeBar={false}
          >
            {data.map((row) => (
              <Cell key={row.category} fill={row.color} />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </Box>
  )
}

function ProjectDesignAnalyticsSection({ projects }: { projects: Project[] }) {
  const [projectId, setProjectId] = useState<DesignProjectId>('')

  const projectOptions = useMemo<DesignProjectOption[]>(
    () =>
      projects
        .map((project) => ({
          id: project.id,
          label: project.name || project.projectCode || 'Untitled Project',
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [projects],
  )

  const selectedOption = useMemo(
    () => projectOptions.find((o) => o.id === projectId) ?? projectOptions[0] ?? null,
    [projectOptions, projectId],
  )

  useEffect(() => {
    if (!projectOptions.length) {
      if (projectId) setProjectId('')
      return
    }

    if (!projectId || !projectOptions.some((option) => option.id === projectId)) {
      setProjectId(projectOptions[0]!.id)
    }
  }, [projectId, projectOptions])

  const selectedProject = useMemo(
    () =>
      projects.find((project) => project.id === projectId) ??
      (selectedOption ? projects.find((project) => project.id === selectedOption.id) : null) ??
      null,
    [projectId, projects, selectedOption],
  )

  const analytics = useMemo(
    () => (selectedProject ? buildDesignProjectAnalytics(selectedProject) : null),
    [selectedProject],
  )

  const feeChartData = useMemo(
    () => buildFeePerSqftChartData(analytics?.feePerSqft ?? []),
    [analytics],
  )

  const feeChartHeight = Math.max(240, Math.min(420, feeChartData.length * 52 + 80))

  const detailFields = useMemo(
    () =>
      analytics
        ? [
            { label: 'Project Name', value: analytics.details.projectName },
            { label: 'Carpet Area', value: analytics.details.carpetArea },
            { label: 'Headcount', value: analytics.details.headcount },
            { label: 'Building', value: analytics.details.building },
            { label: 'Client Sector', value: analytics.details.clientSector },
            { label: 'Project Manager', value: analytics.details.projectManager },
          ]
        : [],
    [analytics],
  )

  const handleProjectChange = (
    _event: SyntheticEvent,
    value: DesignProjectOption | null,
  ) => {
    if (value == null || value.id === projectId) return
    setProjectId(value.id)
  }

  if (!analytics) {
    return (
      <Box sx={{ mb: 3 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
            Project Design Analytics
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
            Detailed design metrics for an individual project.
          </Typography>
        </Box>

        <Paper
          elevation={0}
          sx={{
            p: 4,
            borderRadius: '10px',
            border: `1px solid ${tokens.color.neutral[200]}`,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            bgcolor: 'background.paper',
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
            No projects available for design analytics.
          </Typography>
        </Paper>
      </Box>
    )
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'stretch', sm: 'flex-end' },
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
            Project Design Analytics
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
            Detailed design metrics for an individual project.
          </Typography>
        </Box>

        <Box sx={{ flexShrink: 0, width: { xs: '100%', sm: 'auto' } }}>
          <Typography
            variant="caption"
            color="text.secondary"
            fontWeight={600}
            sx={{
              display: 'block',
              fontSize: 10,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              mb: 0.5,
            }}
          >
            Project
          </Typography>
          <Autocomplete
            size="small"
            disableClearable
            options={projectOptions}
            value={selectedOption}
            onChange={handleProjectChange}
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Search project"
                inputProps={{
                  ...params.inputProps,
                  'aria-label': 'Search and select project',
                }}
              />
            )}
            slotProps={{
              paper: {
                sx: {
                  fontSize: 12,
                  '& .MuiAutocomplete-option': { fontSize: 12, minHeight: 36 },
                },
              },
            }}
            sx={DESIGN_AUTOCOMPLETE_SX}
          />
        </Box>
      </Box>

      <Fade in key={selectedProject?.id ?? 'selected-project'} timeout={280}>
        <Stack spacing={2}>
          {/* Section 1 — Project Details */}
          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              borderRadius: '10px',
              border: `1px solid ${tokens.color.neutral[200]}`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              bgcolor: 'background.paper',
            }}
          >
            <SectionLabel title="Project Details" />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  md: 'repeat(3, 1fr)',
                },
                columnGap: 3,
                rowGap: 2,
              }}
            >
              {detailFields.map((field) => (
                <DetailField key={field.label} label={field.label} value={field.value} />
              ))}
            </Box>
          </Paper>

          {/* Section 2 — Financial Summary (4 KPIs) */}
          <Box>
            <SectionLabel title="Financial Summary" />
            <Grid container spacing={2}>
              {analytics.financialSummary.map((kpi) => {
                const iconMeta = FINANCIAL_ICON_MAP[kpi.icon]
                return (
                  <Grid key={kpi.id} size={{ xs: 12, sm: 6, lg: 3 }}>
                    <DesignKpiCard
                      icon={iconMeta.node}
                      iconColor={iconMeta.color}
                      title={kpi.title}
                      value={kpi.value}
                      subtitle={kpi.subtitle}
                    />
                  </Grid>
                )
              })}
            </Grid>
          </Box>
        </Stack>
      </Fade>

      {/* Fee per Sq.ft — driven by section Project selector */}
      <Box sx={{ mt: 2 }}>
        <ChartCard
          title="Fee per Sq.ft"
          subtitle="Fee per Sq.ft. (₹) by fee category for the selected project."
        >
          {feeChartData.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
            >
              No fee categories for the selected project.
            </Typography>
          ) : (
            <FeePerSqftCategoryChart
              data={feeChartData}
              projectName={analytics.details.projectName}
              height={feeChartHeight}
            />
          )}
        </ChartCard>
      </Box>
    </Box>
  )
}

export function ProjectsTab({
  datePeriod,
  dateRange,
  onDatePeriodChange,
  onDateRangeChange,
}: {
  datePeriod: DashboardDatePeriod
  dateRange: DashboardDateRange
  onDatePeriodChange: (period: DashboardDatePeriod) => void
  onDateRangeChange: (range: DashboardDateRange) => void
}) {
  const dispatch = useAppDispatch()
  const fallbackProjects = useAppSelector((s) => s.projects.items ?? [])
  const [dashboardProjects, setDashboardProjects] = useState<Project[] | null>(null)
  const [backendSectorPerformance, setBackendSectorPerformance] = useState<SectorPerformanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const requestParams = useMemo(() => dashboardDateParams(dateRange), [dateRange])

  const loadProjectsDashboard = useCallback(
    async (isActive: () => boolean) => {
      setLoading(true)
      try {
        const response = await client.get('/dashboard/projects', {
          params: requestParams,
        })
        const data = unwrapApiData<ProjectsDashboardResponse>(response.data)
        if (!isActive()) return
        const projects = asDashboardProjects(data.data?.projects)
        setBackendSectorPerformance(asBackendSectorPerformance(data.data?.sectorPerformance))
        setDashboardProjects(projects)
      } catch {
        if (!isActive()) return
        // Keep last successful dashboard payload; hydrate Redux listing as soft fallback.
        void dispatch(fetchProjects({ page: 1, pageSize: 500 }))
      } finally {
        if (isActive()) setLoading(false)
      }
    },
    [dispatch, requestParams],
  )

  useDashboardReload(loadProjectsDashboard, [loadProjectsDashboard])

  const projects = dashboardProjects ?? fallbackProjects
  const sectionLoading = loading && dashboardProjects == null

  return (
    <Box>
      <ProjectsOverviewSection
        projects={projects}
        loading={sectionLoading}
        action={
          <DashboardDateRangeFilter
            period={datePeriod}
            value={dateRange}
            onPeriodChange={onDatePeriodChange}
            onChange={onDateRangeChange}
          />
        }
      />
      {sectionLoading ? (
        <>
          <Box sx={{ mb: 3 }}>
            <ChartCard title="Project Analytics" subtitle="Loading project analytics">
              <DashboardSectionLoader minHeight={280} />
            </ChartCard>
          </Box>
          <Box sx={{ mb: 3 }}>
            <ChartCard title="Sector Analytics" subtitle="Loading sector analytics">
              <DashboardSectionLoader minHeight={280} />
            </ChartCard>
          </Box>
          <Box sx={{ mb: 3 }}>
            <ChartCard title="Design Analytics" subtitle="Loading design analytics">
              <DashboardSectionLoader minHeight={280} />
            </ChartCard>
          </Box>
        </>
      ) : (
        <>
          <ProjectAnalyticsSection projects={projects} />
          <SectorAnalyticsSection
            projects={projects}
            backendSectorPerformance={backendSectorPerformance}
          />
          <ProjectDesignAnalyticsSection projects={projects} />
        </>
      )}
    </Box>
  )
}
