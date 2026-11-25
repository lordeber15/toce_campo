import { useMemo, useState } from 'react';
import { LAYER_KINDS, type LayerTreeLeaf } from '@toce/shared';
import { KIND_STYLE } from './MapView';

/** Identificador estable de una carpeta hoja: KMZ + ruta de carpetas. */
export const leafId = (l: Pick<LayerTreeLeaf, 'sourceFile' | 'folderPath'>) => JSON.stringify([l.sourceFile, ...l.folderPath]);

type Node = {
  key: string;
  label: string;
  depth: number;
  sourceFile: string | null;
  path: string[];
  /** Elementos que están directamente en esta carpeta (si los hay). */
  leaf?: LayerTreeLeaf;
  children: Node[];
  /** Todas las hojas de este nodo y sus descendientes. */
  leafIds: string[];
  count: number;
  root?: { title: string; brigadeId: string | null; brigadeName: string | null };
};

/** Arma el árbol KMZ -> carpetas -> subcarpetas a partir de las hojas (ya vienen en el orden del archivo). */
export function buildTree(leaves: LayerTreeLeaf[]): Node[] {
  const roots: Node[] = [];
  const byKey = new Map<string, Node>();
  for (const l of leaves) {
    const rootKey = JSON.stringify([l.sourceFile]);
    let node = byKey.get(rootKey);
    if (!node) {
      const title = l.sourceTitle || l.sourceFile?.replace(/\.(kmz|kml)$/i, '') || 'Capas sin archivo';
      node = { key: rootKey, label: title, depth: 0, sourceFile: l.sourceFile, path: [], children: [], leafIds: [], count: 0,
        root: { title, brigadeId: l.brigadeId, brigadeName: l.brigadeName } };
      byKey.set(rootKey, node);
      roots.push(node);
    }
    const id = leafId(l);
    node.leafIds.push(id);
    node.count += l.count;
    for (let i = 0; i < l.folderPath.length; i++) {
      const path = l.folderPath.slice(0, i + 1);
      const key = JSON.stringify([l.sourceFile, ...path]);
      let child = byKey.get(key);
      if (!child) {
        child = { key, label: path[i]!, depth: i + 1, sourceFile: l.sourceFile, path, children: [], leafIds: [], count: 0 };
        byKey.set(key, child);
        node.children.push(child);
      }
      child.leafIds.push(id);
      child.count += l.count;
      node = child;
    }
    node.leaf = l;
  }
  return roots;
}

/** Por defecto todo visible menos las unidades de vegetación (son la mayor parte del peso). */
export const defaultOn = (l: LayerTreeLeaf) => l.kind !== 'uv';

const STORE = 'toce.layers.on.';
function readOn(projectId: string): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE + projectId) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Visibilidad de cada carpeta hoja (se recuerda en este navegador, por proyecto). */
export function useLayerVisibility(projectId: string | undefined, leaves: LayerTreeLeaf[]) {
  const [state, setState] = useState<{ projectId?: string; on: Record<string, boolean> }>({ on: {} });
  const stored = useMemo(() => (projectId ? readOn(projectId) : {}), [projectId]);
  const on = state.projectId === projectId ? state.on : stored;
  const visible = useMemo(() => new Set(leaves.filter((l) => on[leafId(l)] ?? defaultOn(l)).map(leafId)), [leaves, on]);
  const set = (ids: string[], value: boolean) => {
    if (!projectId) return;
    const next = { ...on };
    for (const id of ids) next[id] = value;
    setState({ projectId, on: next });
    try { localStorage.setItem(STORE + projectId, JSON.stringify(next)); } catch { /* sin almacenamiento: solo dura la sesión */ }
  };
  return { visible, set };
}

const SHORT: Record<string, string> = { huella: 'Huella', aid: 'AID', aii: 'AII', uv: 'UV', superposicion: 'Superpos.', otro: 'Otra' };

