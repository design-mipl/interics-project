import type { ReactNode } from 'react'
import { Drawer, Box, Stack } from '@mui/material'
import { Typography } from '@mui/material'
import { CircularProgress } from '@mui/material'
import { Button as MuiButton, IconButton as MuiIconButton } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CloseIcon from '@mui/icons-material/Close'
import { tokens } from '@/design-system/tokens'

interface DrawerFormProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  /** Used by the default footer; omit when using `footer` or `hideFooter`. */
  onSubmit?: () => void
  onCancel?: () => void
  submitLabel?: string
  cancelLabel?: string
  submitLoading?: boolean
  submitDisabled?: boolean
  children: ReactNode
  width?: number
  /** When set, replaces the default Cancel / Submit footer. */
  footer?: ReactNode
  /** Hide footer entirely (e.g. read-only drawer with actions in header). */
  hideFooter?: boolean
  /** Rendered in the header row before the close button (e.g. Edit). */
  headerActions?: ReactNode
  /** Hide the top-right close (X) control. */
  hideCloseButton?: boolean
  /** Removes the bottom border from the header */
  hideHeaderDivider?: boolean
  /** Override header container styles */
  headerSx?: object
  /** Allow nested Modals/Dialogs to receive focus (e.g. QuickAddVendor inside this drawer). */
  disableEnforceFocus?: boolean
}

export function DrawerForm({
  open,
  onClose,
  title,
  subtitle,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  submitLoading = false,
  submitDisabled = false,
  children,
  width = 520,
  footer,
  hideFooter = false,
  headerActions,
  hideCloseButton = false,
  hideHeaderDivider = false,
  headerSx = {},
  disableEnforceFocus = false,
}: DrawerFormProps) {
  const handleCancel = onCancel ?? onClose

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      disableEnforceFocus={disableEnforceFocus}
      PaperProps={{
        sx: {
          width: { xs: '100vw', lg: `${width}px` },
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderLeft: '1px solid',
          borderColor: 'divider',
          borderRadius: '12px 0 0 12px',
        },
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: '20px',
          py: '16px',
          flexShrink: 0,
          borderBottom: hideHeaderDivider ? 'none' : '1px solid',
          borderBottomColor: 'divider',
          ...headerSx,
        }}
      >
        <Box sx={{ minWidth: 0, pr: 1 }}>
          <Typography variant="h6" fontWeight={600} lineHeight={1.3}>
            {title}
          </Typography>
          {subtitle != null && subtitle !== '' && (
            <Box sx={{ mt: 0.5 }}>
              {typeof subtitle === 'string' || typeof subtitle === 'number' ? (
                <Typography variant="body2" color="text.secondary">
                  {subtitle}
                </Typography>
              ) : (
                subtitle
              )}
            </Box>
          )}
        </Box>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ flexShrink: 0 }}>
          {headerActions != null && (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>{headerActions}</Box>
          )}
          {!hideCloseButton && (
            <MuiIconButton
              size="small"
              onClick={onClose}
              sx={{
                color: tokens.color.neutral[400],
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <CloseIcon fontSize="small" />
            </MuiIconButton>
          )}
        </Stack>
      </Stack>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', p: '20px', minWidth: 0 }}>
        {children}
      </Box>

      {/* Footer */}
      {footer !== undefined ? (
        <Box
          sx={{
            flexShrink: 0,
            borderTop: '1px solid',
            borderTopColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          {footer}
        </Box>
      ) : hideFooter ? null : (
        <Stack
          direction="row"
          justifyContent="flex-end"
          gap={1}
          sx={{
            px: '20px',
            py: '14px',
            flexShrink: 0,
            borderTop: '1px solid',
            borderTopColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <MuiButton
            variant="outlined"
            size="small"
            onClick={handleCancel}
            disabled={submitLoading}
            sx={{ height: 32 }}
          >
            {cancelLabel}
          </MuiButton>
          <MuiButton
            variant="contained"
            size="small"
            onClick={onSubmit ?? (() => {})}
            disabled={submitDisabled || submitLoading}
            endIcon={
              submitLoading
                ? <CircularProgress size={12} color="inherit" />
                : <ArrowForwardIcon fontSize="small" />
            }
            sx={{ height: 32, minWidth: 90 }}
          >
            {submitLabel}
          </MuiButton>
        </Stack>
      )}
    </Drawer>
  )
}
