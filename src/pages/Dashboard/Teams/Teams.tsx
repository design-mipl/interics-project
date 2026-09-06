/**
 * Dashboard — Team section
 * Team Performance master graph and existing charts
 */

/**
 * Sample data for Dashboard — Team section (employee-centric, filter by time).
 * Plus Team Performance master graph from real project assignments.
 */


import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import {
  Autocomplete,
  Box,
  CircularProgress,
  MenuItem,
  Select as MuiSelect,
  TextField,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell as RechartsCell,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart,
  ChartCard,
} from '@/design-system/components'
import { CHART_COLORS, tokens } from '@/design-system/tokens'
import { formatCurrency } from '@/utils/formatters'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchProjects } from '@/slices/projects/thunk'
import type { Project } from '@/slices/projects/reducer'
import { getProjectAssignedMembers } from '@/utils/projectAssignedTeam'
import client from '@/api/client'
import { unwrapApiData } from '@/modules/system-settings/shared/api'
import { DashboardDateRangeFilter } from '../DashboardDateRangeFilter'
import {
  type DashboardDatePeriod,
  dashboardDateParams,
  type DashboardDateRange,
} from '../dashboardDateRange'
import { useDashboardReload } from '../useDashboardReload'
import { DashboardSectionLoader } from '../DashboardTabLoader'

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

function projectDurationDays(project: Project): number | null {
  if (project.status !== 'Completed') return null
  if (!project.createdAt || !project.completedAt) return null
  const start = new Date(project.createdAt)
  const endIso = project.completedAt
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  return diff >= 0 ? diff : null
}

export const TEAM_EMPLOYEE_OPTIONS = [
  { value: 'all', label: 'All Employees' },
  { value: 'emp-001', label: 'Jignesh' },
  { value: 'emp-002', label: 'Arjun Nair' },
  { value: 'emp-003', label: 'Meera Iyer' },
  { value: 'emp-004', label: 'Rohan Desai' },
  { value: 'emp-005', label: 'Priya Shah' },
  { value: 'emp-006', label: 'Kabir Malhotra' },
] as const

export const TEAM_TIME_PERIOD_OPTIONS = [
  'This Year',
  'Last Year',
  'Last 5 Years',
  'Lifetime',
  'Custom Range',
] as const

export type TeamTimePeriod = (typeof TEAM_TIME_PERIOD_OPTIONS)[number]

export interface TeamKpiComparison {
  direction: 'up' | 'down'
  percent: number
  label: string
  previousValue?: string
}

export interface TeamKpiBreakdownItem {
  label: string
  value: number
}

export interface TeamKpi {
  id: string
  title: string
  value: string
  /** Secondary line under the main value (e.g. "Projects"). */
  valueLabel?: string
  subtitle: string
  icon: 'revenue' | 'profit' | 'sqft' | 'projects' | 'size' | 'duration'
  comparison?: TeamKpiComparison
  breakdown?: TeamKpiBreakdownItem[]
}

export interface TeamSqftSummary {
  averageLabel: string
  averageValue: number
  totalLabel: string
  totalValue: number
}

export interface TeamAnalyticsBundle {
  kpis: TeamKpi[]
  revenueTrend: Array<Record<string, string | number>>
  revenueTrendXKey: string
  projectsByStage: Array<{
    label: string
    pitch: number
    live: number
    completed: number
    archived: number
  }>
  sqftTrend: Array<{ period: string; sqft: number }>
  sqftSummary: TeamSqftSummary
  revenueVsProfit: Array<{ period: string; revenue: number; profit: number }>
}

function periodFactor(period: TeamTimePeriod): number {
  switch (period) {
    case 'This Year':
      return 1
    case 'Last Year':
      return 0.88
    case 'Last 5 Years':
      return 1.35
    case 'Lifetime':
      return 1.7
    case 'Custom Range':
      return 0.95
    default:
      return 1
  }
}

function employeeFactor(employeeId: string): number {
  if (employeeId === 'all') return 1
  const weights: Record<string, number> = {
    'emp-001': 0.42,
    'emp-002': 0.38,
    'emp-003': 0.32,
    'emp-004': 0.28,
    'emp-005': 0.24,
    'emp-006': 0.22,
  }
  return weights[employeeId] ?? 0.3
}

