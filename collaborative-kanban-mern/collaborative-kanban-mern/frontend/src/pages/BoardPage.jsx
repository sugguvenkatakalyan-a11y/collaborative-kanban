import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { errorMessage } from '../services/api';
import { useBoard } from '../hooks/useBoard';
import { can, useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import KanbanBoard from '../components/KanbanBoard';
import TaskModal from '../components/TaskModal';
import ActivityPanel from '../components/ActivityPanel';
import { PresenceAvatars } from '../components/Avatar';

export default function BoardPage() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantId, role, presence, status } = useWorkspace();
  const toast = useToast();
  const board = useBoard(boardId);
  const [openId, setOpenId] = useState(null);
  const [members, setMembers] = useState([]);
  const [showActivity, setShowActivity] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    api
      .get(`/tenants/${tenantId}/members`)
      .then((r) => setMembers(r.data.members))
      .catch(() => {});
  }, [tenantId]);

  useEffect(() => {
    if (board.deleted) {
      toast('This board was deleted.', 'warn');
      navigate('/');
    }
  }, [board.deleted, navigate, toast]);

  // Close the panel if the open task disappears (deleted by someone else).
  useEffect(() => {
    if (openId && !board.loading && !board.tasks[openId]) {
      setOpenId(null);
      toast('That task was deleted by someone else.', 'warn');
    }
  }, [openId, board.tasks, board.loading, toast]);

  const viewers = presence.filter((p) => p.boardIds.includes(boardId));
  const tasks = Object.values(board.tasks);
  const doneCol = board.columns[board.columns.length - 1];
  const done = doneCol ? tasks.filter((t) => t.columnId === doneCol.id).length : 0;
  const manage = can(role, 'tenant_admin');

  // Client-side filter (search + "mine") applied without touching the real state.
  const view = useMemo(() => {
    if (!filter) return board;
    const q = filter.toLowerCase();
    const keep = Object.fromEntries(
      Object.entries(board.tasks).filter(([, t]) =>
        q === '@me' ? t.assignedTo?.id === user.id : `${t.title} ${t.description} ${t.labels?.join(' ')}`.toLowerCase().includes(q)
      )
    );
    return { ...board, tasks: keep, allTasks: board.tasks };
  }, [board, filter, user]);

  const safe = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (board.error) {
    return (
      <div className="page narrow">
        <div className="panel">
          <h2>Board unavailable</h2>
          <p className="muted">{board.error}</p>
          <Link to="/">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (!board.board) return <div className="page-center muted">Loading board…</div>;

  const openTask = openId && board.tasks[openId];

  return (
    <div className="board-page">
      <div className="board-head">
        <div>
          <Link to="/" className="muted small">
            ← Boards
          </Link>
          <h1>{board.board.name}</h1>
          <div className="muted small">
            {tasks.length} tasks · {tasks.length ? Math.round((done / tasks.length) * 100) : 0}% done
          </div>
        </div>
        <div className="board-tools">
          <input
            className="search"
            placeholder="Filter tasks… (or @me)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <PresenceAvatars users={viewers} label="Viewing this board" />
          {manage && (
            <button
              className="btn-ghost small"
              onClick={() => {
                const name = prompt('New column name');
                if (name?.trim()) safe(board.addColumn)(name.trim());
              }}
            >
              + Column
            </button>
          )}
          <button className="btn-ghost small" onClick={() => setShowActivity((s) => !s)}>
            {showActivity ? 'Hide' : 'Show'} activity
          </button>
        </div>
      </div>

      {status === 'reconnecting' && (
        <div className="banner banner-warn slim">Connection lost — reconnecting. The board will resync automatically.</div>
      )}

      <div className={`board-layout${showActivity ? '' : ' no-side'}`}>
        <div className="board-scroll">
          <KanbanBoard
            board={{
              ...view,
              createTask: safe(board.createTask),
              renameColumn: safe(board.renameColumn),
              deleteColumn: safe(board.deleteColumn),
            }}
            canManage={manage}
            onOpen={setOpenId}
          />
        </div>
        {showActivity && (
          <aside className="side-panel">
            <h3>Activity</h3>
            <ActivityPanel boardId={boardId} />
          </aside>
        )}
      </div>

      {openTask && (
        <TaskModal
          key={openTask.id}
          task={openTask}
          board={board}
          members={members}
          columns={board.columns}
          canDelete={manage || openTask.createdBy === user.id}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
