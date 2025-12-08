/**
 * NextBid Patcher - Login Gateway
 *
 * Port 3001 - Authentication gateway for all NextBid Engine services
 *
 * Features:
 * - Login screen with system status display
 * - Session management for authenticated users
 * - Redirects to Master KPI Dashboard (port 3000) on successful login
 * - Patch/update status display (future)
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
// Note: secure: false until HTTPS/SSL is configured
app.use(session({
  secret: process.env.SESSION_SECRET || 'nextbid-patcher-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true when HTTPS is configured
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Version info
const VERSION = '1.0.0';
const BUILD_DATE = new Date().toISOString().split('T')[0];

// Server host configuration
const SERVER_HOST = process.env.SERVER_HOST || 'localhost';

// Droplet IPs
const DROPLETS = {
  engine: process.env.ENGINE_DROPLET_HOST || '64.23.151.201',
  dev: process.env.DEV_DROPLET_HOST || '161.35.229.220',
  portal: process.env.PORTAL_DROPLET_HOST || null  // Not yet deployed
};

// Project configurations organized by category (each category = different droplet)
const TRADELINES = [
  // ========================================
  // TRADELINE SERVERS (Engine Droplet - 64.23.151.201)
  // ========================================
  {
    slug: 'security',
    name: 'Fire/Life Safety & Security',
    type: 'Security Tradeline',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3002,
    enginePort: 10002,
    description: 'Fire alarm, life safety, security guard services, patrol contracts',
    live: false,
    status: 'offline'
  },
  {
    slug: 'business',
    name: 'Administrative & Business Services',
    type: 'Business',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3003,
    enginePort: 10003,
    description: 'Administrative support, staffing, professional business services',
    live: false,
    status: 'offline'
  },
  {
    slug: 'facilities',
    name: 'Facility Maintenance & Punch-Out',
    type: 'Facilities',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3004,
    enginePort: 10004,
    description: 'General facility maintenance, repairs, punch-out services',
    live: false,
    status: 'offline'
  },
  {
    slug: 'electrical',
    name: 'Electrical Construction',
    type: 'Construction',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3005,
    enginePort: 10005,
    description: 'Electrical construction, wiring, power systems installation',
    live: false,
    status: 'offline'
  },
  {
    slug: 'logistics',
    name: 'Courier / Delivery / Logistics',
    type: 'Logistics',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3006,
    enginePort: 10006,
    description: 'Courier services, package delivery, logistics and transportation',
    live: false,
    status: 'offline'
  },
  {
    slug: 'lowvoltage',
    name: 'Low Voltage Technology',
    type: 'Technology',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3007,
    enginePort: 10007,
    description: 'Low voltage systems, CCTV, access control, structured cabling',
    live: true,
    status: 'online'
  },
  {
    slug: 'landscaping',
    name: 'Landscaping & Grounds Maintenance',
    type: 'Grounds',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3008,
    enginePort: 10008,
    description: 'Landscaping, grounds maintenance, irrigation, tree services',
    live: false,
    status: 'offline'
  },
  {
    slug: 'hvac',
    name: 'HVAC / Mechanical',
    type: 'Mechanical',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3009,
    enginePort: 10009,
    description: 'HVAC installation, mechanical systems, climate control',
    live: false,
    status: 'offline'
  },
  {
    slug: 'plumbing',
    name: 'Plumbing Services',
    type: 'Plumbing',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3010,
    enginePort: 10010,
    description: 'Plumbing installation, repairs, water systems maintenance',
    live: false,
    status: 'offline'
  },
  {
    slug: 'custodial',
    name: 'Custodial & Janitorial Services',
    type: 'Custodial',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3011,
    enginePort: 10011,
    description: 'Janitorial services, cleaning, sanitation, custodial contracts',
    live: false,
    status: 'offline'
  },
  {
    slug: 'it',
    name: 'IT & Technical Services',
    type: 'IT',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3012,
    enginePort: 10012,
    description: 'IT support, technical services, network infrastructure',
    live: false,
    status: 'offline'
  },
  {
    slug: 'environmental',
    name: 'Environmental & Waste Services',
    type: 'Environmental',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3013,
    enginePort: 10013,
    description: 'Waste management, recycling, environmental remediation',
    live: false,
    status: 'offline'
  },
  {
    slug: 'painting',
    name: 'Painting & Surface Coatings',
    type: 'Painting',
    category: 'tradeline',
    host: DROPLETS.engine,
    adminPort: 3014,
    enginePort: 10014,
    description: 'Painting services, surface coatings, finishing work',
    live: false,
    status: 'offline'
  },

  // ========================================
  // DEV PROJECTS (Dev Droplet - 161.35.229.220)
  // ========================================
  {
    slug: 'dev',
    name: 'NextBid Dev',
    type: 'Development',
    category: 'dev',
    host: DROPLETS.dev,
    adminPort: 3099,
    enginePort: 10099,
    description: 'Development and testing environment for new features',
    live: false,
    status: 'offline'
  },
  {
    slug: 'sources',
    name: 'NextBid Sources',
    type: 'Source Discovery',
    category: 'dev',
    host: DROPLETS.dev,
    adminPort: 3098,
    enginePort: null,
    description: 'Source discovery pipeline - find and onboard new procurement portals',
    live: true,
    status: 'online'
  },
  {
    slug: 'portal',
    name: 'NextBid Portal',
    type: 'Client Portal',
    category: 'dev',
    host: DROPLETS.dev,
    adminPort: 3100,
    enginePort: null,
    description: 'Client-facing portal for opportunity management',
    live: false,
    status: 'offline'
  },
  {
    slug: 'tech',
    name: 'NextBid Tech',
    type: 'Technology',
    category: 'dev',
    host: DROPLETS.dev,
    adminPort: 3101,
    enginePort: null,
    description: 'Technology stack and infrastructure management',
    live: false,
    status: 'offline'
  },
  {
    slug: 'app',
    name: 'NextBid App',
    type: 'Mobile/Web App',
    category: 'dev',
    host: DROPLETS.dev,
    adminPort: 3102,
    enginePort: null,
    description: 'NextBid mobile and web application',
    live: false,
    status: 'offline'
  },

  // ========================================
  // NEXTBID PORTALS (Portal Droplet - TBD)
  // ========================================
  {
    slug: 'keystone',
    name: 'Keystone Portal',
    type: 'Client Portal',
    category: 'portal',
    host: DROPLETS.portal,
    adminPort: 4000,
    enginePort: null,
    description: 'Client-facing CRM for Keystone Advantage',
    live: false,
    status: 'offline'
  },
  {
    slug: 'bidder-portal',
    name: 'Bidder Portal',
    type: 'Client Portal',
    category: 'portal',
    host: DROPLETS.portal,
    adminPort: 4001,
    enginePort: null,
    description: 'Public-facing bidder portal for opportunity search',
    live: false,
    status: 'offline'
  }
];

/**
 * Check system status for all tradeline servers
 */
