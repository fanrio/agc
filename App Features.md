# SAP BDC Authorization Wizard — App Features Guide

This document describes the key business features and design concepts of the **Authorization Wizard** governance platform. It is written in business-friendly terms for administrators, managers, and security auditors.

---

## Access Domains

### Description
An **Access Domain** represents a logical boundary, line of business, or data domain within the organization (for example, *Finance*, *Sales*, or *Human Resources*). It organizes roles and data access permissions into clean, isolated compartments.

### Business Purpose & Setup
- **Access Control Boundaries**: Access Domains ensure that security permissions are organized according to your organizational structure, preventing unrelated roles or users from overlapping.
- **Mandatory Fields Definition**: Administrators define specific **Mandatory Restriction Fields** for each Access Domain. For instance, the *Finance* domain might require mapping permissions for *Company Code* and *Plant*, whereas the *Logistics* domain might only require *Warehouse ID*.
- **Role Naming Conventions**: Administrators can define a **Role Template Name** (e.g. `ROLE_{CostCenter}_CUSTOM`) for each Access Domain. This enforces naming consistency for all roles generated or edited within that domain.
  - **Reference Fields**: The template combines free text with reference placeholders (`{FieldName}`) corresponding to the restriction fields defined in the domain.
  - **Interactive Selection**: Users can type free text and insert reference placeholders as visual Chips by pressing the **Ctrl+Space** shortcut, ensuring error-free configuration.
- **Data Governance**: Enforcing mandatory fields ensures that all roles created within a domain are configured consistently and contain all required safety checks.

---

## Derived Roles

### Description
A **Derived Role** is a specialized role that inherits its core security settings, restrictions, and rules from one or more **Parent Roles**. 

### Business Purpose & Handling
- **Reduced Overhead**: Instead of creating every single role from scratch, you can define a template "Parent" role containing common, baseline permissions.
- **Efficient Modifications**: To create a specialized role for a regional team, you simply create a "Derived" role, select the parent template to inherit from, and add only the specific regional restrictions (such as a specific *Plant* code).
- **Consistency**: Updates made to the parent template automatically propagate down to all derived roles, ensuring that security policies are updated globally in one step.

---

## Dependency: How Access Domains and Derived Roles Work Together

To maintain high security standards and prevent misconfigurations, the system enforces a strict relationship between Access Domains and Derived Roles:

1. **Automatic Access Domain Lock**
   When you create a Derived Role and select a parent role, the Derived Role automatically inherits the **Access Domain** of its parent. The Access Domain selection is locked and cannot be changed manually. This guarantees that derived security roles remain within the correct business boundary.

2. **Smart Restriction Field Selection**
   When adding custom restrictions to a Derived Role, the wizard automatically filters the selectable fields:
   - **Domain Compliance**: You can only select fields that have been defined as mandatory for that specific Access Domain.
   - **No Duplication**: You cannot select any fields that are already defined in the parent role. The wizard hides inherited fields to prevent duplicate or conflicting rules.
   - **Wildcard Override Exception**: If a field in the parent role is restricted to a wildcard pattern (`*`), it is treated as a placeholder. The field remains selectable in the derived role so that the child role can narrow down and define the actual values (for example, restricting it to specific countries or plants).

For example, if the *Finance* Access Domain allows the fields *Company Code* and *Plant*, and the parent role restricts *Company Code* to a specific code, but has *Plant* restricted to `*` (any plant), a Derived Role inheriting from it will allow you to add a custom restriction on *Plant* to define specific regional plant codes.

---

## HANA Replication Workflow (General Rule)

To ensure that row-level access control is enforced consistently on the database layer, the replication engine follows a strict three-step workflow when synchronizing role assignments to SAP HANA:

1. **Determine Effective Role Authorization**: 
   The system recursively traverses the parent inheritance chain of the role (resolving all ancestor roles). If a descendant role redefines/restricts a field that is restricted to a wildcard (`*`) in an ancestor role, the descendant's specific values take precedence, and the ancestor's wildcard restriction is discarded.
2. **Create HANA Records (Cartesian Product)**: 
   The system calculates the Cartesian product of all resolved restriction field values to produce a flattened list of authorized combinations.
3. **Save to HANA Flat Tables**: 
   The resulting combinations are written to the database. The system first deletes the old replication rows for the role assignment, then inserts the newly computed rows into the target HANA flat tables (both the global table and the stream-specific authorization tables).
