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
import "@ui5/webcomponents-icons/dist/connected.js";
import * as api from '../api';

export default function StreamsView() {
  const [streams, setStreams]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Form states
  const [form, setForm] = useState({ ID: '', abbreviation: '', name: '' });
  const [editForm, setEditForm] = useState({ abbreviation: '', name: '' });
  const [snackbarMessage, setSnackbarMessage] = useState('');
  
  const toastRef = useRef(null);

  const showToast = (msg) => {
    setSnackbarMessage(msg);
    toastRef.current?.show();
  };

  async function load() {
    setLoading(true);
    try {
      const data = await api.getStreams();
      setStreams(data);
    } catch (e) {
      console.error(e);
      showToast(`Failed to load streams: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function validate(ID, abbreviation, name) {
    if (ID !== undefined) {
      if (ID.trim().length !== 2) return 'ID must be exactly 2 characters.';
    }
    if (abbreviation.trim().length !== 3) return 'Abbreviation must be exactly 3 characters.';
    if (!name.trim()) return 'Name is required.';
    if (name.length > 150) return 'Name cannot exceed 150 characters.';
    return '';
  }

  async function handleCreate() {
    const validationErr = validate(form.ID, form.abbreviation, form.name);
    if (validationErr) {
      showToast(validationErr);
      return;
    }

    const payload = {
      ID: form.ID.toUpperCase().trim(),
      abbreviation: form.abbreviation.toUpperCase().trim(),
      name: form.name.trim()
    };

    setLoading(true);
    try {
      await api.createStream(payload);
      setForm({ ID: '', abbreviation: '', name: '' });
      setShowAdd(false);
      await load();
      showToast('Stream created successfully.');
    } catch (e) {
      showToast(e.message);
    }
    setLoading(false);
  }

  async function handleUpdate(id) {
    const validationErr = validate(undefined, editForm.abbreviation, editForm.name);
    if (validationErr) {
      showToast(validationErr);
      return;
    }

    const payload = {
      abbreviation: editForm.abbreviation.toUpperCase().trim(),
      name: editForm.name.trim()
    };

    setLoading(true);
    try {
      await api.updateStream(id, payload);
      setEditingId(null);
      await load();
      showToast('Stream updated successfully.');
    } catch (e) {
      showToast(e.message);
    }
    setLoading(false);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete stream "${name}" (${id})?`)) return;
    setLoading(true);
    try {
      await api.deleteStream(id);
      await load();
      showToast('Stream deleted.');
    } catch (e) {
      showToast(e.message);
    }
    setLoading(false);
  }

  function startEdit(s) {
    setEditingId(s.ID);
    setEditForm({ abbreviation: s.abbreviation, name: s.name });
  }

  return (
    <FlexBox direction="Column" style={{ width: '100%', gap: '1rem', padding: '1rem', boxSizing: 'border-box' }}>
      <Toast ref={toastRef}>{snackbarMessage}</Toast>

      <FlexBox justifySelf="Spread" alignItems="Center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <FlexBox direction="Column">
          <Title level="H3">Streams Management</Title>
          <Label>Configure operational Business Data Cloud streams</Label>
        </FlexBox>
        <Button 
          design="Emphasized" 
          onClick={() => { setShowAdd(s => !s); }} 
          icon="add"
        >
          Add Stream
        </Button>
      </FlexBox>

      {showAdd && (
        <Card style={{ padding: '1.5rem', marginBottom: '1rem' }}>
          <FlexBox direction="Column" style={{ gap: '1rem', width: '100%' }}>
            <Title level="H5">New Stream Details</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', alignItems: 'end', width: '100%' }}>
              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>ID (2 Chars)</Label>
                <Input
                  maxLength={2}
                  value={form.ID}
                  onInput={e => setForm(f => ({ ...f, ID: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>Abbreviation (3 Chars)</Label>
                <Input
                  maxLength={3}
                  value={form.abbreviation}
                  onInput={e => setForm(f => ({ ...f, abbreviation: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </FlexBox>
              <FlexBox direction="Column" style={{ gap: '0.4rem' }}>
                <Label showColon>Name</Label>
                <Input
                  maxLength={150}
                  value={form.name}
                  onInput={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </FlexBox>
              <FlexBox style={{ gap: '0.5rem' }}>
                <Button design="Emphasized" onClick={handleCreate} disabled={loading} icon="accept">
                  Save
                </Button>
                <Button design="Transparent" onClick={() => setShowAdd(false)} icon="decline" />
              </FlexBox>
            </div>
          </FlexBox>
        </Card>
      )}

      <Card style={{ padding: '1rem' }}>
        {loading && streams.length === 0 ? (
          <FlexBox justifySelf="Center" style={{ width: '100%', justifyContent: 'center', padding: '3rem 0' }}>
            <BusyIndicator active size="M" />
          </FlexBox>
        ) : streams.length === 0 ? (
          <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ padding: '4rem 0', opacity: 0.5, gap: '1rem' }}>
            <Icon name="connected" style={{ fontSize: '3rem' }} />
            <Title level="H4">No operational streams configured</Title>
            <Label>Click "Add Stream" to configure a stream (e.g. FI / Finance).</Label>
          </FlexBox>
        ) : (
          <Table
            headerRow={
              <TableHeaderRow>
                <TableHeaderCell style={{ width: '100px' }}>ID</TableHeaderCell>
                <TableHeaderCell style={{ width: '150px' }}>Abbreviation</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell style={{ width: '150px', textAlign: 'right' }}>Actions</TableHeaderCell>
              </TableHeaderRow>
            }
          >
            {streams.map(s => {
              const isEditing = editingId === s.ID;
              return (
                <TableRow key={s.ID}>
                  <TableCell>
                    <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{s.ID}</span>
                  </TableCell>
                  
                  {isEditing ? (
                    <>
                      <TableCell>
                        <Input
                          maxLength={3}
                          value={editForm.abbreviation}
                          onInput={e => setEditForm(f => ({ ...f, abbreviation: e.target.value }))}
                          style={{ width: '100%' }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          maxLength={150}
                          value={editForm.name}
                          onInput={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          style={{ width: '100%' }}
                        />
                      </TableCell>
                      <TableCell style={{ textAlign: 'right' }}>
                        <FlexBox style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <Button design="Emphasized" icon="accept" onClick={() => handleUpdate(s.ID)} disabled={loading} />
                          <Button design="Transparent" icon="decline" onClick={() => setEditingId(null)} />
                        </FlexBox>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>
                        <span style={{ fontFamily: 'monospace' }}>{s.abbreviation}</span>
                      </TableCell>
                      <TableCell>
                        <span>{s.name}</span>
                      </TableCell>
                      <TableCell style={{ textAlign: 'right' }}>
                        <FlexBox style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <Button design="Transparent" icon="edit" onClick={() => startEdit(s)} />
                          <Button design="Transparent" icon="delete" onClick={() => handleDelete(s.ID, s.name)} disabled={loading} style={{ color: 'var(--sapNegativeElementColor)' }} />
                        </FlexBox>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </Table>
        )}
      </Card>
    </FlexBox>
  );
}
