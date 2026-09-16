// Draws a translucent region outline (convex hull of the area's cells) with a
// labeled color pill per area, so it's obvious which cells belong together.
// Vector polygons (SVG) so borders stay crisp at any zoom. Non-interactive, in a
// pane below the tiles, so clicks pass through to cells.

import L from 'leaflet';
import type { Vec2, World } from '../model/types';
import { convexHull, expandPolygon, worldToLatLng } from '../model/geometry';

export class AreaLayerManager {
  private group = L.layerGroup();
  private visible = true;

  constructor(
    private map: L.Map,
    private pane: string,
  ) {}

  setAreas(world: World, colorOf: (areaId: string) => string): void {
    this.clear();
    for (const area of world.areas) {
      const pts: Vec2[] = [];
      for (const cell of world.cells) {
        if (cell.areaId !== area.id) continue;
        for (const c of cell.geometry.corners) pts.push(c);
      }
      if (pts.length < 3) continue;

      const hull = expandPolygon(convexHull(pts), 70);
      const latlngs = hull.map((p) => L.latLng(worldToLatLng(p)));
      const color = colorOf(area.id);
      const poly = L.polygon(latlngs, {
        pane: this.pane,
        color,
        weight: 2,
        opacity: 0.75,
        fillColor: color,
        fillOpacity: 0.1,
        dashArray: '6 5',
        interactive: false,
      });
      poly.bindTooltip(
        `<span class="area-pill" style="background:${color}">${escapeHtml(area.name)}</span>`,
        { permanent: true, direction: 'center', className: 'area-label' },
      );
      this.group.addLayer(poly);
    }
    if (this.visible) this.group.addTo(this.map);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.group.addTo(this.map);
    else this.group.remove();
  }

  clear(): void {
    this.group.clearLayers();
    this.group.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
