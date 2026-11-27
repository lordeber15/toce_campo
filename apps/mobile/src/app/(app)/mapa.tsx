import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type CameraRef, type MapRef } from '@maplibre/maplibre-react-native';
import {
  checkBrigadeArea, classifyPoint, distanceMeters, formatUtm, latLngToUtm,
  type AreaCheck, type LayerKind, type PhotoMapPoint, type WpBounds, type WpBrigade, type WpLayer, type WpStation,
} from '@toce/shared';
import { api } from '../../lib/api';
import { useField, type MapPhotoLocal } from '../../lib/field';
import { BASEMAP_STYLE_URL, SATELLITE_STYLE_URL, formatMb, useWorkMaps, type BaseLayer } from '../../lib/basemap';
import { ZONE_MAX_TILES, createZone, estimateZone, pauseZone, useOfflineZones } from '../../lib/offlineZones';
import { bearingLabel, formatDistance, usePosition } from '../../lib/location';
import { todayLima, usePackageIndex } from '../../lib/workPackage';
import { useAuth } from '../../lib/auth';
import { myTrackLines, onTrackingChange } from '../../lib/gpsTracking';
import { colors, radius } from '../../theme';

/** Colores por tipo de capa (si la capa del KMZ no trae el suyo). Leyenda de las imágenes de referencia. */
const KIND: Record<LayerKind, { label: string; color: string }> = {
  huella: { label: 'Huella del proyecto', color: '#D93025' },
  aid: { label: 'AID', color: '#E0A800' },
  aii: { label: 'AII', color: '#1E73D8' },
  uv: { label: 'Unidad de vegetación', color: '#2E8B57' },
  superposicion: { label: 'Superposición', color: '#8E44AD' },
  otro: { label: 'Otras capas', color: '#6B7280' },
};
const UV_PALETTE = ['#2E8B57', '#6BA34D', '#3E7C6B', '#8DB255', '#4C9A8A', '#A3B86C'];
const KIND_ORDER: LayerKind[] = ['uv', 'aii', 'aid', 'superposicion', 'huella', 'otro'];

/** Polígono de trabajo de las brigadas y fotos: dentro (verde), fuera (rojo), sin verificar (gris). */
const AREA_COLOR = '#F76707';
const PHOTO_COLOR = { inside: '#2F9E44', outside: '#E03131', unknown: '#868E96' };
/** Recorridos de tracking: un color por EM. */
const TRACK_PALETTE = ['#7048E8', '#1C7ED6', '#D6336C', '#0CA678', '#F08C00', '#495057'];
const TRACK_COLOR = TRACK_PALETTE[0]!;
const NO_BRIGADES: WpBrigade[] = [];
/** Última capa base elegida (se mantiene mientras la app está abierta). */
let lastBase: BaseLayer = 'osm';

/** Foto en el mapa: propia (guardada en el teléfono) o del equipo (supervisor, desde el servidor). */
type MapPhoto =
  | { src: 'mine'; id: string; lat: number; lng: number; outside: boolean | null; photo: MapPhotoLocal; brigade: WpBrigade | undefined }
  | { src: 'team'; id: string; lat: number; lng: number; outside: boolean | null; photo: PhotoMapPoint };

type Picked = { kind: 'station'; station: WpStation } | { kind: 'point'; lat: number; lng: number } | { kind: 'photo'; photo: MapPhoto };

