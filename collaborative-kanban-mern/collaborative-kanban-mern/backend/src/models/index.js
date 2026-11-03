/**
 * MongoDB data model — the eight collections required by the assignment.
 *
 *   Organization ──< Tenant ──< Board ──< Column ──< Task
 *        │              │
 *        └──< Membership >── User
 *                       │
 *                 ActivityLog (per tenant)
 *
 * Every tenant-owned document (Board, Column, Task, ActivityLog) carries a
 * `tenantId` (and `organizationId`) so that EVERY query can be scoped by the
 * authorised tenant. Compound indexes start with `tenantId` for the same reason.
 */
const mongoose = require('mongoose');

const { Schema, Types } = mongoose;
const ObjectId = Schema.Types.ObjectId;

// Return `id` instead of `_id`, drop `__v` and secrets in JSON responses.
function toJSONOptions(hidden = []) {
  return {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      hidden.forEach((f) => delete ret[f]);
      return ret;
    },
  };
}

// ── organizations ────────────────────────────────────────────────────────────
const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: toJSONOptions() }
);

// ── tenants ──────────────────────────────────────────────────────────────────
const tenantSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { timestamps: true, toJSON: toJSONOptions() }
);
tenantSchema.index({ organizationId: 1, name: 1 }, { unique: true });

// ── users ────────────────────────────────────────────────────────────────────
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true, toJSON: toJSONOptions(['passwordHash']) }
);

// ── memberships (RBAC) ───────────────────────────────────────────────────────
// tenantId === null  → organisation-level membership (org_admin)
// tenantId !== null  → tenant-level membership (tenant_admin | member)
const ROLES = ['org_admin', 'tenant_admin', 'member'];
const membershipSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: ObjectId, ref: 'Organization', required: true, index: true },
    tenantId: { type: ObjectId, ref: 'Tenant', default: null, index: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true, toJSON: toJSONOptions() }
);
membershipSchema.index({ userId: 1, organizationId: 1, tenantId: 1 }, { unique: true });

// ── boards ───────────────────────────────────────────────────────────────────
const boardSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: 'Organization', required: true },
    tenantId: { type: ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: toJSONOptions() }
);
boardSchema.index({ tenantId: 1, createdAt: -1 });

// ── columns ──────────────────────────────────────────────────────────────────
const columnSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: 'Organization', required: true },
    tenantId: { type: ObjectId, ref: 'Tenant', required: true },
    boardId: { type: ObjectId, ref: 'Board', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    position: { type: Number, required: true },
  },
  { timestamps: true, toJSON: toJSONOptions() }
);
columnSchema.index({ tenantId: 1, boardId: 1, position: 1 });

// ── tasks ────────────────────────────────────────────────────────────────────
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const taskSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: 'Organization', required: true },
    tenantId: { type: ObjectId, ref: 'Tenant', required: true },
    boardId: { type: ObjectId, ref: 'Board', required: true },
    columnId: { type: ObjectId, ref: 'Column', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    assignedTo: { type: ObjectId, ref: 'User', default: null },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    dueDate: { type: Date, default: null },
    labels: { type: [String], default: [] },
    // Fractional ordering: a task is placed between its neighbours by taking the
    // midpoint of their positions, so a move only writes ONE document.
    position: { type: Number, required: true },
    // Optimistic concurrency control — incremented on every write.
    version: { type: Number, default: 1 },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: toJSONOptions() }
);
taskSchema.index({ tenantId: 1, boardId: 1, columnId: 1, position: 1 });
taskSchema.index({ tenantId: 1, assignedTo: 1 });

// ── activity_logs ────────────────────────────────────────────────────────────
const activityLogSchema = new Schema(
  {
    organizationId: { type: ObjectId, ref: 'Organization', required: true },
    tenantId: { type: ObjectId, ref: 'Tenant', required: true },
    boardId: { type: ObjectId, ref: 'Board', default: null },
    userId: { type: ObjectId, ref: 'User', required: true },
    entityType: { type: String, enum: ['task', 'board', 'column', 'membership', 'tenant'], required: true },
    entityId: { type: ObjectId, required: true },
    action: { type: String, enum: ['created', 'updated', 'moved', 'deleted'], required: true },
    details: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions() }
);
activityLogSchema.index({ tenantId: 1, createdAt: -1 });
activityLogSchema.index({ tenantId: 1, boardId: 1, createdAt: -1 });
activityLogSchema.index({ tenantId: 1, entityId: 1, createdAt: -1 });

module.exports = {
  Organization: mongoose.model('Organization', organizationSchema, 'organizations'),
  Tenant: mongoose.model('Tenant', tenantSchema, 'tenants'),
  User: mongoose.model('User', userSchema, 'users'),
  Membership: mongoose.model('Membership', membershipSchema, 'memberships'),
  Board: mongoose.model('Board', boardSchema, 'boards'),
  Column: mongoose.model('Column', columnSchema, 'columns'),
  Task: mongoose.model('Task', taskSchema, 'tasks'),
  ActivityLog: mongoose.model('ActivityLog', activityLogSchema, 'activity_logs'),
  ROLES,
  PRIORITIES,
  Types,
};
