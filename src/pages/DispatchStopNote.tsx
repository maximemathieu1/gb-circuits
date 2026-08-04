// src/pages/DispatchStopNote.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import { getCircuit, updatePoint } from "../lib/CircuitService";
import { circuitSupabase } from "../lib/circuitSupabase";

function isDesktop() {
  return typeof window !== "undefined" && window.innerWidth >= 1024;
}

type LngLat = { lng: number; lat: number };

// ------------------- Geo helpers -------------------

function clampRadius(m: number) {
  const n = Number(m);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5000, Math.round(n)));
}

function haversineMeters(a: LngLat, b: LngLat) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function destinationPoint(center: LngLat, bearingDeg: number, distanceM: number): LngLat {
  const R = 6378137;
  const brng = (bearingDeg * Math.PI) / 180;
  const d = distanceM / R;

  const lat1 = (center.lat * Math.PI) / 180;
  const lon1 = (center.lng * Math.PI) / 180;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { lat: (lat2 * 180) / Math.PI, lng: (lon2 * 180) / Math.PI };
}

function makeCircleGeoJSON(center: LngLat, radiusM: number, steps = 72) {
  const r = clampRadius(radiusM);
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const b = (360 * i) / steps;
    const p = destinationPoint(center, b, r);
    coords.push([p.lng, p.lat]);
  }
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      },
    ],
  };
}

function makePointGeoJSON(p: LngLat) {
  return {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } },
    ],
  };
}

function makeLineGeoJSON(a: LngLat, b: LngLat) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
      },
    ],
  };
}

// ------------------- Component -------------------

export default function DispatchStopNote() {
  const nav = useNavigate();
  const { id, stopId } = useParams();

  const circuitId = String(id || "");
  const pointId = String(stopId || "");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [circuitName, setCircuitName] = useState<string>("Circuit");
  const [point, setPoint] = useState<any>(null);

  const [noteTriggerM, setNoteTriggerM] = useState<number>(200);
  const [noteText, setNoteText] = useState<string>("");
  const [noteImages, setNoteImages] = useState<string[]>([]);
  const [pendingDeleteImages, setPendingDeleteImages] = useState<string[]>([]);

  const [cursorDistM, setCursorDistM] = useState<number | null>(null);

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const draggingHandleRef = useRef(false);

  const noteTriggerMRef = useRef<number>(200);
  useEffect(() => {
    noteTriggerMRef.current = noteTriggerM;
  }, [noteTriggerM]);

  async function load() {
    setLoading(true);
    try {
      const data = await getCircuit(circuitId);
      setCircuitName(data?.circuit?.nom ?? "Circuit");

      const p = (data?.points ?? []).find((x: any) => String(x.id) === pointId);
      if (!p) {
        alert("Arrêt introuvable.");
        nav(`/admin/circuits/${circuitId}`);
        return;
      }

      setPoint(p);
      setNoteTriggerM(Number.isFinite(Number(p.note_trigger_m)) ? Number(p.note_trigger_m) : 200);
      setNoteText(String(p.note ?? ""));
      setNoteImages(Array.isArray(p.note_images) ? p.note_images.filter(Boolean) : []);
      setPendingDeleteImages([]);
    } catch (e: any) {
      alert(e?.message ?? "Erreur chargement note");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isDesktop()) return;
    if (!circuitId || !pointId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitId, pointId]);

  const center = useMemo<LngLat | null>(() => {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [point]);

  const hasToken = !!(import.meta as any).env?.VITE_MAPBOX_TOKEN;
  const isBusy = saving || loading || uploading;
  const canAddMoreImages = noteImages.length < 3;

  if (!isDesktop()) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Circuits Scolaires</h2>
        <div>Page disponible uniquement sur ordinateur.</div>
      </div>
    );
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;

    const current = Array.isArray(noteImages) ? noteImages : [];
    const remaining = Math.max(0, 3 - current.length);

    if (remaining <= 0) {
      alert("Maximum de 3 photos par note.");
      return;
    }

    const selected = Array.from(files).slice(0, remaining);

    setUploading(true);
    try {
      const uploadedUrls: string[] = [];

      for (const file of selected) {
        const mimeOk = String(file.type || "").startsWith("image/");
        if (!mimeOk) continue;

        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `circuit-${circuitId}/point-${pointId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${safeExt}`;

        const { error: upErr } = await circuitSupabase.storage.from("circuit-notes").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });

        if (upErr) throw upErr;

        const { data } = circuitSupabase.storage.from("circuit-notes").getPublicUrl(path);
        const publicUrl = String(data?.publicUrl ?? "").trim();
        if (publicUrl) uploadedUrls.push(publicUrl);
      }

      setNoteImages((prev) => [...prev, ...uploadedUrls].slice(0, 3));
    } catch (e: any) {
      alert(e?.message ?? "Erreur lors de l’upload des photos");
    } finally {
      setUploading(false);
    }
  }

