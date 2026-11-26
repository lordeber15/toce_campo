import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  ADMIN_ROLES, INFLUENCE_AREAS, templateCommitSchema, templateFileSchema,
  type Role, type TemplateCommitResult, type TemplateDifference, type TemplateOverride, type TemplateValidation,
} from '@toce/shared';
import { db, schema } from '../db/index.js';
import { formForSpecialty } from '../db/catalog.js';
import { audit } from '../lib/audit.js';
import { classifyStations, previewClassification } from '../lib/geo.js';
import { HttpError, badRequest, isUniqueViolation } from '../lib/http.js';
import { hashPassword } from '../lib/password.js';
import { syncStationMethodsBulk } from '../lib/stationMethods.js';
import {
  DEFAULT_ACCESS, emptyContext, fold, keyMember, keyMethod, keySchedule, keyStationMethod, parseTemplate, readWorkbook,
  specialtyCode, templateProjectCode, validateTemplate,
  type Plan, type TemplateContext, type ValidationOutput,
} from '../lib/templateImport.js';

const s = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Pick<typeof db, 'execute' | 'select'>;

const METHOD_PHOTO = 'Toma una foto semipanorámica lateral donde se vea al especialista aplicando el método y el entorno circundante.';

function decode(b64: string): Buffer {
  const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw badRequest('El archivo no es un Excel (.xlsx) válido');
  return buf;
}

/** Lo que ya existe en la base para comparar con la plantilla. */
async function loadContext(exec: Exec, projectCode: string | null): Promise<TemplateContext> {
  const ctx = emptyContext();
  const users = (await exec.execute(sql`
    SELECT u.dni, u.full_name AS "fullName", u.roles::text[] AS roles, sp.name AS specialty
    FROM users u LEFT JOIN specialties sp ON sp.id = u.specialty_id`)).rows as { dni: string; fullName: string; roles: Role[]; specialty: string | null }[];
  for (const u of users) ctx.users.set(u.dni, { fullName: u.fullName, roles: u.roles, specialty: u.specialty });
  ctx.specialties = ((await exec.execute(sql`SELECT name FROM specialties`)).rows as { name: string }[]).map((r) => r.name);
  for (const r of (await exec.execute(sql`
    SELECT a.name AS spec, array_agg(g.name) AS grants FROM specialty_access x
    JOIN specialties a ON a.id = x.specialty_id JOIN specialties g ON g.id = x.granted_id GROUP BY a.name`)).rows as { spec: string; grants: string[] }[]) {
    ctx.access.set(r.spec, r.grants);
  }
  ctx.methodKeys = new Set(
    ((await exec.execute(sql`SELECT sp.name AS spec, m.code FROM methods m JOIN specialties sp ON sp.id = m.specialty_id`)).rows as { spec: string; code: string }[]).map((r) =>
      keyMethod(r.spec, r.code),
    ),
  );
  ctx.coordinators = Number(
    ((await exec.execute(sql`SELECT count(*)::int AS n FROM users WHERE 'coordinador' = ANY(roles) AND is_active AND deleted_at IS NULL`)).rows[0] as { n: number }).n,
  );
  if (!projectCode) return ctx;
  const p = (await exec.execute(sql`SELECT id, code FROM projects WHERE upper(code) = upper(${projectCode}) AND deleted_at IS NULL LIMIT 1`)).rows[0] as
    | { id: string; code: string }
    | undefined;
  if (!p) return ctx;
  ctx.project = p;
  const col = <T,>(q: ReturnType<typeof sql>) => exec.execute(q).then((r) => r.rows as T[]);
  ctx.brigadeCodes = new Set((await col<{ code: string }>(sql`SELECT code FROM brigades WHERE project_id = ${p.id} AND code IS NOT NULL`)).map((r) => r.code));
  ctx.stationCodes = new Set((await col<{ code: string }>(sql`SELECT code FROM stations WHERE project_id = ${p.id} AND deleted_at IS NULL`)).map((r) => r.code));
  ctx.memberKeys = new Set(
    (await col<{ code: string; dni: string }>(sql`
      SELECT b.code, u.dni FROM brigade_members m JOIN brigades b ON b.id = m.brigade_id JOIN users u ON u.id = m.user_id
      WHERE b.project_id = ${p.id} AND b.code IS NOT NULL`)).map((r) => keyMember(r.code, r.dni)),
  );
  ctx.stationMethodKeys = new Set(
    (await col<{ st: string; spec: string; code: string }>(sql`
      SELECT st.code AS st, sp.name AS spec, m.code FROM station_methods sm
      JOIN stations st ON st.id = sm.station_id AND st.deleted_at IS NULL AND st.project_id = ${p.id}
      JOIN methods m ON m.id = sm.method_id JOIN specialties sp ON sp.id = m.specialty_id`)).map((r) => keyStationMethod(r.st, r.spec, r.code)),
  );
  ctx.scheduleKeys = new Set(
    (await col<{ brigadeCode: string; date: string; activityType: Plan['schedules'][number]['activityType']; stationCode: string | null; detail: string | null }>(sql`
      SELECT b.code AS "brigadeCode", to_char(sc.original_date, 'YYYY-MM-DD') AS date, sc.activity_type AS "activityType",
        st.code AS "stationCode", sc.detail
      FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id AND b.code IS NOT NULL LEFT JOIN stations st ON st.id = sc.station_id
      WHERE sc.project_id = ${p.id}`)).map(keySchedule),
  );
  return ctx;
}

