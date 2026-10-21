/* Les couches sont conservées de bas en haut, dans l'ordre de rendu SVG. */
export function layersTopFirst(layers = []) {
  return Array.isArray(layers) ? [...layers].reverse() : [];
}

/** Déplace une couche dans l'ordre visuel (up = vers le sommet de la pile). */
export function moveLayerStack(layers = [], layerId, direction) {
  if (!Array.isArray(layers) || !['up', 'down'].includes(direction)) return Array.isArray(layers) ? [...layers] : [];
  const topFirst = layersTopFirst(layers);
  const from = topFirst.findIndex(layer => layer?.id === layerId);
  if (from < 0) return [...layers];
  const to = from + (direction === 'up' ? -1 : 1);
  if (to < 0 || to >= topFirst.length) return [...layers];
  [topFirst[from], topFirst[to]] = [topFirst[to], topFirst[from]];
  return topFirst.reverse();
}
