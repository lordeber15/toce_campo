import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { Banner, Button } from '../components/ui';
import { colors, radius } from '../theme';

export default function LoginScreen() {
  const { signIn, notice, clearNotice } = useAuth();
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    clearNotice();
    setBusy(true);
    try {
      await signIn(dni.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ingresar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.hero}>
        <Text style={s.kicker}>TOCE</Text>
        <Text style={s.title}>Plataforma de Campo</Text>
        <Text style={s.subtitle}>Primer ingreso con tu DNI. Luego podrás entrar sin conexión con tu PIN.</Text>
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {notice && <Banner>{notice}</Banner>}
          {error && <Banner>{error}</Banner>}
          <View style={s.field}>
            <Text style={s.label}>DNI</Text>
            <TextInput
              style={s.input}
              value={dni}
              onChangeText={setDni}
              keyboardType="number-pad"
              autoComplete="username"
              textContentType="username"
              maxLength={12}
              placeholder="Número de documento"
              placeholderTextColor={colors.text2}
              returnKeyType="next"
              accessibilityLabel="DNI"
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Contraseña</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              placeholder="Contraseña"
              placeholderTextColor={colors.text2}
              returnKeyType="go"
              onSubmitEditing={submit}
              accessibilityLabel="Contraseña"
            />
          </View>
          <Button title="Ingresar" onPress={submit} loading={busy} disabled={!dni || !password} />
          <Text style={s.hint}>Al ingresar se descargará la configuración de tu brigada.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingBottom: 32, paddingTop: 24 },
  kicker: { color: '#9FCBB6', fontWeight: '700', letterSpacing: 2, marginTop: 16 },
  title: { color: colors.white, fontSize: 30, fontWeight: '700', marginTop: 8 },
  subtitle: { color: '#CFE6DA', fontSize: 15, lineHeight: 22, marginTop: 8 },
  form: { padding: 24, gap: 18 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text2 },
  input: { height: 52, borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 18, color: colors.text },
  hint: { textAlign: 'center', color: colors.text2, fontSize: 13 },
});
