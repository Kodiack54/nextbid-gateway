/**
 * 7000 - Authentication Gateway
 *
 * Central authentication layer for NextBid.
 * All user requests flow through here before accessing services.
 *
 * Two domains:
 * - nextbidportal.com: User portal (contractors)
 * - nextbidengine.com: Admin/Dev portal
 *
 * Features:
 * - Session-based authentication
 * - Reverse proxy to internal services
 * - Company profile & credential management
 * - Tradeline subscription management
 *
 * Port: 7000
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.GATEWAY_PORT || 7000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'nextbid-gateway-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// MIDDLEWARE
// ============================================================

/**
 * Check if user is authenticated
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  // API requests get 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Browser requests redirect to login
  res.redirect('/login');
}

/**
 * Check if user is an admin (engine access)
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.domain === 'engine') {
    return next();
  }

  res.status(403).json({ error: 'Forbidden - Admin access required' });
}

// ============================================================
// PUBLIC ROUTES
// ============================================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'auth-gateway',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

/**
 * Login page
 */
app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

/**
 * Process login
 */
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user in database
    const { data: user, error } = await supabase
      .from('nextbid_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    // Update last login
    await supabase
      .from('nextbid_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Create session
    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      company_id: user.company_id,
      domain: user.domain,
      role: user.role
    };

    // Log the login
    await supabase.from('nextbid_audit_log').insert({
      user_id: user.id,
      action: 'login',
      ip_address: req.ip,
      details: { user_agent: req.headers['user-agent'] }
    });

    console.log(`[Auth] User logged in: ${user.email} (${user.domain})`);

    // Redirect based on domain
    if (user.domain === 'engine') {
      res.redirect('/dashboard');
    } else {
      res.redirect('/opportunities');
    }

  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.render('login', { error: 'An error occurred. Please try again.' });
  }
});

/**
 * Logout
 */
app.get('/logout', (req, res) => {
  if (req.session) {
    const user = req.session.user;
    req.session.destroy();
    if (user) {
      console.log(`[Auth] User logged out: ${user.email}`);
    }
  }
  res.redirect('/login');
});

/**
 * Registration page
 */
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

/**
 * Process registration
 */
