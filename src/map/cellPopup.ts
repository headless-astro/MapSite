// DOM content for the per-cell reveal popup (opened when a rendered tile is
// clicked). Built as plain DOM with listeners that call back into the store, so
// Leaflet handles anchoring/positioning while the store stays the source of
// truth. Rebuilt fresh each open, so it always reflects current reveal state.

import { KIND_LABEL, MARKER_KINDS, REVEAL_KEY } from '../model/types';
import type { Area, Cell, Id, RevealKey } from '../model/types';
import { cellReveals, type RevealState } from '../logic/revealController';

export interface CellRevealHandlers {
  toggleCellReveal: (cellId: Id, kind: RevealKey, value: boolean) => void;
  /** A rendered tile was clicked (the side panel shows its notes). */
  onCellSelected?: (cellId: Id) => void;
}

export function buildCellPopup(
  cell: Cell,
  area: Area | undefined,
  reveal: RevealState,
  handlers: CellRevealHandlers,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cell-popup';

  const title = document.createElement('div');
  title.className = 'cp-title';
  title.textContent = cell.name;
  root.appendChild(title);

  if (area) {
    const a = document.createElement('div');
    a.className = 'cp-sub muted';
    a.textContent = area.name;
    root.appendChild(a);
  }
  if (cell.hidden) {
    const h = document.createElement('div');
    h.className = 'cp-sub muted';
    h.textContent = '🔒 Hidden location';
    root.appendChild(h);
  }

  // One reveal toggle per kind of marker this tile actually has.
  const kindsHere = MARKER_KINDS.filter((k) => cell.markers.some((m) => m.kind === k));
  if (!kindsHere.length) {
    const none = document.createElement('div');
    none.className = 'cp-sub muted';
    none.textContent = 'No markers on this tile.';
    root.appendChild(none);
  }
  for (const k of kindsHere) {
    const key = REVEAL_KEY[k];
    const label = `Reveal ${k === 'npc' ? 'NPCs' : KIND_LABEL[k].many.toLowerCase()}`;
    root.appendChild(
      revealRow(label, cellReveals(cell, reveal, key), (v) => handlers.toggleCellReveal(cell.id, key, v)),
    );
  }
  return root;
}

function revealRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'cp-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  const span = document.createElement('span');
  span.textContent = label;
  row.appendChild(cb);
  row.appendChild(span);
  return row;
}
