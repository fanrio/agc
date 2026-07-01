import { useState, useEffect } from 'react';
import { Box, Card, Typography, Button, TextField, Select, MenuItem, FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, IconButton, Chip, CircularProgress, Collapse, Alert, Snackbar } from '@mui/material';
import { Globe, Building2, MapPin, Factory, Briefcase, Plus, Trash2, ChevronRight, ChevronDown, Zap, Edit3, X, Check, MoveRight } from 'lucide-react';
import * as api from '../api';

const TYPE_ICONS = {
  Global:     Globe,
  Region:     Building2,
  Country:    MapPin,
  Plant:      Factory,
  Department: Briefcase,
};

// ─── Move Dialog (MUI replace for Modal) ──────────────────────────────────────
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
        <IconButton onClick={onClose} size="small"><X size={16} /></IconButton>
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
                {n.name} ({n.type?.name || ''})
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

// ─── Org Node Row ─────────────────────────────────────────────────────────────
function OrgNodeRow({ node, depth = 0, allNodes, nodeTypes = [], onGenerate, onRefresh, onError, permissions }) {
  const [expanded, setExpanded]       = useState(depth < 2);
  const [showAddChild, setShowAddChild] = useState(false);
  const [showAddAttr, setShowAddAttr]  = useState(false);
  const [showMove, setShowMove]        = useState(false);
  const [editing, setEditing]          = useState(false);
  const [editName, setEditName]        = useState(node.name);
  const [newChild, setNewChild]        = useState({ name: '', type: '' });
  const [newAttr, setNewAttr]          = useState({ field: '', value: '' });
  const [loading, setLoading]          = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const Icon = (node.type && TYPE_ICONS[node.type.name]) || Building2;
  const hasChildren = node.children && node.children.length > 0;

  async function handleAddChild() {
    if (!newChild.name.trim()) return;
    setLoading(true);
    try {
      const type_ID = newChild.type || (nodeTypes[0]?.ID || '');
      await api.createOrgNode({ name: newChild.name, type_ID, parent_ID: node.ID });
      setNewChild({ name: '', type: '' });
      setShowAddChild(false);
      await onRefresh();
      setExpanded(true);
    } catch(e) { onError(e.message); }
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
      await api.deleteOrgNode(node.ID);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  async function handleRename() {
    if (!editName.trim()) return;
    setLoading(true);
    try {
      await api.updateOrgNode(node.ID, { name: editName });
      setEditing(false);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  async function handleAddAttr() {
    if (!newAttr.field.trim() || !newAttr.value.trim()) return;
    setLoading(true);
    try {
      await api.createOrgAttr({ node_ID: node.ID, field: newAttr.field, value: newAttr.value });
      setNewAttr({ field: '', value: '' });
      setShowAddAttr(false);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  async function handleDeleteAttr(attrId) {
    setLoading(true);
    try {
      await api.deleteOrgAttr(attrId);
      await onRefresh();
    } catch(e) { onError(e.message); }
    setLoading(false);
  }

  async function handleMove(newParentId) {
    setLoading(true);
    try {
      await api.updateOrgNode(node.ID, { parent_ID: newParentId });
      setShowMove(false);
      await onRefresh();
    } catch(e) { onError(e.message); }
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
          {/* Expand toggle */}
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
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRename()}
                  autoFocus
                  sx={{ '& input': { py: 0.5, px: 1, fontSize: 13 } }}
                />
                <IconButton color="primary" onClick={handleRename} disabled={loading} size="small"><Check size={14} /></IconButton>
                <IconButton onClick={() => setEditing(false)} size="small"><X size={14} /></IconButton>
              </Box>
            ) : (
              <>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{node.name}</Typography>
                <Typography variant="caption" color="text.secondary">{node.type?.name || ''}</Typography>
              </>
            )}
          </Box>

          {/* Attributes */}
          {node.attributes && node.attributes.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {node.attributes.map(a => (
                <Chip
                  key={a.ID}
                  label={`${a.field}: ${a.value}`}
                  size="small"
                  onDelete={permissions && !permissions.canManageOrgRoles ? undefined : () => handleDeleteAttr(a.ID)}
                  color="primary"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 9 }}
                />
              ))}
            </Box>
          )}

          {/* Action Row */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button 
              size="small" 
              variant="text" 
              color="primary" 
              onClick={() => onGenerate(node.ID)} 
              disabled={permissions && !permissions.canManageOrgRoles}
              startIcon={<Zap size={12} />}
            >
              Role
            </Button>
            <IconButton size="small" onClick={() => setShowAddAttr(s => !s)} disabled={permissions && !permissions.canManageOrgRoles} title="Add Attribute"><Plus size={13} /></IconButton>
            <IconButton size="small" onClick={() => { setEditing(true); setEditName(node.name); }} disabled={permissions && !permissions.canManageOrgRoles} title="Rename"><Edit3 size={13} /></IconButton>
            <IconButton size="small" onClick={() => setShowAddChild(s => !s)} disabled={permissions && !permissions.canManageOrgRoles} title="Add Child Node"><Building2 size={13} /></IconButton>
            <IconButton size="small" onClick={() => setShowMove(true)} title="Move Node" disabled={loading || (permissions && !permissions.canManageOrgRoles)}><MoveRight size={13} /></IconButton>
            <IconButton size="small" color="error" onClick={handleDelete} disabled={loading || hasChildren || (permissions && !permissions.canManageOrgRoles)} title={hasChildren ? 'Remove all children first' : 'Delete node'}><Trash2 size={13} /></IconButton>
          </Box>
        </Box>

        {/* Inline forms */}
        <Collapse in={showAddAttr}>
          <Card sx={{ ml: depth * 3 + 1, mt: 0.5, p: 1.5, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField size="small" label="Field (e.g. Country)" value={newAttr.field} onChange={e => setNewAttr(a => ({ ...a, field: e.target.value }))} sx={{ flex: 1 }} />
            <TextField size="small" label="Value (e.g. Germany)" value={newAttr.value} onChange={e => setNewAttr(a => ({ ...a, value: e.target.value }))} sx={{ flex: 1 }} />
            <Button variant="contained" size="small" onClick={handleAddAttr} disabled={loading}>Add</Button>
            <IconButton size="small" onClick={() => setShowAddAttr(false)}><X size={15} /></IconButton>
          </Card>
        </Collapse>

        <Collapse in={showAddChild}>
          <Card sx={{ ml: depth * 3 + 1, mt: 0.5, p: 1.5, display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField size="small" label="Node Name" value={newChild.name} onChange={e => setNewChild(c => ({ ...c, name: e.target.value }))} sx={{ flex: 1 }} />
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
            <Button variant="contained" size="small" onClick={handleAddChild} disabled={loading}>Add</Button>
            <IconButton size="small" onClick={() => setShowAddChild(false)}><X size={15} /></IconButton>
          </Card>
        </Collapse>

        {/* Children Row Rendering */}
        {/* Render children row recursive call */}
        {expanded && hasChildren && node.children.map(child => (
          <OrgNodeRow
            key={child.ID}
            node={child}
            depth={depth + 1}
            allNodes={allNodes}
            nodeTypes={nodeTypes}
            onGenerate={onGenerate}
            onRefresh={onRefresh}
            onError={onError}
            permissions={permissions}
          />
        ))}

        {/* Confirm Delete Dialog */}
        <Dialog
          open={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          aria-labelledby="confirm-delete-dialog-title"
          aria-describedby="confirm-delete-dialog-description"
        >
          <DialogTitle id="confirm-delete-dialog-title">
            Delete Node
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="confirm-delete-dialog-description">
              Delete node "{node.name}"? This cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDeleteOpen(false)} color="inherit">
              Cancel
            </Button>
            <Button onClick={executeDelete} color="error" variant="contained" autoFocus>
              Delete
            </Button>
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

// ─── Main Org View ────────────────────────────────────────────────────────────
export default function OrgStructureView({ onGenerateRole, permissions }) {
  const [allNodes, setAllNodes]   = useState([]);
  const [roots, setRoots]         = useState([]);
  const [nodeTypes, setNodeTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [newRoot, setNewRoot]     = useState({ name: '', type: '' });
  const [snackbar, setSnackbar]   = useState({ open: false, message: '', severity: 'error' });

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  async function load() {
    setLoading(true);
    try {
      const [flatData, fieldsData] = await Promise.all([
        api.getAllOrgNodesFlat(),
        api.getRestrictionFields()
      ]);
      setAllNodes(flatData);
      setRoots(buildTree(flatData));
      setNodeTypes(fieldsData);
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAddRoot() {
    if (!newRoot.name.trim()) return;
    try {
      const type_ID = newRoot.type || (nodeTypes[0]?.ID || '');
      await api.createOrgNode({ name: newRoot.name, type_ID });
      setNewRoot({ name: '', type: '' });
      setShowAdd(false);
      await load();
    } catch(e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
  }

  async function handleGenerateAll() {
    setLoading(true);
    try {
      const res = await api.generateAllOrgRoles();
      setSnackbar({ open: true, message: `Successfully generated roles for ${res.count} organizational nodes!`, severity: 'success' });
      await load();
    } catch(e) { setSnackbar({ open: true, message: e.message, severity: 'error' }); }
    setLoading(false);
  }

  return (
    <Box sx={{ animation: 'fadeIn 0.3s' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Organizational Structure</Typography>
          <Typography variant="body2" color="text.secondary">Maintain your business hierarchy — roles are generated from this structure</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button 
            variant="outlined" 
            color="primary" 
            onClick={handleGenerateAll} 
            disabled={loading || (permissions && !permissions.canManageOrgRoles)} 
            startIcon={<Zap size={15} />}
          >
            Generate All Roles
          </Button>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={() => { setShowAdd(s => !s); setSnackbar({ open: false, message: '', severity: 'error' }); }} 
            disabled={permissions && !permissions.canManageOrgRoles}
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
        <Card sx={{ p: 2, mb: 3, display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Node name (e.g. Asia Pacific)"
            value={newRoot.name}
            onChange={e => setNewRoot(r => ({ ...r, name: e.target.value }))}
            sx={{ flex: 1 }}
          />
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
          <Button variant="contained" onClick={handleAddRoot}>Add</Button>
          <IconButton onClick={() => setShowAdd(false)} size="small"><X size={16} /></IconButton>
        </Card>
      </Collapse>

      <Card sx={{ p: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress size={30} /></Box>
        ) : roots.length === 0 ? (
          <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ opacity: 0.5, mb: 2 }}><Building2 size={40} /></Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>No organizational nodes yet</Typography>
            <Typography variant="body2" color="text.secondary">Add a root node to get started (e.g. Global).</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {roots.map(n => (
              <OrgNodeRow
                key={n.ID}
                node={n}
                depth={0}
                allNodes={allNodes}
                nodeTypes={nodeTypes}
                onGenerate={onGenerateRole}
                onRefresh={load}
                onError={msg => setSnackbar({ open: true, message: msg, severity: 'error' })}
                permissions={permissions}
              />
            ))}
          </Box>
        )}
      </Card>
    </Box>
  );
}