/** Mapa offline: base OSM, capas del proyecto, estaciones, tu ubicación y verificación del área de influencia. */
export default function MapScreen() {
  const { station: stationParam, zone: zoneParam } = useLocalSearchParams<{ station?: string; zone?: string }>();
  const index = usePackageIndex();
  const { online, user } = useAuth();
  const pos = usePosition();
  const field = useField();
  const camera = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const [base, setBaseState] = useState<BaseLayer>(lastBase);
  const setBase = (b: BaseLayer) => { lastBase = b; setBaseState(b); };
  // Zona visible a descargar (diálogo abierto) y zonas manuales en curso.
  const [toDownload, setToDownload] = useState<WpBounds | null>(null);
  const manualZones = useOfflineZones();
  const downloading = manualZones.filter((z) => z.status === 'descargando');
  const today = todayLima();

  const focus = stationParam ? index?.stations.get(stationParam) : undefined;
  const project = (focus ? index?.projects.get(focus.projectId) : undefined) ?? index?.pkg.projects[0];
  // Mapa offline (OSM + satélite): un paquete por brigada del usuario (su KMZ o sus estaciones), no todo el proyecto.
  const basemap = useWorkMaps(project, index?.pkg.brigades ?? NO_BRIGADES);
  // Desde "Zonas descargadas": encuadra la zona elegida.
  useEffect(() => {
    const b = zoneParam?.split(',').map(Number);
    if (!b || b.length !== 4 || b.some((n) => !Number.isFinite(n))) return;
    const t = setTimeout(() => camera.current?.fitBounds(b as WpBounds, { padding: { top: 20, right: 20, bottom: 20, left: 20 }, duration: 600 }), 300);
    return () => clearTimeout(t);
  }, [zoneParam]);
  // Todas las capas sirven para verificar el área; en el mapa se pueden ocultar las generales o las de la brigada.
  const layers = useMemo(() => (index?.pkg.layers ?? []).filter((l) => l.projectId === project?.id) ?? [], [index, project?.id]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // brigadeId: paquetes antiguos no lo traen (todo cuenta como general).
  const hasBrigadeKmz = layers.some((l) => l.brigadeId);
  const hasGeneral = layers.some((l) => !l.brigadeId);
  const drawn = useMemo(
    () => layers.filter((l) => !hidden.has(l.brigadeId ? 'kmz-brigada' : 'kmz-general')),
    [layers, hidden],
  );
  const kinds = useMemo(() => KIND_ORDER.filter((k) => drawn.some((l) => l.kind === k)), [drawn]);
  const [picked, setPicked] = useState<Picked | null>(focus ? { kind: 'station', station: focus } : null);

  const todayIds = useMemo(() => new Set(index?.pkg.schedules.filter((s) => s.plannedDate === today).map((s) => s.stationId)), [index, today]);
  const stations = useMemo(() => index?.pkg.stations.filter((s) => s.projectId === project?.id) ?? [], [index, project?.id]);

  const layerData = useMemo(() => {
    const by: Partial<Record<LayerKind, GeoJSON.FeatureCollection>> = {};
    let uvi = 0;
    for (const l of drawn) {
      const color = l.color || (l.kind === 'uv' ? UV_PALETTE[uvi++ % UV_PALETTE.length]! : KIND[l.kind].color);
      (by[l.kind] ??= { type: 'FeatureCollection', features: [] }).features.push({
        type: 'Feature', id: l.id, properties: { name: l.name, color }, geometry: l.geometry as GeoJSON.Geometry,
      });
    }
    return by;
  }, [drawn]);

  // Brigadas del usuario en este proyecto (y sus polígonos de trabajo).
  const myBrigades = useMemo(() => index?.pkg.brigades.filter((b) => b.projectId === project?.id) ?? [], [index, project?.id]);
  const areaBrigades = useMemo(() => myBrigades.filter((b) => b.area), [myBrigades]);
  const areaData = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: areaBrigades.map((b) => ({
      type: 'Feature', id: b.id, properties: { name: b.areaName || b.name }, geometry: b.area as GeoJSON.Geometry,
    })),
  }), [areaBrigades]);
  // El polígono que aplica a "tu ubicación": el de tu brigada como especialista o jefe; si no, el primero.
  const workBrigade = myBrigades.find((b) => b.area && (b.myRoles.includes('miembro') || b.myRoles.includes('jefe'))) ?? areaBrigades[0];

  // Mis fotos con ubicación (se recargan cuando cambia algo en el teléfono).
  const [mine, setMine] = useState<MapPhotoLocal[]>([]);
  useEffect(() => {
    let alive = true;
    void field.myPhotos().then((rows) => { if (alive) setMine(rows); });
    return () => { alive = false; };
  }, [field.myPhotos, field.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mis recorridos de tracking (se actualizan al llegar puntos nuevos).
  const [tracks, setTracks] = useState<Awaited<ReturnType<typeof myTrackLines>>>([]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () => void myTrackLines(user.id).then((rows) => { if (alive) setTracks(rows); });
    load();
    const off = onTrackingChange(load);
    return () => { alive = false; off(); };
  }, [user]);
  const trackData = useMemo<GeoJSON.FeatureCollection>(() => {
    const colorOf = new globalThis.Map<string, string>();
    for (const t of tracks) if (!colorOf.has(t.stationId)) colorOf.set(t.stationId, TRACK_PALETTE[colorOf.size % TRACK_PALETTE.length]!);
    const features: GeoJSON.Feature[] = [];
    for (const t of tracks) {
      const color = colorOf.get(t.stationId)!;
      const code = index?.stations.get(t.stationId)?.code ?? '';
      if (t.line.length > 1) features.push({ type: 'Feature', properties: { color, code }, geometry: { type: 'LineString', coordinates: t.line } });
      if (t.startLat != null && t.startLng != null) {
        features.push({ type: 'Feature', properties: { color, end: 0 }, geometry: { type: 'Point', coordinates: [t.startLng, t.startLat] } });
      }
      if (t.endLat != null && t.endLng != null) {
        features.push({ type: 'Feature', properties: { color, end: 1 }, geometry: { type: 'Point', coordinates: [t.endLng, t.endLat] } });
      }
    }
    return { type: 'FeatureCollection', features };
  }, [tracks, index]);

  // Supervisor: fotos de las brigadas que supervisa (con conexión), del periodo del paquete.
  const supervised = useMemo(() => myBrigades.filter((b) => b.myRoles.includes('supervisor')).map((b) => b.id), [myBrigades]);
  const [team, setTeam] = useState<PhotoMapPoint[]>([]);
  const [teamError, setTeamError] = useState<string | null>(null);
  const supervisedKey = supervised.join(',');
  useEffect(() => {
    if (!online || !project || !supervised.length || !index) return;
    let alive = true;
    const qs = new URLSearchParams({ from: index.pkg.from });
    api<PhotoMapPoint[]>(`/projects/${project.id}/photo-map?${qs}`)
      .then((rows) => { if (alive) { setTeam(rows.filter((r) => r.brigadeId && supervised.includes(r.brigadeId))); setTeamError(null); } })
      .catch((e: unknown) => { if (alive) setTeamError(e instanceof Error ? e.message : 'No se pudieron cargar las fotos'); });
    return () => { alive = false; };
  }, [online, project?.id, supervisedKey, index?.pkg.from, field.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const photos = useMemo<MapPhoto[]>(() => {
    const out: MapPhoto[] = mine.map((ph) => {
      const brigade = ph.brigadeId ? index?.brigades.get(ph.brigadeId) : undefined;
      const c = checkBrigadeArea(brigade, { lat: ph.lat!, lng: ph.lng! });
      return { src: 'mine', id: ph.clientId, lat: ph.lat!, lng: ph.lng!, outside: c.status === 'fuera' ? true : c.status === 'dentro' ? false : null, photo: ph, brigade };
    });
    for (const ph of team) out.push({ src: 'team', id: ph.id, lat: ph.lat, lng: ph.lng, outside: ph.outsideArea, photo: ph });
    return out;
  }, [mine, team, index]);
  const photoData = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: photos
      .filter((ph) => !hidden.has(ph.src === 'mine' ? 'mis-fotos' : 'fotos-equipo'))
      .map((ph) => ({
        type: 'Feature', id: `${ph.src}-${ph.id}`,
        properties: { key: `${ph.src}:${ph.id}`, state: ph.outside === true ? 'fuera' : ph.outside === false ? 'dentro' : 'nd' },
        geometry: { type: 'Point', coordinates: [ph.lng, ph.lat] },
      })),
  }), [photos, hidden]);
  const outsideCount = photos.filter((ph) => ph.outside === true).length;

  const stationData = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: stations.map((s) => ({
      type: 'Feature', id: s.id, properties: { id: s.id, code: s.code, today: todayIds.has(s.id) ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  }), [stations, todayIds]);

  if (!index || !project) {
    return (
      <View style={[s.center, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Mapa' }} />
        <Text style={s.muted}>Descarga tu paquete de trabajo para ver el mapa.</Text>
      </View>
    );
  }

  const me = pos.status === 'ok' ? pos.position : null;
  const myAreas = me ? classifyPoint(layers, me.lat, me.lng) : null;
  const myWorkArea = workBrigade ? checkBrigadeArea(workBrigade, me) : null;
  const fit = () => project.bounds && camera.current?.fitBounds(project.bounds, { padding: { top: 70, right: 40, bottom: 220, left: 40 }, duration: 600 });
  const toggle = (k: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const initial = focus
    ? { center: [focus.lng, focus.lat] as [number, number], zoom: 14 }
    : project.bounds
      ? { bounds: project.bounds, padding: { top: 70, right: 40, bottom: 220, left: 40 } }
      : { center: [-75, -10] as [number, number], zoom: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: '#E8ECE6' }}>
      <Stack.Screen options={{ title: `Mapa · ${project.code}` }} />
      <Map
        ref={mapRef}
        style={{ flex: 1 }}
        mapStyle={base === 'sat' ? SATELLITE_STYLE_URL : BASEMAP_STYLE_URL}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
        compass
        compassPosition={{ top: 64, right: 12 }}
        scaleBar
        scaleBarPosition={{ top: 64, left: 12 }}
        onPress={(e) => setPicked({ kind: 'point', lat: e.nativeEvent.lngLat[1], lng: e.nativeEvent.lngLat[0] })}
      >
        <Camera ref={camera} initialViewState={initial} maxZoom={18} />

        {KIND_ORDER.map((k) => {
          const data = layerData[k];
          if (!data || hidden.has(k)) return null;
          const dashed = k === 'superposicion';
          return (
            <GeoJSONSource key={k} id={`capa-${k}`} data={data}>
              {k !== 'huella' && (
                <Layer type="fill" id={`capa-${k}-fill`} style={{ fillColor: ['get', 'color'], fillOpacity: k === 'uv' ? 0.22 : 0.1 }} />
              )}
              <Layer
                type="line"
                id={`capa-${k}-line`}
                style={{ lineColor: ['get', 'color'], lineWidth: k === 'huella' ? 3 : k === 'uv' ? 1 : 2, ...(dashed ? { lineDasharray: [2, 2] } : {}) }}
              />
            </GeoJSONSource>
          );
        })}

        {areaData.features.length > 0 && !hidden.has('poligono') && (
          <GeoJSONSource id="poligono-brigada" data={areaData}>
            <Layer type="fill" id="poligono-brigada-fill" style={{ fillColor: AREA_COLOR, fillOpacity: 0.08 }} />
            <Layer type="line" id="poligono-brigada-line" style={{ lineColor: AREA_COLOR, lineWidth: 3, lineDasharray: [3, 2] }} />
          </GeoJSONSource>
        )}

        {trackData.features.length > 0 && !hidden.has('tracking') && (
          <GeoJSONSource id="tracking" data={trackData}>
            <Layer
              type="line"
              id="tracking-linea"
              filter={['==', ['geometry-type'], 'LineString']}
              style={{ lineColor: ['get', 'color'], lineWidth: 3.5, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
            />
            <Layer
              type="circle"
              id="tracking-extremos"
              filter={['==', ['geometry-type'], 'Point']}
              style={{
                circleRadius: 5,
                circleColor: ['case', ['==', ['get', 'end'], 1], '#E03131', '#2F9E44'],
                circleStrokeWidth: 2,
                circleStrokeColor: ['get', 'color'],
              }}
            />
          </GeoJSONSource>
        )}

        {!hidden.has('estaciones') && (
          <GeoJSONSource
            id="estaciones"
            data={stationData}
            hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}
            onPress={(e) => {
              e.stopPropagation();
              const id = e.nativeEvent.features[0]?.properties?.id as string | undefined;
              const st = id ? index.stations.get(id) : undefined;
              if (st) setPicked({ kind: 'station', station: st });
            }}
          >
            <Layer
              type="circle"
              id="estaciones-punto"
              style={{
                circleRadius: ['case', ['==', ['get', 'today'], 1], 8, 6],
                circleColor: ['case', ['==', ['get', 'today'], 1], colors.primary, '#7A8A80'],
                circleStrokeWidth: 2.5,
                circleStrokeColor: '#FFFFFF',
              }}
            />
            <Layer
              type="symbol"
              id="estaciones-codigo"
              style={{
                textField: ['get', 'code'], textFont: ['Noto Sans Medium'], textSize: 13, textOffset: [0, 1.3], textAnchor: 'top',
                textColor: '#17231B', textHaloColor: '#FFFFFF', textHaloWidth: 1.6, textAllowOverlap: true,
              }}
            />
          </GeoJSONSource>
        )}

        {photoData.features.length > 0 && (
          <GeoJSONSource
            id="fotos"
            data={photoData}
            hitbox={{ top: 16, right: 16, bottom: 16, left: 16 }}
            onPress={(e) => {
              e.stopPropagation();
              const key = e.nativeEvent.features[0]?.properties?.key as string | undefined;
              const ph = key ? photos.find((x) => `${x.src}:${x.id}` === key) : undefined;
              if (ph) setPicked({ kind: 'photo', photo: ph });
            }}
          >
            <Layer
              type="circle"
              id="fotos-punto"
              style={{
                circleRadius: 6,
                circleColor: ['match', ['get', 'state'], 'fuera', PHOTO_COLOR.outside, 'dentro', PHOTO_COLOR.inside, PHOTO_COLOR.unknown],
                circleStrokeWidth: 2,
                circleStrokeColor: '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}
        {picked?.kind === 'photo' && (
          <GeoJSONSource id="foto-sel" data={{ type: 'Point', coordinates: [picked.photo.lng, picked.photo.lat] }}>
            <Layer type="circle" id="foto-sel-c" style={{ circleRadius: 11, circleColor: 'rgba(0,0,0,0)', circleStrokeWidth: 3, circleStrokeColor: '#111' }} />
          </GeoJSONSource>
        )}

        {picked?.kind === 'point' && (
          <GeoJSONSource id="punto" data={{ type: 'Point', coordinates: [picked.lng, picked.lat] }}>
            <Layer type="circle" id="punto-c" style={{ circleRadius: 6, circleColor: '#111', circleStrokeWidth: 2, circleStrokeColor: '#fff' }} />
          </GeoJSONSource>
        )}
        {picked?.kind === 'point' && me && (
          <GeoJSONSource id="medida" data={{ type: 'LineString', coordinates: [[me.lng, me.lat], [picked.lng, picked.lat]] }}>
            <Layer type="line" id="medida-l" style={{ lineColor: '#111', lineWidth: 2, lineDasharray: [1.5, 1.5] }} />
          </GeoJSONSource>
        )}

        <UserLocation accuracy heading />
      </Map>

      {/* Capas */}
      <ScrollView horizontal style={s.chipsBar} contentContainerStyle={s.chips} showsHorizontalScrollIndicator={false}>
        {[
          ...(areaData.features.length ? [{ key: 'poligono', label: 'Polígono de brigada', color: AREA_COLOR }] : []),
          ...(tracks.length ? [{ key: 'tracking', label: `Mi tracking (${new Set(tracks.map((x) => x.stationId)).size} EM)`, color: TRACK_COLOR }] : []),
          ...(mine.length ? [{ key: 'mis-fotos', label: `Mis fotos (${mine.length})`, color: PHOTO_COLOR.inside }] : []),
          ...(supervised.length ? [{ key: 'fotos-equipo', label: `Fotos de mis brigadas (${team.length})`, color: '#1C7ED6' }] : []),
          ...(hasBrigadeKmz && hasGeneral ? [
            { key: 'kmz-brigada', label: 'KMZ de mi brigada', color: AREA_COLOR },
            { key: 'kmz-general', label: 'Capas generales', color: KIND.otro.color },
          ] : []),
          ...kinds.map((k) => ({ key: k as string, label: KIND[k].label, color: KIND[k].color })),
          { key: 'estaciones', label: 'Estaciones', color: colors.primary },
        ].map((c) => {
          const on = !hidden.has(c.key);
          return (
            <Pressable key={c.key} onPress={() => toggle(c.key)} style={[s.chip, !on && s.chipOff]} accessibilityRole="switch" accessibilityState={{ checked: on }}>
              <View style={[s.swatch, { backgroundColor: on ? c.color : 'transparent', borderColor: c.color }]} />
              <Text style={[s.chipText, !on && { color: colors.text2 }]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Botones */}
      <View style={s.fabs}>
        <Pressable
          style={s.fab}
          onPress={() => me && camera.current?.flyTo({ center: [me.lng, me.lat], zoom: 15, duration: 700 })}
          disabled={!me}
          accessibilityRole="button"
          accessibilityLabel="Centrar en mi ubicación"
        >
          <Text style={[s.fabText, !me && { opacity: 0.35 }]}>◎</Text>
        </Pressable>
        <Pressable style={s.fab} onPress={fit} accessibilityRole="button" accessibilityLabel="Ver toda mi zona de trabajo">
          <Text style={s.fabText}>⤢</Text>
        </Pressable>
        <Pressable
          style={[s.fab, base === 'sat' && { backgroundColor: colors.primary }]}
          onPress={() => setBase(base === 'sat' ? 'osm' : 'sat')}
          accessibilityRole="switch"
          accessibilityState={{ checked: base === 'sat' }}
          accessibilityLabel="Imagen satelital"
        >
          <Text style={[s.fabSmall, base === 'sat' && { color: colors.white }]}>SAT</Text>
        </Pressable>
        <Pressable
          style={s.fab}
          onPress={() => void mapRef.current?.getBounds().then((b) => setToDownload(b as WpBounds))}
          accessibilityRole="button"
          accessibilityLabel="Descargar esta zona para usarla sin conexión"
        >
          <Text style={s.fabText}>⤓</Text>
        </Pressable>
        <Pressable style={s.fab} onPress={() => router.push('/zonas')} accessibilityRole="button" accessibilityLabel="Zonas descargadas">
          <Text style={s.fabText}>☰</Text>
        </Pressable>
      </View>

      {/* Panel inferior */}
      <View style={s.sheet}>
        <OfflineRow basemap={basemap} online={online} />
        {downloading.map((z) => {
          const pct = Math.min(100, Math.floor((z.done / Math.max(1, z.tiles)) * 100));
          return (
            <View key={z.id} style={[s.offline, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
              <View style={s.row}>
                <Text style={[s.offlineText, { flex: 1 }]} numberOfLines={1}>
                  {z.name} · {Math.min(z.done, z.tiles).toLocaleString('es-PE')} / {z.tiles.toLocaleString('es-PE')} teselas
                </Text>
                <Pressable onPress={() => void pauseZone(z.id)} hitSlop={8} accessibilityRole="button">
                  <Text style={[s.offlineAction, { color: colors.danger }]}>Cancelar</Text>
                </Pressable>
              </View>
              <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
            </View>
          );
        })}
        {picked?.kind === 'photo' ? (
          <PhotoPanel photo={picked.photo} online={online} onClose={() => setPicked(null)} />
        ) : picked?.kind === 'station' ? (
          <StationPanel station={picked.station} me={me} layers={layers} onClose={() => setPicked(null)} />
        ) : picked?.kind === 'point' ? (
          <PointPanel lat={picked.lat} lng={picked.lng} me={me} layers={layers} onClose={() => setPicked(null)} />
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={s.h3}>Tu ubicación</Text>
            {me ? (
              <>
                {myWorkArea && <WorkAreaLine check={myWorkArea} />}
                <AreaLine areas={myAreas!} />
                <Text style={s.small}>{formatUtm(latLngToUtm(me.lat, me.lng))}{me.accuracy != null ? ` · GPS ±${Math.round(me.accuracy)} m` : ''}</Text>
              </>
            ) : (
              <Text style={s.small}>{pos.status === 'denied' ? 'Sin permiso de ubicación.' : 'Buscando GPS…'}</Text>
            )}
            {outsideCount > 0 && <Text style={[s.small, { color: PHOTO_COLOR.outside, fontWeight: '700' }]}>{outsideCount} foto{outsideCount === 1 ? '' : 's'} fuera del polígono</Text>}
            {teamError && supervised.length > 0 && <Text style={s.small}>Fotos de tus brigadas: {teamError}</Text>}
            {!online && supervised.length > 0 && <Text style={s.small}>Sin conexión: no se ven las fotos de tus brigadas.</Text>}
            <Text style={s.hint}>Toca una estación o una foto para ver el detalle, o cualquier punto del mapa para medir desde tu ubicación.</Text>
          </View>
        )}
      </View>

      {toDownload && <DownloadDialog bounds={toDownload} online={online} onClose={() => setToDownload(null)} />}
    </View>
  );
}

/** Confirma la descarga de la zona visible: estimado, aviso de wifi y nombre. */
function DownloadDialog({ bounds, online, onClose }: { bounds: WpBounds; online: boolean; onClose: () => void }) {
  const est = useMemo(() => estimateZone(bounds), [bounds]);
  const [name, setName] = useState(() => {
    const d = new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    return `Zona ${d.replace(/\//g, '-').replace(',', '')}`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await createZone(name.trim() || 'Zona sin nombre', bounds);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar la descarga');
      setBusy(false);
    }
  };
  return (
    <View style={s.backdrop}>
      <View style={s.dialog}>
        <Text style={s.h3}>Descargar esta zona</Text>
        {est.tooBig ? (
          <Text style={[s.body, { color: colors.warn }]}>
            La zona visible necesita {est.tiles.toLocaleString('es-PE')} teselas (máximo {ZONE_MAX_TILES.toLocaleString('es-PE')}). Acerca el mapa y vuelve a intentarlo.
          </Text>
        ) : (
          <>
            <Text style={s.body}>
              Imagen satelital de lo que ves en pantalla, zoom 12 a 18: unas {est.tiles.toLocaleString('es-PE')} teselas, aprox. {est.mb.toLocaleString('es-PE')} MB.
            </Text>
            <Text style={s.hint}>Se recomienda conectarse a wifi. Si cancelas, lo ya descargado queda guardado.</Text>
            <TextInput value={name} onChangeText={setName} style={s.input} placeholder="Nombre de la zona" accessibilityLabel="Nombre de la zona" />
            {!online && <Text style={[s.hint, { color: colors.warn }]}>Sin conexión: conéctate para descargar.</Text>}
          </>
        )}
        {error && <Text style={[s.hint, { color: colors.danger }]}>{error}</Text>}
        <View style={[s.row, { justifyContent: 'flex-end', gap: 18, paddingTop: 4 }]}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button"><Text style={[s.offlineAction, { color: colors.text2, fontSize: 15 }]}>Cerrar</Text></Pressable>
          {!est.tooBig && (
            <Pressable onPress={() => void start()} disabled={busy || !online} hitSlop={8} accessibilityRole="button">
              <Text style={[s.offlineAction, { fontSize: 15 }, (busy || !online) && { opacity: 0.4 }]}>{busy ? 'Iniciando…' : 'Descargar'}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function WorkAreaLine({ check }: { check: AreaCheck }) {
  if (check.status === 'sin_area' || check.status === 'sin_gps') return null;
  const inside = check.status === 'dentro';
  return (
    <Text style={[s.area, { color: inside ? PHOTO_COLOR.inside : PHOTO_COLOR.outside }]}>
      {inside ? `Dentro de ${check.areaName}` : `Fuera de ${check.areaName} · a ${check.distanceM < 10 ? 'menos de 10 m' : formatDistance(check.distanceM)}`}
    </Text>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function PhotoPanel({ photo, online, onClose }: { photo: MapPhoto; online: boolean; onClose: () => void }) {
  const [remote, setRemote] = useState<{ id: string; url: string } | null>(null);
  const team = photo.src === 'team' ? photo.photo : null;
  const remoteUrl = remote && remote.id === team?.id ? remote.url : null;
  useEffect(() => {
    if (!team || !team.uploaded || !online) return;
    let alive = true;
    api<{ url: string }>(`/field/attachments/${team.id}/url?variant=compressed`).then((r) => { if (alive) setRemote({ id: team.id, url: r.url }); }).catch(() => {});
    return () => { alive = false; };
  }, [team?.id, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = photo.src === 'mine' && !photo.photo.freed ? photo.photo.path : null;
  const uri = local ?? remoteUrl;
  const title = photo.src === 'mine'
    ? [photo.photo.unitCode, photo.brigade?.name].filter(Boolean).join(' · ') || 'Mi foto'
    : [photo.photo.unitCode ?? photo.photo.stationCode, photo.photo.brigadeName].filter(Boolean).join(' · ') || 'Foto';
  const { takenAt, accuracy } = photo.photo;
  const status = photo.outside === true ? { text: 'Fuera del polígono', color: PHOTO_COLOR.outside }
    : photo.outside === false ? { text: 'Dentro del polígono', color: PHOTO_COLOR.inside }
      : { text: 'Sin polígono para verificar', color: colors.text2 };
  return (
    <View style={{ gap: 8 }}>
      <View style={s.row}>
        <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar"><Text style={s.close}>✕</Text></Pressable>
      </View>
      <View style={[s.row, { alignItems: 'flex-start', gap: 12 }]}>
        {uri ? (
          <Image source={{ uri }} style={s.thumb} contentFit="cover" accessibilityLabel={`Foto ${title}`} />
        ) : (
          <View style={[s.thumb, s.center]}>
            <Text style={[s.hint, { textAlign: 'center' }]}>
              {photo.src === 'mine' ? 'Ya enviada (liberada del teléfono)' : !team?.uploaded ? 'Aún en el teléfono del especialista' : online ? 'Cargando…' : 'Sin conexión'}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[s.area, { color: status.color, fontSize: 15 }]}>{status.text}</Text>
          <Text style={s.small}>{when(takenAt)}{team ? ` · ${team.takenBy}` : ''}</Text>
          <Text style={s.small}>{formatUtm(latLngToUtm(photo.lat, photo.lng))}{accuracy != null ? ` · ±${Math.round(accuracy)} m` : ''}</Text>
        </View>
      </View>
    </View>
  );
}

function AreaLine({ areas }: { areas: ReturnType<typeof classifyPoint> }) {
  const tone = areas.influence === 'AID' ? KIND.aid.color : areas.influence === 'AII' ? KIND.aii.color : colors.text2;
  return (
    <View style={{ gap: 3 }}>
      {areas.influence && (
        <Text style={[s.area, { color: tone }]}>
          {areas.influence === 'fuera' ? 'Fuera del área de influencia' : `Dentro del ${areas.influence}`}
          {areas.inFootprint ? ' · en la huella del proyecto' : ''}
        </Text>
      )}
      {areas.vegetation != null && <Text style={s.body}>Vegetación: {areas.vegetation || 'sin unidad de vegetación'}</Text>}
      {areas.overlaps.length > 0 && <Text style={s.body}>Superposición: {areas.overlaps.join(', ')}</Text>}
      {!areas.influence && areas.vegetation == null && <Text style={s.small}>El proyecto no tiene capas para verificar.</Text>}
    </View>
  );
}

function StationPanel({ station, me, layers, onClose }: {
  station: WpStation; me: { lat: number; lng: number } | null; layers: WpLayer[]; onClose: () => void;
}) {
  const d = me ? distanceMeters(me.lat, me.lng, station.lat, station.lng) : null;
  const here = d != null && d <= 50;
  const myAreas = me ? classifyPoint(layers, me.lat, me.lng) : null;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Text style={[s.h3, { flex: 1 }]}>{station.code}{station.name ? ` · ${station.name}` : ''}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar"><Text style={s.close}>✕</Text></Pressable>
      </View>
      {d != null && me && (
        <Text style={s.big}>{here ? 'Estás en la estación' : `${formatDistance(d)} al ${bearingLabel(me.lat, me.lng, station.lat, station.lng)}`}</Text>
      )}
      <Text style={s.body}>
        Estación: {station.influenceArea === 'fuera' ? 'fuera del área' : station.influenceArea ?? '—'} · {station.vegetationUnit ?? '—'}
      </Text>
      {myAreas?.influence && (
        <Text style={s.small}>
          Tú: {myAreas.influence === 'fuera' ? 'fuera del área' : `dentro del ${myAreas.influence}`}
          {myAreas.influence !== station.influenceArea && station.influenceArea ? ' (no coincide con la estación)' : ''}
        </Text>
      )}
      <Pressable onPress={() => router.push({ pathname: '/estacion/[id]', params: { id: station.id } })} style={s.link} accessibilityRole="button">
        <Text style={s.linkText}>Ver estación y unidades ›</Text>
      </Pressable>
    </View>
  );
}

function PointPanel({ lat, lng, me, layers, onClose }: {
  lat: number; lng: number; me: { lat: number; lng: number } | null; layers: WpLayer[]; onClose: () => void;
}) {
  const d = me ? distanceMeters(me.lat, me.lng, lat, lng) : null;
  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <Text style={[s.h3, { flex: 1 }]}>Punto marcado</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quitar punto"><Text style={s.close}>✕</Text></Pressable>
      </View>
      {d != null && me && <Text style={s.big}>{formatDistance(d)} al {bearingLabel(me.lat, me.lng, lat, lng)} de ti</Text>}
      <Text style={s.small}>{formatUtm(latLngToUtm(lat, lng))}</Text>
      <AreaLine areas={classifyPoint(layers, lat, lng)} />
    </View>
  );
}

function OfflineRow({ basemap, online }: { basemap: ReturnType<typeof useWorkMaps>; online: boolean }) {
  const st = basemap.state;
  if (st.status === 'checking') return null;
  const notes = basemap.notes.length > 0 && (
    <Text style={[s.hint, { color: colors.warn }]}>{basemap.notes.join('\n')}</Text>
  );
  const what = basemap.zones.length > 1 ? `de tus ${basemap.zones.length} zonas de brigada` : 'de tu brigada';
  if (!basemap.zones.some((z) => !z.tooBig)) {
    return <View style={[s.offline, { backgroundColor: '#FFF4E0' }]}>{notes || <Text style={s.offlineText}>Sin zona para el mapa offline.</Text>}</View>;
  }
  if (st.status === 'complete') {
    return (
      <View style={{ gap: 4 }}>
      <View style={[s.offline, s.offlineOk]}>
        <Text style={[s.offlineText, { color: colors.primary }]}>Mapa y satélite sin conexión · {formatMb(st.bytes)}</Text>
        {online && (
          <Pressable onPress={() => void basemap.redownload()} hitSlop={8} accessibilityRole="button">
            <Text style={s.offlineAction}>Actualizar</Text>
          </Pressable>
        )}
      </View>
      {notes}
      </View>
    );
  }
  if (st.status === 'downloading') {
    return (
      <View style={[s.offline, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
        <Text style={s.offlineText}>Descargando mapa y satélite {what}… {st.percent}% · {formatMb(st.bytes)}</Text>
        <View style={s.track}><View style={[s.fill, { width: `${st.percent}%` }]} /></View>
      </View>
    );
  }
  return (
    <View style={{ gap: 4 }}>
      <View style={[s.offline, { backgroundColor: '#FFF4E0' }]}>
        <Text style={[s.offlineText, { color: colors.warn, flex: 1 }]}>
          {st.status === 'error'
            ? `No se completó la descarga: ${st.message}`
            : online ? `El mapa ${what} aún no está guardado para usarlo sin conexión.` : 'Sin conexión: el mapa base no está descargado (las capas sí se ven).'}
        </Text>
        {online && (
          <Pressable onPress={() => void basemap.download()} hitSlop={8} accessibilityRole="button">
            <Text style={[s.offlineAction, { color: colors.warn }]}>{st.status === 'error' ? 'Reintentar' : 'Descargar'}</Text>
          </Pressable>
        )}
      </View>
      {notes}
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: colors.text2, textAlign: 'center' },
  chipsBar: { position: 'absolute', top: 10, left: 0, right: 0, flexGrow: 0 },
  chips: { paddingHorizontal: 12, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  chipOff: { backgroundColor: 'rgba(255,255,255,0.75)' },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 2 },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  fabs: { position: 'absolute', right: 12, top: 110, gap: 10 },
  fab: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, elevation: 3 },
  fabText: { fontSize: 22, color: colors.primary, fontWeight: '700' },
  fabSmall: { fontSize: 12, color: colors.primary, fontWeight: '800' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.surface, borderRadius: radius + 2, padding: 18, gap: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 15 },
  sheet: { position: 'absolute', left: 10, right: 10, bottom: 28, backgroundColor: colors.surface, borderRadius: radius + 2, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border, elevation: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  big: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  area: { fontSize: 16, fontWeight: '800' },
  body: { color: colors.text, lineHeight: 20 },
  small: { color: colors.text2, fontSize: 13, fontVariant: ['tabular-nums'] },
  hint: { color: colors.text2, fontSize: 12, lineHeight: 17 },
  close: { color: colors.text2, fontSize: 18, paddingHorizontal: 4 },
  thumb: { width: 112, height: 84, borderRadius: 8, backgroundColor: '#EEF1EC' },
  link: { paddingTop: 4 },
  linkText: { color: colors.primary, fontWeight: '700' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#EEF1EC' },
  offlineOk: { backgroundColor: colors.primarySoft },
  offlineText: { color: colors.text2, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  offlineAction: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#DCE3DC', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
});
