const { ActivityLog } = require('../models');
const { z, objectId, parse } = require('../utils/validate');
const { asyncHandler } = require('../utils/errors');

// GET /api/activity?boardId=&limit=  (always scoped to the authorised tenant)
exports.list = asyncHandler(async (req, res) => {
  const q = parse(
    z.object({ boardId: objectId.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    req.query
  );
  const filter = { tenantId: req.tenant._id };
  if (q.boardId) filter.boardId = q.boardId;
  const logs = await ActivityLog.find(filter).sort({ createdAt: -1 }).limit(q.limit).populate('userId', 'name');
  res.json({
    activity: logs.map((a) => {
      const j = a.toJSON();
      j.user = a.userId ? { id: a.userId._id.toString(), name: a.userId.name } : null;
      j.userId = j.user?.id;
      return j;
    }),
  });
});
