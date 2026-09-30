import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import CircuitsScolairesPage from "./pages/CircuitsScolairesPage";
import CarteUnitesPage from "./pages/CarteUnitesPage";
import ContactsPage from "./pages/ContactsPage";

import DispatchCircuits from "./pages/DispatchCircuits";
import DispatchCircuitDetail from "./pages/DispatchCircuitDetail";
import DispatchCircuitMap from "./pages/DispatchCircuitMap";
import DispatchCircuitPrint from "./pages/DispatchCircuitPrint";
import DispatchStopNote from "./pages/DispatchStopNote";
import ImportBusPlanner from "./pages/ImportBusPlanner";

import { circuitSupabase } from "./lib/circuitSupabase";
import "./styles.css";
import "./mobile.css";

const SUITE_GB_URL = "https://suite.groupebreton.com";

async function restoreSessionFromHash() {
  const hash = window.location.hash;

  if (
    !hash.includes("access_token") ||
    !hash.includes("refresh_token")
  ) {
    return;
  }

  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return;
  }

  const { error } = await circuitSupabase.auth.setSession({
    access_token: decodeURIComponent(accessToken),
    refresh_token: decodeURIComponent(refreshToken),
  });

  if (error) {
    throw error;
  }

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

async function exchangeSuiteSso(ticket: string) {
  const { data, error } = await circuitSupabase.functions.invoke(
    "exchange-suite-sso",
    {
      body: {
        ticket,
        module_key: "circuits",
        redirectTo:
          "https://circuits.groupebreton.com/admin/circuits-scolaires",
      },
    },
  );

  if (error || data?.success === false) {
    throw new Error(
      data?.error ||
        error?.message ||
        "SSO Circuits impossible.",
    );
  }

  if (!data?.action_link) {
    throw new Error("Lien de connexion Circuits manquant.");
  }

  window.location.href = data.action_link;
}

function SsoBootstrap({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        const params = new URLSearchParams(
          window.location.search,
        );
        const ssoTicket = params.get("sso");

        if (ssoTicket) {
          const lockKey = `sso_circuits_${ssoTicket}`;

          if (sessionStorage.getItem(lockKey)) {
            window.history.replaceState(
              null,
              "",
              window.location.pathname,
            );
          } else {
            sessionStorage.setItem(lockKey, "1");

            window.history.replaceState(
              null,
              "",
              window.location.pathname,
            );

            await exchangeSuiteSso(ssoTicket);
            return;
          }
        }

        await restoreSessionFromHash();

        const { data, error: sessionError } =
          await circuitSupabase.auth.getSession();

        if (!alive) return;

        if (sessionError || !data.session) {
          setLoading(false);

          setTimeout(() => {
            window.location.href = SUITE_GB_URL;
          }, 500);

          return;
        }

        setLoading(false);
      } catch (err) {
        console.error("SSO CIRCUITS ERROR", err);

        if (!alive) return;

        setError(
          err instanceof Error
            ? err.message
            : "Connexion SSO impossible.",
        );
        setLoading(false);

        setTimeout(() => {
          window.location.href = SUITE_GB_URL;
        }, 2500);
      }
    }

    void init();

    return () => {
      alive = false;
    };
  }, [location.search]);

  if (loading) {
    return <div style={{ padding: 16 }}>Connexion en cours…</div>;
  }

  if (error) {
    return <div style={{ padding: 16 }}>{error}</div>;
  }

  return <>{children}</>;
}

