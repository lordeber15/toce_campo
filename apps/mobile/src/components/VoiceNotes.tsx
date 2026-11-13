import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus,
  useAudioRecorder, useAudioRecorderState, type RecordingOptions,
} from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { useField, type LocalAttachment, type LocalExecution } from '../lib/field';
import type { Position } from '../lib/location';
import { fieldDir } from '../lib/photo';
import { colors, radius } from '../theme';

/** Voz mono AAC a 64 kbps: ~30 MB por hora, suficiente para notas largas. */
const VOICE: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 };

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Notas de voz de la unidad: grabar sin límite de duración, escuchar y borrar las aún no enviadas. */
export function VoiceNotes({ execution, notes, position, disabled, onChange }: {
  execution: LocalExecution;
  notes: LocalAttachment[];
  position: Position | null;
  disabled?: boolean;
  onChange: () => void;
}) {
  const field = useField();
  const recorder = useAudioRecorder(VOICE);
  const rec = useAudioRecorderState(recorder, 500);
  const player = useAudioPlayer();
  const playing = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (playing.didJustFinish) setCurrent(null);
  }, [playing.didJustFinish]);

  const start = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Micrófono', 'Permite el micrófono en Ajustes para grabar notas de voz.');
      return;
    }
    player.pause();
    setCurrent(null);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setStartedAt(new Date());
  };

  const stop = async () => {
    const duration = Math.round(rec.durationMillis / 1000);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const uri = recorder.uri;
    if (!uri) return;
    const clientId = Crypto.randomUUID();
    const dest = new File(fieldDir(execution.clientId), `${clientId}.m4a`);
    await new File(uri).move(dest);
    await field.addAttachment({
      clientId, executionClientId: execution.clientId, kind: 'audio', slotKey: null, mimeType: 'audio/mp4',
      path: dest.uri, originalPath: null, sizeBytes: dest.size ?? null, originalSizeBytes: null, width: null, height: null,
      durationSec: duration, lat: position?.lat ?? null, lng: position?.lng ?? null, accuracy: position?.accuracy ?? null,
      altitude: position?.altitude ?? null, takenAt: (startedAt ?? new Date()).toISOString(),
    });
    setStartedAt(null);
    onChange();
  };

  const play = (n: LocalAttachment) => {
    if (current === n.clientId && playing.playing) {
      player.pause();
      return;
    }
    if (current !== n.clientId) {
      player.replace({ uri: n.path });
      setCurrent(n.clientId);
    }
    player.play();
  };

  const remove = (n: LocalAttachment) =>
    Alert.alert('Borrar nota de voz', '¿Seguro? No se puede recuperar.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => {
          if (current === n.clientId) { player.pause(); setCurrent(null); }
          const ok = await field.removeAttachment(n.clientId);
          if (!ok) Alert.alert('Ya enviada', 'Esta nota ya se envió al servidor y queda como evidencia.');
          onChange();
        },
      },
    ]);

  return (
    <View style={{ gap: 10 }}>
      {notes.map((n, i) => {
        const isCur = current === n.clientId;
        return (
          <View key={n.clientId} style={s.note}>
            <Pressable onPress={() => play(n)} style={s.play} accessibilityRole="button" accessibilityLabel={isCur && playing.playing ? 'Pausar' : 'Escuchar'}>
              <Text style={s.playText}>{isCur && playing.playing ? 'II' : '▶'}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.noteTitle}>Nota {i + 1}</Text>
              <Text style={s.small}>
                {isCur ? `${mmss(playing.currentTime)} / ` : ''}{mmss(n.durationSec ?? 0)} ·{' '}
                {new Date(n.takenAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' })}
                {n.uploaded ? ' · enviada' : ' · por enviar'}
              </Text>
            </View>
            {!n.metaSynced && !disabled && (
              <Pressable onPress={() => remove(n)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Borrar nota ${i + 1}`}>
                <Text style={s.del}>Borrar</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {rec.isRecording ? (
        <Pressable onPress={() => void stop()} style={[s.recBtn, s.recOn]} accessibilityRole="button" accessibilityLabel="Detener grabación">
          <View style={s.dotOn} />
          <Text style={s.recOnText}>Grabando {mmss(rec.durationMillis / 1000)} · Detener</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => void start().catch((e) => Alert.alert('No se pudo grabar', e instanceof Error ? e.message : ''))}
          disabled={disabled}
          style={({ pressed }) => [s.recBtn, (pressed || disabled) && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <View style={s.dot} />
          <Text style={s.recText}>Grabar nota de voz</Text>
        </Pressable>
      )}
      {rec.isRecording && <Text style={s.small}>Mantén esta pantalla abierta mientras grabas.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  playText: { color: colors.primary, fontWeight: '800', fontSize: 15 },
  noteTitle: { color: colors.text, fontWeight: '600' },
  small: { color: colors.text2, fontSize: 12, fontVariant: ['tabular-nums'] },
  del: { color: colors.danger, fontWeight: '600' },
  recBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: radius, borderWidth: 1, borderColor: colors.border, paddingVertical: 13, backgroundColor: colors.surface },
  recOn: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger },
  dotOn: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.danger },
  recText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  recOnText: { color: colors.danger, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },
});
