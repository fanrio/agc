import React from 'react';
import { Card, Typography, Box, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import { Shield, ChevronRight, Sparkles } from 'lucide-react';

/**
 * RecentlyCreatedRoles subcomponent for Governance Center Homepage.
 * Lists the most recently deployed authorization roles in a premium list format.
 */
export default function RecentlyCreatedRoles({ stats, setActiveNav }) {
  if (!stats) return null;

  return (
    <Card
      sx={{
        p: 3,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ 
          p: 1, 
          borderRadius: 2, 
          bgcolor: 'rgba(0, 0, 53, 0.06)', 
          border: '1px solid rgba(0, 0, 53, 0.15)' 
        }}>
          <Sparkles size={18} color="#000035" />
        </Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Recently Deployed Roles</Typography>
          <Typography variant="caption" color="text.secondary">Latest role releases and updates</Typography>
        </Box>
      </Box>

      {stats.recentRoles && stats.recentRoles.length > 0 ? (
        <List sx={{ p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {stats.recentRoles.map(role => {
            const isOrg = role.type === 'ORG_BASED';
            const isDerived = role.parentRoles && role.parentRoles.length > 0;
            const shieldColor = isOrg ? '#2563eb' : isDerived ? '#515f74' : '#047857';

            return (
              <ListItem
                key={role.ID}
                onClick={() => setActiveNav('roles')}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: 'action.hover',
                    transform: 'translateX(4px)'
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Shield size={16} color={shieldColor} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography sx={{ fontWeight: 800, fontSize: 13, color: 'text.primary' }}>
                      {role.name}
                    </Typography>
                  }
                  secondary={
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {role.description || 'No description provided'}
                    </Typography>
                  }
                />
                <ChevronRight size={15} color="#515f74" />
              </ListItem>
            );
          })}
        </List>
      ) : (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No roles created yet. Use the wizard to deploy roles.
          </Typography>
        </Box>
      )}
    </Card>
  );
}
