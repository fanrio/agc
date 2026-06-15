import { useState, useEffect } from 'react';
import {
  FlexBox,
  Card,
  CardHeader,
  Title,
  Text,
  Label,
  Table,
  TableHeaderRow,
  TableHeaderCell,
  TableRow,
  TableCell,
  Button,
  Input,
  Select,
  Option,
  CheckBox,
  Dialog,
  Bar,
  BusyIndicator,
  Icon,
  Tag
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import dayjs from 'dayjs';
import { DatePicker } from '@ui5/webcomponents-react';
import { getAuditLogs, getRoles } from '../api';

export default function AuditLogsView() {
  const [logs, setLogs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filters and Pagination
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [actorFilter, setActorFilter] = useState('ALL');
  const [criticalFilter, setCriticalFilter] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  
  // Dialog State
  const [selectedLog, setSelectedLog] = useState(null);

  const consolidateLogs = (rawLogs) => {
    const consolidated = [];
    const sorted = [...rawLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    for (const log of sorted) {
      const match = consolidated.find(c => 
        c.recordId === log.recordId &&
        c.action === log.action &&
        c.createdBy === log.createdBy &&
        Math.abs(new Date(c.createdAt) - new Date(log.createdAt)) < 5000
      );
      
      if (match) {
        try {
          const matchParsed = JSON.parse(match.details);
          const logParsed = JSON.parse(log.details);
          const merged = { ...logParsed };
          for (const [k, v] of Object.entries(matchParsed)) {
            if (merged[k] !== undefined) {
              let counter = 1;
              while (merged[`${k}_${counter}`] !== undefined) {
                counter++;
              }
              merged[`${k}_${counter}`] = v;
            } else {
              merged[k] = v;
            }
          }
          match.details = JSON.stringify(merged);
        } catch (e) {}
      } else {
        consolidated.push({ ...log });
      }
    }
    
    const finalLogs = [];
    for (const log of consolidated) {
      try {
        const parsed = JSON.parse(log.details);
        const keys = Object.keys(parsed);
        const addedKeys = keys.filter(k => k.startsWith('Restriction Added'));
        const deletedKeys = keys.filter(k => k.startsWith('Restriction Deleted'));
        const removedKeys = new Set();
        
        for (const aKey of addedKeys) {
          const aNew = parsed[aKey].new || '';
          const aField = aNew.match(/Field:\s*([^,]+)/)?.[1];
          const aType = aNew.match(/Type:\s*([^,]+)/)?.[1];
          const aVal = aNew.match(/Value:\s*(.+)$/)?.[1];
          
          for (const dKey of deletedKeys) {
            if (removedKeys.has(dKey)) continue;
            const dOld = parsed[dKey].old || '';
            const dField = dOld.match(/Field:\s*([^,]+)/)?.[1];
            const dType = dOld.match(/Type:\s*([^,]+)/)?.[1];
            const dVal = dOld.match(/Value:\s*(.+)$/)?.[1];
            
            if (aField && dField && aField === dField && aType === dType && aVal === dVal) {
              removedKeys.add(aKey);
              removedKeys.add(dKey);
              break;
            }
          }
        }
        
        const filteredDetails = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (!removedKeys.has(k)) {
            filteredDetails[k] = v;
          }
        }
        
        if (Object.keys(filteredDetails).length > 0) {
          log.details = JSON.stringify(filteredDetails);
          finalLogs.push(log);
        }
      } catch (e) {
        finalLogs.push(log);
      }
    }
    return finalLogs;
  };

  const loadLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const [data, rolesData] = await Promise.all([getAuditLogs(), getRoles()]);
      const consolidated = consolidateLogs(data || []);
      setLogs(consolidated);
      setRoles(rolesData || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  // Get unique list of actors from all logs
  const actorsList = [...new Set(logs.map(log => log.createdBy).filter(Boolean))].sort();

  // Filter Logic
  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.recordId?.toLowerCase().includes(search.toLowerCase()) ||
      log.targetName?.toLowerCase().includes(search.toLowerCase()) ||
      log.details?.toLowerCase().includes(search.toLowerCase()) ||
      log.createdBy?.toLowerCase().includes(search.toLowerCase());
      
    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'ALL' || log.entityName === entityFilter;
    
    // Performed By (Actor) filter
    const matchesActor = actorFilter === 'ALL' || log.createdBy === actorFilter;

    // Time Range filter
    let matchesDate = true;
    if (dateFilter !== 'ALL') {
      const logDate = new Date(log.createdAt);
      const today = new Date();
      if (dateFilter === 'TODAY') {
        matchesDate = logDate.getDate() === today.getDate() &&
                      logDate.getMonth() === today.getMonth() &&
                      logDate.getFullYear() === today.getFullYear();
      } else if (dateFilter === 'WEEK') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        matchesDate = logDate >= weekAgo;
      } else if (dateFilter === 'MONTH') {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        matchesDate = logDate >= monthAgo;
      } else if (dateFilter === 'CUSTOM') {
        if (startDate) {
          const start = startDate.startOf('day').toDate();
          if (logDate < start) matchesDate = false;
        }
        if (endDate) {
          const end = endDate.endOf('day').toDate();
          if (logDate > end) matchesDate = false;
        }
      }
    }

    // Critical Roles Only filter
    let matchesCritical = true;
    if (criticalFilter) {
      let roleId = null;
      if (log.entityName === 'Roles') {
        roleId = log.recordId;
      } else if (log.entityName === 'RoleAssignments') {
        try {
          const parsed = JSON.parse(log.details);
          if (parsed.role_ID) {
            roleId = parsed.role_ID;
          } else if (parsed.role && parsed.role.ID) {
            roleId = parsed.role.ID;
          } else if (parsed.role_ID?.new) {
            roleId = parsed.role_ID.new;
          } else if (parsed.role_ID?.old) {
            roleId = parsed.role_ID.old;
          }
        } catch (e) {}
      }
      if (roleId) {
        const role = roles.find(r => r.ID === roleId);
        matchesCritical = role ? role.critical : false;
      } else {
        matchesCritical = false;
      }
    }

    return matchesSearch && matchesAction && matchesEntity && matchesActor && matchesDate && matchesCritical;
  });

  const paginatedLogs = filteredLogs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getActionChip = (action) => {
    switch (action) {
      case 'CREATE':
        return <Tag design="Positive">CREATE</Tag>;
      case 'UPDATE':
        return <Tag design="Information">UPDATE</Tag>;
      case 'DELETE':
        return <Tag design="Negative">DELETE</Tag>;
      default:
        return <Tag>{action}</Tag>;
    }
  };

  const formatRestrictionValue = (rawStr) => {
    if (!rawStr || rawStr === '—' || rawStr === '') return '—';
    const typeMatch = rawStr.match(/Type:\s*([^,]+)/);
    const type = typeMatch ? typeMatch[1].trim() : '';
    const valMatch = rawStr.match(/Value:\s*(.+)$/);
    if (!valMatch) return rawStr;
    let val = valMatch[1].trim();

    if (type === 'SINGLE_VALUE') {
      return val;
    } else if (type === 'RANGE') {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === 'object') {
          return `${parsed.from} - ${parsed.to}`;
        }
      } catch {}
    } else if (type === 'MULTI_VALUE') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          return parsed.join(', ');
        }
      } catch {}
    } else if (type === 'PATTERN') {
      return `Pattern: ${val}`;
    }
    return val;
  };

  const renderDetailsTable = (log) => {
    try {
      const parsed = JSON.parse(log.details);
      
      if (log.action === 'UPDATE') {
        const entries = Object.entries(parsed);
        const generalRows = [];
        const restrictionRows = [];
        
        for (const [key, diff] of entries) {
          const oldValRaw = diff && typeof diff === 'object' && 'old' in diff ? String(diff.old) : String(diff);
          const newValRaw = diff && typeof diff === 'object' && 'new' in diff ? String(diff.new) : '';
          
          if (key.toLowerCase().includes('restriction')) {
            let fieldName = '—';
            let action = 'Changed';
            let oldDisp = oldValRaw;
            let newDisp = newValRaw;
            
            if (key.startsWith('Restriction Added')) {
              action = 'Added';
              const match = newValRaw.match(/Field:\s*([^,]+)/);
              if (match) fieldName = match[1].trim();
              oldDisp = '—';
              newDisp = formatRestrictionValue(newValRaw);
            } else if (key.startsWith('Restriction Deleted')) {
              action = 'Deleted';
              const match = oldValRaw.match(/Field:\s*([^,]+)/);
              if (match) fieldName = match[1].trim();
              oldDisp = formatRestrictionValue(oldValRaw);
              newDisp = '—';
            } else if (key.startsWith('Restriction Changed')) {
              action = 'Changed';
              const match = key.match(/Restriction Changed \(([^)]+)\)/);
              if (match) fieldName = match[1].trim();
              oldDisp = formatRestrictionValue(oldValRaw);
              newDisp = formatRestrictionValue(newValRaw);
            } else {
              fieldName = key;
              oldDisp = oldValRaw;
              newDisp = newValRaw;
            }
            
            restrictionRows.push({
              fieldName,
              action,
              oldVal: oldDisp,
              newVal: newDisp
            });
          } else {
            generalRows.push({
              field: key,
              oldVal: oldValRaw,
              newVal: newValRaw
            });
          }
        }
        
        const renderSectionTable = (title, rows, emptyMessage, isRestriction = false) => (
          <div style={{ marginBottom: '1.5rem' }}>
            <Title level="H6" style={{ fontWeight: 700, marginBottom: '0.75rem', textTransform: 'uppercase', color: 'var(--sapContent_LabelColor)' }}>
              {title}
            </Title>
            {rows.length > 0 ? (
              <Table
                headerRow={
                  <TableHeaderRow>
                    {isRestriction ? (
                      <>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>Restriction Field</Text></TableHeaderCell>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>Action</Text></TableHeaderCell>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>Old Value</Text></TableHeaderCell>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>New Value</Text></TableHeaderCell>
                      </>
                    ) : (
                      <>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>Property</Text></TableHeaderCell>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>Old Value</Text></TableHeaderCell>
                        <TableHeaderCell><Text style={{ fontWeight: 600 }}>New Value</Text></TableHeaderCell>
                      </>
                    )}
                  </TableHeaderRow>
                }
              >
                {rows.map((row, index) => (
                  <TableRow key={isRestriction ? index : row.field}>
                    {isRestriction ? (
                      <>
                        <TableCell><Text style={{ fontWeight: 500 }}>{row.fieldName}</Text></TableCell>
                        <TableCell>
                          <Tag
                            design={row.action === 'Added' ? 'Positive' : row.action === 'Deleted' ? 'Negative' : 'Information'}
                          >
                            {row.action}
                          </Tag>
                        </TableCell>
                        <TableCell>
                          <Text style={{ color: 'var(--sapNegativeColor)', textDecoration: row.action === 'Changed' ? 'line-through' : 'none' }}>
                            {row.oldVal}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text style={{ color: 'var(--sapPositiveColor)' }}>
                            {row.newVal}
                          </Text>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell><Text style={{ fontWeight: 500 }}>{row.field}</Text></TableCell>
                        <TableCell>
                          <Text style={{ color: 'var(--sapNegativeColor)', textDecoration: 'line-through' }}>
                            {row.oldVal || '—'}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text style={{ color: 'var(--sapPositiveColor)' }}>
                            {row.newVal || '—'}
                          </Text>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </Table>
            ) : (
              <Text style={{ fontStyle: 'italic', color: 'var(--sapContent_LabelColor)', paddingLeft: '4px' }}>
                {emptyMessage}
              </Text>
            )}
          </div>
        );

        return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {renderSectionTable("General Information", generalRows, "No general information changes.", false)}
            {renderSectionTable("Restriction", restrictionRows, "No restriction changes.", true)}
          </div>
        );
      } else {
        const rows = Object.entries(parsed).map(([field, val]) => ({
          field,
          value: typeof val === 'object' ? JSON.stringify(val) : String(val)
        }));
        
        return (
          <Table
            headerRow={
              <TableHeaderRow>
                <TableHeaderCell><Text style={{ fontWeight: 600 }}>Property</Text></TableHeaderCell>
                <TableHeaderCell><Text style={{ fontWeight: 600 }}>Value</Text></TableHeaderCell>
              </TableHeaderRow>
            }
          >
            {rows.map((row) => (
              <TableRow key={row.field}>
                <TableCell><Text style={{ fontWeight: 500 }}>{row.field}</Text></TableCell>
                <TableCell><Text style={{ wordBreak: 'break-all' }}>{row.value}</Text></TableCell>
              </TableRow>
            ))}
          </Table>
        );
      }
    } catch {
      return (
        <div style={{ padding: '1rem', backgroundColor: 'var(--sapGroup_ContentBackground)', border: '1px solid var(--sapGroup_BorderColor)', borderRadius: '4px' }}>
          <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>
            {log.details}
          </pre>
        </div>
      );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <FlexBox justifyContent="SpaceBetween" alignItems="Center">
        <div>
          <Title level="H3" style={{ fontWeight: 700 }}>
            System Audit Logs
          </Title>
          <Text style={{ color: 'var(--sapContent_LabelColor)' }}>
            Review security compliance logs and lifecycle changes for roles and assignments.
          </Text>
        </div>
        <Button 
          onClick={loadLogs} 
          icon="refresh"
          disabled={loading}
        >
          Refresh
        </Button>
      </FlexBox>

      {/* Filter Toolbar Card */}
      <Card>
        <div style={{ padding: '1.25rem' }}>
          <FlexBox direction="Column" style={{ gap: '1rem' }}>
            <FlexBox alignItems="Center" style={{ gap: '1rem', flexWrap: 'wrap' }}>
              <Input
                placeholder="Search by Target, User, details..."
                value={search}
                onInput={(e) => { setSearch(e.target.value); setPage(0); }}
                icon={<Icon name="search" />}
                style={{ flexGrow: 1, minWidth: '260px' }}
              />

              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Label>Time Range</Label>
                <Select
                  onChange={(e) => { setDateFilter(e.detail.selectedOption.value); setPage(0); }}
                  style={{ minWidth: '150px' }}
                >
                  <Option selected={dateFilter === 'ALL'} value="ALL">All Time</Option>
                  <Option selected={dateFilter === 'TODAY'} value="TODAY">Today</Option>
                  <Option selected={dateFilter === 'WEEK'} value="WEEK">Past 7 Days</Option>
                  <Option selected={dateFilter === 'MONTH'} value="MONTH">Past 30 Days</Option>
                  <Option selected={dateFilter === 'CUSTOM'} value="CUSTOM">Custom Range...</Option>
                </Select>
              </FlexBox>

              {dateFilter === 'CUSTOM' && (
                <FlexBox style={{ gap: '1rem', alignItems: 'center' }}>
                  <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                    <Label>Start Date</Label>
                    <DatePicker
                      value={startDate ? dayjs(startDate).format('YYYY-MM-DD') : ''}
                      formatPattern="yyyy-MM-dd"
                      onChange={(e) => {
                        const val = e.target.value;
                        setStartDate(val ? dayjs(val) : null);
                        setPage(0);
                      }}
                      style={{ minWidth: '150px' }}
                    />
                  </FlexBox>
                  <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                    <Label>End Date</Label>
                    <DatePicker
                      value={endDate ? dayjs(endDate).format('YYYY-MM-DD') : ''}
                      formatPattern="yyyy-MM-dd"
                      onChange={(e) => {
                        const val = e.target.value;
                        setEndDate(val ? dayjs(val) : null);
                        setPage(0);
                      }}
                      style={{ minWidth: '150px' }}
                    />
                  </FlexBox>
                </FlexBox>
              )}

              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Label>Action</Label>
                <Select
                  onChange={(e) => { setActionFilter(e.detail.selectedOption.value); setPage(0); }}
                  style={{ minWidth: '150px' }}
                >
                  <Option selected={actionFilter === 'ALL'} value="ALL">All Actions</Option>
                  <Option selected={actionFilter === 'CREATE'} value="CREATE">CREATE</Option>
                  <Option selected={actionFilter === 'UPDATE'} value="UPDATE">UPDATE</Option>
                  <Option selected={actionFilter === 'DELETE'} value="DELETE">DELETE</Option>
                </Select>
              </FlexBox>

              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Label>Entity Type</Label>
                <Select
                  onChange={(e) => { setEntityFilter(e.detail.selectedOption.value); setPage(0); }}
                  style={{ minWidth: '180px' }}
                >
                  <Option selected={entityFilter === 'ALL'} value="ALL">All Entities</Option>
                  <Option selected={entityFilter === 'Roles'} value="Roles">Roles</Option>
                  <Option selected={entityFilter === 'RoleAssignments'} value="RoleAssignments">Role Assignments</Option>
                </Select>
              </FlexBox>
            </FlexBox>

            <FlexBox alignItems="Center" justifyContent="SpaceBetween" style={{ gap: '1rem', flexWrap: 'wrap' }}>
              <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
                <Label>Performed By</Label>
                <Select
                  onChange={(e) => { setActorFilter(e.detail.selectedOption.value); setPage(0); }}
                  style={{ minWidth: '180px' }}
                >
                  <Option selected={actorFilter === 'ALL'} value="ALL">All Performers</Option>
                  {actorsList.map(actor => (
                    <Option key={actor} selected={actorFilter === actor} value={actor}>{actor}</Option>
                  ))}
                </Select>
              </FlexBox>

              <CheckBox
                text="Critical Roles Only"
                checked={criticalFilter}
                onChange={(e) => { setCriticalFilter(e.target.checked); setPage(0); }}
              />
            </FlexBox>
          </FlexBox>
        </div>
      </Card>

      {/* Main Table Card */}
      <Card>
        {loading ? (
          <FlexBox justifyContent="Center" alignItems="Center" style={{ padding: '4rem 0' }}>
            <BusyIndicator active size="Large" />
          </FlexBox>
        ) : error ? (
          <FlexBox direction="Column" alignItems="Center" style={{ padding: '4rem 0', gap: '1rem' }}>
            <Icon name="alert" style={{ fontSize: '3rem', color: 'var(--sapNegativeColor)' }} />
            <Text style={{ color: 'var(--sapNegativeColor)' }}>{error}</Text>
            <Button onClick={loadLogs}>Try Again</Button>
          </FlexBox>
        ) : (
          <FlexBox direction="Column">
            <Table
              headerRow={
                <TableHeaderRow>
                  <TableHeaderCell><Text style={{ fontWeight: 600 }}>Entity</Text></TableHeaderCell>
                  <TableHeaderCell><Text style={{ fontWeight: 600 }}>Subject Identity</Text></TableHeaderCell>
                  <TableHeaderCell><Text style={{ fontWeight: 600 }}>Action</Text></TableHeaderCell>
                  <TableHeaderCell><Text style={{ fontWeight: 600 }}>Performed By</Text></TableHeaderCell>
                  <TableHeaderCell><Text style={{ fontWeight: 600 }}>Timestamp</Text></TableHeaderCell>
                  <TableHeaderCell style={{ width: '120px', textAlign: 'end' }}><Text style={{ fontWeight: 600 }}>Details</Text></TableHeaderCell>
                </TableHeaderRow>
              }
            >
              {paginatedLogs.length === 0 ? (
                <TableRow>
                  <TableCell style={{ textAlign: 'center' }} colSpan={6}>
                    <Text style={{ color: 'var(--sapContent_LabelColor)' }}>
                      No audit logs found matching the filters.
                    </Text>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedLogs.map((log) => (
                  <TableRow key={log.ID}>
                    <TableCell>
                      <Text style={{ fontWeight: 500 }}>
                        {log.entityName}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Text style={{ 
                        fontFamily: log.targetName ? 'inherit' : 'monospace',
                        fontWeight: log.targetName ? 500 : 'normal'
                      }}>
                        {log.targetName || log.recordId}
                      </Text>
                    </TableCell>
                    <TableCell>
                      {getActionChip(log.action)}
                    </TableCell>
                    <TableCell>
                      <Text style={{ color: 'var(--sapContent_LabelColor)' }}>
                        {log.createdBy}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Text>
                        {new Date(log.createdAt).toLocaleString()}
                      </Text>
                    </TableCell>
                    <TableCell style={{ textAlign: 'end' }}>
                      <Button
                        icon="show"
                        design="Transparent"
                        onClick={() => setSelectedLog(log)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </Table>

            <FlexBox
              alignItems="Center"
              justifyContent="End"
              style={{
                padding: '0.75rem 1rem',
                gap: '1.5rem',
                borderTop: '1px solid var(--sapGroup_BorderColor)',
                flexWrap: 'wrap'
              }}
            >
              <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                <Label>Rows per page:</Label>
                <Select
                  onChange={(e) => {
                    setRowsPerPage(parseInt(e.detail.selectedOption.value, 10));
                    setPage(0);
                  }}
                >
                  <Option selected={rowsPerPage === 5} value="5">5</Option>
                  <Option selected={rowsPerPage === 10} value="10">10</Option>
                  <Option selected={rowsPerPage === 25} value="25">25</Option>
                  <Option selected={rowsPerPage === 50} value="50">50</Option>
                </Select>
              </FlexBox>

              <Text style={{ color: 'var(--sapContent_LabelColor)' }}>
                {`${page * rowsPerPage + 1}-${Math.min((page + 1) * rowsPerPage, filteredLogs.length)} of ${filteredLogs.length}`}
              </Text>

              <FlexBox style={{ gap: '0.25rem' }}>
                <Button
                  icon="navigation-left-arrow"
                  design="Transparent"
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                />
                <Button
                  icon="navigation-right-arrow"
                  design="Transparent"
                  disabled={(page + 1) * rowsPerPage >= filteredLogs.length}
                  onClick={() => setPage(p => p + 1)}
                />
              </FlexBox>
            </FlexBox>
          </FlexBox>
        )}
      </Card>

      {/* JSON Details Dialog */}
      <Dialog 
        open={Boolean(selectedLog)} 
        onAfterClose={() => setSelectedLog(null)}
        headerText="Audit Details"
        style={{ width: '80%', maxWidth: '800px' }}
      >
        {selectedLog && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <FlexBox direction="Column" style={{ gap: '0.25rem' }}>
              <Text style={{ fontSize: '0.875rem', color: 'var(--sapContent_LabelColor)' }}>
                {selectedLog.entityName} · {selectedLog.action} · {new Date(selectedLog.createdAt).toLocaleString()}
              </Text>
              <Text style={{ fontSize: '0.875rem' }}>
                Audit details for target record ID: <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{selectedLog.recordId}</span>
              </Text>
            </FlexBox>
            
            <div>
              {renderDetailsTable(selectedLog)}
            </div>

            <Bar 
              design="Footer"
              endContent={
                <Button onClick={() => setSelectedLog(null)} design="Emphasized">
                  Close
                </Button>
              }
              style={{ marginTop: '1rem' }}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
