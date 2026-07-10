const HanaClient = require('../lib/hanaClient');
const BdcClient = require('../lib/bdcClient');
const { syncAssignmentToHana } = require('./hanaReplicationService');
const { queueReplication } = require('./replicationQueueService');
const { safeJsonParse } = require('../lib/utils');

/**
 * Synchronizes assignments and dynamic roles for a specific rule.
 */
async function syncDynamicRule(ruleId, cds) {
  const db = cds.db;
  const { DynamicGenerationRules, DynamicRuleFieldMappings, GeneratedResourceMap, Roles, Restrictions, RoleAssignments, AuditLogs, BdcSettings, Replications, RoleInheritance } = cds.entities('fanrio.auth');

  // 1. Fetch the active rule configuration
  const rule = await db.run(SELECT.one.from(DynamicGenerationRules).where({ ID: ruleId, isActive: true }));
  if (!rule) throw new Error(`Active Dynamic Rule ${ruleId} not found`);

  // Fetch field mappings
  const mappings = await db.run(SELECT.from(DynamicRuleFieldMappings).where({ rule_ID: ruleId }));
  if (mappings.length === 0) {
    throw new Error(`No field mappings defined for dynamic rule: ${rule.code}`);
  }

  // 2. Fetch master data records (Local DB fallback or BDC Asset)
  let masterRecords = [];
  let bdcConnection = null;
  if (rule.sourceType === 'LOCAL_DB') {
    masterRecords = await db.run(SELECT.from(rule.sourceEntity));
  } else {
    // Fetch BDC connection details
    bdcConnection = await db.run(SELECT.one.from(BdcSettings).where({ ID: rule.bdcConnection_ID }));
    if (!bdcConnection) {
      throw new Error(`BDC Connection not configured for rule: ${rule.code}`);
    }

    // Fetch master data records from the BDC Asset (OData)
    const { assetRecords } = await BdcClient.fetchRelationalValues({
      url: bdcConnection.url,
      tokenUrl: bdcConnection.tokenUrl,
      clientId: bdcConnection.clientId,
      clientSecret: bdcConnection.clientSecret,
      space: bdcConnection.space,
      asset: rule.sourceEntity
    });
    masterRecords = assetRecords || [];
  }

  // Apply source filter condition in memory
  if (rule.sourceFilterCondition) {
    try {
      const filter = JSON.parse(rule.sourceFilterCondition);
      if (filter && filter.field && filter.value !== undefined) {
        masterRecords = masterRecords.filter(r => r[filter.field] === filter.value);
      }
    } catch (e) {
      console.warn(`[DynamicSync] sourceFilterCondition for rule ${ruleId} is not valid JSON and was ignored:`, rule.sourceFilterCondition);
    }
  }

  // 3. Group master keys by responsible user ID
  const userRecordMapping = {}; // { 'alice@company.com': [ { CompanyCode: '1000', CustomerNumber: 'C001' } ] }
  for (const record of masterRecords) {
    const userId = record[rule.sourceResponsibleField];
    if (userId) {
      const keyObj = {};
      let hasAllKeys = true;
      for (const m of mappings) {
        const val = record[m.sourceKeyField];
        if (val === undefined || val === null) {
          hasAllKeys = false;
          break;
        }
        keyObj[m.sourceKeyField] = val;
      }
      if (hasAllKeys) {
        if (!userRecordMapping[userId]) userRecordMapping[userId] = [];
        userRecordMapping[userId].push(keyObj);
      }
    }
  }

  // Fetch BDC connection details if not already fetched (e.g. for LOCAL_DB mode)
  if (!bdcConnection && rule.bdcConnection_ID) {
    bdcConnection = await db.run(SELECT.one.from(BdcSettings).where({ ID: rule.bdcConnection_ID }));
  }
  const envId = bdcConnection?.environment_ID || 'D';

  const userIds = Object.keys(userRecordMapping);

  // Preload all tables needed for HanaReplication cache
  const [allRoles, allRestrictions, allInheritances] = await Promise.all([
    db.run(SELECT.from(Roles)),
    db.run(SELECT.from(Restrictions)),
    db.run(SELECT.from(RoleInheritance))
  ]);
  const preloaded = { allRoles, allRestrictions, allInheritances };

  // Fetch existing assignments for the active users in a single query
  const existingAssignments = userIds.length > 0
    ? await db.run(SELECT.from(RoleAssignments).where({ userId: { in: userIds } }))
    : [];

  // Fetch existing dynamic roles for these users
  const roleNames = userIds.map(userId => `ROLE_DYN_${rule.code}_${userId.replace(/[@.]/g, '_').toUpperCase()}`);
  if (rule.generationMode === 'TEMPLATE_ASSIGNMENT' && rule.templateRole_ID) {
    const templateRole = allRoles.find(r => r.ID === rule.templateRole_ID);
    if (templateRole) {
      roleNames.push(templateRole.name);
    }
  }
  const existingRoles = roleNames.length > 0
    ? await db.run(SELECT.from(Roles).where({ name: { in: roleNames } }))
    : [];

  // 4. Query current Generated Resources for this rule
  const activeMappings = await db.run(SELECT.from(GeneratedResourceMap).where({ rule_ID: rule.ID }));

  // 5. Process user updates & creations
  for (const [userId, keys] of Object.entries(userRecordMapping)) {
    if (rule.generationMode === 'USER_CONSOLIDATED_ROLE') {
      await _syncConsolidatedUserRole(db, rule, mappings, userId, keys, activeMappings, AuditLogs, cds, envId, preloaded, existingAssignments, existingRoles);
    } else if (rule.generationMode === 'TEMPLATE_ASSIGNMENT') {
      await _syncTemplateAssignment(db, rule, mappings, userId, keys, activeMappings, AuditLogs, cds, envId, preloaded, existingAssignments);
    }
  }

  // 6. Clean up obsolete mappings
  const obsoleteMappings = [];
  for (const mapping of activeMappings) {
    const activeKeys = userRecordMapping[mapping.userId] || [];
    const isStillActive = activeKeys.some(k => JSON.stringify(k) === mapping.masterRecordKey);
    if (!isStillActive) {
      obsoleteMappings.push(mapping);
    }
  }
  
  for (const obsolete of obsoleteMappings) {
    await _removeGeneratedAccess(db, rule, obsolete, AuditLogs, cds, envId, preloaded, existingAssignments);
  }
}

