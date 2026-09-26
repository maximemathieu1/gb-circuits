import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { circuitSupabase } from "../lib/circuitSupabase";

type Compagnie = "AB" | "AC" | "TS";
type Filter = "ALL" | Compagnie;
type VehicleStatus = "MOVING" | "STOPPED" | "STALE";

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

type CircuitRow = {
  circuit: string;
  unite: string;
  compagnie: string;
  nom_conducteur: string | null;
  telephone: string | null;
};

type DisplayVehicle = LiveVehicle & {
  compagnie: Compagnie;
  key: string;
  circuits: string[];
  conducteurs: string[];
  contactsConducteur: Array<{
    nom: string;
    telephone: string;
  }>;
  status: VehicleStatus;
  ageSeconds: number | null;
};

type Destination = {
  longitude: number;
  latitude: number;
};

type EtaInfo = {
  durationSeconds: number;
  distanceMeters: number;
  arrivalAt: string;
};

type HistoryPoint = {
  time: string;
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
  speedKph: number | null;
  address: string | null;
};

type HistoryData = {
  vehicleId: string;
  vehicleName: string | null;
  unit: string;
  compagnie: string;
  startTime: string;
  endTime: string;
  points: HistoryPoint[];
  summary: {
    pointCount: number;
    distanceKm: number;
    maxSpeedKph: number | null;
    movingMinutes: number;
  };
};

type HistoryStop = {
  startIndex: number;
  endIndex: number;
  durationMinutes: number;
};

type SchoolRow = {
  id?: string;
  nom_ecole: string;
  adresse?: string | null;
  latitude: number | null;
  longitude: number | null;
  actif?: boolean | null;
};

type SpeedingInterval = {
  startTime: string;
  endTime: string;
  postedSpeedLimitKph: number | null;
  maxSpeedKph: number | null;
  maxSpeedOverKph: number | null;
  severityLevel: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
};

type TimelineMode = "TRIP" | "SPEED";

const REFRESH_MS = 5000;
const SOC_REFRESH_MS = 30000;
const STALE_AFTER_SECONDS = 180;

const SOURCE_ID = "fleet-source";
const CLUSTER_LAYER_ID = "fleet-clusters";
const CLUSTER_COUNT_LAYER_ID = "fleet-cluster-count";
const CIRCLE_LAYER_ID = "fleet-stopped-circles";
const LABEL_LAYER_ID = "fleet-labels";
const HEADING_LAYER_ID = "fleet-moving-triangles";

const ROUTE_SOURCE_ID = "fleet-route-source";
const ROUTE_LAYER_ID = "fleet-route-layer";
const DEST_SOURCE_ID = "fleet-destination-source";
const DEST_LAYER_ID = "fleet-destination-layer";
const HISTORY_SOURCE_ID = "fleet-history-source";
const HISTORY_LAYER_ID = "fleet-history-layer";
const HISTORY_POINT_SOURCE_ID = "fleet-history-point-source";
const HISTORY_POINT_LAYER_ID = "fleet-history-point-layer";

const SCHOOL_SOURCE_ID = "fleet-school-source";
const SCHOOL_POINT_LAYER_ID = "fleet-school-points";
const SCHOOL_INNER_LAYER_ID = "fleet-school-inner";
const SCHOOL_LABEL_LAYER_ID = "fleet-school-labels";

const VIEW_STORAGE_KEY = "gb-circuits-fleet-view-v2";

const companyColor: Record<Compagnie, string> = {
  AB: "#2563eb",
  AC: "#f59e0b",
  TS: "#16a34a",
};

function schoolGeoJson(schools: SchoolRow[]) {
  return {
    type: "FeatureCollection",
    features: schools
      .filter(
        (school) =>
          school.actif !== false &&
          school.latitude != null &&
          school.longitude != null &&
          Number.isFinite(Number(school.latitude)) &&
          Number.isFinite(Number(school.longitude)),
      )
      .map((school) => ({
        type: "Feature",
        properties: {
          id: school.id ?? "",
          nom: school.nom_ecole,
          adresse: school.adresse ?? "",
        },
        geometry: {
          type: "Point",
          coordinates: [
            Number(school.longitude),
            Number(school.latitude),
          ],
        },
      })),
  };
}

function speedingColor(overKph: number | null) {
  if (overKph == null || overKph <= 0) return "#cbd5e1";
  if (overKph >= 16) return "#dc2626";
  if (overKph >= 12) return "#c2410c";
  return "#f59e0b";
}

function findSpeedingInterval(
  time: string,
  intervals: SpeedingInterval[],
) {
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp)) return null;

  return (
    intervals.find((interval) => {
      const start = Date.parse(interval.startTime);
      const end = Date.parse(interval.endTime);
      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        timestamp >= start &&
        timestamp <= end
      );
    }) ?? null
  );
}

function buildSpeedingGradient(
  points: HistoryPoint[],
  intervals: SpeedingInterval[],
) {
  if (points.length < 2) {
    return "linear-gradient(to right, #cbd5e1 0%, #cbd5e1 100%)";
  }

  const maxIndex = points.length - 1;
  const segments: Array<{
    startIndex: number;
    endIndex: number;
    color: string;
  }> = [];

  let startIndex = 0;
  let currentColor = speedingColor(
    findSpeedingInterval(points[0].time, intervals)?.maxSpeedOverKph ?? null,
  );

  for (let i = 1; i < points.length; i += 1) {
    const color = speedingColor(
      findSpeedingInterval(points[i].time, intervals)?.maxSpeedOverKph ?? null,
    );

    if (color !== currentColor) {
      segments.push({
        startIndex,
        endIndex: i,
        color: currentColor,
      });
      startIndex = i;
      currentColor = color;
    }
  }

  segments.push({
    startIndex,
    endIndex: maxIndex,
    color: currentColor,
  });

  const parts: string[] = [];

  for (const segment of segments) {
    const start = (segment.startIndex / maxIndex) * 100;
    const end = (segment.endIndex / maxIndex) * 100;
    parts.push(`${segment.color} ${start}%`);
    parts.push(`${segment.color} ${end}%`);
  }

  return `linear-gradient(to right, ${parts.join(", ")})`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function companyCode(value: string): Compagnie {
  if (value === "Autobus Champagne") return "AC";
  if (value === "Transport Sécuritaire") return "TS";
  return "AB";
}

function companyFullName(value: Compagnie) {
  if (value === "AC") return "Autobus Champagne";
  if (value === "TS") return "Transport Sécuritaire";
  return "Autobus Breton";
}

function fmtTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtAge(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours} h ${remain} min` : `${hours} h`;
}

function fmtDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function fmtDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours} h ${remain} min` : `${hours} h`;
}


function historyDistanceMeters(a: HistoryPoint, b: HistoryPoint) {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function trimHistoryDeparture(points: HistoryPoint[]) {
  if (points.length < 2) return points;

  // Début réel : coupe le temps mort avant que l'autobus quitte son point initial.
  const origin = points[0];
  let departureIndex = 0;

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const distance = historyDistanceMeters(origin, point);
    const speed = Number(point.speedKph ?? 0);

    if (distance >= 75 && speed >= 3) {
      departureIndex = Math.max(0, i - 1);
      break;
    }
  }

  // Fin réelle : coupe aussi le temps mort après l'arrivée au point final.
  const destination = points[points.length - 1];
  let arrivalIndex = points.length - 1;

  for (let i = points.length - 2; i >= departureIndex; i -= 1) {
    const point = points[i];
    const distance = historyDistanceMeters(destination, point);
    const speed = Number(point.speedKph ?? 0);

    if (distance >= 75 && speed >= 3) {
      arrivalIndex = Math.min(points.length - 1, i + 1);
      break;
    }
  }

  return points.slice(departureIndex, arrivalIndex + 1);
}

function detectHistoryStops(points: HistoryPoint[]) {
  const stops: HistoryStop[] = [];
  const maxRadiusMeters = 75;
  const minStopMs = 5 * 60 * 1000;
  let i = 0;

  while (i < points.length - 1) {
    const anchor = points[i];
    const anchorSpeed = Number(anchor.speedKph ?? 0);

    if (anchorSpeed > 5) {
      i += 1;
      continue;
    }

    let j = i + 1;

    while (j < points.length) {
      const point = points[j];
      const distance = historyDistanceMeters(anchor, point);
      const speed = Number(point.speedKph ?? 0);

      if (distance > maxRadiusMeters || speed > 8) break;
      j += 1;
    }

    const endIndex = Math.max(i, j - 1);
    const durationMs =
      Date.parse(points[endIndex].time) - Date.parse(points[i].time);

    if (durationMs >= minStopMs) {
      stops.push({
        startIndex: i,
        endIndex,
        durationMinutes: Math.max(5, Math.round(durationMs / 60000)),
      });
      i = Math.max(j, i + 1);
    } else {
      i += 1;
    }
  }

  return stops;
}

function buildTimelineGradient(points: HistoryPoint[], stops: HistoryStop[]) {
  if (points.length < 2 || stops.length === 0) {
    return "linear-gradient(to right, #2563eb 0%, #2563eb 100%)";
  }

  const maxIndex = points.length - 1;
  const parts: string[] = [];
  let cursor = 0;

  for (const stop of stops) {
    const start = Math.max(0, Math.min(100, (stop.startIndex / maxIndex) * 100));
    const end = Math.max(start, Math.min(100, (stop.endIndex / maxIndex) * 100));

    parts.push(`#2563eb ${cursor}%`);
    parts.push(`#2563eb ${start}%`);
    parts.push(`#f59e0b ${start}%`);
    parts.push(`#f59e0b ${end}%`);
    cursor = end;
  }

  parts.push(`#2563eb ${cursor}%`);
  parts.push("#2563eb 100%");

  return `linear-gradient(to right, ${parts.join(", ")})`;
}

