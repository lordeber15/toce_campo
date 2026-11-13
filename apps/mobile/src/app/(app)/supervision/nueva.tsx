import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import {
  INCIDENT_MOMENT_LABELS, INCIDENT_MOMENTS, INCIDENT_TYPE_LABELS, SUPERVISOR_INCIDENT_TYPES, type IncidentMoment, type IncidentType,
} from '@toce/shared';
import { useField, type LocalAttachment } from '../../../lib/field';
import { usePosition } from '../../../lib/location';
import { todayLima, usePackageIndex } from '../../../lib/workPackage';
import { Card, Check, Chip, Choice, Field, Label, Photos, PrimaryButton, formStyles as fs } from '../../../components/form';
import { colors } from '../../../theme';

/**
 * Incidencia de supervisión: qué se observó, la desviación metodológica, la acción correctiva aplicada
 * y cómo se resolvió. Se guarda en el teléfono y se envía sola; con ?id= se edita (p. ej. para
 * registrar la solución después).
 */
export default function SupervisionIncidentScreen() {
  const params = useLocalSearchParams<{ id?: string; stationId?: string; unitId?: string }>();
  const index = usePackageIndex();
  const field = useField();
  const pos = usePosition();
  const existing = params.id ? field.incidents.find((i) => i.clientId === params.id) : undefined;
  const [clientId] = useState(() => params.id ?? Crypto.randomUUID());
  const [occurredAt] = useState(() => existing?.occurredAt ?? new Date().toISOString());

  const brigades = useMemo(() => index?.pkg.brigades.filter((b) => b.myRoles.includes('supervisor')) ?? [], [index]);
  const initialStation = existing?.stationId ?? params.stationId ?? null;
  const initialBrigade = existing?.brigadeId
    ?? (initialStation ? index?.pkg.schedules.find((sc) => sc.stationId === initialStation && brigades.some((b) => b.id === sc.brigadeId))?.brigadeId : null)
    ?? brigades[0]?.id ?? null;
  const unit = params.unitId ? index?.units.get(params.unitId) : undefined;

  const [brigadeId, setBrigadeId] = useState<string | null>(initialBrigade);
  const [stationId, setStationId] = useState<string | null>(initialStation);
  const [methodId, setMethodId] = useState<string | null>(existing?.methodId ?? unit?.methodId ?? null);
  const [type, setType] = useState<IncidentType | null>(existing?.type ?? null);
  const [moment, setMoment] = useState<IncidentMoment | null>(existing?.moment ?? 'durante');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [deviation, setDeviation] = useState(existing?.methodologicalDeviation ?? '');
  const [corrective, setCorrective] = useState(existing?.correctiveAction ?? '');
  const [resolved, setResolved] = useState(!!existing?.resolutionNotes);
  const [resolution, setResolution] = useState(existing?.resolutionNotes ?? '');
  const [photos, setPhotos] = useState<LocalAttachment[]>([]);
  const [saving, setSaving] = useState(false);

  const loadPhotos = useCallback(async () => setPhotos(await field.attachmentsOf(clientId)), [clientId, field.attachmentsOf]);
  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos, field.rev]);

  // Estaciones programadas para la brigada (hoy primero).
  const stations = useMemo(() => {
    if (!index || !brigadeId) return [];
    const today = todayLima();
    const sc = index.pkg.schedules.filter((x) => x.brigadeId === brigadeId)
      .sort((a, b) => Number(b.plannedDate === today) - Number(a.plannedDate === today) || a.plannedDate.localeCompare(b.plannedDate));
    return [...new Map(sc.map((x) => [x.stationId, index.stations.get(x.stationId)])).values()].filter((x) => !!x);
  }, [index, brigadeId]);
  const methods = stationId && index ? index.methodsAt(stationId).map((m) => m.method) : [];

  if (!index) return null;
  if (!brigades.length) {
    return (
      <View style={[fs.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Registrar incidencia' }} />
        <Text style={fs.muted}>No figuras como supervisor de una brigada en tu paquete de trabajo.</Text>
      </View>
    );
  }
  const r = existing?.remote;
  const locked = !!r && !(r.status === 'abierta' || r.status === 'en_revision' || (r.status === 'resuelta' && !r.coordinationDecision));

  const brigade = brigadeId ? index.brigades.get(brigadeId) : undefined;
  const schedule = stationId ? index.pkg.schedules.find((x) => x.stationId === stationId && x.brigadeId === brigadeId && x.plannedDate === todayLima())
    ?? index.pkg.schedules.find((x) => x.stationId === stationId && x.brigadeId === brigadeId) : undefined;
  const p = pos.status === 'ok' ? pos.position : null;

  const save = async () => {
    if (!type) return Alert.alert('Falta el tipo', 'Elige el tipo de incidencia.'), false;
    if (description.trim().length < 3) return Alert.alert('Falta el detalle', 'Describe qué se observó.'), false;
    if (resolved && resolution.trim().length < 3) return Alert.alert('Falta la solución', 'Escribe cómo se resolvió o desmarca "Ya se resolvió".'), false;
    await field.saveIncident({
      clientId, projectId: brigade?.projectId ?? null, brigadeId, stationId, methodId, unitId: existing?.unitId ?? (unit && index.pkg.units.some((u) => u.id === unit.id) ? unit.id : null),
      unitCode: existing?.unitCode ?? unit?.code ?? null, scheduleId: schedule?.id ?? null, type, moment, launchedFrom: 'supervision',
      description: description.trim(), proposedAction: null, unitNotDone: false, occurredAt,
      lat: existing?.lat ?? p?.lat ?? null, lng: existing?.lng ?? p?.lng ?? null,
      methodologicalDeviation: deviation.trim() || null, correctiveAction: corrective.trim() || null,
      resolutionNotes: resolved ? resolution.trim() : null,
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
      if (await save()) router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? 'Incidencia de supervisión' : 'Registrar incidencia' }} />
      <ScrollView contentContainerStyle={fs.wrap} keyboardShouldPersistTaps="handled">
        {locked && (
          <Card>
            <Text style={fs.muted}>Coordinación ya respondió esta incidencia; no se puede modificar. Puedes escribir en la conversación.</Text>
          </Card>
        )}
        <Card>
          <Text style={fs.small}>Se registra automáticamente</Text>
          <Text style={fs.small}>
            {new Date(occurredAt).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })}
            {p ? ` · GPS ±${Math.round(p.accuracy ?? 0)} m` : ''}
          </Text>
          {brigades.length > 1 && (
            <>
              <Label>Brigada</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {brigades.map((b) => (
                  <Chip key={b.id} on={brigadeId === b.id} onPress={() => { setBrigadeId(b.id); setStationId(null); setMethodId(null); }}>{b.name}</Chip>
                ))}
              </View>
            </>
          )}
          <Label hint="Opcional: déjalo en General si no es de una estación.">Estación</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip on={!stationId} onPress={() => { setStationId(null); setMethodId(null); }}>General</Chip>
            {stations.map((st) => (
              <Chip key={st.id} on={stationId === st.id} onPress={() => { setStationId(st.id); setMethodId(null); }}>{st.code}</Chip>
            ))}
          </View>
          {methods.length > 0 && (
            <>
              <Label>Método</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {methods.map((m) => <Chip key={m.id} on={methodId === m.id} onPress={() => setMethodId(methodId === m.id ? null : m.id)}>{m.code}</Chip>)}
              </View>
            </>
          )}
        </Card>

        <Card>
          <Label>Tipo de incidencia *</Label>
          <Choice options={SUPERVISOR_INCIDENT_TYPES} labels={INCIDENT_TYPE_LABELS} value={type} onChange={setType} tone="danger" />
          <Label>Momento</Label>
          <Choice options={INCIDENT_MOMENTS} labels={INCIDENT_MOMENT_LABELS} value={moment} onChange={setMoment} allowNone />
          <Label>¿Qué se observó? *</Label>
          <Field value={description} onChangeText={setDescription} multiline editable={!locked}
            placeholder="Ej.: Las trampas Sherman se colocaron a 5 m en lugar de 10 m." accessibilityLabel="Qué se observó" />
          <Label hint="Qué se hizo distinto al protocolo del método.">Desviación metodológica</Label>
          <Field value={deviation} onChangeText={setDeviation} multiline editable={!locked}
            placeholder="Ej.: Distancia entre trampas menor a la establecida." accessibilityLabel="Desviación metodológica" />
          <Label>Acción correctiva aplicada</Label>
          <Field value={corrective} onChangeText={setCorrective} multiline editable={!locked}
            placeholder="Ej.: Se reubicaron las trampas y se reinició el transecto." accessibilityLabel="Acción correctiva" />
          <Check on={resolved} onPress={() => !locked && setResolved(!resolved)}>Ya se resolvió en campo</Check>
          {resolved && (
            <>
              <Label>¿Cómo se resolvió? *</Label>
              <Field value={resolution} onChangeText={setResolution} multiline editable={!locked}
                placeholder="Ej.: Se corrigió con el especialista; las unidades se repitieron." accessibilityLabel="Cómo se resolvió" />
            </>
          )}
        </Card>

        <Card>
          <Label>Evidencias</Label>
          <Photos photos={photos} onAdd={() => void addPhoto()} disabled={locked} />
        </Card>

        {!locked && <PrimaryButton title={saving ? 'Guardando…' : 'Guardar incidencia'} onPress={() => void submit()} disabled={saving} />}
        <Text style={[fs.small, { textAlign: 'center' }]}>
          Sin señal se guarda en el teléfono y se envía sola. Si marcas «Ya se resolvió», llega a coordinación como resuelta en campo.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
