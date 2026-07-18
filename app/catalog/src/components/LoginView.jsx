import React, { useState } from 'react';
import { Box, Card, Typography, TextField, Button, FormControl, InputLabel, Select, MenuItem, IconButton, InputAdornment, Alert } from '@mui/material';
import { Eye, EyeOff, Lock, User, Shield, LogIn } from 'lucide-react';
import * as api from '../api';

export default function LoginView({ onLoginSuccess }) {
  const [customUser, setCustomUser] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const username = customUser.trim();
    
    if (!username) {
      setError('Please enter a username or email.');
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
        background: 'var(--bg-base)',
        position: 'relative',
        overflow: 'hidden',
        px: 2
      }}
    >
      <Card
        component="form"
        onSubmit={handleSubmit}
        sx={{
          width: '100%',
          maxWidth: 440,
          p: 4,
          borderRadius: 'var(--radius-xl)',
          zIndex: 2,
          boxShadow: 'var(--shadow-glow)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
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
              borderRadius: 'var(--radius-lg)',
              background: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-glow)'
            }}
          >
            <Shield size={24} color="#ffffff" />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '0.02em', color: 'var(--text-primary)', mt: 1 }}>
            cortex
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ bgcolor: 'rgba(186, 26, 26, 0.05)', border: '1px solid rgba(186, 26, 26, 0.2)', color: 'var(--accent-danger)' }}>
            {error}
          </Alert>
        )}

        <TextField
          label="User"
          fullWidth
          value={customUser}
          onChange={(e) => setCustomUser(e.target.value)}
          placeholder="e.g. jdoe@company.com"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start" sx={{ color: 'var(--text-muted)' }}>
                <User size={18} />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiInputBase-input': { color: 'var(--text-primary)' },
            '& .MuiInputLabel-root': { color: 'var(--text-secondary)' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-active)' },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent-primary)' }
          }}
        />

        <TextField
          label="Password"
          type={showPassword ? 'text' : 'password'}
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start" sx={{ color: 'var(--text-muted)' }}>
                <Lock size={18} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" sx={{ color: 'var(--text-muted)' }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiInputBase-input': { color: 'var(--text-primary)' },
            '& .MuiInputLabel-root': { color: 'var(--text-secondary)' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-active)' },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent-primary)' }
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
            borderRadius: 'var(--radius-lg)',
            textTransform: 'none',
            fontSize: '0.95rem',
            background: 'var(--accent-primary)',
            color: '#ffffff',
            boxShadow: 'var(--shadow-glow)',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              background: 'var(--accent-bright)',
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
