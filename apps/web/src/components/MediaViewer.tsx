import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, ErrorBox } from './Dialog';

type Props = {
  title: string;
  /** Tipo del adjunto (foto, comprobante, audio, documento…) y su MIME, si se conoce. */
  kind?: string;
  mimeType?: string | null;
  /** Clave de caché del enlace firmado (los enlaces duran 15 min). */
  queryKey: unknown[];
  load: () => Promise<string>;
  /** Si hay original en alta resolución, se puede cambiar a ella dentro del visor. */
  loadOriginal?: () => Promise<string>;
  caption?: ReactNode;
  onClose: () => void;
};

const isImage = (kind?: string, mime?: string | null) => !!mime?.startsWith('image/') || kind === 'foto' || kind === 'comprobante';
const isAudio = (kind?: string, mime?: string | null) => !!mime?.startsWith('audio/') || kind === 'audio';

/** Visor de fotos, audios y PDF en un modal (no descarga ni abre otra pestaña). */
export function MediaViewer({ title, kind, mimeType, queryKey, load, loadOriginal, caption, onClose }: Props) {
  const [original, setOriginal] = useState(false);
  const url = useQuery({ queryKey: ['viewer', ...queryKey], queryFn: load, staleTime: 10 * 60_000 });
  const orig = useQuery({ queryKey: ['viewer-original', ...queryKey], queryFn: () => loadOriginal!(), enabled: original && !!loadOriginal, staleTime: 10 * 60_000 });
  const src = original ? orig.data : url.data;
  const image = isImage(kind, mimeType);
  const audio = isAudio(kind, mimeType);
  const pdf = mimeType === 'application/pdf';

  return (
    <Dialog
      title={title}
      wide
      onClose={onClose}
      footer={<>
        {loadOriginal && image && (
          <button type="button" className="btn" onClick={() => setOriginal((v) => !v)} disabled={original && orig.isLoading}>
            {original ? 'Ver versión liviana' : 'Original en alta resolución'}
          </button>
        )}
        {src && <a className="btn" href={src} target="_blank" rel="noreferrer">Abrir en otra pestaña</a>}
        <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>}
    >
      <ErrorBox error={url.error ?? orig.error} />
      {!src && !url.error && !orig.error && <div className="empty">Cargando…</div>}
      {src && image && (
        <img src={src} alt={title} style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', margin: '0 auto', objectFit: 'contain', borderRadius: 8 }} />
      )}
      {src && audio && <audio controls autoPlay src={src} style={{ width: '100%' }} />}
      {src && pdf && <iframe src={src} title={title} style={{ width: '100%', height: '70vh', border: 0, borderRadius: 8 }} />}
      {src && !image && !audio && !pdf && (
        <div className="empty">Este tipo de archivo no se puede previsualizar. Usa “Abrir en otra pestaña” para verlo o descargarlo.</div>
      )}
      {caption && <div className="hint">{caption}</div>}
    </Dialog>
  );
}
