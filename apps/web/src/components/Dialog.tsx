import { useEffect, type FormEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

export function Dialog({ title, onClose, onSubmit, children, footer, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className={'card dialog' + (wide ? ' dialog-wide' : '')}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit?.(e); }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {children}
        {footer && <div className="dialog-actions">{footer}</div>}
      </form>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg =
    error instanceof Error
      ? ((error as { issues?: { message: string }[] }).issues?.map((i) => i.message).join('. ') || error.message)
      : String(error);
  return <div className="alert-error" role="alert">{msg}</div>;
}

export function NoProject() {
  return <div className="card empty">Crea o selecciona un proyecto para continuar.</div>;
}
