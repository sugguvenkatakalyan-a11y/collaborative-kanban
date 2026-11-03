# REST API reference

Base URL: `http://localhost:5000/api`  ·  Content type: `application/json`

## Conventions

| Header | When | Purpose |
|---|---|---|
| `Authorization: Bearer <jwt>` | every route except register/login/health | Identity |
| `X-Tenant-Id: <tenantId>` | tenant-scoped routes (boards, columns, tasks, activity) | Active branch. **Re-verified against memberships on every request.** |
| `X-Socket-Id: <socket.id>` | optional | Tags resulting broadcasts with `meta.originSocketId` |

**Tenant scoping.** For tenant-scoped routes, every database query is filtered by the *verified* tenant. A record that exists in another tenant is answered with `404` — exactly as if it did not exist. A `tenantId` in the body is ignored.

**Errors** are JSON: `{ "error": "message", ...extra }`

| Status | Meaning |
|---|---|
| 400 | Validation failed — `{ error, errors: [{ field, message }] }` |
| 401 | Missing / invalid / expired token |
| 403 | Authenticated but not allowed (no tenant access, insufficient role) |
| 404 | Not found **in your tenant** |
| 409 | Version conflict — `{ error, code: "VERSION_CONFLICT", current: <task> }` — or duplicate value |
| 500 | Unexpected server error |

Ids are MongoDB ObjectIds (24 hex chars); responses expose them as `id`.

---

## Health

### `GET /health`
`200 { "status": "ok", "time": "2026-11-02T17:41:46.406Z" }`

## Authentication

### `POST /auth/register`
```json
{ "name": "Asha Rao", "email": "asha@abc.example", "password": "at-least-8-chars" }
```
`201 { "token": "<jwt>", "user": { "id", "name", "email", "createdAt", "updatedAt" } }` · `409` email already used · `400` validation.

### `POST /auth/login`
```json
{ "email": "priya@abc.example", "password": "Password@123" }
```
`200 { "token", "user" }` · `401 Invalid email or password` (same message for unknown email).

### `GET /auth/me`
`200 { "user", "organizations": [ { "id", "name", "role": "org_admin" | "tenant_user" } ] }`

---

## Organisations (no tenant header)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/organizations` | any user | Body `{ name }`. Creator becomes `org_admin`. `201 { organization }` |
| GET | `/organizations` | any user | Only organisations the user belongs to. `200 { organizations }` |
| GET | `/organizations/:id` | member of org | `404` if not a member |
| PUT | `/organizations/:id` | org_admin | Body `{ name }` |
| DELETE | `/organizations/:id` | org_admin | Cascades to tenants, memberships, boards, columns, tasks, logs. `204` |
| GET | `/organizations/:id/admins` | org_admin | `{ admins: [{ id, role, user }] }` |
| POST | `/organizations/:id/admins` | org_admin | Body `{ email }` of a registered user. `201` |

## Tenants (branches)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/tenants` | org_admin of `organizationId` | Body `{ organizationId, name }`. `201 { tenant }` |
| GET | `/tenants?organizationId=` | any | Only tenants the user can access, each with the user's effective `role` |
| GET | `/tenants/:id` | tenant access | `{ tenant: { ..., role } }` |
| PUT | `/tenants/:id` | org_admin | Body `{ name }` |
| DELETE | `/tenants/:id` | org_admin | Cascade. `204` |
| GET | `/tenants/:id/members` | tenant access | Tenant members + org admins: `{ members: [{ membershipId, role, inherited, user }] }` |
| POST | `/tenants/:id/members` | tenant_admin+ | Body `{ email, role: "member" \| "tenant_admin" }`. `201`, `404` unknown email, `409` already member |
| PATCH | `/memberships/:id` | tenant_admin+ of that tenant | Body `{ role }` (tenant roles only) |
| DELETE | `/memberships/:id` | tenant_admin+ (tenant) / org_admin (org-level) | Cannot remove the last org admin. Removed user's live sockets are evicted. `204` |

---

