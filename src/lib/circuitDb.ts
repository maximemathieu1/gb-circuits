import { circuitSupabase } from "./circuitSupabase";

export type DispatchCircuitRow = {
  circuit_id: string;
  nom: string;
  transporteur_code: string;
  heure_depart?: string | null;
  heure_retour?: string | null;
  unite?: string | null;
  conducteur?: string | null;
  nb_arrets?: number;
  nb_transferts?: number;
  km_total?: number | null;
};

function throwIfError(error: any) {
  if (error) {
    throw new Error(error.message || "Erreur Supabase");
  }
}

export async function listCircuits(): Promise<DispatchCircuitRow[]> {
  const { data: circuits, error } = await circuitSupabase
    .from("circuits")
    .select(`
      id,
      nom,
      transporteur_code,
      heure_depart,
      heure_retour,
      unite,
      conducteur,
      active_version_id
    `)
    .order("nom", { ascending: true });

  throwIfError(error);

  if (!circuits?.length) return [];

  const versionIds = circuits
    .map((c: any) => c.active_version_id)
    .filter(Boolean);

  let points: any[] = [];
  let traces: any[] = [];

  if (versionIds.length) {
    const [pointsResp, tracesResp] = await Promise.all([
      circuitSupabase
        .from("circuit_points")
        .select("version_id, stop_type")
        .in("version_id", versionIds),

      circuitSupabase
        .from("circuit_traces")
        .select("version_id, distance_m, km_total")
        .in("version_id", versionIds),
    ]);

    throwIfError(pointsResp.error);
    throwIfError(tracesResp.error);

    points = pointsResp.data ?? [];
    traces = tracesResp.data ?? [];
  }

  return circuits.map((c: any) => {
    const circuitPoints = points.filter(
      (p) => p.version_id === c.active_version_id
    );

    const trace = traces.find(
      (t) => t.version_id === c.active_version_id
    );

    const transfers = circuitPoints.filter(
      (p) => p.stop_type === "transfer"
    ).length;

    const km =
      trace?.km_total != null
        ? Number(trace.km_total)
        : trace?.distance_m != null
        ? Number(trace.distance_m) / 1000
        : null;

    return {
      circuit_id: c.id,
      nom: c.nom,
      transporteur_code: c.transporteur_code,
      heure_depart: c.heure_depart,
      heure_retour: c.heure_retour,
      unite: c.unite,
      conducteur: c.conducteur,
      nb_arrets: circuitPoints.length,
      nb_transferts: transfers,
      km_total: km,
    };
  });
}

export async function getCircuit(circuitId: string) {
  const { data: circuit, error: circuitError } = await circuitSupabase
    .from("circuits")
    .select("*")
    .eq("id", circuitId)
    .single();

  throwIfError(circuitError);

  let activeVersion: any = null;

  if (circuit.active_version_id) {
    const { data, error } = await circuitSupabase
      .from("circuit_versions")
      .select("*")
      .eq("id", circuit.active_version_id)
      .single();

    throwIfError(error);
    activeVersion = data;
  }

  const { data: points, error: pointsError } = await circuitSupabase
    .from("circuit_points")
    .select("*")
    .eq("version_id", circuit.active_version_id)
    .order("idx", { ascending: true });

  throwIfError(pointsError);

  const { data: traceRows, error: traceError } = await circuitSupabase
    .from("circuit_traces")
    .select("*")
    .eq("version_id", circuit.active_version_id)
    .order("created_at", { ascending: false })
    .limit(1);

  throwIfError(traceError);

  return {
    circuit,
    active_version: activeVersion,
    points: points ?? [],
    trace: traceRows?.[0] ?? null,
  };
}

export async function updateCircuit(
  circuitId: string,
  values: Record<string, unknown>
) {
  const { data, error } = await circuitSupabase
    .from("circuits")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", circuitId)
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function deleteCircuit(circuitId: string) {
  const { error } = await circuitSupabase
    .from("circuits")
    .delete()
    .eq("id", circuitId);

  throwIfError(error);
}

export async function updatePoint(
  pointId: string,
  values: Record<string, unknown>
) {
  const { data, error } = await circuitSupabase
    .from("circuit_points")
    .update(values)
    .eq("id", pointId)
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function deletePoint(pointId: string) {
  const { error } = await circuitSupabase
    .from("circuit_points")
    .delete()
    .eq("id", pointId);

  throwIfError(error);
}

export async function insertPoint(values: {
  version_id: string;
  idx: number;
  lat: number;
  lng: number;
  label?: string | null;
  stop_type?: string;
}) {
  const { data, error } = await circuitSupabase
    .from("circuit_points")
    .insert(values)
    .select()
    .single();

  throwIfError(error);
  return data;
}

export async function printCircuit(circuitId: string) {
  const data = await getCircuit(circuitId);

  return {
    circuit: data.circuit,
    rows: (data.points ?? []).map((point: any) => ({
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