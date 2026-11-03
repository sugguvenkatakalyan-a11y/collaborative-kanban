/**
 * Task details panel with conflict handling.
 *
 * - The form remembers the version it was based on (`base`).
 * - If someone else saves while the form is clean, it silently refreshes.
 * - If the form is dirty, a banner warns that a newer version exists.
 * - On save, a 409 is resolved automatically when the other person changed
 *   DIFFERENT fields (field-level merge); otherwise the user chooses between
 *   "load latest" and "overwrite with mine".
 */
import { useEffect, useMemo, useState } from 'react';
import api, { errorMessage } from '../services/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from './Avatar';
import { describeActivity, relativeTime } from '../utils/board';

const FIELDS = ['title', 'description', 'assignedTo', 'priority', 'dueDate', 'labels'];

function toForm(t) {
  return {
    title: t.title || '',
    description: t.description || '',
    assignedTo: t.assignedTo?.id || t.assignedTo || '',
    priority: t.priority || 'medium',
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
    labels: (t.labels || []).join(', '),
  };
}

function toPayload(form, keys) {
  const out = {};
  for (const k of keys) {
    if (k === 'assignedTo') out.assignedTo = form.assignedTo || null;
    else if (k === 'dueDate') out.dueDate = form.dueDate || null;
    else if (k === 'labels') out.labels = form.labels.split(',').map((s) => s.trim()).filter(Boolean);
    else out[k] = form[k];
  }
  return out;
}

const diffKeys = (a, b) => FIELDS.filter((k) => a[k] !== b[k]);

export default function TaskModal({ task, board, members, columns, canDelete, onClose }) {
  const toast = useToast();
  const { socket } = useWorkspace();
  const [base, setBase] = useState(task);
  const [form, setForm] = useState(() => toForm(task));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null); // { current, fields }
  const [activity, setActivity] = useState([]);

  const baseForm = useMemo(() => toForm(base), [base]);
  const dirtyKeys = diffKeys(form, baseForm);
  const remoteNewer = task.version > base.version;
  const editors = Object.values(board.editors[task.id] || {});
  const column = columns.find((c) => c.id === task.columnId);

  // Announce editing to collaborators; clear it when the panel closes.
  useEffect(() => {
    board.setEditing(task.id, true);
    return () => board.setEditing(task.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Clean form + remote update → just take the new version.
  useEffect(() => {
    if (remoteNewer && !dirtyKeys.length && !saving) {
      setBase(task);
      setForm(toForm(task));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.version]);

  // Task history (initial fetch + live additions).
  useEffect(() => {
    api
      .get(`/tasks/${task.id}`)
      .then((r) => setActivity(r.data.activity))
      .catch(() => {});
    if (!socket) return;
    const onActivity = ({ activity: a }) => a.entityId === task.id && setActivity((list) => [a, ...list]);
    socket.on('activity:created', onActivity);
    return () => socket.off('activity:created', onActivity);
  }, [task.id, socket]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (keys, version) => {
    setSaving(true);
    try {
      const res = await board.updateTask(task.id, toPayload(form, keys), version);
      if (res.ok) {
        setBase(res.task);
        setForm(toForm(res.task));
        setConflict(null);
        return res;
      }
      // 409 — what did the other person change since our base?
      const theirKeys = diffKeys(toForm(res.current), baseForm);
      const overlap = keys.filter((k) => theirKeys.includes(k));
      if (!overlap.length) {
        // Non-overlapping edits → merge automatically by re-applying our fields on top.
        const merged = await board.updateTask(task.id, toPayload(form, keys), res.current.version);
        if (merged.ok) {
          setBase(merged.task);
          setForm(toForm(merged.task));
          toast('Merged your changes with an edit made by someone else.', 'info');
          return merged;
        }
      }
      setConflict({ current: res.current, fields: overlap.length ? overlap : keys });
      return res;
    } catch (e) {
      toast(e.response?.status === 404 ? 'This task was deleted by someone else.' : errorMessage(e), 'error');
      if (e.response?.status === 404) onClose();
    } finally {
      setSaving(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!dirtyKeys.length) return onClose();
    const res = await submit(dirtyKeys, base.version);
    if (res?.ok) {
      toast('Task saved', 'success', 2000);
      onClose();
    }
  };

  const loadLatest = () => {
    setBase(task);
    setForm(toForm(task));
    setConflict(null);
  };

  const overwrite = () => submit(diffKeys(form, toForm(conflict.current)), conflict.current.version);

  const remove = async () => {
    if (!confirm(`Delete “${task.title}”?`)) return;
    try {
      await board.deleteTask(task.id);
      toast('Task deleted', 'success', 2000);
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Task details">
        <form onSubmit={save} className="modal-main">
          <div className="modal-head">
            <span className="muted small">
              {column?.name} · v{task.version}
            </span>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          {editors.length > 0 && <div className="banner banner-info">✎ {editors.join(', ')} also has this task open.</div>}

          {conflict ? (
            <div className="banner banner-error">
              <div>
                <strong>Conflict:</strong> someone else changed <em>{conflict.fields.join(', ')}</em> while you were
                editing.
              </div>
              <div className="row">
                <button type="button" className="btn small" onClick={loadLatest}>
                  Load latest (discard mine)
                </button>
                <button type="button" className="btn-ghost small" onClick={overwrite} disabled={saving}>
                  Overwrite with mine
                </button>
              </div>
            </div>
          ) : (
            remoteNewer &&
            dirtyKeys.length > 0 && (
              <div className="banner banner-warn">
                This task was updated by someone else (v{task.version}). Saving will try to merge your edits.
                <button type="button" className="link" onClick={loadLatest}>
                  Load latest
                </button>
              </div>
            )
          )}

          <input className="title-input" value={form.title} onChange={set('title')} maxLength={200} required />
          <label className="field">
            <span>Description</span>
            <textarea rows={5} value={form.description} onChange={set('description')} maxLength={5000} />
          </label>

          <div className="grid-2">
            <label className="field">
              <span>Assignee</span>
              <select value={form.assignedTo} onChange={set('assignedTo')}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={form.priority} onChange={set('priority')}>
                {['low', 'medium', 'high', 'urgent'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Due date</span>
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </label>
            <label className="field">
              <span>Labels (comma separated)</span>
              <input value={form.labels} onChange={set('labels')} placeholder="frontend, bug" />
            </label>
          </div>

          <div className="meta-row muted small">
            Created {new Date(task.createdAt).toLocaleString()} · Updated {relativeTime(task.updatedAt)}
          </div>

          <div className="modal-actions">
            {canDelete && (
              <button type="button" className="btn-danger" onClick={remove}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={saving || !dirtyKeys.length || !form.title.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>

        <aside className="modal-side">
          <h4>History</h4>
          <ul className="activity-list">
            {activity.map((a) => (
              <li key={a.id}>
                <Avatar id={a.user?.id} name={a.user?.name} size={20} />
                <div>
                  <strong>{a.user?.name}</strong> {describeActivity(a)}
                  <div className="muted small">{relativeTime(a.createdAt)}</div>
                </div>
              </li>
            ))}
            {!activity.length && <li className="muted small">No history yet.</li>}
          </ul>
        </aside>
      </div>
    </div>
  );
}
