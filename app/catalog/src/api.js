const BASE = '/odata/v4/auth';

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.error?.message || err.message || 'Request failed');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  return data.value !== undefined ? data.value : data;
}

// Org Nodes
export const getOrgNodes       = ()             => request('GET',    '/OrgNodes?$expand=attributes,type,children($expand=attributes,type,children($expand=attributes,type,children($expand=attributes,type)))');
export const getAllOrgNodesFlat = ()             => request('GET',    '/OrgNodes?$expand=attributes,type');
export const createOrgNode     = (body)         => request('POST',   '/OrgNodes', body);
export const updateOrgNode     = (id, body)     => request('PATCH',  `/OrgNodes('${id}')`, body);
export const deleteOrgNode     = (id)           => request('DELETE', `/OrgNodes('${id}')`);
export const createOrgAttr     = (body)         => request('POST',   '/OrgNodeAttributes', body);
export const deleteOrgAttr     = (id)           => request('DELETE', `/OrgNodeAttributes(${id})`);

// Roles
export const getRoles          = ()             => request('GET',    '/Roles?$expand=ownRestrictions,assignments,orgNode,parentRoles($expand=parent),approvers,environment');
export const createRole        = (body)         => request('POST',   '/Roles', body);
export const updateRole        = (id, body)     => request('PATCH',  `/Roles('${id}')`, body);
export const deleteRole        = (id)           => request('DELETE', `/Roles('${id}')`);
export const createRoleInheritance = (body)     => request('POST',   '/RoleInheritance', body);
export const deleteRoleInheritance = (id)       => request('DELETE', `/RoleInheritance(${id})`);
export const createRoleApprover    = (body)     => request('POST',   '/RoleApprovers', body);
export const deleteRoleApprover    = (id)       => request('DELETE', `/RoleApprovers(${id})`);

// Restrictions
export const createRestriction = (body)         => request('POST',   '/Restrictions', body);
export const updateRestriction = (id, body)     => request('PATCH',  `/Restrictions(${id})`, body);
export const deleteRestriction = (id)           => request('DELETE', `/Restrictions(${id})`);
export const getRestrictionFields = ()          => request('GET',    '/RestrictionFields?$expand=bdcConnection');
export const createRestrictionField = (body)    => request('POST',   '/RestrictionFields', body);
export const updateRestrictionField = (id, body) => request('PATCH',  `/RestrictionFields('${id}')`, body);
export const deleteRestrictionField = (id)      => request('DELETE', `/RestrictionFields('${id}')`);

// Streams
export const getStreams            = ()          => request('GET',    '/Streams');
export const createStream          = (body)      => request('POST',   '/Streams', body);
export const updateStream          = (id, body)  => request('PATCH',  `/Streams('${id}')`, body);
export const deleteStream          = (id)        => request('DELETE', `/Streams('${id}')`);

// Assignments
export const getAssignments    = ()             => request('GET',    '/RoleAssignments?$expand=role');
export const createAssignment  = (body)         => request('POST',   '/RoleAssignments', body);
export const deleteAssignment  = (id)           => request('DELETE', `/RoleAssignments(${id})`);

// BDC Settings
export const getBdcSettings     = ()             => request('GET',    '/BdcSettings?$expand=environment');
export const createBdcSetting   = (body)         => request('POST',   '/BdcSettings', body);
export const updateBdcSetting   = (id, body)     => request('PATCH',  `/BdcSettings('${id}')`, body);
export const deleteBdcSetting   = (id)           => request('DELETE', `/BdcSettings('${id}')`);
export const testBdcConnection  = (settingId)    => request('POST',   '/testBdcConnection', { settingId });
export const fetchBdcSpaces     = (url, tokenUrl, clientId, clientSecret) => request('POST', '/fetchBdcSpaces', { url, tokenUrl, clientId, clientSecret });
export const fetchBdcAssets     = (url, tokenUrl, clientId, clientSecret, space) => request('POST', '/fetchBdcAssets', { url, tokenUrl, clientId, clientSecret, space });
export const fetchBdcRelationalValues = (url, tokenUrl, clientId, clientSecret, space, asset, assetText, idColumns, textColumn) => request('POST', '/fetchBdcRelationalValues', { url, tokenUrl, clientId, clientSecret, space, asset, assetText, idColumns, textColumn });
export const fetchBdcAssetColumns = (url, tokenUrl, clientId, clientSecret, space, asset) => request('POST', '/fetchBdcAssetColumns', { url, tokenUrl, clientId, clientSecret, space, asset });

// Actions
export const generateOrgRole   = (orgNodeId)    => request('POST', '/generateOrgRole', { orgNodeId });
export const generateAllOrgRoles = ()           => request('POST', '/generateAllOrgRoles');
export const resolveEffective   = (roleId)      => request('POST', '/resolveEffectiveRestrictions', { roleId });
export const simulateAccess     = (roleId, rows) => request('POST', '/simulateAccess', { roleId, sampleData: JSON.stringify(rows) });
export const searchLdapUsers    = (query)        => request('POST', '/searchLdapUsers', { query });
export const fetchRawBdcSpaces  = (url, tokenUrl, clientId, clientSecret) => request('POST', '/fetchRawBdcSpaces', { url, tokenUrl, clientId, clientSecret });
export const fetchRawBdcAssets  = (url, tokenUrl, clientId, clientSecret) => request('POST', '/fetchRawBdcAssets', { url, tokenUrl, clientId, clientSecret });
export const fetchRawBdcRelationalValues = (url, tokenUrl, clientId, clientSecret, space, asset) => request('POST', '/fetchRawBdcRelationalValues', { url, tokenUrl, clientId, clientSecret, space, asset });
export const fetchRawBdcAssetColumns = (url, tokenUrl, clientId, clientSecret, space, asset) => request('POST', '/fetchRawBdcAssetColumns', { url, tokenUrl, clientId, clientSecret, space, asset });
export const fetchRawHanaViews = (settingId) => request('POST', '/fetchRawHanaViews', { settingId });
export const runBdcTaskChain = (url, tokenUrl, clientId, clientSecret, space, taskChainId) => request('POST', '/runBdcTaskChain', { url, tokenUrl, clientId, clientSecret, space, taskChainId });
export const fetchBdcTaskChainLog = (url, tokenUrl, clientId, clientSecret, space, logId) => request('POST', '/fetchBdcTaskChainLog', { url, tokenUrl, clientId, clientSecret, space, logId });
export const fetchBdcAssociations = (url, tokenUrl, clientId, clientSecret, space, asset) => request('POST', '/fetchBdcAssociations', { url, tokenUrl, clientId, clientSecret, space, asset });
export const getAuditLogs = () => request('GET', '/AuditLogs?$orderby=createdAt desc');
export const getEnvironments = () => request('GET', '/Environments');

export const getAppAuthorizations       = ()             => request('GET',    '/AppAuthorizations');
export const createAppAuthorization     = (body)         => request('POST',   '/AppAuthorizations', body);
export const updateAppAuthorization     = (id, body)     => request('PATCH',  `/AppAuthorizations('${id}')`, body);
export const deleteAppAuthorization     = (id)           => request('DELETE', `/AppAuthorizations('${id}')`);

// Replications
export const getReplications            = ()             => request('GET',    '/Replications?$orderby=replicationDate desc');
export const triggerReplication         = ()             => request('POST',   '/triggerReplication', {});
export const checkReplicationStatuses   = ()             => request('POST',   '/checkReplicationStatuses', {});

