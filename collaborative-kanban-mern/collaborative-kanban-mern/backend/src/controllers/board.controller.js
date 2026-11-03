const { Board, Column, Task, ActivityLog } = require('../models');
const { logActivity } = require('../services/activity.service');
const { deleteBoardCascade } = require('../services/cascade.service');
const { emitToTenant } = require('../sockets/emitter');
const { z, parse, idParam } = require('../utils/validate');
const { asyncHandler, notFound } = require('../utils/errors');

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Testing', 'Done'];

const boardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
});

/** Every lookup is scoped by BOTH id and the authorised tenant. */
async function findBoard(req, id = req.params.id) {
  idParam(id, 'Board');
  const board = await Board.findOne({ _id: id, tenantId: req.tenant._id });
  if (!board) throw notFound('Board not found');
  return board;
}

exports.findBoard = findBoard;

exports.create = asyncHandler(async (req, res) => {
  const data = parse(boardSchema, req.body);
  const board = await Board.create({
    ...data,
    organizationId: req.tenant.organizationId,
    tenantId: req.tenant._id, // ← from the verified tenant, never from the body
    createdBy: req.user._id,
  });
  const columns = await Column.insertMany(
    DEFAULT_COLUMNS.map((name, i) => ({
      name,
      position: (i + 1) * 1024,
      boardId: board._id,
      tenantId: req.tenant._id,
      organizationId: req.tenant.organizationId,
    }))
  );
  const payload = { board: board.toJSON(), columns: columns.map((c) => c.toJSON()) };
  emitToTenant(req.tenant._id, 'board:created', payload, { originSocketId: req.socketId });
  await logActivity(req, { entityType: 'board', entityId: board._id, boardId: board._id, action: 'created', details: { name: board.name } });
  res.status(201).json(payload);
});

exports.list = asyncHandler(async (req, res) => {
  const boards = await Board.find({ tenantId: req.tenant._id }).sort({ createdAt: 1 }).lean();
  const counts = await Task.aggregate([
    { $match: { tenantId: req.tenant._id } },
    { $group: { _id: '$boardId', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));
  res.json({
    boards: boards.map((b) => ({
      id: b._id.toString(),
      name: b.name,
      description: b.description,
      createdAt: b.createdAt,
      taskCount: countMap[b._id.toString()] || 0,
    })),
  });
});

// Full board snapshot: board + columns + tasks (used on load AND after reconnect).
exports.get = asyncHandler(async (req, res) => {
  const board = await findBoard(req);
  const [columns, tasks] = await Promise.all([
    Column.find({ tenantId: req.tenant._id, boardId: board._id }).sort({ position: 1 }),
    Task.find({ tenantId: req.tenant._id, boardId: board._id })
      .sort({ position: 1 })
      .populate('assignedTo', 'name email'),
  ]);
  res.json({
    board: board.toJSON(),
    columns: columns.map((c) => c.toJSON()),
    tasks: tasks.map((t) => t.toJSON()),
    role: req.role,
  });
});

exports.update = asyncHandler(async (req, res) => {
  const board = await findBoard(req);
  const data = parse(boardSchema.partial(), req.body);
  Object.assign(board, data);
  await board.save();
  emitToTenant(req.tenant._id, 'board:updated', { board: board.toJSON() }, { originSocketId: req.socketId });
  await logActivity(req, { entityType: 'board', entityId: board._id, boardId: board._id, action: 'updated', details: data });
  res.json({ board: board.toJSON() });
});

exports.remove = asyncHandler(async (req, res) => {
  const board = await findBoard(req);
  await deleteBoardCascade(req.tenant._id, board._id);
  emitToTenant(req.tenant._id, 'board:deleted', { boardId: board._id.toString() }, { originSocketId: req.socketId });
  await logActivity(req, { entityType: 'board', entityId: board._id, action: 'deleted', details: { name: board.name } });
  res.status(204).end();
});

// Lightweight board insights (counts, overdue, completion rate).
exports.summary = asyncHandler(async (req, res) => {
  const board = await findBoard(req);
  const [columns, tasks] = await Promise.all([
    Column.find({ tenantId: req.tenant._id, boardId: board._id }).sort({ position: 1 }).lean(),
    Task.find({ tenantId: req.tenant._id, boardId: board._id }).lean(),
  ]);
  const doneCol = columns[columns.length - 1];
  const now = new Date();
  const byColumn = columns.map((c) => ({
    column: c.name,
    count: tasks.filter((t) => t.columnId.equals(c._id)).length,
  }));
  const done = doneCol ? tasks.filter((t) => t.columnId.equals(doneCol._id)).length : 0;
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < now && (!doneCol || !t.columnId.equals(doneCol._id)));
  res.json({
    board: board.name,
    total: tasks.length,
    byColumn,
    completed: done,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    overdue: overdue.map((t) => ({ id: t._id.toString(), title: t.title, dueDate: t.dueDate })),
    recentActivity: await ActivityLog.countDocuments({
      tenantId: req.tenant._id,
      boardId: board._id,
      createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
    }),
  });
});
