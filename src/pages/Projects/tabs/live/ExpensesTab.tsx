import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Stack,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableSortLabel,
} from '@mui/material'
import { Plus } from 'lucide-react'
import { WorkspaceSection } from '../../../../components/templates'
import { DrawerForm } from '../../../../components/templates/DrawerForm'
import { Button, StatusBadge, useToast } from '@/design-system/components'
import { tokens } from '@/design-system/tokens'
import { useAppDispatch, useAppSelector } from '../../../../store/hooks'
import {
  createExpense,
  fetchExpenseSummary,
  fetchExpenses,
  fetchReimbursements,
  type ExpenseSummary,
} from '../../../../slices/live/thunk'
import { isReimbursableExpenseType } from '@/utils/reimbursableSync'
import { fetchBaseline, fetchVendorPOs } from '../../../../slices/baseline/thunk'
import { fetchVersions } from '@/slices/pitch/thunk'
import type { Expense, ExpenseType } from '../../../../slices/live/reducer'
import { formatCurrency, formatDate } from '../../../../utils/formatters'
import {
  ExpenseForm,
  type ExpenseFormData,
  type ExpenseFormHandle,
} from '@/components/forms/ExpenseForm'
import {
  ExpenseSummaryStrip,
  ExpenseTypeBadge,
  ViewExpenseModal,
  expenseServiceCell,
  expenseStatusDisplay,
  expenseVendorCell,
} from '@/components/expenses/expenseShared'
import { resolvePitchVersionForProject } from '@/store/selectors/pitchSelectors'
import type { PitchVersion } from '@/slices/pitch/reducer'
import type { Baseline, VendorPO } from '@/slices/baseline/reducer'

type ExpenseFilter = 'all' | ExpenseType

const TABLE_HEADER_SX = {
  fontSize: 10,
  fontWeight: 700,
  color: tokens.color.neutral[500],
  letterSpacing: 0.5,
  textTransform: 'uppercase' as const,
  borderBottom: `1px solid ${tokens.color.neutral[100]}`,
  py: '10px',
  px: 2,
}

const TABLE_CELL_SX = {
  fontSize: 12,
  borderBottom: `1px solid ${tokens.color.neutral[50]}`,
  py: '12px',
  px: 2,
}

// ─── Add drawer ─────────────────────────────────────────────────────────────────

function AddExpenseDrawer({
  open,
  projectId,
  baseline,
  pitchVersion,
  vendorPOs,
  filter,
  onClose,
  onSaved,
}: {
  open: boolean
  projectId: string
  baseline: Baseline | null
  pitchVersion: PitchVersion | null
  vendorPOs: VendorPO[]
  filter: ExpenseFilter
  onClose: () => void
  onSaved: () => void
}) {
  const dispatch = useAppDispatch()
  const { saving } = useAppSelector((s) => s.live)
  const toast = useToast()
  const formRef = useRef<ExpenseFormHandle>(null)

  const handleSubmit = useCallback(
    async (data: ExpenseFormData) => {
      if (data.mode !== 'live_expense') return
      const { projectId: pid, data: body } = data
      try {
        await dispatch(
          createExpense({
            projectId: pid,
            data: body,
          }),
        ).unwrap()
        toast.success(
          isReimbursableExpenseType(body.type) ? 'Reimbursement added for payables' : 'Expense added',
        )
        await dispatch(
          fetchExpenses({ projectId: pid, type: filter === 'all' ? undefined : filter }),
        ).unwrap()
        if (isReimbursableExpenseType(body.type)) {
          await dispatch(fetchReimbursements(pid)).unwrap()
        }
        onSaved()
        onClose()
      } catch {
        toast.error('Failed to add expense')
      }
    },
    [dispatch, toast, onClose, onSaved, filter],
  )

  return (
    <DrawerForm
      open={open}
      onClose={onClose}
      title="Add Expense"
      width={520}
      onSubmit={() => formRef.current?.submit()}
      submitLabel="Add Expense"
      submitLoading={saving}
      submitDisabled={saving}
    >
      <ExpenseForm
        ref={formRef}
        context="live"
        projectId={projectId}
        baseline={baseline?.projectId === projectId ? baseline : null}
        pitchVersion={pitchVersion?.projectId === projectId ? pitchVersion : null}
        vendorPOs={vendorPOs}
        open={open}
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
    </DrawerForm>
  )
}

// ─── Main tab ───────────────────────────────────────────────────────────────────

interface ExpensesTabProps {
  projectId: string
}

