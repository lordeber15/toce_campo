import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth';
import { PIN_MAX, PIN_MIN } from '../lib/config';
import { PinDots, PinPad } from '../components/PinPad';
import { Banner, Button } from '../components/ui';
import { colors } from '../theme';

/** Crear PIN en dos pasos (ingresar y confirmar). */
export default function SetupPinScreen() {
  const { user, setupPin, biometry, signOut } = useAuth();
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [useBio, setUseBio] = useState(biometry.available);
  const [busy, setBusy] = useState(false);

  const add = (d: string) => value.length < PIN_MAX && setValue(value + d);
  const del = () => setValue(value.slice(0, -1));

  async function next() {
    setError(null);
    if (step === 'enter') {
      if (/^(\d)\1+$/.test(value) || '0123456789'.includes(value) || '9876543210'.includes(value)) {
        setError('Evita PIN repetidos o consecutivos (1111, 1234).');
        return setValue('');
      }
      setFirst(value);
      setValue('');
      return setStep('confirm');
    }
    if (value !== first) {
      setError('Los PIN no coinciden. Vuelve a intentarlo.');
      setFirst('');
      setValue('');
      return setStep('enter');
    }
    setBusy(true);
    await setupPin(value, useBio);
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.head}>
        <Text style={s.hello}>Hola, {user?.fullName.split(' ')[0]}</Text>
        <Text style={s.title}>{step === 'enter' ? 'Crea tu PIN' : 'Confirma tu PIN'}</Text>
        <Text style={s.sub}>
          {step === 'enter'
            ? `De ${PIN_MIN} a ${PIN_MAX} dígitos. Lo usarás para entrar sin conexión en campo.`
            : 'Ingresa el mismo PIN otra vez.'}
        </Text>
      </View>
      {error && <View style={{ paddingHorizontal: 24 }}><Banner>{error}</Banner></View>}
      <PinDots length={value.length} maxLength={step === 'confirm' ? first.length : PIN_MAX} />
      <PinPad length={value.length} maxLength={PIN_MAX} onDigit={add} onDelete={del} disabled={busy} />
      <View style={s.foot}>
        {step === 'confirm' && biometry.available && (
          <View style={s.bioRow}>
            <Text style={s.bioText}>Desbloquear también con {biometry.label}</Text>
            <Switch value={useBio} onValueChange={setUseBio} trackColor={{ true: colors.accent }} accessibilityLabel={`Usar ${biometry.label}`} />
          </View>
        )}
        <Button
          title={step === 'enter' ? 'Continuar' : 'Guardar PIN'}
          onPress={next}
          loading={busy}
          disabled={step === 'enter' ? value.length < PIN_MIN : value.length !== first.length}
        />
        <Button title="Salir" variant="ghost" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: 24, paddingTop: 24, gap: 6 },
  hello: { color: colors.text2, fontSize: 15 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  sub: { color: colors.text2, fontSize: 15, lineHeight: 21 },
  foot: { marginTop: 'auto', padding: 24, gap: 8 },
  bioRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  bioText: { fontSize: 15, color: colors.text, flex: 1 },
});
