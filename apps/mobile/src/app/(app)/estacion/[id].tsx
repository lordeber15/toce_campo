import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { unitCode } from '@toce/shared';
import { todayLima, usePackageIndex, type MethodProgress } from '../../../lib/workPackage';
import { useField } from '../../../lib/field';
import { AlertButton } from '../../../components/alerts';
import { TrackingCard } from '../../../components/tracking';
import { useRoleView } from '../../../lib/roles';
import { usePosition } from '../../../lib/location';
import { MethodLine, Pill, UNIT_STATUS } from '../../../components/field';
import { colors, radius } from '../../../theme';

/** Detalle de una estación: mapa, alerta y métodos con sus unidades de muestreo. */
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
  // EM cerrada para el especialista: todas las unidades programadas de sus métodos están terminadas.
  const scheduled = methods.filter((m) => !m.method.isOpenEnded && m.stationMethod.unitsRequired > 0);
  const closed = scheduled.length > 0 && scheduled.every((m) => m.done >= m.stationMethod.unitsRequired);

  const openUnit = (unitId: string) => router.push({ pathname: '/unidad/[id]', params: { id: unitId, ...(date ? { date } : {}) } });

  const nextSeq = (m: MethodProgress) => Math.max(0, ...m.units.map((u) => u.seq)) + 1;

  /**
   * Crea una unidad en campo con el siguiente correlativo: en métodos abiertos, cada observación;
   * en los demás, unidades adicionales a las programadas (lo programado es el mínimo). Funciona sin conexión.
   */
  const newOpenUnit = async (m: MethodProgress) => {
    try {
      const p = pos.status === 'ok' ? pos.position : null;
      const seq = nextSeq(m);
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

  // En métodos con unidades programadas se confirma, para no crear una por un toque accidental.
  const addUnit = (m: MethodProgress) => {
    if (m.method.isOpenEnded) return void newOpenUnit(m);
    const code = `${m.method.code}-${String(nextSeq(m)).padStart(2, '0')}`;
    Alert.alert('Agregar unidad', `Se agrega ${code} a las ${m.stationMethod.unitsRequired} programadas.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Agregar', onPress: () => void newOpenUnit(m) },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap}>
      <Stack.Screen options={{ title: station.code }} />

      <Pressable onPress={() => router.push({ pathname: '/mapa', params: { station: station.id } })} style={s.mapBtn} accessibilityRole="button">
        <Text style={s.mapBtnText}>Ver en el mapa · verificar área de influencia</Text>
      </Pressable>

      {roleView.executes ? (
        <AlertButton onPress={() => router.push({ pathname: '/alerta/nueva', params: { stationId: station.id, from: 'estacion' } })} />
      ) : roleView.supervises ? (
        <AlertButton label="Registrar incidencia de supervisión" onPress={() => router.push({ pathname: '/supervision/nueva', params: { stationId: station.id } })} />
      ) : null}

      {roleView.executes && <TrackingCard station={station} scheduleId={visit?.id ?? null} brigadeId={visit?.brigadeId ?? null} closed={closed} />}

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
                    <Text style={[s.unitStatus, { color: st.fg }]} numberOfLines={1}>
                      {st.label}{!m.method.isOpenEnded && u.seq > m.stationMethod.unitsRequired ? ' · adicional' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {roleView.executes && (
            <Pressable onPress={() => addUnit(m)} style={({ pressed }) => [s.newBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <Text style={s.newBtnText}>
                {m.method.isOpenEnded ? `+ Nuevo registro (${m.method.code})` : `+ Agregar unidad (${m.method.code}-${String(nextSeq(m)).padStart(2, '0')})`}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  muted: { color: colors.text2, lineHeight: 20 },
  small: { color: colors.text2, fontSize: 12 },
  section: { fontSize: 13, fontWeight: '700', color: colors.text2, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 },
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