async function getSystemStatus() {
  const tradelines = [
    { name: 'Security', port: 3054, enginePort: 10054 },
    { name: 'LowVoltage', port: 3007, enginePort: 10007 },
    // Add more tradelines as they come online
  ];

  const status = {
    patcher: { status: 'online', version: VERSION },
    database: { status: 'checking' },
    tradelines: []
  };

  // Check database
  try {
    const { error } = await supabase.from('security_discovered_opportunities').select('id').limit(1);
    status.database.status = error ? 'error' : 'online';
  } catch (e) {
    status.database.status = 'offline';
  }

  // For now, just return configured tradelines
  // In future, actually ping each server
  status.tradelines = tradelines.map(t => ({
    name: t.name,
    adminPort: t.port,
    enginePort: t.enginePort,
    status: 'unknown' // Would ping in production
  }));

  return status;
}

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/?error=Please login to continue');
}

// Auth middleware for proxy (returns 401 instead of redirect)
function requireAuthForProxy(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).send('Unauthorized - Please login at /');
}

//=============================================================================
// PROXY ROUTES - Access tradeline admin panels through gateway
// Routes: /admin/{slug}/* -> localhost:{port}/*
//=============================================================================

// Set up proxy for each tradeline
TRADELINES.forEach(tradeline => {
  const proxyPath = `/admin/${tradeline.slug}`;

  // Determine target host - use host field if configured, otherwise localhost
  const targetHost = tradeline.host || 'localhost';
  const targetUrl = `http://${targetHost}:${tradeline.adminPort}`;

  app.use(proxyPath, requireAuthForProxy, createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    pathRewrite: {
      [`^${proxyPath}`]: '' // Remove /admin/slug prefix when forwarding
    },
    onProxyReq: (proxyReq, req, res) => {
      // Add user info header so tradeline knows who's accessing
      if (req.session && req.session.user) {
        proxyReq.setHeader('X-NextBid-User', req.session.user.email);
        proxyReq.setHeader('X-NextBid-Role', req.session.user.role);
      }
    },
    onError: (err, req, res) => {
      console.error(`Proxy error for ${tradeline.slug}:`, err.message);
      res.status(502).send(`
        <h1>Tradeline Offline</h1>
        <p>The ${tradeline.name} server is not responding.</p>
        <p>Target: ${targetUrl}</p>
        <a href="/gateway">Back to Gateway</a>
      `);
    }
  }));

  console.log(`  Proxy configured: /admin/${tradeline.slug} -> ${targetUrl}`);
});

