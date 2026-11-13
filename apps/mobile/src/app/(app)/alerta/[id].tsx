import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { INCIDENT_DECISION_LABELS, INCIDENT_MOMENT_LABELS, INCIDENT_TYPE_LABELS } from '@toce/shared';
import { useAuth } from '../../../lib/auth';
import { useField, type LocalAttachment } from '../../../lib/field';
import { usePackageIndex } from '../../../lib/workPackage';
import { incidentState, shortDateTime } from '../../../components/alerts';
import { Pill } from '../../../components/field';
import { colors, radius } from '../../../theme';

const fmtDate = (d: string) => d.split('-').reverse().join('/');

/** Detalle de una alerta: lo registrado, la respuesta de coordinación, reprogramaciones y la conversación. */
export default function AlertDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const field = useField();
  const index = usePackageIndex();
  const [photos, setPhotos] = useState<LocalAttachment[]>([]);
  const [reply, setReply] = useState('');
  const incident = field.incidents.find((i) => i.clientId === id);

  const load = useCallback(async () => setPhotos(await field.attachmentsOf(id)), [id, field.attachmentsOf]);
  useEffect(() => {
    void load();
  }, [load, field.rev]);
  // Al abrirla se marcan como vistas las novedades de coordinación.
  useEffect(() => {
    if (incident?.unread) void field.markIncidentSeen(incident.clientId);
  }, [incident?.unread, incident?.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!incident) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Alerta' }} />
        <Text style={s.muted}>No se encontró la alerta.</Text>
      </View>
    );
  }

  const r = incident.remote;
  const st = incidentState(incident);
  const station = incident.stationId ? index?.stations.get(incident.stationId) : undefined;
  const open = !r || r.status === 'abierta' || r.status === 'en_revision';
  const askedInfo = r?.status === 'en_revision';
  const thread = [
    ...(r?.messages ?? []).map((m) => ({ key: m.id, mine: m.authorId === user?.id, author: m.authorName, body: m.body, at: m.sentAt, kind: m.kind, pending: false })),
    ...incident.outbox.map((m) => ({ key: m.clientId, mine: true, author: 'Tú', body: m.body, at: m.sentAt, kind: 'respuesta' as const, pending: true })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const send = async () => {
    if (!reply.trim()) return;
    await field.sendIncidentMessage(incident.clientId, reply);
    setReply('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: INCIDENT_TYPE_LABELS[incident.type] }} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.head}>
            <Text style={[s.h2, { flex: 1 }]}>{INCIDENT_TYPE_LABELS[incident.type]}</Text>
            <Pill fg={st.fg} bg={st.bg}>{st.label}</Pill>
          </View>
          <Text style={s.small}>
            {[station?.code, incident.unitCode].filter(Boolean).join(' · ') || 'General'} · {shortDateTime(incident.occurredAt)}
            {incident.moment ? ` · ${INCIDENT_MOMENT_LABELS[incident.moment]}` : ''}
          </Text>
          <Text style={s.body}>{incident.description}</Text>
          {!!incident.proposedAction && <Text style={s.body}><Text style={s.bold}>Acción propuesta: </Text>{incident.proposedAction}</Text>}
          {!!incident.methodologicalDeviation && <Text style={s.body}><Text style={s.bold}>Desviación metodológica: </Text>{incident.methodologicalDeviation}</Text>}
          {!!incident.correctiveAction && <Text style={s.body}><Text style={s.bold}>Acción correctiva aplicada: </Text>{incident.correctiveAction}</Text>}
          {!!incident.resolutionNotes && <Text style={s.body}><Text style={s.bold}>Cómo se resolvió: </Text>{incident.resolutionNotes}</Text>}
          {incident.unitNotDone && <Text style={[s.body, { color: colors.danger }]}>Unidad {incident.unitCode} marcada como no realizada.</Text>}
          {!!incident.syncError && <Text style={[s.small, { color: colors.danger }]}>No se pudo enviar: {incident.syncError}</Text>}
          <View style={s.photos}>
            {photos.map((ph) => (
              ph.freed
                ? <View key={ph.clientId} style={[s.thumb, s.freed]}><Text style={s.small}>En el servidor</Text></View>
                : <Image key={ph.clientId} source={{ uri: ph.path }} style={s.thumb} contentFit="cover" />
            ))}
            {open && (
              <Pressable
                onPress={() => router.push({ pathname: '/camara', params: { exec: incident.clientId, owner: 'incident', kind: 'foto', label: 'Evidencia' } })}
                style={[s.thumb, s.addPhoto]}
                accessibilityRole="button"
                accessibilityLabel="Agregar foto de evidencia"
              >
                <Text style={s.plus}>+</Text>
              </Pressable>
            )}
          </View>
        </View>

        {incident.launchedFrom === 'supervision' && (!r || r.status === 'abierta' || r.status === 'en_revision' || (r.status === 'resuelta' && !r.coordinationDecision)) && (
          <Pressable
            onPress={() => router.push({ pathname: '/supervision/nueva', params: { id: incident.clientId } })}
            style={({ pressed }) => [s.editBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Text style={s.editText}>{incident.resolutionNotes ? 'Editar incidencia' : 'Registrar cómo se resolvió'}</Text>
          </Pressable>
        )}

        {r?.status === 'resuelta' && !r.coordinationDecision && (
          <View style={[s.card, { borderColor: colors.primary }]}>
            <Text style={[s.h3, { color: colors.primary }]}>Resuelta en campo</Text>
            <Text style={s.small}>Coordinación puede revisarla y responder.</Text>
          </View>
        )}

        {r?.coordinationDecision && (
          <View style={[s.card, { borderColor: r.coordinationDecision === 'rechazada' ? colors.danger : colors.primary }]}>
            <Text style={s.small}>Respuesta de coordinación{r.resolvedByName ? ` · ${r.resolvedByName}` : ''}{r.resolvedAt ? ` · ${shortDateTime(r.resolvedAt)}` : ''}</Text>
            <Text style={[s.h2, { color: r.coordinationDecision === 'rechazada' ? colors.danger : colors.primary }]}>{INCIDENT_DECISION_LABELS[r.coordinationDecision]}</Text>
            {!!r.coordinationResponse && <Text style={s.body}>{r.coordinationResponse}</Text>}
            {!!r.correctiveAction && <Text style={s.body}><Text style={s.bold}>Acción correctiva: </Text>{r.correctiveAction}</Text>}
          </View>
        )}

        {!!r?.reschedules.length && (
          <View style={s.card}>
            <Text style={s.h3}>Reprogramación</Text>
            {r.reschedules.map((x, i) => (
              <Text key={i} style={s.body}>
                {fmtDate(x.fromDate)} → <Text style={s.bold}>{fmtDate(x.toDate)}</Text> · {x.reason}
              </Text>
            ))}
            <Text style={s.small}>Tu paquete de trabajo ya trae la nueva fecha.</Text>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.h3}>Conversación</Text>
          {askedInfo && <Text style={[s.small, { color: '#1D5FA8', fontWeight: '700' }]}>Coordinación pidió más información.</Text>}
          {thread.map((m) => (
            <View key={m.key} style={[s.msg, m.mine ? s.msgMine : s.msgTheirs]}>
              <Text style={s.msgMeta}>{m.author} · {shortDateTime(m.at)}{m.pending ? ' · por enviar' : ''}{m.kind === 'decision' ? ' · decisión' : ''}</Text>
              <Text style={s.body}>{m.body}</Text>
            </View>
          ))}
          {!thread.length && <Text style={s.small}>Aquí verás las preguntas y respuestas de coordinación.</Text>}
          {r?.status !== 'cerrada' && (
            <View style={s.replyRow}>
              <TextInput
                value={reply}
                onChangeText={setReply}
                placeholder="Escribe a coordinación"
                placeholderTextColor={colors.text2}
                multiline
                style={s.input}
                accessibilityLabel="Mensaje a coordinación"
              />
              <Pressable onPress={() => void send()} disabled={!reply.trim()} style={[s.send, !reply.trim() && { opacity: 0.5 }]} accessibilityRole="button">
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h2: { fontSize: 18, fontWeight: '800', color: colors.text },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { color: colors.text, lineHeight: 21 },
  bold: { fontWeight: '700' },
  muted: { color: colors.text2 },
  small: { color: colors.text2, fontSize: 12 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  thumb: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#EEF1EC' },
  freed: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  addPhoto: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  plus: { fontSize: 26, color: colors.danger, fontWeight: '300' },
  msg: { borderRadius: 12, padding: 10, maxWidth: '88%', gap: 2 },
  msgMine: { alignSelf: 'flex-end', backgroundColor: colors.primarySoft },
  msgTheirs: { alignSelf: 'flex-start', backgroundColor: '#EEF1EC' },
  msgMeta: { color: colors.text2, fontSize: 11 },
  replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, maxHeight: 120 },
  send: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sendText: { color: colors.white, fontWeight: '700' },
  editBtn: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.surface },
  editText: { color: colors.primary, fontWeight: '800', fontSize: 15 },
});
