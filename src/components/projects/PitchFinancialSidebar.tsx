import { Box, Stack, Typography, Divider, LinearProgress } from '@mui/material'
import type { PitchVersion } from '@/slices/pitch/reducer'
import type { PitchFinancialMetrics } from '@/store/selectors/pitchSelectors'
import { tokens } from '@/design-system/tokens'
import { formatInr } from '@/utils/formatters'

export interface PitchFinancialSidebarProps {
  version: PitchVersion
  metrics: PitchFinancialMetrics
}

export function PitchFinancialSidebar({ version, metrics: fin }: PitchFinancialSidebarProps) {
  const marginPercent = fin.marginPercent
  const progressValue = Math.min(Math.max(marginPercent, 0), 100)
  const marginBarColor = marginPercent < 0 ? 'error' : 'success'

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 80,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box>
        <Typography variant="overline" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary', display: 'block', mb: 1.5 }}>
          Financial Summary
        </Typography>
        <Stack gap={0.75}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>Revenue</Typography>
            <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700, color: tokens.color.primary[600] }}>
              ₹{formatInr(version.totalRevenue)}
            </Typography>
          </Stack>
          <Divider />
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>Total Cost</Typography>
            <Typography variant="body2" sx={{ fontSize: 14, fontWeight: 700, color: 'warning.main' }}>
              ₹{formatInr(fin.totalCost)}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600 }}>Profitability</Typography>
            <Typography variant="body2" sx={{ fontSize: 14, fontWeight: 700, color: fin.profitability < 0 ? 'error.main' : 'success.main' }}>
              ₹{formatInr(fin.profitability)}
            </Typography>
          </Stack>
        </Stack>
      </Box>

      <Box>
        <Stack gap={0.75}>
          <Typography variant="overline" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary', display: 'block', mb: 0.25 }}>
            Expense Planning
          </Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>Vendor Costs</Typography>
            <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>
              ₹{formatInr(fin.vendorCosts)}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>Planned Expenses</Typography>
            <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600, color: 'text.secondary' }}>
              ₹{formatInr(fin.plannedExpensesTotal)}
            </Typography>
          </Stack>
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="overline" sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary', display: 'block', mb: 0.25 }}>
            Totals
          </Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>Total Cost</Typography>
            <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700, color: 'warning.main' }}>
              ₹{formatInr(fin.totalCost)}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>Profitability</Typography>
            <Typography
              variant="body2"
              sx={{
                fontSize: 13,
                fontWeight: 700,
                color: fin.profitability < 0 ? 'error.main' : 'success.main',
              }}
            >
              ₹{formatInr(fin.profitability)}
            </Typography>
          </Stack>
          <Box>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>Margin</Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: marginPercent < 0 ? 'error.main' : 'success.main',
                }}
              >
                {marginPercent.toFixed(1)}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={progressValue}
              color={marginBarColor}
              sx={{ height: 5, borderRadius: 3 }}
            />
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}
