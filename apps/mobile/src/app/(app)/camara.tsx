import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INCIDENT_TYPE_LABELS, LOGISTICS_ENTITY_LABELS, checkBrigadeArea, formatUtm, latLngToUtm, type AreaCheck } from '@toce/shared';
import { File } from 'expo-file-system';
import { useField } from '../../lib/field';
import { formatDistance, usePosition } from '../../lib/location';
import { processPhoto } from '../../lib/photo';
import { usePackageIndex } from '../../lib/workPackage';
import { colors } from '../../theme';

/** Cámara del registro: toma la foto, la sella (UTM, fecha, lugar, estación, unidad) y vuelve a la unidad. */
export default function CameraScreen() {
  const { exec, kind, slot, label, owner } = useLocalSearchParams<{
    exec: string; kind: 'foto' | 'foto_metodo' | 'comprobante'; slot?: string; label: string; owner?: 'incident' | 'logistics' | 'inquiry';
  }>();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const pos = usePosition();
  const field = useField();
  const index = usePackageIndex();
  const insets = useSafeAreaInsets();
  // Dueño de la foto: la ejecución de una unidad, una alerta (evidencia), un registro logístico
  // o una consulta de coordinación (exec = id de la consulta; la foto va como una respuesta nueva).
  const execution = owner ? undefined : field.executions.find((e) => e.clientId === exec);
  const incident = owner === 'incident' ? field.incidents.find((i) => i.clientId === exec) : undefined;
  const logRecord = owner === 'logistics' ? field.logistics.find((r) => r.clientId === exec) : undefined;
  const inquiry = owner === 'inquiry' ? field.inquiries.find((q) => q.id === exec) : undefined;
  const logData = logRecord?.data as { stationId?: string | null; plate?: string | null; code?: string; fullName?: string; name?: string; description?: string } | undefined;
  const inquiryStation = inquiry?.stationCode && index ? [...index.stations.values()].find((x) => x.code === inquiry.stationCode) : undefined;
  const stationId = execution?.stationId ?? incident?.stationId ?? logData?.stationId ?? inquiryStation?.id ?? null;
  const station = stationId ? index?.stations.get(stationId) : undefined;
  const brigadeProject = logRecord ? index?.brigades.get(logRecord.brigadeId)?.projectId : undefined;
  const projectId = station?.projectId ?? incident?.projectId ?? brigadeProject;
  const project = projectId ? index?.projects.get(projectId) : undefined;
  const ownerLabel = execution?.unitCode
    ?? (incident ? `Alerta · ${incident.unitCode ?? station?.code ?? INCIDENT_TYPE_LABELS[incident.type]}` : '');
  const logLabel = logRecord
    ? `${LOGISTICS_ENTITY_LABELS[logRecord.entity].one} · ${logData?.plate ?? logData?.code ?? logData?.fullName ?? logData?.name ?? logData?.description ?? ''}`
    : '';
  const title = ownerLabel || logLabel || (inquiry ? `Consulta · ${inquiry.subject}` : '');
  // Polígono de trabajo de la brigada: solo se verifican las fotos de campo (no los comprobantes).
  const brigadeId = execution?.brigadeId ?? incident?.brigadeId ?? logRecord?.brigadeId ?? null;
  const brigade = brigadeId ? index?.brigades.get(brigadeId) : undefined;
  const checksArea = kind !== 'comprobante' && !!brigade?.area;

  // La primera vez pide el permiso directamente.
  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) void requestPerm();
  }, [perm?.granted, perm?.canAskAgain]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!perm) return <View style={s.black} />;
  if (!perm.granted) {
    return (
      <View style={[s.black, s.center, { padding: 24 }]}>
        <Stack.Screen options={{ title: label ?? 'Foto' }} />
        <Text style={s.permText}>TOCE Campo necesita la cámara para las fotos de la unidad de muestreo.</Text>
        <Pressable style={s.permBtn} onPress={() => void requestPerm()} accessibilityRole="button">
          <Text style={s.permBtnText}>{perm.canAskAgain ? 'Permitir cámara' : 'Abre Ajustes y permite la cámara'}</Text>
        </Pressable>
      </View>
    );
  }

  const p = pos.status === 'ok' ? pos.position : null;
  const area: AreaCheck = checksArea ? checkBrigadeArea(brigade, p) : { status: 'sin_area' };

  const shoot = async () => {
    if (!cam.current || busy || (!execution && !incident && !logRecord && !inquiry)) return;
    setBusy(true);
    try {
      const takenAt = new Date();
      const pic = await cam.current.takePictureAsync({
        quality: 0.92,
        exif: false,
        shutterSound: true,
        additionalExif: p ? { GPSLatitude: Math.abs(p.lat), GPSLatitudeRef: p.lat < 0 ? 'S' : 'N', GPSLongitude: Math.abs(p.lng), GPSLongitudeRef: p.lng < 0 ? 'W' : 'E' } : undefined,
      });
      // Fuera del polígono de la brigada (o sin GPS para verificarlo): se advierte antes de guardar.
      const at = checksArea ? checkBrigadeArea(brigade, p) : { status: 'sin_area' as const };
      if (at.status === 'fuera' || at.status === 'sin_gps') {
        const keep = await confirmOutside(at);
        if (!keep) {
          try { new File(pic.uri).delete(); } catch { /* temporal de la cámara */ }
          setBusy(false);
          return;
        }
      }
      const clientId = Crypto.randomUUID();
      const when = takenAt.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      const where = [project?.name, station?.name ?? station?.code, station?.vegetationUnit].filter(Boolean).join(' · ');
      const stamp = [
        `${title} · ${label}`,
        p ? `UTM ${formatUtm(latLngToUtm(p.lat, p.lng))}${p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : ''}` : `${station ? `Estación ${station.code}` : 'Sin estación'} · sin GPS`,
        `${when}${p?.altitude != null ? ` · Alt. ${Math.round(p.altitude).toLocaleString('es-PE')} m` : ''}`,
        where || station?.code || '',
      ].filter(Boolean);
      // Consulta: la foto se envía como una respuesta propia (se guarda y sube aunque no haya señal).
      const ownerId = inquiry ? Crypto.randomUUID() : exec;
      const photo = await processPhoto(pic.uri, { width: pic.width, height: pic.height }, stamp, ownerId, clientId);
      if (inquiry) await field.sendInquiryReply(inquiry.id, 'Foto', ownerId);
      await field.addAttachment(
        {
          clientId, executionClientId: ownerId, ownerType: incident ? 'incident' : logRecord ? 'logistics' : inquiry ? 'inquiry_message' : 'execution', kind,
          slotKey: slot ?? (kind === 'foto_metodo' ? 'metodo' : null),
          mimeType: 'image/jpeg', path: photo.compressedPath, originalPath: photo.originalPath,
          sizeBytes: photo.sizeBytes, originalSizeBytes: photo.originalSizeBytes, width: photo.width, height: photo.height,
          durationSec: null, lat: p?.lat ?? null, lng: p?.lng ?? null, accuracy: p?.accuracy ?? null, altitude: p?.altitude ?? null,
          takenAt: takenAt.toISOString(),
        },
        // Las fotos de un lado (norte, sur…) reemplazan a la anterior; las adicionales se suman.
        slot !== 'adicional',
      );
      router.back();
    } catch (e) {
      setBusy(false);
      Alert.alert('No se pudo guardar la foto', e instanceof Error ? e.message : 'Intenta de nuevo.');
    }
  };

  return (
    <View style={s.black}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancelar">
          <Text style={s.topBtn}>Cancelar</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.topTitle}>{label}</Text>
          {!!title && <Text style={s.topSub}>{title}</Text>}
        </View>
        <View style={{ width: 64 }} />
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 20 }]}>
        {area.status !== 'sin_area' && <AreaBadge area={area} />}
        <Text style={s.gps}>
          {pos.status === 'denied'
            ? 'Sin permiso de ubicación: la foto no tendrá coordenadas'
            : p
              ? `GPS ±${p.accuracy != null ? Math.round(p.accuracy) : '?'} m · ${formatUtm(latLngToUtm(p.lat, p.lng))}`
              : 'Buscando GPS…'}
        </Text>
        <Pressable
          onPress={() => void shoot()}
          disabled={busy || !ready}
          accessibilityRole="button"
          accessibilityLabel="Tomar foto"
          style={({ pressed }) => [s.shutter, (pressed || busy) && { opacity: 0.6 }]}
        >
          {busy ? <ActivityIndicator color={colors.primary} /> : <View style={s.shutterInner} />}
        </Pressable>
        {busy && <Text style={s.gps}>Guardando foto con sello…</Text>}
      </View>
    </View>
  );
}

