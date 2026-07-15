import { useState, useEffect } from 'react';
import { Box, Card, Typography, FormControl, InputLabel, Select, MenuItem, TextField, Button, CircularProgress, Alert, Grid, Paper, Tooltip, IconButton } from '@mui/material';
import { Play, Copy, Check, Terminal, Server, ShieldCheck } from 'lucide-react';
import * as api from '../api';

export default function BdcApiTesterView() {
  const [connections, setConnections] = useState([]);
  const [loadingConns, setLoadingConns] = useState(true);
  
  // Selection states
  const [selectedConnId, setSelectedConnId] = useState('');
  const [selectedApi, setSelectedApi] = useState('SPACES'); // SPACES | ASSETS | VALUES | COLUMNS
  const [spaceInput, setSpaceInput] = useState('');
  const [assetInput, setAssetInput] = useState('');
  const [taskChainInput, setTaskChainInput] = useState('');
  const [logIdInput, setLogIdInput] = useState('');

  // Execution states
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getBdcSettings()
      .then(conns => {
        setConnections(conns);
        if (conns.length > 0) {
          setSelectedConnId(conns[0].ID);
        }
      })
      .catch(err => {
        console.error(err);
        setError(`Failed to load BDC Connections: ${err.message}`);
      })
      .finally(() => {
        setLoadingConns(false);
      });
  }, []);

  // Set default space and API endpoint selection when connection changes
  useEffect(() => {
    const conn = connections.find(c => c.ID === selectedConnId);
    if (conn) {
      if (conn.space) {
        setSpaceInput(conn.space);
      }
      if (conn.taskChainFlat) {
        setTaskChainInput(conn.taskChainFlat);
      } else {
        setTaskChainInput('');
      }
      if (conn.connectionType === 'SAP Hana') {
        setSelectedApi('HANA_VIEWS');
      } else {
        setSelectedApi('SPACES');
      }
    }
  }, [selectedConnId, connections]);

  const handleCopy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExecute = async () => {
    setError('');
    setOutput('');
    const conn = connections.find(c => c.ID === selectedConnId);
    if (!conn) {
      setError('Please select a valid BDC System Connection.');
      return;
    }

    setExecuting(true);
    try {
      let result = '';
      if (selectedApi === 'HANA_VIEWS') {
        result = await api.fetchRawHanaViews(conn.ID);
      } else if (selectedApi === 'SPACES') {
        result = await api.fetchRawBdcSpaces(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret);
      } else if (selectedApi === 'ASSETS') {
        result = await api.fetchRawBdcAssets(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret);
      } else if (selectedApi === 'USERS') {
        result = await api.fetchRawBdcUsers(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret);
      } else if (selectedApi === 'VALUES') {
        if (!spaceInput.trim() || !assetInput.trim()) {
          throw new Error('Space and Asset fields are required for Relational Values API.');
        }
        result = await api.fetchRawBdcRelationalValues(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, spaceInput, assetInput);
      } else if (selectedApi === 'COLUMNS') {
        if (!spaceInput.trim() || !assetInput.trim()) {
          throw new Error('Space and Asset fields are required for Metadata Columns API.');
        }
        result = await api.fetchRawBdcAssetColumns(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, spaceInput, assetInput);
      } else if (selectedApi === 'RUN_TASK_CHAIN') {
        if (!spaceInput.trim() || !taskChainInput.trim()) {
          throw new Error('Space and Task Chain ID fields are required to execute a run.');
        }
        result = await api.runBdcTaskChain(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, spaceInput, taskChainInput);
      } else if (selectedApi === 'FETCH_TASK_CHAIN_LOG') {
        if (!spaceInput.trim() || !logIdInput.trim()) {
          throw new Error('Space and Log ID fields are required to fetch task chain logs.');
        }
        result = await api.fetchBdcTaskChainLog(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, spaceInput, logIdInput);
      } else if (selectedApi === 'ASSOCIATIONS') {
        if (!spaceInput.trim() || !assetInput.trim()) {
          throw new Error('Space and Asset fields are required to list associations.');
        }
        result = await api.fetchBdcAssociations(conn.url, conn.tokenUrl, conn.clientId, conn.clientSecret, spaceInput, assetInput);
      }

      setOutput(result);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Execution failed');
      setOutput(JSON.stringify({
        error: true,
        message: e.message || 'Execution failed',
        stack: e.stack || ''
      }, null, 2));
    }
    setExecuting(false);
  };

  const selectedConn = connections.find(c => c.ID === selectedConnId);
  const isHana = selectedConn && selectedConn.connectionType === 'SAP Hana';
  const showSpaceAssetFields = selectedApi === 'VALUES' || selectedApi === 'COLUMNS' || selectedApi === 'ASSOCIATIONS';
  const showTaskChainFields = selectedApi === 'RUN_TASK_CHAIN';
  const showLogFields = selectedApi === 'FETCH_TASK_CHAIN_LOG';

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Terminal size={14} color="#3b82f6" />
          Test SAP Datasphere APIs and view raw payloads without any filtering or transformations.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, border: '1px solid rgba(239, 68, 68, 0.2)', bgcolor: 'rgba(239, 68, 68, 0.05)' }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* API Selection Panel */}
        <Grid item xs={12} md={4}>
          <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <Server size={15} color="#a78bfa" />
              API Test Suite Settings
            </Typography>

            {loadingConns ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : (
              <FormControl size="small" fullWidth>
                <InputLabel id="tester-conn-label">Target BDC Connection</InputLabel>
                <Select
                  labelId="tester-conn-label"
                  label="Target BDC Connection"
                  value={selectedConnId}
                  onChange={e => setSelectedConnId(e.target.value)}
                >
                  {connections.map(c => (
                    <MenuItem key={c.ID} value={c.ID}>
                      {c.systemName}
                    </MenuItem>
                  ))}
                  {connections.length === 0 && (
                    <MenuItem value="" disabled>No connections configured</MenuItem>
                  )}
                </Select>
              </FormControl>
            )}

            <FormControl size="small" fullWidth>
              <InputLabel id="tester-api-label">Select API Endpoint</InputLabel>
              <Select
                labelId="tester-api-label"
                label="Select API Endpoint"
                value={selectedApi}
                onChange={e => setSelectedApi(e.target.value)}
                data-testid="api-endpoint-select"
              >
                {isHana ? (
                  <MenuItem value="HANA_VIEWS">fetchRawHanaViews (List Database Views)</MenuItem>
                ) : (
                  [
                    <MenuItem key="SPACES" value="SPACES">fetchRawBdcSpaces (Spaces Catalog)</MenuItem>,
                    <MenuItem key="ASSETS" value="ASSETS">fetchRawBdcAssets (Assets Catalog)</MenuItem>,
                    <MenuItem key="USERS" value="USERS">fetchRawBdcUsers (SCIM 2.0 User List)</MenuItem>,
                    <MenuItem key="VALUES" value="VALUES">fetchRawBdcRelationalValues (Relational Data)</MenuItem>,
                    <MenuItem key="COLUMNS" value="COLUMNS">fetchRawBdcAssetColumns ($metadata XML Schema)</MenuItem>,
                    <MenuItem key="RUN_TASK_CHAIN" value="RUN_TASK_CHAIN">runBdcTaskChain (Start Task Chain Run)</MenuItem>,
                    <MenuItem key="FETCH_TASK_CHAIN_LOG" value="FETCH_TASK_CHAIN_LOG">fetchBdcTaskChainLog (Fetch Task Chain Log)</MenuItem>,
                    <MenuItem key="ASSOCIATIONS" value="ASSOCIATIONS">fetchBdcAssociations (List View Associations)</MenuItem>
                  ]
                )}
              </Select>
            </FormControl>

            {showSpaceAssetFields && (
              <>
                <TextField
                  label="Space ID"
                  size="small"
                  fullWidth
                  placeholder="e.g. HH_SAP"
                  value={spaceInput}
                  onChange={e => setSpaceInput(e.target.value)}
                  data-testid="space-input"
                />
                <TextField
                  label="Asset ID (View/Table)"
                  size="small"
                  fullWidth
                  placeholder="e.g. VDIM_Place"
                  value={assetInput}
                  onChange={e => setAssetInput(e.target.value)}
                  data-testid="asset-input"
                />
              </>
            )}

            {showTaskChainFields && (
              <>
                <TextField
                  label="Space ID"
                  size="small"
                  fullWidth
                  placeholder="e.g. HH_SAP"
                  value={spaceInput}
                  onChange={e => setSpaceInput(e.target.value)}
                />
                <TextField
                  label="Task Chain ID"
                  size="small"
                  fullWidth
                  placeholder="e.g. df_authorization_flat"
                  value={taskChainInput}
                  onChange={e => setTaskChainInput(e.target.value)}
                />
              </>
            )}

            {showLogFields && (
              <>
                <TextField
                  label="Space ID"
                  size="small"
                  fullWidth
                  placeholder="e.g. HH_SAP"
                  value={spaceInput}
                  onChange={e => setSpaceInput(e.target.value)}
                  data-testid="space-input"
                />
                <TextField
                  label="Log ID"
                  size="small"
                  fullWidth
                  placeholder="e.g. log-12345"
                  value={logIdInput}
                  onChange={e => setLogIdInput(e.target.value)}
                  data-testid="log-id-input"
                />
              </>
            )}

            <Button
              variant="contained"
              onClick={handleExecute}
              disabled={executing || loadingConns || connections.length === 0}
              startIcon={executing ? <CircularProgress size={14} color="inherit" /> : <Play size={14} />}
              fullWidth
              sx={{ mt: 1 }}
            >
              {executing ? 'Requesting...' : 'Execute API Request'}
            </Button>
          </Card>
        </Grid>

        {/* Live Payload Output Panel */}
        <Grid item xs={12} md={8}>
          <Card sx={{ p: 3, minHeight: 400, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ShieldCheck size={15} color="#10b981" />
                Raw Datasphere Response Payload
              </Typography>
              {output && (
                <Tooltip title={copied ? "Copied!" : "Copy Raw Payload"}>
                  <IconButton size="small" onClick={handleCopy} color={copied ? "success" : "inherit"}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            <Paper
              sx={{
                flexGrow: 1,
                bgcolor: '#060913',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 2,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 500
              }}
            >
              {executing ? (
                <Box sx={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1.5, opacity: 0.7 }}>
                  <CircularProgress size={30} />
                  <Typography variant="caption" color="text.secondary">Fetching live payload from Datasphere Cloud Gateway...</Typography>
                </Box>
              ) : output ? (
                <pre style={{ margin: 0, fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {output}
                </pre>
              ) : (
                <Box sx={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', opacity: 0.4, py: 4 }}>
                  <Terminal size={35} />
                  <Typography variant="caption" sx={{ mt: 1 }}>Execute an API request to view raw response payload.</Typography>
                </Box>
              )}
            </Paper>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
