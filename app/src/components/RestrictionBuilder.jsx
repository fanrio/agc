import { useState, useEffect } from 'react';
import { Box, Button, TextField, Select, MenuItem, FormControl, InputLabel, Card, Typography, IconButton, Chip, FormControlLabel, Checkbox, OutlinedInput, ListItemText, ListSubheader, Alert, Snackbar } from '@mui/material';
import * as api from '../api';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import { Filter, Lock, Unlock, X, Plus, Globe, Building2, MapPin, Factory, Briefcase } from 'lucide-react';

// Helper to structure flat list into hierarchical select options with indentation
function getHierarchyOptions(flatNodes) {
  const map = {};
  flatNodes.forEach(node => {
    map[node.ID] = { ...node, children: [] };
  });

  const roots = [];
  flatNodes.forEach(node => {
    const mappedNode = map[node.ID];
    if (node.parent_ID && map[node.parent_ID]) {
      map[node.parent_ID].children.push(mappedNode);
    } else {
      roots.push(mappedNode);
    }
  });

  const result = [];
  function traverse(node, depth = 0) {
    result.push({ ...node, depth });
    if (node.children) {
      node.children.forEach(c => traverse(c, depth + 1));
    }
  }
  roots.forEach(r => traverse(r, 0));
  return result;
}

const FILTER_TYPES = ['SINGLE_VALUE', 'MULTI_VALUE', 'RANGE', 'HIERARCHY', 'PATTERN'];

const TYPE_COLOR = {
  SINGLE_VALUE: 'primary',
  MULTI_VALUE:  'secondary',
  RANGE:        'warning',
  HIERARCHY:    'success',
  PATTERN:      'info',
};
const TYPE_LABEL = {
  SINGLE_VALUE: 'Equals',
  MULTI_VALUE:  'In List',
  RANGE:        'Range',
  HIERARCHY:    'Hierarchy',
  PATTERN:      'Pattern',
};

function TagInput({ values, onChange }) {
  const [input, setInput] = useState('');
  function addTag() {
    const v = input.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setInput('');
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {values.map(v => (
          <Chip
            key={v}
            label={v}
            size="small"
            onDelete={() => onChange(values.filter(x => x !== v))}
            color="primary"
            variant="outlined"
          />
        ))}
      </Box>
      <TextField
        size="small"
        placeholder="Type and press Enter…"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && addTag()}
        fullWidth
      />
    </Box>
  );
}

