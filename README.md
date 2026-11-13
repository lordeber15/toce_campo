# TOCE · Plataforma de Campo

Monorepo (pnpm) con app móvil offline-first, plataforma web y API.

```
apps/api      Fastify 5 + Drizzle + PostgreSQL/PostGIS (+ MinIO para archivos)
apps/web      React 19 + Vite + React Router 8 + TanStack Query
apps/mobile   Expo SDK 58 (Expo Router) — Android e iOS
packages/shared   roles, especialidades, esquemas Zod, utilidades UTM
```

## Levantar en local

```bash
cp .env.example .env              # una vez; ajusta secretos
docker compose up -d postgres minio   # Postgres+PostGIS (puerto 5433) y MinIO (9000, consola 9001)
pnpm install
pnpm db:migrate && pnpm db:seed   # esquema + datos de ejemplo (proyecto TOKE)
pnpm dev:api                      # http://localhost:4000/api/health
pnpm dev:web                      # http://localhost:5173
pnpm dev:mobile                   # escanea el QR con Expo Go
```

Para el móvil, `apps/mobile/.env` debe tener la IP de tu Mac en la red local:
`EXPO_PUBLIC_API_URL=http://192.168.x.x:4000` (en VPS: la URL pública con HTTPS).

## Usuarios de prueba (contraseña `Toce2026`)

| DNI | Rol |
|---|---|
| 10000001 | Coordinador de campo |
| 10000002 | Jefe de proyecto |
| 10000003 | Supervisor de campo |
| 10000004 | Logístico |
| 20000001 | Especialista Aves + Jefa de brigada (Sierra 2) |
| 20000002 | Especialista Aves |
| 20000003 … 20000006 | Especialistas Mastofauna, Herpetofauna, Entomofauna, Flora (jefes de brigada) |

## Acceso móvil

| Situación | Cómo entra |
|---|---|
| Primer ingreso en el teléfono | DNI + contraseña (requiere conexión) y crea su PIN de 4–6 dígitos |
| Servidor alcanzable | Contraseña (el DNI ya está fijado) |
| Sin conexión con el servidor | PIN o huella / Face ID |

- Se comprueba que **el servidor** responda, no solo que haya Wi-Fi.
- La app se bloquea tras 2 min en segundo plano y vuelve a decidir contraseña o PIN.
- 5 PIN incorrectos → se borra la sesión y se exige DNI + contraseña.
- Con conexión, si el usuario fue desactivado o su sesión cerrada, la app lo saca.
- Un solo usuario activo por dispositivo: si entra otro usuario, se borra el PIN del anterior.
- Si la señal se corta mientras se renueva la sesión, el servidor acepta el reintento durante 60 s.

## Paquete de trabajo y Mi jornada (móvil)

- Al entrar con conexión, el teléfono descarga su **paquete de trabajo** (`GET /api/work-package`) y lo guarda en SQLite. Se vuelve a pedir cada 10 min con conexión, o con "Actualizar" / deslizar hacia abajo. Si nada cambió, el servidor responde solo "sin cambios".
- El paquete trae las brigadas activas del usuario (como miembro, jefe, supervisor o logístico), el cronograma de 7 días atrás a 30 días adelante, las estaciones, los métodos **de la especialidad de la brigada**, las unidades, los formularios y el catálogo de especies.
- **Mi jornada** muestra las estaciones por día, el avance por método y la distancia y rumbo desde el GPS. Todo funciona sin conexión.
- Cada descarga queda registrada en `work_package_downloads`.

## Registro de unidad (móvil)

Flujo: estación → unidad → **Iniciar unidad** (hora y GPS) → fotos por orientación + foto del método → registros del formulario (uno por especie u observación; se pueden agregar varios) → notas de voz → **Cerrar unidad** (exige las fotos obligatorias; avisa si no hay registros ni audios o si no se cumplió la duración mínima).

