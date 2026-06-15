import { useState, useEffect } from 'react';
import {
  Card,
  Text,
  Title,
  Button,
  Input,
  Select,
  Option,
  Dialog,
  FlexBox,
  BusyIndicator,
  MessageStrip,
  Label,
  Icon,
  Tag
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import * as api from '../api';

const TYPE_ICONS = {
  Global:     'globe',
  Region:     'building',
  Country:    'map-pin',
  Plant:      'factory',
  Department: 'business-card',
};

// ─── Move Dialog (UI5 replace for Modal) ──────────────────────────────────────
function MoveDialog({ node, allNodes, onConfirm, onClose, open }) {
  const [selectedParentId, setSelectedParentId] = useState('');

  function getDescendantIds(id, nodes) {
    const children = nodes.filter(n => n.parent_ID === id);
    return children.flatMap(c => [c.ID, ...getDescendantIds(c.ID, nodes)]);
  }
  const forbidden = new Set([node.ID, ...getDescendantIds(node.ID, allNodes)]);
  const validParents = allNodes.filter(n => !forbidden.has(n.ID));

  return (
    <Dialog
      open={open}
      headerText="Move Node"
      onAfterClose={onClose}
      style={{ width: '400px' }}
    >
      <FlexBox direction="Column" style={{ padding: '16px', gap: '12px', width: '100%', boxSizing: 'border-box' }}>
        <Text>
          Moving: <span style={{ fontWeight: 600, color: '#3b82f6' }}>{node.name}</span>
        </Text>
        
        <FlexBox direction="Column" style={{ gap: '4px', width: '100%' }}>
          <Label>New Parent Node</Label>
          <Select
            style={{ width: '100%' }}
            onChange={e => setSelectedParentId(e.detail.selectedOption.value)}
          >
            <Option value="" selected={selectedParentId === ''}>— Make root node (no parent) —</Option>
            {validParents.map(n => (
              <Option key={n.ID} value={n.ID} selected={selectedParentId === n.ID}>
                {n.name} ({n.type?.name || ''})
              </Option>
            ))}
          </Select>
        </FlexBox>
      </FlexBox>
      <div slot="footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px', width: '100%', boxSizing: 'border-box' }}>
        <Button design="Transparent" onClick={onClose}>Cancel</Button>
        <Button design="Emphasized" onClick={() => onConfirm(selectedParentId || null)}>Move</Button>
      </div>
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

  const IconName = (node.type && TYPE_ICONS[node.type.name]) || 'building';
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
    if (!confirm(`Delete node "${node.name}"? This cannot be undone.`)) return;
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
    <FlexBox direction="Column" style={{ gap: '4px', width: '100%' }}>
      {showMove && (
        <MoveDialog
          open={showMove}
          node={node}
          allNodes={allNodes}
          onConfirm={handleMove}
          onClose={() => setShowMove(false)}
        />
      )}

      <FlexBox direction="Column" style={{ width: '100%' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '4px',
          marginLeft: `${depth * 24}px`,
          position: 'relative',
          transition: 'all 0.2s',
        }}>
          {/* Expand toggle */}
          {hasChildren ? (
            <Button
              onClick={() => setExpanded(e => !e)}
              design="Transparent"
              icon={expanded ? "navigation-down-arrow" : "navigation-right-arrow"}
              style={{ width: '24px', height: '24px' }}
            />
          ) : (
            <div style={{ width: '24px' }} />
          )}

          <Icon name={IconName} style={{ color: '#3b82f6', width: '16px', height: '16px' }} />

          <FlexBox direction="Column" style={{ flexGrow: 1 }}>
            {editing ? (
              <FlexBox alignItems="Center" style={{ gap: '8px' }}>
                <Input
                  value={editName}
                  onInput={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRename()}
                  style={{ width: '200px' }}
                />
                <Button design="Positive" onClick={handleRename} disabled={loading} icon="accept" />
                <Button design="Transparent" onClick={() => setEditing(false)} icon="decline" />
              </FlexBox>
            ) : (
              <>
                <Text style={{ fontWeight: 700 }}>{node.name}</Text>
                <Text style={{ color: 'var(--sapContent_LabelColor, #888)', fontSize: '11px' }}>{node.type?.name || ''}</Text>
              </>
            )}
          </FlexBox>

          {/* Attributes */}
          {node.attributes && node.attributes.length > 0 && (
            <FlexBox style={{ gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {node.attributes.map(a => (
                <FlexBox key={a.ID} alignItems="Center" style={{ gap: '4px' }}>
                  <Tag design="Set3">{`${a.field}: ${a.value}`}</Tag>
                  {(!permissions || permissions.canManageOrgRoles) && (
                    <Button
                      icon="decline"
                      design="Transparent"
                      style={{ height: '16px', width: '16px', minWidth: '16px', padding: 0 }}
                      onClick={() => handleDeleteAttr(a.ID)}
                    />
                  )}
                </FlexBox>
              ))}
            </FlexBox>
          )}

          {/* Action Row */}
          <FlexBox style={{ gap: '4px' }}>
            <Button 
              design="Transparent" 
              onClick={() => onGenerate(node.ID)} 
              disabled={permissions && !permissions.canManageOrgRoles}
              icon="flash"
            >
              Role
            </Button>
            <Button design="Transparent" icon="add" onClick={() => setShowAddAttr(s => !s)} disabled={permissions && !permissions.canManageOrgRoles} title="Add Attribute" />
            <Button design="Transparent" icon="edit" onClick={() => { setEditing(true); setEditName(node.name); }} disabled={permissions && !permissions.canManageOrgRoles} title="Rename" />
            <Button design="Transparent" icon="building" onClick={() => setShowAddChild(s => !s)} disabled={permissions && !permissions.canManageOrgRoles} title="Add Child Node" />
            <Button design="Transparent" icon="arrow-right" onClick={() => setShowMove(true)} title="Move Node" disabled={loading || (permissions && !permissions.canManageOrgRoles)} />
            <Button design="Transparent" icon="delete" onClick={handleDelete} disabled={loading || hasChildren || (permissions && !permissions.canManageOrgRoles)} title={hasChildren ? 'Remove all children first' : 'Delete node'} style={{ color: 'var(--sapNegativeElementColor)' }} />
          </FlexBox>
        </div>

        {/* Inline forms */}
        {showAddAttr && (
          <Card style={{ marginLeft: `${depth * 24 + 8}px`, marginTop: '8px', padding: '12px' }}>
            <FlexBox alignItems="Center" style={{ gap: '8px' }}>
              <Input placeholder="Field (e.g. Country)" value={newAttr.field} onInput={e => setNewAttr(a => ({ ...a, field: e.target.value }))} style={{ flex: 1 }} />
              <Input placeholder="Value (e.g. Germany)" value={newAttr.value} onInput={e => setNewAttr(a => ({ ...a, value: e.target.value }))} style={{ flex: 1 }} />
              <Button design="Emphasized" onClick={handleAddAttr} disabled={loading}>Add</Button>
              <Button icon="decline" design="Transparent" onClick={() => setShowAddAttr(false)} />
            </FlexBox>
          </Card>
        )}

        {showAddChild && (
          <Card style={{ marginLeft: `${depth * 24 + 8}px`, marginTop: '8px', padding: '12px' }}>
            <FlexBox alignItems="Center" style={{ gap: '8px' }}>
              <Input placeholder="Node Name" value={newChild.name} onInput={e => setNewChild(c => ({ ...c, name: e.target.value }))} style={{ flex: 1 }} />
              <div style={{ width: '140px' }}>
                <Select
                  onChange={e => setNewChild(c => ({ ...c, type: e.detail.selectedOption.value }))}
                >
                  {nodeTypes.map(t => (
                    <Option key={t.ID} value={t.ID} selected={newChild.type === t.ID || (!newChild.type && nodeTypes[0]?.ID === t.ID)}>
                      {t.name}
                    </Option>
                  ))}
                </Select>
              </div>
              <Button design="Emphasized" onClick={handleAddChild} disabled={loading}>Add</Button>
              <Button icon="decline" design="Transparent" onClick={() => setShowAddChild(false)} />
            </FlexBox>
          </Card>
        )}

        {/* Children Row Rendering */}
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
      </FlexBox>
    </FlexBox>
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

  const handleCloseSnackbar = () => {
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
    <div style={{ animation: 'fadeIn 0.3s' }}>
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap" style={{ gap: '16px', marginBottom: '24px' }}>
        <div>
          <Title level="H3" style={{ marginBottom: '4px' }}>Organizational Structure</Title>
          <Text style={{ color: 'var(--sapContent_LabelColor, #888)' }}>Maintain your business hierarchy — roles are generated from this structure</Text>
        </div>
        <FlexBox style={{ gap: '12px' }}>
          <Button 
            design="Default" 
            onClick={handleGenerateAll} 
            disabled={loading || (permissions && !permissions.canManageOrgRoles)} 
            icon="flash"
          >
            Generate All Roles
          </Button>
          <Button 
            design="Emphasized" 
            onClick={() => { setShowAdd(s => !s); setSnackbar({ open: false, message: '', severity: 'error' }); }} 
            disabled={permissions && !permissions.canManageOrgRoles}
            icon="add"
          >
            Add Node
          </Button>
        </FlexBox>
      </FlexBox>

      {snackbar.open && (
        <MessageStrip
          design={snackbar.severity === 'success' ? 'Positive' : 'Negative'}
          onClose={handleCloseSnackbar}
          style={{ marginBottom: '16px' }}
        >
          {snackbar.message}
        </MessageStrip>
      )}

      {showAdd && (
        <Card style={{ padding: '16px', marginBottom: '24px' }}>
          <FlexBox alignItems="Center" style={{ gap: '12px' }}>
            <Input
              placeholder="Node name (e.g. Asia Pacific)"
              value={newRoot.name}
              onInput={e => setNewRoot(r => ({ ...r, name: e.target.value }))}
              style={{ flex: 1 }}
            />
            <div style={{ width: '160px' }}>
              <Select
                onChange={e => setNewRoot(r => ({ ...r, type: e.detail.selectedOption.value }))}
              >
                {nodeTypes.map(t => (
                  <Option key={t.ID} value={t.ID} selected={newRoot.type === t.ID || (!newRoot.type && nodeTypes[0]?.ID === t.ID)}>
                    {t.name}
                  </Option>
                ))}
              </Select>
            </div>
            <Button design="Emphasized" onClick={handleAddRoot}>Add</Button>
            <Button icon="decline" design="Transparent" onClick={() => setShowAdd(false)} />
          </FlexBox>
        </Card>
      )}

      <Card style={{ padding: '16px' }}>
        {loading ? (
          <FlexBox justifyContent="Center" style={{ padding: '40px 0' }}>
            <BusyIndicator active size="Medium" />
          </FlexBox>
        ) : roots.length === 0 ? (
          <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ padding: '48px 0', textAlign: 'center', gap: '16px' }}>
            <Icon name="building" style={{ fontSize: '40px', opacity: 0.5 }} />
            <Title level="H6">No organizational nodes yet</Title>
            <Text style={{ color: 'var(--sapContent_LabelColor, #888)' }}>Add a root node to get started (e.g. Global).</Text>
          </FlexBox>
        ) : (
          <FlexBox direction="Column" style={{ gap: '8px' }}>
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
          </FlexBox>
        )}
      </Card>
    </div>
  );
}
