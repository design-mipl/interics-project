import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Chip as MuiChip,
  Collapse,
  Stack,
  Typography,
} from '@mui/material'
import { Edit, Email, Phone, Star } from '@mui/icons-material'
import { ChevronDown } from 'lucide-react'
import { useTheme, alpha } from '@mui/material/styles'
import { Button } from '@/design-system/components'
import { usePermission } from '@/hooks/usePermission'
import { store } from '@/store'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchCustomerById } from '@/slices/customers/thunk'
import type { Contact } from '@/slices/customers/reducer'
import { updateProject, fetchProjectById, addProjectVendorAssociation } from '@/slices/projects/thunk'
import type { ContactInfo, Project } from '@/slices/projects/reducer'
import { getInitials, getAvatarColor } from '@/utils/formatters'
import { getProjectAdditionalTeamMembers } from '@/utils/projectAssignedTeam'
import { clientTeamFromContacts, getContactsForCustomer, isPersistedContactId } from '../projectCreateHelpers'
import { CreateContactPersonModal } from './CreateContactPersonModal'
import { EditProjectTeamDrawer } from './EditProjectTeamDrawer'
import { ProjectDetailsSections } from './ProjectDetailsSections'
import { fetchVendorById } from '@/slices/vendors/thunk'
import { getVendorContactsList, normalizeVendorContactsForSelect } from '@/utils/vendorContacts'

const OVERVIEW_CARD_SX = {
  bgcolor: 'background.paper',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 2,
  p: 2,
} as const

const TEAM_SECTION_CARD_SX = {
  ...OVERVIEW_CARD_SX,
  height: '100%',
  minWidth: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
} as const

export interface ProjectOverviewTabProps {
  project: Project
  /** When true, hide Add/Edit team actions regardless of permissions (e.g. read-only embeds). */
  readOnly?: boolean
}

