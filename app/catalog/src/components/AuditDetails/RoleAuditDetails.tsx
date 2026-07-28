import React from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Paper
} from '@mui/material';
import AuditHeader from './AuditHeader';

function formatValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function formatUserDisplay(a) {
  if (!a) return '—';
  if (typeof a === 'string') return a;
  const name = a.userName || a.userId;
  const id = a.userId;
  if (!name || name === id || (id && name.includes(`(${id})`))) {
    return name || id || '—';
  }
  return `${name} (${id})`;
}

function formatRestrictionText(r) {
  if (!r) return '—';
  if (typeof r === 'string') return r;
  const val = r.value !== undefined ? r.value : r.val;
  const type = r.filterType || r.type || 'SINGLE_VALUE';
  return `${val} (${type})`;
}

function processRestrictionsDiff(oldList = [], newList = []) {
  const oldArr = Array.isArray(oldList) ? oldList : [];
  const newArr = Array.isArray(newList) ? newList : [];
  const rows = [];
  const oldMap = new Map();
  const newMap = new Map();

  oldArr.forEach(r => oldMap.set(r.ID || `${r.field}_${r.value}`, r));
  newArr.forEach(r => newMap.set(r.ID || `${r.field}_${r.value}`, r));

  newArr.forEach(r => {
    const key = r.ID || `${r.field}_${r.value}`;
    const oldItem = oldMap.get(key) || oldArr.find(o => o.field === r.field);
    if (!oldItem) {
      rows.push({
        label: r.field,
        actionLabel: 'Added',
        actionType: 'Added',
        oldVal: '—',
        newVal: formatRestrictionText(r)
      });
    } else if (oldItem.value !== r.value || oldItem.filterType !== r.filterType) {
      rows.push({
        label: r.field,
        actionLabel: 'Changed',
        actionType: 'Changed',
        oldVal: formatRestrictionText(oldItem),
        newVal: formatRestrictionText(r)
      });
    }
  });

  oldArr.forEach(r => {
    const key = r.ID || `${r.field}_${r.value}`;
    const newItem = newMap.get(key) || newArr.find(n => n.field === r.field);
    if (!newItem) {
      rows.push({
        label: r.field,
        actionLabel: 'Deleted',
        actionType: 'Deleted',
        oldVal: formatRestrictionText(r),
        newVal: '—'
      });
    }
  });

  return rows;
}

function processApproversDiff(oldList = [], newList = []) {
  const oldArr = Array.isArray(oldList) ? oldList : [];
  const newArr = Array.isArray(newList) ? newList : [];
  const rows = [];
  const oldSet = new Set(oldArr.map(a => a.userId));
  const newSet = new Set(newArr.map(a => a.userId));

  newArr.forEach(a => {
    if (!oldSet.has(a.userId)) {
      rows.push({
        user: formatUserDisplay(a),
        actionLabel: 'Added',
        actionType: 'Added'
      });
    }
  });

  oldArr.forEach(a => {
    if (!newSet.has(a.userId)) {
      rows.push({
        user: formatUserDisplay(a),
        actionLabel: 'Deleted',
        actionType: 'Deleted'
      });
    }
  });

  return rows;
}

function processParentRolesDiff(oldList = [], newList = []) {
  const oldArr = Array.isArray(oldList) ? oldList : [];
  const newArr = Array.isArray(newList) ? newList : [];
  const rows = [];
  const oldSet = new Set(oldArr.map(p => p.parent_ID || p.parent?.ID));
  const newSet = new Set(newArr.map(p => p.parent_ID || p.parent?.ID));

  newArr.forEach(p => {
    const pid = p.parent_ID || p.parent?.ID;
    if (pid && !oldSet.has(pid)) {
      rows.push({
        user: pid,
        actionLabel: 'Added',
        actionType: 'Added'
      });
    }
  });

  oldArr.forEach(p => {
    const pid = p.parent_ID || p.parent?.ID;
    if (pid && !newSet.has(pid)) {
      rows.push({
        user: pid,
        actionLabel: 'Deleted',
        actionType: 'Deleted'
      });
    }
  });

  return rows;
}

