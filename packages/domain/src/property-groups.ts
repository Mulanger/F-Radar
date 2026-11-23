import { z } from 'zod';

/**
 * Property groups the organization creates itself (docs/plans/skalning.md, Fas 4 / S-20): areas,
 * companies or managers. A property may be in several groups. Overview, property list, map and alert
 * feed show one group at a time; the acknowledgement report can be limited to one.
 */

/** Groups per organization: enough for areas × managers, few enough for a menu. */
export const PROPERTY_GROUPS_MAX = 100;
export const PROPERTY_GROUP_NAME_MAX = 60;
/** Ids in one membership request: the largest per-organization property limit. */
export const PROPERTY_GROUP_MEMBERS_MAX = 10_000;
export const GROUP_USED_BY_SMS_RULES = 'urn:fastighetsradar:problem:group-used-by-sms-rules';

export function groupUsedBySmsRulesMessage(ruleNames: readonly string[]): string {
  const names = ruleNames.map((name) => `”${name}”`).join(', ');
  return ruleNames.length === 1 ? `Gruppen används av SMS-regeln ${names}. Ändra eller ta bort regeln först.`
    : `Gruppen används av SMS-reglerna ${names}. Ändra eller ta bort reglerna först.`;
}

export const PropertyGroupNameSchema = z.string().trim().min(1).max(PROPERTY_GROUP_NAME_MAX);

export const PropertyGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  propertyCount: z.number().int().nonnegative(),
});
export type PropertyGroup = z.infer<typeof PropertyGroupSchema>;

export const PropertyGroupListResponseSchema = z.object({ groups: z.array(PropertyGroupSchema) });
export type PropertyGroupListResponse = z.infer<typeof PropertyGroupListResponseSchema>;

export const PropertyGroupCreateSchema = z.object({
  name: PropertyGroupNameSchema,
  /** Optional first members (the group dialog creates and fills a group in one step). */
  propertyIds: z.array(z.string().uuid()).max(PROPERTY_GROUP_MEMBERS_MAX).optional(),
});
export type PropertyGroupCreateInput = z.infer<typeof PropertyGroupCreateSchema>;

export const PropertyGroupUpdateSchema = z.object({ name: PropertyGroupNameSchema });

/** Replaces the group's members; ids of properties that no longer exist are skipped. */
export const PropertyGroupMembersSchema = z.object({
  propertyIds: z.array(z.string().uuid()).max(PROPERTY_GROUP_MEMBERS_MAX),
});

export const PropertyGroupIdParamSchema = z.object({ id: z.string().uuid() });

/** The same name regardless of case and surrounding spaces – as the database's unique index sees it. */
export function propertyGroupKey(name: string): string {
  return name.trim().toLocaleLowerCase('sv-SE');
}
