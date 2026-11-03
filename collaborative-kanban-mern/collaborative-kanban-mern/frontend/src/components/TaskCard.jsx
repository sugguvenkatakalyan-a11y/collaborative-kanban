import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar } from './Avatar';
import { formatDue } from '../utils/board';

export function TaskCardBody({ task, editors }) {
  const due = formatDue(task.dueDate);
  const editingNames = Object.values(editors || {});
  return (
    <>
      <div className="card-top">
        <span className={`prio prio-${task.priority}`}>{task.priority}</span>
        {task.labels?.slice(0, 2).map((l) => (
          <span key={l} className="label">
            {l}
          </span>
        ))}
      </div>
      <div className="card-title">{task.title}</div>
      {task.description && <div className="card-desc">{task.description}</div>}
      <div className="card-meta">
        {due ? (
          <span className={`due${due.overdue ? ' overdue' : due.soon ? ' soon' : ''}`}>
            {due.overdue ? 'Overdue · ' : ''}
            {due.label}
          </span>
        ) : (
          <span />
        )}
        {editingNames.length > 0 && <span className="editing-dot">✎ {editingNames[0]}</span>}
        {task.assignedTo ? (
          <Avatar id={task.assignedTo.id} name={task.assignedTo.name} size={22} />
        ) : (
          <span className="unassigned" title="Unassigned">
            ?
          </span>
        )}
      </div>
    </>
  );
}

export default function TaskCard({ task, editors, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId: task.columnId },
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`card${isDragging ? ' card-ghost' : ''}`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(task.id)}
      {...attributes}
      {...listeners}
    >
      <TaskCardBody task={task} editors={editors} />
    </article>
  );
}
