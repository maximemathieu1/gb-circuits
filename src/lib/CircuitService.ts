// src/lib/CircuitService.ts
import { circuitSupabase } from "./circuitSupabase";

/**
 * Accès direct au projet Supabase « Circuit Scolaire ».
 *
 * Tables utilisées :
 * - circuits
 * - circuit_versions
 * - circuit_points
 * - circuit_traces
 *
 * La table circuit_traces contient :
 * id, version_id, trail, points_count, created_at.
 * Le kilométrage est donc calculé à partir du JSON `trail`.
 */

export type CarrierCode = "B" | "C" | "S";

export type TrailPoint = {
  idx?: number;
  lat: number;
  lng: number;
};

export type CircuitRow = {
  id: string;
  nom?: string | null;
  transporteur_code?: CarrierCode | string | null;
  heure_depart?: string | null;
  heure_retour?: string | null;
  unite?: string | null;
  conducteur?: string | null;
  active_version_id?: string | null;
  general_note_start?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type CircuitVersionRow = {
  id: string;
  circuit_id?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
  statut?: string | null;
  general_note_start?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type CircuitPointRow = {
  id: string;
  version_id: string;
  idx: number;
  lat: number;
  lng: number;
  label?: string | null;
  stop_type?: string | null;
  note?: string | null;
  note_mode?: string | null;
  note_trigger_m?: number | null;
  note_once?: boolean | null;
  note_images?: string[] | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type CircuitTraceRow = {
  id: string;
  version_id: string;
  trail: TrailPoint[];
  points_count?: number | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type DispatchCircuitRow = {
  circuit_id: string;
  nom: string;
  transporteur_code: string;
  heure_depart: string | null;
  heure_retour: string | null;
  unite: string | null;
  conducteur: string | null;
  nb_arrets: number;
  nb_transferts: number;
  km_total: number | null;
  active_version_id: string | null;
};

export type CircuitDetailResult = {
  circuit: CircuitRow;
  active_version: CircuitVersionRow | null;
  points: CircuitPointRow[];
  trace: CircuitTraceRow | null;
};

type DbError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

function fail(error: DbError | null, context: string): never | void {
  if (!error) return;

  const extra = [error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" · ");

  throw new Error(
    `${context}: ${error.message || "Erreur Supabase"}${extra ? ` (${extra})` : ""}`
  );
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTrail(value: unknown): TrailPoint[] {
  let input = value;

  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(input)) return [];

  return input
    .map((point: any, index): TrailPoint | null => {
      if (Array.isArray(point)) {
        const lat = asFiniteNumber(point[0]);
        const lng = asFiniteNumber(point[1]);
        if (lat == null || lng == null) return null;
        return { idx: index + 1, lat, lng };
      }

      const lat = asFiniteNumber(point?.lat);
      const lng = asFiniteNumber(point?.lng);
      if (lat == null || lng == null) return null;

      return {
        idx: asFiniteNumber(point?.idx) ?? index + 1,
        lat,
        lng,
      };
    })
    .filter((point): point is TrailPoint => point !== null);
}

function haversineMeters(a: TrailPoint, b: TrailPoint): number {
  const radius = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function calculateTrailDistanceMeters(trailValue: unknown): number {
  const trail = normalizeTrail(trailValue);
  let meters = 0;

  for (let index = 1; index < trail.length; index += 1) {
    meters += haversineMeters(trail[index - 1], trail[index]);
  }

  return meters;
}

export function calculateTrailKm(trailValue: unknown): number {
  return calculateTrailDistanceMeters(trailValue) / 1000;
}

function isVersionMarkedActive(version: CircuitVersionRow): boolean {
  if (version.active === true || version.is_active === true) return true;

  const status = String(version.statut ?? "").trim().toLowerCase();
  return status === "active" || status === "actif" || status === "published";
}

function pickActiveVersion(
  circuit: CircuitRow,
  versions: CircuitVersionRow[]
): CircuitVersionRow | null {
  if (!versions.length) return null;

  const explicitId = String(circuit.active_version_id ?? "").trim();
  if (explicitId) {
    const explicit = versions.find((version) => version.id === explicitId);
    if (explicit) return explicit;
  }

  const marked = versions.find(isVersionMarkedActive);
  if (marked) return marked;

  return [...versions].sort((a, b) => {
    const aDate = Date.parse(String(a.created_at ?? "")) || 0;
    const bDate = Date.parse(String(b.created_at ?? "")) || 0;
    return bDate - aDate;
  })[0];
}

async function getVersionsForCircuit(
  circuit: CircuitRow
): Promise<CircuitVersionRow[]> {
  const circuitId = String(circuit.id);

  const { data, error } = await circuitSupabase
    .from("circuit_versions")
    .select("*")
    .eq("circuit_id", circuitId)
    .order("created_at", { ascending: false });

  fail(error, "Chargement des versions");
  return (data ?? []) as CircuitVersionRow[];
}

async function getLatestTrace(
  versionId: string
): Promise<CircuitTraceRow | null> {
  const { data, error } = await circuitSupabase
    .from("circuit_traces")
    .select("*")
    .eq("version_id", versionId)
    .order("created_at", { ascending: false })
    .limit(1);

  fail(error, "Chargement de la trace");

  const row = (data?.[0] ?? null) as CircuitTraceRow | null;
  if (!row) return null;

  return {
    ...row,
    trail: normalizeTrail(row.trail),
  };
}

export async function listCircuits(): Promise<DispatchCircuitRow[]> {
  const { data: circuitData, error: circuitError } = await circuitSupabase
    .from("circuits")
    .select("*")
    .order("nom", { ascending: true });

  fail(circuitError, "Chargement des circuits");

  const circuits = (circuitData ?? []) as CircuitRow[];
  if (!circuits.length) return [];

  const circuitIds = circuits.map((circuit) => circuit.id);

  const { data: versionData, error: versionError } = await circuitSupabase
    .from("circuit_versions")
    .select("*")
    .in("circuit_id", circuitIds);

  fail(versionError, "Chargement des versions");

  const versions = (versionData ?? []) as CircuitVersionRow[];
  const versionByCircuit = new Map<string, CircuitVersionRow>();

  for (const circuit of circuits) {
    const candidates = versions.filter(
      (version) => String(version.circuit_id ?? "") === circuit.id
    );
    const active = pickActiveVersion(circuit, candidates);
    if (active) versionByCircuit.set(circuit.id, active);
  }

  const versionIds = [...versionByCircuit.values()].map((version) => version.id);

  let points: CircuitPointRow[] = [];
  let traces: CircuitTraceRow[] = [];

  if (versionIds.length) {
    const [pointResponse, traceResponse] = await Promise.all([
      circuitSupabase
        .from("circuit_points")
        .select("*")
        .in("version_id", versionIds),
      circuitSupabase
        .from("circuit_traces")
        .select("*")
        .in("version_id", versionIds)
        .order("created_at", { ascending: false }),
    ]);

    fail(pointResponse.error, "Chargement des arrêts");
    fail(traceResponse.error, "Chargement des traces");

    points = (pointResponse.data ?? []) as CircuitPointRow[];
    traces = (traceResponse.data ?? []) as CircuitTraceRow[];
  }

  return circuits.map((circuit) => {
    const activeVersion = versionByCircuit.get(circuit.id) ?? null;
    const versionId = activeVersion?.id ?? null;

    const circuitPoints = versionId
      ? points.filter((point) => point.version_id === versionId)
      : [];

    const trace = versionId
      ? traces.find((row) => row.version_id === versionId) ?? null
      : null;

    const km = trace ? calculateTrailKm(trace.trail) : null;

    return {
      circuit_id: circuit.id,
      nom: String(circuit.nom ?? ""),
      transporteur_code: String(circuit.transporteur_code ?? ""),
      heure_depart: circuit.heure_depart
        ? String(circuit.heure_depart)
        : null,
      heure_retour: circuit.heure_retour
        ? String(circuit.heure_retour)
        : null,
      unite: circuit.unite ? String(circuit.unite) : null,
      conducteur: circuit.conducteur
        ? String(circuit.conducteur)
        : null,
      nb_arrets: circuitPoints.filter(
        (point) => String(point.stop_type ?? "school") !== "transfer"
      ).length,
      nb_transferts: circuitPoints.filter(
        (point) => String(point.stop_type ?? "") === "transfer"
      ).length,
      km_total: km,
      active_version_id: versionId,
    };
  });
}

export async function getCircuit(
  circuitId: string
): Promise<CircuitDetailResult> {
  const id = String(circuitId ?? "").trim();
  if (!id) throw new Error("ID de circuit manquant.");

  const { data: circuitData, error: circuitError } = await circuitSupabase
    .from("circuits")
    .select("*")
    .eq("id", id)
    .single();

  fail(circuitError, "Chargement du circuit");

  const circuit = circuitData as CircuitRow;
  const versions = await getVersionsForCircuit(circuit);
  const activeVersion = pickActiveVersion(circuit, versions);

  if (!activeVersion) {
    return {
      circuit,
      active_version: null,
      points: [],
      trace: null,
    };
  }

  const [pointsResponse, trace] = await Promise.all([
    circuitSupabase
      .from("circuit_points")
      .select("*")
      .eq("version_id", activeVersion.id)
      .order("idx", { ascending: true }),
    getLatestTrace(activeVersion.id),
  ]);

  fail(pointsResponse.error, "Chargement des arrêts");

  return {
    circuit,
    active_version: activeVersion,
    points: (pointsResponse.data ?? []) as CircuitPointRow[],
    trace,
  };
}

export async function updateCircuit(
  circuitId: string,
  values: Record<string, unknown>
): Promise<CircuitRow> {
  const id = String(circuitId ?? "").trim();
  if (!id) throw new Error("ID de circuit manquant.");

  // general_note_start appartient normalement à circuit_versions.
  const { general_note_start, ...circuitValues } = values;

  let updatedCircuit: CircuitRow;

  if (Object.keys(circuitValues).length) {
    const { data, error } = await circuitSupabase
      .from("circuits")
      .update(circuitValues)
      .eq("id", id)
      .select("*")
      .single();

    fail(error, "Mise à jour du circuit");
    updatedCircuit = data as CircuitRow;
  } else {
    const { data, error } = await circuitSupabase
      .from("circuits")
      .select("*")
      .eq("id", id)
      .single();

    fail(error, "Chargement du circuit");
    updatedCircuit = data as CircuitRow;
  }

  if (general_note_start !== undefined) {
    const versions = await getVersionsForCircuit(updatedCircuit);
    const activeVersion = pickActiveVersion(updatedCircuit, versions);

    if (!activeVersion) {
      throw new Error(
        "Impossible d’enregistrer la note générale : aucune version active."
      );
    }

    const { error } = await circuitSupabase
      .from("circuit_versions")
      .update({ general_note_start })
      .eq("id", activeVersion.id);

    fail(error, "Mise à jour de la note générale");
  }

  return updatedCircuit;
}

export async function deleteCircuit(circuitId: string): Promise<void> {
  const id = String(circuitId ?? "").trim();
  if (!id) throw new Error("ID de circuit manquant.");

  const { error } = await circuitSupabase
    .from("circuits")
    .delete()
    .eq("id", id);

  fail(
    error,
    "Suppression du circuit. Vérifie que les clés étrangères utilisent ON DELETE CASCADE"
  );
}


const CIRCUIT_POINT_WRITABLE_FIELDS = new Set([
  "idx",
  "lat",
  "lng",
  "label",
  "stop_type",
  "note",
  "note_mode",
  "note_trigger_m",
  "note_once",
  "note_images",
]);

function sanitizePointValues(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) =>
      CIRCUIT_POINT_WRITABLE_FIELDS.has(key)
    )
  );
}

export async function updatePoint(
  pointId: string,
  values: Record<string, unknown>
): Promise<CircuitPointRow> {
  const id = String(pointId ?? "").trim();
  if (!id) throw new Error("ID d’arrêt manquant.");

  const payload = sanitizePointValues(values);
  if (!Object.keys(payload).length) {
    throw new Error("Aucun champ valide à enregistrer pour cet arrêt.");
  }

  const { data, error } = await circuitSupabase
    .from("circuit_points")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  fail(error, "Mise à jour de l’arrêt");
  return data as CircuitPointRow;
}

async function shiftIndexesForInsert(
  versionId: string,
  insertIndex: number
): Promise<void> {
  const { data, error } = await circuitSupabase
    .from("circuit_points")
    .select("id,idx")
    .eq("version_id", versionId)
    .gte("idx", insertIndex)
    .order("idx", { ascending: false });

  fail(error, "Préparation de l’insertion");

  // Décalage temporaire pour éviter un conflit si (version_id, idx) est unique.
  for (const point of data ?? []) {
    const { error: moveError } = await circuitSupabase
      .from("circuit_points")
      .update({ idx: Number(point.idx) + 100_000 })
      .eq("id", point.id);

    fail(moveError, "Décalage temporaire des arrêts");
  }

  for (const point of data ?? []) {
    const { error: moveError } = await circuitSupabase
      .from("circuit_points")
      .update({ idx: Number(point.idx) + 1 })
      .eq("id", point.id);

    fail(moveError, "Réindexation des arrêts");
  }
}

export async function insertPoint(values: {
  version_id: string;
  idx?: number;
  lat: number;
  lng: number;
  label?: string | null;
  stop_type?: string | null;
  [key: string]: unknown;
}): Promise<CircuitPointRow> {
  const versionId = String(values.version_id ?? "").trim();
  const lat = asFiniteNumber(values.lat);
  const lng = asFiniteNumber(values.lng);

  if (!versionId) throw new Error("version_id manquant.");
  if (lat == null || lat < -90 || lat > 90) {
    throw new Error("Latitude invalide.");
  }
  if (lng == null || lng < -180 || lng > 180) {
    throw new Error("Longitude invalide.");
  }

  let index = asFiniteNumber(values.idx);

  if (index == null) {
    const { data, error } = await circuitSupabase
      .from("circuit_points")
      .select("idx")
      .eq("version_id", versionId)
      .order("idx", { ascending: false })
      .limit(1);

    fail(error, "Recherche du dernier arrêt");
    index = Number(data?.[0]?.idx ?? -1) + 1;
  } else {
    index = Math.max(0, Math.trunc(index));
    await shiftIndexesForInsert(versionId, index);
  }

  const optionalValues = sanitizePointValues(values);

  const payload = {
    ...optionalValues,
    version_id: versionId,
    idx: index,
    lat,
    lng,
    stop_type: values.stop_type ?? "school",
  };

  const { data, error } = await circuitSupabase
    .from("circuit_points")
    .insert(payload)
    .select("*")
    .single();

  fail(error, "Ajout de l’arrêt");
  return data as CircuitPointRow;
}

export async function insertStopAt(
  versionId: string,
  insertIndex: number,
  values: {
    lat: number;
    lng: number;
    label?: string | null;
    stop_type?: string | null;
    [key: string]: unknown;
  }
): Promise<CircuitPointRow> {
  return insertPoint({
    version_id: versionId,
    idx: insertIndex,
    ...values,
  });
}

export async function deletePoint(pointId: string): Promise<void> {
  const id = String(pointId ?? "").trim();
  if (!id) throw new Error("ID d’arrêt manquant.");

  // Supprime uniquement le point demandé.
  // Les idx techniques des autres points restent inchangés afin de ne pas
  // modifier plusieurs enregistrements lors d’une suppression.
  const { error } = await circuitSupabase
    .from("circuit_points")
    .delete()
    .eq("id", id);

  fail(error, "Suppression de l’arrêt");
}

export async function deletePointByIdx(
  versionId: string,
  index: number
): Promise<void> {
  const { data, error } = await circuitSupabase
    .from("circuit_points")
    .select("id")
    .eq("version_id", versionId)
    .eq("idx", index)
    .single();

  fail(error, "Recherche de l’arrêt à supprimer");
  if (!data?.id) {
    throw new Error("Arrêt introuvable.");
  }
  await deletePoint(String(data.id));
}

export async function saveTrace(
  versionId: string,
  trailValue: unknown
): Promise<CircuitTraceRow> {
  const id = String(versionId ?? "").trim();
  if (!id) throw new Error("version_id manquant.");

  const trail = normalizeTrail(trailValue);
  if (trail.length < 2) {
    throw new Error("La trace doit contenir au moins deux points.");
  }

  const { data: existing, error: existingError } = await circuitSupabase
    .from("circuit_traces")
    .select("id")
    .eq("version_id", id)
    .order("created_at", { ascending: false })
    .limit(1);

  fail(existingError, "Recherche de la trace existante");

  if (existing?.[0]?.id) {
    const { data, error } = await circuitSupabase
      .from("circuit_traces")
      .update({ trail, points_count: trail.length })
      .eq("id", existing[0].id)
      .select("*")
      .single();

    fail(error, "Mise à jour de la trace");

    return {
      ...(data as CircuitTraceRow),
      trail: normalizeTrail((data as CircuitTraceRow).trail),
    };
  }

  const { data, error } = await circuitSupabase
    .from("circuit_traces")
    .insert({
      version_id: id,
      trail,
      points_count: trail.length,
    })
    .select("*")
    .single();

  fail(error, "Création de la trace");

  return {
    ...(data as CircuitTraceRow),
    trail: normalizeTrail((data as CircuitTraceRow).trail),
  };
}

export async function printCircuit(circuitId: string) {
  const detail = await getCircuit(circuitId);

  return {
    circuit: detail.circuit,
    rows: detail.points.map((point) => ({
      idx: point.idx,
      dir: point.dir ?? null,
      nav_dir: point.nav_dir ?? null,
      stop_kind: point.stop_kind ?? null,
      description: point.description ?? null,
      arret: point.label ?? null,
      raw_label: point.label ?? null,
      note: point.note ?? null,
      stop_type: point.stop_type ?? "school",
    })),
  };
}

export type BusPlannerImportPoint = {
  lat: number;
  lng: number;
  label?: string | null;
};

export type BusPlannerImportOptions = {
  transporteur_code: CarrierCode;
  route_id: string;
  circuit_name: string;
  replace_existing: boolean;
  generate_trace: boolean;
  points: BusPlannerImportPoint[];
  trace_points?: BusPlannerImportPoint[];
  official_distance_km?: number | null;
};

export type BusPlannerImportResult = {
  ok: true;
  circuit_id: string;
  version_id: string;
  circuit_name: string;
  route_id: string;
  points_imported: number;
  trace_points: number;
  distance_m: number | null;
  distance_km: number | null;
  trace_generated: boolean;
  warning: string | null;
};

type MapboxDirectionsResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    geometry?: {
      type?: string;
      coordinates?: Array<[number, number]>;
    };
  }>;
};

