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
          bgcolor: 'rgba(167, 139, 250, 0.1)', 
          border: '1px solid rgba(167, 139, 250, 0.2)' 
        }}>
          <Sparkles size={18} color="#a78bfa" />
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
            const shieldColor = isOrg ? '#3b82f6' : isDerived ? '#a78bfa' : '#10b981';

            return (
              <ListItem
                key={role.ID}
                onClick={() => setActiveNav('roles')}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'rgba(255,255,255,0.01)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    borderColor: `${shieldColor}40`,
                    bgcolor: 'rgba(255,255,255,0.02)',
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
                <ChevronRight size={15} color="rgba(255,255,255,0.25)" />
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
