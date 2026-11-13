// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationDashboard,
  type NotificationRule,
} from "@fastighetsradar/domain";
import { SmsManagement } from "@/components/notifications/SmsManagement";

const p = "00000000-0000-4000-8000-000000000001",
  r = "00000000-0000-4000-8000-000000000002",
  id = "00000000-0000-4000-8000-000000000003";
const rule: NotificationRule = {
  id,
  name: "Orange varning",
  enabled: true,
  scope: "selected",
  propertyIds: [p],
  recipientIds: [r],
  condition: {
    category: "smhi_warning",
    levels: ["Orange", "Red"],
    updates: true,
    cancellations: false,
  },
  cooldownMinutes: 360,
  quietHours: {
    enabled: true,
    start: "22:00",
    end: "07:00",
    emergencyException: false,
  },
  groupProperties: true,
  dailyPropertyLimit: 3,
  dailyRecipientLimit: 5,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function data(): NotificationDashboard {
  return {
    canManage: true,
    mode: "simulated",
    rules: [],
    recipients: [
      {
        id: r,
        maskedPhone: "+46 ••• •• 4567",
        consent: true,
        verificationStatus: "pending",
        verificationExpiresAt: null,
      },
    ],
    properties: [{ id: p, name: "Sveavägen 42" }],
    activity: [],
    usage: {
      simulated: 0,
      parts: 0,
      estimatedCostSek: null,
      realCostSek: 0,
      dailyLimit: 20,
      monthlyLimit: 100,
      globalMonthlyCapSek: 0,
      pricePerPartSek: null,
      retentionDays: 30,
    },
    categories: NOTIFICATION_CATEGORIES,
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("SMS management dashboard", () => {
  it("renders real organization properties, pending verification and an unambiguous simulation mode", () => {
    render(<SmsManagement initial={data()} />);
    expect(screen.getByRole("heading", { name: "SMS-regler" })).toBeTruthy();
    expect(
      screen.getByText("Testläge – inga riktiga SMS skickas"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Sveavägen 42")).toBeTruthy();
    expect(screen.getByText(/Väntar på verifiering · Samtycke/)).toBeTruthy();
    expect(screen.queryByText("SMS delivered")).toBeNull();
  });
  it("persists selected property scope and rule configuration through the authenticated BFF", async () => {
    const initial = data();
    const calls: { path: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, init });
        return new Response(
          JSON.stringify(init?.method === "POST" ? { id } : initial),
          { status: 200 },
        );
      }),
    );
    const view = render(<SmsManagement initial={initial} />);
    fireEvent.change(screen.getByLabelText("Regelnamn"), {
      target: { value: "Min regel" },
    });
    fireEvent.click(screen.getByLabelText("Sveavägen 42"));
    fireEvent.click(screen.getByText("Spara regel"));
    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === "POST")).toBe(true),
    );
    const body = JSON.parse(
      calls.find((c) => c.init?.method === "POST")!.init!.body as string,
    );
    expect(body).toMatchObject({
      name: "Min regel",
      propertyIds: [p],
      recipientIds: [r],
      enabled: false,
    });
    view.unmount();
    render(
      <SmsManagement initial={{ ...initial, rules: [{ ...rule, ...body }] }} />,
    );
    expect(screen.getByText("Min regel")).toBeTruthy();
  });
  it("previews exact saved source text and displays retained simulation activity", async () => {
    const initial = data();
    initial.rules = [rule];
    initial.activity = [
      {
        id: "a",
        status: "simulated",
        ruleName: rule.name,
        propertyNames: ["Sveavägen 42"],
        maskedPhone: "+46 ••• •• 4567",
        parts: 2,
        estimatedCostSek: null,
        createdAt: new Date().toISOString(),
        isTest: true,
        verificationRequired: true,
        detail: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (path: string) =>
          new Response(
            JSON.stringify(
              path.endsWith("/preview")
                ? {
                    message:
                      "FastighetsRadar: Sveavägen 42. Officiell orange varning. Källa: SMHI.",
                    parts: 2,
                    estimatedCostSek: null,
                    eligible: true,
                  }
                : initial,
            ),
          ),
      ),
    );
    render(<SmsManagement initial={initial} />);
    fireEvent.click(screen.getByText("Öppna"));
    fireEvent.click(screen.getByText("Förhandsgranska sparad regel"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("SMS-förhandsgranskning").textContent,
      ).toContain("Källa: SMHI"),
    );
    expect(screen.getByText("Simulerad")).toBeTruthy();
    expect(screen.getByText(/gallras efter 30 dagar/)).toBeTruthy();
  });
  it("keeps read-only members from editing notification settings", () => {
    render(<SmsManagement initial={{ ...data(), canManage: false }} />);
    expect(screen.getByText("Spara regel").matches(":disabled")).toBe(true);
    expect(screen.getByText(/Du har läsbehörighet/)).toBeTruthy();
  });
});
