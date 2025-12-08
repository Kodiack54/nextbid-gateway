# NextBid Gateway - Authentication Gateway

Central authentication gateway for all NextBid infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     GATEWAY (Authentication Hub)                         │
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

| Droplet | IP Address | Purpose | PM2 Apps |
|---------|------------|---------|----------|
| **Engine** | `64.23.151.201` | Production tradelines + Gateway | lowvoltage, nextbid-gateway |
| **Dev** | `161.35.229.220` | Development & NextBid Sources | nextbid-sources |
| **Portal** | TBD | Client-facing portal | TBD |

### 1. ENGINE Droplet (Production)
- **IP:** `64.23.151.201`
- **SSH:** `ssh root@64.23.151.201`
- **Purpose:** Production tradeline admin panels + Gateway
- **Path:** `/var/www/nextbid-gateway`
- **Contains:** All tradeline discovery engines, admin UIs, workers
- **Access:** `/admin/{tradeline}` (e.g., `/admin/security`, `/admin/lowvoltage`)
- **Gateway URL:** `http://64.23.151.201:3001/gateway`

### 2. DEVELOPMENT Droplet
- **IP:** `161.35.229.220`
- **SSH:** `ssh root@161.35.229.220`
- **Purpose:** Development and testing environment
- **Path:** `/var/www/nextbid-sources`
- **Contains:** NextBid Sources (source discovery pipeline)
- **Access:** `http://161.35.229.220:3098/`

### 3. PORTAL Droplet (Production)
- **IP:** TBD (not yet deployed)
- **Purpose:** Client-facing portal
- **Contains:** Customer portal UI and backend
- **Access:** `/admin/portal`

---

## SSH Access from PowerShell

```powershell
# Connect to Engine droplet (has Gateway + tradelines)
ssh root@64.23.151.201

# Connect to Dev droplet (has NextBid Sources)
ssh root@161.35.229.220
```

---

## Deployment Commands

### Deploy Gateway (Engine Droplet)
```bash
# SSH into engine droplet
ssh root@64.23.151.201

# Pull and restart
cd /var/www/nextbid-gateway && git pull && pm2 restart nextbid-gateway

# Check logs
pm2 logs nextbid-gateway
```

### Deploy NextBid Sources (Dev Droplet)
```bash
# SSH into dev droplet
ssh root@161.35.229.220

# Pull and restart
cd /var/www/nextbid-sources && git pull && pm2 restart nextbid-sources

# Check logs
pm2 logs nextbid-sources
```

### PM2 Useful Commands
```bash
pm2 list                    # Show all processes
pm2 logs <app-name>         # View logs
pm2 restart <app-name>      # Restart app
pm2 stop <app-name>         # Stop app
pm2 start <app-name>        # Start app
pm2 monit                   # Real-time monitoring
```

---

## Authentication Flow

1. User navigates to gateway login (`:3001`)
2. User authenticates with email/password (validated against `nextbid_users` table)
3. Session created, user redirected to Gateway
4. Gateway shows available droplets/tradelines based on user role
5. User clicks to access backend - request proxied through gateway with auth headers

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
4. **Push to Production** - either Engine droplet or Portal droplet via gateway

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

- All backend access requires authentication through Gateway
- Sessions stored server-side with secure cookies
- API keys for inter-service communication
- User roles control access to different tradelines/droplets
