/**
 * 7000 - Authentication Gateway
 *
 * Central authentication layer for NextBid.
 * All user requests flow through here before accessing services.
 *
 * Features:
 * - JWT-based authentication with refresh tokens
 * - Single Sign-On across all services
 * - Reverse proxy to internal services with user headers
 * - Company profile & credential management
 * - Tradeline subscription management
 *
 * Port: 7000
 */

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.GATEWAY_PORT || 7000;

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'nextbid-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = '1h';           // Access token: 1 hour
const REFRESH_EXPIRES_IN = '7d';       // Refresh token: 7 days
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// JWT HELPERS
// ============================================================

/**
 * Generate access and refresh tokens
 */
function generateTokens(user) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    company_id: user.company_id,
    domain: user.domain,
    role: user.role
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES_IN });

  return { accessToken, refreshToken };
}

/**
 * Verify access token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Set auth cookies
 */
function setAuthCookies(res, accessToken, refreshToken) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  };

  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 }); // 1 hour
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: COOKIE_MAX_AGE }); // 7 days
}

/**
 * Clear auth cookies
 */
function clearAuthCookies(res) {
  res.clearCookie('accessToken', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

/**
 * Check if user is authenticated via JWT
 * Automatically refreshes token if expired but refresh token is valid
 */
async function requireAuth(req, res, next) {
  const accessToken = req.cookies.accessToken;
  const refreshToken = req.cookies.refreshToken;

  // Try access token first
  let user = verifyToken(accessToken);

  // If access token expired, try refresh
  if (!user && refreshToken) {
    const refreshPayload = verifyToken(refreshToken);

    if (refreshPayload && refreshPayload.type === 'refresh') {
      // Get fresh user data from database
      const { data: dbUser } = await supabase
        .from('nextbid_users')
        .select('*')
        .eq('id', refreshPayload.id)
        .eq('is_active', true)
        .single();

      if (dbUser) {
        // Generate new tokens
        const tokens = generateTokens(dbUser);
        setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
        user = verifyToken(tokens.accessToken);
        console.log(`[Auth] Token refreshed for: ${dbUser.email}`);
      }
    }
  }

  if (!user) {
    // API requests get 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // Browser requests redirect to login
    return res.redirect('/login');
  }

  // Attach user to request
  req.user = user;
  next();
}

/**
 * Check if user is an admin (engine access)
 * Superadmins can access everything
 */
function requireAdmin(req, res, next) {
  if (req.user && (req.user.domain === 'engine' || req.user.role === 'superadmin')) {
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
    auth: 'jwt',
    timestamp: new Date().toISOString()
  });
});

/**
 * Login page
 */
