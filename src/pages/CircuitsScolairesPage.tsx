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

type CircuitDocument = {
  id: string;
  circuitId: string;
  nom: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  taille: number;
};

type ContactConducteur = {
  id: string;
  nom: string;
  telephone: string;
  organisation: string;
  typeContact: string;
  actif: boolean;
};

function normaliserAffectation(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function normaliserNumeroCircuit(value: string) {
  return normaliserAffectation(value).replace(/^0+(?=\d)/, "");
}

function estCircuitReserveOuSpare(value: string) {
  const normalise = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  return normalise.includes("SPARE") || normalise.includes("RESERVE");
}

type CircuitScolaire = {
  id: string;
  circuit: string;
  unite: string;
  conducteurContactId: string | null;
  nomConducteur: string;
  telephone: string;
  localisation: string;
  compagnie: Compagnie;
  kmCircuit: number | null;
  nombreHeures: number | null;
  departAmPlanifie: string;
  arriveeAmPlanifie: string;
  departPmPlanifie: string;
  arriveePmPlanifie: string;
  vad: number;
  heuresTotalPaye: number | null;
  profilRhAccepte: boolean;
  profilRhAccepteLe: string | null;
  profilRhAcceptePar: string;
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
  conducteurContactId: null,
  nomConducteur: "",
  telephone: "",
  localisation: "",
  compagnie: "Autobus Breton",
  kmCircuit: null,
  nombreHeures: null,
  departAmPlanifie: "",
  arriveeAmPlanifie: "",
  departPmPlanifie: "",
  arriveePmPlanifie: "",
  vad: 0.25,
  heuresTotalPaye: null,
  profilRhAccepte: false,
  profilRhAccepteLe: null,
  profilRhAcceptePar: "",
  documents: [],
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

function formatHeureSamsara(value: string | null) {
  if (!value) return "—";
  const valeurIso = value
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(valeurIso);
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

function minutesDepuisHeureChamp(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const heures = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(heures) || !Number.isFinite(minutes) || heures < 0 || heures > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return heures * 60 + minutes;
}

function calculNombreHeuresPlanifie(
  departAm: string,
  arriveeAm: string,
  departPm: string,
  arriveePm: string
) {
  const dAm = minutesDepuisHeureChamp(departAm);
  const aAm = minutesDepuisHeureChamp(arriveeAm);
  const dPm = minutesDepuisHeureChamp(departPm);
  const aPm = minutesDepuisHeureChamp(arriveePm);

  if (dAm == null || aAm == null || dPm == null || aPm == null) return null;

  const minutesAm = aAm - dAm;
  const minutesPm = aPm - dPm;
  if (minutesAm < 0 || minutesPm < 0) return null;

  return arrondirQuartHeureDecimal((minutesAm + minutesPm) / 60);
}

function heureChampDepuisIso(value: string | null) {
  if (!value) return "";

  // Supporte autant un timestamp ISO Samsara qu'une valeur TIME PostgreSQL
  // (ex. 07:12:00). Le navigateur n'interprète pas toujours "07:12:00"
  // comme une Date valide, ce qui laissait les champs AM/PM vides.
  const heureSeule = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (heureSeule) {
    const h = Math.max(0, Math.min(23, Number(heureSeule[1])));
    const m = Math.max(0, Math.min(59, Number(heureSeule[2])));
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const heure = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return heure && minute ? `${heure}:${minute}` : "";
}

function moyenneHeuresChamp(values: string[]) {
  const minutes = values
    .map(minutesDepuisHeureChamp)
    .filter((value): value is number => value != null);

  if (minutes.length === 0) return "";

  const moyenne = Math.round(
    minutes.reduce((sum, value) => sum + value, 0) / minutes.length
  );
  const h = Math.floor(moyenne / 60) % 24;
  const m = moyenne % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

function kmRegulierEffectif(jour: CircuitSamsaraJour) {
  const totalKm = Math.max(0, jour.kmAm) + Math.max(0, jour.kmPm);

  // Si la journée est confirmée régulière manuellement OU automatiquement,
  // tout le kilométrage AM + PM doit compter comme régulier.
  if (
    jour.statutManuel === "regulier" ||
    (jour.statutManuel == null && jour.statut === "Régulier")
  ) {
    return totalKm;
  }

  return Math.max(0, jour.kmRegulier);
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
  const [isMobilePage, setIsMobilePage] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 900
  );

  useEffect(() => {
    const onResize = () => setIsMobilePage(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
  const [gpsResumeMobileOuvert, setGpsResumeMobileOuvert] =
    useState(false);
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

  const toutesCompagnies: Compagnie[] = [
    "Autobus Breton",
    "Autobus Champagne",
    "Transport Sécuritaire",
  ];

  const [compagniesSelectionnees, setCompagniesSelectionnees] =
    useState<Compagnie[]>(toutesCompagnies);

  const compagnieParDefaut: Compagnie =
    compagniesSelectionnees[0] ?? "Autobus Breton";

  function basculerCompagnieFiltre(valeur: Compagnie) {
    setCompagniesSelectionnees((actuelles) =>
      actuelles.includes(valeur)
        ? actuelles.filter((item) => item !== valeur)
        : [...actuelles, valeur]
    );
  }

  function selectionnerToutesCompagnies() {
    setCompagniesSelectionnees(toutesCompagnies);
  }

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

  const [contactsConducteurs, setContactsConducteurs] = useState<ContactConducteur[]>([]);
  const [contactsChargement, setContactsChargement] = useState(false);
  const [contactsErreur, setContactsErreur] = useState("");

  async function chargerContactsConducteurs() {
    setContactsChargement(true);
    setContactsErreur("");
    try {
      const { data, error } = await circuitSupabase.from("contacts")
        .select("id,nom,telephone,organisation,type_contact,actif")
        .in("type_contact", ["Conducteur", "Conducteur remplaçant"])
        .order("nom", { ascending: true });
      if (error) throw error;
      setContactsConducteurs((data ?? []).map((item) => ({
        id: String(item.id), nom: item.nom ?? "", telephone: item.telephone ?? "",
        organisation: item.organisation ?? "", typeContact: item.type_contact ?? "",
        actif: item.actif !== false,
      })));
    } catch (error) {
      const message = (error as { message?: string })?.message;
      setContactsErreur(message || "Impossible de charger les conducteurs des contacts.");
    } finally {
      setContactsChargement(false);
    }
  }

  const conducteurSelectionneId = circuitForm.conducteurContactId ||
    contactsConducteurs.find((contact) => contact.organisation === circuitForm.compagnie &&
      normaliserAffectation(contact.nom) === normaliserAffectation(circuitForm.nomConducteur))?.id || "";

  const conducteursDisponibles = contactsConducteurs.filter((contact) =>
    contact.id === conducteurSelectionneId ||
    (contact.actif &&
      (contact.organisation === circuitForm.compagnie ||
        contact.organisation === "Groupe Breton"))
  );

  function selectionnerConducteur(id: string) {
    const contact = contactsConducteurs.find((item) => item.id === id);
    setCircuitForm((prev) => ({ ...prev, conducteurContactId: contact?.id ?? null,
      nomConducteur: contact?.nom ?? "", telephone: contact?.telephone ?? "" }));
  }

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
  const [analyseProfilEnCours, setAnalyseProfilEnCours] = useState(false);
  const [vadEdition, setVadEdition] = useState(false);
  const [afficherExclues, setAfficherExclues] = useState(false);
  const [samsaraSemaine, setSamsaraSemaine] = useState(mondayIso(0));

  /*
   * CHARGEMENT INITIAL
   */

  useEffect(() => {
    void chargerToutesLesDonnees();
  }, []);

  async function chargerToutesLesDonnees() {
    try {
      setChargement(true);

      await chargerCircuits();
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
          conducteur_contact_id,
          telephone,
          localisation,
          compagnie,
          km_circuit,
          nombre_heures,
          depart_am_planifie,
          arrivee_am_planifie,
          depart_pm_planifie,
          arrivee_pm_planifie,
          vad,
          heures_total_paye,
          profil_rh_accepte,
          profil_rh_accepte_le,
          profil_rh_accepte_par,
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
        conducteurContactId: item.conducteur_contact_id ?? null,
        nomConducteur:
          item.nom_conducteur || "",
        telephone: item.telephone || "",
        localisation:
          item.localisation || "",
        compagnie:
          item.compagnie as Compagnie,
        kmCircuit: item.km_circuit == null ? null : Number(item.km_circuit),
        nombreHeures: item.nombre_heures == null ? null : Number(item.nombre_heures),
        departAmPlanifie: item.depart_am_planifie || "",
        arriveeAmPlanifie: item.arrivee_am_planifie || "",
        departPmPlanifie: item.depart_pm_planifie || "",
        arriveePmPlanifie: item.arrivee_pm_planifie || "",
        vad: item.vad == null ? 0.25 : Number(item.vad),
        heuresTotalPaye: item.heures_total_paye == null ? null : Number(item.heures_total_paye),
        profilRhAccepte: item.profil_rh_accepte === true,
        profilRhAccepteLe: item.profil_rh_accepte_le ?? null,
        profilRhAcceptePar: item.profil_rh_accepte_par ?? "",

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

  function cleSamsaraLive(compagnie: Compagnie, unite: string) {
    return `${compagnie}::${unite.trim()}`;
  }

  async function appelerSamsaraLive(
    vehicules: Array<{ unit: string; compagnie: Compagnie }>
  ) {
    const uniques = Array.from(
      new Map(
        vehicules
          .map((item) => ({
            unit: item.unit.trim(),
            compagnie: item.compagnie,
          }))
          .filter((item) => item.unit)
          .map((item) => [
            cleSamsaraLive(item.compagnie, item.unit),
            item,
          ])
      ).values()
    );

    if (uniques.length === 0) {
      return {} as Record<string, SamsaraLiveVehicle>;
    }

    const { data, error } = await circuitSupabase.functions.invoke(
      "circuit-samsara-live",
      {
        body: { vehicles: uniques },
      }
    );

    if (error) throw error;
    if (data?.ok === false) {
      throw new Error(data?.error || "Lecture GPS impossible.");
    }

    return (data?.vehicles || {}) as Record<string, SamsaraLiveVehicle>;
  }

  async function chargerStatutsSamsaraLive(
    liste: CircuitScolaire[] = circuits
  ) {
    try {
      setSamsaraStatutsChargement(true);

      const parUnite = await appelerSamsaraLive(
        liste.map((item) => ({
          unit: item.unite,
          compagnie: item.compagnie,
        }))
      );

      const parCircuit: Record<string, SamsaraLiveVehicle> = {};

      for (const item of liste) {
        const unite = item.unite.trim();
        const cle = cleSamsaraLive(item.compagnie, unite);

        parCircuit[item.id] =
          parUnite[cle] || {
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
      const cle = cleSamsaraLive(circuit.compagnie, unite);

      const parUnite = await appelerSamsaraLive([
        {
          unit: unite,
          compagnie: circuit.compagnie,
        },
      ]);

      const vehicule =
        parUnite[cle] || {
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
        setGpsErreur(`Aucun GPS trouvé pour l’unité ${unite} (${circuit.compagnie}).`);
      }
    } catch (error: any) {
      console.error("Erreur GPS live", error);
      setGpsErreur(error?.message || "Impossible de lire la position GPS.");
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
    setGpsResumeMobileOuvert(false);
    setModalGpsOuvert(true);
    void rafraichirVehiculeGps(circuit, true);
  }

  function fermerCarteGps() {
    etaAbortRef.current?.abort();
    etaAbortRef.current = null;
    etaRequestIdRef.current += 1;

    setModalGpsOuvert(false);
    setGpsResumeMobileOuvert(false);
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
          compagniesSelectionnees.includes(item.compagnie);

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
      const normaliserCircuit = (value: string) =>
        value
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toUpperCase();

      const circuitA = normaliserCircuit(a.circuit);
      const circuitB = normaliserCircuit(b.circuit);

      const estReserveA =
        circuitA.includes("SPARE") ||
        circuitA.includes("RESERVE");

      const estReserveB =
        circuitB.includes("SPARE") ||
        circuitB.includes("RESERVE");

      // Les vrais circuits restent toujours au-dessus.
      if (estReserveA !== estReserveB) {
        return estReserveA ? 1 : -1;
      }

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
    compagniesSelectionnees,
    tri,
    direction,
  ]);

  const compteCircuitsVehicules = useMemo(() => {
    const circuitsComptables = new Set<string>();
    const vehicules = new Set<string>();

    for (const item of circuitsFiltres) {
      const numeroCircuit = item.circuit.trim();
      const unite = item.unite.trim();

      if (unite) {
        vehicules.add(unite.toLowerCase());
      }

      const circuitNormalise = numeroCircuit
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toUpperCase();

      const estReserve =
        circuitNormalise.includes("SPARE") ||
        circuitNormalise.includes("RESERVE");

      if (numeroCircuit && !estReserve) {
        circuitsComptables.add(circuitNormalise);
      }
    }

    return {
      circuits: circuitsComptables.size,
      vehicules: vehicules.size,
    };
  }, [circuitsFiltres]);

  /*
   * CIRCUIT - MODAL
   */

  function ouvrirAjoutCircuit() {
    void chargerContactsConducteurs();
    setCircuitActifId(null);

    setCircuitForm({
      ...circuitVide,

      compagnie: compagnieParDefaut,

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
    void chargerContactsConducteurs();

    setCircuitForm({
      circuit: circuit.circuit,
      unite: circuit.unite,

      conducteurContactId: circuit.conducteurContactId,
      nomConducteur:
        circuit.nomConducteur,

      telephone:
        circuit.telephone,

      localisation:
        circuit.localisation,

      compagnie:
        circuit.compagnie,

      kmCircuit: circuit.kmCircuit,
      nombreHeures: circuit.nombreHeures,
      departAmPlanifie: circuit.departAmPlanifie,
      arriveeAmPlanifie: circuit.arriveeAmPlanifie,
      departPmPlanifie: circuit.departPmPlanifie,
      arriveePmPlanifie: circuit.arriveePmPlanifie,
      vad: circuit.vad ?? 0.25,
      heuresTotalPaye: circuit.heuresTotalPaye,
      profilRhAccepte: circuit.profilRhAccepte,
      profilRhAccepteLe: circuit.profilRhAccepteLe,
      profilRhAcceptePar: circuit.profilRhAcceptePar,

      documents:
        circuit.documents || [],
    });
    setVadEdition(false);

    setFichiersEnAttente([]);
    setOngletCircuit("infos");
    setSamsaraSemaine(mondayIso(0));
    setModalCircuitOuvert(true);
    void chargerAnalyseSamsara(circuit.id, mondayIso(0));
    void chargerAttentesSamsara(circuit.id);

    // Complète automatiquement seulement les profils non acceptés.
    // Un profil accepté reste figé jusqu'à ce qu'on clique sur Modifier.
    if (!circuit.profilRhAccepte) {
      void analyserProfilCircuit(circuit.id, true);
    }
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
    setVadEdition(false);
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


  async function definirAcceptationProfilRh(accepte: boolean) {
    if (!circuitActifId) return;

    if (accepte) {
      if (
        circuitForm.kmCircuit == null ||
        circuitForm.nombreHeures == null ||
        !circuitForm.departAmPlanifie ||
        !circuitForm.arriveeAmPlanifie ||
        !circuitForm.departPmPlanifie ||
        !circuitForm.arriveePmPlanifie
      ) {
        alert("Le profil doit être complet avant de pouvoir être accepté pour RH.");
        return;
      }

      if (!circuitForm.conducteurContactId || !circuitForm.nomConducteur.trim()) {
        alert("Un conducteur doit être assigné au circuit avant l’acceptation RH.");
        return;
      }
    }

    const ancienEtat = {
      accepte: circuitForm.profilRhAccepte,
      accepteLe: circuitForm.profilRhAccepteLe,
      acceptePar: circuitForm.profilRhAcceptePar,
    };

    try {
      setOperationEnCours(true);

      let acceptePar = "";
      if (accepte) {
        try {
          const { data } = await circuitSupabase.auth.getUser();
          acceptePar = data.user?.email ?? "";
        } catch {
          acceptePar = "";
        }
      }

      const accepteLe = accepte ? new Date().toISOString() : null;
      const updatedAt = new Date().toISOString();

      const { error } = await circuitSupabase
        .from("circuits_scolaires")
        .update({
          profil_rh_accepte: accepte,
          profil_rh_accepte_le: accepteLe,
          profil_rh_accepte_par: accepte ? acceptePar || null : null,
          updated_at: updatedAt,
        })
        .eq("id", circuitActifId);

      if (error) throw error;

      // Synchronisation inter-projets : Circuits -> RH.
      // On ne montre l'état accepté dans l'interface qu'après confirmation de RH.
      const { data: syncData, error: syncError } =
        await circuitSupabase.functions.invoke("sync-circuit-rh", {
          body: { circuit_id: circuitActifId },
        });

      if (syncError || syncData?.success === false) {
        // Rollback de l'acceptation locale pour éviter un circuit vert
        // qui n'aurait pas réellement été reçu par RH.
        await circuitSupabase
          .from("circuits_scolaires")
          .update({
            profil_rh_accepte: ancienEtat.accepte,
            profil_rh_accepte_le: ancienEtat.accepteLe,
            profil_rh_accepte_par: ancienEtat.accepte
              ? ancienEtat.acceptePar || null
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", circuitActifId);

        throw new Error(
          syncData?.error ||
            syncError?.message ||
            "Le profil n'a pas pu être synchronisé avec RH."
        );
      }

      setCircuitForm((prev) => ({
        ...prev,
        profilRhAccepte: accepte,
        profilRhAccepteLe: accepteLe,
        profilRhAcceptePar: accepte ? acceptePar : "",
      }));

      setCircuits((prev) =>
        prev.map((item) =>
          item.id === circuitActifId
            ? {
                ...item,
                profilRhAccepte: accepte,
                profilRhAccepteLe: accepteLe,
                profilRhAcceptePar: accepte ? acceptePar : "",
              }
            : item
        )
      );

      if (!accepte) {
        setVadEdition(false);
      }
    } catch (error: any) {
      console.error("Erreur acceptation / synchronisation profil RH", error);
      alert(
        error?.message ||
          "Impossible de modifier l’état d’acceptation ou de synchroniser le profil avec RH."
      );
    } finally {
      setOperationEnCours(false);
    }
  }

  async function analyserProfilCircuit(
    circuitIdForce?: string,
    remplirSeulementVides = false
  ) {
    const circuitIdAnalyse = circuitIdForce ?? circuitActifId;
    if (!circuitIdAnalyse || analyseProfilEnCours) return;

    try {
      setAnalyseProfilEnCours(true);

      const { data, error } = await circuitSupabase
        .from("circuit_samsara_jours")
        .select("*")
        .eq("circuit_id", circuitIdAnalyse)
        .eq("exclue", false)
        .order("date", { ascending: false })
        .limit(60);

      if (error) throw error;

      const jours: CircuitSamsaraJour[] = (data ?? []).map((row: any) => ({
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
        details: row.details && typeof row.details === "object" ? row.details : {},
        exclue: !!row.exclue,
      }));

      let reguliers = jours
        .filter(jourSamsaraCompletPourMoyenne)
        .filter((jour) => {
          // Un statut manuel Hors régulier exclut toujours la journée.
          if (jour.statutManuel === "hors_regulier") return false;
          if (jour.statutManuel === "regulier") return true;

          // Pour l'automatique, on accepte soit le libellé Régulier,
          // soit une journée à laquelle l'analyse a attribué des KM réguliers.
          // Cela évite de dépendre d'un accent/format exact dans `statut`.
          return jour.statut === "Régulier" || jour.kmRegulier > 0;
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-20);

      if (reguliers.length === 0) {
        alert("Aucune journée régulière complète n’est disponible pour établir le profil du circuit.");
        return;
      }

      // Si les dernières journées montrent un nouveau régime récurrent,
      // on ignore l'ancien historique. Un régime récent doit apparaître
      // au moins 3 fois parmi les 5 dernières journées.
      if (reguliers.length > 5) {
        const recentes = reguliers.slice(-5);
        const anciennes = reguliers.slice(0, -5);

        const heuresRecentes = recentes
          .map((jour) => calculHeuresJour(jour).heuresRegulieres)
          .filter((value): value is number => value != null);

        const compteurHeures = new Map<number, number>();
        for (const value of heuresRecentes) {
          compteurHeures.set(value, (compteurHeures.get(value) ?? 0) + 1);
        }
        const modeRecentHeures = [...compteurHeures.entries()]
          .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];

        const heuresAnciennes = anciennes
          .map((jour) => calculHeuresJour(jour).heuresRegulieres)
          .filter((value): value is number => value != null);
        const compteurAncienHeures = new Map<number, number>();
        for (const value of heuresAnciennes) {
          compteurAncienHeures.set(value, (compteurAncienHeures.get(value) ?? 0) + 1);
        }
        const modeAncienHeures = [...compteurAncienHeures.entries()]
          .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];

        const kmRecents = recentes.map((jour) => jour.kmRegulier).filter((value) => value > 0);
        const kmAnciens = anciennes.map((jour) => jour.kmRegulier).filter((value) => value > 0);
        const moyenne = (values: number[]) =>
          values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        const kmRecentMoyen = moyenne(kmRecents);
        const kmAncienMoyen = moyenne(kmAnciens);
        const toleranceKm = Math.max(3, kmRecentMoyen * 0.05);
        const kmRecentStable =
          kmRecents.filter((value) => Math.abs(value - kmRecentMoyen) <= toleranceKm).length >= 3;
        const changementKm =
          kmRecentStable &&
          kmAncienMoyen > 0 &&
          Math.abs(kmRecentMoyen - kmAncienMoyen) > toleranceKm;

        const changementHeures =
          !!modeRecentHeures &&
          modeRecentHeures[1] >= 3 &&
          !!modeAncienHeures &&
          modeRecentHeures[0] !== modeAncienHeures[0];

        if (changementHeures || changementKm) {
          reguliers = recentes;
        }
      }

      const durees = reguliers
        .map((jour) => calculHeuresJour(jour).heuresRegulieres)
        .filter((value): value is number => value != null);

      const compteur = new Map<number, number>();
      for (const duree of durees) {
        compteur.set(duree, (compteur.get(duree) ?? 0) + 1);
      }

      // Règle convenue : une durée est reconnue comme récurrente si elle
      // apparaît au moins 3 fois ET représente au moins 35 % des journées
      // régulières retenues. Si plusieurs durées passent le seuil, on garde
      // la plus élevée.
      const seuilRecurrence = 0.35;
      const dureesRecurrentes = [...compteur.entries()]
        .filter(([, count]) => count / durees.length >= seuilRecurrence)
        .map(([duree]) => duree)
        .sort((a, b) => b - a);

      let nombreHeures: number | null = dureesRecurrentes[0] ?? null;

      if (nombreHeures == null && durees.length > 0) {
        // Si aucune durée n'atteint le seuil de récurrence de 35 %,
        // on prend la durée la plus fréquente.
        // En cas d'égalité, on retient volontairement la PLUS ÉLEVÉE afin de
        // ne pas sous-estimer les heures du circuit.
        const maxOccurrences = Math.max(...compteur.values());
        const dureesLesPlusFrequentes = [...compteur.entries()]
          .filter(([, count]) => count === maxOccurrences)
          .map(([duree]) => duree)
          .sort((a, b) => b - a);

        nombreHeures = dureesLesPlusFrequentes[0] ?? null;
      }

      const kmValues = reguliers
        .map((jour) => jour.kmRegulier)
        .filter((value) => Number.isFinite(value) && value > 0);
      const kmCircuit =
        kmValues.length > 0
          ? Number(
              (
                kmValues.reduce((sum, value) => sum + value, 0) / kmValues.length
              ).toFixed(1)
            )
          : null;

      const departAmPlanifie = moyenneHeuresChamp(
        reguliers.map((jour) => heureChampDepuisIso(jour.departAm)).filter(Boolean)
      );
      const arriveeAmPlanifie = moyenneHeuresChamp(
        reguliers.map((jour) => heureChampDepuisIso(jour.retourAm)).filter(Boolean)
      );
      const departPmPlanifie = moyenneHeuresChamp(
        reguliers.map((jour) => heureChampDepuisIso(jour.departPm)).filter(Boolean)
      );
      const arriveePmPlanifie = moyenneHeuresChamp(
        reguliers.map((jour) => heureChampDepuisIso(jour.retourPm)).filter(Boolean)
      );

      if (!departAmPlanifie || !arriveeAmPlanifie || !departPmPlanifie || !arriveePmPlanifie) {
        console.warn("Profil circuit : heures AM/PM incomplètes après analyse", {
          circuitId: circuitIdAnalyse,
          joursReguliers: reguliers.length,
          departAmPlanifie,
          arriveeAmPlanifie,
          departPmPlanifie,
          arriveePmPlanifie,
        });
      }

      setCircuitForm((prev) => {
        const vad = Number.isFinite(prev.vad) ? prev.vad : 0.25;

        // À l'ouverture de la fiche, on complète automatiquement seulement
        // les champs encore vides afin de ne jamais écraser une correction manuelle.
        const nouveauKmCircuit =
          remplirSeulementVides && prev.kmCircuit != null ? prev.kmCircuit : kmCircuit;
        const nouveauNombreHeures =
          remplirSeulementVides && prev.nombreHeures != null ? prev.nombreHeures : nombreHeures;
        const nouveauDepartAm =
          remplirSeulementVides && prev.departAmPlanifie ? prev.departAmPlanifie : departAmPlanifie;
        const nouvelleArriveeAm =
          remplirSeulementVides && prev.arriveeAmPlanifie ? prev.arriveeAmPlanifie : arriveeAmPlanifie;
        const nouveauDepartPm =
          remplirSeulementVides && prev.departPmPlanifie ? prev.departPmPlanifie : departPmPlanifie;
        const nouvelleArriveePm =
          remplirSeulementVides && prev.arriveePmPlanifie ? prev.arriveePmPlanifie : arriveePmPlanifie;

        return {
          ...prev,
          kmCircuit: nouveauKmCircuit,
          nombreHeures: nouveauNombreHeures,
          departAmPlanifie: nouveauDepartAm,
          arriveeAmPlanifie: nouvelleArriveeAm,
          departPmPlanifie: nouveauDepartPm,
          arriveePmPlanifie: nouvelleArriveePm,
          heuresTotalPaye:
            nouveauNombreHeures == null
              ? null
              : Number((nouveauNombreHeures + vad).toFixed(2)),
        };
      });
    } catch (error: any) {
      console.error("Erreur analyse profil circuit", error);
      alert(error?.message || "Impossible d’analyser le profil du circuit.");
    } finally {
      setAnalyseProfilEnCours(false);
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

    if (valeur === "auto" && statut === "Régulier") {
      // Une journée automatiquement régulière doit toujours compter
      // l'ensemble du trajet AM + PM comme KM régulier.
      kmRegulier = totalKm;
      kmHorsRegulier = 0;
    }

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
        ? samsaraJoursComplets.reduce((sum, row) => sum + kmRegulierEffectif(row), 0) /
          samsaraJoursComplets.length
        : 0,
    kmTotal: samsaraJoursComplets.reduce((sum, row) => sum + kmRegulierEffectif(row), 0),
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
    if (operationEnCours || contactsChargement) return;
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

      // Vérifier les affectations actuelles, même si la liste affichée est ancienne.
      const { data: affectations, error: affectationsErreur } = await circuitSupabase
        .from("circuits_scolaires")
        .select("id,circuit,compagnie,nom_conducteur,conducteur_contact_id");
      if (affectationsErreur) throw affectationsErreur;
      const contactChoisi = contactsConducteurs.find((contact) => contact.id === conducteurSelectionneId);
      const conducteurId = contactChoisi?.id ?? circuitForm.conducteurContactId;
      const nomConducteur = contactChoisi?.nom ?? circuitForm.nomConducteur.trim();
      const telephoneConducteur = contactChoisi?.telephone ?? circuitForm.telephone.trim();
      const autresAffectations = (affectations ?? []).filter((item) => {
        if (String(item.id) === circuitActifId || !nomConducteur) return false;
        const memeConducteur = item.conducteur_contact_id && conducteurId
          ? item.conducteur_contact_id === conducteurId
          : item.compagnie === circuitForm.compagnie &&
            normaliserAffectation(item.nom_conducteur ?? "") === normaliserAffectation(nomConducteur);
        const autreCircuit = item.compagnie !== circuitForm.compagnie ||
          normaliserNumeroCircuit(item.circuit ?? "") !== normaliserNumeroCircuit(numero);
        return memeConducteur && autreCircuit;
      });
      const circuitInitial = circuits.find((item) => item.id === circuitActifId);
      const memeAffectation = !!circuitInitial && circuitInitial.compagnie === circuitForm.compagnie &&
        normaliserNumeroCircuit(circuitInitial.circuit) === normaliserNumeroCircuit(numero) &&
        (circuitInitial.conducteurContactId && conducteurId
          ? circuitInitial.conducteurContactId === conducteurId
          : normaliserAffectation(circuitInitial.nomConducteur) === normaliserAffectation(nomConducteur));
      if (!memeAffectation && autresAffectations.length > 0) {
        const numeros = [...new Set(autresAffectations.map((item) =>
          item.compagnie === circuitForm.compagnie ? item.circuit : `${item.circuit} (${item.compagnie})`
        ))].join(", ");
        if (!window.confirm(`${nomConducteur} est déjà attribué ${autresAffectations.length === 1 ? "au circuit" : "aux circuits"} ${numeros}.\n\nVoulez-vous procéder au changement?`)) return;
      }

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

              conducteur_contact_id: conducteurId,
              nom_conducteur: nomConducteur,
              telephone: telephoneConducteur,

              localisation:
                circuitForm.localisation.trim(),

              compagnie:
                circuitForm.compagnie,

              km_circuit: circuitForm.kmCircuit,
              nombre_heures: circuitForm.nombreHeures,
              depart_am_planifie: circuitForm.departAmPlanifie || null,
              arrivee_am_planifie: circuitForm.arriveeAmPlanifie || null,
              depart_pm_planifie: circuitForm.departPmPlanifie || null,
              arrivee_pm_planifie: circuitForm.arriveePmPlanifie || null,
              vad: Number.isFinite(circuitForm.vad) ? circuitForm.vad : 0.25,
              heures_total_paye:
                circuitForm.nombreHeures == null
                  ? null
                  : Number((circuitForm.nombreHeures + (Number.isFinite(circuitForm.vad) ? circuitForm.vad : 0.25)).toFixed(2)),
              profil_rh_accepte: circuitForm.profilRhAccepte,
              profil_rh_accepte_le: circuitForm.profilRhAccepte ? circuitForm.profilRhAccepteLe : null,
              profil_rh_accepte_par: circuitForm.profilRhAccepte ? circuitForm.profilRhAcceptePar || null : null,

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

              conducteur_contact_id: conducteurId,
              nom_conducteur: nomConducteur,
              telephone: telephoneConducteur,

              localisation:
                circuitForm.localisation.trim(),

              compagnie:
                circuitForm.compagnie,
              km_circuit: circuitForm.kmCircuit,
              nombre_heures: circuitForm.nombreHeures,
              depart_am_planifie: circuitForm.departAmPlanifie || null,
              arrivee_am_planifie: circuitForm.arriveeAmPlanifie || null,
              depart_pm_planifie: circuitForm.departPmPlanifie || null,
              arrivee_pm_planifie: circuitForm.arriveePmPlanifie || null,
              vad: Number.isFinite(circuitForm.vad) ? circuitForm.vad : 0.25,
              heures_total_paye:
                circuitForm.nombreHeures == null
                  ? null
                  : Number((circuitForm.nombreHeures + (Number.isFinite(circuitForm.vad) ? circuitForm.vad : 0.25)).toFixed(2)),
              profil_rh_accepte: circuitForm.profilRhAccepte,
              profil_rh_accepte_le: circuitForm.profilRhAccepte ? circuitForm.profilRhAccepteLe : null,
              profil_rh_accepte_par: circuitForm.profilRhAccepte ? circuitForm.profilRhAcceptePar || null : null,
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

      // La fermeture doit pouvoir se faire après l’enregistrement réussi.
      setModalCircuitOuvert(false);
      setCircuitActifId(null);
      setFichiersEnAttente([]);
    } catch (error) {
      console.error(
        "Erreur sauvegarde circuit",
        error
      );

      alert(
        `Erreur pendant l’enregistrement du circuit.\n${(error as { message?: string })?.message || "Cause inconnue."}`
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

    const libelleCompagnies =
      compagniesSelectionnees.length === toutesCompagnies.length
        ? "Toutes les compagnies"
        : compagniesSelectionnees.length
          ? compagniesSelectionnees.join(" + ")
          : "Aucune compagnie";

    const titre = `Circuits scolaire - ${libelleCompagnies}`;

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
      compagniesSelectionnees.length === toutesCompagnies.length
        ? "circuits-scolaires"
        : `circuits-${compagniesSelectionnees
            .map((c) =>
              c
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "-")
            )
            .join("-")}`;

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
            Répertoire des circuits scolaires.
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
        <div style={{ display: "grid", gap: 10 }}>
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

            <div
              style={{
                minHeight: 38,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "5px 8px",
                border: "1px solid #d7dee8",
                borderRadius: 12,
                background: "#fff",
              }}
            >
              {[
                { valeur: "Autobus Breton" as Compagnie, libelle: "B" },
                { valeur: "Autobus Champagne" as Compagnie, libelle: "C" },
                { valeur: "Transport Sécuritaire" as Compagnie, libelle: "S" },
              ].map(({ valeur, libelle }) => (
                <label
                  key={valeur}
                  title={valeur}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "3px 5px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#1e293b",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={compagniesSelectionnees.includes(valeur)}
                    onChange={() => basculerCompagnieFiltre(valeur)}
                    style={{
                      width: 15,
                      height: 15,
                      accentColor: "#2563eb",
                      cursor: "pointer",
                    }}
                  />
                  {libelle}
                </label>
              ))}

              <button
                type="button"
                onClick={selectionnerToutesCompagnies}
                style={{
                  border: "1px solid #d7dee8",
                  borderRadius: 999,
                  background:
                    compagniesSelectionnees.length === toutesCompagnies.length
                      ? "#f1f5f9"
                      : "#fff",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#1e293b",
                  cursor: "pointer",
                }}
              >
                Tous
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CIRCUITS */}

      <div className="card">
        <div className="card-head">
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div className="card-title">
                Circuits
              </div>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 9px",
                  borderRadius: 999,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#334155",
                }}
              >
                {compteCircuitsVehicules.circuits} circuit
                {compteCircuitsVehicules.circuits > 1 ? "s" : ""}
                {" · "}
                {compteCircuitsVehicules.vehicules} véhicule
                {compteCircuitsVehicules.vehicules > 1 ? "s" : ""}
              </div>
            </div>

            <div className="card-subtitle">
              Double-clic sur un circuit pour ouvrir sa fiche.
            </div>
          </div>

          <div className="page-actions">
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

        {isMobilePage ? (
          <div
            style={{
              display: "grid",
              gap: 9,
            }}
          >
            {circuitsFiltres.map((item) => {
              const live = samsaraLiveParCircuit[item.id];

              return (
                <div
                  key={item.id}
                  onDoubleClick={() =>
                    ouvrirModificationCircuit(item)
                  }
                  onClick={() =>
                    ouvrirModificationCircuit(item)
                  }
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: 12,
                    background: "#fff",
                    display: "grid",
                    gap: 9,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 900,
                        }}
                      >
                        Circuit {item.circuit}
                      </div>

                      <div
                        style={{
                          marginTop: 3,
                          color: "#667085",
                          fontSize: 13,
                        }}
                      >
                        Unité {item.unite || "—"} · {item.compagnie}
                      </div>
                    </div>

                    {live?.found ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          ouvrirCarteGps(item);
                        }}
                        style={{
                          border: "1px solid #86efac",
                          background: "#f0fdf4",
                          color: "#166534",
                          borderRadius: 999,
                          padding: "7px 10px",
                          fontWeight: 900,
                        }}
                      >
                        ● GPS
                      </button>
                    ) : (
                      <span
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fef2f2",
                          color: "#991b1b",
                          borderRadius: 999,
                          padding: "7px 10px",
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                      >
                        ● Aucun GPS
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                    }}
                  >
                    <div>
                      <div
                        className="muted"
                        style={{ fontSize: 11 }}
                      >
                        Conducteur
                      </div>
                      <div style={{ fontWeight: 800 }}>
                        {item.nomConducteur || "—"}
                      </div>
                    </div>

                    <div>
                      <div
                        className="muted"
                        style={{ fontSize: 11 }}
                      >
                        Téléphone
                      </div>
                      <div style={{ fontWeight: 800 }}>
                        {item.telephone ? (
                          <a
                            href={telHref(item.telephone)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.telephone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>

                    <div>
                      <div
                        className="muted"
                        style={{ fontSize: 11 }}
                      >
                        Localisation
                      </div>
                      <div style={{ fontWeight: 700 }}>
                        {item.localisation || "—"}
                      </div>
                    </div>

                    <div>
                      <div
                        className="muted"
                        style={{ fontSize: 11 }}
                      >
                        Vérifié
                      </div>
                      <div style={{ fontWeight: 700 }}>
                        {estCircuitReserveOuSpare(item.circuit) ? (
                          <span className="muted">—</span>
                        ) : (
                          <span
                            title={item.profilRhAccepte ? "Circuit vérifié" : "Circuit non vérifié"}
                            aria-label={item.profilRhAccepte ? "Circuit vérifié" : "Circuit non vérifié"}
                            style={{
                              display: "inline-block",
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: item.profilRhAccepte ? "#16a34a" : "#f59e0b",
                              boxShadow: item.profilRhAccepte
                                ? "0 0 0 3px rgba(22,163,74,.14)"
                                : "0 0 0 3px rgba(245,158,11,.14)",
                            }}
                          />
                        )}
                      </div>
                    </div>

                    <div>
                      <div
                        className="muted"
                        style={{ fontSize: 11 }}
                      >
                        Documents
                      </div>
                      <div style={{ fontWeight: 700 }}>
                        {item.documents.length > 0
                          ? `${item.documents.length} document(s)`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {circuitsFiltres.length === 0 && (
              <div
                className="muted"
                style={{
                  padding: 14,
                  textAlign: "center",
                }}
              >
                Aucun circuit.
              </div>
            )}
          </div>
        ) : (
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

                <th style={{ textAlign: "center" }}>
                  Vérifié
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

                    <td style={{ textAlign: "center" }}>
                      {estCircuitReserveOuSpare(item.circuit) ? (
                        <span className="muted">—</span>
                      ) : (
                        <span
                          title={item.profilRhAccepte ? "Circuit vérifié" : "Circuit non vérifié"}
                          aria-label={item.profilRhAccepte ? "Circuit vérifié" : "Circuit non vérifié"}
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            background: item.profilRhAccepte ? "#16a34a" : "#f59e0b",
                            boxShadow: item.profilRhAccepte
                              ? "0 0 0 3px rgba(22,163,74,.14)"
                              : "0 0 0 3px rgba(245,158,11,.14)",
                          }}
                        />
                      )}
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
                    colSpan={9}
                    className="muted"
                  >
                    Aucun circuit.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
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
                position: "relative",
                display: "grid",
                gridTemplateColumns: isMobilePage
                  ? "minmax(0, 1fr)"
                  : "minmax(250px, 320px) minmax(0, 1fr)",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {isMobilePage && (
                <button
                  type="button"
                  onClick={() =>
                    setGpsResumeMobileOuvert((value) => !value)
                  }
                  aria-label="Afficher les informations GPS"
                  title="Afficher les informations GPS"
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    zIndex: 8,
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    border: "1px solid #d7dee8",
                    background: "rgba(255,255,255,.96)",
                    boxShadow: "0 2px 10px rgba(15,23,42,.14)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 4,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 22, height: 3, borderRadius: 99, background: "#10233f" }} />
                  <span style={{ width: 22, height: 3, borderRadius: 99, background: "#10233f" }} />
                  <span style={{ width: 22, height: 3, borderRadius: 99, background: "#10233f" }} />
                </button>
              )}

              {isMobilePage && gpsResumeMobileOuvert && (
                <div
                  onClick={() => setGpsResumeMobileOuvert(false)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 6,
                    background: "rgba(15,23,42,.34)",
                  }}
                />
              )}

              <div
                style={{
                  position: isMobilePage ? "absolute" : "relative",
                  zIndex: isMobilePage ? 7 : 1,
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: isMobilePage ? "min(86vw, 340px)" : "auto",
                  transform: isMobilePage
                    ? gpsResumeMobileOuvert
                      ? "translateX(0)"
                      : "translateX(-105%)"
                    : "none",
                  transition: isMobilePage ? "transform 220ms ease" : undefined,
                  padding: 18,
                  borderRight: "1px solid #e5e7eb",
                  background: "#fff",
                  display: "grid",
                  alignContent: "start",
                  gap: 12,
                  overflowY: "auto",
                  minHeight: 0,
                  height: "100%",
                  boxSizing: "border-box",
                  boxShadow:
                    isMobilePage && gpsResumeMobileOuvert
                      ? "8px 0 24px rgba(15,23,42,.16)"
                      : "none",
                }}
              >
                {isMobilePage && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginBottom: -2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setGpsResumeMobileOuvert(false)}
                      aria-label="Fermer le résumé GPS"
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        border: "1px solid #e5e7eb",
                        background: "#f8fafc",
                        fontSize: 24,
                        lineHeight: 1,
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}

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
                  gridColumn: isMobilePage ? "1 / -1" : undefined,
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
                        conducteurContactId: null,
                        nomConducteur: "",
                        telephone: "",
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

                <select
                  className="input"
                  aria-label="Nom conducteur"
                  value={conducteurSelectionneId || (circuitForm.nomConducteur ? "__actuel__" : "")}
                  disabled={contactsChargement || operationEnCours || !!contactsErreur}
                  onChange={(e) => selectionnerConducteur(e.target.value)}
                >
                  <option value="">{contactsChargement ? "Chargement…" : "Aucun conducteur"}</option>
                  {circuitForm.nomConducteur && !conducteursDisponibles.some((contact) => contact.id === conducteurSelectionneId) && (
                    <option value={conducteurSelectionneId || "__actuel__"}>
                      {circuitForm.nomConducteur} · affectation actuelle
                    </option>
                  )}
                  {conducteursDisponibles.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.nom}{contact.typeContact === "Conducteur remplaçant" ? " · remplaçant" : ""}{!contact.actif ? " · inactif" : ""}
                    </option>
                  ))}
                </select>
                <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                  Sélection depuis les contacts. Le téléphone est rempli automatiquement.
                </div>
                {contactsErreur && (
                  <div role="alert" style={{ color: "#b91c1c", fontSize: 12, marginTop: 5 }}>
                    {contactsErreur} <button type="button" className="ghost" onClick={() => void chargerContactsConducteurs()}>Réessayer</button>
                  </div>
                )}
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
                  readOnly={!!conducteurSelectionneId}
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


            <div
              style={{
                marginTop: 18,
                paddingTop: 16,
                borderTop: "1px solid #e5e7eb",
                display: "grid",
                gap: 12,
                padding: 16,
                borderRadius: 14,
                background: circuitForm.profilRhAccepte ? "#f1f5f9" : "#ffffff",
                border: circuitForm.profilRhAccepte
                  ? "1px solid #cbd5e1"
                  : "1px solid #e5e7eb",
                opacity: circuitForm.profilRhAccepte ? 0.78 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>
                    Profil régulier du circuit
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                    Alimenté par les journées régulières de Heures/KM. Les valeurs restent modifiables manuellement.
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {circuitForm.profilRhAccepte ? (
                    <>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "7px 10px",
                          borderRadius: 999,
                          background: "#e2e8f0",
                          color: "#334155",
                          fontSize: 12,
                          fontWeight: 900,
                        }}
                      >
                        ✓ Accepté pour RH
                      </span>
                      <button
                        className="btn"
                        type="button"
                        disabled={operationEnCours}
                        onClick={() => void definirAcceptationProfilRh(false)}
                      >
                        Modifier
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn"
                        type="button"
                        disabled={!circuitActifId || analyseProfilEnCours || operationEnCours}
                        onClick={() => void analyserProfilCircuit()}
                        title={!circuitActifId ? "Enregistre d’abord le circuit" : "Analyser les journées régulières récentes"}
                      >
                        {analyseProfilEnCours ? "Analyse…" : "Analyser"}
                      </button>
                      <button
                        className="btn-primary"
                        type="button"
                        disabled={!circuitActifId || analyseProfilEnCours || operationEnCours}
                        onClick={() => void definirAcceptationProfilRh(true)}
                      >
                        Accepter
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                }}
              >
                <div className="field">
                  <div className="label">KM circuit</div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.1}
                    value={circuitForm.kmCircuit ?? ""}
                    disabled={circuitForm.profilRhAccepte}
                    onChange={(e) =>
                      setCircuitForm((prev) => ({
                        ...prev,
                        kmCircuit: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <div className="label">Nombre d’heures</div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.25}
                    value={circuitForm.nombreHeures ?? ""}
                    disabled={circuitForm.profilRhAccepte}
                    onChange={(e) => {
                      const nombreHeures = e.target.value === "" ? null : Number(e.target.value);
                      setCircuitForm((prev) => ({
                        ...prev,
                        nombreHeures,
                        heuresTotalPaye:
                          nombreHeures == null
                            ? null
                            : Number((nombreHeures + (Number.isFinite(prev.vad) ? prev.vad : 0.25)).toFixed(2)),
                      }));
                    }}
                  />
                </div>

                <div className="field">
                  <div className="label">VAD</div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.25}
                    value={circuitForm.vad}
                    disabled={circuitForm.profilRhAccepte}
                    readOnly={!vadEdition}
                    onDoubleClick={() => {
                      if (!circuitForm.profilRhAccepte) setVadEdition(true);
                    }}
                    onFocus={() => {
                      if (!vadEdition) return;
                    }}
                    onBlur={() => setVadEdition(false)}
                    onChange={(e) => {
                      if (!vadEdition) return;
                      const vad = e.target.value === "" ? 0 : Number(e.target.value);
                      setCircuitForm((prev) => ({
                        ...prev,
                        vad,
                        heuresTotalPaye:
                          prev.nombreHeures == null
                            ? null
                            : Number((prev.nombreHeures + vad).toFixed(2)),
                      }));
                    }}
                    title={vadEdition ? "Modification du VAD activée" : "Double-clique pour modifier le VAD"}
                    style={!vadEdition ? { background: "#f8fafc", cursor: "default" } : undefined}
                  />
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Par défaut 0,25 h · double-clic pour modifier
                  </div>
                </div>

                <div className="field">
                  <div className="label">Heures totales payées</div>
                  <input
                    className="input"
                    value={
                      circuitForm.nombreHeures == null
                        ? ""
                        : (circuitForm.nombreHeures + (Number.isFinite(circuitForm.vad) ? circuitForm.vad : 0.25)).toFixed(2)
                    }
                    readOnly
                    style={{ background: "#f8fafc", fontWeight: 900 }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                }}
              >
                {[
                  ["AM · Heure de départ", "departAmPlanifie"],
                  ["AM · Heure d’arrivée", "arriveeAmPlanifie"],
                  ["PM · Heure de départ", "departPmPlanifie"],
                  ["PM · Heure d’arrivée", "arriveePmPlanifie"],
                ].map(([label, key]) => (
                  <div className="field" key={key}>
                    <div className="label">{label}</div>
                    <input
                      className="input"
                      type="time"
                      value={String(circuitForm[key as "departAmPlanifie" | "arriveeAmPlanifie" | "departPmPlanifie" | "arriveePmPlanifie"] ?? "")}
                      disabled={circuitForm.profilRhAccepte}
                      onChange={(e) => {
                        const value = e.target.value;
                        setCircuitForm((prev) => {
                          const next = { ...prev, [key]: value };
                          const nombreHeuresCalcule = calculNombreHeuresPlanifie(
                            String(next.departAmPlanifie),
                            String(next.arriveeAmPlanifie),
                            String(next.departPmPlanifie),
                            String(next.arriveePmPlanifie)
                          );
                          return {
                            ...next,
                            nombreHeures:
                              nombreHeuresCalcule == null ? prev.nombreHeures : nombreHeuresCalcule,
                            heuresTotalPaye:
                              nombreHeuresCalcule == null
                                ? prev.heuresTotalPaye
                                : Number((nombreHeuresCalcule + (Number.isFinite(prev.vad) ? prev.vad : 0.25)).toFixed(2)),
                          };
                        });
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="muted" style={{ fontSize: 12 }}>
                Nombre d’heures : les durées sont arrondies au 0,25 h. Une durée plus élevée est retenue comme récurrente lorsqu’elle apparaît dans au moins 35 % des journées régulières retenues. Si un nouveau régime d’heures ou de KM devient récurrent dans les journées les plus récentes, l’ancien historique est écarté.
              </div>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: circuitForm.profilRhAccepte ? "#e2e8f0" : "#fffbeb",
                  border: circuitForm.profilRhAccepte ? "1px solid #cbd5e1" : "1px solid #fde68a",
                  fontSize: 12,
                  fontWeight: 700,
                  color: circuitForm.profilRhAccepte ? "#334155" : "#92400e",
                }}
              >
                {circuitForm.profilRhAccepte
                  ? `Profil corroboré pour RH${circuitForm.profilRhAcceptePar ? ` par ${circuitForm.profilRhAcceptePar}` : ""}${circuitForm.profilRhAccepteLe ? ` · ${new Date(circuitForm.profilRhAccepteLe).toLocaleString("fr-CA")}` : ""}. Clique sur « Modifier » pour le déverrouiller et l’analyser de nouveau.`
                  : "Profil non accepté : RH doit l’ignorer jusqu’à ce qu’une personne clique sur « Accepter »."}
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
                        <th rowSpan={2} style={{ verticalAlign: "middle", borderLeft: "1px solid #cbd5e1", paddingLeft: 14 }}>KM total</th>
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
                            <td style={{ borderLeft: "1px solid #e2e8f0", paddingLeft: 14 }}>
                              <strong>{(Math.max(0, jour.kmAm) + Math.max(0, jour.kmPm)).toFixed(1)}</strong>
                            </td>
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
    </div>
  );
}