# Data Model Reference

This document describes every entity in `db/schema.cds` with field-level detail.
The CDS namespace is `fanrio.auth`. The OData service is exposed at `/odata/v4/auth/`.

> [!NOTE]
> This file is the canonical reference for AI agents. When in doubt about field names,
> types, or associations, read this before reading schema.cds.

---

## Entities Index

| Entity | Purpose |
|---|---|
| [OrgNodes](#orgnodes) | Organizational hierarchy tree |
| [OrgNodeAttributes](#orgnodeattributes) | Key-value metadata on org nodes |
| [RestrictionFields](#restrictionfields) | Field type definitions for restrictions |
| [Streams](#streams) | Role classification hierarchy |
| [StreamAttributes](#streamattributes) | Key-value metadata on streams |
| [Roles](#roles) | Authorization roles |
| [Restrictions](#restrictions) | Restriction conditions on a role |
| [RoleInheritance](#roleinheritance) | Role parent-child relationships |
| [RoleApprovers](#roleapprovers) | Approver users for a role |
| [RoleAssignments](#roleassignments) | User-to-role assignments |
| [BdcSettings](#bdcsettings) | BDC/HANA connection configurations |
| [AuditLogs](#auditlogs) | Immutable audit trail |
| [AppAuthorizations](#appauthorizations) | Per-user application permission flags |
| [Environments](#environments) | Environment definitions (D/Q/P) |
| [Replications](#replications) | Replication job records |
| [Customers](#customers) | Master data: Customer records (DRAGE source) |
| [DynamicGenerationRules](#dynamicgenerationrules) | DRAGE rule definitions |
| [DynamicRuleFieldMappings](#dynamicrulefieldmappings) | Field mappings within a DRAGE rule |
| [GeneratedResourceMap](#generatedresourcemap) | Tracking table for DRAGE-generated entities |

---

## OrgNodes

**Purpose**: Tree of organizational units (e.g. Company → Country → Plant).

| Field | Type | Notes |
|---|---|---|
| `ID` | String(36) | UUID, primary key |
| `name` | String(100) | Display name of the node |
| `type` | → RestrictionFields | Defines what kind of restriction this node represents |
| `parent` | → OrgNodes | Self-referential parent (null = root) |
| `children` | ← OrgNodes | Composition — all child nodes |
| `attributes` | ← OrgNodeAttributes | Composition — key/value attributes |
| `roles` | ← Roles | Association to roles generated from this node |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` auto-populated |

**CSV seed file**: `db/data/fanrio.auth-OrgNodes.csv`

---

## OrgNodeAttributes

**Purpose**: Key-value pairs attached to an org node (e.g. `Country=Germany`).

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `node` | → OrgNodes | Parent org node |
| `field` | String(100) | Attribute name, e.g. `Country`, `Plant` |
| `value` | String(200) | Attribute value, e.g. `Germany`, `DE01` |

**CSV seed file**: `db/data/fanrio.auth-OrgNodeAttributes.csv`

---

## RestrictionFields

**Purpose**: Defines what restriction fields exist (e.g. "Plant", "Company Code"). Each field can optionally link to a BDC asset for value lookup.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `name` | String(100) | Display name, e.g. `Plant`, `Customer` |
| `bdcConnection` | → BdcSettings | Optional: BDC connection for value lookup |
| `asset` | String(255) | BDC Asset ID |
| `assetText` | String(255) | BDC Asset text/display name |
| `assetHierarchy` | String(255) | BDC hierarchy asset for hierarchy-mode lookups |
| `withHierarchyDirectory` | Boolean | Whether hierarchy directory is enabled |
| `idColumns` | String(500) | JSON array of key column names, e.g. `["id"]` |
| `textColumn` | String(100) | Column name for display text |

**CSV seed file**: `db/data/fanrio.auth-RestrictionFields.csv`

---

## Streams

**Purpose**: Hierarchical classification structure for roles (e.g. Finance → Controlling → Plant Accounting). Creating a Stream automatically creates a corresponding HANA flat table `[name]_flat_authorizations`.

| Field | Type | Notes |
|---|---|---|
| `ID` | String(36) | Primary key (not auto-uuid — caller sets it) |
| `name` | String(10) | **Max 10 chars** — used to generate table name |
| `description` | String(200) | Optional description |
| `type` | → RestrictionFields | Optional: restriction field type classification |
| `parent` | → Streams | Self-referential parent |
| `children` | ← Streams | Composition — child streams |
| `attributes` | ← StreamAttributes | Composition — key/value attributes |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |

> [!IMPORTANT]
> The `name` field is limited to 10 characters. It is sanitized and used as a SQL table name suffix.
> The resulting HANA table is named: `<sanitized_name>_flat_authorizations`.

**CSV seed file**: `db/data/fanrio.auth-Streams.csv`

---

## StreamAttributes

**Purpose**: Key-value metadata pairs on a stream node.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `node` | → Streams | Parent stream |
| `field` | String(100) | Attribute name |
| `value` | String(200) | Attribute value |

**CSV seed file**: `db/data/fanrio.auth-StreamAttributes.csv`

---

## Roles

**Purpose**: The core authorization object. Roles hold restrictions and can be assigned to users.

| Field | Type | Notes |
|---|---|---|
| `ID` | String(36) | UUID primary key |
| `name` | String(200) | Unique display name |
| `type` | String(20) | `SINGLE` \| `DERIVED` \| `ORG_BASED` |
| `description` | String(500) | Optional description |
| `critical` | Boolean | High-risk flag |
| `environment` | → Environments | Which environment this role applies to (D/Q/P) |
| `orgNode` | → OrgNodes | Set for `ORG_BASED` roles |
| `stream` | → Streams | **Required** — defaults to `'app-global'` |
| `parentRoles` | ← RoleInheritance | Roles this role inherits from |
| `childRoles` | ← RoleInheritance | Roles that inherit from this one |
| `ownRestrictions` | ← Restrictions | Composition — directly owned restrictions |
| `assignments` | ← RoleAssignments | Composition — user assignments |
| `approvers` | ← RoleApprovers | Composition — approver users |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |

**Role types**:
- `SINGLE`: Standalone role with own restrictions
- `DERIVED`: Inherits restrictions from parent roles + can add own
- `ORG_BASED`: Auto-generated from an OrgNode; restrictions come from the node's attributes

**CSV seed file**: `db/data/fanrio.auth-Roles.csv`

---

## Restrictions

**Purpose**: An authorization condition on a role for a specific field.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `role` | → Roles | Parent role |
| `field` | String(100) | Restriction field name (matches `RestrictionFields.name`) |
| `filterType` | String(20) | See filter type table below |
| `value` | String(1000) | Encoded value — format depends on filterType |
| `sourceLabel` | String(200) | Display hint: which ancestor introduced this restriction |

**Filter Types**:

| filterType | Value format | Example |
|---|---|---|
| `SINGLE_VALUE` | Plain string | `Germany` |
| `MULTI_VALUE` | JSON array | `["DE01","DE02","DE03"]` |
| `RANGE` | JSON object `{from, to}` | `{"from":1000,"to":50000}` |
| `BT` | JSON object `{from, to}` | `{"from":"DE01","to":"DE02"}` |
| `HIERARCHY` | OrgNode ID string | `"a1b2c3d4-..."` |
| `PATTERN` | String with wildcards | `"CC1%"` |

> [!NOTE]
> `RANGE` and `BT` are treated identically in the backend. Both are parsed as `{from, to}`.
> In the UI, they display as "from [from] and to [to]".

**CSV seed file**: `db/data/fanrio.auth-Restrictions.csv`

---

## RoleInheritance

**Purpose**: Many-to-many join table for role parent-child relationships.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `role` | → Roles | The child role (the one inheriting) |
| `parent` | → Roles | The parent role (the one being inherited from) |

---

## RoleApprovers

**Purpose**: Users who must approve changes to a role.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `role` | → Roles | The role requiring approval |
| `userId` | String(200) | Approver's user ID |
| `userName` | String(200) | Approver's display name |

---

## RoleAssignments

**Purpose**: Links a user to a role. Creating an assignment triggers HANA flat-table replication.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `role` | → Roles | The assigned role |
| `userId` | String(200) | Assignee's user ID / email |
| `userName` | String(200) | Assignee's display name |

> [!IMPORTANT]
> Creating or deleting a `RoleAssignment` triggers `syncAssignmentToHana()` in `assignmentHandlers.js`.
> This resolves all effective restrictions and writes Cartesian-product expanded rows to:
> 1. The default AUTHORIZATION_FLAT table on all active HANA connections
> 2. The stream-specific `[stream_name]_flat_authorizations` table

---

## BdcSettings

**Purpose**: Connection configuration for SAP BDC (OData) or SAP HANA connections.

| Field | Type | Notes |
|---|---|---|
| `ID` | String(36) | UUID primary key |
| `systemName` | String(100) | Display name for the connection |
| `connectionType` | String(50) | `OData` \| `SAP Hana` |
| `environment` | → Environments | Which environment (D/Q/P) |
| `url` | String(255) | Base URL for OData connections |
| `host` | String(255) | Hostname for HANA connections |
| `port` | Integer | Port (default: 443) |
| `authType` | String(50) | `BASIC` \| `OAUTH` \| `TOKEN` |
| `space` | String(100) | BDC space selection |
| `username` | String(100) | For BASIC auth |
| `password` | String(100) | For BASIC auth |
| `tokenUrl` | String(255) | OAuth token endpoint |
| `clientId` | String(100) | OAuth client ID |
| `clientSecret` | String(100) | OAuth client secret |
| `apiToken` | String(255) | For TOKEN auth |
| `taskChainFlat` | String(255) | BDC task chain ID for flat replication (default: `df_authorization_flat`) |
| `taskChainHierarchy` | String(255) | BDC task chain ID for hierarchy replication |
| `isActive` | Boolean | Only active connections receive replication |

**CSV seed file**: `db/data/fanrio.auth-BdcSettings.csv`

---

## AuditLogs

**Purpose**: Immutable append-only log of role and assignment changes.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `entityName` | String(100) | `Roles` or `RoleAssignments` |
| `action` | String(20) | `CREATE` \| `UPDATE` \| `DELETE` |
| `recordId` | String(36) | ID of the changed entity |
| `targetName` | String(255) | Role name or user name |
| `details` | LargeString | JSON representation of changes |
| (managed) | | `createdAt`, `createdBy` |

---

## AppAuthorizations

**Purpose**: Per-user application permission flags. Controls what each user can do in the UI and API.

| Field | Type | Default | Notes |
|---|---|---|---|
| `ID` | UUID (cuid) | Auto | |
| `userId` | String(100) | — | User login ID (e.g. email) |
| `userName` | String(200) | — | Display name |
| `email` | String(255) | — | Email address |
| `isSuperAdmin` | Boolean | false | Bypasses all permission checks |
| `canManageAppUsers` | Boolean | false | Can edit AppAuthorizations |
| `canManageOrgRoles` | Boolean | false | Can create/edit ORG_BASED roles |
| `canManageSingleRoles` | Boolean | false | Can create/edit SINGLE roles |
| `canManageDerivedRoles` | Boolean | false | Can create/edit DERIVED roles |
| `managedDerivedRolesScope` | LargeString | `ALL` | Role name prefix scope |
| `canAssignRoles` | Boolean | false | Can create RoleAssignments |
| `canManageReplications` | Boolean | false | Can trigger replications |
| `canViewAuditLogs` | Boolean | false | Can read AuditLogs |
| `canManageSettings` | Boolean | false | Can manage Streams, RestrictionFields, BdcSettings |
| `allowedEnvironments` | String(50) | `ALL` | Comma-separated env IDs or `ALL` |
| `lastLogin` | DateTime | — | Automatically updated on login |
| `isActive` | Boolean | true | Soft-disable a user |
| (managed) | | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |

---

## Environments

**Purpose**: Simple lookup table for deployment environments.

| Field | Type | Notes |
|---|---|---|
| `ID` | String(10) | Primary key, e.g. `D`, `Q`, `P` |
| `name` | String(100) | Display name, e.g. `Development`, `Production` |

**CSV seed file**: `db/data/fanrio.auth-Environments.csv`

---

## Replications

**Purpose**: Tracks replication job execution records.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `replicationDate` | DateTime | When the replication was initiated |
| `status` | String(20) | `Open` \| `Running` \| `Success` \| `Failed` |
| `replicationRoles` | String(1000) | Comma-separated role names included |
| `environment` | → Environments | Target environment |
| `startTime` | DateTime | Actual start time |
| `endTime` | DateTime | Completion time |
| `user` | String(200) | User who triggered replication |
| `runId` | String(100) | BDC task chain run ID |

**CSV seed file**: `db/data/fanrio.auth-Replications.csv`

---

## Customers

**Purpose**: Master data entity used by the DRAGE engine as a source. When customer ownership changes, DRAGE auto-updates role assignments.

| Field | Type | Notes |
|---|---|---|
| `ID` | String(50) | Business key, e.g. `C1001` |
| `name` | String(255) | Customer display name |
| `responsibleUser` | String(200) | User email/ID who owns this customer |
| `status` | String(20) | `ACTIVE` or other statuses |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |

---

## DynamicGenerationRules

**Purpose**: DRAGE rule definitions. Each rule specifies how to auto-generate roles and assignments from a data source.

| Field | Type | Notes |
|---|---|---|
| `ID` | String(36) | UUID primary key |
| `code` | String(50) | Unique rule code, e.g. `CUST_RESP` |
| `description` | String(255) | Rule description |
| `isActive` | Boolean | Whether this rule is active |
| `sourceType` | String(20) | `LOCAL_DB` \| `HANA_VIEW` \| `ODATA_SERVICE` |
| `sourceEntity` | String(255) | Entity/view name to query |
| `sourceResponsibleField` | String(100) | Field containing the user ID |
| `sourceFilterCondition` | String(500) | Optional WHERE clause |
| `generationMode` | String(30) | `USER_CONSOLIDATED_ROLE` \| `TEMPLATE_ASSIGNMENT` |
| `templateRole` | → Roles | Role used as template (for TEMPLATE_ASSIGNMENT mode) |
| `bdcConnection` | → BdcSettings | Connection for HANA_VIEW / ODATA_SERVICE sources |
| `mappings` | ← DynamicRuleFieldMappings | Field mapping definitions |
| `filterType` | String(20) | Filter type for generated restrictions (default: `MULTI_VALUE`) |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |

---

## DynamicRuleFieldMappings

**Purpose**: Maps source data fields to target restriction field names within a DRAGE rule.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `rule` | → DynamicGenerationRules | Parent rule |
| `sourceKeyField` | String(100) | Field name in source data, e.g. `ID` |
| `targetRestrictionField` | String(100) | Target restriction field name, e.g. `Customer` |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |

---

## GeneratedResourceMap

**Purpose**: Tracking table that records which roles, restrictions, and assignments were created by the DRAGE engine for a given master data record + user combination.

| Field | Type | Notes |
|---|---|---|
| `ID` | UUID (cuid) | Auto-generated |
| `rule` | → DynamicGenerationRules | The rule that generated these resources |
| `masterRecordKey` | String(255) | Key of the source record (e.g. `C1001`) |
| `userId` | String(200) | User these resources belong to |
| `generatedRole` | → Roles | The role that was generated |
| `generatedRestriction` | → Restrictions | The restriction that was generated |
| `generatedAssignment` | → RoleAssignments | The assignment that was generated |
| (managed) | | `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` |
