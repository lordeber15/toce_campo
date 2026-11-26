import { useRef, useState } from 'react';
import { INQUIRY_FILE_MAX_BYTES, INQUIRY_FILE_TYPES } from '@toce/shared';
import { api } from '../lib/api';
import { MediaViewer } from './MediaViewer';

/** Adjuntos de consultas, reprogramaciones y documentos: mismos tipos y tamaño máximo. */
export const ATTACH_ACCEPT = INQUIRY_FILE_TYPES.join(',');
export const mb = (b: number) => `${(b / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits: 1 })} MB`;

/** Revisa tipo y tamaño antes de subir. */
export function fileProblem(files: File[]) {
  const bad = files.find((f) => !(INQUIRY_FILE_TYPES as readonly string[]).includes(f.type));
  if (bad) return `“${bad.name}” no es un tipo admitido (fotos, PDF, audio, Excel o Word).`;
  const big = files.find((f) => f.size > INQUIRY_FILE_MAX_BYTES);
  if (big) return `“${big.name}” pesa ${mb(big.size)}; el máximo es ${mb(INQUIRY_FILE_MAX_BYTES)}.`;
  return null;
}

/** Sube los archivos uno por uno (PUT con el archivo como cuerpo). `urlFor` arma la ruta de cada uno. */
export async function uploadFiles(urlFor: (f: File) => string, files: File[]) {
  for (const f of files) {
    await api(urlFor(f), { method: 'PUT', body: f, headers: { 'content-type': f.type } });
  }
}

export function FilePicker({ files, onChange, label = 'Adjuntar evidencias' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
      <input ref={ref} type="file" multiple accept={ATTACH_ACCEPT} hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
      <button type="button" className="btn btn-sm" onClick={() => ref.current?.click()}>{label}</button>
      {files.map((f, i) => (
        <span key={i} className="chip" style={{ gap: 4 }}>
          {f.name} ({mb(f.size)})
          <button type="button" className="icon-btn" style={{ width: 18, height: 18, fontSize: 14 }} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`}>×</button>
        </span>
      ))}
      {!files.length && <span className="hint">Fotos, PDF, audio, Excel o Word; hasta 25 MB cada uno.</span>}
    </div>
  );
}

type FileRef = { id: string; kind: string; name: string | null; mimeType: string; sizeBytes: number | null };

/** Chip de un adjunto que abre el visor. `endpoint`: '/inquiry-files/' o '/reschedule-files/'. */
export function FileLink({ file, endpoint, fallbackName = 'archivo' }: { file: FileRef; endpoint: string; fallbackName?: string }) {
  const [open, setOpen] = useState(false);
  const icon = file.kind === 'foto' ? '🖼' : file.kind === 'audio' ? '🎧' : '📄';
  const name = file.name ?? fallbackName;
  return (
    <>
      <button type="button" className="chip" onClick={() => setOpen(true)} title="Ver" style={{ cursor: 'pointer', border: 0 }}>
        {icon} {name}{file.sizeBytes ? ` (${mb(file.sizeBytes)})` : ''}
      </button>
      {open && (
        <MediaViewer
          title={name}
          kind={file.kind}
          mimeType={file.mimeType}
          queryKey={[endpoint, file.id]}
          load={() => api<{ url: string }>(`${endpoint}${file.id}/url`).then((r) => r.url)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
