import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { circuitSupabase } from "../lib/circuitSupabase";

type Compagnie = "AB" | "AC" | "TS";
type VehicleRequest = { unit: string; compagnie: Compagnie };
type LiveVehicle = {
  found: boolean;
  unit: string;
  vehicleId: string | null;
  vehicleName: string | null;
  latitude: number | null;
  longitude: number | null;
  headingDegrees: number | null;
  speedKph: number | null;
  fuelPercent: number | null;
  batterySocPercent: number | null;
  address: string | null;
  updatedAt: string | null;
};
type DisplayVehicle = LiveVehicle & { compagnie: Compagnie; key: string };

const REFRESH_MS = 5000;
const companyColor: Record<Compagnie, string> = { AB: "#2563eb", AC: "#f59e0b", TS: "#16a34a" };

function liveKey(compagnie: Compagnie, unit: string) {
  return `${compagnie}::${unit.trim()}`;
}

function fmtUpdated(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function CarteUnitesPage() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const hasFittedRef = useRef(false);
  const busyRef = useRef(false);

  const [requests, setRequests] = useState<VehicleRequest[]>([]);
  const [vehicles, setVehicles] = useState<Record<string, LiveVehicle>>({});
  const [filter, setFilter] = useState<"ALL" | Compagnie>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!mapNode.current || !token) {
      if (!token) setError("Token Mapbox manquant.");
      return;
    }
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapNode.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-70.67, 46.12],
      zoom: 9,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: dbError } = await circuitSupabase
        .from("circuits_scolaires")
        .select("unite, compagnie")
        .not("unite", "is", null);
      if (!alive) return;
      if (dbError) {
        setError(dbError.message);
        setLoading(false);
        return;
      }
      const unique = Array.from(
        new Map(
          (data || [])
            .map((row: any) => ({ unit: String(row.unite || "").trim(), compagnie: row.compagnie as Compagnie }))
            .filter((row) => row.unit && ["AB", "AC", "TS"].includes(row.compagnie))
            .map((row) => [liveKey(row.compagnie, row.unit), row]),
        ).values(),
      );
      setRequests(unique);
      if (unique.length === 0) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!requests.length || busyRef.current) return;
    busyRef.current = true;
    setRefreshing(true);
    try {
      const { data, error: fnError } = await circuitSupabase.functions.invoke("circuit-samsara-live", {
        body: { vehicles: requests },
      });
      if (fnError) throw fnError;
      if (data?.ok === false) throw new Error(data?.error || "Lecture GPS impossible.");
      setVehicles(data?.vehicles || {});
      setLastRefresh(new Date());
      setError("");
    } catch (e: any) {
      setError(e?.message || "Impossible de lire les positions Samsara.");
    } finally {
      busyRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [requests]);

  useEffect(() => {
    if (!requests.length) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [requests, refresh]);

  const displayVehicles = useMemo<DisplayVehicle[]>(() => {
    return requests
      .map((req) => {
        const key = liveKey(req.compagnie, req.unit);
        const live = vehicles[key];
        return live ? { ...live, compagnie: req.compagnie, key } : null;
      })
      .filter((v): v is DisplayVehicle => Boolean(v?.found && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)))
      .filter((v) => filter === "ALL" || v.compagnie === filter);
  }, [requests, vehicles, filter]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !displayVehicles.length) return;
    const bounds = new mapboxgl.LngLatBounds();
    displayVehicles.forEach((v) => bounds.extend([Number(v.longitude), Number(v.latitude)]));
    map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 600 });
  }, [displayVehicles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibleKeys = new Set(displayVehicles.map((v) => v.key));
    markersRef.current.forEach((marker, key) => {
      if (!visibleKeys.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    });

    displayVehicles.forEach((vehicle) => {
      const lngLat: [number, number] = [Number(vehicle.longitude), Number(vehicle.latitude)];
      let marker = markersRef.current.get(vehicle.key);
      if (!marker) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "fleet-marker";
        el.style.setProperty("--fleet-color", companyColor[vehicle.compagnie]);
        el.innerHTML = `<span class="fleet-marker-arrow">▲</span><span class="fleet-marker-label"></span>`;
        const label = el.querySelector(".fleet-marker-label") as HTMLSpanElement;
        label.textContent = vehicle.unit;
        marker = new mapboxgl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
        markersRef.current.set(vehicle.key, marker);
      } else {
        const start = marker.getLngLat();
        const startTime = performance.now();
        const duration = Math.min(REFRESH_MS - 300, 1800);
        const animate = (now: number) => {
          const current = markersRef.current.get(vehicle.key);
          if (!current) return;
          const t = Math.min(1, (now - startTime) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          current.setLngLat([
            start.lng + (lngLat[0] - start.lng) * eased,
            start.lat + (lngLat[1] - start.lat) * eased,
          ]);
          if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }

      const element = marker.getElement();
      element.style.setProperty("--heading", `${vehicle.headingDegrees ?? 0}deg`);
      element.title = `${vehicle.unit} • ${vehicle.speedKph == null ? "—" : Math.round(vehicle.speedKph)} km/h`;
      element.onclick = () => {
        const popup = new mapboxgl.Popup({ offset: 28, closeButton: true })
          .setLngLat(marker!.getLngLat())
          .setHTML(`
            <div class="fleet-popup">
              <strong>Unité ${vehicle.unit}</strong>
              <div>${vehicle.compagnie} • ${vehicle.speedKph == null ? "—" : Math.round(vehicle.speedKph)} km/h</div>
              ${vehicle.address ? `<div>${vehicle.address}</div>` : ""}
              <div>GPS : ${fmtUpdated(vehicle.updatedAt)}</div>
            </div>`)
          .addTo(map);
        popup.on("close", () => undefined);
      };
    });

    if (!hasFittedRef.current && displayVehicles.length) {
      hasFittedRef.current = true;
      fitAll();
    }
  }, [displayVehicles, fitAll]);

  useEffect(() => {
    if (hasFittedRef.current) fitAll();
  }, [filter, fitAll]);



  return (
    <div className="fleet-page">

      <style>{`
        .fleet-page { position: relative; width: 100%; height: calc(100vh - 0px); min-height: 620px; overflow: hidden; background: #e5e7eb; }
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
        .fleet-marker { --heading: 0deg; position: relative; display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; padding: 0; border: 3px solid #fff; border-radius: 50%; background: var(--fleet-color); color: #fff; box-shadow: 0 4px 14px rgba(15,23,42,.35); cursor: pointer; }
        .fleet-marker-arrow { position: absolute; top: -11px; left: 50%; font-size: 13px; line-height: 1; color: var(--fleet-color); transform: translateX(-50%) rotate(var(--heading)); transform-origin: 50% 17px; text-shadow: 0 1px 1px #fff, 0 -1px 1px #fff, 1px 0 1px #fff, -1px 0 1px #fff; }
        .fleet-marker-label { position: relative; z-index: 1; max-width: 38px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 900; letter-spacing: -.2px; }
        .fleet-popup { min-width: 170px; color: #0f172a; font-size: 13px; line-height: 1.45; }
        .fleet-popup strong { display: block; margin-bottom: 4px; font-size: 15px; }
        .mapboxgl-popup-content { border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(15,23,42,.18); }
        @media (max-width: 760px) { .fleet-toolbar { align-items: flex-start; flex-direction: column; } .fleet-actions { justify-content: flex-start; } }
      `}</style>
      <div ref={mapNode} className="fleet-map" />
      <div className="fleet-toolbar">
        <div>
          <div className="fleet-title">Carte des unités</div>
          <div className="fleet-status">
            <span className={`fleet-live-dot ${error ? "is-error" : ""}`} />
            {error ? error : refreshing ? "Actualisation…" : `Live • ${lastRefresh ? fmtUpdated(lastRefresh.toISOString()) : "connexion…"}`}
          </div>
        </div>
        <div className="fleet-actions">
          {(["ALL", "AB", "AC", "TS"] as const).map((value) => (
            <button key={value} className={`fleet-filter ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>
              {value === "ALL" ? "Toutes" : value}
            </button>
          ))}
          <button className="fleet-filter" onClick={fitAll}>Centrer</button>
          <button className="fleet-filter" disabled={refreshing} onClick={() => void refresh()}>↻</button>
        </div>
      </div>
      <div className="fleet-count">{loading ? "Chargement…" : `${displayVehicles.length} unité${displayVehicles.length > 1 ? "s" : ""} en ligne`}</div>
    </div>
  );
}
