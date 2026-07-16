# Pre-Sales Presentation Deck: SAP BDC Authorization Wizard
## *From Authorization Chaos to Scalable Access Governance*

---

````carousel
## SLIDE 1 — Title Slide

# SAP BDC Authorization Wizard
### Enterprise Access Governance for SAP HANA & SAP Datasphere

**Transforming manual database permission tables and fragile security logic into a governed, scalable, self-service authorization platform.**

---

*SAP BDC Authorization Wizard*
*Client Presentation*

<!-- slide -->

## SLIDE 2 — Agenda

# What We'll Cover Today

1. 🔴 **The Challenge** — Central IT bottlenecks & query performance issues
2. 🧩 **Our Solution** — SAP BDC Authorization Wizard
3. 🏢 **Decentralized Self-Service** — Delegated control with parent-child roles
4. ⚙️ **Namespaced Performance** — Dynamic Stream-specific HANA tables
5. 🤖 **DRAGE Automation** — Idempotent user assignment synced from master data
6. 📋 **Guided Authorization Wizard** — Step-by-step role creation & live simulation
7. 🚀 **Business Value & ROI**

<!-- slide -->

## SLIDE 3 — The Enterprise Challenge

# Why Access Governance Breaks at Scale

### The Maintenance Bottleneck
* **IT Dependency**: Every new regional plant, department, or customer category requires Central IT to manually script and deploy new database authorization rows.
* **Access Delays**: Business units wait days or weeks for security access, impacting monthly financial closes and operational agility.
* **Sprawl & Chaos**: Databases become cluttered with duplicate, undocumented, and stale permission roles.

### The Performance Hit
* **Single Table Sprawl**: Storing millions of row-level permission lines in a single massive database table causes query execution speeds to slow down.
* **Collision Risk**: A user requiring different access scopes for the same field (e.g., viewing all plants for Reporting, but planning only one plant) cannot easily split access contexts.

<!-- slide -->

## SLIDE 4 — Introducing SAP BDC Authorization Wizard

# A Purpose-Built Access Governance Platform

```
┌─────────────────────────────────────────────────────┐
│             SAP BDC Authorization Wizard             │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Guided     │  │  DRAGE      │  │  Stream    │  │
│  │  Wizard     │  │  Engine     │  │  Namespace │  │
│  │  (Step 1-4)  │  │  (AutoSync) │  │  (HANA DDL)│  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Access     │  │  Compliance │  │  Predefined│  │
│  │  Simulation │  │  Audit Logs │  │  BDC Views │  │
│  │  (Dry-Runs) │  │  (JSON diff)│  │  (Reuse)   │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────┘
```

* **Core Stack**: Native SAP CAP (Node.js) OData v4 engine integrated with React + Material UI.
* **Database Target**: SAP HANA (Production) and SQLite (Local development).

<!-- slide -->

## SLIDE 5 — Decentralized Self-Service & Role Inheritance

# Delegate Local Security Without Losing IT Control

We split authorization management into two distinct layers to enable safe self-service:

```
┌────────────────────────────────────────────────────────┐
│  Parent Role (Structural Template)                     │
│  → Managed by Central IT (canManageSingleRoles = True)  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼ (Inheritance)
┌────────────────────────────────────────────────────────┐
│  Derived Roles (Localized Parameters)                  │
│  → Managed by Local Business Admins                    │
│    (canManageDerivedRoles = True)                      │
└────────────────────────────────────────────────────────┘
```

* **Central Control**: Central IT defines structural boundaries (e.g. "All finance roles must restrict by Company Code").
* **Local Autonomy**: Regional managers autonomously create localized derived roles and assign them to users, without IT ticket queues.
* **Inherited Security**: Template rules are read-only and child roles cannot weaken them.

<!-- slide -->

## SLIDE 6 — Classification Streams & Namespaced Tables

# High-Performance Query Isolation in SAP HANA

To prevent database slowdowns, the Wizard introduces **Classification Streams**:

```
Stream Created: sales
       ↓ (Backend triggers DDL)
Table created in HANA: sales_flat_authorizations
```

### Core Business Benefits
1. **Isolated Performance**: Every Stream (e.g., `Finance`, `Sales`, `HR`) automatically provisions a dedicated flat table in HANA. Filters are written *only* to the relevant stream table, keeping indexes small and query latency near zero.
2. **Context-Based Splitting**:
   * *The Problem*: In **Sales Reporting** a user needs access to all organizations, but in **Sales Planning** only to their local unit.
   * *The Solution*: The user gets a Reporting role in the `sales-reporting` stream and a Planning role in the `sales-planning` stream. The contexts are separated in different tables, preventing collision.

<!-- slide -->

## SLIDE 7 — Predefined View Reuse

# Zero Duplicate Views or Extra Modeling

```
SAP BDC General Modeling Views
           │
           ├──► Used for BDC Analytics & Relational Data
           │
           └──► Reused Directly for Restriction Lookup
                (No duplicate security views needed)
```

* **Direct Integration**: The Wizard connects to your existing predefined views in SAP BDC to load restriction values.
* **Simplicity**: No separate security views are required in your database just to serve the authorization wizard.
* **Reliability**: Values in the wizard dropdowns are always in sync with your real-world master data models.

<!-- slide -->

## SLIDE 8 — DRAGE: Dynamic Role & Assignment Engine

# Fully Automated Security via Data Mappings

The **DRAGE Engine** automates user access lifecycles by reading master data.

```
Master Record Created (e.g. customer)
          ↓
DRAGE detects owner email column
          ↓
Creates / updates User Consolidated Role
          ↓
Syncs to HANA flat table automatically
```

* **Flexible Key Mapping**: Define source columns and target restriction fields.
* **Ignore Option**: Map fields to `Ignore (Do not map to restriction)` to validate record ownership without cluttering target roles with unnecessary restrictions.
* **Clean Deletions**: If a master record is updated or deleted, DRAGE automatically cleans up the generated roles and assignments.

<!-- slide -->

## SLIDE 9 — The Guided 4-Step Wizard

# Role Engineering Made Simple

### Step 1: Origin
Define the role type (Single/Derived/Org-based), environment, name, and classification stream.

### Step 2: Restrictions & Live Simulation
Build restrictions (Single, Multi-value, Range, Hierarchy, Wildcard).
* **Access Simulation**: Enter test rows in JSON and run a live access check before deploying. Green indicates allowed; Red indicates blocked.

### Step 3: Declaring Approvers
Enforce governance by selecting required approvers via SCIM lookups.

### Step 4: Review & Impact Analysis
Review the configuration. If changing a parent role, the system warns you of the downstream impact on child roles and active users.

<!-- slide -->

## SLIDE 10 — Compliance, Auditing, & ROI

# Audit-Ready by Design

* **Field-Level Diff Logging**: Every role modification, user assignment, or replication is logged in an append-only table. Shows who changed what with an exact old vs. new value JSON diff.
* **Compliance Checks**: Filter logs by critical roles, specific administrators, or actions (Create/Update/Delete).

### Return on Investment (ROI)
* ⏱️ **Time to Access**: Reduced from **days/weeks to minutes**.
* 🛡️ **Zero Errors**: Pre-deployment access simulation and value validation prevent security leaks.
* 📈 **HANA Performance**: Namespaced stream tables keep queries fast even with millions of records.
* 💼 **Resource Savings**: Local business administrators self-serve local access, saving hundreds of IT hours.
```
```

---

> [!NOTE]
> This deck is structured as 10 slides. To convert to PowerPoint, each section between `<!-- slide -->` markers represents one slide.
