import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useAuth } from '../lib/auth';
import { useField } from '../lib/field';
import { usePosition } from '../lib/location';
import { useRoleView } from '../lib/roles';
import { todayLima, usePackageIndex, useWorkPackage } from '../lib/workPackage';
import { StationCard } from './field';
import { AlertButton } from './alerts';
import { AccountFooter, DayTabs, LinkRow, RetentionPrompt, SentBanner, SyncBar, UploadBar, homeStyles as hs, longDate } from './home';
import { Banner, Button } from './ui';
import { colors, radius } from '../theme';

const OPEN = new Set(['abierta', 'en_revision']);

/**
 * Inicio del supervisor de campo: brigadas que supervisa, sus estaciones del día con el avance
 * (según el último paquete descargado), registro de incidencias y alertas de sus brigadas.
 * Funciona sin conexión; lo registrado se envía solo al tener señal.
 */
export function SupervisorHome() {
  const { online } = useAuth();
  const { pkg, downloadedAt, loading, syncing, error, download } = useWorkPackage();
  const field = useField();
  const index = usePackageIndex();
  const pos = usePosition();
  const roleView = useRoleView();
  const today = todayLima();
  const [date, setDate] = useState(today);

  const brigades = useMemo(() => pkg?.brigades.filter((b) => b.myRoles.includes('supervisor')) ?? [], [pkg]);
  const ids = useMemo(() => new Set(brigades.map((b) => b.id)), [brigades]);
  const dayOf = (d: string) => (index?.day(d) ?? []).filter((it) => ids.has(it.schedule.brigadeId));
  const dates = useMemo(() => [...new Set([today, ...(index?.dates ?? [])])].sort(), [today, index]);
  const items = dayOf(date);

  useEffect(() => {
    if (!dates.includes(date)) setDate(today);
  }, [dates, date, today]);

  const unread = field.unreadBrigadeIncidents + field.unreadIncidents;
  const openBrigade = field.brigadeIncidents.filter((i) => OPEN.has(i.status)).length;
  const openMine = field.incidents.filter((i) => !i.remote || OPEN.has(i.remote.status)).length;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={hs.wrap}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => { void download(); void field.syncNow(); }} enabled={online} tintColor={colors.primary} />}
    >
      <Stack.Screen
        options={{
          title: 'Supervisión',
          headerRight: () =>
            pkg ? (
              <Pressable onPress={() => router.push('/mapa')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Abrir mapa">
                <Text style={hs.headerBtn}>Mapa</Text>
              </Pressable>
            ) : null,
        }}
      />
      <SyncBar online={online} syncing={syncing} downloadedAt={downloadedAt} hasPkg={!!pkg} onRefresh={download} />
      <UploadBar online={online} />
      <SentBanner />
      <RetentionPrompt />
      {!!error && (pkg ? <Banner tone="info">{error}</Banner> : <Banner>{error}</Banner>)}

      {!pkg && !loading && !syncing && (
        <View style={hs.emptyCard}>
          <Text style={hs.emptyTitle}>Aún no tienes el paquete de supervisión</Text>
          <Text style={hs.emptyText}>
            {online ? 'Descárgalo para ver tus brigadas y trabajar sin conexión.' : 'Necesitas conexión una vez para descargar tus brigadas.'}
          </Text>
          {online && <Button title="Descargar paquete" onPress={() => void download()} />}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <AlertButton label="Registrar incidencia" onPress={() => router.push('/supervision/nueva')} />
        <LinkRow
          text={`Alertas e incidencias · ${openBrigade + openMine} abierta${openBrigade + openMine === 1 ? '' : 's'}${unread ? ` · ${unread} nueva${unread > 1 ? 's' : ''}` : ''}`}
          unread={unread > 0}
          onPress={() => router.push('/supervision/alertas')}
        />
        {roleView.logistics && <LinkRow text="Logística de la brigada" onPress={() => router.push('/logistica')} />}
      </View>

      {pkg && (
        <>
          {brigades.map((b) => {
            const its = dayOf(today).filter((it) => it.schedule.brigadeId === b.id);
            const total = its.reduce((a, it) => a + it.methods.reduce((x, m) => x + (m.method.isOpenEnded ? 0 : m.stationMethod.unitsRequired), 0), 0);
            const done = its.reduce((a, it) => a + it.methods.reduce((x, m) => x + (m.method.isOpenEnded ? 0 : m.done), 0), 0);
            const alerts = field.brigadeIncidents.filter((i) => i.brigadeId === b.id && OPEN.has(i.status)).length;
            return (
              <View key={b.id} style={s.brigade}>
                <View style={s.brigadeHead}>
                  <Text style={s.brigadeName}>{b.name}</Text>
                  {!!b.specialtyName && <Text style={s.small}>{b.specialtyName}</Text>}
                </View>
                <Text style={s.small}>
                  {b.leaderName ? `Jefe: ${b.leaderName} · ` : ''}{b.members.length} integrante{b.members.length === 1 ? '' : 's'}
                </Text>
                <View style={s.stats}>
                  <Stat value={`${its.length}`} label="estaciones hoy" />
                  <Stat value={total ? `${done}/${total}` : '—'} label="unidades" />
                  <Stat value={`${alerts}`} label="alertas abiertas" tone={alerts ? 'danger' : undefined} />
                </View>
              </View>
            );
          })}
          {!brigades.length && (
            <View style={hs.emptyCard}>
              <Text style={hs.emptyText}>No figuras como supervisor de ninguna brigada activa. Consulta con coordinación.</Text>
            </View>
          )}

          <DayTabs dates={dates} date={date} today={today} count={(d) => dayOf(d).length} onChange={setDate} />
          <View>
            <Text style={hs.h1}>{longDate(date)}</Text>
            <Text style={hs.sub}>
              {items.length ? `${items.length} ${items.length === 1 ? 'estación' : 'estaciones'}` : 'Sin estaciones'} · avance según el último paquete
            </Text>
          </View>
          {items.map((it) => (
            <StationCard
              key={it.schedule.id}
              item={it}
              pos={pos}
              showBrigade={brigades.length > 1}
              onPress={() => router.push({ pathname: '/estacion/[id]', params: { id: it.station.id, date } })}
            />
          ))}
        </>
      )}

      <AccountFooter />
    </ScrollView>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'danger' }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, tone === 'danger' && { color: colors.danger }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  brigade: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  brigadeHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  brigadeName: { fontSize: 17, fontWeight: '800', color: colors.text },
  small: { color: colors.text2, fontSize: 13 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, color: colors.text2 },
});
