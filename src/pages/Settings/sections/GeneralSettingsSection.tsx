import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Box, Typography, TextField, Divider, Skeleton, MenuItem, Stack, CircularProgress } from '@mui/material'
import { SearchableSelect } from '@/components/listing'
import { Edit } from '@mui/icons-material'
import { Button, useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import {
  useGeneralSettingsQuery,
  useUpdateGeneralSettings,
} from '@/modules/system-settings/general-settings'
import type { CompanyProfile } from '@/slices/settings/reducer'
import {
  optionalCompanyName,
  optionalGstin,
  optionalPan,
  optionalEmail,
  optionalWebsite,
  optionalMaxLength,
  optionalPincode,
  collectErrors,
  hasErrors,
  firstErrorMessage,
} from '@/modules/system-settings/shared/settings-validation'
import { parseSettingsApiError, clearFieldError } from '@/modules/system-settings/shared/api-errors'
import { digitsOnly } from '@/constants/locations'
import { lookupPincodeLocation } from '@/utils/pincodeLookup'
import {
  DEFAULT_PHONE_COUNTRY_ISO,
  PHONE_COUNTRY_CODES,
  findPhoneCountryCode,
  parseInternationalPhone,
  sanitizePhoneDigits,
} from '@/utils/phoneCountryCodes'

const COMPANY_TYPE_OPTIONS = [
  { value: 'pvt_ltd', label: 'Private Limited' },
  { value: 'llp', label: 'LLP' },
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
]

function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        py: 1.5,
        px: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', fontSize: 10, fontWeight: 600, letterSpacing: '0.5px' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value || '—'}
      </Typography>
    </Box>
  )
}

function GroupTitle({ label }: { label: string }) {
  return (
    <Box sx={{ px: 2, pt: 2, pb: 0.5, gridColumn: '1 / -1' }}>
      <Typography
        variant="caption"
        sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: '#107E68', textTransform: 'uppercase' }}
      >
        {label}
      </Typography>
    </Box>
  )
}

function SectionDivider() {
  return <Divider sx={{ gridColumn: '1 / -1', my: 1 }} />
}

function CompanyDetailsContainer({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: tokens.color.neutral[50],
        }}
      >
        <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600 }}>
          Company details
        </Typography>
      </Box>
      {children}
    </Box>
  )
}

function optionalCompanyPhone(localNumber: string, countryIso: string): string | undefined {
  const trimmed = localNumber.trim()
  if (!trimmed) return undefined
  const country = findPhoneCountryCode(countryIso)
  if (trimmed.length < country.minDigits || trimmed.length > country.maxDigits) {
    return country.minDigits === country.maxDigits
      ? `Phone number must be ${country.maxDigits} digits for ${country.country}`
      : `Phone number must be ${country.minDigits}-${country.maxDigits} digits for ${country.country}`
  }
  if (!/^\d+$/.test(trimmed)) return 'Phone number must contain digits only'
  return undefined
}

