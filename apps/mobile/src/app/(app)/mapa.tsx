import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Camera, GeoJSONSource, Layer, Map, UserLocation, type CameraRef } from '@maplibre/maplibre-react-native';
import { classifyPoint, distanceMeters, formatUtm, latLngToUtm, type LayerKind, type WpLayer, type WpStation } from '@toce/shared';
import { BASEMAP_STYLE_URL, formatMb, useBasemap } from '../../lib/basemap';
import { bearingLabel, formatDistance, usePosition } from '../../lib/location';
import { todayLima, usePackageIndex } from '../../lib/workPackage';
import { useAuth } from '../../lib/auth';
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

type Picked = { kind: 'station'; station: WpStation } | { kind: 'point'; lat: number; lng: number };

/** Mapa offline: base OSM, capas del proyecto, estaciones, tu ubicación y verificación del área de influencia. */
export default function MapScreen() {
  const { station: stationParam } = useLocalSearchParams<{ station?: string }>();
  const index = usePackageIndex();
  const { online } = useAuth();
  const pos = usePosition();
  const camera = useRef<CameraRef>(null);
  const today = todayLima();

  const focus = stationParam ? index?.stations.get(stationParam) : undefined;
  const project = (focus ? index?.projects.get(focus.projectId) : undefined) ?? index?.pkg.projects[0];
  const basemap = useBasemap(project);
  const layers = useMemo(() => (index?.pkg.layers ?? []).filter((l) => l.projectId === project?.id) ?? [], [index, project?.id]);
  const kinds = useMemo(() => KIND_ORDER.filter((k) => layers.some((l) => l.kind === k)), [layers]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Picked | null>(focus ? { kind: 'station', station: focus } : null);

  const todayIds = useMemo(() => new Set(index?.pkg.schedules.filter((s) => s.plannedDate === today).map((s) => s.stationId)), [index, today]);
  const stations = useMemo(() => index?.pkg.stations.filter((s) => s.projectId === project?.id) ?? [], [index, project?.id]);

  const layerData = useMemo(() => {
    const by: Partial<Record<LayerKind, GeoJSON.FeatureCollection>> = {};
    let uvi = 0;
    for (const l of layers) {
      const color = l.color || (l.kind === 'uv' ? UV_PALETTE[uvi++ % UV_PALETTE.length]! : KIND[l.kind].color);
      (by[l.kind] ??= { type: 'FeatureCollection', features: [] }).features.push({
        type: 'Feature', id: l.id, properties: { name: l.name, color }, geometry: l.geometry as GeoJSON.Geometry,
      });
    }
    return by;
  }, [layers]);

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
        style={{ flex: 1 }}
        mapStyle={BASEMAP_STYLE_URL}
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
        {[...kinds.map((k) => ({ key: k as string, label: KIND[k].label, color: KIND[k].color })), { key: 'estaciones', label: 'Estaciones', color: colors.primary }].map((c) => {
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
        <Pressable style={s.fab} onPress={fit} accessibilityRole="button" accessibilityLabel="Ver todo el proyecto">
          <Text style={s.fabText}>⤢</Text>
        </Pressable>
      </View>

      {/* Panel inferior */}
      <View style={s.sheet}>
        <OfflineRow basemap={basemap} online={online} />
        {picked?.kind === 'station' ? (
          <StationPanel station={picked.station} me={me} layers={layers} onClose={() => setPicked(null)} />
        ) : picked?.kind === 'point' ? (
          <PointPanel lat={picked.lat} lng={picked.lng} me={me} layers={layers} onClose={() => setPicked(null)} />
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={s.h3}>Tu ubicación</Text>
            {me ? (
              <>
                <AreaLine areas={myAreas!} />
                <Text style={s.small}>{formatUtm(latLngToUtm(me.lat, me.lng))}{me.accuracy != null ? ` · GPS ±${Math.round(me.accuracy)} m` : ''}</Text>
              </>
            ) : (
              <Text style={s.small}>{pos.status === 'denied' ? 'Sin permiso de ubicación.' : 'Buscando GPS…'}</Text>
            )}
            <Text style={s.hint}>Toca una estación para ver la distancia, o cualquier punto del mapa para medir desde tu ubicación.</Text>
          </View>
        )}
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

function OfflineRow({ basemap, online }: { basemap: ReturnType<typeof useBasemap>; online: boolean }) {
  const st = basemap.state;
  if (st.status === 'checking') return null;
  if (st.status === 'complete') {
    return (
      <View style={[s.offline, s.offlineOk]}>
        <Text style={[s.offlineText, { color: colors.primary }]}>Mapa disponible sin conexión · {formatMb(st.bytes)}</Text>
        {online && (
          <Pressable onPress={() => void basemap.redownload()} hitSlop={8} accessibilityRole="button">
            <Text style={s.offlineAction}>Actualizar</Text>
          </Pressable>
        )}
      </View>
    );
  }
  if (st.status === 'downloading') {
    return (
      <View style={[s.offline, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
        <Text style={s.offlineText}>Descargando mapa del proyecto… {st.percent}% · {formatMb(st.bytes)}</Text>
        <View style={s.track}><View style={[s.fill, { width: `${st.percent}%` }]} /></View>
      </View>
    );
  }
  return (
    <View style={[s.offline, { backgroundColor: '#FFF4E0' }]}>
      <Text style={[s.offlineText, { color: colors.warn, flex: 1 }]}>
        {st.status === 'error'
          ? `No se completó la descarga: ${st.message}`
          : online ? 'El mapa aún no está guardado para usarlo sin conexión.' : 'Sin conexión: el mapa base no está descargado (las capas sí se ven).'}
      </Text>
      {online && (
        <Pressable onPress={() => void basemap.download()} hitSlop={8} accessibilityRole="button">
          <Text style={[s.offlineAction, { color: colors.warn }]}>{st.status === 'error' ? 'Reintentar' : 'Descargar'}</Text>
        </Pressable>
      )}
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
  sheet: { position: 'absolute', left: 10, right: 10, bottom: 28, backgroundColor: colors.surface, borderRadius: radius + 2, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border, elevation: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  big: { fontSize: 20, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  area: { fontSize: 16, fontWeight: '800' },
  body: { color: colors.text, lineHeight: 20 },
  small: { color: colors.text2, fontSize: 13, fontVariant: ['tabular-nums'] },
  hint: { color: colors.text2, fontSize: 12, lineHeight: 17 },
  close: { color: colors.text2, fontSize: 18, paddingHorizontal: 4 },
  link: { paddingTop: 4 },
  linkText: { color: colors.primary, fontWeight: '700' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#EEF1EC' },
  offlineOk: { backgroundColor: colors.primarySoft },
  offlineText: { color: colors.text2, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  offlineAction: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#DCE3DC', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
});
