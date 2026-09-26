import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { circuitSupabase } from "../lib/circuitSupabase";

type Compagnie = "AB" | "AC" | "TS";
type LiveVehicle = {
  found: boolean;
  unit: string;
  vehicleId: string | null;
  vehicleName: string | null;
  latitude: number | null;
  longitude: number | null;
  headingDegrees: number | null;
  speedKph: number | null;
  fuelPercent?: number | null;
  batterySocPercent?: number | null;
  address: string | null;
  updatedAt: string | null;
};
type DisplayVehicle = LiveVehicle & { compagnie: Compagnie; key: string };
type Filter = "ALL" | Compagnie;

const REFRESH_MS = 5000;
const SOURCE_ID = "fleet-source";
const CIRCLE_LAYER_ID = "fleet-circles";
const LABEL_LAYER_ID = "fleet-labels";
const HEADING_LAYER_ID = "fleet-headings";

const companyColor: Record<Compagnie, string> = {
  AB: "#2563eb",
  AC: "#f59e0b",
  TS: "#16a34a",
};

function fmtUpdated(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function validCoordinate(vehicle: DisplayVehicle) {
  const lat = Number(vehicle.latitude);
  const lng = Number(vehicle.longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toGeoJson(items: DisplayVehicle[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.filter(validCoordinate).map((vehicle) => ({
      type: "Feature" as const,
      id: vehicle.key,
      properties: {
        key: vehicle.key,
        unit: vehicle.unit,
        compagnie: vehicle.compagnie,
        color: companyColor[vehicle.compagnie],
        heading: Number.isFinite(Number(vehicle.headingDegrees))
          ? Number(vehicle.headingDegrees)
          : 0,
        speedKph:
          vehicle.speedKph == null || !Number.isFinite(Number(vehicle.speedKph))
            ? null
            : Number(vehicle.speedKph),
        address: vehicle.address ?? "",
        updatedAt: vehicle.updatedAt ?? "",
      },
      geometry: {
        type: "Point" as const,
        coordinates: [Number(vehicle.longitude), Number(vehicle.latitude)],
      },
    })),
  };
}

export default function CarteUnitesPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const firstFitDoneRef = useRef(false);
  const busyRef = useRef(false);
  const latestDisplayRef = useRef<DisplayVehicle[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [vehicles, setVehicles] = useState<Record<string, LiveVehicle>>({});
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const displayVehicles = useMemo<DisplayVehicle[]>(() => {
    return Object.entries(vehicles)
      .map(([key, live]) => {
        const prefix = key.split("::")[0];
        const compagnie: Compagnie =
          prefix === "AC" ? "AC" : prefix === "TS" ? "TS" : "AB";
        return { ...live, compagnie, key };
      })
      .filter((vehicle) => vehicle.found !== false)
      .filter(validCoordinate)
      .filter((vehicle) => filter === "ALL" || vehicle.compagnie === filter)
      .sort((a, b) =>
        String(a.unit).localeCompare(String(b.unit), "fr-CA", {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [vehicles, filter]);

  const fitVehicles = useCallback(
    (items: DisplayVehicle[], animate = true) => {
      const map = mapRef.current;
      const valid = items.filter(validCoordinate);
      if (!map || !mapReadyRef.current || valid.length === 0) return false;

      if (valid.length === 1) {
        map[animate ? "easeTo" : "jumpTo"]({
          center: [Number(valid[0].longitude), Number(valid[0].latitude)],
          zoom: 15,
          ...(animate ? { duration: 500 } : {}),
        } as any);
        return true;
      }

      const bounds = new mapboxgl.LngLatBounds();
      valid.forEach((vehicle) => {
        bounds.extend([Number(vehicle.longitude), Number(vehicle.latitude)]);
      });
      map.fitBounds(bounds, {
        padding: { top: 110, right: 70, bottom: 70, left: 70 },
        maxZoom: 14,
        duration: animate ? 600 : 0,
      });
      return true;
    },
    [],
  );

  const syncMapData = useCallback((items: DisplayVehicle[]) => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(toGeoJson(items) as any);
  }, []);

  useEffect(() => {
    latestDisplayRef.current = displayVehicles;
    syncMapData(displayVehicles);

    // Un seul cadrage automatique: au premier chargement GPS valide.
    // Les actualisations et les filtres ne changent ensuite jamais le zoom.
    if (
      !firstFitDoneRef.current &&
      mapReadyRef.current &&
      displayVehicles.length > 0
    ) {
      const didFit = fitVehicles(displayVehicles, false);
      if (didFit) firstFitDoneRef.current = true;
    }
  }, [displayVehicles, fitVehicles, syncMapData]);

  useEffect(() => {
    const token =
      import.meta.env.VITE_MAPBOX_TOKEN ||
      import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

    if (!mapNode.current) return;
    if (!token) {
      setError("Token Mapbox manquant.");
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapNode.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-70.67, 46.12],
      zoom: 9,
      attributionControl: true,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      mapReadyRef.current = true;

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toGeoJson([]) as any,
      });

      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            12,
            12,
            16,
            16,
            19,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 0.96,
          "circle-stroke-opacity": 1,
        },
      });

      map.addLayer({
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "text-field": ["get", "unit"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            8,
            12,
            10,
            16,
            11,
          ],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-anchor": "center",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.addLayer({
        id: HEADING_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "text-field": "▲",
          "text-size": 14,
          "text-offset": [0, -1.85],
          "text-rotate": ["get", "heading"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      syncMapData(latestDisplayRef.current);

      if (
        !firstFitDoneRef.current &&
        latestDisplayRef.current.length > 0
      ) {
        const didFit = fitVehicles(latestDisplayRef.current, false);
        if (didFit) firstFitDoneRef.current = true;
      }
    });

    map.on("mouseenter", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", CIRCLE_LAYER_ID, (event) => {
      const feature = event.features?.[0] as any;
      if (!feature || feature.geometry?.type !== "Point") return;

      const coordinates = [...feature.geometry.coordinates] as [number, number];
      const props = feature.properties ?? {};
      const speed =
        props.speedKph == null || props.speedKph === ""
          ? "—"
          : `${Math.round(Number(props.speedKph))} km/h`;
      const address = props.address
        ? `<div>${escapeHtml(props.address)}</div>`
        : "";
      const updatedAt = props.updatedAt
        ? fmtUpdated(String(props.updatedAt))
        : "—";

      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({
        offset: 24,
        closeButton: true,
        closeOnClick: true,
      })
        .setLngLat(coordinates)
        .setHTML(`
          <div class="fleet-popup">
            <strong>Unité ${escapeHtml(props.unit)}</strong>
            <div>${escapeHtml(props.compagnie)} • ${escapeHtml(speed)}</div>
            ${address}
            <div>GPS : ${escapeHtml(updatedAt)}</div>
          </div>
        `)
        .addTo(map);
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      mapReadyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [fitVehicles, syncMapData]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);

    try {
      const { data, error: functionError } =
        await circuitSupabase.functions.invoke("circuit-samsara-live", {
          body: { mode: "fleet" },
        });

      if (functionError) throw functionError;
      if (data?.ok === false) {
        throw new Error(data?.error || "Lecture GPS impossible.");
      }

      const nextVehicles =
        data?.vehicles && typeof data.vehicles === "object"
          ? (data.vehicles as Record<string, LiveVehicle>)
          : {};

      setVehicles(nextVehicles);
      setLastRefresh(new Date());
      setError("");
    } catch (err: any) {
      setError(err?.message || "Impossible de lire les positions Samsara.");
    } finally {
      busyRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleCenter = useCallback(() => {
    fitVehicles(displayVehicles, true);
  }, [displayVehicles, fitVehicles]);

  return (
    <div className="fleet-page">
      <style>{`
        .fleet-page { position: relative; width: 100%; height: 100vh; min-height: 620px; overflow: hidden; background: #e5e7eb; }
        .fleet-map { position: absolute; inset: 0; width: 100%; height: 100%; }
        .fleet-toolbar { position: absolute; z-index: 5; top: 18px; left: 18px; right: 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; background: rgba(255,255,255,.96); border: 1px solid rgba(15,23,42,.10); border-radius: 14px; box-shadow: 0 8px 28px rgba(15,23,42,.16); backdrop-filter: blur(8px); }
        .fleet-title { font-size: 18px; font-weight: 800; color: #0f172a; }
        .fleet-status { margin-top: 3px; display: flex; align-items: center; gap: 7px; font-size: 12px; color: #64748b; }
        .fleet-live-dot { width: 8px; height: 8px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.15); }
        .fleet-live-dot.is-error { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.15); }
        .fleet-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
        .fleet-filter { appearance: none; border: 1px solid #dbe2ea; background: #fff; color: #334155; border-radius: 9px; padding: 8px 11px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; transition: .15s ease; }
        .fleet-filter:hover { background: #f8fafc; border-color: #cbd5e1; }
        .fleet-filter.active { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
        .fleet-filter:disabled { opacity: .5; cursor: default; }
        .fleet-count { position: absolute; z-index: 5; left: 18px; bottom: 18px; padding: 9px 12px; border-radius: 10px; background: rgba(15,23,42,.88); color: #fff; font-size: 13px; font-weight: 700; box-shadow: 0 5px 18px rgba(15,23,42,.18); }
        .fleet-popup { min-width: 180px; color: #0f172a; font-size: 13px; line-height: 1.45; }
        .fleet-popup strong { display: block; margin-bottom: 4px; font-size: 15px; }
        .mapboxgl-popup-content { border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(15,23,42,.18); }
        @media (max-width: 760px) {
          .fleet-toolbar { align-items: flex-start; flex-direction: column; }
          .fleet-actions { justify-content: flex-start; }
        }
      `}</style>

      <div ref={mapNode} className="fleet-map" />

      <div className="fleet-toolbar">
        <div>
          <div className="fleet-title">Carte des unités</div>
          <div className="fleet-status">
            <span className={`fleet-live-dot ${error ? "is-error" : ""}`} />
            {error
              ? error
              : refreshing
                ? "Actualisation…"
                : `Live • ${
                    lastRefresh
                      ? fmtUpdated(lastRefresh.toISOString())
                      : "connexion…"
                  }`}
          </div>
        </div>

        <div className="fleet-actions">
          {(["ALL", "AB", "AC", "TS"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`fleet-filter ${filter === value ? "active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {value === "ALL" ? "Toutes" : value}
            </button>
          ))}
          <button type="button" className="fleet-filter" onClick={handleCenter}>
            Centrer
          </button>
          <button
            type="button"
            className="fleet-filter"
            disabled={refreshing}
            onClick={() => void refresh()}
            title="Actualiser maintenant"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="fleet-count">
        {loading
          ? "Chargement…"
          : `${displayVehicles.length} unité${
              displayVehicles.length > 1 ? "s" : ""
            } en ligne`}
      </div>
    </div>
  );
}
