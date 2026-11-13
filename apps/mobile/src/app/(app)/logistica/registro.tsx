import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import {
  EPP_ITEMS, EQUIPMENT_STATUSES, EQUIPMENT_STATUS_LABELS, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, LOGISTICS_ENTITIES,
  LOGISTICS_ENTITY_LABELS, LOGISTICS_SCHEMAS, SAMPLE_STATUSES, SAMPLE_STATUS_LABELS, SUPPORT_DOCUMENTS, VEHICLE_MATERIALS,
  VEHICLE_STATUSES, VEHICLE_STATUS_LABELS,
  type IncidentType, type LogisticsEntity,
} from '@toce/shared';
import { useField, type LocalAttachment, type LogisticsInput } from '../../../lib/field';
import { todayLima, usePackageIndex } from '../../../lib/workPackage';
import { Card, Check, Chip, Choice, Field, Label, Photos, PrimaryButton, Tags, formStyles as fs } from '../../../components/form';
import { Button } from '../../../components/ui';
import { colors } from '../../../theme';

type Draft = Record<string, unknown>;

const DEFAULTS: Record<LogisticsEntity, () => Draft> = {
  vehicle: () => ({ description: '', plate: '', driverName: '', driverPhone: '', status: 'programada', arrivedAt: null, missingMaterials: [], defectiveMaterials: [], notes: '' }),
  support: () => ({ fullName: '', dni: '', phone: '', community: '', eppItems: [], documentsDelivered: [], availableFrom: '', availableTo: '', isAvailable: true, notes: '' }),
  expense: () => ({ category: null, description: '', amount: '', currency: 'PEN', expenseDate: todayLima(), receiptNumber: '', vendor: '' }),
  sample: () => ({ code: '', description: '', quantity: '1', stationId: null, status: 'recolectada', shippedAt: null, carrier: '', trackingCode: '', destination: '', notes: '' }),
  equipment: () => ({ name: '', serial: '', quantity: '1', status: 'operativo', notes: '' }),
};

/** Texto del formulario → datos del registro (vacíos a null, números desde texto con coma o punto). */
function toPayload(entity: LogisticsEntity, d: Draft): Draft {
  const out: Draft = {};
  for (const [k, v] of Object.entries(d)) out[k] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
  if (entity === 'expense') out.amount = d.amount === '' ? NaN : Number(String(d.amount).replace(',', '.'));
  if (entity === 'sample' || entity === 'equipment') out.quantity = Number.parseInt(String(d.quantity || '1'), 10);
  if (entity === 'expense') out.currency = 'PEN';
  return out;
}

