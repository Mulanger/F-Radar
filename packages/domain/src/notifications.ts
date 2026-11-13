import { z } from "zod";

export const NOTIFICATION_CATEGORIES = [
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
      "Nya betydande trafikstörningar och materiella ändringar inom vald radie (högst 2 km). Innebär inte att fastigheten är otillgänglig.",
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

export const NotificationConditionSchema = z.discriminatedUnion("category", [
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
      category: z.literal("traffic"),
      radiusMeters: z.number().int().min(100).max(2000),
      updates: z.boolean(),
    })
    .strict(),
]);
export const NotificationRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(false),
    scope: z.enum(["selected", "all_current", "all_future"]),
    propertyIds: z.array(z.string().uuid()).max(500),
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
  properties: { id: string; name: string }[];
  activity: NotificationActivity[];
  usage: NotificationUsage;
  canManage: boolean;
  mode: "simulated";
  categories: typeof NOTIFICATION_CATEGORIES;
}
