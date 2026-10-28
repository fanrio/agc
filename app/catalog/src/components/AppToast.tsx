import React from 'react';
import { Snackbar, Alert, AlertColor } from '@mui/material';

export interface AppToastProps {
  open: boolean;
  message: string;
  severity?: AlertColor;
  autoHideDuration?: number;
  onClose: (event?: React.SyntheticEvent | Event, reason?: string) => void;
}

export default function AppToast({
  open,
  message,
  severity = 'info',
  autoHideDuration = 4500,
  onClose
}: AppToastProps) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <Alert
        onClose={onClose}
        severity={severity}
        variant="filled"
        sx={{ width: '100%', boxShadow: '0 8px 24px rgba(0, 0, 53, 0.16)' }}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}
