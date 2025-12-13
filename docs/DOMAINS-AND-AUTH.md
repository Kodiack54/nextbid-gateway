# NextBid - Domains & Authentication Architecture

> **Future-proofed design for multi-product platform**
> Last Updated: December 13, 2025

---

## Per-Droplet Authentication (Port 7000)

**Every droplet runs its own auth service on port 7000.** This is the key to the system.

### Why Per-Droplet Auth?

Cookies are domain-specific. A token set on `134.199.209.140` (Patcher) cannot be read by `64.23.151.201` (Engine). Each droplet needs its own token for its domain.

### The 4 Auth Services

| Droplet | IP | Auth URL | Protects |
|---------|-----|----------|----------|
| **Patcher** | 134.199.209.140 | :7000 | Gateway, Dashboard (7500), Patchers (7100-7106) |
| **Engine** | 64.23.151.201 | :7000 | Tradelines (31001-31020) |
| **Dev** | 161.35.229.220 | :7000 | Dev/Test servers (5000-5999) |
| **Portals** | 146.190.169.112 | :7000 | User products (8000-8999) |

### How It Works

1. **User logs in at Gateway** (134.199.209.140:7000)
   - Validates against `nextbid_users` table
   - Issues JWT cookie for Patcher domain
   - Redirects based on role/products

2. **User clicks "Online" button** (e.g., on a tradeline)
   - Dashboard passes gateway token to target droplet's auth
   - URL: `http://64.23.151.201:7000/auto-login?token=xxx&redirect=31006`

3. **Droplet auth verifies & issues local token**
   - Verifies gateway token (same JWT_SECRET across all droplets)
   - Issues new JWT cookie for THIS droplet's domain
   - Redirects to requested port (e.g., 31006)

4. **User lands on target server** - already authenticated

### Auto-Login Endpoint

Each droplet's auth service has `/auto-login`:

```
GET /auto-login?token={gateway_token}&redirect={port}

1. Verify gateway token is valid
2. Issue local JWT cookie for this domain
3. Redirect to http://{droplet-ip}:{port}/
```

**No re-login needed** - just token exchange and redirect.

### Auth Service Code Location

| Droplet | Auth Code |
|---------|-----------|
| Patcher | `gateway-7000/server.js` (main gateway) |
| Engine | `NextBid/auth/server.js` |
| Dev | (same pattern - create when needed) |
| Portals | (same pattern - create when needed) |

---

## Domains

| Domain | Points To | Port | Purpose |
|--------|-----------|------|---------|
| `nextbidportal.com` | 134.199.209.140 | 7000 | User authentication gateway |
| `nextbidengine.com` | 134.199.209.140 | 7500 | Staff/Dev dashboard (direct) |
| `nextbidder.com` | (future) | TBD | Direct to NextBidder if needed |
| `nexttech.com` | (future) | TBD | Direct to NextTech if needed |

---

## Authentication Flows

### Staff Flow (nextbidengine.com)

```
nextbidengine.com
       │
       ▼
   Patcher Droplet (134.199.209.140)
       │
       ▼
   nginx routes to :7500
       │
       ▼
   Dashboard Login (staff_token)
       │
       ▼
   Staff Universal Dashboard
   (Alerts, Tickets, Server Health, Tasks)
```

- Staff go directly to `nextbidengine.com`
- Authenticate against `nextbid_staff_users` table
- Get `staff_token` JWT cookie
- No access to user portals (separate system)

---

### User Flow (nextbidportal.com)

```
nextbidportal.com
       │
       ▼
   Patcher Droplet (134.199.209.140)
       │
       ▼
   nginx routes to :7000 (Gateway)
       │
       ▼
   Gateway Login (access_token + refresh_token)
       │
       ▼
   Check user.products[] and user.role
       │
       ├── products.length === 1
       │   └── Redirect straight to that product
       │
       ├── products.length > 1
       │   └── Show choice popup
       │
       └── role === 'superadmin'
           └── Show full choice popup (all products + dev)
```

---

## User Types & Routing

| User Type | Role | Products | Login Result |
|-----------|------|----------|--------------|
| Field Tech | `tech` | `['nexttech']` | → NextTech dashboard (job schedule) |
| Subcontractor | `bidder` | `['nextbidder']` | → NextBidder dashboard |
| Company Owner | `owner` | `['nextbid']` | → NextBid Portal |
| Multi-product Owner | `owner` | `['nextbid', 'nextbidder']` | → Choice popup |
| Company Admin | `admin` | varies | → Based on products |
| Superadmin | `superadmin` | all | → Full choice popup |
| Staff/Dev | N/A | N/A | → Use nextbidengine.com instead |

