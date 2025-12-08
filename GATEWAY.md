# NextBid Gateway & Patcher - System Architecture & Design Document

---

## Executive Summary

The **NextBid Gateway** is the authentication portal for all NextBid services. The **NextBid Patcher** (future) will be the central nervous system that coordinates deployment, configuration, and content distribution across all NextBid components:

- **NextBid Engine** - Core business logic and AI pipelines
- **Tradeline Servers** - Specialized processing nodes per trade
- **NextBid Portal** - User-facing dashboards and credential vaults
- **NextTech** - Field/SOP application for execution teams

The Gateway provides authenticated access to all services. The Patcher (when built) will ensure every component runs the correct code version, receives the correct configuration, and operates with the correct content - all while maintaining independence and scalability.

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [System Components](#2-system-components)
3. [The Patcher - Central Control System](#3-the-patcher---central-control-system)
4. [Database Architecture](#4-database-architecture)
5. [Per-User Background Processing](#5-per-user-background-processing)
6. [The Never-Ending Task Manager](#6-the-never-ending-task-manager)
7. [Deployment Infrastructure](#7-deployment-infrastructure)
8. [Version Management](#8-version-management)
9. [Security Model](#9-security-model)
10. [Why the Patcher is the Keystone](#10-why-the-patcher-is-the-keystone)

---

## 1. Architectural Overview

NextBid uses a **hub-and-spoke model**:

```
                                    ┌─────────────────────┐
                                    │                     │
                                    │   NEXTBID PATCHER   │
                                    │   (Central Hub)     │
                                    │                     │
                                    │  - Code Versions    │
                                    │  - Content Packs    │
                                    │  - Configuration    │
                                    │  - Task Templates   │
                                    │                     │
                                    └──────────┬──────────┘
                                               │
              ┌────────────────────────────────┼────────────────────────────────┐
              │                                │                                │
              ▼                                ▼                                ▼
    ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
    │   TRADELINE     │              │   USER          │              │   NEXTTECH      │
    │   SERVERS       │              │   PORTALS       │              │   APPS          │
    │                 │              │                 │              │                 │
    │  security_*     │              │  Credentials    │              │  SOP Viewer     │
    │  roofing_*      │              │  Preferences    │              │  Field Tasks    │
    │  hvac_*         │              │  Task Queue     │              │  Feedback       │
    │  facilities_*   │              │  Region Config  │              │  Execution      │
    │  logistics_*    │              │                 │              │                 │
    └─────────────────┘              └─────────────────┘              └─────────────────┘
              │                                │                                │
              └────────────────────────────────┼────────────────────────────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │                     │
                                    │   SHARED DATABASE   │
                                    │                     │
                                    │  security_*         │
                                    │  roofing_*          │
                                    │  hvac_*             │
                                    │  nextbid_* (global) │
                                    │                     │
                                    └─────────────────────┘
```

### Key Principles

1. **Single Source of Truth** - The Patcher holds all version manifests and content packs
2. **Tradeline Isolation** - Each tradeline writes only to its prefixed tables
3. **Global Visibility** - The `nextbid_*` tables provide cross-tradeline intelligence
4. **Configuration as Data** - Behavior changes without code redeployment

---

## 2. System Components

### 2.1 NextBid Engine (Core Logic Server)

The Engine contains all business logic, AI integrations, and worker pipelines. It is **completely tradeline-agnostic**.

**What it does:**
- Scraper orchestration (SAM, PlanetBids, Public Purchase, RSS, etc.)
- Opportunity discovery and classification
- AI integrations (BidWriter, categorization, matching)
- Worker pipelines (Discovery → Scrubber → Research → Proposal)

**What it does NOT do:**
- Contain roofing-specific logic
- Contain security-specific logic
- Hardcode any tradeline behavior

The same engine code runs on every tradeline server - behavior is determined at runtime by environment and configuration.

### 2.2 Tradeline Servers (Specialized Instances)

Each tradeline runs as an independent server instance:

| Server | Domain | Table Prefix |
|--------|--------|--------------|
| Security | `security.nextbidserver.com` | `security_*` |
| Roofing | `roofing.nextbidserver.com` | `roofing_*` |
| HVAC | `hvac.nextbidserver.com` | `hvac_*` |
| Facilities | `facilities.nextbidserver.com` | `facilities_*` |
| Logistics | `logistics.nextbidserver.com` | `logistics_*` |
| Low Voltage | `lowvoltage.nextbidserver.com` | `lowvoltage_*` |
| Electrical | `electrical.nextbidserver.com` | `electrical_*` |
| Plumbing | `plumbing.nextbidserver.com` | `plumbing_*` |
| Custodial | `custodial.nextbidserver.com` | `custodial_*` |
| IT Services | `it.nextbidserver.com` | `it_*` |
| Environmental | `environmental.nextbidserver.com` | `environmental_*` |
| Painting | `painting.nextbidserver.com` | `painting_*` |
| Admin/Business | `admin.nextbidserver.com` | `admin_*` |

**Each tradeline server:**

1. Reads identity from `.env`:
   ```
   TRADELINE=security
   ```

2. Loads its **tradeline filter JSON**:
   ```json
   {
     "naics_codes": ["561612", "561621", "922160"],
     "psc_codes": ["S206", "S208", "J063"],
     "keywords": ["security guard", "patrol", "fire alarm", "life safety"],
     "unspsc_codes": ["92121500", "46171600"]
   }
   ```

3. Receives patches from the Patcher

4. Writes ONLY to its prefixed tables (`security_opportunities`, `security_sources`, etc.)

5. Runs workers filtered to its tradeline's codes and keywords

### 2.3 NextBid Portal (User Portal)

Each user/company gets their own Portal instance that stores:

- **Credentials** - SAM.gov, Public Purchase, state portals, agency logins
- **Tradeline Selection** - Which trades they operate in
- **Region Configuration** - States, counties, cities they cover
- **Source Preferences** - Which portals to activate
- **Task Queue** - Personal productivity pipeline

**The Portal communicates bidirectionally:**

```
Portal → Patcher:  "Here's what I'm configured for"
Patcher → Portal:  "Here's your latest UI + content + tasks"
Portal → Engine:   "Run these tradelines in these regions with these credentials"
Engine → Portal:   "Here are your opportunities and task assignments"
```

### 2.4 NextTech (Field/SOP Application)

The execution and validation layer for field teams:

- **SOP Viewer** - Standard operating procedures by tradeline
- **Catalog Access** - Materials, labor rates, assemblies
- **Task Execution** - Field work tracking
- **Feedback Loop** - "This SOP step is wrong" / "This spec doesn't work"

Every NextTech interaction improves:
- SOP accuracy
- Catalog relevance
- Real-world constraint data
- Post-award workflows

---

## 3. The Patcher - Central Control System

The Patcher is the most critical component in the ecosystem.

### 3.1 Code Distribution

The Patcher maintains version manifests for all components:

```json
{
  "manifest_version": "2025-12-08.01",
  "components": {
    "engine": {
      "version": "1.3.2",
      "checksum": "sha256:abc123...",
      "release_date": "2025-12-08"
    },
    "portal": {
      "version": "0.9.5",
      "checksum": "sha256:def456...",
      "release_date": "2025-12-07"
    },
    "tech": {
      "version": "0.6.1",
      "checksum": "sha256:ghi789...",
      "release_date": "2025-12-05"
    }
  },
  "content": {
    "sources": "2025-12-08.01",
    "catalogs": "2025-12-06.01",
    "sops": "2025-12-04.01",
    "filters": "2025-12-08.01"
  }
}
```

**Distribution flow:**

1. Development pushes update to dev server
2. Patcher packages update into versioned bundle
3. Patcher updates manifest
4. Each instance checks manifest on schedule/startup
5. If newer version available, instance pulls and applies update

### 3.2 Content Distribution

The Patcher distributes **content packs** that include:

| Content Type | Description |
|--------------|-------------|
| `nb_sources` | Global source registry (250+ portals) |
| `nb_source_tradelines` | Source → tradeline mapping |
| `nb_catalogs` | Materials, labor, assemblies |
| `nb_sops` | Standard operating procedures |
| `nb_task_templates` | Task generation rules |
| `nb_competitors` | Competitor intelligence |
| `nb_agencies` | Agency/contact database |

**Every instance receives the same content pack** but filters based on:
- Its tradeline
- Its region
- Its assigned portals
- User configuration

### 3.3 Configuration Synchronization

The Patcher centralizes all system configuration:

```json
{
  "scraper_profiles": {
    "public_purchase": {
      "rate_limit_ms": 2000,
      "max_concurrent": 3,
      "retry_attempts": 2
    },
    "planetbids": {
      "rate_limit_ms": 1500,
      "max_concurrent": 5,
      "retry_attempts": 3
    }
  },
  "feature_flags": {
    "ai_categorization": true,
    "competitor_tracking": true,
    "catalog_v2": false
  },
  "rollout": {
    "new_scraper_logic": ["security", "lowvoltage"],
    "catalog_v2_beta": ["roofing"]
  }
}
```

**This eliminates code redeployment for:**
- Rate limit adjustments
- Platform selector changes
- Feature rollouts
- Regional scheduling
- Task generation rules

---

## 4. Database Architecture

### 4.1 Shared Database, Isolated Tables

All tradelines share **one physical database** with **prefix isolation**:

```
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE DATABASE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TRADELINE TABLES (isolated by prefix)                         │
│  ├── security_opportunities                                     │
│  ├── security_sources                                           │
│  ├── security_awards                                            │
│  ├── security_companies                                         │
│  │                                                              │
│  ├── roofing_opportunities                                      │
│  ├── roofing_sources                                            │
│  ├── roofing_awards                                             │
│  │                                                              │
│  ├── hvac_opportunities                                         │
│  ├── hvac_sources                                               │
│  └── ... (all 13 tradelines)                                    │
│                                                                 │
│  GLOBAL TABLES (nextbid_* prefix)                               │
│  ├── nextbid_canon_opportunities   (cross-tradeline dedup)      │
│  ├── nextbid_agencies              (unified agency graph)       │
│  ├── nextbid_competitors           (competitor intelligence)    │
│  ├── nextbid_analytics             (system-wide metrics)        │
│  └── nextbid_task_assignments      (task manager state)         │
│                                                                 │
│  CONTENT TABLES (nb_* prefix)                                   │
│  ├── nb_sources                    (global source registry)     │
│  ├── nb_source_tradelines          (source → tradeline map)     │
│  ├── nb_catalogs                   (materials/labor/assemblies) │
│  ├── nb_catalog_tradelines         (catalog → tradeline map)    │
│  ├── nb_sops                       (standard procedures)        │
│  └── nb_sop_tradelines             (SOP → tradeline map)        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Access Rules

| Table Prefix | Tradeline Servers | NextBid Global | User Portals |
|--------------|-------------------|----------------|--------------|
| `security_*` | Read/Write (security only) | Read | Read |
| `roofing_*` | Read/Write (roofing only) | Read | Read |
| `nextbid_*` | Read only | Read/Write | Read |
| `nb_*` | Read only | Read/Write | Read |

### 4.3 Canon / Duplicate Detection

The `nextbid_canon_opportunities` table watches across all tradeline tables:

- Detects when the same opportunity appears in multiple trades
- Maintains canonical ID mapping
- Prevents duplicate notifications
- Enables cross-tradeline analytics

---

## 5. Per-User Background Processing

Every NextBid Portal triggers personalized background work.

### Example: Roofing Contractor in Florida

**Portal Configuration:**
```json
{
  "portal_id": "P1047",
  "user_id": "U8842",
  "tradelines": ["roofing"],
  "regions": ["FL"],
  "credentials": [
    {"source": "sam_gov", "status": "valid"},
    {"source": "florida_state", "status": "valid"},
    {"source": "public_purchase", "status": "valid"}
  ],
  "active_sources": [
    "sam_gov",
    "florida_myflorida",
    "public_purchase_fl"
  ]
}
```

**Engine Job Created:**
```
Run roofing discovery for Portal P1047
  - Region: FL
  - Sources: SAM, FL State, Public Purchase
  - Credentials: Use P1047's vault
  - Filters: roofing NAICS/keywords
  - Write to: roofing_opportunities
```

### Distributed Intelligence

Every user becomes a **distributed discovery agent**:

- Roofer in FL searches FL sources with FL credentials
- Roofer in AZ searches AZ sources with AZ credentials
- Security contractor in CA searches CA sources with CA credentials

**Result:** The more users, the more complete the database becomes for everyone.

---

## 6. The Never-Ending Task Manager

The Task Manager ensures every user always has productive work.

### 6.1 Task Generation Logic

```
IF user has open opportunities:
    Assign opportunity-related tasks:
    - Qualify these 3 new ops
    - Draft section 1.3 for this RFP
    - Review compliance matrix
    - Estimate materials for this job

ELSE:
    Assign improvement tasks:
    - Scan 5 Sources Sought postings
    - Identify 3 competitors in your region
    - Verify agency contacts
    - Review scraped metadata quality
    - Update NAICS accuracy
    - Add missing BOM components
    - Improve SOP documentation
```

### 6.2 Role-Based Task Assignment

| Role | Primary Tasks | System Impact |
|------|---------------|---------------|
| **Procurement Officer** | Scan sources, tag opportunities, verify deadlines | Trains opportunity classifier, improves coverage |
| **Bid Writer** | Review AI drafts, save templates, flag issues | Trains BidWriter AI, builds template library |
| **Estimator** | Build BOMs, map catalog items, tag cost drivers | Improves pricing engine, catalog relevance |
| **Field Tech** | Mark SOP accuracy, add missing steps, capture issues | Improves SOP library, real-world constraints |
| **Admin/Ops** | Merge duplicates, resolve conflicts, approve sources | Cleans agency graph, reduces noise |

### 6.3 The Hidden Flywheel

**What users see:**
- "I'm improving MY portal, MY bids, MY win rate"

**What the system gains:**
- Improved AI models
- Higher-quality source classification
- Better regional coverage
- Stronger catalogs
- Cleaner competitor databases
- More accurate opportunity matching
- Validated SOP content

Every task is a **distributed training step** for the entire ecosystem.

---

## 7. Deployment Infrastructure

### 7.1 Current Droplets

| Droplet | IP Address | Purpose | PM2 Apps |
|---------|------------|---------|----------|
| **Engine** | `64.23.151.201` | Production tradelines + Patcher | lowvoltage, nextbid-patcher |
| **Dev** | `161.35.229.220` | Development & NextBid Sources | nextbid-sources |
| **Portal** | TBD | Client-facing portal | TBD |

### 7.2 SSH Access

```bash
# Engine droplet (Patcher + tradelines)
ssh root@64.23.151.201

# Dev droplet (Sources + testing)
ssh root@161.35.229.220
```

### 7.3 Deployment Commands

**Deploy Patcher:**
```bash
ssh root@64.23.151.201
cd /var/www/nextbid-patcher && git pull && pm2 restart nextbid-patcher
```

**Deploy Sources:**
```bash
ssh root@161.35.229.220
cd /var/www/nextbid-sources && git pull && pm2 restart nextbid-sources
```

---

## 8. Version Management

### 8.1 Version Tracking

Each instance reports its current versions:

```json
{
  "instance_id": "security-prod-01",
  "tradeline": "security",
  "versions": {
    "engine": "1.3.1",
    "content": "2025-12-07.02"
  },
  "last_check": "2025-12-08T09:00:00Z"
}
```

### 8.2 Rollout Strategies

**Staged Rollout:**
```json
{
  "feature": "new_scraper_logic",
  "phase_1": ["security", "lowvoltage"],
  "phase_2": ["facilities", "logistics"],
  "phase_3": ["*"]
}
```

**Rollback:**
```json
{
  "action": "rollback",
  "component": "engine",
  "from_version": "1.3.2",
  "to_version": "1.3.1",
  "affected_tradelines": ["security"]
}
```

---

## 9. Security Model

### 9.1 Credential Vault

User credentials are stored in portal-level vaults:

```
portal_credentials:
  - portal_id
  - source_id (sam_gov, public_purchase, etc.)
  - credential_type (username_password, api_key, oauth)
  - encrypted_secret
  - last_verified
  - status (valid, failed, expired)
```

**Rules:**
- Credentials never leave the vault unencrypted
- Engine workers request credential references, not raw secrets
- Logs never contain passwords or tokens

### 9.2 Rate Limiting

Global throttles prevent abuse:

```json
{
  "public_purchase": {
    "global_max_per_minute": 30,
    "per_portal_max_per_hour": 100
  },
  "sam_gov": {
    "global_max_per_minute": 60,
    "per_portal_max_per_hour": 200
  }
}
```

This prevents 200 portals from collectively hammering external systems.

---

## 10. Why the Patcher is the Keystone

### Without the Patcher:

- Tradeline servers drift out of sync
- Users run incompatible portal versions
- Tech apps break when SOPs change
- Scraper adjustments require redeploying every instance
- Feature releases become chaotic
- Source lists become inconsistent
- Catalogs and task templates fragment

### With the Patcher:

- All servers, apps, and portals run consistent builds
- Global content updates propagate instantly
- Per-tradeline behavior determined automatically
- Scraper failures patched centrally
- New features rolled out gradually
- All users receive correct updates
- All parts of the ecosystem evolve together

### The Resulting System

| Component | Role |
|-----------|------|
| **NextBid Engine** | Distributed national contracting intelligence grid |
| **Tradeline Servers** | Specialized processing nodes per trade |
| **NextBid Portals** | Tenant configuration + credential vault + task dashboard |
| **NextTech** | Execution and validation layer |
| **Patcher** | Central nervous system - consistency, safety, versioning |
| **Task Manager** | Productivity engine + hidden AI training system |

---

## Summary

The NextBid Patcher maintains **platform coherence** across:
- Hundreds of servers
- Thousands of portals
- Millions of background tasks

While enabling:
- Rapid iteration
- Safe rollouts
- Clean tradeline specialization
- Distributed user contribution
- Self-improving AI systems

It is the **single point of orchestration** for the entire NextBid ecosystem.

---

*Last updated: December 8, 2025*