function validateBusPlannerImportPoints(
  points: BusPlannerImportPoint[]
): BusPlannerImportPoint[] {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("Le fichier doit contenir au moins deux points d’arrêt.");
  }

  return points.map((point, index) => {
    const lat = asFiniteNumber(point?.lat);
    const lng = asFiniteNumber(point?.lng);

    if (lat == null || lat < -90 || lat > 90) {
      throw new Error(`Latitude invalide au point ${index + 1}.`);
    }

    if (lng == null || lng < -180 || lng > 180) {
      throw new Error(`Longitude invalide au point ${index + 1}.`);
    }

    return {
      lat,
      lng,
      label: String(point?.label ?? "").trim() || null,
    };
  });
}

function splitDirectionsCoordinates(
  points: BusPlannerImportPoint[],
  maximum = 25
): BusPlannerImportPoint[][] {
  const chunks: BusPlannerImportPoint[][] = [];
  let start = 0;

  while (start < points.length - 1) {
    const endExclusive = Math.min(start + maximum, points.length);
    const chunk = points.slice(start, endExclusive);

    if (chunk.length >= 2) chunks.push(chunk);
    if (endExclusive >= points.length) break;

    // Le dernier point du segment précédent devient le premier du suivant.
    start = endExclusive - 1;
  }

  return chunks;
}

