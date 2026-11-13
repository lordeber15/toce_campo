import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { Banner, Button } from '../components/ui';
import { colors, radius } from '../theme';

/** Con conexión: el usuario ya registrado en el teléfono entra con su contraseña. */
export default function ReauthScreen() {
  const { user, reauthWithPassword, usePinInstead, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await reauthWithPassword(password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ingresar');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <View style={s.online}>
            <View style={s.dot} />
            <Text style={s.onlineText}>Conectado al servidor</Text>
          </View>
          <View style={s.head}>
            <Text style={s.title}>{user?.fullName}</Text>
            <Text style={s.sub}>DNI {user?.dni}</Text>
          </View>
          {error && <Banner>{error}</Banner>}
          <View style={s.field}>
            <Text style={s.label}>Contraseña</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              accessibilityLabel="Contraseña"
            />
          </View>
          <Button title="Ingresar" onPress={submit} loading={busy} disabled={!password} />
          <Button title="Señal débil: usar PIN" variant="outline" onPress={usePinInstead} />
          <Button title="No soy yo / cambiar usuario" variant="ghost" onPress={signOut} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  wrap: { padding: 24, gap: 16 },
  online: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: colors.primarySoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  onlineText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  head: { gap: 4, marginTop: 8 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  sub: { color: colors.text2, fontSize: 15 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text2 },
  input: { height: 52, borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 14, fontSize: 18, color: colors.text },
});
