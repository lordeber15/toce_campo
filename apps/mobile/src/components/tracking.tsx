import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { TRACK_MAX_ACTIVE, TRACK_MIN_SECONDS, formatTrackDuration, formatUtm, latLngToUtm, type WpStation } from '@toce/shared';
import { useAuth } from '../lib/auth';
import { useField } from '../lib/field';
import { TrackingError, sessionSeconds, startTracking, stopTracking, useStationTracking, type LocalTrackSession } from '../lib/gpsTracking';
import { colors, radius } from '../theme';

const hhmm = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const utm = (lat: number | null, lng: number | null) => (lat != null && lng != null ? formatUtm(latLngToUtm(lat, lng)) : 'sin GPS');

/**
 * Tracking GPS de la EM: activar / desactivar, total acumulado frente al mínimo de 2 h e historial
 * de dónde y cuándo se activó y se desactivó. Al cerrar la EM (todas sus unidades terminadas y el
 * tracking apagado) con menos de 2 h, registra una alerta automática (una sola vez por EM).
 */
export function TrackingCard({ station, scheduleId, brigadeId, closed }: {
  station: WpStation; scheduleId: string | null; brigadeId: string | null; closed: boolean;
}) {
  const { user } = useAuth();
  const field = useField();
  const t = useStationTracking(user?.id ?? null, station.id);
  const [busy, setBusy] = useState(false);
  const pct = Math.min(1, t.totalSec / TRACK_MIN_SECONDS);
  const reached = t.totalSec >= TRACK_MIN_SECONDS;

  const toggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      if (t.active) await stopTracking(t.active.clientId);
      else await startTracking({ userId: user.id, stationId: station.id, scheduleId, brigadeId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo cambiar el tracking';
      Alert.alert('Tracking', msg, e instanceof TrackingError && msg.includes('todo el tiempo')
        ? [{ text: 'Cancelar', style: 'cancel' }, { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() }]
        : undefined);
    } finally {
      setBusy(false);
    }
  };

  // Alerta automática al cerrar la EM con menos de 2 h de tracking.
  const alerted = field.incidents.some((i) => i.stationId === station.id && i.type === 'tracking_insuficiente');
  const sending = useRef(false);
  useEffect(() => {
    if (!closed || t.active || reached || alerted || sending.current || !user) return;
    sending.current = true;
    const n = t.sessions.length;
    void field.saveIncident({
      clientId: Crypto.randomUUID(), projectId: station.projectId, brigadeId, stationId: station.id, methodId: null, unitId: null, unitCode: null,
      scheduleId, type: 'tracking_insuficiente', moment: 'posterior', launchedFrom: 'estacion',
      description: `Alerta automática: ${station.code} se cerró con ${formatTrackDuration(t.totalSec)} de tracking GPS `
        + `(mínimo ${formatTrackDuration(TRACK_MIN_SECONDS)}). ${n ? `${n} tramo${n === 1 ? '' : 's'} registrado${n === 1 ? '' : 's'}.` : 'No se activó el tracking.'}`,
      proposedAction: null, unitNotDone: false, occurredAt: new Date().toISOString(), lat: null, lng: null,
    }).finally(() => { sending.current = false; });
  }, [closed, t.active, reached, alerted, user, t.sessions.length, t.totalSec, station, scheduleId, brigadeId, field]);

  const barColor = reached ? colors.accent : colors.warn;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Tracking GPS</Text>
          <Text style={s.small}>
            {formatTrackDuration(t.totalSec)} de {formatTrackDuration(TRACK_MIN_SECONDS)}{reached ? ' · mínimo cumplido' : ''}
          </Text>
        </View>
        {t.active && <View style={s.live}><View style={s.liveDot} /><Text style={s.liveText}>Activo</Text></View>}
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} /></View>

      <Pressable
        onPress={() => void toggle()}
        disabled={busy || (!t.active && t.activeCount >= TRACK_MAX_ACTIVE)}
        style={({ pressed }) => [s.btn, t.active ? s.btnStop : s.btnStart, pressed && { opacity: 0.75 }, (busy || (!t.active && t.activeCount >= TRACK_MAX_ACTIVE)) && { opacity: 0.5 }]}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color={t.active ? colors.danger : colors.white} /> : (
          <Text style={[s.btnText, t.active && { color: colors.danger }]}>{t.active ? 'Desactivar tracking' : 'Activar tracking'}</Text>
        )}
      </Pressable>
      {!t.active && t.activeCount >= TRACK_MAX_ACTIVE && <Text style={s.hint}>Ya tienes {TRACK_MAX_ACTIVE} EM con tracking activo. Desactiva una para usar esta.</Text>}
      {t.stalled && <Text style={[s.hint, { color: colors.warn }]}>Sin señal de GPS hace varios minutos: el recorrido puede tener un hueco.</Text>}
      {closed && t.active && <Text style={s.hint}>Terminaste las unidades de esta EM. Desactiva el tracking al salir.</Text>}
      {alerted && !reached && <Text style={[s.hint, { color: colors.danger }]}>Se registró una alerta por tracking menor a 2 h.</Text>}

      {t.sessions.length > 0 && (
        <View style={{ gap: 0 }}>
          <Text style={s.section}>Historial</Text>
          {t.sessions.slice().reverse().map((x) => <SessionRow key={x.clientId} s={x} />)}
        </View>
      )}
    </View>
  );
}

function SessionRow({ s: x }: { s: LocalTrackSession }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowText}><Text style={s.on}>▶ </Text>{hhmm(x.startedAt)} · {utm(x.startLat, x.startLng)}</Text>
        {x.endedAt
          ? <Text style={s.rowText}><Text style={s.off}>■ </Text>{hhmm(x.endedAt)} · {utm(x.endLat, x.endLng)}</Text>
          : <Text style={[s.rowText, { color: colors.accent }]}>En curso…</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.dur}>{formatTrackDuration(sessionSeconds(x))}</Text>
        <Text style={s.small}>{x.pointCount} pts{x.synced ? ' · enviado' : ''}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  small: { color: colors.text2, fontSize: 12, fontVariant: ['tabular-nums'] },
  hint: { color: colors.text2, fontSize: 13, lineHeight: 18 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  liveText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  track: { height: 8, borderRadius: 4, backgroundColor: '#E6EBE3', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  btn: { borderRadius: radius, paddingVertical: 13, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnStart: { backgroundColor: colors.primary },
  btnStop: { backgroundColor: colors.dangerSoft, borderWidth: 1.5, borderColor: colors.danger },
  btnText: { color: colors.white, fontWeight: '800', fontSize: 15 },
  section: { fontSize: 12, fontWeight: '700', color: colors.text2, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4, marginBottom: 2 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  on: { color: colors.accent },
  off: { color: colors.danger },
  dur: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
