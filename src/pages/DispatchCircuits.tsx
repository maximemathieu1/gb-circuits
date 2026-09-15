// src/pages/DispatchCircuits.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listCircuits, type DispatchCircuitRow } from "../lib/CircuitService";

function isDesktop() {
  return typeof window !== "undefined" && window.innerWidth >= 1024;
}

/* ========= Transporteur filter (checkbox + mémoire) ========= */
type Carrier = "B" | "C" | "S";
const CARRIER_LABEL: Record<Carrier, string> = { B: "B", C: "C", S: "S" };
const LS_CARRIERS_KEY = "dispatchCircuits.transporteurs";
const LS_EXPANDED_CIRCUITS_KEY = "dispatchCircuits.expandedCircuits";

function loadCarrierSet(): Set<Carrier> {
  try {
    const raw = localStorage.getItem(LS_CARRIERS_KEY);
    if (!raw) return new Set<Carrier>(["B", "C", "S"]);

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set<Carrier>(["B", "C", "S"]);

    const valid = arr.filter(
      (x) => x === "B" || x === "C" || x === "S"
    ) as Carrier[];

    return new Set<Carrier>(valid.length ? valid : ["B", "C", "S"]);
  } catch {
    return new Set<Carrier>(["B", "C", "S"]);
  }
}

function saveCarrierSet(set: Set<Carrier>) {
  try {
    localStorage.setItem(LS_CARRIERS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Mémoire locale facultative.
  }
}

function loadStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set<string>();

    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? new Set<string>(arr.map((value) => String(value)))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveStringSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // Mémoire locale facultative.
  }
}