/**
 * Handles Consolidated Dynamic Role mode
 */
async function _syncConsolidatedUserRole(db, rule, mappings, userId, keys, activeMappings, AuditLogs, cds, envId, preloaded, existingAssignments, existingRoles) {
  const { Roles, Restrictions, RoleAssignments, GeneratedResourceMap, RoleInheritance, BdcSettings, Replications } = cds.entities('fanrio.auth');
  
  // Format role name
  const roleName = `ROLE_DYN_${rule.code}_${userId.replace(/[@.]/g, '_').toUpperCase()}`;

  // Find or create dynamic role
  let role = existingRoles.find(r => r.name === roleName);
  let roleId = role?.ID;

  // Check if keys have changed
  const newSerializedKeys = keys.map(k => JSON.stringify(k)).sort();
  const existingSerializedKeys = activeMappings
    .filter(m => m.userId === userId)
    .map(m => m.masterRecordKey)
    .sort();

  const keysUnchanged = 
    newSerializedKeys.length === existingSerializedKeys.length &&
    newSerializedKeys.every((val, index) => val === existingSerializedKeys[index]);

  let assignment = roleId ? existingAssignments.find(a => a.role_ID === roleId && a.userId === userId) : null;

  if (keysUnchanged && role && assignment) {
    return;
  }

  // Find or create dynamic role if not exists
  if (!role) {
    roleId = cds.utils.uuid();
    const newRole = {
      ID: roleId,
      name: roleName,
      type: 'DERIVED',
      description: `Dynamic Role created via rule: ${rule.code} for user ${userId}`,
      environment_ID: envId,
      stream_ID: 'app-global'
    };
    await db.run(INSERT.into(Roles).entries(newRole));
    existingRoles.push(newRole);
    preloaded.allRoles.push(newRole);
  }

  // Set/update the MULTI_VALUE restriction mapping the collected keys for each field
  const targetFields = mappings.map(m => m.targetRestrictionField);
  
  // Remove old restrictions from database
  await db.run(DELETE.from(Restrictions).where({ role_ID: roleId, field: { in: targetFields } }));
  
  // Update in-memory preloaded cache
  preloaded.allRestrictions = preloaded.allRestrictions.filter(
    r => !(r.role_ID === roleId && targetFields.includes(r.field))
  );

  const newRestrictions = [];
  for (const m of mappings) {
    const uniqueValues = [...new Set(keys.map(k => String(k[m.sourceKeyField])))];
    newRestrictions.push({
      ID: cds.utils.uuid(),
      role_ID: roleId,
      field: m.targetRestrictionField,
      filterType: 'MULTI_VALUE',
      value: JSON.stringify(uniqueValues),
      sourceLabel: `Rule Gen: ${rule.code}`,
    });
  }

  if (newRestrictions.length > 0) {
    await db.run(INSERT.into(Restrictions).entries(newRestrictions));
    preloaded.allRestrictions.push(...newRestrictions);
  }

  // Ensure role is assigned to the user
  let assignmentId = assignment?.ID;
  if (!assignment) {
    assignmentId = cds.utils.uuid();
    const newAssignment = {
      ID: assignmentId,
      role_ID: roleId,
      userId: userId,
      userName: userId,
    };
    await db.run(INSERT.into(RoleAssignments).entries(newAssignment));
    existingAssignments.push(newAssignment);
  }

  // Always sync consolidated assignment to HANA since restrictions are replaced on every reconciliation
  await syncAssignmentToHana(
    cds,
    HanaClient,
    { Roles, Restrictions, RoleInheritance, BdcSettings },
    assignmentId,
    userId,
    roleId,
    false,
    preloaded
  );

  // Queue for OData replication to SAP Datasphere
  await queueReplication(cds, Replications, roleName, envId, 'SYSTEM_DYN');

  // Update GeneratedResourceMap ledger and audit logs
  const newMaps = [];
  const newAuditLogs = [];
  for (const key of keys) {
    const serializedKey = JSON.stringify(key);
    const existingMap = activeMappings.find(m => m.masterRecordKey === serializedKey && m.userId === userId);
    if (!existingMap) {
      const mapId = cds.utils.uuid();
      newMaps.push({
        ID: mapId,
        rule_ID: rule.ID,
        masterRecordKey: serializedKey,
        userId: userId,
        generatedRole_ID: roleId,
        generatedAssignment_ID: assignmentId
      });

      newAuditLogs.push({
        ID: cds.utils.uuid(),
        entityName: 'DynamicGenerationRules',
        action: 'CREATE',
        recordId: rule.ID,
        targetName: userId,
        details: JSON.stringify({
          ruleCode: rule.code,
          triggerType: 'AUTOMATED_SYNC',
          masterRecordKey: key,
          generatedRoleName: roleName,
          assignmentId: assignmentId,
          reason: `Auto-assigned master record ${serializedKey} to responsible user ${userId}`
        })
      });
    }
  }

  if (newMaps.length > 0) {
    await db.run(INSERT.into(GeneratedResourceMap).entries(newMaps));
    await db.run(INSERT.into(AuditLogs).entries(newAuditLogs));
    activeMappings.push(...newMaps);
  }
}

