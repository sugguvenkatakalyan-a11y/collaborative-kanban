/**
 * End-to-end checks for tenant isolation, RBAC, optimistic locking and
 * tenant-scoped WebSocket rooms.
 *
 * Prerequisites: MongoDB running, `npm run seed`, and the API running (`npm run dev`).
 * Usage:        npm run test:isolation   (API_URL defaults to http://localhost:5000)
 */
const { io } = require('socket.io-client');

const API = process.env.API_URL || 'http://localhost:5000';
const PASSWORD = 'Password@123';
let passed = 0;
let failed = 0;

function check(name, condition, info = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${name} ${info}`);
  }
}

async function call(method, path, { token, tenant, body } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(tenant && { 'X-Tenant-Id': tenant }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function login(email) {
  const r = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`Login failed for ${email} — did you run "npm run seed"?`);
  return r.data.token;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const join = (socket, tenantId) => new Promise((r) => socket.emit('tenant:join', { tenantId }, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`\nRunning isolation & concurrency checks against ${API}\n`);
  const [rahul, priya, arjun, sneha, kiran] = await Promise.all(
    ['rahul@abc.example', 'priya@abc.example', 'arjun@abc.example', 'sneha@abc.example', 'kiran@xyz.example'].map(login)
  );

  const orgs = (await call('GET', '/organizations', { token: arjun })).data.organizations;
  const abc = orgs.find((o) => o.name === 'ABC Technologies');
  const allAbcTenants = (await call('GET', `/tenants?organizationId=${abc.id}`, { token: rahul })).data.tenants;
  const hyd = allAbcTenants.find((t) => t.name === 'Hyderabad').id;
  const blr = allAbcTenants.find((t) => t.name === 'Bangalore').id;

  console.log('Authentication');
  check('rejects requests without a token', (await call('GET', '/organizations')).status === 401);
  check('rejects a forged token', (await call('GET', '/organizations', { token: 'x.y.z' })).status === 401);
  check(
    'rejects wrong password',
    (await call('POST', '/auth/login', { body: { email: 'arjun@abc.example', password: 'nope' } })).status === 401
  );

  console.log('\nTenant isolation');
  const arjunTenants = (await call('GET', `/tenants?organizationId=${abc.id}`, { token: arjun })).data.tenants;
  check('member only sees own tenant', arjunTenants.length === 1 && arjunTenants[0].id === hyd);
  check('org_admin sees every tenant of the org', allAbcTenants.length === 3);

  const blrBoards = (await call('GET', '/boards', { token: sneha, tenant: blr })).data.boards;
  const blrBoard = (await call('GET', `/boards/${blrBoards[0].id}`, { token: sneha, tenant: blr })).data;
  const blrTask = blrBoard.tasks[0];

  check('Hyderabad user cannot switch X-Tenant-Id to Bangalore', (await call('GET', '/boards', { token: arjun, tenant: blr })).status === 403);
  check('Bangalore task id is not readable through the Hyderabad tenant', (await call('GET', `/tasks/${blrTask.id}`, { token: arjun, tenant: hyd })).status === 404);
  check(
    'Bangalore task cannot be modified through the Hyderabad tenant',
    (await call('PUT', `/tasks/${blrTask.id}`, { token: arjun, tenant: hyd, body: { title: 'hacked', expectedVersion: blrTask.version } })).status === 404
  );
  check(
    'cannot create a task on a Bangalore board from Hyderabad',
    (await call('POST', '/tasks', { token: arjun, tenant: hyd, body: { boardId: blrBoard.board.id, columnId: blrBoard.columns[0].id, title: 'x' } })).status === 404
  );
  check('cross-organisation: XYZ user cannot read ABC organisation', (await call('GET', `/organizations/${abc.id}`, { token: kiran })).status === 404);
  check('cross-organisation: XYZ user cannot use an ABC tenant', (await call('GET', '/boards', { token: kiran, tenant: hyd })).status === 403);
  check('org_admin can access any tenant of their org', (await call('GET', '/boards', { token: rahul, tenant: blr })).status === 200);

  console.log('\nRole-based access control');
  check('member cannot create a tenant', (await call('POST', '/tenants', { token: arjun, body: { organizationId: abc.id, name: 'Pune' } })).status === 403);
  check('member cannot create a board', (await call('POST', '/boards', { token: arjun, tenant: hyd, body: { name: 'x' } })).status === 403);
  check('tenant_admin cannot create a tenant', (await call('POST', '/tenants', { token: priya, body: { organizationId: abc.id, name: 'Pune' } })).status === 403);

  const created = await call('POST', '/boards', { token: priya, tenant: hyd, body: { name: 'RBAC test board' } });
  check('tenant_admin can create a board (with 4 default columns)', created.status === 201 && created.data.columns.length === 4);
  const testBoard = created.data.board;
  const cols = created.data.columns;

  console.log('\nOptimistic concurrency');
  const t = (await call('POST', '/tasks', { token: arjun, tenant: hyd, body: { boardId: testBoard.id, columnId: cols[0].id, title: 'Concurrency test' } })).data.task;
  check('member can create a task (version 1)', t && t.version === 1);

  const r1 = await call('PUT', `/tasks/${t.id}`, { token: priya, tenant: hyd, body: { title: 'Priya edit', expectedVersion: 1 } });
  const r2 = await call('PUT', `/tasks/${t.id}`, { token: arjun, tenant: hyd, body: { description: 'Arjun edit', expectedVersion: 1 } });
  check('first save wins and bumps version to 2', r1.status === 200 && r1.data.task.version === 2);
  check('stale save is rejected with 409 + current copy', r2.status === 409 && r2.data.current?.title === 'Priya edit');

  const [m1, m2] = await Promise.all([
    call('PATCH', `/tasks/${t.id}/move`, { token: priya, tenant: hyd, body: { toColumnId: cols[1].id, toIndex: 0, expectedVersion: 2 } }),
    call('PATCH', `/tasks/${t.id}/move`, { token: arjun, tenant: hyd, body: { toColumnId: cols[3].id, toIndex: 0, expectedVersion: 2 } }),
  ]);
  const statuses = [m1.status, m2.status].sort();
  check('simultaneous moves of the same task: exactly one wins, the other gets 409', statuses[0] === 200 && statuses[1] === 409, JSON.stringify(statuses));

  console.log('\nTenant-scoped WebSockets');
  const [sArjun, sPriya, sSneha] = await Promise.all([connect(arjun), connect(priya), connect(sneha)]);
  check('socket cannot join a tenant without membership', (await join(sArjun, blr)).ok === false);
  check('socket can join its own tenant', (await join(sArjun, hyd)).ok === true);
  await join(sPriya, hyd);
  await join(sSneha, blr);
  await wait(200);

  let arjunGot = null;
  let snehaGot = null;
  sArjun.on('task:updated', (e) => (arjunGot = e));
  sSneha.on('task:updated', (e) => (snehaGot = e));
  const latest = (await call('GET', `/tasks/${t.id}`, { token: priya, tenant: hyd })).data.task;
  await call('PUT', `/tasks/${t.id}`, { token: priya, tenant: hyd, body: { title: 'Live update', expectedVersion: latest.version } });
  await wait(400);
  check('Hyderabad user receives Hyderabad update in real time', arjunGot?.task?.title === 'Live update');
  check('Bangalore user does NOT receive Hyderabad update', snehaGot === null);

  const presence = await join(sPriya, hyd);
  check('presence lists both Hyderabad users', presence.users.length >= 2);

  let offline = null;
  sPriya.on('presence:offline', (e) => (offline = e));
  sArjun.disconnect();
  await wait(400);
  check('presence:offline fires when a user disconnects', offline?.user?.name === 'Arjun Kumar');

  [sPriya, sSneha].forEach((s) => s.disconnect());
  await call('DELETE', `/boards/${testBoard.id}`, { token: priya, tenant: hyd });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
