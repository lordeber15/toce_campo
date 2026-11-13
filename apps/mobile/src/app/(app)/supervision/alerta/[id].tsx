import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  INCIDENT_DECISION_LABELS, INCIDENT_MOMENT_LABELS, INCIDENT_ORIGIN_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS,
} from '@toce/shared';
import { useAuth } from '../../../../lib/auth';
import { useField } from '../../../../lib/field';
import { usePackageIndex } from '../../../../lib/workPackage';
import { shortDateTime } from '../../../../components/alerts';
import { colors, radius } from '../../../../theme';

/**
 * Alerta de un integrante de la brigada vista por el supervisor: lo reportado, la respuesta de
 * coordinación y la conversación, donde el supervisor deja notas de supervisión (cómo se atendió).
 */
export default function BrigadeAlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const field = useField();
  const index = usePackageIndex();
  const [note, setNote] = useState('');
  const i = field.brigadeIncidents.find((x) => x.clientId === id);

  useEffect(() => {
    if (i?.unread) void field.markBrigadeIncidentSeen(i.clientId);
  }, [i?.unread, i?.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!i) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Alerta' }} />
        <Text style={s.muted}>Esta alerta ya no está en el teléfono (solo se guardan las de los últimos 30 días).</Text>
      </View>
    );
  }

  const brigade = i.brigadeId ? index?.brigades.get(i.brigadeId) : undefined;
  const phone = brigade?.members.find((m) => m.id === i.reportedById)?.phone;
  const thread = [
    ...i.messages.map((m) => ({ key: m.id, mine: m.authorId === user?.id, author: m.authorName, body: m.body, at: m.sentAt, kind: m.kind, pending: false })),
    ...i.outbox.map((m) => ({ key: m.clientId, mine: true, author: 'Tú', body: m.body, at: m.sentAt, kind: 'comentario' as const, pending: true })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const send = async () => {
    if (!note.trim()) return;
    await field.sendIncidentMessage(i.clientId, note);
    setNote('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: INCIDENT_TYPE_LABELS[i.type] }} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.h2}>{INCIDENT_TYPE_LABELS[i.type]}</Text>
          <Text style={s.small}>
            {[i.stationCode, i.methodCode, i.unitCode].filter(Boolean).join(' · ') || brigade?.name || 'General'} · {shortDateTime(i.occurredAt)}
            {i.moment ? ` · ${INCIDENT_MOMENT_LABELS[i.moment]}` : ''}
          </Text>
          <View style={s.reporter}>
            <Text style={[s.body, { flex: 1 }]}>
              <Text style={s.bold}>{i.reportedByName}</Text>
              {i.launchedFrom ? ` · ${INCIDENT_ORIGIN_LABELS[i.launchedFrom]}` : ''}
            </Text>
            {!!phone && (
              <Pressable onPress={() => void Linking.openURL(`tel:${phone}`)} accessibilityRole="link" accessibilityLabel={`Llamar a ${i.reportedByName}`} hitSlop={8}>
                <Text style={s.link}>Llamar</Text>
              </Pressable>
            )}
          </View>
          <Text style={s.body}>{i.description}</Text>
          {!!i.proposedAction && <Text style={s.body}><Text style={s.bold}>Acción propuesta: </Text>{i.proposedAction}</Text>}
          {!!i.methodologicalDeviation && <Text style={s.body}><Text style={s.bold}>Desviación: </Text>{i.methodologicalDeviation}</Text>}
          {!!i.resolutionNotes && <Text style={s.body}><Text style={s.bold}>Solución en campo: </Text>{i.resolutionNotes}</Text>}
          <Text style={s.small}>
            Estado: {INCIDENT_STATUS_LABELS[i.status]}{i.files ? ` · ${i.files} foto${i.files > 1 ? 's' : ''} en el servidor` : ''}
          </Text>
        </View>

        {i.coordinationDecision && (
          <View style={[s.card, { borderColor: i.coordinationDecision === 'rechazada' ? colors.danger : colors.primary }]}>
            <Text style={s.small}>Respuesta de coordinación{i.resolvedByName ? ` · ${i.resolvedByName}` : ''}</Text>
            <Text style={[s.h2, { color: i.coordinationDecision === 'rechazada' ? colors.danger : colors.primary }]}>{INCIDENT_DECISION_LABELS[i.coordinationDecision]}</Text>
            {!!i.coordinationResponse && <Text style={s.body}>{i.coordinationResponse}</Text>}
            {!!i.correctiveAction && <Text style={s.body}><Text style={s.bold}>Acción correctiva: </Text>{i.correctiveAction}</Text>}
          </View>
        )}

        <View style={s.card}>
          <Text style={s.h3}>Conversación y notas de supervisión</Text>
          {thread.map((m) => (
            <View key={m.key} style={[s.msg, m.mine ? s.msgMine : s.msgTheirs]}>
              <Text style={s.msgMeta}>{m.author} · {shortDateTime(m.at)}{m.pending ? ' · por enviar' : ''}</Text>
              <Text style={s.body}>{m.body}</Text>
            </View>
          ))}
          {!thread.length && <Text style={s.small}>Registra aquí cómo se atendió en campo; lo verán el especialista y coordinación.</Text>}
          {i.status !== 'cerrada' && (
            <View style={s.replyRow}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Nota de supervisión"
                placeholderTextColor={colors.text2}
                multiline
                style={s.input}
                accessibilityLabel="Nota de supervisión"
              />
              <Pressable onPress={() => void send()} disabled={!note.trim()} style={[s.send, !note.trim() && { opacity: 0.5 }]} accessibilityRole="button">
                <Text style={s.sendText}>Enviar</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { color: colors.text, lineHeight: 21 },
  bold: { fontWeight: '700' },
  muted: { color: colors.text2 },
  small: { color: colors.text2, fontSize: 12 },
  reporter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  msg: { borderRadius: 12, padding: 10, maxWidth: '88%', gap: 2 },
  msgMine: { alignSelf: 'flex-end', backgroundColor: colors.primarySoft },
  msgTheirs: { alignSelf: 'flex-start', backgroundColor: '#EEF1EC' },
  msgMeta: { color: colors.text2, fontSize: 11 },
  replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, maxHeight: 120 },
  send: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sendText: { color: colors.white, fontWeight: '700' },
});
