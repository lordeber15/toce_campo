import { sql } from 'drizzle-orm';
import type { FormField, FormSchema, PhotoSlot, Role, SpecialtyCode } from '@toce/shared';
import { db, pool, schema } from './index.js';
import { hashPassword } from '../lib/password.js';

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

async function main() {
  console.log('Limpiando datos...');
  await db.execute(sql`TRUNCATE specialties, users, projects RESTART IDENTITY CASCADE`);

  const spec: Record<string, string> = {};
  for (const [code, name, order] of SPECIALTIES) {
    const [row] = await db.insert(s.specialties).values({ code, name, sortOrder: order }).returning();
    spec[code] = row!.id;
    let i = 0;
    for (const m of METHODS[code]) {
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
        sortOrder: i++,
      });
    }
  }

  const pwd = await hashPassword('Toce2026');
  const mk = async (dni: string, fullName: string, roles: Role[], specialty?: SpecialtyCode) => {
    const [u] = await db
      .insert(s.users)
      .values({ dni, fullName, roles, passwordHash: pwd, specialtyId: specialty ? spec[specialty] : null })
      .returning();
    return u!;
  };

  const coord = await mk('10000001', 'Carla Coordinadora', ['coordinador']);
  await mk('10000002', 'Jorge Jefe de Proyecto', ['jefe_proyecto']);
  const sup = await mk('10000003', 'Sofía Supervisora', ['supervisor']);
  const log = await mk('10000004', 'Luis Logístico', ['logistico']);
  const aves1 = await mk('20000001', 'Ana Aves (Jefa de brigada)', ['especialista', 'jefe_brigada'], 'AVE');
  const aves2 = await mk('20000002', 'Andrés Aves', ['especialista'], 'AVE');
  const mas = await mk('20000003', 'Mario Mastofauna', ['especialista', 'jefe_brigada'], 'MAS');
  const her = await mk('20000004', 'Helena Herpetofauna', ['especialista', 'jefe_brigada'], 'HER');
  const ent = await mk('20000005', 'Elena Entomofauna', ['especialista', 'jefe_brigada'], 'ENT');
  const flo = await mk('20000006', 'Fernando Flora', ['especialista', 'jefe_brigada'], 'FLO');

  const [project] = await db
    .insert(s.projects)
    .values({ code: 'TOKE', name: 'Proyecto TOKE', status: 'en_curso', startDate: '2026-11-01', endDate: '2026-12-15', centerLat: '-10.6', centerLng: '-75.1', utmZone: 18 })
    .returning();

  const brig = async (name: string, sc: SpecialtyCode, leader: string, members: string[]) => {
    const [b] = await db
      .insert(s.brigades)
      .values({ projectId: project!.id, name, specialtyId: spec[sc], leaderId: leader, logisticianId: log.id, supervisorId: sup.id })
      .returning();
    for (const u of members) await db.insert(s.brigadeMembers).values({ brigadeId: b!.id, userId: u });
    return b!;
  };
  const bAves = await brig('Sierra 2', 'AVE', aves1.id, [aves1.id, aves2.id]);
  const bMas = await brig('Masto 1', 'MAS', mas.id, [mas.id]);
  const bHer = await brig('Herpeto 1', 'HER', her.id, [her.id]);
  const bEnt = await brig('Ento 1', 'ENT', ent.id, [ent.id]);
  const bFlo = await brig('Flora 1', 'FLO', flo.id, [flo.id]);

  // Estaciones de ejemplo con métodos de varias especialidades.
  const allMethods = await db.select().from(s.methods);
  const methodBy = (sc: SpecialtyCode, code: string) => allMethods.find((m) => m.specialtyId === spec[sc] && m.code === code)!;

  const stationsDef: { code: string; lat: number; lng: number; uv: string; area: string; overlap: string; methods: [SpecialtyCode, string, number][] }[] = [
    { code: 'EM-23', lat: -10.601, lng: -75.102, uv: 'Bosque montano 1 (BAPa)', area: 'AID', overlap: 'EF: San Pedro de Chonta',
      methods: [['AVE', 'PC', 10], ['AVE', 'L20', 2], ['AVE', 'ABS', 1], ['AVE', 'RO', 0], ['FLO', 'TV', 1], ['FLO', 'CH', 3], ['FLO', 'RO', 0]] },
    { code: 'EM-41', lat: -10.612, lng: -75.091, uv: 'Bosque de terraza (UV-3)', area: 'AID', overlap: 'Sin superposición',
      methods: [['MAS', 'CT', 6], ['MAS', 'SH', 20], ['MAS', 'TH', 10], ['MAS', 'ABS', 1], ['MAS', 'RO', 0]] },
    { code: 'EM-35A', lat: -10.589, lng: -75.118, uv: 'Bosque húmedo de ladera (UV-BhL)', area: 'AII', overlap: 'Sin superposición',
      methods: [['HER', 'VES', 4], ['HER', 'CD', 2], ['HER', 'ABS', 1], ['HER', 'RO', 0]] },
    { code: 'EM-18', lat: -10.623, lng: -75.110, uv: 'Bosque montano (UV-03)', area: 'AID', overlap: 'EF: Sin Periodo de Chonta',
      methods: [['ENT', 'PF', 10], ['ENT', 'PT', 12], ['ENT', 'TL', 1], ['ENT', 'ABS', 1], ['ENT', 'RO', 0]] },
    { code: 'EM-27', lat: -10.595, lng: -75.085, uv: 'Bosque amazónico (UV-BA)', area: 'AID', overlap: 'Área de Conservación Regional (ACR)',
      methods: [['FLO', 'TV', 1], ['FLO', 'CH', 3], ['FLO', 'PP', 1], ['FLO', 'EP', 1], ['FLO', 'RO', 0], ['AVE', 'PC', 5], ['AVE', 'RO', 0]] },
  ];

  const stationIds: Record<string, string> = {};
  for (const st of stationsDef) {
    const [row] = await db
      .insert(s.stations)
      .values({ projectId: project!.id, code: st.code, geom: { x: st.lng, y: st.lat }, vegetationUnit: st.uv, influenceArea: st.area, overlap: st.overlap })
      .returning();
    stationIds[st.code] = row!.id;
    for (const [sc, mc, units] of st.methods) {
      const m = methodBy(sc, mc);
      const [sm] = await db.insert(s.stationMethods).values({ stationId: row!.id, methodId: m.id, unitsRequired: units }).returning();
      for (let i = 1; i <= units; i++) {
        await db.insert(s.samplingUnits).values({
          stationMethodId: sm!.id, stationId: row!.id, methodId: m.id, seq: i,
          code: `${st.code}-${mc}${String(i).padStart(2, '0')}`,
        });
      }
    }
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const sched = [
    [bAves, 'EM-23'], [bAves, 'EM-27'], [bMas, 'EM-41'], [bHer, 'EM-35A'], [bEnt, 'EM-18'], [bFlo, 'EM-27'], [bFlo, 'EM-23'],
  ] as const;
  let order = 0;
  for (const [b, code] of sched) {
    await db.insert(s.schedules).values({
      projectId: project!.id, brigadeId: b.id, stationId: stationIds[code]!, plannedDate: today, originalDate: today, sortOrder: order++, createdById: coord.id,
    });
  }

  console.log('Seed completo. Contraseña de todos los usuarios: Toce2026');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
