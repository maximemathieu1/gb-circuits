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

import DispatchCircuits from "./pages/DispatchCircuits";
import DispatchCircuitDetail from "./pages/DispatchCircuitDetail";
import DispatchCircuitMap from "./pages/DispatchCircuitMap";
import DispatchCircuitPrint from "./pages/DispatchCircuitPrint";
import DispatchStopNote from "./pages/DispatchStopNote";
import ImportBusPlanner from "./pages/ImportBusPlanner";

import { circuitSupabase } from "./lib/circuitSupabase";
import "./styles.css";

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

function AppShell() {
  const linkClass = ({
    isActive,
  }: {
    isActive: boolean;
  }) => "navlink" + (isActive ? " navlink-active" : "");

  async function logout() {
    await circuitSupabase.auth.signOut();
    window.location.href = SUITE_GB_URL;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
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
          >
            Circuits scolaire
          </NavLink>

          <NavLink
            to="/admin/circuit-tablette-gps"
            className={linkClass}
          >
            Circuit Tablette GPS
          </NavLink>
        </div>

        <div className="section">
          <div className="section-title">Système</div>

          <div className="navlink" style={{ opacity: 0.45 }}>
            Paramètres
          </div>
        </div>

        <div className="section">
          <button
            className="logout-btn"
            type="button"
            onClick={logout}
          >
            Se déconnecter
          </button>
        </div>
      </aside>

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

          {/* =========================
              CIRCUITS SCOLAIRE
          ========================== */}
          <Route
            path="circuits-scolaires"
            element={<CircuitsScolairesPage />}
          />

          {/* =========================
              CIRCUIT TABLETTE GPS
          ========================== */}
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