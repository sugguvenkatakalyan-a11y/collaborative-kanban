import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABEL, useWorkspace } from '../context/WorkspaceContext';
import { Avatar, PresenceAvatars } from './Avatar';

const STATUS_TEXT = {
  online: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const { orgs, orgId, setOrgId, tenants, tenantId, selectTenant, role, status, presence } = useWorkspace();
  const navigate = useNavigate();

  const switchTenant = (id) => {
    selectTenant(id);
    navigate('/'); // never keep showing a board from the previous tenant
  };

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        TeamBoard
      </Link>

      <div className="switchers">
        <label className="switcher">
          <span>Organization</span>
          <select
            value={orgId || ''}
            onChange={(e) => {
              setOrgId(e.target.value);
              navigate('/');
            }}
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <span className="crumb-sep">/</span>
        <label className="switcher">
          <span>Branch</span>
          <select value={tenantId || ''} onChange={(e) => switchTenant(e.target.value)} disabled={!tenants.length}>
            {!tenants.length && <option value="">No branches</option>}
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {role && <span className={`role-pill role-${role}`}>{ROLE_LABEL[role]}</span>}
      </div>

      <div className="nav-right">
        {tenantId && <PresenceAvatars users={presence} label="Online in this branch" />}
        <span className={`conn conn-${status}`} title="Real-time connection">
          <i />
          {STATUS_TEXT[status]}
        </span>
        <div className="user-chip">
          <Avatar id={user?.id} name={user?.name} size={28} />
          <span className="user-name">{user?.name}</span>
          <button className="btn-ghost small" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
