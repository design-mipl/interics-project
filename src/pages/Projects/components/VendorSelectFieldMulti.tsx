import { Box, Checkbox, Divider, FormControl, ListSubheader, MenuItem, Select as MuiSelect } from '@mui/material'

export type VendorOption = { id: string; label: string }

const ADD_VENDOR_VALUE = '__add_new_vendor__'

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Box component="span" sx={{ fontWeight: 500, display: 'block', mb: '4px', fontSize: 12 }}>
      {label}
      {required ? (
        <Box component="span" sx={{ color: 'error.main' }}>
          {' '}
          *
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * Multi-select vendor field that keeps the menu open while selecting vendors.
 * Used by Create Project; singular VendorSelectField remains for other flows.
 */
export function VendorSelectFieldMulti({
  value,
  options,
  onChange,
  onAddNewVendor,
  error,
  loading,
}: {
  value: string[]
  options: VendorOption[]
  onChange: (vendorIds: string[]) => void
  onAddNewVendor?: () => void
  error?: string
  loading?: boolean
}) {
  const selected = new Set(value)

  function openAddNewVendor() {
    queueMicrotask(() => onAddNewVendor?.())
  }

  const selectedLabels = options.filter((opt) => selected.has(opt.id)).map((opt) => opt.label)

  return (
    <Box>
      <FieldLabel label="Vendor" />
      <FormControl fullWidth size="small" error={Boolean(error)}>
        <MuiSelect
          multiple
          value={value}
          displayEmpty
          disabled={loading}
          onChange={(e) => {
            const next = e.target.value
            const asArray = typeof next === 'string' ? next.split(',') : next
            const filtered = asArray.filter((id) => id !== ADD_VENDOR_VALUE)
            onChange(filtered)
          }}
          renderValue={(selectedIds) => {
            if (!selectedIds.length) {
              return (
                <Box component="span" sx={{ color: 'text.secondary', fontSize: 13 }}>
                  {loading ? 'Loading vendors…' : 'Select vendors…'}
                </Box>
              )
            }
            return (
              <Box component="span" sx={{ fontSize: 13 }}>
                {selectedLabels.length ? selectedLabels.join(', ') : `${selectedIds.length} selected`}
              </Box>
            )
          }}
          sx={{ fontSize: 13, minHeight: 40 }}
          MenuProps={{
            PaperProps: {
              sx: { maxHeight: 320 },
            },
            // Keep menu open across checkbox selections (default for multiple Select).
            autoFocus: false,
          }}
        >
          {options.length === 0 ? (
            <MenuItem disabled sx={{ fontSize: 13 }}>
              {loading ? 'Loading…' : 'No vendors found'}
            </MenuItem>
          ) : (
            options.map((opt) => (
              <MenuItem key={opt.id} value={opt.id} sx={{ fontSize: 13 }}>
                <Checkbox size="small" checked={selected.has(opt.id)} sx={{ p: 0.5, mr: 1 }} />
                {opt.label}
              </MenuItem>
            ))
          )}
          {onAddNewVendor ? (
            [
              <ListSubheader key="__add_vendor_divider__" sx={{ lineHeight: '8px', height: 8, p: 0 }}>
                <Divider />
              </ListSubheader>,
              <MenuItem
                key="__add_new_vendor__"
                value={ADD_VENDOR_VALUE}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openAddNewVendor()
                }}
                sx={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'primary.main',
                }}
              >
                + Add New Vendor
              </MenuItem>,
            ]
          ) : null}
        </MuiSelect>
        {error ? (
          <Box component="span" sx={{ fontSize: 11, color: 'error.main', mt: 0.5 }}>
            {error}
          </Box>
        ) : null}
      </FormControl>
    </Box>
  )
}
