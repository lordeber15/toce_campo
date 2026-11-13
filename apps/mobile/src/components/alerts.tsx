import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS } from '@toce/shared';
import type { LocalIncident } from '../lib/field';
import { colors, radius } from '../theme';
import { Pill } from './field';

/** Estado visible de una alerta: local (por enviar) o el que dio coordinación. */
export function incidentState(i: LocalIncident): { label: string; fg: string; bg: string } {
  if (i.syncError) return { label: 'Error al enviar', fg: colors.danger, bg: colors.dangerSoft };
  if (!i.syncedAt || i.syncedAt !== i.updatedAt) return { label: 'Por enviar', fg: colors.warn, bg: '#FFF4E0' };
  const st = i.remote?.status ?? 'abierta';
  switch (st) {
    case 'resuelta': return { label: i.remote?.coordinationDecision ? INCIDENT_STATUS_LABELS[st] : 'Resuelta en campo', fg: colors.primary, bg: colors.primarySoft };
    case 'en_revision': return { label: INCIDENT_STATUS_LABELS[st], fg: '#1D5FA8', bg: '#E4EEF9' };
    case 'rechazada': return { label: INCIDENT_STATUS_LABELS[st], fg: colors.danger, bg: colors.dangerSoft };
    case 'cerrada': return { label: INCIDENT_STATUS_LABELS[st], fg: colors.text2, bg: '#EEF1EC' };
    default: return { label: 'Enviada', fg: colors.text2, bg: '#EEF1EC' };
  }
}

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function IncidentRow({ incident: i, where, onPress }: { incident: LocalIncident; where: string; onPress: () => void }) {
  const st = incidentState(i);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <View style={{ flex: 1, gap: 3 }}>
        <View style={s.head}>
          <Text style={s.type}>{INCIDENT_TYPE_LABELS[i.type]}</Text>
          {i.unread && <View style={s.dot} accessibilityLabel="Respuesta nueva" />}
        </View>
        <Text style={s.small} numberOfLines={1}>{where} · {shortDateTime(i.occurredAt)}</Text>
        <Text style={s.desc} numberOfLines={2}>{i.description}</Text>
      </View>
      <Pill fg={st.fg} bg={st.bg}>{i.unread ? 'Respuesta nueva' : st.label}</Pill>
    </Pressable>
  );
}

/** Botón rojo "Registrar alerta" de las pantallas de referencia. */
export function AlertButton({ onPress, label = 'Registrar alerta' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.alertBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={s.alertIcon}>!</Text>
      <Text style={s.alertText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  type: { color: colors.text, fontWeight: '700', fontSize: 15 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
  small: { color: colors.text2, fontSize: 12 },
  desc: { color: colors.text, fontSize: 14, lineHeight: 19 },
  alertBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: radius, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.dangerSoft, paddingVertical: 13 },
  alertIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, color: colors.white, textAlign: 'center', lineHeight: 22, fontWeight: '900', overflow: 'hidden' },
  alertText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
});