app.post('/register', async (req, res) => {
  const { email, password, name, company_name, tradelines } = req.body;

  try {
    // Check if email exists
    const { data: existing } = await supabase
      .from('nextbid_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.render('register', { error: 'Email already registered' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create company first
    const { data: company, error: companyError } = await supabase
      .from('nextbid_companies')
      .insert({
        name: company_name,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (companyError) {
      console.error('[Auth] Company creation error:', companyError);
      return res.render('register', { error: 'Failed to create company' });
    }

    // Create user
    const { data: user, error: userError } = await supabase
      .from('nextbid_users')
      .insert({
        email: email.toLowerCase(),
        password_hash,
        name,
        company_id: company.id,
        domain: 'portal',
        role: 'owner',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (userError) {
      console.error('[Auth] User creation error:', userError);
      return res.render('register', { error: 'Failed to create account' });
    }

    // Add tradeline subscriptions
    const tradelineList = Array.isArray(tradelines) ? tradelines : [tradelines];
    for (const tradeline of tradelineList.filter(Boolean)) {
      await supabase.from('nextbid_company_tradelines').insert({
        company_id: company.id,
        tradeline,
        created_at: new Date().toISOString()
      });
    }

    console.log(`[Auth] New registration: ${email} (company: ${company_name})`);

    // Auto-login
    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      company_id: company.id,
      domain: 'portal',
      role: 'owner'
    };

    res.redirect('/profile');

  } catch (error) {
    console.error('[Auth] Registration error:', error.message);
    res.render('register', { error: 'An error occurred. Please try again.' });
  }
});

// ============================================================
// AUTHENTICATED ROUTES
// ============================================================

/**
 * Home - redirect based on domain and onboarding status
 */
app.get('/', requireAuth, async (req, res) => {
  // Check onboarding status for portal users
  if (req.session.user.domain === 'portal') {
    const { data: user } = await supabase
      .from('nextbid_users')
      .select('onboarding_completed')
      .eq('id', req.session.user.id)
      .single();

    if (!user?.onboarding_completed) {
      return res.redirect('/onboarding');
    }
    return res.redirect('/opportunities');
  }

  res.redirect('/dashboard');
});

/**
 * Onboarding - video game style tutorial
 */
app.get('/onboarding', requireAuth, async (req, res) => {
  try {
    // Get user and company info
    const { data: user } = await supabase
      .from('nextbid_users')
      .select('onboarding_step')
      .eq('id', req.session.user.id)
      .single();

    const { data: company } = await supabase
      .from('nextbid_companies')
      .select('*, nextbid_company_tradelines(*)')
      .eq('id', req.session.user.company_id)
      .single();

    res.render('onboarding', {
      user: req.session.user,
      company,
      currentStep: user?.onboarding_step || 1
    });
  } catch (error) {
    console.error('[Onboarding] Error:', error.message);
    res.redirect('/opportunities');
  }
});

/**
 * Save onboarding progress
 */
app.post('/onboarding/progress', requireAuth, async (req, res) => {
  const { step } = req.body;

  try {
    await supabase
      .from('nextbid_users')
      .update({ onboarding_step: step })
      .eq('id', req.session.user.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Complete onboarding
 */
app.post('/onboarding/complete', requireAuth, async (req, res) => {
  try {
    await supabase
      .from('nextbid_users')
      .update({
        onboarding_completed: true,
        onboarding_step: 6
      })
      .eq('id', req.session.user.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * User profile
 */
app.get('/profile', requireAuth, async (req, res) => {
  try {
    // Get company info
    const { data: company } = await supabase
      .from('nextbid_companies')
      .select('*, nextbid_company_tradelines(*)')
      .eq('id', req.session.user.company_id)
      .single();

    // Get company credentials (without showing actual values)
    const { data: credentials } = await supabase
      .from('nextbid_company_credentials')
      .select('source, is_configured, status, last_used')
      .eq('company_id', req.session.user.company_id);

    res.render('profile', {
      user: req.session.user,
      company,
      credentials: credentials || []
    });

  } catch (error) {
    console.error('[Profile] Error:', error.message);
    res.status(500).send('Error loading profile');
  }
});

/**
 * Update company credentials
 */
app.post('/profile/credentials', requireAuth, async (req, res) => {
  const { source, username, password, api_key } = req.body;

  try {
    // Encrypt or hash sensitive data before storing
    const credentialData = {
      company_id: req.session.user.company_id,
      source,
      is_configured: true,
      updated_at: new Date().toISOString()
    };

    // Store based on credential type
    if (api_key) {
      credentialData.api_key_encrypted = api_key; // TODO: Actually encrypt this
    }
    if (username && password) {
      credentialData.username = username;
      credentialData.password_encrypted = password; // TODO: Actually encrypt this
    }

    // Upsert credential
    const { error } = await supabase
      .from('nextbid_company_credentials')
      .upsert(credentialData, { onConflict: 'company_id,source' });

    if (error) {
      console.error('[Credentials] Update error:', error);
      return res.status(500).json({ error: 'Failed to update credentials' });
    }

    console.log(`[Credentials] Updated ${source} for company ${req.session.user.company_id}`);

    res.json({ success: true });

  } catch (error) {
    console.error('[Credentials] Error:', error.message);
    res.status(500).json({ error: 'Failed to update credentials' });
  }
});

// ============================================================
// API ROUTES - For internal services to get credentials
// ============================================================

/**
 * Get company credentials for a source
 * Called by tradeline servers to get credentials for scraping
 */
app.get('/api/credentials/:companyId/:source', async (req, res) => {
  const { companyId, source } = req.params;
  const apiKey = req.headers['x-api-key'];

  // Validate API key (internal services use a shared key)
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  try {
    const { data: credential } = await supabase
      .from('nextbid_company_credentials')
      .select('*')
      .eq('company_id', companyId)
      .eq('source', source)
      .single();

    if (!credential) {
      return res.status(404).json({ error: 'Credentials not found' });
    }

    // Return decrypted credentials
    res.json({
      success: true,
      source,
      username: credential.username,
      password: credential.password_encrypted, // TODO: Decrypt
      api_key: credential.api_key_encrypted // TODO: Decrypt
    });

  } catch (error) {
    console.error('[API] Credentials error:', error.message);
    res.status(500).json({ error: 'Failed to get credentials' });
  }
});

/**
 * Get all companies subscribed to a tradeline
 * Called by tradeline servers to know who to scrape for
 */
app.get('/api/tradeline/:tradeline/companies', async (req, res) => {
  const { tradeline } = req.params;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  try {
    const { data: subscriptions } = await supabase
      .from('nextbid_company_tradelines')
      .select('company_id, nextbid_companies(id, name)')
      .eq('tradeline', tradeline)
      .eq('is_active', true);

    const companies = (subscriptions || []).map(s => ({
      id: s.company_id,
      name: s.nextbid_companies?.name
    }));

    res.json({
      success: true,
      tradeline,
      companies
    });

  } catch (error) {
    console.error('[API] Tradeline companies error:', error.message);
    res.status(500).json({ error: 'Failed to get companies' });
  }
});

// ============================================================
// REVERSE PROXY - Route authenticated requests to internal services
// ============================================================

// Dashboard (7500)
app.use('/dashboard', requireAuth, createProxyMiddleware({
  target: 'http://localhost:7500',
  pathRewrite: { '^/dashboard': '' },
  changeOrigin: true
}));

// Patcher API (7101)
app.use('/patcher', requireAdmin, createProxyMiddleware({
  target: 'http://localhost:7101',
  changeOrigin: true
}));

// Dev sync (7101)
app.use('/dev-sync', requireAdmin, createProxyMiddleware({
  target: 'http://localhost:7101',
  pathRewrite: { '^/dev-sync': '/dev' },
  changeOrigin: true
}));

// Tradeline admin pages (3002-3021) - dynamic routing
app.use('/tradelines/:name', requireAuth, (req, res, next) => {
  const tradelinePorts = {
    security: 3002,
    administrative: 3003,
    facilities: 3004,
    electrical: 3005,
    logistics: 3006,
    lowvoltage: 3007,
    landscaping: 3008,
    hvac: 3009,
    plumbing: 3010,
    janitorial: 3011,
    support: 3012,
    waste: 3013,
    construction: 3014,
    roofing: 3015,
    painting: 3016,
    flooring: 3017,
    demolition: 3018,
    environmental: 3019,
    concrete: 3020,
    fencing: 3021
  };

  const port = tradelinePorts[req.params.name];
  if (!port) {
    return res.status(404).json({ error: 'Unknown tradeline' });
  }

  createProxyMiddleware({
    target: `http://localhost:${port}`,
    pathRewrite: { [`^/tradelines/${req.params.name}`]: '' },
    changeOrigin: true
  })(req, res, next);
});

// ============================================================
// PORTAL USER ROUTES (nextbidportal.com)
// ============================================================

/**
 * Browse opportunities
 */
app.get('/opportunities', requireAuth, async (req, res) => {
  // TODO: Fetch opportunities for user's tradelines
  res.render('opportunities', { user: req.session.user });
});

/**
 * My bids
 */
app.get('/bids', requireAuth, async (req, res) => {
  res.render('bids', { user: req.session.user });
});

// ============================================================
// ERROR HANDLING
// ============================================================

app.use((err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   NextBid Authentication Gateway                               ║
║                                                                ║
║   Port: ${PORT}                                                   ║
║                                                                ║
║   Domains:                                                     ║
║   - nextbidportal.com → User Portal                            ║
║   - nextbidengine.com → Admin/Dev Portal                       ║
║                                                                ║
║   Routes:                                                      ║
║   GET  /login            - Login page                          ║
║   POST /login            - Process login                       ║
║   GET  /logout           - Logout                              ║
║   GET  /register         - Registration page                   ║
║   POST /register         - Process registration                ║
║   GET  /profile          - User profile                        ║
║   POST /profile/creds    - Update company credentials          ║
║                                                                ║
║   Proxied Routes (authenticated):                              ║
║   /dashboard/*           → 7500 Dashboard                      ║
║   /patcher/*             → 7101 Patcher (admin only)           ║
║   /dev-sync/*            → 7101 Dev Sync (admin only)          ║
║   /tradelines/:name/*    → 3002-3021 Tradeline admins          ║
║                                                                ║
║   API Routes (internal services):                              ║
║   GET /api/credentials/:company/:source                        ║
║   GET /api/tradeline/:name/companies                           ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
