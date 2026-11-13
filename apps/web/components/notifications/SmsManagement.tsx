"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  NotificationCondition,
  NotificationDashboard,
  NotificationRecipient,
  NotificationRule,
  NotificationRuleInput,
} from "@fastighetsradar/domain";
import { NOTIFICATION_STATUS_LABELS } from "@fastighetsradar/domain";
import { C, card, cardSub, cardTitle } from "@/lib/design/tokens";
import { Toggle } from "../ui/Toggle";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid rgba(20,23,26,.13)",
  borderRadius: 12,
  background: C.white,
  color: C.ink,
  font: "inherit",
  fontSize: 13,
};
const button: React.CSSProperties = {
  border: "1px solid rgba(20,23,26,.12)",
  borderRadius: 18,
  padding: "9px 15px",
  background: C.white,
  color: C.ink,
  cursor: "pointer",
  fontSize: 13,
};
const primary = { ...button, background: C.ink, color: C.white };
const row: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};
const section: React.CSSProperties = { ...card, padding: 24 };
const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
  fontSize: 12.5,
  color: C.text2,
  flex: "1 1 180px",
};
const fmt = (date: string) =>
  new Date(date).toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "short",
    timeStyle: "short",
  });
const conditionDefault = (
  category: NotificationCondition["category"],
): NotificationCondition =>
  category === "smhi_warning"
    ? {
        category,
        levels: ["Orange", "Red"],
        updates: true,
        cancellations: false,
      }
    : category === "forecast"
      ? {
          category,
          metric: "precipitationMean",
          operator: "gt",
          threshold: 25,
          hours: 24,
          hysteresis: 2,
        }
      : category === "vma"
        ? { category, updates: true, cancellations: false }
        : { category, radiusMeters: 1000, updates: true };
function newRule(
  propertyId: string | undefined,
  recipientIds: string[],
): NotificationRuleInput {
  return {
    name: "",
    enabled: false,
    scope: "selected",
    propertyIds: propertyId ? [propertyId] : [],
    recipientIds,
    condition: conditionDefault("smhi_warning"),
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
  };
}
export async function notificationRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api/app/notifications${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok)
    throw new Error(
      data?.detail ??
        data?.errors?.map((e: { message: string }) => e.message).join(", ") ??
        data?.title ??
        "Det gick inte att spara",
    );
  return data as T;
}

