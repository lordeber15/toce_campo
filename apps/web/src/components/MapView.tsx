import { useEffect, useMemo } from 'react';
import { CircleMarker, GeoJSON, LayersControl, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
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

type Props = {
  layers?: FeatureCollection | null;
  stations?: MapStation[];
  onStationClick?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  pick?: { lat: number; lng: number } | null;
  height?: number | string;
  fitKey?: string; // cambia para volver a encuadrar
};

function FitBounds({ layers, stations, fitKey }: Pick<Props, 'layers' | 'stations' | 'fitKey'>) {
  const map = useMap();
  useEffect(() => {
    const b = L.latLngBounds([]);
    if (layers?.features.length) b.extend(L.geoJSON(layers).getBounds());
    stations?.forEach((s) => b.extend([s.lat, s.lng]));
    if (b.isValid()) map.fitBounds(b as LatLngBoundsExpression, { padding: [24, 24], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMapClick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function MapView({ layers, stations = [], onStationClick, onMapClick, pick, height = 480, fitKey }: Props) {
  const layerKey = useMemo(() => (layers ? layers.features.map((f) => f.id).join(',') : ''), [layers]);
  return (
    <MapContainer center={[-9.19, -75.0]} zoom={5} style={{ height, width: '100%', borderRadius: 10 }} scrollWheelZoom>
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
            return { color: f?.properties?.color || st.color, weight: 2, fillOpacity: st.fill };
          }}
          onEachFeature={(f, l) => {
            const p = f.properties as { name?: string; kind?: string; areaHa?: number };
            l.bindTooltip(`${KIND_STYLE[p.kind ?? 'otro']?.label ?? ''}: ${p.name ?? ''}${p.areaHa ? ` · ${p.areaHa.toLocaleString('es-PE')} ha` : ''}`, { sticky: true });
          }}
        />
      )}
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
      {pick && <CircleMarker center={[pick.lat, pick.lng]} radius={8} pathOptions={{ color: '#E03131', weight: 3, fillOpacity: 0.3 }} />}
      <ClickHandler onMapClick={onMapClick} />
      <FitBounds layers={layers} stations={stations} fitKey={fitKey ?? `${layerKey}|${stations.length}`} />
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
