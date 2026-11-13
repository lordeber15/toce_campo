import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { PIN_MAX } from '../lib/config';
import { PinDots, PinPad } from '../components/PinPad';
import { Banner, Button } from '../components/ui';
import { colors } from '../theme';

export default function UnlockScreen() {
  const { user, unlockWithPin, unlockWithBiometric, biometry, biometricEnabled, attemptsLeft, signOut, notice, checkConnectionAndLock } = useAuth();
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const bioTried = useRef(false);
  const canBio = biometricEnabled && biometry.available;

  useEffect(() => {
    if (canBio && !bioTried.current) {
      bioTried.current = true;
      void unlockWithBiometric();
    }
  }, [canBio, unlockWithBiometric]);

  async function tryPin(pin: string) {
    setBusy(true);
    const ok = await unlockWithPin(pin);
    setBusy(false);
    if (!ok) {
      setError(true);
      setValue('');
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.head}>
        <View style={s.avatar}><Text style={s.avatarText}>{initials(user?.fullName)}</Text></View>
        <Text style={s.name}>{user?.fullName}</Text>
        <Text style={s.sub}>Sin conexión · ingresa tu PIN</Text>
      </View>
      {!error && (stillOffline || notice) && (
        <View style={{ paddingHorizontal: 24 }}>
          <Banner tone="info">{stillOffline ? 'Todavía no hay conexión con el servidor. Ingresa con tu PIN.' : notice}</Banner>
        </View>
      )}
      {error && (
        <View style={{ paddingHorizontal: 24 }}>
          <Banner>PIN incorrecto. Te quedan {attemptsLeft} {attemptsLeft === 1 ? 'intento' : 'intentos'}.</Banner>
        </View>
      )}
      <PinDots length={value.length} maxLength={PIN_MAX} error={error && value.length === 0} />
      <PinPad
        length={value.length}
        maxLength={PIN_MAX}
        disabled={busy}
        onDigit={(d) => { setError(false); if (value.length < PIN_MAX) setValue(value + d); }}
        onDelete={() => setValue(value.slice(0, -1))}
        extraKey={canBio ? { label: biometry.label === 'huella' ? 'Huella' : 'Face ID', onPress: () => void unlockWithBiometric(), accessibilityLabel: `Usar ${biometry.label}` } : undefined}
      />
      <View style={s.foot}>
        <Button title="Entrar" onPress={() => tryPin(value)} loading={busy} disabled={value.length < 4} />
        <Button
          title={checking ? 'Buscando conexión…' : 'Ya tengo conexión: usar contraseña'}
          variant="ghost"
          disabled={checking}
          onPress={async () => { setChecking(true); setStillOffline(!(await checkConnectionAndLock())); setChecking(false); }}
        />
        <Button title="No soy yo / cambiar usuario" variant="ghost" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

function initials(name?: string) {
  return (name ?? '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { alignItems: 'center', paddingTop: 32, gap: 6 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  avatarText: { color: colors.white, fontSize: 22, fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  sub: { color: colors.text2, fontSize: 15 },
  foot: { marginTop: 'auto', padding: 24, gap: 8 },
});
