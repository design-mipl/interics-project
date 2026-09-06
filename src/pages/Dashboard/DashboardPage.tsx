/**
 * Dashboard page shell. Tab internals live in their own tab folders.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Box, Paper, Typography } from '@mui/material'
import { Tabs, isoFromDate } from '@/design-system/components'
import { RevenueTab } from './Revenue/Revenue'
import { ProjectsTab } from './Projects/Projects'
import { TeamTab } from './Teams/Teams'
import { VendorsTab } from './Vendors/Vendors'
import {
  getDashboardPeriodRange,
  getCurrentFinancialYearRange,
  type DashboardDatePeriod,
  type DashboardDateRange,
} from './dashboardDateRange'

type DashboardTab = 'revenue' | 'projects' | 'team' | 'vendors'
type DashboardDateRanges = Record<DashboardTab, DashboardDateRange>
type DashboardDatePeriods = Record<DashboardTab, DashboardDatePeriod>

const DASHBOARD_TAB_KEYS: DashboardTab[] = ['revenue', 'projects', 'team', 'vendors']

const DASHBOARD_TABS = [
  { label: 'Revenue', value: 'revenue' },
  { label: 'Projects', value: 'projects' },
  { label: 'Team', value: 'team' },
  { label: 'Vendors', value: 'vendors' },
] as const

function isRelativeDashboardPeriod(period: DashboardDatePeriod): boolean {
  return period === 'This Month' || period === 'Last 6 Months' || period === 'This Financial Year'
}

function sameDashboardRange(a: DashboardDateRange, b: DashboardDateRange): boolean {
  return isoFromDate(a[0]) === isoFromDate(b[0]) && isoFromDate(a[1]) === isoFromDate(b[1])
}

export default function DashboardPage() {
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<DashboardTab>('revenue')
  const [dateRanges, setDateRanges] = useState<DashboardDateRanges>(() => ({
    revenue: getCurrentFinancialYearRange(),
    projects: getCurrentFinancialYearRange(),
    team: getCurrentFinancialYearRange(),
    vendors: getCurrentFinancialYearRange(),
  }))
  const [datePeriods, setDatePeriods] = useState<DashboardDatePeriods>(() => ({
    revenue: 'This Financial Year',
    projects: 'This Financial Year',
    team: 'This Financial Year',
    vendors: 'This Financial Year',
  }))

  // Refresh rolling preset ranges only when navigating back to Dashboard.
  useEffect(() => {
    setDateRanges((prev) => {
      let changed = false
      const next = { ...prev }
      for (const tab of DASHBOARD_TAB_KEYS) {
        const period = datePeriods[tab]
        if (!isRelativeDashboardPeriod(period)) continue
        const refreshed = getDashboardPeriodRange(period)
        if (!sameDashboardRange(prev[tab], refreshed)) {
          next[tab] = refreshed
          changed = true
        }
      }
      return changed ? next : prev
    })
    // Intentionally only when the route entry changes; period changes update ranges directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- datePeriods read from latest render via closure on location.key
  }, [location.key])

  const setTabDateRange = (tab: DashboardTab, range: DashboardDateRange) => {
    setDateRanges((prev) => ({ ...prev, [tab]: range }))
  }

  const setTabDatePeriod = (tab: DashboardTab, period: DashboardDatePeriod) => {
    setDatePeriods((prev) => ({ ...prev, [tab]: period }))
    if (period !== 'Custom Range') {
      setTabDateRange(tab, getDashboardPeriodRange(period))
    }
  }

  return (
    <Box>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h5" fontWeight={700}>
          Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Revenue overview across purchase orders, collections, and vendor payments.
        </Typography>
      </Box>

      <Paper
        elevation={0}
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <Tabs
          items={[...DASHBOARD_TABS]}
          value={activeTab}
          onChange={(value) => setActiveTab(value as DashboardTab)}
          variant="underline"
          scrollable
          size="sm"
          sx={{ px: 2, width: '100%' }}
        />

        <Box sx={{ p: 2 }}>
          {activeTab === 'revenue' && (
            <RevenueTab
              datePeriod={datePeriods.revenue}
              dateRange={dateRanges.revenue}
              onDatePeriodChange={(period) => setTabDatePeriod('revenue', period)}
              onDateRangeChange={(range) => setTabDateRange('revenue', range)}
            />
          )}
          {activeTab === 'projects' && (
            <ProjectsTab
              datePeriod={datePeriods.projects}
              dateRange={dateRanges.projects}
              onDatePeriodChange={(period) => setTabDatePeriod('projects', period)}
              onDateRangeChange={(range) => setTabDateRange('projects', range)}
            />
          )}
          {activeTab === 'team' && (
            <TeamTab
              datePeriod={datePeriods.team}
              dateRange={dateRanges.team}
              onDatePeriodChange={(period) => setTabDatePeriod('team', period)}
              onDateRangeChange={(range) => setTabDateRange('team', range)}
            />
          )}
          {activeTab === 'vendors' && (
            <VendorsTab
              datePeriod={datePeriods.vendors}
              dateRange={dateRanges.vendors}
              onDatePeriodChange={(period) => setTabDatePeriod('vendors', period)}
              onDateRangeChange={(range) => setTabDateRange('vendors', range)}
            />
          )}
        </Box>
      </Paper>
    </Box>
  )
}
