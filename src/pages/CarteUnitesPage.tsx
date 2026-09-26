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

const REFRESH_MS = 5000;
const STALE_AFTER_SECONDS = 180;

const SOURCE_ID = "fleet-source";
const CLUSTER_LAYER_ID = "fleet-clusters";
const CLUSTER_COUNT_LAYER_ID = "fleet-cluster-count";
const CIRCLE_LAYER_ID = "fleet-circles";
const LABEL_LAYER_ID = "fleet-labels";
const HEADING_LAYER_ID = "fleet-headings";

const ROUTE_SOURCE_ID = "fleet-route-source";
const ROUTE_LAYER_ID = "fleet-route-layer";
const DEST_SOURCE_ID = "fleet-destination-source";
const DEST_LAYER_ID = "fleet-destination-layer";

const VIEW_STORAGE_KEY = "gb-circuits-fleet-view-v2";

const companyColor: Record<Compagnie, string> = {
  AB: "#2563eb",
  AC: "#f59e0b",
  TS: "#16a34a",
};

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

  const [vehicles, setVehicles] = useState<Record<string, LiveVehicle>>({});
  const [circuits, setCircuits] = useState<CircuitRow[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
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
    if (!followKey) return displayVehicles;
    const followed = allDisplayVehicles.find((vehicle) => vehicle.key === followKey);
    return followed ? [followed] : [];
  }, [displayVehicles, allDisplayVehicles, followKey]);

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

  const syncMapData = useCallback((items: DisplayVehicle[]) => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(toGeoJson(items) as any);
  }, []);

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

    const follow = followKeyRef.current;
    if (follow) {
      const vehicle = allDisplayVehicles.find((item) => item.key === follow);
      if (vehicle && validCoordinate(vehicle)) {
        mapRef.current?.easeTo({
          center: [Number(vehicle.longitude), Number(vehicle.latitude)],
          duration: 650,
        });
      }
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
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            11,
            12,
            15,
            16,
            18,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "status"], "STALE"],
            "#64748b",
            "#ffffff",
          ],
          "circle-stroke-width": 3,
          "circle-opacity": ["get", "opacity"],
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
        filter: ["!", ["has", "point_count"]],
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
          "line-width": 5,
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

      syncMapData(latestDisplayRef.current);

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
      window.setTimeout(() => mapRef.current?.resize(), 50);
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

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);

    // Mapbox doit recalculer sa largeur pendant/après l'animation du panneau.
    window.requestAnimationFrame(() => mapRef.current?.resize());
    window.setTimeout(() => mapRef.current?.resize(), 80);
    window.setTimeout(() => mapRef.current?.resize(), 220);
  }, []);

  const handleCenter = useCallback(() => {
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
    if (!q) return;

    const exactMatches = displayVehicles.filter((vehicle) => {
      return (
        normalizeText(vehicle.unit) === q ||
        vehicle.circuits.some((circuit) => normalizeText(circuit) === q)
      );
    });

    const target =
      exactMatches.length === 1
        ? exactMatches[0]
        : displayVehicles.length === 1
          ? displayVehicles[0]
          : null;

    if (!target) return;

    setSelectedKey(target.key);
    setSidebarOpen(true);

    if (followKey !== target.key) {
      clearRoute();
      setFollowKey(target.key);
    }

    if (validCoordinate(target)) {
      mapRef.current?.easeTo({
        center: [Number(target.longitude), Number(target.latitude)],
        zoom: Math.max(mapRef.current?.getZoom() ?? 0, 15),
        duration: 500,
      });
    }
  }, [search, displayVehicles, followKey, clearRoute]);




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
        .fleet-search { position:relative; flex:1 1 360px; max-width:520px; }
        .fleet-search input { width:100%; height:40px; box-sizing:border-box; border:1px solid #dbe2ea; border-radius:10px; background:#f8fafc; padding:0 38px 0 13px; font:inherit; font-size:13px; outline:none; }
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

        <div className="fleet-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher unité, circuit ou conducteur…"
            aria-label="Rechercher unité, circuit ou conducteur"
          />
          {search && (
            <button
              type="button"
              className="fleet-search-clear"
              onClick={() => setSearch("")}
              aria-label="Effacer la recherche"
            >
              ×
            </button>
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
        <aside className={`fleet-sidebar ${sidebarOpen ? "" : "closed"}`}>
          {!selectedVehicle ? (
            <>
              <div className="fleet-sidebar-head">
                <div className="fleet-sidebar-count">
                  {displayVehicles.length}
                  <span>
                    unité{displayVehicles.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              <div className="fleet-list">
                {displayVehicles.length === 0 ? (
                  <div className="fleet-list-empty">
                    Aucune unité ne correspond aux filtres.
                  </div>
                ) : (
                  displayVehicles.map((vehicle) => (
                    <button
                      type="button"
                      key={vehicle.key}
                      className={`fleet-row ${
                        selectedKey === vehicle.key ? "selected" : ""
                      }`}
                      onClick={() => selectVehicle(vehicle.key, true)}
                    >
                      <span
                        className="fleet-company-dot"
                        style={{ background: companyColor[vehicle.compagnie] }}
                      />
                      <span className="fleet-row-main">
                        <span className="fleet-row-top">
                          <span className="fleet-row-title">
                            Unité {vehicle.unit}
                          </span>
                          {vehicle.batterySocPercent != null && (
                            <span className="fleet-battery">
                              🔋 {Math.round(vehicle.batterySocPercent)} %
                            </span>
                          )}
                        </span>

                        {vehicle.circuits.length > 0 && (
                          <span className="fleet-row-circuit">
                            Circuit {vehicle.circuits.join(", ")}
                          </span>
                        )}

                        <span className="fleet-row-sub">
                          {vehicle.address || "Adresse non disponible"}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="fleet-detail">
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
                    setSelectedKey(null);
                    setFollowKey(null);
                    clearRoute();
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
                    <span>État de charge</span>
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
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
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
                                whiteSpace: "nowrap",
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
              </div>

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

        <button
          type="button"
          className={`fleet-sidebar-toggle ${sidebarOpen ? "" : "closed"}`}
          onClick={toggleSidebar}
          title={sidebarOpen ? "Masquer la liste" : "Afficher la liste"}
          aria-label={sidebarOpen ? "Masquer la liste" : "Afficher la liste"}
        >
          <span>{sidebarOpen ? "‹" : "›"}</span>
        </button>

        <div className="fleet-map-shell">
          <div ref={mapNode} className="fleet-map" />

          <div className="fleet-map-count">
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