## Boards — require `X-Tenant-Id`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/boards` | any | `{ boards: [{ id, name, description, createdAt, taskCount }] }` |
| POST | `/boards` | tenant_admin+ | Body `{ name, description? }`. Creates default columns *To Do, In Progress, Testing, Done*. `201 { board, columns }` |
| GET | `/boards/:id` | any | Full snapshot `{ board, columns, tasks, role }` — used on load and after reconnect |
| GET | `/boards/:id/summary` | any | `{ board, total, byColumn, completed, completionRate, overdue, recentActivity }` |
| PUT | `/boards/:id` | tenant_admin+ | Body `{ name?, description? }` |
| DELETE | `/boards/:id` | tenant_admin+ | Cascades columns, tasks, logs. `204` |

## Columns — require `X-Tenant-Id`

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/boards/:boardId/columns` | any | Sorted by `position` |
| POST | `/columns` | tenant_admin+ | Body `{ boardId, name }`; board must be in the tenant. Appended at the end |
| PUT | `/columns/:id` | tenant_admin+ | Body `{ name?, position? }` |
| DELETE | `/columns/:id` | tenant_admin+ | `409` if the column still has tasks |

## Tasks — require `X-Tenant-Id`

Task object:
```json
{
  "id": "6730…", "organizationId": "…", "tenantId": "…", "boardId": "…", "columnId": "…",
  "title": "Create Login Page", "description": "…",
  "assignedTo": { "id": "…", "name": "Rahul Sharma", "email": "rahul@abc.example" },
  "priority": "high", "dueDate": "2026-11-05T00:00:00.000Z", "labels": ["frontend"],
  "position": 1024, "version": 3,
  "createdBy": "…", "updatedBy": "…", "createdAt": "…", "updatedAt": "…"
}
```

### `GET /tasks?boardId=&columnId=&assignedTo=me|<userId>`
`200 { tasks }` (max 500, sorted by position).

### `GET /tasks/:id`
`200 { task, activity }` — `activity` is the task's history (latest 30).

### `POST /tasks` — any role
```json
{ "boardId": "…", "columnId": "…", "title": "New task",
  "description": "", "assignedTo": null, "priority": "medium", "dueDate": null, "labels": [] }
```
Column must belong to the board **and** tenant (`400` otherwise); board must be in the tenant (`404`); assignee must have access to the tenant (`400`). Appended to the bottom of the column with `version: 1`. `201 { task }` · broadcasts `task:created`.

### `PUT /tasks/:id` — any role
```json
{ "expectedVersion": 3, "title": "Renamed", "priority": "urgent" }
```
Only the fields sent are changed. Atomic compare-and-set on `version`.

- `200 { task }` (version incremented) · broadcasts `task:updated` with `changed: [fields]`
- `409 { code: "VERSION_CONFLICT", current }` if someone saved first
- `404` if the task was deleted

### `PATCH /tasks/:id/move` — any role

| Property | Details |
|---|---|
| Body | `{ "toColumnId": "…", "toIndex": 0, "expectedVersion": 3 }` |
| `toIndex` | Position among the **other** tasks of the destination column (0 = top; values past the end append) |
| Ordering | Computed server-side from the column's current state (fractional midpoint, automatic rebalance) |
| Response | `200 { task }` · broadcasts `task:moved` `{ task, fromColumnId, toColumnId }` |
| Conflict | `409 VERSION_CONFLICT` with `current` |
| Errors | `400` destination column not on this board / tenant · `404` task not in tenant |

### `DELETE /tasks/:id?expectedVersion=` — creator or tenant_admin+
`204` · broadcasts `task:deleted`. `403` for members deleting someone else's task. With `expectedVersion`, refuses (409) if the task changed meanwhile.

## Activity — require `X-Tenant-Id`

### `GET /activity?boardId=&limit=50`
`200 { activity: [{ id, tenantId, boardId, userId, user: { id, name }, entityType, entityId, action, details, createdAt }] }` — newest first, max 200.

`details` examples: `{ title, from, to, reordered }` for moves, `{ title, fields, assignee }` for updates.

---

## cURL quick start

```bash
TOKEN=$(curl -s localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"priya@abc.example","password":"Password@123"}' | node -pe 'JSON.parse(fs.readFileSync(0)).token')

ORG=$(curl -s localhost:5000/api/organizations -H "Authorization: Bearer $TOKEN" | node -pe 'JSON.parse(fs.readFileSync(0)).organizations[0].id')
TENANT=$(curl -s "localhost:5000/api/tenants?organizationId=$ORG" -H "Authorization: Bearer $TOKEN" | node -pe 'JSON.parse(fs.readFileSync(0)).tenants[0].id')

curl -s localhost:5000/api/boards -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT"
```
