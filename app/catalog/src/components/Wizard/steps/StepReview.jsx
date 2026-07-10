import React from 'react';
import { Box, Card, Typography, Chip, TextField, Button, TableContainer, Table, TableHead, TableRow, TableCell, TableBody } from '@mui/material';
import { PlayCircle } from 'lucide-react';
import { RestrictionDisplay } from '../../RestrictionBuilder';
import { ENV_COLOR } from '../../../utils/helpers';

export default function StepReview({
  roleName, roleType, selectedParentIds,
  environmentId, environments, approvers, description,
  inherited, restrictions,
  simRows, setSimRows, simResults, runSimulation,
  assignUserId, setAssignUserId, assignUserName, setAssignUserName,
  isEditMode, loading, permissions,
  canManageThisDerivedWizard, handleSaveClick
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Summary */}
      <Card sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Role Summary</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Name</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace', color: 'primary.light' }}>{roleName || '—'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Type & Environment</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Chip
                label={roleType === 'ORG_BASED' ? 'Org Role' : (selectedParentIds.length > 0 ? 'Derived' : 'Single')}
                size="small"
                color={roleType === 'ORG_BASED' ? 'primary' : 'secondary'}
                variant="outlined"
                sx={{ height: 20, fontSize: 10 }}
              />
              <Chip
                label={environments.find(e => e.ID === environmentId)?.name || environmentId}
                size="small"
                color={ENV_COLOR[environmentId] || 'default'}
                sx={{ height: 20, fontSize: 10 }}
              />
            </Box>
          </Box>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Approvers</Typography>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {approvers.map(a => a.userName).join(', ') || 'None'}
          </Typography>
        </Box>
        {description && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Description</Typography>
            <Typography variant="body2" color="text.secondary">{description}</Typography>
          </Box>
        )}
      </Card>

      {/* All Restrictions */}
      <Card sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
          Effective Restrictions ({inherited.length + restrictions.length})
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {inherited.map((r, i) => <RestrictionDisplay key={i} restriction={r} isOwn={false} />)}
          {restrictions.map(r => <RestrictionDisplay key={r.ID} restriction={{ ...r, sourceRoleName: 'This Role' }} isOwn={true} />)}
          {inherited.length + restrictions.length === 0 && <Typography variant="body2" color="text.secondary">No restrictions defined.</Typography>}
        </Box>
      </Card>

      {/* Access Simulation */}
      <Card sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Access Simulation</Typography>
        <TextField
          label="Sample Data Rows (JSON Array)"
          multiline
          rows={4}
          fullWidth
          value={simRows}
          onChange={e => setSimRows(e.target.value)}
          sx={{ mb: 2, '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
        />
        <Button variant="outlined" color="primary" onClick={runSimulation} disabled={loading} startIcon={<PlayCircle size={14} />} sx={{ mb: 2 }}>
          Run Simulation
        </Button>

        {simResults && (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 600 }}>Row</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Result</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {simResults.map(r => (
                  <TableRow key={r.rowIndex} hover>
                    <TableCell>#{r.rowIndex + 1}</TableCell>
                    <TableCell sx={{ color: r.passed ? 'success.main' : 'error.main', fontWeight: 600 }}>
                      {r.passed ? '✓ Pass' : '✗ Fail'}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{r.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {/* Immediate Assignment (Optional) */}
      {!isEditMode && (
        <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Direct Assignment (Optional)</Typography>
            <Typography variant="body2" color="text.secondary">Assign this newly created role to a user or group immediately upon deployment.</Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField
              label="User ID / Group ID"
              size="small"
              placeholder="e.g. US12345"
              value={assignUserId}
              onChange={e => setAssignUserId(e.target.value)}
            />
            <TextField
              label="User Name"
              size="small"
              placeholder="e.g. John Doe"
              value={assignUserName}
              onChange={e => setAssignUserName(e.target.value)}
            />
          </Box>
        </Card>
      )}

      <Button
        variant="contained"
        color="primary"
        onClick={handleSaveClick}
        disabled={loading || !roleName || (permissions?.isSuperAdmin ? false : (permissions && (
          roleType === 'ORG_BASED' ? !permissions.canManageOrgRoles :
          (selectedParentIds.length > 0) ? !canManageThisDerivedWizard() : !permissions.canManageSingleRoles
        )))}
        sx={{ alignSelf: 'flex-end', px: 4, py: 1.25 }}
      >
        {loading ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Deploy Role')}
      </Button>
    </Box>
  );
}