//=============================================================================
// ROUTES
//=============================================================================

// Login page (main entry point)
app.get('/', async (req, res) => {
  // If already logged in, redirect to gateway
  if (req.session && req.session.user) {
    return res.redirect('/gateway');
  }

  const systemStatus = await getSystemStatus();

  res.render('login', {
    version: VERSION,
    buildDate: BUILD_DATE,
    systemStatus,
    error: req.query.error || null
  });
});

// Gateway page (after login)
app.get('/gateway', requireAuth, async (req, res) => {
  // Build tradeline list with direct URLs for now
  // TODO: Switch to proxy URLs when tradeline admins support BASE_URL prefix
  const host = process.env.NODE_ENV === 'production' ? PRODUCTION_HOST : SERVER_HOST;
  const tradelines = TRADELINES.map(t => ({
    ...t,
    url: t.live ? `http://${host}:${t.adminPort}/` : `/admin/${t.slug}/`
  }));

  res.render('gateway', {
    version: VERSION,
    buildDate: BUILD_DATE,
    user: req.session.user,
    tradelines
  });
});

// Login POST
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt for:', email);

  if (!email || !password) {
    return res.redirect('/?error=Email and password required');
  }

  try {
    // Get user from database
    const { data: user, error } = await supabase
      .from('nextbid_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    console.log('DB lookup result:', error ? error.message : 'User found');

    if (error || !user) {
      return res.redirect('/?error=Invalid credentials');
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    console.log('Password valid:', validPassword);
    if (!validPassword) {
      return res.redirect('/?error=Invalid credentials');
    }

    // Check if user is active
    if (!user.is_active) {
      return res.redirect('/?error=Account disabled');
    }

    // Set session
    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };
    console.log('Session set for user:', user.email);

    // Update last login
    await supabase
      .from('nextbid_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Redirect to gateway
    res.redirect('/gateway');

  } catch (err) {
    console.error('Login error:', err);
    res.redirect('/?error=Login failed');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/');
  });
});

// API: Verify session (for other services to check)
app.get('/api/verify-session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({
      valid: true,
      user: {
        id: req.session.user.id,
        email: req.session.user.email,
        name: req.session.user.name,
        role: req.session.user.role
      }
    });
  } else {
    res.json({ valid: false });
  }
});

// API: System status
app.get('/api/status', async (req, res) => {
  const status = await getSystemStatus();
  res.json(status);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ███╗   ██╗███████╗██╗  ██╗████████╗██████╗ ██╗██████╗   ║
║   ████╗  ██║██╔════╝╚██╗██╔╝╚══██╔══╝██╔══██╗██║██╔══██╗  ║
║   ██╔██╗ ██║█████╗   ╚███╔╝    ██║   ██████╔╝██║██║  ██║  ║
║   ██║╚██╗██║██╔══╝   ██╔██╗    ██║   ██╔══██╗██║██║  ██║  ║
║   ██║ ╚████║███████╗██╔╝ ██╗   ██║   ██████╔╝██║██████╔╝  ║
║   ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝╚═════╝   ║
║                                                           ║
║   PATCHER v${VERSION}                                         ║
║   Login Gateway & Update System                           ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║   Server running on port ${PORT}                             ║
║   http://localhost:${PORT}                                   ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
