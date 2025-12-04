# NextBid Patcher - Login Gateway

Central authentication gateway for all NextBid infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PATCHER (Login Gateway)                              │
│                     Port 3001 - Authentication Hub                       │
│                     All backend access goes through here                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    Authenticated Proxy Routes
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│     ENGINE      │      │   DEVELOPMENT   │      │     PORTAL      │
│   Droplet #1    │      │   Droplet #2    │      │   Droplet #3    │
│                 │      │                 │      │                 │
│  Production     │      │  Dev/Test for   │      │  Client-facing  │
│  Tradeline      │      │  BOTH Engine    │      │  Portal         │
│  Admin Panels   │      │  AND Portal     │      │                 │
│                 │      │                 │      │                 │
│  /admin/security│      │  /admin/dev     │      │  /admin/portal  │
│  /admin/lowvolt │      │                 │      │                 │
│  /admin/business│      │  Test new       │      │                 │
│  etc...         │      │  features here  │      │                 │
│                 │      │  before pushing │      │                 │
│                 │      │  to Engine or   │      │                 │
│                 │      │  Portal         │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

## Droplets Overview

### 1. ENGINE Droplet (Production)
- **Purpose:** Production tradeline admin panels
- **Contains:** All tradeline discovery engines, admin UIs, workers
- **Access:** `/admin/{tradeline}` (e.g., `/admin/security`, `/admin/lowvoltage`)

### 2. DEVELOPMENT Droplet
- **Purpose:** Development and testing environment
- **Contains:** Test versions of BOTH Engine and Portal code
- **Access:** `/admin/dev`
- **Workflow:**
  - Develop new features here
  - Test thoroughly
  - Push updates to Engine OR Portal via patcher

### 3. PORTAL Droplet (Production)
- **Purpose:** Client-facing portal
- **Contains:** Customer portal UI and backend
- **Access:** `/admin/portal`

## Authentication Flow

1. User navigates to patcher login (`:3001`)
2. User authenticates with email/password (validated against `nextbid_users` table)
3. Session created, user redirected to Gateway
4. Gateway shows available droplets/tradelines based on user role
5. User clicks to access backend - request proxied through patcher with auth headers

## Environment Variables

```env
# Server
PORT=3001
SESSION_SECRET=your-secure-session-secret

# Supabase (for user authentication)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Droplet IPs (configure these for each droplet)
ENGINE_DROPLET_HOST=<engine-droplet-ip>
DEV_DROPLET_HOST=<dev-droplet-ip>
PORTAL_DROPLET_HOST=<portal-droplet-ip>
```

## Development Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   LOCAL     │     │     DEV     │     │ PRODUCTION  │
│   (Windows) │────>│   DROPLET   │────>│  ENGINE or  │
│             │push │             │push │   PORTAL    │
│  Code here  │     │  Test here  │     │  Live here  │
└─────────────┘     └─────────────┘     └─────────────┘
```

1. **Develop locally** on Windows dev machine
2. **Push to Dev Droplet** for testing in real environment
3. **Test thoroughly** - both Engine features and Portal features can be tested on Dev
4. **Push to Production** - either Engine droplet or Portal droplet via patcher

## Tradelines (Engine Droplet)

| Slug | Name | Admin Port | Status |
|------|------|------------|--------|
| security | Fire/Life Safety & Security | 3002 | Live |
| lowvoltage | Low Voltage Technology | 3007 | Live |
| business | Administrative & Business | 3003 | Planned |
| facilities | Facility Maintenance | 3004 | Planned |
| electrical | Electrical Construction | 3005 | Planned |
| logistics | Courier/Delivery/Logistics | 3006 | Planned |
| landscaping | Landscaping & Grounds | 3008 | Planned |
| hvac | HVAC / Mechanical | 3009 | Planned |
| plumbing | Plumbing Services | 3010 | Planned |
| custodial | Custodial & Janitorial | 3011 | Planned |
| it | IT & Technical Services | 3012 | Planned |
| environmental | Environmental & Waste | 3013 | Planned |
| painting | Painting & Surface Coatings | 3014 | Planned |

## Running Locally

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
node server.js
```

## Security

- All backend access requires authentication through Patcher
- Sessions stored server-side with secure cookies
- API keys for inter-service communication
- User roles control access to different tradelines/droplets
