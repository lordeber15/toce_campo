import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { formatUtm, latLngToUtm, type FieldRecord, type WpMethod } from '@toce/shared';
import { useField, type LocalAttachment, type LocalExecution } from '../../../lib/field';
import { usePosition } from '../../../lib/location';
import { todayLima, usePackageIndex } from '../../../lib/workPackage';
import { Pill, UNIT_STATUS } from '../../../components/field';
import { VoiceNotes } from '../../../components/VoiceNotes';
import { AlertButton } from '../../../components/alerts';
import { useRoleView } from '../../../lib/roles';
import { colors, radius } from '../../../theme';

/** Unidad de muestreo: iniciar, fotos por orientación, foto del método, registros, notas de voz y cierre. */
export default function UnitScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const index = usePackageIndex();
  const field = useField();
  const pos = usePosition();
  const [files, setFiles] = useState<LocalAttachment[]>([]);
  const [starting, setStarting] = useState(false);
  const roleView = useRoleView();

  const unit = index?.units.get(id);
  const execution = field.byUnit.get(id);
  const method = unit ? index?.methods.get(unit.methodId) : undefined;
  const station = unit ? index?.stations.get(unit.stationId) : undefined;

  const loadFiles = useCallback(async () => {
    setFiles(execution ? await field.attachmentsOf(execution.clientId) : []);
  }, [execution?.clientId, field.attachmentsOf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, field.rev]);

  const required = useMemo(() => (method ? requiredPhotos(method) : []), [method]);
  const missing = required.filter((r) => !files.some((f) => f.kind === r.kind && (r.kind === 'foto_metodo' || f.slotKey === r.key)));

  // Con todas las fotos obligatorias, la unidad pasa a "fotos listas" (falta el formulario o el cierre).
  useEffect(() => {
    if (execution?.status === 'en_curso' && required.length > 0 && missing.length === 0) {
      void field.update(execution.clientId, { status: 'fotos_ok' });
    }
  }, [execution?.status, execution?.clientId, required.length, missing.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!index || !unit || !method || !station) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Unidad' }} />
        <Text style={s.muted}>Esta unidad ya no está en tu paquete de trabajo.</Text>
      </View>
    );
  }

  const code = execution?.unitCode ?? unit.code;
  const st = UNIT_STATUS[unit.status] ?? UNIT_STATUS.pendiente!;
  const closed = execution?.status === 'completada' || execution?.status === 'no_realizada';
  const p = pos.status === 'ok' ? pos.position : null;

  const start = async () => {
    setStarting(true);
    try {
      const schedules = index.pkg.schedules.filter((sc) => sc.stationId === station.id);
      const schedule = schedules.find((sc) => sc.plannedDate === (date ?? todayLima())) ?? schedules[0];
      await field.start({
        unitId: unit.id, stationMethodId: unit.stationMethodId, stationId: station.id, methodId: method.id,
        scheduleId: schedule?.id ?? null, brigadeId: schedule?.brigadeId ?? null, unitCode: unit.code,
        position: p ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy } : null,
      });
    } finally {
      setStarting(false);
    }
  };

  const openAlert = (notDone: boolean) =>
    router.push({ pathname: '/alerta/nueva', params: { stationId: station.id, unitId: unit.id, from: 'unidad', ...(notDone ? { notDone: '1' } : {}) } });

  const takePhoto = (kind: 'foto' | 'foto_metodo', slot: string | null, label: string) => {
    if (!execution) return;
    router.push({ pathname: '/camara', params: { exec: execution.clientId, kind, label, ...(slot ? { slot } : {}) } });
  };

  const close = () => {
    if (!execution) return;
    if (missing.length) {
      Alert.alert('Faltan fotos', `Antes de cerrar la unidad toma: ${missing.map((m) => m.label).join(', ')}.`);
      return;
    }
    const audios = files.filter((f) => f.kind === 'audio').length;
    const elapsedMin = (Date.now() - new Date(execution.startedAt).getTime()) / 60000;
    const warnings: string[] = [];
    if (!execution.formData.records.length && !audios) warnings.push('No hay registros del formulario ni notas de voz.');
    if (method.minDurationMin && elapsedMin < method.minDurationMin) {
      warnings.push(`Han pasado ${Math.floor(elapsedMin)} min de los ${method.minDurationMin} min mínimos del método.`);
    }
    const doClose = async () => {
      await field.update(execution.clientId, { status: 'completada', finishedAt: new Date().toISOString() });
      router.back();
    };
    if (!warnings.length) return void doClose();
    Alert.alert('¿Cerrar la unidad?', warnings.join('\n\n'), [
      { text: 'Seguir registrando', style: 'cancel' },
      { text: 'Cerrar igual', onPress: () => void doClose() },
    ]);
  };

  const reopen = () =>
    Alert.alert('Reabrir unidad', 'Podrás agregar fotos, registros o notas. Tendrás que cerrarla de nuevo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Reabrir',
        onPress: () => void field.update(execution!.clientId, { status: missing.length || !required.length ? 'en_curso' : 'fotos_ok', finishedAt: null }),
      },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: code }} />

      <View style={s.card}>
        <View style={s.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.code}>{code}</Text>
            <Text style={s.muted}>{method.code} · {method.name}</Text>
          </View>
          <Pill fg={st.fg} bg={st.bg}>{st.label}</Pill>
        </View>
        {execution ? (
          <ExecutionInfo execution={execution} method={method} />
        ) : unit.status === 'no_realizada' ? (
          <NotDoneInfo unitId={unit.id} />
        ) : !roleView.executes ? (
          // Supervisor / logístico: ven la unidad pero no la ejecutan.
          <>
            <Text style={s.small}>El especialista registra esta unidad desde su teléfono. El estado es el del último paquete descargado.</Text>
            {roleView.supervises && (
              <AlertButton
                label="Registrar incidencia de supervisión"
                onPress={() => router.push({ pathname: '/supervision/nueva', params: { stationId: station.id, unitId: unit.id } })}
              />
            )}
          </>
        ) : (
          <>
            {!!method.instructions && <Text style={s.body}>{method.instructions}</Text>}
            <Text style={s.small}>
              Al iniciar se registran la hora y tu ubicación{p ? ` (GPS ±${Math.round(p.accuracy ?? 0)} m)` : pos.status === 'waiting' ? ' (buscando GPS…)' : ''}.
            </Text>
            <Pressable onPress={() => void start()} disabled={starting} style={({ pressed }) => [s.primary, (pressed || starting) && s.pressed]} accessibilityRole="button">
              <Text style={s.primaryText}>{starting ? 'Iniciando…' : 'Iniciar unidad'}</Text>
            </Pressable>
            <Pressable onPress={() => openAlert(true)} style={s.notDone} accessibilityRole="button">
              <Text style={s.notDoneText}>No se puede realizar esta unidad</Text>
            </Pressable>
          </>
        )}
      </View>

      {execution && (
        <>
          {(method.photoSlots.length > 0 || method.methodPhotoInstructions || method.methodPhotoRequired) && (
            <View style={s.card}>
              <Text style={s.h2}>Registro fotográfico</Text>
              {method.photoSlots.length > 0 && (
                <>
                  <Text style={s.small}>Fotos de la unidad de muestreo ({method.photoSlots.length}).</Text>
                  <View style={s.grid}>
                    {method.photoSlots.map((slot, i) => (
                      <PhotoTile
                        key={slot.key}
                        label={slot.label}
                        required={slot.required}
                        photo={files.find((f) => f.kind === 'foto' && f.slotKey === slot.key)}
                        disabled={closed}
                        last={i % 2 === 1}
                        onPress={() => takePhoto('foto', slot.key, slot.label)}
                      />
                    ))}
                  </View>
                </>
              )}
              <View style={s.methodPhoto}>
                <Text style={s.h3}>Foto del método{method.methodPhotoRequired ? ' *' : ''}</Text>
                <Text style={s.small}>
                  {method.methodPhotoInstructions ?? 'Foto panorámica que muestre la aplicación del método en el entorno.'}
                </Text>
                <View style={s.grid}>
                  <PhotoTile
                    label="Método"
                    required={method.methodPhotoRequired}
                    photo={files.find((f) => f.kind === 'foto_metodo')}
                    disabled={closed}
                    last={false}
                    onPress={() => takePhoto('foto_metodo', null, 'Foto del método')}
                  />
                </View>
              </View>
            </View>
          )}

          <View style={s.card}>
            <View style={s.headRow}>
              <Text style={[s.h2, { flex: 1 }]}>Registros</Text>
              <Text style={s.small}>{execution.formData.records.length}</Text>
            </View>
            {execution.formData.records.map((r, i) => (
              <Pressable
                key={r.id}
                onPress={() => router.push({ pathname: '/registro', params: { exec: execution.clientId, record: r.id } })}
                style={({ pressed }) => [s.record, pressed && s.pressed]}
                accessibilityRole="button"
              >
                <Text style={s.recordN}>{i + 1}</Text>
                <Text style={s.recordText} numberOfLines={2}>{recordSummary(r, method)}</Text>
                <Text style={s.chev}>›</Text>
              </Pressable>
            ))}
            {!closed && (
              <Pressable
                onPress={() => router.push({ pathname: '/registro', params: { exec: execution.clientId } })}
                style={({ pressed }) => [s.secondary, pressed && s.pressed]}
                accessibilityRole="button"
              >
                <Text style={s.secondaryText}>{execution.formData.records.length ? 'Agregar otro registro' : 'Llenar formulario'}</Text>
              </Pressable>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.h2}>Notas de voz</Text>
            <Text style={s.small}>Alternativa al formulario cuando no da tiempo de escribir. Se transcriben después en gabinete.</Text>
            <VoiceNotes execution={execution} notes={files.filter((f) => f.kind === 'audio')} position={p} disabled={closed} onChange={() => void loadFiles()} />
          </View>

          <Observations execution={execution} disabled={closed} />

          <SyncState execution={execution} files={files} />

          {!closed && <AlertButton onPress={() => openAlert(false)} />}

          {closed ? (
            <Pressable onPress={reopen} style={({ pressed }) => [s.secondary, pressed && s.pressed]} accessibilityRole="button">
              <Text style={s.secondaryText}>Reabrir unidad</Text>
            </Pressable>
          ) : (
            <Pressable onPress={close} style={({ pressed }) => [s.primary, pressed && s.pressed]} accessibilityRole="button">
              <Text style={s.primaryText}>Cerrar unidad</Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

type RequiredPhoto = { kind: 'foto' | 'foto_metodo'; key: string; label: string };
function requiredPhotos(m: WpMethod): RequiredPhoto[] {
  const list: RequiredPhoto[] = m.photoSlots.filter((p) => p.required).map((p) => ({ kind: 'foto', key: p.key, label: p.label }));
  if (m.methodPhotoRequired) list.push({ kind: 'foto_metodo', key: 'metodo', label: 'Foto del método' });
  return list;
}

/** "Turdus chiguanco · 3 ind." u otros dos primeros campos con valor. */
function recordSummary(r: FieldRecord, m: WpMethod): string {
  const parts = m.formSchema.fields
    .filter((f) => !f.auto && r.values[f.key] != null && r.values[f.key] !== '')
    .slice(0, 3)
    .map((f) => (f.type === 'number' ? `${f.label}: ${String(r.values[f.key])}` : String(r.values[f.key])));
  return parts.join(' · ') || 'Registro sin datos';
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' });

function ExecutionInfo({ execution: e, method }: { execution: LocalExecution; method: WpMethod }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (e.finishedAt) return;
    const iv = setInterval(() => tick((v) => v + 1), 30000);
    return () => clearInterval(iv);
  }, [e.finishedAt]);
  const end = e.finishedAt ? new Date(e.finishedAt).getTime() : Date.now();
  const min = Math.max(0, Math.floor((end - new Date(e.startedAt).getTime()) / 60000));
  return (
    <View style={{ gap: 6 }}>
      <InfoRow label="Inicio" value={`${hhmm(e.startedAt)}${e.finishedAt ? ` · fin ${hhmm(e.finishedAt)}` : ''}`} />
      <InfoRow
        label="Duración"
        value={`${min} min${method.minDurationMin ? ` de ${method.minDurationMin} mín.` : ''}`}
        warn={!!method.minDurationMin && min < method.minDurationMin && !e.finishedAt}
      />
      <InfoRow
        label="Ubicación al iniciar"
        value={e.startLat != null && e.startLng != null ? `${formatUtm(latLngToUtm(e.startLat, e.startLng))}${e.startAccuracy != null ? ` ±${Math.round(e.startAccuracy)} m` : ''}` : 'Sin GPS'}
      />
    </View>
  );
}

/** Unidad declarada "no realizada" en una alerta: se muestra el motivo en lugar de iniciarla. */
function NotDoneInfo({ unitId }: { unitId: string }) {
  const { incidents } = useField();
  const inc = incidents.find((i) => i.unitId === unitId && i.unitNotDone);
  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.body, { color: colors.danger, fontWeight: '700' }]}>No realizada</Text>
      {inc ? (
        <>
          <Text style={s.body}>{inc.description}</Text>
          <Pressable onPress={() => router.push({ pathname: '/alerta/[id]', params: { id: inc.clientId } })} accessibilityRole="button">
            <Text style={[s.secondaryText, { paddingVertical: 4 }]}>Ver alerta y respuesta de coordinación ›</Text>
          </Pressable>
        </>
      ) : (
        <Text style={s.small}>Registrada en el servidor. Si coordinación la reprograma, volverá a quedar pendiente.</Text>
      )}
    </View>
  );
}

function InfoRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.small}>{label}</Text>
      <Text style={[s.infoValue, warn && { color: colors.warn }]}>{value}</Text>
    </View>
  );
}

