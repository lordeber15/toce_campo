import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  EQUIPMENT_STATUS_LABELS, EXPENSE_CATEGORY_LABELS, LOGISTICS_ENTITIES, LOGISTICS_ENTITY_LABELS, SAMPLE_PENDING, SAMPLE_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type EquipmentData, type ExpenseData, type LogisticsEntity, type SampleData, type SupportData, type VehicleData,
} from '@toce/shared';
import { useField, type LocalLogistics } from '../../../lib/field';
import { usePackageIndex } from '../../../lib/workPackage';
import { Chip, PrimaryButton } from '../../../components/form';
import { Pill } from '../../../components/field';
import { money, summarize } from '../../../components/LogisticsHome';
import { colors, radius } from '../../../theme';

const OK = { fg: colors.primary, bg: colors.primarySoft };
const WARN = { fg: colors.warn, bg: '#FFF4E0' };
const BAD = { fg: colors.danger, bg: colors.dangerSoft };
const GREY = { fg: colors.text2, bg: '#EEF1EC' };

/** Lista de una sección de logística (movilidad, apoyos, viáticos, muestras o equipos). */
export default function LogisticsListScreen() {
  const { entity, brigadeId } = useLocalSearchParams<{ entity: LogisticsEntity; brigadeId?: string }>();
  const field = useField();
  const index = usePackageIndex();
  const [onlyPending, setOnlyPending] = useState(entity === 'sample');
  if (!LOGISTICS_ENTITIES.includes(entity)) return null;

  const all = field.logistics.filter((r) => r.entity === entity && (!brigadeId || r.brigadeId === brigadeId));
  const list = entity === 'sample' && onlyPending ? all.filter((r) => SAMPLE_PENDING.includes((r.data as SampleData).status)) : all;
  const sum = summarize(entity, all);
  const multi = new Set(all.map((r) => r.brigadeId)).size > 1;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap}>
      <Stack.Screen options={{ title: LOGISTICS_ENTITY_LABELS[entity].many }} />
      <View style={s.summary}>
        <Text style={s.sumValue}>{sum.value}</Text>
        <Text style={[s.sumDetail, sum.warn && { color: colors.warn }]}>{sum.detail}</Text>
      </View>
      <PrimaryButton
        title={`+ ${entity === 'expense' ? 'Registrar gasto' : `Nuevo: ${LOGISTICS_ENTITY_LABELS[entity].one.toLowerCase()}`}`}
        onPress={() => router.push({ pathname: '/logistica/registro', params: { entity, ...(brigadeId ? { brigadeId } : {}) } })}
      />
      {entity === 'sample' && (
        <View style={s.chips}>
          <Chip on={onlyPending} onPress={() => setOnlyPending(true)}>Por enviar</Chip>
          <Chip on={!onlyPending} onPress={() => setOnlyPending(false)}>Todas</Chip>
        </View>
      )}
      <View style={s.card}>
        {list.map((r) => (
          <Row
            key={r.clientId}
            r={r}
            brigade={multi ? index?.brigades.get(r.brigadeId)?.name : undefined}
            station={(id) => (id ? index?.stations.get(id)?.code : undefined)}
          />
        ))}
        {!list.length && <Text style={s.empty}>{all.length ? 'No hay muestras por enviar.' : 'Aún no hay registros.'}</Text>}
      </View>
    </ScrollView>
  );
}

function describe(r: LocalLogistics, station: (id?: string | null) => string | undefined): { title: string; sub: string; pill: string; tone: typeof OK; right?: string } {
  switch (r.entity) {
    case 'vehicle': {
      const d = r.data as VehicleData;
      const obs = d.missingMaterials.length + d.defectiveMaterials.length;
      return {
        title: [d.description, d.plate].filter(Boolean).join(' · '),
        sub: [d.driverName, obs ? `${obs} material${obs > 1 ? 'es' : ''} con observación` : null].filter(Boolean).join(' · ') || 'Sin conductor',
        pill: VEHICLE_STATUS_LABELS[d.status],
        tone: d.status === 'averiada' || d.status === 'accidente' ? BAD : d.status === 'llegada' || d.status === 'finalizada' ? OK : WARN,
      };
    }
    case 'support': {
      const d = r.data as SupportData;
      return {
        title: d.fullName,
        sub: [d.dni ? `DNI ${d.dni}` : null, d.community, d.eppItems.length ? `EPP: ${d.eppItems.length}` : 'Sin EPP'].filter(Boolean).join(' · '),
        pill: d.isAvailable ? 'Disponible' : 'No disponible',
        tone: d.isAvailable ? OK : GREY,
      };
    }
    case 'expense': {
      const d = r.data as ExpenseData;
      const receipt = !!d.receiptNumber || r.localFiles > 0 || r.remoteFiles > 0;
      return {
        title: d.description,
        sub: [EXPENSE_CATEGORY_LABELS[d.category], d.expenseDate.split('-').reverse().join('/'), d.vendor].filter(Boolean).join(' · '),
        pill: receipt ? 'Con comprobante' : 'Sin comprobante',
        tone: receipt ? OK : WARN,
        right: money(d.amount),
      };
    }
    case 'sample': {
      const d = r.data as SampleData;
      return {
        title: `${d.code}${d.quantity > 1 ? ` × ${d.quantity}` : ''}`,
        sub: [station(d.stationId), d.description, d.destination ? `→ ${d.destination}` : null].filter(Boolean).join(' · ') || '—',
        pill: SAMPLE_STATUS_LABELS[d.status],
        tone: d.status === 'perdida' ? BAD : SAMPLE_PENDING.includes(d.status) ? WARN : OK,
      };
    }
    case 'equipment': {
      const d = r.data as EquipmentData;
      return {
        title: d.name,
        sub: [d.serial ? `Serie ${d.serial}` : null, d.quantity > 1 ? `${d.quantity} unidades` : null, d.notes].filter(Boolean).join(' · ') || '—',
        pill: EQUIPMENT_STATUS_LABELS[d.status],
        tone: d.status === 'operativo' ? OK : d.status === 'en_reparacion' ? WARN : BAD,
      };
    }
  }
}

function Row({ r, brigade, station }: { r: LocalLogistics; brigade?: string; station: (id?: string | null) => string | undefined }) {
  const d = describe(r, station);
  const sync = r.syncError ? 'Error al enviar' : r.syncedAt !== r.updatedAt ? 'Por enviar' : null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/logistica/registro', params: { entity: r.entity, id: r.clientId } })}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.title} numberOfLines={1}>{d.title}</Text>
        <Text style={s.sub} numberOfLines={2}>{[brigade, d.sub].filter(Boolean).join(' · ')}</Text>
        {!!sync && <Text style={[s.sync, r.syncError && { color: colors.danger }]}>{sync}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        {!!d.right && <Text style={s.right}>{d.right}</Text>}
        <Pill fg={d.tone.fg} bg={d.tone.bg}>{d.pill}</Pill>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  sumValue: { fontSize: 26, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  sumDetail: { color: colors.text2 },
  chips: { flexDirection: 'row', gap: 8 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingBottom: 4 },
  empty: { color: colors.text2, paddingVertical: 20, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  title: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sub: { color: colors.text2, fontSize: 13, lineHeight: 18 },
  sync: { color: '#1D5FA8', fontSize: 12, fontWeight: '700' },
  right: { color: colors.text, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