function formatCr(value: number): string {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`
  return `₹${(value / 100_000).toFixed(1)} L`
}

function formatSqftValue(value: number): string {
  return Math.round(value).toLocaleString('en-IN')
}

function sqftKpiForPeriod(period: TeamTimePeriod, e: number): { value: number; subtitle: string } {
  switch (period) {
    case 'This Year':
      return { value: Math.round(18_420 * e), subtitle: 'This Year' }
    case 'Last Year':
      return { value: Math.round(47_652 * e), subtitle: 'Last Year' }
    case 'Last 5 Years':
      return { value: Math.round(1_18_400 * e), subtitle: 'Last 5 Years' }
    case 'Lifetime':
      return { value: Math.round(1_42_500 * e), subtitle: 'Lifetime Total' }
    case 'Custom Range':
      return { value: Math.round(22_150 * e), subtitle: 'Custom Range' }
    default:
      return { value: Math.round(18_420 * e), subtitle: 'This Year' }
  }
}

function buildMonthlySqft(e: number, yearFactor: number): Array<{ period: string; sqft: number }> {
  const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
  const base = [2800, 3100, 2950, 3400, 3600, 3200, 3800, 4100, 3500, 3300, 3000, 3450]
  return months.map((period, i) => ({
    period,
    sqft: Math.round(base[i] * e * yearFactor),
  }))
}

function buildSqftTrend(
  period: TeamTimePeriod,
  e: number,
): { trend: Array<{ period: string; sqft: number }>; summary: TeamSqftSummary } {
  if (period === 'This Year' || period === 'Custom Range') {
    const trend = buildMonthlySqft(e, period === 'Custom Range' ? 0.95 : 1)
    const total = trend.reduce((sum, row) => sum + row.sqft, 0)
    return {
      trend,
      summary: {
        averageLabel: 'Average / Month',
        averageValue: Math.round(total / trend.length),
        totalLabel: period === 'Custom Range' ? 'Period Total' : 'This Year Total',
        totalValue: total,
      },
    }
  }

  if (period === 'Last Year') {
    const trend = buildMonthlySqft(e, 0.88)
    const total = trend.reduce((sum, row) => sum + row.sqft, 0)
    return {
      trend,
      summary: {
        averageLabel: 'Average / Month',
        averageValue: Math.round(total / trend.length),
        totalLabel: 'Last Year Total',
        totalValue: total,
      },
    }
  }

  if (period === 'Last 5 Years') {
    const trend = [
      { period: '2021', sqft: Math.round(18_200 * e) },
      { period: '2022', sqft: Math.round(22_000 * e) },
      { period: '2023', sqft: Math.round(28_500 * e) },
      { period: '2024', sqft: Math.round(34_200 * e) },
      { period: '2025', sqft: Math.round(38_800 * e) },
    ]
    const total = trend.reduce((sum, row) => sum + row.sqft, 0)
    return {
      trend,
      summary: {
        averageLabel: 'Average / Year',
        averageValue: Math.round(total / trend.length),
        totalLabel: 'Period Total',
        totalValue: total,
      },
    }
  }

  // Lifetime — from first completed project year through latest
  const trend = [
    { period: '2019', sqft: Math.round(9_800 * e) },
    { period: '2020', sqft: Math.round(12_400 * e) },
    { period: '2021', sqft: Math.round(18_200 * e) },
    { period: '2022', sqft: Math.round(22_000 * e) },
    { period: '2023', sqft: Math.round(28_500 * e) },
    { period: '2024', sqft: Math.round(34_200 * e) },
    { period: '2025', sqft: Math.round(38_800 * e) },
    { period: '2026', sqft: Math.round(42_500 * e) },
  ]
  const total = trend.reduce((sum, row) => sum + row.sqft, 0)
  return {
    trend,
    summary: {
      averageLabel: 'Average / Year',
      averageValue: Math.round(total / trend.length),
      totalLabel: 'Lifetime Total',
      totalValue: total,
    },
  }
}

/** Filter-driven sample analytics for the Team section. */
export function getTeamAnalytics(
  employeeId: string,
  period: TeamTimePeriod,
): TeamAnalyticsBundle {
  const e = employeeFactor(employeeId)
  const p = periodFactor(period)
  const f = e * p

  const revenue = Math.round(24_500_000 * f)
  const profit = Math.round(6_800_000 * f)
  const projectsTotal = Math.max(3, Math.round(36 * f))
  const pitch = Math.max(1, Math.round(projectsTotal * 0.17))
  const live = Math.max(1, Math.round(projectsTotal * 0.52))
  const archived = Math.max(1, Math.round(projectsTotal * 0.08))
  const completed = Math.max(0, projectsTotal - pitch - live - archived)
  const avgSize = Math.round(3958 * (0.92 + e * 0.2))
  const avgDuration = Math.round(112 * (0.95 + (1 - e) * 0.15))

  const revenueYoY = employeeId === 'all' ? 12 : employeeId === 'emp-001' ? 15 : 8
  const profitYoY = employeeId === 'all' ? 9 : employeeId === 'emp-001' ? 11 : 6
  const previousRevenue = Math.round(revenue / (1 + revenueYoY / 100))
  const previousProfit = Math.round(profit / (1 + profitYoY / 100))

  const sqftKpi = sqftKpiForPeriod(period, e)
  const { trend: sqftTrend, summary: sqftSummary } = buildSqftTrend(period, e)

  const useMonths = period === 'This Year' || period === 'Last Year' || period === 'Custom Range'

  const revenueTrend = useMonths
    ? [
        { period: 'Apr', current: Math.round(1_800_000 * f), previous: Math.round(1_550_000 * f) },
        { period: 'May', current: Math.round(2_050_000 * f), previous: Math.round(1_720_000 * f) },
        { period: 'Jun', current: Math.round(1_950_000 * f), previous: Math.round(1_880_000 * f) },
        { period: 'Jul', current: Math.round(2_200_000 * f), previous: Math.round(1_900_000 * f) },
        { period: 'Aug', current: Math.round(2_350_000 * f), previous: Math.round(2_050_000 * f) },
        { period: 'Sep', current: Math.round(2_100_000 * f), previous: Math.round(1_980_000 * f) },
        { period: 'Oct', current: Math.round(2_450_000 * f), previous: Math.round(2_100_000 * f) },
        { period: 'Nov', current: Math.round(2_600_000 * f), previous: Math.round(2_250_000 * f) },
        { period: 'Dec', current: Math.round(2_300_000 * f), previous: Math.round(2_150_000 * f) },
        { period: 'Jan', current: Math.round(2_150_000 * f), previous: Math.round(1_900_000 * f) },
        { period: 'Feb', current: Math.round(2_000_000 * f), previous: Math.round(1_850_000 * f) },
        { period: 'Mar', current: Math.round(2_250_000 * f), previous: Math.round(2_000_000 * f) },
      ]
    : [
        { period: '2022', current: Math.round(14_200_000 * e), previous: Math.round(12_100_000 * e) },
        { period: '2023', current: Math.round(17_800_000 * e), previous: Math.round(14_200_000 * e) },
        { period: '2024', current: Math.round(20_500_000 * e), previous: Math.round(17_800_000 * e) },
        { period: '2025', current: Math.round(22_800_000 * e), previous: Math.round(20_500_000 * e) },
        {
          period: '2026',
          current: Math.round(24_500_000 * e * (period === 'Lifetime' ? 1 : p)),
          previous: Math.round(22_800_000 * e),
        },
      ]

  return {
    kpis: [
      {
        id: 'revenue',
        title: 'Revenue Generated',
        value: formatCr(revenue),
        subtitle: 'Compared to Last Year',
        icon: 'revenue',
        comparison: {
          direction: 'up',
          percent: revenueYoY,
          label: 'Compared to Last Year',
          previousValue: formatCr(previousRevenue),
        },
      },
      {
        id: 'profit',
        title: 'Profit Generated',
        value: formatCr(profit),
        subtitle: 'Compared to Last Year',
        icon: 'profit',
        comparison: {
          direction: 'up',
          percent: profitYoY,
          label: 'Compared to Last Year',
          previousValue: formatCr(previousProfit),
        },
      },
      {
        id: 'sqft',
        title: 'Total Sq.ft Designed',
        value: `${formatSqftValue(sqftKpi.value)} Sq.ft`,
        subtitle: sqftKpi.subtitle,
        icon: 'sqft',
      },
      {
        id: 'projects',
        title: 'Number of Projects',
        value: String(projectsTotal),
        valueLabel: 'Projects',
        subtitle: 'Projects owned or co-delivered.',
        icon: 'projects',
        breakdown: [
          { label: 'Pitch', value: pitch },
          { label: 'Live', value: live },
          { label: 'Completed', value: completed },
          { label: 'Archived', value: archived },
        ],
      },
      {
        id: 'size',
        title: 'Average Project Size',
        value: `${formatSqftValue(avgSize)} sqft`,
        subtitle: 'Mean carpet area per project.',
        icon: 'size',
      },
      {
        id: 'duration',
        title: 'Average Project Duration',
        value: `${avgDuration} days`,
        subtitle: 'Mean planned-to-handover duration.',
        icon: 'duration',
      },
    ],
    revenueTrend,
    revenueTrendXKey: 'period',
    projectsByStage: [
      {
        label: 'Projects',
        pitch,
        live,
        completed,
        archived,
      },
    ],
    sqftTrend,
    sqftSummary,
    revenueVsProfit: [
      {
        period: 'Previous Year',
        revenue: previousRevenue,
        profit: previousProfit,
      },
      {
        period: 'Current Year',
        revenue,
        profit,
      },
    ],
  }
}

/* -------------------------------------------------------------------------- */
/* Team Performance master graph (real project assignments)                   */
/* -------------------------------------------------------------------------- */

export const TEAM_METRIC_OPTIONS = [
  'Revenue',
  'Project Duration',
  'No of Projects',
  'Area',
  'Completed Projects – Year Comparison',
] as const

export type TeamMetric = (typeof TEAM_METRIC_OPTIONS)[number]

export const DEFAULT_TEAM_PERFORMANCE_MEMBERS = 5

export interface TeamMemberOption {
  value: string
  label: string
}

export interface TeamChartSeriesConfig {
  key: string
  label: string
  color: string
}

export interface TeamPerformanceChartConfig {
  /** Card subtitle — updates with the selected metric. */
  subtitle: string
  /** Numeric-axis label (X when horizontal). */
  yAxisLabel: string
  format: 'count' | 'sqft' | 'days' | 'currency'
  series: TeamChartSeriesConfig[]
  data: Array<Record<string, string | number>>
}

export interface TeamPerformanceBundle {
  memberOptions: TeamMemberOption[]
  performanceChart: TeamPerformanceChartConfig
}

export interface TeamRevenueProjectBreakdown {
  projectId: string
  projectName: string
  revenue: number
}

export interface TeamRevenueYearPoint {
  year: number
  revenue: number
  projects: TeamRevenueProjectBreakdown[]
}

export interface TeamMemberYearlyRevenuePoint {
  userId: string
  member: string
  years: TeamRevenueYearPoint[]
}

export interface YearlyRevenueByTeamMemberBundle {
  memberOptions: TeamMemberOption[]
  years: number[]
  members: TeamMemberYearlyRevenuePoint[]
}

interface TeamRevenueYearChartConfig {
  subtitle: string
  data: TeamRevenueYearPoint[]
}

export interface TeamLifecycleProjectPoint {
  projectId: string
  projectName: string
  areaSqFt: number
  status: string
  createdAt: string
  wentLiveAt: string | null
  completedAt: string | null
  archivedAt: string | null
  cancelledAt: string | null
}

export interface TeamMemberProjectLifecyclePoint {
  userId: string
  member: string
  projects: TeamLifecycleProjectPoint[]
}

export interface ProjectLifecycleByTeamMemberBundle {
  memberOptions: TeamMemberOption[]
  members: TeamMemberProjectLifecyclePoint[]
}

interface ProjectLifecycleStageSegment {
  key: 'pitchDays' | 'liveDays' | 'completedDays'
  label: 'Pitch' | 'Live' | 'Completed'
  startDate: string
  endDate: string
  days: number
}

interface ProjectLifecycleChartRow {
  projectId: string
  projectName: string
  status: string
  pitchDays: number
  liveDays: number
  completedDays: number
  stages: ProjectLifecycleStageSegment[]
}

interface ProjectLifecycleChartConfig {
  subtitle: string
  data: ProjectLifecycleChartRow[]
}

type ProjectStatusProgressKey = 'pitch' | 'live' | 'completed' | 'archived' | 'cancelled'

interface ProjectStatusProgressStage {
  key: ProjectStatusProgressKey
  label: 'Pitch' | 'Live' | 'Completed' | 'Archived' | 'Cancelled'
  startDate: string | null
  endDate: string | null
  days: number | null
}

type ProjectStatusProgressChartRow = Record<ProjectStatusProgressKey, number> & {
  projectId: string
  projectName: string
  status: string
  stages: ProjectStatusProgressStage[]
}

interface ProjectStatusProgressChartConfig {
  subtitle: string
  data: ProjectStatusProgressChartRow[]
}

interface ProjectAreaChartRow {
  projectId: string
  projectName: string
  areaSqFt: number
}

interface ProjectAreaChartConfig {
  subtitle: string
  data: ProjectAreaChartRow[]
}

interface DateBounds {
  start: Date
  end: Date
}

interface MemberAccumulator {
  userId: string
  name: string
  projectIds: Set<string>
  projects: Project[]
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
  // Use createdAt as the primary anchor — it is always populated and reflects
  // when the project record was registered (startDate is the execution start,
  // which may be in prior years for ongoing projects).
  return parseDate(project.createdAt) ?? parseDate(project.startDate)
}

function getPerformancePeriodBounds(period: TeamTimePeriod, now = new Date()): {
  current: DateBounds
  previous: DateBounds
} {
  const year = now.getFullYear()
  if (period === 'Last Year') {
    return {
      current: {
        start: startOfDay(new Date(year - 1, 0, 1)),
        end: endOfDay(new Date(year - 1, 11, 31)),
      },
      previous: {
        start: startOfDay(new Date(year - 2, 0, 1)),
        end: endOfDay(new Date(year - 2, 11, 31)),
      },
    }
  }
  if (period === 'Last 5 Years') {
    return {
      current: {
        start: startOfDay(new Date(year - 4, 0, 1)),
        end: endOfDay(now),
      },
      previous: {
        start: startOfDay(new Date(year - 9, 0, 1)),
        end: endOfDay(new Date(year - 5, 11, 31)),
      },
    }
  }
  if (period === 'Lifetime') {
    return {
      current: {
        start: startOfDay(new Date(2000, 0, 1)),
        end: endOfDay(now),
      },
      previous: {
        start: startOfDay(new Date(2000, 0, 1)),
        end: endOfDay(new Date(year - 1, 11, 31)),
      },
    }
  }
  // This Year + Custom Range → YTD vs prior calendar year
  return {
    current: {
      start: startOfDay(new Date(year, 0, 1)),
      end: endOfDay(now),
    },
    previous: {
      start: startOfDay(new Date(year - 1, 0, 1)),
      end: endOfDay(new Date(year - 1, 11, 31)),
    },
  }
}

function getFinancialYearComparisonBounds(now = new Date()): {
  current: DateBounds
  previous: DateBounds
} {
  const year = now.getFullYear()
  const currentFyStartYear = now.getMonth() >= 3 ? year : year - 1
  return {
    current: {
      start: startOfDay(new Date(currentFyStartYear, 3, 1)),
      end: endOfDay(new Date(currentFyStartYear + 1, 2, 31)),
    },
    previous: {
      start: startOfDay(new Date(currentFyStartYear - 1, 3, 1)),
      end: endOfDay(new Date(currentFyStartYear, 2, 31)),
    },
  }
}

function projectInBounds(project: Project, bounds: DateBounds): boolean {
  const anchor = projectAnchorDate(project)
  if (!anchor) return false
  return anchor >= bounds.start && anchor <= bounds.end
}

function completedProjectInBounds(project: Project, bounds: DateBounds): boolean {
  if (project.status !== 'Completed') return false
  const completed = parseDate(project.completedAt)
  if (!completed) return false
  return completed >= bounds.start && completed <= bounds.end
}

/** Live segment for Number of Projects: status Live and Live/Start Date in period. */
function liveProjectStartInBounds(project: Project, bounds: DateBounds): boolean {
  if (project.status !== 'Live') return false
  const start = parseDate(project.startDate)
  if (!start) return false
  return start >= bounds.start && start <= bounds.end
}

function projectRevenue(project: Project): number {
  return project.totalClientPOValue || 0
}

function projectSqft(project: Project): number | null {
  const area = project.carpetArea ?? project.chargeableArea ?? null
  if (area == null || area <= 0) return null
  return area
}



function uniqueAssignedMembers(project: Project): Array<{ userId: string; name: string }> {
  const seen = new Set<string>()
  const members: Array<{ userId: string; name: string }> = []
  for (const m of getProjectAssignedMembers(project)) {
    const id = m.userId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    members.push({ userId: id, name: m.name.trim() || 'Unknown' })
  }
  return members
}

function accumulate(map: Map<string, MemberAccumulator>, projects: Project[]): void {
  for (const project of projects) {
    for (const member of uniqueAssignedMembers(project)) {
      let acc = map.get(member.userId)
      if (!acc) {
        acc = {
          userId: member.userId,
          name: member.name,
          projectIds: new Set(),
          projects: [],
        }
        map.set(member.userId, acc)
      } else if (member.name && (!acc.name || acc.name === 'Unknown')) {
        acc.name = member.name
      }
      if (acc.projectIds.has(project.id)) continue
      acc.projectIds.add(project.id)
      acc.projects.push(project)
    }
  }
}

interface MemberMetrics {
  userId: string
  name: string
  projectCount: number
  totalDurationDays: number
  avgDurationDays: number
  totalRevenue: number
  avgRevenue: number
  pitches: number
  liveProjects: number
  /** Live projects whose startDate falls in the selected period (Number of Projects chart). */
  liveProjectsInPeriod: number
  completedProjects: number
  cancelledProjects: number
  archivedProjects: number
  previousCompletedProjects: number
}

function metricsForMember(
  current: MemberAccumulator | undefined,
  previous: MemberAccumulator | undefined,
): MemberMetrics | null {
  if (!current && !previous) return null
  const userId = current?.userId ?? previous!.userId
  const name = current?.name ?? previous!.name
  const projects = current?.projects ?? []
  const prevProjects = previous?.projects ?? []

  // "Use actual project duration for completed projects."
  const completedProjectsList = projects.filter((p) => p.status === 'Completed')
  const durations = completedProjectsList
    .map(projectDurationDays)
    .filter((v): v is number => v != null)
  const totalDurationDays = durations.reduce((s, v) => s + v, 0)
  const avgDurationDays =
    durations.length > 0 ? Math.round(totalDurationDays / durations.length) : 0

  const totalRevenue = projects.reduce((s, p) => s + projectRevenue(p), 0)
  const avgRevenue = projects.length > 0 ? Math.round(totalRevenue / projects.length) : 0

  let pitches = 0
  let liveProjects = 0
  let completedProjects = 0
  let cancelledProjects = 0
  let archivedProjects = 0
  for (const p of projects) {
    if (p.status === 'Pitch') pitches += 1
    if (p.status === 'Live') liveProjects += 1
    if (p.status === 'Completed') completedProjects += 1
    if (p.status === 'Cancelled') cancelledProjects += 1
    if (p.status === 'Archived') archivedProjects += 1
  }

  const previousCompletedProjects = prevProjects.filter((p) => p.status === 'Completed').length

  return {
    userId,
    name,
    projectCount: projects.length,
    totalDurationDays,
    avgDurationDays,
    totalRevenue,
    avgRevenue,
    pitches,
    liveProjects,
    liveProjectsInPeriod: 0,
    completedProjects,
    cancelledProjects,
    archivedProjects,
    previousCompletedProjects,
  }
}

function buildPerformanceChart(
  members: MemberMetrics[],
  metric: TeamMetric,
): TeamPerformanceChartConfig {
  const dataBase = members.map((m) => ({ member: m.name, userId: m.userId }))

  switch (metric) {
    case 'Revenue':
      return {
        subtitle: 'Average & Total Revenue by team member',
        yAxisLabel: 'Revenue (₹)',
        format: 'currency',
        series: [
          { key: 'average', label: 'Average Revenue', color: CHART_COLORS.teal },
          { key: 'total', label: 'Total Revenue', color: CHART_COLORS.green },
        ],
        data: members.map((m, i) => ({
          ...dataBase[i],
          average: m.avgRevenue,
          total: m.totalRevenue,
        })),
      }
    case 'Project Duration':
      return {
        subtitle: 'Average & Total Project Duration by team member',
        yAxisLabel: 'Project Duration (days)',
        format: 'days',
        series: [
          { key: 'average', label: 'Average Project Duration', color: CHART_COLORS.blue },
          { key: 'total', label: 'Total Project Duration', color: CHART_COLORS.purple },
        ],
        data: members.map((m, i) => ({
          ...dataBase[i],
          average: m.avgDurationDays,
          total: m.totalDurationDays,
        })),
      }
    case 'No of Projects':
      return {
        subtitle: 'Project status distribution by team member',
        yAxisLabel: 'No of Projects',
        format: 'count',
        series: [
          { key: 'pitch', label: 'Pitch', color: CHART_COLORS.blue },
          { key: 'live', label: 'Live', color: CHART_COLORS.teal },
          { key: 'completed', label: 'Completed', color: CHART_COLORS.green },
          { key: 'cancelled', label: 'Cancelled', color: CHART_COLORS.red },
          { key: 'archived', label: 'Archived', color: CHART_COLORS.orange },
        ],
        data: members.map((m, i) => ({
          ...dataBase[i],
          pitch: m.pitches,
          live: m.liveProjectsInPeriod,
          completed: m.completedProjects,
          cancelled: m.cancelledProjects,
          archived: m.archivedProjects,
        })),
      }
    case 'Completed Projects – Year Comparison':
      return {
        subtitle: 'Completed projects: Current Financial Year vs Previous Financial Year',
        yAxisLabel: 'Completed Projects',
        format: 'count',
        series: [
          { key: 'current', label: 'Current Financial Year', color: CHART_COLORS.green },
          { key: 'previous', label: 'Previous Financial Year', color: CHART_COLORS.grey },
        ],
        data: members.map((m, i) => ({
          ...dataBase[i],
          current: m.completedProjects,
          previous: m.previousCompletedProjects,
        })),
      }
    default:
      return {
        subtitle: 'Team performance by team member',
        yAxisLabel: 'Value',
        format: 'count',
        series: [{ key: 'value', label: 'Value', color: CHART_COLORS.teal }],
        data: members.map((m, i) => ({ ...dataBase[i], value: m.projectCount })),
      }
  }
}

function emptyMemberMetrics(userId: string, name: string): MemberMetrics {
  return {
    userId,
    name,
    projectCount: 0,
    totalDurationDays: 0,
    avgDurationDays: 0,
    totalRevenue: 0,
    avgRevenue: 0,
    pitches: 0,
    liveProjects: 0,
    liveProjectsInPeriod: 0,
    completedProjects: 0,
    cancelledProjects: 0,
    archivedProjects: 0,
    previousCompletedProjects: 0,
  }
}

function buildMemberOptions(projects: Project[]): TeamMemberOption[] {
  const byId = new Map<string, string>()
  for (const project of projects) {
    for (const member of uniqueAssignedMembers(project)) {
      if (!byId.has(member.userId)) byId.set(member.userId, member.name)
    }
  }
  const options = [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [{ value: 'all', label: 'All Team Members' }, ...options]
}

/** Get sort value dynamically based on metric selection for ranking */
function getMetricSortValue(m: MemberMetrics, metric: TeamMetric): number {
  switch (metric) {
    case 'Revenue':
      return m.totalRevenue
    case 'Project Duration':
      return m.totalDurationDays
    case 'No of Projects':
      return (
        m.pitches +
        m.liveProjectsInPeriod +
        m.completedProjects +
        m.cancelledProjects +
        m.archivedProjects
      )
    case 'Completed Projects – Year Comparison':
      return m.completedProjects + m.previousCompletedProjects
    default:
      return m.projectCount
  }
}

/** Master Team Performance chart from real project assignments. */
export function getTeamPerformanceAnalytics(
  projects: Project[],
  timePeriod: TeamTimePeriod,
  teamMemberIds: string[],
  metric: TeamMetric,
  allMemberOptions?: TeamMemberOption[],
): TeamPerformanceBundle {
  const memberOptions = allMemberOptions ?? buildMemberOptions(projects)
  const isYearComparisonMetric = metric === 'Completed Projects – Year Comparison'
  const { current: currentBounds, previous: previousBounds } =
    isYearComparisonMetric
      ? getFinancialYearComparisonBounds()
      : getPerformancePeriodBounds(timePeriod)

  const currentProjects = projects.filter((p) =>
    isYearComparisonMetric
      ? completedProjectInBounds(p, currentBounds)
      : projectInBounds(p, currentBounds),
  )
  const previousProjects = projects.filter((p) =>
    isYearComparisonMetric
      ? completedProjectInBounds(p, previousBounds)
      : projectInBounds(p, previousBounds),
  )

  const currentMap = new Map<string, MemberAccumulator>()
  const previousMap = new Map<string, MemberAccumulator>()
  accumulate(currentMap, currentProjects)
  accumulate(previousMap, previousProjects)

  /** Live counts by Live/Start Date in the selected period (Number of Projects only). */
  const liveInPeriodByMember = new Map<string, { name: string; count: number }>()
  for (const project of projects) {
    if (!liveProjectStartInBounds(project, currentBounds)) continue
    for (const member of uniqueAssignedMembers(project)) {
      const prev = liveInPeriodByMember.get(member.userId)
      if (prev) {
        prev.count += 1
        if (member.name && (!prev.name || prev.name === 'Unknown')) prev.name = member.name
      } else {
        liveInPeriodByMember.set(member.userId, { name: member.name, count: 1 })
      }
    }
  }

  const memberIds = new Set([
    ...currentMap.keys(),
    ...previousMap.keys(),
    ...liveInPeriodByMember.keys(),
  ])
  let members = [...memberIds]
    .map((id) => {
      const base = metricsForMember(currentMap.get(id), previousMap.get(id))
      const liveInPeriod = liveInPeriodByMember.get(id)
      if (base) {
        return {
          ...base,
          liveProjectsInPeriod: liveInPeriod?.count ?? 0,
        }
      }
      if (liveInPeriod) {
        return {
          ...emptyMemberMetrics(id, liveInPeriod.name),
          liveProjectsInPeriod: liveInPeriod.count,
        }
      }
      return null
    })
    .filter((m): m is MemberMetrics => m != null)

  // Determine if specific members are filtered
  const hasSpecificSelection = teamMemberIds.length > 0 && !teamMemberIds.includes('all')

  if (hasSpecificSelection) {
    // Show only selected team members, sorted by metric descending
    members = members.filter((m) => teamMemberIds.includes(m.userId))
    // Add empty metrics for any selected member who has no projects in the period
    for (const id of teamMemberIds) {
      if (!members.some((m) => m.userId === id)) {
        const opt = memberOptions.find((o) => o.value === id)
        if (opt) {
          members.push(emptyMemberMetrics(opt.value, opt.label))
        }
      }
    }
    members.sort((a, b) => getMetricSortValue(b, metric) - getMetricSortValue(a, metric) || a.name.localeCompare(b.name))
  } else if (metric === 'Completed Projects – Year Comparison') {
    // Include every team member (even 0 / 0) so year comparison is visible without hover
    for (const opt of memberOptions) {
      if (opt.value === 'all') continue
      if (!members.some((m) => m.userId === opt.value)) {
        members.push(emptyMemberMetrics(opt.value, opt.label))
      }
    }
    members.sort((a, b) => getMetricSortValue(b, metric) - getMetricSortValue(a, metric) || a.name.localeCompare(b.name))
  } else {
    // All Team Members: show everyone with any projects, sorted by metric descending
    members.sort((a, b) => getMetricSortValue(b, metric) - getMetricSortValue(a, metric) || a.name.localeCompare(b.name))
  }

  if (!hasSpecificSelection) {
    members = members.slice(0, DEFAULT_TEAM_PERFORMANCE_MEMBERS)
  }

  return {
    memberOptions,
    performanceChart: buildPerformanceChart(members, metric),
  }
}

export const DEFAULT_SQFT_TEAM_MEMBERS = 5

export interface TeamMemberSqftPoint {
  userId: string
  member: string
  sqft: number
}

export interface SqftByTeamMemberBundle {
  memberOptions: TeamMemberOption[]
  members: TeamMemberSqftPoint[]
}

export interface TeamMemberRevenuePoint {
  userId: string
  member: string
  projectCount: number
  totalRevenue: number
  averageRevenue: number
  completedProjectCount: number
  totalDurationDays: number
  averageDurationDays: number
}

export interface PerformanceByTeamMemberBundle {
  memberOptions: TeamMemberOption[]
  members: TeamMemberRevenuePoint[]
}

interface TeamDashboardResponse {
  data?: {
    performanceByTeamMember?: unknown
    projectLifecycleByTeamMember?: unknown
    sqftByTeamMember?: unknown
    yearlyRevenueByTeamMember?: unknown
  }
}

function asTeamMemberOptions(value: unknown): TeamMemberOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      return {
        value: String(record.value ?? ''),
        label: String(record.label ?? ''),
      }
    })
    .filter((row) => row.value && row.label)
}

function asTeamMemberRevenuePoints(value: unknown): TeamMemberRevenuePoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const projectCount = Number(record.projectCount ?? 0)
      const totalRevenue = Number(record.totalRevenue ?? 0)
      const averageRevenue = Number(record.averageRevenue ?? 0)
      const completedProjectCount = Number(record.completedProjectCount ?? 0)
      const totalDurationDays = Number(record.totalDurationDays ?? 0)
      const averageDurationDays = Number(record.averageDurationDays ?? 0)
      return {
        userId: String(record.userId ?? ''),
        member: String(record.member ?? ''),
        projectCount: Number.isFinite(projectCount) ? Math.round(projectCount) : 0,
        totalRevenue: Number.isFinite(totalRevenue) ? Math.round(totalRevenue) : 0,
        averageRevenue: Number.isFinite(averageRevenue) ? Math.round(averageRevenue) : 0,
        completedProjectCount: Number.isFinite(completedProjectCount)
          ? Math.round(completedProjectCount)
          : 0,
        totalDurationDays: Number.isFinite(totalDurationDays)
          ? Math.round(totalDurationDays)
          : 0,
        averageDurationDays: Number.isFinite(averageDurationDays)
          ? Math.round(averageDurationDays)
          : 0,
      }
    })
    .filter((row) => row.userId && row.member)
}

function asTeamRevenueProjectBreakdowns(value: unknown): TeamRevenueProjectBreakdown[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const revenue = Number(record.revenue ?? 0)
      return {
        projectId: String(record.projectId ?? ''),
        projectName: String(record.projectName ?? 'Unknown Project'),
        revenue: Number.isFinite(revenue) ? Math.round(revenue) : 0,
      }
    })
    .filter((row) => row.projectId && row.revenue > 0)
}

function asTeamRevenueYearPoints(value: unknown): TeamRevenueYearPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const year = Number(record.year ?? 0)
      const revenue = Number(record.revenue ?? 0)
      return {
        year: Number.isFinite(year) ? Math.round(year) : 0,
        revenue: Number.isFinite(revenue) ? Math.round(revenue) : 0,
        projects: asTeamRevenueProjectBreakdowns(record.projects),
      }
    })
    .filter((row) => row.year > 0)
}

function asTeamMemberYearlyRevenuePoints(value: unknown): TeamMemberYearlyRevenuePoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      return {
        userId: String(record.userId ?? ''),
        member: String(record.member ?? ''),
        years: asTeamRevenueYearPoints(record.years),
      }
    })
    .filter((row) => row.userId && row.member)
}

function asTeamLifecycleProjectPoints(value: unknown): TeamLifecycleProjectPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const areaSqFt = Number(record.areaSqFt ?? 0)
      return {
        projectId: String(record.projectId ?? ''),
        projectName: String(record.projectName ?? 'Unknown Project'),
        areaSqFt: Number.isFinite(areaSqFt) ? Math.round(areaSqFt) : 0,
        status: String(record.status ?? ''),
        createdAt: String(record.createdAt ?? ''),
        wentLiveAt: record.wentLiveAt == null ? null : String(record.wentLiveAt),
        completedAt: record.completedAt == null ? null : String(record.completedAt),
        archivedAt: record.archivedAt == null ? null : String(record.archivedAt),
        cancelledAt: record.cancelledAt == null ? null : String(record.cancelledAt),
      }
    })
    .filter((row) => row.projectId && row.projectName && row.createdAt)
}

function asTeamMemberProjectLifecyclePoints(value: unknown): TeamMemberProjectLifecyclePoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      return {
        userId: String(record.userId ?? ''),
        member: String(record.member ?? ''),
        projects: asTeamLifecycleProjectPoints(record.projects),
      }
    })
    .filter((row) => row.userId && row.member)
}

function asPerformanceByTeamMemberBundle(value: unknown): PerformanceByTeamMemberBundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    memberOptions: asTeamMemberOptions(record.memberOptions),
    members: asTeamMemberRevenuePoints(record.members),
  }
}

function asProjectLifecycleByTeamMemberBundle(value: unknown): ProjectLifecycleByTeamMemberBundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    memberOptions: asTeamMemberOptions(record.memberOptions),
    members: asTeamMemberProjectLifecyclePoints(record.members),
  }
}

function asYearlyRevenueByTeamMemberBundle(value: unknown): YearlyRevenueByTeamMemberBundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const years = Array.isArray(record.years)
    ? record.years
        .map((year) => Number(year))
        .filter((year) => Number.isFinite(year) && year > 0)
        .map((year) => Math.round(year))
    : []
  return {
    memberOptions: asTeamMemberOptions(record.memberOptions),
    years,
    members: asTeamMemberYearlyRevenuePoints(record.members),
  }
}

/** Total sq.ft designed per team member from real project assignments. */
export function getSqftDesignedByTeamMember(
  projects: Project[],
  timePeriod: TeamTimePeriod,
): SqftByTeamMemberBundle {
  const { current: currentBounds } = getPerformancePeriodBounds(timePeriod)
  const currentProjects = projects.filter((p) => projectInBounds(p, currentBounds))
  const currentMap = new Map<string, MemberAccumulator>()
  accumulate(currentMap, currentProjects)

  // Use a map to accumulate sqft per member
  const memberSqftMap = new Map<string, { name: string; sqft: number }>()

  for (const project of currentProjects) {
    const sqft = projectSqft(project) || 0
    for (const member of uniqueAssignedMembers(project)) {
      const existing = memberSqftMap.get(member.userId)
      if (existing) {
        existing.sqft += sqft
      } else {
        memberSqftMap.set(member.userId, { name: member.name, sqft })
      }
    }
  }

  const members = [...memberSqftMap.entries()]
    .map(([userId, val]) => ({ userId, member: val.name, sqft: Math.round(val.sqft) }))
    .sort((a, b) => b.sqft - a.sqft || a.member.localeCompare(b.member))

  const memberOptions = members
    .map((m) => ({ value: m.userId, label: m.member }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return { memberOptions, members }
}

function continuousYearRange(years: number[]): number[] {
  const validYears = years.filter((year) => Number.isFinite(year) && year > 0)
  const currentYear = new Date().getFullYear()
  if (validYears.length === 0) return [currentYear]
  const minYear = Math.min(...validYears)
  const maxYear = Math.max(...validYears, currentYear)
  return Array.from({ length: maxYear - minYear + 1 }, (_value, index) => minYear + index)
}

function buildYearlyRevenueByTeamMemberFromProjects(
  projects: Project[],
): YearlyRevenueByTeamMemberBundle {
  const memberNameById = new Map<string, string>()
  const yearlyByUserId = new Map<string, Map<number, Map<string, TeamRevenueProjectBreakdown>>>()
  const years = new Set<number>()

  for (const project of projects) {
    const revenue = projectRevenue(project)
    if (revenue <= 0) continue
    const year = (projectAnchorDate(project) ?? new Date()).getFullYear()
    years.add(year)

    for (const member of uniqueAssignedMembers(project)) {
      memberNameById.set(member.userId, member.name)
      let memberYears = yearlyByUserId.get(member.userId)
      if (!memberYears) {
        memberYears = new Map()
        yearlyByUserId.set(member.userId, memberYears)
      }
      let projectsById = memberYears.get(year)
      if (!projectsById) {
        projectsById = new Map()
        memberYears.set(year, projectsById)
      }
      projectsById.set(project.id, {
        projectId: project.id,
        projectName: project.name,
        revenue: Math.round(revenue),
      })
    }
  }

  const memberOptions = Array.from(memberNameById.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const members = Array.from(yearlyByUserId.entries())
    .map(([userId, memberYears]) => ({
      userId,
      member: memberNameById.get(userId) ?? 'Unknown',
      years: Array.from(memberYears.entries())
        .map(([year, projectsById]) => {
          const projectsForYear = Array.from(projectsById.values()).sort(
            (a, b) => b.revenue - a.revenue || a.projectName.localeCompare(b.projectName),
          )
          return {
            year,
            revenue: projectsForYear.reduce((sum, project) => sum + project.revenue, 0),
            projects: projectsForYear,
          }
        })
        .sort((a, b) => a.year - b.year),
    }))
    .sort((a, b) => a.member.localeCompare(b.member))

  return {
    memberOptions,
    years: continuousYearRange(Array.from(years)),
    members,
  }
}

function buildRevenueYearChart(
  source: YearlyRevenueByTeamMemberBundle,
  selectedUserId: string | null,
): TeamRevenueYearChartConfig {
  const selectedMember = selectedUserId
    ? source.members.find((member) => member.userId === selectedUserId) ?? null
    : null
  const rowsByYear = new Map<number, TeamRevenueYearPoint>()

  if (selectedMember) {
    for (const row of selectedMember.years) {
      rowsByYear.set(row.year, {
        year: row.year,
        revenue: row.revenue,
        projects: row.projects,
      })
    }
  } else {
    const projectsByYear = new Map<number, Map<string, TeamRevenueProjectBreakdown>>()
    for (const member of source.members) {
      for (const row of member.years) {
        let projectsForYear = projectsByYear.get(row.year)
        if (!projectsForYear) {
          projectsForYear = new Map()
          projectsByYear.set(row.year, projectsForYear)
        }
        for (const project of row.projects) {
          if (!projectsForYear.has(project.projectId)) {
            projectsForYear.set(project.projectId, project)
          }
        }
      }
    }

    for (const [year, projectsForYear] of projectsByYear.entries()) {
      const projectsForChart = Array.from(projectsForYear.values()).sort(
        (a, b) => b.revenue - a.revenue || a.projectName.localeCompare(b.projectName),
      )
      rowsByYear.set(year, {
        year,
        revenue: projectsForChart.reduce((sum, project) => sum + project.revenue, 0),
        projects: projectsForChart,
      })
    }
  }

  const yearRange = continuousYearRange([
    ...source.years,
    ...Array.from(rowsByYear.keys()),
  ])

  return {
    subtitle: selectedMember
      ? `${selectedMember.member} revenue generated by year`
      : 'Total project revenue generated by year',
    data: yearRange.map((year) => ({
      year,
      revenue: rowsByYear.get(year)?.revenue ?? 0,
      projects: rowsByYear.get(year)?.projects ?? [],
    })),
  }
}

function buildProjectLifecycleByTeamMemberFromProjects(
  projects: Project[],
): ProjectLifecycleByTeamMemberBundle {
  const memberNameById = new Map<string, string>()
  const projectsByUserId = new Map<string, Map<string, TeamLifecycleProjectPoint>>()

  for (const project of projects) {
    if (!project.createdAt) continue
    for (const member of uniqueAssignedMembers(project)) {
      memberNameById.set(member.userId, member.name)
      let projectMap = projectsByUserId.get(member.userId)
      if (!projectMap) {
        projectMap = new Map()
        projectsByUserId.set(member.userId, projectMap)
      }
      projectMap.set(project.id, {
        projectId: project.id,
        projectName: project.name,
        areaSqFt: Math.round(projectSqft(project) ?? 0),
        status: project.status,
        createdAt: project.createdAt,
        wentLiveAt: project.wentLiveAt ?? null,
        completedAt: project.completedAt ?? null,
        archivedAt: project.archivedAt ?? null,
        cancelledAt: project.cancelledAt ?? null,
      })
    }
  }

  const memberOptions = Array.from(memberNameById.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const members = Array.from(projectsByUserId.entries())
    .map(([userId, projectMap]) => ({
      userId,
      member: memberNameById.get(userId) ?? 'Unknown',
      projects: Array.from(projectMap.values()).sort(
        (a, b) =>
          (parseDate(a.createdAt)?.getTime() ?? 0) - (parseDate(b.createdAt)?.getTime() ?? 0) ||
          a.projectName.localeCompare(b.projectName),
      ),
    }))
    .sort((a, b) => a.member.localeCompare(b.member))

  return { memberOptions, members }
}

function safeLifecycleDate(value: string | null | undefined): Date | null {
  const parsed = parseDate(value)
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null
}

function lifecycleDays(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000))
}

function addLifecycleSegment(
  segments: ProjectLifecycleStageSegment[],
  key: ProjectLifecycleStageSegment['key'],
  label: ProjectLifecycleStageSegment['label'],
  start: Date,
  end: Date,
): void {
  if (end.getTime() < start.getTime()) return
  const rawDays = lifecycleDays(start, end)
  const days = label === 'Completed' ? Math.max(1, rawDays) : rawDays
  if (days <= 0) return
  segments.push({
    key,
    label,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    days,
  })
}

function projectLifecycleSegments(
  project: TeamLifecycleProjectPoint,
  now = new Date(),
): ProjectLifecycleStageSegment[] {
  const createdAt = safeLifecycleDate(project.createdAt)
  if (!createdAt) return []
  const wentLiveAt = safeLifecycleDate(project.wentLiveAt)
  const completedAt = safeLifecycleDate(project.completedAt)
  const status = project.status.trim().toUpperCase()
  const segments: ProjectLifecycleStageSegment[] = []

  const hasLiveDate = Boolean(wentLiveAt && wentLiveAt.getTime() >= createdAt.getTime())
  const hasCompletedDate = Boolean(completedAt && completedAt.getTime() >= createdAt.getTime())

  if (hasLiveDate && wentLiveAt) {
    addLifecycleSegment(segments, 'pitchDays', 'Pitch', createdAt, wentLiveAt)
  } else if (!hasLiveDate && status === 'PITCH') {
    addLifecycleSegment(segments, 'pitchDays', 'Pitch', createdAt, now)
  }

  const liveStart =
    hasLiveDate && wentLiveAt
      ? wentLiveAt
      : ['LIVE', 'COMPLETED', 'ARCHIVED'].includes(status)
        ? createdAt
        : null
  if (liveStart) {
    const liveEnd = hasCompletedDate && completedAt ? completedAt : now
    addLifecycleSegment(segments, 'liveDays', 'Live', liveStart, liveEnd)
  }

  if (hasCompletedDate && completedAt) {
    addLifecycleSegment(segments, 'completedDays', 'Completed', completedAt, now)
  }

  return segments
}

function buildProjectLifecycleChart(
  source: ProjectLifecycleByTeamMemberBundle,
  selectedUserId: string | null,
): ProjectLifecycleChartConfig {
  const selectedMember = selectedUserId
    ? source.members.find((member) => member.userId === selectedUserId) ?? null
    : null
  const projectMap = new Map<string, TeamLifecycleProjectPoint>()

  const sourceMembers = selectedMember ? [selectedMember] : source.members
  for (const member of sourceMembers) {
    for (const project of member.projects) {
      if (!projectMap.has(project.projectId)) {
        projectMap.set(project.projectId, project)
      }
    }
  }

  const data = Array.from(projectMap.values())
    .map((project): ProjectLifecycleChartRow | null => {
      const stages = projectLifecycleSegments(project)
      if (stages.length === 0) return null
      return {
        projectId: project.projectId,
        projectName: project.projectName,
        status: project.status,
        pitchDays: stages.find((stage) => stage.key === 'pitchDays')?.days ?? 0,
        liveDays: stages.find((stage) => stage.key === 'liveDays')?.days ?? 0,
        completedDays: stages.find((stage) => stage.key === 'completedDays')?.days ?? 0,
        stages,
      }
    })
    .filter((row): row is ProjectLifecycleChartRow => row != null)
    .sort((a, b) => a.projectName.localeCompare(b.projectName))

  return {
    subtitle: selectedMember
      ? `${selectedMember.member} project lifecycle by weeks`
      : 'Project lifecycle by weeks',
    data,
  }
}

const PROJECT_STATUS_PROGRESS_SERIES: Array<{
  key: ProjectStatusProgressKey
  label: ProjectStatusProgressStage['label']
  color: string
}> = [
  { key: 'pitch', label: 'Pitch', color: CHART_COLORS.blue },
  { key: 'live', label: 'Live', color: CHART_COLORS.teal },
  { key: 'completed', label: 'Completed', color: CHART_COLORS.green },
  { key: 'archived', label: 'Archived', color: CHART_COLORS.orange },
  { key: 'cancelled', label: 'Cancelled', color: CHART_COLORS.red },
]

function normalizedProjectStatus(project: TeamLifecycleProjectPoint): string {
  return project.status.trim().toUpperCase()
}

function completedLifecycleProjectInBounds(
  project: TeamLifecycleProjectPoint,
  bounds: DateBounds,
): boolean {
  if (normalizedProjectStatus(project) !== 'COMPLETED') return false
  const completed = safeLifecycleDate(project.completedAt)
  if (!completed) return false
  return completed >= bounds.start && completed <= bounds.end
}

function buildCompletedProjectsYearComparisonChart(
  source: ProjectLifecycleByTeamMemberBundle,
  selectedUserId: string | null,
): TeamPerformanceChartConfig {
  const { current: currentBounds, previous: previousBounds } =
    getFinancialYearComparisonBounds()
  const selectedMember = selectedUserId
    ? source.members.find((member) => member.userId === selectedUserId) ?? null
    : null
  const sourceMembers = selectedMember ? [selectedMember] : source.members

  const rows = sourceMembers
    .map((member) => {
      const current = member.projects.filter((project) =>
        completedLifecycleProjectInBounds(project, currentBounds),
      ).length
      const previous = member.projects.filter((project) =>
        completedLifecycleProjectInBounds(project, previousBounds),
      ).length
      return {
        member: member.member,
        userId: member.userId,
        current,
        previous,
      }
    })
    .sort(
      (a, b) =>
        b.current + b.previous - (a.current + a.previous) ||
        a.member.localeCompare(b.member),
    )

  return {
    subtitle: selectedMember
      ? `${selectedMember.member} completed projects: Current FY vs Previous FY`
      : 'Completed projects: Current FY vs Previous FY',
    yAxisLabel: 'Completed Projects',
    format: 'count',
    series: [
      { key: 'current', label: 'Current Financial Year', color: CHART_COLORS.green },
      { key: 'previous', label: 'Previous Financial Year', color: CHART_COLORS.grey },
    ],
    data: selectedMember ? rows : rows.slice(0, DEFAULT_TEAM_PERFORMANCE_MEMBERS),
  }
}

function projectReachedStatusKeys(project: TeamLifecycleProjectPoint): ProjectStatusProgressKey[] {
  const status = normalizedProjectStatus(project)
  const keys = new Set<ProjectStatusProgressKey>(['pitch'])

  if (project.wentLiveAt || ['LIVE', 'COMPLETED', 'ARCHIVED'].includes(status)) {
    keys.add('live')
  }
  if (project.completedAt || ['COMPLETED', 'ARCHIVED'].includes(status)) {
    keys.add('completed')
  }
  if (project.archivedAt || status === 'ARCHIVED') {
    keys.add('archived')
  }
  if (project.cancelledAt || status === 'CANCELLED') {
    keys.add('cancelled')
  }

  return PROJECT_STATUS_PROGRESS_SERIES
    .map((stage) => stage.key)
    .filter((key) => keys.has(key))
}

function isoFromDate(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function statusStageBounds(
  project: TeamLifecycleProjectPoint,
  key: ProjectStatusProgressKey,
  now: Date,
): { start: Date | null; end: Date | null } {
  const status = normalizedProjectStatus(project)
  const createdAt = safeLifecycleDate(project.createdAt)
  const wentLiveAt = safeLifecycleDate(project.wentLiveAt)
  const completedAt = safeLifecycleDate(project.completedAt)
  const archivedAt = safeLifecycleDate(project.archivedAt)
  const cancelledAt = safeLifecycleDate(project.cancelledAt)

  switch (key) {
    case 'pitch':
      return {
        start: createdAt,
        end: wentLiveAt ?? cancelledAt ?? archivedAt ?? completedAt ?? now,
      }
    case 'live': {
      const hasLiveStage = Boolean(wentLiveAt) || ['LIVE', 'COMPLETED', 'ARCHIVED'].includes(status)
      if (!hasLiveStage) return { start: null, end: null }
      return {
        start: wentLiveAt ?? createdAt,
        end: completedAt ?? archivedAt ?? cancelledAt ?? now,
      }
    }
    case 'completed': {
      const hasCompletedStage = Boolean(completedAt) || ['COMPLETED', 'ARCHIVED'].includes(status)
      if (!hasCompletedStage) return { start: null, end: null }
      return {
        start: completedAt ?? wentLiveAt ?? createdAt,
        end: archivedAt ?? now,
      }
    }
    case 'archived':
      if (!archivedAt && status !== 'ARCHIVED') return { start: null, end: null }
      return {
        start: archivedAt ?? completedAt ?? wentLiveAt ?? createdAt,
        end: now,
      }
    case 'cancelled':
      if (!cancelledAt && status !== 'CANCELLED') return { start: null, end: null }
      return {
        start: cancelledAt ?? completedAt ?? wentLiveAt ?? createdAt,
        end: now,
      }
    default:
      return { start: null, end: null }
  }
}

function projectStatusProgressStages(
  project: TeamLifecycleProjectPoint,
  now = new Date(),
): ProjectStatusProgressStage[] {
  return projectReachedStatusKeys(project).map((key) => {
    const definition = PROJECT_STATUS_PROGRESS_SERIES.find((stage) => stage.key === key)
    const { start, end } = statusStageBounds(project, key, now)
    const days = start && end ? lifecycleDays(start, end) : null
    return {
      key,
      label: definition?.label ?? 'Pitch',
      startDate: isoFromDate(start),
      endDate: isoFromDate(end),
      days,
    }
  })
}

function buildProjectStatusProgressChart(
  source: ProjectLifecycleByTeamMemberBundle,
  selectedUserId: string | null,
): ProjectStatusProgressChartConfig {
  const selectedMember = selectedUserId
    ? source.members.find((member) => member.userId === selectedUserId) ?? null
    : null
  const projectMap = new Map<string, TeamLifecycleProjectPoint>()
  const sourceMembers = selectedMember ? [selectedMember] : source.members

  for (const member of sourceMembers) {
    for (const project of member.projects) {
      if (!projectMap.has(project.projectId)) {
        projectMap.set(project.projectId, project)
      }
    }
  }

  const rows = Array.from(projectMap.values())
    .map((project): ProjectStatusProgressChartRow | null => {
      const stages = projectStatusProgressStages(project)
      if (stages.length === 0) return null
      return {
        projectId: project.projectId,
        projectName: project.projectName,
        status: project.status,
        pitch: 1,
        live: 1,
        completed: 1,
        archived: 1,
        cancelled: 1,
        stages,
      }
    })
    .filter((row): row is ProjectStatusProgressChartRow => row != null)
    .sort((a, b) => a.projectName.localeCompare(b.projectName))

  return {
    subtitle: selectedMember
      ? `${selectedMember.member} project status progression`
      : 'Top 5 project status progressions',
    data: selectedMember ? rows : rows.slice(0, DEFAULT_TEAM_PERFORMANCE_MEMBERS),
  }
}

function buildProjectAreaChart(
  source: ProjectLifecycleByTeamMemberBundle,
  selectedUserId: string | null,
): ProjectAreaChartConfig {
  const selectedMember = selectedUserId
    ? source.members.find((member) => member.userId === selectedUserId) ?? null
    : null
  const projectMap = new Map<string, TeamLifecycleProjectPoint>()
  const sourceMembers = selectedMember ? [selectedMember] : source.members

  for (const member of sourceMembers) {
    for (const project of member.projects) {
      if (!projectMap.has(project.projectId)) {
        projectMap.set(project.projectId, project)
      }
    }
  }

  const rows = Array.from(projectMap.values())
    .map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      areaSqFt: Math.max(0, Math.round(project.areaSqFt)),
    }))
    .sort((a, b) => b.areaSqFt - a.areaSqFt || a.projectName.localeCompare(b.projectName))

  return {
    subtitle: selectedMember
      ? `${selectedMember.member} project area by project`
      : 'Top 5 projects by area',
    data: selectedMember ? rows : rows.slice(0, DEFAULT_TEAM_PERFORMANCE_MEMBERS),
  }
}

const METRIC_SELECT_SX = { minWidth: 200, fontSize: 12, height: 32 } as const
const MENU_ITEM_SX = { fontSize: 12 } as const

/** Match Metric Select theme fill (action.hover, no outline) — do not override bgcolor/border. */
const MEMBER_AUTOCOMPLETE_SX = {
  minWidth: { xs: '100%', sm: 200 },
  maxWidth: { xs: '100%', sm: 240 },
  '& .MuiOutlinedInput-root': {
    height: 32,
    fontSize: 12,
  },
  '& .MuiInputBase-input': {
    fontSize: 12,
    py: 0,
  },
} as const

const FILTER_LABEL_SX = {
  display: 'block',
  fontSize: 10,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  mb: 0.5,
} as const

function formatAxisAmount(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return `₹${formatCurrency(n)}`
}

function formatSqft(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return n.toLocaleString('en-IN')
}

function formatDays(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return `${Math.round(n)}d`
}

function formatCount(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return String(Math.round(n))
}

function formatMetricValue(
  value: number | string | null | undefined,
  format: TeamPerformanceChartConfig['format'],
): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  if (format === 'currency') return `₹${formatCurrency(n)}`
  if (format === 'sqft') return `${Math.round(n).toLocaleString('en-IN')} sqft`
  if (format === 'days') return `${Math.round(n)} days`
  return String(Math.round(n))
}

function ChartTooltipShell({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return (
    <Box
      sx={{
        bgcolor: theme.palette.background.paper,
        border: `1px solid ${tokens.color.neutral[200]}`,
        borderRadius: 1,
        px: 1.5,
        py: 1,
        boxShadow: tokens.shadow.md,
        width: 'max-content',
        minWidth: 160,
        maxWidth: 360,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}

function buildProjectAreaAxis(rows: ProjectAreaChartRow[]): { domainMax: number; ticks: number[] } {
  const maxValue = Math.max(0, ...rows.map((row) => row.areaSqFt))
  const step = 10_000
  const domainMax = Math.max(step, Math.ceil(maxValue / step) * step)
  const ticks: number[] = []
  for (let tick = 0; tick <= domainMax; tick += step) {
    ticks.push(tick)
  }
  return { domainMax, ticks }
}

function ProjectAreaTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as ProjectAreaChartRow | undefined
  if (!row) return null

  return (
    <ChartTooltipShell>
      <Typography variant="caption" fontWeight={700} sx={{ fontSize: 12, display: 'block', mb: 0.5 }}>
        {row.projectName}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, display: 'block' }}>
        Area:{' '}
        <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {formatSqft(row.areaSqFt)} sqft
        </Box>
      </Typography>
    </ChartTooltipShell>
  )
}

function ProjectAreaChart({ data }: { data: ProjectAreaChartRow[] }) {
  const theme = useTheme()
  const axis = useMemo(() => buildProjectAreaAxis(data), [data])
  const height = Math.max(300, data.length * 46 + 86)

  return (
    <Box sx={{ maxHeight: 520, overflowY: 'auto', overflowX: 'hidden' }}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart
          data={data}
          layout="vertical"
          barCategoryGap="28%"
          margin={{ top: 12, right: 24, left: 34, bottom: 22 }}
        >
          <CartesianGrid
            stroke={tokens.color.neutral[200]}
            strokeDasharray="3 3"
            horizontal={false}
            vertical
          />
          <XAxis
            type="number"
            domain={[0, axis.domainMax]}
            ticks={axis.ticks}
            tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: tokens.color.neutral[200] }}
            tickFormatter={formatSqft}
            label={{
              value: 'Area (sqft)',
              position: 'insideBottom',
              offset: -12,
              fill: theme.palette.text.secondary,
              fontSize: 11,
            }}
          />
          <YAxis
            type="category"
            dataKey="projectName"
            width={150}
            tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: tokens.color.neutral[200] }}
          />
          <Tooltip
            content={(props) => <ProjectAreaTooltip {...props} />}
            isAnimationActive={false}
            animationDuration={0}
            allowEscapeViewBox={{ x: true, y: true }}
            offset={12}
            wrapperStyle={{
              outline: 'none',
              pointerEvents: 'none',
              zIndex: tokens.zIndex.tooltip,
            }}
            cursor={{ fill: theme.palette.action.hover }}
          />
          <RechartsBar
            dataKey="areaSqFt"
            name="Area"
            fill={CHART_COLORS.amber}
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            activeBar={false}
            animationDuration={800}
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </Box>
  )
}

function buildCurrencyAxis(rows: TeamRevenueYearPoint[]): { domainMax: number; ticks: number[] } {
  const maxValue = Math.max(0, ...rows.map((row) => row.revenue))
  if (maxValue <= 0) return { domainMax: 100_000, ticks: [0, 25_000, 50_000, 75_000, 100_000] }

  const roughStep = maxValue / 4
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const stepMultiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = stepMultiplier * magnitude
  const domainMax = Math.ceil(maxValue / step) * step
  const ticks: number[] = []
  for (let tick = 0; tick <= domainMax; tick += step) {
    ticks.push(Math.round(tick))
  }
  return { domainMax, ticks }
}

function TeamRevenueYearTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as TeamRevenueYearPoint | undefined
  if (!row) return null

  return (
    <ChartTooltipShell>
      <Typography variant="caption" fontWeight={700} sx={{ fontSize: 12, display: 'block', mb: 0.5 }}>
        Year: {row.year}
      </Typography>
      {row.projects.length > 0 ? (
        <Box
          sx={{
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {row.projects.map((project) => (
            <Typography
              key={project.projectId}
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: 11, display: 'block', mt: 0.25 }}
            >
              <Box component="span" sx={{ color: 'text.primary' }}>
                {project.projectName}
              </Box>
              {' - '}
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                {formatMetricValue(project.revenue, 'currency')}
              </Box>
            </Typography>
          ))}
        </Box>
      ) : null}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontSize: 11,
          display: 'block',
          mt: 0.75,
          pt: 0.5,
          borderTop: `1px solid ${tokens.color.neutral[200]}`,
        }}
      >
        Total -{' '}
        <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
          {formatMetricValue(row.revenue, 'currency')}
        </Box>
      </Typography>
    </ChartTooltipShell>
  )
}

function TeamRevenueYearChart({ data }: { data: TeamRevenueYearPoint[] }) {
  const theme = useTheme()
  const axis = useMemo(() => buildCurrencyAxis(data), [data])

  return (
    <ResponsiveContainer width="100%" height={340}>
      <RechartsBarChart
        data={data}
        margin={{ top: 12, right: 24, left: 36, bottom: 16 }}
      >
        <CartesianGrid
          stroke={tokens.color.neutral[200]}
          strokeDasharray="3 3"
          horizontal
          vertical={false}
        />
        <XAxis
          dataKey="year"
          tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: tokens.color.neutral[200] }}
        />
        <YAxis
          domain={[0, axis.domainMax]}
          ticks={axis.ticks}
          tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatAxisAmount}
        />
        <Tooltip
          content={(props) => <TeamRevenueYearTooltip {...props} />}
          cursor={{ fill: theme.palette.action.hover }}
          isAnimationActive={false}
          animationDuration={0}
          allowEscapeViewBox={{ x: true, y: true }}
          offset={12}
          wrapperStyle={{
            outline: 'none',
            pointerEvents: 'none',
            zIndex: tokens.zIndex.tooltip,
          }}
        />
        <RechartsBar
          dataKey="revenue"
          name="Revenue"
          fill={CHART_COLORS.teal}
          radius={[5, 5, 0, 0]}
          maxBarSize={48}
          activeBar={false}
          animationDuration={800}
        />
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}

const PROJECT_LIFECYCLE_SERIES: Array<{
  key: ProjectLifecycleStageSegment['key']
  label: ProjectLifecycleStageSegment['label']
  color: string
}> = [
  { key: 'pitchDays', label: 'Pitch', color: CHART_COLORS.blue },
  { key: 'liveDays', label: 'Live', color: CHART_COLORS.teal },
  { key: 'completedDays', label: 'Completed', color: CHART_COLORS.green },
]

function buildWeekAxis(rows: ProjectLifecycleChartRow[]): { domainMax: number; ticks: number[] } {
  const maxDays = Math.max(
    0,
    ...rows.map((row) => row.pitchDays + row.liveDays + row.completedDays),
  )
  const maxWeeks = Math.max(1, Math.ceil(maxDays / 7))
  const roughStep = Math.max(1, Math.ceil(maxWeeks / 5))
  const stepWeeks =
    roughStep <= 1 ? 1 : roughStep <= 2 ? 2 : roughStep <= 4 ? 4 : Math.ceil(roughStep / 5) * 5
  const domainWeeks = Math.ceil(maxWeeks / stepWeeks) * stepWeeks
  const ticks: number[] = []
  for (let week = 0; week <= domainWeeks; week += stepWeeks) {
    ticks.push(week * 7)
  }
  return { domainMax: domainWeeks * 7, ticks }
}

function formatWeeks(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return `${Math.round(n / 7)}w`
}

function formatLifecycleDate(value: string): string {
  const parsed = parseDate(value)
  if (!parsed) return '—'
  return parsed.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function ProjectLifecycleTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as ProjectLifecycleChartRow | undefined
  if (!row) return null

  return (
    <ChartTooltipShell>
      <Typography variant="caption" fontWeight={700} sx={{ fontSize: 12, display: 'block', mb: 0.5 }}>
        {row.projectName}
      </Typography>
      {row.stages.map((stage) => (
        <Typography
          key={stage.key}
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: 11, display: 'block', mt: 0.25 }}
        >
          <Box
            component="span"
            sx={{
              color: PROJECT_LIFECYCLE_SERIES.find((item) => item.key === stage.key)?.color,
            }}
          >
            ●
          </Box>{' '}
          {stage.label} - {formatWeeks(stage.days)} ({stage.days} days)
          <Box component="span" sx={{ display: 'block', pl: 1.75, color: 'text.secondary' }}>
            {formatLifecycleDate(stage.startDate)} to {formatLifecycleDate(stage.endDate)}
          </Box>
        </Typography>
      ))}
    </ChartTooltipShell>
  )
}

function ProjectLifecycleChart({ data }: { data: ProjectLifecycleChartRow[] }) {
  const theme = useTheme()
  const axis = useMemo(() => buildWeekAxis(data), [data])
  const height = Math.max(300, data.length * 46 + 86)

  return (
    <Box>
      <Box sx={{ maxHeight: 520, overflowY: 'auto', overflowX: 'hidden' }}>
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart
            data={data}
            layout="vertical"
            barCategoryGap="28%"
            margin={{ top: 12, right: 24, left: 34, bottom: 22 }}
          >
            <CartesianGrid
              stroke={tokens.color.neutral[200]}
              strokeDasharray="3 3"
              horizontal={false}
              vertical
            />
            <XAxis
              type="number"
              domain={[0, axis.domainMax]}
              ticks={axis.ticks}
              tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: tokens.color.neutral[200] }}
              tickFormatter={formatWeeks}
              label={{
                value: 'Weeks',
                position: 'insideBottom',
                offset: -12,
                fill: theme.palette.text.secondary,
                fontSize: 11,
              }}
            />
            <YAxis
              type="category"
              dataKey="projectName"
              width={150}
              tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: tokens.color.neutral[200] }}
            />
            <Tooltip
              content={(props) => <ProjectLifecycleTooltip {...props} />}
              isAnimationActive={false}
              animationDuration={0}
              allowEscapeViewBox={{ x: true, y: true }}
              offset={12}
              wrapperStyle={{
                outline: 'none',
                pointerEvents: 'none',
                zIndex: tokens.zIndex.tooltip,
              }}
              cursor={{ fill: theme.palette.action.hover }}
            />
            {PROJECT_LIFECYCLE_SERIES.map((stage) => (
              <RechartsBar
                key={stage.key}
                dataKey={stage.key}
                name={stage.label}
                stackId="lifecycle"
                fill={stage.color}
                radius={stage.key === 'completedDays' ? [0, 4, 4, 0] : 0}
                maxBarSize={18}
                minPointSize={stage.key === 'completedDays' ? 4 : 0}
                activeBar={false}
                animationDuration={800}
              />
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </Box>
      <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
        <ChartSeriesLegend
          items={PROJECT_LIFECYCLE_SERIES.map((stage) => ({
            label: stage.label,
            color: stage.color,
          }))}
        />
      </Box>
    </Box>
  )
}

const PROJECT_STATUS_AXIS_TICKS = PROJECT_STATUS_PROGRESS_SERIES.map(
  (_stage, index) => index + 0.5,
)

function formatStatusAxis(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return PROJECT_STATUS_PROGRESS_SERIES[Math.floor(n)]?.label ?? ''
}

function formatStageDuration(days: number | null): string {
  if (days == null) return 'Date unavailable'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 60) {
    const weeks = Math.round(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} (${days} days)`
  }
  if (days < 730) {
    const months = Math.round(days / 30.4375)
    return `${months} month${months === 1 ? '' : 's'} (${days} days)`
  }
  const years = Math.round(days / 365.25)
  return `${years} year${years === 1 ? '' : 's'} (${days} days)`
}

function ProjectStatusProgressTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as ProjectStatusProgressChartRow | undefined
  if (!row) return null

  return (
    <ChartTooltipShell>
      <Typography variant="caption" fontWeight={700} sx={{ fontSize: 12, display: 'block', mb: 0.5 }}>
        {row.projectName}
      </Typography>
      {row.stages.map((stage) => {
        const color = PROJECT_STATUS_PROGRESS_SERIES.find((item) => item.key === stage.key)?.color
        return (
          <Typography
            key={stage.key}
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 11, display: 'block', mt: 0.25 }}
          >
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: color,
                mr: 0.75,
              }}
            />
            <Box component="span" sx={{ display: 'none' }}>
              â—
            </Box>{' '}
            {stage.label} - {formatStageDuration(stage.days)}
            {stage.startDate && stage.endDate ? (
              <Box component="span" sx={{ display: 'block', pl: 1.75, color: 'text.secondary' }}>
                {formatLifecycleDate(stage.startDate)} to {formatLifecycleDate(stage.endDate)}
              </Box>
            ) : null}
          </Typography>
        )
      })}
    </ChartTooltipShell>
  )
}

function ProjectStatusProgressChart({ data }: { data: ProjectStatusProgressChartRow[] }) {
  const theme = useTheme()
  const height = Math.max(300, data.length * 46 + 86)

  return (
    <Box>
      <Box sx={{ maxHeight: 520, overflowY: 'auto', overflowX: 'hidden' }}>
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBarChart
            data={data}
            layout="vertical"
            barCategoryGap="28%"
            margin={{ top: 12, right: 24, left: 34, bottom: 22 }}
          >
            <CartesianGrid
              stroke={tokens.color.neutral[200]}
              strokeDasharray="3 3"
              horizontal={false}
              vertical
            />
            <XAxis
              type="number"
              domain={[0, PROJECT_STATUS_PROGRESS_SERIES.length]}
              ticks={PROJECT_STATUS_AXIS_TICKS}
              tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: tokens.color.neutral[200] }}
              tickFormatter={formatStatusAxis}
              label={{
                value: 'Status',
                position: 'insideBottom',
                offset: -12,
                fill: theme.palette.text.secondary,
                fontSize: 11,
              }}
            />
            <YAxis
              type="category"
              dataKey="projectName"
              width={150}
              tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: tokens.color.neutral[200] }}
            />
            <Tooltip
              content={(props) => <ProjectStatusProgressTooltip {...props} />}
              isAnimationActive={false}
              animationDuration={0}
              allowEscapeViewBox={{ x: true, y: true }}
              offset={12}
              wrapperStyle={{
                outline: 'none',
                pointerEvents: 'none',
                zIndex: tokens.zIndex.tooltip,
              }}
              cursor={{ fill: theme.palette.action.hover }}
            />
            {PROJECT_STATUS_PROGRESS_SERIES.map((stage, stageIndex) => (
              <RechartsBar
                key={stage.key}
                dataKey={stage.key}
                name={stage.label}
                stackId="status"
                fill={stage.color}
                radius={
                  stageIndex === PROJECT_STATUS_PROGRESS_SERIES.length - 1
                    ? [0, 4, 4, 0]
                    : 0
                }
                maxBarSize={18}
                activeBar={false}
                animationDuration={800}
              >
                {data.map((row) => {
                  const isReached = row.stages.some((item) => item.key === stage.key)
                  return (
                    <RechartsCell
                      key={`${row.projectId}-${stage.key}`}
                      fill={isReached ? stage.color : 'transparent'}
                    />
                  )
                })}
              </RechartsBar>
            ))}
          </RechartsBarChart>
        </ResponsiveContainer>
      </Box>
      <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
        <ChartSeriesLegend
          items={PROJECT_STATUS_PROGRESS_SERIES.map((stage) => ({
            label: stage.label,
            color: stage.color,
          }))}
        />
      </Box>
    </Box>
  )
}

