import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Transporteur =
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

type Circuit = {
  id: string;
  transporteur: Transporteur;
  numeroCircuit: string;
  numeroBus: string;
  conducteur: string;
  telephone: string;
  notes?: string;
  documents?: CircuitDocument[];
};

type CircuitForm = Omit<Circuit, "id" | "documents"> & {
  documents: CircuitDocument[];
};

const BUCKET_DOCUMENTS = "circuits-scolaires-pdf";

const circuitVide: CircuitForm = {
  transporteur: "Autobus Breton",
  numeroCircuit: "",
  numeroBus: "",
  conducteur: "",
  telephone: "",
  notes: "",
  documents: [],
};

const circuitsInitiaux: Circuit[] = [
  {
    id: "1",
    transporteur: "Autobus Breton",
    numeroCircuit: "B-101",
    numeroBus: "508",
    conducteur: "Martin Gagnon",
    telephone: "418-555-1234",
    documents: [],
  },
];

const fichiersAcceptes =
  "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*";

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function creerId() {
  return crypto.randomUUID?.() || String(Date.now());
}

function dossierTransporteur(transporteur: Transporteur) {
  switch (transporteur) {
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
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function typeCourt(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("image")) return "Image";
  if (mime.includes("word")) return "Word";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "Excel";
  return "Doc";
}

export default function CircuitsScolairePage() {
  const inputFileRef = useRef<HTMLInputElement | null>(null);

  const [circuits, setCircuits] = useState<Circuit[]>(circuitsInitiaux);
  const [recherche, setRecherche] = useState("");
  const [transporteur, setTransporteur] = useState<Transporteur | "Tous">(
    "Tous"
  );

  const [modalOuvert, setModalOuvert] = useState(false);
  const [circuitActifId, setCircuitActifId] = useState<string | null>(null);
  const [form, setForm] = useState<CircuitForm>(circuitVide);

  const [operationEnCours, setOperationEnCours] = useState(false);
  const [dragActif, setDragActif] = useState(false);

  const circuitsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();

    return circuits.filter((circuit) => {
      const okTransporteur =
        transporteur === "Tous" || circuit.transporteur === transporteur;

      const okRecherche =
        !q ||
        circuit.numeroCircuit.toLowerCase().includes(q) ||
        circuit.transporteur.toLowerCase().includes(q) ||
        circuit.numeroBus.toLowerCase().includes(q) ||
        circuit.conducteur.toLowerCase().includes(q) ||
        circuit.telephone.toLowerCase().includes(q);

      return okTransporteur && okRecherche;
    });
  }, [circuits, recherche, transporteur]);

  function ouvrirAjout() {
    setCircuitActifId(null);
    setForm({ ...circuitVide, documents: [] });
    setModalOuvert(true);
  }

  function ouvrirModification(circuit: Circuit) {
    setCircuitActifId(circuit.id);
    setForm({
      transporteur: circuit.transporteur,
      numeroCircuit: circuit.numeroCircuit,
      numeroBus: circuit.numeroBus,
      conducteur: circuit.conducteur,
      telephone: circuit.telephone,
      notes: circuit.notes || "",
      documents: circuit.documents || [],
    });
    setModalOuvert(true);
  }

  function fermerModal() {
    if (operationEnCours) return;
    setModalOuvert(false);
    setCircuitActifId(null);
    setForm({ ...circuitVide, documents: [] });
    setDragActif(false);
  }

  async function ajouterDocuments(files: FileList | File[]) {
    const liste = Array.from(files);
    if (liste.length === 0) return;

    const numeroCircuit = form.numeroCircuit.trim();

    if (!numeroCircuit) {
      alert("Inscris le numéro de circuit avant d’ajouter un document.");
      return;
    }

    const circuitId = circuitActifId || creerId();

    try {
      setOperationEnCours(true);

      const nouveauxDocuments: CircuitDocument[] = [];

      for (const file of liste) {
        const dossier = dossierTransporteur(form.transporteur);
        const nomNettoye = nettoyerNomFichier(file.name);
        const storagePath = `${dossier}/${numeroCircuit}/${Date.now()}_${nomNettoye}`;

        const { error } = await supabase.storage
          .from(BUCKET_DOCUMENTS)
          .upload(storagePath, file, {
            contentType: file.type || "application/octet-stream",
            upsert: true,
          });

        if (error) throw error;

        const { data } = supabase.storage
          .from(BUCKET_DOCUMENTS)
          .getPublicUrl(storagePath);

        nouveauxDocuments.push({
          id: creerId(),
          circuitId,
          nom: file.name,
          storagePath,
          publicUrl: data.publicUrl,
          mimeType: file.type || "application/octet-stream",
          taille: file.size,
        });
      }

      setForm((prev) => ({
        ...prev,
        documents: [...prev.documents, ...nouveauxDocuments],
      }));
    } catch (error) {
      console.error(error);
      alert("Erreur pendant l’envoi du document.");
    } finally {
      setOperationEnCours(false);
    }
  }

  async function supprimerDocument(document: CircuitDocument) {
    const ok = confirm(`Supprimer le document "${document.nom}"?`);
    if (!ok) return;

    try {
      setOperationEnCours(true);

      const { error } = await supabase.storage
        .from(BUCKET_DOCUMENTS)
        .remove([document.storagePath]);

      if (error) throw error;

      setForm((prev) => ({
        ...prev,
        documents: prev.documents.filter((doc) => doc.id !== document.id),
      }));
    } catch (error) {
      console.error(error);
      alert("Erreur pendant la suppression du document.");
    } finally {
      setOperationEnCours(false);
    }
  }

  function enregistrerCircuit() {
    const numeroCircuit = form.numeroCircuit.trim();

    if (!numeroCircuit) {
      alert("Le numéro de circuit est obligatoire.");
      return;
    }

    const circuitSauvegarde: Circuit = {
      id: circuitActifId || creerId(),
      transporteur: form.transporteur,
      numeroCircuit,
      numeroBus: form.numeroBus.trim(),
      conducteur: form.conducteur.trim(),
      telephone: form.telephone.trim(),
      notes: form.notes?.trim() || "",
      documents: form.documents,
    };

    if (circuitActifId) {
      setCircuits((prev) =>
        prev.map((circuit) =>
          circuit.id === circuitActifId ? circuitSauvegarde : circuit
        )
      );
    } else {
      setCircuits((prev) => [circuitSauvegarde, ...prev]);
    }

    fermerModal();
  }

  function supprimerCircuit() {
    if (!circuitActifId) return;

    const ok = confirm("Supprimer ce circuit?");
    if (!ok) return;

    setCircuits((prev) =>
      prev.filter((circuit) => circuit.id !== circuitActifId)
    );

    fermerModal();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Circuits scolaire</h1>
          <div className="muted">
            Liste officielle des circuits, autobus, conducteurs et documents.
          </div>
        </div>

        <div className="page-actions">
          <button className="btn-primary" type="button" onClick={ouvrirAjout}>
            + Ajouter un circuit
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="form-grid">
          <div className="field">
            <div className="label">Recherche</div>
            <input
              className="input"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Circuit, bus, conducteur ou téléphone..."
            />
          </div>

          <div className="field">
            <div className="label">Transporteur</div>
            <select
              className="input"
              value={transporteur}
              onChange={(e) =>
                setTransporteur(e.target.value as Transporteur | "Tous")
              }
            >
              <option value="Tous">Tous les transporteurs</option>
              <option value="Autobus Breton">Autobus Breton</option>
              <option value="Autobus Champagne">Autobus Champagne</option>
              <option value="Transport Sécuritaire">
                Transport Sécuritaire
              </option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Transporteur</th>
                <th>Bus</th>
                <th>Conducteur</th>
                <th>Téléphone</th>
                <th>Documents</th>
              </tr>
            </thead>

            <tbody>
              {circuitsFiltres.map((circuit) => (
                <tr
                  className="row"
                  key={circuit.id}
                  onDoubleClick={() => ouvrirModification(circuit)}
                  title="Double-clic pour modifier"
                >
                  <td>
                    <strong>{circuit.numeroCircuit}</strong>
                  </td>
                  <td>{circuit.transporteur}</td>
                  <td>{circuit.numeroBus || <span className="muted">—</span>}</td>
                  <td>
                    {circuit.conducteur || <span className="muted">—</span>}
                  </td>
                  <td>
                    {circuit.telephone ? (
                      <a href={telHref(circuit.telephone)}>
                        {circuit.telephone}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {circuit.documents?.length ? (
                      `${circuit.documents.length} document(s)`
                    ) : (
                      <span className="muted">Aucun document</span>
                    )}
                  </td>
                </tr>
              ))}

              {circuitsFiltres.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Aucun circuit trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="hint">
          Double-clic sur une ligne pour ouvrir la fiche du circuit.
        </div>
      </div>

      {modalOuvert && (
        <div className="modal-backdrop" onMouseDown={fermerModal}>
          <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {circuitActifId ? "Modifier le circuit" : "Ajouter un circuit"}
                </div>
                <div className="muted">
                  Informations officielles et documents du circuit.
                </div>
              </div>

              <button className="ghost" type="button" onClick={fermerModal}>
                Fermer
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <div className="label">Numéro de circuit</div>
                <input
                  className="input"
                  value={form.numeroCircuit}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      numeroCircuit: e.target.value,
                    }))
                  }
                  placeholder="Ex: B-101"
                />
              </div>

              <div className="field">
                <div className="label">Transporteur</div>
                <select
                  className="input"
                  value={form.transporteur}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      transporteur: e.target.value as Transporteur,
                    }))
                  }
                >
                  <option value="Autobus Breton">Autobus Breton</option>
                  <option value="Autobus Champagne">Autobus Champagne</option>
                  <option value="Transport Sécuritaire">
                    Transport Sécuritaire
                  </option>
                </select>
              </div>

              <div className="field">
                <div className="label">Numéro de bus</div>
                <input
                  className="input"
                  value={form.numeroBus}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      numeroBus: e.target.value,
                    }))
                  }
                  placeholder="Ex: 508"
                />
              </div>

              <div className="field">
                <div className="label">Conducteur</div>
                <input
                  className="input"
                  value={form.conducteur}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      conducteur: e.target.value,
                    }))
                  }
                  placeholder="Nom du conducteur"
                />
              </div>

              <div className="field">
                <div className="label">Téléphone</div>
                <input
                  className="input"
                  value={form.telephone}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      telephone: e.target.value,
                    }))
                  }
                  placeholder="418-555-1234"
                />
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">Documents du circuit</div>

              <input
                ref={inputFileRef}
                type="file"
                multiple
                accept={fichiersAcceptes}
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) ajouterDocuments(e.target.files);
                  e.currentTarget.value = "";
                }}
              />

              <div
                className={"pdf-dropzone" + (dragActif ? " is-dragging" : "")}
                onClick={() => inputFileRef.current?.click()}
                onDoubleClick={() => inputFileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActif(true);
                }}
                onDragLeave={() => setDragActif(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActif(false);
                  ajouterDocuments(e.dataTransfer.files);
                }}
              >
                <div className="pdf-dropzone-title">
                  Glisser les fichiers ici
                </div>
                <div className="muted">
                  PDF, images, Word ou Excel. Clic ou double-clic pour
                  sélectionner.
                </div>
              </div>

              {form.documents.length > 0 && (
                <div className="documents-list">
                  {form.documents.map((doc) => (
                    <div className="document-row" key={doc.id}>
                      <div>
                        <div className="document-name">{doc.nom}</div>
                        <div className="muted">
                          {typeCourt(doc.mimeType)} · {formatTaille(doc.taille)}
                        </div>
                      </div>

                      <div className="document-actions">
                        <a
                          className="btn"
                          href={doc.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ouvrir
                        </a>

                        <button
                          className="btn-danger"
                          type="button"
                          onClick={() => supprimerDocument(doc)}
                          disabled={operationEnCours}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">Notes</div>
              <textarea
                className="input"
                value={form.notes || ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
                placeholder="Notes internes..."
              />
            </div>

            <div className="modal-actions">
              {circuitActifId && (
                <button
                  className="btn-danger"
                  type="button"
                  onClick={supprimerCircuit}
                  disabled={operationEnCours}
                >
                  Supprimer le circuit
                </button>
              )}

              <div className="modal-actions-right">
                <button
                  className="ghost"
                  type="button"
                  onClick={fermerModal}
                  disabled={operationEnCours}
                >
                  Annuler
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={enregistrerCircuit}
                  disabled={operationEnCours}
                >
                  {operationEnCours ? "Traitement..." : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}