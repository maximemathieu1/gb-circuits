import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { circuitSupabase } from "../lib/circuitSupabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type Compagnie =
  | "Autobus Breton"
  | "Autobus Champagne"
  | "Transport Sécuritaire";

type Organisation =
  | "Autobus Breton"
  | "Autobus Champagne"
  | "Transport Sécuritaire"
  | "Groupe Breton"
  | "Autre";

type CircuitDocument = {
  id: string;
  circuitId: string;
  nom: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  taille: number;
};

type CircuitScolaire = {
  id: string;
  circuit: string;
  unite: string;
  nomConducteur: string;
  telephone: string;
  localisation: string;
  compagnie: Compagnie;
  documents: CircuitDocument[];
};

type CircuitSamsaraJour = {
  id: string;
  circuitId: string;
  date: string;
  samsaraVehicleId: string;
  samsaraVehicleName: string;
  departAm: string | null;
  retourAm: string | null;
  kmAm: number;
  departPm: string | null;
  retourPm: string | null;
  kmPm: number;
  kmRegulier: number;
  kmHorsRegulier: number;
  statut: string;
  statutManuel: "regulier" | "hors_regulier" | null;
  details: Record<string, any>;
  exclue: boolean;
};

type CircuitSamsaraConfig = {
  circuitId: string;
  samsaraVehicleId: string | null;
  samsaraVehicleName: string | null;
  depotLat: number | null;
  depotLng: number | null;
  depotRadiusM: number;
  toleranceMinutes: number;
};

