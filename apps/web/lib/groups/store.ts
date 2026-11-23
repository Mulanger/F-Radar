import { PROPERTY_GROUPS_MAX, type Portfolio, type PropertyGroup } from '@fastighetsradar/domain';

/**
 * Changes to the organization's property groups (docs/plans/skalning.md, Fas 4 / S-20). Live, each
 * change goes to the API and is then applied to the shown portfolio at once (the reload follows);
 * in demo mode only the shown portfolio changes, and nothing is saved.
 */

export type GroupChange =
  | { kind: 'create'; id: string; name: string; propertyIds: string[] }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'remove'; id: string }
  | { kind: 'members'; id: string; propertyIds: string[] };

/** A change as the UI asks for it: a new group gets its id from the API (or the demo). */
export type GroupChangeRequest = Omit<Extract<GroupChange, { kind: 'create' }>, 'id'> | Exclude<GroupChange, { kind: 'create' }>;

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'sv-SE');

/** The portfolio as it looks after the change: the group list and every property's `groupIds`. */
export function applyGroupChange(p: Portfolio, change: GroupChange): Portfolio {
  const members = change.kind === 'create' || change.kind === 'members' ? new Set(change.propertyIds) : null;
  const groups =
    change.kind === 'create' ? [...p.groups, { id: change.id, label: change.name.trim() }].sort(byName)
    : change.kind === 'rename' ? p.groups.map((g) => (g.id === change.id ? { ...g, label: change.name.trim() } : g)).sort(byName)
    : change.kind === 'remove' ? p.groups.filter((g) => g.id !== change.id)
    : p.groups;
  if (change.kind === 'rename') return { ...p, groups };
  const properties = p.properties.map((s) => {
    const has = s.property.groupIds.includes(change.id);
    const want = members ? members.has(s.property.id) : false;
    if (has === want) return s;
    const groupIds = want ? [...s.property.groupIds, change.id] : s.property.groupIds.filter((id) => id !== change.id);
    return { ...s, property: { ...s.property, groupIds } };
  });
  return { ...p, groups, properties };
}

export class GroupRequestError extends Error {}

const PROBLEM_TYPE_LIMIT = 'urn:fastighetsradar:problem:group-limit';

async function problem(res: Response): Promise<GroupRequestError> {
  let type = '';
  try {
    type = ((await res.json()) as { type?: string }).type ?? '';
  } catch {
    // Not a problem document (a proxy error page): the status is enough.
  }
  const message =
    res.status === 409 ? (type === PROBLEM_TYPE_LIMIT ? `En organisation kan ha högst ${PROPERTY_GROUPS_MAX} grupper.` : 'Det finns redan en grupp med det namnet.')
    : res.status === 404 ? 'Gruppen finns inte längre – ladda om sidan.'
    : res.status === 401 ? 'Din inloggning har gått ut – logga in igen.'
    : res.status === 403 ? 'Du saknar behörighet att ändra grupper.'
    : res.status === 429 ? 'För många ändringar – vänta en stund och försök igen.'
    : res.status === 413 ? 'För många fastigheter i en ändring.'
    : `Gruppen kunde inte sparas (${res.status}).`;
  return new GroupRequestError(message);
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api/app/property-groups${path}`, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GroupRequestError('Nätverksfel – gruppen sparades inte.');
  }
  if (!res.ok) throw await problem(res);
  return res;
}

/** The API calls behind each change; `create` answers with the new group's id. */
export const groupApi = {
  async create(name: string, propertyIds: string[] = []): Promise<string> {
    const res = await send('', 'POST', { name: name.trim(), propertyIds });
    return ((await res.json()) as { group: PropertyGroup }).group.id;
  },
  async rename(id: string, name: string): Promise<void> {
    await send(`/${id}`, 'PATCH', { name: name.trim() });
  },
  async remove(id: string): Promise<void> {
    await send(`/${id}`, 'DELETE');
  },
  async members(id: string, propertyIds: string[]): Promise<void> {
    await send(`/${id}/properties`, 'PUT', { propertyIds });
  },
};

let demoSequence = 0;

/** Runs one change: through the API when live (then reloads), in the shown portfolio only in demo mode. */
export async function runGroupChange(
  change: GroupChangeRequest,
  options: { live: boolean; portfolio: () => Portfolio; patch: (next: Portfolio) => void; refresh: () => void },
): Promise<string> {
  let applied: GroupChange;
  if (change.kind === 'create') {
    const id = options.live ? await groupApi.create(change.name, change.propertyIds) : `demo-group-${++demoSequence}`;
    applied = { ...change, id };
  } else {
    if (options.live) {
      if (change.kind === 'rename') await groupApi.rename(change.id, change.name);
      else if (change.kind === 'remove') await groupApi.remove(change.id);
      else await groupApi.members(change.id, change.propertyIds);
    }
    applied = change;
  }
  options.patch(applyGroupChange(options.portfolio(), applied));
  if (options.live) options.refresh();
  return applied.id;
}