export default function GeneralSettingsSection() {
  const success = useToast((s) => s.success)
  const error = useToast((s) => s.error)
  const { data: companyProfile, loading } = useGeneralSettingsQuery()
  const { mutateAsync, saving } = useUpdateGeneralSettings()
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<CompanyProfile>(companyProfile)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [phoneCountryIso, setPhoneCountryIso] = useState(DEFAULT_PHONE_COUNTRY_ISO)
  const [phoneLocal, setPhoneLocal] = useState('')
  const [pincodeLookupLoading, setPincodeLookupLoading] = useState(false)
  const pincodeLookupSeq = useRef(0)

  useEffect(() => {
    if (!isEditing) {
      setEditForm(companyProfile)
      const parsed = parseInternationalPhone(companyProfile.phone)
      setPhoneCountryIso(parsed.iso)
      setPhoneLocal(parsed.localNumber)
      setPincodeLookupLoading(false)
      pincodeLookupSeq.current += 1
    }
  }, [companyProfile, isEditing])

  const selectedPhoneCountry = findPhoneCountryCode(phoneCountryIso)

  const handleEdit = () => {
    setEditForm(companyProfile)
    const parsed = parseInternationalPhone(companyProfile.phone)
    setPhoneCountryIso(parsed.iso)
    setPhoneLocal(parsed.localNumber)
    setPincodeLookupLoading(false)
    pincodeLookupSeq.current += 1
    setFieldErrors({})
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditForm(companyProfile)
    const parsed = parseInternationalPhone(companyProfile.phone)
    setPhoneCountryIso(parsed.iso)
    setPhoneLocal(parsed.localNumber)
    setPincodeLookupLoading(false)
    pincodeLookupSeq.current += 1
    setFieldErrors({})
  }

  const handlePhoneCountryChange = (nextIso: string) => {
    const nextCountry = findPhoneCountryCode(nextIso)
    setPhoneCountryIso(nextCountry.iso)
    setPhoneLocal((prev) => sanitizePhoneDigits(prev, nextCountry.maxDigits))
    setFieldErrors((errors) => clearFieldError(errors, 'phone'))
  }

  const handlePhoneLocalChange = (value: string) => {
    setPhoneLocal(sanitizePhoneDigits(value, selectedPhoneCountry.maxDigits))
    setFieldErrors((errors) => clearFieldError(errors, 'phone'))
  }

  const setWebsiteFieldError = (value: string) => {
    const message = optionalWebsite(value)
    setFieldErrors((errors) => {
      if (!message) return clearFieldError(errors, 'website')
      return { ...errors, website: message }
    })
  }

  const handleWebsiteChange = (value: string) => {
    setEditForm((prev) => ({ ...prev, website: value }))
    setFieldErrors((errors) => {
      if (!errors.website) return errors
      const message = optionalWebsite(value)
      if (!message) return clearFieldError(errors, 'website')
      return { ...errors, website: message }
    })
  }

  const resolvePincode = async (pin: string) => {
    const seq = ++pincodeLookupSeq.current
    setPincodeLookupLoading(true)
    setFieldErrors((errors) =>
      clearFieldError(clearFieldError(clearFieldError(errors, 'pincode'), 'city'), 'state'),
    )
    try {
      const location = await lookupPincodeLocation(pin)
      if (seq !== pincodeLookupSeq.current) return
      setEditForm((prev) => ({
        ...prev,
        pincode: location.pincode,
        city: location.city,
        state: location.state,
      }))
    } catch {
      if (seq !== pincodeLookupSeq.current) return
      setFieldErrors((errors) => ({
        ...errors,
        pincode: 'Could not resolve city/state for this pincode',
      }))
    } finally {
      if (seq === pincodeLookupSeq.current) {
        setPincodeLookupLoading(false)
      }
    }
  }

  const handlePincodeChange = (raw: string) => {
    const pin = digitsOnly(raw).slice(0, 6)
    setEditForm((prev) => ({ ...prev, pincode: pin }))
    setFieldErrors((errors) => clearFieldError(errors, 'pincode'))
    if (pin.length < 6) {
      pincodeLookupSeq.current += 1
      setPincodeLookupLoading(false)
      return
    }
    void resolvePincode(pin)
  }

  const handleSave = () => {
    const composedPhone = phoneLocal.trim()
      ? `${selectedPhoneCountry.dialCode}${phoneLocal.trim()}`
      : ''
    const next = collectErrors([
      ['companyName', optionalCompanyName(editForm.companyName)],
      ['gstin', optionalGstin(editForm.gstin)],
      ['pan', optionalPan(editForm.pan)],
      ['email', optionalEmail(editForm.email)],
      ['phone', optionalCompanyPhone(phoneLocal, phoneCountryIso)],
      ['website', optionalWebsite(editForm.website)],
      ['addressLine1', optionalMaxLength(editForm.addressLine1, 'Address Line 1', 255)],
      ['addressLine2', optionalMaxLength(editForm.addressLine2, 'Address Line 2', 255)],
      ['city', optionalMaxLength(editForm.city, 'City', 100)],
      ['state', optionalMaxLength(editForm.state, 'State', 100)],
      ['pincode', optionalPincode(editForm.pincode)],
    ])
    setFieldErrors(next)
    if (hasErrors(next)) {
      error(firstErrorMessage(next, 'Please fix the highlighted fields'))
      return
    }
    mutateAsync({
      ...editForm,
      phone: composedPhone,
      website: editForm.website.trim(),
    })
      .then(() => {
        setIsEditing(false)
        success('Company profile saved')
      })
      .catch((err) => {
        const parsed = parseSettingsApiError(err, 'Failed to save profile')
        if (Object.keys(parsed.fieldErrors).length) setFieldErrors(parsed.fieldErrors)
        error(parsed.message)
      })
  }

  const field = (key: keyof CompanyProfile) => ({
    value: (editForm[key] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditForm((prev) => ({ ...prev, [key]: e.target.value }))
      setFieldErrors((errors) => clearFieldError(errors, key))
    },
    error: !!fieldErrors[key],
    helperText: fieldErrors[key],
  })

  const companyTypeLabel =
    COMPANY_TYPE_OPTIONS.find((o) => o.value === companyProfile.companyType)?.label ??
    companyProfile.companyType

  return (
    <Box>
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>
            General Settings
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Company identity and contact
          </Typography>
        </Box>
        {!isEditing && !loading && (
          <Button variant="outlined" color="secondary" size="sm" onClick={handleEdit}>
            <Edit sx={{ fontSize: 14, mr: 0.5 }} /> Edit
          </Button>
        )}
      </Box>

      {/* VIEW MODE */}
      {!isEditing && (
        <Box>
          <CompanyDetailsContainer>
            {loading ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, p: 2 }}>
                {[...Array(12)].map((_, i) => (
                  <Box key={i} sx={{ py: 1.5, px: 0 }}>
                    <Skeleton width="40%" height={12} />
                    <Skeleton width="70%" height={20} sx={{ mt: 0.75 }} />
                  </Box>
                ))}
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                <GroupTitle label="Company Identity" />
                <LabelValue label="Company Name" value={companyProfile.companyName} />
                <LabelValue label="GSTIN" value={companyProfile.gstin} />
                <LabelValue label="PAN" value={companyProfile.pan} />
                <LabelValue label="Company Type" value={companyTypeLabel} />

                <SectionDivider />

                <GroupTitle label="Contact" />
                <LabelValue label="Email" value={companyProfile.email} />
                <LabelValue label="Phone" value={companyProfile.phone} />
                <LabelValue label="Website" value={companyProfile.website} />

                <SectionDivider />

                <GroupTitle label="Address" />
                <LabelValue label="Address Line 1" value={companyProfile.addressLine1} />
                <LabelValue label="Address Line 2" value={companyProfile.addressLine2} />
                <LabelValue label="City" value={companyProfile.city} />
                <LabelValue label="State" value={companyProfile.state} />
                <LabelValue label="Pincode" value={companyProfile.pincode} />
              </Box>
            )}
          </CompanyDetailsContainer>
        </Box>
      )}

      {/* EDIT MODE */}
      {isEditing && (
        <Box>
          <CompanyDetailsContainer>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, p: 2 }}>
              <GroupTitle label="Company Identity" />
              <TextField size="small" label="Company Name" {...field('companyName')} />
              <TextField size="small" label="GSTIN" {...field('gstin')} />
              <TextField size="small" label="PAN" {...field('pan')} />
              <SearchableSelect
                label="Company Type"
                fullWidth
                value={editForm.companyType}
                onChange={(companyType) =>
                  setEditForm((prev) => ({
                    ...prev,
                    companyType: companyType as CompanyProfile['companyType'],
                  }))
                }
                options={COMPANY_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />

              <SectionDivider />

              <GroupTitle label="Contact" />
              <TextField size="small" label="Email" {...field('email')} />
              <Stack direction="row" gap={1} alignItems="flex-start">
                <TextField
                  select
                  size="small"
                  label="Code"
                  value={phoneCountryIso}
                  onChange={(e) => handlePhoneCountryChange(e.target.value)}
                  sx={{
                    width: 88,
                    flexShrink: 0,
                    '& .MuiSelect-select': {
                      pr: '28px !important',
                      whiteSpace: 'nowrap',
                    },
                  }}
                  inputProps={{ 'aria-label': 'Country code' }}
                  SelectProps={{
                    renderValue: (selected) => findPhoneCountryCode(String(selected)).dialCode,
                    MenuProps: {
                      PaperProps: {
                        sx: { maxHeight: 240, minWidth: 220 },
                      },
                    },
                  }}
                >
                  {PHONE_COUNTRY_CODES.map((option) => (
                    <MenuItem key={option.iso} value={option.iso} sx={{ fontSize: 13 }}>
                      {option.dialCode} {option.country}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Phone"
                  fullWidth
                  value={phoneLocal}
                  onChange={(e) => handlePhoneLocalChange(e.target.value)}
                  error={!!fieldErrors.phone}
                  helperText={fieldErrors.phone}
                  placeholder={`${selectedPhoneCountry.maxDigits} digit number`}
                  inputProps={{
                    inputMode: 'numeric',
                    pattern: '[0-9]*',
                    maxLength: selectedPhoneCountry.maxDigits,
                  }}
                />
              </Stack>
              <TextField
                size="small"
                label="Website"
                placeholder="https://www.example.com"
                value={editForm.website}
                onChange={(e) => handleWebsiteChange(e.target.value)}
                onBlur={() => setWebsiteFieldError(editForm.website)}
                error={!!fieldErrors.website}
                helperText={
                  fieldErrors.website ||
                  'Enter a valid URL starting with http:// or https:// (e.g. https://www.example.com)'
                }
                inputProps={{ maxLength: 2048, inputMode: 'url', autoComplete: 'url' }}
                sx={{ gridColumn: '1 / -1' }}
              />

              <SectionDivider />

              <GroupTitle label="Address" />
              <TextField
                size="small"
                label="Address Line 1"
                {...field('addressLine1')}
                sx={{ gridColumn: '1 / -1' }}
              />
              <TextField
                size="small"
                label="Address Line 2"
                {...field('addressLine2')}
                sx={{ gridColumn: '1 / -1' }}
              />
              <TextField size="small" label="City" {...field('city')} />
              <TextField size="small" label="State" {...field('state')} />
              <TextField
                size="small"
                label="Pincode"
                value={editForm.pincode}
                onChange={(e) => handlePincodeChange(e.target.value)}
                error={!!fieldErrors.pincode}
                helperText={
                  fieldErrors.pincode ||
                  (pincodeLookupLoading ? 'Looking up city & state…' : undefined)
                }
                inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                InputProps={{
                  endAdornment: pincodeLookupLoading ? (
                    <CircularProgress color="inherit" size={16} />
                  ) : undefined,
                }}
              />
            </Box>
          </CompanyDetailsContainer>

          {/* Footer */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, pt: 2, mt: 2 }}>
            <Button size="sm" variant="outlined" color="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="contained"
              color="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}
