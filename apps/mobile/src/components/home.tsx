import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ROLE_LABELS, SPECIALTY_LABELS, type SpecialtyCode } from '@toce/shared';
import { useAuth } from '../lib/auth';
import { useField } from '../lib/field';
import { getDb } from '../lib/db';
import { Button } from './ui';
import { colors, radius } from '../theme';

/** Piezas comunes de las pantallas de inicio (Mi jornada, Supervisión, Logística). */

export const TZ = 'America/Lima';
const asDate = (d: string) => new Date(`${d}T12:00:00-05:00`);
export const fmtDate = (d: string) => asDate(d).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: TZ });
export const longDate = (d: string) => {
  const t = asDate(d).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export function dayLabel(d: string, today: string) {
  const diff = Math.round((asDate(d).getTime() - asDate(today).getTime()) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  const t = asDate(d).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', timeZone: TZ }).replace('.', '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function sinceLabel(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const sameDay = d.toLocaleDateString('es-PE', { timeZone: TZ }) === new Date().toLocaleDateString('es-PE', { timeZone: TZ });
  const time = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  return sameDay ? `hoy a las ${time}` : `el ${d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: TZ })} a las ${time}`;
}

/** Selector de días con programación. */
export function DayTabs({ dates, date, today, count, unit = 'EM', onChange }: {
  dates: string[]; date: string; today: string; count: (d: string) => number; unit?: string; onChange: (d: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.days}>
      {dates.map((d) => {
        const n = count(d);
        const on = d === date;
        return (
          <Pressable
            key={d}
            onPress={() => onChange(d)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${dayLabel(d, today)}, ${n} estaciones`}
            style={[s.day, on && s.dayOn]}
          >
            <Text style={[s.dayTop, on && s.dayTextOn]}>{dayLabel(d, today)}</Text>
            <Text style={[s.dayCount, on && s.dayTextOn]}>{n ? `${n} ${unit}` : '—'}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SyncBar({ online, syncing, downloadedAt, hasPkg, onRefresh }: {
  online: boolean; syncing: boolean; downloadedAt: string | null; hasPkg: boolean; onRefresh: () => Promise<void>;
}) {
  const when = downloadedAt ? sinceLabel(downloadedAt) : null;
  const text = syncing
    ? 'Descargando paquete de trabajo…'
    : online
      ? hasPkg ? `Conectado · paquete actualizado ${when}` : 'Conectado'
      : hasPkg ? `Sin conexión · paquete descargado ${when}` : 'Sin conexión';
  return (
    <View style={[s.sync, { backgroundColor: online ? colors.primarySoft : '#FFF4E0' }]}>
      <View style={[s.syncDot, { backgroundColor: online ? colors.accent : colors.warn }]} />
      <Text style={[s.syncText, { color: online ? colors.primary : colors.warn }]} numberOfLines={2}>{text}</Text>
      {online && hasPkg && !syncing && (
        <Pressable onPress={() => void onRefresh()} accessibilityRole="button" hitSlop={10}>
          <Text style={s.syncAction}>Actualizar</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Lo registrado en campo que falta enviar al servidor. */
export function UploadBar({ online }: { online: boolean }) {
  const { pending, syncing, lastSyncError, syncNow } = useField();
  const n = pending.executions + pending.files;
  if (!n && !lastSyncError) return null;
  const mb = pending.bytes / (1024 * 1024);
  const parts = [
    pending.executions ? `${pending.executions} registro${pending.executions > 1 ? 's' : ''}` : null,
    pending.files ? `${pending.files} archivo${pending.files > 1 ? 's' : ''}${mb >= 0.1 ? ` (${mb.toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB)` : ''}` : null,
  ].filter(Boolean);
  const text = syncing
    ? `Enviando ${parts.join(' y ')}…`
    : lastSyncError
      ? `Error al enviar: ${lastSyncError}`
      : `Por enviar: ${parts.join(' y ')}${online ? '' : ' · se enviarán al tener conexión'}`;
  return (
    <View style={[s.sync, { backgroundColor: '#E4EEF9' }]}>
      <View style={[s.syncDot, { backgroundColor: '#1D5FA8' }]} />
      <Text style={[s.syncText, { color: '#1D5FA8' }]} numberOfLines={2}>{text}</Text>
      {online && !syncing && (
        <Pressable onPress={() => void syncNow()} accessibilityRole="button" hitSlop={10}>
          <Text style={[s.syncAction, { color: '#1D5FA8' }]}>Enviar</Text>
        </Pressable>
      )}
    </View>
  );
}

/** "Se enviaron N registros" tras una sincronización con envíos (se oculta solo). */
export function SentBanner() {
  const { lastReport } = useField();
  const [visible, setVisible] = useState<string | null>(null);
  useEffect(() => {
    if (!lastReport) return;
    setVisible(lastReport.at);
    const t = setTimeout(() => setVisible(null), 8000);
    return () => clearTimeout(t);
  }, [lastReport]);
  if (!lastReport || visible !== lastReport.at) return null;
  const parts = [
    lastReport.records ? `${lastReport.records} registro${lastReport.records > 1 ? 's' : ''}` : null,
    lastReport.files ? `${lastReport.files} archivo${lastReport.files > 1 ? 's' : ''}` : null,
  ].filter(Boolean);
  return (
    <View style={[s.sync, { backgroundColor: colors.primarySoft }]}>
      <Text style={[s.syncText, { color: colors.primary }]}>
        {parts.length ? `Se enviaron ${parts.join(' y ')}` : ''}
        {lastReport.responses ? `${parts.length ? ' · ' : ''}${lastReport.responses} respuesta${lastReport.responses > 1 ? 's' : ''} de coordinación` : ''}
      </Text>
    </View>
  );
}

/**
 * Limpieza acordada: los archivos ya enviados se conservan 30 días en el teléfono. Pasado ese plazo
 * se pregunta (una vez al día como máximo) si se liberan; lo no enviado nunca se borra.
 */
export function RetentionPrompt() {
  const { retentionCandidates, freeUploadedFiles, rev } = useField();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void (async () => {
      const db = await getDb();
      const last = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = 'retention_prompt_at'");
      if (last && Date.now() - new Date(last.value).getTime() < 24 * 3600 * 1000) return;
      const c = await retentionCandidates();
      if (!c.count) return;
      await db.runAsync("INSERT INTO meta (key, value) VALUES ('retention_prompt_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", new Date().toISOString());
      const mb = (c.bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 0 });
      Alert.alert(
        'Liberar espacio',
        `Hay ${c.count} fotos y audios de hace más de 30 días que ya están en el servidor (${mb} MB). ¿Borrarlos del teléfono? Lo que aún no se envía no se toca.`,
        [
          { text: 'Ahora no', style: 'cancel' },
          {
            text: 'Liberar', onPress: async () => {
              const r = await freeUploadedFiles();
              Alert.alert('Listo', `Se liberaron ${(r.bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 0 })} MB.`);
            },
          },
        ],
      );
    })();
  }, [rev, retentionCandidates, freeUploadedFiles]);
  return null;
}

/** Fila de acceso (p. ej. "Mis alertas · 2 abiertas") con punto de novedad. */
export function LinkRow({ text, unread, onPress }: { text: string; unread?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.linkRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={s.linkText}>{text}</Text>
      {unread && <View style={s.unreadDot} />}
      <Text style={s.chev}>›</Text>
    </Pressable>
  );
}

/** Nombre, roles y botones de bloqueo / cierre de sesión. */
export function AccountFooter() {
  const { user, lock, signOut } = useAuth();
  const specialty = user?.specialtyCode ? SPECIALTY_LABELS[user.specialtyCode as SpecialtyCode] ?? user.specialtyCode : null;
  return (
    <View style={s.account}>
      <Text style={s.accountName}>{user?.fullName}</Text>
      <Text style={s.accountMeta}>{[user?.roles.map((r) => ROLE_LABELS[r]).join(' · '), specialty].filter(Boolean).join(' · ')}</Text>
      <View style={s.accountBtns}>
        <Button title="Bloquear" variant="outline" onPress={lock} style={{ flex: 1, height: 44 }} />
        <Button title="Cerrar sesión" variant="ghost" onPress={signOut} style={{ flex: 1, height: 44 }} />
      </View>
    </View>
  );
}

export const homeStyles = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 32 },
  headerBtn: { color: colors.white, fontWeight: '700', fontSize: 16, paddingHorizontal: 4 },
  h1: { fontSize: 20, fontWeight: '800', color: colors.text },
  h2: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { color: colors.text2, marginTop: 2 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  emptyText: { color: colors.text2, lineHeight: 21 },
});

const s = StyleSheet.create({
  sync: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius },
  syncDot: { width: 10, height: 10, borderRadius: 5 },
  syncText: { fontWeight: '600', flex: 1 },
  syncAction: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  days: { gap: 8, paddingVertical: 2 },
  day: { minWidth: 72, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTop: { fontWeight: '700', color: colors.text },
  dayCount: { fontSize: 12, color: colors.text2, marginTop: 2 },
  dayTextOn: { color: colors.white },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  linkText: { flex: 1, color: colors.text, fontWeight: '600' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  chev: { color: colors.text2, fontSize: 20 },
  account: { marginTop: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border, gap: 4 },
  accountName: { fontWeight: '700', color: colors.text },
  accountMeta: { color: colors.text2, fontSize: 13 },
  accountBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
