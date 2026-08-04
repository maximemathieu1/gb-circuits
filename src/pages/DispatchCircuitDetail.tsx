// src/pages/DispatchCircuitDetail.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteCircuit,
  deletePoint,
  getCircuit,
  insertStopAt,
  updateCircuit,
  updatePoint,
} from "../lib/CircuitService";
import { circuitSupabase } from "../lib/circuitSupabase";

function isDesktop() {
  return typeof window !== "undefined" && window.innerWidth >= 1024;
}

const STOP_TYPES = [
  { v: "school", label: "Scolaire" },
  { v: "school_uturn", label: "Scolaire-Demi tour" },
  { v: "uturn", label: "Demi-Tour" },
  { v: "transfer", label: "Transfert" },
  { v: "ecole", label: "École" },
] as const;

type StopType = (typeof STOP_TYPES)[number]["v"];

const NOTE_MODES = [
  { v: "none", label: "Aucun" },
  { v: "show", label: "Afficher" },
  { v: "tts", label: "Annoncer (TTS)" },
] as const;

type NoteMode = (typeof NOTE_MODES)[number]["v"];
type AddPosition = "before" | "after";

type Opt = { value: string; label: string };

function norm(s: string) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as any)) onOutside();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, onOutside]);
}

function parseCoordInput(v: string): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validLatLng(lat: number | null, lng: number | null) {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const base = (import.meta as any).env?.VITE_GPS_FUNCTION_URL || "";
  const token = (import.meta as any).env?.VITE_DISPATCH_SECRET || "";

  if (!base) throw new Error("VITE_GPS_FUNCTION_URL manquant.");
  if (!token) throw new Error("DISPATCH_SECRET manquant.");

  const r = await fetch(`${base.replace(/\/$/, "")}/dispatch-reverse-geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dispatch-token": token },
    body: JSON.stringify({ lat, lng }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Erreur reverse geocode (${r.status})`);
  return String(j?.address ?? "");
}

