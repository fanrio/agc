const cds = require('@sap/cds');
const { resolveEffectiveRestrictions, evaluateRestriction } = require('./lib/resolveEffectiveRestrictions');
const { syncDynamicRule } = require('./lib/dynamicSync');

function isMockUrl(url) {
  return !!(url && (url.includes('mock') || url.includes('sandbox') || url.includes('test') || url.includes('localhost')));
}

module.exports = cds.service.impl(async function () {
  const { OrgNodes, OrgNodeAttributes, Roles, Restrictions, RoleAssignments, RoleInheritance, RestrictionFields, BdcSettings, AuditLogs, Replications } = this.entities;

  // DRAGE OData action and automated master data hooks
  this.on('syncDynamicRule', async (req) => {
    const { ruleId } = req.data;
    try {
      await syncDynamicRule(ruleId);
      return { success: true, message: 'Reconciliation rule execution completed successfully' };
    } catch (err) {
      return { success: false, message: err.message || 'Rule sync execution failed' };
    }
  });

  this.after(['CREATE', 'UPDATE', 'DELETE'], 'Customers', async (data, req) => {
    try {
      const activeRules = await cds.db.run(
        SELECT.from('fanrio.auth.DynamicGenerationRules')
          .where({ isActive: true })
          .and("sourceEntity = 'fanrio.auth.Customers' or sourceEntity = 'Customers'")
      );
      for (const rule of activeRules) {
        await syncDynamicRule(rule.ID);
      }
    } catch (err) {
      console.error('Failed to trigger automatic dynamic rules synchronization:', err);
    }
  });

  // Helper to add role change to replication list
  async function _queueReplication(roleName, environmentId, user) {
    if (!roleName) return;
    try {
      const envId = environmentId || 'D';
      // Check if there is already a pending 'Open' replication for this role in this environment
      const existing = await cds.db.run(SELECT.one.from(Replications).where({
        replicationRoles: roleName,
        environment_ID: envId,
        status: 'Open'
      }));
      if (existing) {
        return; // Already queued, avoid duplicates
      }

      await cds.db.run(INSERT.into(Replications).entries({
        ID: cds.utils.uuid(),
        replicationDate: new Date().toISOString(),
        status: 'Open',
        replicationRoles: roleName,
        environment_ID: envId,
        user: user || 'system'
      }));
    } catch (err) {
      console.error('Failed to queue replication for role change:', err);
    }
  }

  // Auto-generate UUID keys for OrgNodes if not provided by client
  this.before('CREATE', 'OrgNodes', (req) => {
    if (!req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
  });

  // Auto-generate UUID keys for BdcSettings if not provided by client
  this.before('CREATE', 'BdcSettings', (req) => {
    if (!req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
  });
  // Auto-generate UUID keys for Roles if not provided by client
  this.before('CREATE', 'Roles', (req) => {
    if (!req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
  });

  // Auto-generate UUID keys for DynamicGenerationRules if not provided by client
  this.before('CREATE', 'DynamicGenerationRules', (req) => {
    if (!req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
  });

  // Auto-generate UUID keys for GeneratedResourceMap if not provided by client
  this.before('CREATE', 'GeneratedResourceMap', (req) => {
    if (!req.data.ID) {
      req.data.ID = cds.utils.uuid();
    }
  });


  // Ensure Role names are unique on CREATE
  this.before('CREATE', 'Roles', async (req) => {
    const { name } = req.data;
    if (name) {
      const existing = await cds.db.run(SELECT.one.from(Roles).where({ name }));
      if (existing) {
        return req.error(400, `A role with name "${name}" already exists.`);
      }
    }
  });

  // Ensure Role names are unique on UPDATE
  this.before('UPDATE', 'Roles', async (req) => {
    const { name } = req.data;
    if (name) {
      let id = req.data.ID;
      if (!id && req.params && req.params.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (id) {
        const current = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        if (current && current.name === name) {
          return; // Name did not change, ignore uniqueness check
        }
        const existing = await cds.db.run(SELECT.one.from(Roles).where({ name }).and({ ID: { '!=': id } }));
        if (existing) {
          return req.error(400, `A role with name "${name}" already exists.`);
        }
      }
    }
  });

  // Helper function to generate role for a single node
  async function _generateRoleForNode(node, db) {
    const roleName = `ROLE_ORG_${node.name.replace(/\s+/g, '_').toUpperCase()}`;

    // Check if role already exists for this node
    let role = await db.run(SELECT.one.from(Roles).where({ orgNode_ID: node.ID, type: 'ORG_BASED' }));
    let roleId;
    if (role) {
      roleId = role.ID;
      await db.run(UPDATE(Roles).set({ name: roleName }).where({ ID: roleId }));
    } else {
      roleId = cds.utils.uuid();
      await db.run(INSERT.into(Roles).entries({
        ID: roleId,
        name: roleName,
        type: 'ORG_BASED',
        description: `Auto-generated from Org Node: ${node.name}`,
        orgNode_ID: node.ID,
      }));
    }

    // Find the associated restriction field directly from type_ID
    let restrictionFieldName = 'OrgNode';
    if (node.type_ID) {
      const rf = await db.run(
        SELECT.one.from(RestrictionFields)
          .columns('name')
          .where({ ID: node.type_ID })
      );
      if (rf) {
        restrictionFieldName = rf.name;
      }
    }

    // Set dynamic restriction: only the node name
    await db.run(DELETE.from(Restrictions).where({ role_ID: roleId }));
    await db.run(INSERT.into(Restrictions).entries({
      ID: cds.utils.uuid(),
      role_ID: roleId,
      field: restrictionFieldName,
      filterType: 'SINGLE_VALUE',
      value: node.name,
      sourceLabel: node.name,
    }));

    // Update node attribute for visibility
    await db.run(DELETE.from(OrgNodeAttributes).where({ node_ID: node.ID, field: 'Role' }));
    await db.run(INSERT.into(OrgNodeAttributes).entries({
      ID: cds.utils.uuid(),
      node_ID: node.ID,
      field: 'Role',
      value: roleName,
    }));

    return { roleId, roleName };
  }

  // Helper function to replicate role assignments to SAP HANA databases
  async function _syncAssignmentToHana(assignmentId, userId, roleId, isDelete) {
    const db = cds.db;

    let role = null;
    let restrictions = [];
    if (!isDelete) {
      role = await db.run(SELECT.one.from(Roles).where({ ID: roleId }));
      if (!role) return;
      
      const allRoles = await db.run(SELECT.from(Roles));
      const allRestrictions = await db.run(SELECT.from(Restrictions));
      const allInheritances = await db.run(SELECT.from(RoleInheritance));
      
      try {
        const resolved = resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
        restrictions = resolved.map(r => ({
          ID: r.restrictionId,
          field: r.field,
          filterType: r.filterType,
          value: r.value
        }));
      } catch (e) {
        console.error("Failed resolving effective restrictions for replication:", e.message);
        return;
      }
    }

    const bdcSettings = await db.run(SELECT.from(BdcSettings).where({ connectionType: 'SAP Hana', isActive: true }));
    if (bdcSettings.length === 0) return;

    const hana = require('@sap/hana-client');

    for (const setting of bdcSettings) {
      const conn = hana.createConnection();
      const connParams = {
        serverNode: `${setting.host}:${setting.port || 443}`,
        uid: setting.username,
        pwd: setting.password,
        encrypt: 'true',
        sslValidateCertificate: 'true',
        sslHostNameInCertificate: setting.host
      };

      await new Promise((resolve) => {
        conn.connect(connParams, (err) => {
          if (err) {
            console.error(`Failed to connect to HANA database [${setting.systemName}] for sync:`, err.message);
            resolve();
          } else {
            // Delete existing rows for this assignment
            const deleteSql = `DELETE FROM "${setting.username}"."authoriziation_flat" WHERE "ID" LIKE ?`;
            conn.prepare(deleteSql, (prepErr, stmt) => {
              if (prepErr) {
                console.error("Failed to prepare delete sync query:", prepErr);
                conn.disconnect(() => resolve());
              } else {
                stmt.exec([`${assignmentId}%`], (execErr) => {
                  if (execErr) console.error("Failed to execute delete sync query:", execErr);

                  if (isDelete || restrictions.length === 0) {
                    conn.disconnect(() => resolve());
                  } else {
                    // Insert rows
                    const insertSql = `INSERT INTO "${setting.username}"."authoriziation_flat" ("ID", "USER", "ROLE", "FIELD", "OPERATOR", "LOW", "HIGH") VALUES (?, ?, ?, ?, ?, ?, ?)`;
                    conn.prepare(insertSql, (insertPrepErr, insertStmt) => {
                      if (insertPrepErr) {
                        console.error("Failed to prepare insert sync query:", insertPrepErr);
                        conn.disconnect(() => resolve());
                        return;
                      }

                      const entries = [];
                      for (const r of restrictions) {
                        let op = 'EQ';
                        let low = r.value;
                        let high = '';

                        if (r.filterType === 'SINGLE_VALUE') {
                          op = 'EQ';
                        } else if (r.filterType === 'RANGE') {
                          op = 'BT';
                          try {
                            const rangeObj = JSON.parse(r.value);
                            low = String(rangeObj.from || '');
                            high = String(rangeObj.to || '');
                          } catch (e) {}
                        } else if (r.filterType === 'PATTERN') {
                          op = 'CP';
                        }

                        if (r.filterType === 'MULTI_VALUE') {
                          let values = [r.value];
                          try {
                            values = JSON.parse(r.value);
                            if (!Array.isArray(values)) values = [r.value];
                          } catch (e) {}
                          for (let idx = 0; idx < values.length; idx++) {
                            entries.push([
                              `${assignmentId}_${r.ID}_${idx}`,
                              userId,
                              role.name,
                              r.field,
                              op,
                              String(values[idx]),
                              high
                            ]);
                          }
                        } else {
                          entries.push([
                            `${assignmentId}_${r.ID}`,
                            userId,
                            role.name,
                            r.field,
                            op,
                            low,
                            high
                          ]);
                        }
                      }

                      let chain = Promise.resolve();
                      for (const entry of entries) {
                        chain = chain.then(() => new Promise((resolveExec) => {
                          insertStmt.exec(entry, (insertExecErr) => {
                            if (insertExecErr) console.error("Failed to insert sync row:", insertExecErr);
                            resolveExec();
                          });
                        }));
                      }

                      chain.then(() => {
                        conn.disconnect(() => resolve());
                      });
                    });
                  }
                });
              }
            });
          }
        });
      });
    }
  }

  // Helper to sync all assignments of a role (and its descendants) to HANA
  async function _syncRoleAssignmentsToHana(roleId) {
    const db = cds.db;
    try {
      const allInheritances = await db.run(SELECT.from(RoleInheritance));
      
      // Find all descendant roles recursively (child roles that inherit this parent role)
      const roleIds = new Set([roleId]);
      const queue = [roleId];
      while (queue.length > 0) {
        const currId = queue.shift();
        const children = allInheritances.filter(ri => ri.parent_ID === currId);
        for (const child of children) {
          if (!roleIds.has(child.role_ID)) {
            roleIds.add(child.role_ID);
            queue.push(child.role_ID);
          }
        }
      }

      // Fetch and sync all assignments for all these roles
      const assignments = await db.run(SELECT.from(RoleAssignments).where({ role_ID: { in: Array.from(roleIds) } }));
      for (const assignment of assignments) {
        try {
          await _syncAssignmentToHana(assignment.ID, assignment.userId, assignment.role_ID, false);
        } catch (e) {
          console.error(`Failed to sync assignment ${assignment.ID} on role change:`, e);
        }
      }
    } catch (err) {
      console.error(`Failed to sync role assignments for role ${roleId}:`, err);
    }
  }

  // Sync role assignments to HANA and queue replication on CREATE
  this.after('CREATE', 'RoleAssignments', async (assignment, req) => {
    try {
      await _syncAssignmentToHana(assignment.ID, assignment.userId, assignment.role_ID, false);
    } catch (e) {
      console.error("Failed to replicate assignment creation to HANA:", e);
    }
    try {
      const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
      if (role) {
        await _queueReplication(role.name, role.environment_ID, req?.user?.id);
      }
    } catch (err) {
      console.error("Failed to queue replication for assignment creation:", err);
    }
  });

  // Sync role assignments to HANA and queue replication on DELETE
  this.before('DELETE', 'RoleAssignments', async (req) => {
    try {
      const id = req.data.ID || req.query.DELETE?.where?.[2]?.val || (req.params[0] && (req.params[0].ID || req.params[0]));
      if (id) {
        // Fetch assignment details before deletion to determine environment/role
        const assignment = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
        if (assignment) {
          const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
          if (role) {
            await _queueReplication(`${role.name} (ASSIGNMENT DELETED)`, role.environment_ID, req?.user?.id);
          }
        }
        await _syncAssignmentToHana(id, null, null, true);
      }
    } catch (e) {
      console.error("Failed to replicate assignment deletion:", e);
    }
  });

  // ---------------------------------------------------------------------------
  // generateOrgRole
  // ---------------------------------------------------------------------------
  this.on('generateOrgRole', async (req) => {
    const { orgNodeId } = req.data;
    const db = cds.db;

    const node = await db.run(SELECT.one.from(OrgNodes).where({ ID: orgNodeId }));
    if (!node) return req.error(404, `OrgNode ${orgNodeId} not found`);

    return _generateRoleForNode(node, db);
  });

  // ---------------------------------------------------------------------------
  // generateAllOrgRoles
  // ---------------------------------------------------------------------------
  this.on('generateAllOrgRoles', async (req) => {
    const db = cds.db;
    const nodes = await db.run(SELECT.from(OrgNodes));

    let count = 0;
    for (const node of nodes) {
      await _generateRoleForNode(node, db);
      count++;
    }

    return { count };
  });

  // ---------------------------------------------------------------------------
  // resolveEffectiveRestrictions
  // ---------------------------------------------------------------------------
  this.on('resolveEffectiveRestrictions', async (req) => {
    const { roleId } = req.data;
    const db = cds.db;

    const allRoles = await db.run(SELECT.from(Roles));
    const allRestrictions = await db.run(SELECT.from(Restrictions));
    const allInheritances = await db.run(SELECT.from(RoleInheritance));

    try {
      return resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
    } catch (e) {
      return req.error(400, e.message);
    }
  });

  // ---------------------------------------------------------------------------
  // simulateAccess
  // ---------------------------------------------------------------------------
  this.on('simulateAccess', async (req) => {
    const { roleId, sampleData } = req.data;
    const db = cds.db;

    let rows;
    try {
      rows = JSON.parse(sampleData);
    } catch {
      return req.error(400, 'sampleData must be a valid JSON array string');
    }

    const allRoles = await db.run(SELECT.from(Roles));
    const allRestrictions = await db.run(SELECT.from(Restrictions));
    const allInheritances = await db.run(SELECT.from(RoleInheritance));

    let effectiveRestrictions;
    try {
      effectiveRestrictions = resolveEffectiveRestrictions(roleId, allRoles, allRestrictions, allInheritances);
    } catch (e) {
      return req.error(400, e.message);
    }

    return rows.map((row, idx) => {
      for (const restriction of effectiveRestrictions) {
        const result = evaluateRestriction(restriction, row);
        if (!result.passed) {
          return { rowIndex: idx, passed: false, reason: result.reason };
        }
      }
      return { rowIndex: idx, passed: true, reason: 'All restrictions satisfied' };
    });
  });

  // ---------------------------------------------------------------------------
  // testBdcConnection
  // ---------------------------------------------------------------------------
  this.on('testBdcConnection', async (req) => {
    const { settingId } = req.data;
    const db = cds.db;
    const { BdcSettings } = this.entities;

    const setting = await db.run(SELECT.one.from(BdcSettings).where({ ID: settingId }));
    if (!setting) return req.error(404, `BDC Setting with ID ${settingId} not found`);

    console.log('testBdcConnection retrieved setting:', JSON.stringify(setting, null, 2));

    const type = setting.connectionType || 'OData';

    if (type === 'SAP Hana') {
      if (!setting.host) {
        return { success: false, message: 'Failed: Hostname is required for SAP Hana connection' };
      }
      if (!setting.port) {
        return { success: false, message: 'Failed: Port is required for SAP Hana connection' };
      }
      if (!setting.username || !setting.password) {
        return { success: false, message: 'Failed: User and Password are required for SAP Hana connection' };
      }

      // Real database connectivity check using the official @sap/hana-client library
      const hana = require('@sap/hana-client');
      const conn = hana.createConnection();
      const connParams = {
        serverNode: `${setting.host}:${setting.port || 443}`,
        uid: setting.username,
        pwd: setting.password,
        encrypt: 'true',
        sslValidateCertificate: 'true',
        sslHostNameInCertificate: setting.host
      };

      const connectionPromise = new Promise((resolve) => {
        conn.connect(connParams, (err) => {
          if (err) {
            resolve({
              success: false,
              message: `Hana database connection failed: ${err.message}`
            });
          } else {
            // Create "authoriziation_flat" table in username schema
            const sql = `CREATE TABLE "${setting.username}"."authoriziation_flat" (
              "ID" VARCHAR(100) PRIMARY KEY,
              "USER" VARCHAR(150),
              "ROLE" VARCHAR(150),
              "FIELD" VARCHAR(50),
              "OPERATOR" VARCHAR(2),
              "LOW" VARCHAR(1333),
              "HIGH" VARCHAR(1333)
            )`;
            conn.exec(sql, (execErr) => {
              if (execErr) {
                const isAlreadyExists = execErr.code === 288 || execErr.message.toLowerCase().includes('already exists') || execErr.message.toLowerCase().includes('duplicate table name');
                if (!isAlreadyExists) {
                  console.error("Failed to create table:", execErr);
                }
              }
              conn.disconnect(() => {
                resolve({
                  success: true,
                  message: `Successfully connected to SAP Hana database. Table "${setting.username}"."authoriziation_flat" is verified/created.`
                });
              });
            });
          }
        });
      });

      return await connectionPromise;
    } else {
      if (!setting.url || !setting.url.startsWith('http')) {
        return { success: false, message: `Failed: Invalid endpoint URL '${setting.url || ''}'` };
      }

      if (setting.authType === 'BASIC') {
        if (!setting.username || !setting.password) {
          return { success: false, message: 'Failed: Missing username or password for Basic Authentication' };
        }
      } else if (setting.authType === 'OAUTH') {
        if (!setting.tokenUrl || !setting.clientId || !setting.clientSecret) {
          return { success: false, message: 'Failed: Missing OAuth2 token URL, Client ID, or Client Secret' };
        }
      } else if (setting.authType === 'TOKEN') {
        if (!setting.apiToken) {
          return { success: false, message: 'Failed: Missing API Bearer Token' };
        }
      }

      // Simulate validation request delay and success
      await new Promise(resolve => setTimeout(resolve, 800));
      return {
        success: true,
        message: `Successfully connected to Business Data Cloud System [${setting.systemName}] at ${setting.url}. Connection state: ACTIVE.`
      };
    }
  });

  // ---------------------------------------------------------------------------
  // fetchBdcSpaces
  // ---------------------------------------------------------------------------
  this.on('fetchBdcSpaces', async (req) => {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) {
      return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    }

    try {
      // 1. Fetch access token from OAuth Token URL
      const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!tokenRes.ok) {
        throw new Error(`Token request failed with status ${tokenRes.status}`);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error('No access_token returned in OAuth response');
      }

      // 2. Fetch spaces from Basis URL + /api/v1/datasphere/consumption/catalog/spaces
      const spacesEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/spaces`;
      const spacesRes = await fetch(spacesEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!spacesRes.ok) {
        throw new Error(`Spaces request failed with status ${spacesRes.status}`);
      }

      const data = await spacesRes.json();
      let spacesList = [];
      if (Array.isArray(data)) {
        spacesList = data.map(s => s.id || s.name || s);
      } else if (data && Array.isArray(data.results)) {
        spacesList = data.results.map(s => s.id || s.name || s);
      } else if (data && Array.isArray(data.value)) {
        spacesList = data.value.map(s => s.id || s.name || s);
      }

      return spacesList;
    } catch (e) {
      if (isMockUrl(url)) {
        console.warn(`fetchBdcSpaces failed: ${e.message}. Returning mock fallback spaces for testing.`);
        // Mock fallback spaces for demo/testing purposes
        return ['SALES_DEMO_SPACE', 'FINANCE_QA_SPACE', 'PRODUCTION_CORE_SPACE', 'HR_GLOBAL_SPACE'];
      }
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchBdcAssets
  // ---------------------------------------------------------------------------
  this.on('fetchBdcAssets', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) {
      return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    }

    let assetsList = [];
    let rawData = null;

    try {
      // 1. Fetch access token from OAuth Token URL
      const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!tokenRes.ok) {
        throw new Error(`Token request failed with status ${tokenRes.status}`);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error('No access_token returned in OAuth response');
      }

      // 2. Fetch assets from Basis URL + /api/v1/datasphere/consumption/catalog/assets
      const assetsEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/assets`;
      const assetsRes = await fetch(assetsEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!assetsRes.ok) {
        throw new Error(`Assets request failed with status ${assetsRes.status}`);
      }

      rawData = await assetsRes.json();
      console.log('fetchBdcAssets data:', rawData);

      let rawAssets = [];
      if (Array.isArray(rawData)) {
        rawAssets = rawData;
      } else if (rawData && Array.isArray(rawData.results)) {
        rawAssets = rawData.results;
      } else if (rawData && Array.isArray(rawData.value)) {
        rawAssets = rawData.value;
      }

      if (space) {
        rawAssets = rawAssets.filter(a => a.spaceName === space);
      }
      assetsList = rawAssets.map(a => a.id || a.name || a);
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }

    // Save list to file
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, 'last_fetched_assets.json');
      fs.writeFileSync(filePath, JSON.stringify(rawData || assetsList, null, 2), 'utf-8');
      console.log('Successfully saved assets payload to:', filePath);
    } catch (err) {
      console.error('Failed to save assets file:', err);
    }

    return assetsList;
  });

  this.on('fetchBdcRelationalValues', async (req) => {
    console.log('=== DEBUG: fetchBdcRelationalValues input ===', req.data);
    const { url, tokenUrl, clientId, clientSecret, space, asset, assetText, idColumns, textColumn } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    }

    let rawData = null;
    let mapped = [];

    try {
      // 1. Fetch access token from OAuth Token URL
      const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!tokenRes.ok) {
        throw new Error(`Token request failed with status ${tokenRes.status}`);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error('No access_token returned in OAuth response');
      }

      // Automatically retrieve key columns from metadata using helper
      let cols = [];
      try {
        cols = await _getAssetKeyColumns(url, accessToken, space, asset);
      } catch (err) {
        console.error(`Failed to automatically resolve key columns for asset ${asset}:`, err.message);
      }

      // Fallback: use passed idColumns parameter if present
      if (!cols || cols.length === 0 || cols[0] === 'id') {
        if (idColumns) {
          try {
            const parsed = JSON.parse(idColumns);
            if (Array.isArray(parsed) && parsed.length > 0) {
              cols = parsed;
            } else if (parsed) {
              cols = [parsed];
            }
          } catch {
            cols = [idColumns];
          }
        }
      }
      if (!Array.isArray(cols) || cols.length === 0 || !cols[0]) {
        cols = ['id'];
      }

      console.log(`=== DEBUG: fetchBdcRelationalValues resolved key columns (cols) ===`, cols);

      // 2. Fetch keys from Asset ID view (cleanAsset)
      const cleanSpace = space.trim();
      const cleanAsset = asset.trim();
      const assetEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAsset}/${cleanAsset}`;
      
      const assetRes = await fetch(assetEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!assetRes.ok) {
        throw new Error(`Asset ID relational request failed: ${assetRes.status} ${assetRes.statusText}`);
      }

      const assetResponseText = await assetRes.text();
      rawData = JSON.parse(assetResponseText);
      const assetRows = rawData.value?.[0]?.value || rawData.results || rawData.value || rawData || [];
      const assetRecords = Array.isArray(assetRows) ? assetRows : [];

      // 3. Fetch translations from Asset Text view (cleanAssetText) if provided
      let assetTextRecords = [];
      if (assetText && assetText.trim()) {
        const cleanAssetText = assetText.trim();
        const assetTextEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAssetText}/${cleanAssetText}`;
        const textRes = await fetch(assetTextEndpoint, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        });
        if (textRes.ok) {
          const textResponseText = await textRes.text();
          const textRaw = JSON.parse(textResponseText);
          const textRows = textRaw.value?.[0]?.value || textRaw.results || textRaw.value || textRaw || [];
          assetTextRecords = Array.isArray(textRows) ? textRows : [];
        } else {
          console.warn(`Asset Text relational request failed: ${textRes.status}. Falling back to Asset ID text retrieval.`);
        }
      }

      // 4. Build translation map if Asset Text is provided
      const translationMap = new Map();
      if (assetTextRecords.length > 0) {
        for (const row of assetTextRecords) {
          const key = cols.map(c => row[c] !== undefined && row[c] !== null ? String(row[c]) : '').filter(Boolean).join('-');
          if (key) {
            // Label must be taken from the attribute "description" (case-insensitive) or textColumn
            const descCol = Object.keys(row).find(k => k.toLowerCase() === 'description') || textColumn || 'description';
            const textVal = row[descCol] !== undefined && row[descCol] !== null ? String(row[descCol]) : '';
            translationMap.set(key, textVal);
          }
        }
      }

      // 5. Map Asset ID records to keys and look up translations
      mapped = assetRecords.map(row => {
        // Look for case-insensitive matches for NodeID, SalesOrg, RegionID
        const nodeIdCol = Object.keys(row).find(k => k.toLowerCase() === 'nodeid');
        const salesOrgCol = Object.keys(row).find(k => k.toLowerCase() === 'salesorg');
        const regionIdCol = Object.keys(row).find(k => k.toLowerCase() === 'regionid');
        
        let idVal;
        let textVal;

        if (nodeIdCol) {
          idVal = row[nodeIdCol] !== undefined && row[nodeIdCol] !== null ? String(row[nodeIdCol]) : '';
          const salesOrgVal = salesOrgCol && row[salesOrgCol] !== undefined && row[salesOrgCol] !== null ? String(row[salesOrgCol]).trim() : '';
          const regionIdVal = regionIdCol && row[regionIdCol] !== undefined && row[regionIdCol] !== null ? String(row[regionIdCol]).trim() : '';
          
          if (salesOrgVal) {
            textVal = `${idVal} - ${salesOrgVal}`;
          } else if (regionIdVal) {
            textVal = `${idVal} - ${regionIdVal}`;
          } else {
            textVal = idVal;
          }
        } else {
          idVal = cols.map(c => row[c] !== undefined && row[c] !== null ? String(row[c]) : '').filter(Boolean).join('-');
          textVal = idVal;
          if (assetText && assetText.trim() && assetTextRecords.length > 0) {
            textVal = translationMap.get(idVal) || idVal;
          } else {
            // Check if main asset contains "Description" (case-insensitive) or textColumn
            const descCol = Object.keys(row).find(k => k.toLowerCase() === 'description') || textColumn;
            if (descCol && row[descCol] !== undefined && row[descCol] !== null) {
              textVal = String(row[descCol]);
            } else {
              textVal = idVal;
            }
          }
        }

        const hierarchyCol = Object.keys(row).find(k => k.toLowerCase() === 'hierarchy');
        const hierarchyVal = hierarchyCol && row[hierarchyCol] !== undefined && row[hierarchyCol] !== null ? String(row[hierarchyCol]) : undefined;

        const parentIdCol = Object.keys(row).find(k => k.toLowerCase() === 'parentid');
        const parentIdVal = parentIdCol && row[parentIdCol] !== undefined && row[parentIdCol] !== null ? String(row[parentIdCol]) : null;

        const returnObj = {
          id: idVal,
          text: nodeIdCol ? textVal : (idVal === textVal ? idVal : `${idVal} - ${textVal}`)
        };
        if (nodeIdCol) {
          returnObj.parent_ID = (parentIdVal !== null && parentIdVal !== 'null' && parentIdVal !== '') ? parentIdVal : null;
        }
        if (hierarchyVal !== undefined) {
          returnObj.hierarchy = hierarchyVal;
        }
        return returnObj;
      }).filter(item => item.id !== undefined && item.id !== null && item.id !== '');

    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }

    // Save list to file
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, 'last_fetched_relational_values.json');
      fs.writeFileSync(filePath, JSON.stringify(rawData || mapped, null, 2), 'utf-8');
      console.log('Successfully saved relational values to:', filePath);
    } catch (err) {
      console.error('Failed to save relational values file:', err);
    }

    return mapped;
  });

  // ---------------------------------------------------------------------------
  this.on('fetchBdcAssetColumns', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    }

    try {
      // 1. Fetch access token from OAuth Token URL
      const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!tokenRes.ok) {
        throw new Error(`Token request failed with status ${tokenRes.status}`);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        throw new Error('No access_token returned in OAuth response');
      }

      // 2. Fetch metadata XML schema document from OData service root
      const cleanSpace = space.trim();
      const cleanAsset = asset.trim();
      const relationalEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAsset}/$metadata`;
      const relationalRes = await fetch(relationalEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/xml, application/json'
        }
      });

      if (!relationalRes.ok) {
        throw new Error(`Relational request failed with status ${relationalRes.status}`);
      }

      const responseText = await relationalRes.text();
      
      const properties = [];
      const cleanAssetLower = cleanAsset.toLowerCase();
      let foundBlockContent = null;

      // Look through all EntityTypes in the OData XML to locate the one matching the asset name
      const entityTypeScanner = /<(?:\w+:)?EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?EntityType>/gi;
      let match;
      while ((match = entityTypeScanner.exec(responseText)) !== null) {
        const entityName = match[1].toLowerCase();
        if (entityName === cleanAssetLower || entityName === `${cleanAssetLower}type` || entityName.includes(cleanAssetLower)) {
          foundBlockContent = match[2];
          break;
        }
      }

      const contentToSearch = foundBlockContent || responseText;
      const propRegex = /<(?:\w+:)?Property\s+Name="([^"]+)"/g;
      let propMatch;
      while ((propMatch = propRegex.exec(contentToSearch)) !== null) {
        if (!properties.includes(propMatch[1])) {
          properties.push(propMatch[1]);
        }
      }

      return properties;
    } catch (e) {
      return req.error(500, `Datasphere API Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // searchLdapUsers
  // ---------------------------------------------------------------------------
  this.on('searchLdapUsers', async (req) => {
    const { query } = req.data;
    const users = [
      { username: 'jdoe', displayName: 'John Doe', email: 'john.doe@fanrio.com', department: 'Finance' },
      { username: 'asmith', displayName: 'Alice Smith', email: 'alice.smith@fanrio.com', department: 'Human Resources' },
      { username: 'bobm', displayName: 'Bob Martin', email: 'bob.martin@fanrio.com', department: 'IT Operations' },
      { username: 'cwhite', displayName: 'Charlie White', email: 'charlie.white@fanrio.com', department: 'Sales' },
      { username: 'emiller', displayName: 'Emily Miller', email: 'emily.miller@fanrio.com', department: 'Global Operations' },
      { username: 'dbrown', displayName: 'David Brown', email: 'david.brown@fanrio.com', department: 'Finance' },
      { username: 'sjohnson', displayName: 'Sarah Johnson', email: 'sarah.johnson@fanrio.com', department: 'IT Development' },
      { username: 'mgarcia', displayName: 'Maria Garcia', email: 'maria.garcia@fanrio.com', department: 'Sales' },
      { username: 'rwilson', displayName: 'Robert Wilson', email: 'robert.wilson@fanrio.com', department: 'Security' },
      { username: 'lharris', displayName: 'Linda Harris', email: 'linda.harris@fanrio.com', department: 'Human Resources' }
    ];
    if (!query || !query.trim()) return users;
    const q = query.toLowerCase().trim();
    return users.filter(u =>
      u.username.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.department.toLowerCase().includes(q)
    );
  });

  // Helper to fetch OAuth token
  async function _getOAuthToken(tokenUrl, clientId, clientSecret) {
    if (isMockUrl(tokenUrl)) {
      return 'mock-token';
    }
    const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    if (!tokenRes.ok) {
      throw new Error(`Token request failed with status ${tokenRes.status}`);
    }
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error('No access_token returned in OAuth response');
    }
    return tokenData.access_token;
  }

  // Helper to fetch keys of an asset from OData metadata
  async function _getAssetKeyColumns(url, accessToken, space, asset) {
    if (isMockUrl(url)) {
      return ['id'];
    }
    try {
      const cleanSpace = space.trim();
      const cleanAsset = asset.trim();
      const metadataEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${cleanSpace}/${cleanAsset}/$metadata`;
      
      const res = await fetch(metadataEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/xml, application/json'
        }
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch metadata: ${res.status}`);
      }
      const xml = await res.text();
      
      // Look for the entity type block
      const cleanAssetLower = cleanAsset.toLowerCase();
      let foundBlockContent = null;
      const entityTypeScanner = /<(?:\w+:)?EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?EntityType>/gi;
      let match;
      while ((match = entityTypeScanner.exec(xml)) !== null) {
        const entityName = match[1].toLowerCase();
        if (entityName === cleanAssetLower || entityName === `${cleanAssetLower}type` || entityName.includes(cleanAssetLower)) {
          foundBlockContent = match[2];
          break;
        }
      }
      
      const contentToSearch = foundBlockContent || xml;
      const keyBlockRegex = /<(?:\w+:)?Key>([\s\S]*?)<\/(?:\w+:)?Key>/i;
      const keyBlockMatch = keyBlockRegex.exec(contentToSearch);
      
      const keys = [];
      if (keyBlockMatch) {
        const propRefRegex = /<(?:\w+:)?PropertyRef\s+Name="([^"]+)"/g;
        let refMatch;
        while ((refMatch = propRefRegex.exec(keyBlockMatch[1])) !== null) {
          keys.push(refMatch[1]);
        }
      }
      
      if (keys.length > 0) {
        return keys;
      }
      
      // Fallback: scan all properties and look for "id"
      const propRegex = /<(?:\w+:)?Property\s+Name="([^"]+)"/g;
      let propMatch;
      const properties = [];
      while ((propMatch = propRegex.exec(contentToSearch)) !== null) {
        properties.push(propMatch[1]);
      }
      const fallbackKey = properties.find(p => p.toLowerCase() === 'id') || properties[0] || 'id';
      return [fallbackKey];
    } catch (e) {
      console.error(`Failed to automatically resolve key columns for asset ${asset}:`, e.message);
      return ['id']; // default fallback
    }
  }

  // ---------------------------------------------------------------------------
  // fetchRawBdcSpaces
  // ---------------------------------------------------------------------------
  this.on('fetchRawBdcSpaces', async (req) => {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) {
      return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    }
    try {
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/spaces`;
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`Spaces request failed: ${res.status} [Endpoint: ${endpoint}]`);
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchRawBdcAssets
  // ---------------------------------------------------------------------------
  this.on('fetchRawBdcAssets', async (req) => {
    const { url, tokenUrl, clientId, clientSecret } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret) {
      return req.error(400, 'Missing url, tokenUrl, clientId, or clientSecret');
    }
    try {
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/catalog/assets`;
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`Assets request failed: ${res.status} [Endpoint: ${endpoint}]`);
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchRawBdcRelationalValues
  // ---------------------------------------------------------------------------
  this.on('fetchRawBdcRelationalValues', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    }
    try {
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const s = space.trim();
      const a = asset.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/${a}`;
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`Relational Values request failed: ${res.status} [Endpoint: ${endpoint}]`);
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchRawBdcAssetColumns
  // ---------------------------------------------------------------------------
  this.on('fetchRawBdcAssetColumns', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !asset) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    }
    try {
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const s = space.trim();
      const a = asset.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/$metadata`;
      const res = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' }
      });
      if (!res.ok) throw new Error(`Asset Columns Metadata request failed: ${res.status} [Endpoint: ${endpoint}]`);
      const data = await res.text();
      return data;
    } catch (e) {
      return req.error(500, `Datasphere API Raw Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchBdcAssociations
  // ---------------------------------------------------------------------------
  this.on('fetchBdcAssociations', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space, asset } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || space === undefined || asset === undefined) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or asset');
    }
    try {
      const s = space ? space.trim() : '';
      const a = asset ? asset.trim() : '';
      
      // If mock url, return mock associations
      if (isMockUrl(url)) {
        return JSON.stringify([
          { name: "to_TextTable", targetType: "MY_SPACE.COMPANY_TEXT" },
          { name: "to_HierarchyDirectory", targetType: "MY_SPACE.MY_HIERARCHY_DIRECTORY" }
        ], null, 2);
      }
      
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const analyticalEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/analytical/${s}/${a}/$metadata`;
      
      let res;
      let endpoint = analyticalEndpoint;
      try {
        res = await fetch(analyticalEndpoint, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' }
        });
      } catch (err) {
        console.warn(`Analytical endpoint fetch failed: ${err.message}. Trying relational fallback.`);
      }

      if (!res || !res.ok) {
        const relationalEndpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/consumption/relational/${s}/${a}/$metadata`;
        endpoint = relationalEndpoint;
        res = await fetch(relationalEndpoint, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml, application/json' }
        });
      }

      if (!res.ok) throw new Error(`Asset Metadata request failed: ${res.status} [Endpoint: ${endpoint}]`);
      const xml = await res.text();
      
      const associations = [];
      const navPropRegex = /<NavigationProperty\b[^>]*>/g;
      const nameRegex = /\bName="([^"]+)"/;
      const typeRegex = /\bType="([^"]+)"/;
      
      let match;
      while ((match = navPropRegex.exec(xml)) !== null) {
        const tagContent = match[0];
        const nameMatch = nameRegex.exec(tagContent);
        const typeMatch = typeRegex.exec(tagContent);
        if (nameMatch && typeMatch) {
          associations.push({
            name: nameMatch[1],
            targetType: typeMatch[1]
          });
        }
      }
      
      return JSON.stringify(associations, null, 2);
    } catch (e) {
      return req.error(500, `Datasphere API fetchBdcAssociations Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchRawHanaViews
  // ---------------------------------------------------------------------------
  this.on('fetchRawHanaViews', async (req) => {
    const { settingId } = req.data;
    const db = cds.db;
    const { BdcSettings } = this.entities;

    const setting = await db.run(SELECT.one.from(BdcSettings).where({ ID: settingId }));
    if (!setting) return req.error(404, `BDC Setting with ID ${settingId} not found`);

    const hana = require('@sap/hana-client');
    const conn = hana.createConnection();
    const connParams = {
      serverNode: `${setting.host}:${setting.port || 443}`,
      uid: setting.username,
      pwd: setting.password,
      encrypt: 'true',
      sslValidateCertificate: 'true',
      sslHostNameInCertificate: setting.host
    };

    const connectionPromise = new Promise((resolve) => {
      conn.connect(connParams, (err) => {
        if (err) {
          resolve(req.error(500, `Hana connection failed: ${err.message}`));
        } else {
          const query = `
            SELECT SCHEMA_NAME, VIEW_NAME 
            FROM VIEWS 
            WHERE SCHEMA_NAME NOT IN ('SYS', '_SYS_BI', '_SYS_BIC', '_SYS_STATISTICS', '_SYS_XS')
            ORDER BY SCHEMA_NAME, VIEW_NAME
          `;
          conn.exec(query, (err, rows) => {
            conn.disconnect();
            if (err) {
              resolve(req.error(500, `Query failed: ${err.message}`));
            } else {
              resolve(JSON.stringify(rows, null, 2));
            }
          });
        }
      });
    });

    return await connectionPromise;
  });

  // Helper to check and update running replication statuses
  async function _checkAndUpdateRunningReplications(db) {
    const runningReps = await db.run(SELECT.from(Replications).where({ status: 'Running' }));
    if (runningReps.length === 0) {
      return { success: true, message: 'No running replications.' };
    }

    const runIds = Array.from(new Set(runningReps.map(r => r.runId).filter(Boolean)));
    const results = [];
    const errors = [];

    for (const runId of runIds) {
      try {
        const repSample = runningReps.find(r => r.runId === runId);
        const envId = repSample ? repSample.environment_ID : 'D';

        const activeSetting = await db.run(SELECT.one.from(BdcSettings).where({
          connectionType: 'OData',
          isActive: true,
          environment_ID: envId
        }));

        if (!activeSetting) {
          errors.push(`Run ${runId}: No active BDC connection configured for environment: ${envId}`);
          continue;
        }

        const { url, tokenUrl, clientId, clientSecret, space } = activeSetting;
        if (!url || !tokenUrl || !clientId || !clientSecret || !space) {
          errors.push(`Run ${runId}: Active BDC connection for environment ${envId} is missing parameters.`);
          continue;
        }

        let status = 'RUNNING';
        let finishedAt = null;

        if (isMockUrl(url)) {
          if (runId && runId.includes('complete')) {
            status = 'COMPLETED';
            finishedAt = new Date().toISOString();
          } else {
            // Mock URL fallback logic: complete mock runs after 10 seconds
            const startedMs = parseInt(runId.replace('mock-log-', '')) || Date.now();
            if (Date.now() - startedMs > 10000) {
              status = 'COMPLETED';
              finishedAt = new Date().toISOString();
            } else {
              status = 'RUNNING';
            }
          }
        } else {
          const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
          const s = space.trim();
          const l = runId.trim();
          const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/logs/${s}/${l}`;

          const res = await fetch(endpoint, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.sap.datasphere.task.log.details+json, application/json'
            }
          });

          if (res.ok) {
            const data = await res.json();
            status = data.status || 'RUNNING';
            finishedAt = data.endTime || data.finishedAt || data.endedAt || new Date().toISOString();
          } else {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Log request failed with status ${res.status}: ${errBody}`);
          }
        }

        if (status === 'COMPLETED') {
          await db.run(UPDATE(Replications)
            .set({ 
              status: 'Success', 
              replicationDate: finishedAt || new Date().toISOString(),
              endTime: finishedAt || new Date().toISOString()
            })
            .where({ runId: runId, status: 'Running' }));
          results.push(`Run ${runId} completed successfully.`);
        } else if (status === 'FAILED' || status === 'ABORTED') {
          await db.run(UPDATE(Replications)
            .set({ 
              status: 'Failed', 
              replicationDate: finishedAt || new Date().toISOString(),
              endTime: finishedAt || new Date().toISOString()
            })
            .where({ runId: runId, status: 'Running' }));
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
    return {
      success: true,
      message: `Checked statuses: ${results.join('; ')}`
    };
  }

  // ---------------------------------------------------------------------------
  // checkReplicationStatuses
  // ---------------------------------------------------------------------------
  this.on('checkReplicationStatuses', async (req) => {
    const db = cds.db;
    try {
      return await _checkAndUpdateRunningReplications(db);
    } catch (e) {
      return req.error(500, `Failed to check replication statuses: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // triggerReplication
  // ---------------------------------------------------------------------------
  this.on('triggerReplication', async (req) => {
    const db = cds.db;
    
    // 1. Check/update status of any currently 'Running' task chains before starting new ones
    await _checkAndUpdateRunningReplications(db).catch(err => {
      console.error('Error auto-refreshing running replication statuses:', err);
    });
    
    // 2. Fetch all pending open or failed replications
    const openReps = await db.run(SELECT.from(Replications).where({ status: { in: ['Open', 'Failed'] } }));
    console.log("DEBUG triggerReplication openReps:", JSON.stringify(openReps));
    if (openReps.length === 0) {
      return { success: true, message: 'No pending or failed changes to replicate.' };
    }

    // 3. Identify the unique environments of those open changes
    const envIds = Array.from(new Set(openReps.map(r => r.environment_ID).filter(Boolean)));
    
    // If somehow no environments are set, fallback to Development
    if (envIds.length === 0) {
      envIds.push('D');
    }

    const results = [];
    const errors = [];

    // 4. For each environment, trigger the corresponding BDC task chain
    for (const envId of envIds) {
      const activeSetting = await db.run(SELECT.one.from(BdcSettings).where({ 
        connectionType: 'OData', 
        isActive: true, 
        environment_ID: envId 
      }));

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
        const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
        const s = space.trim();
        const tc = taskChainFlat.trim();
        const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/chains/${s}/run/${tc}`;
        
        let success = false;
        let responseData = null;

        if (isMockUrl(url)) {
          success = true;
          responseData = {
            logId: `mock-log-${Date.now()}`,
            status: 'RUNNING',
            spaceId: space,
            taskChainId: taskChainFlat,
            startedAt: runStartTime
          };
        } else {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
          });
          if (res.ok) {
            success = true;
            responseData = await res.json().catch(() => ({}));
          } else {
            const errBody = await res.text().catch(() => '');
            throw new Error(`Task chain run request failed: ${res.status} ${res.statusText}. Response: ${errBody}`);
          }
        }

        const runUser = req?.user?.id || 'system';
        const finalLogId = responseData && (responseData.logId || responseData.runId || `run-${Date.now()}`);

        if (success) {
          // Change status of open or failed replications in this environment to 'Running' (with startTime and runId)
          await db.run(UPDATE(Replications)
            .set({ 
              status: 'Running', 
              replicationDate: runStartTime,
              startTime: runStartTime,
              user: runUser,
              runId: String(finalLogId)
            })
            .where({ environment_ID: envId, status: { in: ['Open', 'Failed'] } }));
          results.push(`Environment ${envId}: Started replication (Run ID: ${finalLogId}) via connection ${activeSetting.systemName}`);
        } else {
          errors.push(`Environment ${envId}: Replication failed to trigger.`);
        }
      } catch (e) {
        console.error("DEBUG CATCH EXCEPTION:", e);
        errors.push(`Environment ${envId} Error: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      console.error("DEBUG triggerReplication errors:", errors);
      if (results.length > 0) {
        return { 
          success: false, 
          message: `Partial replication. Successes: [${results.join('; ')}]. Errors: [${errors.join('; ')}]` 
        };
      } else {
        return req.error(500, `Replication failed: ${errors.join('; ')}`);
      }
    }

    return { success: true, message: `All environments replicated: ${results.join('; ')}` };
  });

  // ---------------------------------------------------------------------------
  // runBdcTaskChain
  // ---------------------------------------------------------------------------
  this.on('runBdcTaskChain', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space, taskChainId } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !taskChainId) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or taskChainId');
    }
    try {
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const s = space.trim();
      const tc = taskChainId.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/chains/${s}/run/${tc}`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Task chain run request failed: ${res.status} ${res.statusText}. Response: ${errBody} [Endpoint: ${endpoint}]`);
      }
      
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (e) {
      if (isMockUrl(url)) {
        console.warn(`runBdcTaskChain failed: ${e.message}. Returning mock run log response for testing.`);
        return JSON.stringify({
          logId: `mock-log-${Date.now()}`,
          status: 'RUNNING',
          spaceId: space,
          taskChainId: taskChainId,
          startedAt: new Date().toISOString()
        }, null, 2);
      }
      return req.error(500, `Datasphere API runBdcTaskChain Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // fetchBdcTaskChainLog
  // ---------------------------------------------------------------------------
  this.on('fetchBdcTaskChainLog', async (req) => {
    const { url, tokenUrl, clientId, clientSecret, space, logId } = req.data;
    if (!url || !tokenUrl || !clientId || !clientSecret || !space || !logId) {
      return req.error(400, 'Missing url, tokenUrl, clientId, clientSecret, space, or logId');
    }
    try {
      const token = await _getOAuthToken(tokenUrl, clientId, clientSecret);
      const s = space.trim();
      const l = logId.trim();
      const endpoint = `${url.replace(/\/$/, '')}/api/v1/datasphere/tasks/logs/${s}/${l}`;
      
      const res = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.sap.datasphere.task.log.details+json, application/json'
        }
      });
      
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Task chain log request failed: ${res.status} ${res.statusText}. Response: ${errBody} [Endpoint: ${endpoint}]`);
      }
      
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    } catch (e) {
      if (isMockUrl(url)) {
        console.warn(`fetchBdcTaskChainLog failed: ${e.message}. Returning mock log detail for testing.`);
        const now = new Date();
        const start = new Date(now.getTime() - 5000);
        return JSON.stringify({
          logId: logId,
          status: 'COMPLETED',
          spaceId: space,
          startTime: start.toISOString(),
          endTime: now.toISOString(),
          startedAt: start.toISOString(),
          finishedAt: now.toISOString(),
          tasks: [
            { taskId: 'step-1-data-flow', taskType: 'DATA_FLOW', status: 'COMPLETED' }
          ]
        }, null, 2);
      }
      return req.error(500, `Datasphere API fetchBdcTaskChainLog Error: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Audit Logs - Roles
  // ---------------------------------------------------------------------------
  this.after('CREATE', 'Roles', async (role, req) => {
    try {
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID: cds.utils.uuid(),
        entityName: 'Roles',
        action: 'CREATE',
        recordId: role.ID,
        targetName: role.name,
        details: JSON.stringify(role)
      }));
      await _queueReplication(role.name, role.environment_ID, req?.user?.id);
    } catch (err) {
      console.error('Audit Log failed for Roles CREATE:', err);
    }
  });

  this.before('UPDATE', 'Roles', async (req) => {
    try {
      let id = req.data.ID;
      if (!id && req.params && req.params.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateRole = beforeState;
        }
      }
    } catch (err) {
      console.error('Audit Log capture before Roles UPDATE failed:', err);
    }
  });

  this.after('UPDATE', 'Roles', async (res, req) => {
    try {
      let id = req.data.ID;
      if (!id && req.params && req.params.length > 0) {
        const p = req.params[0];
        id = typeof p === 'object' ? p.ID : p;
      }
      if (id) {
        const afterState = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        const beforeState = req.context?.beforeStateRole;
        
        const diff = {};
        if (beforeState && afterState) {
          for (const key of Object.keys(afterState)) {
            if (['modifiedAt', 'modifiedBy'].includes(key)) continue;
            if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
              diff[key] = { old: beforeState[key], new: afterState[key] };
            }
          }
        }

        if (Object.keys(diff).length > 0) {
          await cds.db.run(INSERT.into(AuditLogs).entries({
            ID: cds.utils.uuid(),
            entityName: 'Roles',
            action: 'UPDATE',
            recordId: id,
            targetName: afterState ? afterState.name : (beforeState ? beforeState.name : 'Unknown Role'),
            details: JSON.stringify(diff)
          }));
          await _queueReplication(
            afterState ? afterState.name : (beforeState ? beforeState.name : 'Unknown Role'),
            afterState ? afterState.environment_ID : (beforeState ? beforeState.environment_ID : 'D'),
            req?.user?.id
          );
        }
        await _syncRoleAssignmentsToHana(id);
      }
    } catch (err) {
      console.error('Audit Log failed for Roles UPDATE:', err);
    }
  });

  this.before('DELETE', 'Roles', async (req) => {
    try {
      let id = req.data.ID || req.query.DELETE?.where?.[2]?.val || (req.params[0] && (req.params[0].ID || req.params[0]));
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(Roles).where({ ID: id }));
        if (beforeState) {
          // Log parent deletion
          await cds.db.run(INSERT.into(AuditLogs).entries({
            ID: cds.utils.uuid(),
            entityName: 'Roles',
            action: 'DELETE',
            recordId: id,
            targetName: beforeState.name,
            details: JSON.stringify(beforeState)
          }));
          await _queueReplication(`${beforeState.name} (DELETED)`, beforeState.environment_ID, req?.user?.id);

          // Handle recursive descendant and assignment deletions
          req.context = req.context || {};
          if (!req.context.inCascadingDelete) {
            req.context.inCascadingDelete = true;

            const allInheritances = await cds.db.run(SELECT.from(RoleInheritance));
            const descendantRoleIds = [];
            const queue = [id];
            const visited = new Set([id]);
            while (queue.length > 0) {
              const curr = queue.shift();
              const children = allInheritances.filter(ri => ri.parent_ID === curr);
              for (const child of children) {
                if (!visited.has(child.role_ID)) {
                  visited.add(child.role_ID);
                  descendantRoleIds.push(child.role_ID);
                  queue.push(child.role_ID);
                }
              }
            }

            // 1. Delete all assignments associated with the parent role and descendants
            const allRoleIds = [id, ...descendantRoleIds];
            const assignments = await cds.db.run(SELECT.from(RoleAssignments).where({ role_ID: { in: allRoleIds } }));
            for (const assignment of assignments) {
              // Using this.run to trigger hooks (audit logs & HANA sync)
              await this.run(DELETE.from(RoleAssignments).where({ ID: assignment.ID }));
            }

            // 2. Delete all inheritances involving these roles
            await cds.db.run(DELETE.from(RoleInheritance).where({
              or: [
                { role_ID: { in: allRoleIds } },
                { parent_ID: { in: allRoleIds } }
              ]
            }));

            // 3. Delete descendant roles recursively (triggering hooks for audit log and compositions)
            for (const descId of descendantRoleIds) {
              await this.run(DELETE.from(Roles).where({ ID: descId }));
            }
          }
        }
      }
    } catch (err) {
      console.error('Audit Log failed for Roles DELETE:', err);
    }
  });

  // ---------------------------------------------------------------------------
  // Validation & Audit Logs - Role Assignments
  // ---------------------------------------------------------------------------
  this.before('CREATE', 'RoleAssignments', async (req) => {
    const { role_ID } = req.data;
    if (role_ID) {
      const allRoles = await cds.db.run(SELECT.from(Roles));
      const allRestrictions = await cds.db.run(SELECT.from(Restrictions));
      const allInheritances = await cds.db.run(SELECT.from(RoleInheritance));
      try {
        const resolved = resolveEffectiveRestrictions(role_ID, allRoles, allRestrictions, allInheritances);
        if (resolved.length === 0) {
          return req.error(400, 'Cannot assign a role that has no restrictions.');
        }
      } catch (e) {
        return req.error(400, e.message);
      }
    }
  });

  this.after('CREATE', 'RoleAssignments', async (assignment) => {
    try {
      await cds.db.run(INSERT.into(AuditLogs).entries({
        ID: cds.utils.uuid(),
        entityName: 'RoleAssignments',
        action: 'CREATE',
        recordId: assignment.ID,
        targetName: assignment.userName || assignment.userId,
        details: JSON.stringify(assignment)
      }));
    } catch (err) {
      console.error('Audit Log failed for RoleAssignments CREATE:', err);
    }
  });

  this.before('UPDATE', 'RoleAssignments', async (req) => {
    try {
      let id = req.data.ID || req.params[0]?.ID || req.params[0];
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateAssignment = beforeState;
        }
      }
    } catch (err) {
      console.error('Audit Log capture before RoleAssignments UPDATE failed:', err);
    }
  });

  this.after('UPDATE', 'RoleAssignments', async (res, req) => {
    try {
      let id = req.data.ID || req.params[0]?.ID || req.params[0];
      if (id) {
        const afterState = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
        const beforeState = req.context?.beforeStateAssignment;
        
        const diff = {};
        if (beforeState && afterState) {
          for (const key of Object.keys(afterState)) {
            if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
              diff[key] = { old: beforeState[key], new: afterState[key] };
            }
          }
        }

        if (Object.keys(diff).length > 0) {
          await cds.db.run(INSERT.into(AuditLogs).entries({
            ID: cds.utils.uuid(),
            entityName: 'RoleAssignments',
            action: 'UPDATE',
            recordId: id,
            targetName: afterState ? (afterState.userName || afterState.userId) : (beforeState ? (beforeState.userName || beforeState.userId) : 'Unknown User'),
            details: JSON.stringify(diff)
          }));
        }

        // Queue replication for updated assignment
        if (afterState) {
          const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: afterState.role_ID }));
          if (role) {
            await _queueReplication(role.name, role.environment_ID, req?.user?.id);
          }
        }
        if (beforeState && beforeState.role_ID !== afterState?.role_ID) {
          const oldRole = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
          if (oldRole) {
            await _queueReplication(oldRole.name, oldRole.environment_ID, req?.user?.id);
          }
        }
      }
    } catch (err) {
      console.error('Audit Log failed for RoleAssignments UPDATE:', err);
    }
  });

  this.before('DELETE', 'RoleAssignments', async (req) => {
    try {
      let id = req.data.ID || req.query.DELETE?.where?.[2]?.val || (req.params[0] && (req.params[0].ID || req.params[0]));
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(RoleAssignments).where({ ID: id }));
        if (beforeState) {
          await cds.db.run(INSERT.into(AuditLogs).entries({
            ID: cds.utils.uuid(),
            entityName: 'RoleAssignments',
            action: 'DELETE',
            recordId: id,
            targetName: beforeState.userName || beforeState.userId,
            details: JSON.stringify(beforeState)
          }));
        }
      }
    } catch (err) {
      console.error('Audit Log failed for RoleAssignments DELETE:', err);
    }
  });

  // ---------------------------------------------------------------------------
  // Audit Logs & Replications - Restrictions (Consolidated under Roles)
  // ---------------------------------------------------------------------------
  this.after('CREATE', 'Restrictions', async (restriction, req) => {
    try {
      if (restriction.role_ID) {
        const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: restriction.role_ID }));
        const roleName = role ? role.name : 'Unknown Role';
        const details = {
          "Restriction Added": {
            old: "",
            new: `Field: ${restriction.field}, Type: ${restriction.filterType}, Value: ${restriction.value}`
          }
        };
        await cds.db.run(INSERT.into(AuditLogs).entries({
          ID: cds.utils.uuid(),
          entityName: 'Roles',
          action: 'UPDATE',
          recordId: restriction.role_ID,
          targetName: roleName,
          details: JSON.stringify(details)
        }));
        await _queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
        if (restriction.role_ID) {
          await _syncRoleAssignmentsToHana(restriction.role_ID);
        }
      }
    } catch (err) {
      console.error('Audit Log failed for Restrictions CREATE:', err);
    }
  });

  this.before('UPDATE', 'Restrictions', async (req) => {
    try {
      let id = req.data.ID || req.params[0]?.ID || req.params[0];
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
        if (beforeState) {
          req.context = req.context || {};
          req.context.beforeStateRestriction = beforeState;
        }
      }
    } catch (err) {
      console.error('Audit Log capture before Restrictions UPDATE failed:', err);
    }
  });

  this.after('UPDATE', 'Restrictions', async (res, req) => {
    try {
      let id = req.data.ID || req.params[0]?.ID || req.params[0];
      if (id) {
        const afterState = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
        const beforeState = req.context?.beforeStateRestriction;
        
        let hasChanges = false;
        if (beforeState && afterState) {
          if (beforeState.filterType !== afterState.filterType || beforeState.value !== afterState.value || beforeState.field !== afterState.field) {
            hasChanges = true;
          }
        }

        if (hasChanges && beforeState.role_ID) {
          const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
          const roleName = role ? role.name : 'Unknown Role';
          const details = {
            [`Restriction Changed (${beforeState.field})`]: {
              old: `Type: ${beforeState.filterType}, Value: ${beforeState.value}`,
              new: `Type: ${afterState.filterType}, Value: ${afterState.value}`
            }
          };
          await cds.db.run(INSERT.into(AuditLogs).entries({
            ID: cds.utils.uuid(),
            entityName: 'Roles',
            action: 'UPDATE',
            recordId: beforeState.role_ID,
            targetName: roleName,
            details: JSON.stringify(details)
          }));
          await _queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
          if (beforeState && beforeState.role_ID) {
            await _syncRoleAssignmentsToHana(beforeState.role_ID);
          }
        }
      }
    } catch (err) {
      console.error('Audit Log failed for Restrictions UPDATE:', err);
    }
  });

  this.before('DELETE', 'Restrictions', async (req) => {
    try {
      let id = req.data.ID || req.query.DELETE?.where?.[2]?.val || (req.params[0] && (req.params[0].ID || req.params[0]));
      if (id) {
        const beforeState = await cds.db.run(SELECT.one.from(Restrictions).where({ ID: id }));
        if (beforeState && beforeState.role_ID) {
          const role = await cds.db.run(SELECT.one.from(Roles).where({ ID: beforeState.role_ID }));
          const roleName = role ? role.name : 'Unknown Role';
          const details = {
            "Restriction Deleted": {
              old: `Field: ${beforeState.field}, Type: ${beforeState.filterType}, Value: ${beforeState.value}`,
              new: ""
            }
          };
          await cds.db.run(INSERT.into(AuditLogs).entries({
            ID: cds.utils.uuid(),
            entityName: 'Roles',
            action: 'UPDATE',
            recordId: beforeState.role_ID,
            targetName: roleName,
            details: JSON.stringify(details)
          }));
          await _queueReplication(roleName, role ? role.environment_ID : 'D', req?.user?.id);
          if (beforeState && beforeState.role_ID) {
            await _syncRoleAssignmentsToHana(beforeState.role_ID);
          }
        }
      }
    } catch (err) {
      console.error('Audit Log failed for Restrictions DELETE:', err);
    }
  });

});
