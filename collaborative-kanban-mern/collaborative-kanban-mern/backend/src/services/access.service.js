/**
 * Central authorisation logic. Used by BOTH the REST middleware and the
 * Socket.IO server, so the same rules decide who may read an API resource and
 * who may join a real-time tenant room.
 */
const mongoose = require('mongoose');
const { Membership, Tenant, Organization } = require('../models');

// Higher number = more privileges.
const ROLE_RANK = { member: 1, tenant_admin: 2, org_admin: 3 };

const hasRole = (role, minRole) => (ROLE_RANK[role] || 0) >= ROLE_RANK[minRole];

/**
 * Resolve a user's effective role inside a tenant.
 *  - org_admin of the tenant's organisation → access to every tenant of that org
 *  - otherwise a tenant-level membership is required
 * Returns { tenant, role } or null when the user has no access.
 */
async function resolveTenantAccess(userId, tenantId) {
  if (!mongoose.isValidObjectId(tenantId)) return null;
  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant) return null;

  const memberships = await Membership.find({
    userId,
    organizationId: tenant.organizationId,
    $or: [{ tenantId: null }, { tenantId: tenant._id }],
  }).lean();
  if (!memberships.length) return null;

  const role = memberships
    .map((m) => m.role)
    .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0];
  return { tenant, role };
}

/** Is the user an org_admin of this organisation? */
async function isOrgAdmin(userId, organizationId) {
  if (!mongoose.isValidObjectId(organizationId)) return false;
  const m = await Membership.exists({ userId, organizationId, tenantId: null, role: 'org_admin' });
  return Boolean(m);
}

/** Organisations the user belongs to (at org level or through any tenant). */
async function listOrganizationsForUser(userId) {
  const memberships = await Membership.find({ userId }).lean();
  const orgIds = [...new Set(memberships.map((m) => m.organizationId.toString()))];
  const orgs = await Organization.find({ _id: { $in: orgIds } }).sort({ name: 1 });
  return orgs.map((o) => {
    const isAdmin = memberships.some(
      (m) => m.organizationId.equals(o._id) && m.tenantId === null && m.role === 'org_admin'
    );
    return { ...o.toJSON(), role: isAdmin ? 'org_admin' : 'tenant_user' };
  });
}

/** Tenants of an organisation visible to the user, each with the user's effective role. */
async function listTenantsForUser(userId, organizationId) {
  const memberships = await Membership.find({ userId, organizationId }).lean();
  if (!memberships.length) return [];
  const orgAdmin = memberships.some((m) => m.tenantId === null && m.role === 'org_admin');

  const filter = { organizationId };
  if (!orgAdmin) filter._id = { $in: memberships.filter((m) => m.tenantId).map((m) => m.tenantId) };
  const tenants = await Tenant.find(filter).sort({ name: 1 });

  return tenants.map((t) => {
    const own = memberships.find((m) => m.tenantId && m.tenantId.equals(t._id));
    return { ...t.toJSON(), role: orgAdmin ? 'org_admin' : own.role };
  });
}

module.exports = {
  ROLE_RANK,
  hasRole,
  resolveTenantAccess,
  isOrgAdmin,
  listOrganizationsForUser,
  listTenantsForUser,
};
