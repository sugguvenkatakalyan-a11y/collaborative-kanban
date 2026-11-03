/**
 * Workspace = selected organisation + tenant + the live socket connection.
 *
 * - Organisation and tenant lists come from the API (only what the user may access).
 * - Switching tenant clears the previous tenant's data and re-joins the matching
 *   Socket.IO room; the server re-checks membership before admitting the socket.
 * - After any reconnect, `syncKey` increments so open boards refetch the
 *   authoritative state (events missed while offline are never assumed delivered).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { errorMessage, setActiveTenant } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const WorkspaceContext = createContext(null);
const LS_ORG = 'kanban.org';
const LS_TENANT = 'kanban.tenant';

export function WorkspaceProvider({ children }) {
  const { token, user } = useAuth();
  const toast = useToast();

  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState(null);
  const [loading, setLoading] = useState(true);

  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('offline'); // connecting | online | reconnecting | offline
  const [presence, setPresence] = useState([]);
  const [syncKey, setSyncKey] = useState(0);

  const tenantRef = useRef(null);
  const disconnectedRef = useRef(false);

  // ── organisations ──
  const loadOrgs = useCallback(async (preferId) => {
    const { data } = await api.get('/organizations');
    setOrgs(data.organizations);
    const stored = preferId || localStorage.getItem(LS_ORG);
    const next = data.organizations.find((o) => o.id === stored) || data.organizations[0] || null;
    setOrgId(next?.id || null);
    if (!next) setLoading(false);
    return data.organizations;
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadOrgs().catch((e) => toast(errorMessage(e), 'error'));
  }, [user, loadOrgs, toast]);

  // ── tenants of the selected organisation ──
  const selectTenant = useCallback((id) => {
    setActiveTenant(id); // set synchronously so child fetches carry the new header
    tenantRef.current = id;
    setPresence([]);
    setTenantId(id);
    if (id) localStorage.setItem(LS_TENANT, id);
  }, []);

  const loadTenants = useCallback(
    async (preferId) => {
      if (!orgId) return;
      const { data } = await api.get('/tenants', { params: { organizationId: orgId } });
      setTenants(data.tenants);
      const stored = preferId || localStorage.getItem(LS_TENANT);
      const next = data.tenants.find((t) => t.id === stored) || data.tenants[0] || null;
      selectTenant(next?.id || null);
      setLoading(false);
    },
    [orgId, selectTenant]
  );

  useEffect(() => {
    if (!orgId) return;
    localStorage.setItem(LS_ORG, orgId);
    selectTenant(null); // never show the previous organisation's data while switching
    setTenants([]);
    loadTenants().catch((e) => toast(errorMessage(e), 'error'));
  }, [orgId, loadTenants, selectTenant, toast]);

  // ── socket lifecycle ──
  const joinTenant = useCallback((s, id) => {
    if (!s || !s.connected) return;
    if (!id) {
      s.emit('tenant:leave', {}, () => {});
      return;
    }
    s.emit('tenant:join', { tenantId: id }, (ack) => {
      if (tenantRef.current !== id) return; // user switched again meanwhile
      if (!ack?.ok) {
        setStatus('offline');
        return;
      }
      setPresence(ack.users || []);
      setStatus('online');
      if (disconnectedRef.current) {
        disconnectedRef.current = false;
        setSyncKey((k) => k + 1); // resync board state after a reconnect
      }
    });
  }, []);

  useEffect(() => {
    if (!token) {
      disconnectSocket();
      setSocket(null);
      setStatus('offline');
      return;
    }
    const s = connectSocket(token);
    setSocket(s);
    setStatus('connecting');

    s.on('connect', () => joinTenant(s, tenantRef.current));
    s.on('disconnect', (reason) => {
      disconnectedRef.current = true;
      setStatus(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
    });
    s.on('connect_error', () => {
      disconnectedRef.current = true;
      setStatus('reconnecting');
    });
    s.on('presence:update', (e) => {
      if (e.tenantId === tenantRef.current) setPresence(e.users);
    });
    s.on('tenant:access-revoked', (e) => {
      if (e.tenantId === tenantRef.current) {
        toast('Your access to this branch was removed.', 'error');
        loadTenants().catch(() => {});
      }
    });
    return () => disconnectSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Re-join whenever the tenant changes.
  useEffect(() => {
    joinTenant(socket, tenantId);
  }, [socket, tenantId, joinTenant]);

  // ── mutations used by the dashboard ──
  const createOrganization = async (name) => {
    const { data } = await api.post('/organizations', { name });
    await loadOrgs(data.organization.id);
    setOrgId(data.organization.id);
  };

  const createTenant = async (name) => {
    const { data } = await api.post('/tenants', { organizationId: orgId, name });
    await loadTenants(data.tenant.id);
  };

  const org = orgs.find((o) => o.id === orgId) || null;
  const tenant = tenants.find((t) => t.id === tenantId) || null;

  const value = useMemo(
    () => ({
      orgs,
      org,
      orgId,
      setOrgId,
      tenants,
      tenant,
      tenantId,
      selectTenant,
      role: tenant?.role || null,
      loading,
      socket,
      status,
      presence,
      syncKey,
      createOrganization,
      createTenant,
      reloadTenants: loadTenants,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgs, org, orgId, tenants, tenant, tenantId, loading, socket, status, presence, syncKey]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceContext);

export const ROLE_LABEL = { org_admin: 'Org Admin', tenant_admin: 'Tenant Admin', member: 'Member' };
const RANK = { member: 1, tenant_admin: 2, org_admin: 3 };
export const can = (role, min) => (RANK[role] || 0) >= RANK[min];
