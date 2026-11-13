import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useField } from '../../lib/field';
import { usePackageIndex } from '../../lib/workPackage';
import { AlertButton, IncidentRow } from '../../components/alerts';
import { colors, radius } from '../../theme';

/** Mis alertas: estado, respuesta de coordinación y conversación. */
export default function AlertsScreen() {
  const field = useField();
  const index = usePackageIndex();
  const where = (stationId: string | null, unitCode: string | null) =>
    [stationId ? index?.stations.get(stationId)?.code : null, unitCode].filter(Boolean).join(' · ') || 'General';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap}>
      <Stack.Screen options={{ title: 'Mis alertas' }} />
      <AlertButton onPress={() => router.push({ pathname: '/alerta/nueva', params: { from: 'mi_jornada' } })} />
      <View style={s.card}>
        {field.incidents.map((i) => (
          <IncidentRow key={i.clientId} incident={i} where={where(i.stationId, i.unitCode)} onPress={() => router.push({ pathname: '/alerta/[id]', params: { id: i.clientId } })} />
        ))}
        {!field.incidents.length && <Text style={s.empty}>No has registrado alertas.</Text>}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingBottom: 4 },
  empty: { color: colors.text2, paddingVertical: 20, textAlign: 'center' },
});
