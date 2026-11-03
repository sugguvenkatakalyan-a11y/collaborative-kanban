import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import TaskCard from './TaskCard';

export default function BoardColumn({ column, tasks, editors, onOpen, onCreate, canManage, onRename, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}`, data: { type: 'column', columnId: column.id } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreate(column.id, title.trim());
      setTitle('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`column${isOver ? ' column-over' : ''}`}>
      <header className="column-head">
        <h3>{column.name}</h3>
        <span className="count">{tasks.length}</span>
        {canManage && (
          <div className="column-actions">
            <button
              className="icon-btn"
              title="Rename column"
              onClick={() => {
                const name = prompt('Rename column', column.name);
                if (name && name.trim() && name !== column.name) onRename(column.id, name.trim());
              }}
            >
              ✎
            </button>
            <button
              className="icon-btn"
              title="Delete column"
              onClick={() => confirm(`Delete column “${column.name}”?`) && onDelete(column.id)}
            >
              ×
            </button>
          </div>
        )}
      </header>

      <div ref={setNodeRef} className="column-body">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} editors={editors[t.id]} onOpen={onOpen} />
          ))}
        </SortableContext>
        {!tasks.length && <div className="column-empty">Drop tasks here</div>}
      </div>

      {adding ? (
        <form className="quick-add" onSubmit={submit}>
          <input
            autoFocus
            placeholder="Task title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
          />
          <div className="row">
            <button className="btn small" disabled={busy || !title.trim()}>
              Add
            </button>
            <button type="button" className="btn-ghost small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="add-task" onClick={() => setAdding(true)}>
          + Add task
        </button>
      )}
    </section>
  );
}
