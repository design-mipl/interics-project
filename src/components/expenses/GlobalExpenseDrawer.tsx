import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DrawerForm } from '@/components/templates/DrawerForm'
import {
  ExpenseForm,
  type ExpenseFormData,
  type ExpenseFormHandle,
} from '@/components/forms/ExpenseForm'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchProjects } from '@/slices/projects/thunk'
import { fetchBaseline, fetchVendorPOs } from '@/slices/baseline/thunk'
import { fetchVersions } from '@/slices/pitch/thunk'
import {
  createExpense,
  fetchExpenses,
  fetchReimbursements,
  updateExpense,
} from '@/slices/live/thunk'
import type { Expense } from '@/slices/live/types'
import { isReimbursableExpenseType } from '@/utils/reimbursableSync'
import { useToast } from '@/design-system/components'
import { resolvePitchVersionForProject } from '@/store/selectors/pitchSelectors'

export interface GlobalExpenseDrawerProps {
  open: boolean
  onClose: () => void
  /** When set, drawer opens in edit mode for this expense. */
  editingExpense?: Expense | null
  /** Called after a successful create or update (refetch lists, etc.) */
  onSuccess?: () => void
}

export function GlobalExpenseDrawer({
  open,
  onClose,
  editingExpense = null,
  onSuccess,
}: GlobalExpenseDrawerProps) {
  const dispatch = useAppDispatch()
  const toast = useToast()
  const projects = useAppSelector((s) => s.projects.items ?? [])
  const { baseline, vendorPOs } = useAppSelector((s) => s.baseline)
  const pitchVersions = useAppSelector((s) => s.pitch.versions ?? [])
  const activePitchVersion = useAppSelector((s) => s.pitch.activeVersion)
  const { saving } = useAppSelector((s) => s.live)

  const formRef = useRef<ExpenseFormHandle>(null)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [submitLabel, setSubmitLabel] = useState('Save')
  const isEditMode = Boolean(editingExpense)

  useEffect(() => {
    if (open) {
      void dispatch(fetchProjects({}))
      if (editingExpense) {
        setSelectedProjectId(editingExpense.projectId)
      }
    } else {
      setSelectedProjectId('')
      setSubmitLabel('Save')
    }
  }, [open, dispatch, editingExpense])

  useEffect(() => {
    if (!selectedProjectId) return
    void dispatch(fetchBaseline(selectedProjectId))
    void dispatch(fetchVendorPOs(selectedProjectId))
    void dispatch(fetchVersions(selectedProjectId))
  }, [selectedProjectId, dispatch])

  const pitchVersion = useMemo(
    () =>
      selectedProjectId
        ? resolvePitchVersionForProject(selectedProjectId, activePitchVersion, pitchVersions)
        : null,
    [selectedProjectId, activePitchVersion, pitchVersions],
  )

  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, label: p.name })),
    [projects],
  )

  const handleSubmit = useCallback(
    async (data: ExpenseFormData) => {
      if (data.mode !== 'live_expense') return
      const { projectId, data: body } = data
      try {
        if (isEditMode && editingExpense) {
          await dispatch(
            updateExpense({
              projectId,
              expenseId: editingExpense.id,
              data: body,
            }),
          ).unwrap()
          toast.success('Expense updated')
        } else {
          await dispatch(createExpense({ projectId, data: body })).unwrap()
          if (isReimbursableExpenseType(body.type)) {
            await dispatch(fetchReimbursements(projectId)).unwrap()
          }
          toast.success(
            isReimbursableExpenseType(body.type)
              ? 'Reimbursement added for payables'
              : 'Expense added',
          )
        }
        await dispatch(fetchExpenses({ projectId })).unwrap()
        onSuccess?.()
        onClose()
      } catch {
        toast.error(isEditMode ? 'Failed to update expense' : 'Failed to add expense')
      }
    },
    [dispatch, editingExpense, isEditMode, onClose, onSuccess, toast],
  )

  return (
    <DrawerForm
      open={open}
      onClose={onClose}
      title={isEditMode ? 'Edit Expense' : 'Add Expense'}
      width={520}
      onSubmit={() => {
        void formRef.current?.submit()
      }}
      submitLabel={submitLabel}
      submitLoading={saving}
      submitDisabled={saving}
    >
      <ExpenseForm
        ref={formRef}
        context="global"
        selectedProjectId={selectedProjectId}
        onSelectedProjectIdChange={setSelectedProjectId}
        projectOptions={projectOptions}
        baseline={baseline?.projectId === selectedProjectId ? baseline : null}
        pitchVersion={pitchVersion?.projectId === selectedProjectId ? pitchVersion : null}
        vendorPOs={vendorPOs}
        editingExpense={editingExpense}
        open={open}
        onSubmit={handleSubmit}
        onCancel={onClose}
        onSubmitLabelChange={setSubmitLabel}
      />
    </DrawerForm>
  )
}