function PhotoTile({ label, required, photo, disabled, last, onPress }: {
  label: string; required: boolean; photo?: LocalAttachment; disabled: boolean; last: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.tile, { marginRight: last ? 0 : '4%' }, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={photo ? `${label}: tomada. Tocar para repetir` : `Tomar foto ${label}`}
    >
      {photo?.freed ? (
        <View style={[s.thumb, s.empty]}><Text style={s.small}>En el servidor</Text></View>
      ) : photo ? (
        <Image source={{ uri: photo.path }} style={s.thumb} contentFit="cover" />
      ) : (
        <View style={[s.thumb, s.empty]}>
          <Text style={s.plus}>+</Text>
        </View>
      )}
      <Text style={s.tileLabel}>
        {label}{required ? ' *' : ''}{photo && !disabled ? ' · repetir' : ''}
      </Text>
    </Pressable>
  );
}

function Observations({ execution, disabled }: { execution: LocalExecution; disabled: boolean }) {
  const field = useField();
  const [text, setText] = useState(execution.observations ?? '');
  const save = () => {
    const v = text.trim() || null;
    if (v !== (execution.observations ?? null)) void field.update(execution.clientId, { observations: v });
  };
  return (
    <View style={s.card}>
      <Text style={s.h2}>Observaciones</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={save}
        editable={!disabled}
        multiline
        placeholder="Clima, incidencias menores, notas del sitio…"
        placeholderTextColor={colors.text2}
        style={s.textarea}
        accessibilityLabel="Observaciones de la unidad"
      />
    </View>
  );
}

