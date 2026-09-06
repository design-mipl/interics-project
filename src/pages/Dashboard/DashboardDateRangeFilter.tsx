import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { DatePicker } from '@/design-system/components'
import {
  getDashboardPeriodRange,
  type DashboardDatePeriod,
  type DashboardDateRange,
} from './dashboardDateRange'

const DATE_FIELD_SX = {
  '& .MuiInputBase-root': {
    height: 32,
    bgcolor: 'background.paper',
  },
  '& .MuiInputLabel-root': {
    fontSize: 12,
    transform: 'translate(14px, 7px) scale(1)',
  },
  '& .MuiInputLabel-shrink': {
    transform: 'translate(14px, -8px) scale(0.75)',
  },
  '& .MuiInputBase-input': {
    fontSize: 12,
    py: 0.5,
  },
} as const

export function DashboardDateRangeFilter({
  period,
  value,
  onPeriodChange,
  onChange,
}: {
  period: DashboardDatePeriod
  value: DashboardDateRange
  onPeriodChange: (period: DashboardDatePeriod) => void
  onChange: (range: DashboardDateRange) => void
}) {
  const [from, to] = value
  const showCustomRange = period === 'Custom Range'

  function handlePeriodChange(nextPeriod: DashboardDatePeriod) {
    onPeriodChange(nextPeriod)
    if (nextPeriod !== 'Custom Range') {
      onChange(getDashboardPeriodRange(nextPeriod))
    }
  }

  return (
    <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>
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
        Time Period
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: 'wrap',
          width: { xs: '100%', sm: 'auto' },
        }}
      >
        <TextField
          select
          size="small"
          value={period}
          onChange={(event) => handlePeriodChange(event.target.value as DashboardDatePeriod)}
          sx={{
            minWidth: { xs: '100%', sm: 180 },
            '& .MuiInputBase-root': {
              height: 32,
              bgcolor: 'background.paper',
              fontSize: 12,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            },
            '& .MuiOutlinedInput-notchedOutline': {
              border: 0,
            },
            '& .MuiInputBase-root:hover': {
              borderColor: 'text.secondary',
            },
            '& .MuiInputBase-root.Mui-focused': {
              borderColor: 'primary.main',
            },
            '& .MuiSelect-select': {
              py: 0.5,
            },
          }}
        >
          <MenuItem value="This Month">This Month</MenuItem>
          <MenuItem value="Last 6 Months">Last 6 Months</MenuItem>
          <MenuItem value="This Financial Year">This Financial Year</MenuItem>
          <MenuItem value="Custom Range">Custom Range</MenuItem>
        </TextField>

        {showCustomRange ? (
          <>
            <DatePicker
              label="From"
              value={from}
              onChange={(date) => onChange([date, to])}
              maxDate={to ?? undefined}
              size="sm"
              sx={{ ...DATE_FIELD_SX, width: { xs: '100%', sm: 250 } }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0, fontSize: 12 }}
            >
              -
            </Typography>
            <DatePicker
              label="To"
              value={to}
              onChange={(date) => onChange([from, date])}
              minDate={from ?? undefined}
              size="sm"
              sx={{ ...DATE_FIELD_SX, width: { xs: '100%', sm: 250 } }}
            />
          </>
        ) : null}
      </Box>
    </Box>
  )
}
