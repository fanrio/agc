import React, { useState } from 'react';
import {
  Box,
  Card,
  Paper,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip
} from '@mui/material';
import { ShieldCheck, LayoutList, Table as TableIcon, Layers } from 'lucide-react';
import { RestrictionDisplay } from './RestrictionBuilder';

export function formatRestrictionValue(restriction) {
  if (!restriction || restriction.value === null || restriction.value === undefined) {
    return '—';
  }

  const rawVal = restriction.value;
  const filterType = (restriction.filterType || '').toUpperCase();

  function extractText(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
      if (val.name) return val.name;
      if (val.text && val.id) return `${val.text} (${val.id})`;
      if (val.text) return val.text;
      if (val.hierarchy && val.id) {
        return val.hierarchy === val.id ? val.id : `${val.hierarchy}/${val.id}`;
      }
      if (val.id) return val.id;
      return JSON.stringify(val);
    }
    return String(val);
  }

  let parsedVal = rawVal;
  if (typeof rawVal === 'string') {
    const trimmed = rawVal.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsedVal = JSON.parse(trimmed);
      } catch (e) {
        parsedVal = rawVal;
      }
    }
  }

  if (filterType === 'HIERARCHY') {
    function formatHierarchyNode(val) {
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') {
        if (val.hierarchy && val.id) {
          const nodeName = val.text && val.text !== val.id ? val.text : val.id;
          return val.hierarchy === val.id ? nodeName : `${val.hierarchy}/${nodeName}`;
        }
        return val.text || val.id || val.name || JSON.stringify(val);
      }
      return String(val);
    }

    if (Array.isArray(parsedVal)) {
      return parsedVal.map(formatHierarchyNode).filter(Boolean).join(', ') || String(rawVal);
    }
    return formatHierarchyNode(parsedVal);
  }

  if (filterType === 'MULTI_VALUE') {
    if (Array.isArray(parsedVal)) {
      return parsedVal.map(extractText).filter(Boolean).join(', ') || String(rawVal);
    }
    return String(parsedVal);
  }

  if (filterType === 'RANGE' || filterType === 'BT') {
    if (parsedVal && typeof parsedVal === 'object' && !Array.isArray(parsedVal)) {
      const fromStr = extractText(parsedVal.from || parsedVal.low);
      const toStr = extractText(parsedVal.to || parsedVal.high);
      if (fromStr && toStr) {
        return `${fromStr} to ${toStr}`;
      }
    }
    return String(rawVal);
  }

  if (Array.isArray(parsedVal)) {
    return parsedVal.map(extractText).filter(Boolean).join(', ');
  }

  if (parsedVal && typeof parsedVal === 'object') {
    return extractText(parsedVal);
  }

  return String(rawVal);
}

export function isPatternRestriction(r) {
  if (!r) return false;
  const ft = (r.filterType || '').toUpperCase();
  const val = String(r.value || '').trim();
  if (ft === 'ALL' || ft === 'CP') return true;
  if (val === '*' || val.includes('*') || val.includes('?')) return true;
  return false;
}

export function computeEffectiveRestrictions(restrictions = [], inherited = []) {
  const ownFields = new Set(restrictions.map(r => (r.field || '').toLowerCase()));
  const filteredInherited = inherited.filter(r => {
    if (isPatternRestriction(r) && ownFields.has((r.field || '').toLowerCase())) {
      return false;
    }
    return true;
  });

  const inheritedList = filteredInherited.map((r, i) => ({
    ...r,
    ID: r.ID || r.id || `inh-${i}`,
    isOwn: false,
    sourceRoleName: r.sourceRoleName || r.sourceRoleId || 'Inherited'
  }));

  const ownList = restrictions.map((r, i) => ({
    ...r,
    ID: r.ID || r.id || `own-${i}`,
    isOwn: true,
    sourceRoleName: r.sourceRoleName || 'This Role'
  }));

  return [...inheritedList, ...ownList];
}

