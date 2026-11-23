"use client";

import { useMemo, useState } from "react";
import { C, cardSub } from "@/lib/design/tokens";

const norm = (s: string) => s.toLocaleLowerCase("sv-SE");
const linkButton: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  font: "inherit",
  fontSize: 12.5,
  color: C.ink,
  textDecoration: "underline",
  cursor: "pointer",
};

/**
 * The SMS rule's "Välj en eller flera" property list (docs/plans/skalning.md, S-27): search,
 * select/clear everything that matches, and a count of the selection – picking 150 of 500 is
 * a search and one click instead of 150 checkboxes.
 */
export function RulePropertySelect({
  properties,
  selected,
  onChange,
  searchLabel = "Sök fastighet för regeln",
  listHeight = 220,
}: {
  /** `detail` (address, town) is shown beside the name and searched too. */
  properties: { id: string; name: string; detail?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  searchLabel?: string;
  listHeight?: number;
}) {
  const [query, setQuery] = useState("");
  const chosen = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    return words.length ? properties.filter((p) => words.every((w) => norm(`${p.name} ${p.detail ?? ""}`).includes(w))) : properties;
  }, [properties, query]);
  const visibleChosen = visible.filter((p) => chosen.has(p.id)).length;

  if (!properties.length)
    return <span style={cardSub}>Lägg först till en fastighet i portföljen.</span>;

  const selectVisible = () => onChange([...selected, ...visible.filter((p) => !chosen.has(p.id)).map((p) => p.id)]);
  const clearVisible = () => {
    const hide = new Set(visible.map((p) => p.id));
    onChange(selected.filter((id) => !hide.has(id)));
  };
  const filtered = visible.length !== properties.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {properties.length > 6 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={properties.some((p) => p.detail) ? "Sök fastighet, adress eller ort" : "Sök fastighet"}
          aria-label={searchLabel}
          autoComplete="off"
          style={{ boxSizing: "border-box", width: "100%", padding: "8px 12px", border: "1px solid rgba(20,23,26,.13)", borderRadius: 12, background: C.white, color: C.ink, font: "inherit", fontSize: 13 }}
        />
      )}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: C.text3 }}>
        <span role="status">{selected.length} av {properties.length} valda</span>
        {visibleChosen < visible.length && (
          <button type="button" style={linkButton} onClick={selectVisible}>
            {filtered ? `Markera alla som syns (${visible.length})` : "Markera alla"}
          </button>
        )}
        {visibleChosen > 0 && (
          <button type="button" style={linkButton} onClick={clearVisible}>
            {filtered ? "Avmarkera alla som syns" : "Avmarkera alla"}
          </button>
        )}
      </div>
      <div role="group" aria-label="Välj fastigheter" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: listHeight, overflowY: "auto", overscrollBehavior: "contain" }}>
        {visible.map((p) => (
          <label key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={chosen.has(p.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))}
            />
            {p.name}
            {p.detail && <span style={{ color: C.text3, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.detail}</span>}
          </label>
        ))}
        {!visible.length && <span style={cardSub}>Inga fastigheter matchar ”{query.trim()}”.</span>}
      </div>
    </div>
  );
}

/** "Hamnvägen 1, Kajen 4 och 298 till" with a toggle to list every name (activity log, S-27). */
export function PropertyNamesSummary({ names, max = 3 }: { names: string[]; max?: number }) {
  const [all, setAll] = useState(false);
  if (names.length <= max || all)
    return (
      <>
        {names.join(", ")}
        {all && (
          <>
            {" "}
            <button type="button" style={{ ...linkButton, fontSize: "inherit" }} onClick={() => setAll(false)}>Visa färre</button>
          </>
        )}
      </>
    );
  return (
    <>
      {names.slice(0, max - 1).join(", ")} och{" "}
      <button type="button" style={{ ...linkButton, fontSize: "inherit" }} onClick={() => setAll(true)} aria-label={`Visa alla ${names.length} fastigheter`}>
        {names.length - (max - 1)} till
      </button>
    </>
  );
}
