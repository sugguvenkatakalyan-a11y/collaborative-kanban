const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireTenant, requireRole } = require('../middleware/tenant.middleware');

const auth = require('../controllers/auth.controller');
const orgs = require('../controllers/organization.controller');
const tenants = require('../controllers/tenant.controller');
const boards = require('../controllers/board.controller');
const columns = require('../controllers/column.controller');
const tasks = require('../controllers/task.controller');
const activity = require('../controllers/activity.controller');

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Auth ─────────────────────────────────────────────────────────────────────
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.get('/auth/me', requireAuth, auth.me);

// Everything below requires a valid JWT.
router.use(requireAuth);

// ── Organizations (org-level, no tenant header) ─────────────────────────────
router.post('/organizations', orgs.create);
router.get('/organizations', orgs.list);
router.get('/organizations/:id', orgs.get);
router.put('/organizations/:id', orgs.update);
router.delete('/organizations/:id', orgs.remove);
router.get('/organizations/:id/admins', orgs.listAdmins);
router.post('/organizations/:id/admins', orgs.addAdmin);

// ── Tenants ──────────────────────────────────────────────────────────────────
router.post('/tenants', tenants.create);
router.get('/tenants', tenants.list);
router.get('/tenants/:id', requireTenant('id'), tenants.get);
router.put('/tenants/:id', requireTenant('id'), tenants.update);
router.delete('/tenants/:id', requireTenant('id'), tenants.remove);
router.get('/tenants/:id/members', requireTenant('id'), tenants.listMembers);
router.post('/tenants/:id/members', requireTenant('id'), tenants.addMember);
router.patch('/memberships/:id', tenants.updateMembership);
router.delete('/memberships/:id', tenants.removeMembership);

// ── Tenant-scoped resources: require X-Tenant-Id + verified membership ──────
const scoped = Router();
scoped.use(requireTenant('header'));

scoped.get('/boards', boards.list);
scoped.post('/boards', requireRole('tenant_admin'), boards.create);
scoped.get('/boards/:id', boards.get);
scoped.get('/boards/:id/summary', boards.summary);
scoped.put('/boards/:id', requireRole('tenant_admin'), boards.update);
scoped.delete('/boards/:id', requireRole('tenant_admin'), boards.remove);

scoped.get('/boards/:boardId/columns', columns.listForBoard);
scoped.post('/columns', requireRole('tenant_admin'), columns.create);
scoped.put('/columns/:id', requireRole('tenant_admin'), columns.update);
scoped.delete('/columns/:id', requireRole('tenant_admin'), columns.remove);

scoped.get('/tasks', tasks.list);
scoped.post('/tasks', tasks.create);
scoped.get('/tasks/:id', tasks.get);
scoped.put('/tasks/:id', tasks.update);
scoped.patch('/tasks/:id/move', tasks.move);
scoped.delete('/tasks/:id', tasks.remove);

scoped.get('/activity', activity.list);

router.use(scoped);

module.exports = router;
