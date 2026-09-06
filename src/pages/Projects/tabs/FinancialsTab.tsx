import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Box,
  Card,
  Chip as MuiChip,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import { WorkspaceSection } from '../../../components/templates'
import { tokens } from '@/design-system/tokens'
import { Button, useToast } from '@/design-system/components'
import type { Project } from '../../../slices/projects/reducer'
import { formatCurrencyCompact } from '../../../utils/formatters'
import { openAuthenticatedDocument } from '@/utils/openAuthenticatedDocument'
import {
  vendorInvoiceDocumentOpenUrl,
  TABLE_CELL_SX,
  TABLE_HEADER_SX,
} from './live/vendorSettlement/utils'
import { VendorInvoiceDetailModal } from './live/vendorSettlement/SettlementModals'
import { ViewInvoiceDrawer } from './live/BillingTab'
import { downloadClientInvoiceDocument } from './live/downloadClientInvoice'
import { usePermission } from '@/hooks/usePermission'
import { RecordDetailSectionTitle } from '@/pages/workspace/recordDetailTabUtils'
import {
  PROJECT_DETAILS_GRID_SX,
  METADATA_BODY_SX,
  formatSqftRate,
} from '../projectOverviewHelpers'
import { TaxComplianceSection } from './live/TaxComplianceSection'
import { liveApi, type FinancialInvoiceRow, type FinancialOverviewDto } from '@/api/liveApi'
import { ProjectTabSkeleton } from '../components/ProjectTabSkeleton'
import { useAppDispatch } from '../../../store/hooks'
import { fetchInvoices } from '../../../slices/live/thunk'
import type { ClientInvoice, VendorInvoice } from '../../../slices/live/types'

const SUMMARY_COUNT = 4

const TRACKING_METRIC_COUNT = 6

type FinancialSubTab = 'overview' | 'invoice' | 'compliance'

const FINANCIAL_SUB_TAB_SX = {
  minHeight: 36,
  '& .MuiTab-root': {
    minHeight: 36,
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'none' as const,
    px: 2,
    py: 0,
  },
  '& .MuiTabs-indicator': {
    height: 2,
  },
} as const

function FinancialModuleSectionHeading({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <Box>
      <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700 }}>
        {title}
      </Typography>
      {description != null && (
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 0.25 }}>
          {description}
        </Typography>
      )}
    </Box>
  )
}

const METRIC_CELL_ALIGN_SX = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  textAlign: 'center',
  height: '100%',
} as const

const SUMMARY_CELL_SX = {
  px: '20px',
  py: '4px',
  minWidth: 0,
  ...METRIC_CELL_ALIGN_SX,
} as const

const DURATION_CELL_SX = {
  px: '20px',
  py: 0,
  minWidth: 0,
  ...METRIC_CELL_ALIGN_SX,
} as const

const TRACKING_CELL_SX = {
  px: '20px',
  py: '6px',
  minWidth: 0,
  ...METRIC_CELL_ALIGN_SX,
} as const

const INVOICES_TABLE_COLGROUP = (
  <colgroup>
    <col style={{ width: '14%' }} />
    <col style={{ width: '20%' }} />
    <col style={{ width: '12%' }} />
    <col style={{ width: '14%' }} />
    <col style={{ width: '14%' }} />
    <col style={{ width: '14%' }} />
    <col style={{ width: '12%' }} />
  </colgroup>
)

type ProjectInvoiceRow = FinancialInvoiceRow & { receivedDate: string }

function invoiceDocumentOpenUrl(documentUrl: string | undefined): string | null {
  if (!documentUrl) return null
  return vendorInvoiceDocumentOpenUrl(documentUrl)
}