export default function ExpensesTab({ projectId }: ExpensesTabProps) {
  const dispatch = useAppDispatch()
  const { baseline, vendorPOs } = useAppSelector((s) => s.baseline)
  const pitchVersions = useAppSelector((s) => s.pitch.versions ?? [])
  const activePitchVersion = useAppSelector((s) => s.pitch.activeVersion)
  const pitchVersion = useMemo(
    () => resolvePitchVersionForProject(projectId, activePitchVersion, pitchVersions),
    [projectId, activePitchVersion, pitchVersions],
  )
  const [filter, setFilter] = useState<ExpenseFilter>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [viewExpense, setViewExpense] = useState<Expense | null>(null)
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [listedExpenses, setListedExpenses] = useState<Expense[]>([])

  const refreshSummary = useCallback(async () => {
    try {
      const next = await dispatch(fetchExpenseSummary(projectId)).unwrap()
      setSummary(next)
    } catch {
      setSummary(null)
    }
  }, [dispatch, projectId])

  const refreshList = useCallback(async () => {
    try {
      const rows = await dispatch(
        fetchExpenses({
          projectId,
          type: filter === 'all' ? undefined : filter,
        }),
      ).unwrap()
      setListedExpenses(rows)
      // Keep full project expenses in Redux for other live tabs
      if (filter !== 'all') {
        void dispatch(fetchExpenses({ projectId }))
      }
    } catch {
      setListedExpenses([])
    }
  }, [dispatch, projectId, filter])

  useEffect(() => {
    void dispatch(fetchBaseline(projectId))
    void dispatch(fetchVendorPOs(projectId))
    void dispatch(fetchVersions(projectId))
    void refreshSummary()
  }, [dispatch, projectId, refreshSummary])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const filtered = useMemo(() => {
    return [...listedExpenses].sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortBy === 'amount') return (a.amount - b.amount) * mul
      const da = new Date(a.date).getTime()
      const db = new Date(b.date).getTime()
      return (da - db) * mul
    })
  }, [listedExpenses, sortBy, sortDir])

  function handleSort(column: 'date' | 'amount') {
    if (sortBy === column) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(column)
      setSortDir(column === 'date' ? 'desc' : 'desc')
    }
  }

  const pills: { id: ExpenseFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'additional', label: 'Additional' },
    { id: 'vendor_linked', label: 'Vendor Linked' },
    { id: 'common', label: 'Common' },
    { id: 'office_expenses', label: 'Office Expenses' },
  ]

  return (
    <>
      <ExpenseSummaryStrip summary={summary} />

      <WorkspaceSection
        title="Project Expenses"
        noPadding
        action={
          <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
            <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mr: 1 }}>
              {pills.map((p) => {
                const selected = filter === p.id
                return (
                  <Box
                    key={p.id}
                    component="button"
                    type="button"
                    onClick={() => setFilter(p.id)}
                    sx={{
                      border: '1px solid',
                      borderColor: selected ? tokens.color.primary[500] : tokens.color.neutral[200],
                      bgcolor: selected ? tokens.color.primary[50] : 'background.paper',
                      color: 'text.primary',
                      px: 2,
                      py: 0.75,
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {p.label}
                  </Box>
                )
              })}
            </Stack>
            <Button
              size="sm"
              variant="contained"
              color="primary"
              label="Add Expense"
              startIcon={<Plus size={14} strokeWidth={2} />}
              onClick={() => setAddOpen(true)}
            />
          </Stack>
        }
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={TABLE_HEADER_SX}>Type</TableCell>
              <TableCell sx={TABLE_HEADER_SX}>Description</TableCell>
              {filter === 'all' || filter === 'vendor_linked' ? (
                <TableCell sx={TABLE_HEADER_SX}>Vendor</TableCell>
              ) : null}
              {filter === 'all' || filter === 'vendor_linked' ? (
                <TableCell sx={TABLE_HEADER_SX}>Service</TableCell>
              ) : null}
              <TableCell sx={TABLE_HEADER_SX}>
                <TableSortLabel
                  active={sortBy === 'amount'}
                  direction={sortBy === 'amount' ? sortDir : 'asc'}
                  onClick={() => handleSort('amount')}
                  sx={{ fontSize: 10 }}
                >
                  Amount
                </TableSortLabel>
              </TableCell>
              <TableCell sx={TABLE_HEADER_SX}>
                <TableSortLabel
                  active={sortBy === 'date'}
                  direction={sortBy === 'date' ? sortDir : 'desc'}
                  onClick={() => handleSort('date')}
                  sx={{ fontSize: 10 }}
                >
                  Date
                </TableSortLabel>
              </TableCell>
              <TableCell sx={TABLE_HEADER_SX}>Status</TableCell>
              <TableCell sx={TABLE_HEADER_SX}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={filter === 'all' || filter === 'vendor_linked' ? 8 : 6}
                  sx={{ ...TABLE_CELL_SX, textAlign: 'center', py: 4 }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No expenses yet
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {filtered.map((exp) => {
              const st = expenseStatusDisplay(exp.status)
              return (
                <TableRow key={exp.id} hover>
                  <TableCell sx={TABLE_CELL_SX}>
                    <ExpenseTypeBadge type={exp.type} />
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX}>
                    <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                      {exp.description}
                    </Typography>
                  </TableCell>
                  {filter === 'all' || filter === 'vendor_linked' ? (
                    <TableCell sx={TABLE_CELL_SX}>{expenseVendorCell(exp)}</TableCell>
                  ) : null}
                  {filter === 'all' || filter === 'vendor_linked' ? (
                    <TableCell sx={TABLE_CELL_SX}>{expenseServiceCell(exp)}</TableCell>
                  ) : null}
                  <TableCell sx={TABLE_CELL_SX}>
                    ₹{formatCurrency(exp.amount)}
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX}>{formatDate(exp.date)}</TableCell>
                  <TableCell sx={TABLE_CELL_SX}>
                    <StatusBadge status={st.status} label={st.label} size="small" />
                  </TableCell>
                  <TableCell sx={TABLE_CELL_SX}>
                    <Button
                      size="sm"
                      variant="outlined"
                      color="primary"
                      label="View"
                      onClick={() => setViewExpense(exp)}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </WorkspaceSection>

      <AddExpenseDrawer
        open={addOpen}
        projectId={projectId}
        baseline={baseline?.projectId === projectId ? baseline : null}
        pitchVersion={pitchVersion?.projectId === projectId ? pitchVersion : null}
        vendorPOs={vendorPOs}
        filter={filter}
        onClose={() => setAddOpen(false)}
        onSaved={() => {
          void refreshSummary()
          void refreshList()
        }}
      />

      <ViewExpenseModal
        open={!!viewExpense}
        expense={viewExpense}
        onClose={() => setViewExpense(null)}
      />
    </>
  )
}
