namespace fanrio.auth;

using { cuid, managed } from '@sap/cds/common';

// ---------------------------------------------------------------------------
// Organizational Structure
// ---------------------------------------------------------------------------

entity OrgNodes : managed {
  key ID     : String(36) @default : 'uuid()';
  name       : String(100) not null;
  type       : Association to RestrictionFields;
  parent     : Association to OrgNodes;
  children   : Composition of many OrgNodes on children.parent = $self;
  attributes : Composition of many OrgNodeAttributes on attributes.node = $self;
  roles      : Association to many Roles on roles.orgNode = $self;
}

entity OrgNodeAttributes : cuid {
  node  : Association to OrgNodes not null;
  field : String(100) not null;   // e.g. 'Country', 'Plant'
  value : String(200) not null;   // e.g. 'Germany', 'DE01'
}

entity RestrictionFields : cuid {
  name          : String(100) not null;
  bdcConnection : Association to BdcSettings;
  asset         : String(255);          // Asset ID
  assetText     : String(255);          // Asset Text
  assetHierarchy: String(255);          // Asset Hierarchy
  withHierarchyDirectory: Boolean;      // Checkbox info based on hierarchy attribute presence
  idColumns     : String(500); // e.g. ["id"] or ["company","plant"]
  textColumn    : String(100);
}

entity AccessDomains : managed {
  key ID      : String(36);
  name        : String(10) not null;
  description : String(200);
  type        : Association to RestrictionFields;
  parent      : Association to AccessDomains;
  children    : Composition of many AccessDomains on children.parent = $self;
  attributes  : Composition of many AccessDomainAttributes on attributes.node = $self;
  restrictionFields : Composition of many AccessDomainFields on restrictionFields.domain = $self;
  roleTemplateName  : String(255);
}

entity AccessDomainAttributes : cuid {
  node  : Association to AccessDomains not null;
  field : String(100) not null;
  value : String(200) not null;
}

entity AccessDomainFields : cuid {
  domain : Association to AccessDomains not null;
  field  : Association to RestrictionFields not null;
}

// ---------------------------------------------------------------------------
// Roles & Restrictions
// ---------------------------------------------------------------------------

entity Roles : managed {
  key ID          : String(36)  @default : 'uuid()';
  name            : String(200) not null;
  type            : String(20)  not null;  // ORG_BASED | DERIVED
  description     : String(500);
  critical        : Boolean @default : false;
  environment     : Association to Environments;
  orgNode         : Association to OrgNodes;  // for ORG_BASED roles
  accessDomain    : Association to AccessDomains;
  parentRoles     : Composition of many RoleInheritance on parentRoles.role = $self;
  childRoles      : Association to many RoleInheritance on childRoles.parent = $self;
  ownRestrictions : Composition of many Restrictions on ownRestrictions.role = $self;
  assignments     : Composition of many RoleAssignments on assignments.role = $self;
  approvers       : Composition of many RoleApprovers on approvers.role = $self;
}

entity RoleInheritance : cuid {
  role   : Association to Roles not null;
  parent : Association to Roles not null;
}

entity RoleApprovers : cuid {
  role     : Association to Roles not null;
  userId   : String(200) not null;
  userName : String(200);
}

entity Restrictions : cuid {
  role        : Association to Roles not null;
  field       : String(100) not null;
  //  SINGLE_VALUE | MULTI_VALUE | RANGE | HIERARCHY | CP
  filterType  : String(20) not null;
  // Serialized value — see notes below per type:
  //   SINGLE_VALUE  → plain string  e.g. "Germany"
  //   MULTI_VALUE   → JSON array    e.g. ["DE01","DE02"]
  //   RANGE         → JSON object   e.g. {"from":1000,"to":50000}
  //   HIERARCHY     → orgNode ID    e.g. "a1b2c3..."
  //   CP            → plain string  e.g. "CC1%"
  value       : String(1000) not null;
  sourceLabel : String(200);  // display hint — which ancestor introduced this
}

@assert.unique: {
  roleUser : [role, userId]
}
entity RoleAssignments : cuid, managed {
  role     : Association to Roles not null;
  userId   : String(200) not null;
  userName : String(200);
}

