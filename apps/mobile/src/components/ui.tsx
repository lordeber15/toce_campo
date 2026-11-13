import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

type BtnProps = Omit<PressableProps, 'children'> & { title: string; variant?: 'primary' | 'outline' | 'ghost'; loading?: boolean; style?: ViewStyle };
export function Button({ title, variant = 'primary', loading, disabled, style, ...rest }: BtnProps) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      style={({ pressed }) => [s.btn, s[variant], off && { opacity: 0.55 }, pressed && { opacity: 0.85 }, style]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.white : colors.primary} />
      ) : (
        <Text style={[s.btnText, variant !== 'primary' && { color: colors.primary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Banner({ tone = 'danger', children }: { tone?: 'danger' | 'info'; children: ReactNode }) {
  return (
    <View accessibilityRole="alert" style={[s.banner, tone === 'info' && { backgroundColor: colors.primarySoft }]}>
      <Text style={[s.bannerText, tone === 'info' && { color: colors.primary }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { height: 52, borderRadius: radius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: colors.primary },
  outline: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface },
  ghost: { backgroundColor: 'transparent' },
  btnText: { color: colors.white, fontSize: 17, fontWeight: '600' },
  banner: { backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 12 },
  bannerText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
