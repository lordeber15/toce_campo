import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  LOGISTICS_ENTITY_LABELS, SAMPLE_PENDING, isLogisticsIncident,
  type EquipmentData, type ExpenseData, type LogisticsEntity, type SampleData, type SupportData, type VehicleData,
} from '@toce/shared';
import { useAuth } from '../lib/auth';
import { useField, type LocalLogistics } from '../lib/field';
import { useWorkPackage } from '../lib/workPackage';
import { AlertButton } from './alerts';
import { Chip } from './form';
import { AccountFooter, LinkRow, RetentionPrompt, SentBanner, SyncBar, UploadBar, homeStyles as hs } from './home';
import { Banner, Button } from './ui';
import { colors, radius } from '../theme';

export const money = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Resumen de cada sección (lo que se ve en el inicio y en la lista). */
export function summarize(entity: LogisticsEntity, list: LocalLogistics[]): { value: string; detail: string; warn?: boolean } {
  const data = list.map((r) => r.data);
  switch (entity) {
    case 'vehicle': {
      const v = data as VehicleData[];
      const problems = v.filter((x) => x.status === 'averiada' || x.status === 'accidente' || x.missingMaterials.length || x.defectiveMaterials.length).length;
      return { value: `${v.length}`, detail: `${v.filter((x) => x.status === 'llegada').length} llegaron${problems ? ` · ${problems} con observaciones` : ''}`, warn: problems > 0 };
    }
    case 'support': {
      const v = data as SupportData[];
      const noEpp = v.filter((x) => !x.eppItems.length).length;
      return { value: `${v.filter((x) => x.isAvailable).length}`, detail: `disponibles de ${v.length}${noEpp ? ` · ${noEpp} sin EPP` : ''}`, warn: noEpp > 0 };
    }
    case 'expense': {
      const noReceipt = list.filter((r) => !(r.data as ExpenseData).receiptNumber && !r.localFiles && !r.remoteFiles).length;
      const total = (data as ExpenseData[]).reduce((a, x) => a + x.amount, 0);
      return { value: money(total), detail: `${list.length} gasto${list.length === 1 ? '' : 's'}${noReceipt ? ` · ${noReceipt} sin comprobante` : ''}`, warn: noReceipt > 0 };
    }
    case 'sample': {
      const v = data as SampleData[];
      const pending = v.filter((x) => SAMPLE_PENDING.includes(x.status)).length;
      return { value: `${pending}`, detail: `por enviar · ${v.filter((x) => x.status === 'enviada' || x.status === 'recibida').length} enviadas`, warn: pending > 0 };
    }
    case 'equipment': {
      const v = data as EquipmentData[];
      const bad = v.filter((x) => x.status !== 'operativo').length;
      return { value: `${v.length}`, detail: bad ? `${bad} con problemas` : 'todos operativos', warn: bad > 0 };
    }
  }
}

const SECTIONS: LogisticsEntity[] = ['vehicle', 'support', 'expense', 'sample', 'equipment'];

/**
 * Inicio del responsable logístico: movilidad, apoyos locales, viáticos, muestras, equipos e
 * incidencias logísticas de sus brigadas. Todo se registra sin conexión y se envía solo.
 */
export function LogisticsHome() {
  const { online } = useAuth();
  const { pkg, downloadedAt, loading, syncing, error, download } = useWorkPackage();
  const field = useField();
  const brigades = useMemo(() => pkg?.brigades.filter((b) => b.myRoles.includes('logistico')) ?? [], [pkg]);
  const [brigadeId, setBrigadeId] = useState<string | null>(null);
  const records = field.logistics.filter((r) => !brigadeId || r.brigadeId === brigadeId);
  const incidents = field.incidents.filter((i) => isLogisticsIncident(i.type) && (!brigadeId || i.brigadeId === brigadeId));
  const openInc = incidents.filter((i) => !i.remote || i.remote.status === 'abierta' || i.remote.status === 'en_revision').length;
  const unread = incidents.filter((i) => i.unread).length;
  const params = brigadeId ? { brigadeId } : {};

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={hs.wrap}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => { void download(); void field.syncNow(); }} enabled={online} tintColor={colors.primary} />}
    >
      <Stack.Screen options={{ title: 'Logística' }} />
      <SyncBar online={online} syncing={syncing} downloadedAt={downloadedAt} hasPkg={!!pkg} onRefresh={download} />
      <UploadBar online={online} />
      <SentBanner />
      <RetentionPrompt />
      {!!error && (pkg ? <Banner tone="info">{error}</Banner> : <Banner>{error}</Banner>)}

      {!pkg && !loading && !syncing && (
        <View style={hs.emptyCard}>
          <Text style={hs.emptyTitle}>Aún no tienes tus brigadas</Text>
          <Text style={hs.emptyText}>{online ? 'Descarga el paquete para registrar sin conexión.' : 'Necesitas conexión una vez para descargar tus brigadas.'}</Text>
          {online && <Button title="Descargar paquete" onPress={() => void download()} />}
        </View>
      )}

      {pkg && !brigades.length && (
        <View style={hs.emptyCard}>
          <Text style={hs.emptyText}>No figuras como responsable logístico de ninguna brigada activa. Consulta con coordinación.</Text>
        </View>
      )}

      {brigades.length > 1 && (
        <View style={s.chips}>
          <Chip on={!brigadeId} onPress={() => setBrigadeId(null)}>Todas</Chip>
          {brigades.map((b) => <Chip key={b.id} on={brigadeId === b.id} onPress={() => setBrigadeId(b.id)}>{b.name}</Chip>)}
        </View>
      )}

      {brigades.length > 0 && (
        <>
          <View style={{ gap: 8 }}>
            <AlertButton label="Reportar incidencia logística" onPress={() => router.push({ pathname: '/alerta/nueva', params: { mode: 'logistica', ...params } })} />
            {incidents.length > 0 && (
              <LinkRow
                text={`Incidencias logísticas · ${openInc} abierta${openInc === 1 ? '' : 's'}${unread ? ` · ${unread} con respuesta` : ''}`}
                unread={unread > 0}
                onPress={() => router.push('/alertas')}
              />
            )}
          </View>

          <View style={s.grid}>
            {SECTIONS.map((e) => {
              const list = records.filter((r) => r.entity === e);
              const sum = summarize(e, list);
              const pending = list.filter((r) => r.syncedAt !== r.updatedAt).length;
              return (
                <Pressable
                  key={e}
                  onPress={() => router.push({ pathname: '/logistica/[entity]', params: { entity: e, ...params } })}
                  style={({ pressed }) => [s.tile, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${LOGISTICS_ENTITY_LABELS[e].many}: ${sum.value} ${sum.detail}`}
                >
                  <Text style={s.tileTitle}>{LOGISTICS_ENTITY_LABELS[e].many}</Text>
                  <Text style={s.tileValue}>{sum.value}</Text>
                  <Text style={[s.tileDetail, sum.warn && { color: colors.warn }]} numberOfLines={2}>{sum.detail}</Text>
                  {pending > 0 && <Text style={s.tilePending}>{pending} por enviar</Text>}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <AccountFooter />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4, minHeight: 118 },
  tileTitle: { color: colors.text2, fontWeight: '700', fontSize: 13 },
  tileValue: { color: colors.text, fontWeight: '800', fontSize: 24, fontVariant: ['tabular-nums'] },
  tileDetail: { color: colors.text2, fontSize: 12, lineHeight: 16 },
  tilePending: { color: '#1D5FA8', fontSize: 11, fontWeight: '700', marginTop: 2 },
});
