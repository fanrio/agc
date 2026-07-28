import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  TextField,
  Avatar,
  Chip,
  InputAdornment,
  CircularProgress
} from '@mui/material';
import { Search, Shield, UserCheck, ChevronRight, Users as UsersIcon } from 'lucide-react';
import { getRoleAssignments } from '../api';

export default function UsersView({ onInspectUser }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getRoleAssignments()
      .then(res => {
        if (!isMounted) return;
        const list = Array.isArray(res) ? res : res?.value || [];
        
        // Aggregate users by userId
        const userMap = new Map();
        list.forEach(a => {
          const uid = a.userId;
          if (!uid) return;
          if (!userMap.has(uid)) {
            userMap.set(uid, {
              userId: uid,
              userName: a.userName || uid,
              roleCount: 0,
              roles: []
            });
          }
          const userObj = userMap.get(uid);
          userObj.roleCount += 1;
          if (a.role_ID) userObj.roles.push(a.role_ID);
        });

        setUsers(Array.from(userMap.values()));
      })
      .catch(err => {
        console.error('Failed to load users for directory:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const filteredUsers = users.filter(u => {
    const q = search.toLowerCase();
    return u.userName.toLowerCase().includes(q) || u.userId.toLowerCase().includes(q);
  });

  return (
    <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <UsersIcon color="#3b82f6" size={28} /> User Directory & Access Profiles
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Inspect effective authorization profiles, assigned roles, and domain restrictions for system users.
          </Typography>
        </Box>

        <TextField
          placeholder="Search user by name or email..."
          size="small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ width: 320 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} />
              </InputAdornment>
            )
          }}
        />
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress color="primary" />
        </Box>
      ) : filteredUsers.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center', borderRadius: 2 }}>
          <Typography variant="body1" color="text.secondary">
            No users found matching "{search}".
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {filteredUsers.map((user, idx) => (
            <Grid item xs={12} sm={6} md={4} key={idx}>
              <Card 
                variant="outlined" 
                sx={{ 
                  borderRadius: 2, 
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    borderColor: 'primary.main',
                    boxShadow: '0 6px 20px rgba(59, 130, 246, 0.12)',
                    transform: 'translateY(-2px)'
                  }
                }}
              >
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Avatar 
                      sx={{ 
                        width: 48, 
                        height: 48, 
                        bgcolor: 'primary.main', 
                        fontWeight: 700, 
                        color: 'primary.contrastText' 
                      }}
                    >
                      {getInitials(user.userName)}
                    </Avatar>
                    <Box sx={{ overflow: 'hidden' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {user.userName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {user.userId}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip 
                      icon={<Shield size={14} />} 
                      label={`${user.roleCount} Roles Assigned`} 
                      size="small"
                      color="primary"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                    <Chip 
                      icon={<UserCheck size={14} />} 
                      label="Active" 
                      size="small"
                      color="success"
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                </CardContent>

                <CardActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 2.5, py: 1.5, bgcolor: 'action.hover' }}>
                  <Button 
                    size="small" 
                    variant="contained" 
                    color="primary" 
                    fullWidth
                    endIcon={<ChevronRight size={16} />}
                    onClick={() => onInspectUser && onInspectUser(user.userId)}
                  >
                    View Authorization Card
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
