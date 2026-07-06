const HanaClient = require('./hanaClient');
const { syncAssignmentToHana } = require('../services/hanaReplicationService');

function safeJsonParse(val, fallback = []) {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch (e) {
    console.error(`JSON Parse failed for value: ${val}`, e);
    return fallback;
  }
}

// Whitelist of entities permitted for dynamic sync
const ALLOWED_ENTITIES = ['fanrio.auth.Customers', 'Customers'];

/**
 * Synchronizes assignments and dynamic roles for a specific rule.
 */
async function syncDynamicRule(ruleId, cds) {
  const db = cds.db;
  const { DynamicGenerationRules, GeneratedResourceMap, Roles, Restrictions, RoleAssignments, AuditLogs } = db.entities('fanrio.auth');

  // 1. Fetch the active rule configuration
  const rule = await db.run(SELECT.one.from(DynamicGenerationRules).where({ ID: ruleId, isActive: true }));
  if (!rule) throw new Error(`Active Dynamic Rule ${ruleId} not found`);

  if (!ALLOWED_ENTITIES.includes(rule.sourceEntity)) {
    throw new Error(`Dynamic sync is not permitted for entity: ${rule.sourceEntity}`);
  }

  // 2. Fetch master data records based on configured sourceEntity and sourceFilterCondition
  let query = SELECT.from(rule.sourceEntity);
  if (rule.sourceFilterCondition) {
    // A-03 fix: parse structured JSON filter to avoid CQL injection.
    // sourceFilterCondition must be stored as { "field": "...", "operator": "=", "value": "..." }
    try {
      const filter = JSON.parse(rule.sourceFilterCondition);
      if (filter && filter.field && filter.value !== undefined) {
        query.where({ [filter.field]: filter.value });
      }
    } catch (e) {
      // If not valid JSON, skip the filter to prevent injection — log for operator visibility
      console.warn(`[DynamicSync] sourceFilterCondition for rule ${ruleId} is not valid JSON and was ignored:`, rule.sourceFilterCondition);
    }
  }
  const masterRecords = await db.run(query);

  // 3. Group master keys by responsible user ID
  const userRecordMapping = {}; // { 'alice@company.com': ['C101', 'C102'], 'bob@company.com': ['C103'] }
  for (const record of masterRecords) {
    const userId = record[rule.sourceResponsibleField];
    const keyVal = record[rule.sourceKeyField];
    if (userId && keyVal) {
      if (!userRecordMapping[userId]) userRecordMapping[userId] = [];
      userRecordMapping[userId].push(keyVal);
    }
  }

  // 4. Query current Generated Resources for this rule to find deleted mappings or owner changes
  const activeMappings = await db.run(SELECT.from(GeneratedResourceMap).where({ rule_ID: rule.ID }));

  // 5. Process user updates & creations
  for (const [userId, keys] of Object.entries(userRecordMapping)) {
    if (rule.generationMode === 'USER_CONSOLIDATED_ROLE') {
      await _syncConsolidatedUserRole(db, rule, userId, keys, activeMappings, AuditLogs, cds);
    } else if (rule.generationMode === 'TEMPLATE_ASSIGNMENT') {
      await _syncTemplateAssignment(db, rule, userId, keys, activeMappings, AuditLogs, cds);
    }
  }

  // 6. Clean up obsolete mappings (Users who no longer have any records assigned or records removed)
  const obsoleteMappings = [];
  for (const mapping of activeMappings) {
    const activeKeys = userRecordMapping[mapping.userId] || [];
    if (!activeKeys.includes(mapping.masterRecordKey)) {
      obsoleteMappings.push(mapping);
    }
  }
  
  for (const obsolete of obsoleteMappings) {
    await _removeGeneratedAccess(db, rule, obsolete, AuditLogs, cds);
  }
}

/**
 * Handles Consolidated Dynamic Role mode
 */
