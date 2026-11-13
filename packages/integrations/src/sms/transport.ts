import { z } from "zod";
import { resolveSmsMode, type ServerEnv } from "@fastighetsradar/config";

export type SimulationScenario =
  | "success"
  | "failure"
  | "timeout"
  | "unavailable";
export interface TransportMessage {
  to: string;
  message: string;
  dedupKey: string;
  scenario?: SimulationScenario;
}
export type TransportResult = {
  outcome:
    | "simulated"
    | "rejected"
    | "unavailable"
    | "unknown"
    | "accepted"
    | "dryrun"
    | "disabled";
  providerId?: string;
  parts?: number;
  costSek?: number;
  code?: string;
};
export interface NotificationTransport {
  readonly name: "simulated" | "46elks";
  send(message: TransportMessage): Promise<TransportResult>;
}

/** Pure deterministic fake. It never calls fetch or a carrier. Durable attempts belong to the outbox. */
export class SimulatedSmsProvider implements NotificationTransport {
  readonly name = "simulated";
  async send(m: TransportMessage): Promise<TransportResult> {
    switch (m.scenario ?? "success") {
      case "failure":
        return { outcome: "rejected", code: "simulated_failure" };
      case "timeout":
        return { outcome: "unknown", code: "simulated_timeout" };
      case "unavailable":
        return { outcome: "unavailable", code: "simulated_unavailable" };
      default:
        return { outcome: "simulated" };
    }
  }
}

export function serializeElksRequest(
  m: TransportMessage,
  sender: string,
  dryrun: boolean,
  callback?: string,
): URLSearchParams {
  const form = new URLSearchParams({
    from: sender,
    to: m.to,
    message: m.message,
    dontlog: "message",
  });
  if (dryrun) form.set("dryrun", "yes");
  if (callback) form.set("whendelivered", callback);
  return form;
}
const ResponseSchema = z.object({
  id: z.string().optional(),
  status: z.enum(["created", "sent", "failed", "delivered"]),
  parts: z.number().int().positive(),
  cost: z.number().int().nonnegative().optional(),
  estimated_cost: z.number().int().nonnegative().optional(),
});
export function parseElksResponse(
  raw: unknown,
  dryrun: boolean,
): TransportResult {
  const p = ResponseSchema.safeParse(raw);
  if (!p.success) return { outcome: "unknown", code: "invalid_response" };
  const d = p.data;
  if (dryrun)
    return d.estimated_cost === undefined
      ? { outcome: "unknown", code: "missing_estimate" }
      : {
          outcome: "dryrun",
          parts: d.parts,
          costSek: d.estimated_cost / 10000,
        };
  if (!d.id) return { outcome: "unknown", code: "missing_provider_id" };
  if (d.status === "failed")
    return { outcome: "rejected", code: "provider_failed" };
  return {
    outcome: "accepted",
    providerId: d.id,
    parts: d.parts,
    costSek: d.cost === undefined ? undefined : d.cost / 10000,
  };
}

/** Prepared adapter. Phase 4 has an additional code-level live lock, even with all env gates set. */
export class FortySixElksSmsProvider implements NotificationTransport {
  readonly name = "46elks";
  constructor(
    private env: ServerEnv,
    private request: typeof fetch = fetch,
  ) {}
  async send(m: TransportMessage): Promise<TransportResult> {
    if (
      !this.env.ELKS_API_USERNAME ||
      !this.env.ELKS_API_PASSWORD ||
      this.env.SMS_PROVIDER !== "46elks"
    )
      return { outcome: "disabled", code: "missing_credentials_or_provider" };
    // Deliberately immutable in this phase. Removing this requires a reviewed activation release.
    if (!this.env.SMS_DRY_RUN)
      return { outcome: "disabled", code: "phase4_live_lock" };
    try {
      const r = await this.request("https://api.46elks.com/a1/sms", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `Basic ${Buffer.from(`${this.env.ELKS_API_USERNAME}:${this.env.ELKS_API_PASSWORD}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: serializeElksRequest(m, this.env.SMS_SENDER, true),
      });
      if (!r.ok) {
        // 5xx / network errors are uncertain; never automatically resend a potentially accepted paid SMS.
        if (r.status >= 500)
          return { outcome: "unknown", code: "provider_5xx" };
        return {
          outcome: "rejected",
          code:
            r.status === 401 || r.status === 403
              ? "authentication"
              : r.status === 429
                ? "rate_limited"
                : "invalid_request",
        };
      }
      return parseElksResponse(await r.json(), true);
    } catch {
      return { outcome: "unknown", code: "timeout_or_network" };
    }
  }
}

export function liveSmsPrerequisites(
  env: ServerEnv,
  evidence: { verified: boolean; optedIn: boolean; budgetChecked: boolean },
): boolean {
  return (
    resolveSmsMode(env) === "live" &&
    evidence.verified &&
    evidence.optedIn &&
    evidence.budgetChecked
  );
}

/** The production scheduler ALWAYS selects the local simulator in Phase 4. */
export function notificationTransport(): NotificationTransport {
  return new SimulatedSmsProvider();
}
