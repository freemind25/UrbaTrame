import { runPolygonOverlay } from './polygon-overlay.mjs';
self.addEventListener('message', event => {
  try { const {target,reference,options}=event.data; self.postMessage({ok:true,result:runPolygonOverlay(target,reference,options)}); }
  catch (error) { self.postMessage({ok:false,code:error?.code || 'OVERLAY_FAILED',message:error?.code ? error.message : 'Calcul géométrique impossible ; aucune couche ajoutée.'}); }
});
