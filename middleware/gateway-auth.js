/**
 * Gateway Authentication Middleware
 *
 * Drop this file into any backend service (Dashboard, Patcher, Tradelines)
 * to make it trust authentication from the gateway.
 *
 * The gateway validates JWT tokens and passes user info via headers.
 * Backend services just need to read these headers.
 *
 * Usage in your Express app:
 *
 *   const { requireGatewayAuth, getUser } = require('./middleware/gateway-auth');
 *
 *   // Protect all routes
 *   app.use(requireGatewayAuth);
 *
 *   // Or protect specific routes
 *   app.get('/admin', requireGatewayAuth, (req, res) => {
 *     console.log('User:', req.gatewayUser);
 *   });
 *
 *   // Access user in any route
 *   app.get('/profile', (req, res) => {
 *     const user = getUser(req);
 *     res.json({ email: user.email });
 *   });
 */

/**
 * Extract user from gateway headers
 */
function getUser(req) {
  if (req.headers['x-gateway-auth'] !== 'true') {
    return null;
  }

  return {
    id: req.headers['x-user-id'],
    email: req.headers['x-user-email'],
    name: req.headers['x-user-name'],
    role: req.headers['x-user-role'],
    domain: req.headers['x-user-domain'],
    company_id: req.headers['x-company-id']
  };
}

/**
 * Middleware: Require authentication via gateway
 */
function requireGatewayAuth(req, res, next) {
  const user = getUser(req);

  if (!user) {
    // Not coming through gateway - reject
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Access this service through the gateway at /login'
    });
  }

  // Attach user to request
  req.gatewayUser = user;
  next();
}

/**
 * Middleware: Require admin role
 */
function requireAdmin(req, res, next) {
  const user = getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (user.role !== 'superadmin' && user.domain !== 'engine') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.gatewayUser = user;
  next();
}

/**
 * Optional: Attach user to all requests (doesn't block if not authenticated)
 */
function attachUser(req, res, next) {
  req.gatewayUser = getUser(req);
  next();
}

module.exports = {
  getUser,
  requireGatewayAuth,
  requireAdmin,
  attachUser
};
