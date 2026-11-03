# Testing guide

## 1. Automated checks

```bash
npm run seed            # fresh demo data
npm run dev             # API + web app (or: cd backend && npm run dev)
npm run test:isolation  # in another terminal
```

Expected output (abridged):

```
Authentication
  ✔ rejects requests without a token
  ✔ rejects a forged token
  ✔ rejects wrong password
Tenant isolation
  ✔ member only sees own tenant
  ✔ org_admin sees every tenant of the org
  ✔ Hyderabad user cannot switch X-Tenant-Id to Bangalore
  ✔ Bangalore task id is not readable through the Hyderabad tenant
  ✔ Bangalore task cannot be modified through the Hyderabad tenant
  ✔ cannot create a task on a Bangalore board from Hyderabad
  ✔ cross-organisation: XYZ user cannot read ABC organisation
  ✔ cross-organisation: XYZ user cannot use an ABC tenant
  ✔ org_admin can access any tenant of their org
Role-based access control
  ✔ member cannot create a tenant
  ✔ member cannot create a board
  ✔ tenant_admin cannot create a tenant
  ✔ tenant_admin can create a board (with 4 default columns)
Optimistic concurrency
  ✔ member can create a task (version 1)
  ✔ first save wins and bumps version to 2
  ✔ stale save is rejected with 409 + current copy
  ✔ simultaneous moves of the same task: exactly one wins, the other gets 409
Tenant-scoped WebSockets
  ✔ socket cannot join a tenant without membership
  ✔ socket can join its own tenant
  ✔ Hyderabad user receives Hyderabad update in real time
  ✔ Bangalore user does NOT receive Hyderabad update
  ✔ presence lists both Hyderabad users
  ✔ presence:offline fires when a user disconnects
26 passed, 0 failed
```

> The "simultaneous moves" check relies on MongoDB's atomic single-document `findOneAndUpdate`. Run it against real MongoDB (local, Docker or Atlas). MongoDB-compatible emulators that don't implement atomic find-and-modify may report `[200, 200]` there.

## 2. Manual test plan (two browsers)

Use a normal window and an incognito/private window (or two browsers) so each has its own login.

### Real-time sync
| # | Browser A (priya@abc.example) | Browser B (arjun@abc.example) | Expected |
|---|---|---|---|
| 1 | Open *Hyderabad → Website Development* | Same board | Both see "2 online" in the board header |
| 2 | Add a task in *To Do* | — | Appears instantly in B; activity feed updates |
| 3 | — | Rename the task | A sees the new title |
| 4 | Drag the task to *Testing* | — | B sees it move without refresh |
| 5 | Delete the task | — | Disappears in B; if B had it open, the panel closes with a notice |

### Concurrency
| # | Steps | Expected |
|---|---|---|
| 6 | A and B open the same task. A edits **description** and saves; B edits **title** and saves | B's save merges automatically ("Merged your changes…"); both changes are kept |
| 7 | A and B open the same task, both change the **title**; A saves, then B saves | B sees the conflict banner → *Load latest* or *Overwrite with mine* |
| 8 | While B has a task open (no edits), A saves it | B's form refreshes silently to the new version |
| 9 | While B has edited but not saved, A saves | B sees "updated by someone else (vN)" warning |
| 10 | A and B drag the same card to different columns at the same moment | One wins; the other's card snaps to the authoritative column with a notice |

### Isolation & RBAC
| # | Steps | Expected |
|---|---|---|
| 11 | Log in as arjun — open the branch switcher | Only *Hyderabad* is listed |
| 12 | As arjun, edit `localStorage['kanban.tenant']` to a Bangalore id and reload | Falls back to Hyderabad; direct API calls with that header get 403 |
| 13 | Log in as sneha (Bangalore) next to priya (Hyderabad); priya moves a task | Sneha receives nothing |
| 14 | As arjun (member) | No "Create board", "+ Column" or role controls; API calls return 403 |
| 15 | As rahul (org admin) switch between Hyderabad, Bangalore, Chennai | All accessible; "Add branch" available |
| 16 | As priya, remove arjun from Hyderabad while arjun has the board open | Arjun is notified and loses the branch immediately |

### Network recovery
| # | Steps | Expected |
|---|---|---|
| 17 | In B, DevTools → Network → Offline | Navbar shows **Reconnecting…**, board shows the reconnect banner |
| 18 | In A, create/move/delete several tasks | — |
| 19 | In B, go back Online | B reconnects, re-joins the room and refetches: board equals A's board |
| 20 | Stop the API server for 10 s, restart it | Both clients reconnect and resync automatically |

### Presence
| # | Steps | Expected |
|---|---|---|
| 21 | Open the same account in two tabs, close one | User stays online (connections count drops from 2 to 1) |
| 22 | Close the last tab | Others see the user go offline within seconds |

## 3. Postman / cURL

See `docs/API.md` for request bodies. Remember to send `Authorization: Bearer <token>` and, for boards/columns/tasks/activity, `X-Tenant-Id`.
