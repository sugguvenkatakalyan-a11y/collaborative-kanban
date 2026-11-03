/**
 * Thin wrapper so controllers can broadcast committed changes without importing
 * the Socket.IO server directly. Events only ever go to `tenant:<id>` rooms, and
 * sockets are only admitted to a room after a membership check.
 */
let io = null;

const tenantRoom = (tenantId) => `tenant:${tenantId}`;
const userRoom = (userId) => `user:${userId}`;

function setIO(instance) {
  io = instance;
}

function getIO() {
  return io;
}

/**
 * Broadcast to everyone in a tenant room.
 * `meta.originSocketId` lets clients recognise echoes of their own actions.
 */
function emitToTenant(tenantId, event, payload, meta = {}) {
  if (!io) return;
  io.to(tenantRoom(tenantId)).emit(event, { ...payload, meta: { at: new Date().toISOString(), ...meta } });
}

module.exports = { setIO, getIO, emitToTenant, tenantRoom, userRoom };