/** Shared Projects → Overview content (also used by Team → Employee → Project Overview). */
export function ProjectOverviewTab({ project, readOnly = false }: ProjectOverviewTabProps) {
  const theme = useTheme()
  const dispatch = useAppDispatch()
  const canEditProject = usePermission('projects', 'edit')
  const allowMutations = !readOnly && canEditProject
  const selectedCustomer = useAppSelector((s) => s.customers.selectedItem)
  const [expandedClientIds, setExpandedClientIds] = useState<Set<string>>(new Set())
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false)
  const [editTeamOpen, setEditTeamOpen] = useState(false)

  const additionalTeamMembers = getProjectAdditionalTeamMembers(project)
  const customerForContacts =
    selectedCustomer?.id === project.customerId ? selectedCustomer : null
  const existingCustomerContacts = getContactsForCustomer(customerForContacts)

  /** Prefer live customer contacts so Client Team stays in sync with customer CRM.
   *  Append linked project vendor contacts (already on project detail) with a Vendor badge. */
  const clientTeamMembers = useMemo((): Array<{
    id: string
    name: string
    designation: string
    phone: string
    email: string
    isPrimary: boolean
    source: 'client' | 'vendor'
  }> => {
    const clientMembers =
      customerForContacts
        ? [...existingCustomerContacts]
            .map((c: Contact) => ({
              id: c.id,
              name: c.name,
              designation: c.designation ?? '',
              phone: c.phone ?? '',
              email: c.email ?? '',
              isPrimary: Boolean(c.isPrimary),
              source: 'client' as const,
            }))
            .sort((a, b) => {
              if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
              return a.name.localeCompare(b.name)
            })
        : (project.clientTeam ?? []).map((m, idx) => ({
            id: `project-client-${idx}`,
            name: m.name ?? '',
            designation: m.designation ?? '',
            phone: m.phone ?? m.contact ?? '',
            email: m.email ?? '',
            isPrimary: idx === 0,
            source: 'client' as const,
          }))

    const vendorSource =
      (project.vendors?.length
        ? project.vendors.flatMap((group) =>
            group.contacts.map((c) => ({
              ...c,
              company: group.vendorName,
              vendorId: group.vendorId,
              source: 'vendor' as const,
            })),
          )
        : project.vendorContacts) ?? []

    const vendorMembers = vendorSource.map((m, idx) => ({
      id: m.id?.trim() || `project-vendor-${idx}-${m.name ?? ''}-${m.phone ?? m.contact ?? ''}`,
      name: m.name ?? '',
      designation: m.designation ?? '',
      phone: m.phone ?? m.contact ?? '',
      email: m.email ?? '',
      isPrimary: false,
      source: 'vendor' as const,
    }))

    // Deduplicate vendor rows by contact id only (never by name).
    const seenVendorIds = new Set<string>()
    const dedupedVendors = vendorMembers.filter((m) => {
      if (!m.name.trim() && !m.phone.trim()) return false
      if (seenVendorIds.has(m.id)) return false
      seenVendorIds.add(m.id)
      return true
    })

    return [...clientMembers, ...dedupedVendors]
  }, [customerForContacts, existingCustomerContacts, project.clientTeam, project.vendorContacts, project.vendors])

  useEffect(() => {
    if (project.customerId) {
      void dispatch(fetchCustomerById(project.customerId))
    }
  }, [dispatch, project.customerId])

  function toggleClientExpanded(id: string) {
    setExpandedClientIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleContactAssigned(info: ContactInfo) {
    const latestCustomer = store.getState().customers.selectedItem
    const contacts =
      latestCustomer?.id === project.customerId
        ? getContactsForCustomer(latestCustomer)
        : existingCustomerContacts

    // Always merge against the latest project in the store (avoids stale props after a prior save).
    const latestProject =
      store.getState().projects.selectedItem?.id === project.id
        ? store.getState().projects.selectedItem
        : project
    const projectForMerge = latestProject ?? project

    // Persist vendor association via additive API — never replace other vendors/contacts.
    if (info.source === 'vendor' && info.vendorId && isPersistedContactId(info.id)) {
      const vendorDetail = await dispatch(fetchVendorById(info.vendorId)).unwrap()
      const validIds = new Set(
        normalizeVendorContactsForSelect(getVendorContactsList(vendorDetail))
          .map((c) => c.id)
          .filter((id) => isPersistedContactId(id)),
      )
      if (!validIds.has(info.id)) {
        throw new Error(
          'Selected vendor contact is not linked to this vendor yet. Re-select the contact and try again.',
        )
      }

      await dispatch(
        addProjectVendorAssociation({
          id: project.id,
          vendorId: info.vendorId,
          vendorContactIds: [info.id],
        }),
      ).unwrap()

      await dispatch(fetchProjectById(project.id)).unwrap()
      return
    }

    // Customer contacts: append the assigned contact to existing project links.
    const existingCustomerIds = (projectForMerge.clientTeam ?? [])
      .map((c) => c.id)
      .filter((id): id is string => Boolean(id) && isPersistedContactId(id))

    const assignedCustomerId = isPersistedContactId(info.id) ? info.id : undefined
    const contactIds = [
      ...new Set([
        ...existingCustomerIds,
        ...(assignedCustomerId ? [assignedCustomerId] : []),
        ...contacts.map((c) => c.id).filter((id) => isPersistedContactId(id)),
      ]),
    ]

    const nextTeam =
      contacts.length > 0
        ? clientTeamFromContacts(contacts, project.customerName ?? '')
        : [
            ...(projectForMerge.clientTeam ?? []),
            ...(info.name ? [info] : []),
          ]

    await dispatch(
      updateProject({
        id: project.id,
        data: {
          ...(contactIds.length ? { contactIds } : {}),
          clientTeam: nextTeam,
        },
      }),
    ).unwrap()

    await dispatch(fetchProjectById(project.id)).unwrap()
  }

  const TeamsRow = (
    <Box
      sx={{
        mt: 2,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 2,
        alignItems: 'stretch',
      }}
    >
      <Box sx={TEAM_SECTION_CARD_SX}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          sx={{ mb: 1.5 }}
        >
          <Typography
            variant="overline"
            sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary' }}
          >
            Team
          </Typography>
          {allowMutations ? (
            <Button
              variant="soft"
              color="primary"
              size="sm"
              startIcon={<Edit sx={{ fontSize: 14 }} />}
              onClick={() => setEditTeamOpen(true)}
            >
              Edit
            </Button>
          ) : null}
        </Stack>
        <Stack gap={1.5} sx={{ flex: 1 }}>
          <Box>
            <Typography
              variant="caption"
              sx={{
                fontSize: 10,
                color: 'text.secondary',
                letterSpacing: 0.5,
                display: 'block',
                mb: 0.75,
              }}
            >
              PROJECT LEAD
            </Typography>
            <Stack direction="row" alignItems="center" gap={1}>
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  bgcolor: alpha(getAvatarColor(project.projectManager).bg, 0.15),
                  color: getAvatarColor(project.projectManager).text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {getInitials(project.projectManager)}
              </Box>
              <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                {project.projectManager}
              </Typography>
            </Stack>
          </Box>
          <Box>
            <Typography
              variant="caption"
              sx={{
                fontSize: 10,
                color: 'text.secondary',
                letterSpacing: 0.5,
                display: 'block',
                mb: 0.75,
              }}
            >
              TEAM MEMBERS
            </Typography>
            <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap" useFlexGap>
              {additionalTeamMembers.length === 0 ? (
                <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>
                  No additional team members
                </Typography>
              ) : (
                additionalTeamMembers.map((member) => (
                  <Stack key={member.userId} direction="row" alignItems="center" gap={1}>
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        bgcolor: alpha(getAvatarColor(member.name).bg, 0.15),
                        color: getAvatarColor(member.name).text,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(member.name)}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                      {member.name}
                    </Typography>
                  </Stack>
                ))
              )}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Box sx={TEAM_SECTION_CARD_SX}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          sx={{ mb: 1.5 }}
        >
          <Typography
            variant="overline"
            sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'text.secondary' }}
          >
            Client Team
          </Typography>
          {allowMutations ? (
            <Button
              variant="soft"
              color="primary"
              size="sm"
              onClick={() => setContactDrawerOpen(true)}
            >
              Add Client team
            </Button>
          ) : null}
        </Stack>
        {clientTeamMembers.length === 0 ? (
          <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>
            No client team contacts added.
          </Typography>
        ) : (
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              width: '100%',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 1.25,
              alignItems: 'start',
            }}
          >
            {clientTeamMembers.map((member) => {
              const memberId = member.id
              const isExpanded = expandedClientIds.has(memberId)
              const isPrimary = member.isPrimary
              const isVendor = member.source === 'vendor'

              return (
                <Box
                  key={memberId}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    border: '1px solid',
                    borderColor: isPrimary ? 'primary.light' : 'divider',
                    borderRadius: 2,
                    px: 1.5,
                    py: 1.25,
                    bgcolor: isPrimary ? alpha(theme.palette.primary.main, 0.03) : 'transparent',
                  }}
                >
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => toggleClientExpanded(memberId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleClientExpanded(memberId)
                      }
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      cursor: 'pointer',
                      outline: 'none',
                      minWidth: 0,
                      '&:focus-visible': {
                        borderRadius: 1,
                        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.35)}`,
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="center" gap={1.25} sx={{ minWidth: 0, flex: 1 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          bgcolor: alpha(getAvatarColor(member.name || 'Client').bg, 0.15),
                          color: getAvatarColor(member.name || 'Client').text,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {getInitials(member.name || 'Client')}
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <Stack
                          direction="row"
                          alignItems="center"
                          gap={0.75}
                          sx={{ minWidth: 0 }}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Typography
                            variant="body2"
                            title={member.name || undefined}
                            sx={{
                              fontSize: 13,
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                              maxWidth: '100%',
                            }}
                          >
                            {member.name || '—'}
                          </Typography>
                          {isPrimary ? (
                            <MuiChip
                              size="small"
                              icon={<Star sx={{ fontSize: '12px !important' }} />}
                              label="Primary"
                              sx={{
                                height: 20,
                                fontSize: 10,
                                borderRadius: '6px',
                                flexShrink: 0,
                                bgcolor: alpha(theme.palette.primary.main, 0.12),
                                color: 'primary.main',
                                '& .MuiChip-label': { px: 1 },
                                '& .MuiChip-icon': { color: 'primary.main', ml: '4px' },
                              }}
                            />
                          ) : null}
                          {isVendor ? (
                            <MuiChip
                              size="small"
                              label="Vendor"
                              sx={{
                                height: 20,
                                fontSize: 10,
                                borderRadius: '6px',
                                flexShrink: 0,
                                bgcolor: alpha(theme.palette.warning.main, 0.12),
                                color: 'warning.dark',
                                border: '1px solid',
                                borderColor: alpha(theme.palette.warning.main, 0.35),
                                '& .MuiChip-label': { px: 1 },
                              }}
                            />
                          ) : null}
                        </Stack>
                        <Typography
                          variant="caption"
                          title={member.designation || undefined}
                          sx={{
                            fontSize: 11,
                            color: 'text.secondary',
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {member.designation || '—'}
                        </Typography>
                      </Box>
                    </Stack>
                    <Box
                      sx={{
                        color: 'text.secondary',
                        display: 'flex',
                        alignItems: 'center',
                        flexShrink: 0,
                        transition: 'transform 0.2s ease',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    >
                      <ChevronDown size={16} strokeWidth={1.75} />
                    </Box>
                  </Box>

                  <Collapse in={isExpanded}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      gap={1.5}
                      flexWrap="wrap"
                      useFlexGap
                      sx={{ mt: 1.25, pl: 6.5, minWidth: 0 }}
                    >
                      <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: 0 }}>
                        <Phone sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }} />
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: 11,
                            color: 'text.secondary',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {member.phone || '—'}
                        </Typography>
                      </Stack>
                      <Stack
                        direction="row"
                        alignItems="center"
                        gap={0.5}
                        sx={{ minWidth: 0, flex: 1 }}
                      >
                        <Email sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }} />
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: 11,
                            color: 'primary.main',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {member.email || '—'}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Collapse>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    </Box>
  )

  return (
    <Stack
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch',
        '& > .MuiCard-root': {
          display: 'flex',
          flexDirection: 'column',
          mb: 2,
        },
        '& > .MuiCard-root > :last-child': {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <ProjectDetailsSections project={project} />
      {TeamsRow}

      {allowMutations ? (
        <>
          <CreateContactPersonModal
            open={contactDrawerOpen}
            onClose={() => setContactDrawerOpen(false)}
            customerId={project.customerId}
            projectId={project.id}
            existingCustomerContacts={existingCustomerContacts}
            initialContactType="customer"
            onAssigned={(info) => handleContactAssigned(info)}
          />

          <EditProjectTeamDrawer
            open={editTeamOpen}
            onClose={() => setEditTeamOpen(false)}
            project={project}
          />
        </>
      ) : null}
    </Stack>
  )
}
