import { eq } from 'drizzle-orm';
import { db, pool, schema } from './index.js';
import { hashPassword } from '../lib/password.js';
import { ensureCatalog } from './catalog.js';

/**
 * Preparación de producción (no borra nada; se puede repetir):
 *   node dist/db/setup.js <DNI> "<Nombre completo>" <contraseña>
 * Carga el catálogo de especialidades y métodos que falte y crea el primer coordinador
 * (si el DNI ya existe, no lo toca). Con roles coordinador + supervisor puede administrar todo desde la web.
 */
async function main() {
  const [dni, fullName, password] = process.argv.slice(2);
  if (!dni || !/^\d{8}$/.test(dni) || !fullName || !password || password.length < 8) {
    console.error('Uso: node dist/db/setup.js <DNI de 8 dígitos> "<Nombre completo>" <contraseña de 8+ caracteres>');
    process.exit(1);
  }
  const spec = await ensureCatalog();
  console.log(`Catálogo listo: ${Object.keys(spec).length} especialidades`);

  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.dni, dni));
  if (existing) {
    console.log(`El usuario ${dni} ya existe; no se modificó`);
  } else {
    await db.insert(schema.users).values({
      dni, fullName, roles: ['coordinador', 'supervisor'], passwordHash: await hashPassword(password),
    });
    console.log(`Coordinador ${fullName} (${dni}) creado`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
