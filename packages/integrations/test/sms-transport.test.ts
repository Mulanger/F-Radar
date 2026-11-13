import { describe, expect, it, vi } from "vitest";
import { loadServerEnv } from "@fastighetsradar/config";
import {
  estimateSmsParts,
  FortySixElksSmsProvider,
  liveSmsPrerequisites,
  notificationTransport,
  parseElksResponse,
  serializeElksRequest,
  SimulatedSmsProvider,
} from "../src";
const message = {
  to: "+46701234567",
  message: "FastighetsRadar: Varning",
  dedupKey: "test",
};
describe("notification transports and encoding", () => {
  it("counts GSM extension septets and UTF-16 surrogate pairs conservatively", () => {
    expect(estimateSmsParts("^".repeat(80))).toBe(1);
    expect(estimateSmsParts("^".repeat(81))).toBe(2);
    expect(estimateSmsParts("😀".repeat(35))).toBe(1);
    expect(estimateSmsParts("😀".repeat(36))).toBe(2);
    expect(estimateSmsParts("åäöÅÄÖ")).toBe(1);
  });
  it("simulates deterministic outcomes without network", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const sms = new SimulatedSmsProvider();
    for (const [scenario, outcome] of [
      ["success", "simulated"],
      ["failure", "rejected"],
      ["timeout", "unknown"],
      ["unavailable", "unavailable"],
    ] as const)
      expect((await sms.send({ ...message, scenario })).outcome).toBe(outcome);
    expect(request).not.toHaveBeenCalled();
    expect(notificationTransport().name).toBe("simulated");
  });
  it("serializes form data, dryrun and callback URL correctly", () => {
    const form = serializeElksRequest(
      { ...message, message: "Å & +" },
      "FRadar",
      true,
      "https://example.test/callback",
    );
    expect(form.get("dryrun")).toBe("yes");
    expect(new URLSearchParams(form.toString()).get("message")).toBe("Å & +");
    expect(form.get("dontlog")).toBe("message");
    expect(form.get("whendelivered")).toBe("https://example.test/callback");
  });
  it("parses provider cost units and rejects malformed acceptance", () => {
    expect(
      parseElksResponse(
        { status: "created", parts: 2, estimated_cost: 10000 },
        true,
      ),
    ).toEqual({ outcome: "dryrun", parts: 2, costSek: 1 });
    expect(
      parseElksResponse(
        { status: "created", parts: 1, id: "s123", cost: 5000 },
        false,
      ),
    ).toMatchObject({ outcome: "accepted", providerId: "s123", costSek: 0.5 });
    expect(parseElksResponse({}, false).outcome).toBe("unknown");
  });
  it("does not contact 46elks without credentials or with live sending selected", async () => {
    const request = vi.fn();
    expect(
      (
        await new FortySixElksSmsProvider(loadServerEnv({}), request).send(
          message,
        )
      ).outcome,
    ).toBe("disabled");
    expect(
      (
        await new FortySixElksSmsProvider(
          loadServerEnv({
            SMS_PROVIDER: "46elks",
            SMS_DRY_RUN: "false",
            ELKS_API_USERNAME: "u",
            ELKS_API_PASSWORD: "p",
          }),
          request,
        ).send(message)
      ).code,
    ).toBe("phase4_live_lock");
    expect(request).not.toHaveBeenCalled();
  });
  it("supports mocked authenticated dryrun, error mapping and uncertain timeouts", async () => {
    const env = loadServerEnv({
      SMS_PROVIDER: "46elks",
      ELKS_API_USERNAME: "u",
      ELKS_API_PASSWORD: "p",
    });
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ status: "created", parts: 1, estimated_cost: 5000 }),
          { status: 200 },
        ),
    );
    expect(
      (await new FortySixElksSmsProvider(env, request).send(message)).outcome,
    ).toBe("dryrun");
    expect(request.mock.calls[0][1]).toMatchObject({
      headers: {
        authorization: "Basic dTpw",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    for (const [status, outcome] of [
      [401, "rejected"],
      [429, "rejected"],
      [503, "unknown"],
    ] as const)
      expect(
        (
          await new FortySixElksSmsProvider(
            env,
            async () => new Response("", { status }),
          ).send(message)
        ).outcome,
      ).toBe(outcome);
    expect(
      (
        await new FortySixElksSmsProvider(env, async () => {
          throw new Error("timeout");
        }).send(message)
      ).outcome,
    ).toBe("unknown");
    expect(
      liveSmsPrerequisites(env, {
        verified: true,
        optedIn: true,
        budgetChecked: true,
      }),
    ).toBe(false);
  });
});