function ComboInput({
  value,
  onChange,
  placeholder,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: Opt[];
  label: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useOutsideClick(boxRef, () => setOpen(false));

  const filtered = useMemo(() => {
    const q = norm(value);
    if (!q) return options.slice(0, 200);
    return options
      .filter((o) => norm(o.label).includes(q) || norm(o.value).includes(q))
      .slice(0, 200);
  }, [options, value]);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={fieldLabel}>{label}</div>

      <div ref={boxRef} style={comboWrapper}>
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          style={{ ...input, paddingRight: 34 }}
          placeholder={placeholder}
        />

        <button type="button" style={comboArrowBtn} onClick={() => setOpen((v) => !v)} title="Ouvrir la liste">
          ▼
        </button>

        {open && (
          <div style={comboList}>
            {filtered.map((o) => (
              <div
                key={o.value}
                style={comboItem}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                title={o.label}
              >
                {o.label}
              </div>
            ))}
            {!filtered.length && <div style={comboEmpty}>Aucun résultat</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function hasNote(p: any) {
  const t = String(p?.note ?? "").trim();
  return t.length > 0;
}

function hasPhotos(p: any) {
  return Array.isArray(p?.note_images) && p.note_images.filter(Boolean).length > 0;
}

function firstPhoto(p: any) {
  if (!Array.isArray(p?.note_images)) return null;
  return p.note_images.find((x: any) => !!String(x ?? "").trim()) ?? null;
}

function ActionsMenu({
  onViewCircuit,
  onPrintCircuit,
  disabled,
}: {
  onViewCircuit: () => void;
  onPrintCircuit: () => void;
  disabled?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useOutsideClick(menuRef, () => setOpen(false));

  return (
    <div ref={menuRef} style={menuWrap}>
      <button
        type="button"
        style={{ ...btnGhost, minWidth: 44, padding: "8px 12px" }}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Autres actions"
      >
        ...
      </button>

      {open && (
        <div style={menuList}>
          <button
            type="button"
            style={menuItemBtn}
            onClick={() => {
              setOpen(false);
              onViewCircuit();
            }}
          >
            Voir Circuit
          </button>

          <button
            type="button"
            style={menuItemBtn}
            onClick={() => {
              setOpen(false);
              onPrintCircuit();
            }}
          >
            Imprimer
          </button>
        </div>
      )}
    </div>
  );
}

function reindexPoints(arr: any[]) {
  return [...arr]
    .sort((a, b) => Number(a?.idx ?? 0) - Number(b?.idx ?? 0))
    .map((p, i) => ({ ...p, idx: i }));
}

export default function DispatchCircuitDetail() {
  const nav = useNavigate();
  const { id } = useParams();
  const circuitId = String(id || "");

  const [loading, setLoading] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [addrPointId, setAddrPointId] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const [, setCircuit] = useState<any>(null);
  const [activeVersion, setActiveVersion] = useState<any>(null);
  const [points, setPoints] = useState<any[]>([]);

  const [nomCircuit, setNomCircuit] = useState("");
  const [heureDepart, setHeureDepart] = useState("");
  const [heureRetour, setHeureRetour] = useState("");
  const [unite, setUnite] = useState("");
  const [conducteur, setConducteur] = useState("");
  const [generalNoteStart, setGeneralNoteStart] = useState("");

  const [vehiculeOpts, setVehiculeOpts] = useState<Opt[]>([]);
  const [conducteurOpts, setConducteurOpts] = useState<Opt[]>([]);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addPosition, setAddPosition] = useState<AddPosition>("after");
  const [addTargetId, setAddTargetId] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [addStopType, setAddStopType] = useState<StopType>("school");
  const [addLat, setAddLat] = useState("");
  const [addLng, setAddLng] = useState("");
  const [savingInsert, setSavingInsert] = useState(false);

  async function loadPicklists() {
    try {
      const [{ data: vehs }, { data: conds }] = await Promise.all([
        circuitSupabase
          .from("vehicules")
          .select("no_unite")
          .not("no_unite", "is", null)
          .order("no_unite", { ascending: true })
          .limit(2000),
        circuitSupabase
          .from("conducteurs")
          .select("nom")
          .not("nom", "is", null)
          .order("nom", { ascending: true })
          .limit(2000),
      ]);

      const vset = new Set<string>();
      const vopts: Opt[] = [];
      (vehs ?? []).forEach((r: any) => {
        const v = String(r.no_unite ?? "").trim();
        if (!v) return;
        if (vset.has(v)) return;
        vset.add(v);
        vopts.push({ value: v, label: v });
      });

      const cset = new Set<string>();
      const copts: Opt[] = [];
      (conds ?? []).forEach((r: any) => {
        const v = String(r.nom ?? "").trim();
        if (!v) return;
        const k = norm(v);
        if (cset.has(k)) return;
        cset.add(k);
        copts.push({ value: v, label: v });
      });

      setVehiculeOpts(vopts);
      setConducteurOpts(copts);
    } catch {
      // silencieux
    }
  }

  async function load() {
    setLoading(true);
    try {
      const data = await getCircuit(circuitId);
      const loadedPoints = reindexPoints(data.points || []);
      setCircuit(data.circuit);
      setActiveVersion(data.active_version);
      setPoints(loadedPoints);

      setNomCircuit(String(data.circuit?.nom ?? ""));
      setHeureDepart((data.circuit?.heure_depart ?? "").slice(0, 5));
      setHeureRetour((data.circuit?.heure_retour ?? "").slice(0, 5));
      setUnite(String(data.circuit?.unite ?? ""));
      setConducteur(String(data.circuit?.conducteur ?? ""));
      setGeneralNoteStart(String(data.active_version?.general_note_start ?? ""));

      if (loadedPoints.length) {
        setAddTargetId(String(loadedPoints[loadedPoints.length - 1].id));
      } else {
        setAddTargetId("");
      }
    } catch (e: any) {
      alert(e?.message ?? "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isDesktop()) return;
    if (!circuitId) return;
    load();
    loadPicklists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitId]);

  const title = useMemo(() => nomCircuit.trim() || "Circuit", [nomCircuit]);

  const dureeLabel = useMemo(() => {
    const a = (heureDepart || "").trim();
    const b = (heureRetour || "").trim();
    const m = (t: string) => {
      const [hh, mm] = t.split(":").map((x) => Number(x));
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      return hh * 60 + mm;
    };
    const ma = m(a);
    const mb = m(b);
    if (ma == null || mb == null) return "—";
    let diff = mb - ma;
    if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60);
    const min = diff % 60;
    return `${h}h ${String(min).padStart(2, "0")}`;
  }, [heureDepart, heureRetour]);

  const stopTargetOptions = useMemo(
    () =>
      points.map((p, position) => ({
        value: String(p.id),
        label: `Arrêt #${position + 1}${p.label ? ` — ${String(p.label)}` : ""}`,
      })),
    [points]
  );

  if (!isDesktop()) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Circuits Scolaires</h2>
        <div>Page disponible uniquement sur ordinateur.</div>
      </div>
    );
  }

  async function savePointSilent(p: any) {
    const stopType: StopType = (p.stop_type as StopType) || "school";
    const noteMode: NoteMode = (p.note_mode as NoteMode) || "none";

    await updatePoint(p.id, {
      label: (p.label ?? "").trim() || null,
      stop_type: stopType,
      note: (p.note ?? "").trim() || null,
      note_mode: noteMode,
      note_trigger_m: Number.isFinite(Number(p.note_trigger_m)) ? Number(p.note_trigger_m) : 200,
      note_once: !!p.note_once,
    } as any);
  }

  async function persistVisiblePointEdits() {
    for (const p of points) {
      if (!p?.id) continue;
      await savePointSilent(p);
    }
  }

  function openAddModal() {
    setAddPosition("after");
    setAddTargetId((prev) => prev || (points.length ? String(points[points.length - 1].id) : ""));
    setAddLabel("");
    setAddStopType("school");
    setAddLat("");
    setAddLng("");
    setAddModalOpen(true);
  }

  function closeAddModal() {
    if (savingInsert) return;
    setAddModalOpen(false);
    setAddLabel("");
    setAddStopType("school");
    setAddLat("");
    setAddLng("");
  }

  function copyTargetCoords() {
    const target = points.find((p) => String(p.id) === String(addTargetId));
    if (!target) return;
    const lat = Number(target.lat);
    const lng = Number(target.lng);
    if (Number.isFinite(lat)) setAddLat(String(lat));
    if (Number.isFinite(lng)) setAddLng(String(lng));
  }

  async function insertStopAtTarget() {
    if (!activeVersion?.id) {
      alert("Aucune version active trouvée.");
      return;
    }

    const lat = parseCoordInput(addLat);
    const lng = parseCoordInput(addLng);

    if (lat == null || lng == null || !validLatLng(lat, lng)) {
      alert("Entre une latitude et une longitude valides pour le nouvel arrêt.");
      return;
    }

    setSavingInsert(true);
    try {
      await persistVisiblePointEdits();

      let insertIdx = 0;

      if (points.length) {
        const target = points.find((p) => String(p.id) === String(addTargetId));
        if (!target) {
          throw new Error("Sélectionne un arrêt cible.");
        }

        const targetIdx = Number(target.idx);
        insertIdx = addPosition === "before" ? targetIdx : targetIdx + 1;
      }

      await insertStopAt(String(activeVersion.id), insertIdx, {
        lat,
        lng,
        label: addLabel.trim() || null,
        stop_type: addStopType,
      });

      closeAddModal();
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Erreur insertion");
    } finally {
      setSavingInsert(false);
    }
  }

  async function deleteStop(point: any) {
    if (!activeVersion?.id) {
      alert("Aucune version active trouvée.");
      return;
    }
    if (!confirm("Supprimer cet arrêt ?")) return;

    try {
      if (!point?.id) throw new Error("ID de l’arrêt manquant.");
      await deletePoint(String(point.id));
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Erreur suppression");
    }
  }

  async function saveAll() {
    if (!activeVersion?.id) {
      alert("Aucune version active trouvée.");
      return;
    }

    setSavingAll(true);
    try {
      await updateCircuit(circuitId, {
        nom: nomCircuit.trim() || null,
        heure_depart: heureDepart ? `${heureDepart}:00` : null,
        heure_retour: heureRetour ? `${heureRetour}:00` : null,
        unite: unite.trim() || null,
        conducteur: conducteur.trim() || null,
        general_note_start: generalNoteStart.trim() || null,
      });

      await persistVisiblePointEdits();

      await load();
      alert("Enregistré ✅");
    } catch (e: any) {
      alert(e?.message ?? "Erreur sauvegarde");
      await load();
    } finally {
      setSavingAll(false);
    }
  }

  async function fillAddress(p: any) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      alert("Coordonnées invalides pour cet arrêt.");
      return;
    }

    setAddrPointId(p.id);
    try {
      const addr = await reverseGeocode(lat, lng);
      if (!addr) {
        alert("Adresse introuvable pour ce point.");
        return;
      }
      setPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, label: addr } : x)));
    } catch (e: any) {
      alert(e?.message ?? "Erreur adresse");
    } finally {
      setAddrPointId(null);
    }
  }

  async function onDelete() {
    if (!confirm("Supprimer ce circuit ?")) return;
    try {
      await deleteCircuit(circuitId);
      nav("/admin/circuits");
    } catch (e: any) {
      alert(e?.message ?? "Erreur suppression");
    }
  }

  function onViewCircuit() {
    nav(`/admin/circuits/${circuitId}/map`);
  }

  function onPrintCircuit() {
    nav(`/admin/circuits/${circuitId}/print`);
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={topBar}>
        <div style={topLeft}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={topTitleRow}>
              <div style={pageTitle}>{title}</div>
              {loading ? <div style={{ fontSize: 12, color: "#6b7280" }}>Chargement…</div> : null}
            </div>
          </div>
        </div>

        <div style={topRight}>
          <button style={btnGhost} onClick={() => nav("/admin/circuits")}>
            Retour
          </button>

          <div style={{ width: 10 }} />

          <button style={btnPrimary} onClick={saveAll} disabled={savingAll || savingInsert}>
            {savingAll ? "Enregistrement…" : "Enregistrer"}
          </button>

          <button style={btnDanger} onClick={onDelete} disabled={savingAll || savingInsert}>
            Supprimer
          </button>

          <ActionsMenu onViewCircuit={onViewCircuit} onPrintCircuit={onPrintCircuit} disabled={savingAll || savingInsert} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Informations Circuit</h3>

        <div style={grid1}>
          <div style={field}>
            <label style={fieldLabel}>Nom du circuit</label>
            <input
              value={nomCircuit}
              onChange={(e) => setNomCircuit(e.target.value)}
              style={input}
              placeholder="Nom du circuit"
            />
          </div>
        </div>

        <div style={timeGrid3}>
          <div style={field}>
            <label style={fieldLabel}>Heure départ</label>
            <input type="time" step={60} value={heureDepart} onChange={(e) => setHeureDepart(e.target.value)} style={input} />
          </div>

          <div style={field}>
            <label style={fieldLabel}>Heure retour</label>
            <input type="time" step={60} value={heureRetour} onChange={(e) => setHeureRetour(e.target.value)} style={input} />
          </div>

          <div style={field}>
            <label style={fieldLabel}>Durée</label>
            <div style={durationBox}>{dureeLabel}</div>
          </div>
        </div>

        <div style={grid2}>
          <ComboInput label="Véhicule (Unité)" value={unite} onChange={setUnite} placeholder="Ex: 123" options={vehiculeOpts} />
          <ComboInput label="Conducteur" value={conducteur} onChange={setConducteur} placeholder="Nom du conducteur" options={conducteurOpts} />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Note de départ</h3>

        <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.4, marginBottom: 10 }}>
          Cette note s’affiche seulement lors d’un départ normal dans NAV GPS.
          <br />
        </div>

        <textarea
          value={generalNoteStart}
          onChange={(e) => setGeneralNoteStart(e.target.value)}
          placeholder="Ex. Départ du garage à 6 h 42"
          rows={4}
          style={textarea}
        />
      </div>

      <div style={card}>
        <div style={sectionHeader}>
          <h3 style={{ margin: 0 }}>Arrêts (version active)</h3>

          <button
            type="button"
            style={btnAdd}
            onClick={openAddModal}
            disabled={savingAll || savingInsert}
            title="Ajouter un arrêt"
          >
            + Ajouter un arrêt
          </button>
        </div>

        <div style={{ ...row, fontWeight: 900, color: "#374151" }}>
          <div>#</div>
          <div>Libellé</div>
          <div>Type</div>
          <div>Note</div>
          <div>Photo</div>
          <div>Actions</div>
        </div>

        {points.map((p, position) => {
          const stopType: StopType = (p.stop_type as StopType) || "school";
          const isAddr = addrPointId === p.id;
          const notePresent = hasNote(p);
          const photoPresent = hasPhotos(p);
          const preview = firstPhoto(p);

          return (
            <div key={p.id} style={row}>
              <div style={{ fontWeight: 900 }}>#{position + 1}</div>

              <div style={{ position: "relative" }}>
                <input
                  value={p.label ?? ""}
                  onChange={(e) => setPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, label: e.target.value } : x)))}
                  style={input}
                  placeholder="Libellé"
                  disabled={savingAll || savingInsert}
                />
                <button
                  style={addrBtnInline}
                  onClick={() => fillAddress(p)}
                  disabled={isAddr || savingAll || savingInsert}
                  title="Convertir lat/lng en adresse"
                  type="button"
                >
                  {isAddr ? "…" : "Adresse"}
                </button>
              </div>

              <select
                value={stopType}
                onChange={(e) => setPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, stop_type: e.target.value } : x)))}
                style={input}
                disabled={savingAll || savingInsert}
              >
                {STOP_TYPES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  style={notePresent ? btnNoteActive : btnNote}
                  type="button"
                  disabled={savingAll || savingInsert}
                  onClick={() => nav(`/admin/circuits/${circuitId}/stops/${p.id}/note`)}
                  title="Gérer la note"
                >
                  Ajouter/Consulter Note
                </button>
              </div>

              <div style={photoCell}>
                {photoPresent && preview ? (
                  <img
                    src={preview}
                    alt={`Photo arrêt ${position + 1}`}
                    style={photoThumb}
                    onClick={() => setPreviewImg(preview)}
                    title="Voir la photo"
                  />
                ) : (
                  <span style={photoEmpty}>—</span>
                )}
              </div>

              <div style={actionsCell}>
                <button
                  style={btnMiniDangerSoft}
                  type="button"
                  onClick={() => deleteStop(p)}
                  disabled={savingAll || savingInsert}
                  title="Supprimer cet arrêt"
                >
                  Supprimer
                </button>
              </div>
            </div>
          );
        })}

        {!points.length && <div style={{ color: "#6b7280" }}>Aucun arrêt.</div>}
      </div>

      <div style={bottomActions}>
        <button style={btnPrimary} onClick={saveAll} disabled={savingAll || savingInsert}>
          {savingAll ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {addModalOpen ? (
        <div style={modalOverlay} onClick={closeAddModal}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <div style={modalTitle}>Ajouter un arrêt</div>
              <button type="button" style={modalCloseBtn} onClick={closeAddModal} disabled={savingInsert}>
                Fermer
              </button>
            </div>

            <div style={modalBody}>
              {points.length ? (
                <>
                  <div style={field}>
                    <label style={fieldLabel}>Position</label>
                    <select value={addPosition} onChange={(e) => setAddPosition(e.target.value as AddPosition)} style={input} disabled={savingInsert}>
                      <option value="before">Ajouter avant</option>
                      <option value="after">Ajouter après</option>
                    </select>
                  </div>

                  <div style={field}>
                    <label style={fieldLabel}>Arrêt cible</label>
                    <select value={addTargetId} onChange={(e) => setAddTargetId(e.target.value)} style={input} disabled={savingInsert}>
                      {stopTargetOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      style={btnGhost}
                      onClick={copyTargetCoords}
                      disabled={savingInsert}
                      title="Copier les coordonnées de l'arrêt cible"
                    >
                      Copier coords arrêt cible
                    </button>
                  </div>
                </>
              ) : (
                <div style={modalHint}>
                  Aucun arrêt n’existe encore. Le premier arrêt sera créé pour cette version.
                </div>
              )}

              <div style={field}>
                <label style={fieldLabel}>Libellé</label>
                <input
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  style={input}
                  placeholder="Ex. 1250 90e Rue"
                  disabled={savingInsert}
                />
              </div>

              <div style={coordGrid}>
                <div style={field}>
                  <label style={fieldLabel}>Latitude</label>
                  <input
                    value={addLat}
                    onChange={(e) => setAddLat(e.target.value)}
                    style={input}
                    placeholder="Ex. 46.112345"
                    disabled={savingInsert}
                  />
                </div>

                <div style={field}>
                  <label style={fieldLabel}>Longitude</label>
                  <input
                    value={addLng}
                    onChange={(e) => setAddLng(e.target.value)}
                    style={input}
                    placeholder="Ex. -70.665432"
                    disabled={savingInsert}
                  />
                </div>
              </div>

              <div style={field}>
                <label style={fieldLabel}>Type d’arrêt</label>
                <select value={addStopType} onChange={(e) => setAddStopType(e.target.value as StopType)} style={input} disabled={savingInsert}>
                  {STOP_TYPES.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={modalHint}>
                Le nouvel arrêt sera créé exactement à la latitude/longitude saisies. Pour qu’il colle à ta trace, entre les coordonnées directement sur le trajet voulu.
              </div>
            </div>

            <div style={modalFooter}>
              <button type="button" style={btnGhost} onClick={closeAddModal} disabled={savingInsert}>
                Annuler
              </button>
              <button type="button" style={btnPrimary} onClick={insertStopAtTarget} disabled={savingInsert}>
                {savingInsert ? "Ajout…" : "Ajouter"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewImg ? (
        <div style={previewOverlay} onClick={() => setPreviewImg(null)}>
          <div style={previewCard} onClick={(e) => e.stopPropagation()}>
            <button type="button" style={previewCloseBtn} onClick={() => setPreviewImg(null)}>
              Fermer
            </button>
            <img src={previewImg} alt="Aperçu photo arrêt" style={previewImage} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ===================== */
/* Styles */
/* ===================== */

const topBar: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 10,
};

const topLeft: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  minWidth: 360,
};

const topRight: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const topTitleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const pageTitle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 1000,
  color: "#111827",
  lineHeight: 1.1,
};

const card: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,.1)",
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
  background: "#fff",
};

const grid1: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
  maxWidth: 900,
  marginBottom: 12,
};

const timeGrid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 12,
  maxWidth: 900,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  maxWidth: 900,
  marginTop: 12,
};

const coordGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const field: React.CSSProperties = { display: "grid", gap: 6 };

const fieldLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#6b7280",
};

const durationBox: React.CSSProperties = {
  height: 42,
  display: "flex",
  alignItems: "center",
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  fontWeight: 900,
  color: "#111827",
};

const sectionHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
  flexWrap: "wrap",
};

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "70px 1.6fr 220px 1.35fr 90px 130px",
  gap: 10,
  marginBottom: 10,
  alignItems: "center",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 14,
  boxSizing: "border-box",
};

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 110,
  resize: "vertical",
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const btnDanger: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #dc2626",
  background: "#dc2626",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
};

const btnGhost: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnAdd: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 6px 16px rgba(37,99,235,.18)",
};

const btnMiniDangerSoft: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#dc2626",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 11,
  width: "auto",
  minWidth: 84,
};

const comboWrapper: React.CSSProperties = { position: "relative" };

const comboArrowBtn: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  height: 28,
  width: 28,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 12,
  color: "#374151",
};

const comboList: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  background: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  marginTop: 6,
  maxHeight: 240,
  overflowY: "auto",
  zIndex: 50,
  boxShadow: "0 10px 25px rgba(0,0,0,.08)",
};

const comboItem: React.CSSProperties = {
  padding: "9px 10px",
  cursor: "pointer",
  fontWeight: 900,
  color: "#111827",
};

