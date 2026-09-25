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
