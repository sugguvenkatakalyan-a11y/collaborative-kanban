import { useEffect, useState } from 'react';
import api from '../services/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { Avatar } from './Avatar';
import { describeActivity, relativeTime } from '../utils/board';

/** Live activity feed for a board (or the whole tenant when boardId is omitted). */
export default function ActivityPanel({ boardId, limit = 40 }) {
  const { socket, tenantId, syncKey } = useWorkspace();
  const [items, setItems] = useState([]);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    api
      .get('/activity', { params: { boardId, limit } })
      .then((r) => setItems(r.data.activity))
      .catch(() => setItems([]));
  }, [boardId, tenantId, limit, syncKey]);

  useEffect(() => {
    if (!socket) return;
    const onActivity = ({ activity }) => {
      if (boardId && activity.boardId !== boardId) return;
      setItems((list) => [activity, ...list.filter((a) => a.id !== activity.id)].slice(0, limit));
    };
    socket.on('activity:created', onActivity);
    return () => socket.off('activity:created', onActivity);
  }, [socket, boardId, limit]);

  // keep "2m ago" labels fresh
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <ul className="activity-list">
      {items.map((a) => (
        <li key={a.id} className="fade-in">
          <Avatar id={a.user?.id} name={a.user?.name} size={22} />
          <div>
            <strong>{a.user?.name}</strong> {describeActivity(a)}
            <div className="muted small">{relativeTime(a.createdAt)}</div>
          </div>
        </li>
      ))}
      {!items.length && <li className="muted small">No activity yet.</li>}
    </ul>
  );
}