function interpolateHeading(
  from: number | null,
  to: number | null,
  t: number,
) {
  if (from == null && to == null) return null;
  if (from == null) return to;
  if (to == null) return from;

  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function interpolateVehicle(
  from: DisplayVehicle,
  to: DisplayVehicle,
  t: number,
): DisplayVehicle {
  const fromLat = Number(from.latitude);
  const fromLng = Number(from.longitude);
  const toLat = Number(to.latitude);
  const toLng = Number(to.longitude);

  return {
    ...to,
    latitude:
      Number.isFinite(fromLat) && Number.isFinite(toLat)
        ? fromLat + (toLat - fromLat) * t
        : to.latitude,
    longitude:
      Number.isFinite(fromLng) && Number.isFinite(toLng)
        ? fromLng + (toLng - fromLng) * t
        : to.longitude,
    headingDegrees: interpolateHeading(
      from.headingDegrees,
      to.headingDegrees,
      t,
    ),
  };
}

function validCoordinate(vehicle: Pick<DisplayVehicle, "latitude" | "longitude">) {
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

function calculateAgeSeconds(updatedAt: string | null) {
  if (!updatedAt) return null;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
}

function calculateStatus(live: LiveVehicle): VehicleStatus {
  const age = calculateAgeSeconds(live.updatedAt);
  if (age == null || age > STALE_AFTER_SECONDS) return "STALE";
  if (Number(live.speedKph ?? 0) >= 3) return "MOVING";
  return "STOPPED";
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function loadSavedView() {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lng = Number(parsed.lng);
    const lat = Number(parsed.lat);
    const zoom = Number(parsed.zoom);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) {
      return null;
    }
    return { lng, lat, zoom };
  } catch {
    return null;
  }
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
        circuits: vehicle.circuits.join(", "),
        conducteurs: vehicle.conducteurs.join(", "),
        batterySocPercent: vehicle.batterySocPercent ?? null,
        status: vehicle.status,
        opacity: vehicle.status === "STALE" ? 0.52 : 0.96,
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
  const pageRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const firstFitDoneRef = useRef(false);
  const busyRef = useRef(false);
  const latestDisplayRef = useRef<DisplayVehicle[]>([]);
  const selectedKeyRef = useRef<string | null>(null);
  const followKeyRef = useRef<string | null>(null);
  const destinationRef = useRef<Destination | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const routeRequestIdRef = useRef(0);
  const searchWasActiveRef = useRef(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const socBusyRef = useRef(false);
  const lastSocRefreshRef = useRef(0);
  const mapAnimationFrameRef = useRef<number | null>(null);
  const renderedMapVehiclesRef = useRef<DisplayVehicle[]>([]);
  const lastAutoFollowSearchRef = useRef("");
  const manualSearchOverrideRef = useRef(false);

  const [vehicles, setVehicles] = useState<Record<string, LiveVehicle>>({});
  const [circuits, setCircuits] = useState<CircuitRow[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [followKey, setFollowKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [eta, setEta] = useState<EtaInfo | null>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [etaError, setEtaError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });
  const [historyStart, setHistoryStart] = useState("06:00");
  const [historyEnd, setHistoryEnd] = useState("18:00");
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyIndex, setHistoryIndex] = useState(0);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("TRIP");
  const [speedingIntervals, setSpeedingIntervals] = useState<SpeedingInterval[]>([]);
  const [speedingLoading, setSpeedingLoading] = useState(false);
  const [speedingError, setSpeedingError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(30);

  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  useEffect(() => {
    followKeyRef.current = followKey;
  }, [followKey]);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  const circuitsByVehicle = useMemo(() => {
    const map = new Map<
      string,
      {
        circuits: string[];
        conducteurs: string[];
        contactsConducteur: Array<{ nom: string; telephone: string }>;
      }
    >();

    for (const row of circuits) {
      const unit = String(row.unite ?? "").trim();
      if (!unit) continue;

      const key = `${companyCode(row.compagnie)}::${unit}`;
      const current = map.get(key) ?? {
        circuits: [],
        conducteurs: [],
        contactsConducteur: [],
      };
      const circuit = String(row.circuit ?? "").trim();
      const conducteur = String(row.nom_conducteur ?? "").trim();
      const telephone = String(row.telephone ?? "").trim();

      if (circuit && !current.circuits.includes(circuit)) {
        current.circuits.push(circuit);
        current.circuits.sort((a, b) =>
          a.localeCompare(b, "fr-CA", {
            numeric: true,
            sensitivity: "base",
          }),
        );
      }

      if (conducteur && !current.conducteurs.includes(conducteur)) {
        current.conducteurs.push(conducteur);
        current.conducteurs.sort((a, b) =>
          a.localeCompare(b, "fr-CA", { sensitivity: "base" }),
        );
      }

      if (conducteur || telephone) {
        const contactExiste = current.contactsConducteur.some(
          (contact) =>
            normalizeText(contact.nom) === normalizeText(conducteur) &&
            contact.telephone === telephone,
        );

        if (!contactExiste) {
          current.contactsConducteur.push({
            nom: conducteur || "Conducteur",
            telephone,
          });
        }
      }

      map.set(key, current);
    }

    return map;
  }, [circuits]);

  const allDisplayVehicles = useMemo<DisplayVehicle[]>(() => {
    return Object.entries(vehicles)
      .map(([key, live]) => {
        const prefix = key.split("::")[0];
        const compagnie: Compagnie =
          prefix === "AC" ? "AC" : prefix === "TS" ? "TS" : "AB";
        const extra = circuitsByVehicle.get(key) ?? {
          circuits: [],
          conducteurs: [],
          contactsConducteur: [],
        };
        const ageSeconds = calculateAgeSeconds(live.updatedAt);

        return {
          ...live,
          compagnie,
          key,
          circuits: extra.circuits,
          conducteurs: extra.conducteurs,
          contactsConducteur: extra.contactsConducteur,
          status: calculateStatus(live),
          ageSeconds,
        };
      })
      .filter((vehicle) => vehicle.found !== false)
      .filter(validCoordinate)
      .sort((a, b) =>
        String(a.unit).localeCompare(String(b.unit), "fr-CA", {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [vehicles, circuitsByVehicle]);

  const searchSuggestions = useMemo(() => {
    const q = normalizeText(searchInput);

    return allDisplayVehicles.filter((vehicle) => {
      if (filter !== "ALL" && vehicle.compagnie !== filter) return false;
      if (!q) return true;

      return (
        normalizeText(vehicle.unit).includes(q) ||
        vehicle.circuits.some((circuit) =>
          normalizeText(circuit).includes(q),
        ) ||
        vehicle.conducteurs.some((name) =>
          normalizeText(name).includes(q),
        )
      );
    });
  }, [allDisplayVehicles, filter, searchInput]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const box = searchBoxRef.current;
      if (!box) return;

      if (!box.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  const displayVehicles = useMemo(() => {
    const q = normalizeText(search);

    return allDisplayVehicles.filter((vehicle) => {
      if (filter !== "ALL" && vehicle.compagnie !== filter) return false;
      if (!q) return true;

      return (
        normalizeText(vehicle.unit).includes(q) ||
        vehicle.circuits.some((circuit) => normalizeText(circuit).includes(q)) ||
        vehicle.conducteurs.some((name) => normalizeText(name).includes(q))
      );
    });
  }, [allDisplayVehicles, filter, search]);

  const selectedVehicle = useMemo(() => {
    if (!selectedKey) return null;
    return allDisplayVehicles.find((vehicle) => vehicle.key === selectedKey) ?? null;
  }, [allDisplayVehicles, selectedKey]);

  const mapVehicles = useMemo(() => {
    if (historyOpen && selectedVehicle) return [selectedVehicle];
    if (!followKey) return displayVehicles;
    const followed = allDisplayVehicles.find((vehicle) => vehicle.key === followKey);
    return followed ? [followed] : [];
  }, [displayVehicles, allDisplayVehicles, followKey, historyOpen, selectedVehicle]);

  const fitVehicles = useCallback((items: DisplayVehicle[], animate = true) => {
    const map = mapRef.current;
    const valid = items.filter(validCoordinate);
    if (!map || !mapReadyRef.current || valid.length === 0) return false;

    if (valid.length === 1) {
      if (animate) {
        map.easeTo({
          center: [Number(valid[0].longitude), Number(valid[0].latitude)],
          zoom: Math.max(map.getZoom(), 15),
          duration: 500,
        });
      } else {
        map.jumpTo({
          center: [Number(valid[0].longitude), Number(valid[0].latitude)],
          zoom: 15,
        });
      }
      return true;
    }

    const bounds = new mapboxgl.LngLatBounds();
    valid.forEach((vehicle) => {
      bounds.extend([Number(vehicle.longitude), Number(vehicle.latitude)]);
    });

    map.fitBounds(bounds, {
      padding: { top: 50, right: 50, bottom: 50, left: 50 },
      maxZoom: 14,
      duration: animate ? 600 : 0,
    });

    return true;
  }, []);

  const syncMapData = useCallback(
    (items: DisplayVehicle[], animate = true) => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current) return;

      const source = map.getSource(SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;

      if (!source) return;

      if (mapAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(mapAnimationFrameRef.current);
        mapAnimationFrameRef.current = null;
      }

      const previous = renderedMapVehiclesRef.current;
      const previousByKey = new Map(
        previous.map((item) => [item.key, item]),
      );

      if (!animate || previous.length === 0) {
        renderedMapVehiclesRef.current = items;
        source.setData(toGeoJson(items) as any);
        return;
      }

      // Interpolation presque jusqu'au prochain refresh Samsara.
      // Résultat : déplacement continu au lieu d'un bond toutes les ~5 s.
      const durationMs = Math.max(1000, REFRESH_MS - 350);
      const startedAt = performance.now();

      const step = (now: number) => {
        const rawT = Math.min(1, (now - startedAt) / durationMs);
        const t = rawT * rawT * (3 - 2 * rawT);

        const interpolated = items.map((target) => {
          const origin = previousByKey.get(target.key);

          if (
            !origin ||
            !validCoordinate(origin) ||
            !validCoordinate(target)
          ) {
            return target;
          }

          return interpolateVehicle(origin, target, t);
        });

        renderedMapVehiclesRef.current = interpolated;
        source.setData(toGeoJson(interpolated) as any);

        // En mode suivi, la caméra suit exactement le même mouvement fluide.
        const followedKey = followKeyRef.current;
        if (followedKey) {
          const followed = interpolated.find(
            (vehicle) => vehicle.key === followedKey,
          );

          if (followed && validCoordinate(followed)) {
            map.setCenter([
              Number(followed.longitude),
              Number(followed.latitude),
            ]);
          }
        }

        if (rawT < 1) {
          mapAnimationFrameRef.current =
            window.requestAnimationFrame(step);
        } else {
          renderedMapVehiclesRef.current = items;
          mapAnimationFrameRef.current = null;
        }
      };

      mapAnimationFrameRef.current =
        window.requestAnimationFrame(step);
    },
    [],
  );

  const selectVehicle = useCallback((key: string, center = false) => {
    const vehicle = latestDisplayRef.current.find((item) => item.key === key);
    setSelectedKey(key);
    setSidebarOpen(true);

    if (center && vehicle && validCoordinate(vehicle)) {
      mapRef.current?.easeTo({
        center: [Number(vehicle.longitude), Number(vehicle.latitude)],
        zoom: Math.max(mapRef.current.getZoom(), 15),
        duration: 500,
      });
    }
  }, []);

  const clearRoute = useCallback(() => {
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    routeRequestIdRef.current += 1;

    setDestination(null);
    setEta(null);
    setEtaError("");
    setEtaLoading(false);

    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const routeSource = map.getSource(ROUTE_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;
    routeSource?.setData({
      type: "FeatureCollection",
      features: [],
    } as any);

    const destinationSource = map.getSource(DEST_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;
    destinationSource?.setData({
      type: "FeatureCollection",
      features: [],
    } as any);
  }, []);

  const calculateRoute = useCallback(
    async (vehicle: DisplayVehicle, nextDestination: Destination) => {
      const token =
        import.meta.env.VITE_MAPBOX_TOKEN ||
        import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

      if (!token || !validCoordinate(vehicle)) return;

      const requestId = ++routeRequestIdRef.current;
      routeAbortRef.current?.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      setDestination(nextDestination);
      setEta(null);
      setEtaError("");
      setEtaLoading(true);

      try {
        const coordinates =
          `${vehicle.longitude},${vehicle.latitude};` +
          `${nextDestination.longitude},${nextDestination.latitude}`;

        const response = await fetch(
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}` +
            `?alternatives=false&geometries=geojson&overview=full&steps=false` +
            `&access_token=${encodeURIComponent(token)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Mapbox Directions ${response.status}`);
        }

        const data = await response.json();

        if (requestId !== routeRequestIdRef.current) return;

        const route = data?.routes?.[0];
        if (!route?.geometry) {
          throw new Error("Aucun itinéraire trouvé.");
        }

        const durationSeconds = Number(route.duration ?? 0);
        const distanceMeters = Number(route.distance ?? 0);

        setEta({
          durationSeconds,
          distanceMeters,
          arrivalAt: new Date(
            Date.now() + durationSeconds * 1000,
          ).toISOString(),
        });

        const map = mapRef.current;
        if (!map || !mapReadyRef.current) return;

        const routeSource = map.getSource(ROUTE_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;
        routeSource?.setData({
          type: "Feature",
          properties: {},
          geometry: route.geometry,
        } as any);

        const destinationSource = map.getSource(DEST_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;
        destinationSource?.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Point",
                coordinates: [
                  nextDestination.longitude,
                  nextDestination.latitude,
                ],
              },
            },
          ],
        } as any);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setEtaError(err?.message || "Impossible de calculer l’itinéraire.");
      } finally {
        if (requestId === routeRequestIdRef.current) {
          setEtaLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    latestDisplayRef.current = allDisplayVehicles;
    syncMapData(mapVehicles);

    if (
      !firstFitDoneRef.current &&
      mapReadyRef.current &&
      displayVehicles.length > 0
    ) {
      const didFit = fitVehicles(displayVehicles, false);
      if (didFit) firstFitDoneRef.current = true;
    }

  }, [mapVehicles, displayVehicles, allDisplayVehicles, fitVehicles, syncMapData]);

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
    const savedView = loadSavedView();

    const map = new mapboxgl.Map({
      container: mapNode.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: savedView ? [savedView.lng, savedView.lat] : [-70.67, 46.12],
      zoom: savedView?.zoom ?? 9,
      attributionControl: true,
    });

    if (savedView) {
      firstFitDoneRef.current = true;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      mapReadyRef.current = true;

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toGeoJson([]) as any,
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 42,
      } as any);

      map.addLayer({
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#0f172a",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            20,
            5,
            24,
            15,
            30,
            30,
            36,
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 0.9,
        },
      });

      map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 13,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: [
          "all",
          ["!", ["has", "point_count"]],
          ["!=", ["get", "status"], "MOVING"],
        ],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            6,
            12,
            8,
            16,
            9,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
      });

      map.addLayer({
        id: LABEL_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "unit"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            10,
            12,
            11,
            16,
            12,
          ],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-anchor": "top",
          "text-offset": [
            "case",
            ["==", ["get", "status"], "MOVING"],
            ["literal", [0, 1.75]],
            ["literal", [0, 1.55]],
          ],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 3,
        },
      });

      map.addLayer({
        id: HEADING_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "status"], "MOVING"],
        ],
        layout: {
          "text-field": "▲",
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            18,
            12,
            22,
            16,
            26,
          ],
          "text-rotate": ["get", "heading"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
          "text-opacity": ["get", "opacity"],
        },
      });

      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 4,
          "line-opacity": 0.85,
        },
      });

      map.addSource(DEST_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: DEST_LAYER_ID,
        type: "circle",
        source: DEST_SOURCE_ID,
        paint: {
          "circle-radius": 9,
          "circle-color": "#dc2626",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
        },
      });

      map.addSource(SCHOOL_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: SCHOOL_POINT_LAYER_ID,
        type: "circle",
        source: SCHOOL_SOURCE_ID,
        minzoom: 8,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            7,
            11,
            9,
            14,
            11,
            17,
            13,
          ],
          "circle-color": "#7c3aed",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 1,
        },
      });

      map.addLayer({
        id: SCHOOL_LABEL_LAYER_ID,
        type: "symbol",
        source: SCHOOL_SOURCE_ID,
        minzoom: 9,
        layout: {
          "text-field": ["concat", "ÉCOLE · ", ["get", "nom"]],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            10,
            12,
            12,
            16,
            14,
          ],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-offset": [0, 1.55],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-padding": 4,
        },
        paint: {
          "text-color": "#4c1d95",
          "text-halo-color": "#ffffff",
          "text-halo-width": 3,
          "text-halo-blur": 0.4,
        },
      });

      map.addLayer({
        id: SCHOOL_INNER_LAYER_ID,
        type: "circle",
        source: SCHOOL_SOURCE_ID,
        minzoom: 8,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            2.5,
            12,
            3.5,
            16,
            4.5,
          ],
          "circle-color": "#ffffff",
          "circle-stroke-color": "#7c3aed",
          "circle-stroke-width": 1.5,
          "circle-opacity": 1,
        },
      });

      const showSchoolPopup = (event: mapboxgl.MapMouseEvent & {
        features?: mapboxgl.MapboxGeoJSONFeature[];
      }) => {
        const feature = event.features?.[0] as any;
        if (!feature) return;

        const coordinates = feature.geometry?.coordinates as [number, number];
        const nom = String(feature.properties?.nom ?? "École");
        const adresse = String(feature.properties?.adresse ?? "");

        const wrapper = document.createElement("div");
        wrapper.style.fontFamily = "inherit";

        const title = document.createElement("strong");
        title.textContent = nom;
        wrapper.appendChild(title);

        if (adresse) {
          const address = document.createElement("div");
          address.textContent = adresse;
          address.style.marginTop = "4px";
          address.style.fontSize = "12px";
          wrapper.appendChild(address);
        }

        new mapboxgl.Popup({ offset: 10 })
          .setLngLat(coordinates)
          .setDOMContent(wrapper)
          .addTo(map);
      };

      map.on("click", SCHOOL_POINT_LAYER_ID, showSchoolPopup);
      map.on("click", SCHOOL_INNER_LAYER_ID, showSchoolPopup);

      [SCHOOL_POINT_LAYER_ID, SCHOOL_INNER_LAYER_ID].forEach((layerId) => {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      });

      map.addSource(HISTORY_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: HISTORY_LAYER_ID,
        type: "line",
        source: HISTORY_SOURCE_ID,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#2563eb",
          "line-width": 5,
          "line-opacity": 0.8,
        },
      });

      map.addSource(HISTORY_POINT_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: HISTORY_POINT_LAYER_ID,
        type: "circle",
        source: HISTORY_POINT_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": "#2563eb",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      renderedMapVehiclesRef.current = latestDisplayRef.current;
      syncMapData(latestDisplayRef.current, false);

      if (
        !firstFitDoneRef.current &&
        latestDisplayRef.current.length > 0
      ) {
        const didFit = fitVehicles(latestDisplayRef.current, false);
        if (didFit) firstFitDoneRef.current = true;
      }
    });

    map.on("moveend", () => {
      const center = map.getCenter();
      try {
        localStorage.setItem(
          VIEW_STORAGE_KEY,
          JSON.stringify({
            lng: center.lng,
            lat: center.lat,
            zoom: map.getZoom(),
          }),
        );
      } catch {
        // Rien à faire si le stockage local est indisponible.
      }
    });

    map.on("click", CLUSTER_LAYER_ID, (event) => {
      const feature = event.features?.[0] as any;
      if (!feature) return;

      const clusterId = feature.properties?.cluster_id;
      const coordinates = feature.geometry?.coordinates as [number, number];
      const source = map.getSource(SOURCE_ID) as any;

      if (clusterId == null || !source) return;

      source.getClusterExpansionZoom(
        clusterId,
        (clusterError: Error | null, zoom: number) => {
          if (clusterError) return;
          map.easeTo({
            center: coordinates,
            zoom,
            duration: 450,
          });
        },
      );
    });

    map.on("click", CIRCLE_LAYER_ID, (event) => {
      const feature = event.features?.[0] as any;
      const key = String(feature?.properties?.key ?? "");
      if (!key) return;
      selectVehicle(key, false);
    });

    map.on("click", HEADING_LAYER_ID, (event) => {
      const feature = event.features?.[0] as any;
      const key = String(feature?.properties?.key ?? "");
      if (!key) return;
      selectVehicle(key, false);
    });

    map.on("mouseenter", CLUSTER_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", CLUSTER_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseenter", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseenter", HEADING_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", HEADING_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("contextmenu", (event) => {
      event.preventDefault();

      // L'ETA est disponible seulement pendant le suivi d'une unité.
      const key = followKeyRef.current;
      if (!key) return;

      const vehicle = latestDisplayRef.current.find((item) => item.key === key);
      if (!vehicle) return;

      void calculateRoute(vehicle, {
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
      });
    });

    return () => {
      routeAbortRef.current?.abort();

      if (mapAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(mapAnimationFrameRef.current);
        mapAnimationFrameRef.current = null;
      }

      mapReadyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, [calculateRoute, fitVehicles, selectVehicle, syncMapData]);

  useEffect(() => {
    let cancelled = false;

    const loadCircuits = async () => {
      try {
        const { data, error: circuitsError } = await circuitSupabase
          .from("circuits_scolaires")
          .select("circuit, unite, compagnie, nom_conducteur, telephone");

        if (circuitsError) throw circuitsError;

        if (!cancelled) {
          setCircuits((data ?? []) as CircuitRow[]);
        }
      } catch (err) {
        console.error("Erreur chargement circuits pour la carte", err);
      }
    };

    void loadCircuits();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const geocodeMissingSchools = async (rows: SchoolRow[]) => {
      const missing = rows.filter(
        (school) =>
          school.actif !== false &&
          (school.latitude == null ||
            school.longitude == null ||
            !Number.isFinite(Number(school.latitude)) ||
            !Number.isFinite(Number(school.longitude))),
      );

      if (missing.length === 0) return rows;

      const token =
        import.meta.env.VITE_MAPBOX_TOKEN ||
        import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

      if (!token) return rows;

      try {
        const response = await fetch(
          `https://api.mapbox.com/search/geocode/v6/batch?access_token=${encodeURIComponent(
            token,
          )}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              missing.map((school) => ({
                q: `${school.adresse ?? ""}, Québec, Canada`,
                country: ["ca"],
                bbox: [-72.5, 45.0, -68.5, 48.0],
                limit: 1,
              })),
            ),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Géocodage Mapbox ${response.status} ${response.statusText}`,
          );
        }

        const body = await response.json();
        const batch = Array.isArray(body?.batch) ? body.batch : [];
        const geocodedById = new Map<string, { lat: number; lng: number }>();

        missing.forEach((school, index) => {
          const feature = batch[index]?.features?.[0];
          const coordinates = feature?.geometry?.coordinates;

          if (
            Array.isArray(coordinates) &&
            Number.isFinite(Number(coordinates[0])) &&
            Number.isFinite(Number(coordinates[1]))
          ) {
            geocodedById.set(
              String(school.id ?? school.nom_ecole),
              {
                lng: Number(coordinates[0]),
                lat: Number(coordinates[1]),
              },
            );
          }
        });

        return rows.map((school) => {
          const geocoded = geocodedById.get(
            String(school.id ?? school.nom_ecole),
          );

          return geocoded
            ? {
                ...school,
                latitude: geocoded.lat,
                longitude: geocoded.lng,
              }
            : school;
        });
      } catch (err) {
        console.warn("Géocodage temporaire des écoles impossible", err);
        return rows;
      }
    };

    const loadSchools = async () => {
      const { data, error: schoolsError } = await circuitSupabase
        .from("ecoles")
        .select("id, nom_ecole, adresse, latitude, longitude, actif")
        .order("nom_ecole");

      if (schoolsError) {
        console.warn(
          "Table ecoles non disponible ou inaccessible; les repères écoles sont ignorés.",
          schoolsError,
        );
        return;
      }

      const loaded = (data ?? []) as SchoolRow[];
      const withCoordinates = await geocodeMissingSchools(loaded);

      if (!cancelled) {
        setSchools(withCoordinates);
      }
    };

    void loadSchools();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const source = map.getSource(SCHOOL_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;

    source?.setData(schoolGeoJson(schools) as any);
  }, [schools]);


  const clearHistoryMap = useCallback(() => {
    setHistoryData(null);
    setHistoryIndex(0);
    setHistoryError("");
    setSpeedingIntervals([]);
    setSpeedingError("");
    setIsPlaying(false);

    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const lineSource = map.getSource(HISTORY_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;

    lineSource?.setData({
      type: "FeatureCollection",
      features: [],
    } as any);

    const pointSource = map.getSource(HISTORY_POINT_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;

    pointSource?.setData({
      type: "FeatureCollection",
      features: [],
    } as any);
  }, []);

  const loadHistory = useCallback(async () => {
    if (!selectedVehicle?.vehicleId || !historyDate) return;

    setHistoryLoading(true);
    setHistoryError("");

    try {
      const startLocal = new Date(`${historyDate}T${historyStart}:00`);
      const endLocal = new Date(`${historyDate}T${historyEnd}:00`);

      if (
        Number.isNaN(startLocal.getTime()) ||
        Number.isNaN(endLocal.getTime()) ||
        endLocal <= startLocal
      ) {
        throw new Error("La plage horaire est invalide.");
      }

      const { data, error: historyFunctionError } =
        await circuitSupabase.functions.invoke("circuit-samsara-live", {
          body: {
            mode: "history",
            compagnie: companyFullName(selectedVehicle.compagnie),
            vehicleId: selectedVehicle.vehicleId,
            unit: selectedVehicle.unit,
            startTime: startLocal.toISOString(),
            endTime: endLocal.toISOString(),
          },
        });

      if (historyFunctionError) throw historyFunctionError;
      if (data?.ok === false) {
        throw new Error(data?.error || "Historique Samsara impossible.");
      }

      const history = data?.history as HistoryData;
      const points = Array.isArray(history?.points) ? history.points : [];

      setHistoryData(history);
      setHistoryIndex(0);

      const map = mapRef.current;
      if (!map || !mapReadyRef.current) return;

      const lineSource = map.getSource(HISTORY_SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;

      lineSource?.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: points.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      } as any);

      if (points.length > 0) {
        const first = points[0];
        const pointSource = map.getSource(HISTORY_POINT_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;

        pointSource?.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [first.longitude, first.latitude],
          },
        } as any);

        const bounds = new mapboxgl.LngLatBounds();
        points.forEach((point) => {
          bounds.extend([point.longitude, point.latitude]);
        });

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: { top: 60, right: 60, bottom: 120, left: 60 },
            maxZoom: 15,
            duration: 600,
          });
        }
      }
    } catch (err: any) {
      setHistoryError(
        err?.message || "Impossible de charger l’historique du trajet.",
      );
      clearHistoryMap();
    } finally {
      setHistoryLoading(false);
    }
  }, [
    clearHistoryMap,
    historyDate,
    historyEnd,
    historyStart,
    selectedVehicle?.compagnie,
    selectedVehicle?.unit,
    selectedVehicle?.vehicleId,
  ]);

  useEffect(() => {
    if (!historyOpen || !selectedVehicle?.vehicleId || !historyDate) return;

    const timer = window.setTimeout(() => {
      void loadHistory();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    historyOpen,
    historyDate,
    historyStart,
    historyEnd,
    selectedVehicle?.vehicleId,
    loadHistory,
  ]);

  const loadSpeeding = useCallback(async () => {
    if (!selectedVehicle?.vehicleId || !historyDate) return;

    setSpeedingLoading(true);
    setSpeedingError("");

    try {
      const startLocal = new Date(`${historyDate}T${historyStart}:00`);
      const endLocal = new Date(`${historyDate}T${historyEnd}:00`);

      const { data, error: speedingFunctionError } =
        await circuitSupabase.functions.invoke("circuit-samsara-live", {
          body: {
            mode: "speeding",
            compagnie: companyFullName(selectedVehicle.compagnie),
            vehicleId: selectedVehicle.vehicleId,
            unit: selectedVehicle.unit,
            startTime: startLocal.toISOString(),
            endTime: endLocal.toISOString(),
          },
        });

      if (speedingFunctionError) throw speedingFunctionError;
      if (data?.ok === false) {
        throw new Error(
          data?.error || "Excès de vitesse Samsara impossibles.",
        );
      }

      setSpeedingIntervals(
        Array.isArray(data?.speeding?.intervals)
          ? (data.speeding.intervals as SpeedingInterval[])
          : [],
      );
    } catch (err: any) {
      setSpeedingIntervals([]);
      setSpeedingError(
        err?.message ||
          "Impossible de charger les excès de vitesse Samsara.",
      );
    } finally {
      setSpeedingLoading(false);
    }
  }, [
    historyDate,
    historyEnd,
    historyStart,
    selectedVehicle?.compagnie,
    selectedVehicle?.unit,
    selectedVehicle?.vehicleId,
  ]);

  useEffect(() => {
    if (!historyOpen || !selectedVehicle?.vehicleId || !historyDate) return;

    const timer = window.setTimeout(() => {
      void loadSpeeding();
    }, 220);

    return () => window.clearTimeout(timer);
  }, [
    historyOpen,
    historyDate,
    historyStart,
    historyEnd,
    selectedVehicle?.vehicleId,
    loadSpeeding,
  ]);

  const refreshSoc = useCallback(
    async (baseVehicles: Record<string, LiveVehicle>, force = false) => {
      const now = Date.now();

      if (socBusyRef.current) return;
      if (!force && now - lastSocRefreshRef.current < SOC_REFRESH_MS) return;

      const requested = Object.entries(baseVehicles)
        .map(([key, vehicle]) => {
          const prefix = key.split("::")[0] as Compagnie;
          const unit = String(vehicle.unit ?? "").trim();

          if (!unit || !["AB", "AC", "TS"].includes(prefix)) return null;

          return {
            unit,
            compagnie: companyFullName(prefix),
          };
        })
        .filter(Boolean);

      if (requested.length === 0) return;

      socBusyRef.current = true;

      try {
        const { data, error: socError } =
          await circuitSupabase.functions.invoke("circuit-samsara-live", {
            body: { vehicles: requested },
          });

        if (socError) throw socError;
        if (data?.ok === false) {
          throw new Error(data?.error || "Lecture SOC impossible.");
        }

        const enriched =
          data?.vehicles && typeof data.vehicles === "object"
            ? (data.vehicles as Record<string, LiveVehicle>)
            : {};

        setVehicles((current) => {
          const next = { ...current };

          for (const [key, live] of Object.entries(enriched)) {
            if (!next[key]) continue;

            next[key] = {
              ...next[key],
              batterySocPercent:
                live.batterySocPercent ?? next[key].batterySocPercent ?? null,
            };
          }

          return next;
        });

        lastSocRefreshRef.current = Date.now();
      } catch (err) {
        console.warn("SOC Samsara non disponible sur la carte", err);
      } finally {
        socBusyRef.current = false;
      }
    },
    [],
  );

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

      setVehicles((current) => {
        const next: Record<string, LiveVehicle> = {};

        for (const [key, live] of Object.entries(nextVehicles)) {
          next[key] = {
            ...live,
            batterySocPercent:
              live.batterySocPercent ?? current[key]?.batterySocPercent ?? null,
          };
        }

        return next;
      });

      void refreshSoc(nextVehicles);
      setLastRefresh(new Date());
      setError("");
    } catch (err: any) {
      setError(err?.message || "Impossible de lire les positions Samsara.");
    } finally {
      busyRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [refreshSoc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!destination || !selectedVehicle) return;

    const timer = window.setInterval(() => {
      const latest = allDisplayVehicles.find(
        (item) => item.key === selectedVehicle.key,
      );
      const currentDestination = destinationRef.current;

      if (latest && currentDestination) {
        void calculateRoute(latest, currentDestination);
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [
    destination?.longitude,
    destination?.latitude,
    selectedVehicle?.key,
    allDisplayVehicles,
    calculateRoute,
  ]);

  useEffect(() => {
    const handler = () => {
      setFullscreen(Boolean(document.fullscreenElement));

      const resizeAndRecenter = () => {
        const map = mapRef.current;
        if (!map) return;

        map.resize();

        const followedKey = followKeyRef.current;
        const followed = followedKey
          ? latestDisplayRef.current.find(
              (vehicle) => vehicle.key === followedKey,
            )
          : null;

        const selectedKey = selectedKeyRef.current;
        const selected = selectedKey
          ? latestDisplayRef.current.find(
              (vehicle) => vehicle.key === selectedKey,
            )
          : null;

        const target = followed ?? selected;

        if (target && validCoordinate(target)) {
          map.jumpTo({
            center: [
              Number(target.longitude),
              Number(target.latitude),
            ],
          });
        }
      };

      window.requestAnimationFrame(resizeAndRecenter);
      window.setTimeout(resizeAndRecenter, 120);
      window.setTimeout(resizeAndRecenter, 320);
    };

    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const node = mapNode.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  const historyPoints = historyData?.points ?? [];

  const historyTimelinePoints = useMemo(
    () => trimHistoryDeparture(historyPoints),
    [historyPoints],
  );

  const historyStops = useMemo(
    () => detectHistoryStops(historyTimelinePoints),
    [historyTimelinePoints],
  );

  const historyTimelineGradient = useMemo(
    () => buildTimelineGradient(historyTimelinePoints, historyStops),
    [historyTimelinePoints, historyStops],
  );

  const speedTimelineGradient = useMemo(
    () => buildSpeedingGradient(historyTimelinePoints, speedingIntervals),
    [historyTimelinePoints, speedingIntervals],
  );

  const timelineGradient =
    timelineMode === "SPEED"
      ? speedTimelineGradient
      : historyTimelineGradient;

  const activeHistoryStop = useMemo(
    () =>
      historyStops.find(
        (stop) =>
          historyIndex >= stop.startIndex &&
          historyIndex <= stop.endIndex,
      ) ?? null,
    [historyStops, historyIndex],
  );

  const historyCursorPercent =
    historyTimelinePoints.length <= 1
      ? 0
      : (Math.min(historyIndex, historyTimelinePoints.length - 1) /
          (historyTimelinePoints.length - 1)) *
        100;

  const activeHistoryStopTimes = useMemo(() => {
    if (!activeHistoryStop || historyTimelinePoints.length === 0) return null;

    const start = historyTimelinePoints[activeHistoryStop.startIndex];
    const end = historyTimelinePoints[activeHistoryStop.endIndex];

    if (!start || !end) return null;

    return {
      startTime: start.time,
      endTime: end.time,
      durationMinutes: activeHistoryStop.durationMinutes,
    };
  }, [activeHistoryStop, historyTimelinePoints]);

  const activeSpeedingInterval = useMemo(() => {
    const point =
      historyTimelinePoints[
        Math.min(historyIndex, historyTimelinePoints.length - 1)
      ];

    if (!point) return null;
    return findSpeedingInterval(point.time, speedingIntervals);
  }, [historyTimelinePoints, historyIndex, speedingIntervals]);


  useEffect(() => {
    if (historyTimelinePoints.length === 0) {
      setHistoryIndex(0);
      return;
    }

    setHistoryIndex((current) =>
      Math.min(current, historyTimelinePoints.length - 1),
    );
  }, [historyTimelinePoints.length]);

  useEffect(() => {
    if (!historyTimelinePoints.length) return;

    const point =
      historyTimelinePoints[
        Math.min(historyIndex, historyTimelinePoints.length - 1)
      ];

    if (!point) return;

    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const pointSource = map.getSource(HISTORY_POINT_SOURCE_ID) as
      | mapboxgl.GeoJSONSource
      | undefined;

    pointSource?.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Point",
        coordinates: [point.longitude, point.latitude],
      },
    } as any);
  }, [historyTimelinePoints, historyIndex]);

  const toggleSidebar = useCallback(() => {
    manualSearchOverrideRef.current = true;
    setSidebarOpen((open) => !open);

    // Mapbox doit recalculer sa largeur pendant/après l'animation du panneau.
    window.requestAnimationFrame(() => mapRef.current?.resize());
    window.setTimeout(() => mapRef.current?.resize(), 80);
    window.setTimeout(() => mapRef.current?.resize(), 220);
  }, []);

  const commitVehicleSearch = useCallback(
    (vehicle: DisplayVehicle | null) => {
      if (!vehicle) return;

      manualSearchOverrideRef.current = false;
      lastAutoFollowSearchRef.current = "";
      setSearchInput(vehicle.unit);
      setSearch(vehicle.unit);
      setSearchOpen(false);
    },
    [],
  );

  const commitSearchInput = useCallback(() => {
    const q = normalizeText(searchInput);

    if (!q) {
      manualSearchOverrideRef.current = false;
      lastAutoFollowSearchRef.current = "";
      setSearch("");
      setSearchOpen(false);
      return;
    }

    const exact =
      searchSuggestions.find(
        (vehicle) => normalizeText(vehicle.unit) === q,
      ) ??
      searchSuggestions.find((vehicle) =>
        vehicle.circuits.some(
          (circuit) => normalizeText(circuit) === q,
        ),
      ) ??
      (searchSuggestions.length === 1 ? searchSuggestions[0] : null);

    if (exact) {
      commitVehicleSearch(exact);
      return;
    }

    // S'il y a plusieurs résultats, on laisse le menu ouvert pour choisir.
    setSearchOpen(true);
  }, [commitVehicleSearch, searchInput, searchSuggestions]);

  const handleCenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    map.resize();

    const followedKey = followKeyRef.current;
    const followed = followedKey
      ? latestDisplayRef.current.find(
          (vehicle) => vehicle.key === followedKey,
        )
      : null;

    const target =
      followed ??
      (displayVehicles.length === 1 ? displayVehicles[0] : null);

    if (target && validCoordinate(target)) {
      map.easeTo({
        center: [
          Number(target.longitude),
          Number(target.latitude),
        ],
        zoom: Math.max(map.getZoom(), 15),
        duration: 450,
      });
      return;
    }

    fitVehicles(displayVehicles, true);
  }, [displayVehicles, fitVehicles]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await pageRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Plein écran impossible", err);
    }
  }, []);

  const toggleFollow = useCallback(() => {
    if (!selectedVehicle) return;

    // Une action manuelle doit toujours avoir priorité sur le filtre.
    manualSearchOverrideRef.current = true;

    if (followKey === selectedVehicle.key) {
      setFollowKey(null);
      clearRoute();
      return;
    }

    clearRoute();
    setFollowKey(selectedVehicle.key);

    // "Suivre" centre immédiatement l'unité, puis continue de la suivre.
    if (validCoordinate(selectedVehicle)) {
      mapRef.current?.easeTo({
        center: [
          Number(selectedVehicle.longitude),
          Number(selectedVehicle.latitude),
        ],
        zoom: Math.max(mapRef.current.getZoom(), 15),
        duration: 500,
      });
    }
  }, [clearRoute, followKey, selectedVehicle]);

  useEffect(() => {
    const q = normalizeText(search);

    if (!q) {
      if (searchWasActiveRef.current) {
        setFollowKey(null);
        clearRoute();
        setHistoryOpen(false);
        clearHistoryMap();
      }

      searchWasActiveRef.current = false;
      lastAutoFollowSearchRef.current = "";
      manualSearchOverrideRef.current = false;
      return;
    }

    searchWasActiveRef.current = true;

    // Historique ou action manuelle : le filtre demeure visible,
    // mais il ne reprend jamais le contrôle tout seul.
    if (historyOpen || manualSearchOverrideRef.current) return;

    // Important : un refresh GPS change displayVehicles toutes les 5 s.
    // On ne doit donc auto-suivre qu'une seule fois par valeur recherchée.
    if (lastAutoFollowSearchRef.current === q) return;

    const exactMatches = displayVehicles.filter((vehicle) => {
      return (
        normalizeText(vehicle.unit) === q ||
        vehicle.circuits.some(
          (circuit) => normalizeText(circuit) === q,
        )
      );
    });

    const target =
      exactMatches.length === 1
        ? exactMatches[0]
        : displayVehicles.length === 1
          ? displayVehicles[0]
          : null;

    if (!target) return;

    lastAutoFollowSearchRef.current = q;
    setSelectedKey(target.key);
    setSidebarOpen(true);

    clearRoute();
    setHistoryOpen(false);
    clearHistoryMap();
    setFollowKey(target.key);

    if (validCoordinate(target)) {
      mapRef.current?.easeTo({
        center: [
          Number(target.longitude),
          Number(target.latitude),
        ],
        zoom: Math.max(mapRef.current?.getZoom() ?? 0, 15),
        duration: 500,
      });
    }
  }, [
    search,
    displayVehicles,
    clearRoute,
    clearHistoryMap,
    historyOpen,
  ]);


  const toggleHistory = useCallback(() => {
    if (!selectedVehicle) return;

    manualSearchOverrideRef.current = true;

    if (historyOpen) {
      setHistoryOpen(false);
      clearHistoryMap();
      return;
    }

    setFollowKey(null);
    clearRoute();
    setHistoryStart("06:00");
    setHistoryEnd("18:00");
    setHistoryOpen(true);
  }, [clearHistoryMap, clearRoute, historyOpen, selectedVehicle]);

  const handleHistoryDateChange = useCallback((value: string) => {
    setHistoryDate(value);
    setHistoryStart("06:00");
    setHistoryEnd("18:00");
    setHistoryData(null);
    setHistoryIndex(0);
  }, []);

  useEffect(() => {
    if (!isPlaying || historyTimelinePoints.length < 2) return;

    const startIndex = Math.min(
      historyIndex,
      historyTimelinePoints.length - 1,
    );
    const startRealTime = Date.now();
    const startHistoryTime = Date.parse(
      historyTimelinePoints[startIndex].time,
    );

    if (!Number.isFinite(startHistoryTime)) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setInterval(() => {
      const simulatedTime =
        startHistoryTime +
        (Date.now() - startRealTime) * playbackRate;

      let nextIndex = startIndex;

      while (
        nextIndex + 1 < historyTimelinePoints.length &&
        Date.parse(historyTimelinePoints[nextIndex + 1].time) <= simulatedTime
      ) {
        nextIndex += 1;
      }

      setHistoryIndex(nextIndex);

      if (nextIndex >= historyTimelinePoints.length - 1) {
        setIsPlaying(false);
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [
    isPlaying,
    playbackRate,
    historyIndex,
    historyTimelinePoints,
  ]);

  return (
    <div ref={pageRef} className="fleet-page">
      <style>{`
        .fleet-page { width:100%; height:100vh; min-height:620px; display:flex; flex-direction:column; overflow:hidden; background:#e5e7eb; color:#0f172a; }
        .fleet-header { flex:0 0 auto; display:flex; align-items:center; gap:14px; padding:12px 16px; background:#fff; border-bottom:1px solid #e2e8f0; z-index:20; }
        .fleet-title-wrap { min-width:190px; }
        .fleet-title { font-size:18px; line-height:1.1; font-weight:900; }
        .fleet-status { margin-top:5px; display:flex; align-items:center; gap:7px; color:#64748b; font-size:12px; }
        .fleet-live-dot { width:8px; height:8px; border-radius:999px; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.15); }
        .fleet-live-dot.is-error { background:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.15); }
        .fleet-search { position:relative; flex:1 1 360px; max-width:520px; z-index:40; }
        .fleet-search input { width:100%; height:40px; box-sizing:border-box; border:1px solid #dbe2ea; border-radius:10px; background:#f8fafc; padding:0 38px 0 13px; font:inherit; font-size:13px; outline:none; }
        .fleet-search-menu { position:absolute; top:46px; left:0; right:0; max-height:min(520px,70vh); overflow:auto; background:#fff; border:1px solid #dbe2ea; border-radius:12px; box-shadow:0 16px 40px rgba(15,23,42,.18); padding:6px; }
        .fleet-search-option { width:100%; border:0; background:transparent; border-radius:9px; padding:9px 10px; display:flex; align-items:center; gap:10px; text-align:left; cursor:pointer; color:#0f172a; }
        .fleet-search-option:hover { background:#f1f5f9; }
        .fleet-search-option-unit { min-width:64px; font-size:13px; font-weight:950; }
        .fleet-search-option-meta { min-width:0; color:#64748b; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fleet-search-empty { padding:12px; color:#64748b; font-size:12px; text-align:center; }
        .fleet-search input:focus { background:#fff; border-color:#93c5fd; box-shadow:0 0 0 3px rgba(37,99,235,.10); }
        .fleet-search-clear { position:absolute; right:7px; top:50%; transform:translateY(-50%); border:0; background:transparent; width:28px; height:28px; border-radius:7px; color:#64748b; cursor:pointer; font-size:17px; }
        .fleet-search-clear:hover { background:#e2e8f0; color:#0f172a; }
        .fleet-header-actions { margin-left:auto; display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
        .fleet-company-group { display:flex; gap:4px; padding:4px; border:1px solid #e2e8f0; background:#f8fafc; border-radius:11px; }
        .fleet-btn { height:36px; border:1px solid #dbe2ea; background:#fff; color:#334155; border-radius:9px; padding:0 11px; font:inherit; font-size:13px; font-weight:800; cursor:pointer; white-space:nowrap; }
        .fleet-btn:hover { background:#f8fafc; border-color:#cbd5e1; }
        .fleet-btn.active { color:#fff; background:#1d4ed8; border-color:#1d4ed8; }
        .fleet-btn:disabled { opacity:.5; cursor:default; }
        .fleet-body { position:relative; flex:1 1 auto; min-height:0; display:flex; overflow:hidden; }
        .fleet-sidebar { position:relative; flex:0 0 380px; width:380px; background:#fff; border-right:1px solid #e2e8f0; display:flex; flex-direction:column; min-height:0; overflow:hidden; transition:width .18s ease, flex-basis .18s ease; }
        .fleet-sidebar.closed { width:0; flex-basis:0; border-right:0; }
        .fleet-sidebar-toggle { position:absolute; z-index:25; top:50%; left:366px; transform:translateY(-50%); width:28px; height:56px; border:1px solid #cbd5e1; border-left:0; border-radius:0 12px 12px 0; background:#fff; color:#334155; box-shadow:3px 0 10px rgba(15,23,42,.12); display:grid; place-items:center; cursor:pointer; font-size:20px; font-weight:900; transition:left .18s ease, background .15s ease; }
        .fleet-sidebar-toggle:hover { background:#f8fafc; }
        .fleet-sidebar-toggle.closed { left:0; }
        .fleet-sidebar-toggle span { display:block; line-height:1; transform:translateX(-1px); }
        .fleet-sidebar-toggle.closed span { transform:translateX(1px); }
        .fleet-sidebar-head { padding:12px 14px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .fleet-sidebar-count { font-size:15px; font-weight:900; }
        .fleet-sidebar-count span { color:#64748b; font-size:12px; font-weight:700; margin-left:4px; }
        .fleet-battery { display:inline-flex; align-items:center; gap:4px; color:#166534; background:#dcfce7; border-radius:999px; padding:4px 7px; font-size:10px; font-weight:900; white-space:nowrap; }
                .fleet-list { flex:1 1 auto; overflow:auto; padding:8px; }
        .fleet-list-empty { padding:24px 12px; text-align:center; color:#64748b; font-size:13px; }
        .fleet-row { width:100%; border:1px solid transparent; background:transparent; border-radius:12px; padding:10px 11px; cursor:pointer; text-align:left; display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; align-items:start; }
        .fleet-row:hover { background:#f8fafc; }
        .fleet-row.selected { border-color:#bfdbfe; background:#eff6ff; }
        .fleet-company-dot { width:11px; height:11px; margin-top:5px; border-radius:999px; box-shadow:0 0 0 2px #fff,0 0 0 3px #cbd5e1; }
        .fleet-row-main { min-width:0; }
        .fleet-row-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .fleet-row-title { min-width:0; font-weight:900; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fleet-row-circuit { margin-top:2px; color:#334155; font-size:11px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fleet-row-sub { margin-top:3px; color:#64748b; font-size:11px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
                .fleet-detail { flex:1 1 auto; overflow:auto; padding:14px; }
        .fleet-detail-top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
        .fleet-detail-unit { font-size:22px; font-weight:950; }
        .fleet-detail-meta { margin-top:3px; color:#64748b; font-size:12px; }
        .fleet-detail-grid { margin-top:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .fleet-detail-card { border:1px solid #e2e8f0; border-radius:11px; padding:10px; background:#f8fafc; }
        .fleet-detail-card span { display:block; color:#64748b; font-size:10px; font-weight:800; text-transform:uppercase; }
        .fleet-detail-card strong { display:block; margin-top:4px; font-size:15px; }
        .fleet-section { margin-top:14px; }
        .fleet-section-title { margin-bottom:5px; color:#64748b; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.04em; }
        .fleet-section-value { font-size:13px; line-height:1.45; font-weight:700; }
        .fleet-detail-actions { margin-top:14px; display:flex; gap:7px; flex-wrap:wrap; }
        .fleet-route-box { margin-top:14px; padding:11px; border:1px solid #bfdbfe; background:#eff6ff; border-radius:11px; }
        .fleet-route-box strong { display:block; font-size:17px; }
        .fleet-route-box div { margin-top:3px; color:#475569; font-size:12px; }
        .fleet-route-help { margin-top:12px; padding:9px 10px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px; color:#64748b; font-size:11px; line-height:1.4; }
        .fleet-live-detail-hidden { display:none; }
        .fleet-history-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:12px; margin-bottom:12px; border-bottom:1px solid #e2e8f0; }
        .fleet-history-head-unit { font-size:19px; font-weight:950; }
        .fleet-history-head-meta { margin-top:3px; color:#64748b; font-size:11px; font-weight:750; }
        .fleet-history { margin-top:0; border-top:0; padding-top:0; }
        .fleet-history-controls { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .fleet-history-controls .full { grid-column:1 / -1; }
        .fleet-history-controls label { display:grid; gap:4px; color:#64748b; font-size:10px; font-weight:900; text-transform:uppercase; }
        .fleet-history-controls input { height:36px; border:1px solid #dbe2ea; border-radius:8px; padding:0 9px; font:inherit; font-size:12px; }
        .fleet-history-summary { margin-top:10px; display:grid; grid-template-columns:repeat(2,1fr); gap:7px; }
        .fleet-history-summary div { border:1px solid #e2e8f0; background:#f8fafc; border-radius:9px; padding:8px; }
        .fleet-history-summary span { display:block; color:#64748b; font-size:9px; font-weight:900; text-transform:uppercase; }
        .fleet-history-summary strong { display:block; margin-top:3px; font-size:13px; }
        .fleet-history-quick { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
        .fleet-history-modes { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
        .fleet-school-note { margin-top:7px; color:#64748b; font-size:10px; }
        .fleet-playback { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .fleet-playback select { height:32px; border:1px solid #dbe2ea; border-radius:8px; background:#fff; padding:0 7px; font:inherit; font-size:11px; font-weight:800; }
        .fleet-timeline { position:absolute; left:18px; right:18px; bottom:18px; z-index:8; padding:10px 14px; border:1px solid #bfdbfe; background:rgba(255,255,255,.96); border-radius:12px; box-shadow:0 8px 28px rgba(15,23,42,.18); backdrop-filter:blur(8px); }
        .fleet-timeline-top { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:6px; }
        .fleet-timeline-title { font-size:12px; font-weight:900; color:#0f172a; white-space:nowrap; }
        .fleet-timeline-track { position:relative; height:34px; display:flex; align-items:center; }
        .fleet-timeline input[type="range"] { position:relative; z-index:2; width:100%; height:8px; margin:0; border-radius:999px; appearance:none; -webkit-appearance:none; outline:none; cursor:pointer; }
        .fleet-timeline input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:999px; background:#fff; border:3px solid #2563eb; box-shadow:0 1px 4px rgba(15,23,42,.28); }
        .fleet-timeline input[type="range"]::-moz-range-thumb { width:12px; height:12px; border-radius:999px; background:#fff; border:3px solid #2563eb; box-shadow:0 1px 4px rgba(15,23,42,.28); }
        .fleet-timeline-cursor { position:absolute; z-index:4; top:0; bottom:0; width:2px; background:#0f172a; border-radius:999px; transform:translateX(-1px); pointer-events:none; box-shadow:0 0 0 1px rgba(255,255,255,.75); }
        .fleet-stop-boundary { position:absolute; z-index:3; top:5px; bottom:5px; width:1px; background:#d97706; pointer-events:none; opacity:.95; }
        .fleet-stop-boundary::before { content:""; position:absolute; top:-2px; left:-2px; width:5px; height:5px; border-radius:999px; background:#d97706; }
        .fleet-timeline-point { min-width:210px; text-align:right; font-size:12px; line-height:1.35; color:#334155; }
        .fleet-stop-detail { color:#b45309; font-weight:900; }
        .fleet-timeline-legend { margin-top:7px; display:flex; align-items:center; gap:12px; color:#64748b; font-size:10px; font-weight:800; }
        .fleet-timeline-legend span { display:inline-flex; align-items:center; gap:5px; }
        .fleet-timeline-swatch { width:16px; height:5px; border-radius:999px; display:inline-block; }
        .fleet-map-count.with-timeline { bottom:118px; }
        .fleet-map-shell { position:relative; flex:1 1 0; width:0; min-width:0; min-height:0; overflow:hidden; }
        .fleet-map { position:absolute; inset:0; width:100%; height:100%; }
        .fleet-map-count { position:absolute; left:12px; bottom:12px; z-index:5; padding:8px 11px; border-radius:10px; background:rgba(15,23,42,.88); color:#fff; font-size:12px; font-weight:800; box-shadow:0 5px 18px rgba(15,23,42,.18); }
                .fleet-following { background:#1d4ed8!important; color:#fff!important; border-color:#1d4ed8!important; }
        .fleet-error { color:#b91c1c; font-size:11px; margin-top:5px; }
        .fleet-page:fullscreen { background:#fff; }
        .mapboxgl-ctrl-group { border-radius:10px!important; overflow:hidden; box-shadow:0 5px 18px rgba(15,23,42,.16)!important; }
        @media (max-width:1100px) {
          .fleet-header { flex-wrap:wrap; }
          .fleet-search { order:3; flex-basis:100%; max-width:none; }
        }
        @media (max-width:800px) {
          .fleet-sidebar { flex-basis:340px; width:340px; }
          .fleet-title-wrap { min-width:150px; }
        }
        @media (max-width:650px) {
          .fleet-sidebar { flex-basis:min(380px,90vw); width:min(380px,90vw); }
          .fleet-sidebar.closed { flex-basis:0; width:0; }
          .fleet-sidebar-toggle { left:calc(min(380px,90vw) - 14px); }
          .fleet-sidebar-toggle.closed { left:0; }
          .fleet-header-actions { width:100%; margin-left:0; justify-content:flex-start; }
        }
      `}</style>

      <div className="fleet-header">
        <div className="fleet-title-wrap">
          <div className="fleet-title">Carte des unités</div>
          <div className="fleet-status">
            <span className={`fleet-live-dot ${error ? "is-error" : ""}`} />
            {error
              ? error
              : refreshing
                ? "Actualisation…"
                : `Live • ${
                    lastRefresh ? fmtTime(lastRefresh.toISOString()) : "connexion…"
                  }`}
          </div>
        </div>

        <div className="fleet-search" ref={searchBoxRef}>
          <input
            value={searchInput}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitSearchInput();
              } else if (event.key === "Escape") {
                setSearchOpen(false);
              }
            }}
            placeholder="Choisir une unité…"
            aria-label="Choisir une unité"
            autoComplete="off"
          />

          {searchInput && (
            <button
              type="button"
              className="fleet-search-clear"
              onClick={() => {
                manualSearchOverrideRef.current = false;
                lastAutoFollowSearchRef.current = "";
                setSearchInput("");
                setSearch("");
                setSearchOpen(false);
              }}
              aria-label="Effacer la recherche"
            >
              ×
            </button>
          )}

          {searchOpen && (
            <div className="fleet-search-menu">
              {searchSuggestions.length === 0 ? (
                <div className="fleet-search-empty">
                  Aucune unité trouvée.
                </div>
              ) : (
                searchSuggestions.map((vehicle) => (
                  <button
                    key={vehicle.key}
                    type="button"
                    className="fleet-search-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commitVehicleSearch(vehicle)}
                  >
                    <span
                      className="fleet-company-dot"
                      style={{
                        background: companyColor[vehicle.compagnie],
                      }}
                    />
                    <span className="fleet-search-option-unit">
                      {vehicle.unit}
                    </span>
                    <span className="fleet-search-option-meta">
                      {vehicle.compagnie}
                      {vehicle.circuits.length
                        ? ` · Circuit ${vehicle.circuits.join(", ")}`
                        : ""}
                      {vehicle.conducteurs.length
                        ? ` · ${vehicle.conducteurs.join(", ")}`
                        : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="fleet-header-actions">
          <div className="fleet-company-group">
            {(["ALL", "AB", "AC", "TS"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`fleet-btn ${filter === value ? "active" : ""}`}
                onClick={() => setFilter(value)}
              >
                {value === "ALL" ? "Toutes" : value}
              </button>
            ))}
          </div>

          <button type="button" className="fleet-btn" onClick={handleCenter}>
            Centrer
          </button>

          <button
            type="button"
            className="fleet-btn"
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? "Quitter plein écran" : "Plein écran"}
          </button>

          <button
            type="button"
            className="fleet-btn"
            disabled={refreshing}
            onClick={() => void refresh()}
            title="Actualiser maintenant"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="fleet-body">
        <aside
          className={`fleet-sidebar ${
            selectedVehicle && sidebarOpen ? "" : "closed"
          }`}
        >
          {selectedVehicle && (
            <div className="fleet-detail">
              <div className={historyOpen ? "fleet-live-detail-hidden" : ""}>
              <div className="fleet-detail-top">
                <div>
                  <div className="fleet-detail-unit">
                    Unité {selectedVehicle.unit}
                  </div>
                  <div className="fleet-detail-meta">
                    {selectedVehicle.compagnie}
                    {selectedVehicle.circuits.length
                      ? ` · Circuit ${selectedVehicle.circuits.join(", ")}`
                      : ""}
                  </div>
                </div>

                <button
                  type="button"
                  className="fleet-btn"
                  onClick={() => {
                    manualSearchOverrideRef.current = true;
                    setSelectedKey(null);
                    setFollowKey(null);
                    setSearch("");
                    setSearchInput("");
                    setSearchOpen(false);
                    setHistoryOpen(false);
                    clearHistoryMap();
                    clearRoute();

                    setSidebarOpen(false);

                    const map = mapRef.current;
                    if (map) {
                      map.resize();

                      window.requestAnimationFrame(() => {
                        fitVehicles(allDisplayVehicles, true);
                      });

                      window.setTimeout(() => {
                        map.resize();
                        fitVehicles(allDisplayVehicles, true);
                      }, 220);
                    }
                  }}
                >
                  Retour
                </button>
              </div>

              <div className="fleet-detail-grid">
                <div className="fleet-detail-card">
                  <span>Vitesse</span>
                  <strong>
                    {selectedVehicle.speedKph == null
                      ? "—"
                      : `${Math.round(selectedVehicle.speedKph)} km/h`}
                  </strong>
                </div>

                <div className="fleet-detail-card">
                  <span>Dernier GPS</span>
                  <strong>{fmtAge(selectedVehicle.ageSeconds)}</strong>
                </div>

                {selectedVehicle.batterySocPercent != null && (
                  <div className="fleet-detail-card">
                    <span>État de charge (SOC)</span>
                    <strong>
                      {Math.round(selectedVehicle.batterySocPercent)} %
                    </strong>
                  </div>
                )}

                {selectedVehicle.fuelPercent != null && (
                  <div className="fleet-detail-card">
                    <span>Carburant</span>
                    <strong>{Math.round(selectedVehicle.fuelPercent)} %</strong>
                  </div>
                )}
              </div>

              <div className="fleet-section">
                <div className="fleet-section-title">Adresse</div>
                <div className="fleet-section-value">
                  {selectedVehicle.address || "Adresse non disponible"}
                </div>
              </div>

              <div className="fleet-section">
                <div className="fleet-section-title">Conducteur</div>
                <div className="fleet-section-value">
                  {selectedVehicle.contactsConducteur.length > 0 ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {selectedVehicle.contactsConducteur.map((contact, index) => (
                        <div
                          key={`${contact.nom}-${contact.telephone}-${index}`}
                          style={{
                            display: "grid",
                            gap: 3,
                          }}
                        >
                          <span>{contact.nom || "Conducteur"}</span>
                          {contact.telephone ? (
                            <a
                              href={telHref(contact.telephone)}
                              style={{
                                color: "#1d4ed8",
                                fontWeight: 900,
                                textDecoration: "none",
                                width: "fit-content",
                              }}
                              title={`Appeler ${contact.nom || "le conducteur"}`}
                            >
                              ☎ {contact.telephone}
                            </a>
                          ) : (
                            <span style={{ color: "#64748b", fontWeight: 700 }}>
                              Téléphone non disponible
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : selectedVehicle.conducteurs.length ? (
                    selectedVehicle.conducteurs.join(", ")
                  ) : (
                    "Non assigné"
                  )}
                </div>
              </div>

              <div className="fleet-section">
                <div className="fleet-section-title">Position GPS</div>
                <div className="fleet-section-value">
                  {fmtTime(selectedVehicle.updatedAt)}
                  <br />
                  {Number(selectedVehicle.latitude).toFixed(5)},{" "}
                  {Number(selectedVehicle.longitude).toFixed(5)}
                </div>
              </div>

              <div className="fleet-detail-actions">
                <button
                  type="button"
                  className={`fleet-btn ${
                    followKey === selectedVehicle.key ? "fleet-following" : ""
                  }`}
                  onClick={toggleFollow}
                >
                  {followKey === selectedVehicle.key
                    ? "Arrêter le suivi"
                    : "Suivre l’unité"}
                </button>

                <button
                  type="button"
                  className={`fleet-btn ${historyOpen ? "active" : ""}`}
                  onClick={toggleHistory}
                >
                  {historyOpen ? "Fermer historique" : "Historique trajet"}
                </button>
              </div>

              </div>

              {historyOpen && (
                <div className="fleet-history-head">
                  <div>
                    <div className="fleet-history-head-unit">
                      Unité {selectedVehicle.unit}
                    </div>
                    <div className="fleet-history-head-meta">
                      {selectedVehicle.compagnie}
                      {selectedVehicle.circuits.length
                        ? ` · Circuit ${selectedVehicle.circuits.join(", ")}`
                        : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="fleet-btn"
                    onClick={toggleHistory}
                  >
                    Fermer historique
                  </button>
                </div>
              )}

              {historyOpen && (
                <div className="fleet-history">
                  <div className="fleet-section-title">
                    Historique du trajet
                  </div>

                  <div className="fleet-history-controls">
                    <label className="full">
                      Journée
                      <input
                        type="date"
                        value={historyDate}
                        onChange={(event) =>
                          handleHistoryDateChange(event.target.value)
                        }
                      />
                    </label>

                    <label>
                      Heure début
                      <input
                        type="time"
                        value={historyStart}
                        onChange={(event) =>
                          setHistoryStart(event.target.value)
                        }
                      />
                    </label>

                    <label>
                      Heure fin
                      <input
                        type="time"
                        value={historyEnd}
                        onChange={(event) =>
                          setHistoryEnd(event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="fleet-history-modes">
                    <button
                      type="button"
                      className={`fleet-btn ${
                        timelineMode === "TRIP" ? "active" : ""
                      }`}
                      onClick={() => setTimelineMode("TRIP")}
                    >
                      Trajet
                    </button>

                    <button
                      type="button"
                      className={`fleet-btn ${
                        timelineMode === "SPEED" ? "active" : ""
                      }`}
                      onClick={() => setTimelineMode("SPEED")}
                    >
                      Vitesse
                    </button>
                  </div>

                  <div className="fleet-history-quick">
                    <button
                      type="button"
                      className={`fleet-btn ${
                        historyStart === "06:00" && historyEnd === "10:00"
                          ? "active"
                          : ""
                      }`}
                      onClick={() => {
                        setHistoryStart("06:00");
                        setHistoryEnd("10:00");
                      }}
                    >
                      AM 06:00–10:00
                    </button>

                    <button
                      type="button"
                      className={`fleet-btn ${
                        historyStart === "14:30" && historyEnd === "18:00"
                          ? "active"
                          : ""
                      }`}
                      onClick={() => {
                        setHistoryStart("14:30");
                        setHistoryEnd("18:00");
                      }}
                    >
                      PM 14:30–18:00
                    </button>
                  </div>

                  {historyLoading && (
                    <div
                      style={{
                        marginTop: 9,
                        color: "#64748b",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      Chargement du trajet…
                    </div>
                  )}

                  {historyError && (
                    <div className="fleet-error">{historyError}</div>
                  )}

                  {timelineMode === "SPEED" && speedingLoading && (
                    <div className="fleet-school-note">
                      Chargement des excès de vitesse…
                    </div>
                  )}

                  {timelineMode === "SPEED" && speedingError && (
                    <div className="fleet-error">{speedingError}</div>
                  )}

                  {historyData && (
                    <>
                      <div className="fleet-history-summary">
                        <div>
                          <span>Distance</span>
                          <strong>
                            {historyData.summary.distanceKm.toFixed(1)} km
                          </strong>
                        </div>

                        <div>
                          <span>Vitesse max</span>
                          <strong>
                            {historyData.summary.maxSpeedKph == null
                              ? "—"
                              : `${Math.round(
                                  historyData.summary.maxSpeedKph,
                                )} km/h`}
                          </strong>
                        </div>

                        <div>
                          <span>Temps en mouvement</span>
                          <strong>
                            {historyData.summary.movingMinutes} min
                          </strong>
                        </div>

                      </div>

                    </>
                  )}
                </div>
              )}

              {followKey === selectedVehicle.key && (
                <>
                  <div className="fleet-route-help">
                    Clic droit sur la carte pour choisir une destination et
                    calculer automatiquement l’heure d’arrivée de cette unité.
                  </div>

                  {destination && (
                    <div className="fleet-route-box">
                      {etaLoading ? (
                        <div>Calcul de l’itinéraire…</div>
                      ) : eta ? (
                        <>
                          <strong>
                            {fmtDuration(eta.durationSeconds)} ·{" "}
                            {fmtDistance(eta.distanceMeters)}
                          </strong>
                          <div>Arrivée estimée : {fmtTime(eta.arrivalAt)}</div>
                        </>
                      ) : (
                        <div>Destination sélectionnée.</div>
                      )}

                      {etaError && <div className="fleet-error">{etaError}</div>}

                      <button
                        type="button"
                        className="fleet-btn"
                        style={{ marginTop: 9 }}
                        onClick={clearRoute}
                      >
                        Effacer la destination
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </aside>

        {selectedVehicle && (
          <button
            type="button"
            className={`fleet-sidebar-toggle ${sidebarOpen ? "" : "closed"}`}
            onClick={toggleSidebar}
            title={sidebarOpen ? "Masquer le panneau" : "Afficher le panneau"}
            aria-label={
              sidebarOpen ? "Masquer le panneau" : "Afficher le panneau"
            }
          >
            <span>{sidebarOpen ? "‹" : "›"}</span>
          </button>
        )}

        <div className="fleet-map-shell">
          <div ref={mapNode} className="fleet-map" />

          {historyTimelinePoints.length > 0 && (
            <div className="fleet-timeline">
              <div className="fleet-timeline-top">
                <div>
                  <div className="fleet-timeline-title">
                    Historique · unité {selectedVehicle?.unit ?? ""} ·{" "}
                    {fmtTime(historyTimelinePoints[0].time)}–{fmtTime(
                      historyTimelinePoints[historyTimelinePoints.length - 1].time,
                    )}
                  </div>

                  <div className="fleet-playback" style={{ marginTop: 5 }}>
                    <button
                      type="button"
                      className="fleet-btn"
                      style={{ height: 30 }}
                      onClick={() => {
                        if (
                          historyIndex >=
                          historyTimelinePoints.length - 1
                        ) {
                          setHistoryIndex(0);
                        }
                        setIsPlaying((value) => !value);
                      }}
                    >
                      {isPlaying ? "⏸ Pause" : "▶ Lecture"}
                    </button>

                    <select
                      value={playbackRate}
                      onChange={(event) =>
                        setPlaybackRate(Number(event.target.value))
                      }
                      aria-label="Vitesse de lecture"
                    >
                      <option value={10}>×10</option>
                      <option value={30}>×30</option>
                      <option value={60}>×60</option>
                    </select>
                  </div>
                </div>

                {(() => {
                  const point =
                    historyTimelinePoints[
                      Math.min(
                        historyIndex,
                        historyTimelinePoints.length - 1,
                      )
                    ];

                  return (
                    <div className="fleet-timeline-point">
                      <strong>{fmtTime(point.time)}</strong>
                      {" · "}
                      {point.speedKph == null
                        ? "Vitesse —"
                        : `${Math.round(point.speedKph)} km/h`}
                      {timelineMode === "TRIP" &&
                      activeHistoryStopTimes ? (
                        <>
                          {" · "}
                          <span className="fleet-stop-detail">
                            Arrêt {fmtTime(activeHistoryStopTimes.startTime)} →{" "}
                            {fmtTime(activeHistoryStopTimes.endTime)} (
                            {activeHistoryStopTimes.durationMinutes} min)
                          </span>
                        </>
                      ) : null}
                      {timelineMode === "SPEED" &&
                      activeSpeedingInterval ? (
                        <>
                          {" · "}
                          <span
                            className="fleet-stop-detail"
                            style={{
                              color: speedingColor(
                                activeSpeedingInterval.maxSpeedOverKph,
                              ),
                            }}
                          >
                            Limite{" "}
                            {activeSpeedingInterval.postedSpeedLimitKph == null
                              ? "—"
                              : `${Math.round(
                                  activeSpeedingInterval.postedSpeedLimitKph,
                                )} km/h`}
                            {" · Max "}
                            {activeSpeedingInterval.maxSpeedKph == null
                              ? "—"
                              : `${Math.round(
                                  activeSpeedingInterval.maxSpeedKph,
                                )} km/h`}
                            {" · +"}
                            {activeSpeedingInterval.maxSpeedOverKph == null
                              ? "—"
                              : `${activeSpeedingInterval.maxSpeedOverKph.toFixed(
                                  1,
                                )} km/h`}
                          </span>
                        </>
                      ) : null}
                      {point.address ? ` · ${point.address}` : ""}
                    </div>
                  );
                })()}
              </div>

              <div className="fleet-timeline-track">
                {timelineMode === "TRIP" &&
                  historyStops.flatMap((stop, stopIndex) => {
                  const maxIndex = Math.max(
                    1,
                    historyTimelinePoints.length - 1,
                  );
                  const startPercent =
                    (stop.startIndex / maxIndex) * 100;
                  const endPercent =
                    (stop.endIndex / maxIndex) * 100;
                  const startPoint =
                    historyTimelinePoints[stop.startIndex];
                  const endPoint =
                    historyTimelinePoints[stop.endIndex];

                  return [
                    <span
                      key={`stop-start-${stopIndex}`}
                      className="fleet-stop-boundary"
                      style={{ left: `${startPercent}%` }}
                      title={`Début arrêt ${fmtTime(startPoint?.time ?? null)}`}
                    />,
                    <span
                      key={`stop-end-${stopIndex}`}
                      className="fleet-stop-boundary"
                      style={{ left: `${endPercent}%` }}
                      title={`Fin arrêt ${fmtTime(endPoint?.time ?? null)}`}
                    />,
                  ];
                })}

                <span
                  className="fleet-timeline-cursor"
                  style={{ left: `${historyCursorPercent}%` }}
                />

                <input
                  type="range"
                  min={0}
                  max={Math.max(0, historyTimelinePoints.length - 1)}
                  step={1}
                  value={Math.min(
                    historyIndex,
                    historyTimelinePoints.length - 1,
                  )}
                  onChange={(event) =>
                    setHistoryIndex(Number(event.target.value))
                  }
                  aria-label="Position précise dans l'historique du trajet"
                  style={{ background: timelineGradient }}
                />
              </div>

              <div className="fleet-timeline-legend">
                {timelineMode === "TRIP" ? (
                  <>
                    <span>
                      <i
                        className="fleet-timeline-swatch"
                        style={{ background: "#2563eb" }}
                      />
                      Déplacement
                    </span>
                    <span>
                      <i
                        className="fleet-timeline-swatch"
                        style={{ background: "#f59e0b" }}
                      />
                      Arrêt de plus de 5 min
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <i
                        className="fleet-timeline-swatch"
                        style={{ background: "#f59e0b" }}
                      />
                      Excès jusqu’à +12 km/h
                    </span>
                    <span>
                      <i
                        className="fleet-timeline-swatch"
                        style={{ background: "#c2410c" }}
                      />
                      Excès +12 km/h
                    </span>
                    <span>
                      <i
                        className="fleet-timeline-swatch"
                        style={{ background: "#dc2626" }}
                      />
                      Excès +16 km/h
                    </span>
                  </>
                )}
                <span>
                  <i
                    className="fleet-timeline-swatch"
                    style={{
                      background: "#0f172a",
                      width: 2,
                      height: 12,
                    }}
                  />
                  Position exacte
                </span>
              </div>
            </div>
          )}

          <div
            className={`fleet-map-count ${
              historyTimelinePoints.length ? "with-timeline" : ""
            }`}
          >
            {loading
              ? "Chargement…"
              : followKey
                ? `Suivi de l’unité ${selectedVehicle?.unit ?? ""}`
                : `${displayVehicles.length} unité${
                    displayVehicles.length > 1 ? "s" : ""
                  } affichée${displayVehicles.length > 1 ? "s" : ""}`}
          </div>
        </div>
      </div>
    </div>
  );
}
