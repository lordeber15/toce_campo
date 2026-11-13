import { sql } from 'drizzle-orm';
import type { Role, SpecialtyCode } from '@toce/shared';
import { db, pool, schema } from './index.js';
import { hashPassword } from '../lib/password.js';
import { ensureCatalog } from './catalog.js';

const s = schema;


async function main() {
  console.log('Limpiando datos...');
  await db.execute(sql`TRUNCATE specialties, users, projects RESTART IDENTITY CASCADE`);

  const spec = await ensureCatalog();

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
