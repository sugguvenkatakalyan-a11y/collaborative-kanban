const { Tenant, Membership, Board, Column, Task, ActivityLog } = require('../models');

async function deleteBoardCascade(tenantId, boardId) {
  await Promise.all([
    Task.deleteMany({ tenantId, boardId }),
    Column.deleteMany({ tenantId, boardId }),
    ActivityLog.deleteMany({ tenantId, boardId }),
  ]);
  await Board.deleteOne({ _id: boardId, tenantId });
}

async function deleteTenantCascade(tenantId) {
  await Promise.all([
    Task.deleteMany({ tenantId }),
    Column.deleteMany({ tenantId }),
    Board.deleteMany({ tenantId }),
    ActivityLog.deleteMany({ tenantId }),
    Membership.deleteMany({ tenantId }),
  ]);
  await Tenant.deleteOne({ _id: tenantId });
}

async function deleteOrganizationCascade(organizationId, OrganizationModel) {
  const tenants = await Tenant.find({ organizationId }).select('_id').lean();
  for (const t of tenants) await deleteTenantCascade(t._id);
  await Membership.deleteMany({ organizationId });
  await OrganizationModel.deleteOne({ _id: organizationId });
}

module.exports = { deleteBoardCascade, deleteTenantCascade, deleteOrganizationCascade };
