import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS } from '@toce/shared';
import { useField, type BrigadeIncident } from '../../../lib/field';
import { usePackageIndex } from '../../../lib/workPackage';
import { AlertButton, IncidentRow, shortDateTime } from '../../../components/alerts';
import { Pill } from '../../../components/field';
import { colors, radius } from '../../../theme';

/** Supervisor: alertas de sus brigadas (de los especialistas y logística) y sus propias incidencias. */
export default function SupervisionAlertsScreen() {
  const field = useField();
  const index = usePackageIndex();
  const where = (stationId: string | null, unitCode: string | null) =>
    [stationId ? index?.stations.get(stationId)?.code : null, unitCode].filter(Boolean).join(' · ') || 'General';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap}>
      <Stack.Screen options={{ title: 'Alertas e incidencias' }} />
      <AlertButton label="Registrar incidencia" onPress={() => router.push('/supervision/nueva')} />

      <Text style={s.section}>De mis brigadas</Text>
      <View style={s.card}>
        {field.brigadeIncidents.map((i) => <BrigadeRow key={i.clientId} i={i} brigade={i.brigadeId ? index?.brigades.get(i.brigadeId)?.name : undefined} />)}
        {!field.brigadeIncidents.length && (
          <Text style={s.empty}>Sin alertas de tus brigadas en los últimos 30 días. Se actualizan cada vez que hay señal.</Text>
        )}
      </View>

      <Text style={s.section}>Registradas por mí</Text>
      <View style={s.card}>
        {field.incidents.map((i) => (
          <IncidentRow
            key={i.clientId}
            incident={i}
            where={where(i.stationId, i.unitCode)}
            onPress={() => router.push({ pathname: '/alerta/[id]', params: { id: i.clientId } })}
          />
        ))}
        {!field.incidents.length && <Text style={s.empty}>Aún no registras incidencias.</Text>}
      </View>
    </ScrollView>
  );
}

const TONE: Record<string, { fg: string; bg: string }> = {
  abierta: { fg: colors.warn, bg: '#FFF4E0' },
  en_revision: { fg: '#1D5FA8', bg: '#E4EEF9' },
  resuelta: { fg: colors.primary, bg: colors.primarySoft },
  rechazada: { fg: colors.danger, bg: colors.dangerSoft },
  cerrada: { fg: colors.text2, bg: '#EEF1EC' },
};

function BrigadeRow({ i, brigade }: { i: BrigadeIncident; brigade?: string }) {
  const tone = TONE[i.status] ?? TONE.cerrada!;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/supervision/alerta/[id]', params: { id: i.clientId } })}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={s.head}>
          <Text style={s.type}>{INCIDENT_TYPE_LABELS[i.type]}</Text>
          {i.unread && <View style={s.dot} accessibilityLabel="Nueva" />}
        </View>
        <Text style={s.small} numberOfLines={1}>
          {i.reportedByName} · {[i.stationCode, i.unitCode].filter(Boolean).join(' · ') || brigade || 'General'} · {shortDateTime(i.occurredAt)}
        </Text>
        <Text style={s.desc} numberOfLines={2}>{i.description}</Text>
      </View>
      <Pill fg={tone.fg} bg={tone.bg}>{i.unread ? 'Nueva' : INCIDENT_STATUS_LABELS[i.status]}</Pill>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  section: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 6 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingBottom: 4 },
  empty: { color: colors.text2, paddingVertical: 18, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  type: { color: colors.text, fontWeight: '700', fontSize: 15 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
  small: { color: colors.text2, fontSize: 12 },
  desc: { color: colors.text, fontSize: 14, lineHeight: 19 },
});
