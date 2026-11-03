/**
 * Task API — the heart of the collaboration features.
 *
 * Concurrency model (optimistic locking):
 *   Every task has a `version`. Clients send the version they last saw
 *   (`expectedVersion`). Writes use an atomic conditional update
 *     findOneAndUpdate({ _id, tenantId, version: expectedVersion }, { ..., $inc: { version: 1 } })
 *   so if someone else saved first, the filter matches nothing and we answer
 *   409 Conflict together with the current server copy. No silent overwrites.
 *
 * Every query is filtered by `tenantId: req.tenant._id` (tenant isolation), and
 * real-time events are emitted only AFTER the database write succeeded.
 */
const { Task, Column, ActivityLog } = require('../models');
const { findBoard } = require('./board.controller');
const { resolveTenantAccess, hasRole } = require('../services/access.service');
const { logActivity } = require('../services/activity.service');
const { emitToTenant } = require('../sockets/emitter');
const { positionBetween, STEP } = require('../utils/ordering');
const { z, objectId, parse, idParam } = require('../utils/validate');
const { asyncHandler, notFound, conflict, badRequest, forbidden } = require('../utils/errors');

const POPULATE = { path: 'assignedTo', select: 'name email' };
const SORT = { position: 1, _id: 1 };

const fields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(5000),
  assignedTo: objectId.nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  dueDate: z.coerce.date().nullable(),
  labels: z.array(z.string().trim().min(1).max(30)).max(10),
};

const createSchema = z.object({
  boardId: objectId,
  columnId: objectId,
  title: fields.title,
  description: fields.description.optional().default(''),
  assignedTo: fields.assignedTo.optional().default(null),
  priority: fields.priority.optional().default('medium'),
  dueDate: fields.dueDate.optional().default(null),
  labels: fields.labels.optional().default([]),
});

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: fields.title.optional(),
    description: fields.description.optional(),
    assignedTo: fields.assignedTo.optional(),
    priority: fields.priority.optional(),
    dueDate: fields.dueDate.optional(),
    labels: fields.labels.optional(),
  })
  .refine((d) => Object.keys(d).length > 1, { message: 'Nothing to update' });

const moveSchema = z.object({
  toColumnId: objectId,
  toIndex: z.number().int().min(0),
  expectedVersion: z.number().int().positive(),
});

// ── helpers ──────────────────────────────────────────────────────────────────
async function findTask(req, id = req.params.id) {
  idParam(id, 'Task');
  const task = await Task.findOne({ _id: id, tenantId: req.tenant._id }).populate(POPULATE);
  if (!task) throw notFound('Task not found (it may have been deleted)');
  return task;
}

async function assertAssignable(req, userId) {
  if (!userId) return;
  const access = await resolveTenantAccess(userId, req.tenant._id);
  if (!access) throw badRequest('Assignee is not a member of this tenant');
}

async function versionConflict(req, id) {
  const current = await Task.findOne({ _id: id, tenantId: req.tenant._id }).populate(POPULATE);
  if (!current) throw notFound('Task not found (it may have been deleted)');
  return conflict('This task was changed by someone else. Review the latest version and try again.', {
    code: 'VERSION_CONFLICT',
    current: current.toJSON(),
  });
}

/** Re-space all tasks of a column evenly. Returns the fresh sorted list. */
async function rebalanceColumn(tenantId, columnId) {
  const tasks = await Task.find({ tenantId, columnId }).sort(SORT).select('_id position');
  if (tasks.length) {
    await Task.bulkWrite(
      tasks.map((t, i) => ({ updateOne: { filter: { _id: t._id, tenantId }, update: { $set: { position: (i + 1) * STEP } } } }))
    );
  }
  return Task.find({ tenantId, columnId }).sort(SORT).select('_id position');
}

function emit(req, event, payload) {
  emitToTenant(req.tenant._id, event, payload, { originSocketId: req.socketId, by: { id: req.user._id.toString(), name: req.user.name } });
}

// ── handlers ─────────────────────────────────────────────────────────────────
exports.list = asyncHandler(async (req, res) => {
  const q = parse(
    z.object({ boardId: objectId.optional(), columnId: objectId.optional(), assignedTo: z.string().optional() }),
    req.query
  );
  const filter = { tenantId: req.tenant._id };
  if (q.boardId) filter.boardId = q.boardId;
  if (q.columnId) filter.columnId = q.columnId;
  if (q.assignedTo) filter.assignedTo = q.assignedTo === 'me' ? req.user._id : idParam(q.assignedTo, 'User');
  const tasks = await Task.find(filter).sort(SORT).populate(POPULATE).limit(500);
  res.json({ tasks: tasks.map((t) => t.toJSON()) });
});

exports.get = asyncHandler(async (req, res) => {
  const task = await findTask(req);
  const activity = await ActivityLog.find({ tenantId: req.tenant._id, entityId: task._id })
    .sort({ createdAt: -1 })
    .limit(30)
    .populate('userId', 'name');
  res.json({
    task: task.toJSON(),
    activity: activity.map((a) => {
      const j = a.toJSON();
      j.user = a.userId ? { id: a.userId._id.toString(), name: a.userId.name } : null;
      j.userId = j.user?.id;
      return j;
    }),
  });
});

