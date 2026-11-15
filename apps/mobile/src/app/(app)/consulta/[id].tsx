import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { INQUIRY_CHANNEL_LABELS, INQUIRY_MESSAGE_KIND_LABELS, type InquiryFile } from '@toce/shared';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useField } from '../../../lib/field';
import { shortDateTime } from '../../../components/alerts';
import { Pill } from '../../../components/field';
import { colors, radius } from '../../../theme';
import { inquiryState } from '../../../components/inquiries';

/** Una consulta de coordinación: la conversación y la respuesta (se guarda en el teléfono y se envía al conectarse). */
export default function InquiryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, online } = useAuth();
  const field = useField();
  const [reply, setReply] = useState('');
  const q = field.inquiries.find((x) => x.id === id);

  useEffect(() => {
    if (q?.unread) void field.markInquirySeen(q.id);
  }, [q?.unread, q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Consulta' }} />
        <Text style={s.muted}>No se encontró la consulta.</Text>
      </View>
    );
  }

  const st = inquiryState(q);
  const thread = [
    ...q.thread.map((m) => ({
      key: m.id, mine: m.kind === 'respuesta', body: m.body, at: m.sentAt, files: m.files, pending: false, error: null as string | null,
      // Fotos tomadas aquí: se ven desde el teléfono aunque aún no se suban.
      local: (q.photos[m.clientId] ?? []).filter((p) => !p.freed),
      meta: [
        m.onBehalfOfName ? `${m.onBehalfOfName} (anotó ${m.authorName})` : m.authorId === user?.id ? 'Tú' : m.authorName,
        INQUIRY_MESSAGE_KIND_LABELS[m.kind],
        m.channel !== 'app' ? INQUIRY_CHANNEL_LABELS[m.channel] : null,
      ].filter(Boolean).join(' · '),
    })),
    ...q.outbox.map((m) => ({
      key: m.clientId, mine: true, body: m.body, at: m.sentAt, files: [] as InquiryFile[], pending: true, error: m.error, meta: 'Tú · por enviar',
      local: q.photos[m.clientId] ?? [],
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const send = async () => {
    if (!reply.trim()) return;
    await field.sendInquiryReply(q.id, reply);
    setReply('');
  };

  const openFile = async (f: InquiryFile) => {
    if (!online) return Alert.alert('Sin conexión', 'Los adjuntos se abren cuando el teléfono tiene conexión.');
    try {
      const { url } = await api<{ url: string }>(`/inquiry-files/${f.id}/url`);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('No se pudo abrir', e instanceof Error ? e.message : 'Intenta de nuevo');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Consulta' }} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.head}>
            <Text style={[s.h2, { flex: 1 }]}>{q.subject}</Text>
            <Pill fg={st.fg} bg={st.bg}>{st.label}</Pill>
          </View>
          <Text style={s.small}>
            {[q.brigadeName, q.stationCode, q.methodCode].filter(Boolean).join(' · ') || 'General'} · {q.createdByName} · {shortDateTime(q.createdAt)}
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.h3}>Conversación</Text>
          {thread.map((m) => (
            <View key={m.key} style={[s.msg, m.mine ? s.msgMine : s.msgTheirs]}>
              <Text style={s.msgMeta}>{m.meta} · {shortDateTime(m.at)}</Text>
              {!(m.local.length && m.body === 'Foto') && <Text style={s.body}>{m.body}</Text>}
              {m.local.length > 0 && (
                <View style={s.photos}>
                  {m.local.map((p) => <Image key={p.clientId} source={{ uri: p.path }} style={s.photo} contentFit="cover" accessibilityLabel="Foto enviada" />)}
                </View>
              )}
              {m.local.some((p) => !p.uploaded) && <Text style={s.small}>Foto por subir</Text>}
              {m.files.filter((f) => !m.local.length || f.kind !== 'foto').map((f) => (
                <Pressable key={f.id} onPress={() => void openFile(f)} accessibilityRole="link" hitSlop={6}>
                  <Text style={s.file}>{f.kind === 'foto' ? 'Foto' : f.kind === 'audio' ? 'Audio' : 'Documento'}{f.name ? `: ${f.name}` : ''}</Text>
                </Pressable>
              ))}
              {!!m.error && <Text style={[s.small, { color: colors.danger }]}>No se pudo enviar: {m.error}</Text>}
            </View>
          ))}
          {q.status !== 'cerrada' ? (
            <View style={s.replyRow}>
              <TextInput
                value={reply}
                onChangeText={setReply}
                placeholder="Escribe tu respuesta"
                placeholderTextColor={colors.text2}
                multiline
                maxLength={4000}
                style={s.input}
                accessibilityLabel="Respuesta a coordinación"
              />
              <Pressable
                onPress={() => router.push({ pathname: '/camara', params: { exec: q.id, owner: 'inquiry', kind: 'foto', label: 'Foto para coordinación' } })}
                style={s.photoBtn}
                accessibilityRole="button"
                accessibilityLabel="Enviar una foto"
              >
                <Text style={s.photoBtnText}>Foto</Text>
              </Pressable>
              <Pressable onPress={() => void send()} disabled={!reply.trim()} style={[s.send, !reply.trim() && { opacity: 0.5 }]} accessibilityRole="button">
                <Text style={s.sendText}>Enviar</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.small}>Coordinación cerró esta consulta.</Text>
          )}
          {!online && q.status !== 'cerrada' && <Text style={s.small}>Sin conexión: tu respuesta y tus fotos se guardan y se envían al conectarte.</Text>}
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
  muted: { color: colors.text2 },
  small: { color: colors.text2, fontSize: 12 },
  file: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline', marginTop: 4 },
  msg: { borderRadius: 12, padding: 10, maxWidth: '88%', gap: 2 },
  msgMine: { alignSelf: 'flex-end', backgroundColor: colors.primarySoft },
  msgTheirs: { alignSelf: 'flex-start', backgroundColor: '#EEF1EC' },
  msgMeta: { color: colors.text2, fontSize: 11 },
  replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, maxHeight: 120 },
  send: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sendText: { color: colors.white, fontWeight: '700' },
  photoBtn: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  photoBtnText: { color: colors.primary, fontWeight: '700' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  photo: { width: 120, height: 120, borderRadius: 8, backgroundColor: '#E5E8E2' },
});