/* ========= Helpers (heures/durée) ========= */
function parseTimeToMinutes(t?: string | null): number | null {
  const s = String(t ?? "").trim();
  if (!s) return null;

  const match = s.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function durationMinutes(dep?: string | null, ret?: string | null): number | null {
  const m1 = parseTimeToMinutes(dep);
  const m2 = parseTimeToMinutes(ret);

  if (m1 == null || m2 == null) return null;

  let diff = m2 - m1;
  if (diff < 0) diff += 24 * 60;

  return diff;
}

function fmtHM(t?: string | null) {
  const s = String(t ?? "").trim();
  if (!s) return "—";

  const match = s.match(/(\d{1,2}):(\d{2})/);
  if (!match) return s;

  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function fmtDuration(min: number | null) {
  if (min == null) return "—";

  const hh = Math.floor(min / 60);
  const mm = min % 60;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeName(value?: string | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Le nom du parcours est défini manuellement.
 * Exemples attendus :
 * 006 AM -> Circuit 006
 * 006 PM -> Circuit 006
 * 106 AM -> Circuit 106
 * 106 PM -> Circuit 106
 *
 * Le repli sur 5 chiffres conserve la compatibilité avec les anciens noms
 * (ex. 00601 AM -> Circuit 006), mais l'affichage ne crée plus de groupe AM/PM.
 */
function detectParentCircuit(value?: string | null) {
  const normalized = normalizeName(value).toUpperCase();
  const digits = normalized.match(/\d+/)?.[0] ?? "";

  if (!digits) return normalized || "SANS NUMÉRO";

  if (digits.length >= 5) {
    return digits.slice(0, 3);
  }

  if (digits.length <= 3) {
    return digits.padStart(3, "0");
  }

  return digits;
}

type CircuitGroup = {
  key: string;
  circuitNo: string;
  carrierCode: string;
  rows: DispatchCircuitRow[];
  totalStops: number;
  totalTransfers: number;
  totalKm: number;
  units: string[];
  drivers: string[];
};

function buildGroups(rows: DispatchCircuitRow[]): CircuitGroup[] {
  const map = new Map<string, DispatchCircuitRow[]>();

  for (const row of rows) {
    const carrierCode = String(row.transporteur_code ?? "").toUpperCase();
    const circuitNo = detectParentCircuit(row.nom);
    const key = `${carrierCode}|${circuitNo}`;

    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }

  return Array.from(map.entries())
    .map(([key, groupRows]) => {
      const [carrierCode, circuitNo] = key.split("|");
      const sortedRows = [...groupRows].sort((a, b) =>
        naturalCompare(String(a.nom ?? ""), String(b.nom ?? ""))
      );

      const units = Array.from(
        new Set(
          groupRows
            .map((row) => String(row.unite ?? "").trim())
            .filter(Boolean)
        )
      );

      const drivers = Array.from(
        new Set(
          groupRows
            .map((row) => String(row.conducteur ?? "").trim())
            .filter(Boolean)
        )
      );

      return {
        key,
        circuitNo,
        carrierCode,
        rows: sortedRows,
        totalStops: groupRows.reduce(
          (sum, row) => sum + Number(row.nb_arrets ?? 0),
          0
        ),
        totalTransfers: groupRows.reduce(
          (sum, row) => sum + Number(row.nb_transferts ?? 0),
          0
        ),
        totalKm: groupRows.reduce(
          (sum, row) => sum + Number(row.km_total ?? 0),
          0
        ),
        units,
        drivers,
      };
    })
    .sort((a, b) => naturalCompare(a.circuitNo, b.circuitNo));
}

export default function DispatchCircuits() {
  const nav = useNavigate();

  const [rows, setRows] = useState<DispatchCircuitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [carrierSet, setCarrierSet] = useState<Set<Carrier>>(() =>
    loadCarrierSet()
  );
  const [expandedCircuits, setExpandedCircuits] = useState<Set<string>>(() =>
    loadStringSet(LS_EXPANDED_CIRCUITS_KEY)
  );
  useEffect(() => saveCarrierSet(carrierSet), [carrierSet]);
  useEffect(
    () => saveStringSet(LS_EXPANDED_CIRCUITS_KEY, expandedCircuits),
    [expandedCircuits]
  );

  function toggleCarrier(code: Carrier) {
    setCarrierSet((prev) => {
      const next = new Set(prev);

      if (next.has(code)) next.delete(code);
      else next.add(code);

      if (next.size === 0) {
        return new Set<Carrier>(["B", "C", "S"]);
      }

      return next;
    });
  }

  function selectAllCarriers() {
    setCarrierSet(new Set<Carrier>(["B", "C", "S"]));
  }

  function toggleCircuit(key: string) {
    setExpandedCircuits((prev) => {
      const next = new Set(prev);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });
  }

  async function load() {
    setLoading(true);

    try {
      const data = await listCircuits();
      setRows(data);
    } catch (e: any) {
      alert(e?.message ?? "Erreur chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isDesktop()) {
      void load();
    }
  }, []);

  const filteredRows = useMemo(() => {
    const search = q.trim().toLowerCase();

    return rows.filter((row) => {
      const code = String(row.transporteur_code ?? "").toUpperCase() as Carrier;

      if (
        (code === "B" || code === "C" || code === "S") &&
        !carrierSet.has(code)
      ) {
        return false;
      }

      if (!search) return true;

      const parent = detectParentCircuit(row.nom);
      const haystack = [
        row.nom,
        parent,
        row.unite,
        row.conducteur,
        row.transporteur_code,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      return haystack.includes(search);
    });
  }, [rows, q, carrierSet]);

  const groups = useMemo(() => buildGroups(filteredRows), [filteredRows]);
  const hasExpandedCircuit = expandedCircuits.size > 0;

  function expandAll() {
    setExpandedCircuits(new Set(groups.map((group) => group.key)));
  }

  function collapseAll() {
    setExpandedCircuits(new Set<string>());
  }

  if (!isDesktop()) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Circuits Scolaires</h2>
        <div>Page disponible uniquement sur ordinateur.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <h2 style={{ margin: 0 }}>Circuits Scolaires</h2>

            {loading ? (
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                Chargement…
              </span>
            ) : null}
          </div>

          <button
            type="button"
            style={btnPrimary}
            onClick={() => nav("/admin/circuit-tablette-gps/import-busplanner")}
          >
            Importer BusPlanner
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={carrierBox} title="Filtrer par transporteur (mémorisé)">
            <span style={carrierLabel}>Transporteur</span>

            {(["B", "C", "S"] as Carrier[]).map((key) => (
              <label key={key} style={carrierItem}>
                <input
                  type="checkbox"
                  checked={carrierSet.has(key)}
                  onChange={() => toggleCarrier(key)}
                />
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 400,
                    color: "#111827",
                  }}
                >
                  {CARRIER_LABEL[key]}
                </span>
              </label>
            ))}

            <button
              type="button"
              onClick={selectAllCarriers}
              style={carrierMiniBtn}
              title="Tout afficher"
            >
              Tous
            </button>
          </div>

          <button type="button" onClick={expandAll} style={btnGhost}>
            Tout ouvrir
          </button>

          <button type="button" onClick={collapseAll} style={btnGhost}>
            Tout fermer
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: 1,
              minWidth: 340,
            }}
          >
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Circuit, parcours, unité, conducteur…"
              style={{
                padding: "10px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 12,
                width: "100%",
                maxWidth: 520,
              }}
            />

            {q.trim() ? (
              <button onClick={() => setQ("")} style={btnGhost}>
                Effacer
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {loading ? (
          <div style={emptyState}>Chargement…</div>
        ) : null}

        {!loading && groups.length === 0 ? (
          <div style={emptyState}>Aucun circuit.</div>
        ) : null}

        {!loading
          ? groups.map((group) => {
              const circuitExpanded = expandedCircuits.has(group.key);

              return (
                <section
                  key={group.key}
                  style={{
                    ...circuitCard,
                    opacity:
                      hasExpandedCircuit && !circuitExpanded ? 0.42 : 1,
                    filter:
                      hasExpandedCircuit && !circuitExpanded
                        ? "grayscale(0.45)"
                        : "none",
                    transform: circuitExpanded ? "scale(1.002)" : "none",
                    boxShadow: circuitExpanded
                      ? "0 6px 18px rgba(15, 23, 42, 0.10)"
                      : "none",
                    borderColor: circuitExpanded ? "#cbd5e1" : "#e5e7eb",
                    transition:
                      "opacity 160ms ease, filter 160ms ease, box-shadow 160ms ease, transform 160ms ease",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleCircuit(group.key)}
                    style={circuitHeader}
                  >
                    <span style={chevron}>
                      {circuitExpanded ? "⌄" : "›"}
                    </span>

                    <span style={{ minWidth: 165, textAlign: "left" }}>
                      <span
                        style={{
                          display: "block",
                          fontWeight: 900,
                          fontSize: 17,
                        }}
                      >
                        Circuit {group.circuitNo}
                      </span>

                    </span>

                    <Metric label="Arrêts" value={String(group.totalStops)} />
                    <Metric
                      label="Transferts"
                      value={String(group.totalTransfers)}
                    />
                    <Metric label="KM total" value={group.totalKm.toFixed(2)} />
                    <Metric
                      label="Unité"
                      value={group.units.length ? group.units.join(", ") : "—"}
                    />
                    <Metric
                      label="Conducteur"
                      value={
                        group.drivers.length ? group.drivers.join(", ") : "—"
                      }
                      wide
                    />
                  </button>

                  {circuitExpanded ? (
                    <div style={circuitBody}>
                      <div style={{ overflowX: "auto" }}>
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: 15,
                            minWidth: 980,
                          }}
                        >
                          <thead>
                            <tr style={{ background: "#f5f5f5" }}>
                              <Th>Parcours</Th>
                              <Th>Heure départ</Th>
                              <Th>Heure retour</Th>
                              <Th>Durée</Th>
                              <Th># Arrêts</Th>
                              <Th># Transferts</Th>
                              <Th>KM</Th>
                              <Th>Unité</Th>
                              <Th>Conducteur</Th>
                            </tr>
                          </thead>

                          <tbody>
                            {group.rows.map((row, index) => {
                              const duration = durationMinutes(
                                row.heure_depart ?? null,
                                row.heure_retour ?? null
                              );

                              return (
                                <tr
                                  key={row.circuit_id}
                                  onDoubleClick={() =>
                                    nav(`/admin/circuit-tablette-gps/${row.circuit_id}`)
                                  }
                                  style={{
                                    cursor: "pointer",
                                    background: index % 2 === 0 ? "#fff" : "#fafafa",
                                  }}
                                  title="Double-clique pour modifier"
                                >
                                  <Td style={{ fontWeight: 900 }}>
                                    {row.nom}
                                  </Td>
                                  <Td>{fmtHM(row.heure_depart)}</Td>
                                  <Td>{fmtHM(row.heure_retour)}</Td>
                                  <Td>{fmtDuration(duration)}</Td>
                                  <Td>{row.nb_arrets ?? 0}</Td>
                                  <Td>{row.nb_transferts ?? 0}</Td>
                                  <Td>
                                    {Number(row.km_total ?? 0).toFixed(2)}
                                  </Td>
                                  <Td style={{ fontWeight: 800 }}>
                                    {row.unite ?? "—"}
                                  </Td>
                                  <Td style={{ fontWeight: 800 }}>
                                    {row.conducteur ?? "—"}
                                  </Td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })
          : null}
      </div>

      <div style={{ color: "#6b7280", fontSize: 12 }}>
        Ouvre un circuit pour voir directement ses parcours (ex. 106 AM et 106 PM).
        Double-clique sur un parcours pour le modifier.
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <span
      style={{
        minWidth: wide ? 155 : 68,
        textAlign: "left",
      }}
    >
      <span style={metricLabel}>{label}</span>
      <span style={metricValue}>{value}</span>
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "2px solid #ddd",
        whiteSpace: "nowrap",
        fontWeight: 800,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid #eee",
        verticalAlign: "top",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

const btnGhost: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const carrierBox: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fff",
};

const carrierLabel: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 900,
  color: "#6b7280",
  marginRight: 2,
};

const carrierItem: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 6px",
  borderRadius: 999,
  background: "#f9fafb",
  border: "1px solid #f3f4f6",
};

const carrierMiniBtn: React.CSSProperties = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const emptyState: React.CSSProperties = {
  padding: 20,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  color: "#6b7280",
};

const circuitCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
  background: "#fff",
};

const circuitHeader: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "20px minmax(260px,1fr) 90px 100px 110px 90px 220px",
  alignItems: "center",
  columnGap: 8,
  padding: "8px 12px",
  border: 0,
  background: "#fff",
  color: "#0f172a",
  cursor: "pointer",
  font: "inherit",
};

const circuitBody: React.CSSProperties = {
  padding: "0 8px 8px 30px",
  background: "#fafafa",
  borderTop: "1px solid #eeeeee",
};

const chevron: React.CSSProperties = {
  width: 18,
  color: "#64748b",
  fontSize: 20,
  lineHeight: 1,
  fontWeight: 700,
};

const metricLabel: React.CSSProperties = {
  display: "block",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const metricValue: React.CSSProperties = {
  display: "block",
  marginTop: 1,
  color: "#1f2937",
  fontSize: 15,
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};