function SyncState({ execution, files }: { execution: LocalExecution; files: LocalAttachment[] }) {
  const pendingData = !execution.syncedAt || execution.syncedAt !== execution.updatedAt;
  const pendingFiles = files.filter((f) => !f.uploaded || (f.originalPath && !f.originalUploaded)).length;
  const error = execution.syncError ?? files.find((f) => f.syncError)?.syncError;
  const text = error
    ? `No se pudo enviar: ${error}`
    : pendingData || pendingFiles
      ? `Guardado en el teléfono · ${pendingFiles ? `${pendingFiles} archivo${pendingFiles > 1 ? 's' : ''} por enviar` : 'datos por enviar'}`
      : 'Enviado al servidor';
  return <Text style={[s.syncText, error ? { color: colors.danger } : null]}>{text}</Text>;
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: { fontSize: 24, fontWeight: '800', color: colors.text },
  muted: { color: colors.text2, lineHeight: 20 },
  body: { color: colors.text, lineHeight: 20 },
  small: { color: colors.text2, fontSize: 12, lineHeight: 17 },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text },
  h3: { fontSize: 15, fontWeight: '700', color: colors.text },
  primary: { backgroundColor: colors.primary, borderRadius: radius, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  secondary: { borderRadius: radius, borderWidth: 1, borderColor: colors.primary, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.surface },
  secondaryText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  pressed: { opacity: 0.7 },
  notDone: { alignItems: 'center', paddingVertical: 8 },
  notDoneText: { color: colors.danger, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoValue: { color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  tile: { width: '48%' },
  thumb: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: '#EEF1EC' },
  empty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  plus: { fontSize: 30, color: colors.primary, fontWeight: '300' },
  tileLabel: { marginTop: 6, color: colors.text, fontWeight: '600', fontSize: 13 },
  methodPhoto: { gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  record: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  recordN: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, color: colors.primary, textAlign: 'center', lineHeight: 24, fontWeight: '700', fontSize: 12, overflow: 'hidden' },
  recordText: { flex: 1, color: colors.text },
  chev: { color: colors.text2, fontSize: 22 },
  textarea: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.text, textAlignVertical: 'top', fontSize: 15 },
  syncText: { color: colors.text2, fontSize: 13, textAlign: 'center' },
});
