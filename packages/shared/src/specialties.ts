/**
 * Especialidades iniciales (según fichas de referencia). La tabla `specialties` es la fuente de verdad:
 * la carga masiva y la web pueden crear otras (con código generado), así que el código es un texto libre.
 */
export const SPECIALTY_CODES = ['AVE', 'MAS', 'HER', 'ENT', 'FLO'] as const;
export type BaseSpecialtyCode = (typeof SPECIALTY_CODES)[number];
/** Código de especialidad: uno de los iniciales u otro creado después. */
export type SpecialtyCode = BaseSpecialtyCode | (string & {});

export const SPECIALTY_LABELS: Readonly<Record<string, string>> = {
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
