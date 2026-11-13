import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { todayLima, usePackageIndex, useWorkPackage } from '../../lib/workPackage';
import { useField } from '../../lib/field';
import { usePosition } from '../../lib/location';
import { useRoleView } from '../../lib/roles';
import { StationCard } from '../../components/field';
import { AlertButton } from '../../components/alerts';
import {
  AccountFooter, DayTabs, LinkRow, RetentionPrompt, SentBanner, SyncBar, UploadBar, dayLabel, fmtDate, homeStyles as s, longDate,
} from '../../components/home';
import { SupervisorHome } from '../../components/SupervisorHome';
import { LogisticsHome } from '../../components/LogisticsHome';
import { Banner, Button } from '../../components/ui';
import { colors } from '../../theme';

/** Inicio según el rol: Mi jornada (especialista), Supervisión o Logística. */
export default function Home() {
  const { home } = useRoleView();
  if (home === 'supervision') return <SupervisorHome />;
  if (home === 'logistica') return <LogisticsHome />;
  return <MiJornada />;
}

/** Mi jornada: estaciones programadas por día, con avance y distancia. Funciona sin conexión. */
function MiJornada() {
  const { online } = useAuth();
  const { pkg, downloadedAt, loading, syncing, error, download } = useWorkPackage();
  const index = usePackageIndex();
  const pos = usePosition();
  const roleView = useRoleView();
  const today = todayLima();
  const [date, setDate] = useState(today);

  // Días con programación, siempre incluyendo hoy.
  const dates = useMemo(() => [...new Set([today, ...(index?.dates ?? [])])].sort(), [today, index]);
  const items = useMemo(() => index?.day(date) ?? [], [index, date]);
  const nextDate = dates.find((d) => d > date && (index?.day(d).length ?? 0) > 0);
  const multiBrigade = (pkg?.brigades.length ?? 0) > 1;

  // Si el día elegido sale del paquete (p. ej. cambió la fecha), vuelve a hoy.
  useEffect(() => {
    if (!dates.includes(date)) setDate(today);
  }, [dates, date, today]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={s.wrap}
      refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void download()} enabled={online} tintColor={colors.primary} />}
    >
      <Stack.Screen
        options={{
          title: 'Mi jornada',
          headerRight: () =>
            pkg ? (
              <Pressable onPress={() => router.push('/mapa')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Abrir mapa">
                <Text style={s.headerBtn}>Mapa</Text>
              </Pressable>
            ) : null,
        }}
      />
      <SyncBar online={online} syncing={syncing} downloadedAt={downloadedAt} hasPkg={!!pkg} onRefresh={download} />
      <UploadBar online={online} />
      <SentBanner />
      <RetentionPrompt />

      {!!error && (pkg ? <Banner tone="info">{error}</Banner> : <Banner>{error}</Banner>)}
      {pkg && today > pkg.to && <Banner>Tu paquete de trabajo terminó el {fmtDate(pkg.to)}. Conéctate para descargar la nueva programación.</Banner>}

      {!pkg && !loading && !syncing && (
        <View style={s.emptyCard}>
          <Text style={s.emptyTitle}>Aún no tienes tu paquete de trabajo</Text>
          <Text style={s.emptyText}>
            {online
              ? 'Descárgalo para ver tus estaciones y trabajar sin conexión.'
              : 'Necesitas conexión una vez para descargar tus estaciones. Después podrás trabajar sin señal.'}
          </Text>
          {online && <Button title="Descargar paquete" onPress={() => void download()} />}
        </View>
      )}

      {pkg && (
        <>
          <AlertsSummary />
          {/* Quien además supervisa o lleva la logística entra a esas vistas desde aquí. */}
          {roleView.supervises && <LinkRow text="Supervisión de brigadas" onPress={() => router.push('/supervision')} />}
          {roleView.logistics && <LinkRow text="Logística de la brigada" onPress={() => router.push('/logistica')} />}
          <DayTabs dates={dates} date={date} today={today} count={(d) => index?.day(d).length ?? 0} onChange={setDate} />

          <View>
            <Text style={s.h1}>{longDate(date)}</Text>
            <Text style={s.sub}>
              {items.length ? `${items.length} ${items.length === 1 ? 'estación' : 'estaciones'}` : 'Sin estaciones'}
              {pkg.brigades.length ? ` · ${pkg.brigades.map((b) => b.name).join(', ')}` : ''}
            </Text>
          </View>

          {items.map((it) => (
            <StationCard
              key={it.schedule.id}
              item={it}
              pos={pos}
              showBrigade={multiBrigade}
              onPress={() => router.push({ pathname: '/estacion/[id]', params: { id: it.station.id, date } })}
            />
          ))}

          {!items.length && (
            <View style={s.emptyCard}>
              <Text style={s.emptyText}>
                {pkg.brigades.length
                  ? 'No tienes estaciones programadas este día.'
                  : 'No estás asignado a ninguna brigada activa. Consulta con coordinación.'}
              </Text>
              {nextDate && <Button title={`Ver ${dayLabel(nextDate, today).toLowerCase()}`} variant="outline" onPress={() => setDate(nextDate)} />}
            </View>
          )}
        </>
      )}

      <AccountFooter />
    </ScrollView>
  );
}

/** "Registrar alerta" y acceso a mis alertas (con aviso de respuestas nuevas). */
function AlertsSummary() {
  const { incidents, unreadIncidents } = useField();
  const open = incidents.filter((i) => !i.remote || i.remote.status === 'abierta' || i.remote.status === 'en_revision').length;
  return (
    <View style={{ gap: 8 }}>
      <AlertButton onPress={() => router.push({ pathname: '/alerta/nueva', params: { from: 'mi_jornada' } })} />
      {incidents.length > 0 && (
        <LinkRow
          text={`Mis alertas · ${open} abierta${open === 1 ? '' : 's'}${unreadIncidents ? ` · ${unreadIncidents} con respuesta nueva` : ''}`}
          unread={unreadIncidents > 0}
          onPress={() => router.push('/alertas')}
        />
      )}
    </View>
  );
}
