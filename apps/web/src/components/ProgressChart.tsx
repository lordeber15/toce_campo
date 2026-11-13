import { useEffect, useRef, useState } from 'react';

type Point = { date: string; planned: number; done: number | null };

const fmtDay = (d: string) => new Date(`${d}T12:00:00-05:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'America/Lima' }).replace('.', '');

/**
 * Curva de avance acumulado: unidades programadas según el cronograma original (línea discontinua) frente a
 * unidades completadas. Un solo eje; leyenda y etiquetas directas; tooltip con línea guía al pasar el mouse.
 */
export function ProgressChart({ data, today, height = 240 }: { data: Point[]; today: string; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e!.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  if (data.length < 2) return <div className="empty" style={{ padding: 24 }}>Aún no hay suficientes días programados para la curva.</div>;

  const pad = { l: 44, r: 92, t: 14, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const maxY = Math.max(1, ...data.map((d) => Math.max(d.planned, d.done ?? 0)));
  const niceMax = niceCeil(maxY);
  const x = (i: number) => pad.l + (i / (data.length - 1)) * w;
  const y = (v: number) => pad.t + h - (v / niceMax) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const path = (vals: (number | null)[]) =>
    vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p}`).join(' ');
  const plannedPath = path(data.map((d) => d.planned));
  const donePath = path(data.map((d) => d.done));
  const lastDone = data.reduce((a, d, i) => (d.done != null ? i : a), -1);
  const ti = data.findIndex((d) => d.date === today);
  const step = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(w / 70))));
  const hv = hover != null ? data[hover] : null;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div className="chart" ref={wrap}>
      <div className="chart-legend">
        <span><i className="swatch swatch-planned" /> Programado (cronograma original)</span>
        <span><i className="swatch swatch-done" /> Completado</span>
        <button className="link-btn" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Ver gráfico' : 'Ver tabla'}</button>
      </div>
      {table ? (
        <div className="table-wrap" style={{ maxHeight: height, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>Día</th><th style={{ textAlign: 'right' }}>Programado acumulado</th><th style={{ textAlign: 'right' }}>Completado acumulado</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date}><td>{fmtDay(d.date)}</td><td style={{ textAlign: 'right' }}>{d.planned}</td><td style={{ textAlign: 'right' }}>{d.done ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg width={width} height={height} role="img" aria-label={`Avance acumulado: ${data[lastDone]?.done ?? 0} de ${data[data.length - 1]!.planned} unidades completadas`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={pad.l - 8} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{t}</text>
              </g>
            ))}
            {data.map((d, i) => (i % step === 0 || i === data.length - 1 ? (
              <text key={d.date} x={x(i)} y={height - 8} className="chart-axis" textAnchor="middle">{fmtDay(d.date)}</text>
            ) : null))}
            {ti >= 0 && (
              <g>
                <line x1={x(ti)} x2={x(ti)} y1={pad.t} y2={pad.t + h} className="chart-today" />
                <text x={x(ti) - 4} y={pad.t + 10} className="chart-axis" textAnchor="end">hoy</text>
              </g>
            )}
            <path d={plannedPath} className="line-planned" />
            <path d={donePath} className="line-done" />
            {/* Etiquetas directas al final de cada línea */}
            <text x={x(data.length - 1) + 8} y={y(data[data.length - 1]!.planned)} className="chart-label" dominantBaseline="middle">
              {data[data.length - 1]!.planned} prog.
            </text>
            {lastDone >= 0 && (
              <>
                <circle cx={x(lastDone)} cy={y(data[lastDone]!.done!)} r={4} className="dot-done" />
                <text x={x(lastDone) + 8} y={y(data[lastDone]!.done!) + (Math.abs(y(data[lastDone]!.done!) - y(data[data.length - 1]!.planned)) < 14 && lastDone === data.length - 1 ? 14 : 0)}
                  className="chart-label" dominantBaseline="middle">{data[lastDone]!.done} compl.</text>
              </>
            )}
            {hv && (
              <g>
                <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={pad.t + h} className="chart-cross" />
                <circle cx={x(hover!)} cy={y(hv.planned)} r={4} className="dot-planned" />
                {hv.done != null && <circle cx={x(hover!)} cy={y(hv.done)} r={4} className="dot-done" />}
              </g>
            )}
            <rect x={pad.l} y={pad.t} width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
          </svg>
          {hv && (
            <div className="chart-tip" style={{ left: Math.min(x(hover!) + 12, width - 190), top: pad.t }}>
              <strong>{fmtDay(hv.date)}</strong>
              <div><i className="swatch swatch-planned" /> Programado: {hv.planned}</div>
              <div><i className="swatch swatch-done" /> Completado: {hv.done ?? '—'}</div>
              {hv.done != null && hv.planned > 0 && <div className="hint">{Math.round((hv.done / hv.planned) * 100)} % de lo programado</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Barra de avance con su porcentaje (texto en tinta normal; la barra solo acompaña). */
export function ProgressBar({ value, tone }: { value: number | null; tone?: 'warn' | 'danger' }) {
  return (
    <span className="pbar" title={value == null ? 'Sin base' : `${value} %`}>
      <span className="pbar-track"><span className={`pbar-fill${tone ? ` pbar-${tone}` : ''}`} style={{ width: `${Math.min(100, value ?? 0)}%` }} /></span>
      <span className="pbar-num">{value == null ? '—' : `${value.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`}</span>
    </span>
  );
}