function useIsMobile(bp = 900) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(`(max-width: ${bp}px)`).matches
      : false,
  );

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${bp}px)`);
    const onChange = () => setIsMobile(media.matches);

    onChange();
    media.addEventListener("change", onChange);

    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [bp]);

  return isMobile;
}

function AppShell() {
  const isMobile = useIsMobile(900);
  const [menuMobileOuvert, setMenuMobileOuvert] = useState(false);

  const linkClass = ({
    isActive,
  }: {
    isActive: boolean;
  }) => "navlink" + (isActive ? " navlink-active" : "");

  async function logout() {
    await circuitSupabase.auth.signOut();
    window.location.href = SUITE_GB_URL;
  }

  function fermerMenuMobile() {
    setMenuMobileOuvert(false);
  }

  const menu = (
    <>
      <div className="brand">
        <img
          src="/logo-gb-suite.svg"
          className="brand-logo"
          alt="GB Suite"
          title="Retour au portail Suite GB"
          onClick={() => {
            window.location.href = SUITE_GB_URL;
          }}
        />
      </div>

      <div className="section">
        <NavLink
          to="/admin/circuits-scolaires"
          className={linkClass}
          onClick={fermerMenuMobile}
        >
          Circuits scolaire
        </NavLink>

        <NavLink
          to="/admin/circuit-tablette-gps"
          className={linkClass}
          onClick={fermerMenuMobile}
        >
          Circuit Tablette GPS
        </NavLink>

        <NavLink
          to="/admin/carte-unites"
          className={linkClass}
          onClick={fermerMenuMobile}
        >
          Carte des unités
        </NavLink>
      </div>

      <div className="section mobile-sidebar-bottom">
        <NavLink
          to="/admin/contacts"
          className={linkClass}
          onClick={fermerMenuMobile}
        >
          Contacts
        </NavLink>

        <button
          className="logout-btn"
          type="button"
          onClick={logout}
        >
          Se déconnecter
        </button>
      </div>
    </>
  );

  return (
    <div className={"app-shell" + (isMobile ? " is-mobile" : "")}>
      {!isMobile && (
        <aside className="sidebar">
          {menu}
        </aside>
      )}

      {isMobile && (
        <>
          <header className="mobile-topbar">
            <button
              type="button"
              className="mobile-menu-button"
              onClick={() =>
                setMenuMobileOuvert((value) => !value)
              }
              aria-label="Ouvrir le menu"
              aria-expanded={menuMobileOuvert}
            >
              <span />
              <span />
              <span />
            </button>

            <div className="mobile-topbar-title">
              GB Circuits
            </div>

            <div className="mobile-topbar-spacer" />
          </header>

          <div
            className={
              "mobile-menu-overlay" +
              (menuMobileOuvert ? " open" : "")
            }
            onClick={fermerMenuMobile}
          />

          <aside
            className={
              "sidebar mobile-sidebar" +
              (menuMobileOuvert ? " open" : "")
            }
          >
            <button
              type="button"
              className="mobile-menu-close"
              onClick={fermerMenuMobile}
              aria-label="Fermer le menu"
            >
              ×
            </button>

            {menu}
          </aside>
        </>
      )}

      <main className="content">
        <Routes>
          <Route
            index
            element={
              <Navigate
                to="/admin/circuits-scolaires"
                replace
              />
            }
          />

          <Route
            path="circuits-scolaires"
            element={<CircuitsScolairesPage />}
          />

          <Route
            path="contacts"
            element={<ContactsPage />}
          />

          <Route
            path="carte-unites"
            element={<CarteUnitesPage />}
          />

          <Route
            path="circuit-tablette-gps"
            element={<DispatchCircuits />}
          />

          <Route
            path="circuit-tablette-gps/import-busplanner"
            element={<ImportBusPlanner />}
          />

          <Route
            path="circuit-tablette-gps/:id"
            element={<DispatchCircuitDetail />}
          />

          <Route
            path="circuit-tablette-gps/:id/map"
            element={<DispatchCircuitMap />}
          />

          <Route
            path="circuit-tablette-gps/:id/print"
            element={<DispatchCircuitPrint />}
          />

          <Route
            path="circuit-tablette-gps/:id/stops/:stopId/note"
            element={<DispatchStopNote />}
          />

          <Route
            path="*"
            element={
              <Navigate
                to="/admin/circuits-scolaires"
                replace
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SsoBootstrap>
        <Routes>
          <Route
            path="/admin/*"
            element={<AppShell />}
          />

          <Route
            path="/"
            element={
              <Navigate
                to="/admin/circuits-scolaires"
                replace
              />
            }
          />

          <Route
            path="*"
            element={
              <Navigate
                to="/admin/circuits-scolaires"
                replace
              />
            }
          />
        </Routes>
      </SsoBootstrap>
    </BrowserRouter>
  );
}