---

## Product URLs (Gateway Proxies)

| Product | Gateway Route | Target |
|---------|---------------|--------|
| NextBid Portal | `/portal/*` | 146.190.169.112:4002 |
| NextBidder | `/bidder/*` | 146.190.169.112:4000 |
| NextTech | `/tech/*` | 146.190.169.112:4001 |
| NextSource | `/source/*` | 146.190.169.112:4003 |
| Dashboard (superadmin) | `/dashboard/*` | 134.199.209.140:7500 |

---

## Database Schema for Multi-Product

### nextbid_users (existing)
```sql
id UUID PRIMARY KEY
email VARCHAR(255)
password_hash VARCHAR(255)
name VARCHAR(255)
role VARCHAR(50)        -- 'superadmin', 'owner', 'admin', 'user', 'tech', 'bidder'
domain VARCHAR(50)      -- 'portal', 'engine', 'both'
company_id UUID
```

### nextbid_user_products (new - for multi-product)
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES nextbid_users(id)
product VARCHAR(50)     -- 'nextbid', 'nextbidder', 'nexttech', 'nextsource'
role_in_product VARCHAR(50)  -- product-specific role
granted_at TIMESTAMP
granted_by UUID
is_active BOOLEAN DEFAULT TRUE
```

### Alternative: products[] array on user
```sql
-- Or just add to nextbid_users:
products TEXT[]         -- ['nextbid', 'nextbidder']
```

---

## Gateway Login Logic (Pseudocode)

```javascript
// POST /login
async function login(email, password) {
  const user = await getUser(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return error('Invalid credentials');
  }

  // Get user's products
  const products = await getUserProducts(user.id);
  // OR: const products = user.products;

  // Generate tokens
  const tokens = generateJWT(user, products);
  setCookies(tokens);

  // Determine redirect
  if (user.role === 'superadmin') {
    return redirect('/choose'); // Full choice popup
  }

  if (products.length === 0) {
    return redirect('/onboarding'); // No products yet
  }

  if (products.length === 1) {
    // Single product - go straight there
    return redirect(getProductUrl(products[0]));
  }

  // Multiple products - show choice
  return redirect('/choose');
}

// GET /choose
function renderChoicePage(user, products) {
  const choices = products.map(p => ({
    name: productNames[p],
    url: productUrls[p],
    icon: productIcons[p]
  }));

  // Superadmin also sees dev dashboard option
  if (user.role === 'superadmin') {
    choices.push({
      name: 'NextBid Dev',
      url: '/dashboard',
      icon: 'wrench'
    });
  }

  return render('choose', { choices });
}
```

---

## Nginx Configuration

### /etc/nginx/sites-available/nextbid

```nginx
# User Portal Gateway
server {
    listen 80;
    server_name nextbidportal.com www.nextbidportal.com;

    location / {
        proxy_pass http://localhost:7000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Staff Dashboard (Direct)
server {
    listen 80;
    server_name nextbidengine.com www.nextbidengine.com;

    location / {
        proxy_pass http://localhost:7500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

After setup, run:
```bash
sudo ln -s /etc/nginx/sites-available/nextbid /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Add SSL
sudo certbot --nginx -d nextbidportal.com -d www.nextbidportal.com
sudo certbot --nginx -d nextbidengine.com -d www.nextbidengine.com
```

---

## DNS Setup (Wix)

### nextbidportal.com
| Type | Host | Value |
|------|------|-------|
| A | @ | 134.199.209.140 |
| A | www | 134.199.209.140 |

### nextbidengine.com
| Type | Host | Value |
|------|------|-------|
| A | @ | 134.199.209.140 |
| A | www | 134.199.209.140 |

---

## Token Strategy

| Token | Used By | Stored In | Expires |
|-------|---------|-----------|---------|
| `access_token` | Users (Gateway) | httpOnly cookie | 1 hour |
| `refresh_token` | Users (Gateway) | httpOnly cookie | 7 days |
| `staff_token` | Staff (Dashboard) | httpOnly cookie | 7 days |

- Users and Staff have **separate token systems**
- Staff cannot access user portals with their token
- Users cannot access staff dashboard with their token
- Superadmin gets **user tokens** (can access portals + dev dashboard via Gateway)

---

## Future Expansion

When adding new products:

1. Add product to `productUrls` mapping in Gateway
2. Add proxy route in Gateway server.js
3. Add to choice page UI
4. Create portal on Portal droplet (146.190.169.112)
5. Users subscribe via `nextbid_user_products` table

No DNS or nginx changes needed - all products go through Gateway.

---

*This architecture supports unlimited products without infrastructure changes.*
