import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { distanceMeters } from '@toce/shared';
import type { MethodProgress, StationDay } from '../lib/workPackage';
import { bearingLabel, formatDistance, type PositionState } from '../lib/location';
import { colors, radius } from '../theme';

export const UNIT_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  pendiente: { label: 'Pendiente', fg: colors.text2, bg: '#EEF1EC' },
  en_ejecucion: { label: 'En curso', fg: '#1D5FA8', bg: '#E4EEF9' },
  fotos_ok: { label: 'Fotos listas', fg: colors.warn, bg: '#FFF4E0' },
  completada: { label: 'Completada', fg: colors.primary, bg: colors.primarySoft },
  no_realizada: { label: 'No realizada', fg: colors.danger, bg: colors.dangerSoft },
};

export const SCHEDULE_STATUS: Record<string, string> = {
  planificada: 'Planificada',
  en_curso: 'En curso',
  ejecutada: 'Ejecutada',
  no_realizada: 'No realizada',
  reprogramada: 'Reprogramada',
  cancelada: 'Cancelada',
};

export function Pill({ children, fg = colors.text2, bg = '#EEF1EC' }: { children: ReactNode; fg?: string; bg?: string }) {
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.min(1, value / total) : 0;
  return (
    <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: value }}>
      <View style={[s.fill, { width: `${pct * 100}%` }, pct === 1 && { backgroundColor: colors.primary }]} />
    </View>
  );
}

/** "PC · Puntos de conteo   2/6" con barra de avance. Los métodos abiertos (RO) muestran conteo. */
export function MethodLine({ m }: { m: MethodProgress }) {
  const total = m.method.isOpenEnded ? 0 : m.stationMethod.unitsRequired;
  return (
    <View style={s.methodLine}>
      <View style={s.methodHead}>
        <Text style={s.methodCode}>{m.method.code}</Text>
        <Text style={s.methodName} numberOfLines={1}>{m.method.name}</Text>
        <Text style={s.methodCount}>
          {m.method.isOpenEnded ? `${m.units.length} reg.` : `${m.done}/${total}`}
        </Text>
      </View>
      {!m.method.isOpenEnded && <ProgressBar value={m.done} total={total} />}
    </View>
  );
}

/** Distancia y rumbo desde el teléfono hasta la estación. Funciona sin internet (GPS). */
export function DistanceText({ pos, lat, lng, style }: { pos: PositionState; lat: number; lng: number; style?: object }) {
  if (pos.status === 'denied') return <Text style={[s.dist, s.distMuted, style]}>Sin permiso de ubicación</Text>;
  if (pos.status === 'waiting') return <Text style={[s.dist, s.distMuted, style]}>Buscando GPS…</Text>;
  const p = pos.position;
  const d = distanceMeters(p.lat, p.lng, lat, lng);
  return (
    <Text style={[s.dist, style]} accessibilityLabel={`A ${formatDistance(d)} hacia el ${bearingLabel(p.lat, p.lng, lat, lng)}`}>
      {formatDistance(d)} <Text style={s.distDir}>{bearingLabel(p.lat, p.lng, lat, lng)}</Text>
    </Text>
  );
}

export function StationCard({ item, pos, showBrigade, onPress }: { item: StationDay; pos: PositionState; showBrigade: boolean; onPress: () => void }) {
  const { station, methods, schedule } = item;
  const total = methods.reduce((a, m) => a + (m.method.isOpenEnded ? 0 : m.stationMethod.unitsRequired), 0);
  const done = methods.reduce((a, m) => a + (m.method.isOpenEnded ? 0 : m.done), 0);
  const status = schedule.status !== 'planificada' ? SCHEDULE_STATUS[schedule.status] : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Estación ${station.code}, ${done} de ${total} unidades completadas`}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
    >
      <View style={s.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={s.code}>{station.code}</Text>
          {!!station.name && <Text style={s.name} numberOfLines={1}>{station.name}</Text>}
        </View>
        <DistanceText pos={pos} lat={station.lat} lng={station.lng} />
      </View>
      <View style={s.tags}>
        {!!station.influenceArea && <Pill fg={colors.primary} bg={colors.primarySoft}>{station.influenceArea}</Pill>}
        {!!station.vegetationUnit && <Pill>{station.vegetationUnit}</Pill>}
        {showBrigade && <Pill>{item.brigadeName}</Pill>}
        {status && <Pill fg={colors.warn} bg="#FFF4E0">{status}</Pill>}
      </View>
      <View style={s.methods}>
        {methods.length ? methods.map((m) => <MethodLine key={m.stationMethod.id} m={m} />) : (
          <Text style={s.empty}>Sin métodos de tu especialidad en esta estación.</Text>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E6EBE3', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  methodLine: { gap: 6 },
  methodHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  methodCode: { fontWeight: '700', color: colors.text, minWidth: 36 },
  methodName: { flex: 1, color: colors.text2 },
  methodCount: { fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  dist: { fontSize: 16, fontWeight: '700', color: colors.primary, fontVariant: ['tabular-nums'] },
  distMuted: { fontSize: 13, fontWeight: '500', color: colors.text2 },
  distDir: { fontSize: 13, fontWeight: '600', color: colors.text2 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  code: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: 0.3 },
  name: { color: colors.text2, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  methods: { gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  empty: { color: colors.text2 },
});
