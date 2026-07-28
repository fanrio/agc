import { useState, useEffect } from 'react';
import { Box, Button, TextField, Select, MenuItem, FormControl, InputLabel, Card, Typography, IconButton, Chip, FormControlLabel, Checkbox, OutlinedInput, ListItemText, ListSubheader, Alert, Snackbar, Tooltip } from '@mui/material';
import * as api from '../api';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import { Filter, Lock, Unlock, X, Plus, Globe, Building2, MapPin, Factory, Briefcase } from 'lucide-react';

// Helper to structure flat list into hierarchical select options with indentation
function getHierarchyOptions(flatNodes) {
  const map = {};
  flatNodes.forEach(node => {
    const id = node.localId || node.id || node.ID;
    map[id] = { ...node, children: [] };
  });

  const roots = [];
  flatNodes.forEach(node => {
    const id = node.localId || node.id || node.ID;
    const parentId = node.localParentId || node.parent_ID || node.parent_id;
    const mappedNode = map[id];
    if (parentId && map[parentId]) {
      map[parentId].children.push(mappedNode);
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

// Helper to check if any ancestor of nodeId is present in currentSelection list
export function isAncestorSelected(nodeId, currentSelection, flatNodes) {
  if (!flatNodes || !Array.isArray(flatNodes) || flatNodes.length === 0) return false;

  const nodeMap = new Map();
  flatNodes.forEach(node => {
    const localId = node.localId || node.id || node.ID;
    nodeMap.set(String(localId), node);
  });

  const selectionLocalIds = currentSelection.map(id => {
    const matchingNode = flatNodes.find(n => {
      const nid = n.id || n.ID;
      return nid === id || n.localId === id;
    });
    return matchingNode ? (matchingNode.localId || id) : id;
  }).map(String);

  const node = flatNodes.find(n => {
    const nid = n.id || n.ID;
    return nid === nodeId || n.localId === nodeId;
  });
  if (!node) return false;

  let curr = node;
  while (curr) {
    const parentId = curr.localParentId || curr.parent_ID || curr.parent_id;
    if (!parentId) break;
    if (selectionLocalIds.includes(String(parentId))) {
      return true;
    }
    curr = nodeMap.get(String(parentId));
  }
  return false;
}

// Helper to filter selection list and exclude children of selected parents
export function filterSelectedNodes(selectedList, flatNodes) {
  if (!selectedList || !Array.isArray(selectedList)) return [];
  return selectedList.filter(id => !isAncestorSelected(id, selectedList, flatNodes));
}

const FILTER_TYPES = ['ALL', 'N', 'NN', 'EQ', 'NE', 'GT', 'GE', 'LT', 'LE', 'CP', 'BT', 'MULTI_VALUE', 'HIERARCHY'];

const TYPE_COLOR = {
  ALL: 'success',
  N: 'secondary',
  NN: 'secondary',
  EQ: 'primary',
  NE: 'error',
  GT: 'warning',
  GE: 'warning',
  LT: 'warning',
  LE: 'warning',
  CP: 'info',
  BT: 'info',
  MULTI_VALUE: 'secondary',
  HIERARCHY: 'success',
  SINGLE_VALUE: 'primary',
  RANGE: 'warning',
};
const TYPE_LABEL = {
  ALL: 'All (*)',
  N: 'Is Null (N)',
  NN: 'Not Null (NN)',
  EQ: 'Equals (EQ)',
  NE: 'Not Equals (NE)',
  GT: 'Greater Than (GT)',
  GE: 'Greater Equal (GE)',
  LT: 'Less Than (LT)',
  LE: 'Less Equal (LE)',
  CP: 'Pattern (CP)',
  BT: 'Between (BT)',
  MULTI_VALUE: 'In List',
  HIERARCHY: 'Hierarchy',
  SINGLE_VALUE: 'Equals',
  RANGE: 'Range',
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
  const [selectedHierarchyDirectory, setSelectedHierarchyDirectory] = useState('');

  useEffect(() => {
    setSelectedHierarchyDirectory('');
  }, [fieldConfig, filterType]);

  useEffect(() => {
    if (['ALL', 'N', 'NN'].includes(filterType) && value !== '') {
      onChange('');
    }
  }, [filterType, value, onChange]);

  useEffect(() => {
    if (!fieldConfig || !fieldConfig.bdcConnection) {
      setBdcValues([]);
      return;
    }
    if (['CP', 'RANGE', 'BT', 'ALL', 'N', 'NN'].includes(filterType)) {
      setBdcValues([]);
      return;
    }
    if (filterType === 'HIERARCHY' && !fieldConfig.assetHierarchy) {
      setBdcValues([]);
      return;
    }

    setLoadingBdc(true);
    const conn = fieldConfig.bdcConnection;
    const targetAsset = filterType === 'HIERARCHY' ? fieldConfig.assetHierarchy : fieldConfig.asset;

    api.fetchBdcRelationalValues(
      conn.ID,
      conn.space,
      targetAsset,
      filterType === 'HIERARCHY' ? null : (fieldConfig.assetText || null),
      fieldConfig.idColumns || '["id"]',
      fieldConfig.textColumn || 'id'
    )
      .then(values => {
        const mapped = (values || []).map(v => ({
          ...v,
          localId: v.hierarchy ? `${v.hierarchy}-${v.id}` : v.id,
          localParentId: (v.hierarchy && v.parent_ID) ? `${v.hierarchy}-${v.parent_ID}` : v.parent_ID
        }));
        setBdcValues(mapped);
      })
      .catch(e => {
        console.error('Failed to fetch BDC relational values:', e);
        setBdcValues([]);
      })
      .finally(() => {
        setLoadingBdc(false);
      });
  }, [fieldConfig, field, filterType]);

  const hasBdcOptions = bdcValues.length > 0;

  if (['ALL', 'N', 'NN'].includes(filterType)) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1, fontStyle: 'italic' }}>
        No value is required for this operator.
      </Typography>
    );
  }

  if (filterType === 'CP') {
    return (
      <TextField
        size="small"
        fullWidth
        placeholder="e.g. CC1% or DE_"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  }
  if (filterType === 'SINGLE_VALUE' || ['EQ', 'NE', 'GT', 'GE', 'LT', 'LE'].includes(filterType)) {
    if (loadingBdc) {
      return <TextField size="small" fullWidth disabled value="Loading values from Datasphere..." />;
    }
    if (hasBdcOptions) {
      // Parse current stored value: may be {id,text} object or plain string
      const parsedSingleVal = (() => { try { const p = JSON.parse(value); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; } })();
      const selectedId = parsedSingleVal ? parsedSingleVal.id : value;
      return (
        <FormControl size="small" fullWidth>
          <InputLabel id="restriction-bdc-label">Select {field}</InputLabel>
          <Select
            labelId="restriction-bdc-label"
            label={`Select ${field}`}
            value={selectedId}
            onChange={e => {
              const chosen = bdcValues.find(v => v.id === e.target.value);
              onChange(chosen ? JSON.stringify({ id: chosen.id, text: chosen.text || chosen.id }) : '');
            }}
            renderValue={sel => bdcValues.find(v => v.id === sel)?.text || sel}
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
        placeholder="e.g. Germany"
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
      // Parse stored value: may be [{id,text}] or [id] (legacy)
      const rawMulti = value ? (() => { try { return JSON.parse(value); } catch { return []; } })() : [];
      const selectedIds = rawMulti.map(item => (item && typeof item === 'object' ? item.id : item));
      return (
        <FormControl size="small" fullWidth>
          <InputLabel id="restriction-multivalue-bdc-label">Select {field} (Multiple)</InputLabel>
          <Select
            labelId="restriction-multivalue-bdc-label"
            multiple
            value={selectedIds}
            onChange={e => {
              const chosen = e.target.value.map(id => {
                const v = bdcValues.find(x => x.id === id);
                return v ? { id: v.id, text: v.text || v.id } : { id, text: id };
              });
              onChange(JSON.stringify(chosen));
            }}
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
  if (filterType === 'RANGE' || filterType === 'BT') {
    const range = value ? JSON.parse(value) : { from: '', to: '' };
    if (loadingBdc) {
      return <TextField size="small" fullWidth disabled value="Loading values from Datasphere..." />;
    }
    if (hasBdcOptions) {
      // Parse stored range: may be {from:{id,text}, to:{id,text}} or {from:id, to:id} (legacy)
      const fromObj = range.from && typeof range.from === 'object' ? range.from : null;
      const toObj = range.to && typeof range.to === 'object' ? range.to : null;
      const fromId = fromObj ? fromObj.id : (range.from || '');
      const toId = toObj ? toObj.id : (range.to || '');
      return (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', width: '100%' }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel id="restriction-range-from-label">From</InputLabel>
            <Select
              labelId="restriction-range-from-label"
              label="From"
              value={fromId}
              onChange={e => {
                const chosen = bdcValues.find(v => v.id === e.target.value);
                onChange(JSON.stringify({ ...range, from: chosen ? { id: chosen.id, text: chosen.text || chosen.id } : e.target.value }));
              }}
              renderValue={sel => bdcValues.find(v => v.id === sel)?.text || sel}
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
              value={toId}
              onChange={e => {
                const chosen = bdcValues.find(v => v.id === e.target.value);
                onChange(JSON.stringify({ ...range, to: chosen ? { id: chosen.id, text: chosen.text || chosen.id } : e.target.value }));
              }}
              renderValue={sel => bdcValues.find(v => v.id === sel)?.text || sel}
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
    // If BDC link and hierarchy asset is configured, use BDC hierarchy loader
    if (fieldConfig && fieldConfig.bdcConnection && fieldConfig.assetHierarchy) {
      if (loadingBdc) {
        return <TextField size="small" fullWidth disabled value="Loading hierarchy from Datasphere..." />;
      }
      const uniqueHierarchies = Array.from(new Set(bdcValues.map(v => v.hierarchy).filter(Boolean)));

      // Filter options based on selected directory (if withHierarchyDirectory is true)
      const isWithDirectory = !!fieldConfig.withHierarchyDirectory;

      // Extract directory from value if present
      let initialDir = '';
      const rawSelected = value ? (value.startsWith('[') ? JSON.parse(value) : [value]) : [];
      if (isWithDirectory && rawSelected.length > 0) {
        const first = rawSelected.find(x => {
          const idStr = typeof x === 'object' ? x.id : x;
          return typeof idStr === 'string' && idStr.includes('/');
        });
        if (first) {
          const idStr = typeof first === 'object' ? first.id : first;
          initialDir = idStr.split('/')[0];
        }
      }

      // Initialize local state if not set
      const activeDir = selectedHierarchyDirectory || initialDir;

      const filteredOptions = isWithDirectory && activeDir
        ? bdcValues.filter(v => v.hierarchy === activeDir)
        : bdcValues;

      // Clean prefix for UI rendering but keeping it unique using localId
      const selectedLocalIds = rawSelected.map(val => {
        const valId = typeof val === 'object' ? val.id : val;
        const matchingNode = bdcValues.find(n => {
          const dbVal = n.hierarchy ? `${n.hierarchy}/${n.id}` : n.id;
          return dbVal === valId || n.id === valId || n.value === valId;
        });
        return matchingNode ? (matchingNode.localId || valId) : valId;
      });

      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
          {isWithDirectory && (
            <FormControl size="small" fullWidth>
              <InputLabel id="hierarchy-directory-label">Hierarchy Directory</InputLabel>
              <Select
                labelId="hierarchy-directory-label"
                value={selectedHierarchyDirectory || initialDir}
                onChange={e => {
                  setSelectedHierarchyDirectory(e.target.value);
                  onChange(JSON.stringify([]));
                }}
                label="Hierarchy Directory"
              >
                <MenuItem value=""><em>All Directories</em></MenuItem>
                {uniqueHierarchies.map(h => (
                  <MenuItem key={h} value={h}>{h}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl size="small" fullWidth>
            <InputLabel id="restriction-hierarchy-bdc-label">Select Hierarchy Nodes</InputLabel>
            <Select
              labelId="restriction-hierarchy-bdc-label"
              multiple
              value={selectedLocalIds}
              onChange={e => {
                const nextSelected = e.target.value;
                const filtered = filterSelectedNodes(nextSelected, filteredOptions);
                const finalValues = filtered.map(localId => {
                  const matchingNode = filteredOptions.find(n => n.localId === localId);
                  if (matchingNode) {
                    const idStr = isWithDirectory && activeDir
                      ? `${activeDir}/${matchingNode.id}`
                      : matchingNode.id;
                    const savedId = matchingNode.value || idStr;
                    return {
                      id: savedId,
                      nodeType: matchingNode.nodeType || '',
                      text: matchingNode.text || matchingNode.id || idStr,
                      hierarchy: matchingNode.hierarchy || ''
                    };
                  }
                  return { id: localId, nodeType: '', text: localId };
                });
                onChange(JSON.stringify(finalValues));
              }}
              input={<OutlinedInput label="Select Hierarchy Nodes" />}

              renderValue={(selected) => {
                return selected.map(localId => bdcValues.find(x => x.localId === localId)?.text || localId).join(', ');
              }}
            >
              {getHierarchyOptions(filteredOptions).map(v => {
                const itemKey = v.localId || v.id;
                const isChecked = selectedLocalIds.includes(itemKey);
                const isDisabled = isAncestorSelected(itemKey, selectedLocalIds, filteredOptions);
                const SelectionIcon = isChecked ? CheckBoxIcon : CheckBoxOutlineBlankIcon;
                return (
                  <MenuItem
                    key={itemKey}
                    value={itemKey}
                    disabled={isDisabled}
                    sx={{
                      pl: 2 + (v.depth || 0) * 3, // Indent based on depth hierarchy
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
                    <ListItemText primary={v.text} />
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        </Box>
      );
    }

    // Default local orgNodes fallback if no BDC hierarchy asset defined
    const sortedNodes = getHierarchyOptions(orgNodes);
    const rawSelected = value ? (value.startsWith('[') ? JSON.parse(value) : [value]) : [];
    const selectedIds = rawSelected.map(val => typeof val === 'object' ? val.id : val);

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
            const filtered = filterSelectedNodes(nextSelected, orgNodes);
            const finalValues = filtered.map(id => {
              const matchingNode = orgNodes.find(n => n.ID === id);
              return {
                id: id,
                nodeType: matchingNode?.type || '',
                text: matchingNode?.name || id
              };
            });
            onChange(JSON.stringify(finalValues));
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
            const isDisabled = isAncestorSelected(n.ID, selectedIds, orgNodes);

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
                <TypeIcon size={16} color={isDisabled ? "text.disabled" : "primary.main"} />
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

  // Helper: extract display text from a stored value that may be a plain string or an {id,text} object
  function extractText(val) {
    if (val && typeof val === 'object') return val.text || val.id || String(val);
    return String(val ?? '');
  }

  let display = restriction.value;
  if (restriction.filterType === 'MULTI_VALUE') {
    try {
      const parsed = JSON.parse(restriction.value);
      display = parsed.map(extractText).join(', ');
    } catch { }
  } else if (restriction.filterType === 'RANGE' || restriction.filterType === 'BT') {
    try {
      const r = JSON.parse(restriction.value);
      display = `${extractText(r.from)} and ${extractText(r.to)}`;
    } catch { }
  } else if (restriction.filterType === 'HIERARCHY') {
    try {
      if (restriction.value.startsWith('[')) {
        const parsed = JSON.parse(restriction.value);
        display = parsed.map(val => {
          if (val && typeof val === 'object') {
            if (val.hierarchy && val.id) {
              return val.hierarchy === val.id ? val.id : `${val.hierarchy}/${val.id}`;
            }
            return val.text || val.id;
          }
          return val;
        }).join(', ');
      }
    } catch { }
  } else {
    // SINGLE_VALUE / EQ / NE / GT / GE / LT / LE / CP — may be stored as {id, text}
    try {
      const parsed = JSON.parse(restriction.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        display = parsed.text || parsed.id || restriction.value;
      }
    } catch { }
  }

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 1.5,
      p: '8px 16px',
      bgcolor: isOwn ? 'rgba(15, 23, 42, 0.04)' : 'action.hover',
      border: '1px solid',
      borderColor: isOwn ? 'primary.main' : 'divider',
      borderRadius: 1.5,
      width: '100%',
    }}>
      {isOwn ? <Unlock size={14} color="var(--accent-primary)" /> : <Lock size={14} color="#64748b" />}
      <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 90, color: isOwn ? 'primary.main' : 'text.secondary' }}>
        {restriction.field}
      </Typography>
      <Chip label={label} size="small" color={color} sx={{ fontSize: 9, height: 18 }} />
      <Typography variant="body2" sx={{ fontWeight: 500, flexGrow: 1 }}>
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

export default function RestrictionBuilder({ restrictions, onChange, inheritedRestrictions = [], orgNodes = [], restrictionFields = [], isReadOnly = false }) {
  const [draft, setDraft] = useState({ field: '', filterType: 'EQ', value: '' });
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'error';
  }>({ open: false, message: '', severity: 'error' });

  const handleCloseSnackbar = (event?: any, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  function addRestriction() {
    if (!draft.field.trim() || !draft.value) return;

    if (draft.filterType === 'RANGE' || draft.filterType === 'BT') {
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
    setDraft({ field: '', filterType: 'EQ', value: '' });
  }

  function removeRestriction(id) {
    onChange(restrictions.filter(r => r.ID !== id));
  }

  // Available fields in builder are all restrictionFields passed to the component
  const availableFields = restrictionFields;

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
                {!isReadOnly && (
                  <IconButton color="error" onClick={() => removeRestriction(r.ID)} size="small">
                    <X size={15} />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Add new restriction */}
      {!isReadOnly && (
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
                {availableFields.map(f => (
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
      )}
    </Box>
  );
}