/**
 * Handles Template Assignment mode
 */
async function _syncTemplateAssignment(db, rule, mappings, userId, keys, activeMappings, AuditLogs, cds, envId, preloaded, existingAssignments) {
  const { Roles, Restrictions, RoleAssignments, GeneratedResourceMap, RoleInheritance, BdcSettings, Replications } = cds.entities('fanrio.auth');
  
  if (!rule.templateRole_ID) {
    throw new Error(`Template role not configured for rule ${rule.code}`);
  }

  // Check if keys have changed
  const newSerializedKeys = keys.map(k => JSON.stringify(k)).sort();
  const existingSerializedKeys = activeMappings
    .filter(m => m.userId === userId)
    .map(m => m.masterRecordKey)
    .sort();

  const keysUnchanged = 
    newSerializedKeys.length === existingSerializedKeys.length &&
    newSerializedKeys.every((val, index) => val === existingSerializedKeys[index]);

  let assignment = existingAssignments.find(a => a.role_ID === rule.templateRole_ID && a.userId === userId);
  let assignmentId = assignment?.ID;

  if (keysUnchanged && assignment) {
    return;
  }

  // Ensure template role is assigned to the user
  if (!assignment) {
    assignmentId = cds.utils.uuid();
    const newAssignment = {
      ID: assignmentId,
      role_ID: rule.templateRole_ID,
      userId: userId,
      userName: userId,
    };
    await db.run(INSERT.into(RoleAssignments).entries(newAssignment));
    existingAssignments.push(newAssignment);

    // Sync template role assignment to HANA
    await syncAssignmentToHana(
      cds,
      HanaClient,
      { Roles, Restrictions, RoleInheritance, BdcSettings },
      assignmentId,
      userId,
      rule.templateRole_ID,
      false,
      preloaded
    );

    // Queue for OData replication
    const templateRole = preloaded.allRoles.find(r => r.ID === rule.templateRole_ID);
    if (templateRole) {
      await queueReplication(cds, Replications, templateRole.name, templateRole.environment_ID || envId, 'SYSTEM_DYN');
    }
  }

  // Update GeneratedResourceMap ledger and audit logs
  const newMaps = [];
  const newAuditLogs = [];
  for (const key of keys) {
    const serializedKey = JSON.stringify(key);
    const existingMap = activeMappings.find(m => m.masterRecordKey === serializedKey && m.userId === userId);
    if (!existingMap) {
      const mapId = cds.utils.uuid();
      newMaps.push({
        ID: mapId,
        rule_ID: rule.ID,
        masterRecordKey: serializedKey,
        userId: userId,
        generatedAssignment_ID: assignmentId
      });

      newAuditLogs.push({
        ID: cds.utils.uuid(),
        entityName: 'DynamicGenerationRules',
        action: 'CREATE',
        recordId: rule.ID,
        targetName: userId,
        details: JSON.stringify({
          ruleCode: rule.code,
          triggerType: 'AUTOMATED_SYNC',
          masterRecordKey: key,
          templateRole_ID: rule.templateRole_ID,
          assignmentId: assignmentId,
          reason: `Assigned static template role to user ${userId} for master record ${serializedKey}`
        })
      });
    }
  }

  if (newMaps.length > 0) {
    await db.run(INSERT.into(GeneratedResourceMap).entries(newMaps));
    await db.run(INSERT.into(AuditLogs).entries(newAuditLogs));
    activeMappings.push(...newMaps);
  }
}

