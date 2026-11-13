import { Navigate, Route, Routes } from 'react-router';
import { ADMIN_ROLES, WEB_ROLES } from '@toce/shared';
import { useAuth } from './lib/auth';
import { ProjectProvider } from './lib/project';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { UsersPage } from './pages/Users';
import { ProjectsPage } from './pages/Projects';
import { LayersPage } from './pages/Layers';
import { StationsPage } from './pages/Stations';
import { BrigadesPage } from './pages/Brigades';
import { SchedulePage } from './pages/Schedule';
import { MethodsPage } from './pages/Methods';
import { SpeciesPage } from './pages/Species';
import { AlertsPage } from './pages/Alerts';
import { LogisticsPage } from './pages/Logistics';
import { TrackingPage } from './pages/Tracking';
import { BrigadeTrackingPage } from './pages/BrigadeTracking';
import { RecordDetailPage, RecordsPage } from './pages/Records';

export function App() {
  const { user, loading, can } = useAuth();
  if (loading) return <div className="center">Cargando…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  const viewer = can(...WEB_ROLES, 'jefe_proyecto');
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          {viewer && (
            <>
              <Route path="proyectos" element={<ProjectsPage />} />
              <Route path="capas" element={<LayersPage />} />
              <Route path="estaciones" element={<StationsPage />} />
              <Route path="brigadas" element={<BrigadesPage />} />
              <Route path="cronograma" element={<SchedulePage />} />
              <Route path="metodos" element={<MethodsPage />} />
              <Route path="especies" element={<SpeciesPage />} />
              <Route path="seguimiento" element={<TrackingPage />} />
              <Route path="seguimiento/:id" element={<BrigadeTrackingPage />} />
              <Route path="consultas" element={<RecordsPage />} />
              <Route path="consultas/:id" element={<RecordDetailPage />} />
              <Route path="alertas" element={<AlertsPage />} />
              <Route path="logistica" element={<LogisticsPage />} />
            </>
          )}
          {can(...ADMIN_ROLES) && <Route path="usuarios" element={<UsersPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProjectProvider>
  );
}
