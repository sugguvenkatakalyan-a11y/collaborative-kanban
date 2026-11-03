/**
 * Board state + real-time sync.
 *
 *  - Loads the authoritative snapshot (board, columns, tasks) from the API.
 *  - Applies Socket.IO events from the tenant room; an incoming task only
 *    replaces the local copy if its version is not older (idempotent, order-safe).
 *  - Moves are optimistic: the card jumps immediately, then is confirmed by the
 *    server or rolled back / reconciled on error or 409 conflict.
 *  - Refetches everything whenever the workspace reports a reconnect (syncKey).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import api, { errorMessage } from '../services/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import { positionBetween, tasksByColumn } from '../utils/board';

const initial = { board: null, columns: [], tasks: {}, loading: true, error: null, deleted: false, editors: {} };

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, loading: true, error: null };
    case 'LOADED':
      return {
        ...state,
        loading: false,
        board: action.board,
        columns: action.columns,
        tasks: Object.fromEntries(action.tasks.map((t) => [t.id, t])),
      };
    case 'ERROR':
      return { ...state, loading: false, error: action.error };
    case 'UPSERT_TASK': {
      const cur = state.tasks[action.task.id];
      if (cur && !action.force && cur.version > action.task.version) return state; // stale event
      return { ...state, tasks: { ...state.tasks, [action.task.id]: { ...cur, ...action.task } } };
    }
    case 'REMOVE_TASK': {
      if (!state.tasks[action.id]) return state;
      const tasks = { ...state.tasks };
      delete tasks[action.id];
      return { ...state, tasks };
    }
    case 'BOARD':
      return { ...state, board: { ...state.board, ...action.board } };
    case 'BOARD_DELETED':
      return { ...state, deleted: true };
    case 'UPSERT_COLUMN': {
      const others = state.columns.filter((c) => c.id !== action.column.id);
      return { ...state, columns: [...others, action.column].sort((a, b) => a.position - b.position) };
    }
    case 'REMOVE_COLUMN':
      return { ...state, columns: state.columns.filter((c) => c.id !== action.id) };
    case 'EDITING': {
      const forTask = { ...(state.editors[action.taskId] || {}) };
      if (action.editing) forTask[action.user.id] = action.user.name;
      else delete forTask[action.user.id];
      return { ...state, editors: { ...state.editors, [action.taskId]: forTask } };
    }
    case 'CLEAR_EDITOR': {
      const editors = {};
      for (const [taskId, users] of Object.entries(state.editors)) {
        const copy = { ...users };
        delete copy[action.userId];
        editors[taskId] = copy;
      }
      return { ...state, editors };
    }
    default:
      return state;
  }
}

export function useBoard(boardId) {
  const { socket, tenantId, syncKey } = useWorkspace();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!boardId || !tenantId) return;
    dispatch({ type: 'LOADING' });
    try {
      const { data } = await api.get(`/boards/${boardId}`);
      dispatch({ type: 'LOADED', board: data.board, columns: data.columns, tasks: data.tasks });
    } catch (e) {
      dispatch({ type: 'ERROR', error: errorMessage(e) });
    }
  }, [boardId, tenantId]);

  // Initial load, tenant switch, and resync after reconnect.
  useEffect(() => {
    load();
  }, [load, syncKey]);

  // Real-time subscriptions.
  useEffect(() => {
    if (!socket) return;
    const mine = (e) => (e.task?.boardId || e.boardId || e.column?.boardId) === boardId;
    const handlers = {
      'task:created': (e) => mine(e) && dispatch({ type: 'UPSERT_TASK', task: e.task }),
      'task:updated': (e) => mine(e) && dispatch({ type: 'UPSERT_TASK', task: e.task }),
      'task:moved': (e) => mine(e) && dispatch({ type: 'UPSERT_TASK', task: e.task }),
      'task:deleted': (e) => mine(e) && dispatch({ type: 'REMOVE_TASK', id: e.taskId }),
      'column:created': (e) => mine(e) && dispatch({ type: 'UPSERT_COLUMN', column: e.column }),
      'column:updated': (e) => mine(e) && dispatch({ type: 'UPSERT_COLUMN', column: e.column }),
      'column:deleted': (e) => mine(e) && dispatch({ type: 'REMOVE_COLUMN', id: e.columnId }),
      'board:updated': (e) => e.board?.id === boardId && dispatch({ type: 'BOARD', board: e.board }),
      'board:deleted': (e) => e.boardId === boardId && dispatch({ type: 'BOARD_DELETED' }),
      'board:resync': (e) => e.boardId === boardId && load(),
      'task:editing': (e) => dispatch({ type: 'EDITING', ...e }),
      'presence:offline': (e) => dispatch({ type: 'CLEAR_EDITOR', userId: e.user.id }),
    };
    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    return () => Object.entries(handlers).forEach(([ev, fn]) => socket.off(ev, fn));
  }, [socket, boardId, load]);

  // Tell the tenant which board we are looking at (per-board presence).
  useEffect(() => {
    if (!socket) return;
    const announce = () => socket.emit('presence:viewing', { boardId });
    announce();
    socket.on('connect', announce);
    return () => {
      socket.off('connect', announce);
      socket.emit('presence:viewing', { boardId: null });
    };
  }, [socket, boardId, syncKey]);

  // ── actions ──
  const createTask = async (columnId, title) => {
    const { data } = await api.post('/tasks', { boardId, columnId, title });
    dispatch({ type: 'UPSERT_TASK', task: data.task });
    return data.task;
  };

  /** Returns { ok, task } or { conflict, current } on 409. */
  const updateTask = async (id, changes, expectedVersion) => {
    try {
      const { data } = await api.put(`/tasks/${id}`, { ...changes, expectedVersion });
      dispatch({ type: 'UPSERT_TASK', task: data.task });
      return { ok: true, task: data.task };
    } catch (e) {
      if (e.response?.status === 409 && e.response.data.current) {
        dispatch({ type: 'UPSERT_TASK', task: e.response.data.current, force: true });
        return { conflict: true, current: e.response.data.current };
      }
      if (e.response?.status === 404) dispatch({ type: 'REMOVE_TASK', id });
      throw e;
    }
  };

  const moveTask = async (id, toColumnId, toIndex) => {
    const snapshot = stateRef.current.tasks[id];
    if (!snapshot) return;

    // Optimistic placement using the same midpoint rule as the server.
    const lists = tasksByColumn(stateRef.current.columns, stateRef.current.tasks);
    const siblings = (lists[toColumnId] || []).filter((t) => t.id !== id);
    const position = positionBetween(siblings[toIndex - 1]?.position, siblings[toIndex]?.position);
    dispatch({ type: 'UPSERT_TASK', force: true, task: { ...snapshot, columnId: toColumnId, position } });

    try {
      const { data } = await api.patch(`/tasks/${id}/move`, {
        toColumnId,
        toIndex,
        expectedVersion: snapshot.version,
      });
      dispatch({ type: 'UPSERT_TASK', task: data.task, force: true });
    } catch (e) {
      if (e.response?.status === 409 && e.response.data.current) {
        dispatch({ type: 'UPSERT_TASK', task: e.response.data.current, force: true });
        toast('Someone else changed this task first — showing the latest position.', 'warn');
      } else if (e.response?.status === 404) {
        dispatch({ type: 'REMOVE_TASK', id });
        toast('That task was deleted by someone else.', 'warn');
      } else {
        dispatch({ type: 'UPSERT_TASK', task: snapshot, force: true }); // roll back
        toast(errorMessage(e), 'error');
      }
    }
  };

  const deleteTask = async (id) => {
    await api.delete(`/tasks/${id}`);
    dispatch({ type: 'REMOVE_TASK', id });
  };

  const addColumn = async (name) => {
    const { data } = await api.post('/columns', { boardId, name });
    dispatch({ type: 'UPSERT_COLUMN', column: data.column });
  };

  const renameColumn = async (id, name) => {
    const { data } = await api.put(`/columns/${id}`, { name });
    dispatch({ type: 'UPSERT_COLUMN', column: data.column });
  };

  const deleteColumn = async (id) => {
    await api.delete(`/columns/${id}`);
    dispatch({ type: 'REMOVE_COLUMN', id });
  };

  const setEditing = useCallback(
    (taskId, editing) => socket?.emit('task:editing', { taskId, editing }),
    [socket]
  );

  return {
    ...state,
    reload: load,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    addColumn,
    renameColumn,
    deleteColumn,
    setEditing,
  };
}