/** Alta o edición de un registro logístico. Se guarda en el teléfono y se envía solo. */
export default function LogisticsRecordScreen() {
  const params = useLocalSearchParams<{ entity: LogisticsEntity; id?: string; brigadeId?: string }>();
  const entity = params.entity;
  const field = useField();
  const index = usePackageIndex();
  const existing = params.id ? field.logistics.find((r) => r.clientId === params.id) : undefined;
  const brigades = useMemo(() => index?.pkg.brigades.filter((b) => b.myRoles.includes('logistico') || b.myRoles.includes('supervisor')) ?? [], [index]);
  const [clientId] = useState(() => params.id ?? Crypto.randomUUID());
  const [brigadeId, setBrigadeId] = useState<string | null>(existing?.brigadeId ?? params.brigadeId ?? (brigades.length === 1 ? brigades[0]!.id : null));
  const [d, setD] = useState<Draft>(() => {
    if (existing) {
      const { clientId: _c, brigadeId: _b, clientUpdatedAt: _u, ...rest } = existing.data as Draft;
      const base = { ...DEFAULTS[entity](), ...rest };
      for (const k of Object.keys(base)) if (base[k] === null && typeof DEFAULTS[entity]()[k] === 'string') base[k] = '';
      if (entity === 'expense') base.amount = String(rest.amount ?? '');
      if (entity === 'sample' || entity === 'equipment') base.quantity = String(rest.quantity ?? 1);
      return base;
    }
    const base = DEFAULTS[entity]();
    // Código sugerido para muestras: correlativo de la brigada.
    if (entity === 'sample') base.code = `M-${String(field.logistics.filter((r) => r.entity === 'sample').length + 1).padStart(3, '0')}`;
    return base;
  });
  const [photos, setPhotos] = useState<LocalAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (v: unknown) => setD((p) => ({ ...p, [k]: v }));
  const str = (k: string) => (d[k] as string | null) ?? '';

  const loadPhotos = useCallback(async () => setPhotos(await field.attachmentsOf(clientId)), [clientId, field.attachmentsOf]);
  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos, field.rev]);

  const stations = useMemo(() => {
    if (!index || !brigadeId || entity !== 'sample') return [];
    const ids = [...new Set(index.pkg.schedules.filter((x) => x.brigadeId === brigadeId).map((x) => x.stationId))];
    return ids.map((id) => index.stations.get(id)).filter((x) => !!x);
  }, [index, brigadeId, entity]);

  if (!LOGISTICS_ENTITIES.includes(entity) || !index) return null;
  const label = LOGISTICS_ENTITY_LABELS[entity].one;

  /** Valida y guarda; devuelve false si falta algo. */
  const save = async (override?: Draft) => {
    const draft = { ...d, ...override };
    if (!brigadeId) {
      Alert.alert('Falta la brigada', 'Elige la brigada del registro.');
      return false;
    }
    const payload = { ...toPayload(entity, draft), clientId, brigadeId };
    const check = LOGISTICS_SCHEMAS[entity].safeParse({ ...payload, clientUpdatedAt: new Date().toISOString() });
    if (!check.success) {
      Alert.alert('Revisa el registro', check.error.issues[0]?.message ?? 'Hay datos incompletos.');
      return false;
    }
    if (override) setD(draft);
    await field.saveLogistics(entity, payload as unknown as LogisticsInput<typeof entity>);
    return true;
  };

  /** Problemas que deben llegar a coordinación como incidencia logística. */
  const incidentFor = (draft: Draft): { type: IncidentType; text: string } | null => {
    if (entity === 'vehicle' && draft.status === 'accidente') return { type: 'accidente_movilidad', text: `Accidente de la movilidad ${[draft.description, draft.plate].filter(Boolean).join(' ')}.` };
    if (entity === 'vehicle' && draft.status === 'averiada') return { type: 'desperfecto_mecanico', text: `Movilidad ${[draft.description, draft.plate].filter(Boolean).join(' ')} averiada.` };
    if (entity === 'equipment' && (draft.status === 'defectuoso' || draft.status === 'perdido')) {
      return { type: 'equipos', text: `Equipo ${draft.name}${draft.serial ? ` (serie ${draft.serial})` : ''} ${draft.status === 'perdido' ? 'perdido' : 'defectuoso'}.` };
    }
    return null;
  };

  const submit = async (override?: Draft) => {
    setSaving(true);
    try {
      if (!(await save(override))) return;
      const inc = incidentFor({ ...d, ...override });
      const wasSame = existing && incidentFor(existing.data as unknown as Draft)?.type === inc?.type;
      if (inc && !wasSame) {
        Alert.alert('¿Avisar a coordinación?', 'Registra la incidencia logística para que coordinación la vea como alerta.', [
          { text: 'Ahora no', style: 'cancel', onPress: () => router.back() },
          {
            text: 'Registrar incidencia',
            onPress: () => router.replace({ pathname: '/alerta/nueva', params: { mode: 'logistica', type: inc.type, brigadeId: brigadeId!, text: inc.text } }),
          },
        ]);
        return;
      }
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const addPhoto = async () => {
    if (!(await save())) return;
    router.push({
      pathname: '/camara',
      params: { exec: clientId, owner: 'logistics', kind: entity === 'expense' ? 'comprobante' : 'foto', label: entity === 'expense' ? 'Comprobante' : 'Evidencia' },
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? label : entity === 'expense' ? 'Registrar gasto' : `Nuevo: ${label.toLowerCase()}` }} />
      <ScrollView contentContainerStyle={fs.wrap} keyboardShouldPersistTaps="handled">
        {brigades.length > 1 && (
          <Card>
            <Label>Brigada *</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {brigades.map((b) => <Chip key={b.id} on={brigadeId === b.id} onPress={() => setBrigadeId(b.id)}>{b.name}</Chip>)}
            </View>
          </Card>
        )}

        {entity === 'vehicle' && (
          <>
            <Card>
              <Label>Movilidad *</Label>
              <Field value={str('description')} onChangeText={set('description')} placeholder="Ej.: Camioneta 4x4 Hilux" accessibilityLabel="Movilidad" />
              <Label>Placa</Label>
              <Field value={str('plate')} onChangeText={(v) => set('plate')(v.toUpperCase())} placeholder="ABC-123" autoCapitalize="characters" accessibilityLabel="Placa" />
              <Label>Conductor</Label>
              <Field value={str('driverName')} onChangeText={set('driverName')} placeholder="Nombre" accessibilityLabel="Conductor" />
              <Field value={str('driverPhone')} onChangeText={set('driverPhone')} placeholder="Celular" keyboardType="phone-pad" accessibilityLabel="Celular del conductor" />
            </Card>
            <Card>
              <Label>Estado</Label>
              <Choice options={VEHICLE_STATUSES} labels={VEHICLE_STATUS_LABELS} value={d.status as never} onChange={(v) => set('status')(v ?? 'programada')} />
              {d.status !== 'llegada' && d.status !== 'finalizada' && (
                <Button title="Confirmar llegada" variant="outline" onPress={() => void submit({ status: 'llegada', arrivedAt: new Date().toISOString() })} />
              )}
              {!!d.arrivedAt && (
                <Text style={fs.small}>Llegó: {new Date(d.arrivedAt as string).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })}</Text>
              )}
            </Card>
            <Card>
              <Label hint="Lo que debía llevar y no llegó.">Materiales faltantes</Label>
              <Tags value={d.missingMaterials as string[]} onChange={set('missingMaterials')} suggestions={VEHICLE_MATERIALS} placeholder="Otro material" />
              <Label>Materiales defectuosos</Label>
              <Tags value={d.defectiveMaterials as string[]} onChange={set('defectiveMaterials')} suggestions={VEHICLE_MATERIALS} placeholder="Otro material" />
              <Label>Observaciones</Label>
              <Field value={str('notes')} onChangeText={set('notes')} multiline placeholder="Estado de la vía, combustible, etc." accessibilityLabel="Observaciones" />
            </Card>
          </>
        )}

        {entity === 'support' && (
          <>
            <Card>
              <Label>Nombre completo *</Label>
              <Field value={str('fullName')} onChangeText={set('fullName')} placeholder="Nombres y apellidos" accessibilityLabel="Nombre completo" />
              <Label>DNI</Label>
              <Field value={str('dni')} onChangeText={(v) => set('dni')(v.replace(/\D/g, '').slice(0, 8))} placeholder="8 dígitos" keyboardType="number-pad" accessibilityLabel="DNI" />
              <Label>Celular</Label>
              <Field value={str('phone')} onChangeText={set('phone')} keyboardType="phone-pad" accessibilityLabel="Celular" />
              <Label>Comunidad</Label>
              <Field value={str('community')} onChangeText={set('community')} placeholder="Ej.: CC Huancapallac" accessibilityLabel="Comunidad" />
              <Check on={!!d.isAvailable} onPress={() => set('isAvailable')(!d.isAvailable)}>Disponible para la brigada</Check>
              <Label hint="AAAA-MM-DD (opcional)">Disponible desde / hasta</Label>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Field value={str('availableFrom')} onChangeText={set('availableFrom')} placeholder="Desde" style={{ flex: 1 }} accessibilityLabel="Disponible desde" />
                <Field value={str('availableTo')} onChangeText={set('availableTo')} placeholder="Hasta" style={{ flex: 1 }} accessibilityLabel="Disponible hasta" />
              </View>
            </Card>
            <Card>
              <Label>EPP entregado</Label>
              <Tags value={d.eppItems as string[]} onChange={set('eppItems')} suggestions={EPP_ITEMS} placeholder="Otro EPP" />
              <Label>Documentación entregada</Label>
              <Tags value={d.documentsDelivered as string[]} onChange={set('documentsDelivered')} suggestions={SUPPORT_DOCUMENTS} placeholder="Otro documento" />
              <Label>Observaciones</Label>
              <Field value={str('notes')} onChangeText={set('notes')} multiline accessibilityLabel="Observaciones" />
            </Card>
          </>
        )}

        {entity === 'expense' && (
          <Card>
            <Label>Tipo de gasto *</Label>
            <Choice options={EXPENSE_CATEGORIES} labels={EXPENSE_CATEGORY_LABELS} value={d.category as never} onChange={set('category')} />
            <Label>Detalle *</Label>
            <Field value={str('description')} onChangeText={set('description')} placeholder="Ej.: Gasolina 10 galones" accessibilityLabel="Detalle del gasto" />
            <Label>Monto (S/) *</Label>
            <Field value={str('amount')} onChangeText={(v) => set('amount')(v.replace(/[^\d.,]/g, ''))} placeholder="0.00" keyboardType="decimal-pad" accessibilityLabel="Monto en soles" />
            <Label>Fecha</Label>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Chip on={d.expenseDate === todayLima()} onPress={() => set('expenseDate')(todayLima())}>Hoy</Chip>
              <Chip on={d.expenseDate === yesterday()} onPress={() => set('expenseDate')(yesterday())}>Ayer</Chip>
              <Field value={str('expenseDate')} onChangeText={set('expenseDate')} placeholder="AAAA-MM-DD" style={{ flex: 1 }} accessibilityLabel="Fecha del gasto" />
            </View>
            <Label>N.º de comprobante</Label>
            <Field value={str('receiptNumber')} onChangeText={set('receiptNumber')} placeholder="Ej.: B001-000123" autoCapitalize="characters" accessibilityLabel="Número de comprobante" />
            <Label>Proveedor</Label>
            <Field value={str('vendor')} onChangeText={set('vendor')} placeholder="Grifo, hospedaje, tienda…" accessibilityLabel="Proveedor" />
          </Card>
        )}

        {entity === 'sample' && (
          <>
            <Card>
              <Label>Código *</Label>
              <Field value={str('code')} onChangeText={set('code')} autoCapitalize="characters" accessibilityLabel="Código de la muestra" />
              <Label>Descripción</Label>
              <Field value={str('description')} onChangeText={set('description')} placeholder="Ej.: Ejemplares de herbario" accessibilityLabel="Descripción" />
              <Label>Cantidad</Label>
              <Field value={str('quantity')} onChangeText={(v) => set('quantity')(v.replace(/\D/g, ''))} keyboardType="number-pad" accessibilityLabel="Cantidad" />
              {stations.length > 0 && (
                <>
                  <Label>Estación</Label>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {stations.map((st) => <Chip key={st.id} on={d.stationId === st.id} onPress={() => set('stationId')(d.stationId === st.id ? null : st.id)}>{st.code}</Chip>)}
                  </View>
                </>
              )}
            </Card>
            <Card>
              <Label>Estado</Label>
              <Choice options={SAMPLE_STATUSES} labels={SAMPLE_STATUS_LABELS} value={d.status as never} onChange={(v) => set('status')(v ?? 'recolectada')} />
              <Label>Envío</Label>
              <Field value={str('destination')} onChangeText={set('destination')} placeholder="Destino (laboratorio, ciudad)" accessibilityLabel="Destino" />
              <Field value={str('carrier')} onChangeText={set('carrier')} placeholder="Empresa de transporte" accessibilityLabel="Empresa de transporte" />
              <Field value={str('trackingCode')} onChangeText={set('trackingCode')} placeholder="N.º de guía" accessibilityLabel="Número de guía" />
              {d.status !== 'enviada' && d.status !== 'recibida' && (
                <Button title="Confirmar envío" variant="outline" onPress={() => void submit({ status: 'enviada', shippedAt: new Date().toISOString() })} />
              )}
              {!!d.shippedAt && (
                <Text style={fs.small}>Enviada: {new Date(d.shippedAt as string).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })}</Text>
              )}
              <Label>Observaciones</Label>
              <Field value={str('notes')} onChangeText={set('notes')} multiline accessibilityLabel="Observaciones" />
            </Card>
          </>
        )}

        {entity === 'equipment' && (
          <Card>
            <Label>Equipo *</Label>
            <Field value={str('name')} onChangeText={set('name')} placeholder="Ej.: GPS Garmin 64s" accessibilityLabel="Equipo" />
            <Label>N.º de serie</Label>
            <Field value={str('serial')} onChangeText={set('serial')} autoCapitalize="characters" accessibilityLabel="Número de serie" />
            <Label>Cantidad</Label>
            <Field value={str('quantity')} onChangeText={(v) => set('quantity')(v.replace(/\D/g, ''))} keyboardType="number-pad" accessibilityLabel="Cantidad" />
            <Label>Estado</Label>
            <Choice options={EQUIPMENT_STATUSES} labels={EQUIPMENT_STATUS_LABELS} value={d.status as never} onChange={(v) => set('status')(v ?? 'operativo')} />
            <Label>Observaciones</Label>
            <Field value={str('notes')} onChangeText={set('notes')} multiline placeholder="Qué falla, desde cuándo…" accessibilityLabel="Observaciones" />
          </Card>
        )}

        <Card>
          <Label hint={entity === 'expense' ? 'Foto legible del comprobante o boleta.' : 'Fotos de evidencia (opcional).'}>
            {entity === 'expense' ? 'Comprobante' : 'Fotos'}
          </Label>
          <Photos photos={photos} onAdd={() => void addPhoto()} remote={existing?.remoteFiles ?? 0} addLabel={entity === 'expense' ? 'Comprobante' : 'Foto'} />
        </Card>

        <PrimaryButton title={saving ? 'Guardando…' : 'Guardar'} onPress={() => void submit()} disabled={saving} />
        {!!existing?.syncError && <Text style={[fs.small, { color: colors.danger, textAlign: 'center' }]}>No se pudo enviar: {existing.syncError}</Text>}
        <Text style={[fs.small, { textAlign: 'center' }]}>Sin señal se guarda en el teléfono y se envía solo al tener conexión.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function yesterday() {
  const [y, m, d] = todayLima().split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}
