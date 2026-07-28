import React from 'react';
import { Card, Typography, Box, IconButton, Tooltip } from '@mui/material';
import { Shield, X } from 'lucide-react';
import UserSelection from '../../UserSelection';

export default function StepApprovers({
  approvers, setApprovers,
  approverInput, setApproverInput,
  scimOptions, scimLoading, isReadOnly
}) {
  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Approvers List</Typography>
      {!isReadOnly && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, maxWidth: 600 }}>
          <UserSelection
            value={null}
            onChange={(event, newValue) => {
              if (newValue && !approvers.find(a => a.userId === newValue.username)) {
                setApprovers(prev => [
                  ...prev,
                  {
                    userId: newValue.username,
                    userName: newValue.displayName,
                    ID: `temp-${Date.now()}`
                  }
                ]);
              }
            }}
            label="Search Approver (SCIM)"
            placeholder="Type name, department, or email..."
          />
        </Box>
      )}

      {approvers.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 500 }}>
          {approvers.map(a => (
            <Card key={a.ID} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, background: 'transparent', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'text.secondary' } }}>
              <Shield size={14} color="#7c3aed" />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.userName}</Typography>
              {!isReadOnly && (
                <Tooltip title="Remove approver">
                  <IconButton size="small" color="error" onClick={() => setApprovers(as => as.filter(x => x.ID !== a.ID))} sx={{ ml: 'auto' }} aria-label="Remove approver">
                    <X size={14} />
                  </IconButton>
                </Tooltip>
              )}
            </Card>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">No approvers assigned yet.</Typography>
      )}
    </Card>
  );
}
