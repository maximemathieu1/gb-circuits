import { useMemo, useState } from "react";

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

type CircuitScolaire = {
  id: string;
  circuit: string;
  unite: string;
  nomConducteur: string;
  telephone: string;
  localisation: string;
  compagnie: Compagnie;
};

type ContactUrgence = {
  id: string;
  organisation: Organisation;
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

const circuitsDemo: CircuitScolaire[] = [
  {
    id: "1",
    circuit: "006",
    unite: "508",
    nomConducteur: "Martin Gagnon",
    telephone: "418-555-1234",
    localisation: "Saint-Georges",
    compagnie: "Autobus Breton",
  },
  {
    id: "2",
    circuit: "03601",
    unite: "512",
    nomConducteur: "Alain Roy",
    telephone: "418-555-5678",
    localisation: "Beauceville",
    compagnie: "Autobus Breton",
  },
  {
    id: "3",
    circuit: "C-201",
    unite: "334",
    nomConducteur: "Marc Poulin",
    telephone: "418-555-9876",
    localisation: "Saint-Joseph",
    compagnie: "Autobus Champagne",
  },
  {
    id: "4",
    circuit: "S-101",
    unite: "701",
    nomConducteur: "Jean Tremblay",
    telephone: "418-555-2222",
    localisation: "Saint-Georges",
    compagnie: "Transport Sécuritaire",
  },
];

const contactsInitiaux: ContactUrgence[] = [];

const contactVide: Omit<ContactUrgence, "id"> = {
  organisation: "Groupe Breton",
  nom: "",
  fonction: "",
  telephone: "",
  telephone2: "",
  notes: "",
};

const remplacantVide: Omit<ConducteurRemplacant, "id"> = {
  nom: "",
  telephone: "",
  compagnie: "Autobus Breton",
};

function creerId() {
  return crypto.randomUUID?.() || String(Date.now());
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export default function CircuitsScolairesPage() {
  const [circuits] = useState<CircuitScolaire[]>(circuitsDemo);
  const [contacts, setContacts] =
    useState<ContactUrgence[]>(contactsInitiaux);
  const [remplacants, setRemplacants] =
    useState<ConducteurRemplacant[]>([]);

  const [recherche, setRecherche] = useState("");
  const [compagnie, setCompagnie] =
    useState<Compagnie | "Toutes">("Toutes");

  const [tri, setTri] = useState<ColonneTriCircuit>("circuit");
  const [direction, setDirection] =
    useState<"asc" | "desc">("asc");

  const [modalContactOuvert, setModalContactOuvert] =
    useState(false);
  const [contactActifId, setContactActifId] =
    useState<string | null>(null);
  const [contactForm, setContactForm] =
    useState<Omit<ContactUrgence, "id">>(contactVide);

  const [modalRemplacantOuvert, setModalRemplacantOuvert] =
    useState(false);
  const [remplacantActifId, setRemplacantActifId] =
    useState<string | null>(null);
  const [remplacantForm, setRemplacantForm] =
    useState<Omit<ConducteurRemplacant, "id">>(remplacantVide);

  function changerTri(colonne: ColonneTriCircuit) {
    if (tri === colonne) {
      setDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setTri(colonne);
      setDirection("asc");
    }
  }

  function indicateurTri(colonne: ColonneTriCircuit) {
    if (tri !== colonne) return "";
    return direction === "asc" ? " ↑" : " ↓";
  }

  const circuitsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();

    const resultat = circuits.filter((item) => {
      const okCompagnie =
        compagnie === "Toutes" || item.compagnie === compagnie;

      const okRecherche =
        !q ||
        item.circuit.toLowerCase().includes(q) ||
        item.unite.toLowerCase().includes(q) ||
        item.nomConducteur.toLowerCase().includes(q) ||
        item.telephone.toLowerCase().includes(q) ||
        item.localisation.toLowerCase().includes(q) ||
        item.compagnie.toLowerCase().includes(q);

      return okCompagnie && okRecherche;
    });

    resultat.sort((a, b) => {
      const valeurA = a[tri].toLowerCase();
      const valeurB = b[tri].toLowerCase();

      const comparaison = valeurA.localeCompare(valeurB, "fr", {
        numeric: true,
        sensitivity: "base",
      });

      return direction === "asc" ? comparaison : -comparaison;
    });

    return resultat;
  }, [circuits, recherche, compagnie, tri, direction]);

  const remplacantsFiltres = useMemo(() => {
    if (compagnie === "Toutes") return remplacants;

    return remplacants.filter(
      (item) => item.compagnie === compagnie
    );
  }, [remplacants, compagnie]);

  function ouvrirAjoutContact() {
    setContactActifId(null);
    setContactForm(contactVide);
    setModalContactOuvert(true);
  }

  function ouvrirModificationContact(contact: ContactUrgence) {
    setContactActifId(contact.id);

    setContactForm({
      organisation: contact.organisation,
      nom: contact.nom,
      fonction: contact.fonction,
      telephone: contact.telephone,
      telephone2: contact.telephone2,
      notes: contact.notes,
    });

    setModalContactOuvert(true);
  }

  function fermerModalContact() {
    setModalContactOuvert(false);
    setContactActifId(null);
    setContactForm(contactVide);
  }

  function enregistrerContact() {
    const nom = contactForm.nom.trim();

    if (!nom) {
      alert("Le nom du contact est obligatoire.");
      return;
    }

    const contactSauvegarde: ContactUrgence = {
      id: contactActifId || creerId(),
      organisation: contactForm.organisation,
      nom,
      fonction: contactForm.fonction.trim(),
      telephone: contactForm.telephone.trim(),
      telephone2: contactForm.telephone2.trim(),
      notes: contactForm.notes.trim(),
    };

    if (contactActifId) {
      setContacts((prev) =>
        prev.map((contact) =>
          contact.id === contactActifId
            ? contactSauvegarde
            : contact
        )
      );
    } else {
      setContacts((prev) => [...prev, contactSauvegarde]);
    }

    fermerModalContact();
  }

  function supprimerContact() {
    if (!contactActifId) return;

    const ok = confirm("Supprimer ce contact d’urgence?");
    if (!ok) return;

    setContacts((prev) =>
      prev.filter((contact) => contact.id !== contactActifId)
    );

    fermerModalContact();
  }

  function ouvrirAjoutRemplacant() {
    setRemplacantActifId(null);
    setRemplacantForm({
      ...remplacantVide,
      compagnie:
        compagnie === "Toutes" ? "Autobus Breton" : compagnie,
    });
    setModalRemplacantOuvert(true);
  }

  function ouvrirModificationRemplacant(
    remplacant: ConducteurRemplacant
  ) {
    setRemplacantActifId(remplacant.id);

    setRemplacantForm({
      nom: remplacant.nom,
      telephone: remplacant.telephone,
      compagnie: remplacant.compagnie,
    });

    setModalRemplacantOuvert(true);
  }

  function fermerModalRemplacant() {
    setModalRemplacantOuvert(false);
    setRemplacantActifId(null);
    setRemplacantForm(remplacantVide);
  }

  function enregistrerRemplacant() {
    const nom = remplacantForm.nom.trim();

    if (!nom) {
      alert("Le nom du conducteur est obligatoire.");
      return;
    }

    const remplacantSauvegarde: ConducteurRemplacant = {
      id: remplacantActifId || creerId(),
      nom,
      telephone: remplacantForm.telephone.trim(),
      compagnie: remplacantForm.compagnie,
    };

    if (remplacantActifId) {
      setRemplacants((prev) =>
        prev.map((item) =>
          item.id === remplacantActifId
            ? remplacantSauvegarde
            : item
        )
      );
    } else {
      setRemplacants((prev) => [
        ...prev,
        remplacantSauvegarde,
      ]);
    }

    fermerModalRemplacant();
  }

  function supprimerRemplacant() {
    if (!remplacantActifId) return;

    const ok = confirm(
      "Supprimer ce conducteur remplaçant?"
    );

    if (!ok) return;

    setRemplacants((prev) =>
      prev.filter((item) => item.id !== remplacantActifId)
    );

    fermerModalRemplacant();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Circuits scolaire</h1>
          <div className="muted">
            Répertoire des circuits scolaires, contacts d’urgence
            et conducteurs remplaçants.
          </div>
        </div>

        <div className="page-actions">
          <button className="btn-primary" type="button">
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
              placeholder="Circuit, unité, conducteur, téléphone ou localisation..."
            />
          </div>

          <div className="field">
            <div className="label">Compagnie</div>

            <select
              className="input"
              value={compagnie}
              onChange={(e) =>
                setCompagnie(
                  e.target.value as Compagnie | "Toutes"
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

      <div className="card" style={{ marginBottom: 14 }}>
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
            onClick={ouvrirAjoutContact}
          >
            + Ajouter un contact
          </button>
        </div>

        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Nom</th>
                <th>Fonction</th>
                <th>Téléphone</th>
                <th>Téléphone 2</th>
              </tr>
            </thead>

            <tbody>
              {contacts.map((contact) => (
                <tr
                  className="row"
                  key={contact.id}
                  onDoubleClick={() =>
                    ouvrirModificationContact(contact)
                  }
                  title="Double-clic pour modifier"
                >
                  <td>{contact.organisation}</td>

                  <td>
                    <strong>{contact.nom}</strong>
                  </td>

                  <td>
                    {contact.fonction || (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td>
                    {contact.telephone ? (
                      <a href={telHref(contact.telephone)}>
                        {contact.telephone}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td>
                    {contact.telephone2 ? (
                      <a href={telHref(contact.telephone2)}>
                        {contact.telephone2}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {contacts.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Aucun contact d’urgence.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="hint">
          Double-clic sur un contact pour le modifier.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Circuits</div>

            <div className="card-subtitle">
              Clique sur un titre de colonne pour trier le tableau.
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th
                  className="sortable-head"
                  onClick={() => changerTri("circuit")}
                >
                  Circuit{indicateurTri("circuit")}
                </th>

                <th
                  className="sortable-head"
                  onClick={() => changerTri("unite")}
                >
                  Unité{indicateurTri("unite")}
                </th>

                <th
                  className="sortable-head"
                  onClick={() =>
                    changerTri("nomConducteur")
                  }
                >
                  Nom conducteur
                  {indicateurTri("nomConducteur")}
                </th>

                <th
                  className="sortable-head"
                  onClick={() => changerTri("telephone")}
                >
                  Téléphone
                  {indicateurTri("telephone")}
                </th>

                <th
                  className="sortable-head"
                  onClick={() => changerTri("localisation")}
                >
                  Localisation
                  {indicateurTri("localisation")}
                </th>

                <th
                  className="sortable-head"
                  onClick={() => changerTri("compagnie")}
                >
                  Compagnie
                  {indicateurTri("compagnie")}
                </th>
              </tr>
            </thead>

            <tbody>
              {circuitsFiltres.map((item) => (
                <tr className="row" key={item.id}>
                  <td>
                    <strong>{item.circuit}</strong>
                  </td>

                  <td>{item.unite}</td>

                  <td>{item.nomConducteur}</td>

                  <td>
                    <a href={telHref(item.telephone)}>
                      {item.telephone}
                    </a>
                  </td>

                  <td>{item.localisation}</td>

                  <td>{item.compagnie}</td>
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
      </div>

      <div
        className="card"
        style={{ marginTop: 14 }}
      >
        <div className="card-head">
          <div>
            <div className="card-title">
              Conducteurs remplaçants
            </div>

            <div className="card-subtitle">
              Liste des conducteurs disponibles pour effectuer
              des remplacements.
            </div>
          </div>

          <button
            className="btn-primary"
            type="button"
            onClick={ouvrirAjoutRemplacant}
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
              {remplacantsFiltres.map((item) => (
                <tr
                  className="row"
                  key={item.id}
                  onDoubleClick={() =>
                    ouvrirModificationRemplacant(item)
                  }
                  title="Double-clic pour modifier"
                >
                  <td>
                    <strong>{item.nom}</strong>
                  </td>

                  <td>
                    {item.telephone ? (
                      <a href={telHref(item.telephone)}>
                        {item.telephone}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td>{item.compagnie}</td>
                </tr>
              ))}

              {remplacantsFiltres.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Aucun conducteur remplaçant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="hint">
          Double-clic sur un conducteur pour le modifier.
        </div>
      </div>

      {modalContactOuvert && (
        <div
          className="modal-backdrop"
          onMouseDown={fermerModalContact}
        >
          <div
            className="modal-card"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {contactActifId
                    ? "Modifier le contact d’urgence"
                    : "Ajouter un contact d’urgence"}
                </div>

                <div className="muted">
                  Coordonnées du contact.
                </div>
              </div>

              <button
                className="ghost"
                type="button"
                onClick={fermerModalContact}
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
                  value={contactForm.organisation}
                  onChange={(e) =>
                    setContactForm((prev) => ({
                      ...prev,
                      organisation:
                        e.target.value as Organisation,
                    }))
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

              <div className="field">
                <div className="label">Nom</div>

                <input
                  className="input"
                  value={contactForm.nom}
                  onChange={(e) =>
                    setContactForm((prev) => ({
                      ...prev,
                      nom: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="field">
                <div className="label">Fonction</div>

                <input
                  className="input"
                  value={contactForm.fonction}
                  onChange={(e) =>
                    setContactForm((prev) => ({
                      ...prev,
                      fonction: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="field">
                <div className="label">Téléphone</div>

                <input
                  className="input"
                  value={contactForm.telephone}
                  onChange={(e) =>
                    setContactForm((prev) => ({
                      ...prev,
                      telephone: e.target.value,
                    }))
                  }
                  placeholder="418-555-1234"
                />
              </div>

              <div className="field">
                <div className="label">Téléphone 2</div>

                <input
                  className="input"
                  value={contactForm.telephone2}
                  onChange={(e) =>
                    setContactForm((prev) => ({
                      ...prev,
                      telephone2: e.target.value,
                    }))
                  }
                  placeholder="418-555-5678"
                />
              </div>
            </div>

            <div
              className="field"
              style={{ marginTop: 12 }}
            >
              <div className="label">Notes</div>

              <textarea
                className="input"
                value={contactForm.notes}
                onChange={(e) =>
                  setContactForm((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
              />
            </div>

            <div className="modal-actions">
              {contactActifId && (
                <button
                  className="btn-danger"
                  type="button"
                  onClick={supprimerContact}
                >
                  Supprimer
                </button>
              )}

              <div className="modal-actions-right">
                <button
                  className="ghost"
                  type="button"
                  onClick={fermerModalContact}
                >
                  Annuler
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={enregistrerContact}
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalRemplacantOuvert && (
        <div
          className="modal-backdrop"
          onMouseDown={fermerModalRemplacant}
        >
          <div
            className="modal-card"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {remplacantActifId
                    ? "Modifier le conducteur remplaçant"
                    : "Ajouter un conducteur remplaçant"}
                </div>

                <div className="muted">
                  Coordonnées du conducteur remplaçant.
                </div>
              </div>

              <button
                className="ghost"
                type="button"
                onClick={fermerModalRemplacant}
              >
                Fermer
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <div className="label">Nom</div>

                <input
                  className="input"
                  value={remplacantForm.nom}
                  onChange={(e) =>
                    setRemplacantForm((prev) => ({
                      ...prev,
                      nom: e.target.value,
                    }))
                  }
                  placeholder="Nom du conducteur"
                />
              </div>

              <div className="field">
                <div className="label">Téléphone</div>

                <input
                  className="input"
                  value={remplacantForm.telephone}
                  onChange={(e) =>
                    setRemplacantForm((prev) => ({
                      ...prev,
                      telephone: e.target.value,
                    }))
                  }
                  placeholder="418-555-1234"
                />
              </div>

              <div className="field">
                <div className="label">Compagnie</div>

                <select
                  className="input"
                  value={remplacantForm.compagnie}
                  onChange={(e) =>
                    setRemplacantForm((prev) => ({
                      ...prev,
                      compagnie:
                        e.target.value as Compagnie,
                    }))
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
                  onClick={supprimerRemplacant}
                >
                  Supprimer
                </button>
              )}

              <div className="modal-actions-right">
                <button
                  className="ghost"
                  type="button"
                  onClick={fermerModalRemplacant}
                >
                  Annuler
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={enregistrerRemplacant}
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