import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import {
  createPropertyGroup,
  deletePropertyGroup,
  listPropertyGroups,
  renamePropertyGroup,
  setPropertyGroupMembers,
  type Queryable,
} from '@fastighetsradar/db';
import {
  PROPERTY_GROUPS_MAX,
  PropertyGroupCreateSchema,
  PropertyGroupIdParamSchema,
  PropertyGroupMembersSchema,
  PropertyGroupUpdateSchema,
  type PropertyGroup,
  type PropertyGroupListResponse,
} from '@fastighetsradar/domain';
import { orgContext } from '../auth';
import { HttpProblem } from '../errors';

/** Problem types the web tells apart (a 409 is either a taken name or the group limit). */
export const GROUP_NAME_TAKEN = 'urn:fastighetsradar:problem:group-name-taken';
export const GROUP_LIMIT_REACHED = 'urn:fastighetsradar:problem:group-limit';

/** 10 000 property ids are ~390 kB; the API's default body limit is 64 kB. */
const MEMBERS_BODY_LIMIT = 512 * 1024;

const nameTaken = () => new HttpProblem(409, 'Group name taken', 'Det finns redan en grupp med det namnet.', GROUP_NAME_TAKEN);

/**
 * Property groups (docs/plans/skalning.md, Fas 4 / S-20). Any member of the organization may manage
 * them, like the properties themselves. A group change does not move a property, so nothing is
 * re-matched; the dashboard reloads its portfolio after a change.
 */
export function registerPropertyGroupRoutes(app: FastifyInstance, deps: { db: Queryable | null; requireOrg: preHandlerHookHandler }) {
  const db = () => {
    if (!deps.db) throw new HttpProblem(503, 'Database unavailable');
    return deps.db;
  };

  app.get('/v1/property-groups', { preHandler: deps.requireOrg }, async (req): Promise<PropertyGroupListResponse> => ({
    groups: await listPropertyGroups(db(), orgContext(req)),
  }));

  app.post('/v1/property-groups', { preHandler: deps.requireOrg, bodyLimit: MEMBERS_BODY_LIMIT }, async (req, reply): Promise<{ group: PropertyGroup }> => {
    const { name, propertyIds } = PropertyGroupCreateSchema.parse(req.body);
    const result = await createPropertyGroup(db(), orgContext(req), name, propertyIds);
    if (!result.ok) {
      if (result.reason === 'duplicate') throw nameTaken();
      throw new HttpProblem(409, 'Group limit reached', `En organisation kan ha högst ${PROPERTY_GROUPS_MAX} grupper.`, GROUP_LIMIT_REACHED);
    }
    req.log.info({ propertyGroup: { id: result.group.id, properties: result.group.propertyCount } }, 'property group created');
    reply.code(201);
    return { group: result.group };
  });

  app.patch('/v1/property-groups/:id', { preHandler: deps.requireOrg }, async (req) => {
    const { id } = PropertyGroupIdParamSchema.parse(req.params);
    const { name } = PropertyGroupUpdateSchema.parse(req.body);
    const outcome = await renamePropertyGroup(db(), orgContext(req), id, name);
    if (outcome === 'not_found') throw new HttpProblem(404, 'Group not found');
    if (outcome === 'duplicate') throw nameTaken();
    return { id, name: name.trim() };
  });

  app.put('/v1/property-groups/:id/properties', { preHandler: deps.requireOrg, bodyLimit: MEMBERS_BODY_LIMIT }, async (req) => {
    const { id } = PropertyGroupIdParamSchema.parse(req.params);
    const { propertyIds } = PropertyGroupMembersSchema.parse(req.body);
    const count = await setPropertyGroupMembers(db(), orgContext(req), id, [...new Set(propertyIds)]);
    if (count === null) throw new HttpProblem(404, 'Group not found');
    return { id, propertyCount: count };
  });

  app.delete('/v1/property-groups/:id', { preHandler: deps.requireOrg }, async (req, reply) => {
    const { id } = PropertyGroupIdParamSchema.parse(req.params);
    if (!(await deletePropertyGroup(db(), orgContext(req), id))) throw new HttpProblem(404, 'Group not found');
    reply.code(204);
    return null;
  });
}