entity BdcSettings {
  key ID       : String(36) @default : 'uuid()';
  systemName   : String(100) not null;
  connectionType : String(50) @default : 'OData'; // OData | SAP Hana
  environment  : Association to Environments;
  url          : String(255);
  host         : String(255);
  port         : Integer @default : 443;
  authType     : String(50);  // BASIC | OAUTH | TOKEN
  space        : String(100);          // BDC Space selection (e.g. DEV, QA, PROD)
  username     : String(100);
  password     : String(100);
  tokenUrl     : String(255);
  clientId     : String(100);
  clientSecret : String(100);
  apiToken     : String(255);
  taskChainFlat : String(255) @default : 'df_authorization_flat';      // Task chain: Flat authorization
  isActive     : Boolean @default: true;
}

entity AuditLogs : cuid, managed {
  entityName : String(100) not null; // 'Roles' or 'RoleAssignments'
  action     : String(20) not null;  // 'CREATE' | 'UPDATE' | 'DELETE'
  recordId   : String(36) not null;  // ID of the role or assignment
  targetName : String(255);          // Role name or User name
  details    : LargeString;          // JSON representation of changes / values
}

entity AppAuthorizations : cuid, managed {
  userId               : String(100) not null;
  userName             : String(200);
  email                : String(255);
  isSuperAdmin         : Boolean @default: false;
  canManageAppUsers    : Boolean @default: false;
  canManageOrgRoles    : Boolean @default: false;
  canManageSingleRoles : Boolean @default: false;
  canManageDerivedRoles: Boolean @default: false;
  managedDerivedRolesScope: LargeString @default: 'ALL';
  canAssignRoles       : Boolean @default: false;
  canManageReplications: Boolean @default: false;
  canViewAuditLogs     : Boolean @default: false;
  canManageSettings    : Boolean @default: false;
  allowedEnvironments  : String(50) @default: 'ALL';
  allowedAccessDomains : String(1000) @default: 'ALL';  // JSON array of access domain IDs or 'ALL'
  lastLogin            : DateTime;
  isActive             : Boolean @default: true;
}

entity Environments {
  key ID : String(10); // 'P', 'Q', 'D'
  name   : String(100) not null;
}

entity Replications : cuid {
  replicationDate  : DateTime;
  status           : String(20) not null; // e.g. 'Open', 'Running', 'Success', 'Failed'
  replicationRoles : String(1000) not null;
  environment      : Association to Environments;
  startTime        : DateTime;
  endTime          : DateTime;
  user             : String(200);
  runId            : String(100);
}

// ---------------------------------------------------------------------------
// Dynamic Role & Assignment Generation
// ---------------------------------------------------------------------------

entity Customers : managed {
  key ID          : String(50); // e.g. 'C1001'
  name            : String(255);
  responsibleUser : String(200); // User email/ID
  status          : String(20) @default: 'ACTIVE';
}

entity DynamicGenerationRules : managed {
  key ID                  : String(36) @default : 'uuid()';
  code                    : String(50) not null;                 // e.g. 'CUST_RESP'
  description             : String(255);
  isActive                : Boolean @default : true;

  sourceType              : String(20) not null;                 // 'LOCAL_DB' | 'HANA_VIEW' | 'ODATA_SERVICE'
  sourceEntity            : String(255) not null;                // e.g. 'CUSTOMERS_VW' (BDC Asset ID)
  sourceResponsibleField  : String(100) not null;                // e.g. 'responsibleUser'
  sourceFilterCondition   : String(500);

  generationMode          : String(30) not null;                 // 'USER_CONSOLIDATED_ROLE' | 'TEMPLATE_ASSIGNMENT'
  templateRole            : Association to Roles;
  bdcConnection           : Association to BdcSettings;
  accessDomain            : Association to AccessDomains not null;     // Mapped Access Domain definition
  environment             : Association to Environments not null; // Mapped Environment definition
  mappings                : Composition of many DynamicRuleFieldMappings on mappings.rule = $self;
  filterType              : String(20) @default : 'MULTI_VALUE';
}

entity DynamicRuleFieldMappings : cuid, managed {
  rule                    : Association to DynamicGenerationRules;
  sourceKeyField          : String(100) not null;                // e.g. 'ID'
  targetRestrictionField  : String(100) not null;                // e.g. 'Customer'
}

entity GeneratedResourceMap : cuid, managed {
  rule                    : Association to DynamicGenerationRules not null;
  masterRecordKey         : String(255) not null;                // e.g. 'C1001' or JSON string for composite keys
  userId                  : String(200) not null;
  generatedRole           : Association to Roles;
  generatedRestriction    : Association to Restrictions;
  generatedAssignment     : Association to RoleAssignments;
}


