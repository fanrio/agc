import { useState, useEffect } from 'react';
import { Box, Card, Typography, Button, TextField, Select, MenuItem, FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, IconButton, Chip, CircularProgress, Collapse, Alert, Snackbar, Tooltip } from '@mui/material';
import { Plus, Trash2, ChevronRight, ChevronDown, Zap, Edit3, X, Check, MoveRight, HelpCircle, Building2, Sliders } from 'lucide-react';
import * as api from '../api';
import TemplateNameEditor from './TemplateNameEditor';

// ─── Move Dialog ──────────────────────────────────────────────────────────────
function MoveDialog({ node, allNodes, onConfirm, onClose, open }) {
  const [selectedParentId, setSelectedParentId] = useState('');

  function getDescendantIds(id, nodes) {
    const children = nodes.filter(n => n.parent_ID === id);
    return children.flatMap(c => [c.ID, ...getDescendantIds(c.ID, nodes)]);
  }
  const forbidden = new Set([node.ID, ...getDescendantIds(node.ID, allNodes)]);
  const validParents = allNodes.filter(n => !forbidden.has(n.ID));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Move Node</Typography>
          <Typography variant="body2" color="text.secondary">
            Moving: <Box component="span" color="primary.light" sx={{ fontWeight: 600 }}>{node.name}</Box>
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close"><X size={16} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <FormControl size="small" fullWidth sx={{ mt: 1 }}>
          <InputLabel id="move-parent-select-label">New Parent Node</InputLabel>
          <Select
            labelId="move-parent-select-label"
            label="New Parent Node"
            value={selectedParentId}
            onChange={e => setSelectedParentId(e.target.value)}
          >
            <MenuItem value=""><em>— Make root node (no parent) —</em></MenuItem>
            {validParents.map(n => (
              <MenuItem key={n.ID} value={n.ID}>
                {n.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={() => onConfirm(selectedParentId || null)} startIcon={<MoveRight size={14} />}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Helper to parse "ROLE_{CostCenter}_CUSTOM" into a readable flex-row with purple chips
function parseTemplateToChips(templateStr) {
  if (!templateStr) return null;
  const regex = /(\{[a-zA-Z0-9_]+\})/g;
  const parts = templateStr.split(regex);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      {parts.map((part, idx) => {
        if (part.startsWith('{') && part.endsWith('}')) {
          return (
            <Chip
              key={idx}
              label={part.slice(1, -1)}
              size="small"
              color="secondary"
              sx={{
                height: 18,
                fontSize: '9px',
                fontWeight: 600,
                bgcolor: 'rgba(147, 51, 234, 0.12)',
                border: '1px solid rgba(147, 51, 234, 0.25)',
                color: 'secondary.light',
                px: 0.5
              }}
            />
          );
        }
        return (
          <Typography key={idx} variant="caption" sx={{ fontSize: '11px', fontFamily: 'monospace', color: 'text.secondary' }}>
            {part}
          </Typography>
        );
      })}
    </Box>
  );
}

// ─── Node Row Component ───────────────────────────────────────────────────────
function NodeRow({
  node,
  depth = 0,
  allNodes,
  nodeTypes = [],
  createNode,
  updateNode,
  deleteNode,
  createAttribute,
  deleteAttribute,
  typeIcons = {},
  defaultIcon: DefaultIcon = HelpCircle,
  onGenerate,
  onRefresh,
  onError,
  canManage,
  showTypeSelector = true,
  showDescriptionField = false,
  maxNameLength = 100,
  showRestrictionFields = false,
  createRestrictionField,
  deleteRestrictionField,
  showRoleTemplateName = false,
}) {
  const [expanded, setExpanded]       = useState(depth < 2);
  const [showAddChild, setShowAddChild] = useState(false);
  const [showAddAttr, setShowAddAttr]  = useState(false);
  const [showMove, setShowMove]        = useState(false);
  const [editing, setEditing]          = useState(false);
  const [editName, setEditName]        = useState(node.name);
  const [editDesc, setEditDesc]        = useState(node.description || '');
  const [editTemplate, setEditTemplate] = useState(node.roleTemplateName || '');
  const [newChild, setNewChild]        = useState({ name: '', description: '', type: '' });
  const [newChildTemplate, setNewChildTemplate] = useState('');
  const [newAttr, setNewAttr]          = useState({ field: '', value: '' });
  const [newChildFields, setNewChildFields] = useState([]);
  const [loading, setLoading]          = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showAddField, setShowAddField] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState('');

  const Icon = (node.type && typeIcons[node.type.name]) || DefaultIcon;
  const hasChildren = node.children && node.children.length > 0;

  async function handleAddChild() {
    if (!newChild.name.trim()) return;
    if (showRoleTemplateName && !newChildTemplate.trim()) {
      onError('Role template name is required.');
      return;
    }
    setLoading(true);
    try {
      const payload = { name: newChild.name, parent_ID: node.ID };
      if (showTypeSelector) {
        payload.type_ID = newChild.type || (nodeTypes[0]?.ID || '');
      }
      if (showDescriptionField) {
        payload.description = newChild.description;
      }
      if (showRoleTemplateName) {
        payload.roleTemplateName = newChildTemplate;
      }
      const created = await createNode(payload);
      // Immediately attach selected restriction fields
      if (showRestrictionFields && newChildFields.length > 0 && createRestrictionField && created?.ID) {
        await Promise.all(newChildFields.map(fId => createRestrictionField({ domain_ID: created.ID, field_ID: fId })));
      }
      setNewChild({ name: '', description: '', type: '' });
      setNewChildTemplate('');
      setNewChildFields([]);
      setShowAddChild(false);
      await onRefresh();
      setExpanded(true);
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleDelete() {
    if (hasChildren) {
      onError(`Cannot delete "${node.name}" — it still has child nodes. Remove all children first.`);
      return;
    }
    setConfirmDeleteOpen(true);
  }

  async function executeDelete() {
    setConfirmDeleteOpen(false);
    setLoading(true);
    try {
      await deleteNode(node.ID);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleRename() {
    if (!editName.trim()) return;
    if (showRoleTemplateName && !editTemplate.trim()) {
      onError('Role template name is required.');
      return;
    }
    setLoading(true);
    try {
      const payload = { name: editName };
      if (showDescriptionField) {
        payload.description = editDesc;
      }
      if (showRoleTemplateName) {
        payload.roleTemplateName = editTemplate;
      }
      await updateNode(node.ID, payload);
      setEditing(false);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleAddAttr() {
    if (!newAttr.field.trim() || !newAttr.value.trim()) return;
    setLoading(true);
    try {
      await createAttribute({ node_ID: node.ID, field: newAttr.field, value: newAttr.value });
      setNewAttr({ field: '', value: '' });
      setShowAddAttr(false);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleDeleteAttr(attrId) {
    setLoading(true);
    try {
      await deleteAttribute(attrId);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleMove(newParentId) {
    setLoading(true);
    try {
      await updateNode(node.ID, { parent_ID: newParentId });
      setShowMove(false);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleAddRestrictionField() {
    if (!selectedFieldId) return;
    setLoading(true);
    try {
      await createRestrictionField({ domain_ID: node.ID, field_ID: selectedFieldId });
      setSelectedFieldId('');
      setShowAddField(false);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  async function handleDeleteRestrictionField(mappingId) {
    setLoading(true);
    try {
      await deleteRestrictionField(mappingId);
      await onRefresh();
    } catch (e) { onError(e.message); }
    setLoading(false);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, width: '100%' }}>
      {showMove && (
        <MoveDialog
          open={showMove}
          node={node}
          allNodes={allNodes}
          onConfirm={handleMove}
          onClose={() => setShowMove(false)}
        />
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: '10px 14px',
          bgcolor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 1,
          ml: depth * 3,
          position: 'relative',
          transition: 'all 0.2s',
          '&:hover': {
            borderColor: 'rgba(59, 130, 246, 0.2)',
            bgcolor: 'rgba(255, 255, 255, 0.03)',
          }
        }}>
          <IconButton
            onClick={() => setExpanded(e => !e)}
            disabled={!hasChildren}
            size="small"
            sx={{ p: 0, color: 'text.secondary', opacity: hasChildren ? 1 : 0.3 }}
          >
            {hasChildren ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <Box sx={{ width: 14 }} />}
          </IconButton>

          <Icon size={16} color="#3b82f6" />

          <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            {editing ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                <TextField
                  size="small"
                  value={editName}
                  onChange={e => setEditName(e.target.value.slice(0, maxNameLength))}
                  inputProps={{ maxLength: maxNameLength }}
                  sx={{ '& input': { py: 0.5, px: 1, fontSize: 13 }, width: 120 }}
                />
                {showDescriptionField && (
                  <TextField
                    size="small"
                    placeholder="Description"
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value.slice(0, 200))}
                    inputProps={{ maxLength: 200 }}
                    sx={{ '& input': { py: 0.5, px: 1, fontSize: 13 }, width: 220 }}
                  />
                )}
                {showRoleTemplateName && (
                  <Box sx={{ width: '100%', mt: 1, mb: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>Role template name:</Typography>
                    <TemplateNameEditor
                      value={editTemplate}
                      onChange={setEditTemplate}
                      availableFields={node.restrictionFields?.map(rf => rf.field?.name || rf.field_ID).filter(Boolean) || []}
                    />
                  </Box>
                )}
                <IconButton color="primary" onClick={handleRename} disabled={loading} size="small" aria-label="Save rename"><Check size={14} /></IconButton>
                <IconButton onClick={() => setEditing(false)} size="small" aria-label="Cancel edit"><X size={14} /></IconButton>
              </Box>
            ) : (
              <>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {node.name}
                  {showDescriptionField && node.description && (
                    <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary', ml: 1.5, fontSize: 12 }}>
                      — {node.description}
                    </Box>
                  )}
                </Typography>
                {showTypeSelector && <Typography variant="caption" color="text.secondary">{node.type?.name || ''}</Typography>}
                {showRoleTemplateName && node.roleTemplateName && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, opacity: 0.85 }}>
                    <Typography variant="caption" color="text.secondary">Template:</Typography>
                    {parseTemplateToChips(node.roleTemplateName)}
                  </Box>
                )}
              </>
            )}
          </Box>

          {node.attributes && node.attributes.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {node.attributes.map(a => (
                <Chip
                  key={a.ID}
                  label={`${a.field}: ${a.value}`}
                  size="small"
                  onDelete={canManage ? () => handleDeleteAttr(a.ID) : undefined}
                  color="primary"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 9 }}
                />
              ))}
            </Box>
          )}

          {showRestrictionFields && node.restrictionFields && node.restrictionFields.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {node.restrictionFields.map(rf => (
                <Chip
                  key={rf.ID}
                  label={rf.field?.name || rf.field_ID}
                  size="small"
                  onDelete={canManage ? () => handleDeleteRestrictionField(rf.ID) : undefined}
                  color="secondary"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 9 }}
                />
              ))}
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {onGenerate && (
              <Button 
                size="small" 
                variant="text" 
                color="primary" 
                onClick={() => onGenerate(node.ID)} 
                disabled={!canManage}
                startIcon={<Zap size={12} />}
              >
                Role
              </Button>
            )}
            {showRestrictionFields && (
              <Tooltip title="Define Mandatory Fields">
                <IconButton size="small" onClick={() => setShowAddField(s => !s)} disabled={!canManage} aria-label="Define Mandatory Fields">
                  <Sliders size={13} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Add Attribute">
              <IconButton size="small" onClick={() => setShowAddAttr(s => !s)} disabled={!canManage} aria-label="Add Attribute"><Plus size={13} /></IconButton>
            </Tooltip>
            <Tooltip title="Rename / Edit">
              <IconButton size="small" onClick={() => { setEditing(true); setEditName(node.name); setEditDesc(node.description || ''); setEditTemplate(node.roleTemplateName || ''); }} disabled={!canManage} aria-label="Rename / Edit"><Edit3 size={13} /></IconButton>
            </Tooltip>
            <Tooltip title="Add Child Node">
              <IconButton size="small" onClick={() => setShowAddChild(s => !s)} disabled={!canManage} aria-label="Add Child Node"><Building2 size={13} /></IconButton>
            </Tooltip>
            <Tooltip title="Move Node">
              <IconButton size="small" onClick={() => setShowMove(true)} aria-label="Move Node" disabled={loading || !canManage}>
                <MoveRight size={13} />
              </IconButton>
            </Tooltip>
            <Tooltip title={hasChildren ? 'Remove all children first' : 'Delete node'}>
              <IconButton size="small" color="error" onClick={handleDelete} disabled={loading || hasChildren || !canManage} aria-label={hasChildren ? 'Remove all children first' : 'Delete node'}><Trash2 size={13} /></IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Collapse in={showAddAttr}>
          <Card sx={{ ml: depth * 3 + 1, mt: 0.5, p: 1.5, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField size="small" label="Field (e.g. Country)" value={newAttr.field} onChange={e => setNewAttr(a => ({ ...a, field: e.target.value }))} sx={{ flex: 1 }} />
            <TextField size="small" label="Value (e.g. Germany)" value={newAttr.value} onChange={e => setNewAttr(a => ({ ...a, value: e.target.value }))} sx={{ flex: 1 }} />
            <Button variant="contained" size="small" onClick={handleAddAttr} disabled={loading}>Add</Button>
            <IconButton size="small" onClick={() => setShowAddAttr(false)}><X size={15} /></IconButton>
          </Card>
        </Collapse>

        {showRestrictionFields && (
          <Collapse in={showAddField}>
            <Card sx={{ ml: depth * 3 + 1, mt: 0.5, p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>Assign Mandatory Field:</Typography>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel id={`add-field-select-${node.ID}`}>Select Field</InputLabel>
                <Select
                  labelId={`add-field-select-${node.ID}`}
                  label="Select Field"
                  value={selectedFieldId}
                  onChange={e => setSelectedFieldId(e.target.value)}
                >
                  <MenuItem value="" disabled><em>— Choose Field —</em></MenuItem>
                  {nodeTypes.map(f => (
                    <MenuItem key={f.ID} value={f.ID}>
                      {f.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleAddRestrictionField} disabled={loading || !selectedFieldId}>Assign</Button>
              <IconButton size="small" onClick={() => { setShowAddField(false); setSelectedFieldId(''); }}><X size={15} /></IconButton>
            </Card>
          </Collapse>
        )}

        <Collapse in={showAddChild}>
          <Card sx={{ ml: depth * 3 + 1, mt: 0.5, p: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Node Name"
              value={newChild.name}
              onChange={e => setNewChild(c => ({ ...c, name: e.target.value.slice(0, maxNameLength) }))}
              inputProps={{ maxLength: maxNameLength }}
              sx={{ flex: 1, minWidth: 120 }}
            />
            {showDescriptionField && (
              <TextField
                size="small"
                label="Description"
                value={newChild.description || ''}
                onChange={e => setNewChild(c => ({ ...c, description: e.target.value.slice(0, 200) }))}
                inputProps={{ maxLength: 200 }}
                sx={{ flex: 2, minWidth: 200 }}
              />
            )}
            {showTypeSelector && (
              <FormControl size="small" sx={{ width: 140 }}>
                <InputLabel id="child-type-label">Type</InputLabel>
                <Select
                  labelId="child-type-label"
                  label="Type"
                  value={newChild.type || (nodeTypes[0]?.ID || '')}
                  onChange={e => setNewChild(c => ({ ...c, type: e.target.value }))}
                >
                  {nodeTypes.map(t => <MenuItem key={t.ID} value={t.ID}>{t.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            {showRestrictionFields && nodeTypes.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id={`child-fields-label-${node.ID}`}>Restriction Fields</InputLabel>
                <Select
                  labelId={`child-fields-label-${node.ID}`}
                  label="Restriction Fields"
                  multiple
                  value={newChildFields}
                  onChange={e => setNewChildFields(e.target.value)}
                  renderValue={selected => selected.map(id => nodeTypes.find(f => f.ID === id)?.name || id).join(', ')}
                >
                  {nodeTypes.map(f => (
                    <MenuItem key={f.ID} value={f.ID}>{f.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {showRoleTemplateName && (
              <Box sx={{ width: '100%', mt: 1.5, mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>Role template name:</Typography>
                <TemplateNameEditor
                  value={newChildTemplate}
                  onChange={setNewChildTemplate}
                  availableFields={newChildFields.map(id => nodeTypes.find(f => f.ID === id)?.name).filter(Boolean)}
                />
              </Box>
            )}
            <Button variant="contained" size="small" onClick={handleAddChild} disabled={loading}>Add</Button>
            <IconButton size="small" onClick={() => { setShowAddChild(false); setNewChildFields([]); setNewChildTemplate(''); }}><X size={15} /></IconButton>
          </Card>
        </Collapse>

        {expanded && hasChildren && node.children.map(child => (
          <NodeRow
            key={child.ID}
            node={child}
            depth={depth + 1}
            allNodes={allNodes}
            nodeTypes={nodeTypes}
            createNode={createNode}
            updateNode={updateNode}
            deleteNode={deleteNode}
            createAttribute={createAttribute}
            deleteAttribute={deleteAttribute}
            typeIcons={typeIcons}
            defaultIcon={DefaultIcon}
            onGenerate={onGenerate}
            onRefresh={onRefresh}
            onError={onError}
            canManage={canManage}
            showTypeSelector={showTypeSelector}
            showDescriptionField={showDescriptionField}
            maxNameLength={maxNameLength}
            showRestrictionFields={showRestrictionFields}
            createRestrictionField={createRestrictionField}
            deleteRestrictionField={deleteRestrictionField}
            showRoleTemplateName={showRoleTemplateName}
          />
        ))}

        <Dialog
          open={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
        >
          <DialogTitle>Delete Node</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Delete node "{node.name}"? This cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDeleteOpen(false)} color="inherit">Cancel</Button>
            <Button onClick={executeDelete} color="error" variant="contained" autoFocus>Delete</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
}

// Tree Builder helper
function buildTree(flatNodes) {
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
  return roots;
}

// ─── Main Hierarchical Manager Component ─────────────────────────────────────
export default function HierarchicalManager({
  title,
  subtitle,
  emptyTitle,
  emptySubtitle,
  addNodePlaceholder,
  
  // API calls
  fetchNodesFlat,
  createNode,
  updateNode,
  deleteNode,
  createAttribute,
  deleteAttribute,
  
  // Styling
  typeIcons,
  defaultIcon,
  
  // Actions
  onGenerateNode,
  onGenerateAll,
  generateAllText,
  
  // Permissions
  canManage,

  // Customization props
  showTypeSelector = true,
  showDescriptionField = false,
  maxNameLength = 100,
  showRestrictionFields = false,
  createRestrictionField,
  deleteRestrictionField,
  showRoleTemplateName = false,
}) {
  const [allNodes, setAllNodes]   = useState([]);
  const [roots, setRoots]         = useState([]);
  const [nodeTypes, setNodeTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [newRoot, setNewRoot]     = useState({ name: '', description: '', type: '' });
  const [newRootTemplate, setNewRootTemplate] = useState('');
  const [newRootFields, setNewRootFields] = useState([]);
  const [snackbar, setSnackbar]   = useState({ open: false, message: '', severity: 'error' });

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const [flatData, fieldsData] = await Promise.all([
        fetchNodesFlat(),
        api.getRestrictionFields()
      ]);
      setAllNodes(flatData);
      setRoots(buildTree(flatData));
      setNodeTypes(fieldsData);
    } catch (e) {
      console.error(e);
      setSnackbar({ open: true, message: `Failed to load data: ${e.message}`, severity: 'error' });
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAddRoot() {
    if (!newRoot.name.trim()) return;
    if (showRoleTemplateName && !newRootTemplate.trim()) {
      setSnackbar({ open: true, message: 'Role template name is required.', severity: 'error' });
      return;
    }
    try {
      const payload = { name: newRoot.name };
      if (showTypeSelector) {
        payload.type_ID = newRoot.type || (nodeTypes[0]?.ID || '');
      }
      if (showDescriptionField) {
        payload.description = newRoot.description || '';
      }
      if (showRoleTemplateName) {
        payload.roleTemplateName = newRootTemplate;
      }
      const created = await createNode(payload);
      // Immediately attach selected restriction fields
      if (showRestrictionFields && newRootFields.length > 0 && createRestrictionField && created?.ID) {
        await Promise.all(newRootFields.map(fId => createRestrictionField({ domain_ID: created.ID, field_ID: fId })));
      }
      setNewRoot({ name: '', description: '', type: '' });
      setNewRootTemplate('');
      setNewRootFields([]);
      setShowAdd(false);
      await load();
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  }

  async function handleGenerateAll() {
    setLoading(true);
    try {
      const res = await onGenerateAll();
      setSnackbar({ open: true, message: `Successfully generated roles for ${res.count} organizational nodes!`, severity: 'success' });
      await load();
    } catch (e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {onGenerateAll && (
            <Button 
              variant="outlined" 
              color="primary" 
              onClick={handleGenerateAll} 
              disabled={loading || !canManage} 
              startIcon={<Zap size={15} />}
            >
              {generateAllText || 'Generate All'}
            </Button>
          )}
          <Button 
            variant="contained" 
            color="primary" 
            onClick={() => { setShowAdd(s => !s); setSnackbar({ open: false, message: '', severity: 'error' }); }} 
            disabled={!canManage}
            startIcon={<Plus size={15} />}
          >
            Add Node
          </Button>
        </Box>
      </Box>

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

      <Collapse in={showAdd}>
        <Card sx={{ p: 2, mb: 3, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={addNodePlaceholder || "Node name..."}
            value={newRoot.name}
            onChange={e => setNewRoot(r => ({ ...r, name: e.target.value.slice(0, maxNameLength) }))}
            slotProps={{ input: { maxLength: maxNameLength } }}
            sx={{ flex: 1, minWidth: 120 }}
          />
          {showDescriptionField && (
            <TextField
              size="small"
              placeholder="Description (max 200 chars)..."
              value={newRoot.description || ''}
              onChange={e => setNewRoot(r => ({ ...r, description: e.target.value.slice(0, 200) }))}
              slotProps={{ input: { maxLength: 200 } }}
              sx={{ flex: 2, minWidth: 200 }}
            />
          )}
          {showTypeSelector && (
            <FormControl size="small" sx={{ width: 160 }}>
              <InputLabel id="root-type-label">Type</InputLabel>
              <Select
                labelId="root-type-label"
                label="Type"
                value={newRoot.type || (nodeTypes[0]?.ID || '')}
                onChange={e => setNewRoot(r => ({ ...r, type: e.target.value }))}
              >
                {nodeTypes.map(t => <MenuItem key={t.ID} value={t.ID}>{t.name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {showRestrictionFields && nodeTypes.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="root-fields-label">Restriction Fields</InputLabel>
              <Select
                labelId="root-fields-label"
                label="Restriction Fields"
                multiple
                value={newRootFields}
                onChange={e => setNewRootFields(e.target.value)}
                renderValue={selected => selected.map(id => nodeTypes.find(f => f.ID === id)?.name || id).join(', ')}
              >
                {nodeTypes.map(f => (
                  <MenuItem key={f.ID} value={f.ID}>{f.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {showRoleTemplateName && (
            <Box sx={{ width: '100%', mt: 1.5, mb: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>Role template name:</Typography>
              <TemplateNameEditor
                value={newRootTemplate}
                onChange={setNewRootTemplate}
                availableFields={newRootFields.map(id => nodeTypes.find(f => f.ID === id)?.name).filter(Boolean)}
              />
            </Box>
          )}
          <Button variant="contained" onClick={handleAddRoot}>Add</Button>
          <IconButton onClick={() => { setShowAdd(false); setNewRootFields([]); setNewRootTemplate(''); }} size="small"><X size={16} /></IconButton>
        </Card>
      </Collapse>

      <Card sx={{ p: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        ) : roots.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Building2 size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{emptyTitle}</Typography>
            <Typography variant="body2" color="text.secondary">{emptySubtitle}</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {roots.map(n => (
              <NodeRow
                key={n.ID}
                node={n}
                depth={0}
                allNodes={allNodes}
                nodeTypes={nodeTypes}
                createNode={createNode}
                updateNode={updateNode}
                deleteNode={deleteNode}
                createAttribute={createAttribute}
                deleteAttribute={deleteAttribute}
                typeIcons={typeIcons}
                defaultIcon={defaultIcon}
                onGenerate={onGenerateNode}
                onRefresh={load}
                onError={msg => setSnackbar({ open: true, message: msg, severity: 'error' })}
                canManage={canManage}
                showTypeSelector={showTypeSelector}
                showDescriptionField={showDescriptionField}
                maxNameLength={maxNameLength}
                showRestrictionFields={showRestrictionFields}
                createRestrictionField={createRestrictionField}
                deleteRestrictionField={deleteRestrictionField}
                showRoleTemplateName={showRoleTemplateName}
              />
            ))}
          </Box>
        )}
      </Card>
    </Box>
  );
}
