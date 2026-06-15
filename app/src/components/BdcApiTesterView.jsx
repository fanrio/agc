import { useState, useEffect, useRef } from 'react';
import { 
  FlexBox, 
  Card, 
  CardHeader, 
  Title, 
  Label, 
  Select, 
  Option, 
  Input, 
  Button, 
  BusyIndicator, 
  MessageStrip, 
  Icon,
  Toast 
} from '@ui5/webcomponents-react';
import "@ui5/webcomponents-icons/dist/play.js";
import "@ui5/webcomponents-icons/dist/copy.js";
import "@ui5/webcomponents-icons/dist/accept.js";
import "@ui5/webcomponents-icons/dist/database.js";
import "@ui5/webcomponents-icons/dist/shield.js";
import "@ui5/webcomponents-icons/dist/sys-help.js";
import "@ui5/webcomponents-icons/dist/message-information.js";
import "@ui5/webcomponents-icons/dist/action-settings.js";
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

  // Execution states
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');

  const toastRef = useRef(null);

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
    toastRef.current?.show();
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
  const showSpaceAssetFields = selectedApi === 'VALUES' || selectedApi === 'COLUMNS';
  const showTaskChainFields = selectedApi === 'RUN_TASK_CHAIN';

  return (
    <FlexBox direction="Column" style={{ width: '100%', padding: '1rem', boxSizing: 'border-box' }}>
      <Toast ref={toastRef}>Raw Payload Copied to Clipboard!</Toast>
      
      <FlexBox alignItems="Center" style={{ gap: '0.5rem', marginBottom: '1.5rem' }}>
        <Icon name="message-information" style={{ color: '#3b82f6' }} />
        <Label style={{ fontSize: '0.9rem' }}>
          Test SAP Datasphere APIs and view raw payloads without any filtering or transformations.
        </Label>
      </FlexBox>

      {error && (
        <MessageStrip design="Negative" style={{ marginBottom: '1.5rem', width: '100%' }}>
          {error}
        </MessageStrip>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', width: '100%' }}>
        
        {/* API Selection Panel */}
        <Card 
          header={
            <CardHeader 
              titleText="API Test Suite Settings" 
              avatar={<Icon name="database" style={{ color: '#a78bfa' }} />} 
            />
          }
          style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
        >
          <FlexBox direction="Column" style={{ gap: '1.2rem', width: '100%', boxSizing: 'border-box' }}>
            {loadingConns ? (
              <FlexBox style={{ width: '100%', justifyContent: 'center', padding: '1rem 0' }}>
                <BusyIndicator active size="S" />
              </FlexBox>
            ) : (
              <FlexBox direction="Column" style={{ gap: '0.4rem', width: '100%' }}>
                <Label showColon>Target BDC Connection</Label>
                <Select
                  onChange={e => setSelectedConnId(e.detail.selectedOption.value)}
                  style={{ width: '100%' }}
                >
                  {connections.map(c => (
                    <Option key={c.ID} value={c.ID} selected={c.ID === selectedConnId}>
                      {c.systemName}
                    </Option>
                  ))}
                  {connections.length === 0 && (
                    <Option value="" disabled selected>No connections configured</Option>
                  )}
                </Select>
              </FlexBox>
            )}

            <FlexBox direction="Column" style={{ gap: '0.4rem', width: '100%' }}>
              <Label showColon>Select API Endpoint</Label>
              <Select
                onChange={e => setSelectedApi(e.detail.selectedOption.value)}
                style={{ width: '100%' }}
              >
                {isHana ? (
                  <Option value="HANA_VIEWS" selected={selectedApi === 'HANA_VIEWS'}>
                    fetchRawHanaViews (List Database Views)
                  </Option>
                ) : (
                  [
                    <Option key="SPACES" value="SPACES" selected={selectedApi === 'SPACES'}>
                      fetchRawBdcSpaces (Spaces Catalog)
                    </Option>,
                    <Option key="ASSETS" value="ASSETS" selected={selectedApi === 'ASSETS'}>
                      fetchRawBdcAssets (Assets Catalog)
                    </Option>,
                    <Option key="VALUES" value="VALUES" selected={selectedApi === 'VALUES'}>
                      fetchRawBdcRelationalValues (Relational Data)
                    </Option>,
                    <Option key="COLUMNS" value="COLUMNS" selected={selectedApi === 'COLUMNS'}>
                      fetchRawBdcAssetColumns ($metadata XML Schema)
                    </Option>,
                    <Option key="RUN_TASK_CHAIN" value="RUN_TASK_CHAIN" selected={selectedApi === 'RUN_TASK_CHAIN'}>
                      runBdcTaskChain (Start Task Chain Run)
                    </Option>
                  ]
                )}
              </Select>
            </FlexBox>

            {showSpaceAssetFields && (
              <>
                <FlexBox direction="Column" style={{ gap: '0.4rem', width: '100%' }}>
                  <Label showColon>Space ID</Label>
                  <Input
                    placeholder="e.g. HH_SAP"
                    value={spaceInput}
                    onInput={e => setSpaceInput(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </FlexBox>
                <FlexBox direction="Column" style={{ gap: '0.4rem', width: '100%' }}>
                  <Label showColon>Asset ID (View/Table)</Label>
                  <Input
                    placeholder="e.g. VDIM_Place"
                    value={assetInput}
                    onInput={e => setAssetInput(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </FlexBox>
              </>
            )}

            {showTaskChainFields && (
              <>
                <FlexBox direction="Column" style={{ gap: '0.4rem', width: '100%' }}>
                  <Label showColon>Space ID</Label>
                  <Input
                    placeholder="e.g. HH_SAP"
                    value={spaceInput}
                    onInput={e => setSpaceInput(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </FlexBox>
                <FlexBox direction="Column" style={{ gap: '0.4rem', width: '100%' }}>
                  <Label showColon>Task Chain ID</Label>
                  <Input
                    placeholder="e.g. df_authorization_flat"
                    value={taskChainInput}
                    onInput={e => setTaskChainInput(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </FlexBox>
              </>
            )}

            <Button
              design="Emphasized"
              onClick={handleExecute}
              disabled={executing || loadingConns || connections.length === 0}
              icon={executing ? undefined : "play"}
              style={{ width: '100%', marginTop: '0.5rem' }}
            >
              {executing ? 'Requesting...' : 'Execute API Request'}
            </Button>
          </FlexBox>
        </Card>

        {/* Live Payload Output Panel */}
        <Card
          header={
            <CardHeader 
              titleText="Raw Datasphere Response Payload" 
              avatar={<Icon name="shield" style={{ color: '#10b981' }} />}
              action={
                output ? (
                  <Button 
                    icon="copy" 
                    design="Transparent"
                    onClick={handleCopy} 
                    tooltip="Copy Raw Payload" 
                  />
                ) : null
              }
            />
          }
          style={{ padding: '1.5rem', minHeight: '400px', display: 'flex', flexDirection: 'column' }}
        >
          <div
            style={{
              flexGrow: 1,
              backgroundColor: '#060913',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              padding: '1rem',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '500px',
              boxSizing: 'border-box'
            }}
          >
            {executing ? (
              <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ flexGrow: 1, gap: '1rem', opacity: 0.7, padding: '2rem 0' }}>
                <BusyIndicator active size="M" />
                <Label style={{ color: '#e2e8f0' }}>Fetching live payload from Datasphere Cloud Gateway...</Label>
              </FlexBox>
            ) : output ? (
              <pre style={{ margin: 0, fontFamily: 'Consolas, monospace', fontSize: '13px', color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {output}
              </pre>
            ) : (
              <FlexBox direction="Column" alignItems="Center" justifyContent="Center" style={{ flexGrow: 1, opacity: 0.4, padding: '4rem 0', gap: '0.5rem' }}>
                <Icon name="action-settings" style={{ fontSize: '2rem', color: '#e2e8f0' }} />
                <Label style={{ color: '#e2e8f0' }}>Execute an API request to view raw response payload.</Label>
              </FlexBox>
            )}
          </div>
        </Card>
      </div>
    </FlexBox>
  );
}
