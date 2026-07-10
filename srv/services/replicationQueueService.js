'use strict';

/**
 * ReplicationQueueService
 *
 * Manages the lifecycle of replication queue entries (fanrio.auth.Replications):
 *   - queueReplication()                   — dedup-insert an open replication record
 *   - checkAndUpdateRunningReplications()  — poll BDC task-chain logs, update statuses
 *   - triggerReplicationHandler()          — full triggerReplication OData action body
 *
 * Previously embedded as nested helpers + handler in authorization-service.js (L41-66, L843-1089).
 */

const { isMockUrl } = require('../lib/urlUtils');

const REPLICATION_STATUS = {
  OPEN: 'Open',
  RUNNING: 'Running',
  SUCCESS: 'Success',
  FAILED: 'Failed'
};

/**
 * Inserts a new 'Open' replication record for the given role, unless one already exists.
 *
 * @param {object} cds           - CAP cds instance
 * @param {object} Replications  - CAP entity descriptor
 * @param {string} roleName      - name of the role that changed
 * @param {string} environmentId - target environment (default 'D')
 * @param {string} user          - user who triggered the change
 */
async function queueReplication(cds, Replications, roleName, environmentId, user) {
  if (!roleName) return;
  try {
    const envId = environmentId || 'D';
    const existing = await cds.db.run(
      SELECT.one.from(Replications).where({ replicationRoles: roleName, environment_ID: envId, status: REPLICATION_STATUS.OPEN })
    );
    if (existing) return; // already queued — avoid duplicates

    await cds.db.run(INSERT.into(Replications).entries({
      ID:               cds.utils.uuid(),
      replicationDate:  new Date().toISOString(),
      status:           REPLICATION_STATUS.OPEN,
      replicationRoles: roleName,
      environment_ID:   envId,
      user:             user || 'system'
    }));
  } catch (err) {
    console.error('[ReplicationQueue] Failed to queue replication for role change:', err.message);
  }
}

/**
 * Polls BDC task-chain logs for all 'Running' replications and updates their DB status.
 *
 * @param {object} cds         - CAP cds instance
 * @param {object} entities    - { Replications, BdcSettings }
 * @param {object} BdcClient   - injected BDC client
 * @returns {{ success: boolean, message: string }}
 */
