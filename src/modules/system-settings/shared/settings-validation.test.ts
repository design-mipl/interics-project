import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  requiredGstRateInput,
  requiredRateInput,
  serviceGstRate,
} from '@/modules/system-settings/shared/settings-validation'

describe('settings-validation GST rate input', () => {
  it('accepts integer rates including zero and values outside old slabs', () => {
    expect(requiredGstRateInput('0')).toBeUndefined()
    expect(requiredGstRateInput('18')).toBeUndefined()
    expect(requiredGstRateInput('75')).toBeUndefined()
    expect(requiredGstRateInput('100')).toBeUndefined()
  })

  it('rejects decimal rates with GST-specific message', () => {
    expect(requiredGstRateInput('0.5')).toBe('GST rate must be a whole number.')
    expect(requiredGstRateInput('18.5')).toBe('GST rate must be a whole number.')
    expect(requiredGstRateInput('75.25')).toBe('GST rate must be a whole number.')
  })

  it('rejects negative rates with GST-specific message', () => {
    expect(requiredGstRateInput('-1')).toBe('GST rate cannot be negative.')
    expect(requiredGstRateInput('-10')).toBe('GST rate cannot be negative.')
  })

  it('preserves original required behavior for empty input', () => {
    expect(requiredGstRateInput('')).toBe('Rate is required')
    expect(requiredGstRateInput('   ')).toBe('Rate is required')
  })
})

describe('settings-validation tax rates', () => {
  describe('requiredRateInput', () => {
    it('accepts integer rates including zero', () => {
      expect(requiredRateInput('0', 'Rate')).toBeUndefined()
      expect(requiredRateInput('18', 'Rate')).toBeUndefined()
      expect(requiredRateInput('75', 'Rate')).toBeUndefined()
    })

    it('rejects decimal rates', () => {
      expect(requiredRateInput('5.5', 'Rate')).toBe('Rate must be a whole number')
      expect(requiredRateInput('18.25', 'Rate')).toBe('Rate must be a whole number')
    })

    it('rejects negative rates', () => {
      expect(requiredRateInput('-1', 'Rate')).toBe('Rate must not be negative')
      expect(requiredRateInput('-5', 'Default Rate')).toBe('Default Rate must not be negative')
    })
  })
})

describe('settings-validation service GST', () => {
  it('accepts GST rates outside the old 0/5/12/18/28 restriction', () => {
    expect(serviceGstRate(75)).toBeUndefined()
    expect(serviceGstRate(30)).toBeUndefined()
  })

  it('still requires a GST rate value', () => {
    expect(serviceGstRate(null)).toBe('GST rate is required')
    expect(serviceGstRate(undefined)).toBe('GST rate is required')
  })
})

describe('TaxConfigSection GST rate field', () => {
  it('renders the GST rate numeric input bound to gstRateInput', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../pages/Settings/sections/TaxConfigSection.tsx'),
      'utf8',
    )

    expect(source).toContain('label="Rate (%)"')
    expect(source).toContain('inputMode="numeric"')
    expect(source).toContain('value={gstRateInput}')
    expect(source).toContain('setGstRateInput')
    expect(source).toContain('sanitizeGstRateInput')
    expect(source).toContain('requiredGstRateInput')
    expect(source).toContain('This GST rate value already exists')
    expect(source).toContain('Status-only / unchanged rate while editing')
  })

  it('loads existing saved GST values into gstRateInput on edit', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../../pages/Settings/sections/TaxConfigSection.tsx'),
      'utf8',
    )

    expect(source).toContain('setGstRateInput(String(row.rate))')
  })
})