- Todo se guarda primero en el teléfono (SQLite + archivos en `documentDirectory/campo/<ejecución>/`) y funciona sin conexión.
- **Fotos**: el original de la cámara se guarda tal cual (alta resolución, con GPS en EXIF). La copia comprimida (lado mayor 1600 px, JPEG 72) lleva el **sello visible**: unidad y lado, UTM con precisión, fecha y hora de Lima, altitud, proyecto · estación · unidad de vegetación.
- **Notas de voz**: AAC mono 64 kbps (~30 MB por hora), sin límite de duración, varias por unidad.
- **Métodos abiertos** (p. ej. registros oportunos): "+ Nuevo registro" crea la unidad en campo; el servidor asigna el correlativo definitivo.
- **Cola de subida**, en orden: datos de la unidad → datos de fotos/audios → copias comprimidas y audios → originales. Se reintenta al recuperar conexión, al volver a la app y cada minuto. Mi jornada muestra lo pendiente ("Por enviar…").
- API: `POST /api/field/executions` (idempotente por `clientId`; gana el envío más reciente según la hora del teléfono), `POST /api/field/attachments`, `PUT /api/field/attachments/:clientId/content?variant=compressed|original` (cuerpo binario, va directo a MinIO), `GET /api/field/attachments/:id/url` (enlace temporal).
- Ruta en MinIO: `<proyecto>/<estación>/<unidad>/fotos|audios|originales/<clientId>.<ext>`.

## Mapa offline (móvil)