function TeamPerformanceTooltip({
  active,
  payload,
  format,
}: TooltipContentProps & { format: TeamPerformanceChartConfig['format'] }) {
  if (!active || !payload?.length) return null
  const member = String(payload[0]?.payload?.member ?? '')

  // Calculate total projects if it's the project status breakdown.
  const isNumberProjects = payload.some((entry) =>
    ['pitch', 'live', 'completed', 'cancelled', 'archived'].includes(String(entry.dataKey)),
  )
  let totalProjectsSum = 0
  if (isNumberProjects) {
    payload.forEach(entry => {
      const val = Number(entry.value)
      if (!Number.isNaN(val)) {
        totalProjectsSum += val
      }
    })
  }

  return (
    <ChartTooltipShell>
      {member ? (
        <Typography variant="caption" fontWeight={600} sx={{ fontSize: 12, display: 'block', mb: 0.5 }}>
          {member}
        </Typography>
      ) : null}
      {payload.map((entry) => {
        const key = String(entry.dataKey ?? entry.name ?? '')
        const label = String(entry.name ?? key)
        return (
          <Typography
            key={key}
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 11, display: 'block', mt: 0.25 }}
          >
            <Box component="span" sx={{ color: String(entry.color ?? 'inherit') }}>
              ●
            </Box>{' '}
            {label}:{' '}
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {formatMetricValue(entry.value as number | string | undefined, format)}
            </Box>
          </Typography>
        )
      })}
      {isNumberProjects && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: 11, display: 'block', mt: 0.75, pt: 0.5, borderTop: `1px solid ${tokens.color.neutral[200]}` }}
        >
          Total Projects:{' '}
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {totalProjectsSum}
          </Box>
        </Typography>
      )}
    </ChartTooltipShell>
  )
}

