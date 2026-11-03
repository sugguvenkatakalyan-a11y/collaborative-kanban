import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../services/api';
import { can, useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import MembersPanel from '../components/MembersPanel';
import ActivityPanel from '../components/ActivityPanel';

export default function Dashboard() {
  const { org, tenant, tenantId, role, socket, loading, createOrganization, createTenant, orgs, syncKey } = useWorkspace();
  const toast = useToast();
  const [boards, setBoards] = useState([]);
  const [boardName, setBoardName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [orgName, setOrgName] = useState('');

  const loadBoards = () =>
    api
      .get('/boards')
      .then((r) => setBoards(r.data.boards))
      .catch((e) => toast(errorMessage(e), 'error'));

  useEffect(() => {
    setBoards([]); // clear previous tenant's boards immediately
    if (tenantId) loadBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, syncKey]);

  // Boards created/deleted elsewhere appear live.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => loadBoards();
    ['board:created', 'board:updated', 'board:deleted', 'task:created', 'task:deleted'].forEach((e) => socket.on(e, refresh));
    return () =>
      ['board:created', 'board:updated', 'board:deleted', 'task:created', 'task:deleted'].forEach((e) =>
        socket.off(e, refresh)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, tenantId]);

  const run = (fn, msg) => async (e) => {
    e.preventDefault();
    try {
      await fn();
      if (msg) toast(msg, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  if (loading) return <div className="page-center muted">Loading workspace…</div>;

  if (!orgs.length) {
    return (
      <div className="page narrow">
        <div className="panel">
          <h2>Welcome! You are not part of any organization yet.</h2>
          <p className="muted">Ask an admin to add you to a branch, or create your own organization.</p>
          <form className="inline-form" onSubmit={run(() => createOrganization(orgName), 'Organization created')}>
            <input placeholder="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            <button className="btn">Create organization</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{org?.name}</div>
          <h1>{tenant ? `${tenant.name} branch` : 'No branch selected'}</h1>
        </div>
      </div>

      {!tenant && (
        <div className="panel">
          <p className="muted">You don't have access to any branch of this organization yet.</p>
        </div>
      )}

      {tenant && (
        <div className="dash-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Boards</h2>
            </div>
            <div className="board-grid">
              {boards.map((b) => (
                <Link key={b.id} to={`/boards/${b.id}`} className="board-tile">
                  <strong>{b.name}</strong>
                  <span className="muted small">{b.description}</span>
                  <span className="tile-foot small">{b.taskCount} tasks →</span>
                </Link>
              ))}
              {!boards.length && <p className="muted">No boards yet.</p>}
            </div>
            {can(role, 'tenant_admin') && (
              <form
                className="inline-form"
                onSubmit={run(async () => {
                  await api.post('/boards', { name: boardName });
                  setBoardName('');
                  loadBoards();
                }, 'Board created with default columns')}
              >
                <input placeholder="New board name" value={boardName} onChange={(e) => setBoardName(e.target.value)} required />
                <button className="btn">Create board</button>
              </form>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Members</h2>
            </div>
            <MembersPanel />
          </section>

          <section className="panel span-2">
            <div className="panel-head">
              <h2>Recent activity in {tenant.name}</h2>
            </div>
            <ActivityPanel limit={15} />
          </section>
        </div>
      )}

      <section className="panel admin-panel">
        <h2>Administration</h2>
        <div className="grid-2">
          {role === 'org_admin' || org?.role === 'org_admin' ? (
            <form
              className="inline-form"
              onSubmit={run(async () => {
                await createTenant(tenantName);
                setTenantName('');
              }, 'Branch created')}
            >
              <input placeholder={`New branch for ${org?.name}`} value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
              <button className="btn">Add branch</button>
            </form>
          ) : (
            <p className="muted small">Only organization admins can add branches.</p>
          )}
          <form
            className="inline-form"
            onSubmit={run(async () => {
              await createOrganization(orgName);
              setOrgName('');
            }, 'Organization created')}
          >
            <input placeholder="New organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            <button className="btn-ghost">Create organization</button>
          </form>
        </div>
      </section>
    </div>
  );
}
