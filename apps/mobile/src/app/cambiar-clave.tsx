import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { Banner, Button } from '../components/ui';
import { colors, radius } from '../theme';

/** Cambio de contraseña obligatorio en el primer ingreso (la contraseña inicial es el DNI). Igual que en la web. */
export default function ChangePasswordScreen() {
  const { user, changePassword, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = next && next.length < 6 ? 'La nueva contraseña debe tener al menos 6 caracteres.'
    : next && next === user?.dni ? 'La nueva contraseña no puede ser tu DNI.'
      : repeat && next !== repeat ? 'Las contraseñas no coinciden.' : null;
  const ready = !!current && !!next && next === repeat && !problem;

  async function submit() {
    if (!ready) return;
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.hero}>
        <Text style={s.kicker}>TOCE</Text>
        <Text style={s.title}>Crea tu contraseña</Text>
        <Text style={s.subtitle}>
          Es tu primer ingreso: la contraseña inicial es tu DNI. Elige una nueva; la usarás en la app y en la web.
        </Text>
        {user && <Text style={s.who}>{user.fullName}</Text>}
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {(error || problem) && <Banner>{error ?? problem}</Banner>}
          <Field label="Contraseña actual" value={current} onChange={setCurrent} autoComplete="current-password" />
          <Field label="Nueva contraseña" value={next} onChange={setNext} autoComplete="new-password" />
          <Field label="Repite la nueva contraseña" value={repeat} onChange={setRepeat} autoComplete="new-password" onSubmit={submit} />
          <Button title="Guardar y continuar" onPress={submit} loading={busy} disabled={!ready} />
          <Button title="Salir" variant="outline" onPress={() => void signOut()} disabled={busy} />
          <Text style={s.hint}>Necesitas conexión a internet para este paso.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, value, onChange, autoComplete, onSubmit }: {
  label: string; value: string; onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password'; onSubmit?: () => void;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={autoComplete}
        textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
        maxLength={72}
        returnKeyType={onSubmit ? 'go' : 'next'}
        onSubmitEditing={onSubmit}
        accessibilityLabel={label}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingBottom: 32, paddingTop: 24 },
  kicker: { color: '#9FCBB6', fontWeight: '700', letterSpacing: 2, marginTop: 16 },
  title: { color: colors.white, fontSize: 30, fontWeight: '700', marginTop: 8 },
  subtitle: { color: '#CFE6DA', fontSize: 15, lineHeight: 22, marginTop: 8 },
  who: { color: '#9FCBB6', fontSize: 13, marginTop: 10 },
  form: { padding: 24, gap: 18 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text2 },
  input: { height: 52, borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 18, color: colors.text },
  hint: { textAlign: 'center', color: colors.text2, fontSize: 13 },
});