export function SmsManagement({
  initial,
  propertyId,
}: {
  initial: NotificationDashboard;
  propertyId?: string;
}) {
  const [data, setData] = useState(initial),
    [draft, setDraft] = useState<NotificationRuleInput>(() =>
      newRule(
        propertyId,
        initial.recipients.map((r) => r.id),
      ),
    ),
    [editing, setEditing] = useState<string | null>(null);
  const [phone, setPhone] = useState(""),
    [consent, setConsent] = useState(false),
    [recipientEdit, setRecipientEdit] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{
      message: string;
      parts: number;
      estimatedCostSek: number | null;
      eligible: boolean;
    } | null>(null);
  const [scenario, setScenario] = useState("success"),
    [verificationId, setVerificationId] = useState<string | null>(null),
    [code, setCode] = useState("");
  const reload = useCallback(async () => {
    const d = await notificationRequest<NotificationDashboard>("");
    setData(d);
  }, []);
  useEffect(() => {
    const t = setInterval(() => void reload().catch(() => undefined), 15000);
    return () => clearInterval(t);
  }, [reload]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Åtgärden misslyckades");
    } finally {
      setBusy(false);
    }
  };
  const update = <K extends keyof NotificationRuleInput>(
    key: K,
    value: NotificationRuleInput[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPreview(null);
  };
  const updateCondition = (patch: Record<string, unknown>) =>
    update("condition", {
      ...draft.condition,
      ...patch,
    } as NotificationCondition);
  const edit = (r: NotificationRule) => {
    const { id, createdAt: _created, updatedAt: _updated, ...input } = r;
    setDraft(input);
    setEditing(id);
    setPreview(null);
    setNotice("");
  };
  const disabled = busy || !data.canManage;
  const selectedCount = new Set(
    data.rules
      .filter((r) => r.enabled)
      .flatMap((r) =>
        r.scope === "all_future"
          ? data.properties.map((p) => p.id)
          : r.propertyIds,
      ),
  ).size;
  const save = () =>
    act(async () => {
      const { id } = await notificationRequest<{ id: string }>(
        editing ? `/rules/${editing}` : "/rules",
        editing ? "PATCH" : "POST",
        draft,
      );
      setEditing(id);
      setNotice("Regeln är sparad. Testläge är aktivt.");
    });
  const startVerification = (r: NotificationRecipient) =>
    act(async () => {
      const result = await notificationRequest<{
        channelAvailable: boolean;
        message?: string;
      }>(`/recipients/${r.id}/verification`, "POST", {});
      if (result.channelAvailable) setVerificationId(r.id);
      setNotice(result.message ?? "Ange verifieringskoden.");
    });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        animation: "frFade .45s ease both",
      }}
    >
      <div>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: "-.035em",
            margin: "0 0 8px",
          }}
        >
          SMS-regler
        </h1>
        <p style={{ ...cardSub, margin: 0 }}>
          Bevaka dina fastigheter med egna villkor och tydliga gränser.
        </p>
      </div>
      <div
        role="status"
        style={{
          ...card,
          padding: "15px 20px",
          background: "oklch(0.96 0.035 155)",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        Testläge – inga riktiga SMS skickas
      </div>
      {!data.canManage && (
        <p style={cardSub}>
          Du har läsbehörighet. En organisationsadministratör kan ändra
          inställningarna.
        </p>
      )}
      {error && (
        <div role="alert" style={{ color: "#ab332e", padding: 12 }}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ color: C.text2, padding: 12 }}>
          {notice}
        </div>
      )}
      <section
        aria-label="Översikt"
        style={{ ...section, ...row, gap: 28, justifyContent: "space-between" }}
      >
        {[
          [String(data.rules.length), "Konfigurerade regler"],
          [String(data.rules.filter((r) => r.enabled).length), "Aktiva regler"],
          [String(selectedCount), "Bevakade fastigheter"],
          [String(data.usage.simulated), "Genererade simuleringar"],
          [String(data.usage.parts), "Beräknade SMS-delar"],
        ].map(([value, label]) => (
          <div key={label}>
            <div
              style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-.03em" }}
            >
              {value}
            </div>
            <div style={cardSub}>{label}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {data.recipients.some((r) => r.verificationStatus === "verified")
              ? "Verifierat nummer"
              : data.recipients.length
                ? "Väntar på verifiering"
                : "Inget nummer"}
          </div>
          <div style={cardSub}>Leverans: simulering</div>
        </div>
      </section>
      <section style={section} aria-labelledby="recipient-heading">
        <h2 id="recipient-heading" style={{ ...cardTitle, margin: "0 0 5px" }}>
          Mottagare
        </h2>
        <p style={{ ...cardSub, margin: "0 0 16px" }}>
          Svenska mobilnummer. Nummer verifieras först när en riktig
          verifieringskanal finns.
        </p>
        {data.recipients.map((r) => (
          <div
            key={r.id}
            style={{
              ...row,
              padding: "12px 0",
              borderBottom: "1px solid rgba(20,23,26,.06)",
            }}
          >
            <strong style={{ fontSize: 14 }}>{r.maskedPhone}</strong>
            <span style={cardSub}>
              {r.verificationStatus === "verified"
                ? "Verifierat"
                : r.verificationStatus === "expired"
                  ? "Verifiering utgången"
                  : "Väntar på verifiering"}{" "}
              · {r.consent ? "Samtycke registrerat" : "Samtycke saknas"}
            </span>
            <div style={{ marginLeft: "auto", ...row }}>
              <button
                disabled={disabled}
                style={button}
                onClick={() => {
                  setRecipientEdit(r.id);
                  setPhone("");
                  setConsent(r.consent);
                }}
              >
                Ändra
              </button>
              <button
                disabled={disabled}
                style={button}
                onClick={() => void startVerification(r)}
              >
                Verifiera
              </button>
              <button
                disabled={disabled}
                style={button}
                onClick={() =>
                  void act(async () => {
                    await notificationRequest(`/recipients/${r.id}`, "DELETE");
                    setDraft((d) => ({
                      ...d,
                      recipientIds: d.recipientIds.filter((id) => id !== r.id),
                    }));
                  })
                }
              >
                Ta bort
              </button>
            </div>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const result = await notificationRequest<{
                recipient: NotificationRecipient;
              }>(
                recipientEdit ? `/recipients/${recipientEdit}` : "/recipients",
                recipientEdit ? "PATCH" : "POST",
                { phone, consent },
              );
              setDraft((d) => ({
                ...d,
                recipientIds: [
                  ...new Set([...d.recipientIds, result.recipient.id]),
                ],
              }));
              setPhone("");
              setConsent(false);
              setRecipientEdit(null);
              setNotice(
                "Numret sparades. Riktig leverans kräver separat verifiering.",
              );
            });
          }}
        >
          <fieldset
            disabled={disabled}
            style={{ border: 0, padding: 0, margin: "18px 0 0" }}
          >
            <div style={row}>
              <label style={field}>
                {recipientEdit ? "Ersätt mobilnummer" : "Lägg till mobilnummer"}
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="070 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  style={inputStyle}
                />
              </label>
              <label style={{ ...row, fontSize: 13, flex: "2 1 300px" }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Jag godkänner aviseringar för detta nummer.
              </label>
              <button style={primary}>
                {recipientEdit ? "Spara nummer" : "Lägg till"}
              </button>
              {recipientEdit && (
                <button
                  type="button"
                  style={button}
                  onClick={() => {
                    setRecipientEdit(null);
                    setPhone("");
                  }}
                >
                  Avbryt
                </button>
              )}
            </div>
          </fieldset>
        </form>
        {verificationId && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await notificationRequest(
                  `/recipients/${verificationId}/verification/complete`,
                  "POST",
                  { code },
                );
                setVerificationId(null);
                setCode("");
                setNotice("Numret verifierades.");
              });
            }}
            style={{ ...row, marginTop: 14 }}
          >
            <label style={field}>
              Verifieringskod
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                style={inputStyle}
              />
            </label>
            <button disabled={disabled} style={button}>
              Bekräfta kod
            </button>
          </form>
        )}
      </section>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <section
          style={{ ...section, flex: "1 1 300px" }}
          aria-labelledby="saved-heading"
        >
          <div style={{ ...row, justifyContent: "space-between" }}>
            <h2 id="saved-heading" style={{ ...cardTitle, margin: 0 }}>
              Sparade regler
            </h2>
            <button
              style={button}
              disabled={disabled}
              onClick={() => {
                setDraft(
                  newRule(
                    propertyId,
                    data.recipients.map((r) => r.id),
                  ),
                );
                setEditing(null);
                setPreview(null);
              }}
            >
              Ny regel
            </button>
          </div>
          {!data.rules.length && (
            <p style={cardSub}>
              Inga regler ännu. Lägg till ett nummer och välj vilka fastigheter
              du vill bevaka.
            </p>
          )}
          {data.rules.map((r) => (
            <div
              key={r.id}
              style={{
                padding: "16px 0",
                borderBottom: "1px solid rgba(20,23,26,.06)",
              }}
            >
              <div style={row}>
                <button
                  style={{
                    border: 0,
                    padding: 0,
                    background: "transparent",
                    fontSize: 14,
                    textAlign: "left",
                    cursor: "pointer",
                    color: C.ink,
                    flex: 1,
                  }}
                  onClick={() => edit(r)}
                >
                  {r.name}
                </button>
                <Toggle
                  on={r.enabled}
                  disabled={disabled}
                  label={`Aktivera ${r.name}`}
                  onToggle={() =>
                    void act(async () => {
                      await notificationRequest(`/rules/${r.id}`, "PATCH", {
                        enabled: !r.enabled,
                      });
                      if (editing === r.id)
                        setDraft((d) => ({ ...d, enabled: !r.enabled }));
                    })
                  }
                />
              </div>
              <div style={{ ...cardSub, marginTop: 7 }}>
                {
                  data.categories.find((c) => c.id === r.condition.category)
                    ?.label
                }{" "}
                ·{" "}
                {r.scope === "all_future"
                  ? "Alla nuvarande och framtida fastigheter"
                  : `${r.propertyIds.length} valda fastigheter`}
              </div>
              <div style={{ ...row, marginTop: 10 }}>
                <button style={button} onClick={() => edit(r)}>
                  Öppna
                </button>
                <button
                  style={button}
                  disabled={disabled}
                  onClick={() =>
                    void act(async () => {
                      await notificationRequest(`/rules/${r.id}`, "DELETE");
                      if (editing === r.id) {
                        setEditing(null);
                        setDraft(
                          newRule(
                            propertyId,
                            data.recipients.map((r) => r.id),
                          ),
                        );
                        setPreview(null);
                      }
                    })
                  }
                >
                  Ta bort
                </button>
              </div>
            </div>
          ))}
        </section>
        <section
          style={{ ...section, flex: "2 1 520px" }}
          aria-labelledby="rule-heading"
        >
          <h2 id="rule-heading" style={{ ...cardTitle, margin: "0 0 18px" }}>
            {editing ? "Redigera regel" : "Skapa regel"}
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset
              disabled={disabled}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div style={row}>
                <label style={field}>
                  Regelnamn
                  <input
                    style={inputStyle}
                    value={draft.name}
                    onChange={(e) => update("name", e.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label style={field}>
                  Kategori
                  <select
                    style={inputStyle}
                    value={draft.condition.category}
                    onChange={(e) =>
                      update(
                        "condition",
                        conditionDefault(
                          e.target.value as NotificationCondition["category"],
                        ),
                      )
                    }
                  >
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.enabled}>
                        {c.label}
                        {c.enabled ? "" : " – ej aktiverad"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p style={{ ...cardSub, margin: 0, lineHeight: 1.6 }}>
                {
                  data.categories.find((c) => c.id === draft.condition.category)
                    ?.explanation
                }
              </p>
              <label style={field}>
                Fastigheter
                <select
                  style={inputStyle}
                  value={draft.scope}
                  onChange={(e) => {
                    const scope = e.target
                      .value as NotificationRuleInput["scope"];
                    setDraft((d) => ({
                      ...d,
                      scope,
                      propertyIds:
                        scope === "all_current"
                          ? data.properties.map((p) => p.id)
                          : d.propertyIds,
                    }));
                    setPreview(null);
                  }}
                >
                  <option value="selected">Välj en eller flera</option>
                  <option value="all_current">
                    Alla nuvarande fastigheter (sparat urval)
                  </option>
                  <option value="all_future">
                    Alla nuvarande och framtida fastigheter
                  </option>
                </select>
              </label>
              {draft.scope === "all_future" ? (
                <p style={{ ...cardSub, margin: 0 }}>
                  Du väljer uttryckligen att även nya fastigheter ska omfattas
                  av regeln.
                </p>
              ) : (
                <div
                  role="group"
                  aria-label="Välj fastigheter"
                  style={{ ...row, maxHeight: 180, overflowY: "auto" }}
                >
                  {data.properties.map((p) => (
                    <label key={p.id} style={{ ...row, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={draft.propertyIds.includes(p.id)}
                        onChange={(e) =>
                          update(
                            "propertyIds",
                            e.target.checked
                              ? [...draft.propertyIds, p.id]
                              : draft.propertyIds.filter((id) => id !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                  {!data.properties.length && (
                    <span style={cardSub}>
                      Lägg först till en fastighet i portföljen.
                    </span>
                  )}
                </div>
              )}
              <div role="group" aria-label="Välj mottagare" style={row}>
                {data.recipients.map((r) => (
                  <label key={r.id} style={{ ...row, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={draft.recipientIds.includes(r.id)}
                      onChange={(e) =>
                        update(
                          "recipientIds",
                          e.target.checked
                            ? [...draft.recipientIds, r.id]
                            : draft.recipientIds.filter((id) => id !== r.id),
                        )
                      }
                    />
                    {r.maskedPhone}
                  </label>
                ))}
              </div>
              {draft.condition.category === "smhi_warning" && (
                <div role="group" aria-label="Varningsnivåer" style={row}>
                  {(["Yellow", "Orange", "Red"] as const).map((level, i) => (
                    <label style={{ ...row, fontSize: 13 }} key={level}>
                      <input
                        type="checkbox"
                        checked={
                          draft.condition.category === "smhi_warning" &&
                          draft.condition.levels.includes(level)
                        }
                        onChange={(e) => {
                          const c = draft.condition;
                          if (c.category === "smhi_warning")
                            updateCondition({
                              levels: e.target.checked
                                ? [...c.levels, level]
                                : c.levels.filter((l) => l !== level),
                            });
                        }}
                      />
                      {["Gul", "Orange", "Röd"][i]}
                    </label>
                  ))}
                </div>
              )}
              {draft.condition.category === "forecast" && (
                <>
                  <div style={row}>
                    <label style={field}>
                      Prognosvärde
                      <select
                        style={inputStyle}
                        value={draft.condition.metric}
                        onChange={(e) => {
                          const metric = e.target.value;
                          updateCondition({
                            metric,
                            operator: "gt",
                            threshold:
                              metric === "airTemperature"
                                ? 0
                                : metric === "relativeHumidity"
                                  ? 90
                                  : 25,
                          });
                        }}
                      >
                        {[
                          ["precipitationMean", "Nederbörd (mm, summa)"],
                          ["windSpeed", "Vind (m/s, högsta)"],
                          ["windGust", "Byvind (m/s, högsta)"],
                          ["airTemperature", "Temperatur (°C)"],
                          ["relativeHumidity", "Luftfuktighet (%)"],
                        ].map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={field}>
                      Villkor
                      <select
                        style={inputStyle}
                        value={draft.condition.operator}
                        onChange={(e) =>
                          updateCondition({ operator: e.target.value })
                        }
                      >
                        <option value="gt">Över</option>
                        <option
                          value="lt"
                          disabled={
                            !["airTemperature", "relativeHumidity"].includes(
                              draft.condition.metric,
                            )
                          }
                        >
                          Under
                        </option>
                      </select>
                    </label>
                  </div>
                  <div style={row}>
                    <label style={field}>
                      Tröskel
                      <input
                        type="number"
                        step="0.1"
                        min={
                          draft.condition.metric === "airTemperature" ? -60 : 0
                        }
                        max={
                          draft.condition.metric === "relativeHumidity"
                            ? 100
                            : 500
                        }
                        required
                        style={inputStyle}
                        value={draft.condition.threshold}
                        onChange={(e) =>
                          updateCondition({ threshold: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label style={field}>
                      Prognosperiod (timmar)
                      <input
                        type="number"
                        min={1}
                        max={48}
                        required
                        style={inputStyle}
                        value={draft.condition.hours}
                        onChange={(e) =>
                          updateCondition({ hours: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label style={field}>
                      Hysteres (samma enhet)
                      <input
                        type="number"
                        min={0.1}
                        max={50}
                        step="0.1"
                        required
                        style={inputStyle}
                        value={draft.condition.hysteresis}
                        onChange={(e) =>
                          updateCondition({
                            hysteresis: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <p style={{ ...cardSub, margin: 0 }}>
                    Första prognosen blir en utgångspunkt. Avisering skapas vid
                    nästa nya tröskelpassage, inte vid varje uppdatering.
                  </p>
                </>
              )}
              {draft.condition.category === "traffic" && (
                <label style={field}>
                  Radie från fastigheten (meter)
                  <input
                    type="number"
                    min={100}
                    max={2000}
                    step={100}
                    required
                    style={inputStyle}
                    value={draft.condition.radiusMeters}
                    onChange={(e) =>
                      updateCondition({ radiusMeters: Number(e.target.value) })
                    }
                  />
                </label>
              )}
              {draft.condition.category !== "forecast" && (
                <label style={{ ...row, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.condition.updates}
                    onChange={(e) =>
                      updateCondition({ updates: e.target.checked })
                    }
                  />
                  Avisera även materiella uppdateringar
                </label>
              )}
              {(draft.condition.category === "smhi_warning" ||
                draft.condition.category === "vma") && (
                <label style={{ ...row, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.condition.cancellations}
                    onChange={(e) =>
                      updateCondition({ cancellations: e.target.checked })
                    }
                  />
                  Avisera även avslutade / återkallade varningar
                </label>
              )}
              <div style={row}>
                <label style={field}>
                  Minsta tid mellan aviseringar (minuter)
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    required
                    style={inputStyle}
                    value={draft.cooldownMinutes}
                    onChange={(e) =>
                      update("cooldownMinutes", Number(e.target.value))
                    }
                  />
                </label>
                <label style={field}>
                  Max per fastighet och dag
                  <input
                    type="number"
                    min={1}
                    max={20}
                    required
                    style={inputStyle}
                    value={draft.dailyPropertyLimit}
                    onChange={(e) =>
                      update("dailyPropertyLimit", Number(e.target.value))
                    }
                  />
                </label>
                <label style={field}>
                  Max per mottagare och dag
                  <input
                    type="number"
                    min={1}
                    max={20}
                    required
                    style={inputStyle}
                    value={draft.dailyRecipientLimit}
                    onChange={(e) =>
                      update("dailyRecipientLimit", Number(e.target.value))
                    }
                  />
                </label>
              </div>
              <label style={{ ...row, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={draft.groupProperties}
                  onChange={(e) => update("groupProperties", e.target.checked)}
                />
                Samla samma källhändelse för flera fastigheter i ett SMS
              </label>
              <div style={row}>
                <label style={{ ...row, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.quietHours.enabled}
                    onChange={(e) =>
                      update("quietHours", {
                        ...draft.quietHours,
                        enabled: e.target.checked,
                      })
                    }
                  />
                  Tysta timmar
                </label>
                <label style={field}>
                  Från
                  <input
                    type="time"
                    style={inputStyle}
                    value={draft.quietHours.start}
                    onChange={(e) =>
                      update("quietHours", {
                        ...draft.quietHours,
                        start: e.target.value,
                      })
                    }
                  />
                </label>
                <label style={field}>
                  Till
                  <input
                    type="time"
                    style={inputStyle}
                    value={draft.quietHours.end}
                    onChange={(e) =>
                      update("quietHours", {
                        ...draft.quietHours,
                        end: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <p style={{ ...cardSub, margin: 0 }}>
                Svensk tid, inklusive sommartid. Stoppade aviseringar samlas
                inte för senare utskick.
              </p>
              <label style={{ ...row, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={draft.quietHours.emergencyException}
                  onChange={(e) =>
                    update("quietHours", {
                      ...draft.quietHours,
                      emergencyException: e.target.checked,
                    })
                  }
                />
                Tillåt röd SMHI-varning och VMA under tysta timmar (övriga
                gränser gäller)
              </label>
              <div style={{ ...row, justifyContent: "space-between" }}>
                <label style={{ ...row, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => update("enabled", e.target.checked)}
                  />
                  Aktivera regeln i testläge
                </label>
                <button
                  style={primary}
                  disabled={!data.recipients.length || !data.properties.length}
                >
                  Spara regel
                </button>
              </div>
            </fieldset>
          </form>
          {editing && (
            <div
              style={{
                borderTop: "1px solid rgba(20,23,26,.07)",
                marginTop: 22,
                paddingTop: 18,
              }}
            >
              <div style={row}>
                <button
                  style={button}
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      setPreview(
                        await notificationRequest(
                          `/rules/${editing}/preview`,
                          "POST",
                          {},
                        ),
                      ),
                    )
                  }
                >
                  Förhandsgranska sparad regel
                </button>
                <label style={field}>
                  Testresultat
                  <select
                    style={inputStyle}
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                  >
                    <option value="success">Simulerad framgång</option>
                    <option value="failure">Simulerat fel</option>
                    <option value="timeout">Simulerad timeout</option>
                    <option value="unavailable">
                      Simulerad otillgänglighet
                    </option>
                  </select>
                </label>
                <button
                  style={button}
                  disabled={disabled}
                  onClick={() =>
                    void act(async () => {
                      const r = await notificationRequest<{
                        generated: number;
                      }>(`/rules/${editing}/test`, "POST", { scenario });
                      setNotice(
                        `${r.generated} testposter skapades. De bearbetas i bakgrunden. Inga SMS skickas.`,
                      );
                    })
                  }
                >
                  Testa sparad regel
                </button>
              </div>
              <p style={cardSub}>
                Förhandsgranskning och test använder sparade källhändelser.
                Spara ändringar först.
              </p>
            </div>
          )}
          {preview && (
            <div
              style={{
                background: C.page,
                borderRadius: 16,
                padding: 18,
                marginTop: 18,
              }}
              aria-label="SMS-förhandsgranskning"
            >
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                }}
              >
                {preview.message}
              </div>
              <div style={{ ...cardSub, marginTop: 12 }}>
                {preview.parts} SMS-delar ·{" "}
                {preview.estimatedCostSek === null
                  ? "Pris per del ej konfigurerat"
                  : `cirka ${preview.estimatedCostSek.toLocaleString("sv-SE")} kr`}{" "}
                ·{" "}
                {preview.eligible
                  ? "Villkoret är uppfyllt"
                  : "Ingen berättigad källhändelse"}
              </div>
            </div>
          )}
        </section>
      </div>
      <section style={section} aria-labelledby="activity-heading">
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <h2 id="activity-heading" style={{ ...cardTitle, margin: 0 }}>
              Senaste aviseringsaktivitet
            </h2>
            <p style={cardSub}>
              Senaste 50 poster · gallras efter 30 dagar · svensk tid
            </p>
          </div>
          <button
            style={button}
            onClick={() => void act(reload)}
            disabled={busy}
          >
            Uppdatera
          </button>
        </div>
        {!data.activity.length && (
          <p style={cardSub}>
            Ingen aktivitet ännu. Förhandsgranska en regel och kör ett test.
          </p>
        )}
        {data.activity.map((a) => (
          <div
            key={a.id}
            style={{
              ...row,
              justifyContent: "space-between",
              padding: "14px 0",
              borderTop: "1px solid rgba(20,23,26,.06)",
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                {a.ruleName}
                {a.isTest ? " · Regeltest" : ""}
              </div>
              <div style={cardSub}>
                {a.propertyNames.join(", ")} · {a.maskedPhone} ·{" "}
                {fmt(a.createdAt)}
              </div>
              {a.detail && (
                <div style={{ ...cardSub, marginTop: 4 }}>{a.detail}</div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {NOTIFICATION_STATUS_LABELS[a.status] ?? a.status}
              </div>
              <div style={cardSub}>
                {a.parts} delar
                {a.verificationRequired
                  ? " · verifiering krävs för riktig leverans"
                  : ""}
              </div>
            </div>
          </div>
        ))}
      </section>
      <section
        style={{ ...section, ...row, justifyContent: "space-between" }}
        aria-label="Användning och gränser"
      >
        <div>
          <h2 style={{ ...cardTitle, margin: 0 }}>Användning denna månad</h2>
          <p style={cardSub}>
            {data.usage.simulated} genererade simuleringar av{" "}
            {data.usage.monthlyLimit} · högst {data.usage.dailyLimit} per
            organisation och dag
          </p>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          Uppskattat:{" "}
          {data.usage.estimatedCostSek === null
            ? "pris ej konfigurerat"
            : `${data.usage.estimatedCostSek.toLocaleString("sv-SE")} kr`}
          <br />
          Faktisk SMS-kostnad: {data.usage.realCostSek} kr · Globalt tillåten
          verklig SMS-kostnad: {data.usage.globalMonthlyCapSek} kr/månad
        </div>
      </section>
    </div>
  );
}