- **Mapa base OpenStreetMap servido por nuestro API** (`/api/basemap/style.json`, teselas, fuentes e íconos). Los servidores de openstreetmap.org prohíben descargar zonas para uso offline, así que el API lee las teselas vectoriales de la compilación pública diaria de [Protomaps](https://protomaps.com) (datos OSM, hecha para extraer regiones) y las guarda en MinIO (`basemap/`): cada tesela se pide a internet una sola vez. Fuera de la zona de los proyectos (+15 km) solo se sirven los zooms generales. Se puede fijar un archivo propio con `BASEMAP_PMTILES_URL`.
- En el teléfono, el mapa descarga la zona del proyecto (z8–z15 + 4 km de margen) como paquete offline de MapLibre. En el proyecto de ejemplo son ~460 teselas, <1 MB más fuentes. Si la zona cambia (nuevas estaciones o capas), pide descargarla de nuevo.
- Las **capas KMZ** van en el paquete de trabajo (simplificadas ~2 m) y se dibujan por tipo: huella, AID, AII, unidades de vegetación, superposición; se prenden y apagan con los botones de arriba.
- **Verificación del área de influencia sin conexión** (`packages/shared/src/areas.ts`): con el GPS dice si estás dentro del AID, AII o fuera, la unidad de vegetación y las superposiciones. Usa la misma regla que el servidor para clasificar estaciones (la prueba lo compara).
- Tocar una estación: distancia y rumbo desde tu ubicación. Tocar cualquier punto: distancia, UTM y capas de ese punto. Sin track GPS (acordado).

## Alertas e incidencias

- **Teléfono**: "Registrar alerta" desde Mi jornada (antes de llegar), la estación o la unidad (durante/después). Tipo, momento, detalle, acción propuesta y fotos de evidencia con sello; estación, método, unidad, hora y GPS se completan solos. "No se puede realizar esta unidad" la marca como **no realizada**. Todo funciona sin conexión y se envía con la misma cola.
- El teléfono descarga el estado de sus alertas en cada sincronización: decisión de coordinación, acción correctiva, reprogramaciones y la conversación (puede responder). Mi jornada avisa de respuestas nuevas y muestra "Se enviaron N registros" tras cada envío.
- **Web → Alertas** (coordinador, supervisor; jefe de proyecto solo lectura): bandeja con filtros, detalle con evidencias, conversación (también para registrar llamadas), respuesta **Aprobada / Rechazada / Se pide más información**, **reprogramación** (guarda fecha original, nueva, motivo y quién aprobó; actualiza el cronograma y opcionalmente devuelve a pendiente las unidades no realizadas) y cierre.
- **Limpieza del teléfono**: los archivos ya enviados se conservan 30 días; después la app pregunta (como máximo una vez al día) si se liberan. Lo no enviado nunca se borra.

## Supervisión y logística (móvil + web)

La app abre la vista del rol principal: **Mi jornada** (especialista / jefe de brigada), **Supervisión** o **Logística**. Quien tiene varios roles entra a las otras desde su inicio. Todo funciona sin conexión y usa la misma cola de envío.

- **Supervisor (10000003)**: brigadas que supervisa con estaciones del día y avance (según el último paquete), **Registrar incidencia** (tipo, estación/método opcional, qué se observó, desviación metodológica, acción correctiva aplicada, "Ya se resolvió en campo" + cómo se resolvió, fotos). Con solución llega a coordinación como **Resuelta en campo**; se puede completar después. Ve las **alertas de sus brigadas** (últimos 30 días) y deja **notas de supervisión** en su conversación. Estación y unidad son de solo lectura (no ejecuta unidades).
- **Logístico (10000004)**: movilidad (estado, confirmar llegada, materiales faltantes/defectuosos), apoyos locales (nombre, DNI, EPP, documentos, disponibilidad), viáticos (monto, comprobante con foto), muestras (estado, confirmar envío, pendientes) y equipos; fotos de evidencia y comprobantes. **Reportar incidencia logística** (accidente de movilidad, desperfecto mecánico, hospedaje, equipos) llega a **Alertas**; al marcar una movilidad averiada/accidentada o un equipo defectuoso la app ofrece registrarla. Lo registrado se restaura desde el servidor en otro teléfono o tras reinstalar.
- **Web → Logística** (coordinador, supervisor, jefe de proyecto): resumen y tablas por brigada con fotos y comprobantes. **Web → Alertas** filtra por origen (especialistas, supervisión, logística) y muestra desviación, acción de campo y solución.

## Avance de brigadas (web · Fase 2)

**Web → Avance de brigadas** (coordinador, supervisor, jefe de proyecto). Se calcula con lo sincronizado y se actualiza cada minuto; se puede elegir una fecha de corte.

- **Indicadores**: brigadas, estaciones ejecutadas/programadas, unidades completadas, **avance** (completadas / requeridas), **cumplimiento a la fecha** (sobre lo programado hasta hoy), **desviación del cronograma** (unidades ejecutadas fuera de su fecha programada; las hechas en una fecha reprogramada con aprobación se muestran aparte), estaciones atrasadas, alertas activas y reprogramaciones pendientes (unidades no realizadas sin nueva fecha).
- **Curva de avance**: unidades programadas según el cronograma original frente a completadas, acumuladas por día (con tabla).
- **Brigadas** ordenadas por atraso (Con atraso / En riesgo < 80 % / Al día). Cada brigada tiene su vista: equipo con última sincronización y descarga de paquete, avance por estación y método, pendientes, no realizadas, fuera de fecha, alertas y reprogramaciones.
- La unidad de cálculo es brigada × estación con las unidades de los métodos de su especialidad; los registros abiertos no cuentan para el avance.
- `scripts/demo-avance.sh` carga un avance de ejemplo para ver el tablero con datos; `scripts/demo-avance.sh --limpiar` lo quita y deja todo como estaba.

## Instalar la app en un teléfono Android

La app usa módulos nativos (cámara, audio, Skia para el sello), así que no funciona en Expo Go. Con el teléfono conectado por USB y la depuración USB activa (en Xiaomi también "Instalar vía USB"):

```bash
cd apps/mobile
npx expo prebuild --platform android --no-install   # tras cambiar app.json o agregar módulos nativos
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

La versión *release* trae el código incluido y abre sin computadora ni internet. La versión de desarrollo (`npx expo run:android`) carga el código desde Metro: sin el cable/Metro se queda cargando. La URL del API sale de `apps/mobile/.env` (`EXPO_PUBLIC_API_URL`, IP de la computadora en la red Wi-Fi). Mientras el servidor de pruebas sea `http://`, el plugin `plugins/withCleartextHttp.js` permite HTTP sin cifrar; en producción el API irá por HTTPS y se quita.

## Despliegue en el VPS (puertos)

TOCE usa el bloque **4710–4714**, que no choca con las aplicaciones que ya corren en el VPS (8080, 3000, 5432, 8085, etc.):

| Puerto | Servicio | Exposición |
|---|---|---|
| 4710 | Web (panel) | proxy → `https://toce.<dominio>` |
| 4711 | API | proxy → `https://api.toce.<dominio>` (la app móvil apunta aquí) |
| 4712 | MinIO (archivos) | proxy → `https://files.toce.<dominio>` |
| 4713 | Consola MinIO | solo `127.0.0.1` (túnel SSH) |

En el VPS **no se levanta otro Postgres**: la API usa la base existente (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`). En local el perfil `db` sí levanta uno propio con esas mismas variables (`COMPOSE_PROFILES=db`, Postgres en 5433).

**Usar la base de datos existente** (una sola vez, como superusuario de ese Postgres). TOCE necesita **PostGIS**, que la imagen `postgres:17` no trae: cambiar la imagen de ese contenedor a `postgis/postgis:17-3.5` (mismo Postgres 17, los datos se conservan; hacer respaldo antes) o instalar el paquete `postgresql-17-postgis-3` en él. Luego:

```sql
CREATE USER toce WITH PASSWORD '<contraseña larga>';
CREATE DATABASE toce OWNER toce;
\c toce
CREATE EXTENSION IF NOT EXISTS postgis;
```

1. `cp .env.vps.example .env` y reemplazar todos los `<...>` (contraseñas y secretos nuevos, dominios).
2. `docker compose up -d --build`, luego migraciones: `docker compose exec api node dist/db/migrate.js`.
   Primer acceso (catálogo de especialidades y métodos + coordinador inicial; no borra nada): `docker compose exec api node dist/db/setup.js <DNI> "<Nombre>" <contraseña>`. No usar `db:seed` en producción: borra todo y crea usuarios de prueba.
3. En Nginx Proxy Manager crear los tres proxy hosts (web, API, archivos) hacia la IP del servidor con los puertos 4710/4711/4712, con SSL.

Los puertos se cambian en `.env` (`WEB_HOST_PORT`, `API_HOST_PORT`, `MINIO_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT`). En local se siguen usando 5433 / 9000 / 9001 / 4000.

## Archivos (MinIO)

MinIO dejó de publicar imágenes oficiales; se usa `pgsty/minio` (build comunitario del mismo código fuente) con versión fijada en `docker-compose.yml`. Consola: http://localhost:9001.

## Configuración del proyecto (web)

Orden sugerido (la página de Inicio muestra el avance):

1. **Mapa y capas** — importar KMZ/KML. El tipo de cada capa (huella, AID, AII, UV, superposición) se sugiere por el nombre de carpeta y se puede corregir. Reimportar un archivo con el mismo nombre reemplaza sus capas. Los puntos con código EM se pueden crear como estaciones.
2. **Estaciones** — crear (UTM o geográficas, o clic en el mapa) o importar desde Excel/CSV (`Código, Este, Norte` o `Latitud, Longitud`). AID/AII, unidad de vegetación y superposición se calculan con las capas.
3. **Métodos de la estación** — esfuerzo por método; genera las unidades `EM-23-PC01…`. Reducir solo quita las últimas unidades y nunca las que tienen trabajo de campo.
4. **Brigadas** — especialidad, jefe, logístico, supervisor y especialistas (uno por brigada activa).
5. **Cronograma** — semana por brigada; solo ofrece estaciones con métodos de la especialidad de la brigada.
6. **Métodos y formularios / Especies** — campos, opciones, fotos requeridas y catálogo de especies (importable desde Excel).

## Pruebas

```bash
scripts/smoke-auth.sh     # con el API corriendo
scripts/smoke-config.sh   # reglas de configuración (crea y borra un proyecto ZZTEST)
scripts/smoke-workpackage.sh  # paquete de trabajo (requiere pnpm db:seed)
scripts/smoke-basemap.sh # mapa base OSM: estilo, teselas, límites de zona
scripts/smoke-incidents.sh # alertas: registro, respuesta, conversación y reprogramación (deja todo como estaba)
scripts/smoke-field.sh   # registro de campo: ejecuciones, fotos, audios y subida a MinIO (deja todo como estaba)
scripts/smoke-tracking.sh # avance de brigadas: indicadores, desviación, curva y permisos (usa y quita el avance de ejemplo)
scripts/smoke-supervision-logistics.sh # supervisor y logístico: incidencias con solución, alertas de brigada, movilidad, apoyos, viáticos, muestras, equipos
pnpm typecheck
```
