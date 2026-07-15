'use strict';

const cds = require('@sap/cds');
const { getUserId, getSessionPermissions, requirePermission } = require('../lib/authGuard');
const { syncDynamicRule } = require('../services/dynamicSyncService');

function registerAppAuthorizationsHandlers(service, entities) {
  const { AppAuthorizations, AuditLogs, DynamicGenerationRules } = entities;

  // AppAuthorizations CRUD protection
  service.before('*', 'AppAuthorizations', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageAppUsers', req);
  });

  // Action searchScimUsers protection
  service.before('searchScimUsers', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canManageAppUsers', req);
  });

  // AuditLogs protection
  service.before('READ', 'AuditLogs', async (req) => {
    const perms = await getSessionPermissions(req, cds.db, AppAuthorizations);
    requirePermission(perms, 'canViewAuditLogs', req);
  });

  // Audit Logs for AppAuthorizations changes
  service.after(['CREATE', 'UPDATE', 'DELETE'], 'AppAuthorizations', async (result, req) => {
    try {
      const userId = getUserId(req);
      let targetName = result?.userId || req.data?.userId;
      let recordId = result?.ID || req.data?.ID;
      if (!recordId && req.params?.length > 0) {
        const p = req.params[0];
        recordId = typeof p === 'object' ? p.ID : p;
      }
      if (!targetName && recordId) {
        const target = await cds.db.run(SELECT.one.from(AppAuthorizations).where({ ID: recordId }));
        targetName = target?.userId;
      }

      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID:         cds.utils.uuid(),
        entityName: 'AppAuthorizations',
        action:     req.event,
        recordId:   recordId || 'unknown',
        targetName: targetName || 'unknown',
        details:    JSON.stringify({ changedBy: userId, data: req.data || result })
      }));
    } catch (err) {
      console.error('[AppAuthorizationsHandlers] Audit Log failed for AppAuthorizations changes:', err.message);
    }
  });

  // Customers DRAGE sync reconciliation trigger
  service.after(['CREATE', 'UPDATE', 'DELETE'], 'Customers', async (data, req) => {
    try {
      const activeRules = await cds.db.run(
        SELECT.from(DynamicGenerationRules)
          .where({ isActive: true })
      );
      for (const rule of activeRules) {
        if (rule.sourceEntity === 'Customers' || rule.sourceEntity === 'fanrio.auth.Customers') {
          await syncDynamicRule(rule.ID, cds);
        }
      }
    } catch (err) {
      console.error('[AppAuthorizationsHandlers] Failed to trigger dynamic rules synchronization:', err.message);
    }
  });
}

module.exports = { registerAppAuthorizationsHandlers };
