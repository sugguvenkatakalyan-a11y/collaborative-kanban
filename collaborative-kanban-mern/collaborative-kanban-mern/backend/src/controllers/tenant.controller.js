const { Tenant, Membership, User } = require('../models');
const { isOrgAdmin, listTenantsForUser, resolveTenantAccess, hasRole } = require('../services/access.service');
const { deleteTenantCascade } = require('../services/cascade.service');
const { logActivity } = require('../services/activity.service');
const { revokeAccess } = require('../sockets');
const { z, objectId, parse, idParam } = require('../utils/validate');
const { asyncHandler, forbidden, notFound, conflict, badRequest } = require('../utils/errors');

const createSchema = z.object({ organizationId: objectId, name: z.string().trim().min(2).max(120) });
const updateSchema = z.object({ name: z.string().trim().min(2).max(120) });
const TENANT_ROLES = ['tenant_admin', 'member'];

exports.create = asyncHandler(async (req, res) => {
  const { organizationId, name } = parse(createSchema, req.body);
  if (!(await isOrgAdmin(req.user._id, organizationId))) throw forbidden('Requires org_admin role');
  const tenant = await Tenant.create({ organizationId, name });
  res.status(201).json({ tenant: { ...tenant.toJSON(), role: 'org_admin' } });
});

// GET /api/tenants?organizationId=...  → only tenants the user may access.
exports.list = asyncHandler(async (req, res) => {
  const { organizationId } = parse(z.object({ organizationId: objectId }), req.query);
  res.json({ tenants: await listTenantsForUser(req.user._id, organizationId) });
});

// The routes below run after requireTenant('id'), so req.tenant is authorised.
exports.get = asyncHandler(async (req, res) => {
  res.json({ tenant: { ...req.tenant, id: req.tenant._id.toString(), _id: undefined, role: req.role } });
});

exports.update = asyncHandler(async (req, res) => {
  if (req.role !== 'org_admin') throw forbidden('Requires org_admin role');
  const { name } = parse(updateSchema, req.body);
  const tenant = await Tenant.findByIdAndUpdate(req.tenant._id, { name }, { new: true, runValidators: true });
  res.json({ tenant: tenant.toJSON() });
});

exports.remove = asyncHandler(async (req, res) => {
  if (req.role !== 'org_admin') throw forbidden('Requires org_admin role');
  await deleteTenantCascade(req.tenant._id);
  res.status(204).end();
});

// ── Tenant members ───────────────────────────────────────────────────────────
// Lists tenant members plus the org admins who also have access (used for assignee pickers).
exports.listMembers = asyncHandler(async (req, res) => {
  const memberships = await Membership.find({
    organizationId: req.tenant.organizationId,
    $or: [{ tenantId: req.tenant._id }, { tenantId: null, role: 'org_admin' }],
  })
    .populate('userId', 'name email')
    .lean();

  const byUser = new Map();
  for (const m of memberships) {
    const key = m.userId._id.toString();
    const existing = byUser.get(key);
    // org_admin outranks tenant roles
    if (!existing || m.role === 'org_admin') {
      byUser.set(key, {
        membershipId: m._id.toString(),
        role: m.role,
        inherited: m.tenantId === null,
        user: { id: key, name: m.userId.name, email: m.userId.email },
      });
    }
  }
  res.json({ members: [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name)) });
});

exports.addMember = asyncHandler(async (req, res) => {
  if (!hasRole(req.role, 'tenant_admin')) throw forbidden('Requires tenant_admin role');
  const { email, role } = parse(
    z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(TENANT_ROLES).default('member') }),
    req.body
  );
  const user = await User.findOne({ email });
  if (!user) throw notFound('No registered user with that email');
  if (await Membership.exists({ userId: user._id, organizationId: req.tenant.organizationId, tenantId: req.tenant._id })) {
    throw conflict('User is already a member of this tenant');
  }
  const m = await Membership.create({
    userId: user._id,
    organizationId: req.tenant.organizationId,
    tenantId: req.tenant._id,
    role,
  });
  await logActivity(req, {
    entityType: 'membership',
    entityId: m._id,
    action: 'created',
    details: { userName: user.name, role },
  });
  res.status(201).json({ membership: m.toJSON() });
});

/** Shared loader for PATCH/DELETE /api/memberships/:id with authorisation. */
async function loadManageableMembership(req) {
  idParam(req.params.id, 'Membership');
  const m = await Membership.findById(req.params.id);
  if (!m) throw notFound('Membership not found');

  if (m.tenantId) {
    const access = await resolveTenantAccess(req.user._id, m.tenantId);
    if (!access) throw notFound('Membership not found');
    if (!hasRole(access.role, 'tenant_admin')) throw forbidden('Requires tenant_admin role');
    req.tenant = access.tenant;
    req.role = access.role;
  } else if (!(await isOrgAdmin(req.user._id, m.organizationId))) {
    throw notFound('Membership not found');
  }
  return m;
}

exports.updateMembership = asyncHandler(async (req, res) => {
  const m = await loadManageableMembership(req);
  if (!m.tenantId) throw badRequest('Org admin memberships have a fixed role');
  const { role } = parse(z.object({ role: z.enum(TENANT_ROLES) }), req.body);
  m.role = role;
  await m.save();
  await logActivity(req, { entityType: 'membership', entityId: m._id, action: 'updated', details: { role } });
  res.json({ membership: m.toJSON() });
});

exports.removeMembership = asyncHandler(async (req, res) => {
  const m = await loadManageableMembership(req);
  let revokedTenantIds;
  if (!m.tenantId) {
    const admins = await Membership.countDocuments({ organizationId: m.organizationId, tenantId: null });
    if (admins <= 1) throw badRequest('Cannot remove the last org admin');
    revokedTenantIds = (await Tenant.find({ organizationId: m.organizationId }).select('_id').lean()).map((t) => t._id);
  } else {
    revokedTenantIds = [m.tenantId];
    await logActivity(req, { entityType: 'membership', entityId: m._id, action: 'deleted', details: {} });
  }
  await m.deleteOne();

  // Kick the user's live sockets out of rooms they can no longer access.
  for (const tenantId of revokedTenantIds) {
    if (!(await resolveTenantAccess(m.userId, tenantId))) revokeAccess(m.userId, tenantId);
  }
  res.status(204).end();
});
