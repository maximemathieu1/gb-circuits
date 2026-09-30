import { useEffect, useMemo, useState } from "react";
import { circuitSupabase } from "../lib/circuitSupabase";

type Organisation =
  | "Autobus Breton"
  | "Autobus Champagne"
  | "Transport Sécuritaire"
  | "Groupe Breton"
  | "CSSBE"
  | "Autre";

type TypeContact =
  | "Urgence"
  | "Conducteur"
  | "Conducteur remplaçant"
  | "Direction"
  | "CSSBE"
  | "Mécanique"
  | "Répartition"
  | "Fournisseur"
  | "Autre";

type Onglet = "urgence" | "conducteurs" | "organisations";

type Compagnie =
  | "Autobus Breton"
  | "Autobus Champagne"
  | "Transport Sécuritaire";

type Contact = {
  id: string;
  organisation: Organisation;
  organisationAutre: string;
  typeContact: TypeContact;
  nom: string;
  fonction: string;
  telephone: string;
  telephone2: string;
  courriel: string;
  notes: string;
  actif: boolean;
};

type CircuitConducteurRaw = {
  id: string;
  circuit: string;
  unite: string;
  nomConducteur: string;
  telephone: string;
  compagnie: Compagnie;
  conducteurContactId: string | null;
};

type ConducteurAffiche = {
  key: string;
  source: "regulier" | "remplacant";
  contactId: string;
  nom: string;
  telephone: string;
  compagnie: Compagnie;
  circuits: string[];
  unites: string[];
};

const organisations: Organisation[] = [
  "Autobus Breton",
  "Autobus Champagne",
  "Transport Sécuritaire",
  "Groupe Breton",
  "CSSBE",
  "Autre",
];

const typesContact: TypeContact[] = [
  "Urgence",
  "Conducteur",
  "Conducteur remplaçant",
  "Direction",
  "CSSBE",
  "Mécanique",
  "Répartition",
  "Fournisseur",
  "Autre",
];

const compagnies: Compagnie[] = [
  "Autobus Breton",
  "Autobus Champagne",
  "Transport Sécuritaire",
];

