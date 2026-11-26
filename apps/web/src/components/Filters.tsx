import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Fila de GET /projects/:id/brigades (solo los campos que usa la web fuera de la página de Brigadas). */
export type BrigadeRow = {
  id: string; code: string | null; name: string; isActive: boolean;
  specialtyId: string | null; specialtyName: string | null; areaHa: number | null; schedules: number;
};

/** Brigadas del proyecto (misma caché que Brigadas, Mapa y capas y Cronograma). */
export function useBrigades(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['brigades', projectId],
    enabled: !!projectId,
    queryFn: () => api<BrigadeRow[]>(`/projects/${projectId}/brigades`),
  });
}

type Option = { id: string; name: string };

/**
 * Filtro por brigada. Sin `brigades` usa las del proyecto (`projectId`); con `brigades` muestra esas
 * (p. ej. las que trae el endpoint de opciones de la página).
 */
export function BrigadeSelect<B extends Option = BrigadeRow>({
  value, onChange, projectId, brigades, allLabel = 'Todas las brigadas', optionLabel, style,
}: {
  value: string;
  onChange: (id: string) => void;
  projectId?: string | null;
  brigades?: B[];
  allLabel?: string;
  optionLabel?: (b: B) => string;
  style?: CSSProperties;
}) {
  const own = useBrigades(brigades ? null : projectId);
  const list = (brigades ?? own.data ?? []) as B[];
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Brigada" style={style}>
      <option value="">{allLabel}</option>
      {list.map((b) => <option key={b.id} value={b.id}>{optionLabel ? optionLabel(b) : b.name}</option>)}
    </select>
  );
}

/** Rango de fechas Desde / Hasta. `bounded`: Desde no pasa de Hasta y viceversa. */
export function DateRange({ from, to, onFrom, onTo, bounded }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; bounded?: boolean;
}) {
  return (
    <>
      <label className="hint date-range">
        Desde <input className="input" type="date" value={from} max={bounded && to ? to : undefined} onChange={(e) => onFrom(e.target.value)} />
      </label>
      <label className="hint date-range">
        Hasta <input className="input" type="date" value={to} min={bounded && from ? from : undefined} onChange={(e) => onTo(e.target.value)} />
      </label>
    </>
  );
}
