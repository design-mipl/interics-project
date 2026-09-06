import { useState } from 'react'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MuiSelect from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormHelperText from '@mui/material/FormHelperText'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Box from '@mui/material/Box'
import CloseIcon from '@mui/icons-material/Close'
import type { SxProps, Theme } from '@mui/material/styles'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { ReactNode } from 'react'

interface SelectOption {
  label: string
  value: string | number
  disabled?: boolean
  icon?: ReactNode
  sx?: SxProps<Theme>
}

export interface SelectProps {
  label?: string
  placeholder?: string
  value?: string | number
  onChange?: (value: string | number) => void
  options: SelectOption[]
  error?: boolean
  helperText?: string
  disabled?: boolean
  required?: boolean
  size?: 'sm' | 'md'
  fullWidth?: boolean
  clearable?: boolean
  loading?: boolean
  sx?: SxProps<Theme>
}

export default function Select({
  label,
  placeholder,
  value,
  onChange,
  options,
  error = false,
  helperText,
  disabled = false,
  required = false,
  size = 'md',
  fullWidth = false,
  clearable = false,
  loading = false,
  sx,
}: SelectProps) {
  const labelId = label ? `select-label-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined
  const inputHeight = size === 'sm' ? '36px' : '42px'
  const [open, setOpen] = useState(false)

  const handleChange = (e: SelectChangeEvent<string | number>) => {
    onChange?.(e.target.value)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange?.('')
  }

  const showClear = clearable && value !== undefined && value !== ''

  return (
    <FormControl
      error={error}
      disabled={disabled || loading}
      required={required}
      fullWidth={fullWidth}
      size="small"
      sx={sx}
    >
      {label && <InputLabel id={labelId}>{label}</InputLabel>}
      <MuiSelect
        labelId={labelId}
        label={label}
        value={value ?? ''}
        onChange={handleChange}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        displayEmpty={!!placeholder}
        endAdornment={
          loading ? (
            <InputAdornment position="end" sx={{ mr: 2 }}>
              <CircularProgress size={16} />
            </InputAdornment>
          ) : showClear ? (
            <InputAdornment position="end" sx={{ mr: 2 }}>
              <IconButton size="small" onClick={handleClear} edge="end">
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : undefined
        }
        sx={{ height: inputHeight }}
      >
        {placeholder && (
          <MenuItem value="" disabled={!clearable}>
            <Box
              component="span"
              sx={{ color: clearable ? 'text.primary' : 'text.disabled' }}
            >
              {placeholder}
            </Box>
          </MenuItem>
        )}
        {options.map((opt) => (
          <MenuItem key={opt.value} value={opt.value} disabled={opt.disabled} sx={opt.sx}>
            {opt.icon && (
              <Box component="span" sx={{ mr: 1, display: 'inline-flex', alignItems: 'center' }}>
                {opt.icon}
              </Box>
            )}
            {opt.label}
          </MenuItem>
        ))}
      </MuiSelect>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  )
}
