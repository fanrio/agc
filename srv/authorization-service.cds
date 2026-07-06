using {fanrio.auth as db} from '../db/schema';

service AuthorizationService @(path: '/odata/v4/auth') {

  // -------------------------------------------------------------------------
  // Org Structure
  // -------------------------------------------------------------------------
  entity OrgNodes               as projection on db.OrgNodes;
  entity OrgNodeAttributes      as projection on db.OrgNodeAttributes;
  entity RestrictionFields      as projection on db.RestrictionFields;
  entity Streams                as projection on db.Streams;

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------
  entity Roles                  as projection on db.Roles;
  entity Restrictions           as projection on db.Restrictions;
  entity RoleAssignments        as projection on db.RoleAssignments;
  entity RoleInheritance        as projection on db.RoleInheritance;
  entity RoleApprovers          as projection on db.RoleApprovers;

  entity Environments           as projection on db.Environments;
  entity AuditLogs              as projection on db.AuditLogs;
  entity AppAuthorizations      as projection on db.AppAuthorizations;
  entity Replications           as projection on db.Replications;
  entity Customers              as projection on db.Customers;
  entity DynamicGenerationRules as projection on db.DynamicGenerationRules;
  entity GeneratedResourceMap   as projection on db.GeneratedResourceMap;
  entity BdcSettings            as projection on db.BdcSettings;


  action searchLdapUsers(query: String)                                         returns array of {
    username    : String;
    displayName : String;
    email       : String;
    department  : String;
  };


  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Auto-generate an Org-Based Role from an OrgNode.
   * Walks the ancestry path and creates Restriction entries per node attribute.
   */
  action generateOrgRole(orgNodeId: UUID)                                       returns {
    roleId   : UUID;
    roleName : String;
  };

  /**
   * Batch generate Org-Based Roles for all nodes in the tree.
   */
  action generateAllOrgRoles()                                                  returns {
    count : Integer;
  };

  /**
   * Recursively resolves the full inherited restriction chain for a role.
   * Returns all restrictions tagged by their source role.
   */
  action resolveEffectiveRestrictions(roleId: UUID)                             returns array of {
    restrictionId  : UUID;
    field          : String;
    filterType     : String;
    value          : String;
    sourceRoleId   : UUID;
    sourceRoleName : String;
    isOwn          : Boolean;
  };

  /**
   * Simulates access for a role against sample data rows.
   * Returns pass/fail per row with reason.
   */
  action simulateAccess(roleId: UUID, sampleData: String, restrictions: String) returns array of {
    rowIndex : Integer;
    passed   : Boolean;
    reason   : String;
  };


  action syncDynamicRule(ruleId: UUID)                                          returns {
    success : Boolean;
    message : String;
  };

  // -------------------------------------------------------------------------
  // BDC Connection & Data Actions
  // -------------------------------------------------------------------------

  action testBdcConnection(settingId: UUID)                                     returns {
    success : Boolean;
    message : String;
  };

  action fetchBdcSpaces(url: String, tokenUrl: String, clientId: String, clientSecret: String) returns array of String;

  action fetchBdcAssets(url: String, tokenUrl: String, clientId: String, clientSecret: String, space: String) returns array of String;

  action fetchBdcRelationalValues(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                                  space: String, asset: String, assetText: String,
                                  idColumns: String, textColumn: String)        returns array of {
    id   : String;
    text : String;
  };

  action fetchBdcAssetColumns(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                              space: String, asset: String)                     returns array of String;

  action fetchRawBdcSpaces(url: String, tokenUrl: String, clientId: String, clientSecret: String) returns LargeString;

  action fetchRawBdcAssets(url: String, tokenUrl: String, clientId: String, clientSecret: String) returns LargeString;

  action fetchRawBdcRelationalValues(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                                     space: String, asset: String)             returns LargeString;

  action fetchRawBdcAssetColumns(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                                 space: String, asset: String)                 returns LargeString;

  action fetchBdcAssociations(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                              space: String, asset: String)                    returns LargeString;

  action runBdcTaskChain(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                         space: String, taskChainId: String)                   returns LargeString;

  action fetchBdcTaskChainLog(url: String, tokenUrl: String, clientId: String, clientSecret: String,
                              space: String, logId: String)                    returns LargeString;

  action fetchRawHanaViews(settingId: UUID)                                    returns LargeString;

  // -------------------------------------------------------------------------
  // Replication Actions
  // -------------------------------------------------------------------------

  action triggerReplication()                                                   returns {
    success : Boolean;
    message : String;
  };

  action checkReplicationStatuses()                                             returns {
    success : Boolean;
    message : String;
  };

  function getCurrentUserPermissions()                                         returns AppAuthorizations;
}
