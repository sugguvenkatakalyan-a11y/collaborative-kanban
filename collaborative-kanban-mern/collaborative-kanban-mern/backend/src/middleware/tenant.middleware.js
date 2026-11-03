/**
 * Tenant isolation middleware.
 *
 * The active tenant is taken from the `X-Tenant-Id` header (or a route param),
 * but it is NEVER trusted on its own: the server checks that the authenticated
 * user actually has a membership granting access to that tenant. Controllers then
 * use `req.tenant._id` — never a tenantId from the request body — in every query.
 */
const { resolveTenantAccess, hasRole } = require('../services/access.service');
const { badRequest, forbidden, asyncHandler } = require('../utils/errors');

const requireTenant = (source = 'header') =>
  asyncHandler(async (req, _res, next) => {
    const tenantId = source === 'header' ? req.headers['x-tenant-id'] : req.params[source];
    if (!tenantId) throw badRequest('Missing tenant context (X-Tenant-Id header)');

    const access = await resolveTenantAccess(req.user._id, tenantId);
    // Same response whether the tenant does not exist or belongs to someone else,
    // so tenant ids cannot be probed.
    if (!access) throw forbidden('You do not have access to this tenant');

    req.tenant = access.tenant;
    req.role = access.role;
    next();
  });

/** Require a minimum role inside the active tenant. */
const requireRole = (minRole) => (req, _res, next) => {
  if (!hasRole(req.role, minRole)) return next(forbidden(`Requires ${minRole} role`));
  next();
};

module.exports = { requireTenant, requireRole };
