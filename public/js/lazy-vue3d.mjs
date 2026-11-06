/* Chargement différé du moteur 3D (vue3d.js, script classique qui pose
   globalThis.FMVue3D) : règle perf 22 — l'accueil ne le télécharge plus
   systématiquement, seulement quand une vue/planche/export 3D est demandé.
   L'empreinte ?v= de CE module est réutilisée pour vue3d.js (même version). */
let pending = null;

export function ensureVue3D() {
  if (globalThis.FMVue3D) return Promise.resolve(globalThis.FMVue3D);
  if (pending) return pending;
  const v = new URL(import.meta.url).search || '';
  pending = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vue3d.js' + v;
    s.onload = () => (globalThis.FMVue3D ? resolve(globalThis.FMVue3D) : reject(new Error('FMVue3D absent après chargement')));
    s.onerror = () => { pending = null; reject(new Error('chargement de vue3d.js échoué')); };
    document.head.appendChild(s);
  });
  return pending;
}
