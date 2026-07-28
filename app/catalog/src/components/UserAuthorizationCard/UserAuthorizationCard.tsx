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
import { getUserEffectiveAuthorizations, getAccessDomainsFlat, simulateAccess } from '../../api';
import EffectiveRestrictions from '../EffectiveRestrictions';

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
  const [accessDomainsMap, setAccessDomainsMap] = useState(new Map());

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

    Promise.all([
      getUserEffectiveAuthorizations(userId),
      getAccessDomainsFlat().catch(() => [])
    ])
      .then(([raw, domainsList]) => {
        if (!isMounted) return;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          setAuthData(parsed);
        } catch (e) {
          setAuthData(raw);
        }
        if (Array.isArray(domainsList)) {
          console.log(domainsList);
          const map = new Map();
          domainsList.forEach(ad => {
            if (ad.ID) {
              map.set(ad.ID, ad.name);
            }
          });
          setAccessDomainsMap(map);
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

  const getDomainDisplayName = (dom) => {
    console.log(dom);
    if (!dom) return '';
    if (dom.domainId === 'DEFAULT' || dom.domainName === 'Global / Default Domain') {
      return 'Global / Default Domain';
    }

    const mappedName = accessDomainsMap.get(dom.domainId) || accessDomainsMap.get(dom.domainName);
    if (mappedName) return mappedName;
    if (dom.domainName && dom.domainName !== dom.domainId) return dom.domainName;
    return dom.domainName || dom.domainId;
  };

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
  const currentDomain = domains[activeTab] || domains[0];

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
              label={`${getDomainDisplayName(dom)} (${dom.assignedRoles.length})`}
              sx={{ fontWeight: 600, textTransform: 'none', minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Box>

      {/* Tab Panel Content */}
      <Box sx={{ p: 3, flexGrow: 1, overflowY: 'auto' }}>
        {currentDomain && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Granted Roles Section */}
            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Layers size={16} /> Granted Roles in {getDomainDisplayName(currentDomain)} ({currentDomain.assignedRoles.length})
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

            {/* Resolved Effective Restrictions */}
            <EffectiveRestrictions
              effectiveRestrictions={currentDomain.effectiveRestrictions}
              showCard={false}
              defaultView="list"
              emptyMessage="No restrictions configured for this domain (Full Unrestricted Access Granted)."
              restrictions={undefined}
              inherited={undefined}
              title={undefined} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
