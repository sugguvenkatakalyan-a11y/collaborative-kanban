import { colorFor, initials } from '../utils/board';

export function Avatar({ id, name, size = 26, online = false, title }) {
  return (
    <span
      className={`avatar${online ? ' avatar-online' : ''}`}
      style={{ width: size, height: size, background: colorFor(id || name), fontSize: size * 0.4 }}
      title={title || name}
    >
      {initials(name)}
    </span>
  );
}

/** Stack of online users, e.g. in the navbar or a board header. */
export function PresenceAvatars({ users, max = 5, label }) {
  if (!users?.length) return <span className="muted small">Only you</span>;
  const shown = users.slice(0, max);
  return (
    <div className="presence" aria-label={label}>
      <div className="avatar-stack">
        {shown.map((u) => (
          <Avatar
            key={u.userId}
            id={u.userId}
            name={u.name}
            online
            title={`${u.name} — online${u.connections > 1 ? ` (${u.connections} tabs)` : ''}`}
          />
        ))}
        {users.length > max && <span className="avatar avatar-more">+{users.length - max}</span>}
      </div>
      <span className="small muted">{users.length} online</span>
    </div>
  );
}
