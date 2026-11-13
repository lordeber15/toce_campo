/** Especialidades y métodos iniciales (según fichas de referencia). Editables desde la web. */
export const SPECIALTY_CODES = ['AVE', 'MAS', 'HER', 'ENT', 'FLO'] as const;
export type SpecialtyCode = (typeof SPECIALTY_CODES)[number];

export const SPECIALTY_LABELS: Record<SpecialtyCode, string> = {
  AVE: 'Aves',
  MAS: 'Mastofauna',
  HER: 'Herpetofauna',
  ENT: 'Entomofauna',
  FLO: 'Flora',
};

export type PhotoSlot = { key: string; label: string; required: boolean };

export type FormFieldType = 'text' | 'number' | 'select' | 'date' | 'coords' | 'textarea' | 'species';
export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  auto?: boolean; // se completa automáticamente (fecha, coordenadas)
};
export type FormSchema = { fields: FormField[] };