const contactVide: Omit<Contact, "id"> = {
  organisation: "Groupe Breton",
  organisationAutre: "",
  typeContact: "Direction",
  nom: "",
  fonction: "",
  telephone: "",
  telephone2: "",
  courriel: "",
  notes: "",
  actif: true,
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function organisationLabel(contact: Contact) {
  return contact.organisation === "Autre"
    ? contact.organisationAutre || "Autre"
    : contact.organisation;
}

function compagnieDepuisOrganisation(
  organisation: Organisation,
): Compagnie | null {
  if (
    organisation === "Autobus Breton" ||
    organisation === "Autobus Champagne" ||
    organisation === "Transport Sécuritaire"
  ) {
    return organisation;
  }
  return null;
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function mailHref(email: string) {
  return `mailto:${email.trim()}`;
}

function shortCompagnie(compagnie: Compagnie) {
  if (compagnie === "Autobus Breton") return "B";
  if (compagnie === "Autobus Champagne") return "C";
  return "S";
}

function estOrganisationInterne(organisation: Organisation) {
  return (
    organisation === "Autobus Breton" ||
    organisation === "Autobus Champagne" ||
    organisation === "Transport Sécuritaire" ||
    organisation === "Groupe Breton"
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 42,
  border: "1px solid #d6dce5",
  borderRadius: 8,
  padding: "9px 11px",
  background: "#fff",
  boxSizing: "border-box",
};

const tabStyle = (
  actif: boolean,
): React.CSSProperties => ({
  minHeight: 38,
  borderRadius: 9,
  padding: "8px 14px",
  border: actif ? "1px solid #2f6fed" : "1px solid #d0d5dd",
  background: actif ? "#2f6fed" : "#fff",
  color: actif ? "#fff" : "#101828",
  fontWeight: 800,
  cursor: "pointer",
});

const filterButtonStyle = (
  actif: boolean,
): React.CSSProperties => ({
  minHeight: 34,
  borderRadius: 9,
  padding: "6px 11px",
  border: actif ? "1px solid #9bb7ff" : "1px solid #d0d5dd",
  background: actif ? "#eef4ff" : "#fff",
  color: actif ? "#12398f" : "#344054",
  fontWeight: 800,
  cursor: "pointer",
});

export default function ContactsPage() {
  const [isMobilePage, setIsMobilePage] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 820px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const syncMobile = () => setIsMobilePage(media.matches);

    syncMobile();
    media.addEventListener("change", syncMobile);

    return () => {
      media.removeEventListener("change", syncMobile);
    };
  }, []);

  const [onglet, setOnglet] = useState<Onglet>("urgence");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [circuitsConducteurs, setCircuitsConducteurs] = useState<
    CircuitConducteurRaw[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState("");

  const [recherche, setRecherche] = useState("");
  const [compagniesSelectionnees, setCompagniesSelectionnees] =
    useState<Compagnie[]>([...compagnies]);
  const [filtreConducteur, setFiltreConducteur] = useState<
    "Tous" | "Remplaçants"
  >("Tous");

  const [organisationFiltre, setOrganisationFiltre] =
    useState<Organisation | "Toutes">("Toutes");

  const [modalOuvert, setModalOuvert] = useState(false);
  const [contactActifId, setContactActifId] = useState<string | null>(
    null,
  );
  const [form, setForm] =
    useState<Omit<Contact, "id">>(contactVide);
  const [saving, setSaving] = useState(false);

  async function chargerDonnees() {
    setLoading(true);
    setErreur("");

    const [contactsResult, circuitsResult] = await Promise.all([
      circuitSupabase
        .from("contacts")
        .select("*")
        .order("organisation", { ascending: true })
        .order("nom", { ascending: true }),
      circuitSupabase
        .from("circuits_scolaires")
        .select(
          "id,circuit,unite,nom_conducteur,telephone,compagnie,conducteur_contact_id",
        )
        .order("circuit", { ascending: true }),
    ]);

    if (contactsResult.error) {
      setErreur(contactsResult.error.message);
      setLoading(false);
      return;
    }

    if (circuitsResult.error) {
      setErreur(circuitsResult.error.message);
      setLoading(false);
      return;
    }

    const contactsMapped: Contact[] = (
      contactsResult.data ?? []
    ).map((item: any) => ({
      id: String(item.id),
      organisation: item.organisation as Organisation,
      organisationAutre: item.organisation_autre ?? "",
      typeContact: item.type_contact as TypeContact,
      nom: item.nom ?? "",
      fonction: item.fonction ?? "",
      telephone: item.telephone ?? "",
      telephone2: item.telephone2 ?? "",
      courriel: item.courriel ?? "",
      notes: item.notes ?? "",
      actif: item.actif !== false,
    }));

    const circuitsMapped: CircuitConducteurRaw[] = (
      circuitsResult.data ?? []
    )
      .filter(
        (item: any) =>
          String(item?.nom_conducteur ?? "").trim() !== "",
      )
      .filter((item: any) =>
        compagnies.includes(item.compagnie as Compagnie),
      )
      .map((item: any) => ({
        id: String(item.id),
        circuit: String(item.circuit ?? ""),
        unite: String(item.unite ?? ""),
        nomConducteur: String(item.nom_conducteur ?? ""),
        telephone: String(item.telephone ?? ""),
        compagnie: item.compagnie as Compagnie,
        conducteurContactId: item.conducteur_contact_id
          ? String(item.conducteur_contact_id)
          : null,
      }));

    setContacts(contactsMapped);
    setCircuitsConducteurs(circuitsMapped);
    setLoading(false);
  }

  useEffect(() => {
    void chargerDonnees();
  }, []);

  const contactsUrgence = useMemo(() => {
    const q = normalize(recherche);

    return contacts
      .filter((contact) => contact.actif)
      .filter((contact) => contact.typeContact === "Urgence")
      .filter((contact) => {
        if (!q) return true;
        return [
          organisationLabel(contact),
          contact.nom,
          contact.fonction,
          contact.telephone,
          contact.telephone2,
          contact.courriel,
          contact.notes,
        ].some((value) => normalize(value).includes(q));
      });
  }, [contacts, recherche]);

  const conducteurs = useMemo(() => {
    const q = normalize(recherche);

    return contacts
      .filter((contact) => contact.actif)
      .filter(
        (contact) =>
          contact.typeContact === "Conducteur" ||
          contact.typeContact === "Conducteur remplaçant",
      )
      .filter((contact) => {
        if (
          filtreConducteur === "Remplaçants" &&
          contact.typeContact !== "Conducteur remplaçant"
        ) {
          return false;
        }

        const compagnie = compagnieDepuisOrganisation(
          contact.organisation,
        );

        return (
          compagnie != null &&
          compagniesSelectionnees.includes(compagnie)
        );
      })
      .map((contact): ConducteurAffiche | null => {
        const compagnie = compagnieDepuisOrganisation(
          contact.organisation,
        );

        if (!compagnie) return null;

        const circuitsLies = circuitsConducteurs.filter(
          (row) =>
            row.conducteurContactId === contact.id ||
            (
              !row.conducteurContactId &&
              row.compagnie === compagnie &&
              normalize(row.nomConducteur) === normalize(contact.nom)
            ),
        );

        return {
          key: contact.id,
          source:
            contact.typeContact === "Conducteur remplaçant"
              ? "remplacant"
              : "regulier",
          contactId: contact.id,
          nom: contact.nom,
          telephone: contact.telephone,
          compagnie,
          circuits: [
            ...new Set(
              circuitsLies
                .map((row) => row.circuit)
                .filter(Boolean),
            ),
          ],
          unites: [
            ...new Set(
              circuitsLies
                .map((row) => row.unite)
                .filter(Boolean),
            ),
          ],
        };
      })
      .filter((row): row is ConducteurAffiche => row != null)
      .filter((conducteur) => {
        if (!q) return true;

        return [
          conducteur.nom,
          conducteur.telephone,
          conducteur.compagnie,
          conducteur.circuits.join(" "),
          conducteur.unites.join(" "),
          conducteur.source === "remplacant"
            ? "remplacant"
            : "regulier",
        ].some((value) => normalize(value).includes(q));
      })
      .sort((a, b) =>
        a.nom.localeCompare(b.nom, "fr", {
          sensitivity: "base",
        }),
      );
  }, [
    contacts,
    circuitsConducteurs,
    compagniesSelectionnees,
    filtreConducteur,
    recherche,
  ]);

  const contactsOrganisation = useMemo(() => {
    const q = normalize(recherche);

    return contacts
      .filter((contact) => contact.actif)
      .filter(
        (contact) =>
          contact.typeContact !== "Conducteur" &&
          contact.typeContact !== "Conducteur remplaçant",
      )
      .filter(
        (contact) =>
          organisationFiltre === "Toutes" ||
          contact.organisation === organisationFiltre,
      )
      .filter((contact) => {
        if (!q) return true;
        return [
          organisationLabel(contact),
          contact.typeContact,
          contact.nom,
          contact.fonction,
          contact.telephone,
          contact.telephone2,
          contact.courriel,
          contact.notes,
        ].some((value) => normalize(value).includes(q));
      });
  }, [contacts, recherche, organisationFiltre]);

  const organisationsGroupes = useMemo(() => {
    const internes = contactsOrganisation
      .filter((contact) => estOrganisationInterne(contact.organisation))
      .sort((a, b) =>
        organisationLabel(a).localeCompare(
          organisationLabel(b),
          "fr",
          { sensitivity: "base" },
        ),
      );

    const externes = contactsOrganisation
      .filter((contact) => !estOrganisationInterne(contact.organisation))
      .sort((a, b) =>
        organisationLabel(a).localeCompare(
          organisationLabel(b),
          "fr",
          { sensitivity: "base" },
        ),
      );

    return { internes, externes };
  }, [contactsOrganisation]);

  function toggleCompagnie(compagnie: Compagnie) {
    setCompagniesSelectionnees((current) =>
      current.includes(compagnie)
        ? current.filter((c) => c !== compagnie)
        : [...current, compagnie],
    );
  }

  function toutesCompagnies() {
    setCompagniesSelectionnees([...compagnies]);
  }

  function ouvrirAjout(type?: TypeContact) {
    let prochain: Omit<Contact, "id"> = {
      ...contactVide,
    };

    if (type === "Urgence" || onglet === "urgence") {
      prochain = {
        ...prochain,
        typeContact: "Urgence",
      };
    } else if (
      type === "Conducteur remplaçant" ||
      onglet === "conducteurs"
    ) {
      prochain = {
        ...prochain,
        organisation:
          compagniesSelectionnees.length === 1
            ? compagniesSelectionnees[0]
            : "Autobus Breton",
        typeContact: "Conducteur remplaçant",
        fonction: "Conducteur remplaçant",
      };
    } else {
      prochain = {
        ...prochain,
        typeContact: "Direction",
      };
    }

    setContactActifId(null);
    setForm(prochain);
    setModalOuvert(true);
  }

  function ouvrirModification(contact: Contact) {
    setContactActifId(contact.id);
    setForm({
      organisation: contact.organisation,
      organisationAutre: contact.organisationAutre,
      typeContact: contact.typeContact,
      nom: contact.nom,
      fonction: contact.fonction,
      telephone: contact.telephone,
      telephone2: contact.telephone2,
      courriel: contact.courriel,
      notes: contact.notes,
      actif: contact.actif,
    });
    setModalOuvert(true);
  }

  function modifierConducteur(row: ConducteurAffiche) {
    const contact = contacts.find(
      (c) => c.id === row.contactId,
    );

    if (contact) {
      ouvrirModification(contact);
    }
  }

  function fermerModal() {
    if (saving) return;
    setModalOuvert(false);
    setContactActifId(null);
    setForm(contactVide);
  }

  async function enregistrer() {
    if (!form.nom.trim()) {
      alert("Le nom est obligatoire.");
      return;
    }

    if (
      form.organisation === "Autre" &&
      !form.organisationAutre.trim()
    ) {
      alert("Inscris le nom de l’organisation.");
      return;
    }

    const payload = {
      organisation: form.organisation,
      organisation_autre:
        form.organisation === "Autre"
          ? form.organisationAutre.trim()
          : null,
      type_contact: form.typeContact,
      nom: form.nom.trim(),
      fonction: form.fonction.trim(),
      telephone: form.telephone.trim(),
      telephone2: form.telephone2.trim(),
      courriel: form.courriel.trim(),
      notes: form.notes.trim(),
      actif: form.actif,
      updated_at: new Date().toISOString(),
    };

    setSaving(true);

    try {
      if (contactActifId) {
        const { error } = await circuitSupabase
          .from("contacts")
          .update(payload)
          .eq("id", contactActifId);

        if (error) throw error;
      } else {
        const { error } = await circuitSupabase
          .from("contacts")
          .insert(payload);

        if (error) throw error;
      }

      await chargerDonnees();
      setModalOuvert(false);
      setContactActifId(null);
      setForm(contactVide);
    } catch (error: any) {
      console.error(error);
      alert(
        error?.message ??
          "Erreur pendant l’enregistrement.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function supprimerContact() {
    if (!contactActifId) return;
    if (!confirm("Supprimer définitivement ce contact?")) {
      return;
    }

    setSaving(true);

    try {
      const { error } = await circuitSupabase
        .from("contacts")
        .delete()
        .eq("id", contactActifId);

      if (error) throw error;

      await chargerDonnees();
      setModalOuvert(false);
      setContactActifId(null);
      setForm(contactVide);
    } catch (error: any) {
      console.error(error);
      alert(
        error?.message ??
          "Erreur pendant la suppression.",
      );
    } finally {
      setSaving(false);
    }
  }

  const titreAction =
    onglet === "urgence"
      ? "+ Ajouter un contact d’urgence"
      : onglet === "conducteurs"
        ? "+ Ajouter un remplaçant"
        : "+ Ajouter un contact";

  return (
    <div style={{ paddingBottom: 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>
            Contacts
          </h1>
          <div
            style={{
              color: "#667085",
              marginTop: 4,
            }}
          >
            Répertoire des contacts, conducteurs et
            organisations.
          </div>
        </div>

        <button
          className="btn-primary"
          type="button"
          onClick={() => ouvrirAjout()}
        >
          {titreAction}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          style={tabStyle(onglet === "urgence")}
          onClick={() => {
            setOnglet("urgence");
            setRecherche("");
          }}
        >
          Contacts d’urgence
        </button>

        <button
          type="button"
          style={tabStyle(onglet === "conducteurs")}
          onClick={() => {
            setOnglet("conducteurs");
            setRecherche("");
          }}
        >
          Conducteurs
        </button>

        <button
          type="button"
          style={tabStyle(onglet === "organisations")}
          onClick={() => {
            setOnglet("organisations");
            setRecherche("");
          }}
        >
          Organisations
        </button>
      </div>

      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 14,
        }}
      >
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={
            onglet === "conducteurs"
              ? "Conducteur, téléphone, circuit ou unité..."
              : "Rechercher un nom, téléphone, courriel, fonction ou organisation..."
          }
          style={inputStyle}
        />

        {onglet === "conducteurs" && (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 7,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <strong
                style={{
                  color: "#667085",
                  fontSize: 13,
                  marginRight: 2,
                }}
              >
                Transporteur
              </strong>

              {compagnies.map((compagnie) => (
                <label
                  key={compagnie}
                  style={{
                    ...filterButtonStyle(
                      compagniesSelectionnees.includes(
                        compagnie,
                      ),
                    ),
                    display: "inline-flex",
                    gap: 7,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={compagniesSelectionnees.includes(
                      compagnie,
                    )}
                    onChange={() =>
                      toggleCompagnie(compagnie)
                    }
                  />
                  {shortCompagnie(compagnie)}
                </label>
              ))}

              <button
                type="button"
                style={filterButtonStyle(
                  compagniesSelectionnees.length ===
                    compagnies.length,
                )}
                onClick={toutesCompagnies}
              >
                Tous
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 7,
                alignItems: "center",
              }}
            >
              <strong
                style={{
                  color: "#667085",
                  fontSize: 13,
                  marginRight: 2,
                }}
              >
                Conducteurs
              </strong>

              <button
                type="button"
                style={filterButtonStyle(
                  filtreConducteur === "Tous",
                )}
                onClick={() =>
                  setFiltreConducteur("Tous")
                }
              >
                Tous
              </button>

              <button
                type="button"
                style={filterButtonStyle(
                  filtreConducteur === "Remplaçants",
                )}
                onClick={() =>
                  setFiltreConducteur("Remplaçants")
                }
              >
                Remplaçants
              </button>
            </div>
          </div>
        )}

        {onglet === "organisations" && (
          <div
            style={{
              marginTop: 12,
              maxWidth: 360,
            }}
          >
            <select
              value={organisationFiltre}
              onChange={(e) =>
                setOrganisationFiltre(
                  e.target.value as
                    | Organisation
                    | "Toutes",
                )
              }
              style={inputStyle}
            >
              <option value="Toutes">
                Toutes les organisations
              </option>
              {organisations.map((organisation) => (
                <option
                  key={organisation}
                  value={organisation}
                >
                  {organisation}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {erreur ? (
        <div className="card" style={{ padding: 16 }}>
          <span style={{ color: "#b42318" }}>
            Impossible de charger les données : {erreur}
          </span>
        </div>
      ) : loading ? (
        <div className="card" style={{ padding: 16 }}>
          Chargement...
        </div>
      ) : onglet === "urgence" ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                Contacts d’urgence
                <span
                  style={{
                    marginLeft: 8,
                    color: "#667085",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {contactsUrgence.length}
                </span>
              </div>
              <div className="card-subtitle">
                Double-clic sur une ligne pour modifier.
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Nom</th>
                  <th>Fonction</th>
                  <th>Téléphone</th>
                  <th>Courriel</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {contactsUrgence.map((contact) => (
                  <tr
                    key={contact.id}
                    className="row"
                    style={{ cursor: "pointer" }}
                    onDoubleClick={() =>
                      ouvrirModification(contact)
                    }
                  >
                    <td>
                      <strong>
                        {organisationLabel(contact)}
                      </strong>
                    </td>
                    <td>
                      <strong>{contact.nom}</strong>
                    </td>
                    <td>
                      {contact.fonction || "—"}
                    </td>
                    <td>
                      {contact.telephone ? (
                        <a
                          href={telHref(
                            contact.telephone,
                          )}
                        >
                          {contact.telephone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {contact.courriel ? (
                        <a
                          href={mailHref(
                            contact.courriel,
                          )}
                        >
                          {contact.courriel}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{contact.notes || "—"}</td>
                  </tr>
                ))}

                {!contactsUrgence.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Aucun contact d’urgence.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : onglet === "conducteurs" ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                Conducteurs
                <span
                  style={{
                    marginLeft: 8,
                    color: "#667085",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {conducteurs.length}
                </span>
              </div>
              <div className="card-subtitle">
                Tous les conducteurs sont liés au répertoire central.
                Double-clic pour modifier la fiche.
              </div>
            </div>
          </div>

          {isMobilePage ? (
            <div
              style={{
                display: "grid",
                gap: 8,
                marginTop: 10,
              }}
            >
              {conducteurs.map((conducteur) => (
                <div
                  key={conducteur.key}
                  onClick={() => modifierConducteur(conducteur)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 13px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <strong
                    style={{
                      minWidth: 0,
                      fontSize: 15,
                      lineHeight: 1.25,
                    }}
                  >
                    {conducteur.nom}
                  </strong>

                  {conducteur.telephone ? (
                    <a
                      href={telHref(conducteur.telephone)}
                      onClick={(event) => event.stopPropagation()}
                      style={{
                        flex: "0 0 auto",
                        fontWeight: 900,
                        color: "#1d4ed8",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {conducteur.telephone}
                    </a>
                  ) : (
                    <span
                      style={{
                        flex: "0 0 auto",
                        color: "#98a2b3",
                      }}
                    >
                      —
                    </span>
                  )}
                </div>
              ))}

              {!conducteurs.length && (
                <div
                  className="muted"
                  style={{
                    padding: 14,
                    textAlign: "center",
                  }}
                >
                  Aucun conducteur ne correspond aux filtres.
                </div>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Transporteur</th>
                    <th>Statut</th>
                    <th>Téléphone</th>
                    <th>Circuit</th>
                    <th>Unité</th>
                  </tr>
                </thead>
                <tbody>
                  {conducteurs.map((conducteur) => (
                    <tr
                      key={conducteur.key}
                      className="row"
                      style={{ cursor: "pointer" }}
                      onDoubleClick={() =>
                        modifierConducteur(conducteur)
                      }
                      title="Double-clic pour modifier la fiche conducteur"
                    >
                      <td>
                        <strong>{conducteur.nom}</strong>
                      </td>
                      <td>{conducteur.compagnie}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "4px 8px",
                            borderRadius: 999,
                            background:
                              conducteur.source ===
                              "remplacant"
                                ? "#fff4e5"
                                : "#eefbf3",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          {conducteur.source ===
                          "remplacant"
                            ? "Remplaçant"
                            : "Régulier"}
                        </span>
                      </td>
                      <td>
                        {conducteur.telephone ? (
                          <a
                            href={telHref(
                              conducteur.telephone,
                            )}
                          >
                            {conducteur.telephone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {conducteur.circuits.length
                          ? conducteur.circuits.join(", ")
                          : "—"}
                      </td>
                      <td>
                        {conducteur.unites.length
                          ? conducteur.unites.join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}

                  {!conducteurs.length && (
                    <tr>
                      <td colSpan={6} className="muted">
                        Aucun conducteur ne correspond aux
                        filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 18,
          }}
        >
          {/* EXTERNE : une seule card */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                }}
              >
                Externe
              </h2>

              <span
                style={{
                  color: "#667085",
                  fontSize: 13,
                }}
              >
                CSSBE et autres organisations externes
              </span>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">
                    Contacts externes
                    <span
                      style={{
                        marginLeft: 8,
                        color: "#667085",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {organisationsGroupes.externes.length} contact
                      {organisationsGroupes.externes.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Organisation</th>
                      <th>Nom</th>
                      <th>Type</th>
                      <th>Fonction</th>
                      <th>Téléphone</th>
                      <th>Courriel</th>
                      <th>Notes</th>
                    </tr>
                  </thead>

                  <tbody>
                    {organisationsGroupes.externes.map((contact) => (
                      <tr
                        key={contact.id}
                        className="row"
                        style={{ cursor: "pointer" }}
                        onDoubleClick={() =>
                          ouvrirModification(contact)
                        }
                      >
                        <td>
                          <strong>
                            {organisationLabel(contact)}
                          </strong>
                        </td>
                        <td>{contact.nom}</td>
                        <td>{contact.typeContact}</td>
                        <td>{contact.fonction || "—"}</td>
                        <td>
                          {contact.telephone ? (
                            <a href={telHref(contact.telephone)}>
                              {contact.telephone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {contact.courriel ? (
                            <a href={mailHref(contact.courriel)}>
                              {contact.courriel}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{contact.notes || "—"}</td>
                      </tr>
                    ))}

                    {!organisationsGroupes.externes.length && (
                      <tr>
                        <td colSpan={7} className="muted">
                          Aucun contact externe ne correspond aux filtres.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* INTERNE : une seule card */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 18,
                }}
              >
                Interne
              </h2>

              <span
                style={{
                  color: "#667085",
                  fontSize: 13,
                }}
              >
                Groupe Breton, Autobus Breton, Autobus Champagne et Transport Sécuritaire
              </span>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">
                    Contacts internes
                    <span
                      style={{
                        marginLeft: 8,
                        color: "#667085",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {organisationsGroupes.internes.length} contact
                      {organisationsGroupes.internes.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Organisation</th>
                      <th>Nom</th>
                      <th>Type</th>
                      <th>Fonction</th>
                      <th>Téléphone</th>
                      <th>Courriel</th>
                      <th>Notes</th>
                    </tr>
                  </thead>

                  <tbody>
                    {organisationsGroupes.internes.map((contact) => (
                      <tr
                        key={contact.id}
                        className="row"
                        style={{ cursor: "pointer" }}
                        onDoubleClick={() =>
                          ouvrirModification(contact)
                        }
                      >
                        <td>
                          <strong>
                            {organisationLabel(contact)}
                          </strong>
                        </td>
                        <td>{contact.nom}</td>
                        <td>{contact.typeContact}</td>
                        <td>{contact.fonction || "—"}</td>
                        <td>
                          {contact.telephone ? (
                            <a href={telHref(contact.telephone)}>
                              {contact.telephone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {contact.courriel ? (
                            <a href={mailHref(contact.courriel)}>
                              {contact.courriel}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{contact.notes || "—"}</td>
                      </tr>
                    ))}

                    {!organisationsGroupes.internes.length && (
                      <tr>
                        <td colSpan={7} className="muted">
                          Aucun contact interne ne correspond aux filtres.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      )}

      {modalOuvert && (
        <div
          className="modal-backdrop"
          onMouseDown={fermerModal}
        >
          <div
            className="modal-card"
            style={{
              width: "min(820px, calc(100vw - 32px))",
              maxWidth: "none",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {contactActifId
                    ? "Modifier le contact"
                    : form.typeContact ===
                        "Conducteur remplaçant"
                      ? "Ajouter un conducteur remplaçant"
                      : "Ajouter un contact"}
                </div>
              </div>

              <button
                type="button"
                className="btn-ghost"
                onClick={fermerModal}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
              }}
            >
              <label>
                <div className="field-label">
                  Organisation
                </div>
                <select
                  style={inputStyle}
                  value={form.organisation}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      organisation:
                        e.target
                          .value as Organisation,
                    }))
                  }
                >
                  {organisations.map((org) => (
                    <option
                      value={org}
                      key={org}
                    >
                      {org}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="field-label">
                  Type de contact
                </div>
                <select
                  style={inputStyle}
                  value={form.typeContact}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      typeContact:
                        e.target
                          .value as TypeContact,
                    }))
                  }
                >
                  {typesContact.map((type) => (
                    <option
                      value={type}
                      key={type}
                    >
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              {form.organisation === "Autre" && (
                <label
                  style={{ gridColumn: "1 / -1" }}
                >
                  <div className="field-label">
                    Nom de l’organisation
                  </div>
                  <input
                    style={inputStyle}
                    value={form.organisationAutre}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        organisationAutre:
                          e.target.value,
                      }))
                    }
                  />
                </label>
              )}

              <label>
                <div className="field-label">
                  Nom *
                </div>
                <input
                  style={inputStyle}
                  value={form.nom}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      nom: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                <div className="field-label">
                  Fonction
                </div>
                <input
                  style={inputStyle}
                  value={form.fonction}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fonction: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                <div className="field-label">
                  Téléphone
                </div>
                <input
                  style={inputStyle}
                  value={form.telephone}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      telephone: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                <div className="field-label">
                  Téléphone 2
                </div>
                <input
                  style={inputStyle}
                  value={form.telephone2}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      telephone2:
                        e.target.value,
                    }))
                  }
                />
              </label>

              <label
                style={{ gridColumn: "1 / -1" }}
              >
                <div className="field-label">
                  Courriel
                </div>
                <input
                  type="email"
                  style={inputStyle}
                  value={form.courriel}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      courriel: e.target.value,
                    }))
                  }
                />
              </label>

              <label
                style={{ gridColumn: "1 / -1" }}
              >
                <div className="field-label">
                  Notes
                </div>
                <textarea
                  style={{
                    ...inputStyle,
                    minHeight: 95,
                    resize: "vertical",
                  }}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      notes: e.target.value,
                    }))
                  }
                />
              </label>

              <label
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={form.actif}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      actif: e.target.checked,
                    }))
                  }
                />
                Contact actif
              </label>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                marginTop: 20,
              }}
            >
              <div>
                {contactActifId && (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={supprimerContact}
                    disabled={saving}
                  >
                    Supprimer
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={fermerModal}
                  disabled={saving}
                >
                  Annuler
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={enregistrer}
                  disabled={saving}
                >
                  {saving
                    ? "Enregistrement..."
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