type Props = {
  leaves: LayerTreeLeaf[];
  visible: Set<string>;
  onToggle: (ids: string[], on: boolean) => void;
  /** Hojas que aún se están descargando. */
  loading?: Set<string>;
  brigades?: { id: string; name: string }[];
  /** Solo administradores: cambiar tipo / brigada, borrar un KMZ. */
  admin?: {
    setKind: (sourceFile: string | null, folderPath: string[], kind: string) => void;
    setBrigade: (sourceFile: string | null, brigadeId: string | null) => void;
    remove: (sourceFile: string | null, title: string) => void;
  };
};

export function LayerTree({ leaves, visible, onToggle, loading, brigades = [], admin }: Props) {
  const tree = useMemo(() => buildTree(leaves), [leaves]);
  // Plegado: los KMZ abiertos, las carpetas cerradas (se recuerda mientras dure la página).
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const isOpen = (n: Node) => (n.depth === 0 ? !open.has(n.key) : open.has(n.key));
  const flip = (k: string) => setOpen((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; });

  const row = (n: Node): React.ReactNode => {
    const shown = n.leafIds.filter((id) => visible.has(id)).length;
    const state = shown === 0 ? 'none' : shown === n.leafIds.length ? 'all' : 'some';
    const expandable = n.children.length > 0;
    const expanded = expandable && isOpen(n);
    const busy = loading && n.leafIds.some((id) => loading.has(id) && visible.has(id));
    const color = n.leaf ? n.leaf.color || KIND_STYLE[n.leaf.kind]?.color : undefined;
    return (
      <li key={n.key} role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-selected={false}>
        <div className={'ltree-row' + (n.depth === 0 ? ' ltree-root' : '')} style={{ paddingLeft: 6 + n.depth * 18 }}>
          {expandable
            ? <button type="button" className="ltree-chevron" aria-label={expanded ? `Plegar ${n.label}` : `Desplegar ${n.label}`} onClick={() => flip(n.key)}>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ transform: expanded ? 'none' : 'rotate(-90deg)' }}><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            : <span className="ltree-chevron" aria-hidden="true" />}
          <label className="ltree-label">
            <input
              type="checkbox"
              checked={state === 'all'}
              ref={(el) => { if (el) el.indeterminate = state === 'some'; }}
              onChange={() => onToggle(n.leafIds, state !== 'all')}
            />
            {color && <i className="ltree-swatch" style={{ background: color }} />}
            <span className="ltree-name" title={n.label}>{n.label}</span>
          </label>
          {busy && <span className="ltree-busy" aria-label="Cargando" />}
          <span className="ltree-count">{n.count.toLocaleString('es-PE')}</span>
          {admin && n.leaf && !expandable && (
            <select className="input ltree-kind" value={n.leaf.kind} aria-label={`Tipo de ${n.label}`}
              onChange={(e) => admin.setKind(n.sourceFile, n.path, e.target.value)}>
              {LAYER_KINDS.map((k) => <option key={k} value={k}>{SHORT[k]}</option>)}
            </select>
          )}
        </div>
        {n.root && (admin || n.root.brigadeName) && (
          <div className="ltree-meta" style={{ paddingLeft: 6 + 18 + 26 }}>
            {admin ? (
              <>
                <select className="input" value={n.root.brigadeId ?? ''} aria-label={`Brigada de ${n.label}`}
                  onChange={(e) => admin.setBrigade(n.sourceFile, e.target.value || null)}>
                  <option value="">Todo el proyecto</option>
                  {brigades.map((b) => <option key={b.id} value={b.id}>Brigada {b.name}</option>)}
                </select>
                <button type="button" className="btn btn-sm" onClick={() => admin.remove(n.sourceFile, n.label)}>Eliminar KMZ</button>
              </>
            ) : <span className="chip">Brigada {n.root.brigadeName}</span>}
          </div>
        )}
        {expanded && <ul role="group">{n.children.map(row)}</ul>}
      </li>
    );
  };

  if (!tree.length) return <div className="empty">Importa un KMZ con las capas del proyecto.</div>;
  return <ul className="ltree" role="tree" aria-label="Capas del proyecto">{tree.map(row)}</ul>;
}