async function removeImageAt(index: number) {
  const img = noteImages[index];
  if (!img) return;

  if (!confirm("Supprimer cette photo ?")) return;

  try {
    setUploading(true);

    // 1️⃣ supprimer dans le bucket
    await deletePendingImagesFromStorage([img]);

    // 2️⃣ nouveau tableau
    const updated = noteImages.filter((_, i) => i !== index);

    // 3️⃣ mettre à jour la DB
    await updatePoint(pointId, {
      note_images: updated,
    } as any);

    // 4️⃣ update UI
    setNoteImages(updated);

  } catch (e: any) {
    alert(e?.message ?? "Erreur suppression photo");
  } finally {
    setUploading(false);
  }
}

async function deletePendingImagesFromStorage(urls: string[]) {
  if (!urls.length) return;

  const paths = urls
    .map((url) => {
      try {
        const marker = "/storage/v1/object/public/circuit-notes/";
        const index = url.indexOf(marker);
        if (index < 0) return null;
        return decodeURIComponent(url.slice(index + marker.length));
      } catch {
        return null;
      }
    })
    .filter((path): path is string => Boolean(path));

  if (!paths.length) return;

  const { error } = await circuitSupabase.storage
    .from("circuit-notes")
    .remove(paths);

  if (error) throw error;
}

  async function save() {
    setSaving(true);
    try {
      const trimmed = noteText.trim();
      const hasText = !!trimmed;
      const hasImages = noteImages.length > 0;
      const shouldShow = hasText || hasImages;

      await updatePoint(pointId, {
        note_mode: shouldShow ? "show" : "none",
        note_trigger_m: Number.isFinite(Number(noteTriggerM)) ? Number(noteTriggerM) : 200,
        note: hasText ? trimmed : null,
        note_images: noteImages,
        note_display_s: null,
      } as any);

      if (pendingDeleteImages.length > 0) {
        await deletePendingImagesFromStorage(pendingDeleteImages);
      }

      setPendingDeleteImages([]);
      alert("Note sauvegardée ✅");
      nav(`/admin/circuits/${circuitId}`);
    } catch (e: any) {
      alert(e?.message ?? "Erreur sauvegarde note");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!confirm("Supprimer la note (texte + distance + photos) ?")) return;

    setSaving(true);
    try {
      const allImagesToDelete = [...noteImages];

      await updatePoint(pointId, {
        note_mode: "none",
        note_trigger_m: 200,
        note: null,
        note_images: [],
        note_display_s: null,
      } as any);

      if (allImagesToDelete.length > 0) {
        await deletePendingImagesFromStorage(allImagesToDelete);
      }

      setPendingDeleteImages([]);
      alert("Note supprimée ✅");
      nav(`/admin/circuits/${circuitId}`);
    } catch (e: any) {
      alert(e?.message ?? "Erreur suppression note");
    } finally {
      setSaving(false);
    }
  }

  // ---------- Map init ----------
  useEffect(() => {
    if (!center) return;
    if (!mapDivRef.current) return;
    if (mapRef.current) return;
    if (!hasToken) return;

    mapboxgl.accessToken = (import.meta as any).env?.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapDivRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [center.lng, center.lat],
      zoom: 16,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("stop-point", { type: "geojson", data: makePointGeoJSON(center) });
      map.addLayer({
        id: "stop-point-layer",
        type: "circle",
        source: "stop-point",
        paint: {
          "circle-radius": 7,
          "circle-color": "#2563eb",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.addSource("note-circle", { type: "geojson", data: makeCircleGeoJSON(center, noteTriggerMRef.current) });
      map.addLayer({
        id: "note-circle-fill",
        type: "fill",
        source: "note-circle",
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "note-circle-line",
        type: "line",
        source: "note-circle",
        paint: { "line-color": "#f59e0b", "line-width": 2, "line-opacity": 0.9 },
      });

      const handlePos = destinationPoint(center, 90, clampRadius(noteTriggerMRef.current));
      map.addSource("note-handle", { type: "geojson", data: makePointGeoJSON(handlePos) });
      map.addLayer({
        id: "note-handle-layer",
        type: "circle",
        source: "note-handle",
        paint: {
          "circle-radius": 8,
          "circle-color": "#f59e0b",
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 2,
        },
      });

      map.addSource("cursor-line", { type: "geojson", data: makeLineGeoJSON(center, center) });
      map.addLayer({
        id: "cursor-line-layer",
        type: "line",
        source: "cursor-line",
        paint: { "line-width": 2, "line-color": "#111827", "line-opacity": 0.35 },
      });

      map.on("mouseenter", "note-handle-layer", () => {
        map.getCanvas().style.cursor = "grab";
      });
      map.on("mouseleave", "note-handle-layer", () => {
        if (!draggingHandleRef.current) map.getCanvas().style.cursor = "";
      });

      map.on("mousedown", "note-handle-layer", (e: mapboxgl.MapLayerMouseEvent) => {
        e.preventDefault();
        draggingHandleRef.current = true;
        map.getCanvas().style.cursor = "grabbing";
      });

      map.on("mousemove", (e: mapboxgl.MapMouseEvent) => {
        const cursor: LngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };

        const clSrc: any = map.getSource("cursor-line");
        if (clSrc) clSrc.setData(makeLineGeoJSON(center, cursor));
        setCursorDistM(haversineMeters(center, cursor));

        if (!draggingHandleRef.current) return;

        const r = clampRadius(haversineMeters(center, cursor));
        setNoteTriggerM(r);

        const hSrc: any = map.getSource("note-handle");
        if (hSrc) hSrc.setData(makePointGeoJSON(cursor));

        const cSrc: any = map.getSource("note-circle");
        if (cSrc) cSrc.setData(makeCircleGeoJSON(center, r));
      });

      const endDrag = () => {
        if (!draggingHandleRef.current) return;
        draggingHandleRef.current = false;
        map.getCanvas().style.cursor = "";

        const r = clampRadius(noteTriggerMRef.current);
        const snap = destinationPoint(center, 90, r);
        const hSrc: any = map.getSource("note-handle");
        if (hSrc) hSrc.setData(makePointGeoJSON(snap));
      };

      map.on("mouseup", endDrag);
      map.on("mouseout", endDrag);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, hasToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!center) return;
    if (!map.isStyleLoaded()) return;

    const r = clampRadius(noteTriggerM);

    const cSrc: any = map.getSource("note-circle");
    if (cSrc) cSrc.setData(makeCircleGeoJSON(center, r));

    if (!draggingHandleRef.current) {
      const snap = destinationPoint(center, 90, r);
      const hSrc: any = map.getSource("note-handle");
      if (hSrc) hSrc.setData(makePointGeoJSON(snap));
    }
  }, [noteTriggerM, center]);

  return (
    <div style={{ padding: 20 }}>
      <div style={topBar}>
        <div style={topLeft}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={topTitleRow}>
              <div style={pageTitle}>Note – arrêt #{point?.idx ?? "—"}</div>
              {loading ? <div style={{ fontSize: 12, color: "#6b7280" }}>Chargement…</div> : null}
            </div>

            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Circuit: <strong style={{ color: "#111827" }}>{circuitName}</strong>
            </div>
          </div>
        </div>

        <div style={topRight}>
          <button style={btnGhost} onClick={() => nav(`/admin/circuits/${circuitId}`)} disabled={isBusy}>
            Retour
          </button>

          <div style={{ width: 10 }} />

          <button style={btnDanger} onClick={onDelete} disabled={isBusy}>
            Supprimer
          </button>

          <button style={btnPrimary} onClick={save} disabled={isBusy}>
            {saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Paramètre</h3>

        <div style={{ maxWidth: 520 }}>
          <div style={field}>
            <label style={fieldLabel}>Distance de déclenchement (m)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={String(noteTriggerM)}
              onChange={(e) => setNoteTriggerM(Number(e.target.value))}
              style={input}
              disabled={isBusy}
            />
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Astuce: tu peux aussi <strong>tirer la poignée</strong> sur la carte pour définir la distance.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Mode: <strong style={{ color: "#111827" }}>Afficher</strong> si texte ou photo présente (sinon: Aucun).
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Texte de la note</h3>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Tape ta note ici (multi-lignes)…"
          rows={8}
          style={textarea}
          disabled={isBusy}
        />
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Photos</h3>

        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.45 }}>
          Ajoute jusqu’à <strong style={{ color: "#111827" }}>3 photos</strong> pour aider à identifier l’endroit
          exact : stationnement, repère visuel, porte d’école, entrée, demi-tour, etc.
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ ...btnGhost, cursor: isBusy || !canAddMoreImages ? "default" : "pointer" }}>
            {uploading ? "Envoi…" : "Ajouter des photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              disabled={isBusy || !canAddMoreImages}
              onChange={(e) => {
                uploadImages(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>

          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {noteImages.length}/3 photo{noteImages.length > 1 ? "s" : ""}
          </div>
        </div>

        {noteImages.length > 0 ? (
          <div style={imageGrid}>
            {noteImages.map((img, i) => (
              <div key={`${img}-${i}`} style={imageCard}>
                <img src={img} alt={`Photo ${i + 1}`} style={imageThumb} />
                <button type="button" style={imageDeleteBtn} onClick={() => removeImageAt(i)} disabled={isBusy}>
                  Supprimer
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#6b7280" }}>Aucune photo ajoutée.</div>
        )}
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Zone de déclenchement</h3>

        {!center ? (
          <div style={{ color: "#6b7280" }}>Coordonnées manquantes pour cet arrêt.</div>
        ) : !hasToken ? (
          <div style={{ color: "#6b7280" }}>VITE_MAPBOX_TOKEN manquant — impossible d’afficher la carte.</div>
        ) : (
          <>
            <div
              ref={mapDivRef}
              style={{
                height: 340,
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid #e5e7eb",
              }}
            />
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Rayon: <strong style={{ color: "#111827" }}>{clampRadius(noteTriggerM)} m</strong>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Curseur → arrêt:{" "}
                <strong style={{ color: "#111827" }}>
                  {cursorDistM == null ? "—" : `${cursorDistM.toFixed(cursorDistM < 100 ? 1 : 0)} m`}
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
              Pour ajuster: clique sur la <strong>poignée orange</strong> sur le cercle et tire-la.
            </div>
          </>
        )}
      </div>
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

const field: React.CSSProperties = { display: "grid", gap: 6 };

const fieldLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#6b7280",
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
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontSize: 14,
  resize: "vertical",
  minHeight: 160,
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

const imageGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: 12,
};

const imageCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 10,
  background: "#fff",
};

const imageThumb: React.CSSProperties = {
  width: "100%",
  height: 140,
  objectFit: "cover",
  borderRadius: 10,
  display: "block",
  marginBottom: 10,
  background: "#f3f4f6",
};

const imageDeleteBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #dc2626",
  background: "#fff",
  color: "#dc2626",
  fontWeight: 900,
  cursor: "pointer",
};