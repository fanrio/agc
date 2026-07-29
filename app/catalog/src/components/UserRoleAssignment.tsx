import { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';
import UserSelection from './UserSelection';
import SearchableSelect from './SearchableSelect';
import * as api from '../api';

// Helper to recursively check if a role or any of its parents has restrictions
function hasAnyRestrictions(role, allRoles) {
  if (role.ownRestrictions && role.ownRestrictions.length > 0) return true;
  if (role.parentRoles && role.parentRoles.length > 0) {
    for (const pr of role.parentRoles) {
      const parentId = pr.parent_ID || (pr.parent && pr.parent.ID);
      if (parentId) {
        const parent = allRoles.find(r => r.ID === parentId);
        if (parent && hasAnyRestrictions(parent, allRoles)) {
          return true;
        }
      }
    }
  }
  return false;
}

interface UserRoleAssignmentProps {
  open: boolean;
  role?: any;
  roles?: any[];
  allRoles?: any[];
  onClose: () => void;
  onSuccess?: (msg: string) => void | Promise<void>;
  onError?: (msg: string) => void;
}

export default function UserRoleAssignment({
  open,
  role,
  roles = [],
  allRoles = roles,
  onClose,
  onSuccess,
  onError
}: UserRoleAssignmentProps) {
  const [selectedScimUser, setSelectedScimUser] = useState(null);
  const [assignForm, setAssignForm] = useState({ userId: '', userName: '' });
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Reset state when dialog is closed or role changes
  useEffect(() => {
    if (!open) {
      setSelectedScimUser(null);
      setAssignForm({ userId: '', userName: '' });
      setSelectedRoleIds(role ? [role.ID] : []);
      setLoading(false);
    }
  }, [open, role]);

  const handleSubmit = async () => {
    if (!assignForm.userId.trim()) return;

    setLoading(true);
    try {
      if (role) {
        // Single role assignment flow
        await api.createAssignment({
          userId: assignForm.userId.trim(),
          userName: assignForm.userName.trim() || assignForm.userId.trim(),
          role_ID: role.ID
        });
        if (onSuccess) {
          onSuccess(`Successfully assigned role "${role.name}" to ${assignForm.userId}`);
        }
      } else {
        // Multiple roles assignment flow
        const selectedRoles = roles.filter(r => selectedRoleIds.includes(r.ID));
        if (selectedRoles.length === 0) return;

        await Promise.all(selectedRoles.map(r =>
          api.createAssignment({
            userId: assignForm.userId.trim(),
            userName: assignForm.userName.trim() || assignForm.userId.trim(),
            role_ID: r.ID
          })
        ));

        if (onSuccess) {
          const names = selectedRoles.map(r => r.name).join(', ');
          onSuccess(`Successfully assigned roles [${names}] to ${assignForm.userId}`);
        }
      }
    } catch (e) {
      if (onError) {
        onError(e.message || 'Failed to assign roles');
      }
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled = !assignForm.userId.trim() || (role ? false : selectedRoleIds.length === 0) || loading;

  return (
    <Dialog open={open} onClose={() => { if (!loading) onClose(); }} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Assign User to Role</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>
        {role ? (
          <>
            <Typography variant="body2" color="text.secondary">
              Assign role <strong>{role.name}</strong> to a user or group.
            </Typography>
            <UserSelection
              value={selectedScimUser}
              onChange={(e, v) => {
                setSelectedScimUser(v);
                if (v) {
                  setAssignForm({
                    userId: v.username,
                    userName: v.displayName || v.username
                  });
                } else {
                  setAssignForm({ userId: '', userName: '' });
                }
              }}
              disabled={loading}
            />
          </>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Box sx={{ flex: 1.5, width: '100%' }}>
              <UserSelection
                value={selectedScimUser}
                onChange={(e, v) => {
                  setSelectedScimUser(v);
                  if (v) {
                    setAssignForm({
                      userId: v.username,
                      userName: v.displayName || v.username
                    });
                  } else {
                    setAssignForm({ userId: '', userName: '' });
                  }
                }}
                disabled={loading}
              />
            </Box>
            <SearchableSelect
              options={roles.map(r => {
                const allowed = hasAnyRestrictions(r, allRoles);
                const typeStr = r.type === 'ORG_BASED' ? 'Org' : (r.parentRoles && r.parentRoles.length > 0 ? 'Derived' : 'Single');
                return {
                  value: r.ID,
                  label: r.name,
                  sublabel: `${typeStr}${!allowed ? ' - No Restrictions' : ''}`,
                  disabled: !allowed
                };
              })}
              value={selectedRoleIds}
              onChange={vals => setSelectedRoleIds(vals)}
              label="Role"
              multiple
              disabled={loading}
              getOptionDisabled={(option) => !!option.disabled}
              sx={{ flex: 1 }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isSubmitDisabled}
        >
          {loading ? 'Assigning...' : 'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
