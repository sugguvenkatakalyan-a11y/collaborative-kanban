import { useEffect, useState } from 'react';
import api, { errorMessage } from '../services/api';
import { ROLE_LABEL, can, useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from './Avatar';

/** Tenant members & roles. Tenant admins (and org admins) can add, re-role and remove. */
export default function MembersPanel() {
  const { tenantId, role, presence } = useWorkspace();
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState('member');
  const manage = can(role, 'tenant_admin');

  const load = () =>
    api
      .get(`/tenants/${tenantId}/members`)
      .then((r) => setMembers(r.data.members))
      .catch(() => setMembers([]));

  useEffect(() => {
    if (tenantId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/tenants/${tenantId}/members`, { email, role: newRole });
      setEmail('');
      toast('Member added', 'success');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const changeRole = async (m, r) => {
    try {
      await api.patch(`/memberships/${m.membershipId}`, { role: r });
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (m) => {
    if (!confirm(`Remove ${m.user.name} from this branch?`)) return;
    try {
      await api.delete(`/memberships/${m.membershipId}`);
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const onlineIds = new Set(presence.map((p) => p.userId));

  return (
    <div>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.user.id}>
            <Avatar id={m.user.id} name={m.user.name} online={onlineIds.has(m.user.id)} />
            <div className="member-info">
              <strong>{m.user.name}</strong>
              <span className="muted small">{m.user.email}</span>
            </div>
            {manage && !m.inherited ? (
              <>
                <select value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                  <option value="member">Member</option>
                  <option value="tenant_admin">Tenant Admin</option>
                </select>
                <button className="icon-btn" title="Remove" onClick={() => remove(m)}>
                  ×
                </button>
              </>
            ) : (
              <span className={`role-pill role-${m.role}`}>{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <form className="inline-form" onSubmit={add}>
          <input
            type="email"
            placeholder="colleague@company.com (must be registered)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="tenant_admin">Tenant Admin</option>
          </select>
          <button className="btn small">Add</button>
        </form>
      )}
    </div>
  );
}
