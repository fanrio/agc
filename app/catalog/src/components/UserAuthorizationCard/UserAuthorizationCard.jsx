import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  CircularProgress,
  Button,
  TextField,
  Alert,
  Divider,
  IconButton
} from '@mui/material';
import { 
  ShieldCheck, 
  Layers, 
  CheckCircle2, 
  XCircle, 
  Play, 
  UserCheck, 
  Globe, 
  Building2, 
  X 
} from 'lucide-react';
import { getUserEffectiveAuthorizations, simulateAccess } from '../../api';

function formatVal(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export default function UserAuthorizationCard({ userId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [authData, setAuthData] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(0);

  // Simulator state
  const [simField, setSimField] = useState('Plant');
  const [simValue, setSimValue] = useState('1000');
  const [simResult, setSimResult] = useState(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (!userId) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    getUserEffectiveAuthorizations(userId)
      .then(raw => {
        if (!isMounted) return;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          setAuthData(parsed);
        } catch (e) {
          setAuthData(raw);
        }
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.message || 'Failed to load user authorization profile');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [userId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 8, gap: 2 }}>
        <CircularProgress size={40} color="primary" />
        <Typography variant="body2" color="text.secondary">
          Resolving effective authorizations for {userId}...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!authData || !authData.domains || authData.domains.length === 0) {
    return (
      <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="info">
          No active role assignments or effective authorizations found for <strong>{userId}</strong>.
        </Alert>
      </Box>
    );
  }

  const domains = authData.domains || [];
  const isSimulatorTab = activeTab === domains.length;
  const currentDomain = isSimulatorTab ? null : domains[activeTab] || domains[0];

  const handleRunSimulator = async () => {
    if (!simField || !simValue) return;

    setSimulating(true);
    setSimResult(null);

    try {
      // Gather all effective restrictions across all domains
      const allRestrictions = domains.flatMap(d => d.effectiveRestrictions || []);
      const sampleRow = [{ [simField]: simValue }];
      
      const res = await simulateAccess(null, sampleRow, allRestrictions);
      if (Array.isArray(res) && res.length > 0) {
        setSimResult(res[0]);
      } else {
        setSimResult({ passed: true, reason: 'Evaluation completed cleanly' });
      }
    } catch (err) {
      setSimResult({ passed: false, reason: err.message || 'Simulation error' });
    } finally {
      setSimulating(false);
    }
  };

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
      {/* Header Banner */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 3, 
          borderRadius: 0, 
          borderBottom: '1px solid', 
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
          <Avatar 
            sx={{ 
              width: 56, 
              height: 56, 
              bgcolor: 'primary.main', 
              color: 'primary.contrastText',
              fontWeight: 700,
              fontSize: '1.25rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            {getInitials(authData.userName)}
          </Avatar>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
                {authData.userName}
              </Typography>

              <Chip 
                icon={<UserCheck size={14} />} 
                label="Active Access Profile" 
                size="small" 
                color="success" 
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {authData.userId}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
              <Chip 
                icon={<ShieldCheck size={14} />} 
                label={`${authData.totalRolesCount} Roles Assigned`} 
                size="small" 
                sx={{ bgcolor: 'action.hover', fontWeight: 600 }}
              />
              <Chip 
                icon={<Globe size={14} />} 
                label={`${domains.length} Access Domains`} 
                size="small" 
                sx={{ bgcolor: 'action.hover', fontWeight: 600 }}
              />
            </Box>
          </Box>
        </Box>

        {onClose && (
          <IconButton onClick={onClose} size="medium">
            <X size={20} />
          </IconButton>
        )}
      </Paper>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(e, val) => setActiveTab(val)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {domains.map((dom, idx) => (
            <Tab 
              key={idx} 
              label={`${dom.domainName} (${dom.assignedRoles.length})`} 
              sx={{ fontWeight: 600, textTransform: 'none', minHeight: 48 }}
            />
          ))}
          <Tab 
            label="🧪 Live Access Simulator" 
            sx={{ fontWeight: 600, textTransform: 'none', color: 'secondary.main', minHeight: 48 }}
          />
        </Tabs>
      </Box>

      {/* Tab Panel Content */}
      <Box sx={{ p: 3, flexGrow: 1, overflowY: 'auto' }}>
        {!isSimulatorTab && currentDomain && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Granted Roles Section */}
            <Box>
              <Typography 
                variant="subtitle2" 
                sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Layers size={16} /> Granted Roles in {currentDomain.domainName} ({currentDomain.assignedRoles.length})
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'action.hover' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Role Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Environment</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {currentDomain.assignedRoles.map((role, idx) => (
                      <TableRow key={idx} hover>
                        <TableCell sx={{ fontWeight: 700, color: 'primary.main' }}>
                          {role.name}
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={role.type} 
                            size="small" 
                            color={role.type === 'ORG_BASED' ? 'secondary' : role.type === 'DERIVED' ? 'info' : 'default'}
                            variant="outlined"
                            sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip label={role.environment_ID || 'ALL'} size="small" sx={{ fontSize: 10, height: 20 }} />
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {role.description || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            {/* Resolved Effective Restrictions Table */}
            <Box>
              <Typography 
                variant="subtitle2" 
                sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <ShieldCheck size={16} /> Effective Restrictions ({currentDomain.effectiveRestrictions.length})
              </Typography>
              
              {currentDomain.effectiveRestrictions.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', borderRadius: 1.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    No restrictions configured for this domain (Full Unrestricted Access Granted).
                  </Typography>
                </Paper>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: 'action.hover' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Restriction Field</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Filter Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Effective Value</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Source Role</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Origin</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {currentDomain.effectiveRestrictions.map((re, idx) => (
                        <TableRow key={idx} hover>
                          <TableCell sx={{ fontWeight: 700 }}>
                            {re.field}
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={re.filterType || 'SINGLE_VALUE'} 
                              size="small" 
                              variant="outlined" 
                              sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, color: 'text.primary' }}>
                            {formatVal(re.value)}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            {re.sourceRoleName || re.sourceRoleId}
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={re.isOwn ? 'Own' : 'Inherited'} 
                              size="small" 
                              color={re.isOwn ? 'success' : 'info'}
                              sx={{ fontWeight: 600, fontSize: 10, height: 20 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          </Box>
        )}

        {/* Live Simulator Tab Panel */}
        {isSimulatorTab && (
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 1.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                Live Access Simulator
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Evaluate whether <strong>{authData.userName}</strong> holds effective authorization to access specific data parameters across all domains.
              </Typography>
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField 
                label="Field Name" 
                value={simField} 
                onChange={e => setSimField(e.target.value)} 
                size="small" 
                sx={{ width: 220 }}
              />
              <TextField 
                label="Sample Value to Test" 
                value={simValue} 
                onChange={e => setSimValue(e.target.value)} 
                size="small" 
                sx={{ width: 220 }}
              />
              <Button 
                variant="contained" 
                color="primary" 
                startIcon={<Play size={16} />}
                onClick={handleRunSimulator}
                disabled={simulating}
              >
                {simulating ? 'Evaluating...' : 'Test Access'}
              </Button>
            </Box>

            {simResult && (
              <Alert 
                severity={simResult.passed ? 'success' : 'error'} 
                icon={simResult.passed ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                sx={{ mt: 1 }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {simResult.passed ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                </Typography>
                <Typography variant="body2">
                  {simResult.reason}
                </Typography>
              </Alert>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  );
}
