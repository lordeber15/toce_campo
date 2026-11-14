import { router } from 'expo-router';
import { useField, type LocalInquiry } from '../lib/field';
import { colors } from '../theme';
import { LinkRow } from './home';

/** Estado visible de una consulta en el teléfono. */
export function inquiryState(q: LocalInquiry): { label: string; fg: string; bg: string } {
  if (q.unread) return { label: 'Pregunta nueva', fg: colors.danger, bg: colors.dangerSoft };
  if (q.outbox.some((m) => m.error)) return { label: 'Error al enviar', fg: colors.danger, bg: colors.dangerSoft };
  if (q.outbox.length) return { label: 'Respuesta por enviar', fg: colors.warn, bg: '#FFF4E0' };
  if (q.status === 'cerrada') return { label: 'Cerrada', fg: colors.text2, bg: '#EEF1EC' };
  if (q.status === 'respondida') return { label: 'Respondida', fg: colors.primary, bg: colors.primarySoft };
  return { label: 'Por responder', fg: colors.warn, bg: '#FFF4E0' };
}

/** Acceso a las consultas de coordinación (solo si hay alguna), con aviso de preguntas nuevas. */
export function InquiriesLink() {
  const { inquiries, unreadInquiries } = useField();
  if (!inquiries.length) return null;
  const pending = inquiries.filter((q) => q.status === 'abierta' && !q.outbox.length).length;
  return (
    <LinkRow
      text={`Consultas de coordinación${pending ? ` · ${pending} por responder` : ''}${unreadInquiries ? ` · ${unreadInquiries} nueva${unreadInquiries > 1 ? 's' : ''}` : ''}`}
      unread={unreadInquiries > 0}
      onPress={() => router.push('/consultas')}
    />
  );
}
