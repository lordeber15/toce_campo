import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import {
  INCIDENT_MOMENT_LABELS, INCIDENT_MOMENTS, INCIDENT_TYPE_LABELS, LOGISTICS_INCIDENT_TYPES, SPECIALIST_INCIDENT_TYPES,
  type IncidentMoment, type IncidentType,
} from '@toce/shared';
import { useField, type LocalAttachment } from '../../../lib/field';
import { usePosition } from '../../../lib/location';
import { todayLima, usePackageIndex } from '../../../lib/workPackage';
import { colors, radius } from '../../../theme';

const QUICK_ACTIONS = ['Reprogramar la actividad', 'Ajustar el esfuerzo de muestreo', 'Continuar con las demás unidades', 'Requiere apoyo logístico'];
const LOGISTICS_ACTIONS = ['Enviar movilidad de reemplazo', 'Enviar repuesto o equipo', 'Cambiar de hospedaje', 'Pausar la salida de la brigada'];

/**
 * Registrar alerta / incumplimiento. Se abre desde Mi jornada (antes de llegar), desde la estación
 * o desde una unidad (durante/después). Estación, método, unidad, hora y GPS se completan solos.
 * Con mode=logistica es la incidencia logística (accidente, desperfecto, hospedaje, equipos).
 */
export default function NewAlertScreen() {
  const params = useLocalSearchParams<{
    stationId?: string; unitId?: string; from?: 'mi_jornada' | 'estacion' | 'unidad'; notDone?: string;
    mode?: 'logistica'; type?: IncidentType; brigadeId?: string; text?: string;
  }>();
  const logistics = params.mode === 'logistica';
  const index = usePackageIndex();
  const field = useField();
  const pos = usePosition();
  const [clientId] = useState(() => Crypto.randomUUID());
  const [occurredAt] = useState(() => new Date().toISOString());
  const from = logistics ? 'logistica' : params.from ?? 'mi_jornada';
  const [type, setType] = useState<IncidentType | null>(params.type ?? (params.notDone ? 'imposibilidad' : null));
  const [moment, setMoment] = useState<IncidentMoment>(from === 'unidad' ? 'durante' : 'antes');
  const [description, setDescription] = useState(params.text ?? '');
  const [proposed, setProposed] = useState(params.notDone ? 'Reprogramar la actividad' : '');
  const [notDone, setNotDone] = useState(params.notDone === '1');
  const [photos, setPhotos] = useState<LocalAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  const station = params.stationId ? index?.stations.get(params.stationId) : undefined;
  const unit = params.unitId ? index?.units.get(params.unitId) : undefined;
  const method = unit ? index?.methods.get(unit.methodId) : undefined;
  const schedules = index?.pkg.schedules.filter((sc) => !station || sc.stationId === station.id) ?? [];
  const schedule = station ? schedules.find((sc) => sc.plannedDate === todayLima()) ?? schedules[0] : undefined;
  const logBrigades = index?.pkg.brigades.filter((b) => b.myRoles.includes('logistico')) ?? [];
  const [pickedBrigade, setPickedBrigade] = useState<string | null>(params.brigadeId ?? null);
  const brigade = logistics
    ? index?.brigades.get(pickedBrigade ?? '') ?? (logBrigades.length === 1 ? logBrigades[0] : undefined)
    : schedule ? index?.brigades.get(schedule.brigadeId) : index?.pkg.brigades[0];
  const projectId = station?.projectId ?? brigade?.projectId ?? null;
  // Id de la unidad en el servidor (una unidad creada en campo solo lo tiene después de sincronizarse).
  const serverUnitId = unit ? (index?.pkg.units.some((u) => u.id === unit.id) ? unit.id : field.byUnit.get(unit.id)?.unitId ?? null) : null;

  const loadPhotos = useCallback(async () => setPhotos(await field.attachmentsOf(clientId)), [clientId, field.attachmentsOf]);
  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos, field.rev]);

  if (!index) return null;
  if (logistics && !brigade && logBrigades.length > 1) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Incidencia logística' }} />
        <Text style={s.label}>¿De qué brigada es la incidencia?</Text>
        <View style={s.chips}>
          {logBrigades.map((b) => <Chip key={b.id} on={false} onPress={() => setPickedBrigade(b.id)}>{b.name}</Chip>)}
        </View>
      </View>
    );
  }
  if (!projectId) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Registrar alerta' }} />
        <Text style={s.muted}>No tienes una brigada asignada en tu paquete de trabajo. Comunícate por teléfono con coordinación.</Text>
      </View>
    );
  }

  const p = pos.status === 'ok' ? pos.position : null;
  const valid = !!type && description.trim().length >= 3;

  /** Guarda en el teléfono (se envía sola con conexión). */
  const save = async () => {
    if (!type) {
      Alert.alert('Falta el tipo', 'Elige el tipo de alerta.');
      return false;
    }
    if (description.trim().length < 3) {
      Alert.alert('Falta el detalle', 'Describe brevemente la situación.');
      return false;
    }
    await field.saveIncident({
      clientId, projectId, brigadeId: brigade?.id ?? null, stationId: station?.id ?? null, methodId: method?.id ?? null,
      unitId: serverUnitId, unitCode: unit?.code ?? null, scheduleId: schedule?.id ?? null,
      type, moment: logistics ? null : moment, launchedFrom: from, description: description.trim(), proposedAction: proposed.trim() || null,
      unitNotDone: notDone && !!unit, occurredAt, lat: p?.lat ?? null, lng: p?.lng ?? null,
    });
    return true;
  };

  const addPhoto = async () => {
    if (!(await save())) return;
    router.push({ pathname: '/camara', params: { exec: clientId, owner: 'incident', kind: 'foto', label: 'Evidencia' } });
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (!(await save())) return;
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const where = [station?.code, unit?.code ?? method?.code, brigade?.name].filter(Boolean).join(' · ');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: logistics ? 'Incidencia logística' : 'Registrar alerta' }} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.small}>Se registra automáticamente</Text>
          <Text style={s.auto}>{where || 'Sin estación'}</Text>
          <Text style={s.small}>
            {new Date(occurredAt).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })}
            {p ? ` · GPS ±${Math.round(p.accuracy ?? 0)} m` : ''}
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Tipo de alerta *</Text>
          <View style={s.chips}>
            {(logistics ? LOGISTICS_INCIDENT_TYPES : SPECIALIST_INCIDENT_TYPES).map((t) => (
              <Chip key={t} on={type === t} onPress={() => setType(t)}>{INCIDENT_TYPE_LABELS[t]}</Chip>
            ))}
          </View>

          {!logistics && (
            <>
              <Text style={s.label}>Momento</Text>
              <View style={s.chips}>
                {INCIDENT_MOMENTS.map((m) => (
                  <Chip key={m} on={moment === m} onPress={() => setMoment(m)}>{INCIDENT_MOMENT_LABELS[m]}</Chip>
                ))}
              </View>
            </>
          )}

          <Text style={s.label}>Detalle de la situación *</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder={logistics ? 'Ej.: La camioneta se quedó sin frenos en la trocha a Huancapallac.' : 'Ej.: Lluvia intensa desde las 7:00, no se puede completar el punto de conteo.'}
            placeholderTextColor={colors.text2}
            style={[s.input, s.textarea]}
            accessibilityLabel="Detalle de la situación"
          />

          <Text style={s.label}>Acción propuesta</Text>
          <View style={s.chips}>
            {(logistics ? LOGISTICS_ACTIONS : QUICK_ACTIONS).map((a) => (
              <Chip key={a} on={proposed === a} onPress={() => setProposed(proposed === a ? '' : a)}>{a}</Chip>
            ))}
          </View>
          <TextInput
            value={proposed}
            onChangeText={setProposed}
            placeholder="O escribe otra acción"
            placeholderTextColor={colors.text2}
            style={s.input}
            accessibilityLabel="Acción propuesta"
          />

          {unit && (
            <Pressable onPress={() => setNotDone(!notDone)} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: notDone }}>
              <View style={[s.box, notDone && s.boxOn]}>{notDone && <Text style={s.tick}>✓</Text>}</View>
              <Text style={s.checkText}>No se pudo realizar la unidad {unit.code}</Text>
            </Pressable>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.label}>Evidencia</Text>
          <View style={s.photos}>
            {photos.map((ph) => <Image key={ph.clientId} source={{ uri: ph.path }} style={s.thumb} contentFit="cover" />)}
            <Pressable onPress={() => void addPhoto()} style={[s.thumb, s.addPhoto]} accessibilityRole="button" accessibilityLabel="Agregar foto de evidencia">
              <Text style={s.plus}>+</Text>
              <Text style={s.small}>Foto</Text>
            </Pressable>
          </View>
        </View>

        <Pressable onPress={() => void submit()} disabled={saving} style={({ pressed }) => [s.primary, (!valid || pressed || saving) && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={s.primaryText}>{logistics ? 'Enviar incidencia' : 'Enviar alerta'}</Text>
        </Pressable>
        <Text style={[s.small, { textAlign: 'center' }]}>Sin señal se guarda en el teléfono y se envía sola al tener conexión.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Chip({ on, onPress, children }: { on: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{children}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  muted: { color: colors.text2, lineHeight: 20 },
  small: { color: colors.text2, fontSize: 12 },
  auto: { color: colors.text, fontWeight: '700', fontSize: 16 },
  label: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  textarea: { minHeight: 96, textAlignVertical: 'top' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  tick: { color: colors.white, fontWeight: '900' },
  checkText: { color: colors.text, fontWeight: '600', flex: 1 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: '#EEF1EC' },
  addPhoto: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  plus: { fontSize: 26, color: colors.danger, fontWeight: '300' },
  primary: { backgroundColor: colors.danger, borderRadius: radius, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: colors.white, fontWeight: '800', fontSize: 16 },
});