app.get('/login', (req, res) => {
  // Check if already logged in
  const user = verifyToken(req.cookies.accessToken);
  if (user) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

/**
 * Process login - issues JWT tokens
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

    // Generate JWT tokens
    const tokens = generateTokens(user);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    // Update last login
    await supabase
      .from('nextbid_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Log the login
    await supabase.from('nextbid_audit_log').insert({
      user_id: user.id,
      action: 'login',
      ip_address: req.ip,
      details: { user_agent: req.headers['user-agent'] }
    });

    console.log(`[Auth] User logged in: ${user.email} (${user.role || user.domain})`);

    // Redirect based on role/domain
    if (user.domain === 'engine' || user.role === 'superadmin') {
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
 * Logout - clears JWT cookies
 */
app.get('/logout', async (req, res) => {
  const user = verifyToken(req.cookies.accessToken);
  if (user) {
    console.log(`[Auth] User logged out: ${user.email}`);
    await supabase.from('nextbid_audit_log').insert({
      user_id: user.id,
      action: 'logout',
      ip_address: req.ip
    });
  }
  clearAuthCookies(res);
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

    // Generate JWT tokens and auto-login
    const tokens = generateTokens(user);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

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
  // Superadmins and engine users go to dashboard
  if (req.user.role === 'superadmin' || req.user.domain === 'engine') {
    return res.redirect('/dashboard');
  }

  // Check onboarding status for portal users
  const { data: user } = await supabase
    .from('nextbid_users')
    .select('onboarding_completed')
    .eq('id', req.user.id)
    .single();

  if (!user?.onboarding_completed) {
    return res.redirect('/onboarding');
  }

  res.redirect('/opportunities');
});

/**
 * Onboarding - video game style tutorial
 */
app.get('/onboarding', requireAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('nextbid_users')
      .select('onboarding_step')
      .eq('id', req.user.id)
      .single();

    const { data: company } = await supabase
      .from('nextbid_companies')
      .select('*, nextbid_company_tradelines(*)')
      .eq('id', req.user.company_id)
      .single();

    res.render('onboarding', {
      user: req.user,
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
      .eq('id', req.user.id);

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
      .eq('id', req.user.id);

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
    const { data: company } = await supabase
      .from('nextbid_companies')
      .select('*, nextbid_company_tradelines(*)')
      .eq('id', req.user.company_id)
      .single();

    const { data: credentials } = await supabase
      .from('nextbid_company_credentials')
      .select('source, is_configured, status, last_used')
      .eq('company_id', req.user.company_id);

    res.render('profile', {
      user: req.user,
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
    const credentialData = {
      company_id: req.user.company_id,
      source,
      is_configured: true,
      updated_at: new Date().toISOString()
    };

    if (api_key) {
      credentialData.api_key_encrypted = api_key; // TODO: Actually encrypt this
    }
    if (username && password) {
      credentialData.username = username;
      credentialData.password_encrypted = password; // TODO: Actually encrypt this
    }

    const { error } = await supabase
      .from('nextbid_company_credentials')
      .upsert(credentialData, { onConflict: 'company_id,source' });

    if (error) {
      console.error('[Credentials] Update error:', error);
      return res.status(500).json({ error: 'Failed to update credentials' });
    }

    console.log(`[Credentials] Updated ${source} for company ${req.user.company_id}`);
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
 */
app.get('/api/credentials/:companyId/:source', async (req, res) => {
  const { companyId, source } = req.params;
  const apiKey = req.headers['x-api-key'];

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

    res.json({
      success: true,
      source,
      username: credential.username,
      password: credential.password_encrypted,
      api_key: credential.api_key_encrypted
    });

  } catch (error) {
    console.error('[API] Credentials error:', error.message);
    res.status(500).json({ error: 'Failed to get credentials' });
  }
});

/**
 * Get all companies subscribed to a tradeline
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

    res.json({ success: true, tradeline, companies });

  } catch (error) {
    console.error('[API] Tradeline companies error:', error.message);
    res.status(500).json({ error: 'Failed to get companies' });
  }
});

// ============================================================
// REVERSE PROXY - Pass user info to backend services
// ============================================================

/**
 * Create proxy with user headers
 * Backend services can trust these headers because only gateway can reach them
 */
function createAuthProxy(target, pathRewrite = null) {
  const options = {
    target,
    changeOrigin: true,
    onProxyReq: (proxyReq, req) => {
      // Pass authenticated user info to backend
      if (req.user) {
        proxyReq.setHeader('X-User-Id', req.user.id);
        proxyReq.setHeader('X-User-Email', req.user.email);
        proxyReq.setHeader('X-User-Name', req.user.name || '');
        proxyReq.setHeader('X-User-Role', req.user.role || 'user');
        proxyReq.setHeader('X-User-Domain', req.user.domain || 'portal');
        proxyReq.setHeader('X-Company-Id', req.user.company_id || '');
        proxyReq.setHeader('X-Gateway-Auth', 'true');
      }
    }
  };

  if (pathRewrite) {
    options.pathRewrite = pathRewrite;
  }

  return createProxyMiddleware(options);
}

// Dashboard (7500) - proxy all paths including static assets
app.use('/dashboard', requireAuth, createAuthProxy('http://localhost:7500', { '^/dashboard': '' }));

// Dashboard static assets (CSS, JS, images) - needed because dashboard HTML uses absolute paths like /css/
app.use('/css', requireAuth, createAuthProxy('http://localhost:7500'));
app.use('/js', requireAuth, createAuthProxy('http://localhost:7500'));
app.use('/images', requireAuth, createAuthProxy('http://localhost:7500'));

// Patcher API (7101) - Admin only
app.use('/patcher', requireAuth, requireAdmin, createAuthProxy('http://localhost:7101'));

// Dev sync (7101) - Admin only
app.use('/dev-sync', requireAuth, requireAdmin, createAuthProxy('http://localhost:7101', { '^/dev-sync': '/dev' }));

// Tradeline admin pages (3002-3021) - dynamic routing
const tradelinePorts = {
  security: 3002, administrative: 3003, facilities: 3004, electrical: 3005,
  logistics: 3006, lowvoltage: 3007, landscaping: 3008, hvac: 3009,
  plumbing: 3010, janitorial: 3011, support: 3012, waste: 3013,
  construction: 3014, roofing: 3015, painting: 3016, flooring: 3017,
  demolition: 3018, environmental: 3019, concrete: 3020, fencing: 3021
};

app.use('/tradelines/:name', requireAuth, (req, res, next) => {
  const port = tradelinePorts[req.params.name];
  if (!port) {
    return res.status(404).json({ error: 'Unknown tradeline' });
  }

  createAuthProxy(`http://localhost:${port}`, {
    [`^/tradelines/${req.params.name}`]: ''
  })(req, res, next);
});

// ============================================================
// PORTAL USER ROUTES
// ============================================================

app.get('/opportunities', requireAuth, async (req, res) => {
  res.render('opportunities', { user: req.user });
});

app.get('/bids', requireAuth, async (req, res) => {
  res.render('bids', { user: req.user });
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
║   Auth: JWT with refresh tokens                                ║
║                                                                ║
║   Token Expiry:                                                ║
║   - Access Token:  1 hour (auto-refreshes)                     ║
║   - Refresh Token: 7 days                                      ║
║                                                                ║
║   Routes:                                                      ║
║   GET  /login            - Login page                          ║
║   POST /login            - Process login (issues JWT)          ║
║   GET  /logout           - Logout (clears tokens)              ║
║   GET  /register         - Registration page                   ║
║   POST /register         - Process registration                ║
║   GET  /profile          - User profile                        ║
║                                                                ║
║   Proxied Routes (with user headers):                          ║
║   /dashboard/*           → 7500 Dashboard                      ║
║   /patcher/*             → 7101 Patcher (admin only)           ║
║   /dev-sync/*            → 7101 Dev Sync (admin only)          ║
║   /tradelines/:name/*    → 3002-3021 Tradeline admins          ║
║                                                                ║
║   Backend services receive headers:                            ║
║   X-User-Id, X-User-Email, X-User-Role, X-Company-Id           ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
