/**
 * Prueba del lector/validador de la plantilla de carga masiva (sin base de datos).
 *   pnpm --filter @toce/api test:import [ruta.xlsx]
 * 1) La plantilla real: conteos esperados, 0 errores y las advertencias conocidas.
 * 2) Un archivo armado con errores: los errores exactos.
 * 3) El mismo archivo real guardado de nuevo por exceljs (Excel "normal") se sigue leyendo igual.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import {
  emptyContext, normalizeXlsx, parseTemplate, properCaseName, readWorkbook, validateTemplate, type ValidationOutput,
} from '../src/lib/templateImport.js';
import { utmToLatLng } from '@toce/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL = process.argv[2] ?? path.join(here, '../../../docs/plantillas/EIAd_TOCE_Carga_Masiva_Cierre_QA_Reglas_APP_2026-11-25.xlsx');

let failures = 0;
const test = async (name: string, fn: () => Promise<void> | void) => {
  try {
    await fn();
    console.log(`  OK   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`);
  }
};

const run = async (buf: Buffer): Promise<ValidationOutput> => validateTemplate(parseTemplate(await readWorkbook(buf)), emptyContext());
const has = (out: ValidationOutput['errors'], sheet: string, row: number | null, text: string) =>
  out.some((e) => e.sheet === sheet && (row == null || e.row === row) && e.message.includes(text));

async function main() {
  console.log('Utilidades');
  await test('nombres en mayúsculas a nombre propio', () => {
    assert.equal(properCaseName('RICARDO LENIN PEREZ DE LA CRUZ'), 'Ricardo Lenin Perez de la Cruz');
    assert.equal(properCaseName('JOSÉ DEL CASTILLO Y ÁVILA'), 'José del Castillo y Ávila');
    assert.equal(properCaseName('María López'), null);
  });
  await test('UTM 18 S -> lat/lng (punto de control)', () => {
    // 500000 E, 8800000 N, zona 18 S. Valor de PostGIS: ST_Transform(EPSG:32718 -> 4326) = (-10.855481221619, -75).
    const p = utmToLatLng(18, 'S', 500000, 8800000);
    assert.ok(Math.abs(p.lng + 75) < 1e-6, `lng ${p.lng}`);
    assert.ok(Math.abs(p.lat + 10.855481221619) < 1e-7, `lat ${p.lat}`);
  });

  console.log('Plantilla real');
  if (!fs.existsSync(REAL)) {
    console.log(`  (no se encontró ${REAL}; se omite)`);
  } else {
    const buf = fs.readFileSync(REAL);
    await test('exceljs no abre el original sin normalizar (OpenXML SDK)', async () => {
      const wb = new ExcelJS.Workbook();
      await assert.rejects(() => wb.xlsx.load(buf as unknown as ArrayBuffer));
    });
    const out = await run(buf);
    const p = out.plan;
    await test('0 errores', () => assert.deepEqual(out.errors, []));
    await test('conteos', () => {
      assert.ok(p);
      assert.equal(p.project.code, 'EIAD TOCE');
      assert.equal(p.project.startDate, '2026-12-01');
      assert.equal(p.project.endDate, '2027-01-31');
      assert.equal(p.project.utmZone, 17);
      assert.equal(p.users.length, 75);
      assert.equal(p.users.filter((u) => u.roles.includes('especialista')).length, 66);
      assert.equal(p.users.filter((u) => u.roles.includes('jefe_brigada')).length, 9);
      assert.equal(p.users.filter((u) => u.roles.includes('coordinador')).length, 0);
      assert.equal(p.brigades.length, 9);
      assert.equal(p.members.length, 66);
      assert.equal(p.stations.length, 97);
      const area = (a: string) => p.stations.filter((s) => s.influenceArea === a).length;
      assert.deepEqual([area('Huella'), area('AID'), area('AII')], [37, 32, 28]);
      assert.deepEqual([p.stations.filter((s) => s.zone === 17).length, p.stations.filter((s) => s.zone === 18).length], [38, 59]);
      assert.equal(p.methods.length, 33);
      assert.equal(p.stationMethods.length, 2258);
      assert.equal(p.schedules.length, 142);
      const t = (x: string) => p.schedules.filter((s) => s.activityType === x).length;
      assert.deepEqual([t('estacion'), t('movilizacion'), t('desmovilizacion'), t('otro')], [108, 21, 10, 3]);
      assert.equal(out.summary.stationMethods.total, 2258);
      assert.equal(out.summary.users.new, 75);
    });
    await test('especialidades: las 14 de Listas', () => {
      assert.equal(p!.specialties.length, 14);
      assert.ok(p!.specialties.includes('Mixta') && p!.specialties.includes('Mamíferos') && p!.specialties.includes('Fauna transversal'));
    });
    await test('brigadas "Mixta" quedan sin especialidad (ven todo)', () => assert.ok(p!.brigades.every((b) => b.specialty === null)));
    await test('advertencias: 5 nombres en mayúsculas (filas 13, 20, 38, 48, 70)', () => {
      const rows = out.warnings.filter((w) => w.message.startsWith('Nombre en mayúsculas')).map((w) => w.row);
      assert.deepEqual(rows, [13, 20, 38, 48, 70]);
      const u = p!.users.find((x) => x.row === 20)!;
      assert.notEqual(u.fullName, u.fullName.toUpperCase());
    });
    await test('advertencias: códigos con espacios EM-04 R y EM-52 R', () => {
      const codes = out.warnings.filter((w) => w.message.includes('tiene espacios')).map((w) => /"([^"]+)"/.exec(w.message)![1]);
      assert.deepEqual(codes.sort(), ['EM-04 R', 'EM-52 R']);
      assert.ok(p!.stations.some((s) => s.code === 'EM-04 R'));
    });
    await test('advertencia: sin coordinador', () => assert.ok(out.warnings.some((w) => w.message.includes('Coordinador'))));
    await test('coordenadas dentro del Perú', () => {
      for (const s of p!.stations) assert.ok(s.lat > -18.5 && s.lat < 0.1 && s.lng > -81.5 && s.lng < -68.5, s.code);
    });
    await test('EVENTO = método abierto; unidades vacías = las del método', () => {
      assert.ok(p!.methods.find((m) => m.code === 'ROA')!.isOpenEnded);
      assert.ok(!p!.methods.find((m) => m.code === 'PC')!.isOpenEnded);
      assert.ok(p!.methods.find((m) => m.code === 'ECF')!.isOpenEnded, 'ECF sin unidades = abierto');
      assert.ok(!p!.methods.find((m) => m.code === 'VES')!.isOpenEnded, 'VES tiene unidades por estación');
      assert.equal(p!.methods.find((m) => m.code === 'PC')!.scheduleStart, '06:00');
    });
    console.log(`       (${out.warnings.length} advertencias en total)`);
    const kinds = new Map<string, number>();
    for (const w of out.warnings) {
      const k = w.message.replace(/\d+/g, '#').replace(/"[^"]*"/g, '"…"').slice(0, 60);
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    for (const [k, n] of kinds) console.log(`       ${n} × ${k}`);

    await test('archivo guardado de nuevo por exceljs se lee igual', async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await normalizeXlsx(buf)) as unknown as ArrayBuffer);
      const again = Buffer.from(await wb.xlsx.writeBuffer());
      const out2 = await run(again);
      assert.deepEqual(out2.errors, []);
      assert.equal(out2.plan!.stationMethods.length, 2258);
      assert.equal(out2.plan!.schedules.length, 142);
    });
  }

  console.log('Archivo con errores');
  const bad = await buildBadFile();
  const out = await run(bad);
  const U = '2. Usuarios', M = '4. Integrantes', S = '5. Estaciones', C = '8. Cronograma', B = '3. Brigadas';
  await test('DNI duplicado', () => assert.ok(has(out.errors, U, 4, 'DNI 11111111 duplicado (fila 2)'), JSON.stringify(out.errors)));
  await test('brigada inexistente', () => assert.ok(has(out.errors, M, 3, 'La brigada "NO EXISTE" no está en la hoja')));
  await test('ESTACIÓN sin estación', () => assert.ok(has(out.errors, C, 3, 'Una actividad ESTACIÓN necesita la estación')));
  await test('zona UTM no válida', () => assert.ok(has(out.errors, S, 3, 'Zona UTM no válida: "21 S"')));
  await test('Desde > Hasta', () => assert.ok(has(out.errors, M, 2, 'Desde (2026-12-20) es posterior a Hasta (2026-12-10)')));
  await test('DNI de 7 dígitos', () => assert.ok(has(out.errors, U, 5, 'no tiene 8 dígitos')));
  await test('jefe sin rol Jefe de brigada', () => assert.ok(has(out.errors, B, 2, 'no tiene el rol "Jefe de brigada"')));
  await test('especialista sin especialidad', () => assert.ok(has(out.errors, U, 3, 'Especialidad es obligatoria')));
  await test('fecha fuera del proyecto', () => assert.ok(has(out.errors, C, 4, 'fuera de la vigencia del proyecto')));
  await test('coordenadas no numéricas', () => assert.ok(has(out.errors, S, 4, 'Este (m) no es numérico')));
  await test('no hay plan si hay errores', () => assert.equal(out.plan, null));
  console.log(`       errores: ${out.errors.length}`);

  console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodas las pruebas del importador pasaron');
  process.exit(failures ? 1 : 0);
}

/** Plantilla mínima con errores conocidos (escrita con exceljs, como un Excel normal). */
async function buildBadFile(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, rows: unknown[][]) => wb.addWorksheet(name).addRows(rows);
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  sheet('1. Proyecto', [
    ['Código', 'Nombre', 'Cliente', 'Fecha inicio', 'Fecha fin', 'Zona UTM principal', 'Descripción'],
    ['PRUEBA', 'Proyecto de prueba', null, d('2026-12-01'), d('2026-12-31'), null, null],
  ]);
  sheet('2. Usuarios', [
    ['DNI', 'Nombre completo', 'Correo', 'Teléfono', 'Especialidad', 'Especialista', 'Jefe de brigada', 'Supervisor', 'Logístico', 'Coordinador', 'Jefe de proyecto'],
    ['11111111', 'Ana Uno', null, null, 'Aves', 'Sí', 'No'],
    ['22222222', 'Beto Dos', null, null, null, 'Sí', 'No'],
    ['11111111', 'Ana Repetida', null, null, 'Aves', 'Sí'],
    ['3333333', 'Carla Tres', null, null, null, 'No', 'Sí'],
  ]);
  sheet('Listas', [['Especialidades'], ['Aves']]);
  sheet('3. Brigadas', [
    ['Código', 'Nombre', 'Proyecto', 'Región', 'Especialidad', 'Jefe de brigada', 'Supervisor', 'Logístico', 'Observaciones'],
    ['B1', 'Brigada 1', 'PRUEBA', 'SIERRA', 'Aves', '11111111 · Ana Uno'],
  ]);
  sheet('4. Integrantes', [
    ['Brigada', 'Especialista', 'Desde', 'Hasta'],
    ['B1', '11111111 · Ana Uno', d('2026-12-20'), d('2026-12-10')],
    ['NO EXISTE', '22222222 · Beto Dos', null, null],
  ]);
  sheet('5. Estaciones', [
    ['Código', 'Proyecto', 'Zona UTM', 'Este (m)', 'Norte (m)', 'Altitud (m)', 'AID/AII', 'Unidad de vegetación', 'ZA/EF', 'Nombre (opcional)', 'Indicaciones de acceso'],
    ['EM-01', 'PRUEBA', '18 S', 500000, 8800000, null, 'AID'],
    ['EM-02', 'PRUEBA', '21 S', 500000, 8800000, null, 'AID'],
    ['EM-03', 'PRUEBA', '18 S', 'quinientos', 8800000, null, 'AII'],
  ]);
  sheet('6. Métodos', [
    ['Código', 'Nombre', 'Especialidad', 'Unidades por defecto', 'Fotos por unidad', 'Clase', 'Track', 'Horario', 'Condición de aplicación'],
    ['PC', 'Puntos de conteo', 'Aves', 10, 4, 'TODAS', 'No'],
  ]);
  sheet('7. Estación–Método', [
    ['Estación', 'Método', 'Nombre del método (auto)', 'Brigada', 'Unidades requeridas', 'Observación'],
    ['EM-01', 'PC', null, 'B1', null],
  ]);
  sheet('8. Cronograma', [
    ['Fecha', 'Brigada', 'Tipo de actividad', 'Estación', 'Detalle operativo'],
    [d('2026-12-05'), 'B1', 'ESTACIÓN', 'EM-01'],
    [d('2026-12-06'), 'B1', 'ESTACIÓN', null],
    [d('2027-02-01'), 'B1', 'MOVILIZACIÓN', null, 'Retorno'],
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