function RestrictionInput({ field, filterType, value, onChange, orgNodes = [], restrictionFields = [] }) {
  const matchingNodes = orgNodes.filter(n => (n.type?.name || '').toUpperCase() === (field || '').toUpperCase());
  const hasOrgOptions = matchingNodes.length > 0;

  // BDC Options Loader
  const fieldConfig = restrictionFields.find(f => f.name === field);
  const [bdcValues, setBdcValues] = useState([]);
  const [loadingBdc, setLoadingBdc] = useState(false);

  useEffect(() => {
    if (!fieldConfig || !fieldConfig.bdcConnection || !fieldConfig.asset) {
      setBdcValues([]);
      return;
    }
    setLoadingBdc(true);
    const conn = fieldConfig.bdcConnection;
    api.fetchBdcRelationalValues(
      conn.url, 
      conn.tokenUrl, 
      conn.clientId, 
      conn.clientSecret, 
      conn.space, 
      fieldConfig.asset, 
      fieldConfig.idColumns || '["id"]', 
      fieldConfig.textColumn || 'id'
    )
      .then(values => {
        setBdcValues(values || []);
      })
      .catch(e => {
        console.error('Failed to fetch BDC relational values:', e);
        setBdcValues([]);
      })
      .finally(() => {
        setLoadingBdc(false);
      });
  }, [fieldConfig, field]);

  const hasBdcOptions = bdcValues.length > 0;

  if (filterType === 'SINGLE_VALUE' || filterType === 'PATTERN') {
    if (loadingBdc) {
      return <TextField size="small" fullWidth disabled value="Loading values from Datasphere..." />;
    }
    if (hasBdcOptions) {
      return (
        <FormControl size="small" fullWidth>
          <InputLabel id="restriction-bdc-label">Select {field}</InputLabel>
          <Select
            labelId="restriction-bdc-label"
            label={`Select ${field}`}
            value={value}
            onChange={e => onChange(e.target.value)}
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {bdcValues.map(v => (
              <MenuItem key={v.id} value={v.id}>{v.text}</MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    if (hasOrgOptions) {
      return (
        <FormControl size="small" fullWidth>
          <InputLabel id="restriction-org-label">Select {field}</InputLabel>
          <Select
            labelId="restriction-org-label"
            label={`Select ${field}`}
            value={value}
            onChange={e => onChange(e.target.value)}
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {matchingNodes.map(n => (
              <MenuItem key={n.ID} value={n.name}>{n.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    return (
      <TextField
        size="small"
        fullWidth
        placeholder={filterType === 'PATTERN' ? 'e.g. CC1% or DE_' : 'e.g. Germany'}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  }
  if (filterType === 'MULTI_VALUE') {
    if (loadingBdc) {
      return <TextField size="small" fullWidth disabled value="Loading values from Datasphere..." />;
    }
    if (hasBdcOptions) {
      const selectedIds = value ? JSON.parse(value) : [];
      return (
        <FormControl size="small" fullWidth>
          <InputLabel id="restriction-multivalue-bdc-label">Select {field} (Multiple)</InputLabel>
          <Select
            labelId="restriction-multivalue-bdc-label"
            multiple
            value={selectedIds}
            onChange={e => onChange(JSON.stringify(e.target.value))}
            input={<OutlinedInput label={`Select ${field} (Multiple)`} />}
            renderValue={selected => selected.map(id => bdcValues.find(x => x.id === id)?.text || id).join(', ')}
          >
            {bdcValues.map(v => {
              const selected = selectedIds.includes(v.id);
              const SelectionIcon = selected ? CheckBoxIcon : CheckBoxOutlineBlankIcon;
              return (
                <MenuItem key={v.id} value={v.id}>
                  <SelectionIcon
                    fontSize="small"
                    style={{ marginRight: 8, padding: 9, boxSizing: 'content-box' }}
                  />
                  <ListItemText primary={v.text} />
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
      );
    }
    if (hasOrgOptions) {
      const selectedNames = value ? JSON.parse(value) : [];
      return (
        <FormControl size="small" fullWidth>
          <InputLabel id="restriction-multivalue-label">Select {field} (Multiple)</InputLabel>
          <Select
            labelId="restriction-multivalue-label"
            id="restriction-multivalue-select"
            multiple
            value={selectedNames}
            onChange={e => onChange(JSON.stringify(e.target.value))}
            input={<OutlinedInput label={`Select ${field} (Multiple)`} />}
            renderValue={selected => selected.join(', ')}
          >
            {matchingNodes.map(n => {
              const selected = selectedNames.includes(n.name);
              const SelectionIcon = selected ? CheckBoxIcon : CheckBoxOutlineBlankIcon;

              return (
                <MenuItem key={n.ID} value={n.name}>
                  <SelectionIcon
                    fontSize="small"
                    style={{ marginRight: 8, padding: 9, boxSizing: 'content-box' }}
                  />
                  <ListItemText primary={n.name} />
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
      );
    }
    const tags = value ? JSON.parse(value) : [];
    return <TagInput values={tags} onChange={arr => onChange(JSON.stringify(arr))} />;
  }
  if (filterType === 'RANGE') {
    const range = value ? JSON.parse(value) : { from: '', to: '' };
    if (loadingBdc) {
      return <TextField size="small" fullWidth disabled value="Loading values from Datasphere..." />;
    }
    if (hasBdcOptions) {
      return (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', width: '100%' }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel id="restriction-range-from-label">From</InputLabel>
            <Select
              labelId="restriction-range-from-label"
              label="From"
              value={range.from}
              onChange={e => onChange(JSON.stringify({ ...range, from: e.target.value }))}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {bdcValues.map(v => (
                <MenuItem key={v.id} value={v.id}>{v.text}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary">-</Typography>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel id="restriction-range-to-label">To</InputLabel>
            <Select
              labelId="restriction-range-to-label"
              label="To"
              value={range.to}
              onChange={e => onChange(JSON.stringify({ ...range, to: e.target.value }))}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {bdcValues.map(v => (
                <MenuItem key={v.id} value={v.id}>{v.text}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      );
    }
    if (hasOrgOptions) {
      return (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', width: '100%' }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel id="restriction-range-from-label">From</InputLabel>
            <Select
              labelId="restriction-range-from-label"
              label="From"
              value={range.from}
              onChange={e => onChange(JSON.stringify({ ...range, from: e.target.value }))}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {matchingNodes.map(n => (
                <MenuItem key={n.ID} value={n.name}>{n.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary">-</Typography>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel id="restriction-range-to-label">To</InputLabel>
            <Select
              labelId="restriction-range-to-label"
              label="To"
              value={range.to}
              onChange={e => onChange(JSON.stringify({ ...range, to: e.target.value }))}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {matchingNodes.map(n => (
                <MenuItem key={n.ID} value={n.name}>{n.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      );
    }
    return (
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
        <TextField
          size="small"
          type="number"
          placeholder="From"
          value={range.from}
          onChange={e => onChange(JSON.stringify({ ...range, from: e.target.value }))}
        />
        <Typography variant="body2" color="text.secondary">-</Typography>
        <TextField
          size="small"
          type="number"
          placeholder="To"
          value={range.to}
          onChange={e => onChange(JSON.stringify({ ...range, to: e.target.value }))}
        />
      </Box>
    );
  }
  if (filterType === 'HIERARCHY') {
    const sortedNodes = getHierarchyOptions(orgNodes);
    const selectedIds = value ? (value.startsWith('[') ? JSON.parse(value) : [value]) : [];

    const isAncestorSelected = (nodeId, currentSelection) => {
      let curr = orgNodes.find(x => x.ID === nodeId);
      while (curr && curr.parent_ID) {
        if (currentSelection.includes(curr.parent_ID)) {
          return true;
        }
        curr = orgNodes.find(x => x.ID === curr.parent_ID);
      }
      return false;
    };

    return (
      <FormControl size="small" fullWidth>
        <InputLabel id="restriction-hierarchy-label">Select Hierarchy Nodes</InputLabel>
        <Select
          labelId="restriction-hierarchy-label"
          id="restriction-hierarchy-select"
          multiple
          value={selectedIds}
          onChange={e => {
            const nextSelected = e.target.value;
            // Clean up: remove children/descendants if their parent/ancestor is in the selection
            const filtered = nextSelected.filter(id => !isAncestorSelected(id, nextSelected));
            onChange(JSON.stringify(filtered));
          }}
          input={<OutlinedInput label="Select Hierarchy Nodes" />}
          renderValue={(selected) => {
            const names = selected.map(id => orgNodes.find(n => n.ID === id)?.name).filter(Boolean);
            return names.join(', ');
          }}
        >
          {sortedNodes.map(n => {
            const isChecked = selectedIds.includes(n.ID);
            const SelectionIcon = isChecked ? CheckBoxIcon : CheckBoxOutlineBlankIcon;
            const isDisabled = isAncestorSelected(n.ID, selectedIds);

            // Choose icon based on node type
            let TypeIcon = Building2;
            if (n.type === 'GLOBAL') TypeIcon = Globe;
            else if (n.type === 'REGION') TypeIcon = Building2;
            else if (n.type === 'COUNTRY') TypeIcon = MapPin;
            else if (n.type === 'PLANT') TypeIcon = Factory;
            else if (n.type === 'DEPARTMENT') TypeIcon = Briefcase;

            return (
              <MenuItem
                key={n.ID}
                value={n.ID}
                disabled={isDisabled}
                sx={{
                  pl: 2 + n.depth * 3, // Indent based on depth hierarchy
                  py: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <SelectionIcon
                  fontSize="small"
                  style={{ marginRight: 8, boxSizing: 'content-box' }}
                />
                <TypeIcon size={16} color={isDisabled ? "text.disabled" : "#3b82f6"} />
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: isDisabled ? 'text.disabled' : 'text.primary' }}>
                    {n.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, textTransform: 'uppercase', lineHeight: 1.2 }}>
                    {n.type?.name || ''}
                  </Typography>
                </Box>
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>
    );
  }
  return null;
}

export function RestrictionDisplay({ restriction, isOwn = true }) {
  const color = TYPE_COLOR[restriction.filterType] || 'primary';
  const label = TYPE_LABEL[restriction.filterType] || restriction.filterType;

  let display = restriction.value;
  if (restriction.filterType === 'MULTI_VALUE') {
    try { display = JSON.parse(restriction.value).join(', '); } catch {}
  } else if (restriction.filterType === 'RANGE') {
    try { const r = JSON.parse(restriction.value); display = `${r.from} – ${r.to}`; } catch {}
  } else if (restriction.filterType === 'HIERARCHY') {
    try {
      if (restriction.value.startsWith('[')) {
        display = JSON.parse(restriction.value).join(', ');
      }
    } catch {}
  }

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 1.5,
      p: '8px 16px',
      bgcolor: isOwn ? 'rgba(59, 130, 246, 0.04)' : 'rgba(255, 255, 255, 0.02)',
      border: '1px solid',
      borderColor: isOwn ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.06)',
      borderRadius: 1.5,
      width: '100%',
    }}>
      {isOwn ? <Unlock size={14} color="#3b82f6" /> : <Lock size={14} color="#94a3b8" />}
      <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 90, color: isOwn ? 'primary.light' : 'text.secondary', fontFamily: 'monospace' }}>
        {restriction.field}
      </Typography>
      <Chip label={label} size="small" color={color} sx={{ fontSize: 9, height: 18 }} />
      <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace', flexGrow: 1 }}>
        {display}
      </Typography>
      {restriction.sourceRoleName && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontStyle: 'italic' }}>
          from: {restriction.sourceRoleName}
        </Typography>
      )}
    </Box>
  );
}

export default function RestrictionBuilder({ restrictions, onChange, inheritedRestrictions = [], orgNodes = [], restrictionFields = [] }) {
  const [draft, setDraft] = useState({ field: '', filterType: 'SINGLE_VALUE', value: '' });
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  function addRestriction() {
    if (!draft.field.trim() || !draft.value) return;

    if (draft.filterType === 'RANGE') {
      try {
        const range = JSON.parse(draft.value);
        if (!range.from || !range.to) {
          setSnackbar({ open: true, message: "Both 'From' and 'To' values must be specified.", severity: 'error' });
          return;
        }

        const fromNum = parseFloat(range.from);
        const toNum = parseFloat(range.to);

        if (!isNaN(fromNum) && !isNaN(toNum)) {
          if (fromNum >= toNum) {
            setSnackbar({ open: true, message: "'From' value must be lower than 'To' value.", severity: 'error' });
            return;
          }
        } else {
          if (String(range.from).localeCompare(String(range.to)) >= 0) {
            setSnackbar({ open: true, message: "'From' value must be lower than 'To' value.", severity: 'error' });
            return;
          }
        }
      } catch (e) {
        setSnackbar({ open: true, message: "Invalid range values.", severity: 'error' });
        return;
      }
    }

    onChange([...restrictions, { ...draft, ID: `temp-${Date.now()}` }]);
    setDraft({ field: '', filterType: 'SINGLE_VALUE', value: '' });
  }

  function removeRestriction(id) {
    onChange(restrictions.filter(r => r.ID !== id));
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Inherited */}
      {inheritedRestrictions.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
            <Lock size={12} /> Inherited from parent chain
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {inheritedRestrictions.map(r => (
              <RestrictionDisplay key={r.restrictionId || r.ID} restriction={{ ...r, field: r.field, filterType: r.filterType, value: r.value, sourceRoleName: r.sourceRoleName }} isOwn={false} />
            ))}
          </Box>
        </Box>
      )}

      {/* Own restrictions */}
      {restrictions.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
            <Unlock size={12} /> Own restrictions
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {restrictions.map(r => (
              <Box key={r.ID} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                <RestrictionDisplay restriction={r} isOwn={true} />
                <IconButton color="error" onClick={() => removeRestriction(r.ID)} size="small">
                  <X size={15} />
                </IconButton>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Add new restriction */}
      <Card sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Plus size={12} /> Add restriction
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 2fr auto' }, gap: 2, alignItems: 'end' }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="builder-field-label">Field</InputLabel>
            <Select
              labelId="builder-field-label"
              label="Field"
              value={draft.field}
              onChange={e => setDraft(d => ({ ...d, field: e.target.value }))}
            >
              <MenuItem value=""><em>Select Field</em></MenuItem>
              {restrictionFields.map(f => (
                <MenuItem key={f.ID} value={f.name}>{f.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="builder-type-label">Type</InputLabel>
            <Select
              labelId="builder-type-label"
              label="Type"
              value={draft.filterType}
              onChange={e => setDraft(d => ({ ...d, filterType: e.target.value, value: '' }))}
            >
              {FILTER_TYPES.map(t => (
                <MenuItem key={t} value={t}>{TYPE_LABEL[t]}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ width: '100%' }}>
            <RestrictionInput
              field={draft.field}
              filterType={draft.filterType}
              value={draft.value}
              onChange={v => setDraft(d => ({ ...d, value: v }))}
              orgNodes={orgNodes}
              restrictionFields={restrictionFields}
            />
          </Box>

          <Button variant="contained" onClick={addRestriction} startIcon={<Plus size={14} />} sx={{ minHeight: 40 }}>
            Add
          </Button>
        </Box>
      </Card>
    </Box>
  );
}
