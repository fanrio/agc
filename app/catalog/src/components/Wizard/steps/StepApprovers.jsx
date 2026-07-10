import React from 'react';
import { Card, Typography, Box, Autocomplete, CircularProgress, TextField, IconButton } from '@mui/material';
import { Shield, X } from 'lucide-react';

export default function StepApprovers({
  approvers, setApprovers,
  approverInput, setApproverInput,
  ldapOptions, ldapLoading
}) {
  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Approvers List</Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 3, maxWidth: 600 }}>
        <Autocomplete
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
            setApproverInput('');
          }}
          inputValue={approverInput}
          onInputChange={(event, newInputValue) => {
            setApproverInput(newInputValue);
          }}
          options={ldapOptions}
          loading={ldapLoading}
          getOptionLabel={(option) => `${option.displayName} (${option.username}) - ${option.department}`}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search Approver (LDAP)"
              size="small"
              placeholder="Type name, department, or username..."
              InputProps={{
                ...(params.InputProps || {}),
                endAdornment: (
                  <>
                    {ldapLoading ? <CircularProgress color="inherit" size={20} /> : null}
                    {params.InputProps?.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...optionProps } = props;
            return (
              <li key={key || option.username} {...optionProps}>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.displayName} ({option.username})</Typography>
                  <Typography variant="caption" color="text.secondary">{option.email} | {option.department}</Typography>
                </Box>
              </li>
            );
          }}
          sx={{ flex: 1 }}
        />
      </Box>

      {approvers.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 500 }}>
          {approvers.map(a => (
            <Card key={a.ID} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, background: 'transparent', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'text.secondary' } }}>
              <Shield size={14} color="#7c3aed" />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.userName}</Typography>
              <IconButton size="small" color="error" onClick={() => setApprovers(as => as.filter(x => x.ID !== a.ID))} sx={{ ml: 'auto' }}>
                <X size={14} />
              </IconButton>
            </Card>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">No approvers assigned yet.</Typography>
      )}
    </Card>
  );
}
