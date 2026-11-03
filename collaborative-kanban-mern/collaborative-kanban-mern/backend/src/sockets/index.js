/**
 * Socket.IO server: authentication, tenant-scoped rooms and presence.
 *
 *  1. Handshake must carry a valid JWT (`auth: { token }`) or the connection is refused.
 *  2. A client asks to `tenant:join` a tenant; the server checks membership with the
 *     SAME access service the REST API uses before adding the socket to `tenant:<id>`.
 *     Clients can never join a room just by naming it.
 *  3. Each socket is in at most one tenant room at a time (switching tenants leaves the old one).
 *  4. Presence is tracked per socket, so a user with several tabs open only goes
 *     "offline" when their LAST socket in that tenant disconnects.
 *  5. Socket.IO's ping/pong heartbeat detects dead connections (pingInterval/pingTimeout).
 */
const { Server } = require('socket.io');
const env = require('../config/env');
const { userFromToken } = require('../middleware/auth.middleware');
const { resolveTenantAccess } = require('../services/access.service');
const { setIO, getIO, tenantRoom, userRoom } = require('./emitter');

// tenantId -> Map<socketId, { userId, name, boardId }>
const presence = new Map();

function presenceList(tenantId) {
  const sockets = presence.get(tenantId);
  if (!sockets) return [];
  const users = new Map();
  for (const { userId, name, boardId } of sockets.values()) {
    const u = users.get(userId) || { userId, name, boardIds: [], connections: 0 };
    u.connections += 1;
    if (boardId && !u.boardIds.includes(boardId)) u.boardIds.push(boardId);
    users.set(userId, u);
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const userConnections = (tenantId, userId) =>
  [...(presence.get(tenantId)?.values() || [])].filter((p) => p.userId === userId).length;

function broadcastPresence(tenantId) {
  getIO()?.to(tenantRoom(tenantId)).emit('presence:update', { tenantId, users: presenceList(tenantId) });
}

function addPresence(socket, tenantId) {
  const { id: userId, name } = socket.data.user;
  if (!presence.has(tenantId)) presence.set(tenantId, new Map());
  const wasOnline = userConnections(tenantId, userId) > 0;
  presence.get(tenantId).set(socket.id, { userId, name, boardId: null });
  if (!wasOnline) socket.to(tenantRoom(tenantId)).emit('presence:online', { tenantId, user: { id: userId, name } });
  broadcastPresence(tenantId);
}

function removePresence(socket, tenantId) {
  const sockets = presence.get(tenantId);
  if (!sockets || !sockets.has(socket.id)) return;
  const { userId, name } = sockets.get(socket.id);
  sockets.delete(socket.id);
  if (!sockets.size) presence.delete(tenantId);
  if (userConnections(tenantId, userId) === 0) {
    getIO()?.to(tenantRoom(tenantId)).emit('presence:offline', { tenantId, user: { id: userId, name } });
  }
  broadcastPresence(tenantId);
}

function leaveCurrentTenant(socket) {
  const current = socket.data.tenantId;
  if (!current) return;
  socket.leave(tenantRoom(current));
  removePresence(socket, current);
  socket.data.tenantId = null;
}

/** Called when a membership is removed: evict that user's live sockets from the tenant room. */
async function revokeAccess(userId, tenantId) {
  const io = getIO();
  if (!io) return;
  const sockets = await io.in(userRoom(userId.toString())).fetchSockets();
  for (const s of sockets) {
    if (s.data.tenantId === tenantId.toString()) {
      s.leave(tenantRoom(tenantId));
      const real = io.sockets.sockets.get(s.id);
      if (real) removePresence(real, tenantId.toString());
      s.data.tenantId = null;
      s.emit('tenant:access-revoked', { tenantId: tenantId.toString() });
    }
  }
}

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    pingInterval: 10000,
    pingTimeout: 5000,
  });
  setIO(io);

  // 1. Authenticate the handshake.
  io.use(async (socket, next) => {
    const user = await userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = { id: user._id.toString(), name: user.name };
    socket.data.tenantId = null;
    next();
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.user.id));

    // 2. Join an authorised tenant room.
    socket.on('tenant:join', async (payload, ack = () => {}) => {
      try {
        const tenantId = payload?.tenantId;
        const access = await resolveTenantAccess(socket.data.user.id, tenantId);
        if (!access) return ack({ ok: false, error: 'forbidden' });

        const id = access.tenant._id.toString();
        if (socket.data.tenantId !== id) {
          leaveCurrentTenant(socket);
          socket.join(tenantRoom(id));
          socket.data.tenantId = id;
          addPresence(socket, id);
        }
        ack({ ok: true, tenantId: id, role: access.role, users: presenceList(id) });
      } catch (err) {
        console.error('[socket] tenant:join failed', err);
        ack({ ok: false, error: 'server_error' });
      }
    });

    socket.on('tenant:leave', (_payload, ack = () => {}) => {
      leaveCurrentTenant(socket);
      ack({ ok: true });
    });

    // Which board is this socket looking at? (drives per-board "who's here" avatars)
    socket.on('presence:viewing', (payload) => {
      const tenantId = socket.data.tenantId;
      const entry = tenantId && presence.get(tenantId)?.get(socket.id);
      if (!entry) return;
      entry.boardId = typeof payload?.boardId === 'string' ? payload.boardId : null;
      broadcastPresence(tenantId);
    });

    // Soft lock hint: "Priya is editing this task". Relayed only inside the joined tenant.
    socket.on('task:editing', (payload) => {
      const tenantId = socket.data.tenantId;
      if (!tenantId || typeof payload?.taskId !== 'string') return;
      socket.to(tenantRoom(tenantId)).emit('task:editing', {
        taskId: payload.taskId,
        editing: Boolean(payload.editing),
        user: socket.data.user,
      });
    });

    socket.on('disconnect', () => leaveCurrentTenant(socket));
  });

  return io;
}

module.exports = { initSockets, revokeAccess, presenceList };