async function checkAndUpdateRunningReplications(cds, entities, BdcClient) {
  const db = cds.db;
  const { Replications, BdcSettings } = entities;

  const runningReps = await db.run(SELECT.from(Replications).where({ status: REPLICATION_STATUS.RUNNING }));
  if (runningReps.length === 0) {
    return { success: true, message: 'No running replications.' };
  }

  const runIds  = Array.from(new Set(runningReps.map(r => r.runId).filter(Boolean)));
  const results = [];
  const errors  = [];

  for (const runId of runIds) {
    try {
      const repSample = runningReps.find(r => r.runId === runId);
      const envId     = repSample ? repSample.environment_ID : 'D';

      const activeSetting = await db.run(
        SELECT.one.from(BdcSettings).where({ connectionType: 'OData', isActive: true, environment_ID: envId })
      );
      if (!activeSetting) {
        errors.push(`Run ${runId}: No active BDC connection for environment: ${envId}`);
        continue;
      }

      const { url, tokenUrl, clientId, clientSecret, space } = activeSetting;
      if (!url || !tokenUrl || !clientId || !clientSecret || !space) {
        errors.push(`Run ${runId}: Active BDC connection for environment ${envId} is missing parameters.`);
        continue;
      }

      let status     = 'RUNNING';
      let finishedAt = null;

      if (isMockUrl(url)) {
        const startedMs = parseInt(runId.replace('mock-log-', '')) || Date.now();
        if (runId.includes('complete') || Date.now() - startedMs > 10000) {
          status     = 'COMPLETED';
          finishedAt = new Date().toISOString();
        }
      } else {
        const token    = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
        const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/logs/${space.trim()}/${runId.trim()}`;
        const res      = await fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept':        'application/vnd.sap.datasphere.task.log.details+json, application/json'
          }
        });
        if (res.ok) {
          const data = await res.json();
          status     = data.status || 'RUNNING';
          finishedAt = data.endTime || data.finishedAt || data.endedAt || new Date().toISOString();
        } else {
          const errBody = await res.text().catch(() => '');
          throw new Error(`Log request failed with status ${res.status}: ${errBody}`);
        }
      }

      const now = finishedAt || new Date().toISOString();
      if (status === 'COMPLETED') {
        await db.run(UPDATE(Replications).set({ status: REPLICATION_STATUS.SUCCESS,  replicationDate: now, endTime: now }).where({ runId, status: REPLICATION_STATUS.RUNNING }));
        results.push(`Run ${runId} completed successfully.`);
      } else if (status === 'FAILED' || status === 'ABORTED') {
        await db.run(UPDATE(Replications).set({ status: REPLICATION_STATUS.FAILED, replicationDate: now, endTime: now }).where({ runId, status: REPLICATION_STATUS.RUNNING }));
        results.push(`Run ${runId} failed or aborted.`);
      } else {
        results.push(`Run ${runId} is still running.`);
      }
    } catch (err) {
      errors.push(`Run ${runId} check failed: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      message: `Checked statuses with partial errors. Results: [${results.join('; ')}]. Errors: [${errors.join('; ')}]`
    };
  }
  return { success: true, message: `Checked statuses: ${results.join('; ')}` };
}

/**
 * OData action handler for triggerReplication.
 * Triggers BDC task chains for all environments that have pending Open/Failed replications.
 *
 * @param {object} cds        - CAP cds instance
 * @param {object} entities   - { Replications, BdcSettings }
 * @param {object} BdcClient  - injected BDC client
 * @returns {Function}        - async CAP request handler (req) => result
 */
function makeTriggerReplicationHandler(cds, entities, BdcClient) {
  return async function triggerReplicationHandler(req) {
    const db = cds.db;
    const { Replications, BdcSettings } = entities;

    // 1. Refresh statuses of currently Running task chains
    await checkAndUpdateRunningReplications(cds, entities, BdcClient).catch(err => {
      console.error('[ReplicationQueue] Error auto-refreshing running statuses:', err.message);
    });

    // 2. Fetch all pending Open or Failed replications
    const openReps = await db.run(SELECT.from(Replications).where({ status: { in: [REPLICATION_STATUS.OPEN, REPLICATION_STATUS.FAILED] } }));
    if (openReps.length === 0) {
      return { success: true, message: 'No pending or failed changes to replicate.' };
    }

    // 3. Identify unique environments
    let envIds = Array.from(new Set(openReps.map(r => r.environment_ID).filter(Boolean)));
    if (envIds.length === 0) envIds.push('D');

    const results = [];
    const errors  = [];

    // 4. Trigger BDC task chain per environment
    for (const envId of envIds) {
      const activeSetting = await db.run(
        SELECT.one.from(BdcSettings).where({ connectionType: 'OData', isActive: true, environment_ID: envId })
      );
      if (!activeSetting) {
        errors.push(`No active BDC connection configured for environment: ${envId}`);
        continue;
      }

      const { url, tokenUrl, clientId, clientSecret, space, taskChainFlat } = activeSetting;
      if (!url || !tokenUrl || !clientId || !clientSecret || !space || !taskChainFlat) {
        errors.push(`Active BDC connection for environment ${envId} is missing parameters.`);
        continue;
      }

      try {
        const runStartTime = new Date().toISOString();
        let success      = false;
        let responseData = null;

        if (isMockUrl(url)) {
          success      = true;
          responseData = { logId: `mock-log-${Date.now()}`, status: 'RUNNING', spaceId: space, taskChainId: taskChainFlat, startedAt: runStartTime };
        } else {
          const token    = await BdcClient.getAccessToken(tokenUrl, clientId, clientSecret);
          const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/chains/${space.trim()}/run/${taskChainFlat.trim()}`;
          const res      = await fetch(endpoint, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body:    JSON.stringify({})
          });
          if (res.ok) {
            success      = true;
            responseData = await res.json().catch(() => ({}));
          } else {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Task chain run request failed: ${res.status} ${res.statusText}. Response: ${errBody}`);
          }
        }

        const runUser   = req?.user?.id || 'system';
        const finalLogId = responseData && (responseData.logId || responseData.runId || `run-${Date.now()}`);

        if (success) {
          await db.run(UPDATE(Replications)
            .set({ status: REPLICATION_STATUS.RUNNING, replicationDate: runStartTime, startTime: runStartTime, user: runUser, runId: String(finalLogId) })
            .where({ environment_ID: envId, status: { in: [REPLICATION_STATUS.OPEN, REPLICATION_STATUS.FAILED] } }));
          results.push(`Environment ${envId}: Started replication (Run ID: ${finalLogId}) via ${activeSetting.systemName}`);
        } else {
          errors.push(`Environment ${envId}: Replication failed to trigger.`);
        }
      } catch (e) {
        errors.push(`Environment ${envId} Error: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      if (results.length > 0) {
        return { success: false, message: `Partial replication. Successes: [${results.join('; ')}]. Errors: [${errors.join('; ')}]` };
      }
      return req.error(500, `Replication failed: ${errors.join('; ')}`);
    }
    return { success: true, message: `All environments replicated: ${results.join('; ')}` };
  };
}

module.exports = { queueReplication, checkAndUpdateRunningReplications, makeTriggerReplicationHandler };
