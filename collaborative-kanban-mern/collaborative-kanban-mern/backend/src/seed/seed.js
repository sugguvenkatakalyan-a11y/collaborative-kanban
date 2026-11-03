/**
 * Demo data: 2 organisations, 5 tenants, 7 users, 7 boards, ~30 tasks.
 * Run with:  npm run seed      (WARNING: wipes the configured database first)
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const env = require('../config/env');
const connectDB = require('../config/db');
const { Organization, Tenant, User, Membership, Board, Column, Task, ActivityLog } = require('../models');

const PASSWORD = 'Password@123';
const COLUMNS = ['To Do', 'In Progress', 'Testing', 'Done'];
const day = (n) => new Date(Date.now() + n * 24 * 3600 * 1000);

async function seed() {
  await connectDB(env.mongoUri);
  await Promise.all(
    [Organization, Tenant, User, Membership, Board, Column, Task, ActivityLog].map((m) => m.deleteMany({}))
  );

  // ── Users ──
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const people = {
    rahul: 'Rahul Sharma',
    priya: 'Priya Reddy',
    arjun: 'Arjun Kumar',
    sneha: 'Sneha Iyer',
    meera: 'Meera Nair',
    vikram: 'Vikram Patel',
    kiran: 'Kiran Desai',
  };
  const users = {};
  for (const [key, name] of Object.entries(people)) {
    const domain = ['vikram', 'kiran'].includes(key) ? 'xyz.example' : 'abc.example';
    users[key] = await User.create({ name, email: `${key}@${domain}`, passwordHash });
  }

  // ── Organisations & tenants ──
  const abc = await Organization.create({ name: 'ABC Technologies', createdBy: users.rahul._id });
  const xyz = await Organization.create({ name: 'XYZ Solutions', createdBy: users.vikram._id });
  const t = {};
  for (const name of ['Hyderabad', 'Bangalore', 'Chennai']) t[name] = await Tenant.create({ organizationId: abc._id, name });
  for (const name of ['Mumbai', 'Pune']) t[name] = await Tenant.create({ organizationId: xyz._id, name });

  // ── Memberships (RBAC) ──
  const m = (user, org, tenant, role) =>
    Membership.create({ userId: users[user]._id, organizationId: org._id, tenantId: tenant ? t[tenant]._id : null, role });
  await m('rahul', abc, null, 'org_admin');
  await m('priya', abc, 'Hyderabad', 'tenant_admin');
  await m('arjun', abc, 'Hyderabad', 'member');
  await m('sneha', abc, 'Bangalore', 'tenant_admin');
  await m('meera', abc, 'Bangalore', 'member');
  await m('meera', abc, 'Chennai', 'member'); // one user, two tenants
  await m('vikram', xyz, null, 'org_admin');
  await m('kiran', xyz, 'Mumbai', 'member');

  // ── Boards, columns, tasks ──
  const plan = {
    Hyderabad: {
      'Website Development': [
        ['Create Login Page', 'To Do', 'rahul', 'high', 3, ['frontend']],
        ['Fix API Validation', 'To Do', 'arjun', 'medium', 5, ['backend']],
        ['Design Dashboard Wireframes', 'To Do', 'priya', 'low', 8, ['design']],
        ['Develop Registration API', 'In Progress', 'arjun', 'high', 2, ['backend']],
        ['Set up CI pipeline', 'In Progress', 'priya', 'medium', 4, ['devops']],
        ['Test Authentication Flow', 'Testing', 'priya', 'urgent', -1, ['qa']],
        ['Deploy Dashboard', 'Done', 'rahul', 'medium', -3, ['devops']],
        ['Write API documentation', 'Done', 'arjun', 'low', -5, ['docs']],
      ],
      'Mobile Application Development': [
        ['Push notification service', 'To Do', 'arjun', 'high', 6, ['mobile']],
        ['Offline sync prototype', 'In Progress', 'priya', 'urgent', 1, ['mobile']],
        ['App store screenshots', 'Testing', null, 'low', 10, ['marketing']],
        ['Splash screen', 'Done', 'arjun', 'low', -2, ['mobile']],
      ],
    },
    Bangalore: {
      'CRM Development': [
        ['Lead import from CSV', 'To Do', 'meera', 'medium', 4, ['backend']],
        ['Customer timeline view', 'In Progress', 'sneha', 'high', 2, ['frontend']],
        ['Email integration', 'Testing', 'meera', 'medium', -1, ['integration']],
        ['Contact deduplication', 'Done', 'sneha', 'high', -4, ['data']],
      ],
      'AI Automation': [
        ['Ticket classification model', 'To Do', 'sneha', 'high', 7, ['ml']],
        ['Prompt evaluation harness', 'In Progress', 'meera', 'medium', 3, ['ml']],
        ['Summarise weekly reports', 'Done', 'meera', 'low', -6, ['ml']],
      ],
    },
    Chennai: {
      'Infrastructure Upgrade': [
        ['Migrate to managed database', 'To Do', 'meera', 'urgent', 2, ['infra']],
        ['Upgrade Node.js runtime', 'In Progress', 'meera', 'medium', 5, ['infra']],
      ],
    },
    Mumbai: {
      'Customer Support Platform': [
        ['Live chat widget', 'To Do', 'kiran', 'high', 4, ['frontend']],
        ['SLA reporting', 'In Progress', 'kiran', 'medium', 6, ['reporting']],
        ['Knowledge base search', 'Testing', 'vikram', 'medium', 1, ['search']],
        ['Agent roster', 'Done', 'kiran', 'low', -2, ['admin']],
      ],
    },
    Pune: {
      'Data Migration': [
        ['Map legacy schema', 'To Do', 'vikram', 'high', 9, ['data']],
        ['Dry-run migration', 'In Progress', 'vikram', 'urgent', 3, ['data']],
      ],
    },
  };

  let taskCount = 0;
  for (const [tenantName, boards] of Object.entries(plan)) {
    const tenant = t[tenantName];
    const creator = tenant.organizationId.equals(abc._id) ? users.rahul : users.vikram;
    for (const [boardName, tasks] of Object.entries(boards)) {
      const board = await Board.create({
        organizationId: tenant.organizationId,
        tenantId: tenant._id,
        name: boardName,
        description: `${boardName} — ${tenantName} team`,
        createdBy: creator._id,
      });
      const cols = {};
      for (const [i, name] of COLUMNS.entries()) {
        cols[name] = await Column.create({
          organizationId: tenant.organizationId,
          tenantId: tenant._id,
          boardId: board._id,
          name,
          position: (i + 1) * 1024,
        });
      }
      const posInCol = {};
      for (const [title, colName, assignee, priority, due, labels] of tasks) {
        posInCol[colName] = (posInCol[colName] || 0) + 1024;
        const task = await Task.create({
          organizationId: tenant.organizationId,
          tenantId: tenant._id,
          boardId: board._id,
          columnId: cols[colName]._id,
          title,
          description: `Details for "${title}".`,
          assignedTo: assignee ? users[assignee]._id : null,
          priority,
          dueDate: day(due),
          labels,
          position: posInCol[colName],
          version: 1,
          createdBy: creator._id,
          updatedBy: creator._id,
        });
        await ActivityLog.create({
          organizationId: tenant.organizationId,
          tenantId: tenant._id,
          boardId: board._id,
          userId: creator._id,
          entityType: 'task',
          entityId: task._id,
          action: 'created',
          details: { title, column: colName },
        });
        taskCount += 1;
      }
    }
  }

  console.log(`\nSeeded ${Object.keys(users).length} users, 2 organizations, ${Object.keys(t).length} tenants, ${taskCount} tasks.`);
  console.log(`All demo accounts use the password: ${PASSWORD}\n`);
  console.table([
    { email: 'rahul@abc.example', role: 'org_admin', scope: 'ABC Technologies (all tenants)' },
    { email: 'priya@abc.example', role: 'tenant_admin', scope: 'ABC / Hyderabad' },
    { email: 'arjun@abc.example', role: 'member', scope: 'ABC / Hyderabad' },
    { email: 'sneha@abc.example', role: 'tenant_admin', scope: 'ABC / Bangalore' },
    { email: 'meera@abc.example', role: 'member', scope: 'ABC / Bangalore + Chennai' },
    { email: 'vikram@xyz.example', role: 'org_admin', scope: 'XYZ Solutions (all tenants)' },
    { email: 'kiran@xyz.example', role: 'member', scope: 'XYZ / Mumbai' },
  ]);
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
