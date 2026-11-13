import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, router, type ErrorBoundaryProps } from 'expo-router';
import { WorkPackageProvider, useWorkPackage } from '../../lib/workPackage';
import { FieldProvider } from '../../lib/field';
import { colors } from '../../theme';

export default function AppLayout() {
  return (
    <WorkPackageProvider>
      <FieldWithPackage>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.white,
            headerTitleStyle: { fontWeight: '600' },
            headerBackTitle: 'Atrás',
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Mi jornada' }} />
          <Stack.Screen name="estacion/[id]" options={{ title: 'Estación' }} />
          <Stack.Screen name="unidad/[id]" options={{ title: 'Unidad' }} />
          <Stack.Screen name="registro" options={{ title: 'Registro' }} />
          <Stack.Screen name="camara" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="mapa" options={{ title: 'Mapa' }} />
          <Stack.Screen name="alertas" options={{ title: 'Mis alertas' }} />
          <Stack.Screen name="alerta/nueva" options={{ title: 'Registrar alerta' }} />
          <Stack.Screen name="alerta/[id]" options={{ title: 'Alerta' }} />
          <Stack.Screen name="supervision/index" options={{ title: 'Supervisión' }} />
          <Stack.Screen name="supervision/nueva" options={{ title: 'Registrar incidencia' }} />
          <Stack.Screen name="supervision/alertas" options={{ title: 'Alertas e incidencias' }} />
          <Stack.Screen name="supervision/alerta/[id]" options={{ title: 'Alerta' }} />
          <Stack.Screen name="logistica/index" options={{ title: 'Logística' }} />
          <Stack.Screen name="logistica/[entity]" options={{ title: 'Logística' }} />
          <Stack.Screen name="logistica/registro" options={{ title: 'Registro' }} />
        </Stack>
      </FieldWithPackage>
    </WorkPackageProvider>
  );
}

/** El registro de campo pide actualizar el paquete cuando coordinación reprograma una visita. */
function FieldWithPackage({ children }: { children: ReactNode }) {
  const { download } = useWorkPackage();
  return <FieldProvider onScheduleChanged={() => void download()}>{children}</FieldProvider>;
}

/** Si una pantalla falla, se muestra este aviso en lugar de cerrar la app (lo guardado no se pierde). */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'center', gap: 14 }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>Algo falló en esta pantalla</Text>
      <Text style={{ color: colors.text2, lineHeight: 20 }}>
        Tus registros están guardados en el teléfono. Intenta de nuevo; si se repite, avisa a coordinación con este mensaje:
      </Text>
      <Text selectable style={{ color: colors.danger, fontFamily: 'monospace', fontSize: 12 }}>{error.message}</Text>
      <Pressable onPress={() => void retry()} style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }} accessibilityRole="button">
        <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>Reintentar</Text>
      </Pressable>
      <Pressable onPress={() => router.replace('/')} style={{ paddingVertical: 10, alignItems: 'center' }} accessibilityRole="button">
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver al inicio</Text>
      </Pressable>
    </View>
  );
}
