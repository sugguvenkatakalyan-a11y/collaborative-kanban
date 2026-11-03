const { Column, Task } = require('../models');
const { findBoard } = require('./board.controller');
const { logActivity } = require('../services/activity.service');
const { emitToTenant } = require('../sockets/emitter');
const { z, objectId, parse, idParam } = require('../utils/validate');
const { asyncHandler, notFound, conflict } = require('../utils/errors');

async function findColumn(req) {
  idParam(req.params.id, 'Column');
  const column = await Column.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!column) throw notFound('Column not found');
  return column;
}

exports.listForBoard = asyncHandler(async (req, res) => {
  const board = await findBoard(req, req.params.boardId);
  const columns = await Column.find({ tenantId: req.tenant._id, boardId: board._id }).sort({ position: 1 });
  res.json({ columns: columns.map((c) => c.toJSON()) });
});

exports.create = asyncHandler(async (req, res) => {
  const { boardId, name } = parse(z.object({ boardId: objectId, name: z.string().trim().min(1).max(60) }), req.body);
  const board = await findBoard(req, boardId); // board must belong to this tenant
  const last = await Column.findOne({ tenantId: req.tenant._id, boardId: board._id }).sort({ position: -1 });
  const column = await Column.create({
    name,
    boardId: board._id,
    tenantId: req.tenant._id,
    organizationId: req.tenant.organizationId,
    position: (last?.position || 0) + 1024,
  });
  emitToTenant(req.tenant._id, 'column:created', { column: column.toJSON() }, { originSocketId: req.socketId });
  await logActivity(req, { entityType: 'column', entityId: column._id, boardId: board._id, action: 'created', details: { name } });
  res.status(201).json({ column: column.toJSON() });
});

exports.update = asyncHandler(async (req, res) => {
  const column = await findColumn(req);
  const data = parse(
    z.object({ name: z.string().trim().min(1).max(60).optional(), position: z.number().finite().optional() }),
    req.body
  );
  Object.assign(column, data);
  await column.save();
  emitToTenant(req.tenant._id, 'column:updated', { column: column.toJSON() }, { originSocketId: req.socketId });
  await logActivity(req, { entityType: 'column', entityId: column._id, boardId: column.boardId, action: 'updated', details: data });
  res.json({ column: column.toJSON() });
});

exports.remove = asyncHandler(async (req, res) => {
  const column = await findColumn(req);
  if (await Task.exists({ tenantId: req.tenant._id, columnId: column._id })) {
    throw conflict('Column still contains tasks — move or delete them first');
  }
  await column.deleteOne();
  emitToTenant(
    req.tenant._id,
    'column:deleted',
    { columnId: column._id.toString(), boardId: column.boardId.toString() },
    { originSocketId: req.socketId }
  );
  await logActivity(req, { entityType: 'column', entityId: column._id, boardId: column.boardId, action: 'deleted', details: { name: column.name } });
  res.status(204).end();
});
