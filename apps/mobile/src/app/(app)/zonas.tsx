import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatMb } from '../../lib/basemap';
import { deleteZone, pauseZone, resumeZone, totalOfflineBytes, useOfflineZones, type ManualZone } from '../../lib/offlineZones';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../theme';

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** Zonas satelitales descargadas a mano: estado, peso, encuadrar en el mapa y borrar. */
export default function ZonesScreen() {
  const zones = useOfflineZones();
  const { online } = useAuth();
  const [total, setTotal] = useState<number | null>(null);
  const rev = zones.map((z) => `${z.id}:${z.status}:${z.bytes}`).join('|');
  useEffect(() => {
    let alive = true;
    void totalOfflineBytes().then((b) => { if (alive) setTotal(b); }).catch(() => undefined);
    return () => { alive = false; };
  }, [rev]);

  const remove = (z: ManualZone) =>
    Alert.alert('Borrar zona', `¿Borrar «${z.name}» del teléfono? Las imágenes que usa otra zona o el mapa de tu brigada se conservan.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => void deleteZone(z.id).catch((e: unknown) => Alert.alert('No se pudo borrar', e instanceof Error ? e.message : '')) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.header}>
        <Text style={s.small}>Espacio usado por los mapas sin conexión (brigada y zonas): {total == null ? '…' : formatMb(total)}</Text>
      </View>
      <FlatList
        data={zones}
        keyExtractor={(z) => z.id}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        ListEmptyComponent={
          <Text style={[s.small, { textAlign: 'center', padding: 24 }]}>
            Aún no descargaste zonas. En el mapa, encuadra la zona que necesitas y toca ⤓.
          </Text>
        }
        renderItem={({ item: z }) => {
          const pct = Math.min(100, Math.floor((z.done / Math.max(1, z.tiles)) * 100));
          return (
            <Pressable
              style={s.card}
              onPress={() => router.navigate({ pathname: '/mapa', params: { zone: z.bounds.join(',') } })}
              accessibilityRole="button"
              accessibilityLabel={`Ver ${z.name} en el mapa`}
            >
              <View style={s.row}>
                <Text style={[s.h3, { flex: 1 }]} numberOfLines={1}>{z.name}</Text>
                <Pressable onPress={() => remove(z)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Borrar ${z.name}`}>
                  <Text style={[s.action, { color: colors.danger }]}>Borrar</Text>
                </Pressable>
              </View>
              <Text style={s.small}>
                {when(z.createdAt)} · zoom {z.minZoom}–{z.maxZoom} · {z.tiles.toLocaleString('es-PE')} teselas · {formatMb(z.bytes)}
              </Text>
              {z.status === 'completa' ? (
                <Text style={[s.small, { color: colors.primary, fontWeight: '700' }]}>Lista para usar sin conexión</Text>
              ) : (
                <View style={{ gap: 6 }}>
                  <View style={s.row}>
                    <Text style={[s.small, { flex: 1 }]}>
                      {z.status === 'descargando' ? 'Descargando' : 'Detenida'} · {pct}%{z.error ? ' · algunas imágenes se bajarán después' : ''}
                    </Text>
                    {z.status === 'descargando' ? (
                      <Pressable onPress={() => void pauseZone(z.id)} hitSlop={8} accessibilityRole="button"><Text style={s.action}>Cancelar</Text></Pressable>
                    ) : online ? (
                      <Pressable onPress={() => void resumeZone(z.id)} hitSlop={8} accessibilityRole="button"><Text style={s.action}>Continuar</Text></Pressable>
                    ) : null}
                  </View>
                  <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radius, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  small: { color: colors.text2, fontSize: 13, fontVariant: ['tabular-nums'] },
  action: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#DCE3DC', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.primary },
});
