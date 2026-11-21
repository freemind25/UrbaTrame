/* Configuration fermée de la planche éclatée ; aucun texte libre ni code. */
(function (G) {
  'use strict';
  const keys = Object.freeze(['occupation','voirie','bati','poi']);
  const gaps = Object.freeze([30,42,54]);
  function normalize(value) {
    const raw=value && typeof value==='object' && !Array.isArray(value) ? value : {};
    const requested=Array.isArray(raw.order) ? raw.order.filter(x=>keys.includes(x)) : [];
    const order=[...new Set(requested)];
    for (const key of keys) if (!order.includes(key)) order.push(key);
    const visible=Array.isArray(raw.visible) ? [...new Set(raw.visible.filter(x=>keys.includes(x)))] : [...keys];
    return {order,visible:visible.length ? order.filter(x=>visible.includes(x)) : [...order],gap:gaps.includes(raw.gap)?raw.gap:54};
  }
  G.FMAxoLayout=Object.freeze({keys,gaps,normalize});
})(globalThis);
