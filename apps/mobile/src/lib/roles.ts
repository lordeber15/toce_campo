import { useAuth } from './auth';

/**
 * Qué vistas usa el usuario en el teléfono según sus roles.
 * - executes: especialista / jefe de brigada (Mi jornada, ejecuta unidades).
 * - supervises: supervisor de campo (documenta incidencias y sus soluciones).
 * - logistics: responsable logístico.
 */
export function useRoleView() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const executes = roles.includes('especialista') || roles.includes('jefe_brigada');
  const supervises = roles.includes('supervisor');
  const logistics = roles.includes('logistico');
  /** Pantalla de inicio: la del rol principal (quien ejecuta ve Mi jornada). */
  const home: 'jornada' | 'supervision' | 'logistica' = executes ? 'jornada' : supervises ? 'supervision' : logistics ? 'logistica' : 'jornada';
  return { executes, supervises, logistics, home };
}
