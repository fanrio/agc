import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Typography, Box, Card, Chip } from '@mui/material';
import { AlertTriangle, GitBranch, Users } from 'lucide-react';

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
        <AlertTriangle color="#ed6c02" size={24} />
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
                <GitBranch size={18} color="#0288d1" />
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
              <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                <Users size={18} color="#2e7d32" />
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
              <Box sx={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {impactData.affectedUsers.map(u => (
                  <Card key={u.userId} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{u.userName}</Typography>
                      <Chip label={u.userId} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Assigned via: <strong>{u.assignedRole}</strong>
                    </Typography>
                  </Card>
                ))}
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