/**
 * Removes dynamic roles, restrictions, and mapping registers when user loses scope
 */
async function _removeGeneratedAccess(db, rule, mapping, AuditLogs, cds, envId, preloaded, existingAssignments) {
  const { Roles, Restrictions, RoleAssignments, GeneratedResourceMap, RoleInheritance, BdcSettings, Replications } = cds.entities('fanrio.auth');

  // Delete the GeneratedResourceMap entry
  await db.run(DELETE.from(GeneratedResourceMap).where({ ID: mapping.ID }));

  // Log deletion in AuditLogs
  await db.run(INSERT.into(AuditLogs).entries({
    ID: cds.utils.uuid(),
    entityName: 'DynamicGenerationRules',
    action: 'DELETE',
    recordId: rule.ID,
    targetName: mapping.userId,
    details: JSON.stringify({
      ruleCode: rule.code,
      triggerType: 'AUTOMATED_SYNC',
      masterRecordKey: mapping.masterRecordKey,
      reason: `Removed access to master record ${mapping.masterRecordKey} for user ${mapping.userId} due to ownership change`
    })
  }));

  // Clean up assignment if no other keys reference it
  if (mapping.generatedAssignment_ID) {
    const otherMapForAssignment = await db.run(SELECT.one.from(GeneratedResourceMap).where({
      generatedAssignment_ID: mapping.generatedAssignment_ID
    }));
    if (!otherMapForAssignment) {
      const assignment = existingAssignments.find(a => a.ID === mapping.generatedAssignment_ID)
        || await db.run(SELECT.one.from(RoleAssignments).where({ ID: mapping.generatedAssignment_ID }));
      if (assignment) {
        // Sync delete to HANA
        await syncAssignmentToHana(
          cds,
          HanaClient,
          { Roles, Restrictions, RoleInheritance, BdcSettings },
          mapping.generatedAssignment_ID,
          mapping.userId,
          assignment.role_ID,
          true,
          preloaded
        );

        // Fetch the role's details from preload or DB to get its name for queueReplication
        const role = preloaded.allRoles.find(r => r.ID === assignment.role_ID)
          || await db.run(SELECT.one.from(Roles).where({ ID: assignment.role_ID }));
        if (role) {
          await queueReplication(cds, Replications, role.name, role.environment_ID || envId, 'SYSTEM_DYN');
        }
      }
      await db.run(DELETE.from(RoleAssignments).where({ ID: mapping.generatedAssignment_ID }));
    }
  }

  // Clean up role and restrictions if consolidated and no other keys reference it
  if (mapping.generatedRole_ID) {
    const otherMapForRole = await db.run(SELECT.one.from(GeneratedResourceMap).where({
      generatedRole_ID: mapping.generatedRole_ID
    }));
    if (!otherMapForRole) {
      const role = preloaded.allRoles.find(r => r.ID === mapping.generatedRole_ID)
        || await db.run(SELECT.one.from(Roles).where({ ID: mapping.generatedRole_ID }));
      
      // Find and delete all restrictions for this role
      await db.run(DELETE.from(Restrictions).where({ role_ID: mapping.generatedRole_ID }));
      await db.run(DELETE.from(Roles).where({ ID: mapping.generatedRole_ID }));

      // Update in-memory preloaded cache
      preloaded.allRoles = preloaded.allRoles.filter(r => r.ID !== mapping.generatedRole_ID);
      preloaded.allRestrictions = preloaded.allRestrictions.filter(r => r.role_ID !== mapping.generatedRole_ID);

      if (role) {
        await queueReplication(cds, Replications, `${role.name} (DELETED)`, role.environment_ID || envId, 'SYSTEM_DYN');
      }
    }
  }
}

module.exports = {
  syncDynamicRule
};