const comboEmpty: React.CSSProperties = {
  padding: "10px",
  opacity: 0.65,
};

const addrBtnInline: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 12,
};

const btnNote: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(37,99,235,0.35)",
  background: "rgba(37,99,235,0.10)",
  cursor: "pointer",
  fontWeight: 900,
  color: "#1d4ed8",
};

const btnNoteActive: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #16a34a",
  background: "#2563eb",
  cursor: "pointer",
  fontWeight: 900,
  color: "#fff",
};

const photoCell: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const photoEmpty: React.CSSProperties = {
  color: "#9ca3af",
  fontWeight: 900,
  fontSize: 16,
};

const photoThumb: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 10,
  objectFit: "cover",
  border: "1px solid #d1d5db",
  cursor: "pointer",
  background: "#f3f4f6",
  boxShadow: "0 4px 12px rgba(0,0,0,.08)",
};

const actionsCell: React.CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "flex-start",
};

const menuWrap: React.CSSProperties = {
  position: "relative",
};

const menuList: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  minWidth: 180,
  background: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  boxShadow: "0 10px 25px rgba(0,0,0,.08)",
  overflow: "hidden",
  zIndex: 50,
};

const menuItemBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  background: "#fff",
  border: "none",
  borderBottom: "1px solid #f3f4f6",
  cursor: "pointer",
  fontWeight: 800,
  color: "#111827",
};

const bottomActions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 18,
};

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 9998,
};

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 620,
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  boxShadow: "0 24px 60px rgba(0,0,0,.20)",
  overflow: "hidden",
};

const modalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 18px",
  borderBottom: "1px solid #eef2f7",
};

const modalTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 1000,
  color: "#111827",
};

const modalCloseBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const modalBody: React.CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 18,
};

const modalHint: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.45,
  color: "#6b7280",
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
};

const modalFooter: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "16px 18px",
  borderTop: "1px solid #eef2f7",
};

const previewOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.82)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 9999,
};

const previewCard: React.CSSProperties = {
  position: "relative",
  maxWidth: "92vw",
  maxHeight: "92vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const previewImage: React.CSSProperties = {
  maxWidth: "92vw",
  maxHeight: "92vh",
  objectFit: "contain",
  borderRadius: 16,
  boxShadow: "0 24px 60px rgba(0,0,0,.35)",
};

const previewCloseBtn: React.CSSProperties = {
  position: "absolute",
  top: -14,
  right: -14,
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,.18)",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  zIndex: 2,
};