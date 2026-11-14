import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useField } from '../../lib/field';
import { inquiryState } from '../../components/inquiries';
import { shortDateTime } from '../../components/alerts';
import { Pill } from '../../components/field';
import { colors, radius } from '../../theme';

/** Consultas de coordinación dirigidas a mí. */
export default function InquiriesScreen() {
  const { inquiries } = useField();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap}>
      <Stack.Screen options={{ title: 'Consultas de coordinación' }} />
      <Text style={s.hint}>Responde aunque no tengas señal: la respuesta se envía sola cuando el teléfono se conecte.</Text>
      <View style={s.card}>
        {inquiries.map((q) => {
          const st = inquiryState(q);
          const last = q.thread.at(-1);
          return (
            <Pressable
              key={q.id}
              onPress={() => router.push({ pathname: '/consulta/[id]', params: { id: q.id } })}
              style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <View style={{ flex: 1, gap: 3 }}>
                <View style={s.head}>
                  <Text style={s.subject} numberOfLines={1}>{q.subject}</Text>
                  {q.unread && <View style={s.dot} accessibilityLabel="Pregunta nueva" />}
                </View>
                <Text style={s.small} numberOfLines={1}>
                  {[q.stationCode, q.methodCode, q.brigadeName].filter(Boolean).join(' · ') || 'General'} · {q.createdByName}
                </Text>
                {last && <Text style={s.desc} numberOfLines={2}>{last.body}</Text>}
                <Text style={s.small}>{shortDateTime(q.updatedAt)}</Text>
              </View>
              <Pill fg={st.fg} bg={st.bg}>{st.label}</Pill>
            </Pressable>
          );
        })}
        {!inquiries.length && <Text style={s.empty}>No tienes consultas de coordinación.</Text>}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  hint: { color: colors.text2, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subject: { color: colors.text, fontWeight: '700', fontSize: 15, flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.danger },
  small: { color: colors.text2, fontSize: 12 },
  desc: { color: colors.text, fontSize: 14, lineHeight: 19 },
  empty: { color: colors.text2, paddingVertical: 20, textAlign: 'center' },
});