async function _syncConsolidatedUserRole(db, rule, userId, keys, activeMappings, AuditLogs, cds) {
  const { Roles, Restrictions, RoleAssignments, GeneratedResourceMap, RoleInheritance, BdcSettings } = db.entities('fanrio.auth');
  
  // Format role name (safe alphanumeric string)
  const roleName = `ROLE_DYN_${rule.code}_${userId.replace(/[@.]/g, '_').toUpperCase()}`;

  // Find or create dynamic role
  let role = await db.run(SELECT.one.from(Roles).where({ name: roleName }));
  let roleId = role?.ID;
  
  if (!role) {
    roleId = cds.utils.uuid();
    await db.run(INSERT.into(Roles).entries({
      ID: roleId,
      name: roleName,
      type: 'DERIVED',
      description: `Dynamic Role created via rule: ${rule.code} for user ${userId}`,
    }));
  }

  // Set/update the MULTI_VALUE restriction mapping the collected keys
  await db.run(DELETE.from(Restrictions).where({ role_ID: roleId, field: rule.targetRestrictionField }));
  const restrictionId = cds.utils.uuid();
  await db.run(INSERT.into(Restrictions).entries({
    ID: restrictionId,
    role_ID: roleId,
    field: rule.targetRestrictionField,
    filterType: 'MULTI_VALUE',
    value: JSON.stringify(keys),
    sourceLabel: `Rule Gen: ${rule.code}`,
  }));

  // Ensure role is assigned to the user
  let assignment = await db.run(SELECT.one.from(RoleAssignments).where({ role_ID: roleId, userId }));
  let assignmentId = assignment?.ID;
  if (!assignment) {
    assignmentId = cds.utils.uuid();
    await db.run(INSERT.into(RoleAssignments).entries({
      ID: assignmentId,
      role_ID: roleId,
      userId: userId,
      userName: userId, // Default display name
    }));
  }

  // Always sync consolidated assignment to HANA since restrictions are replaced on every reconciliation
  await syncAssignmentToHana(
    cds,
    HanaClient,
    { Roles, Restrictions, RoleInheritance, BdcSettings },
    assignmentId,
    userId,
    roleId,
    false
  );

  // Update GeneratedResourceMap ledger and audit log creations in bulk
  const newMaps = [];
  const newAuditLogs = [];
  for (const key of keys) {
    const existingMap = activeMappings.find(m => m.masterRecordKey === key && m.userId === userId);
    if (!existingMap) {
      const mapId = cds.utils.uuid();
      newMaps.push({
        ID: mapId,
        rule_ID: rule.ID,
        masterRecordKey: key,
        userId: userId,
        generatedRole_ID: roleId,
        generatedRestriction_ID: restrictionId,
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
          generatedRestrictionField: rule.targetRestrictionField,
          assignmentId: assignmentId,
          reason: `Auto-assigned master record ${key} to responsible user ${userId}`
        })
      });
    }
  }

  if (newMaps.length > 0) {
    await db.run(INSERT.into(GeneratedResourceMap).entries(newMaps));
    await db.run(INSERT.into(AuditLogs).entries(newAuditLogs));
  }
}

/**
 * Handles Template Assignment mode
 */
async function _syncTemplateAssignment(db, rule, userId, keys, activeMappings, AuditLogs, cds) {
  const { Roles, Restrictions, RoleAssignments, GeneratedResourceMap, RoleInheritance, BdcSettings } = db.entities('fanrio.auth');
  
  if (!rule.templateRole_ID) {
    throw new Error(`Template role not configured for rule ${rule.code}`);
  }

  // Ensure template role is assigned to the user
  let assignment = await db.run(SELECT.one.from(RoleAssignments).where({ role_ID: rule.templateRole_ID, userId }));
  let assignmentId = assignment?.ID;
  if (!assignment) {
    assignmentId = cds.utils.uuid();
    await db.run(INSERT.into(RoleAssignments).entries({
      ID: assignmentId,
      role_ID: rule.templateRole_ID,
      userId: userId,
      userName: userId,
    }));

    // Sync template role assignment to HANA
    await syncAssignmentToHana(
      cds,
      HanaClient,
      { Roles, Restrictions, RoleInheritance, BdcSettings },
      assignmentId,
      userId,
      rule.templateRole_ID,
      false
    );
  }

  // Update GeneratedResourceMap ledger and audit log creations in bulk
  const newMaps = [];
  const newAuditLogs = [];
  for (const key of keys) {
    const existingMap = activeMappings.find(m => m.masterRecordKey === key && m.userId === userId);
    if (!existingMap) {
      const mapId = cds.utils.uuid();
      newMaps.push({
        ID: mapId,
        rule_ID: rule.ID,
        masterRecordKey: key,
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
          reason: `Assigned static template role to user ${userId} for master record ${key}`
        })
      });
    }
  }

  if (newMaps.length > 0) {
    await db.run(INSERT.into(GeneratedResourceMap).entries(newMaps));
    await db.run(INSERT.into(AuditLogs).entries(newAuditLogs));
  }
}

/**
 * Removes dynamic roles, restrictions, and mapping registers when user loses scope
 */
async function _removeGeneratedAccess(db, rule, mapping, AuditLogs, cds) {
  const { Roles, Restrictions, RoleAssignments, GeneratedResourceMap, RoleInheritance, BdcSettings } = db.entities('fanrio.auth');

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
      const assignment = await db.run(SELECT.one.from(RoleAssignments).where({ ID: mapping.generatedAssignment_ID }));
      if (assignment) {
        // Sync delete to HANA
        await syncAssignmentToHana(
          cds,
          HanaClient,
          { Roles, Restrictions, RoleInheritance, BdcSettings },
          mapping.generatedAssignment_ID,
          mapping.userId,
          assignment.role_ID,
          true
        );
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
      await db.run(DELETE.from(Restrictions).where({ role_ID: mapping.generatedRole_ID }));
      await db.run(DELETE.from(Roles).where({ ID: mapping.generatedRole_ID }));
    }
  }
}

module.exports = {
  syncDynamicRule,
  ALLOWED_ENTITIES
};
