import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { formatUtm, latLngToUtm, type FieldRecord, type FormField, type WpSpecies } from '@toce/shared';
import { useField } from '../../lib/field';
import { usePosition } from '../../lib/location';
import { todayLima, usePackageIndex } from '../../lib/workPackage';
import { colors, radius } from '../../theme';

type Values = Record<string, unknown>;
type Coords = { lat: number; lng: number; accuracy: number | null; utm: string };

/** Formulario reducido de un registro (p. ej. una especie observada). Al guardar vuelve a la unidad. */
export default function RecordScreen() {
  const { exec, record } = useLocalSearchParams<{ exec: string; record?: string }>();
  const field = useField();
  const index = usePackageIndex();
  const pos = usePosition();
  const execution = field.executions.find((e) => e.clientId === exec);
  const method = execution ? index?.methods.get(execution.methodId) : undefined;
  const existing = record ? execution?.formData.records.find((r) => r.id === record) : undefined;
  const fields = method?.formSchema.fields ?? [];

  const [values, setValues] = useState<Values>(() => {
    const v: Values = { ...(existing?.values ?? {}) };
    for (const f of fields) if (f.type === 'date' && v[f.key] == null) v[f.key] = todayLima();
    return v;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  if (!execution || !method) {
    return (
      <View style={[s.wrap, { flex: 1, backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ title: 'Registro' }} />
        <Text style={s.muted}>No se encontró la unidad de este registro.</Text>
      </View>
    );
  }

  const n = existing ? execution.formData.records.indexOf(existing) + 1 : execution.formData.records.length + 1;
  const species = index?.pkg.species.filter((sp) => sp.specialtyCode === method.specialtyCode) ?? [];

  const save = async () => {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.required && (v == null || v === '')) errs[f.key] = 'Obligatorio';
      if (f.type === 'number' && v != null && v !== '' && !Number.isFinite(v)) errs[f.key] = 'Número inválido';
    }
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      Alert.alert('Revisa el formulario', `Falta completar: ${fields.filter((f) => errs[f.key]).map((f) => f.label).join(', ')}.`);
      return;
    }
    setSaving(true);
    const now = new Date().toISOString();
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v != null && v !== ''));
    const rec: FieldRecord = existing
      ? { ...existing, values: clean, updatedAt: now }
      : { id: Crypto.randomUUID(), values: clean, createdAt: now };
    const records = existing
      ? execution.formData.records.map((r) => (r.id === existing.id ? rec : r))
      : [...execution.formData.records, rec];
    await field.update(execution.clientId, { formData: { records } });
    router.back();
  };

  const remove = () =>
    Alert.alert('Eliminar registro', `¿Eliminar el registro ${n}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          await field.update(execution.clientId, { formData: { records: execution.formData.records.filter((r) => r.id !== existing!.id) } });
          router.back();
        },
      },
    ]);

  const closed = execution.status === 'completada' || execution.status === 'no_realizada';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: `${execution.unitCode} · Registro ${n}` }} />
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          {fields.map((f, i) => (
            <FieldInput
              key={f.key}
              n={i + 1}
              field={f}
              value={values[f.key]}
              error={errors[f.key]}
              species={species}
              position={pos.status === 'ok' ? pos.position : null}
              disabled={closed}
              onChange={(v) => set(f.key, v)}
              onChangeExtra={(k, v) => set(k, v)}
            />
          ))}
          {!fields.length && <Text style={s.muted}>Este método no tiene formulario configurado. Usa observaciones o notas de voz.</Text>}
        </View>

        {!closed && (
          <Pressable onPress={() => void save()} disabled={saving} style={({ pressed }) => [s.primary, (pressed || saving) && s.pressed]} accessibilityRole="button">
            <Text style={s.primaryText}>Guardar registro</Text>
          </Pressable>
        )}
        {existing && !closed && (
          <Pressable onPress={remove} style={s.danger} accessibilityRole="button">
            <Text style={s.dangerText}>Eliminar registro</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FieldInput({ n, field: f, value, error, species, position, disabled, onChange, onChangeExtra }: {
  n: number; field: FormField; value: unknown; error?: string; species: WpSpecies[];
  position: { lat: number; lng: number; accuracy: number | null } | null; disabled: boolean;
  onChange: (v: unknown) => void; onChangeExtra: (key: string, v: unknown) => void;
}) {
  const label = (
    <Text style={s.label}>
      <Text style={s.num}>{n}  </Text>{f.label}{f.required ? <Text style={{ color: colors.danger }}> *</Text> : null}
    </Text>
  );
  let input: React.ReactNode;
  switch (f.type) {
    case 'select':
      input = (
        <View style={s.chips}>
          {(f.options ?? []).map((o) => {
            const on = value === o;
            return (
              <Pressable
                key={o}
                onPress={() => onChange(on ? null : o)}
                disabled={disabled}
                style={[s.chip, on && s.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{o}</Text>
              </Pressable>
            );
          })}
        </View>
      );
      break;
    case 'species':
      input = <SpeciesInput value={typeof value === 'string' ? value : ''} species={species} disabled={disabled} onChange={(name, id) => { onChange(name); onChangeExtra(`${f.key}_id`, id); }} />;
      break;
    case 'coords': {
      const c = value as Coords | undefined;
      input = (
        <View style={{ gap: 8 }}>
          {c && <Text style={s.value}>{c.utm}{c.accuracy != null ? ` ±${Math.round(c.accuracy)} m` : ''}</Text>}
          <Pressable
            disabled={disabled || !position}
            onPress={() => position && onChange({ lat: position.lat, lng: position.lng, accuracy: position.accuracy, utm: formatUtm(latLngToUtm(position.lat, position.lng)) })}
            style={[s.smallBtn, (!position || disabled) && s.pressed]}
            accessibilityRole="button"
          >
            <Text style={s.smallBtnText}>{position ? (c ? 'Actualizar con mi ubicación' : 'Usar mi ubicación') : 'Buscando GPS…'}</Text>
          </Pressable>
        </View>
      );
      break;
    }
    case 'number':
      input = (
        <TextInput
          value={value == null ? '' : String(value)}
          onChangeText={(t) => {
            const v = t.replace(',', '.').trim();
            onChange(v === '' ? null : Number.isNaN(Number(v)) ? v : Number(v));
          }}
          editable={!disabled}
          keyboardType="decimal-pad"
          style={[s.input, error ? s.inputErr : null]}
          accessibilityLabel={f.label}
        />
      );
      break;
    default:
      input = (
        <TextInput
          value={value == null ? '' : String(value)}
          onChangeText={(t) => onChange(t)}
          editable={!disabled && !f.auto}
          multiline={f.type === 'textarea'}
          placeholder={f.type === 'date' ? 'AAAA-MM-DD' : undefined}
          placeholderTextColor={colors.text2}
          style={[s.input, f.type === 'textarea' && s.textarea, f.auto && s.inputAuto, error ? s.inputErr : null]}
          accessibilityLabel={f.label}
        />
      );
  }
  return (
    <View style={s.field}>
      {label}
      {input}
      {f.auto && <Text style={s.hint}>Automático</Text>}
      {!!error && <Text style={s.err}>{error}</Text>}
    </View>
  );
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Especie: busca en el catálogo de la especialidad; si no está, se guarda el texto escrito. */
function SpeciesInput({ value, species, disabled, onChange }: {
  value: string; species: WpSpecies[]; disabled: boolean; onChange: (name: string | null, id: string | null) => void;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = norm(q.trim());
    if (t.length < 2) return [];
    return species.filter((sp) => norm(sp.scientificName).includes(t) || (sp.commonName && norm(sp.commonName).includes(t))).slice(0, 12);
  }, [q, species]);

  return (
    <View style={{ gap: 6 }}>
      <TextInput
        value={q}
        onChangeText={(t) => { setQ(t); setOpen(true); onChange(t.trim() || null, null); }}
        onFocus={() => setOpen(true)}
        editable={!disabled}
        placeholder={species.length ? 'Escribe nombre científico o común' : 'Escribe el nombre de la especie'}
        placeholderTextColor={colors.text2}
        autoCorrect={false}
        style={s.input}
        accessibilityLabel="Especie"
      />
      {open && matches.length > 0 && (
        <View style={s.suggest}>
          {matches.map((sp) => (
            <Pressable
              key={sp.id}
              onPress={() => { setQ(sp.scientificName); setOpen(false); onChange(sp.scientificName, sp.id); }}
              style={({ pressed }) => [s.suggestItem, pressed && { backgroundColor: colors.primarySoft }]}
              accessibilityRole="button"
            >
              <Text style={s.sci}>{sp.scientificName}</Text>
              {!!(sp.commonName || sp.family) && <Text style={s.hint}>{[sp.commonName, sp.family].filter(Boolean).join(' · ')}</Text>}
            </Pressable>
          ))}
        </View>
      )}
      {!species.length && <Text style={s.hint}>El catálogo de especies aún no está cargado: se guarda lo que escribas.</Text>}
      {species.length > 0 && q.trim().length >= 2 && !matches.length && <Text style={s.hint}>No está en el catálogo: se guardará como lo escribiste.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 18 },
  muted: { color: colors.text2, lineHeight: 20 },
  field: { gap: 8 },
  label: { color: colors.text, fontWeight: '600', fontSize: 15 },
  num: { color: colors.text2, fontWeight: '700', fontVariant: ['tabular-nums'] },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  inputAuto: { backgroundColor: '#F2F4F1', color: colors.text2 },
  inputErr: { borderColor: colors.danger },
  textarea: { minHeight: 84, textAlignVertical: 'top' },
  value: { color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hint: { color: colors.text2, fontSize: 12 },
  err: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  smallBtn: { alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9 },
  smallBtnText: { color: colors.primary, fontWeight: '700' },
  suggest: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' },
  suggestItem: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  sci: { color: colors.text, fontStyle: 'italic', fontWeight: '600' },
  primary: { backgroundColor: colors.primary, borderRadius: radius, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.6 },
  danger: { alignItems: 'center', paddingVertical: 12 },
  dangerText: { color: colors.danger, fontWeight: '700' },
});
