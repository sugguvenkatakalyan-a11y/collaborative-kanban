import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import BoardColumn from './BoardColumn';
import { TaskCardBody } from './TaskCard';
import { tasksByColumn } from '../utils/board';

export default function KanbanBoard({ board, canManage, onOpen }) {
  const { columns, tasks, editors, moveTask, createTask, renameColumn, deleteColumn } = board;
  const [activeId, setActiveId] = useState(null);
  const lists = useMemo(() => tasksByColumn(columns, tasks), [columns, tasks]);
  // Indexes sent to the server must be relative to the FULL column, even while a filter hides some cards.
  const allTasks = board.allTasks || tasks;
  const fullLists = useMemo(() => tasksByColumn(columns, allTasks), [columns, allTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // small drag threshold keeps clicks working
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /**
   * Translate a drop into (destination column, index among the OTHER tasks of that column).
   * The server recomputes the final position from its own current state.
   */
  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    const task = allTasks[active.id];
    if (!task) return;

    let toColumnId;
    let toIndex;
    if (over.data.current?.type === 'column') {
      toColumnId = over.data.current.columnId;
      const others = fullLists[toColumnId].filter((t) => t.id !== task.id);
      toIndex = others.length;
      if (toColumnId === task.columnId && fullLists[toColumnId].at(-1)?.id === task.id) return; // already last
    } else {
      const overTask = allTasks[over.id];
      if (!overTask) return;
      toColumnId = overTask.columnId;
      const list = fullLists[toColumnId];
      if (toColumnId === task.columnId) {
        const oldIndex = list.findIndex((t) => t.id === task.id);
        const newIndex = list.findIndex((t) => t.id === overTask.id);
        if (oldIndex === newIndex) return;
        toIndex = newIndex;
      } else {
        toIndex = list.findIndex((t) => t.id === overTask.id);
      }
    }
    moveTask(task.id, toColumnId, toIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="board-columns">
        {columns.map((c) => (
          <BoardColumn
            key={c.id}
            column={c}
            tasks={lists[c.id] || []}
            editors={editors}
            onOpen={onOpen}
            onCreate={createTask}
            canManage={canManage}
            onRename={renameColumn}
            onDelete={deleteColumn}
          />
        ))}
      </div>
      <DragOverlay>
        {activeId && tasks[activeId] ? (
          <article className="card card-overlay">
            <TaskCardBody task={tasks[activeId]} />
          </article>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
