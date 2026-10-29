export interface Restriction {
  filterType: string;
  value: string;
  field?: string;
  [key: string]: any;
}

export interface OrgNode {
  ID: string;
  parent_ID?: string;
  parent?: { ID: string };
  name?: string;
  [key: string]: any;
}

export interface Role {
  ID: string;
  name: string;
  type: string;
  description?: string;
  environment_ID: string;
  accessDomain_ID: string;
  approvers?: { userId: string }[];
  ownRestrictions?: Restriction[];
  parentRoles?: { parent_ID?: string; parent?: { ID: string; name?: string } }[];
  assignments?: any[];
  critical?: boolean;
}

export const ENV_LABEL: Record<string, string> = {
  P: 'Production',
  Q: 'Quality Assurance',
  D: 'Development'
};

export const ENV_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  P: 'error',
  Q: 'warning',
  D: 'info'
};

const sharedDateTimeFormatter =
  typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null;

// Helper to format ISO datetime strings
export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';
  if (sharedDateTimeFormatter) {
    return sharedDateTimeFormatter.format(date);
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

// Helper to determine if a specific restriction is critical
export function isCriticalRestriction(r: Restriction, orgNodes: OrgNode[] = []): boolean {
  const type = r.filterType;
  const val = r.value || '';
  if (type === 'SINGLE_VALUE') {
    return val.toUpperCase() === 'ALL';
  }
  if (type === 'MULTI_VALUE') {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.some(v => String(v).toUpperCase() === 'ALL')) {
        return true;
      }
    } catch (e) {
      if (val.toUpperCase() === 'ALL') return true;
    }
  }
  if (type === 'CP') {
    return val.includes('%');
  }
  if (type === 'HIERARCHY') {
    const node = orgNodes.find(n => n.ID === val);
    if (node) {
      return !node.parent_ID && (!node.parent || !node.parent.ID);
    }
  }
  return false;
}

const scopeParseCache = new Map<string, { isJson: boolean; set: Set<string> }>();

/**
 * Helper to check if a specific role ID/name is within the permitted scope.
 * Handles both JSON arrays and comma-separated string fallbacks.
 */
export function isRoleInScope(roleId: string, roleName: string | undefined, scope: string | undefined): boolean {
  if (!scope || scope.trim() === '' || scope.trim().toUpperCase() === 'ALL' || scope.trim() === '*') {
    return true;
  }

  let parsed = scopeParseCache.get(scope);
  if (!parsed) {
    try {
      const scopeList = JSON.parse(scope);
      if (Array.isArray(scopeList)) {
        parsed = {
          isJson: true,
          set: new Set(scopeList.map((s) => String(s?.roleId || '')).filter(Boolean))
        };
      }
    } catch (_e) {
      // Fallback below
    }
    if (!parsed) {
      parsed = {
        isJson: false,
        set: new Set(scope.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
      };
    }
    if (scopeParseCache.size > 100) scopeParseCache.clear();
    scopeParseCache.set(scope, parsed);
  }

  if (parsed.isJson) {
    return parsed.set.has(roleId) || Boolean(roleName && parsed.set.has(roleName));
  }
  return parsed.set.has((roleId || '').toLowerCase()) || parsed.set.has((roleName || '').toLowerCase());
}


export function canDeriveFromRole(role: Role, permissions: any): boolean {
  if (permissions?.isSuperAdmin) return true;
  if (!permissions) return false;
  if (!permissions.canManageDerivedRoles) return false;
  return isRoleInScope(role.ID, role.name, permissions.managedDerivedRolesScope);
}

export function isPatternRestriction(r: Restriction): boolean {
  if (!r) return false;
  const ft = (r.filterType || '').toUpperCase();
  const val = String(r.value || '').trim();
  if (ft === 'ALL' || ft === 'CP' || ft === 'PATTERN') return true;
  if (val === '*' || val.includes('*') || val.includes('?')) return true;
  return false;
}
