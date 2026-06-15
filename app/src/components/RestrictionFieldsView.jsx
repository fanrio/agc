import { useState, useEffect, useRef } from 'react';
import { 
  FlexBox, 
  Card, 
  CardHeader, 
  Title, 
  Label, 
  Table, 
  TableHeaderRow, 
  TableHeaderCell, 
  TableRow, 
  TableCell, 
  Button, 
  Input, 
  Select, 
  Option, 
  MultiComboBox, 
  MultiComboBoxItem, 
  Tag, 
  BusyIndicator, 
  MessageStrip, 
  Icon, 
  Toast 
} from '@ui5/webcomponents-react';
import "@ui5/webcomponents-icons/dist/add.js";
import "@ui5/webcomponents-icons/dist/delete.js";
import "@ui5/webcomponents-icons/dist/edit.js";
import "@ui5/webcomponents-icons/dist/accept.js";
import "@ui5/webcomponents-icons/dist/decline.js";
import "@ui5/webcomponents-icons/dist/cloud.js";
import "@ui5/webcomponents-icons/dist/settings.js";
import * as api from '../api';

export default function RestrictionFieldsView() {
  const [fields, setFields]         = useState([]);
  const [bdcConnections, setBdcConnections] = useState([]);
  const [loading, setLoading]       = useState(true);
  
  // Creation States
  const [showAdd, setShowAdd]       = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newBdcConnectionId, setNewBdcConnectionId] = useState('');
  const [newAsset, setNewAsset] = useState('');
  const [assetsList, setAssetsList] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  // ID & Text Metadata Columns States
  const [columnsList, setColumnsList] = useState([]);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const [newIdColumns, setNewIdColumns] = useState([]);
  const [newTextColumn, setNewTextColumn] = useState('');

  // Editing States
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', bdcConnectionId: '', asset: '', idColumns: [], textColumn: '' });
  const [editAssetsList, setEditAssetsList] = useState([]);
  const [loadingEditAssets, setLoadingEditAssets] = useState(false);
  const [editColumnsList, setEditColumnsList] = useState([]);
  const [loadingEditColumns, setLoadingEditColumns] = useState(false);

  const [toastMessage, setToastMessage] = useState('');
  const toastRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    toastRef.current?.show();
  };

  async function load() {
    setLoading(true);
    try {
      const [customFields, connections] = await Promise.all([
        api.getRestrictionFields(),
        api.getBdcSettings()
      ]);
      setFields(customFields);
      setBdcConnections(connections);
    } catch (e) {
      console.error(e);
      showToast(`Failed to load data: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Auto-fetch assets when creation BDC connection changes
  useEffect(() => {
    if (!newBdcConnectionId) {
      setAssetsList([]);
      setNewAsset('');
      return;
    }
    const conn = bdcConnections.find(c => c.ID === newBdcConnectionId);
    if (conn) {
      setLoadingAssets(true);
      api.fetchBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space)
        .then(assets => {
          setAssetsList(assets);
          setNewAsset(assets[0] || '');
        })
        .catch(e => {
          console.error('Failed to load assets:', e);
          setAssetsList([]);
          setNewAsset('');
          alert(`Failed to load assets: ${e.message}`);
        })
        .finally(() => {
          setLoadingAssets(false);
        });
    }
  }, [newBdcConnectionId, bdcConnections]);

  // Auto-fetch columns when creation BDC connection or asset changes
  useEffect(() => {
    if (!newBdcConnectionId || !newAsset) {
      setColumnsList([]);
      setNewIdColumns([]);
      setNewTextColumn('');
      return;
    }
    const conn = bdcConnections.find(c => c.ID === newBdcConnectionId);
    if (conn) {
      setLoadingColumns(true);
      api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, newAsset)
        .then(cols => {
          setColumnsList(cols);
          const defaultId = cols.find(c => c.toLowerCase() === 'id') || cols[0] || '';
          setNewIdColumns(defaultId ? [defaultId] : []);
          const defaultText = cols.find(c => ['name', 'text', 'description', 'formattedaddress'].includes(c.toLowerCase())) || cols[0] || '';
          setNewTextColumn(defaultText);
        })
        .catch(e => {
          console.error('Failed to fetch columns:', e);
          setColumnsList([]);
          alert(`Failed to load columns: ${e.message}`);
        })
        .finally(() => {
          setLoadingColumns(false);
        });
    }
  }, [newBdcConnectionId, newAsset, bdcConnections]);

  // Auto-fetch assets when editing BDC connection changes
  useEffect(() => {
    if (!editForm.bdcConnectionId) {
      setEditAssetsList([]);
      return;
    }
    const conn = bdcConnections.find(c => c.ID === editForm.bdcConnectionId);
    if (conn) {
      setLoadingEditAssets(true);
      api.fetchBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space)
        .then(assets => {
          setEditAssetsList(assets);
        })
        .catch(e => {
          console.error('Failed to load edit assets:', e);
          setEditAssetsList([]);
          alert(`Failed to load edit assets: ${e.message}`);
        })
        .finally(() => {
          setLoadingEditAssets(false);
        });
    }
  }, [editForm.bdcConnectionId, bdcConnections]);

  // Auto-fetch columns when editing asset changes
  useEffect(() => {
    if (!editForm.bdcConnectionId || !editForm.asset) {
      setEditColumnsList([]);
      return;
    }
    const conn = bdcConnections.find(c => c.ID === editForm.bdcConnectionId);
    if (conn) {
      setLoadingEditColumns(true);
      api.fetchBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, conn.space, editForm.asset)
        .then(cols => {
          setEditColumnsList(cols);
        })
        .catch(e => {
          console.error('Failed to load edit columns:', e);
          setEditColumnsList([]);
          alert(`Failed to load edit columns: ${e.message}`);
        })
        .finally(() => {
          setLoadingEditColumns(false);
        });
    }
  }, [editForm.bdcConnectionId, editForm.asset, bdcConnections]);

  async function handleAddField() {
    const name = newFieldName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const payload = {
        name,
        bdcConnection_ID: newBdcConnectionId || null,
        asset: newAsset || null,
        idColumns: newIdColumns.length > 0 ? JSON.stringify(newIdColumns) : null,
        textColumn: newTextColumn || null
      };
      await api.createRestrictionField(payload);
      
      setNewFieldName('');
      setNewBdcConnectionId('');
      setNewAsset('');
      setNewIdColumns([]);
      setNewTextColumn('');
      setShowAdd(false);
      await load();
      showToast('Restriction field added.');
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  }

  async function handleUpdateField(id) {
    const name = editForm.name.trim();
    if (!name) return;
    setLoading(true);
    try {
      const payload = {
        name,
        bdcConnection_ID: editForm.bdcConnectionId || null,
        asset: editForm.asset || null,
        idColumns: editForm.idColumns.length > 0 ? JSON.stringify(editForm.idColumns) : null,
        textColumn: editForm.textColumn || null
      };
      await api.updateRestrictionField(id, payload);

      setEditingId(null);
      await load();
      showToast('Restriction field updated.');
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  }

  function startEdit(f) {
    let initialIds = [];
    try {
      initialIds = f.idColumns ? JSON.parse(f.idColumns) : [];
    } catch {
      initialIds = f.idColumns ? [f.idColumns] : [];
    }
    setEditingId(f.ID);
    setEditForm({
      name: f.name,
      bdcConnectionId: f.bdcConnection?.ID || '',
      asset: f.asset || '',
      idColumns: initialIds,
      textColumn: f.textColumn || ''
    });
    if (f.asset) {
      setEditAssetsList([f.asset]);
    } else {
      setEditAssetsList([]);
    }
  }

  async function handleDeleteField(id, name) {
    if (!confirm(`Remove restriction field "${name}"? Existing roles using this field name will not be deleted but it will no longer be available for new restrictions.`)) return;
    setLoading(true);
    try {
      await api.deleteRestrictionField(id);
      await load();
      showToast('Restriction field removed.');
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  }

  return (
    <FlexBox direction="Column" style={{ width: '100%', gap: '1rem', padding: '1rem', boxSizing: 'border-box' }}>
      <Toast ref={toastRef}>{toastMessage}</Toast>

      <FlexBox justifySelf="Spread" alignItems="Center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <FlexBox direction="Column">
          <Title level="H3">Restriction Fields Configuration</Title>
          <Label>Configure the field names and BDC asset associations</Label>
        </FlexBox>
        <Button design="Emphasized" icon="add" onClick={() => setShowAdd(s => !s)}>
          Add Field
        </Button>
      </FlexBox>

      {showAdd && (
        <Card style={{ padding: '1.5rem', marginBottom: '1rem' }}>
          <FlexBox direction="Column" style={{ gap: '1rem', width: '100%' }}>
            <Title level="H5">New Restriction Field</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end', width: '100%' }}>
              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>Field Name</Label>
                <Input
                  placeholder="e.g. CostCenter"
                  value={newFieldName}
                  onInput={e => setNewFieldName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </FlexBox>

              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>BDC Connection</Label>
                <Select
                  onChange={e => setNewBdcConnectionId(e.detail.selectedOption.value)}
                  style={{ width: '100%' }}
                >
                  <Option value="">None (No BDC Link)</Option>
                  {bdcConnections.map(c => (
                    <Option key={c.ID} value={c.ID} selected={c.ID === newBdcConnectionId}>
                      {c.systemName}
                    </Option>
                  ))}
                </Select>
              </FlexBox>

              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>{loadingAssets ? 'Loading Assets...' : 'Asset'}</Label>
                <Select
                  disabled={!newBdcConnectionId || loadingAssets}
                  onChange={e => setNewAsset(e.detail.selectedOption.value)}
                  style={{ width: '100%' }}
                >
                  {assetsList.map(a => (
                    <Option key={a} value={a} selected={a === newAsset}>{a}</Option>
                  ))}
                  {assetsList.length === 0 && (
                    <Option value="" disabled selected>No assets available</Option>
                  )}
                </Select>
              </FlexBox>

              {newBdcConnectionId && newAsset && (
                <>
                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>ID Columns (Keys)</Label>
                    <MultiComboBox
                      disabled={loadingColumns || columnsList.length === 0}
                      onSelectionChange={e => {
                        const selectedKeys = e.detail.items.map(item => item.getAttribute('value') || item.text);
                        setNewIdColumns(selectedKeys);
                      }}
                      style={{ width: '100%' }}
                    >
                      {columnsList.map(c => (
                        <MultiComboBoxItem key={c} value={c} text={c} selected={newIdColumns.indexOf(c) > -1} />
                      ))}
                    </MultiComboBox>
                  </FlexBox>

                  <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                    <Label showColon>Text Column (Label)</Label>
                    <Select
                      disabled={loadingColumns || columnsList.length === 0}
                      onChange={e => setNewTextColumn(e.detail.selectedOption.value)}
                      style={{ width: '100%' }}
                    >
                      <Option value="">None</Option>
                      {columnsList.map(c => (
                        <Option key={c} value={c} selected={c === newTextColumn}>{c}</Option>
                      ))}
                    </Select>
                  </FlexBox>
                </>
              )}
            </div>

            <FlexBox style={{ gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button design="Transparent" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button design="Emphasized" onClick={handleAddField} disabled={loading || !newFieldName.trim()}>Save Field</Button>
            </FlexBox>
          </FlexBox>
        </Card>
      )}

      <Card style={{ padding: '1rem' }}>
        {loading && fields.length === 0 ? (
          <FlexBox justifySelf="Center" style={{ width: '100%', justifyContent: 'center', padding: '3rem 0' }}>
            <BusyIndicator active size="M" />
          </FlexBox>
        ) : fields.length === 0 ? (
          <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ padding: '4rem 0', opacity: 0.5, gap: '1rem' }}>
            <Icon name="settings" style={{ fontSize: '3rem' }} />
            <Title level="H4">No restriction fields configured</Title>
            <Label>Add fields like Country, Plant, or CostCenter to configure them.</Label>
          </FlexBox>
        ) : (
          <Table
            headerRow={
              <TableHeaderRow>
                <TableHeaderCell>Field Name</TableHeaderCell>
                <TableHeaderCell>BDC Connection</TableHeaderCell>
                <TableHeaderCell>Asset</TableHeaderCell>
                <TableHeaderCell>Metadata Mapping</TableHeaderCell>
                <TableHeaderCell style={{ width: '150px', textAlign: 'right' }}>Actions</TableHeaderCell>
              </TableHeaderRow>
            }
          >
            {fields.map(f => {
              const isEditing = editingId === f.ID;
              if (isEditing) {
                return (
                  <TableRow key={f.ID}>
                    <TableCell colSpan={5}>
                      <FlexBox direction="Column" style={{ gap: '1rem', padding: '1rem', width: '100%', boxSizing: 'border-box' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', width: '100%' }}>
                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>Field Name</Label>
                            <Input
                              value={editForm.name}
                              onInput={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                              style={{ width: '100%' }}
                            />
                          </FlexBox>

                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>BDC Connection</Label>
                            <Select
                              onChange={e => setEditForm(prev => ({ ...prev, bdcConnectionId: e.detail.selectedOption.value }))}
                              style={{ width: '100%' }}
                            >
                              <Option value="">None (No BDC Link)</Option>
                              {bdcConnections.map(c => (
                                <Option key={c.ID} value={c.ID} selected={c.ID === editForm.bdcConnectionId}>
                                  {c.systemName}
                                </Option>
                              ))}
                            </Select>
                          </FlexBox>

                          <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                            <Label showColon>{loadingEditAssets ? 'Loading Assets...' : 'Asset'}</Label>
                            <Select
                              disabled={!editForm.bdcConnectionId || loadingEditAssets}
                              onChange={e => setEditForm(prev => ({ ...prev, asset: e.detail.selectedOption.value }))}
                              style={{ width: '100%' }}
                            >
                              {Array.from(new Set([...editAssetsList, editForm.asset])).filter(Boolean).map(a => (
                                <Option key={a} value={a} selected={a === editForm.asset}>{a}</Option>
                              ))}
                              {editAssetsList.length === 0 && (
                                <Option value="" disabled selected>No assets available</Option>
                              )}
                            </Select>
                          </FlexBox>

                          {editForm.bdcConnectionId && editForm.asset && (
                            <>
                              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                                <Label showColon>ID Columns (Keys)</Label>
                                <MultiComboBox
                                  disabled={loadingEditColumns || editColumnsList.length === 0}
                                  onSelectionChange={e => {
                                    const selectedKeys = e.detail.items.map(item => item.getAttribute('value') || item.text);
                                    setEditForm(prev => ({ ...prev, idColumns: selectedKeys }));
                                  }}
                                  style={{ width: '100%' }}
                                >
                                  {editColumnsList.map(c => (
                                    <MultiComboBoxItem key={c} value={c} text={c} selected={editForm.idColumns.indexOf(c) > -1} />
                                  ))}
                                </MultiComboBox>
                              </FlexBox>

                              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                                <Label showColon>Text Column (Label)</Label>
                                <Select
                                  disabled={loadingEditColumns || editColumnsList.length === 0}
                                  onChange={e => setEditForm(prev => ({ ...prev, textColumn: e.detail.selectedOption.value }))}
                                  style={{ width: '100%' }}
                                >
                                  <Option value="">None</Option>
                                  {editColumnsList.map(c => (
                                    <Option key={c} value={c} selected={c === editForm.textColumn}>{c}</Option>
                                  ))}
                                </Select>
                              </FlexBox>
                            </>
                          )}
                        </div>

                        <FlexBox style={{ gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <Button design="Emphasized" icon="accept" onClick={() => handleUpdateField(f.ID)} disabled={loading || !editForm.name.trim()}>Save</Button>
                          <Button design="Transparent" icon="decline" onClick={() => setEditingId(null)}>Cancel</Button>
                        </FlexBox>
                      </FlexBox>
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow key={f.ID}>
                  <TableCell>
                    <span style={{ fontWeight: 'bold' }}>{f.name}</span>
                  </TableCell>
                  <TableCell>
                    {f.bdcConnection ? (
                      <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                        <Icon name="cloud" style={{ color: '#3b82f6' }} />
                        <span>{f.bdcConnection.systemName}</span>
                      </FlexBox>
                    ) : 'None'}
                  </TableCell>
                  <TableCell>
                    <span style={{ fontFamily: 'monospace' }}>{f.asset || '—'}</span>
                  </TableCell>
                  <TableCell>
                    {f.bdcConnection ? (
                      <FlexBox style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                        {f.idColumns && (
                          <Tag design="Set1">
                            {`Keys: ${(() => {
                              try { return JSON.parse(f.idColumns).join(', '); } catch { return f.idColumns; }
                            })()}`}
                          </Tag>
                        )}
                        {f.textColumn && (
                          <Tag design="Set2">
                            {`Label: ${f.textColumn}`}
                          </Tag>
                        )}
                      </FlexBox>
                    ) : '—'}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right' }}>
                    <FlexBox style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <Button design="Transparent" icon="edit" onClick={() => startEdit(f)} disabled={loading} />
                      <Button design="Transparent" icon="delete" onClick={() => handleDeleteField(f.ID, f.name)} disabled={loading} style={{ color: 'var(--sapNegativeElementColor)' }} />
                    </FlexBox>
                  </TableCell>
                </TableRow>
              );
            })}
          </Table>
        )}
      </Card>
    </FlexBox>
  );
}