exports.create = asyncHandler(async (req, res) => {
  const data = parse(createSchema, req.body);
  const board = await findBoard(req, data.boardId);
  const column = await Column.findOne({ _id: data.columnId, tenantId: req.tenant._id, boardId: board._id });
  if (!column) throw badRequest('Column does not belong to this board');
  await assertAssignable(req, data.assignedTo);

  const last = await Task.findOne({ tenantId: req.tenant._id, columnId: column._id }).sort({ position: -1 });
  const task = await Task.create({
    ...data,
    organizationId: req.tenant.organizationId,
    tenantId: req.tenant._id,
    position: (last?.position ?? 0) + STEP,
    version: 1,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await task.populate(POPULATE);

  emit(req, 'task:created', { task: task.toJSON() });
  await logActivity(req, {
    entityType: 'task',
    entityId: task._id,
    boardId: board._id,
    action: 'created',
    details: { title: task.title, column: column.name },
  });
  res.status(201).json({ task: task.toJSON() });
});

exports.update = asyncHandler(async (req, res) => {
  const { expectedVersion, ...changes } = parse(updateSchema, req.body);
  const before = await findTask(req);
  if (before.version !== expectedVersion) throw await versionConflict(req, before._id);
  if ('assignedTo' in changes) await assertAssignable(req, changes.assignedTo);

  // Atomic compare-and-set on version.
  const task = await Task.findOneAndUpdate(
    { _id: before._id, tenantId: req.tenant._id, version: expectedVersion },
    { $set: { ...changes, updatedBy: req.user._id }, $inc: { version: 1 } },
    { new: true, runValidators: true }
  ).populate(POPULATE);
  if (!task) throw await versionConflict(req, before._id);

  const changed = Object.keys(changes).filter(
    (k) => JSON.stringify(before.toJSON()[k] ?? null) !== JSON.stringify(task.toJSON()[k] ?? null)
  );
  emit(req, 'task:updated', { task: task.toJSON(), changed });
  await logActivity(req, {
    entityType: 'task',
    entityId: task._id,
    boardId: task.boardId,
    action: 'updated',
    details: {
      title: task.title,
      fields: changed,
      ...(changed.includes('assignedTo') && { assignee: task.assignedTo?.name || 'Unassigned' }),
    },
  });
  res.json({ task: task.toJSON() });
});

exports.move = asyncHandler(async (req, res) => {
  const { toColumnId, toIndex, expectedVersion } = parse(moveSchema, req.body);
  const task = await findTask(req);
  if (task.version !== expectedVersion) throw await versionConflict(req, task._id);

  const [fromColumn, toColumn] = await Promise.all([
    Column.findOne({ _id: task.columnId, tenantId: req.tenant._id }),
    Column.findOne({ _id: toColumnId, tenantId: req.tenant._id, boardId: task.boardId }),
  ]);
  if (!toColumn) throw badRequest('Destination column does not belong to this board');

  // Server-authoritative ordering: compute the position from the CURRENT state of
  // the destination column, not from whatever the client believes it looks like.
  let siblings = await Task.find({ tenantId: req.tenant._id, columnId: toColumn._id, _id: { $ne: task._id } })
    .sort(SORT)
    .select('_id position');
  const idx = Math.min(toIndex, siblings.length);
  let position = positionBetween(siblings[idx - 1]?.position, siblings[idx]?.position);
  let rebalanced = false;
  if (position === null) {
    siblings = (await rebalanceColumn(req.tenant._id, toColumn._id)).filter((t) => !t._id.equals(task._id));
    position = positionBetween(siblings[idx - 1]?.position, siblings[idx]?.position);
    rebalanced = true;
  }

  const moved = await Task.findOneAndUpdate(
    { _id: task._id, tenantId: req.tenant._id, version: expectedVersion },
    { $set: { columnId: toColumn._id, position, updatedBy: req.user._id }, $inc: { version: 1 } },
    { new: true }
  ).populate(POPULATE);
  if (!moved) throw await versionConflict(req, task._id);

  emit(req, 'task:moved', {
    task: moved.toJSON(),
    fromColumnId: task.columnId.toString(),
    toColumnId: toColumn._id.toString(),
  });
  if (rebalanced) emit(req, 'board:resync', { boardId: moved.boardId.toString(), reason: 'rebalance' });

  const sameColumn = task.columnId.equals(toColumn._id);
  await logActivity(req, {
    entityType: 'task',
    entityId: moved._id,
    boardId: moved.boardId,
    action: 'moved',
    details: { title: moved.title, from: fromColumn?.name, to: toColumn.name, reordered: sameColumn },
  });
  res.json({ task: moved.toJSON() });
});

exports.remove = asyncHandler(async (req, res) => {
  const task = await findTask(req);
  const isCreator = task.createdBy && task.createdBy.equals(req.user._id);
  if (!isCreator && !hasRole(req.role, 'tenant_admin')) {
    throw forbidden('Only the task creator or a tenant admin can delete this task');
  }
  // Optional optimistic check: ?expectedVersion=3 → refuse to delete a task that changed meanwhile.
  const expected = req.query.expectedVersion ? Number(req.query.expectedVersion) : null;
  const filter = { _id: task._id, tenantId: req.tenant._id };
  if (expected) filter.version = expected;
  const result = await Task.deleteOne(filter);
  if (!result.deletedCount) throw await versionConflict(req, task._id);

  emit(req, 'task:deleted', { taskId: task._id.toString(), boardId: task.boardId.toString(), columnId: task.columnId.toString() });
  await logActivity(req, {
    entityType: 'task',
    entityId: task._id,
    boardId: task.boardId,
    action: 'deleted',
    details: { title: task.title },
  });
  res.status(204).end();
});
