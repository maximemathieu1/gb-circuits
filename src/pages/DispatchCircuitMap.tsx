// src/pages/DispatchCircuitMap.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import { getCircuit, type TrailPoint } from "../lib/CircuitService";

function isDesktop() {
  return typeof window !== "undefined" && window.innerWidth >= 1024;
}

export default function DispatchCircuitMap() {
  const nav = useNavigate();
  const { id } = useParams();
  const circuitId = String(id || "");

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("Circuit");
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [points, setPoints] = useState<any[]>([]);

  const hasTrail = trail.length >= 2;

  // GeoJSON - trace
  const lineGeojson = useMemo(() => {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: trail.map((p) => [Number(p.lng), Number(p.lat)]),
          },
        },
      ],
    } as any;
  }, [trail]);

  // GeoJSON - stops
  const stopsGeojson = useMemo(() => {
    const orderedPoints = [...(points || [])]
      .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
      .sort((a, b) => Number(a.idx ?? 0) - Number(b.idx ?? 0));

    const feats = orderedPoints.map((p, position) => ({
      type: "Feature",
      properties: {
        // Numéro visible : toujours 1, 2, 3...
        // On ne dépend pas du idx technique de Supabase, qui peut contenir des trous.
        idx: position + 1,
        technical_idx: p.idx,
        label: p.label ?? "",
        stop_type: p.stop_type ?? "school",
      },
      geometry: {
        type: "Point",
        coordinates: [Number(p.lng), Number(p.lat)],
      },
    }));

    return { type: "FeatureCollection", features: feats } as any;
  }, [points]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await getCircuit(circuitId);
      setTitle(data?.circuit?.nom ?? "Circuit");

      const t = (data?.trace?.trail || []) as TrailPoint[];
      const safe = (t || []).filter(
        (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
      );
      setTrail(safe);

      setPoints(data?.points || []);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur chargement");
      setTrail([]);
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isDesktop() && circuitId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitId]);

  // Init map
  useEffect(() => {
    if (!mapDivRef.current) return;
    if (mapRef.current) return;

    const token =
      (import.meta as any).env?.VITE_MAPBOX_TOKEN ||
      (import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN;

    if (!token) {
      setErr("Token Mapbox manquant: ajoute VITE_MAPBOX_TOKEN (ou VITE_MAPBOX_ACCESS_TOKEN) dans .env");
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapDivRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-71.2, 46.8], // fallback Québec
      zoom: 10,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw/update layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyLayers = () => {
      const m = mapRef.current;
      if (!m) return;

      // --- TRACE LINE (BLEU) ---
      if (m.getSource("trace-line")) {
        (m.getSource("trace-line") as mapboxgl.GeoJSONSource).setData(lineGeojson);
      } else {
        m.addSource("trace-line", { type: "geojson", data: lineGeojson });
        m.addLayer({
          id: "trace-line-layer",
          type: "line",
          source: "trace-line",
          paint: {
            "line-color": "#2563eb", // ✅ bleu
            "line-width": 5,
            "line-opacity": 0.95,
          },
        });
      }

      // --- STOPS SOURCE ---
if (m.getSource("stops")) {
  (m.getSource("stops") as mapboxgl.GeoJSONSource).setData(stopsGeojson);
} else {
  m.addSource("stops", { type: "geojson", data: stopsGeojson });

  // ✅ Halo JAUNE (plus gros)
  m.addLayer({
    id: "stops-halo",
    type: "circle",
    source: "stops",
    paint: {
      "circle-radius": 18, // 👈 plus gros
      "circle-color": "#dc2626", // jaune
      "circle-opacity": 0.95,
    },
  });

  // ✅ Rond rouge central (plus gros aussi)
  m.addLayer({
    id: "stops-dot",
    type: "circle",
    source: "stops",
    paint: {
      "circle-radius": 11,
      "circle-color": "#dc2626",
      "circle-opacity": 1,
    },
  });

  // ✅ Numéro noir
  m.addLayer({
    id: "stops-number",
    type: "symbol",
    source: "stops",
    layout: {
      "text-field": [
        "to-string",
        ["coalesce", ["get", "idx"], ""],
      ],
      "text-size": 14, // 👈 plus gros
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-anchor": "center",
    },
    paint: {
      "text-color": "#FFFFFF",
    },
  });
}

      // Fit bounds sur la trace
      if (trail.length >= 2) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of trail) bounds.extend([Number(p.lng), Number(p.lat)]);
        m.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 400 });
      }
    };

    if (!map.isStyleLoaded()) {
      const onLoad = () => {
        map.off("load", onLoad);
        applyLayers();
      };
      map.on("load", onLoad);
      return;
    }

    applyLayers();
  }, [lineGeojson, stopsGeojson, trail]);

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
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button style={btnGhost} onClick={() => nav(`/admin/circuits/${circuitId}`)}>
          ← Retour
        </button>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {loading ? <span style={{ fontSize: 12, color: "#6b7280" }}>Chargement…</span> : null}
        {!loading && !hasTrail ? (
          <span style={{ fontSize: 12, color: "#b45309", fontWeight: 800 }}>
            Aucune trace enregistrée pour ce circuit.
          </span>
        ) : null}
      </div>

      {err ? (
        <div
          style={{
            padding: 12,
            border: "1px solid #fecaca",
            background: "#fff7f7",
            borderRadius: 12,
            color: "#991b1b",
            fontWeight: 800,
          }}
        >
          {err}
        </div>
      ) : null}

      <div
        ref={mapDivRef}
        style={{
          height: "calc(100dvh - 140px)",
          minHeight: 520,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
      />
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};