import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import DispatchCircuits from "./pages/DispatchCircuits";
import DispatchCircuitDetail from "./pages/DispatchCircuitDetail";
import DispatchCircuitMap from "./pages/DispatchCircuitMap";
import DispatchCircuitPrint from "./pages/DispatchCircuitPrint";
import DispatchStopNote from "./pages/DispatchStopNote";
import ImportBusPlanner from "./pages/ImportBusPlanner";
import { circuitSupabase } from "./lib/circuitSupabase";
import "./styles.css";

const SUITE_GB_URL = "https://suite.groupebreton.com";
const SUITE_SUPABASE_URL =
  import.meta.env.VITE_SUITE_SUPABASE_URL ||
  "https://zvzehhzjoaehlvoraatt.supabase.co";

async function connectWithSsoTicket(ticket: string) {
  const response = await fetch(
    `${SUITE_SUPABASE_URL}/functions/v1/validate-sso-ticket`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticket,
        module_key: "circuits",
      }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || "Ticket SSO invalide.");
  }

  if (!data?.access_token || !data?.refresh_token) {
    throw new Error("Session SSO manquante.");
  }

  const { error } = await circuitSupabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  if (error) {
    throw error;
  }
}

async function restoreSessionFromHash() {
  const hash = window.location.hash;

  if (!hash.includes("access_token") || !hash.includes("refresh_token")) {
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
    `${window.location.pathname}${window.location.search}`
  );
}

function AppShell({ onLogout }: { onLogout: () => void | Promise<void> }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    "navlink" + (isActive ? " navlink-active" : "");

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
          <NavLink to="/admin/circuits" className={linkClass}>
            Circuits scolaires
          </NavLink>
        </div>

        <div className="section">
          <div className="section-title">À venir</div>

          <div className="navlink" style={{ opacity: 0.45 }}>
            Circuits tablette
          </div>

          <div className="navlink" style={{ opacity: 0.45 }}>
            Paramètres
          </div>
        </div>

        <div className="section">
          <button className="logout-btn" onClick={onLogout} type="button">
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route index element={<Navigate to="/admin/circuits" replace />} />
          <Route path="circuits" element={<DispatchCircuits />} />
          <Route
            path="circuits/import-busplanner"
            element={<ImportBusPlanner />}
          />
          <Route path="circuits/:id" element={<DispatchCircuitDetail />} />
          <Route path="circuits/:id/map" element={<DispatchCircuitMap />} />
          <Route path="circuits/:id/print" element={<DispatchCircuitPrint />} />
          <Route
            path="circuits/:id/stops/:stopId/note"
            element={<DispatchStopNote />}
          />
          <Route path="*" element={<Navigate to="/admin/circuits" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [ssoError, setSsoError] = useState("");

  const pathRef = useRef(location.pathname);

  const DEV_BYPASS =
    import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS === "true";

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        const params = new URLSearchParams(window.location.search);
        const ssoTicket = params.get("sso");

        if (ssoTicket) {
          await connectWithSsoTicket(ssoTicket);

          if (!alive) return;

          window.history.replaceState(null, "", "/admin/circuits");
          navigate("/admin/circuits", { replace: true });

          setIsAuthed(true);
          setLoading(false);
          return;
        }

        await restoreSessionFromHash();

        const { data, error } = await circuitSupabase.auth.getSession();

        if (!alive) return;

        if (error || !data.session) {
          setIsAuthed(false);
          setLoading(false);

          setTimeout(() => {
            window.location.href = SUITE_GB_URL;
          }, 500);

          return;
        }

        setIsAuthed(true);
        setLoading(false);
      } catch (error) {
        console.error(error);

        if (!alive) return;

        setSsoError(
          error instanceof Error ? error.message : "Connexion SSO impossible."
        );
        setIsAuthed(false);
        setLoading(false);

        setTimeout(() => {
          window.location.href = SUITE_GB_URL;
        }, 1800);
      }
    }

    void init();

    const { data: authListener } =
      circuitSupabase.auth.onAuthStateChange((_event, session) => {
        if (!alive) return;

        if (!session) {
          setIsAuthed(false);
          return;
        }

        setIsAuthed(true);
        setLoading(false);
      });

    return () => {
      alive = false;
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  async function logout() {
    await circuitSupabase.auth.signOut();
    window.location.href = SUITE_GB_URL;
  }

  if (DEV_BYPASS) {
    return <AppShell onLogout={() => {}} />;
  }

  if (loading) {
    return <div style={{ padding: 16 }}>Connexion en cours…</div>;
  }

  if (!isAuthed) {
    return (
      <div style={{ padding: 16 }}>
        {ssoError || "Redirection vers Suite GB…"}
      </div>
    );
  }

  return <AppShell onLogout={logout} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<AuthenticatedApp />} />
        <Route path="/" element={<Navigate to="/admin/circuits" replace />} />
        <Route path="*" element={<Navigate to="/admin/circuits" replace />} />
      </Routes>
    </BrowserRouter>
  );
}