function TeamPerformanceGraph({
  chart,
  projectAreaChart,
  projectLifecycleChart,
  projectStatusProgressChart,
  revenueChart,
  metric,
  teamMemberIds,
  loading,
  yearComparison,
}: {
  chart: TeamPerformanceChartConfig
  projectAreaChart: ProjectAreaChartConfig | null
  projectLifecycleChart: ProjectLifecycleChartConfig | null
  projectStatusProgressChart: ProjectStatusProgressChartConfig | null
  revenueChart: TeamRevenueYearChartConfig | null
  metric: TeamMetric
  teamMemberIds: string[]
  loading: boolean
  yearComparison: boolean
}) {
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    setSwitching(true)
    const timer = window.setTimeout(() => setSwitching(false), 160)
    return () => window.clearTimeout(timer)
  }, [chart, metric, projectAreaChart, projectLifecycleChart, projectStatusProgressChart, revenueChart, teamMemberIds])

  const formatPerfY =
    chart.format === 'currency'
      ? formatAxisAmount
      : chart.format === 'sqft'
        ? formatSqft
        : chart.format === 'days'
          ? formatDays
          : formatCount
  const chartHeight = Math.max(
    300,
    chart.data.length * (yearComparison ? 64 : 44) + 80,
  )
  const memberAxisWidth = Math.min(
    240,
    Math.max(
      140,
      ...chart.data.map((row) => String(row.member ?? '').length * 7 + 24),
    ),
  )
  const hasChartData = chart.data.length > 0
  const hasRevenueData = Boolean(
    revenueChart?.data.some((row) => row.revenue > 0 || row.projects.length > 0),
  )
  const hasProjectLifecycleData = Boolean(projectLifecycleChart?.data.length)
  const hasProjectStatusProgressData = Boolean(projectStatusProgressChart?.data.length)
  const hasProjectAreaData = Boolean(projectAreaChart?.data.length)
  const showLoader = loading || switching

  if (showLoader) {
    return (
      <Box
        sx={{
          minHeight: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress size={28} />
      </Box>
    )
  }

  if (metric === 'Revenue') {
    if (!revenueChart || !hasRevenueData) {
      return (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
        >
          No revenue data for the selected team member.
        </Typography>
      )
    }
    return <TeamRevenueYearChart data={revenueChart.data} />
  }

  if (metric === 'Project Duration') {
    if (!projectLifecycleChart || !hasProjectLifecycleData) {
      return (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
        >
          No projects found for the selected team member.
        </Typography>
      )
    }
    return <ProjectLifecycleChart data={projectLifecycleChart.data} />
  }

  if (metric === 'No of Projects') {
    if (!projectStatusProgressChart || !hasProjectStatusProgressData) {
      return (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
        >
          No projects found for the selected team member.
        </Typography>
      )
    }
    return <ProjectStatusProgressChart data={projectStatusProgressChart.data} />
  }

  if (metric === 'Area') {
    if (!projectAreaChart || !hasProjectAreaData) {
      return (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
        >
          No project area found for the selected team member.
        </Typography>
      )
    }
    return <ProjectAreaChart data={projectAreaChart.data} />
  }

  if (!hasChartData) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontSize: 12, py: 6, textAlign: 'center' }}
      >
        No team member data for the selected filters.
      </Typography>
    )
  }

  return (
    <Box
      sx={{
        maxHeight: 520,
        overflowY: 'auto',
        overflowX: 'hidden',
        '&::-webkit-scrollbar': { width: 6 },
        '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
        '&::-webkit-scrollbar-thumb': {
          bgcolor: 'divider',
          borderRadius: 3,
        },
      }}
    >
      <BarChart
        key={`${teamMemberIds.join(',')}-${metric}`}
        data={[...chart.data]}
        xKey="member"
        height={chartHeight}
        orientation="horizontal"
        stacked={false}
        showLegend={false}
        yAxisWidth={memberAxisWidth}
        barSize={
          yearComparison
            ? 14
            : chart.series.length > 1
              ? 12
              : 18
        }
        bars={chart.series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
        }))}
        formatX={formatPerfY}
        tooltipContent={(props) => (
          <TeamPerformanceTooltip {...props} format={chart.format} />
        )}
      />
      {chart.series.length > 1 ? (
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
          <ChartSeriesLegend
            items={chart.series.map((s) => ({ label: s.label, color: s.color }))}
          />
        </Box>
      ) : null}
    </Box>
  )
}

