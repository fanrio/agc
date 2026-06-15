import { useState, useEffect } from 'react';
import {
  Card,
  CardHeader,
  FlexBox,
  Grid,
  Tag,
  List,
  ListItemStandard,
  ListItemCustom,
  MessageStrip,
  Button,
  Icon,
  BusyIndicator
} from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import * as api from '../api';

export default function HomeView({ setActiveNav, onCreateRole, navigateToRoles }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadStats() {
    setLoading(true);
    setError('');
    try {
      const [roles, nodes, assignments, streams, fields, bdcSettings] = await Promise.all([
        api.getRoles(),
        api.getAllOrgNodesFlat(),
        api.getAssignments(),
        api.getStreams(),
        api.getRestrictionFields(),
        api.getBdcSettings()
      ]);

      // Calculate unique users
      const uniqueUsers = new Set(assignments.map(a => a.userId));

      // Calculate unique users with critical roles
      const usersWithCritical = new Set(
        assignments
          .filter(a => {
            const role = roles.find(r => r.ID === a.role_ID);
            return role && role.critical;
          })
          .map(a => a.userId)
      );

      // Calculate recent roles (sort by createdAt if present, or take last 3)
      const sortedRoles = [...roles]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 3);

      const nodeTypeCounts = {};
      nodes.forEach(node => {
        const type = node.type?.name || 'UNKNOWN';
        nodeTypeCounts[type] = (nodeTypeCounts[type] || 0) + 1;
      });

      let rolesWithoutRestriction = 0;
      let rolesWithoutApprover = 0;
      let rolesWithoutAssignment = 0;
      let criticalRoles = 0;

      roles.forEach(role => {
        if (!role.ownRestrictions || role.ownRestrictions.length === 0) {
          rolesWithoutRestriction++;
        }
        if (!role.approvers || role.approvers.length === 0) {
          rolesWithoutApprover++;
        }
        if (!role.assignments || role.assignments.length === 0) {
          rolesWithoutAssignment++;
        }
        if (role.critical) {
          criticalRoles++;
        }
      });

      setStats({
        roleCount: roles.length,
        rolesWithoutRestriction,
        rolesWithoutApprover,
        rolesWithoutAssignment,
        criticalRoles,
        usersWithCritical: usersWithCritical.size,
        nodeCount: nodes.length,
        nodeTypeCounts,
        assignmentCount: assignments.length,
        userCount: uniqueUsers.size,
        streamCount: streams.length,
        fieldCount: fields.length,
        bdcCount: bdcSettings.length,
        recentRoles: sortedRoles
      });
    } catch (e) {
      setError(`Failed to load dashboard statistics: ${e.message}`);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <BusyIndicator active size="L" />
      </div>
    );
  }

  const cards = [
    { label: 'Roles health overview', icon: 'pulse', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.04)', border: 'rgba(59, 130, 246, 0.15)', tab: 'roles', size: 12 },
    { label: 'Users & assignments overview', icon: 'group', color: '#10b981', bg: 'rgba(16, 185, 129, 0.04)', border: 'rgba(16, 185, 129, 0.15)', tab: 'assignments', size: 8 },
    { label: 'Organizational Nodes', value: stats?.nodeCount || 0, icon: 'building', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.04)', border: 'rgba(167, 139, 250, 0.15)', tab: 'org', size: 4 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <style>{`
        .hover-card:hover {
          transform: translateY(-4px);
          border-color: var(--card-color) !important;
          box-shadow: 0 4px 20px -5px var(--card-color-alpha) !important;
        }
        .hover-bg-blue:hover {
          background-color: rgba(59, 130, 246, 0.08) !important;
        }
        .hover-role-item:hover {
          border-color: rgba(59, 130, 246, 0.3) !important;
          background-color: rgba(255, 255, 255, 0.02) !important;
        }
      `}</style>

      {/* Welcome Hero Panel */}
      <Card style={{ 
        padding: '2rem', 
        background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(167,139,250,0.08) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--sapTextColor, #fff)' }}>
            Authorization Governance Center
          </h2>
          <p style={{ fontSize: '1.05rem', color: 'var(--sapContent_LabelColor, #888)', maxWidth: 650, margin: '0 0 1.5rem 0', lineHeight: 1.5 }}>
            Manage role-based permissions, inheritances, and organizational restrictions dynamically. Create org nodes, map custom restriction fields, and simulate data access configurations.
          </p>
          <FlexBox direction="Row" gap="1rem" wrap="Wrap">
            <Button design="Emphasized" onClick={onCreateRole} icon="flash">
              Create Role Wizard
            </Button>
            <Button design="Transparent" onClick={() => setActiveNav('org')} icon="building">
              Manage Org Structure
            </Button>
          </FlexBox>
        </div>
        {/* Decorative background element */}
        <div style={{ 
          position: 'absolute', 
          right: -50, 
          bottom: -50, 
          width: 250, 
          height: 250, 
          borderRadius: '50%', 
          backgroundColor: 'rgba(59,130,246,0.05)', 
          filter: 'blur(40px)',
          zIndex: 1
        }} />
      </Card>

      {error && (
        <MessageStrip design="Negative" onClose={loadStats} style={{ border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </MessageStrip>
      )}

      {/* KPI Stats Grid */}
      <Grid defaultSpan="XL3 L3 M6 S12" style={{ gap: '1.5rem' }}>
        {cards.map(card => {
          const isHealthCard = card.label === 'Roles health overview';
          const isUsersCard = card.label === 'Users & assignments overview';
          const isOrgCard = card.label === 'Organizational Nodes';
          
          let layoutSpan = "XL3 L3 M6 S12";
          if (card.size === 12) layoutSpan = "XL12 L12 M12 S12";
          else if (card.size === 8) layoutSpan = "XL8 L8 M8 S12";
          else if (card.size === 4) layoutSpan = "XL4 L4 M4 S12";

          return (
            <div data-layout-span={layoutSpan} key={card.label} style={{ display: 'flex' }}>
              <Card 
                onClick={() => setActiveNav(card.tab)}
                className="hover-card"
                style={{ 
                  padding: '1.5rem', 
                  backgroundColor: card.bg, 
                  borderColor: card.border,
                  cursor: 'pointer',
                  width: '100%',
                  minHeight: '155px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxSizing: 'border-box',
                  '--card-color': card.color,
                  '--card-color-alpha': `${card.color}25`
                }}
              >
                <FlexBox direction="Row" justifyContent="SpaceBetween" alignItems="Start" style={{ width: '100%', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.875rem', color: 'var(--sapContent_LabelColor, #888)', fontWeight: 600 }}>
                    {card.label}
                  </span>
                  <Icon name={card.icon} style={{ color: card.color, fontSize: '1.25rem' }} />
                </FlexBox>

                {isHealthCard && stats ? (
                  <div style={{ marginTop: '0.5rem', width: '100%' }}>
                    <FlexBox direction="Row" wrap="Wrap" justifyContent="SpaceBetween" style={{ gap: '1rem', width: '100%' }}>
                      {/* Total Roles */}
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles(null);
                          else setActiveNav('roles');
                        }}
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.5rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          flex: '1 1 18%',
                          minWidth: '100px',
                          transition: 'all 0.2s',
                          boxSizing: 'border-box'
                        }}
                        className="hover-bg-blue"
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapContent_LabelColor, #888)' }}>
                          Total Roles
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                          {stats.roleCount}
                        </span>
                      </div>

                      {/* Critical */}
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('critical');
                          else setActiveNav('roles');
                        }}
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.5rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          flex: '1 1 18%',
                          minWidth: '100px',
                          transition: 'all 0.2s',
                          borderLeft: '1px solid var(--sapGroup_BorderColor, #e2e8f0)',
                          paddingLeft: '1rem',
                          boxSizing: 'border-box'
                        }}
                        className="hover-bg-blue"
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapErrorColor, #ff5454)' }}>
                          Critical
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapErrorColor, #ff5454)', fontFamily: 'monospace' }}>
                          {stats.criticalRoles}
                        </span>
                      </div>

                      {/* Unrestricted */}
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('unrestricted');
                          else setActiveNav('roles');
                        }}
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.5rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          flex: '1 1 18%',
                          minWidth: '100px',
                          transition: 'all 0.2s',
                          borderLeft: '1px solid var(--sapGroup_BorderColor, #e2e8f0)',
                          paddingLeft: '1rem',
                          boxSizing: 'border-box'
                        }}
                        className="hover-bg-blue"
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapContent_LabelColor, #888)' }}>
                          Unrestricted
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                          {stats.rolesWithoutRestriction}
                        </span>
                      </div>
                      
                      {/* No Users */}
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('no-users');
                          else setActiveNav('roles');
                        }}
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.5rem', 
                          borderLeft: '1px solid var(--sapGroup_BorderColor, #e2e8f0)', 
                          paddingLeft: '1rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          flex: '1 1 18%',
                          minWidth: '100px',
                          transition: 'all 0.2s',
                          boxSizing: 'border-box'
                        }}
                        className="hover-bg-blue"
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapContent_LabelColor, #888)' }}>
                          No Users
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                          {stats.statsWithoutAssignment || stats.rolesWithoutAssignment}
                        </span>
                      </div>
                      
                      {/* No Approver */}
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigateToRoles) navigateToRoles('no-approver');
                          else setActiveNav('roles');
                        }}
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: '0.5rem', 
                          borderLeft: '1px solid var(--sapGroup_BorderColor, #e2e8f0)', 
                          paddingLeft: '1rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          flex: '1 1 18%',
                          minWidth: '100px',
                          transition: 'all 0.2s',
                          boxSizing: 'border-box'
                        }}
                        className="hover-bg-blue"
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapContent_LabelColor, #888)' }}>
                          No Approver
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                          {stats.rolesWithoutApprover}
                        </span>
                      </div>
                    </FlexBox>
                  </div>
                ) : isUsersCard && stats ? (
                  <div style={{ marginTop: '0.5rem', width: '100%' }}>
                    <FlexBox direction="Row" wrap="Wrap" style={{ gap: '1rem', width: '100%' }}>
                      {/* Unique Users */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: '1 1 28%', minWidth: '120px', boxSizing: 'border-box' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapContent_LabelColor, #888)' }}>
                          Unique Users
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                          {stats.userCount}
                        </span>
                      </div>

                      {/* Role Assignments */}
                      <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.5rem',
                        flex: '1 1 28%',
                        minWidth: '120px',
                        borderLeft: '1px solid var(--sapGroup_BorderColor, #e2e8f0)',
                        paddingLeft: '1.5rem',
                        boxSizing: 'border-box'
                      }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapContent_LabelColor, #888)' }}>
                          Role Assignments
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                          {stats.assignmentCount}
                        </span>
                      </div>

                      {/* Users with Critical Roles */}
                      <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.5rem',
                        flex: '1 1 28%',
                        minWidth: '120px',
                        borderLeft: '1px solid var(--sapGroup_BorderColor, #e2e8f0)',
                        paddingLeft: '1.5rem',
                        boxSizing: 'border-box'
                      }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sapErrorColor, #ff5454)' }}>
                          Users with Critical Roles
                        </span>
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapErrorColor, #ff5454)', fontFamily: 'monospace' }}>
                          {stats.usersWithCritical}
                        </span>
                      </div>
                    </FlexBox>
                  </div>
                ) : isOrgCard && stats?.nodeTypeCounts ? (
                  <div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace', marginBottom: '0.75rem' }}>
                      {card.value}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {Object.entries(stats.nodeTypeCounts).map(([type, count]) => (
                        <Tag 
                          key={type} 
                          style={{ 
                            fontSize: '9px', 
                            height: '16px', 
                            backgroundColor: 'rgba(255,255,255,0.03)', 
                            border: '1px solid rgba(255,255,255,0.06)',
                            color: 'var(--sapContent_LabelColor, #888)' 
                          }}
                        >
                          {`${type}: ${count}`}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--sapTextColor, #fff)', fontFamily: 'monospace' }}>
                    {card.value}
                  </div>
                )}
              </Card>
            </div>
          );
        })}
      </Grid>

      {/* Detail Sections */}
      <Grid defaultSpan="XL6 L6 M12 S12" style={{ gap: '1.5rem' }}>
        {/* Recent Roles */}
        <div data-layout-span="XL7 L7 M12 S12">
          <Card 
            header={<CardHeader titleText="Recently Created Roles" />}
            style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%', boxSizing: 'border-box' }}
          >
            {stats?.recentRoles && stats.recentRoles.length > 0 ? (
              <List style={{ width: '100%' }}>
                {stats.recentRoles.map(role => (
                  <ListItemCustom 
                    key={role.ID}
                    onClick={() => setActiveNav('roles')}
                    style={{ 
                      padding: '1rem', 
                      borderRadius: '4px', 
                      backgroundColor: 'rgba(255,255,255,0.01)', 
                      border: '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer',
                      marginBottom: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      boxSizing: 'border-box'
                    }}
                    className="hover-role-item"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                      <Icon name="shield" style={{ color: role.type === 'ORG_BASED' ? '#3b82f6' : '#a78bfa', fontSize: '1rem' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '13px', color: 'var(--sapTextColor, #fff)' }}>
                          {role.name}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--sapContent_LabelColor, #888)' }}>
                          {role.description || 'No description provided'}
                        </span>
                      </div>
                    </div>
                    <Icon name="navigation-right-arrow" style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }} />
                  </ListItemCustom>
                ))}
              </List>
            ) : (
              <div style={{ fontSize: '0.875rem', color: 'var(--sapContent_LabelColor, #888)' }}>
                No roles created yet. Use the wizard to deploy roles.
              </div>
            )}
          </Card>
        </div>

        {/* Global Configuration summary */}
        <div data-layout-span="XL5 L5 M12 S12">
          <Card 
            header={<CardHeader titleText="Global Parameters" />}
            style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', boxSizing: 'border-box' }}
          >
            <FlexBox direction="Column" gap="1rem" style={{ width: '100%', marginBottom: '1.5rem' }}>
              <FlexBox direction="Row" justifyContent="SpaceBetween" alignItems="Center" style={{ width: '100%' }}>
                <FlexBox direction="Row" alignItems="Center" gap="0.75rem">
                  <Icon name="org-chart" style={{ color: '#3b82f6', fontSize: '1rem' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--sapTextColor, #fff)' }}>Active Streams</span>
                </FlexBox>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sapTextColor, #fff)' }}>
                  {stats?.streamCount || 0}
                </span>
              </FlexBox>

              <FlexBox direction="Row" justifyContent="SpaceBetween" alignItems="Center" style={{ width: '100%' }}>
                <FlexBox direction="Row" alignItems="Center" gap="0.75rem">
                  <Icon name="settings" style={{ color: '#a78bfa', fontSize: '1rem' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--sapTextColor, #fff)' }}>Restriction Fields</span>
                </FlexBox>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sapTextColor, #fff)' }}>
                  {stats?.fieldCount || 0}
                </span>
              </FlexBox>

              <FlexBox direction="Row" justifyContent="SpaceBetween" alignItems="Center" style={{ width: '100%' }}>
                <FlexBox direction="Row" alignItems="Center" gap="0.75rem">
                  <Icon name="cloud" style={{ color: '#10b981', fontSize: '1rem' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--sapTextColor, #fff)' }}>BDC System Connections</span>
                </FlexBox>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sapTextColor, #fff)' }}>
                  {stats?.bdcCount || 0}
                </span>
              </FlexBox>
            </FlexBox>

            <Button 
              design="Transparent"
              style={{ width: '100%', marginTop: 'auto' }}
              onClick={() => setActiveNav('admin')}
              icon="settings"
            >
              Configure Settings
            </Button>
          </Card>
        </div>
      </Grid>
    </div>
  );
}