async function requestMapboxDirections(
  points: BusPlannerImportPoint[]
): Promise<{ trail: TrailPoint[]; distance_m: number }> {
  const token = String(
    (import.meta as any).env?.VITE_MAPBOX_TOKEN ||
      (import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN ||
      ""
  ).trim();

  if (!token) {
    throw new Error(
      "VITE_MAPBOX_TOKEN est manquant. Décoche le calcul de la trace ou ajoute le token Mapbox."
    );
  }

  const chunks = splitDirectionsCoordinates(points, 25);
  const mergedCoordinates: Array<[number, number]> = [];
  let distanceM = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const coordinateString = chunk
      .map((point) => `${point.lng},${point.lat}`)
      .join(";");

    const params = new URLSearchParams({
      access_token: token,
      geometries: "geojson",
      overview: "full",
      steps: "false",
      alternatives: "false",
    });

    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${coordinateString}?${params.toString()}`;

    const response = await fetch(url);
    const payload = (await response.json().catch(() => ({}))) as MapboxDirectionsResponse;

    if (!response.ok || payload.code !== "Ok") {
      throw new Error(
        payload.message ||
          `Mapbox n’a pas pu calculer le segment ${chunkIndex + 1} (${response.status}).`
      );
    }

    const route = payload.routes?.[0];
    const coordinates = route?.geometry?.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error(`Mapbox a retourné une trace vide au segment ${chunkIndex + 1}.`);
    }

    distanceM += Number(route?.distance ?? 0);

    if (mergedCoordinates.length && coordinates.length) {
      const previous = mergedCoordinates[mergedCoordinates.length - 1];
      const first = coordinates[0];

      if (previous[0] === first[0] && previous[1] === first[1]) {
        mergedCoordinates.push(...coordinates.slice(1));
      } else {
        mergedCoordinates.push(...coordinates);
      }
    } else {
      mergedCoordinates.push(...coordinates);
    }
  }

  const trail = mergedCoordinates.map(([lng, lat], index) => ({
    idx: index,
    lat,
    lng,
  }));

  if (trail.length < 2) {
    throw new Error("La trace Mapbox générée est trop courte.");
  }

  return {
    trail,
    distance_m: Number.isFinite(distanceM)
      ? distanceM
      : calculateTrailDistanceMeters(trail),
  };
}

async function findExistingImportCircuit(
  transporteurCode: CarrierCode,
  circuitName: string
): Promise<CircuitRow | null> {
  const { data, error } = await circuitSupabase
    .from("circuits")
    .select("*")
    .eq("transporteur_code", transporteurCode)
    .ilike("nom", circuitName)
    .limit(1);

  fail(error, "Recherche du circuit existant");
  return (data?.[0] ?? null) as CircuitRow | null;
}


type GeneratedRouteCandidate = {
  label: string;
  trail: TrailPoint[];
  distance_m: number;
  difference_ratio: number | null;
};

function officialDifferenceRatio(
  distanceM: number,
  officialDistanceKm: number | null
): number | null {
  if (
    officialDistanceKm == null ||
    !Number.isFinite(officialDistanceKm) ||
    officialDistanceKm <= 0
  ) {
    return null;
  }

  const officialM = officialDistanceKm * 1000;
  return Math.abs(distanceM - officialM) / officialM;
}

async function generateBestBusPlannerRoute(
  visibleStops: BusPlannerImportPoint[],
  constrainedPoints: BusPlannerImportPoint[],
  officialDistanceKm: number | null
): Promise<{
  selected: GeneratedRouteCandidate;
  warning: string | null;
}> {
  const candidates: GeneratedRouteCandidate[] = [];
  const signatures = new Set<string>();

  async function addCandidate(
    label: string,
    routePoints: BusPlannerImportPoint[]
  ) {
    if (routePoints.length < 2) return;

    const signature = routePoints
      .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
      .join("|");

    if (signatures.has(signature)) return;
    signatures.add(signature);

    const generated = await requestMapboxDirections(routePoints);

    candidates.push({
      label,
      trail: generated.trail,
      distance_m: generated.distance_m,
      difference_ratio: officialDifferenceRatio(
        generated.distance_m,
        officialDistanceKm
      ),
    });
  }

  let constrainedError: unknown = null;

  try {
    await addCandidate("contraintes XLS", constrainedPoints);
  } catch (error) {
    constrainedError = error;
  }

  try {
    await addCandidate("arrêts seulement", visibleStops);
  } catch (error) {
    if (!candidates.length) throw error;
  }

  if (!candidates.length) {
    throw constrainedError instanceof Error
      ? constrainedError
      : new Error("Aucune trace Mapbox valide n’a pu être générée.");
  }

  const selected = [...candidates].sort((a, b) => {
    if (a.difference_ratio == null && b.difference_ratio == null) {
      return a.distance_m - b.distance_m;
    }
    if (a.difference_ratio == null) return 1;
    if (b.difference_ratio == null) return -1;
    return a.difference_ratio - b.difference_ratio;
  })[0];

  const warningParts: string[] = [];

  if (
    selected.difference_ratio != null &&
    selected.difference_ratio > 0.35
  ) {
    const calculatedKm = selected.distance_m / 1000;
    warningParts.push(
      `Trace enregistrée pour diagnostic malgré un écart important : ` +
        `${calculatedKm.toFixed(2)} km calculés contre ` +
        `${officialDistanceKm?.toFixed(2)} km dans BusPlanner.`
    );
  }

  if (selected.label === "arrêts seulement" && constrainedPoints.length > visibleStops.length) {
    warningParts.push(
      "Les contraintes de demi-tour donnaient une trace moins cohérente; " +
        "la trace basée sur les arrêts a été conservée."
    );
  }

  if (
    selected.difference_ratio != null &&
    selected.difference_ratio > 0.15 &&
    selected.difference_ratio <= 0.35
  ) {
    warningParts.push(
      `Écart de ${(selected.difference_ratio * 100).toFixed(1)} % avec la distance officielle.`
    );
  }

  return {
    selected,
    warning: warningParts.length ? warningParts.join(" ") : null,
  };
}

export async function importBusPlanner(
  options: BusPlannerImportOptions
): Promise<BusPlannerImportResult> {
  const transporteurCode = String(options.transporteur_code ?? "")
    .trim()
    .toUpperCase() as CarrierCode;
  const routeId = String(options.route_id ?? "").trim();
  const circuitName = String(options.circuit_name ?? "").trim();

  if (!["B", "C", "S"].includes(transporteurCode)) {
    throw new Error("Transporteur invalide.");
  }

  if (!routeId) throw new Error("RouteID BusPlanner manquant.");
  if (!circuitName) throw new Error("Nom du circuit manquant.");

  const points = validateBusPlannerImportPoints(options.points);
  const traceSourcePoints = options.trace_points?.length
    ? validateBusPlannerImportPoints(options.trace_points)
    : points;
  const officialDistanceKm =
    options.official_distance_km == null
      ? null
      : Number(options.official_distance_km);

  let circuitId = "";
  let versionId = "";
  let createdNewCircuit = false;
  let previousActiveVersionIds: string[] = [];

  try {
    const existingCircuit = await findExistingImportCircuit(
      transporteurCode,
      circuitName
    );

    if (existingCircuit && !options.replace_existing) {
      throw new Error(
        `Le circuit « ${circuitName} » existe déjà. Coche « Créer une nouvelle version » pour l’importer.`
      );
    }

    if (existingCircuit) {
      circuitId = existingCircuit.id;

      const { data: activeVersions, error: activeVersionsError } =
        await circuitSupabase
          .from("circuit_versions")
          .select("id")
          .eq("circuit_id", circuitId)
          .eq("is_active", true);

      fail(activeVersionsError, "Chargement des versions actives");
      previousActiveVersionIds = (activeVersions ?? []).map((row: any) =>
        String(row.id)
      );

      const { error: deactivateError } = await circuitSupabase
        .from("circuit_versions")
        .update({ is_active: false })
        .eq("circuit_id", circuitId);

      fail(deactivateError, "Désactivation de l’ancienne version");
    } else {
      const { data: newCircuit, error: circuitError } = await circuitSupabase
        .from("circuits")
        .insert({
          transporteur_code: transporteurCode,
          nom: circuitName,
          actif: true,
        })
        .select("*")
        .single();

      fail(circuitError, "Création du circuit");

      circuitId = String(newCircuit.id);
      createdNewCircuit = true;
    }

    const { data: latestVersions, error: latestVersionError } =
      await circuitSupabase
        .from("circuit_versions")
        .select("version_no")
        .eq("circuit_id", circuitId)
        .order("version_no", { ascending: false })
        .limit(1);

    fail(latestVersionError, "Recherche du numéro de version");

    const versionNo = Number(latestVersions?.[0]?.version_no ?? 0) + 1;

    const { data: newVersion, error: versionError } = await circuitSupabase
      .from("circuit_versions")
      .insert({
        circuit_id: circuitId,
        version_no: versionNo,
        is_active: true,
        note: `Import BusPlanner — RouteID ${routeId}`,
        general_note_start: null,
      })
      .select("*")
      .single();

    fail(versionError, "Création de la version");

    versionId = String(newVersion.id);

    const rows = points.map((point, index) => ({
      version_id: versionId,
      // La base utilise un idx technique commençant à 0.
      idx: index,
      lat: point.lat,
      lng: point.lng,
      label: point.label,
      stop_type: "school",
      note: null,
      note_mode: "none",
      note_trigger_m: 200,
      note_once: true,
      note_images: [],
    }));

    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) {
      const { error: pointsError } = await circuitSupabase
        .from("circuit_points")
        .insert(rows.slice(start, start + batchSize));

      fail(pointsError, "Import des points d’arrêt");
    }

    let tracePoints = 0;
    let distanceM: number | null = null;
    let warning: string | null = null;

    if (options.generate_trace) {
      try {
        const generated = await generateBestBusPlannerRoute(
          points,
          traceSourcePoints,
          officialDistanceKm
        );

        const trace = await saveTrace(
          versionId,
          generated.selected.trail
        );

        tracePoints = trace.trail.length;
        distanceM = generated.selected.distance_m;
        warning = generated.warning;
      } catch (traceError: any) {
        // Ne conserve jamais une trace manifestement incohérente.
        warning =
          `Les arrêts ont été importés, mais la trace n’a pas été enregistrée : ` +
          `${traceError?.message ?? "Erreur Mapbox"}`;
      }
    }

    return {
      ok: true,
      circuit_id: circuitId,
      version_id: versionId,
      circuit_name: circuitName,
      route_id: routeId,
      points_imported: rows.length,
      trace_points: tracePoints,
      distance_m: distanceM,
      distance_km: distanceM == null ? null : distanceM / 1000,
      trace_generated: tracePoints >= 2,
      warning,
    };
  } catch (error) {
    // Retour arrière minimal afin de ne pas laisser une version partielle active.
    try {
      if (versionId) {
        await circuitSupabase
          .from("circuit_versions")
          .delete()
          .eq("id", versionId);
      }

      if (createdNewCircuit && circuitId) {
        await circuitSupabase.from("circuits").delete().eq("id", circuitId);
      } else if (circuitId && previousActiveVersionIds.length) {
        await circuitSupabase
          .from("circuit_versions")
          .update({ is_active: true })
          .in("id", previousActiveVersionIds);
      }
    } catch {
      // Ne masque pas l’erreur d’import originale.
    }

    throw error;
  }
}

