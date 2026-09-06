import { Box, CircularProgress, Skeleton } from '@mui/material'

/** Centered spinner for an individual dashboard section/card/table. */
export function DashboardSectionLoader({
  minHeight = 160,
  size = 28,
}: {
  minHeight?: number
  size?: number
}) {
  return (
    <Box
      sx={{
        minHeight,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 3,
      }}
    >
      <CircularProgress size={size} />
    </Box>
  )
}

/** Compact skeleton used inside KPI cards while that card's value is loading. */
export function DashboardKpiCardSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
      <Skeleton variant="text" width="70%" height={18} />
      <Skeleton variant="text" width="55%" height={32} sx={{ mt: 0.5 }} />
      <Skeleton variant="text" width="90%" height={16} sx={{ mt: 'auto' }} />
    </Box>
  )
}