type SamsaraLiveVehicle = {
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

type CircuitSamsaraAttente = {
  id: string;
  circuitId: string;
  date: string;
  periode: "AM" | "PM";
  arrivee: string;
  depart: string;
  dureeMinutes: number;
  latitude: number;
  longitude: number;
  samsaraAddressId: string | null;
  nomLieu: string | null;
  adresse: string | null;
  groupKey: string | null;
  recurrent: boolean;
  occurrenceCount: number;
  regularDaysCount: number;
  recurrenceRatio: number;
  averageDurationMinutes: number | null;
  maxDurationMinutes: number | null;
};

type ContactUrgence = {
  id: string;
  organisation: Organisation;
  organisationAutre: string;
  nom: string;
  fonction: string;
  telephone: string;
  telephone2: string;
  notes: string;
};

type ConducteurRemplacant = {
  id: string;
  nom: string;
  telephone: string;
  compagnie: Compagnie;
};

type ColonneTriCircuit =
  | "circuit"
  | "unite"
  | "nomConducteur"
  | "telephone"
  | "localisation"
  | "compagnie";

const BUCKET_DOCUMENTS = "circuits-scolaires-pdf";

const fichiersAcceptes =
  "application/pdf,image/jpeg,image/png,image/webp,text/plain";

const circuitVide: Omit<CircuitScolaire, "id"> = {
  circuit: "",
  unite: "",
  nomConducteur: "",
  telephone: "",
  localisation: "",
  compagnie: "Autobus Breton",
  documents: [],
};

const contactVide: Omit<ContactUrgence, "id"> = {
  organisation: "Groupe Breton",
  organisationAutre: "",
  nom: "",
  fonction: "",
  telephone: "",
  telephone2: "",
  notes: "",
};

const remplacantVide: Omit<
  ConducteurRemplacant,
  "id"
> = {
  nom: "",
  telephone: "",
  compagnie: "Autobus Breton",
};

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function dossierCompagnie(compagnie: Compagnie) {
  switch (compagnie) {
    case "Autobus Breton":
      return "breton";

    case "Autobus Champagne":
      return "champagne";

    case "Transport Sécuritaire":
      return "securitaire";
  }
}

function nettoyerNomFichier(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatTaille(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} o`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} Ko`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function typeCourt(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("image")) return "Image";
  if (mime.includes("text")) return "Texte";

  return "Fichier";
}

function nomOrganisation(contact: ContactUrgence) {
  if (contact.organisation === "Autre") {
    return (
      contact.organisationAutre.trim() ||
      "Autre"
    );
  }

  return contact.organisation;
}

function formatHeureSamsara(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}


function minutesEntreHeures(depart: string | null, retour: string | null): number | null {
  if (!depart || !retour) return null;

  const d = new Date(depart);
  const r = new Date(retour);

  if (Number.isNaN(d.getTime()) || Number.isNaN(r.getTime())) return null;

  const minutes = (r.getTime() - d.getTime()) / 60000;
  return minutes >= 0 ? minutes : null;
}

function arrondirQuartHeureDecimal(heures: number) {
  return Math.round(heures * 4) / 4;
}

function calculHeuresJour(jour: CircuitSamsaraJour) {
  const amMinutes = minutesEntreHeures(jour.departAm, jour.retourAm);
  const pmMinutes = minutesEntreHeures(jour.departPm, jour.retourPm);

  const segmentsComplets = [amMinutes, pmMinutes].filter(
    (v): v is number => v != null
  );

  if (segmentsComplets.length === 0) {
    return {
      heuresRegulieres: null as number | null,
      vad: null as number | null,
      heuresAPayer: null as number | null,
    };
  }

  const heuresBrutes =
    segmentsComplets.reduce((sum, minutes) => sum + minutes, 0) / 60;

  const heuresRegulieres = arrondirQuartHeureDecimal(heuresBrutes);
  const vad = 0.25;

  return {
    heuresRegulieres,
    vad,
    heuresAPayer: heuresRegulieres + vad,
  };
}

function jourSamsaraAvecDonnees(jour: CircuitSamsaraJour) {
  return Boolean(
    jour.departAm ||
      jour.retourAm ||
      jour.departPm ||
      jour.retourPm ||
      jour.kmAm > 0 ||
      jour.kmPm > 0 ||
      jour.kmRegulier > 0 ||
      jour.kmHorsRegulier > 0
  );
}

function jourSamsaraCompletPourMoyenne(jour: CircuitSamsaraJour) {
  const amComplet = Boolean(jour.departAm && jour.retourAm);
  const pmComplet = Boolean(jour.departPm && jour.retourPm);

  // Une journée n'entre dans les moyennes qu'une fois les deux périodes
  // AM et PM complétées. Cela évite qu'une journée en cours avec 0 km
  // fasse artificiellement baisser la moyenne.
  return amComplet && pmComplet;
}

function raisonStatutSamsara(jour: CircuitSamsaraJour) {
  if (jour.exclue) return "Journée exclue des statistiques.";
  if (jour.statutManuel === "regulier") return "Confirmé régulier manuellement.";
  if (jour.statutManuel === "hors_regulier") return "Classé hors régulier manuellement.";

  const raison = String(jour.details?.raison_statut ?? "").trim();
  if (raison) return raison;

  if (jour.statut === "À vérifier") return "Période AM ou PM incomplète.";
  if (jour.statut === "Hors régulier") return "Écart supérieur à la tolérance de 15 minutes.";
  if (jour.statut === "Régulier") return "Dans la plage régulière historique.";
  return "";
}

function valeurStatutManuel(jour: CircuitSamsaraJour) {
  return jour.statutManuel ?? "auto";
}

function formatDateSamsara(value: string) {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("fr-CA", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function mondayIso(offsetWeeks = 0) {
  const now = new Date();
  const local = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now) + "T12:00:00"
  );
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff + offsetWeeks * 7);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

function fridayFromMonday(monday: string) {
  const d = new Date(`${monday}T12:00:00`);
  d.setDate(d.getDate() + 4);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatHeureLive(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export default function CircuitsScolairesPage() {
  const inputFichierRef =
    useRef<HTMLInputElement | null>(null);

  const gpsMapContainerRef = useRef<HTMLDivElement | null>(null);
  const gpsMapRef = useRef<mapboxgl.Map | null>(null);
  const gpsMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const gpsDestinationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const vehiculeGpsActifRef = useRef<SamsaraLiveVehicle | null>(null);
  const destinationGpsRef = useRef<{
    longitude: number;
    latitude: number;
  } | null>(null);
  const etaAbortRef = useRef<AbortController | null>(null);
  const etaRequestIdRef = useRef(0);

  /*
   * DONNÉES SUPABASE
   */

  const [circuits, setCircuits] = useState<
    CircuitScolaire[]
  >([]);

  const [contacts, setContacts] = useState<
    ContactUrgence[]
  >([]);

  const [remplacants, setRemplacants] =
    useState<ConducteurRemplacant[]>([]);

  const [chargement, setChargement] =
    useState(true);

  /*
   * SAMSARA LIVE / MAPBOX
   */
  const [samsaraLiveParCircuit, setSamsaraLiveParCircuit] =
    useState<Record<string, SamsaraLiveVehicle>>({});
  const [samsaraStatutsChargement, setSamsaraStatutsChargement] =
    useState(false);
  const [modalGpsOuvert, setModalGpsOuvert] = useState(false);
  const [circuitGpsActif, setCircuitGpsActif] =
    useState<CircuitScolaire | null>(null);
  const [vehiculeGpsActif, setVehiculeGpsActif] =
    useState<SamsaraLiveVehicle | null>(null);
  const [gpsChargement, setGpsChargement] = useState(false);
  const [gpsErreur, setGpsErreur] = useState<string | null>(null);
  const [suiviGps, setSuiviGps] = useState(true);
  const [destinationGps, setDestinationGps] = useState<{
    longitude: number;
    latitude: number;
  } | null>(null);
  const [etaGps, setEtaGps] = useState<{
    durationSeconds: number;
    distanceMeters: number;
    arrivalAt: string;
  } | null>(null);
  const [etaChargement, setEtaChargement] = useState(false);
  const [etaErreur, setEtaErreur] = useState<string | null>(null);

  useEffect(() => {
    vehiculeGpsActifRef.current = vehiculeGpsActif;
  }, [vehiculeGpsActif]);

  useEffect(() => {
    destinationGpsRef.current = destinationGps;
  }, [destinationGps]);

  /*
   * FILTRES / TRI
   */

  const [recherche, setRecherche] =
    useState("");

  const [compagnie, setCompagnie] =
    useState<Compagnie | "Toutes">(
      "Toutes"
    );

  const [tri, setTri] =
    useState<ColonneTriCircuit>(
      "circuit"
    );

  const [direction, setDirection] =
    useState<"asc" | "desc">("asc");

  /*
   * MODAL CIRCUIT
   */

  const [
    modalCircuitOuvert,
    setModalCircuitOuvert,
  ] = useState(false);

  const [circuitActifId, setCircuitActifId] =
    useState<string | null>(null);

  const [circuitForm, setCircuitForm] =
    useState<Omit<CircuitScolaire, "id">>({
      ...circuitVide,
      documents: [],
    });

  const [fichiersEnAttente, setFichiersEnAttente] =
    useState<File[]>([]);

  const [dragActif, setDragActif] =
    useState(false);

  const [
    operationEnCours,
    setOperationEnCours,
  ] = useState(false);

  const [ongletCircuit, setOngletCircuit] = useState<"infos" | "samsara" | "attentes">("infos");
  const [samsaraJours, setSamsaraJours] = useState<CircuitSamsaraJour[]>([]);
  const [samsaraAttentes, setSamsaraAttentes] = useState<CircuitSamsaraAttente[]>([]);
  const [attentesChargement, setAttentesChargement] = useState(false);
  const [filtreAttentes, setFiltreAttentes] = useState<"recurrent" | "occasionnel" | "tous">("tous");
  const [seuilAttenteMinutes, setSeuilAttenteMinutes] = useState(25);
  const [, setSamsaraConfig] =
  useState<CircuitSamsaraConfig | null>(null);
  const [samsaraChargement, setSamsaraChargement] = useState(false);
  const [samsaraSync, setSamsaraSync] = useState(false);
  const [afficherExclues, setAfficherExclues] = useState(false);
  const [samsaraSemaine, setSamsaraSemaine] = useState(mondayIso(0));

  /*
   * MODAL CONTACT
   */

  const [
    modalContactOuvert,
    setModalContactOuvert,
  ] = useState(false);

  const [contactActifId, setContactActifId] =
    useState<string | null>(null);

  const [contactForm, setContactForm] =
    useState<Omit<ContactUrgence, "id">>(
      contactVide
    );

  /*
   * MODAL REMPLAÇANT
   */

  const [
    modalRemplacantOuvert,
    setModalRemplacantOuvert,
  ] = useState(false);

  const [
    remplacantActifId,
    setRemplacantActifId,
  ] = useState<string | null>(null);

  const [
    remplacantForm,
    setRemplacantForm,
  ] = useState<
    Omit<ConducteurRemplacant, "id">
  >(remplacantVide);

  /*
   * CHARGEMENT INITIAL
   */

  useEffect(() => {
    void chargerToutesLesDonnees();
  }, []);

  async function chargerToutesLesDonnees() {
    try {
      setChargement(true);

      await Promise.all([
        chargerCircuits(),
        chargerContacts(),
        chargerRemplacants(),
      ]);
    } catch (error) {
      console.error(
        "Erreur chargement circuits scolaires",
        error
      );

      alert(
        "Impossible de charger les données."
      );
    } finally {
      setChargement(false);
    }
  }

  async function chargerCircuits() {
    const { data, error } =
      await circuitSupabase
        .from("circuits_scolaires")
        .select(`
          id,
          circuit,
          unite,
          nom_conducteur,
          telephone,
          localisation,
          compagnie,
          circuits_scolaires_documents (
            id,
            circuit_id,
            nom,
            storage_path,
            public_url,
            mime_type,
            taille
          )
        `)
        .order("circuit", {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    const resultat: CircuitScolaire[] =
      (data || []).map((item: any) => ({
        id: item.id,
        circuit: item.circuit || "",
        unite: item.unite || "",
        nomConducteur:
          item.nom_conducteur || "",
        telephone: item.telephone || "",
        localisation:
          item.localisation || "",
        compagnie:
          item.compagnie as Compagnie,

        documents:
          (
            item.circuits_scolaires_documents ||
            []
          ).map((doc: any) => ({
            id: doc.id,
            circuitId: doc.circuit_id,
            nom: doc.nom,
            storagePath:
              doc.storage_path,
            publicUrl: doc.public_url,
            mimeType:
              doc.mime_type ||
              "application/octet-stream",
            taille:
              Number(doc.taille) || 0,
          })),
      }));

    setCircuits(resultat);
    void chargerStatutsSamsaraLive(resultat);
  }

  async function chargerContacts() {
    const { data, error } =
      await circuitSupabase
        .from(
          "circuits_contacts_urgence"
        )
        .select("*")
        .order("organisation", {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    const resultat: ContactUrgence[] =
      (data || []).map((item: any) => ({
        id: item.id,

        organisation:
          item.organisation as Organisation,

        organisationAutre:
          item.organisation_autre || "",

        nom: item.nom || "",
        fonction: item.fonction || "",
        telephone: item.telephone || "",
        telephone2:
          item.telephone2 || "",
        notes: item.notes || "",
      }));

    setContacts(resultat);
  }

  async function chargerRemplacants() {
    const { data, error } =
      await circuitSupabase
        .from("circuits_remplacants")
        .select("*")
        .order("nom", {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    const resultat: ConducteurRemplacant[] =
      (data || []).map((item: any) => ({
        id: item.id,
        nom: item.nom || "",
        telephone: item.telephone || "",
        compagnie:
          item.compagnie as Compagnie,
      }));

    setRemplacants(resultat);
  }

  async function appelerSamsaraLive(unites: string[]) {
    const uniques = Array.from(
      new Set(unites.map((u) => u.trim()).filter(Boolean))
    );

    if (uniques.length === 0) {
      return {} as Record<string, SamsaraLiveVehicle>;
    }

    const { data, error } = await circuitSupabase.functions.invoke(
      "circuit-samsara-live",
      {
        body: { units: uniques },
      }
    );

    if (error) throw error;
    if (data?.ok === false) {
      throw new Error(data?.error || "Lecture Samsara impossible.");
    }

    return (data?.vehicles || {}) as Record<string, SamsaraLiveVehicle>;
  }

  async function chargerStatutsSamsaraLive(
    liste: CircuitScolaire[] = circuits
  ) {
    try {
      setSamsaraStatutsChargement(true);

      const parUnite = await appelerSamsaraLive(
        liste.map((item) => item.unite)
      );

      const parCircuit: Record<string, SamsaraLiveVehicle> = {};

      for (const item of liste) {
        const unite = item.unite.trim();
        parCircuit[item.id] =
          parUnite[unite] || {
            found: false,
            unit: unite,
            vehicleId: null,
            vehicleName: null,
            latitude: null,
            longitude: null,
            headingDegrees: null,
            speedKph: null,
            fuelPercent: null,
            batterySocPercent: null,
            address: null,
            updatedAt: null,
          };
      }

      setSamsaraLiveParCircuit(parCircuit);
    } catch (error) {
      console.error("Erreur statuts Samsara live", error);
    } finally {
      setSamsaraStatutsChargement(false);
    }
  }

  async function rafraichirVehiculeGps(
    circuit: CircuitScolaire,
    afficherChargement = false
  ) {
    try {
      if (afficherChargement) setGpsChargement(true);
      setGpsErreur(null);

      const unite = circuit.unite.trim();
      const parUnite = await appelerSamsaraLive([unite]);
      const vehicule =
        parUnite[unite] || {
          found: false,
          unit: unite,
          vehicleId: null,
          vehicleName: null,
          latitude: null,
          longitude: null,
          headingDegrees: null,
          speedKph: null,
          fuelPercent: null,
          batterySocPercent: null,
          address: null,
          updatedAt: null,
        };

      setVehiculeGpsActif(vehicule);
      setSamsaraLiveParCircuit((prev) => ({
        ...prev,
        [circuit.id]: vehicule,
      }));

      if (!vehicule.found) {
        setGpsErreur(`Aucun véhicule Samsara trouvé pour l’unité ${unite}.`);
      }
    } catch (error: any) {
      console.error("Erreur Samsara live", error);
      setGpsErreur(error?.message || "Impossible de lire la position Samsara.");
    } finally {
      if (afficherChargement) setGpsChargement(false);
    }
  }

  function formaterDureeTrajet(seconds: number) {
    const totalMinutes = Math.max(1, Math.round(seconds / 60));

    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }

    const heures = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${heures} h ${minutes} min` : `${heures} h`;
  }

  function formaterDistanceTrajet(meters: number) {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }

    return `${(meters / 1000).toFixed(1)} km`;
  }

  function retirerTrajetGps() {
    etaAbortRef.current?.abort();
    etaAbortRef.current = null;
    etaRequestIdRef.current += 1;

    setDestinationGps(null);
    destinationGpsRef.current = null;
    setEtaGps(null);
    setEtaErreur(null);

    gpsDestinationMarkerRef.current?.remove();
    gpsDestinationMarkerRef.current = null;

    const map = gpsMapRef.current;
    if (!map) return;

    if (map.getLayer("gps-route-line")) {
      map.removeLayer("gps-route-line");
    }

    if (map.getSource("gps-route")) {
      map.removeSource("gps-route");
    }
  }

  async function calculerEtaGps(
    destination = destinationGps,
    live = vehiculeGpsActif
  ) {
    if (
      !destination ||
      live?.latitude == null ||
      live?.longitude == null
    ) {
      return;
    }

    const token =
      import.meta.env.VITE_MAPBOX_TOKEN ||
      import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

    if (!token) {
      setEtaErreur("Jeton Mapbox introuvable.");
      return;
    }

    try {
      const requestId = ++etaRequestIdRef.current;

      etaAbortRef.current?.abort();
      const controller = new AbortController();
      etaAbortRef.current = controller;

      setEtaChargement(true);
      setEtaErreur(null);

      const coordinates =
        `${live.longitude},${live.latitude};` +
        `${destination.longitude},${destination.latitude}`;

      const url =
        `https://api.mapbox.com/directions/v5/mapbox/driving/` +
        `${coordinates}` +
        `?alternatives=false&geometries=geojson&overview=full&steps=false` +
        `&access_token=${encodeURIComponent(token)}`;

      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Mapbox Directions ${response.status}`);
      }

      const data = await response.json();

      if (requestId !== etaRequestIdRef.current) {
        return;
      }

      const route = data?.routes?.[0];

      if (!route) {
        throw new Error("Aucun itinéraire routier trouvé.");
      }

      const durationSeconds = Number(route.duration ?? 0);
      const distanceMeters = Number(route.distance ?? 0);

      setEtaGps({
        durationSeconds,
        distanceMeters,
        arrivalAt: new Date(
          Date.now() + durationSeconds * 1000
        ).toISOString(),
      });

      const map = gpsMapRef.current;

      if (
        map &&
        route.geometry &&
        route.geometry.type === "LineString"
      ) {
        const geojson = {
          type: "Feature",
          properties: {},
          geometry: route.geometry,
        } as any;

        const existingSource = map.getSource(
          "gps-route"
        ) as mapboxgl.GeoJSONSource | undefined;

        if (existingSource) {
          existingSource.setData(geojson);
        } else {
          map.addSource("gps-route", {
            type: "geojson",
            data: geojson,
          });

          map.addLayer({
            id: "gps-route-line",
            type: "line",
            source: "gps-route",
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
        }

        const coordinatesRoute =
          route.geometry.coordinates as [number, number][];

        if (coordinatesRoute.length > 1) {
          const bounds = coordinatesRoute.reduce(
            (b, coord) => b.extend(coord),
            new mapboxgl.LngLatBounds(
              coordinatesRoute[0],
              coordinatesRoute[0]
            )
          );

          map.fitBounds(bounds, {
            padding: 70,
            maxZoom: 15,
            duration: 500,
          });
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        return;
      }

      console.error("Erreur calcul ETA Mapbox", error);
      setEtaErreur(
        error?.message ||
          "Impossible de calculer l’itinéraire."
      );
    } finally {
      if (etaAbortRef.current?.signal.aborted !== true) {
        setEtaChargement(false);
      }
    }
  }

  function definirDestinationGps(
    longitude: number,
    latitude: number
  ) {
    const destination = { longitude, latitude };

    setDestinationGps(destination);
    setEtaGps(null);
    setEtaErreur(null);
    setSuiviGps(true);

    gpsDestinationMarkerRef.current?.remove();

    const markerEl = document.createElement("div");
    markerEl.style.width = "34px";
    markerEl.style.height = "34px";
    markerEl.style.borderRadius = "50% 50% 50% 0";
    markerEl.style.background = "#dc2626";
    markerEl.style.border = "3px solid #ffffff";
    markerEl.style.boxShadow = "0 3px 12px rgba(0,0,0,.25)";
    markerEl.style.transform = "rotate(-45deg)";
    markerEl.style.display = "grid";
    markerEl.style.placeItems = "center";

    const centerDot = document.createElement("div");
    centerDot.style.width = "9px";
    centerDot.style.height = "9px";
    centerDot.style.borderRadius = "50%";
    centerDot.style.background = "#ffffff";
    markerEl.appendChild(centerDot);

    gpsDestinationMarkerRef.current = new mapboxgl.Marker({
      element: markerEl,
      anchor: "bottom",
    })
      .setLngLat([longitude, latitude])
      .addTo(gpsMapRef.current!);

    void calculerEtaGps(destination, vehiculeGpsActif);
  }

  function ouvrirCarteGps(circuit: CircuitScolaire) {
    const live = samsaraLiveParCircuit[circuit.id];

    if (!live?.found) return;

    setCircuitGpsActif(circuit);
    setVehiculeGpsActif(live);
    setGpsErreur(null);
    setSuiviGps(true);
    setModalGpsOuvert(true);
    void rafraichirVehiculeGps(circuit, true);
  }

  function fermerCarteGps() {
    etaAbortRef.current?.abort();
    etaAbortRef.current = null;
    etaRequestIdRef.current += 1;

    setModalGpsOuvert(false);
    setCircuitGpsActif(null);
    setVehiculeGpsActif(null);
    setGpsErreur(null);
    setSuiviGps(true);
    setDestinationGps(null);
    setEtaGps(null);
    setEtaErreur(null);

    gpsMarkerRef.current?.remove();
    gpsMarkerRef.current = null;

    gpsDestinationMarkerRef.current?.remove();
    gpsDestinationMarkerRef.current = null;

    gpsMapRef.current?.remove();
    gpsMapRef.current = null;
  }

  function recentrerGps() {
    const map = gpsMapRef.current;
    const live = vehiculeGpsActif;

    if (
      !map ||
      live?.latitude == null ||
      live?.longitude == null
    ) {
      return;
    }

    setSuiviGps(true);
    map.easeTo({
      center: [live.longitude, live.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: 500,
    });
  }

  useEffect(() => {
    if (!modalGpsOuvert || !circuitGpsActif) return;

    const timer = window.setInterval(() => {
      void rafraichirVehiculeGps(circuitGpsActif, false);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [modalGpsOuvert, circuitGpsActif?.id]);

  useEffect(() => {
    if (!modalGpsOuvert || !gpsMapContainerRef.current) return;

    const token =
      import.meta.env.VITE_MAPBOX_TOKEN ||
      import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

    if (!token) {
      setGpsErreur(
        "Jeton Mapbox introuvable. Utilise VITE_MAPBOX_TOKEN ou VITE_MAPBOX_ACCESS_TOKEN."
      );
      return;
    }

    if (gpsMapRef.current) return;

    mapboxgl.accessToken = token;

    const longitude = vehiculeGpsActif?.longitude ?? -70.67;
    const latitude = vehiculeGpsActif?.latitude ?? 46.12;

    const map = new mapboxgl.Map({
      container: gpsMapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [longitude, latitude],
      zoom:
        vehiculeGpsActif?.latitude != null &&
        vehiculeGpsActif?.longitude != null
          ? 14
          : 9,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("contextmenu", (event) => {
      event.preventDefault();
      definirDestinationGps(
        event.lngLat.lng,
        event.lngLat.lat
      );
    });

    gpsMapRef.current = map;

    return () => {
      gpsMarkerRef.current?.remove();
      gpsMarkerRef.current = null;
      gpsDestinationMarkerRef.current?.remove();
      gpsDestinationMarkerRef.current = null;
      map.remove();
      if (gpsMapRef.current === map) gpsMapRef.current = null;
    };
  }, [modalGpsOuvert]);

  useEffect(() => {
    const map = gpsMapRef.current;
    const live = vehiculeGpsActif;

    if (
      !map ||
      !live?.found ||
      live.latitude == null ||
      live.longitude == null
    ) {
      return;
    }

    const lngLat: [number, number] = [
      live.longitude,
      live.latitude,
    ];

    if (!gpsMarkerRef.current) {
      const el = document.createElement("div");
      el.style.width = "46px";
      el.style.height = "46px";
      el.style.borderRadius = "50%";
      el.style.background = "#ffffff";
      el.style.border = "3px solid #16a34a";
      el.style.display = "grid";
      el.style.placeItems = "center";
      el.style.fontSize = "25px";
      el.style.boxShadow = "0 4px 14px rgba(0,0,0,.22)";
      el.textContent = "🚌";

      gpsMarkerRef.current = new mapboxgl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      gpsMarkerRef.current.setLngLat(lngLat);
    }

    if (suiviGps) {
      map.easeTo({
        center: lngLat,
        duration: 650,
      });
    }
  }, [
    vehiculeGpsActif?.latitude,
    vehiculeGpsActif?.longitude,
    vehiculeGpsActif?.headingDegrees,
    suiviGps,
  ]);

  useEffect(() => {
    if (!modalGpsOuvert || !destinationGps) return;

    const recalculerDepuisPositionActuelle = () => {
      const destination = destinationGpsRef.current;
      const live = vehiculeGpsActifRef.current;

      if (
        !destination ||
        live?.latitude == null ||
        live?.longitude == null
      ) {
        return;
      }

      void calculerEtaGps(destination, live);
    };

    // Recalcule avec LA position la plus récente au moment du calcul.
    recalculerDepuisPositionActuelle();

    const timer = window.setInterval(
      recalculerDepuisPositionActuelle,
      15000
    );

    return () => window.clearInterval(timer);
  }, [
    modalGpsOuvert,
    destinationGps?.longitude,
    destinationGps?.latitude,
  ]);

  /*
   * TRI
   */

  function changerTri(
    colonne: ColonneTriCircuit
  ) {
    if (tri === colonne) {
      setDirection((prev) =>
        prev === "asc"
          ? "desc"
          : "asc"
      );
    } else {
      setTri(colonne);
      setDirection("asc");
    }
  }

  function indicateurTri(
    colonne: ColonneTriCircuit
  ) {
    if (tri !== colonne) return "";

    return direction === "asc"
      ? " ↑"
      : " ↓";
  }

  const circuitsFiltres = useMemo(() => {
    const q = recherche
      .trim()
      .toLowerCase();

    const resultat = circuits.filter(
      (item) => {
        const okCompagnie =
          compagnie === "Toutes" ||
          item.compagnie === compagnie;

        const okRecherche =
          !q ||
          item.circuit
            .toLowerCase()
            .includes(q) ||
          item.unite
            .toLowerCase()
            .includes(q) ||
          item.nomConducteur
            .toLowerCase()
            .includes(q) ||
          item.telephone
            .toLowerCase()
            .includes(q) ||
          item.localisation
            .toLowerCase()
            .includes(q) ||
          item.compagnie
            .toLowerCase()
            .includes(q);

        return (
          okCompagnie &&
          okRecherche
        );
      }
    );

    resultat.sort((a, b) => {
      const valeurA =
        a[tri].toLowerCase();

      const valeurB =
        b[tri].toLowerCase();

      const comparaison =
        valeurA.localeCompare(
          valeurB,
          "fr",
          {
            numeric: true,
            sensitivity: "base",
          }
        );

      return direction === "asc"
        ? comparaison
        : -comparaison;
    });

    return resultat;
  }, [
    circuits,
    recherche,
    compagnie,
    tri,
    direction,
  ]);

  const remplacantsFiltres =
    useMemo(() => {
      if (compagnie === "Toutes") {
        return remplacants;
      }

      return remplacants.filter(
        (item) =>
          item.compagnie === compagnie
      );
    }, [remplacants, compagnie]);

  /*
   * CIRCUIT - MODAL
   */

  function ouvrirAjoutCircuit() {
    setCircuitActifId(null);

    setCircuitForm({
      ...circuitVide,

      compagnie:
        compagnie === "Toutes"
          ? "Autobus Breton"
          : compagnie,

      documents: [],
    });

    setFichiersEnAttente([]);
    setOngletCircuit("infos");
    setSamsaraJours([]);
    setSamsaraAttentes([]);
    setSamsaraConfig(null);
    setSeuilAttenteMinutes(25);
    setModalCircuitOuvert(true);
  }

  function ouvrirModificationCircuit(
    circuit: CircuitScolaire
  ) {
    setCircuitActifId(circuit.id);

    setCircuitForm({
      circuit: circuit.circuit,
      unite: circuit.unite,

      nomConducteur:
        circuit.nomConducteur,

      telephone:
        circuit.telephone,

      localisation:
        circuit.localisation,

      compagnie:
        circuit.compagnie,

      documents:
        circuit.documents || [],
    });

    setFichiersEnAttente([]);
    setOngletCircuit("infos");
    setSamsaraSemaine(mondayIso(0));
    setModalCircuitOuvert(true);
    void chargerAnalyseSamsara(circuit.id, mondayIso(0));
    void chargerAttentesSamsara(circuit.id);
  }

  function fermerModalCircuit() {
    if (operationEnCours) return;

    setModalCircuitOuvert(false);
    setCircuitActifId(null);

    setCircuitForm({
      ...circuitVide,
      documents: [],
    });

    setFichiersEnAttente([]);
    setDragActif(false);
    setOngletCircuit("infos");
    setSamsaraJours([]);
    setSamsaraAttentes([]);
    setSamsaraConfig(null);
  }

  async function chargerAnalyseSamsara(
    circuitId: string,
    semaine = samsaraSemaine
  ) {
    try {
      setSamsaraChargement(true);

      const fin = fridayFromMonday(semaine);

      const [{ data: configData, error: configError }, { data: joursData, error: joursError }] =
        await Promise.all([
          circuitSupabase
            .from("circuit_samsara_config")
            .select("*")
            .eq("circuit_id", circuitId)
            .maybeSingle(),
          circuitSupabase
            .from("circuit_samsara_jours")
            .select("*")
            .eq("circuit_id", circuitId)
            .gte("date", semaine)
            .lte("date", fin)
            .order("date", { ascending: true }),
        ]);

      if (configError) throw configError;
      if (joursError) throw joursError;

      setSamsaraConfig(
        configData
          ? {
              circuitId: configData.circuit_id,
              samsaraVehicleId: configData.samsara_vehicle_id ?? null,
              samsaraVehicleName: configData.samsara_vehicle_name ?? null,
              depotLat: configData.depot_lat == null ? null : Number(configData.depot_lat),
              depotLng: configData.depot_lng == null ? null : Number(configData.depot_lng),
              depotRadiusM: Number(configData.depot_radius_m ?? 150),
              toleranceMinutes: Number(configData.tolerance_minutes ?? 15),
            }
          : null
      );
      setSeuilAttenteMinutes(
        Math.max(0, Math.min(180, Number(configData?.attente_seuil_minutes ?? 25)))
      );

      setSamsaraJours(
        (joursData || []).map((row: any) => ({
          id: row.id,
          circuitId: row.circuit_id,
          date: row.date,
          samsaraVehicleId: row.samsara_vehicle_id || "",
          samsaraVehicleName: row.samsara_vehicle_name || "",
          departAm: row.depart_am,
          retourAm: row.retour_am,
          kmAm: Number(row.km_am ?? 0),
          departPm: row.depart_pm,
          retourPm: row.retour_pm,
          kmPm: Number(row.km_pm ?? 0),
          kmRegulier: Number(row.km_regulier ?? 0),
          kmHorsRegulier: Number(row.km_hors_regulier ?? 0),
          statut: row.statut || "—",
          statutManuel:
            row.statut_manuel === "regulier" || row.statut_manuel === "hors_regulier"
              ? row.statut_manuel
              : null,
          details:
            row.details && typeof row.details === "object"
              ? row.details
              : {},
          exclue: !!row.exclue,
        }))
      );
    } catch (error: any) {
      console.error("Erreur chargement analyse Samsara", error);
      alert(error?.message || "Impossible de charger l’analyse Samsara.");
    } finally {
      setSamsaraChargement(false);
    }
  }


  async function chargerAttentesSamsara(circuitId: string) {
    try {
      setAttentesChargement(true);
      const { data, error } = await circuitSupabase
        .from("circuit_samsara_attentes")
        .select("*")
        .eq("circuit_id", circuitId)
        .order("date", { ascending: false })
        .order("arrivee", { ascending: false })
        .limit(300);

      if (error) throw error;

      setSamsaraAttentes(
        (data || []).map((row: any) => ({
          id: row.id,
          circuitId: row.circuit_id,
          date: row.date,
          periode: row.periode === "PM" ? "PM" : "AM",
          arrivee: row.arrivee,
          depart: row.depart,
          dureeMinutes: Number(row.duree_minutes ?? 0),
          latitude: Number(row.latitude ?? 0),
          longitude: Number(row.longitude ?? 0),
          samsaraAddressId: row.samsara_address_id ?? null,
          nomLieu: row.nom_lieu ?? null,
          adresse: row.adresse ?? null,
          groupKey: row.group_key ?? null,
          recurrent: !!row.recurrent,
          occurrenceCount: Number(row.occurrence_count ?? 1),
          regularDaysCount: Number(row.regular_days_count ?? 0),
          recurrenceRatio: Number(row.recurrence_ratio ?? 0),
          averageDurationMinutes: row.average_duration_minutes == null ? null : Number(row.average_duration_minutes),
          maxDurationMinutes: row.max_duration_minutes == null ? null : Number(row.max_duration_minutes),
        }))
      );
    } catch (error: any) {
      console.error("Erreur chargement temps d'attente Samsara", error);
      alert(error?.message || "Impossible de charger les temps d’attente.");
    } finally {
      setAttentesChargement(false);
    }
  }

  async function synchroniserSamsara(circuitId?: string) {
    try {
      setSamsaraSync(true);
      const startDate = circuitId ? samsaraSemaine : mondayIso(0);
      const endDate = fridayFromMonday(startDate);

      const { data, error } = await circuitSupabase.functions.invoke(
        "circuit-samsara-analyse",
        {
          body: {
            circuit_id: circuitId || null,
            start_date: startDate,
            end_date: endDate,
            tolerance_minutes: 15,
            wait_threshold_minutes: circuitId ? seuilAttenteMinutes : null,
          },
        }
      );

      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error || "Synchronisation Samsara impossible.");

      if (circuitId) {
        await chargerAnalyseSamsara(circuitId, startDate);
        await chargerAttentesSamsara(circuitId);
      } else {
        alert(`Synchronisation Samsara terminée : ${data?.circuits_updated ?? 0} circuit(s).`);
      }
    } catch (error: any) {
      console.error("Erreur synchronisation Samsara", error);
      alert(error?.message || "Synchronisation Samsara impossible.");
    } finally {
      setSamsaraSync(false);
    }
  }

  async function basculerExclusionSamsara(jour: CircuitSamsaraJour) {
    const { error } = await circuitSupabase
      .from("circuit_samsara_jours")
      .update({ exclue: !jour.exclue, updated_at: new Date().toISOString() })
      .eq("id", jour.id);

    if (error) {
      alert(error.message);
      return;
    }

    setSamsaraJours((prev) =>
      prev.map((item) =>
        item.id === jour.id ? { ...item, exclue: !item.exclue } : item
      )
    );
  }

  async function changerStatutSamsara(
    jour: CircuitSamsaraJour,
    valeur: "auto" | "regulier" | "hors_regulier"
  ) {
    const totalKm = Math.max(0, jour.kmAm) + Math.max(0, jour.kmPm);
    const details = jour.details || {};

    let statutManuel: "regulier" | "hors_regulier" | null = null;
    let statut = String(details.auto_statut ?? jour.statut ?? "—");
    let kmRegulier = Number(details.auto_km_regulier ?? jour.kmRegulier ?? 0);
    let kmHorsRegulier = Number(details.auto_km_hors_regulier ?? jour.kmHorsRegulier ?? 0);

    if (valeur === "regulier") {
      statutManuel = "regulier";
      statut = "Régulier";
      kmRegulier = totalKm;
      kmHorsRegulier = 0;
    } else if (valeur === "hors_regulier") {
      statutManuel = "hors_regulier";
      statut = "Hors régulier";
      kmRegulier = 0;
      kmHorsRegulier = totalKm;
    }

    const { error } = await circuitSupabase
      .from("circuit_samsara_jours")
      .update({
        statut_manuel: statutManuel,
        statut,
        km_regulier: Number(kmRegulier.toFixed(2)),
        km_hors_regulier: Number(kmHorsRegulier.toFixed(2)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jour.id);

    if (error) {
      alert(error.message);
      return;
    }

    setSamsaraJours((prev) =>
      prev.map((item) =>
        item.id === jour.id
          ? {
              ...item,
              statutManuel,
              statut,
              kmRegulier: Number(kmRegulier.toFixed(2)),
              kmHorsRegulier: Number(kmHorsRegulier.toFixed(2)),
            }
          : item
      )
    );
  }

  const samsaraJoursVisibles = samsaraJours.filter(
    (jour) => afficherExclues || !jour.exclue
  );

  const samsaraJoursInclus = samsaraJours.filter((jour) => !jour.exclue);
  const samsaraJoursAvecDonnees = samsaraJoursInclus.filter(jourSamsaraAvecDonnees);

  // IMPORTANT :
  // Les moyennes utilisent seulement les journées COMPLÈTES (AM + PM).
  // Une journée en cours ou partielle reste visible dans le tableau,
  // mais elle ne compte pas encore dans KM moyen / jour ni Heures moy. / jour.
  const samsaraJoursComplets = samsaraJoursInclus.filter(
    jourSamsaraCompletPourMoyenne
  );

  const heuresPayablesIncluses = samsaraJoursComplets
    .map((jour) => calculHeuresJour(jour).heuresAPayer)
    .filter((v): v is number => v != null);

  const samsaraResume = {
    kmMoyen:
      samsaraJoursComplets.length > 0
        ? samsaraJoursComplets.reduce((sum, row) => sum + row.kmRegulier, 0) /
          samsaraJoursComplets.length
        : 0,
    kmTotal: samsaraJoursComplets.reduce((sum, row) => sum + row.kmRegulier, 0),
    horsTotal: samsaraJoursAvecDonnees.reduce((sum, row) => sum + row.kmHorsRegulier, 0),
    heuresMoyennes:
      heuresPayablesIncluses.length > 0
        ? heuresPayablesIncluses.reduce((sum, value) => sum + value, 0) /
          heuresPayablesIncluses.length
        : 0,
    heuresTotal: heuresPayablesIncluses.reduce((sum, value) => sum + value, 0),
  };


  const attentesGroupes = useMemo(() => {
    return [...samsaraAttentes]
      .filter((attente) => attente.dureeMinutes > seuilAttenteMinutes)
      .filter((attente) => {
        if (filtreAttentes === "recurrent") return attente.recurrent;
        if (filtreAttentes === "occasionnel") return !attente.recurrent;
        return true;
      })
      .sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return Date.parse(b.arrivee) - Date.parse(a.arrivee);
      });
  }, [samsaraAttentes, filtreAttentes, seuilAttenteMinutes]);

  /*
   * CIRCUIT - ENREGISTRER
   */

  async function enregistrerCircuit() {
    const numero =
      circuitForm.circuit.trim();

    if (!numero) {
      alert(
        "Le numéro de circuit est obligatoire."
      );

      return;
    }

    try {
      setOperationEnCours(true);

      let circuitId =
        circuitActifId;

      if (circuitActifId) {
        const { error } =
          await circuitSupabase
            .from(
              "circuits_scolaires"
            )
            .update({
              circuit: numero,

              unite:
                circuitForm.unite.trim(),

              nom_conducteur:
                circuitForm.nomConducteur.trim(),

              telephone:
                circuitForm.telephone.trim(),

              localisation:
                circuitForm.localisation.trim(),

              compagnie:
                circuitForm.compagnie,

              updated_at:
                new Date().toISOString(),
            })
            .eq(
              "id",
              circuitActifId
            );

        if (error) {
          throw error;
        }
      } else {
        const {
          data,
          error,
        } =
          await circuitSupabase
            .from(
              "circuits_scolaires"
            )
            .insert({
              circuit: numero,

              unite:
                circuitForm.unite.trim(),

              nom_conducteur:
                circuitForm.nomConducteur.trim(),

              telephone:
                circuitForm.telephone.trim(),

              localisation:
                circuitForm.localisation.trim(),

              compagnie:
                circuitForm.compagnie,
            })
            .select("id")
            .single();

        if (error) {
          throw error;
        }

        circuitId = data.id;
      }

      if (!circuitId) {
        throw new Error(
          "ID du circuit manquant."
        );
      }

      if (
        fichiersEnAttente.length > 0
      ) {
        await uploaderFichiersCircuit(
          circuitId,
          numero,
          fichiersEnAttente
        );
      }

      await chargerCircuits();

      fermerModalCircuit();
    } catch (error) {
      console.error(
        "Erreur sauvegarde circuit",
        error
      );

      alert(
        "Erreur pendant l’enregistrement du circuit."
      );
    } finally {
      setOperationEnCours(false);
    }
  }

  /*
   * CIRCUIT - SUPPRIMER
   */

  async function supprimerCircuit() {
    if (!circuitActifId) return;

    const ok = confirm(
      "Supprimer ce circuit et tous ses documents?"
    );

    if (!ok) return;

    try {
      setOperationEnCours(true);

      const paths =
        circuitForm.documents
          .map(
            (doc) =>
              doc.storagePath
          )
          .filter(Boolean);

      if (paths.length > 0) {
        const { error } =
          await circuitSupabase.storage
            .from(
              BUCKET_DOCUMENTS
            )
            .remove(paths);

        if (error) {
          throw error;
        }
      }

      const { error } =
        await circuitSupabase
          .from(
            "circuits_scolaires"
          )
          .delete()
          .eq(
            "id",
            circuitActifId
          );

      if (error) {
        throw error;
      }

      await chargerCircuits();

      setModalCircuitOuvert(false);
      setCircuitActifId(null);

      setCircuitForm({
        ...circuitVide,
        documents: [],
      });
    } catch (error) {
      console.error(
        "Erreur suppression circuit",
        error
      );

      alert(
        "Erreur pendant la suppression du circuit."
      );
    } finally {
      setOperationEnCours(false);
    }
  }

  /*
   * DOCUMENTS
   */

  function ajouterFichiersEnAttente(
    files: FileList | File[]
  ) {
    const liste =
      Array.from(files);

    if (liste.length === 0) {
      return;
    }

    setFichiersEnAttente(
      (prev) => [
        ...prev,
        ...liste,
      ]
    );
  }

  function retirerFichierEnAttente(
    index: number
  ) {
    setFichiersEnAttente(
      (prev) =>
        prev.filter(
          (_, i) => i !== index
        )
    );
  }

  function ouvrirFichierLocal(
    file: File
  ) {
    const url =
      URL.createObjectURL(file);

    window.open(
      url,
      "_blank",
      "noopener,noreferrer"
    );

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);
  }

  async function uploaderFichiersCircuit(
    circuitId: string,
    numeroCircuit: string,
    files: File[]
  ) {
    for (const file of files) {
      const dossier =
        dossierCompagnie(
          circuitForm.compagnie
        );

      const nomNettoye =
        nettoyerNomFichier(
          file.name
        );

      const storagePath =
        `circuits-scolaires/${dossier}/` +
        `${numeroCircuit}/` +
        `${Date.now()}_${crypto.randomUUID()}_${nomNettoye}`;

      const { error: uploadError } =
        await circuitSupabase.storage
          .from(
            BUCKET_DOCUMENTS
          )
          .upload(
            storagePath,
            file,
            {
              contentType:
                file.type ||
                "application/octet-stream",

              upsert: false,
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      const { data: urlData } =
        circuitSupabase.storage
          .from(
            BUCKET_DOCUMENTS
          )
          .getPublicUrl(
            storagePath
          );

      const { error: insertError } =
        await circuitSupabase
          .from(
            "circuits_scolaires_documents"
          )
          .insert({
            circuit_id:
              circuitId,

            nom:
              file.name,

            storage_path:
              storagePath,

            public_url:
              urlData.publicUrl,

            mime_type:
              file.type ||
              "application/octet-stream",

            taille:
              file.size,
          });

      if (insertError) {
        /*
         * Si l'enregistrement DB échoue,
         * on enlève le fichier du bucket
         * pour éviter un fichier orphelin.
         */
        await circuitSupabase.storage
          .from(
            BUCKET_DOCUMENTS
          )
          .remove([
            storagePath,
          ]);

        throw insertError;
      }
    }
  }

  async function supprimerDocument(
    document: CircuitDocument
  ) {
    const ok = confirm(
      `Supprimer "${document.nom}"?`
    );

    if (!ok) return;

    try {
      setOperationEnCours(true);

      const { error: storageError } =
        await circuitSupabase.storage
          .from(
            BUCKET_DOCUMENTS
          )
          .remove([
            document.storagePath,
          ]);

      if (storageError) {
        throw storageError;
      }

      const { error: dbError } =
        await circuitSupabase
          .from(
            "circuits_scolaires_documents"
          )
          .delete()
          .eq(
            "id",
            document.id
          );

      if (dbError) {
        throw dbError;
      }

      setCircuitForm(
        (prev) => ({
          ...prev,

          documents:
            prev.documents.filter(
              (doc) =>
                doc.id !==
                document.id
            ),
        })
      );

      await chargerCircuits();
    } catch (error) {
      console.error(
        "Erreur suppression document",
        error
      );

      alert(
        "Erreur pendant la suppression du fichier."
      );
    } finally {
      setOperationEnCours(false);
    }
  }

  function ouvrirDocument(
    document: CircuitDocument
  ) {
    window.open(
      document.publicUrl,
      "_blank",
      "noopener,noreferrer"
    );
  }

  /*
   * CONTACTS
   */

  function ouvrirAjoutContact() {
    setContactActifId(null);

    setContactForm({
      ...contactVide,
    });

    setModalContactOuvert(true);
  }

  function ouvrirModificationContact(
    contact: ContactUrgence
  ) {
    setContactActifId(
      contact.id
    );

    setContactForm({
      organisation:
        contact.organisation,

      organisationAutre:
        contact.organisationAutre ||
        "",

      nom:
        contact.nom,

      fonction:
        contact.fonction,

      telephone:
        contact.telephone,

      telephone2:
        contact.telephone2,

      notes:
        contact.notes,
    });

    setModalContactOuvert(true);
  }

  function fermerModalContact() {
    setModalContactOuvert(false);

    setContactActifId(null);

    setContactForm({
      ...contactVide,
    });
  }

  async function enregistrerContact() {
    const nom =
      contactForm.nom.trim();

    if (!nom) {
      alert(
        "Le nom du contact est obligatoire."
      );

      return;
    }

    if (
      contactForm.organisation ===
        "Autre" &&
      !contactForm.organisationAutre.trim()
    ) {
      alert(
        "Inscris le nom de l’organisation."
      );

      return;
    }

    const payload = {
      organisation:
        contactForm.organisation,

      organisation_autre:
        contactForm.organisation ===
        "Autre"
          ? contactForm.organisationAutre.trim()
          : null,

      nom,

      fonction:
        contactForm.fonction.trim(),

      telephone:
        contactForm.telephone.trim(),

      telephone2:
        contactForm.telephone2.trim(),

      notes:
        contactForm.notes.trim(),

      updated_at:
        new Date().toISOString(),
    };

    try {
      if (contactActifId) {
        const { error } =
          await circuitSupabase
            .from(
              "circuits_contacts_urgence"
            )
            .update(payload)
            .eq(
              "id",
              contactActifId
            );

        if (error) {
          throw error;
        }
      } else {
        const { error } =
          await circuitSupabase
            .from(
              "circuits_contacts_urgence"
            )
            .insert(payload);

        if (error) {
          throw error;
        }
      }

      await chargerContacts();

      fermerModalContact();
    } catch (error) {
      console.error(
        "Erreur contact urgence",
        error
      );

      alert(
        "Erreur pendant l’enregistrement du contact."
      );
    }
  }

  async function supprimerContact() {
    if (!contactActifId) return;

    if (
      !confirm(
        "Supprimer ce contact d’urgence?"
      )
    ) {
      return;
    }

    try {
      const { error } =
        await circuitSupabase
          .from(
            "circuits_contacts_urgence"
          )
          .delete()
          .eq(
            "id",
            contactActifId
          );

      if (error) {
        throw error;
      }

      await chargerContacts();

      fermerModalContact();
    } catch (error) {
      console.error(
        "Erreur suppression contact",
        error
      );

      alert(
        "Erreur pendant la suppression du contact."
      );
    }
  }

  /*
   * REMPLAÇANTS
   */

  function ouvrirAjoutRemplacant() {
    setRemplacantActifId(null);

    setRemplacantForm({
      ...remplacantVide,

      compagnie:
        compagnie === "Toutes"
          ? "Autobus Breton"
          : compagnie,
    });

    setModalRemplacantOuvert(true);
  }

  function ouvrirModificationRemplacant(
    remplacant: ConducteurRemplacant
  ) {
    setRemplacantActifId(
      remplacant.id
    );

    setRemplacantForm({
      nom:
        remplacant.nom,

      telephone:
        remplacant.telephone,

      compagnie:
        remplacant.compagnie,
    });

    setModalRemplacantOuvert(true);
  }

  function fermerModalRemplacant() {
    setModalRemplacantOuvert(false);

    setRemplacantActifId(null);

    setRemplacantForm({
      ...remplacantVide,
    });
  }

  async function enregistrerRemplacant() {
    const nom =
      remplacantForm.nom.trim();

    if (!nom) {
      alert(
        "Le nom du conducteur est obligatoire."
      );

      return;
    }

    const payload = {
      nom,

      telephone:
        remplacantForm.telephone.trim(),

      compagnie:
        remplacantForm.compagnie,

      updated_at:
        new Date().toISOString(),
    };

    try {
      if (remplacantActifId) {
        const { error } =
          await circuitSupabase
            .from(
              "circuits_remplacants"
            )
            .update(payload)
            .eq(
              "id",
              remplacantActifId
            );

        if (error) {
          throw error;
        }
      } else {
        const { error } =
          await circuitSupabase
            .from(
              "circuits_remplacants"
            )
            .insert(payload);

        if (error) {
          throw error;
        }
      }

      await chargerRemplacants();

      fermerModalRemplacant();
    } catch (error) {
      console.error(
        "Erreur remplaçant",
        error
      );

      alert(
        "Erreur pendant l’enregistrement du conducteur."
      );
    }
  }

  async function supprimerRemplacant() {
    if (!remplacantActifId) return;

    if (
      !confirm(
        "Supprimer ce conducteur remplaçant?"
      )
    ) {
      return;
    }

    try {
      const { error } =
        await circuitSupabase
          .from(
            "circuits_remplacants"
          )
          .delete()
          .eq(
            "id",
            remplacantActifId
          );

      if (error) {
        throw error;
      }

      await chargerRemplacants();

      fermerModalRemplacant();
    } catch (error) {
      console.error(
        "Erreur suppression remplaçant",
        error
      );

      alert(
        "Erreur pendant la suppression du conducteur."
      );
    }
  }

  /*
   * EXPORT PDF
   */

  function exporterCircuitsPdf() {
    if (circuitsFiltres.length === 0) {
      alert("Aucun circuit à exporter.");
      return;
    }

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "letter",
    });

    const titre =
      compagnie === "Toutes"
        ? "Circuits scolaire - Toutes les compagnies"
        : `Circuits scolaire - ${compagnie}`;

    const dateExport = new Date().toLocaleDateString("fr-CA");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(titre, 12, 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Exporté le ${dateExport}`, 12, 20);

    let startY = 25;

    if (recherche.trim()) {
      doc.text(`Recherche : ${recherche.trim()}`, 12, 25);
      startY = 30;
    }

    const lignes = circuitsFiltres.map((item) => [
      item.circuit,
      item.unite || "",
      item.nomConducteur || "",
      item.telephone || "",
      item.localisation || "",
      item.compagnie,
    ]);

    autoTable(doc, {
      startY,
      head: [
        [
          "Circuit",
          "Unité",
          "Nom conducteur",
          "Téléphone",
          "Localisation",
          "Compagnie",
        ],
      ],
      body: lignes,
      theme: "grid",
      margin: {
        top: 15,
        right: 10,
        bottom: 15,
        left: 10,
      },
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 2.5,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fontStyle: "bold",
        halign: "left",
      },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 20 },
        2: { cellWidth: 52 },
        3: { cellWidth: 37 },
        4: { cellWidth: 52 },
        5: { cellWidth: 55 },
      },
      didDrawPage: () => {
        const largeur = doc.internal.pageSize.getWidth();
        const hauteur = doc.internal.pageSize.getHeight();
        const page = doc.getNumberOfPages();

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(`Page ${page}`, largeur - 12, hauteur - 7, {
          align: "right",
        });
      },
    });

    const nomFichier =
      compagnie === "Toutes"
        ? "circuits-scolaires"
        : `circuits-${compagnie
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")}`;

    doc.save(`${nomFichier}.pdf`);
  }

  /*
   * AFFICHAGE
   */

  if (chargement) {
    return (
      <div className="page">
        <div className="card">
          Chargement des circuits scolaires…
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Circuits scolaire</h1>

          <div className="muted">
            Répertoire des circuits scolaires,
            contacts d’urgence et conducteurs
            remplaçants.
          </div>
        </div>

      </div>

      {/* FILTRES */}

      <div
        className="card"
        style={{
          marginBottom: 14,
        }}
      >
        <div className="form-grid">
          <div className="field">
            <div className="label">
              Recherche
            </div>

            <input
              className="input"
              value={recherche}
              onChange={(e) =>
                setRecherche(
                  e.target.value
                )
              }
              placeholder="Circuit, unité, conducteur, téléphone ou localisation..."
            />
          </div>

          <div className="field">
            <div className="label">
              Compagnie
            </div>

            <select
              className="input"
              value={compagnie}
              onChange={(e) =>
                setCompagnie(
                  e.target.value as
                    | Compagnie
                    | "Toutes"
                )
              }
            >
              <option value="Toutes">
                Toutes les compagnies
              </option>

              <option value="Autobus Breton">
                Autobus Breton
              </option>

              <option value="Autobus Champagne">
                Autobus Champagne
              </option>

              <option value="Transport Sécuritaire">
                Transport Sécuritaire
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* CONTACTS URGENCE */}

      <div
        className="card"
        style={{
          marginBottom: 14,
        }}
      >
        <div className="card-head">
          <div>
            <div className="card-title">
              Contacts d’urgence
            </div>

            <div className="card-subtitle">
              Contacts importants par organisation.
            </div>
          </div>

          <button
            className="btn-primary"
            type="button"
            onClick={
              ouvrirAjoutContact
            }
          >
            + Ajouter un contact
          </button>
        </div>

        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>
                  Organisation
                </th>

                <th>Nom</th>
                <th>Fonction</th>
                <th>Téléphone</th>
                <th>Téléphone 2</th>
              </tr>
            </thead>

            <tbody>
              {contacts.map(
                (contact) => (
                  <tr
                    className="row"
                    key={contact.id}
                    onDoubleClick={() =>
                      ouvrirModificationContact(
                        contact
                      )
                    }
                    title="Double-clic pour modifier"
                  >
                    <td>
                      {nomOrganisation(
                        contact
                      )}
                    </td>

                    <td>
                      <strong>
                        {contact.nom}
                      </strong>
                    </td>

                    <td>
                      {contact.fonction ||
                        "—"}
                    </td>

                    <td>
                      {contact.telephone ? (
                        <a
                          href={telHref(
                            contact.telephone
                          )}
                          onDoubleClick={(
                            e
                          ) =>
                            e.stopPropagation()
                          }
                        >
                          {
                            contact.telephone
                          }
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td>
                      {contact.telephone2 ? (
                        <a
                          href={telHref(
                            contact.telephone2
                          )}
                          onDoubleClick={(
                            e
                          ) =>
                            e.stopPropagation()
                          }
                        >
                          {
                            contact.telephone2
                          }
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                )
              )}

              {contacts.length ===
                0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="muted"
                  >
                    Aucun contact d’urgence.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CIRCUITS */}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              Circuits
            </div>

            <div className="card-subtitle">
              Double-clic sur un circuit pour ouvrir sa fiche.
            </div>
          </div>

          <div className="page-actions">
            <button
              className="btn"
              type="button"
              onClick={() => void synchroniserSamsara()}
              disabled={samsaraSync}
              title="Analyse tous les véhicules pour la semaine courante"
            >
              {samsaraSync ? "Samsara…" : "Actualiser Samsara"}
            </button>

            <button
              className="btn"
              type="button"
              onClick={exporterCircuitsPdf}
              disabled={circuitsFiltres.length === 0}
            >
              Exporter PDF
            </button>

            <button
              className="btn-primary"
              type="button"
              onClick={ouvrirAjoutCircuit}
            >
              + Ajouter un circuit
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri(
                      "circuit"
                    )
                  }
                >
                  Circuit
                  {indicateurTri(
                    "circuit"
                  )}
                </th>

                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri(
                      "unite"
                    )
                  }
                >
                  Unité
                  {indicateurTri(
                    "unite"
                  )}
                </th>

                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri(
                      "nomConducteur"
                    )
                  }
                >
                  Nom conducteur
                  {indicateurTri(
                    "nomConducteur"
                  )}
                </th>

                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri(
                      "telephone"
                    )
                  }
                >
                  Téléphone
                  {indicateurTri(
                    "telephone"
                  )}
                </th>

                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri(
                      "localisation"
                    )
                  }
                >
                  Localisation
                  {indicateurTri(
                    "localisation"
                  )}
                </th>

                <th>GPS</th>

                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri(
                      "compagnie"
                    )
                  }
                >
                  Compagnie
                  {indicateurTri(
                    "compagnie"
                  )}
                </th>

                <th>
                  Documents
                </th>
              </tr>
            </thead>

            <tbody>
              {circuitsFiltres.map(
                (item) => (
                  <tr
                    className="row"
                    key={item.id}
                    onDoubleClick={() =>
                      ouvrirModificationCircuit(
                        item
                      )
                    }
                    title="Double-clic pour modifier"
                  >
                    <td>
                      <strong>
                        {item.circuit}
                      </strong>
                    </td>

                    <td>
                      {item.unite ||
                        "—"}
                    </td>

                    <td>
                      {item.nomConducteur ||
                        "—"}
                    </td>

                    <td>
                      {item.telephone ? (
                        <a
                          href={telHref(
                            item.telephone
                          )}
                          onDoubleClick={(
                            e
                          ) =>
                            e.stopPropagation()
                          }
                        >
                          {
                            item.telephone
                          }
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td>
                      {item.localisation ||
                        "—"}
                    </td>

                    <td>
                      {(() => {
                        const live = samsaraLiveParCircuit[item.id];

                        if (samsaraStatutsChargement && !live) {
                          return (
                            <span className="muted">
                              Vérification…
                            </span>
                          );
                        }

                        if (live?.found) {
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                ouvrirCarteGps(item);
                              }}
                              onDoubleClick={(e) =>
                                e.stopPropagation()
                              }
                              title="Ouvrir la position en temps réel"
                              style={{
                                border: "1px solid #86efac",
                                background: "#f0fdf4",
                                color: "#166534",
                                borderRadius: 999,
                                padding: "6px 10px",
                                fontWeight: 800,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              ● GPS
                            </button>
                          );
                        }

                        return (
                          <span
                            title="Aucun GPS trouvé pour cette unité"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              border: "1px solid #fecaca",
                              background: "#fef2f2",
                              color: "#991b1b",
                              borderRadius: 999,
                              padding: "6px 10px",
                              fontWeight: 800,
                              whiteSpace: "nowrap",
                            }}
                          >
                            ● Aucun GPS
                          </span>
                        );
                      })()}
                    </td>

                    <td>
                      {item.compagnie}
                    </td>

                    <td>
                      {item.documents
                        .length > 0
                        ? `${item.documents.length} document(s)`
                        : "—"}
                    </td>
                  </tr>
                )
              )}

              {circuitsFiltres.length ===
                0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="muted"
                  >
                    Aucun circuit.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* REMPLAÇANTS */}

      <div
        className="card"
        style={{
          marginTop: 14,
        }}
      >
        <div className="card-head">
          <div>
            <div className="card-title">
              Conducteurs remplaçants
            </div>

            <div className="card-subtitle">
              Conducteurs disponibles pour les remplacements.
            </div>
          </div>

          <button
            className="btn-primary"
            type="button"
            onClick={
              ouvrirAjoutRemplacant
            }
          >
            + Ajouter un conducteur
          </button>
        </div>

        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Compagnie</th>
              </tr>
            </thead>

            <tbody>
              {remplacantsFiltres.map(
                (item) => (
                  <tr
                    className="row"
                    key={item.id}
                    onDoubleClick={() =>
                      ouvrirModificationRemplacant(
                        item
                      )
                    }
                    title="Double-clic pour modifier"
                  >
                    <td>
                      <strong>
                        {item.nom}
                      </strong>
                    </td>

                    <td>
                      {item.telephone ? (
                        <a
                          href={telHref(
                            item.telephone
                          )}
                          onDoubleClick={(
                            e
                          ) =>
                            e.stopPropagation()
                          }
                        >
                          {
                            item.telephone
                          }
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td>
                      {item.compagnie}
                    </td>
                  </tr>
                )
              )}

              {remplacantsFiltres.length ===
                0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="muted"
                  >
                    Aucun conducteur remplaçant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CARTE GPS SAMSARA */}

      {modalGpsOuvert && circuitGpsActif && (
        <div
          className="modal-backdrop"
          onMouseDown={fermerCarteGps}
          style={{
            zIndex: 2000,
            position: "fixed",
            inset: 0,
            padding: 14,
            display: "flex",
            alignItems: "stretch",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div
            className="modal-card"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(1500px, 100%)",
              maxWidth: "none",
              height: "100%",
              maxHeight: "100%",
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              className="modal-head"
              style={{ padding: "16px 18px" }}
            >
              <div>
                <div className="modal-title">
                  Circuit {circuitGpsActif.circuit} · Unité{" "}
                  {circuitGpsActif.unite}
                </div>
                <div className="muted">
                  {circuitGpsActif.nomConducteur || "Conducteur non assigné"}
                  {vehiculeGpsActif?.vehicleName
                    ? ` · GPS ${vehiculeGpsActif.vehicleName}`
                    : ""}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn"
                  type="button"
                  onClick={recentrerGps}
                  disabled={
                    vehiculeGpsActif?.latitude == null ||
                    vehiculeGpsActif?.longitude == null
                  }
                >
                  Recentrer
                </button>

                <button
                  className="ghost"
                  type="button"
                  onClick={fermerCarteGps}
                >
                  Fermer
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(250px, 320px) minmax(0, 1fr)",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: 18,
                  borderRight: "1px solid #e5e7eb",
                  background: "#fff",
                  display: "grid",
                  alignContent: "start",
                  gap: 12,
                  overflowY: "auto",
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 900,
                    color: vehiculeGpsActif?.found
                      ? "#166534"
                      : "#991b1b",
                  }}
                >
                  <span>
                    {vehiculeGpsActif?.found ? "●" : "●"}
                  </span>
                  {vehiculeGpsActif?.found
                    ? "GPS actif"
                    : "Aucun GPS"}
                </div>

                {gpsChargement && (
                  <div className="muted">
                    Lecture de la position…
                  </div>
                )}

                {gpsErreur && (
                  <div
                    style={{
                      border: "1px solid #fecaca",
                      background: "#fef2f2",
                      color: "#991b1b",
                      borderRadius: 10,
                      padding: 10,
                      fontSize: 13,
                    }}
                  >
                    {gpsErreur}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div className="muted" style={{ fontSize: 12 }}>
                      Vitesse
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        fontWeight: 900,
                        fontSize: 22,
                      }}
                    >
                      {vehiculeGpsActif?.speedKph != null
                        ? `${Math.round(
                            vehiculeGpsActif.speedKph
                          )} km/h`
                        : "—"}
                    </div>
                  </div>

                                          %
                      </div>
                    </div>
                  )}

                  {vehiculeGpsActif?.batterySocPercent != null && (
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <div
                        className="muted"
                        style={{
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span aria-hidden="true">🔋</span>
                        État de charge
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontWeight: 900,
                          fontSize: 22,
                        }}
                      >
                        {Math.round(
                          vehiculeGpsActif.batterySocPercent
                        )}
                        %
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <div className="label">
                    Dernière position
                  </div>
                  <div style={{ fontWeight: 800, marginTop: 3 }}>
                    {formatHeureLive(
                      vehiculeGpsActif?.updatedAt ?? null
                    )}
                  </div>
                </div>

                {vehiculeGpsActif?.address && (
                  <div>
                    <div className="label">Adresse</div>
                    <div style={{ marginTop: 3 }}>
                      {vehiculeGpsActif.address}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    border: "1px solid #dbeafe",
                    background: "#eff6ff",
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 900 }}>
                    Estimation d’arrivée
                  </div>

                  {!destinationGps ? (
                    <div
                      className="muted"
                      style={{ marginTop: 5, fontSize: 12 }}
                    >
                      Clique avec le bouton droit sur la carte pour choisir
                      une destination et calculer le temps de trajet.
                    </div>
                  ) : etaChargement ? (
                    <div
                      className="muted"
                      style={{ marginTop: 5 }}
                    >
                      Calcul de l’itinéraire…
                    </div>
                  ) : etaGps ? (
                    <div style={{ marginTop: 7 }}>
                      <div
                        style={{
                          fontWeight: 900,
                          fontSize: 22,
                        }}
                      >
                        {formaterDureeTrajet(
                          etaGps.durationSeconds
                        )}{" "}
                        ·{" "}
                        {formaterDistanceTrajet(
                          etaGps.distanceMeters
                        )}
                      </div>

                      <div
                        className="muted"
                        style={{ marginTop: 4 }}
                      >
                        Arrivée estimée :{" "}
                        <strong>
                          {formatHeureLive(
                            etaGps.arrivalAt
                          )}
                        </strong>
                      </div>
                    </div>
                  ) : null}

                  {etaErreur && (
                    <div
                      style={{
                        marginTop: 7,
                        color: "#991b1b",
                        fontSize: 12,
                      }}
                    >
                      {etaErreur}
                    </div>
                  )}

                  {destinationGps && (
                    <button
                      className="btn"
                      type="button"
                      onClick={retirerTrajetGps}
                      style={{ marginTop: 10 }}
                    >
                      Effacer la destination
                    </button>
                  )}
                </div>

                <div className="muted" style={{ fontSize: 12 }}>
                  Position GPS mise à jour toutes les 5 secondes. Le suivi
                  reste actif même si tu zoomes ou déplaces manuellement la
                  carte. L’itinéraire est recalculé toutes les 15 secondes à
                  partir de la position GPS la plus récente de l’autobus.
                </div>

                {!suiviGps && !destinationGps && (
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={recentrerGps}
                  >
                    Reprendre le suivi de l’autobus
                  </button>
                )}
              </div>

              <div
                style={{
                  position: "relative",
                  minHeight: 0,
                  minWidth: 0,
                  height: "100%",
                }}
              >
                <div
                  ref={gpsMapContainerRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    background: "#f3f4f6",
                  }}
                />

                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    top: 12,
                    zIndex: 2,
                    background: "rgba(255,255,255,.94)",
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 800,
                    boxShadow: "0 2px 8px rgba(0,0,0,.08)",
                    pointerEvents: "none",
                  }}
                >
                  Clic droit = calculer l’arrivée à cet endroit
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CIRCUIT */}

      {modalCircuitOuvert && (
        <div
          className="modal-backdrop"
          onMouseDown={
            fermerModalCircuit
          }
        >
          <div
            className="modal-card"
            style={{
              width: "min(1240px, calc(100vw - 32px))",
              maxWidth: "none",
            }}
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {circuitActifId
                    ? `Circuit ${circuitForm.circuit}`
                    : "Ajouter un circuit"}
                </div>

                <div className="muted">
                  Informations et documents du circuit scolaire.
                </div>
              </div>

              <button
                className="ghost"
                type="button"
                disabled={
                  operationEnCours
                }
                onClick={
                  fermerModalCircuit
                }
              >
                Fermer
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                marginBottom: 14,
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <button
                type="button"
                className={ongletCircuit === "infos" ? "btn-primary" : "btn"}
                onClick={() => setOngletCircuit("infos")}
              >
                Informations
              </button>
              <button
                type="button"
                className={ongletCircuit === "samsara" ? "btn-primary" : "btn"}
                onClick={() => {
                  setOngletCircuit("samsara");
                  if (circuitActifId) void chargerAnalyseSamsara(circuitActifId, samsaraSemaine);
                }}
                disabled={!circuitActifId}
                title={!circuitActifId ? "Enregistre d’abord le circuit" : "Analyse des heures et kilomètres réels"}
              >
                Heures/KM
              </button>
              <button
                type="button"
                className={ongletCircuit === "attentes" ? "btn-primary" : "btn"}
                onClick={() => {
                  setOngletCircuit("attentes");
                  if (circuitActifId) void chargerAttentesSamsara(circuitActifId);
                }}
                disabled={!circuitActifId}
                title={!circuitActifId ? "Enregistre d’abord le circuit" : "Temps d’attente quotidiens de 15 minutes et plus"}
              >
                Temps d’attente
              </button>
            </div>

            {ongletCircuit === "infos" ? (
              <>
            <div className="form-grid">
              <div className="field">
                <div className="label">
                  Circuit
                </div>

                <input
                  className="input"
                  value={
                    circuitForm.circuit
                  }
                  onChange={(e) =>
                    setCircuitForm(
                      (prev) => ({
                        ...prev,

                        circuit:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Unité
                </div>

                <input
                  className="input"
                  value={
                    circuitForm.unite
                  }
                  onChange={(e) =>
                    setCircuitForm(
                      (prev) => ({
                        ...prev,

                        unite:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Compagnie
                </div>

                <select
                  className="input"
                  value={
                    circuitForm.compagnie
                  }
                  onChange={(e) =>
                    setCircuitForm(
                      (prev) => ({
                        ...prev,

                        compagnie:
                          e.target
                            .value as Compagnie,
                      })
                    )
                  }
                >
                  <option value="Autobus Breton">
                    Autobus Breton
                  </option>

                  <option value="Autobus Champagne">
                    Autobus Champagne
                  </option>

                  <option value="Transport Sécuritaire">
                    Transport Sécuritaire
                  </option>
                </select>
              </div>

              <div className="field">
                <div className="label">
                  Nom conducteur
                </div>

                <input
                  className="input"
                  value={
                    circuitForm.nomConducteur
                  }
                  onChange={(e) =>
                    setCircuitForm(
                      (prev) => ({
                        ...prev,

                        nomConducteur:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Téléphone
                </div>

                <input
                  className="input"
                  value={
                    circuitForm.telephone
                  }
                  onChange={(e) =>
                    setCircuitForm(
                      (prev) => ({
                        ...prev,

                        telephone:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Localisation
                </div>

                <input
                  className="input"
                  value={
                    circuitForm.localisation
                  }
                  onChange={(e) =>
                    setCircuitForm(
                      (prev) => ({
                        ...prev,

                        localisation:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>
            </div>

            {/* DOCUMENTS */}

            <div
              className="field"
              style={{
                marginTop: 16,
              }}
            >
              <div className="label">
                Documents du circuit
              </div>

              <input
                ref={
                  inputFichierRef
                }
                type="file"
                multiple
                accept={
                  fichiersAcceptes
                }
                style={{
                  display: "none",
                }}
                onChange={(e) => {
                  if (
                    e.target.files
                  ) {
                    ajouterFichiersEnAttente(
                      e.target.files
                    );
                  }

                  e.currentTarget.value =
                    "";
                }}
              />

              <div
                className={
                  "pdf-dropzone" +
                  (dragActif
                    ? " is-dragging"
                    : "")
                }
                onClick={() =>
                  inputFichierRef.current?.click()
                }
                onDoubleClick={() =>
                  inputFichierRef.current?.click()
                }
                onDragOver={(e) => {
                  e.preventDefault();

                  setDragActif(true);
                }}
                onDragLeave={() =>
                  setDragActif(false)
                }
                onDrop={(e) => {
                  e.preventDefault();

                  setDragActif(false);

                  ajouterFichiersEnAttente(
                    e.dataTransfer.files
                  );
                }}
              >
                <div className="pdf-dropzone-title">
                  Glisser les fichiers ici
                </div>

                <div className="muted">
                  PDF, images ou fichiers texte. Clic ou double-clic pour sélectionner.
                </div>
              </div>

              {/* DOCUMENTS DÉJÀ ENREGISTRÉS */}

              {circuitForm.documents
                .length > 0 && (
                <div className="documents-list">
                  {circuitForm.documents.map(
                    (doc) => (
                      <div
                        className="document-row"
                        key={doc.id}
                        onDoubleClick={() =>
                          ouvrirDocument(
                            doc
                          )
                        }
                        title="Double-clic pour ouvrir"
                      >
                        <div>
                          <div className="document-name">
                            {doc.nom}
                          </div>

                          <div className="muted">
                            {typeCourt(
                              doc.mimeType
                            )}{" "}
                            ·{" "}
                            {formatTaille(
                              doc.taille
                            )}
                          </div>
                        </div>

                        <div className="document-actions">
                          <button
                            className="btn"
                            type="button"
                            onClick={(
                              e
                            ) => {
                              e.stopPropagation();

                              ouvrirDocument(
                                doc
                              );
                            }}
                          >
                            Ouvrir
                          </button>

                          <button
                            className="btn-danger"
                            type="button"
                            disabled={
                              operationEnCours
                            }
                            onClick={(
                              e
                            ) => {
                              e.stopPropagation();

                              void supprimerDocument(
                                doc
                              );
                            }}
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* NOUVEAUX FICHIERS */}

              {fichiersEnAttente.length >
                0 && (
                <div className="documents-list">
                  {fichiersEnAttente.map(
                    (
                      file,
                      index
                    ) => (
                      <div
                        className="document-row"
                        key={`${file.name}-${index}`}
                        onDoubleClick={() =>
                          ouvrirFichierLocal(
                            file
                          )
                        }
                        title="Double-clic pour ouvrir"
                      >
                        <div>
                          <div className="document-name">
                            {
                              file.name
                            }
                          </div>

                          <div className="muted">
                            Nouveau ·{" "}
                            {typeCourt(
                              file.type
                            )}{" "}
                            ·{" "}
                            {formatTaille(
                              file.size
                            )}
                          </div>
                        </div>

                        <div className="document-actions">
                          <button
                            className="btn-danger"
                            type="button"
                            onClick={(
                              e
                            ) => {
                              e.stopPropagation();

                              retirerFichierEnAttente(
                                index
                              );
                            }}
                          >
                            Retirer
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

              </>
            ) : ongletCircuit === "samsara" ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "end",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                    <div className="field">
                      <div className="label">Semaine du</div>
                      <input
                        type="date"
                        className="input"
                        value={samsaraSemaine}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSamsaraSemaine(value);
                          if (circuitActifId && value) void chargerAnalyseSamsara(circuitActifId, value);
                        }}
                      />
                    </div>

                    <label style={{ display: "flex", gap: 7, alignItems: "center", paddingBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={afficherExclues}
                        onChange={(e) => setAfficherExclues(e.target.checked)}
                      />
                      Afficher les journées exclues
                    </label>
                  </div>

                  <button
                    className="btn-primary"
                    type="button"
                    disabled={!circuitActifId || samsaraSync}
                    onClick={() => circuitActifId && void synchroniserSamsara(circuitActifId)}
                  >
                    {samsaraSync ? "Analyse…" : "Actualiser ce circuit"}
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                    gap: 10,
                  }}
                >
                  {[
                    ["Unité", circuitForm.unite || "—"],
                    ["KM moyen / jour", `${samsaraResume.kmMoyen.toFixed(1)} km`],
                    [
                      "Heures moy. / jour",
                      `${arrondirQuartHeureDecimal(samsaraResume.heuresMoyennes).toFixed(2)} h`,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fafafa",
                      }}
                    >
                      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
                      <div style={{ fontWeight: 900, marginTop: 4 }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="muted" style={{ fontSize: 12 }}>
                  Référence automatique : médiane des 20 dernières journées régulières complètes, avec tolérance de ±15 minutes sur les retours AM/PM. Un statut manuel Régulier ou Hors régulier a priorité. Heures à payer = temps AM + PM, arrondi au 0,25 h, puis +0,25 h de VAD par journée.
                </div>

                <div className="table-wrap">
                  <table className="list">
                    <thead>
                      <tr>
                        <th rowSpan={2} style={{ verticalAlign: "middle" }}>Date</th>
                        <th
                          colSpan={3}
                          style={{
                            textAlign: "center",
                            background: "#f8fafc",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          AM
                        </th>
                        <th
                          colSpan={3}
                          style={{
                            textAlign: "center",
                            background: "#f8fafc",
                            borderLeft: "1px solid #cbd5e1",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          PM
                        </th>
                        <th rowSpan={2} style={{ verticalAlign: "middle", borderLeft: "1px solid #cbd5e1", paddingLeft: 14 }}>KM régulier</th>
                                                <th rowSpan={2} style={{ verticalAlign: "middle" }}>H régulières</th>
                        <th rowSpan={2} style={{ verticalAlign: "middle" }}>VAD</th>
                        <th rowSpan={2} style={{ verticalAlign: "middle" }}>H à payer</th>
                        <th rowSpan={2} style={{ verticalAlign: "middle" }}>Statut</th>
                        <th rowSpan={2}></th>
                      </tr>
                      <tr>
                        <th>Départ</th>
                        <th>Retour</th>
                        <th>KM</th>
                        <th style={{ borderLeft: "1px solid #cbd5e1", paddingLeft: 12 }}>Départ</th>
                        <th>Retour</th>
                        <th>KM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {samsaraChargement ? (
                        <tr><td colSpan={13} className="muted">Chargement Samsara…</td></tr>
                      ) : samsaraJoursVisibles.length === 0 ? (
                        <tr><td colSpan={13} className="muted">Aucune donnée pour cette semaine. Clique sur « Actualiser ce circuit ».</td></tr>
                      ) : (
                        samsaraJoursVisibles.map((jour) => {
                          const heures = calculHeuresJour(jour);

                          return (
                          <tr key={jour.id} style={jour.exclue ? { opacity: 0.45 } : undefined}>
                            <td><strong>{formatDateSamsara(jour.date)}</strong></td>
                            <td>{formatHeureSamsara(jour.departAm)}</td>
                            <td>{formatHeureSamsara(jour.retourAm)}</td>
                            <td>{jour.kmAm.toFixed(1)}</td>
                            <td style={{ borderLeft: "1px solid #e2e8f0", paddingLeft: 12 }}>{formatHeureSamsara(jour.departPm)}</td>
                            <td>{formatHeureSamsara(jour.retourPm)}</td>
                            <td>{jour.kmPm.toFixed(1)}</td>
                            <td style={{ borderLeft: "1px solid #e2e8f0", paddingLeft: 14 }}><strong>{jour.kmRegulier.toFixed(1)}</strong></td>
                            <td>{heures.heuresRegulieres != null ? heures.heuresRegulieres.toFixed(2) : "—"}</td>
                            <td>{heures.vad != null ? heures.vad.toFixed(2) : "—"}</td>
                            <td><strong>{heures.heuresAPayer != null ? heures.heuresAPayer.toFixed(2) : "—"}</strong></td>
                            <td style={{ minWidth: 190 }}>
                              {jour.exclue ? (
                                <div>
                                  <strong>Exclue</strong>
                                  <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                                    Journée exclue des statistiques.
                                  </div>
                                </div>
                              ) : (
                                <div style={{ display: "grid", gap: 4 }}>
                                  <select
                                    className="input"
                                    style={{ minWidth: 160, padding: "6px 8px" }}
                                    value={valeurStatutManuel(jour)}
                                    onChange={(e) =>
                                      void changerStatutSamsara(
                                        jour,
                                        e.target.value as "auto" | "regulier" | "hors_regulier"
                                      )
                                    }
                                  >
                                    <option value="auto">Automatique · {jour.statut}</option>
                                    <option value="regulier">Régulier</option>
                                    <option value="hors_regulier">Hors régulier</option>
                                  </select>
                                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.25 }}>
                                    {raisonStatutSamsara(jour)}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => void basculerExclusionSamsara(jour)}
                              >
                                {jour.exclue ? "Réinclure" : "Exclure"}
                              </button>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "end",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 16 }}>Temps d’attente quotidiens</div>
                    <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>
                      Tous les arrêts de plus de {seuilAttenteMinutes} minutes détectés pendant les journées classées régulières. La récurrence est seulement un filtre secondaire.
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                    <div className="field">
                      <div className="label">Afficher</div>
                      <select
                        className="input"
                        value={filtreAttentes}
                        onChange={(e) => setFiltreAttentes(e.target.value as "recurrent" | "occasionnel" | "tous")}
                      >
                        <option value="recurrent">Récurrents seulement</option>
                        <option value="occasionnel">Occasionnels seulement</option>
                        <option value="tous">Tous</option>
                      </select>
                    </div>
                    <div className="field" style={{ minWidth: 145 }}>
                      <div className="label">Attente &gt; (min)</div>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={180}
                        step={1}
                        value={seuilAttenteMinutes}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setSeuilAttenteMinutes(
                            Number.isFinite(value)
                              ? Math.max(0, Math.min(180, Math.round(value)))
                              : 25
                          );
                        }}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={!circuitActifId || samsaraSync}
                      onClick={() => circuitActifId && void synchroniserSamsara(circuitActifId)}
                    >
                      {samsaraSync ? "Analyse…" : "Analyser les attentes"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 10,
                  }}
                >
                  {[
                    ["Attentes détectées", String(samsaraAttentes.length)],
                    ["Seuil d’attente", `> ${seuilAttenteMinutes} min`],
                    ["Journées ciblées", "Régulières"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fafafa" }}
                    >
                      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
                      <div style={{ fontWeight: 900, marginTop: 4 }}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="table-wrap">
                  <table className="list">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Période</th>
                        <th>Arrivée</th>
                        <th>Départ</th>
                        <th>Durée</th>
                        <th>Lieu</th>
                        <th>Adresse</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attentesChargement ? (
                        <tr><td colSpan={8} className="muted">Chargement des temps d’attente…</td></tr>
                      ) : attentesGroupes.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="muted">
                            Aucun temps d’attente quotidien détecté sur les journées régulières analysées.
                          </td>
                        </tr>
                      ) : (
                        attentesGroupes.map((attente) => (
                          <tr key={attente.id}>
                            <td><strong>{formatDateSamsara(attente.date)}</strong></td>
                            <td><strong>{attente.periode}</strong></td>
                            <td>{formatHeureSamsara(attente.arrivee)}</td>
                            <td>{formatHeureSamsara(attente.depart)}</td>
                            <td><strong>{Math.round(attente.dureeMinutes)} min</strong></td>
                            <td>
                              <strong>{attente.nomLieu || "Lieu non identifié"}</strong>
                              {!attente.nomLieu && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {attente.latitude.toFixed(5)}, {attente.longitude.toFixed(5)}
                                </div>
                              )}
                            </td>
                            <td>{attente.adresse || "—"}</td>
                            <td>
                              {attente.recurrent ? (
                                <strong>Récurrent</strong>
                              ) : (
                                <span className="muted">À valider</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="muted" style={{ fontSize: 12 }}>
                  Détection quotidienne : seulement les journées régulières, arrêt &gt; {seuilAttenteMinutes} min. Le statut récurrent est calculé ensuite et ne bloque jamais l’affichage dans « Tous ».
                </div>
              </div>
            )}

            <div className="modal-actions">
              {circuitActifId && (
                <button
                  className="btn-danger"
                  type="button"
                  disabled={
                    operationEnCours
                  }
                  onClick={() =>
                    void supprimerCircuit()
                  }
                >
                  Supprimer le circuit
                </button>
              )}

              <div className="modal-actions-right">
                <button
                  className="ghost"
                  type="button"
                  disabled={
                    operationEnCours
                  }
                  onClick={
                    fermerModalCircuit
                  }
                >
                  Annuler
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  disabled={
                    operationEnCours
                  }
                  onClick={() =>
                    void enregistrerCircuit()
                  }
                >
                  {operationEnCours
                    ? "Traitement..."
                    : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONTACT */}

      {modalContactOuvert && (
        <div
          className="modal-backdrop"
          onMouseDown={
            fermerModalContact
          }
        >
          <div
            className="modal-card"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {contactActifId
                    ? "Modifier le contact d’urgence"
                    : "Ajouter un contact d’urgence"}
                </div>
              </div>

              <button
                className="ghost"
                type="button"
                onClick={
                  fermerModalContact
                }
              >
                Fermer
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <div className="label">
                  Organisation
                </div>

                <select
                  className="input"
                  value={
                    contactForm.organisation
                  }
                  onChange={(e) =>
                    setContactForm(
                      (prev) => ({
                        ...prev,

                        organisation:
                          e.target
                            .value as Organisation,

                        organisationAutre:
                          e.target
                            .value ===
                          "Autre"
                            ? prev.organisationAutre
                            : "",
                      })
                    )
                  }
                >
                  <option value="Groupe Breton">
                    Groupe Breton
                  </option>

                  <option value="Autobus Breton">
                    Autobus Breton
                  </option>

                  <option value="Autobus Champagne">
                    Autobus Champagne
                  </option>

                  <option value="Transport Sécuritaire">
                    Transport Sécuritaire
                  </option>

                  <option value="Autre">
                    Autre
                  </option>
                </select>
              </div>

              {contactForm.organisation ===
                "Autre" && (
                <div className="field">
                  <div className="label">
                    Nom de l’organisation
                  </div>

                  <input
                    className="input"
                    value={
                      contactForm.organisationAutre
                    }
                    onChange={(e) =>
                      setContactForm(
                        (prev) => ({
                          ...prev,

                          organisationAutre:
                            e.target
                              .value,
                        })
                      )
                    }
                    placeholder="Ex: CSSBE, Ville de Saint-Georges..."
                  />
                </div>
              )}

              <div className="field">
                <div className="label">
                  Nom
                </div>

                <input
                  className="input"
                  value={
                    contactForm.nom
                  }
                  onChange={(e) =>
                    setContactForm(
                      (prev) => ({
                        ...prev,

                        nom:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Fonction
                </div>

                <input
                  className="input"
                  value={
                    contactForm.fonction
                  }
                  onChange={(e) =>
                    setContactForm(
                      (prev) => ({
                        ...prev,

                        fonction:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Téléphone
                </div>

                <input
                  className="input"
                  value={
                    contactForm.telephone
                  }
                  onChange={(e) =>
                    setContactForm(
                      (prev) => ({
                        ...prev,

                        telephone:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Téléphone 2
                </div>

                <input
                  className="input"
                  value={
                    contactForm.telephone2
                  }
                  onChange={(e) =>
                    setContactForm(
                      (prev) => ({
                        ...prev,

                        telephone2:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>
            </div>

            <div
              className="field"
              style={{
                marginTop: 12,
              }}
            >
              <div className="label">
                Notes
              </div>

              <textarea
                className="input"
                value={
                  contactForm.notes
                }
                onChange={(e) =>
                  setContactForm(
                    (prev) => ({
                      ...prev,

                      notes:
                        e.target.value,
                    })
                  )
                }
              />
            </div>

            <div className="modal-actions">
              {contactActifId && (
                <button
                  className="btn-danger"
                  type="button"
                  onClick={() =>
                    void supprimerContact()
                  }
                >
                  Supprimer
                </button>
              )}

              <div className="modal-actions-right">
                <button
                  className="ghost"
                  type="button"
                  onClick={
                    fermerModalContact
                  }
                >
                  Annuler
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={() =>
                    void enregistrerContact()
                  }
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REMPLAÇANT */}

      {modalRemplacantOuvert && (
        <div
          className="modal-backdrop"
          onMouseDown={
            fermerModalRemplacant
          }
        >
          <div
            className="modal-card"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {remplacantActifId
                    ? "Modifier le conducteur remplaçant"
                    : "Ajouter un conducteur remplaçant"}
                </div>
              </div>

              <button
                className="ghost"
                type="button"
                onClick={
                  fermerModalRemplacant
                }
              >
                Fermer
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <div className="label">
                  Nom
                </div>

                <input
                  className="input"
                  value={
                    remplacantForm.nom
                  }
                  onChange={(e) =>
                    setRemplacantForm(
                      (prev) => ({
                        ...prev,

                        nom:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Téléphone
                </div>

                <input
                  className="input"
                  value={
                    remplacantForm.telephone
                  }
                  onChange={(e) =>
                    setRemplacantForm(
                      (prev) => ({
                        ...prev,

                        telephone:
                          e.target.value,
                      })
                    )
                  }
                />
              </div>

              <div className="field">
                <div className="label">
                  Compagnie
                </div>

                <select
                  className="input"
                  value={
                    remplacantForm.compagnie
                  }
                  onChange={(e) =>
                    setRemplacantForm(
                      (prev) => ({
                        ...prev,

                        compagnie:
                          e.target
                            .value as Compagnie,
                      })
                    )
                  }
                >
                  <option value="Autobus Breton">
                    Autobus Breton
                  </option>

                  <option value="Autobus Champagne">
                    Autobus Champagne
                  </option>

                  <option value="Transport Sécuritaire">
                    Transport Sécuritaire
                  </option>
                </select>
              </div>
            </div>

            <div className="modal-actions">
              {remplacantActifId && (
                <button
                  className="btn-danger"
                  type="button"
                  onClick={() =>
                    void supprimerRemplacant()
                  }
                >
                  Supprimer
                </button>
              )}

              <div className="modal-actions-right">
                <button
                  className="ghost"
                  type="button"
                  onClick={
                    fermerModalRemplacant
                  }
                >
                  Annuler
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={() =>
                    void enregistrerRemplacant()
                  }
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}