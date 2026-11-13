import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { formatUtm, latLngToUtm, unitCode } from '@toce/shared';
import { todayLima, usePackageIndex, type MethodProgress } from '../../../lib/workPackage';
import { useField } from '../../../lib/field';
import { AlertButton } from '../../../components/alerts';
import { useRoleView } from '../../../lib/roles';
import { usePosition } from '../../../lib/location';
import { DistanceText, MethodLine, Pill, SCHEDULE_STATUS, UNIT_STATUS } from '../../../components/field';
import { colors, radius } from '../../../theme';

/** Detalle de una estación: ubicación, equipo y métodos con sus unidades de muestreo. */
export default function StationScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const index = usePackageIndex();
  const pos = usePosition();
  const field = useField();
  const roleView = useRoleView();
  const station = index?.stations.get(id);

  if (!index || !station) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Estación' }} />
        <Text style={s.muted}>Esta estación ya no está en tu paquete de trabajo.</Text>
      </View>
    );
  }

  const methods = index.methodsAt(station.id);
  const visits = index.pkg.schedules.filter((sc) => sc.stationId === station.id);
  const visit = visits.find((v) => v.plannedDate === date) ?? visits[0];
  const brigade = visit ? index.brigades.get(visit.brigadeId) : undefined;
  const utm = formatUtm(latLngToUtm(station.lat, station.lng));

  const openUnit = (unitId: string) => router.push({ pathname: '/unidad/[id]', params: { id: unitId, ...(date ? { date } : {}) } });

  /** Métodos abiertos (registros oportunos): cada observación crea su unidad con el siguiente correlativo. */
  const newOpenUnit = async (m: MethodProgress) => {
    try {
      const p = pos.status === 'ok' ? pos.position : null;
      const seq = Math.max(0, ...m.units.map((u) => u.seq)) + 1;
      const schedule = visits.find((v) => v.plannedDate === (date ?? todayLima())) ?? visit;
      const newUnitClientId = Crypto.randomUUID();
      await field.start({
        unitId: null, newUnitClientId, stationMethodId: m.stationMethod.id, stationId: station.id, methodId: m.method.id,
        scheduleId: schedule?.id ?? null, brigadeId: schedule?.brigadeId ?? null, unitCode: unitCode(station.code, m.method.code, seq),
        position: p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null,
      });
      openUnit(newUnitClientId);
    } catch (e) {
      Alert.alert('No se pudo crear el registro', e instanceof Error ? e.message : '');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap}>
      <Stack.Screen options={{ title: station.code }} />

      <View style={s.card}>
        <View style={s.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.code}>{station.code}</Text>
            {!!station.name && <Text style={s.muted}>{station.name}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <DistanceText pos={pos} lat={station.lat} lng={station.lng} style={{ fontSize: 20 }} />
            {pos.status === 'ok' && pos.position.accuracy != null && (
              <Text style={s.small}>GPS ±{Math.round(pos.position.accuracy)} m</Text>
            )}
          </View>
        </View>
        <Pressable onPress={() => router.push({ pathname: '/mapa', params: { station: station.id } })} style={s.mapBtn} accessibilityRole="button">
          <Text style={s.mapBtnText}>Ver en el mapa · verificar área de influencia</Text>
        </Pressable>
        <Row label="UTM (WGS84)" value={utm} mono />
        <Row label="Geográficas" value={`${station.lat.toFixed(6)}, ${station.lng.toFixed(6)}`} mono />
        {station.altitude != null && <Row label="Altitud" value={`${station.altitude.toLocaleString('es-PE')} m s. n. m.`} />}
        <Row label="Área de influencia" value={station.influenceArea === 'fuera' ? 'Fuera del área' : station.influenceArea} />
        <Row label="Unidad de vegetación" value={station.vegetationUnit} />
        <Row label="Superposición" value={station.overlap} />
        {!!station.accessNotes && <Row label="Acceso" value={station.accessNotes} block />}
      </View>

      {brigade && (
        <View style={s.card}>
          <Text style={s.h2}>Brigada {brigade.name}</Text>
          <View style={s.visits}>
            {visits.map((v) => (
              <Pill key={v.id} fg={v.plannedDate === date ? colors.white : colors.text2} bg={v.plannedDate === date ? colors.primary : '#EEF1EC'}>
                {shortDate(v.plannedDate)}{v.status !== 'planificada' ? ` · ${SCHEDULE_STATUS[v.status]}` : ''}
              </Pill>
            ))}
          </View>
          {brigade.members
            .slice()
            .sort((a, b) => Number(b.id === brigade.leaderId) - Number(a.id === brigade.leaderId))
            .map((m) => (
            <View key={m.id} style={s.member}>
              <View style={{ flex: 1 }}>
                <Text style={s.memberName}>{m.fullName}</Text>
                {m.id === brigade.leaderId && <Text style={s.small}>Jefe de brigada</Text>}
              </View>
              {m.phone ? (
                <Pressable onPress={() => void Linking.openURL(`tel:${m.phone}`)} accessibilityRole="link" accessibilityLabel={`Llamar a ${m.fullName}`} hitSlop={8}>
                  <Text style={s.phone}>{m.phone}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {!!brigade.leaderName && !brigade.members.some((m) => m.id === brigade.leaderId) && (
            <Row label="Jefe de brigada" value={brigade.leaderName} />
          )}
        </View>
      )}

      {roleView.executes ? (
        <AlertButton onPress={() => router.push({ pathname: '/alerta/nueva', params: { stationId: station.id, from: 'estacion' } })} />
      ) : roleView.supervises ? (
        <AlertButton label="Registrar incidencia de supervisión" onPress={() => router.push({ pathname: '/supervision/nueva', params: { stationId: station.id } })} />
      ) : null}

      <Text style={s.section}>Métodos</Text>
      {!methods.length && <Text style={s.muted}>{roleView.executes ? 'No hay métodos de tu especialidad en esta estación.' : 'No hay métodos programados para la brigada en esta estación.'}</Text>}
      {methods.map((m) => (
        <View key={m.stationMethod.id} style={s.card}>
          <MethodLine m={m} />
          <View style={s.meta}>
            {!!(m.method.scheduleStart && m.method.scheduleEnd) && <Pill>{`${m.method.scheduleStart}–${m.method.scheduleEnd}`}</Pill>}
            {m.method.minDurationMin != null && <Pill>{`mín. ${m.method.minDurationMin} min`}</Pill>}
            {m.method.photoSlots.length > 0 && <Pill>{`${m.method.photoSlots.length} fotos por unidad`}</Pill>}
          </View>
          {!!m.method.instructions && <Text style={s.instructions}>{m.method.instructions}</Text>}
          {!!m.stationMethod.notes && <Text style={s.instructions}>Nota: {m.stationMethod.notes}</Text>}
          {m.method.requirements.length > 0 && (
            <Text style={s.small}>Llevar: {m.method.requirements.join(', ')}</Text>
          )}

          {m.method.isOpenEnded && (
            <View style={s.openBox}>
              <Text style={s.muted}>Registro abierto: cada observación crea su unidad en campo.</Text>
            </View>
          )}
          {m.units.length > 0 && (
            <View style={s.units}>
              {m.units.map((u, i) => {
                const st = UNIT_STATUS[u.status] ?? UNIT_STATUS.pendiente!;
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => openUnit(u.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${u.code}, ${st.label}`}
                    style={({ pressed }) => [s.unit, { backgroundColor: st.bg, marginRight: i % 3 === 2 ? 0 : '2%' }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={[s.unitCode, { color: st.fg }]}>{`${m.method.code}-${String(u.seq).padStart(2, '0')}`}</Text>
                    <Text style={[s.unitStatus, { color: st.fg }]} numberOfLines={1}>{st.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {m.method.isOpenEnded && roleView.executes && (
            <Pressable onPress={() => void newOpenUnit(m)} style={({ pressed }) => [s.newBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <Text style={s.newBtnText}>+ Nuevo registro ({m.method.code})</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Row({ label, value, mono, block }: { label: string; value?: string | null; mono?: boolean; block?: boolean }) {
  return (
    <View style={[s.row, block && { flexDirection: 'column', gap: 4 }]}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, mono && { fontVariant: ['tabular-nums'] }, block && { textAlign: 'left', fontWeight: '400' }]} selectable>
        {value || '—'}
      </Text>
    </View>
  );
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00-05:00`).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Lima' });

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  code: { fontSize: 26, fontWeight: '800', color: colors.text },
  muted: { color: colors.text2, lineHeight: 20 },
  small: { color: colors.text2, fontSize: 12 },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text },
  section: { fontSize: 13, fontWeight: '700', color: colors.text2, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { color: colors.text2 },
  rowValue: { color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  visits: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  member: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  memberName: { color: colors.text },
  phone: { color: colors.primary, fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  instructions: { color: colors.text, lineHeight: 20 },
  openBox: { backgroundColor: '#F6F8F4', borderRadius: 10, padding: 12 },
  units: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  unit: { width: '32%', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10 },
  unitCode: { fontSize: 16, fontWeight: '800' },
  unitStatus: { fontSize: 12, marginTop: 2 },
  mapBtn: { borderRadius: 10, backgroundColor: colors.primarySoft, paddingVertical: 11, alignItems: 'center' },
  mapBtnText: { color: colors.primary, fontWeight: '700' },
  newBtn: { borderRadius: 10, borderWidth: 1, borderColor: colors.primary, paddingVertical: 12, alignItems: 'center' },
  newBtnText: { color: colors.primary, fontWeight: '700' },
});
