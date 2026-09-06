import { useState } from 'react'
import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import type { Project } from '@/slices/projects/reducer'
import { WorkspaceSection } from '@/components/templates'
import {
  RecordDetailSectionTitle,
  getRecordDetailFlatSectionSx,
} from '@/pages/workspace/recordDetailTabUtils'
import { formatDate } from '@/utils/formatters'
import {
  PROJECT_DETAILS_GRID_SX,
  METADATA_BODY_SX,
  METADATA_PREWRAP_SX,
  formatBuildingFloor,
  formatExpectedDuration,
} from '../projectOverviewHelpers'
import { getProjectTypes } from '../projectTypes'
import { ProjectTypeTags } from './ProjectTypeTags'

function LabelValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography
        variant="overline"
        sx={{ fontSize: 10, color: 'text.secondary', letterSpacing: 0.6, display: 'block' }}
      >
        {label}
      </Typography>
      <Box sx={{ mt: '2px', minWidth: 0, flex: 1 }}>{children}</Box>
    </Box>
  )
}

const OVERVIEW_TEXT_LIMIT = 90

/** Plain-text preview for optional rich-text project detail fields. */
function formatOptionalHtml(value?: string | null): string {
  if (!value?.trim()) return '—'
  const plain = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return plain || '—'
}

function ExpandableOverviewText({ value }: { value?: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const plain = formatOptionalHtml(value)
  if (plain === '—') {
    return (
      <Typography variant="body2" sx={METADATA_PREWRAP_SX}>
        —
      </Typography>
    )
  }
  const needsTruncate = plain.length > OVERVIEW_TEXT_LIMIT
  const display = !needsTruncate || expanded ? plain : `${plain.slice(0, OVERVIEW_TEXT_LIMIT).trimEnd()}…`
  return (
    <Box>
      <Tooltip title={needsTruncate && !expanded ? plain : ''} placement="top-start">
        <Typography variant="body2" sx={METADATA_PREWRAP_SX}>
          {display}
        </Typography>
      </Tooltip>
      {needsTruncate ? (
        <Typography
          component="button"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          sx={{
            mt: 0.25,
            p: 0,
            border: 0,
            bgcolor: 'transparent',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            color: 'primary.main',
            fontFamily: 'inherit',
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Typography>
      ) : null}
    </Box>
  )
}

interface ProjectDetailsSectionsProps {
  project: Project
}

export function ProjectDetailsSections({ project }: ProjectDetailsSectionsProps) {
  const theme = useTheme()

  return (
    <WorkspaceSection title="Project Details" noPadding>
      <Box sx={{ px: 2, py: 1.5 }}>
      <Stack gap={0}>
        <Box sx={getRecordDetailFlatSectionSx(theme, { isLast: false })}>
          <RecordDetailSectionTitle>Project Profile</RecordDetailSectionTitle>
          <Box sx={PROJECT_DETAILS_GRID_SX}>
            <LabelValue label="Project Code">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {project.projectCode}
              </Typography>
            </LabelValue>
            <LabelValue label="Client">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {project.customerName?.trim() || '—'}
              </Typography>
            </LabelValue>
            <LabelValue label="Location">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {formatBuildingFloor(project)}
              </Typography>
            </LabelValue>
            <LabelValue label="Start Date">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {formatDate(project.startDate)}
              </Typography>
            </LabelValue>
            <LabelValue label="Expected End Date">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {formatDate(project.expectedEndDate)}
              </Typography>
            </LabelValue>
            <LabelValue label="Expected Duration">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {formatExpectedDuration(project.startDate, project.expectedEndDate)}
              </Typography>
            </LabelValue>
            <LabelValue label="Sector">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {project.sector || '—'}
              </Typography>
            </LabelValue>
            <LabelValue label="Project Scope">
              <ProjectTypeTags types={getProjectTypes(project)} />
            </LabelValue>
            <LabelValue label="Carpet Area">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {project.carpetArea ? `${project.carpetArea.toLocaleString()} sq ft` : '—'}
              </Typography>
            </LabelValue>
            <LabelValue label="Headcount">
              <Typography variant="body2" sx={METADATA_BODY_SX}>
                {project.headcount ?? '—'}
              </Typography>
            </LabelValue>
          </Box>
        </Box>

        <Box sx={getRecordDetailFlatSectionSx(theme, { isLast: true })}>
          <RecordDetailSectionTitle>Area & Planning</RecordDetailSectionTitle>
          <Box sx={PROJECT_DETAILS_GRID_SX}>
            <LabelValue label="Workstations">
              <ExpandableOverviewText value={project.workstations} />
            </LabelValue>
            <LabelValue label="Cabins">
              <ExpandableOverviewText value={project.cabins} />
            </LabelValue>
            <LabelValue label="Meeting Rooms">
              <ExpandableOverviewText value={project.meetingRooms} />
            </LabelValue>
            <LabelValue label="Services">
              <ExpandableOverviewText value={project.services} />
            </LabelValue>
            <LabelValue label="Support Function">
              <ExpandableOverviewText value={project.supportFunction} />
            </LabelValue>
          </Box>
        </Box>
      </Stack>
      </Box>
    </WorkspaceSection>
  )
}