/** ¿El valor de la plantilla y el de las capas son el mismo? ("Bosque montano" = "Bosque montano (UV-03)"). */
function sameValue(declared: string, computed: string) {
  const d = fold(declared);
  const c = fold(computed);
  return c === d || c.startsWith(`${d} (`) || c.endsWith(`(${d})`);
}

/** Diferencias entre la plantilla y las capas KMZ del proyecto (solo si el proyecto ya existe y tiene capas). */
async function computeDifferences(exec: Exec, ctx: TemplateContext, plan: Plan | null): Promise<TemplateDifference[]> {
  if (!ctx.project || !plan) return [];
  const computed = await previewClassification(exec, ctx.project.id, plan.stations.map((x) => ({ code: x.code, lat: x.lat, lng: x.lng })));
  const byCode = new Map(computed.map((c) => [c.code, c]));
  const out: TemplateDifference[] = [];
  for (const st of plan.stations) {
    const c = byCode.get(st.code);
    if (!c) continue;
    if (c.influenceArea && fold(c.influenceArea) !== fold(st.influenceArea)) {
      out.push({ stationCode: st.code, field: 'influenceArea', declared: st.influenceArea, computed: c.influenceArea });
    }
    if (c.vegetationUnit && st.vegetationUnit && !sameValue(st.vegetationUnit, c.vegetationUnit)) {
      out.push({ stationCode: st.code, field: 'vegetationUnit', declared: st.vegetationUnit, computed: c.vegetationUnit });
    }
  }
  return out;
}

async function analyze(exec: Exec, b64: string) {
  const parsed = parseTemplate(await readWorkbook(decode(b64)).catch((e: Error) => {
    throw badRequest(e.message);
  }));
  const ctx = await loadContext(exec, templateProjectCode(parsed));
  const result = validateTemplate(parsed, ctx);
  const differences = await computeDifferences(exec, ctx, result.plan);
  return { ctx, result, differences };
}

const toValidation = (ctx: TemplateContext, r: ValidationOutput, differences: TemplateDifference[]): TemplateValidation => ({
  ok: r.ok,
  summary: r.summary,
  errors: r.errors,
  warnings: r.warnings,
  differences,
  projectId: ctx.project?.id ?? null,
  projectCode: r.plan?.project.code ?? ctx.project?.code ?? null,
});

/** Valor final y bloqueo de un atributo espacial según la diferencia y la elección del usuario. */
function resolveField(d: TemplateDifference | undefined, o: TemplateOverride | undefined, declared: string | null) {
  if (!d) return { value: declared, locked: null as boolean | null }; // sin diferencia: se respeta el bloqueo actual
  if (o?.choice === 'computed') return { value: d.computed, locked: false };
  if (o?.choice === 'custom') return { value: o.value ?? null, locked: true };
  return { value: declared, locked: true }; // 'declared' o sin elección: manda la plantilla
}