const dist = (m: number) => (m < 10 ? 'menos de 10 m' : formatDistance(m));

/** Pregunta si guardar una foto fuera del polígono de la brigada. true = guardar igual. */
function confirmOutside(at: Extract<AreaCheck, { status: 'fuera' | 'sin_gps' }>): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      at.status === 'fuera' ? 'Foto fuera del polígono' : 'Sin ubicación GPS',
      at.status === 'fuera'
        ? `Estás a ${dist(at.distanceM)} fuera de ${at.areaName}, el polígono asignado a tu brigada.\n\nSi la guardas, quedará marcada como "fuera del polígono" para el supervisor.`
        : `No hay GPS, así que no se puede verificar si estás dentro de ${at.areaName}.\n\nSi la guardas, quedará sin verificar.`,
      [
        { text: 'Volver a tomar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Guardar igual', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Aviso en vivo: dentro o fuera del polígono de la brigada. */
function AreaBadge({ area }: { area: AreaCheck }) {
  if (area.status === 'sin_area') return null;
  const tone = area.status === 'dentro' ? '#2F9E44' : area.status === 'fuera' ? '#E03131' : '#868E96';
  const text = area.status === 'dentro'
    ? `Dentro de ${area.areaName}`
    : area.status === 'fuera' ? `Fuera de ${area.areaName} · a ${dist(area.distanceM)}` : `Sin GPS para verificar ${area.areaName}`;
  return (
    <View style={[s.badge, { backgroundColor: tone }]} accessibilityLiveRegion="polite">
      <Text style={s.badgeText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, maxWidth: '92%' },
  badgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  black: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  permText: { color: '#fff', textAlign: 'center', fontSize: 16, lineHeight: 22 },
  permBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  topBtn: { color: '#fff', fontSize: 16, width: 64 },
  topTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  topSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 14, paddingTop: 14, backgroundColor: 'rgba(0,0,0,0.45)' },
  gps: { color: '#fff', fontSize: 13, fontVariant: ['tabular-nums'] },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
