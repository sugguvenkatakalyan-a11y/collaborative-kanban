const { ActivityLog } = require('../models');
const { emitToTenant } = require('../sockets/emitter');

/**
 * Record an action in activity_logs and push it to the tenant room in real time.
 * Always uses the server-verified tenant from `req.tenant`.
 */
async function logActivity(req, { entityType, entityId, action, details = {}, boardId = null }) {
  const log = await ActivityLog.create({
    organizationId: req.tenant.organizationId,
    tenantId: req.tenant._id,
    boardId,
    userId: req.user._id,
    entityType,
    entityId,
    action,
    details,
  });
  const json = { ...log.toJSON(), user: { id: req.user._id.toString(), name: req.user.name } };
  emitToTenant(req.tenant._id, 'activity:created', { activity: json }, { originSocketId: req.socketId });
  return json;
}

module.exports = { logActivity };
