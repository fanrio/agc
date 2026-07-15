import React, { useState } from 'react';
import { Box, Card, Typography, TextField, Button, FormControl, InputLabel, Select, MenuItem, IconButton, InputAdornment, Alert } from '@mui/material';
import { Eye, EyeOff, Lock, User, Network, LogIn } from 'lucide-react';
import * as api from '../api';

const PRESET_USERS = [
  { id: 'tim.waecken@cimt-ag.de', name: 'Tim Wäcken', email: 'tim.waecken@cimt-ag.de' },
  { id: 'asmith', name: 'Alice Smith', email: 'asmith' },
  { id: 'bobm', name: 'Bob Martin', email: 'bobm' },
  { id: 'cwhite', name: 'Charlie White', email: 'cwhite' },
  { id: 'admin', name: 'System Admin', email: 'admin' },
];

export default function LoginView({ onLoginSuccess }) {
  const [userType, setUserType] = useState('preset'); // preset | custom
  const [selectedUser, setSelectedUser] = useState('tim.waecken@cimt-ag.de');
  const [customUser, setCustomUser] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const username = userType === 'preset' ? selectedUser : customUser.trim();
    
    if (!username) {
      setError('Please select or enter a username/email.');
      return;
    }

    setLoading(true);
    try {
      // Set the simulated user and fetch credentials
      api.setSimulatedUser(username);
      const perms = await api.getCurrentUserPermissions();
      
      // Store in localStorage for session persistence
      localStorage.setItem('auth_user', username);
      
      // Notify parent
      onLoginSuccess(username);
    } catch (err) {
      setError(err.message || 'Login failed. Please verify connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)',
        position: 'relative',
        overflow: 'hidden',
        px: 2,
        '&::before': {
          content: '""',
          position: 'absolute',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, rgba(0,0,0,0) 70%)',
          top: '-10%',
          left: '-10%',
          zIndex: 1,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168,85,247,0.1) 0%, rgba(0,0,0,0) 70%)',
          bottom: '-10%',
          right: '-10%',
          zIndex: 1,
        }
      }}
    >
      <Card
        component="form"
        onSubmit={handleSubmit}
        sx={{
          width: '100%',
          maxWidth: 440,
          p: 4,
          borderRadius: 4,
          zIndex: 2,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          background: 'rgba(255, 255, 255, 0.03)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        {/* Brand Header */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(99, 102, 241, 0.3)'
            }}
          >
            <Network size={24} color="#ffffff" />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '0.02em', color: '#f8fafc', mt: 1 }}>
            cortex <Box component="span" sx={{ fontWeight: 300, color: '#94a3b8' }}>/ BDC Auth</Box>
          </Typography>
          <Typography variant="body2" sx={{ color: '#94a3b8', textAlign: 'center' }}>
            Authorization Wizard & Replication Manager
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ bgcolor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}>
            {error}
          </Alert>
        )}

        {/* User Type Switcher */}
        <Box sx={{ display: 'flex', gap: 1, p: 0.5, bgcolor: 'rgba(255, 255, 255, 0.03)', borderRadius: 2, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <Button
            size="small"
            onClick={() => setUserType('preset')}
            sx={{
              flex: 1,
              borderRadius: 1.5,
              textTransform: 'none',
              fontWeight: 600,
              color: userType === 'preset' ? '#ffffff' : '#94a3b8',
              bgcolor: userType === 'preset' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              '&:hover': { bgcolor: userType === 'preset' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.02)' }
            }}
          >
            Preset Users
          </Button>
          <Button
            size="small"
            onClick={() => setUserType('custom')}
            sx={{
              flex: 1,
              borderRadius: 1.5,
              textTransform: 'none',
              fontWeight: 600,
              color: userType === 'custom' ? '#ffffff' : '#94a3b8',
              bgcolor: userType === 'custom' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              '&:hover': { bgcolor: userType === 'custom' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.02)' }
            }}
          >
            Custom ID
          </Button>
        </Box>

        {userType === 'preset' ? (
          <FormControl fullWidth>
            <InputLabel id="preset-user-label" sx={{ color: '#94a3b8', '&.Mui-focused': { color: '#6366f1' } }}>Select Identity</InputLabel>
            <Select
              labelId="preset-user-label"
              id="preset-user"
              value={selectedUser}
              label="Select Identity"
              onChange={(e) => setSelectedUser(e.target.value)}
              sx={{
                color: '#f8fafc',
                bgcolor: 'rgba(255, 255, 255, 0.02)',
                '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.1)' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.2)' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#6366f1' }
              }}
            >
              {PRESET_USERS.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <TextField
            label="User ID or Email"
            fullWidth
            value={customUser}
            onChange={(e) => setCustomUser(e.target.value)}
            placeholder="e.g. jdoe@company.com"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ color: '#94a3b8' }}>
                  <User size={18} />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiInputBase-input': { color: '#f8fafc' },
              '& .MuiInputLabel-root': { color: '#94a3b8' },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.1)' },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.2)' },
              '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#6366f1' }
            }}
          />
        )}

        <TextField
          label="Password"
          type={showPassword ? 'text' : 'password'}
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start" sx={{ color: '#94a3b8' }}>
                <Lock size={18} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" sx={{ color: '#94a3b8' }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiInputBase-input': { color: '#f8fafc' },
            '& .MuiInputLabel-root': { color: '#94a3b8' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.1)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.2)' },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#6366f1' }
          }}
        />

        <Button
          type="submit"
          variant="contained"
          disabled={loading}
          fullWidth
          startIcon={<LogIn size={18} />}
          sx={{
            py: 1.5,
            fontWeight: 700,
            borderRadius: 2.5,
            textTransform: 'none',
            fontSize: '0.95rem',
            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
            boxShadow: '0 8px 20px rgba(99, 102, 241, 0.2)',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              background: 'linear-gradient(135deg, #4f46e5 0%, #9333ea 100%)',
              boxShadow: '0 8px 24px rgba(99, 102, 241, 0.35)',
              transform: 'translateY(-1px)'
            }
          }}
        >
          {loading ? 'Logging in...' : 'Sign In'}
        </Button>
      </Card>
    </Box>
  );
}
