import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Typography,
  Box,
  Card,
  Chip
} from '@mui/material';
import { AlertTriangle, GitBranch, Users } from 'lucide-react';

export function parseUserDetails(user: any): { firstName: string; lastName: string; email: string } {
  if (!user) return { firstName: '-', lastName: '-', email: '-' };

  let firstName = user.firstName || '';
  let lastName = user.lastName || '';
  let email = user.email || '';

  const rawUserId = String(user.userId || '').trim();
  const rawUserName = String(user.userName || '').trim();

  // 1. Resolve email
  if (!email) {
    if (rawUserId.includes('@')) {
      email = rawUserId;
    } else if (rawUserName.includes('@')) {
      email = rawUserName;
    }
  }

  // 2. Resolve firstName and lastName
  if (!firstName || !lastName) {
    let nameCandidate = rawUserName;
    // If rawUserName is an email or empty, derive from email or rawUserId
    if (!nameCandidate || nameCandidate.includes('@')) {
      if (email && email.includes('@')) {
        const localPart = email.split('@')[0];
        nameCandidate = localPart
          .split(/[._-]/)
          .filter(Boolean)
          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');
      } else {
        nameCandidate = rawUserId;
      }
    }

    if (nameCandidate) {
      if (nameCandidate.includes(',')) {
        // "Nachname, Vorname"
        const parts = nameCandidate.split(',').map(s => s.trim()).filter(Boolean);
        lastName = lastName || parts[0] || '';
        firstName = firstName || parts.slice(1).join(' ') || '';
      } else {
        // "Vorname Nachname"
        const parts = nameCandidate.split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
          firstName = firstName || parts[0];
          lastName = lastName || parts.slice(1).join(' ');
        } else if (parts.length === 1) {
          firstName = firstName || parts[0];
          lastName = lastName || '-';
        }
      }
    }
  }

  return {
    firstName: firstName || '-',
    lastName: lastName || '-',
    email: email || rawUserId || '-'
  };
}

export default function ImpactDialog({ open, roleName, impactData, onClose, onConfirm }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          p: 1,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <AlertTriangle color="#d97706" size={24} />
        <Typography component="span" variant="h6" sx={{ fontWeight: 700 }}>
          Confirm Changes & Analyze Impact
        </Typography>
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 3 }}>
          Saving changes to role <strong>{roleName}</strong> will affect the following derived roles and assigned users. Please review before proceeding.
        </DialogContentText>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, mt: 1 }}>
          {/* Derived Roles Panel */}
          <Card variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <GitBranch size={18} color="#2563eb" />
                Derived Roles
              </Typography>
              <Chip
                label={impactData.derivedRoles.length}
                size="small"
                color="info"
                sx={{ fontWeight: 600 }}
              />
            </Box>
            {impactData.derivedRoles.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
                No derived roles will be affected.
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {impactData.derivedRoles.map(r => (
                  <Card key={r.ID} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.description || 'No description'}</Typography>
                  </Card>
                ))}
              </Box>
            )}
          </Card>

          {/* Affected Users Panel */}
          <Card variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Users size={18} color="#047857" />
                Affected Users
              </Typography>
              <Chip
                label={impactData.affectedUsers.length}
                size="small"
                color="success"
                sx={{ fontWeight: 600 }}
              />
            </Box>
            {impactData.affectedUsers.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 1 }}>
                No assigned users will be affected.
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {impactData.affectedUsers.map((u, idx) => {
                  const userDetails = parseUserDetails(u);
                  return (
                    <Card
                      key={u.userId || idx}
                      sx={{
                        p: 1.5,
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: 'none',
                        bgcolor: 'background.paper',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.25
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        <span>{userDetails.firstName}</span> <span>{userDetails.lastName}</span>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {userDetails.email}
                      </Typography>
                    </Card>
                  );
                })}
              </Box>
            )}
          </Card>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, pt: 1, gap: 1 }}>
        <Button
          onClick={onClose}
          variant="outlined"
          color="inherit"
          sx={{ px: 3 }}
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color="primary"
          sx={{ px: 4 }}
        >
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}
