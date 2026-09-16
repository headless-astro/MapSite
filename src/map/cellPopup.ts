// DOM content for the per-cell reveal popup (opened when a rendered tile is
// clicked). Built as plain DOM with listeners that call back into the store, so
// Leaflet handles anchoring/positioning while the store stays the source of
// truth. Rebuilt fresh each open, so it always reflects current reveal state.

import type { Area, Cell, Id } from '../model/types';
import { cellRevealsNpcs, cellRevealsResources, type RevealState } from '../logic/revealController';

export interface CellRevealHandlers {
  toggleCellReveal: (cellId: Id, kind: 'resources' | 'npcs', value: boolean) => void;
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

  root.appendChild(
    revealRow('Reveal resources', cellRevealsResources(cell, reveal), (v) =>
      handlers.toggleCellReveal(cell.id, 'resources', v),
    ),
  );
  root.appendChild(
    revealRow('Reveal NPCs', cellRevealsNpcs(cell, reveal), (v) =>
      handlers.toggleCellReveal(cell.id, 'npcs', v),
    ),
  );
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
