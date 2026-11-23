import { z } from "zod";
import { TRAFFIC_RADIUS } from "./organization-settings";
import type { PropertyGroup } from "./property-groups";
import { isOfferedUtility, type UtilityKind } from './utility-outages';

export const OUTAGE_CATEGORY_UTILITIES = {
  power_outage: ['electricity', 'district_heating', 'district_cooling'],
  water_outage: ['water'],
  heating_outage: ['district_heating', 'district_cooling'],
  gas_outage: ['gas'],
} as const satisfies Record<string, readonly UtilityKind[]>;
type OutageCategory = keyof typeof OUTAGE_CATEGORY_UTILITIES;

export function offeredOutageCategoryUtilities(category: OutageCategory): UtilityKind[] {
  return OUTAGE_CATEGORY_UTILITIES[category].filter(isOfferedUtility);
}

const NOTIFICATION_CATEGORY_DEFINITIONS = [
  { id: 'water_outage', source: 'utility_outages', label: 'Vatten och avlopp', explanation: 'Exakt träff på leverantörens område eller adresslista. Kokningsrekommendationer följer kommunens besked.', enabled: true },
  { id: 'heating_outage', source: 'utility_outages', label: 'Fjärrvärme och fjärrkyla', explanation: 'Endast exakt träff på leverantörens publicerade avbrottsområde.', enabled: true },
  { id: 'gas_outage', source: 'utility_outages', label: 'Gasavbrott', explanation: 'Endast exakt träff på leverantörens publicerade avbrottsområde.', enabled: true },
  {
    id: "smhi_warning",
    source: "smhi_warnings",
    label: "SMHI officiella varningar",
    explanation:
      "Nya geografiskt matchade gula, orange eller röda varningar. Välj även materiella uppdateringar och avslut.",
    enabled: true,
  },
  {
    id: "forecast",
    source: "smhi_forecast",
    label: "SMHI väderprognos",
    explanation:
      "En ny tröskelpassage i aktuell modellprognos. Återställs först när värdet passerat hysteresgränsen.",
    enabled: true,
  },
  {
    id: "vma",
    source: "krisinformation",
    label: "Krisinformation / VMA",
    explanation:
      "Officiell VMA för fastighetens län, kommun eller hela landet. Vanliga nyhetsartiklar utlöser inga SMS.",
    enabled: true,
  },
  {
    id: "traffic",
    source: "trafikverket",
    label: "Trafikverket",
    explanation:
      "Nya betydande trafikstörningar och materiella ändringar inom vald radie (högst organisationens trafikavstånd, upp till 3 km). Innebär inte att fastigheten är otillgänglig.",
    enabled: true,
  },
  {
    id: "power_outage",
    source: "utility_outages",
    label: offeredOutageCategoryUtilities('power_outage').some((u) => u !== 'electricity') ? 'Strömavbrott och fjärrvärmeavbrott' : 'Strömavbrott',
    explanation:
      "SMS skickas bara när fastighetens adresspunkt ligger inom området nätbolaget publicerat som berört. Postnummer-, område- och närhetsträffar visas bara i dashboarden.",
    enabled: true,
  },
  {
    id: "air_quality",
    source: "air_quality",
    label: "Luftkvalitet",
    explanation:
      "Inte aktiverad: stationsrepresentativitet, medelvärdesperiod och tröskelpolicy behöver godkännas.",
    enabled: false,
  },
  {
    id: "groundwater",
    source: "sgu_groundwater",
    label: "Regionalt grundvatten",
    explanation:
      "Inte aktiverad: regional modell, ingen mätning vid byggnaden.",
    enabled: false,
  },
  {
    id: "flood",
    source: "mcf_flood",
    label: "Modellerad översvämningsexponering",
    explanation:
      "Statisk kartinformation i fastighetsvyn. Inga återkommande varningar.",
    enabled: false,
  },
  {
    id: "statistics",
    source: "scb",
    label: "SCB statistik",
    explanation: "Endast regional bakgrundsinformation. Inga SMS.",
    enabled: false,
  },
] as const;

