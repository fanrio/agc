import React from 'react';
import { Drawer, Box } from '@mui/material';
import UserAuthorizationCard from './UserAuthorizationCard';

export default function UserAuthorizationCardDrawer({ userId, onClose }) {
  const open = Boolean(userId);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 2
      }}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 640, md: 800 },
          maxWidth: '100vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
        }
      }}
    >
      {userId && (
        <UserAuthorizationCard userId={userId} onClose={onClose} />
      )}
    </Drawer>
  );
}