export function TeamTab({
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
  const projects = useAppSelector((s) => s.projects.items ?? [])
  const projectsLoading = useAppSelector((s) => s.projects.loading)

  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([])
  const [metric, setMetric] = useState<TeamMetric>('Revenue')
  const [serverPerformanceByMember, setServerPerformanceByMember] =
    useState<PerformanceByTeamMemberBundle | null>(null)
  const [serverYearlyRevenueByMember, setServerYearlyRevenueByMember] =
    useState<YearlyRevenueByTeamMemberBundle | null>(null)
  const [serverProjectLifecycleByMember, setServerProjectLifecycleByMember] =
    useState<ProjectLifecycleByTeamMemberBundle | null>(null)
  const [teamDashboardLoading, setTeamDashboardLoading] = useState(true)
  const timePeriod: TeamTimePeriod = 'Lifetime'
  const requestParams = useMemo(() => dashboardDateParams(dateRange), [dateRange])

  useEffect(() => {
    void dispatch(fetchProjects({ page: 1, pageSize: 500 }))
  }, [dispatch])

  const loadTeamDashboard = useCallback(
    async (isActive: () => boolean) => {
      setTeamDashboardLoading(true)
      try {
        const response = await client.get('/dashboard/team', {
          params: requestParams,
        })
        const data = unwrapApiData<TeamDashboardResponse>(response.data)
        if (!isActive()) return
        setServerPerformanceByMember(
          asPerformanceByTeamMemberBundle(data.data?.performanceByTeamMember),
        )
        setServerProjectLifecycleByMember(
          asProjectLifecycleByTeamMemberBundle(data.data?.projectLifecycleByTeamMember),
        )
        setServerYearlyRevenueByMember(
          asYearlyRevenueByTeamMemberBundle(data.data?.yearlyRevenueByTeamMember),
        )
      } catch {
        // Keep last successful payload so a raced/failed refetch cannot blank charts.
        if (!isActive()) return
      } finally {
        if (isActive()) setTeamDashboardLoading(false)
      }
    },
    [requestParams],
  )

  useDashboardReload(loadTeamDashboard, [loadTeamDashboard])

  const showInitialLoader = teamDashboardLoading && serverPerformanceByMember == null
  const performance = useMemo(() => {
    return getTeamPerformanceAnalytics(
      projects,
      timePeriod,
      teamMemberIds,
      metric,
      serverPerformanceByMember?.memberOptions,
    )
  }, [metric, projects, serverPerformanceByMember, teamMemberIds, timePeriod])

  const localYearlyRevenueByMember = useMemo(
    () => buildYearlyRevenueByTeamMemberFromProjects(projects),
    [projects],
  )
  const yearlyRevenueByMember = serverYearlyRevenueByMember ?? localYearlyRevenueByMember
  const revenueYearChart = useMemo(
    () => buildRevenueYearChart(yearlyRevenueByMember, teamMemberIds[0] ?? null),
    [teamMemberIds, yearlyRevenueByMember],
  )
  const localProjectLifecycleByMember = useMemo(
    () => buildProjectLifecycleByTeamMemberFromProjects(projects),
    [projects],
  )
  const projectLifecycleByMember =
    serverProjectLifecycleByMember ?? localProjectLifecycleByMember
  const projectLifecycleChart = useMemo(
    () => buildProjectLifecycleChart(projectLifecycleByMember, teamMemberIds[0] ?? null),
    [projectLifecycleByMember, teamMemberIds],
  )
  const projectStatusProgressChart = useMemo(
    () => buildProjectStatusProgressChart(projectLifecycleByMember, teamMemberIds[0] ?? null),
    [projectLifecycleByMember, teamMemberIds],
  )
  const projectAreaChart = useMemo(
    () => buildProjectAreaChart(projectLifecycleByMember, teamMemberIds[0] ?? null),
    [projectLifecycleByMember, teamMemberIds],
  )
  const completedProjectsYearComparisonChart = useMemo(
    () =>
      buildCompletedProjectsYearComparisonChart(
        projectLifecycleByMember,
        teamMemberIds[0] ?? null,
      ),
    [projectLifecycleByMember, teamMemberIds],
  )
  const teamMemberOptions =
    metric === 'Revenue'
      ? yearlyRevenueByMember.memberOptions
      : metric === 'Project Duration' ||
          metric === 'No of Projects' ||
          metric === 'Area' ||
          metric === 'Completed Projects – Year Comparison'
        ? projectLifecycleByMember.memberOptions
        : performance.memberOptions

  // Filter out any selected member IDs that are not present in options
  useEffect(() => {
    const validIds = teamMemberIds.filter((id) =>
      teamMemberOptions.some((o) => o.value === id),
    )
    if (validIds.length !== teamMemberIds.length) {
      setTeamMemberIds(validIds)
    }
  }, [teamMemberOptions, teamMemberIds])

  const selectedTeamMemberOption = useMemo((): TeamMemberOption | null => {
    const selectedId = teamMemberIds[0]
    if (!selectedId) return null
    return teamMemberOptions.find((opt) => opt.value === selectedId) ?? null
  }, [teamMemberOptions, teamMemberIds])

  const handleTeamMemberChange = (
    _event: SyntheticEvent,
    value: TeamMemberOption | null,
  ) => {
    if (!value || value.value === 'all') {
      setTeamMemberIds([])
    } else {
      setTeamMemberIds([value.value])
    }
  }

  const isYearComparison = metric === 'Completed Projects – Year Comparison'
  const chart = isYearComparison
    ? completedProjectsYearComparisonChart
    : performance.performanceChart
  const teamPerformanceSubtitle =
    metric === 'Revenue'
      ? revenueYearChart.subtitle
      : metric === 'Project Duration'
        ? projectLifecycleChart.subtitle
        : metric === 'No of Projects'
          ? projectStatusProgressChart.subtitle
          : metric === 'Area'
            ? projectAreaChart.subtitle
            : chart.subtitle
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
            Team
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
            Individual performance across revenue, delivery, and capacity.
          </Typography>
        </Box>

        <DashboardDateRangeFilter
          period={datePeriod}
          value={dateRange}
          onPeriodChange={onDatePeriodChange}
          onChange={onDateRangeChange}
        />
      </Box>

      <Box sx={{ mb: 2 }}>
        <ChartCard
          title="Team Performance"
          subtitle={showInitialLoader ? 'Loading team performance…' : teamPerformanceSubtitle}
          action={
            showInitialLoader ? null : (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1.5,
                alignItems: 'flex-end',
                justifyContent: 'flex-end',
              }}
            >
              <Box sx={{ width: { xs: '100%', sm: 220 } }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  sx={FILTER_LABEL_SX}
                >
                  Team Member
                </Typography>
                <Autocomplete
                  size="small"
                  options={teamMemberOptions}
                  value={selectedTeamMemberOption}
                  onChange={handleTeamMemberChange}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.value === value.value}
                  filterOptions={(options, state) => {
                    const query = state.inputValue.trim().toLowerCase()
                    if (!query) return options
                    return options.filter((opt) => opt.label.toLowerCase().includes(query))
                  }}
                  renderOption={(props, option) => {
                    const { key, ...rest } = props as {
                      key: string
                    } & HTMLAttributes<HTMLLIElement>
                    return (
                      <li key={key} {...rest}>
                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                          {option.label}
                        </Typography>
                      </li>
                    )
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder={selectedTeamMemberOption ? undefined : 'All Team Members'}
                      inputProps={{
                        ...params.inputProps,
                        'aria-label': 'Search and select a team member',
                      }}
                    />
                  )}
                  slotProps={{
                    listbox: {
                      sx: { maxHeight: 280, overflow: 'auto' },
                    },
                    paper: {
                      sx: {
                        fontSize: 12,
                        '& .MuiAutocomplete-option': { fontSize: 12, minHeight: 36 },
                      },
                    },
                  }}
                  sx={{
                    ...MEMBER_AUTOCOMPLETE_SX,
                    maxWidth: '100%',
                    '& .MuiOutlinedInput-root': {
                      ...MEMBER_AUTOCOMPLETE_SX['& .MuiOutlinedInput-root'],
                      height: 'auto',
                      minHeight: 32,
                      flexWrap: 'nowrap',
                    },
                  }}
                />
              </Box>

              <Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  sx={FILTER_LABEL_SX}
                >
                  Metric
                </Typography>
                <MuiSelect
                  size="small"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as TeamMetric)}
                  sx={METRIC_SELECT_SX}
                >
                  {TEAM_METRIC_OPTIONS.map((opt) => (
                    <MenuItem key={opt} value={opt} sx={MENU_ITEM_SX}>
                      {opt}
                    </MenuItem>
                  ))}
                </MuiSelect>
              </Box>

            </Box>
            )
          }
        >
          {showInitialLoader ? (
            <DashboardSectionLoader minHeight={320} />
          ) : (
          <TeamPerformanceGraph
            chart={chart}
            projectAreaChart={projectAreaChart}
            projectLifecycleChart={projectLifecycleChart}
            projectStatusProgressChart={projectStatusProgressChart}
            revenueChart={revenueYearChart}
            metric={metric}
            teamMemberIds={teamMemberIds}
            loading={
              metric === 'Revenue' ||
              metric === 'Project Duration' ||
              metric === 'No of Projects' ||
              metric === 'Area' ||
              metric === 'Completed Projects – Year Comparison'
                ? teamDashboardLoading
                : projectsLoading
            }
            yearComparison={isYearComparison}
          />
          )}
        </ChartCard>
      </Box>

    </Box>
  )
}
