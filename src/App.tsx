import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";

import DispatchCircuits from "./pages/DispatchCircuits";
import DispatchCircuitDetail from "./pages/DispatchCircuitDetail";
import DispatchCircuitMap from "./pages/DispatchCircuitMap";
import DispatchCircuitPrint from "./pages/DispatchCircuitPrint";
import DispatchStopNote from "./pages/DispatchStopNote";
import ImportBusPlanner from "./pages/ImportBusPlanner";
import "./styles.css";

function AppShell() {
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
              window.location.href = "https://suite.groupebreton.com";
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
      </aside>

      <main className="content">
        <Routes>
          <Route
            index
            element={<Navigate to="/admin/circuits" replace />}
          />

          <Route
            path="circuits"
            element={<DispatchCircuits />}
          />

          <Route
            path="circuits/import-busplanner"
            element={<ImportBusPlanner />}
          />

          <Route
            path="circuits/:id"
            element={<DispatchCircuitDetail />}
          />

          <Route
            path="circuits/:id/map"
            element={<DispatchCircuitMap />}
          />

          <Route
            path="circuits/:id/print"
            element={<DispatchCircuitPrint />}
          />

          <Route
            path="circuits/:id/stops/:stopId/note"
            element={<DispatchStopNote />}
          />

          <Route
            path="*"
            element={<Navigate to="/admin/circuits" replace />}
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
      

        <Route
          path="/admin/*"
          element={<AppShell />}
        />

        <Route
          path="/"
          element={<Navigate to="/admin/circuits" replace />}
        />

        <Route
          path="*"
          element={<Navigate to="/admin/circuits" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