export const NOTIFICATION_CATEGORIES = NOTIFICATION_CATEGORY_DEFINITIONS.filter((c) =>
  !(c.id in OUTAGE_CATEGORY_UTILITIES) || offeredOutageCategoryUtilities(c.id as OutageCategory).length > 0);

const supplyCondition = <T extends 'water_outage' | 'heating_outage' | 'gas_outage'>(category: T) => z.object({
  category: z.literal(category),
  utilities: z.array(z.enum(['water', 'district_heating', 'district_cooling', 'gas'])).min(1).max(2),
  unplanned: z.boolean(), planned: z.boolean(), plannedReminder: z.boolean(), restored: z.boolean(), changes: z.boolean(),
}).strict().refine((c) => c.utilities.every((u) => category === 'water_outage' ? u === 'water' : category === 'gas_outage' ? u === 'gas' : u === 'district_heating' || u === 'district_cooling'), { message: 'Fel nyttighet för SMS-kategorin' })
  .refine((c) => c.unplanned || c.planned || c.plannedReminder, { message: 'Välj minst en typ av avbrott' });

export const NotificationConditionSchema = z.discriminatedUnion("category", [
  supplyCondition('water_outage'),
  supplyCondition('heating_outage'),
  supplyCondition('gas_outage'),
  z
    .object({
      category: z.literal("smhi_warning"),
      levels: z
        .array(z.enum(["Yellow", "Orange", "Red"]))
        .min(1)
        .max(3),
      updates: z.boolean(),
      cancellations: z.boolean(),
    })
    .strict(),
  z
    .object({
      category: z.literal("forecast"),
      metric: z.enum([
        "precipitationMean",
        "windSpeed",
        "windGust",
        "airTemperature",
        "relativeHumidity",
      ]),
      operator: z.enum(["gt", "lt"]),
      threshold: z.number().finite().min(-60).max(500),
      hours: z.number().int().min(1).max(48),
      hysteresis: z.number().finite().min(0.1).max(50),
    })
    .strict(),
  z
    .object({
      category: z.literal("vma"),
      updates: z.boolean(),
      cancellations: z.boolean(),
    })
    .strict(),
  z
    .object({
      category: z.literal("power_outage"),
      utilities: z.array(z.enum(["electricity", "district_heating", "district_cooling"])).min(1).max(3),
      unplanned: z.boolean(),
      planned: z.boolean(),
      plannedReminder: z.boolean(),
      restored: z.boolean(),
      changes: z.boolean(),
    })
    .strict()
    .refine((c) => c.unplanned || c.planned || c.plannedReminder, { message: "Välj minst en typ av avbrott" }),
  z
    .object({
      category: z.literal("traffic"),
      radiusMeters: z.number().int().min(TRAFFIC_RADIUS.min).max(TRAFFIC_RADIUS.max),
      updates: z.boolean(),
    })
    .strict(),
]);
export const NotificationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(false),
    scope: z.enum(["selected", "all_current", "all_future", "group"]),
    groupId: z.uuid({ error: "Ogiltigt id för fastighetsgruppen" }).optional(),
    // As many as an organization may have (DEFAULT_MAX_PROPERTIES); larger selections use the "all" scopes.
    propertyIds: z.array(z.string().uuid()).max(1000),
    recipientIds: z.array(z.string().uuid()).min(1).max(10),
    condition: NotificationConditionSchema,
    cooldownMinutes: z.number().int().min(5).max(10080).default(360),
    quietHours: z
      .object({
        enabled: z.boolean(),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        emergencyException: z.boolean(),
      })
      .strict(),
    groupProperties: z.boolean().default(true),
    dailyPropertyLimit: z.number().int().min(1).max(20).default(3),
    dailyRecipientLimit: z.number().int().min(1).max(20).default(5),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.scope === "group" && !r.groupId)
      ctx.addIssue({ code: "custom", path: ["groupId"], message: "Välj en fastighetsgrupp" });
    if (r.scope === "selected" && !r.propertyIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["propertyIds"],
        message: "Välj minst en fastighet",
      });
    if (r.quietHours.enabled && r.quietHours.start === r.quietHours.end)
      ctx.addIssue({
        code: "custom",
        path: ["quietHours"],
        message: "Start och slut måste skilja sig",
      });
    const c = r.condition;
    if (c.category === "forecast") {
      if (c.metric !== "airTemperature" && c.threshold < 0)
        ctx.addIssue({
          code: "custom",
          path: ["condition", "threshold"],
          message: "Värdet får inte vara negativt",
        });
      if (c.metric === "relativeHumidity" && c.threshold > 100)
        ctx.addIssue({
          code: "custom",
          path: ["condition", "threshold"],
          message: "Luftfuktighet anges i procent 0–100",
        });
      if (
        c.metric !== "airTemperature" &&
        c.operator === "lt" &&
        c.metric !== "relativeHumidity"
      )
        ctx.addIssue({
          code: "custom",
          path: ["condition", "operator"],
          message: "Denna parameter stöder endast övre gräns",
        });
    }
  });
