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
  | "Conducteur remplaçant"
  | "Direction"
  | "CSSBE"
  | "Mécanique"
  | "Répartition"
  | "Fournisseur"
  | "Autre";

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
  "Conducteur remplaçant",
  "Direction",
  "CSSBE",
  "Mécanique",
  "Répartition",
  "Fournisseur",
  "Autre",
];

const contactVide: Omit<Contact, "id"> = {
  organisation: "Groupe Breton",
  organisationAutre: "",
  typeContact: "Urgence",
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

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function mailHref(email: string) {
  return `mailto:${email.trim()}`;
}

function organisationLabel(contact: Contact) {
  return contact.organisation === "Autre"
    ? contact.organisationAutre || "Autre"
    : contact.organisation;
}

function shortOrganisation(org: Organisation) {
  switch (org) {
    case "Autobus Breton":
      return "B";
    case "Autobus Champagne":
      return "C";
    case "Transport Sécuritaire":
      return "S";
    case "Groupe Breton":
      return "GB";
    case "CSSBE":
      return "CSSBE";
    case "Autre":
      return "Autre";
  }
}

const chipBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 34,
  padding: "6px 11px",
  borderRadius: 8,
  border: "1px solid #d6dce5",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  userSelect: "none",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 42,
  border: "1px solid #d6dce5",
  borderRadius: 8,
  padding: "9px 11px",
  background: "#fff",
  boxSizing: "border-box",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState("");

  const [recherche, setRecherche] = useState("");
  const [organisationsSelectionnees, setOrganisationsSelectionnees] =
    useState<Organisation[]>([
      "Autobus Breton",
      "Autobus Champagne",
      "Transport Sécuritaire",
      "Groupe Breton",
      "CSSBE",
      "Autre",
    ]);
  const [typeFiltre, setTypeFiltre] = useState<TypeContact | "Tous">("Tous");
  const [inclureInactifs, setInclureInactifs] = useState(false);

  const [modalOuvert, setModalOuvert] = useState(false);
  const [contactActifId, setContactActifId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Contact, "id">>(contactVide);
  const [saving, setSaving] = useState(false);

  async function chargerContacts() {
    setLoading(true);
    setErreur("");

    const { data, error } = await circuitSupabase
      .from("contacts")
      .select("*")
      .order("organisation", { ascending: true })
      .order("nom", { ascending: true });

    if (error) {
      console.error("Erreur chargement contacts", error);
      setErreur(error.message);
      setLoading(false);
      return;
    }

    const mapped: Contact[] = (data ?? []).map((item: any) => ({
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

    setContacts(mapped);
    setLoading(false);
  }

  useEffect(() => {
    void chargerContacts();
  }, []);

  const contactsFiltres = useMemo(() => {
    const q = normalize(recherche);

    return contacts.filter((contact) => {
      if (!inclureInactifs && !contact.actif) return false;
      if (!organisationsSelectionnees.includes(contact.organisation)) return false;
      if (typeFiltre !== "Tous" && contact.typeContact !== typeFiltre) return false;

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
  }, [
    contacts,
    recherche,
    organisationsSelectionnees,
    typeFiltre,
    inclureInactifs,
  ]);

  const stats = useMemo(() => {
    const actifs = contacts.filter((c) => c.actif);
    return {
      total: actifs.length,
      urgence: actifs.filter((c) => c.typeContact === "Urgence").length,
      remplacants: actifs.filter(
        (c) => c.typeContact === "Conducteur remplaçant",
      ).length,
    };
  }, [contacts]);

  function toggleOrganisation(org: Organisation) {
    setOrganisationsSelectionnees((current) =>
      current.includes(org)
        ? current.filter((x) => x !== org)
        : [...current, org],
    );
  }

  function selectionnerTous() {
    setOrganisationsSelectionnees([...organisations]);
  }

  function ouvrirAjout() {
    setContactActifId(null);
    setForm(contactVide);
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

  function fermerModal() {
    if (saving) return;
    setModalOuvert(false);
    setContactActifId(null);
    setForm(contactVide);
  }

  async function enregistrer() {
    const nom = form.nom.trim();

    if (!nom) {
      alert("Le nom du contact est requis.");
      return;
    }

    if (form.organisation === "Autre" && !form.organisationAutre.trim()) {
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
      nom,
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

      await chargerContacts();
      fermerModal();
    } catch (error: any) {
      console.error("Erreur enregistrement contact", error);
      alert(error?.message ?? "Erreur pendant l’enregistrement du contact.");
    } finally {
      setSaving(false);
    }
  }

  async function supprimerContact() {
    if (!contactActifId) return;
    if (!confirm("Supprimer définitivement ce contact?")) return;

    setSaving(true);
    try {
      const { error } = await circuitSupabase
        .from("contacts")
        .delete()
        .eq("id", contactActifId);

      if (error) throw error;

      await chargerContacts();
      setModalOuvert(false);
      setContactActifId(null);
      setForm(contactVide);
    } catch (error: any) {
      console.error("Erreur suppression contact", error);
      alert(error?.message ?? "Erreur pendant la suppression du contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Contacts</h1>
          <div style={{ marginTop: 5, color: "#667085" }}>
            Répertoire central des contacts de Groupe Breton.
          </div>
        </div>

        <button className="btn-primary" type="button" onClick={ouvrirAjout}>
          + Ajouter un contact
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        {[
          ["Contacts actifs", stats.total],
          ["Contacts d’urgence", stats.urgence],
          ["Conducteurs remplaçants", stats.remplacants],
        ].map(([label, value]) => (
          <div className="card" key={String(label)} style={{ padding: 14 }}>
            <div style={{ color: "#667085", fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14, padding: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 1fr) auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un nom, téléphone, courriel, fonction, organisation..."
            style={inputStyle}
          />

          <select
            value={typeFiltre}
            onChange={(e) =>
              setTypeFiltre(e.target.value as TypeContact | "Tous")
            }
            style={{ ...inputStyle, minWidth: 210 }}
          >
            <option value="Tous">Tous les types</option>
            {typesContact.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 7,
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <button
            type="button"
            style={{
              ...chipBase,
              background:
                organisationsSelectionnees.length === organisations.length
                  ? "#111827"
                  : "#fff",
              color:
                organisationsSelectionnees.length === organisations.length
                  ? "#fff"
                  : "#111827",
            }}
            onClick={selectionnerTous}
          >
            Tous
          </button>

          {organisations.map((org) => {
            const active = organisationsSelectionnees.includes(org);
            return (
              <button
                key={org}
                type="button"
                title={org}
                style={{
                  ...chipBase,
                  background: active ? "#eef2ff" : "#fff",
                  borderColor: active ? "#9aa7ff" : "#d6dce5",
                  color: active ? "#2537a7" : "#667085",
                }}
                onClick={() => toggleOrganisation(org)}
              >
                {shortOrganisation(org)}
              </button>
            );
          })}

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              marginLeft: 4,
              fontSize: 13,
              color: "#475467",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={inclureInactifs}
              onChange={(e) => setInclureInactifs(e.target.checked)}
            />
            Afficher les inactifs
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              Répertoire
              <span
                style={{
                  marginLeft: 9,
                  color: "#667085",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {contactsFiltres.length} contact
                {contactsFiltres.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="card-subtitle">
              Double-clic sur une ligne pour modifier.
            </div>
          </div>
        </div>

        {erreur ? (
          <div style={{ padding: 16, color: "#b42318" }}>
            Impossible de charger les contacts : {erreur}
          </div>
        ) : loading ? (
          <div style={{ padding: 16, color: "#667085" }}>
            Chargement des contacts...
          </div>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Type</th>
                  <th>Nom</th>
                  <th>Fonction</th>
                  <th>Téléphone</th>
                  <th>Courriel</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {contactsFiltres.map((contact) => (
                  <tr
                    className="row"
                    key={contact.id}
                    onDoubleClick={() => ouvrirModification(contact)}
                    title="Double-clic pour modifier"
                    style={{
                      opacity: contact.actif ? 1 : 0.5,
                      cursor: "pointer",
                    }}
                  >
                    <td>
                      <strong>{organisationLabel(contact)}</strong>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#f2f4f7",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {contact.typeContact}
                      </span>
                    </td>
                    <td>
                      <strong>{contact.nom}</strong>
                    </td>
                    <td>{contact.fonction || "—"}</td>
                    <td>
                      {contact.telephone ? (
                        <a
                          href={telHref(contact.telephone)}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {contact.telephone}
                        </a>
                      ) : (
                        "—"
                      )}
                      {contact.telephone2 && (
                        <div style={{ marginTop: 3 }}>
                          <a
                            href={telHref(contact.telephone2)}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            {contact.telephone2}
                          </a>
                        </div>
                      )}
                    </td>
                    <td>
                      {contact.courriel ? (
                        <a
                          href={mailHref(contact.courriel)}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          {contact.courriel}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      style={{
                        maxWidth: 280,
                        whiteSpace: "normal",
                      }}
                    >
                      {contact.notes || "—"}
                    </td>
                  </tr>
                ))}

                {!contactsFiltres.length && (
                  <tr>
                    <td colSpan={7} className="muted">
                      Aucun contact ne correspond aux filtres.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOuvert && (
        <div className="modal-backdrop" onMouseDown={fermerModal}>
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
                  {contactActifId ? "Modifier le contact" : "Ajouter un contact"}
                </div>
                <div className="muted">
                  Ce contact sera disponible dans le répertoire central.
                </div>
              </div>

              <button type="button" className="btn-ghost" onClick={fermerModal}>
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
                <div className="field-label">Organisation</div>
                <select
                  style={inputStyle}
                  value={form.organisation}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      organisation: e.target.value as Organisation,
                    }))
                  }
                >
                  {organisations.map((org) => (
                    <option value={org} key={org}>
                      {org}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div className="field-label">Type de contact</div>
                <select
                  style={inputStyle}
                  value={form.typeContact}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      typeContact: e.target.value as TypeContact,
                    }))
                  }
                >
                  {typesContact.map((type) => (
                    <option value={type} key={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              {form.organisation === "Autre" && (
                <label style={{ gridColumn: "1 / -1" }}>
                  <div className="field-label">Nom de l’organisation</div>
                  <input
                    style={inputStyle}
                    value={form.organisationAutre}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        organisationAutre: e.target.value,
                      }))
                    }
                  />
                </label>
              )}

              <label>
                <div className="field-label">Nom *</div>
                <input
                  style={inputStyle}
                  value={form.nom}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nom: e.target.value }))
                  }
                />
              </label>

              <label>
                <div className="field-label">Fonction</div>
                <input
                  style={inputStyle}
                  value={form.fonction}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fonction: e.target.value }))
                  }
                />
              </label>

              <label>
                <div className="field-label">Téléphone</div>
                <input
                  style={inputStyle}
                  value={form.telephone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, telephone: e.target.value }))
                  }
                />
              </label>

              <label>
                <div className="field-label">Téléphone 2</div>
                <input
                  style={inputStyle}
                  value={form.telephone2}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, telephone2: e.target.value }))
                  }
                />
              </label>

              <label style={{ gridColumn: "1 / -1" }}>
                <div className="field-label">Courriel</div>
                <input
                  type="email"
                  style={inputStyle}
                  value={form.courriel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, courriel: e.target.value }))
                  }
                />
              </label>

              <label style={{ gridColumn: "1 / -1" }}>
                <div className="field-label">Notes</div>
                <textarea
                  style={{
                    ...inputStyle,
                    minHeight: 100,
                    resize: "vertical",
                  }}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </label>

              <label
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.actif}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, actif: e.target.checked }))
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

              <div style={{ display: "flex", gap: 8 }}>
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
                  {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
