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
import { InquiriesPage } from './pages/Inquiries';
import { ReschedulesPage } from './pages/Reschedules';
import { DocumentsPage } from './pages/Documents';
import { MyRecordsPage } from './pages/MyRecords';
import { LogisticsPage } from './pages/Logistics';
import { TrackingPage } from './pages/Tracking';
import { BrigadeTrackingPage } from './pages/BrigadeTracking';
import { RecordDetailPage, RecordsPage } from './pages/Records';
import { ReportsPage } from './pages/Reports';
import { PhotoMapPage } from './pages/PhotoMap';
import { GpsTracksPage } from './pages/GpsTracks';
import { BulkImportPage } from './pages/BulkImport';
import { FormImportPage } from './pages/FormImport';
import { ChangePasswordPage } from './pages/ChangePassword';

export function App() {
  const { user, loading, can, mustChangePassword } = useAuth();
  if (loading) return <div className="center">Cargando…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  // Primer ingreso (contraseña inicial = DNI): no se entra a nada hasta cambiarla.
  if (mustChangePassword) return <ChangePasswordPage />;
  const viewer = can(...WEB_ROLES, 'jefe_proyecto');
  return (
    <ProjectProvider>
      <Routes>
        <Route element={<Layout />}>
          {/* El personal de campo entra directo a lo que cargó desde su teléfono. */}
          <Route index element={viewer ? <HomePage /> : <Navigate to="/mis-registros" replace />} />
          <Route path="mis-registros" element={<MyRecordsPage />} />
          <Route path="mis-registros/:id" element={<RecordDetailPage mine />} />
          <Route path="mi-brigada/:id" element={<BrigadeTrackingPage />} />
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
              <Route path="registros" element={<RecordsPage />} />
              <Route path="registros/:id" element={<RecordDetailPage />} />
              <Route path="mapa-fotos" element={<PhotoMapPage />} />
              <Route path="tracking-gps" element={<GpsTracksPage />} />
              <Route path="reportes" element={<ReportsPage />} />
              <Route path="alertas" element={<AlertsPage />} />
              <Route path="consultas" element={<InquiriesPage />} />
              <Route path="reprogramaciones" element={<ReschedulesPage />} />
              <Route path="documentos" element={<DocumentsPage />} />
              <Route path="logistica" element={<LogisticsPage />} />
            </>
          )}
          {can(...ADMIN_ROLES) && <Route path="usuarios" element={<UsersPage />} />}
          {can(...ADMIN_ROLES) && <Route path="carga-masiva" element={<BulkImportPage />} />}
          {can(...ADMIN_ROLES) && <Route path="carga-formularios" element={<FormImportPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProjectProvider>
  );
}
