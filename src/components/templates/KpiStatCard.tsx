import { Box, Card, CircularProgress, Stack, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'

export type StatCardVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'info'
  | 'danger'
  | 'purple'
  | 'teal'

const KPI_LIGHT: Record<
  StatCardVariant,
  { iconBg: string; iconColor: string }
> = {
  default: { iconBg: '#F3F4F6', iconColor: '#374151' },
  success: { iconBg: '#DCFCE7', iconColor: '#15803D' },
  warning: { iconBg: '#FEF3C7', iconColor: '#B45309' },
  info: { iconBg: '#DBEAFE', iconColor: '#1D4ED8' },
  danger: { iconBg: '#FEE2E2', iconColor: '#B91C1C' },
  purple: { iconBg: '#EDE9FE', iconColor: '#7C3AED' },
  teal: { iconBg: '#CCFBF1', iconColor: '#0F766E' },
}

const KPI_DARK: Record<
  StatCardVariant,
  { iconBg: string; iconColor: string }
> = {
  default: { iconBg: '#374151', iconColor: '#E5E7EB' },
  success: { iconBg: '#14532D', iconColor: '#86EFAC' },
  warning: { iconBg: '#78350F', iconColor: '#FCD34D' },
  info: { iconBg: '#1E3A8A', iconColor: '#93C5FD' },
  danger: { iconBg: '#7F1D1D', iconColor: '#FCA5A5' },
  purple: { iconBg: '#4C1D95', iconColor: '#C4B5FD' },
  teal: { iconBg: '#134E4A', iconColor: '#5EEAD4' },
}

export function getKpiVariantColors(variant: StatCardVariant, mode: 'light' | 'dark') {
  return mode === 'dark' ? KPI_DARK[variant] : KPI_LIGHT[variant]
}

export interface KpiStatCardProps {
  label: string
  value: string | number
  variant?: StatCardVariant
  icon?: ReactNode
  /** Show a compact loader in place of the value while data is fetching. */
  loading?: boolean
}

export function KpiStatCard({
  label,
  value,
  variant = 'default',
  icon,
  loading = false,
}: KpiStatCardProps) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { iconBg, iconColor } = getKpiVariantColors(variant, mode)

  return (
    <Card
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="overline"
            sx={{
              fontSize: 11,
              fontWeight: 500,
              color: 'text.secondary',
              letterSpacing: 0.8,
              display: 'block',
              lineHeight: 1.2,
            }}
          >
            {label}
          </Typography>
          {loading ? (
            <Box sx={{ mt: 0.75, minHeight: 26, display: 'flex', alignItems: 'center' }}>
              <CircularProgress size={18} thickness={4} />
            </Box>
          ) : (
            <Typography
              sx={{
                fontSize: 22,
                fontWeight: 600,
                color: 'text.primary',
                mt: 0.75,
                lineHeight: 1.2,
              }}
            >
              {value}
            </Typography>
          )}
        </Box>
        {icon && (
          <Box
            sx={{
              width: theme.spacing(8),
              height: theme.spacing(8),
              minWidth: theme.spacing(8),
              borderRadius: '50%',
              bgcolor: iconBg,
              color: iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              '& svg': {
                width: theme.spacing(5),
                height: theme.spacing(5),
                fontSize: theme.spacing(5),
              },
            }}
          >
            {icon}
          </Box>
        )}
      </Stack>
    </Card>
  )
}
