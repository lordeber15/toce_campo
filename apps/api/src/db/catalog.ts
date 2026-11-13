import { eq } from 'drizzle-orm';
import type { FormField, FormSchema, PhotoSlot, SpecialtyCode } from '@toce/shared';
import { db, schema } from './index.js';

/** Catálogo base: especialidades, métodos, fotos requeridas y formularios reducidos. Lo usan el seed y setup. */
const s = schema;

const sel = (key: string, label: string, options: string[], required = false): FormField => ({ key, label, type: 'select', options, required });
const base = (): FormField[] => [
  { key: 'fecha', label: 'Fecha', type: 'date', auto: true, required: true },
  { key: 'especie', label: 'Especie', type: 'species', required: true },
  { key: 'n_individuos', label: 'Número de individuos', type: 'number', required: true },
];
const obs: FormField = { key: 'observaciones', label: 'Observaciones', type: 'textarea' };
const ubic: FormField = { key: 'ubicacion', label: 'Ubicación del registro', type: 'coords', auto: true };
const tipoRegistro = sel('tipo_registro', 'Tipo de registro', ['Visual', 'Auditivo', 'Visual y auditivo', 'Huella', 'Rastro', 'Captura', 'Fotografía']);

const FORMS: Record<SpecialtyCode, FormSchema> = {
  AVE: {
    fields: [
      ...base(),
      tipoRegistro,
      sel('actividad', 'Actividad / comportamiento', ['Perchado', 'Vuelo', 'Alimentación', 'Canto', 'Reproducción', 'Otro']),
      { key: 'altura_vuelo', label: 'Altura de vuelo (m)', type: 'number' },
      sel('direccion_vuelo', 'Dirección de vuelo', ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']),
      sel('tipo_vuelo', 'Tipo de vuelo', ['Directo', 'Planeo', 'Circular', 'Batido', 'Cernido']),
      sel('posicion_lista', 'Posición en lista de 20', Array.from({ length: 20 }, (_, i) => String(i + 1))),
      sel('habitat', 'Hábitat del registro', ['Bosque', 'Borde de bosque', 'Matorral', 'Pastizal', 'Cuerpo de agua', 'Área intervenida']),
      sel('agrupamiento', 'Ubicación de agrupamiento / ambiente utilizado', ['Solitario', 'Pareja', 'Grupo', 'Bandada mixta']),
      obs,
    ],
  },
  MAS: {
    fields: [
      ...base(),
      tipoRegistro,
      sel('actividad', 'Actividad / comportamiento', ['Activo', 'Forrajeo', 'Desplazamiento', 'Descanso', 'Otro']),
      sel('microhabitat', 'Microhábitat / estrato', ['Suelo', 'Sotobosque', 'Dosel', 'Madriguera', 'Cuerpo de agua']),
      sel('metodo_asociado', 'Método asociado', ['CT', 'SH', 'TH', 'ABS', 'RO']),
      sel('huella_indicio', 'Huella / indicio / vocalización', ['Huella', 'Heces', 'Madriguera', 'Comedero', 'Vocalización', 'Ninguno']),
      sel('sexo_edad', 'Sexo / edad (si aplica)', ['Macho', 'Hembra', 'Juvenil', 'Adulto', 'Indeterminado']),
      sel('habitat', 'Hábitat del registro', ['Bosque', 'Borde de bosque', 'Matorral', 'Pastizal', 'Ribera']),
      ubic,
      obs,
    ],
  },
  HER: {
    fields: [
      ...base(),
      tipoRegistro,
      sel('actividad', 'Actividad / comportamiento', ['Activo', 'Inactivo', 'Vocalizando', 'Amplexo', 'Termorregulando']),
      sel('microhabitat', 'Microhábitat', ['Hojarasca', 'Tronco caído', 'Bajo roca', 'Vegetación', 'Orilla', 'Dentro del agua']),
      sel('sustrato', 'Sustrato / cuerpo de agua', ['Suelo', 'Roca', 'Hoja', 'Rama', 'Quebrada', 'Charca', 'Río']),
      sel('metodo_asociado', 'Método asociado', ['VES', 'CD', 'ABS', 'RO']),
      sel('etapa_vida', 'Etapa de vida', ['Huevo', 'Renacuajo', 'Juvenil', 'Adulto']),
      sel('habitat', 'Hábitat del registro', ['Bosque', 'Borde de bosque', 'Matorral', 'Pastizal', 'Ribera']),
      ubic,
      obs,
    ],
  },
  ENT: {
    fields: [
      { key: 'fecha', label: 'Fecha', type: 'date', auto: true, required: true },
      { key: 'especie', label: 'Morfoespecie / especie', type: 'species', required: true },
      { key: 'n_individuos', label: 'Número de individuos', type: 'number', required: true },
      tipoRegistro,
      sel('metodo_asociado', 'Método asociado', ['PF', 'PT', 'TL', 'ABS', 'RO']),
      sel('microhabitat', 'Microhábitat', ['Hojarasca', 'Suelo', 'Vegetación', 'Tronco', 'Flor']),
      sel('sustrato', 'Sustrato', ['Suelo', 'Hoja', 'Rama', 'Roca', 'Agua']),
      sel('condicion_trampa', 'Condición de la trampa', ['Operativa', 'Dañada', 'Inundada', 'Removida']),
      { key: 'hora_revision', label: 'Hora de revisión', type: 'text' },
      sel('habitat', 'Hábitat del registro', ['Bosque', 'Borde de bosque', 'Matorral', 'Pastizal']),
      ubic,
      obs,
    ],
  },
  FLO: {
    fields: [
      ...base().slice(0, 2),
      sel('habito', 'Hábito / estrato', ['Árbol', 'Arbusto', 'Hierba', 'Epífita', 'Liana', 'Helecho']),
      sel('cobertura', 'Cobertura / abundancia', ['<5%', '5-25%', '25-50%', '50-75%', '>75%']),
      { key: 'dap_altura', label: 'DAP / altura (si aplica)', type: 'number' },
      sel('estado_fenologico', 'Estado fenológico', ['Vegetativo', 'Floración', 'Fructificación', 'Senescente']),
      sel('metodo_asociado', 'Método asociado', ['TV', 'CH', 'PP', 'EP', 'RO']),
      { key: 'subparcela', label: 'Subparcela / unidad', type: 'text' },
      sel('condicion', 'Condición del individuo', ['Sano', 'Dañado', 'Muerto en pie']),
      sel('habitat', 'Hábitat / UV', ['Bosque', 'Borde de bosque', 'Matorral', 'Pastizal']),
      ubic,
      obs,
    ],
  },
};

const slots = (...pairs: [string, string][]): PhotoSlot[] => pairs.map(([key, label]) => ({ key, label, required: true }));
const NSEO = slots(['norte', 'Norte'], ['sur', 'Sur'], ['este', 'Este'], ['oeste', 'Oeste']);
const FL = slots(['frontal', 'Frontal'], ['lateral', 'Lateral']);
const IF = slots(['inicio', 'Inicio'], ['fin', 'Fin']);
const PAN = slots(['panoramica_lateral', 'Panorámica lateral'], ['panoramica_centro', 'Panorámica al centro']);

type M = { code: string; name: string; units: number; slots: PhotoSlot[]; open?: boolean };
const METHODS: Record<SpecialtyCode, M[]> = {
  AVE: [
    { code: 'PC', name: 'Puntos de conteo', units: 10, slots: NSEO },
    { code: 'L20', name: 'Listas de 20 especies', units: 2, slots: NSEO },
    { code: 'ABS', name: 'Búsqueda intensiva', units: 1, slots: NSEO },
    { code: 'RO', name: 'Registros oportunos', units: 0, slots: [], open: true },
  ],
  MAS: [
    { code: 'CT', name: 'Cámaras trampa', units: 6, slots: FL },
    { code: 'SH', name: 'Trampas Sherman', units: 20, slots: FL },
    { code: 'TH', name: 'Trampas Tomahawk', units: 10, slots: FL },
    { code: 'ABS', name: 'Búsqueda intensiva', units: 1, slots: FL },
    { code: 'RO', name: 'Registros oportunos', units: 0, slots: [], open: true },
  ],
  HER: [
    { code: 'VES', name: 'Relevamiento por encuentros visuales (VES)', units: 4, slots: IF },
    { code: 'CD', name: 'Conteo directo (fauna acuática)', units: 2, slots: IF },
    { code: 'ABS', name: 'Búsqueda intensiva', units: 1, slots: IF },
    { code: 'RO', name: 'Registros oportunos', units: 0, slots: [], open: true },
  ],
  ENT: [
    { code: 'PF', name: 'Pitfall trap', units: 10, slots: FL },
    { code: 'PT', name: 'Pan traps', units: 12, slots: FL },
    { code: 'TL', name: 'Trampa de luz', units: 1, slots: FL },
    { code: 'ABS', name: 'Búsqueda intensiva', units: 1, slots: FL },
    { code: 'RO', name: 'Registros oportunos', units: 0, slots: [], open: true },
  ],
  FLO: [
    { code: 'TV', name: 'Transecto de vegetación', units: 1, slots: PAN },
    { code: 'CH', name: 'Cuadrante de herbáceas', units: 3, slots: PAN },
    { code: 'PP', name: 'Parcela forestal', units: 1, slots: PAN },
    { code: 'EP', name: 'Epífitas', units: 1, slots: PAN },
    { code: 'RO', name: 'Registros oportunos', units: 0, slots: [], open: true },
  ],
};
const SPECIALTIES: [SpecialtyCode, string, string][] = [
  ['AVE', 'Aves', '1'], ['MAS', 'Mastofauna', '2'], ['HER', 'Herpetofauna', '3'], ['ENT', 'Entomofauna', '4'], ['FLO', 'Flora', '5'],
];
const METHOD_PHOTO = 'Toma una foto semipanorámica lateral donde se vea al especialista aplicando el método y el entorno circundante.';

/** Inserta las especialidades y sus métodos que falten (idempotente). Devuelve código → id de especialidad. */
export async function ensureCatalog(): Promise<Record<string, string>> {
  const spec: Record<string, string> = {};
  for (const [code, name, order] of SPECIALTIES) {
    let [row] = await db.select().from(s.specialties).where(eq(s.specialties.code, code));
    if (!row) [row] = await db.insert(s.specialties).values({ code, name, sortOrder: order }).returning();
    spec[code] = row!.id;
    const existing = new Set((await db.select({ code: s.methods.code }).from(s.methods).where(eq(s.methods.specialtyId, row!.id))).map((m) => m.code));
    let i = 0;
    for (const m of METHODS[code]) {
      const order = i++;
      if (existing.has(m.code)) continue;
      await db.insert(s.methods).values({
        specialtyId: row!.id,
        code: m.code,
        name: m.name,
        isOpenEnded: !!m.open,
        defaultUnitsRequired: m.units || 1,
        photoSlots: m.slots,
        methodPhotoRequired: !m.open,
        methodPhotoInstructions: m.open ? null : METHOD_PHOTO,
        formSchema: FORMS[code],
        sortOrder: order,
      });
    }
  }
  return spec;
}
