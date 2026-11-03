# Database design (MongoDB)

![ER diagram](database-erd.png)

Source of truth: `backend/src/models/index.js`. Editable diagram source: `docs/erd-source.html` (open in a browser).

```mermaid
erDiagram
  ORGANIZATIONS ||--o{ TENANTS : has
  ORGANIZATIONS ||--o{ MEMBERSHIPS : grants
  USERS ||--o{ MEMBERSHIPS : holds
  TENANTS ||--o{ MEMBERSHIPS : "scopes (null = org-level)"
  TENANTS ||--o{ BOARDS : owns
  BOARDS ||--o{ COLUMNS : contains
  COLUMNS ||--o{ TASKS : holds
  BOARDS ||--o{ TASKS : contains
  USERS ||--o{ TASKS : "assignedTo"
  TENANTS ||--o{ ACTIVITY_LOGS : records
  USERS ||--o{ ACTIVITY_LOGS : performs

  ORGANIZATIONS { ObjectId _id PK  string name  ObjectId createdBy FK  date createdAt  date updatedAt }
  TENANTS { ObjectId _id PK  ObjectId organizationId FK  string name  date createdAt }
  USERS { ObjectId _id PK  string name  string email UK  string passwordHash  date createdAt }
  MEMBERSHIPS { ObjectId _id PK  ObjectId userId FK  ObjectId organizationId FK  ObjectId tenantId FK  string role }
  BOARDS { ObjectId _id PK  ObjectId organizationId FK  ObjectId tenantId FK  string name  string description  ObjectId createdBy FK }
  COLUMNS { ObjectId _id PK  ObjectId tenantId FK  ObjectId boardId FK  string name  number position }
  TASKS { ObjectId _id PK  ObjectId tenantId FK  ObjectId boardId FK  ObjectId columnId FK  string title  string description  ObjectId assignedTo FK  string priority  date dueDate  number position  number version }
  ACTIVITY_LOGS { ObjectId _id PK  ObjectId tenantId FK  ObjectId boardId FK  ObjectId userId FK  string entityType  ObjectId entityId  string action  mixed details  date createdAt }
```

## Collections

| Collection | Purpose | Key fields | Indexes |
|---|---|---|---|
| `organizations` | Parent companies | `name`, `createdBy` | `_id` |
| `tenants` | Branches / workspaces | `organizationId`, `name` | `organizationId`; **unique** `(organizationId, name)` |
| `users` | Accounts | `email` (lower-case), `passwordHash` (bcrypt, never returned) | **unique** `email` |
| `memberships` | RBAC link user ↔ org/tenant | `userId`, `organizationId`, `tenantId` (null ⇒ org level), `role` | `userId`, `organizationId`, `tenantId`; **unique** `(userId, organizationId, tenantId)` |
| `boards` | Kanban boards | `tenantId`, `organizationId`, `name`, `description`, `createdBy` | `(tenantId, createdAt)` |
| `columns` | Status columns | `tenantId`, `boardId`, `name`, `position` | `(tenantId, boardId, position)` |
| `tasks` | Work items | `tenantId`, `boardId`, `columnId`, `title`, `description`, `assignedTo`, `priority`, `dueDate`, `labels`, `position`, `version`, `createdBy`, `updatedBy` | `(tenantId, boardId, columnId, position)`, `(tenantId, assignedTo)` |
| `activity_logs` | Audit / history | `tenantId`, `boardId`, `userId`, `entityType`, `entityId`, `action`, `details` | `(tenantId, createdAt)`, `(tenantId, boardId, createdAt)`, `(tenantId, entityId, createdAt)` |

Every collection has `createdAt` / `updatedAt` timestamps (activity logs: `createdAt` only).

## Design decisions

**Denormalised `tenantId` (and `organizationId`) on every tenant-owned document.** Columns and tasks could derive their tenant through their board, but storing it directly means *every* query can be a single filter `{ _id, tenantId }`. That makes isolation both cheap and easy to audit: any query without `tenantId` is a bug.

**References, not embedding.** Tasks are separate documents (not embedded in boards) so that concurrent edits touch different documents, versioning is per task, and a board does not grow without bound.

**Referential integrity in code.** MongoDB has no foreign keys, so the service layer:
- validates that referenced ids exist *in the same tenant* (column ∈ board ∈ tenant; assignee has tenant access),
- performs cascading deletes (`backend/src/services/cascade.service.js`),
- refuses to delete a column that still holds tasks.

**Ordering.** `position` is a floating-point number. Inserting between neighbours uses the midpoint, so a move updates one document. If neighbouring positions get closer than `1e-6`, the column is renumbered (1024, 2048, …) and clients get `board:resync`. Ties are broken by `_id` on both server and client.

**Concurrency.** `version` starts at 1 and is incremented by every update/move with an atomic conditional update (`{ _id, tenantId, version: expected }`). A failed match means a stale write → HTTP 409.

**Passwords.** bcrypt with cost 12 (`select: false` on the schema; stripped from JSON).
