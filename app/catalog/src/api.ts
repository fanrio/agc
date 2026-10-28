const BASE = '/odata/v4/auth';

let activeSimulatedUser = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
  ? localStorage.getItem('auth_user') || 'tim.waecken@cimt-ag.de'
  : 'tim.waecken@cimt-ag.de';

export function setSimulatedUser(userId: string): void {
  activeSimulatedUser = userId;
}

async function request(method: string, path: string, body?: any): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (activeSimulatedUser) {
    headers['x-simulated-user'] = activeSimulatedUser;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.error?.message || err.message || 'Request failed');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (data && '@odata.count' !== undefined && '@odata.count' in data) {
    return { value: data.value, count: Number(data['@odata.count']) };
  }
  return data.value !== undefined ? data.value : data;
}

export const getCurrentUserPermissions = () => request('GET', '/getCurrentUserPermissions()');

// Org Nodes
export const getOrgNodes = () => request('GET', '/OrgNodes?$expand=attributes,type,children($expand=attributes,type,children($expand=attributes,type,children($expand=attributes,type)))');
export const getAllOrgNodesFlat = () => request('GET', '/OrgNodes?$expand=attributes,type');
export const createOrgNode = (body: any) => request('POST', '/OrgNodes', body);
export const updateOrgNode = (id: string, body: any) => request('PATCH', `/OrgNodes('${id}')`, body);
export const deleteOrgNode = (id: string) => request('DELETE', `/OrgNodes('${id}')`);
export const createOrgAttr = (body: any) => request('POST', '/OrgNodeAttributes', body);
export const deleteOrgAttr = (id: string | number) => request('DELETE', `/OrgNodeAttributes(${id})`);

// Roles
export interface GetRolesParams {
  top?: number;
  skip?: number;
  count?: boolean;
  filter?: string;
  search?: string;
  envFilter?: string[];
  typeFilter?: string;
  healthFilter?: string | null;
}

