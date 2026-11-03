const { Organization, Membership, User } = require('../models');
const { isOrgAdmin, listOrganizationsForUser } = require('../services/access.service');
const { deleteOrganizationCascade } = require('../services/cascade.service');
const { z, parse, idParam } = require('../utils/validate');
const { asyncHandler, forbidden, notFound, conflict } = require('../utils/errors');

const orgSchema = z.object({ name: z.string().trim().min(2).max(120) });

/** Load an organisation the user can see; 404 otherwise (no existence leak). */
async function loadVisibleOrg(userId, id) {
  idParam(id, 'Organization');
  const member = await Membership.exists({ userId, organizationId: id });
  if (!member) throw notFound('Organization not found');
  const org = await Organization.findById(id);
  if (!org) throw notFound('Organization not found');
  return org;
}

async function assertOrgAdmin(userId, orgId) {
  if (!(await isOrgAdmin(userId, orgId))) throw forbidden('Requires org_admin role');
}

// Any authenticated user may create an organisation; the creator becomes its org_admin.
exports.create = asyncHandler(async (req, res) => {
  const { name } = parse(orgSchema, req.body);
  const org = await Organization.create({ name, createdBy: req.user._id });
  await Membership.create({ userId: req.user._id, organizationId: org._id, tenantId: null, role: 'org_admin' });
  res.status(201).json({ organization: { ...org.toJSON(), role: 'org_admin' } });
});

exports.list = asyncHandler(async (req, res) => {
  res.json({ organizations: await listOrganizationsForUser(req.user._id) });
});

exports.get = asyncHandler(async (req, res) => {
  const org = await loadVisibleOrg(req.user._id, req.params.id);
  res.json({ organization: org.toJSON() });
});

exports.update = asyncHandler(async (req, res) => {
  const org = await loadVisibleOrg(req.user._id, req.params.id);
  await assertOrgAdmin(req.user._id, org._id);
  const { name } = parse(orgSchema, req.body);
  org.name = name;
  await org.save();
  res.json({ organization: org.toJSON() });
});

exports.remove = asyncHandler(async (req, res) => {
  const org = await loadVisibleOrg(req.user._id, req.params.id);
  await assertOrgAdmin(req.user._id, org._id);
  await deleteOrganizationCascade(org._id, Organization);
  res.status(204).end();
});

// ── Organisation-level admins ────────────────────────────────────────────────
exports.listAdmins = asyncHandler(async (req, res) => {
  const org = await loadVisibleOrg(req.user._id, req.params.id);
  await assertOrgAdmin(req.user._id, org._id);
  const admins = await Membership.find({ organizationId: org._id, tenantId: null })
    .populate('userId', 'name email')
    .lean();
  res.json({
    admins: admins.map((m) => ({
      id: m._id.toString(),
      role: m.role,
      user: { id: m.userId._id.toString(), name: m.userId.name, email: m.userId.email },
    })),
  });
});

exports.addAdmin = asyncHandler(async (req, res) => {
  const org = await loadVisibleOrg(req.user._id, req.params.id);
  await assertOrgAdmin(req.user._id, org._id);
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
  const user = await User.findOne({ email });
  if (!user) throw notFound('No registered user with that email');
  if (await Membership.exists({ userId: user._id, organizationId: org._id, tenantId: null })) {
    throw conflict('User is already an org admin');
  }
  const m = await Membership.create({ userId: user._id, organizationId: org._id, tenantId: null, role: 'org_admin' });
  res.status(201).json({ membership: m.toJSON() });
});