export default function EffectiveRestrictions({
  restrictions,
  inherited,
  effectiveRestrictions,
  title,
  showCard = true,
  defaultView = 'list',
  allowViewToggle = true,
  emptyMessage = 'No restrictions defined.',
  groupByRole = true
}) {
  const [viewMode, setViewMode] = useState(defaultView);

  let items = [];
  if (Array.isArray(effectiveRestrictions)) {
    items = effectiveRestrictions.map((r, i) => ({
      ...r,
      ID: r.ID || r.id || `eff-${i}`,
      isOwn: r.isOwn !== undefined ? r.isOwn : (r.sourceRoleName === 'This Role' || !r.sourceRoleName)
    }));
  } else {
    items = computeEffectiveRestrictions(restrictions || [], inherited || []);
  }

  const totalCount = items.length;
  const displayTitle = title || `Effective Restrictions (${totalCount})`;

  // Group items by role if there are multiple distinct roles
  const getRoleGroupKey = (r) => {
    if (r.sourceRoleName && r.sourceRoleName !== 'This Role' && r.sourceRoleName !== 'Inherited') {
      return r.sourceRoleName;
    }
    if (r.isOwn) return 'Current Role (Own)';
    return r.sourceRoleName || r.sourceRoleId || 'Inherited Role';
  };

  const roleGroupsMap = new Map();
  items.forEach(r => {
    const key = getRoleGroupKey(r);
    if (!roleGroupsMap.has(key)) {
      roleGroupsMap.set(key, []);
    }
    roleGroupsMap.get(key).push(r);
  });

  const distinctRoleKeys = Array.from(roleGroupsMap.keys());
  const shouldGroup = distinctRoleKeys.length > 1;

  const content = (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 1
          }}
        >
          <ShieldCheck size={18} color="#1976d2" />
          {displayTitle}
        </Typography>

        {allowViewToggle && totalCount > 0 && (
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(e, next) => next && setViewMode(next)}
            size="small"
            sx={{ height: 28 }}
          >
            <Tooltip title="Chip List View">
              <ToggleButton value="list" aria-label="chip view">
                <LayoutList size={14} />
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Table View">
              <ToggleButton value="table" aria-label="table view">
                <TableIcon size={14} />
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        )}
      </Box>

      {totalCount === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      ) : viewMode === 'list' ? (
        shouldGroup ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {distinctRoleKeys.map((roleName) => {
              const groupItems = roleGroupsMap.get(roleName);
              const isOwnGroup = groupItems.some(r => r.isOwn);
              return (
                <Paper
                  key={roleName}
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    borderColor: isOwnGroup ? 'primary.main' : 'divider',
                    bgcolor: isOwnGroup ? 'action.hover' : 'background.paper'
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Layers size={16} color={isOwnGroup ? '#1976d2' : '#666'} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Role: {roleName}
                    </Typography>
                    <Chip
                      label={isOwnGroup ? 'Own Role' : 'Inherited Role'}
                      size="small"
                      color={isOwnGroup ? 'primary' : 'default'}
                      variant={isOwnGroup ? 'filled' : 'outlined'}
                      sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {groupItems.length} restriction{groupItems.length > 1 ? 's' : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {groupItems.map((r) => (
                      <RestrictionDisplay key={r.ID} restriction={r} isOwn={r.isOwn} />
                    ))}
                  </Box>
                </Paper>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {items.map((r) => (
              <RestrictionDisplay key={r.ID} restriction={r} isOwn={r.isOwn} />
            ))}
          </Box>
        )
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
          <Table size="small">
            <TableHead sx={{ bgcolor: 'table.header' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Restriction Field</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Filter Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Effective Value</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Source Role</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Origin</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shouldGroup ? (
                distinctRoleKeys.map((roleName) => {
                  const groupItems = roleGroupsMap.get(roleName);
                  return (
                    <React.Fragment key={roleName}>
                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                        <TableCell colSpan={5} sx={{ py: 1, fontWeight: 700, color: 'primary.main' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Layers size={14} />
                            Role: {roleName} ({groupItems.length})
                          </Box>
                        </TableCell>
                      </TableRow>
                      {groupItems.map((re, idx) => (
                        <TableRow key={re.ID || idx} hover>
                          <TableCell sx={{ fontWeight: 700, pl: 3 }}>
                            {re.field}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={re.filterType || 'SINGLE_VALUE'}
                              size="small"
                              variant="outlined"
                              sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                            {formatRestrictionValue(re)}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            {re.sourceRoleName || re.sourceRoleId || '—'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={re.isOwn ? 'Own' : 'Inherited'}
                              size="small"
                              color={re.isOwn ? 'success' : 'info'}
                              sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })
              ) : (
                items.map((re, idx) => (
                  <TableRow key={re.ID || idx} hover>
                    <TableCell sx={{ fontWeight: 700 }}>
                      {re.field}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={re.filterType || 'SINGLE_VALUE'}
                        size="small"
                        variant="outlined"
                        sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {formatRestrictionValue(re)}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {re.sourceRoleName || re.sourceRoleId || '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={re.isOwn ? 'Own' : 'Inherited'}
                        size="small"
                        color={re.isOwn ? 'success' : 'info'}
                        sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );

  if (showCard) {
    return <Card sx={{ p: 3 }}>{content}</Card>;
  }

  return content;
}
