import { timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import { z } from "zod";
import type { Queryable } from "@fastighetsradar/db";
import type { ServerEnv } from "@fastighetsradar/config";
import {
  NOTIFICATION_CATEGORIES,
  NotificationRuleInputSchema,
  RecipientInputSchema,
} from "@fastighetsradar/domain";
import { orgContext } from "../auth";
import { HttpProblem } from "../errors";
import { createRateLimiter } from "../rate-limit";
import { NotificationService } from "../notifications/service";
import {
  loadRules,
  notificationTransaction,
  publicRecipient,
  publicRule,
  saveRule,
  type RecipientRow,
} from "../notifications/store";
import {
  codeMatches,
  FakeVerificationProvider,
  newVerificationCode,
  normalizeSwedishPhone,
  UnavailableVerificationProvider,
  verificationHash,
  type PhoneVerificationProvider,
} from "../notifications/verification";

export function canManageNotifications(req: FastifyRequest): boolean {
  return req.auth?.orgRole === "org:admin";
}
interface Deps {
  db: Queryable | null;
  env: ServerEnv;
  requireOrg: preHandlerHookHandler;
  verification?: PhoneVerificationProvider;
}
const Id = z.object({ id: z.string().uuid() });
export function registerNotificationRoutes(app: FastifyInstance, deps: Deps) {
  const service = deps.db ? new NotificationService(deps.db, deps.env) : null;
  const requireService = () => {
    if (!service) throw new HttpProblem(503, "Database unavailable");
    return service;
  };
  const db = () => requireService().db;
  const verification =
    deps.verification ?? new UnavailableVerificationProvider();
  if (
    deps.env.NODE_ENV === "production" &&
    verification instanceof FakeVerificationProvider
  )
    throw new Error("Fake verification forbidden in production");
  const writes = createRateLimiter({ capacity: 20, refillPerSecond: 0.2 });
  const tests = createRateLimiter({ capacity: 3, refillPerSecond: 1 / 60 });
  const admin: preHandlerHookHandler = async (req) => {
    if (!canManageNotifications(req))
      throw new HttpProblem(
        403,
        "Endast organisationsadministratörer får ändra SMS-inställningar",
      );
    if (!writes.take(req.auth!.userId))
      throw new HttpProblem(429, "För många ändringar. Försök senare.");
  };
  const read = { preHandler: deps.requireOrg };
  const write = { preHandler: [deps.requireOrg, admin] };
  app.get("/v1/notifications", read, async (req) =>
    requireService().dashboard(
      orgContext(req).organizationId,
      canManageNotifications(req),
    ),
  );
  app.get("/v1/notifications/categories", read, async () => ({
    categories: NOTIFICATION_CATEGORIES,
  }));
  app.get("/v1/notifications/rules", read, async (req) => ({
    rules: (await loadRules(db(), orgContext(req).organizationId)).map(
      publicRule,
    ),
  }));
  app.post("/v1/notifications/rules", write, async (req, reply) => {
    const id = await saveRule(
      db(),
      orgContext(req).organizationId,
      NotificationRuleInputSchema.parse(req.body),
    );
    reply.code(201);
    return { id };
  });
  app.patch("/v1/notifications/rules/:id", write, async (req) => {
    const { id } = Id.parse(req.params),
      org = orgContext(req).organizationId;
    // Toggle-only updates preserve the rest of the server-validated configuration.
    const toggle = z
      .object({ enabled: z.boolean() })
      .strict()
      .safeParse(req.body);
    let input;
    if (toggle.success) {
      const rule = (await loadRules(db(), org)).find((r) => r.id === id);
      if (!rule) throw new HttpProblem(404, "Rule not found");
      input = NotificationRuleInputSchema.parse({
        ...rule.config,
        enabled: toggle.data.enabled,
      });
    } else input = NotificationRuleInputSchema.parse(req.body);
    return { id: await saveRule(db(), org, input, id) };
  });
  app.delete("/v1/notifications/rules/:id", write, async (req, reply) => {
    const result = await notificationTransaction(db(), (tx) =>
      tx.query(
        "DELETE FROM alert_rules WHERE organization_id=$1 AND id=$2 AND sms_version=1 RETURNING id",
        [orgContext(req).organizationId, Id.parse(req.params).id],
      ),
    );
    if (!result.rows.length) throw new HttpProblem(404, "Rule not found");
    return reply.code(204).send();
  });
  app.get("/v1/notifications/recipients", read, async (req) => ({
    recipients: (
      await db().query<RecipientRow>(
        "SELECT * FROM sms_recipients WHERE organization_id=$1",
        [orgContext(req).organizationId],
      )
    ).rows.map((r) => publicRecipient(r)),
  }));
  const saveRecipient = async (req: FastifyRequest, id?: string) => {
    const input = RecipientInputSchema.parse(req.body),
      phone = normalizeSwedishPhone(input.phone),
      ctx = orgContext(req);
    return notificationTransaction(db(), async (tx) => {
      const exists = (
        await tx.query(
          "SELECT id FROM sms_recipients WHERE organization_id=$1 AND phone_e164=$2 AND ($3::uuid IS NULL OR id<>$3)",
          [ctx.organizationId, phone, id ?? null],
        )
      ).rows.length;
      if (exists)
        throw new HttpProblem(409, "Numret finns redan i organisationen");
      if (
        !id &&
        Number(
          (
            await tx.query<{ n: string }>(
              "SELECT count(*) AS n FROM sms_recipients WHERE organization_id=$1",
              [ctx.organizationId],
            )
          ).rows[0]!.n,
        ) >= 10
      )
        throw new HttpProblem(409, "Högst 10 mottagare");
      const params = [ctx.organizationId, phone, input.consent, ctx.userId];
      let row: RecipientRow | undefined;
      if (id) {
        row = (
          await tx.query<RecipientRow>(
            `UPDATE sms_recipients SET phone_e164=$2,consent_at=CASE WHEN $3 THEN coalesce(consent_at,now()) ELSE NULL END,
          verified_at=CASE WHEN phone_e164=$2 THEN verified_at ELSE NULL END,verification_expires_at=CASE WHEN phone_e164=$2 THEN verification_expires_at ELSE NULL END,
          verification_method=CASE WHEN phone_e164=$2 THEN verification_method ELSE NULL END,challenge_hash=NULL,challenge_expires_at=NULL,challenge_attempts=0,updated_at=now()
          WHERE organization_id=$1 AND id=$4 RETURNING *`,
            [ctx.organizationId, phone, input.consent, id],
          )
        ).rows[0];
        await tx.query(
          "UPDATE notification_outbox SET status='delivery_disabled',message=NULL,detail='Mottagaren ändrades' WHERE organization_id=$1 AND recipient_id=$2 AND status IN ('queued','retry')",
          [ctx.organizationId, id],
        );
      } else
        row = (
          await tx.query<RecipientRow>(
            `INSERT INTO sms_recipients(organization_id,phone_e164,consent_at,created_by) VALUES($1,$2,CASE WHEN $3 THEN now() ELSE NULL END,$4) RETURNING *`,
            params,
          )
        ).rows[0];
      if (!row) throw new HttpProblem(404, "Recipient not found");
      return { recipient: publicRecipient(row) };
    });
  };
  app.post("/v1/notifications/recipients", write, async (req, reply) => {
    const r = await saveRecipient(req);
    reply.code(201);
    return r;
  });
  app.patch("/v1/notifications/recipients/:id", write, async (req) =>
    saveRecipient(req, Id.parse(req.params).id),
  );
  app.delete("/v1/notifications/recipients/:id", write, async (req, reply) => {
    const r = await notificationTransaction(db(), (tx) =>
      tx.query(
        "DELETE FROM sms_recipients WHERE organization_id=$1 AND id=$2 RETURNING id",
        [orgContext(req).organizationId, Id.parse(req.params).id],
      ),
    );
    if (!r.rows.length) throw new HttpProblem(404, "Recipient not found");
    return reply.code(204).send();
  });
  app.post(
    "/v1/notifications/recipients/:id/verification",
    write,
    async (req) => {
      const org = orgContext(req).organizationId,
        id = Id.parse(req.params).id;
      const row = (
        await db().query<RecipientRow>(
          "SELECT * FROM sms_recipients WHERE organization_id=$1 AND id=$2",
          [org, id],
        )
      ).rows[0];
      if (!row) throw new HttpProblem(404, "Recipient not found");
      if (!verification.available)
        return {
          status: "pending",
          channelAvailable: false,
          message:
            "Verifiering öppnas när en riktig verifieringskanal finns. Inget SMS skickades.",
        };
      const code = newVerificationCode();
      const changed = await db().query(
        `UPDATE sms_recipients SET challenge_hash=$3,challenge_expires_at=now()+interval '10 minutes',challenge_attempts=0,challenge_requested_at=now()
      WHERE organization_id=$1 AND id=$2 AND (challenge_requested_at IS NULL OR challenge_requested_at<now()-interval '1 minute') RETURNING id`,
        [org, id, verificationHash(id, row.phone_e164, code)],
      );
      if (!changed.rows.length)
        throw new HttpProblem(429, "Vänta innan en ny kod begärs");
      await verification.begin(row.phone_e164, code);
      return {
        status: "pending",
        channelAvailable: true,
        expiresInSeconds: 600,
      };
    },
  );
  app.post(
    "/v1/notifications/recipients/:id/verification/complete",
    write,
    async (req) => {
      const org = orgContext(req).organizationId,
        id = Id.parse(req.params).id,
        code = z
          .object({ code: z.string().regex(/^\d{6}$/) })
          .strict()
          .parse(req.body).code;
      if (!verification.available)
        throw new HttpProblem(503, "Verifieringskanalen är inte tillgänglig");
      // Wrong attempts must COMMIT; throwing inside the transaction would roll the limit back.
      const verified = await notificationTransaction(db(), async (tx) => {
        const r = (
          await tx.query<RecipientRow>(
            "SELECT * FROM sms_recipients WHERE organization_id=$1 AND id=$2 FOR UPDATE",
            [org, id],
          )
        ).rows[0];
        if (!r) throw new HttpProblem(404, "Recipient not found");
        if (
          !r.challenge_hash ||
          !r.challenge_expires_at ||
          r.challenge_expires_at <= new Date() ||
          r.challenge_attempts >= 5
        )
          return false;
        await tx.query(
          "UPDATE sms_recipients SET challenge_attempts=challenge_attempts+1 WHERE organization_id=$1 AND id=$2",
          [org, id],
        );
        if (
          !codeMatches(
            r.challenge_hash,
            verificationHash(id, r.phone_e164, code),
          )
        )
          return false;
        await tx.query(
          `UPDATE sms_recipients SET verified_at=now(),verification_expires_at=now()+interval '180 days',verification_method=$3,challenge_hash=NULL,challenge_expires_at=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
          [
            org,
            id,
            verification instanceof FakeVerificationProvider
              ? "fake_test"
              : "otp",
          ],
        );
        return true;
      });
      if (!verified)
        throw new HttpProblem(400, "Ogiltig eller utgången verifieringskod");
      return { status: "verified" };
    },
  );
  app.get("/v1/notifications/activity", read, async (req) => ({
    activity: await requireService().activity(orgContext(req).organizationId),
  }));
  app.get("/v1/notifications/usage", read, async (req) =>
    requireService().usage(orgContext(req).organizationId),
  );
  const previews = createRateLimiter({ capacity: 10, refillPerSecond: 1 / 10 });
  app.post("/v1/notifications/rules/:id/preview", read, async (req) => {
    if (!previews.take(req.auth!.userId))
      throw new HttpProblem(
        429,
        "För många förhandsgranskningar. Försök senare.",
      );
    return requireService().preview(
      orgContext(req).organizationId,
      Id.parse(req.params).id,
    );
  });
  app.post("/v1/notifications/rules/:id/test", write, async (req) => {
    const org = orgContext(req).organizationId;
    if (!tests.take(org))
      throw new HttpProblem(429, "Testgränsen är nådd. Försök senare.");
    const { scenario } = z
      .object({
        scenario: z
          .enum(["success", "failure", "timeout", "unavailable"])
          .default("success"),
      })
      .strict()
      .parse(req.body ?? {});
    const generated = await requireService().evaluateOrganization(
      org,
      Id.parse(req.params).id,
      scenario,
    );
    // The regular scheduler processes these durable records. Requests cannot call a gateway.
    return { generated, mode: "simulated" };
  });
  app.get("/v1/notifications/links/:key", read, async (req) => {
    const { key } = z
      .object({ key: z.string().regex(/^[a-f0-9]{16}$/) })
      .parse(req.params);
    const r = (
      await db().query<{ id: string }>(
        "SELECT id FROM properties WHERE organization_id=$1 AND notification_link_key=$2",
        [orgContext(req).organizationId, key],
      )
    ).rows[0];
    if (!r) throw new HttpProblem(404, "Property not found");
    return r;
  });
  app.patch("/v1/notifications/properties/:id", write, async (req) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const r = await db().query(
      "UPDATE properties SET sms_notifications_paused=NOT $3 WHERE organization_id=$1 AND id=$2 RETURNING id",
      [orgContext(req).organizationId, Id.parse(req.params).id, enabled],
    );
    if (!r.rows.length) throw new HttpProblem(404, "Property not found");
    return { enabled };
  });

  // No implied signatures: official docs support Basic Auth on delivery callback URLs.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 4096 },
    (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  const callbacks = createRateLimiter({ capacity: 60, refillPerSecond: 1 });
  app.post("/v1/webhooks/46elks", async (req, reply) => {
    const secret = deps.env.SMS_WEBHOOK_AUTH_SECRET;
    const expected = secret
      ? Buffer.from(`Basic ${Buffer.from(`elks:${secret}`).toString("base64")}`)
      : null;
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (
      !expected ||
      secret!.length < 32 ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    )
      throw new HttpProblem(401, "Webhook authentication required");
    if (!callbacks.take("46elks"))
      throw new HttpProblem(429, "Callback rate limited");
    if (
      !req.headers["content-type"]?.startsWith(
        "application/x-www-form-urlencoded",
      )
    )
      throw new HttpProblem(415, "Form-urlencoded required");
    const body = z
      .object({
        id: z.string().regex(/^s[a-f0-9]{32}$/),
        status: z.enum(["sent", "delivered", "failed"]),
        delivered: z.string().max(40).optional(),
      })
      .strict()
      .parse(req.body);
    await notificationTransaction(db(), async (tx) => {
      const n = (
        await tx.query<{ id: string; status: string }>(
          "SELECT id,status FROM notification_outbox WHERE provider_id=$1 AND provider='46elks' FOR UPDATE",
          [body.id],
        )
      ).rows[0];
      if (!n) return;
      const inserted = await tx.query(
        "INSERT INTO sms_delivery_callbacks(notification_id,status) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING notification_id",
        [n.id, body.status],
      );
      if (!inserted.rows.length || ["delivered", "failed"].includes(n.status))
        return;
      await tx.query(
        "UPDATE notification_outbox SET status=$2,updated_at=now() WHERE id=$1 AND status IN ('accepted','sent','unknown')",
        [n.id, body.status],
      );
    });
    return reply.code(204).send();
  });
}
