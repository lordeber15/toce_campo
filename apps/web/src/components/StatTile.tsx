import { Link } from 'react-router';

/**
 * Indicador (tarjeta con etiqueta, valor y nota). `warn` resalta el valor en rojo;
 * con `warnHint` resalta la nota en ámbar (avisos más suaves, como en Logística).
 */
export function StatTile({ label, value, hint, warn, warnHint, link }: {
  label: string; value: string; hint?: string; warn?: boolean; warnHint?: boolean; link?: string;
}) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="value" style={{ color: warn && !warnHint ? 'var(--danger)' : undefined }}>{value}</div>
      {hint && <div className="hint" style={{ color: warn && warnHint ? 'var(--warn)' : undefined }}>{hint}</div>}
    </>
  );
  return link ? <Link to={link} className="card stat" style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : <div className="card stat">{body}</div>;
}