function fmtInr(amount: number): string {
  return formatCurrencyCompact(amount, 2)
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function activeDurationLabel(startRaw: string | null | undefined, endRaw: string | null | undefined): string {
  if (!startRaw || !endRaw) return '—'
  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—'

  const ms = end.getTime() - start.getTime()
  if (ms <= 0) return '0 days'

  const totalDays = Math.floor(ms / (1000 * 60 * 60 * 24))
  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  if (months <= 0) return `${days} day${days === 1 ? '' : 's'}`
  return `${months} mo ${days} day${days === 1 ? '' : 's'}`
}

interface FinancialsTabProps {
  project: Project
}

function RateField({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="overline"
        sx={{ fontSize: 10, color: 'text.secondary', letterSpacing: 0.6, display: 'block' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: '4px', ...METADATA_BODY_SX, fontWeight: 600 }}>
        {formatSqftRate(value)}
      </Typography>
    </Box>
  )
}

function CommercialRatesSection({
  buildValuePerSqft,
  designFeePerSqft,
}: {
  buildValuePerSqft: number | null
  designFeePerSqft: number | null
}) {
  return (
    <WorkspaceSection title="Commercial rates">
      <RecordDetailSectionTitle>Per sqft values</RecordDetailSectionTitle>
      <Box sx={PROJECT_DETAILS_GRID_SX}>
        <RateField label="Build Value per sqft" value={buildValuePerSqft} />
        <RateField label="Design Fee per sqft" value={designFeePerSqft} />
      </Box>
    </WorkspaceSection>
  )
}

export default function FinancialsTab({ project }: FinancialsTabProps) {
  const toast = useToast((s) => s.showToast)
  const dispatch = useAppDispatch()
  const [activeSubTab, setActiveSubTab] = useState<FinancialSubTab>('overview')
  const canViewFinancialMetrics = usePermission('projectFinancials', 'view')
  const canViewCompliance = usePermission('compliance', 'view')

  const [overview, setOverview] = useState<FinancialOverviewDto | null>(null)
  const [financialInvoices, setFinancialInvoices] = useState<FinancialInvoiceRow[]>([])
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [overviewLoaded, setOverviewLoaded] = useState(false)
  const [invoiceLoaded, setInvoiceLoaded] = useState(false)
  const [viewClientInvoice, setViewClientInvoice] = useState<ClientInvoice | null>(null)
  const [viewVendorInvoice, setViewVendorInvoice] = useState<VendorInvoice | null>(null)
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null)

  const projectId = project.id
  const projectForSummary = project

  async function handleViewInvoice(row: ProjectInvoiceRow) {
    setViewLoadingId(row.id)
    try {
      if (row.invoiceType === 'Client' && row.id.startsWith('client-')) {
        const invoiceId = row.id.slice('client-'.length)
        const invoices = await dispatch(fetchInvoices(projectId)).unwrap()
        const match = invoices.find((inv) => inv.id === invoiceId) ?? null
        if (!match) {
          toast({
            title: 'Unable to open invoice',
            description: 'Client invoice details could not be loaded.',
            variant: 'error',
          })
          return
        }
        setViewClientInvoice(match)
        return
      }

      if (row.invoiceType === 'Vendor' && row.id.startsWith('vendor-')) {
        const invoiceId = row.id.slice('vendor-'.length)
        const invoices = await liveApi.getVendorInvoices(projectId)
        const match = invoices.find((inv) => inv.id === invoiceId) ?? null
        if (!match) {
          toast({
            title: 'Unable to open invoice',
            description: 'Vendor invoice details could not be loaded.',
            variant: 'error',
          })
          return
        }
        setViewVendorInvoice(match)
        return
      }

      toast({
        title: 'Unable to open invoice',
        description: 'Unrecognized invoice type.',
        variant: 'error',
      })
    } catch {
      toast({
        title: 'Unable to open invoice',
        description: 'Invoice details could not be loaded. Try again.',
        variant: 'error',
      })
    } finally {
      setViewLoadingId(null)
    }
  }

  useEffect(() => {
    if (activeSubTab !== 'overview' || overviewLoaded) return
    let cancelled = false
    setOverviewLoading(true)
    void (async () => {
      try {
        const data = await liveApi.getFinancialOverview(projectId)
        if (!cancelled) {
          setOverview(data)
          setOverviewLoaded(true)
        }
      } catch {
        if (!cancelled) setOverview(null)
      } finally {
        if (!cancelled) setOverviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSubTab, overviewLoaded, projectId])

  useEffect(() => {
    if (activeSubTab !== 'invoice' || invoiceLoaded) return
    let cancelled = false
    setInvoiceLoading(true)
    void (async () => {
      try {
        const rows = await liveApi.getFinancialInvoices(projectId)
        if (!cancelled) {
          setFinancialInvoices(rows)
          setInvoiceLoaded(true)
        }
      } catch {
        if (!cancelled) setFinancialInvoices([])
      } finally {
        if (!cancelled) setInvoiceLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSubTab, invoiceLoaded, projectId])

  const projectStartDate = projectForSummary.startDate
  const projectEndDate = projectForSummary.expectedEndDate
  const activeDuration = useMemo(() => {
    if (!projectStartDate || !projectEndDate) return '—'
    return activeDurationLabel(projectStartDate, projectEndDate)
  }, [projectStartDate, projectEndDate])

  const projectInvoiceRows = useMemo((): ProjectInvoiceRow[] => {
    return financialInvoices.map((row) => ({ ...row, receivedDate: row.invoiceDate }))
  }, [financialInvoices])

  const revenue = overview?.summary.revenue ?? 0
  const cost = overview?.summary.cost ?? 0
  const grossProfit = revenue - cost
  const marginPct = revenue === 0 ? 0 : (grossProfit / revenue) * 100

  const summaryMetrics: Array<{
    label: string
    valueColor: string
    renderValue: () => ReactNode
  }> = [
    {
      label: 'REVENUE',
      valueColor: 'primary.main',
      renderValue: () => formatCurrencyCompact(revenue, 2),
    },
    {
      label: 'COST',
      valueColor: 'warning.main',
      renderValue: () => formatCurrencyCompact(cost, 2),
    },
    {
      label: 'GROSS PROFIT',
      valueColor: grossProfit < 0 ? 'error.main' : 'success.main',
      renderValue: () => formatCurrencyCompact(grossProfit, 2),
    },
    {
      label: 'MARGIN %',
      valueColor: marginPct < 0 ? 'error.main' : 'success.main',
      renderValue: () => `${marginPct.toFixed(1)}%`,
    },
  ]

  const trackingMetrics = overview
    ? [
        { label: 'Amount Received', value: fmtInr(overview.tracking.amountReceived) },
        { label: 'Invoices Under Process', value: fmtInr(overview.tracking.invoicesUnderProcess) },
        { label: 'Unbilled Amount', value: fmtInr(overview.tracking.unbilledAmount) },
        { label: 'Vendor Payment Amount', value: fmtInr(overview.tracking.vendorPaymentAmount) },
        { label: 'Unbilled Vendor Payments', value: fmtInr(overview.tracking.unbilledVendorPayments) },
        { label: 'Expenses', value: fmtInr(overview.tracking.expenses) },
      ]
    : []

  const subTabs = useMemo(() => {
    const tabs: { label: string; value: FinancialSubTab }[] = [
      { label: 'Financial Overview', value: 'overview' },
      { label: 'Invoice', value: 'invoice' },
    ]
    if (canViewCompliance) {
      tabs.push({ label: 'Tax & Compliance', value: 'compliance' })
    }
    return tabs
  }, [canViewCompliance])

  useEffect(() => {
    if (!canViewCompliance && activeSubTab === 'compliance') {
      setActiveSubTab('overview')
    }
  }, [canViewCompliance, activeSubTab])

  const tabLoading =
    (activeSubTab === 'overview' && overviewLoading) ||
    (activeSubTab === 'invoice' && invoiceLoading)

  if (tabLoading) {
    return <ProjectTabSkeleton rows={6} showKpis />
  }

  return (
    <Box>
      <Box
        sx={{
          borderBottom: `1px solid ${tokens.color.neutral[100]}`,
          mb: 2,
        }}
      >
        <Tabs
          value={activeSubTab}
          onChange={(_, value: FinancialSubTab) => setActiveSubTab(value)}
          sx={FINANCIAL_SUB_TAB_SX}
        >
          {subTabs.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>
      </Box>

      {activeSubTab === 'overview' ? (
        <Stack gap={2}>
          <FinancialModuleSectionHeading
            title="Financial Overview"
            description="Project revenue, cost, collections, and variance against baseline."
          />

      {canViewFinancialMetrics && overview ? (
        <CommercialRatesSection
          buildValuePerSqft={overview.commercialRates.buildValuePerSqft}
          designFeePerSqft={overview.commercialRates.designFeePerSqft}
        />
      ) : null}

      {/* Section 1 — Summary strip */}
      <Card
        sx={{
          mb: 0,
          p: '10px 0',
          display: 'grid',
          alignItems: 'stretch',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            lg: `repeat(${SUMMARY_COUNT}, 1fr)`,
          },
        }}
      >
        {summaryMetrics.map((metric, idx) => (
          <Box
            key={metric.label}
            sx={(t) => ({
              ...SUMMARY_CELL_SX,
              borderRight: idx < summaryMetrics.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider',
              [t.breakpoints.down('lg')]: {
                borderRight:
                  idx < summaryMetrics.length - 1 && idx % 2 === 0 ? '1px solid' : 'none',
                borderBottom: idx < summaryMetrics.length - 2 ? '1px solid' : 'none',
              },
            })}
          >
            <Typography
              variant="overline"
              sx={{
                fontSize: 10,
                color: 'text.secondary',
                letterSpacing: 0.6,
                display: 'block',
              }}
            >
              {metric.label}
            </Typography>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                fontSize: 15,
                mt: '1px',
                color: metric.valueColor,
              }}
            >
              {metric.label === 'MARGIN %' ? (
                metric.renderValue()
              ) : (
                metric.renderValue()
              )}
            </Typography>
          </Box>
        ))}
      </Card>

      <Card
        sx={{
          mb: 0,
          py: '12px',
          px: 0,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: 'stretch',
          border: `1px solid ${tokens.color.neutral[100]}`,
          borderRadius: 2,
        }}
      >
        <Box
          sx={(t) => ({
            px: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            borderColor: 'divider',
            [t.breakpoints.up('md')]: {
              minWidth: 148,
              borderRight: '1px solid',
            },
            [t.breakpoints.down('md')]: {
              borderBottom: '1px solid',
              pb: 1,
              mb: 0.5,
            },
          })}
        >
          <Typography
            variant="overline"
            sx={{
              fontSize: 10,
              color: 'text.secondary',
              letterSpacing: 0.6,
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            PROJECT DURATION
          </Typography>
        </Box>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'grid',
            alignItems: 'stretch',
            gridTemplateColumns: { xs: '1fr', md: `repeat(3, minmax(0, 1fr))` },
          }}
        >
          {[
            { label: 'Project Start Date', value: fmtDate(projectStartDate) },
            { label: 'Project End Date', value: fmtDate(projectEndDate) },
            {
              label: 'Active Duration / Timeline',
              value: activeDuration,
            },
          ].map((item, idx) => (
            <Box
              key={item.label}
              sx={(t) => ({
                ...DURATION_CELL_SX,
                borderRight: idx < 2 ? '1px solid' : 'none',
                borderColor: 'divider',
                [t.breakpoints.down('md')]: {
                  borderRight: 'none',
                  borderBottom: idx < 2 ? '1px solid' : 'none',
                  py: idx === 0 ? 0 : 1.5,
                  pb: idx === 2 ? 0 : undefined,
                },
              })}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                {item.label}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, fontSize: 13, fontWeight: 600 }}>
                {item.value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Card>

      <Card
        sx={{
          mb: 0,
          p: '10px 0',
          display: 'grid',
          alignItems: 'stretch',
          gridTemplateColumns: {
            xs: 'repeat(1, 1fr)',
            sm: 'repeat(2, 1fr)',
            lg: `repeat(${TRACKING_METRIC_COUNT}, 1fr)`,
          },
        }}
      >
        {trackingMetrics.map((metric, idx) => (
          <Box
            key={metric.label}
            sx={(t) => ({
              ...TRACKING_CELL_SX,
              borderColor: 'divider',
              [t.breakpoints.up('lg')]: {
                borderRight: idx < trackingMetrics.length - 1 ? '1px solid' : 'none',
                borderBottom: 'none',
              },
              [t.breakpoints.between('sm', 'lg')]: {
                borderRight: idx % 2 === 0 && idx < trackingMetrics.length - 1 ? '1px solid' : 'none',
                borderBottom: idx < trackingMetrics.length - 2 ? '1px solid' : 'none',
              },
              [t.breakpoints.down('sm')]: {
                borderRight: 'none',
                borderBottom: idx < trackingMetrics.length - 1 ? '1px solid' : 'none',
              },
            })}
          >
            <Typography
              variant="overline"
              sx={{ fontSize: 10, color: 'text.secondary', letterSpacing: 0.5, display: 'block' }}
            >
              {metric.label}
            </Typography>
            <Typography variant="body2" sx={{ mt: '2px', fontSize: 13, fontWeight: 700 }}>
              {metric.value}
            </Typography>
          </Box>
        ))}
      </Card>
        </Stack>
      ) : null}

      {activeSubTab === 'invoice' ? (
        <Stack gap={2}>
          <WorkspaceSection title="Invoices" noPadding>
            {projectInvoiceRows.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, px: 2 }}>
                No invoices available.
              </Typography>
            ) : (
              <TableContainer>
                <Table
                  size="small"
                  sx={{
                    tableLayout: 'fixed',
                    width: '100%',
                    '& .MuiTableCell-root': { verticalAlign: 'middle' },
                  }}
                >
                  {INVOICES_TABLE_COLGROUP}
                  <TableHead>
                    <TableRow>
                      {[
                        'Invoice No.',
                        'Party',
                        'Invoice Type',
                        'Amount',
                        'Received Date',
                        'Uploaded Date',
                        'Action',
                      ].map((h) => (
                        <TableCell key={h} sx={TABLE_HEADER_SX}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {projectInvoiceRows.map((row) => {
                      return (
                        <TableRow key={row.id} hover>
                          <TableCell sx={{ ...TABLE_CELL_SX, fontWeight: 600 }}>
                            {row.invoiceNumber}
                          </TableCell>
                          <TableCell sx={TABLE_CELL_SX}>{row.party}</TableCell>
                          <TableCell sx={TABLE_CELL_SX}>
                            <MuiChip
                              label={row.invoiceType}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: 11,
                                fontWeight: 600,
                                bgcolor:
                                  row.invoiceType === 'Client'
                                    ? tokens.color.info[100]
                                    : tokens.color.neutral[100],
                                color:
                                  row.invoiceType === 'Client'
                                    ? tokens.color.info[800]
                                    : tokens.color.neutral[700],
                                '& .MuiChip-label': { px: 1 },
                              }}
                            />
                          </TableCell>
                          <TableCell sx={TABLE_CELL_SX}>{fmtInr(row.amount)}</TableCell>
                          <TableCell sx={TABLE_CELL_SX}>{fmtDate(row.receivedDate)}</TableCell>
                          <TableCell sx={TABLE_CELL_SX}>{fmtDate(row.uploadedDate)}</TableCell>
                          <TableCell sx={TABLE_CELL_SX}>
                            <Button
                              size="sm"
                              variant="outlined"
                              color="primary"
                              label="View"
                              loading={viewLoadingId === row.id}
                              onClick={() => {
                                void handleViewInvoice(row)
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </WorkspaceSection>
        </Stack>
      ) : null}

      <ViewInvoiceDrawer
        open={!!viewClientInvoice}
        invoice={viewClientInvoice}
        projectName={projectForSummary.name}
        onClose={() => setViewClientInvoice(null)}
        onRecordPayment={() => {
          setViewClientInvoice(null)
        }}
        onDownloadPdf={() => {
          if (!viewClientInvoice) return
          const openUrl = invoiceDocumentOpenUrl(viewClientInvoice.documentUrl)
          if (openUrl) {
            void openAuthenticatedDocument(openUrl, () => {
              toast({
                title: 'Unable to open invoice document',
                description: 'The invoice document could not be opened.',
                variant: 'error',
              })
            })
            return
          }
          downloadClientInvoiceDocument({
            invoiceNumber: viewClientInvoice.invoiceNumber,
            invoiceDate: viewClientInvoice.invoiceDate,
            dueDate: viewClientInvoice.dueDate,
            projectName: projectForSummary.name,
            clientName: viewClientInvoice.clientName ?? projectForSummary.customerName ?? '',
            notes: viewClientInvoice.notes,
            milestoneName: viewClientInvoice.milestoneName,
            serviceName: viewClientInvoice.serviceName,
            lineItems: viewClientInvoice.lineItems.map((l) => ({
              serviceName: l.serviceName,
              amount: l.amount,
              labourCessRate: l.labourCessRate,
              gstRate: l.gstRate,
              labourCessAmount: l.labourCessAmount,
              taxableAmount: l.taxableAmount,
              gstAmount: l.gstAmount,
            })),
          })
        }}
      />

      <VendorInvoiceDetailModal
        open={!!viewVendorInvoice}
        invoice={viewVendorInvoice}
        onClose={() => setViewVendorInvoice(null)}
      />

      {activeSubTab === 'compliance' && canViewCompliance ? (
        <Stack gap={2}>
          <FinancialModuleSectionHeading
            title="Tax & Compliance"
            description="GST, labour cess, and TDS position for this project."
          />
          <TaxComplianceSection
            projectId={projectId}
            clientName={projectForSummary.customerName}
          />
        </Stack>
      ) : null}
    </Box>
  )
}