function processAssignmentsDiff(oldList = [], newList = []) {
  const oldArr = Array.isArray(oldList) ? oldList : [];
  const newArr = Array.isArray(newList) ? newList : [];
  const rows = [];
  const oldSet = new Set(oldArr.map(a => a.userId));
  const newSet = new Set(newArr.map(a => a.userId));

  newArr.forEach(a => {
    if (!oldSet.has(a.userId)) {
      rows.push({
        user: formatUserDisplay(a),
        actionLabel: 'Assigned',
        actionType: 'Added'
      });
    }
  });

  oldArr.forEach(a => {
    if (!newSet.has(a.userId)) {
      rows.push({
        user: formatUserDisplay(a),
        actionLabel: 'Unassigned',
        actionType: 'Deleted'
      });
    }
  });

  return rows;
}

export default function RoleAuditDetails({ log }) {
  let details = {};

  try {
    details = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {});
  } catch (e) {
    details = { raw: log.details };
  }

  const action = log.action;

  // Helper to render 4-column section table for Restrictions / General Properties
  const renderSectionTable = (title, rows, isDiff = true) => {
    if (!rows || rows.length === 0) return null;

    return (
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
        >
          {title}
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Item / Field</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                {isDiff ? (
                  <>
                    <TableCell sx={{ fontWeight: 600 }}>Old Value</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>New Value</TableCell>
                  </>
                ) : (
                  <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{row.label}</TableCell>
                  <TableCell>
                    <Chip
                      label={row.actionLabel || 'Modified'}
                      size="small"
                      sx={{
                        fontWeight: 600,
                        fontSize: 10,
                        height: 20,
                        bgcolor: row.actionType === 'Added' ? 'success.light' : row.actionType === 'Deleted' ? 'error.light' : 'info.light',
                        color: row.actionType === 'Added' ? 'success.dark' : row.actionType === 'Deleted' ? 'error.dark' : 'info.dark',
                        border: '1px solid',
                        borderColor: row.actionType === 'Added' ? 'success.main' : row.actionType === 'Deleted' ? 'error.main' : 'info.main'
                      }}
                    />
                  </TableCell>
                  {isDiff ? (
                    <>
                      <TableCell sx={{ color: 'error.main', textDecoration: row.actionType === 'Changed' ? 'line-through' : 'none' }}>
                        {formatValue(row.oldVal)}
                      </TableCell>
                      <TableCell sx={{ color: 'success.main' }}>
                        {formatValue(row.newVal)}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell sx={{ color: 'text.primary' }}>
                      {formatValue(row.val)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };

  // Helper to render 2-column section table for Approvers / Parent Roles / Assignments
  const renderTwoColumnSectionTable = (title, rows, col1Header = 'User', col2Header = 'Action') => {
    if (!rows || rows.length === 0) return null;

    return (
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
        >
          {title}
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{col1Header}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{col2Header}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {formatValue(row.user || row.label)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={row.actionLabel || 'Modified'}
                      size="small"
                      sx={{
                        fontWeight: 600,
                        fontSize: 10,
                        height: 20,
                        bgcolor: row.actionType === 'Added' ? 'success.light' : row.actionType === 'Deleted' ? 'error.light' : 'info.light',
                        color: row.actionType === 'Added' ? 'success.dark' : row.actionType === 'Deleted' ? 'error.dark' : 'info.dark',
                        border: '1px solid',
                        borderColor: row.actionType === 'Added' ? 'success.main' : row.actionType === 'Deleted' ? 'error.main' : 'info.main'
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };

  if (action === 'UPDATE') {
    const generalRows = [];
    let restrictionRows = [];
    let approverRows = [];
    let parentRoleRows = [];
    let assignmentRows = [];

    for (const [key, diff] of Object.entries(details)) {
      const oldVal = diff && typeof diff === 'object' && 'old' in diff ? diff.old : undefined;
      const newVal = diff && typeof diff === 'object' && 'new' in diff ? diff.new : diff;

      if (key === 'ownRestrictions' || key === 'restrictions') {
        restrictionRows.push(...processRestrictionsDiff(oldVal, newVal));
      } else if (key === 'approvers') {
        approverRows.push(...processApproversDiff(oldVal, newVal));
      } else if (key === 'parentRoles') {
        parentRoleRows.push(...processParentRolesDiff(oldVal, newVal));
      } else if (key === 'assignments') {
        assignmentRows.push(...processAssignmentsDiff(oldVal, newVal));
      } else if (key.startsWith('Restriction')) {
        let actionType = 'Changed';
        if (key.includes('Added')) actionType = 'Added';
        else if (key.includes('Deleted') || key.includes('Removed')) actionType = 'Deleted';

        restrictionRows.push({
          label: key,
          actionLabel: actionType,
          actionType,
          oldVal,
          newVal
        });
      } else if (key.startsWith('Approver')) {
        let actionType = 'Changed';
        if (key.includes('Added')) actionType = 'Added';
        else if (key.includes('Removed') || key.includes('Deleted')) actionType = 'Deleted';
        const userDisp = newVal !== '—' && newVal !== undefined ? newVal : (oldVal !== '—' ? oldVal : key);

        approverRows.push({
          user: typeof userDisp === 'object' ? JSON.stringify(userDisp) : String(userDisp),
          actionLabel: actionType,
          actionType
        });
      } else if (key.startsWith('Parent Role')) {
        let actionType = 'Changed';
        if (key.includes('Added')) actionType = 'Added';
        else if (key.includes('Removed') || key.includes('Deleted')) actionType = 'Deleted';
        const roleDisp = newVal !== '—' && newVal !== undefined ? newVal : (oldVal !== '—' ? oldVal : key);

        parentRoleRows.push({
          user: typeof roleDisp === 'object' ? JSON.stringify(roleDisp) : String(roleDisp),
          actionLabel: actionType,
          actionType
        });
      } else if (key.startsWith('Assignment')) {
        let actionType = 'Changed';
        if (key.includes('Added')) actionType = 'Added';
        else if (key.includes('Removed') || key.includes('Deleted')) actionType = 'Deleted';
        const userDisp = newVal !== '—' && newVal !== undefined ? newVal : (oldVal !== '—' ? oldVal : key);

        assignmentRows.push({
          user: typeof userDisp === 'object' ? JSON.stringify(userDisp) : String(userDisp),
          actionLabel: actionType,
          actionType
        });
      } else {
        generalRows.push({
          label: key,
          actionLabel: 'Updated',
          actionType: 'Changed',
          oldVal,
          newVal
        });
      }
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <AuditHeader 
          log={log} 
          title={`Role: ${log.targetName || details.name || 'Role Event'}`}
          subtitle={`Target Record ID: ${log.recordId}`}
        />
        {renderSectionTable('General Role Properties', generalRows, true)}
        {renderSectionTable('Restrictions', restrictionRows, true)}
        {renderTwoColumnSectionTable('Approvers', approverRows, 'User', 'Action')}
        {renderTwoColumnSectionTable('Parent Roles', parentRoleRows, 'Parent Role', 'Action')}
        {renderTwoColumnSectionTable('Assignments', assignmentRows, 'User', 'Action')}
      </Box>
    );
  }

  // CREATE or DELETE snapshots
  const generalFields = [
    { label: 'Role Name', val: details.name },
    { label: 'Type', val: details.type },
    { label: 'Description', val: details.description },
    { label: 'Environment', val: details.environment_ID },
    { label: 'Access Domain', val: details.accessDomain_ID },
    { label: 'Critical', val: details.critical ? 'Yes' : 'No' }
  ].filter(f => f.val !== undefined);

  const restrictions = Array.isArray(details.ownRestrictions) ? details.ownRestrictions : [];
  const approvers = Array.isArray(details.approvers) ? details.approvers : [];
  const parentRoles = Array.isArray(details.parentRoles) ? details.parentRoles : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <AuditHeader 
        log={log} 
        title={`Role: ${log.targetName || details.name || 'Role Event'}`}
        subtitle={`Target Record ID: ${log.recordId}`}
      />
      {/* General Properties Table */}
      <Box>
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
        >
          Role Attributes ({action})
        </Typography>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'action.hover' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Field</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {generalFields.map((f, idx) => (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 600, width: '30%' }}>{f.label}</TableCell>
                  <TableCell sx={{ color: 'text.primary' }}>{formatValue(f.val)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* Restrictions Snapshot */}
      {restrictions.length > 0 && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Own Restrictions ({restrictions.length})
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Field Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Filter Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {restrictions.map((r, idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.field}</TableCell>
                    <TableCell><Chip label={r.filterType || 'SINGLE_VALUE'} size="small" variant="outlined" /></TableCell>
                    <TableCell sx={{ color: 'text.primary' }}>{formatValue(r.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Approvers Snapshot */}
      {approvers.length > 0 && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Approvers ({approvers.length})
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>User Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>User ID</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {approvers.map((a, idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{a.userName || a.userId}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{a.userId}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Parent Roles Snapshot */}
      {parentRoles.length > 0 && (
        <Box>
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
          >
            Parent Roles ({parentRoles.length})
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Parent Role ID</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {parentRoles.map((p, idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={{ color: 'text.primary' }}>{p.parent_ID || p.parent?.ID}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}
