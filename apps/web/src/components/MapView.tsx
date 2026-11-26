import { useEffect, useMemo } from 'react';
import { CircleMarker, GeoJSON, LayersControl, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { type LatLngBoundsExpression } from 'leaflet';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';

export const KIND_STYLE: Record<string, { color: string; fill: number; label: string }> = {
  huella: { color: '#E03131', fill: 0.08, label: 'Huella del proyecto' },
  aii: { color: '#1C7ED6', fill: 0.04, label: 'Influencia indirecta (AII)' },
  aid: { color: '#F2B705', fill: 0.06, label: 'Influencia directa (AID)' },
  uv: { color: '#2F9E44', fill: 0.12, label: 'Unidad de vegetación' },
  superposicion: { color: '#9C36B5', fill: 0.1, label: 'Superposición' },
  otro: { color: '#868E96', fill: 0.05, label: 'Otra capa' },
};

export type MapStation = { id: string; code: string; lat: number; lng: number; color?: string; selected?: boolean };
/** Foto ubicada: verde dentro del polígono de la brigada, rojo fuera, gris si no se pudo verificar. */
export type MapPhoto = { id: string; lat: number; lng: number; outside: boolean | null; label: string; selected?: boolean };

/** Recorrido de tracking GPS: línea [lat, lng] con su inicio (verde) y fin (rojo). */
export type MapTrack = {
  id: string; color: string; line: [number, number][]; start: [number, number] | null; end: [number, number] | null; label: string; selected?: boolean;
};

export const PHOTO_COLORS = { inside: '#2F9E44', outside: '#E03131', unknown: '#868E96' };
export const BRIGADE_AREA_COLOR = '#F76707';
const photoColor = (o: boolean | null) => (o === true ? PHOTO_COLORS.outside : o === false ? PHOTO_COLORS.inside : PHOTO_COLORS.unknown);

type Props = {
  layers?: FeatureCollection | null;
  /** Polígonos de trabajo de las brigadas (properties.name / areaName). */
  areas?: FeatureCollection | null;
  photos?: MapPhoto[];
  onPhotoClick?: (id: string) => void;
  tracks?: MapTrack[];
  onTrackClick?: (id: string) => void;
  stations?: MapStation[];
  onStationClick?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  pick?: { lat: number; lng: number } | null;
  height?: number | string;
  fitKey?: string; // cambia para volver a encuadrar
};

function FitBounds({ layers, areas, stations, photos, tracks, fitKey }: Pick<Props, 'layers' | 'areas' | 'stations' | 'photos' | 'tracks' | 'fitKey'>) {
  const map = useMap();
  useEffect(() => {
    const b = L.latLngBounds([]);
    if (layers?.features.length) b.extend(L.geoJSON(layers).getBounds());
    if (areas?.features.length) b.extend(L.geoJSON(areas).getBounds());
    stations?.forEach((s) => b.extend([s.lat, s.lng]));
    photos?.forEach((p) => b.extend([p.lat, p.lng]));
    tracks?.forEach((t) => {
      t.line.forEach((pt) => b.extend(pt));
      if (t.start) b.extend(t.start);
      if (t.end) b.extend(t.end);
    });
    if (b.isValid()) map.fitBounds(b as LatLngBoundsExpression, { padding: [24, 24], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMapClick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function MapView({ layers, areas, photos = [], onPhotoClick, tracks = [], onTrackClick, stations = [], onStationClick, onMapClick, pick, height = 480, fitKey }: Props) {
  const layerKey = useMemo(() => (layers ? layers.features.map((f) => f.id).join(',') : ''), [layers]);
  const areaKey = useMemo(() => (areas ? areas.features.map((f) => f.id).join(',') : ''), [areas]);
  return (
    <MapContainer center={[-9.19, -75.0]} zoom={5} style={{ height, width: '100%', borderRadius: 10 }} scrollWheelZoom preferCanvas>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Relieve (OpenTopoMap)">
          <TileLayer attribution="&copy; OpenTopoMap, OpenStreetMap" url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png" maxZoom={17} />
        </LayersControl.BaseLayer>
      </LayersControl>
      {layers && (
        <GeoJSON
          key={layerKey}
          data={layers}
          style={(f) => {
            const st = KIND_STYLE[String(f?.properties?.kind)] ?? KIND_STYLE.otro!;
            const color = f?.properties?.color || st.color;
            // El relleno del KMZ (si lo trae) se respeta, pero sin tapar el mapa base.
            const kmzFill = Number((f?.properties?.properties as Record<string, unknown> | undefined)?.['fill-opacity']);
            const fill = Number.isFinite(kmzFill) && kmzFill > 0 ? Math.min(kmzFill, 0.35) : st.fill;
            return { color, weight: 1.5, fillColor: color, fillOpacity: fill };
          }}
          pointToLayer={(f, latlng) => {
            const color = f.properties?.color || KIND_STYLE[String(f.properties?.kind)]?.color || KIND_STYLE.otro!.color;
            return L.circleMarker(latlng, { radius: 5, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 });
          }}
          onEachFeature={(f, l) => {
            const p = f.properties as { name?: string; kind?: string; areaHa?: number; folderPath?: string[] };
            const folder = p.folderPath?.length ? p.folderPath[p.folderPath.length - 1] : KIND_STYLE[p.kind ?? 'otro']?.label;
            const label = `${folder && folder !== p.name ? `${folder}: ` : ''}${p.name ?? ''}${p.areaHa ? ` · ${p.areaHa.toLocaleString('es-PE')} ha` : ''}`;
            const tip = document.createElement('span');
            tip.textContent = label; // texto del KMZ: sin interpretar HTML
            l.bindTooltip(tip, { sticky: true });
          }}
        />
      )}
      {areas && (
        <GeoJSON
          key={`areas-${areaKey}`}
          data={areas}
          style={() => ({ color: BRIGADE_AREA_COLOR, weight: 3, dashArray: '8 6', fillColor: BRIGADE_AREA_COLOR, fillOpacity: 0.07 })}
          onEachFeature={(f, l) => {
            const p = f.properties as { name?: string; areaName?: string | null; areaHa?: number };
            l.bindTooltip(`Polígono de ${p.name ?? 'brigada'}${p.areaName ? `: ${p.areaName}` : ''}${p.areaHa ? ` · ${p.areaHa.toLocaleString('es-PE')} ha` : ''}`, { sticky: true });
          }}
        />
      )}
      {tracks.map((t) => (
        <Polyline
          key={`l-${t.id}`}
          positions={t.line}
          pathOptions={{ color: t.color, weight: t.selected ? 6 : 3.5, opacity: t.selected ? 1 : 0.85 }}
          eventHandlers={{ click: () => onTrackClick?.(t.id) }}
        >
          <Tooltip sticky>{t.label}</Tooltip>
        </Polyline>
      ))}
      {tracks.flatMap((t) => [
        t.start && (
          <CircleMarker key={`s-${t.id}`} center={t.start} radius={5} pathOptions={{ color: t.color, weight: 2, fillColor: '#2F9E44', fillOpacity: 1 }}
            eventHandlers={{ click: () => onTrackClick?.(t.id) }}>
            <Tooltip direction="top">Activado · {t.label}</Tooltip>
          </CircleMarker>
        ),
        t.end && (
          <CircleMarker key={`e-${t.id}`} center={t.end} radius={5} pathOptions={{ color: t.color, weight: 2, fillColor: '#E03131', fillOpacity: 1 }}
            eventHandlers={{ click: () => onTrackClick?.(t.id) }}>
            <Tooltip direction="top">Desactivado · {t.label}</Tooltip>
          </CircleMarker>
        ),
      ])}
      {stations.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={s.selected ? 9 : 7}
          pathOptions={{ color: '#fff', weight: 2, fillColor: s.color ?? '#1F5C45', fillOpacity: 1 }}
          eventHandlers={{ click: () => onStationClick?.(s.id) }}
        >
          <Tooltip direction="top" offset={[0, -6]} permanent={stations.length <= 40}>
            {s.code}
          </Tooltip>
        </CircleMarker>
      ))}
      {photos.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={p.selected ? 9 : 6}
          pathOptions={{ color: p.selected ? '#111' : '#fff', weight: 2, fillColor: photoColor(p.outside), fillOpacity: 0.95 }}
          eventHandlers={{ click: () => onPhotoClick?.(p.id) }}
        >
          <Tooltip direction="top" offset={[0, -6]}>{p.label}</Tooltip>
        </CircleMarker>
      ))}
      {pick && <CircleMarker center={[pick.lat, pick.lng]} radius={8} pathOptions={{ color: '#E03131', weight: 3, fillOpacity: 0.3 }} />}
      <ClickHandler onMapClick={onMapClick} />
      <FitBounds layers={layers} areas={areas} stations={stations} photos={photos} tracks={tracks} fitKey={fitKey ?? `${layerKey}|${areaKey}|${stations.length}|${photos.length}|${tracks.length}`} />
    </MapContainer>
  );
}

export function MapLegend() {
  return (
    <div className="legend">
      {Object.entries(KIND_STYLE).map(([k, v]) => (
        <span key={k}><i style={{ borderColor: v.color, background: v.color + '33' }} />{v.label}</span>
      ))}
    </div>
  );
}
