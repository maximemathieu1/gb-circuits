import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { circuitSupabase } from "../lib/circuitSupabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

export default function CircuitsScolairesPage() {
  const inputFichierRef =
    useRef<HTMLInputElement | null>(null);

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
    setModalCircuitOuvert(true);
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
  }

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
                    colSpan={7}
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