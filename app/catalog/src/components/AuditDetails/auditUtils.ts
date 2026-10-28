export function parseLogDetails(log: any): Record<string, any> {
  if (!log || !log.details) return {};
  try {
    return typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
  } catch {
    return { raw: log.details };
  }
}

export function formatAuditValue(val: any, formatObjectsAsEntries = false): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'None';
    return val.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  }
  if (typeof val === 'object') {
    if (formatObjectsAsEntries) {
      return Object.entries(val)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('; ');
    }
    return JSON.stringify(val);
  }
  return String(val);
}

export function resolveAccessDomainName(
  domainId: string | undefined,
  accessDomains: any[] = [],
  details?: Record<string, any>
): string | undefined {
  if (!domainId) return details?.accessDomain?.name;
  if (details?.accessDomain?.name && details.accessDomain_ID === domainId) {
    return details.accessDomain.name;
  }
  const found = (accessDomains || []).find(d => d.ID === domainId || d.name === domainId);
  return found ? found.name : domainId;
}

export function resolveRoleName(
  roleId: string | undefined,
  roles: any[] = [],
  fallbackName?: string
): string | undefined {
  if (fallbackName) return fallbackName;
  if (!roleId) return undefined;
  const found = (roles || []).find(r => r.ID === roleId || r.name === roleId);
  return found ? found.name : roleId;
}

export function consolidateAuditLogs(rawLogs: any[] = []): any[] {
  const consolidated: any[] = [];
  const sorted = [...rawLogs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const log of sorted) {
    const match = consolidated.find(
      c =>
        c.recordId === log.recordId &&
        c.action === log.action &&
        c.createdBy === log.createdBy &&
        Math.abs(new Date(c.createdAt).getTime() - new Date(log.createdAt).getTime()) < 5000
    );

    if (match) {
      try {
        const matchParsed = JSON.parse(match.details);
        const logParsed = JSON.parse(log.details);
        const merged: Record<string, any> = { ...logParsed };
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
      } catch (e: any) {
        console.warn('[AuditLogsView] Failed to merge duplicate log details:', e?.message);
        consolidated.push({ ...log });
      }
    } else {
      consolidated.push({ ...log });
    }
  }

  const finalLogs: any[] = [];
  for (const log of consolidated) {
    try {
      const parsed = JSON.parse(log.details);
      const keys = Object.keys(parsed);
      const addedKeys = keys.filter(k => k.startsWith('Restriction Added'));
      const deletedKeys = keys.filter(k => k.startsWith('Restriction Deleted'));
      const removedKeys = new Set<string>();

      for (const aKey of addedKeys) {
        const aNew = parsed[aKey]?.new || '';
        const aField = aNew.match(/Field:\s*([^,]+)/)?.[1];
        const aType = aNew.match(/Type:\s*([^,]+)/)?.[1];
        const aVal = aNew.match(/Value:\s*(.+)$/)?.[1];

        for (const dKey of deletedKeys) {
          if (removedKeys.has(dKey)) continue;
          const dOld = parsed[dKey]?.old || '';
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

      const filteredDetails: Record<string, any> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (!removedKeys.has(k)) {
          filteredDetails[k] = v;
        }
      }

      if (Object.keys(filteredDetails).length > 0) {
        log.details = JSON.stringify(filteredDetails);
        finalLogs.push(log);
      }
    } catch {
      finalLogs.push(log);
    }
  }
  return finalLogs;
}

function matchesDateRange(createdAt: string, dateFilter: string, startDate: any, endDate: any): boolean {
  if (dateFilter === 'ALL') return true;
  const logDate = new Date(createdAt);
  const today = new Date();

  if (dateFilter === 'TODAY') {
    return (
      logDate.getDate() === today.getDate() &&
      logDate.getMonth() === today.getMonth() &&
      logDate.getFullYear() === today.getFullYear()
    );
  }
  if (dateFilter === 'WEEK') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return logDate >= weekAgo;
  }
  if (dateFilter === 'MONTH') {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    return logDate >= monthAgo;
  }
  if (dateFilter === 'CUSTOM') {
    if (startDate && logDate < startDate.startOf('day').toDate()) return false;
    if (endDate && logDate > endDate.endOf('day').toDate()) return false;
  }
  return true;
}

function isCriticalAuditLog(log: any, roles: any[]): boolean {
  let roleId: string | null = null;
  if (log.entityName === 'Roles') {
    roleId = log.recordId;
  } else if (log.entityName === 'RoleAssignments') {
    const parsed = parseLogDetails(log);
    roleId = parsed.role_ID?.new || parsed.role_ID?.old || parsed.role_ID || parsed.role?.ID || null;
  }
  if (!roleId) return false;
  const role = roles.find(r => r.ID === roleId);
  return Boolean(role?.critical);
}

export interface AuditLogFilters {
  search: string;
  actionFilter: string;
  entityFilter: string;
  actorFilter: string;
  dateFilter: string;
  startDate: any;
  endDate: any;
  criticalFilter: boolean;
}

export function filterAuditLogs(logs: any[], filters: AuditLogFilters, roles: any[] = []): any[] {
  const query = filters.search.toLowerCase();
  return logs.filter(log => {
    const matchesSearch =
      !query ||
      log.recordId?.toLowerCase().includes(query) ||
      log.targetName?.toLowerCase().includes(query) ||
      log.details?.toLowerCase().includes(query) ||
      log.createdBy?.toLowerCase().includes(query);

    const matchesAction = filters.actionFilter === 'ALL' || log.action === filters.actionFilter;
    const matchesEntity = filters.entityFilter === 'ALL' || log.entityName === filters.entityFilter;
    const matchesActor = filters.actorFilter === 'ALL' || log.createdBy === filters.actorFilter;
    const matchesDate = matchesDateRange(log.createdAt, filters.dateFilter, filters.startDate, filters.endDate);
    const matchesCritical = !filters.criticalFilter || isCriticalAuditLog(log, roles);

    return matchesSearch && matchesAction && matchesEntity && matchesActor && matchesDate && matchesCritical;
  });
}
