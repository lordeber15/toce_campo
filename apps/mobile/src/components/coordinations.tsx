import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  COORDINATION_CHANNELS, COORDINATION_CHANNEL_LABELS, type CoordinationChannel, type IncidentCoordinationDto,
} from '@toce/shared';
import { useField, type PendingCoordination } from '../lib/field';
import { shortDateTime } from './alerts';
import { Choice, Field, Label } from './form';
import { colors, radius } from '../theme';

/**
 * Coordinaciones del supervisor con el equipo técnico al atender una incidencia: con quién, por qué medio
 * y qué se acordó. Se guardan en el teléfono y se envían solas (también sin conexión).
 */
export function Coordinations({ incidentClientId, sent, pending, canAdd }: {
  incidentClientId: string;
  sent: IncidentCoordinationDto[] | undefined;
  pending: PendingCoordination[];
  canAdd: boolean;
}) {
  const field = useField();
  const [open, setOpen] = useState(false);
  const [withWhom, setWithWhom] = useState('');
  const [channel, setChannel] = useState<CoordinationChannel | null>('presencial');
  const [agreement, setAgreement] = useState('');
  const [saving, setSaving] = useState(false);
  const items = [
    ...(sent ?? []).map((c) => ({ ...c, key: c.id, pending: false, error: null as string | null })),
    ...pending.map((c) => ({ ...c, key: c.clientId, authorName: 'Tú', pending: true })),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const save = async () => {
    if (withWhom.trim().length < 2) return Alert.alert('Falta un dato', 'Indica con quién se coordinó.');
    if (agreement.trim().length < 3) return Alert.alert('Falta un dato', 'Indica qué se acordó.');
    setSaving(true);
    try {
      await field.addCoordination(incidentClientId, { withWhom, channel: channel ?? 'presencial', agreement });
      setWithWhom('');
      setAgreement('');
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={s.card}>
      <Text style={s.h3}>Coordinaciones con el equipo técnico</Text>
      {items.map((c) => (
        <View key={c.key} style={s.item}>
          <Text style={s.meta}>
            {shortDateTime(c.occurredAt)} · {COORDINATION_CHANNEL_LABELS[c.channel] ?? c.channel} · {c.authorName}{c.pending ? ' · por enviar' : ''}
          </Text>
          <Text style={s.who}>Con {c.withWhom}</Text>
          <Text style={s.body}>{c.agreement}</Text>
          {!!c.error && <Text style={[s.meta, { color: colors.danger }]}>No se pudo enviar: {c.error}</Text>}
        </View>
      ))}
      {!items.length && !open && <Text style={s.meta}>Anota con quién coordinaste y qué se acordó para atender la incidencia.</Text>}

      {canAdd && !open && (
        <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.addBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={s.addText}>+ Registrar coordinación</Text>
        </Pressable>
      )}
      {open && (
        <View style={{ gap: 6 }}>
          <Label>¿Con quién? *</Label>
          <Field value={withWhom} onChangeText={setWithWhom} placeholder="Ej.: Ana Aves (jefa de brigada)" maxLength={200} accessibilityLabel="Con quién se coordinó" />
          <Label>Medio</Label>
          <Choice options={COORDINATION_CHANNELS} labels={COORDINATION_CHANNEL_LABELS} value={channel} onChange={setChannel} />
          <Label>¿Qué se acordó? *</Label>
          <Field value={agreement} onChangeText={setAgreement} multiline maxLength={4000}
            placeholder="Ej.: Se repetirán los puntos PC-03 y PC-04 mañana a las 6:00." accessibilityLabel="Qué se acordó" />
          <View style={s.row}>
            <Pressable onPress={() => setOpen(false)} style={({ pressed }) => [s.cancel, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <Text style={s.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={() => void save()} disabled={saving} style={({ pressed }) => [s.save, (pressed || saving) && { opacity: 0.7 }]} accessibilityRole="button">
              <Text style={s.saveText}>{saving ? 'Guardando…' : 'Guardar'}</Text>
            </Pressable>
          </View>
          <Text style={s.meta}>Sin señal se guarda en el teléfono y se envía sola.</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  item: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 10, gap: 2 },
  meta: { color: colors.text2, fontSize: 12 },
  who: { color: colors.text, fontWeight: '700' },
  body: { color: colors.text, lineHeight: 21 },
  addBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addText: { color: colors.primary, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancel: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: colors.text, fontWeight: '600' },
  save: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: colors.white, fontWeight: '700' },
});
