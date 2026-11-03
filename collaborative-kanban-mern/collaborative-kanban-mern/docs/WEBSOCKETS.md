# WebSocket (Socket.IO) reference

Server: same origin/port as the API (`http://localhost:5000`, path `/socket.io`). In development the Vite server proxies it.

## Connecting & authentication

```js
import { io } from 'socket.io-client';
const socket = io(API_URL, { auth: { token: jwt } });
```

The handshake middleware verifies the JWT. Invalid or missing token → `connect_error` with message `unauthorized`; the connection is refused.

Each socket automatically joins a private `user:<userId>` room (used only by the server, e.g. for revoking access).

## Tenant rooms

```js
socket.emit('tenant:join', { tenantId }, (ack) => {
  // { ok: true, tenantId, role, users: [presence…] }
  // { ok: false, error: 'forbidden' | 'server_error' }
});
```

- The server runs the **same membership check as the REST API** (`resolveTenantAccess`). Naming a room is not enough to join it.
- A socket is in at most one tenant room (`tenant:<tenantId>`). Joining another tenant leaves the previous one.
- All broadcasts below go **only** to `tenant:<id>` rooms, and only after the database write has committed.

## Client → server

| Event | Payload | Ack | Description |
|---|---|---|---|
| `tenant:join` | `{ tenantId }` | `{ ok, tenantId, role, users }` | Authorised room join (see above) |
| `tenant:leave` | `{}` | `{ ok }` | Leave the current tenant room |
| `presence:viewing` | `{ boardId \| null }` | — | Which board this tab is looking at (per-board presence) |
| `task:editing` | `{ taskId, editing: boolean }` | — | Relayed to other members of the joined tenant as an "is editing" hint |

## Server → client

Every broadcast payload carries `meta: { at, originSocketId?, by?: { id, name } }`.

| Event | Payload | When |
|---|---|---|
| `task:created` | `{ task }` | Task created |
| `task:updated` | `{ task, changed: string[] }` | Task fields changed |
| `task:moved` | `{ task, fromColumnId, toColumnId }` | Task moved / reordered |
| `task:deleted` | `{ taskId, boardId, columnId }` | Task deleted |
| `board:created` | `{ board, columns }` | Board created |
| `board:updated` | `{ board }` | Board renamed / described |
| `board:deleted` | `{ boardId }` | Board deleted |
| `board:resync` | `{ boardId, reason }` | Column positions were rebalanced — refetch the board |
| `column:created` / `column:updated` | `{ column }` | Column added / renamed / repositioned |
| `column:deleted` | `{ columnId, boardId }` | Column removed |
| `activity:created` | `{ activity }` | New activity log entry (includes `user: { id, name }`) |
| `presence:update` | `{ tenantId, users: [{ userId, name, boardIds, connections }] }` | Anyone joins/leaves/changes board |
| `presence:online` | `{ tenantId, user: { id, name } }` | A user's **first** socket in the tenant connects |
| `presence:offline` | `{ tenantId, user: { id, name } }` | A user's **last** socket in the tenant disconnects |
| `task:editing` | `{ taskId, editing, user: { id, name } }` | Someone opened/closed a task panel |
| `tenant:access-revoked` | `{ tenantId }` | Your membership was removed; you were evicted from the room |

## Client-side handling rules (as implemented in `useBoard.js`)

1. **Idempotent / order-safe**: a received task replaces the local copy only if `incoming.version >= local.version`. Duplicates and late events are ignored.
2. **Own echoes** are harmless for the same reason (the HTTP response and the echo carry the same version).
3. **Filter by board**: events for other boards of the same tenant are ignored by the board view (the dashboard uses them to refresh counts).

## Presence

- Tracked per socket: `tenantId → socketId → { userId, name, boardId }`.
- A user with three tabs open appears once with `connections: 3`, and goes offline only when the last tab closes.
- Dead connections are detected by Socket.IO's heartbeat (`pingInterval: 10s`, `pingTimeout: 5s`).

## Reconnection

1. Connection drops → UI shows **Reconnecting…** (Socket.IO retries with back-off, 0.5–5 s).
2. On reconnect the handshake **re-verifies the JWT**.
3. The client re-emits `tenant:join` → membership is **re-checked**.
4. On a successful re-join after a disconnect the workspace increments `syncKey`, which makes the open board, dashboard and activity feed refetch from the REST API.
5. Local state is replaced by the authoritative snapshot — missed events are never assumed delivered.