export const getRoles = (params?: GetRolesParams) => {
  if (!params) {
    return request('GET', '/Roles?$expand=orgNode,parentRoles($expand=parent),approvers,environment');
  }

  const queryParams: string[] = [
    '$expand=orgNode,parentRoles($expand=parent),approvers,environment'
  ];

  if (params.count) {
    queryParams.push('$count=true');
  }
  if (params.top !== undefined) {
    queryParams.push(`$top=${params.top}`);
  }
  if (params.skip !== undefined) {
    queryParams.push(`$skip=${params.skip}`);
  }

  const filters: string[] = [];

  if (params.filter) {
    filters.push(params.filter);
  }

  if (params.typeFilter && params.typeFilter !== 'ALL') {
    filters.push(`type eq '${params.typeFilter}'`);
  }

  if (params.envFilter && params.envFilter.length > 0) {
    const envConds = params.envFilter.map(e => `environment_ID eq '${e.replace(/'/g, "''")}'`).join(' or ');
    filters.push(`(${envConds})`);
  }

  if (params.search && params.search.trim()) {
    const q = params.search.trim().replace(/'/g, "''").toLowerCase();
    filters.push(`(contains(tolower(name), '${q}') or (description ne null and contains(tolower(description), '${q}')))`);
  }

  if (params.healthFilter) {
    if (params.healthFilter === 'unrestricted') {
      filters.push('not ownRestrictions/any()');
    } else if (params.healthFilter === 'no-users') {
      filters.push('not assignments/any()');
    } else if (params.healthFilter === 'no-approver') {
      filters.push('not approvers/any()');
    } else if (params.healthFilter === 'critical') {
      filters.push('critical eq true');
    }
  }

  if (filters.length > 0) {
    queryParams.push(`$filter=${filters.join(' and ')}`);
  }

  return request('GET', `/Roles?${queryParams.join('&')}`);
};

export const getRole = (id: string) => request('GET', `/Roles('${id}')?$expand=ownRestrictions,orgNode,parentRoles($expand=parent),approvers,environment`);
export const createRole = (body: any) => request('POST', '/Roles', body);
export const updateRole = (id: string, body: any) => request('PATCH', `/Roles('${id}')`, body);
export const deleteRole = (id: string) => request('DELETE', `/Roles('${id}')`);
export const createRoleInheritance = (body: any) => request('POST', '/RoleInheritance', body);
export const deleteRoleInheritance = (id: string | number) => request('DELETE', `/RoleInheritance(${id})`);
export const createRoleApprover = (body: any) => request('POST', '/RoleApprovers', body);
export const deleteRoleApprover = (id: string | number) => request('DELETE', `/RoleApprovers(${id})`);

// Restrictions
export const createRestriction = (body: any) => request('POST', '/Restrictions', body);
export const updateRestriction = (id: string | number, body: any) => request('PATCH', `/Restrictions(${id})`, body);
export const deleteRestriction = (id: string | number) => request('DELETE', `/Restrictions(${id})`);
export const getRestrictionFields = () => request('GET', '/RestrictionFields?$expand=bdcConnection');
export const createRestrictionField = (body: any) => request('POST', '/RestrictionFields', body);
export const updateRestrictionField = (id: string, body: any) => request('PATCH', `/RestrictionFields('${id}')`, body);
export const deleteRestrictionField = (id: string) => request('DELETE', `/RestrictionFields('${id}')`);

// Access Domains
export const getAccessDomainsFlat = () => request('GET', '/AccessDomains?$expand=attributes,type,restrictionFields($expand=field)');
export const createAccessDomainNode = (body: any) => request('POST', '/AccessDomains', body);
export const updateAccessDomainNode = (id: string, body: any) => request('PATCH', `/AccessDomains('${id}')`, body);
export const deleteAccessDomainNode = (id: string) => request('DELETE', `/AccessDomains('${id}')`);
export const createAccessDomainAttr = (body: any) => request('POST', '/AccessDomainAttributes', body);
export const deleteAccessDomainAttr = (id: string | number) => request('DELETE', `/AccessDomainAttributes(${id})`);
export const createAccessDomainField = (body: any) => request('POST', '/AccessDomainFields', body);
export const deleteAccessDomainField = (id: string) => request('DELETE', `/AccessDomainFields('${id}')`);

// Assignments
export const getAssignments = () => request('GET', '/RoleAssignments?$expand=role');
export const getRoleAssignments = getAssignments;
export const createAssignment = (body: any) => request('POST', '/RoleAssignments', body);
export const deleteAssignment = (id: string | number) => request('DELETE', `/RoleAssignments(${id})`);

// BDC Settings
export const getBdcSettings = () => request('GET', '/BdcSettings?$expand=environment');
export const createBdcSetting = (body: any) => request('POST', '/BdcSettings', body);
export const updateBdcSetting = (id: string, body: any) => request('PATCH', `/BdcSettings('${id}')`, body);
export const deleteBdcSetting = (id: string) => request('DELETE', `/BdcSettings('${id}')`);
export const testBdcConnection = (settingId: string) => request('POST', '/testBdcConnection', { settingId });
// fetchBdcSpaces: dual signature — connectionId (saved connection) OR direct credentials (during creation)
export const fetchBdcSpaces = (connectionIdOrUrl: string, tokenUrl?: string, clientId?: string, clientSecret?: string) => {
  if (tokenUrl) {
    // Direct credentials mode (used during BdcSettings creation before save)
    return request('POST', '/fetchBdcSpaces', { url: connectionIdOrUrl, tokenUrl, clientId, clientSecret });
  }
  // Connection ID mode (preferred)
  return request('POST', '/fetchBdcSpaces', { connectionId: connectionIdOrUrl });
};
export const fetchBdcAssets = (connectionId: string) => request('POST', '/fetchBdcAssets', { connectionId });
export const fetchBdcRelationalValues = (connectionId: string, space: string, asset: string, assetText?: string, idColumns?: string[], textColumn?: string) => request('POST', '/fetchBdcRelationalValues', { connectionId, space, asset, assetText, idColumns, textColumn });
export const fetchBdcAssetColumns = (connectionId: string, space: string, asset: string) => request('POST', '/fetchBdcAssetColumns', { connectionId, space, asset });
export const fetchBdcAssetKeyColumns = (connectionId: string, space: string, asset: string) => request('POST', '/fetchBdcAssetKeyColumns', { connectionId, space, asset });

// Actions
export const generateOrgRole = (orgNodeId: string) => request('POST', '/generateOrgRole', { orgNodeId });
export const generateAllOrgRoles = () => request('POST', '/generateAllOrgRoles');
export const resolveEffective = (roleId: string) => request('POST', '/resolveEffectiveRestrictions', { roleId });
export const simulateAccess = (roleId: string, rows: any[], restrictions?: any[]) => request('POST', '/simulateAccess', { roleId, sampleData: JSON.stringify(rows), restrictions: restrictions ? JSON.stringify(restrictions) : undefined });
export const searchScimUsers = (query: string) => request('POST', '/searchScimUsers', { query });
export const fetchRawBdcSpaces = (connectionId: string) => request('POST', '/fetchRawBdcSpaces', { connectionId });
export const fetchRawBdcAssets = (connectionId: string) => request('POST', '/fetchRawBdcAssets', { connectionId });
export const fetchRawBdcUsers = (connectionId: string) => request('POST', '/fetchRawBdcUsers', { connectionId });
export const fetchRawBdcRelationalValues = (connectionId: string, space: string, asset: string) => request('POST', '/fetchRawBdcRelationalValues', { connectionId, space, asset });
export const fetchRawBdcAssetColumns = (connectionId: string, space: string, asset: string) => request('POST', '/fetchRawBdcAssetColumns', { connectionId, space, asset });
export const fetchRawHanaViews = (settingId: string) => request('POST', '/fetchRawHanaViews', { settingId });
export const runBdcTaskChain = (connectionId: string, space: string, taskChainId: string) => request('POST', '/runBdcTaskChain', { connectionId, space, taskChainId });
export const fetchBdcTaskChainLog = (connectionId: string, space: string, logId: string) => request('POST', '/fetchBdcTaskChainLog', { connectionId, space, logId });
export const fetchBdcAssociations = (connectionId: string, space: string, asset: string) => request('POST', '/fetchBdcAssociations', { connectionId, space, asset });
export const getAuditLogs = () => request('GET', '/AuditLogs?$orderby=createdAt desc');
export const getEnvironments = () => request('GET', '/Environments');

export const getAppAuthorizations = () => request('GET', '/AppAuthorizations');
export const createAppAuthorization = (body: any) => request('POST', '/AppAuthorizations', body);
export const updateAppAuthorization = (id: string, body: any) => request('PATCH', `/AppAuthorizations('${id}')`, body);
export const deleteAppAuthorization = (id: string) => request('DELETE', `/AppAuthorizations('${id}')`);

// Replications
export const getReplications = () => request('GET', '/Replications?$orderby=replicationDate desc');
export const triggerReplication = () => request('POST', '/triggerReplication', {});
export const checkReplicationStatuses = () => request('POST', '/checkReplicationStatuses', {});

// Dynamic Rules & Customers
export const getDynamicRules = () => request('GET', '/DynamicGenerationRules?$expand=templateRole,mappings,bdcConnection');
export const createDynamicRule = (body: any) => request('POST', '/DynamicGenerationRules', body);
export const updateDynamicRule = (id: string, body: any) => request('PATCH', `/DynamicGenerationRules('${id}')`, body);
export const deleteDynamicRule = (id: string) => request('DELETE', `/DynamicGenerationRules('${id}')`);
export const syncDynamicRule = (ruleId: string) => request('POST', '/syncDynamicRule', { ruleId });

// Customers
export const getCustomers = () => request('GET', '/Customers');
export const createCustomer = (body: any) => request('POST', '/Customers', body);
export const updateCustomer = (id: string, body: any) => request('PATCH', `/Customers('${id}')`, body);
export const deleteCustomer = (id: string) => request('DELETE', `/Customers('${id}')`);

export const getDashboardKpis = () => request('GET', '/getDashboardKpis()');
export const getRecentRoles = () => request('GET', '/Roles?$orderby=createdAt desc&$top=20&$expand=parentRoles($expand=parent)');
export const getUserEffectiveAuthorizations = (userId: string) => request('GET', `/getUserEffectiveAuthorizations(userId='${encodeURIComponent(userId)}')`);
