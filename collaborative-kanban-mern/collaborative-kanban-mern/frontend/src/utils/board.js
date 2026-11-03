// Same ordering rule as the server: position, then id as a tie-breaker.
export const byPosition = (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function tasksByColumn(columns, tasks) {
  const map = Object.fromEntries(columns.map((c) => [c.id, []]));
  for (const t of Object.values(tasks)) if (map[t.columnId]) map[t.columnId].push(t);
  for (const id of Object.keys(map)) map[id].sort(byPosition);
  return map;
}

// Mirrors backend/src/utils/ordering.js for the optimistic preview.
export function positionBetween(before, after) {
  if (before == null && after == null) return 1024;
  if (before == null) return after - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

export function initials(name = '?') {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const PALETTE = ['#3b5bdb', '#0c8599', '#2b8a3e', '#e67700', '#c2255c', '#7048e8', '#1971c2', '#5c940d'];
export function colorFor(id = '') {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function relativeTime(date) {
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(date).toLocaleDateString();
}

export function formatDue(date) {
  if (!date) return null;
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today) / 86400000);
  const label = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { label, overdue: diff < 0, soon: diff >= 0 && diff <= 2 };
}

export function describeActivity(a) {
  const d = a.details || {};
  const title = d.title ? `“${d.title}”` : '';
  switch (`${a.entityType}:${a.action}`) {
    case 'task:created':
      return `created ${title}${d.column ? ` in ${d.column}` : ''}`;
    case 'task:moved':
      return d.reordered ? `reordered ${title} in ${d.to}` : `moved ${title} from ${d.from} to ${d.to}`;
    case 'task:updated':
      return `updated ${d.fields?.length ? d.fields.join(', ') : ''} on ${title}${d.assignee ? ` → ${d.assignee}` : ''}`;
    case 'task:deleted':
      return `deleted ${title}`;
    case 'board:created':
      return `created board “${d.name}”`;
    case 'board:updated':
      return 'updated the board';
    case 'board:deleted':
      return `deleted board “${d.name}”`;
    case 'column:created':
      return `added column “${d.name}”`;
    case 'column:deleted':
      return `removed column “${d.name}”`;
    case 'membership:created':
      return `added ${d.userName} as ${d.role?.replace('_', ' ')}`;
    case 'membership:updated':
      return `changed a member's role to ${d.role?.replace('_', ' ')}`;
    case 'membership:deleted':
      return 'removed a member';
    default:
      return `${a.action} ${a.entityType}`;
  }
}