export type NotificationRuleInput = z.infer<typeof NotificationRuleInputSchema>;
export type NotificationCondition = z.infer<typeof NotificationConditionSchema>;
export type OutageNotificationCondition = Extract<NotificationCondition, { category: 'power_outage' | 'water_outage' | 'heating_outage' | 'gas_outage' }>;
export function isOfferedNotificationCondition(c: NotificationCondition): boolean {
  return !isOutageCondition(c) || c.utilities.some(isOfferedUtility);
}

export function isOutageCondition(c: NotificationCondition): c is OutageNotificationCondition {
  return ['power_outage', 'water_outage', 'heating_outage', 'gas_outage'].includes(c.category);
}
export type NotificationRule = NotificationRuleInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export const RecipientInputSchema = z
  .object({ phone: z.string().trim().min(5).max(40), consent: z.boolean() })
  .strict();
export interface NotificationRecipient {
  id: string;
  maskedPhone: string;
  consent: boolean;
  verificationStatus: "pending" | "verified" | "expired";
  verificationExpiresAt: string | null;
}
export const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  queued: "Väntar på simulering",
  processing: "Simuleras",
  retry: "Simulering försöks igen",
  simulated: "Simulerad",
  simulated_failure: "Simulerat fel",
  unknown: "Okänt resultat – skickas inte igen",
  failed: "Misslyckad simulering",
  suppressed_cooldown: "Stoppad av frekvensgräns",
  suppressed_quiet_hours: "Stoppad av tysta timmar",
  suppressed_limit: "Stoppad av antalgräns",
  suppressed_cost: "Stoppad av kostnadsgräns",
  pending_verification: "Väntar på verifiering / samtycke",
  not_eligible: "Inte berättigad",
  delivery_disabled: "Leverans avstängd",
  accepted: "Accepterad av SMS-leverantör",
  sent: "Skickad till operatör",
  delivered: "Levererad (operatörskvitto)",
};
export interface NotificationActivity {
  id: string;
  status: string;
  createdAt: string;
  ruleName: string;
  propertyNames: string[];
  maskedPhone: string;
  parts: number;
  estimatedCostSek: number | null;
  isTest: boolean;
  verificationRequired: boolean;
  detail: string | null;
}
export interface NotificationUsage {
  simulated: number;
  parts: number;
  estimatedCostSek: number | null;
  realCostSek: number;
  dailyLimit: number;
  monthlyLimit: number;
  globalMonthlyCapSek: number;
  pricePerPartSek: number | null;
  retentionDays: number;
}
export interface NotificationDashboard {
  rules: NotificationRule[];
  recipients: NotificationRecipient[];
  properties: { id: string; name: string; groupIds: string[] }[];
  groups: PropertyGroup[];
  activity: NotificationActivity[];
  usage: NotificationUsage;
  canManage: boolean;
  mode: "simulated";
  categories: ReadonlyArray<Omit<(typeof NOTIFICATION_CATEGORIES)[number], 'enabled'> & { enabled: boolean }>;
}