/** Guarda todo el plan (dentro de una transacción). */
async function commitPlan(tx: Tx, plan: Plan, ctx: TemplateContext, differences: TemplateDifference[], overrides: TemplateOverride[], userId: string) {
  // 1. Proyecto (por código).
  const P = plan.project;
  const projectValues = { name: P.name, client: P.client, startDate: P.startDate, endDate: P.endDate, utmZone: P.utmZone, description: P.description };
  let projectId: string;
  if (ctx.project) {
    projectId = ctx.project.id;
    await tx.update(s.projects).set(projectValues).where(eq(s.projects.id, projectId));
  } else {
    // Libera el código si hay un proyecto eliminado con el mismo.
    await tx.execute(sql`UPDATE projects SET code = code || '~' || extract(epoch from now())::bigint WHERE upper(code) = ${P.code} AND deleted_at IS NOT NULL`);
    const [row] = await tx.insert(s.projects).values({ code: P.code, ...projectValues }).returning({ id: s.projects.id });
    projectId = row!.id;
  }

  // 2. Especialidades (por nombre) y accesos por defecto.
  const specRows = await tx.select({ id: s.specialties.id, code: s.specialties.code, name: s.specialties.name, sortOrder: s.specialties.sortOrder }).from(s.specialties);
  const specId = new Map(specRows.map((r) => [fold(r.name), r.id]));
  const taken = new Set(specRows.map((r) => r.code));
  let order = specRows.reduce((a, r) => Math.max(a, Number(r.sortOrder) || 0), 0);
  for (const name of plan.specialties) {
    if (specId.has(fold(name))) continue;
    const [row] = await tx.insert(s.specialties).values({ code: specialtyCode(name, taken), name, sortOrder: String(++order) }).returning({ id: s.specialties.id });
    specId.set(fold(name), row!.id);
  }
  const sid = (name: string | null) => (name ? specId.get(fold(name)) ?? null : null);
  const withAccess = new Set(((await tx.execute(sql`SELECT DISTINCT specialty_id AS id FROM specialty_access`)).rows as { id: string }[]).map((r) => r.id));
  for (const [name, grants] of Object.entries(DEFAULT_ACCESS)) {
    const id = sid(name);
    if (!id || withAccess.has(id) || !plan.specialties.some((n) => fold(n) === fold(name))) continue;
    const rows = grants.map(sid).filter((g): g is string => !!g && g !== id).map((grantedId) => ({ specialtyId: id, grantedId }));
    if (rows.length) await tx.insert(s.specialtyAccess).values(rows).onConflictDoNothing();
  }

  // 3. Usuarios (por DNI). Nuevos: contraseña inicial = DNI y cambio obligatorio. Existentes: se actualizan sin tocar la contraseña.
  const existingUsers = await tx.select({ id: s.users.id, dni: s.users.dni, roles: s.users.roles, email: s.users.email, phone: s.users.phone, specialtyId: s.users.specialtyId, deletedAt: s.users.deletedAt })
    .from(s.users).where(inArray(s.users.dni, plan.users.map((u) => u.dni).concat('__none__')));
  const userByDni = new Map(existingUsers.map((u) => [u.dni, u]));
  const fresh = plan.users.filter((u) => !userByDni.has(u.dni));
  const hashes = await Promise.all(fresh.map((u) => hashPassword(u.dni)));
  if (fresh.length) {
    await tx.insert(s.users).values(
      fresh.map((u, i) => ({
        dni: u.dni, fullName: u.fullName, email: u.email, phone: u.phone, roles: u.roles, specialtyId: sid(u.specialty),
        passwordHash: hashes[i]!, mustChangePassword: true,
      })),
    );
  }
  for (const u of plan.users) {
    const ex = userByDni.get(u.dni);
    if (!ex) continue;
    await tx.update(s.users).set({
      fullName: u.fullName,
      email: u.email ?? ex.email,
      phone: u.phone ?? ex.phone,
      specialtyId: u.specialty ? sid(u.specialty) : ex.specialtyId,
      roles: [...new Set([...ex.roles, ...u.roles])],
      ...(ex.deletedAt && { deletedAt: null, isActive: true }),
    }).where(eq(s.users.id, ex.id));
  }
  const refDnis = [...new Set([...plan.users.map((u) => u.dni), ...plan.members.map((m) => m.dni),
    ...plan.brigades.flatMap((b) => [b.leaderDni, b.supervisorDni, b.logisticianDni]).filter((x): x is string => !!x)])];
  const uid = new Map((await tx.select({ id: s.users.id, dni: s.users.dni }).from(s.users).where(inArray(s.users.dni, refDnis))).map((u) => [u.dni, u.id]));

  // 4. Brigadas (por código; las antiguas sin código se emparejan por nombre).
  const curBrigades = await tx.select({ id: s.brigades.id, code: s.brigades.code, name: s.brigades.name }).from(s.brigades).where(eq(s.brigades.projectId, projectId));
  const brigadeId = new Map<string, string>(curBrigades.filter((b) => b.code).map((b) => [b.code!, b.id]));
  for (const b of plan.brigades) {
    const values = {
      code: b.code, name: b.name, region: b.region, notes: b.notes, specialtyId: sid(b.specialty), isActive: true,
      leaderId: uid.get(b.leaderDni) ?? null, supervisorId: b.supervisorDni ? uid.get(b.supervisorDni)! : null,
      logisticianId: b.logisticianDni ? uid.get(b.logisticianDni)! : null,
    };
    const ex = brigadeId.get(b.code) ?? curBrigades.find((x) => !x.code && fold(x.name) === fold(b.name))?.id;
    if (ex) {
      await tx.update(s.brigades).set(values).where(eq(s.brigades.id, ex));
      brigadeId.set(b.code, ex);
    } else {
      const [row] = await tx.insert(s.brigades).values({ ...values, projectId }).returning({ id: s.brigades.id });
      brigadeId.set(b.code, row!.id);
    }
  }

  // 5. Integrantes (se agregan o reactivan; no se quita a nadie).
  for (const m of plan.members) {
    await tx
      .insert(s.brigadeMembers)
      .values({ brigadeId: brigadeId.get(m.brigadeCode)!, userId: uid.get(m.dni)!, validFrom: m.validFrom, validTo: m.validTo })
      .onConflictDoUpdate({ target: [s.brigadeMembers.brigadeId, s.brigadeMembers.userId], set: { leftAt: null, validFrom: m.validFrom, validTo: m.validTo } });
  }

  // 6. Estaciones (por código). Diferencias con las capas: se guarda lo elegido y queda bloqueado.
  const curStations = await tx.select({ id: s.stations.id, code: s.stations.code }).from(s.stations).where(and(eq(s.stations.projectId, projectId), isNull(s.stations.deletedAt)));
  const stationId = new Map(curStations.map((x) => [x.code, x.id]));
  const diff = (code: string, field: TemplateDifference['field']) => differences.find((d) => d.stationCode === code && d.field === field);
  const over = (code: string, field: TemplateDifference['field']) => overrides.find((o) => o.stationCode.toUpperCase() === code && o.field === field);
  for (const st of plan.stations) {
    const area = resolveField(diff(st.code, 'influenceArea'), over(st.code, 'influenceArea'), st.influenceArea);
    const uv = resolveField(diff(st.code, 'vegetationUnit'), over(st.code, 'vegetationUnit'), st.vegetationUnit);
    const values = {
      name: st.name, geom: { x: st.lng, y: st.lat }, altitude: st.altitude, influenceArea: area.value, vegetationUnit: uv.value,
      overlap: st.overlap, accessNotes: st.accessNotes,
      ...(area.locked !== null && { influenceLocked: area.locked }),
      ...(uv.locked !== null && { vegetationLocked: uv.locked }),
    };
    const ex = stationId.get(st.code);
    if (ex) {
      await tx.update(s.stations).set(values).where(eq(s.stations.id, ex));
    } else {
      await tx.execute(sql`UPDATE stations SET code = code || '~' || extract(epoch from now())::bigint
        WHERE project_id = ${projectId} AND code = ${st.code} AND deleted_at IS NOT NULL`);
      const [row] = await tx.insert(s.stations).values({ ...values, code: st.code, projectId }).returning({ id: s.stations.id });
      stationId.set(st.code, row!.id);
    }
  }

  // 7. Métodos (catálogo global por especialidad + código).
  const specIds = [...new Set(plan.methods.map((m) => sid(m.specialty)!))];
  const curMethods = await tx.select({ id: s.methods.id, specialtyId: s.methods.specialtyId, code: s.methods.code }).from(s.methods).where(inArray(s.methods.specialtyId, specIds));
  const methodId = new Map<string, string>();
  const methodDefaults = new Map<string, number>();
  let mOrder = 0;
  for (const m of plan.methods) {
    const spec = sid(m.specialty)!;
    const values = {
      name: m.name, methodClass: m.methodClass, requiresTrack: m.requiresTrack, photosPerUnit: m.photosPerUnit,
      scheduleText: m.scheduleText, scheduleStart: m.scheduleStart, scheduleEnd: m.scheduleEnd, guideline: m.guideline,
      isOpenEnded: m.isOpenEnded, isActive: true, sortOrder: mOrder++,
      ...(m.defaultUnits != null && { defaultUnitsRequired: m.defaultUnits }),
    };
    const ex = curMethods.find((x) => x.specialtyId === spec && x.code === m.code);
    if (ex) {
      await tx.update(s.methods).set(values).where(eq(s.methods.id, ex.id));
      methodId.set(m.code, ex.id);
    } else {
      const specName = plan.specialties.find((n) => fold(n) === fold(m.specialty)) ?? m.specialty;
      const code = ((await tx.select({ code: s.specialties.code }).from(s.specialties).where(eq(s.specialties.id, spec)))[0]?.code) ?? '';
      const [row] = await tx.insert(s.methods).values({
        ...values, specialtyId: spec, code: m.code, defaultUnitsRequired: m.defaultUnits ?? 0,
        formSchema: formForSpecialty(code, specName), photoSlots: [],
        methodPhotoRequired: !m.isOpenEnded, methodPhotoInstructions: m.isOpenEnded ? null : METHOD_PHOTO,
      }).returning({ id: s.methods.id });
      methodId.set(m.code, row!.id);
    }
    methodDefaults.set(m.code, m.defaultUnits ?? 0);
  }

  // 8. Métodos por estación + unidades de muestreo (EM-36-PC01...). No se quitan métodos que no vengan en la plantilla.
  const byStation = new Map<string, Plan['stationMethods']>();
  for (const sm of plan.stationMethods) byStation.set(sm.stationCode, [...(byStation.get(sm.stationCode) ?? []), sm]);
  const missingStations = [...byStation.keys()].filter((c) => !stationId.has(c));
  if (missingStations.length) throw badRequest(`Estaciones no encontradas: ${missingStations.join(', ')}`);
  const unitsCreated = await syncStationMethodsBulk(
    tx,
    [...byStation].map(([code, items]) => ({
      stationId: stationId.get(code)!,
      stationCode: code,
      items: items.map((i) => ({ methodId: methodId.get(i.methodCode)!, unitsRequired: i.unitsRequired, brigadeId: brigadeId.get(i.brigadeCode) ?? null, notes: i.notes })),
    })),
    { removeMissing: false },
  );

  // 9. Cronograma: idempotente por (brigada, fecha original, tipo, estación | detalle).
  const curSchedules = (await tx.execute(sql`
    SELECT sc.id, b.code AS "brigadeCode", to_char(sc.original_date, 'YYYY-MM-DD') AS date, sc.activity_type AS "activityType",
      st.code AS "stationCode", sc.detail, sc.sort_order AS "sortOrder", sc.brigade_id AS "brigadeId", sc.status,
      (EXISTS (SELECT 1 FROM executions e WHERE e.schedule_id = sc.id) OR EXISTS (SELECT 1 FROM reschedules r WHERE r.schedule_id = sc.id)
        OR EXISTS (SELECT 1 FROM incidents i WHERE i.schedule_id = sc.id) OR EXISTS (SELECT 1 FROM track_sessions t WHERE t.schedule_id = sc.id)) AS used
    FROM schedules sc JOIN brigades b ON b.id = sc.brigade_id LEFT JOIN stations st ON st.id = sc.station_id
    WHERE sc.project_id = ${projectId}`)).rows as {
    id: string; brigadeCode: string | null; date: string; activityType: Plan['schedules'][number]['activityType']; stationCode: string | null;
    detail: string | null; sortOrder: number; brigadeId: string; status: string; used: boolean;
  }[];
  const schedByKey = new Map(curSchedules.filter((x) => x.brigadeCode).map((x) => [keySchedule({ ...x, brigadeCode: x.brigadeCode! }), x]));
  const matched = new Set<string>();
  const newSchedules: (typeof s.schedules.$inferInsert)[] = [];
  for (const sc of plan.schedules) {
    const ex = schedByKey.get(keySchedule(sc));
    if (ex) {
      matched.add(ex.id);
      if (ex.sortOrder !== sc.sortOrder || ex.detail !== sc.detail) await tx.update(s.schedules).set({ sortOrder: sc.sortOrder, detail: sc.detail }).where(eq(s.schedules.id, ex.id));
      continue;
    }
    newSchedules.push({
      projectId, brigadeId: brigadeId.get(sc.brigadeCode)!, stationId: sc.stationCode ? stationId.get(sc.stationCode)! : null,
      activityType: sc.activityType, detail: sc.detail, plannedDate: sc.date, originalDate: sc.date, sortOrder: sc.sortOrder, createdById: userId,
    });
  }
  for (let i = 0; i < newSchedules.length; i += 1000) await tx.insert(s.schedules).values(newSchedules.slice(i, i + 1000));
  // Programaciones de estas brigadas que ya no están en la plantilla: se quitan solo si no tienen trabajo de campo.
  const planBrigades = new Set(plan.brigades.map((b) => brigadeId.get(b.code)));
  const stale = curSchedules.filter((x) => !matched.has(x.id) && planBrigades.has(x.brigadeId) && x.status === 'planificada' && !x.used).map((x) => x.id);
  if (stale.length) await tx.delete(s.schedules).where(inArray(s.schedules.id, stale));

  await classifyStations(tx, projectId);
  return { projectId, unitsCreated, schedulesRemoved: stale.length };
}

const importRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = app.requireRoles(...ADMIN_ROLES);

  /** Lee y valida la plantilla. No escribe nada. */
  r.post('/import/template/validate', { onRequest: admin, bodyLimit: 100 * 1024 * 1024, schema: { body: templateFileSchema } }, async (req) => {
    const { ctx, result, differences } = await analyze(app.db, req.body.fileBase64);
    return toValidation(ctx, result, differences);
  });

  /** Valida de nuevo y, si no hay errores, guarda todo en una sola transacción. */
  r.post('/import/template/commit', { onRequest: admin, bodyLimit: 100 * 1024 * 1024, schema: { body: templateCommitSchema } }, async (req, reply) => {
    for (const o of req.body.overrides) {
      if (o.choice === 'custom' && o.field === 'influenceArea' && !INFLUENCE_AREAS.includes(o.value as never)) {
        throw badRequest(`${o.stationCode}: área de influencia no válida "${o.value}" (${INFLUENCE_AREAS.join(', ')})`);
      }
    }
    try {
      const out = await app.db.transaction(async (tx) => {
        // Bloqueo para que dos cargas simultáneas no se pisen.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('toce:template-import'))`);
        const { ctx, result, differences } = await analyze(tx, req.body.fileBase64);
        if (!result.ok || !result.plan) return { invalid: toValidation(ctx, result, differences) };
        const saved = await commitPlan(tx, result.plan, ctx, differences, req.body.overrides, req.user.sub);
        await audit(req, 'project', saved.projectId, 'template_import', {
          after: { fileName: req.body.fileName ?? null, summary: result.summary, overrides: req.body.overrides.length, ...saved },
        }, tx);
        const body: TemplateCommitResult = { ok: true, summary: result.summary, warnings: result.warnings, ...saved };
        return { body };
      });
      if ('invalid' in out) return reply.code(400).send({ error: 'La plantilla tiene errores', ...out.invalid });
      return out.body;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (isUniqueViolation(e)) throw new HttpError(409, `Conflicto de datos al guardar: ${(e as { detail?: string; cause?: { detail?: string } }).cause?.detail ?? (e as { detail?: string }).detail ?? 'registro duplicado'}`);
      throw e;
    }
  });
};

export default importRoutes;
