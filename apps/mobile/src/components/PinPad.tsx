import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Props = {
  length: number; // dígitos ingresados
  maxLength: number;
  onDigit: (d: string) => void;
  onDelete: () => void;
  extraKey?: { label: string; onPress: () => void; accessibilityLabel?: string };
  disabled?: boolean;
};

export function PinDots({ length, maxLength, error }: { length: number; maxLength: number; error?: boolean }) {
  return (
    <View style={s.dots} accessibilityLabel={`${length} de ${maxLength} dígitos`}>
      {Array.from({ length: maxLength }, (_, i) => (
        <View key={i} style={[s.dot, i < length && s.dotOn, error && s.dotErr]} />
      ))}
    </View>
  );
}

export function PinPad({ onDigit, onDelete, extraKey, disabled }: Props) {
  const rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];
  const Key = ({ label, onPress, a11y }: { label: string; onPress: () => void; a11y?: string }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.key, pressed && s.keyPressed]}
    >
      <Text style={[s.keyText, label.length > 1 && s.keySmall]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={s.pad}>
      {rows.map((r) => (
        <View key={r[0]} style={s.row}>
          {r.map((d) => <Key key={d} label={d} onPress={() => onDigit(d)} />)}
        </View>
      ))}
      <View style={s.row}>
        {extraKey ? <Key label={extraKey.label} onPress={extraKey.onPress} a11y={extraKey.accessibilityLabel} /> : <View style={s.key} />}
        <Key label="0" onPress={() => onDigit('0')} />
        <Key label="Borrar" onPress={onDelete} a11y="Borrar dígito" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginVertical: 24 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.primary },
  dotOn: { backgroundColor: colors.primary },
  dotErr: { borderColor: colors.danger, backgroundColor: colors.danger },
  pad: { gap: 12, alignSelf: 'center', width: '100%', maxWidth: 320 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  key: { width: 84, height: 68, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  keyPressed: { backgroundColor: colors.primarySoft },
  keyText: { fontSize: 28, fontWeight: '500', color: colors.text },
  keySmall: { fontSize: 15, fontWeight: '600', color: colors.primary },
});
