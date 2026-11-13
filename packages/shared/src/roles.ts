/** Roles del sistema. Un usuario puede tener varios (p. ej. especialista + jefe_brigada). */
export const ROLES = [
  'especialista',
  'jefe_brigada',
  'supervisor',
  'logistico',
  'coordinador',
  'jefe_proyecto',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  especialista: 'Especialista de campo',
  jefe_brigada: 'Jefe de brigada',
  supervisor: 'Supervisor de campo',
  logistico: 'Responsable logístico',
  coordinador: 'Coordinador de campo',
  jefe_proyecto: 'Jefe de proyecto',
};

/** Roles que operan principalmente desde la app móvil. */
export const MOBILE_ROLES: Role[] = ['especialista', 'jefe_brigada', 'supervisor', 'logistico'];
/** Roles que operan principalmente desde la web. */
export const WEB_ROLES: Role[] = ['coordinador', 'jefe_proyecto', 'supervisor'];
/** Roles que pueden administrar usuarios, catálogos y formularios. */
export const ADMIN_ROLES: Role[] = ['coordinador', 'supervisor'];

export function hasAnyRole(userRoles: readonly Role[], allowed: readonly Role[]): boolean {
  return userRoles.some((r) => allowed.includes(r));
}
