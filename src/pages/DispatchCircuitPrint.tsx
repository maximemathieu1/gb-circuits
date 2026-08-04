import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { printCircuit } from "../lib/CircuitService";

type PrintRow = {
  idx?: number | null;
  dir?: string;
  nav_dir?: string;
  stop_kind?: string;
  description?: string;
  arret?: string;
  note?: string;
  stop_type?: string;
  raw_label?: string;
};

type CircuitPrintData = {
  id: string;
  nom: string;
  chauffeur: string;
  unite: string;
  heure_depart?: string;
  heure_retour?: string;
  rows: PrintRow[];
};

function normalizeText(v: any) {
  return String(v ?? "").trim();
}

function formatArret(v: any) {
  const s = normalizeText(v);
  if (!s) return "";
  return s.split(",")[0].trim().replace(/\s+/g, " ");
}

function extractStreetOnly(v: any) {
  const s = formatArret(v);
  if (!s) return "";

  let out = s.replace(/^\s*\d+[A-Za-z\-\/]*\s+/, "").trim();

  out = out.replace(/^av\s+/i, "Avenue ");
  out = out.replace(/^ave\s+/i, "Avenue ");
  out = out.replace(/^boul\s+/i, "Boulevard ");
  out = out.replace(/^blvd\s+/i, "Boulevard ");
  out = out.replace(/^ch\s+/i, "Chemin ");
  out = out.replace(/^range\s+/i, "Rang ");
  out = out.replace(/^rang\s+/i, "Rang ");
  out = out.replace(/^rte\s+/i, "Route ");
  out = out.replace(/^route\s+/i, "Route ");
  out = out.replace(/^rue\s+/i, "Rue ");

  return out.trim();
}

function fallbackStopKind(stopType: string) {
  const t = normalizeText(stopType).toLowerCase();

  if (t === "ecole") return "École";
  if (t === "transfer") return "Transfert";
  if (t === "uturn" || t === "school_uturn") return "Demi-tour";

  return "";
}

function displayDir(row: PrintRow) {
  const direct = normalizeText(row.dir);
  if (direct) return direct;

  const navDir = normalizeText(row.nav_dir);
  const stopKind = normalizeText(row.stop_kind);

  if (navDir && stopKind) {
    if (navDir === stopKind) return navDir;
    return `${navDir} • ${stopKind}`;
  }

  if (navDir) return navDir;
  if (stopKind) return stopKind;

  return fallbackStopKind(normalizeText(row.stop_type));
}

function displayDescription(row: PrintRow) {
  const explicit = normalizeText(row.description);
  if (explicit) return explicit;

  const source = normalizeText(row.arret) || normalizeText(row.raw_label);
  return extractStreetOnly(source);
}

function emptyRows(count: number): PrintRow[] {
  return Array.from({ length: count }, () => ({
    dir: "",
    nav_dir: "",
    stop_kind: "",
    description: "",
    arret: "",
    note: "",
    stop_type: "",
    raw_label: "",
  }));
}

