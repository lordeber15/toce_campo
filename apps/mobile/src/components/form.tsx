import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Image } from 'expo-image';
import type { LocalAttachment } from '../lib/field';
import { colors, radius } from '../theme';

/** Piezas de formulario reutilizadas en supervisión y logística (grandes, para usar con guantes). */

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={{ gap: 2, marginTop: 4 }}>
      <Text style={s.label}>{children}</Text>
      {!!hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}

export function Field({ multiline, style, ...rest }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.text2}
      multiline={multiline}
      style={[s.input, multiline && s.textarea, style]}
      {...rest}
    />
  );
}

export function Chip({ on, onPress, children, tone = 'primary' }: { on: boolean; onPress: () => void; children: string; tone?: 'primary' | 'danger' }) {
  const bg = tone === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, on && { backgroundColor: bg, borderColor: bg }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Text style={[s.chipText, on && s.chipTextOn]}>{children}</Text>
    </Pressable>
  );
}

/** Elegir una opción de una lista corta. */
export function Choice<T extends string>({ options, labels, value, onChange, tone, allowNone }: {
  options: readonly T[]; labels: Record<T, string>; value: T | null; onChange: (v: T | null) => void; tone?: 'primary' | 'danger'; allowNone?: boolean;
}) {
  return (
    <View style={s.chips}>
      {options.map((o) => (
        <Chip key={o} tone={tone} on={value === o} onPress={() => onChange(allowNone && value === o ? null : o)}>{labels[o]}</Chip>
      ))}
    </View>
  );
}

export function Check({ on, onPress, children }: { on: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable onPress={onPress} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[s.box, on && s.boxOn]}>{on && <Text style={s.tick}>✓</Text>}</View>
      <Text style={s.checkText}>{children}</Text>
    </Pressable>
  );
}

/** Lista de elementos: sugerencias de un toque y otro texto libre. */
export function Tags({ value, onChange, suggestions, placeholder }: {
  value: string[]; onChange: (v: string[]) => void; suggestions: string[]; placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const extra = value.filter((v) => !suggestions.includes(v));
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={s.chips}>
        {[...suggestions, ...extra].map((t) => (
          <Pressable key={t} onPress={() => toggle(t)} style={[s.chip, value.includes(t) && s.tagOn]} accessibilityRole="checkbox" accessibilityState={{ checked: value.includes(t) }}>
            <Text style={[s.chipText, value.includes(t) && { color: colors.primary, fontWeight: '700' }]}>{value.includes(t) ? `✓ ${t}` : t}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.row}>
        <Field value={draft} onChangeText={setDraft} placeholder={placeholder} onSubmitEditing={add} returnKeyType="done" style={{ flex: 1 }} />
        <Pressable onPress={add} disabled={!draft.trim()} style={[s.addBtn, !draft.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Agregar">
          <Text style={s.addBtnText}>Agregar</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Fotos de evidencia: miniaturas y botón para tomar otra. */
export function Photos({ photos, onAdd, remote = 0, addLabel = 'Foto', disabled }: {
  photos: LocalAttachment[]; onAdd: () => void; remote?: number; addLabel?: string; disabled?: boolean;
}) {
  const shownRemote = Math.max(0, remote - photos.filter((p) => p.metaSynced).length);
  return (
    <View style={s.photos}>
      {photos.map((ph) => (
        ph.freed
          ? <View key={ph.clientId} style={[s.thumb, s.center]}><Text style={s.hint}>En el servidor</Text></View>
          : <Image key={ph.clientId} source={{ uri: ph.path }} style={s.thumb} contentFit="cover" />
      ))}
      {shownRemote > 0 && <View style={[s.thumb, s.center]}><Text style={[s.hint, { textAlign: 'center' }]}>{shownRemote} en el servidor</Text></View>}
      {!disabled && (
        <Pressable onPress={onAdd} style={[s.thumb, s.addPhoto]} accessibilityRole="button" accessibilityLabel={`Tomar ${addLabel.toLowerCase()}`}>
          <Text style={s.plus}>+</Text>
          <Text style={s.hint}>{addLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function PrimaryButton({ title, onPress, disabled, tone = 'primary' }: { title: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'danger' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.primary, tone === 'danger' && { backgroundColor: colors.danger }, (pressed || disabled) && { opacity: 0.6 }]}
      accessibilityRole="button"
    >
      <Text style={s.primaryText}>{title}</Text>
    </Pressable>
  );
}

export const formStyles = StyleSheet.create({
  wrap: { padding: 16, gap: 14, paddingBottom: 40 },
  small: { color: colors.text2, fontSize: 12 },
  muted: { color: colors.text2, lineHeight: 20 },
  auto: { color: colors.text, fontWeight: '700', fontSize: 16 },
});

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  label: { color: colors.text, fontWeight: '700', fontSize: 15 },
  hint: { color: colors.text2, fontSize: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: colors.surface },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  tagOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tick: { color: colors.white, fontWeight: '900' },
  checkText: { color: colors.text, fontWeight: '600', flex: 1 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addBtn: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  addBtnText: { color: colors.primary, fontWeight: '700' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: '#EEF1EC' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  addPhoto: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border },
  plus: { fontSize: 26, color: colors.primary, fontWeight: '300' },
  primary: { backgroundColor: colors.primary, borderRadius: radius, paddingVertical: 15, alignItems: 'center' },
  primaryText: { color: colors.white, fontWeight: '800', fontSize: 16 },
});
