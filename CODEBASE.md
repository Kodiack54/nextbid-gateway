# NextBid Patcher - Codebase Reference

---

## Database Tables

### User Authentication

| Table | Description |
|-------|-------------|
| `nextbid_users` | User accounts for login (email, password_hash, role, is_active, last_login) |

---

## Folder Structure

```
nextbid-patcher/
├── public/                         # Static assets
│   ├── css/
│   │   └── patcher.css             # Main stylesheet (371 lines)
│   └── images/                     # Image assets
│
├── scripts/                        # Utility scripts
│   └── create-admin-user.js        # Create admin user in database
│
├── views/                          # EJS templates
│   ├── gateway.ejs                 # Gateway page - tradeline selection (526 lines)
│   └── login.ejs                   # Login page (152 lines)
│
├── .env                            # Environment variables (not committed)
├── .env.example                    # Environment template
├── .gitignore                      # Git ignore rules
├── CODEBASE.md                     # This file
├── Jurnal-log.md                   # Development journal
├── package.json                    # NPM dependencies
├── package-lock.json               # NPM lock file
├── README.md                       # Project documentation
└── server.js                       # Main Express server (561 lines)
```

---

## Key Files

### Entry Points

| File | Port | Description |
|------|------|-------------|
| `server.js` | 3001 | Login gateway server |

### Core Functionality

| File | Description |
|------|-------------|
| `server.js` | Express server with session auth, proxy middleware, tradeline routing |
| `views/login.ejs` | Login page with system status display |
| `views/gateway.ejs` | Tradeline selection dashboard after login |

---

## Tradeline Configuration

The server proxies requests to various tradeline admin panels:

### Engine Droplet (64.23.151.201)

| Slug | Name | Admin Port | Status |
|------|------|------------|--------|
| security | Fire/Life Safety & Security | 3002 | Offline |
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

### Dev Droplet (161.35.229.220)

| Slug | Name | Admin Port | Status |
|------|------|------------|--------|
| dev | NextBid Dev | 3099 | Live |
| sources | NextBid Sources | 3098 | Live |
| portal | NextBid Portal | 3100 | Planned |
| tech | NextBid Tech | 3101 | Planned |
| app | NextBid App | 3102 | Planned |

### Portal Droplet (TBD)

| Slug | Name | Admin Port | Status |
|------|------|------------|--------|
| keystone | Keystone Portal | 4000 | Planned |
| bidder-portal | Bidder Portal | 4001 | Planned |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Login page |
| `/gateway` | GET | Tradeline selection (requires auth) |
| `/login` | POST | Authenticate user |
| `/logout` | GET | Destroy session |
| `/api/verify-session` | GET | Check if session is valid |
| `/api/status` | GET | System status |
| `/admin/{slug}/*` | * | Proxy to tradeline admin panel |

---

## Environment Variables

```env
PORT=3001
SESSION_SECRET=your-secure-session-secret
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
ENGINE_DROPLET_HOST=64.23.151.201
DEV_DROPLET_HOST=161.35.229.220
PORTAL_DROPLET_HOST=<not-yet-deployed>
SERVER_HOST=localhost
```

---

## NPM Scripts

```bash
npm start          # Start server
npm run dev        # Start with nodemon (auto-reload)
```

---

*Last updated: Dec 8, 2025*