export default function DispatchCircuitPrint() {
  const { id = "" } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<CircuitPrintData | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");

      try {
        const payload = await printCircuit(id);
        if (!alive) return;

        const circuit = payload?.circuit ?? {};
        const rows: PrintRow[] = Array.isArray(payload?.rows)
          ? payload.rows.map((row: any) => ({
              idx: Number.isFinite(Number(row?.idx)) ? Number(row.idx) : null,
              dir: normalizeText(row?.dir) || undefined,
              nav_dir: normalizeText(row?.nav_dir) || undefined,
              stop_kind: normalizeText(row?.stop_kind) || undefined,
              description: normalizeText(row?.description) || undefined,
              arret: normalizeText(row?.arret) || undefined,
              note: normalizeText(row?.note) || undefined,
              stop_type: normalizeText(row?.stop_type) || undefined,
              raw_label: normalizeText(row?.raw_label) || undefined,
            }))
          : [];

        setData({
          id: normalizeText(circuit.id) || id,
          nom: normalizeText(circuit.nom) || "Circuit",
          chauffeur: normalizeText(circuit.conducteur) || normalizeText(circuit.chauffeur),
          unite: normalizeText(circuit.unite),
          heure_depart: normalizeText(circuit.heure_depart),
          heure_retour: normalizeText(circuit.heure_retour),
          rows,
        });
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Erreur de chargement du circuit");
      } finally {
        if (alive) setLoading(false);
      }
    }

    if (id) load();
    else {
      setLoading(false);
      setErr("ID de circuit manquant");
    }

    return () => {
      alive = false;
    };
  }, [id]);

  const rows = useMemo(() => {
    const base = data?.rows ?? [];
    return [...base, ...emptyRows(Math.max(0, 34 - base.length))];
  }, [data]);

  return (
    <div style={pageWrap}>
      <style>{`
        @page {
          size: Letter portrait;
          margin: 10mm;
        }

        html, body {
          margin:0;
          padding:0;
          font-family: Arial, Helvetica, sans-serif;
        }

        @media print {
          body * {
            visibility: hidden;
          }

          .print-page,
          .print-page * {
            visibility: visible;
          }

          .print-page {
            position:absolute;
            left:0;
            top:0;
            width:100%;
          }

          .no-print{
            display:none !important;
          }
        }
      `}</style>

      <div className="no-print" style={toolbar}>
        <button onClick={() => nav(-1)} style={btnGhost}>
          Retour
        </button>

        <button onClick={() => window.print()} style={printBtn} disabled={loading || !!err}>
          Imprimer
        </button>
      </div>

      {loading ? (
        <div style={statusBox}>Chargement du circuit…</div>
      ) : err ? (
        <div style={statusBoxError}>{err}</div>
      ) : !data ? (
        <div style={statusBoxError}>Circuit introuvable.</div>
      ) : (
        <div className="print-page" style={page}>
          
          <div style={topHeader}>
            <div style={topLeft}>
              <div style={circuitLine}>Circuit: {data.nom || data.id}</div>
              <div style={unitLine}>Unité: {data.unite || "—"}</div>
            </div>

            <div style={topRight}>
              <div>Départ: {data.heure_depart || "—"}</div>
              <div>Retour: {data.heure_retour || "—"}</div>
            </div>
          </div>

          <table style={table}>
            <thead>
              <tr>
                <th style={{ ...th, width: "14%" }}>Dir.</th>
                <th style={{ ...th, width: "28%" }}>Description</th>
                <th style={{ ...th, width: "32%" }}>Arrêt</th>
                <th style={{ ...th, width: "26%" }}>Note</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={tdDir}>{displayDir(r)}</td>
                  <td style={td}>{displayDescription(r)}</td>
                  <td style={td}>{formatArret(r.arret || r.raw_label)}</td>
                  <td style={tdNote}>{normalizeText(r.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* styles */

const pageWrap: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f3f4f6",
  padding: 20,
};

const toolbar: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: 10,
  marginBottom: 14,
};

const btnGhost: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const printBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const statusBox: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 18,
};

const statusBoxError: React.CSSProperties = {
  ...statusBox,
  color: "#991b1b",
};

const page: React.CSSProperties = {
  width: "8.5in",
  minHeight: "11in",
  margin: "0 auto",
  background: "#fff",
  padding: "10mm",
  boxSizing: "border-box",
};

const topHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 10,
};

const topLeft: React.CSSProperties = {
  display: "grid",
  gap: 2,
};

const topRight: React.CSSProperties = {
  textAlign: "right",
  fontWeight: 700,
};

const circuitLine: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
};

const unitLine: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
  fontSize: 11,
};

const th: React.CSSProperties = {
  border: "1px solid #111",
  padding: "6px 8px",
  textAlign: "left",
  fontWeight: 800,
  background: "#f8f8f8",
};

const td: React.CSSProperties = {
  border: "1px solid #111",
  padding: "6px 8px",
};

const tdNote: React.CSSProperties = {
  ...td,
};

const tdDir: React.CSSProperties = {
  ...td,
  textAlign: "center",
  fontWeight: 900,
};