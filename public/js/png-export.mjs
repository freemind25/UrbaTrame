/* Conversion navigateur d'un SVG en PNG, utilisée par les boutons d'export
   des cartes. Le navigateur rasterise le SVG via Image + Canvas : aucun
   convertisseur externe ni rasterisation côté serveur. */
export function svgElementToPngBlob(svg, {
  scale = 3,
  background = '#fff',
  ImageCtor = globalThis.Image,
  SerializerCtor = globalThis.XMLSerializer,
  documentRef = globalThis.document
} = {}) {
  if (!svg || typeof svg.getAttribute !== 'function')
    return Promise.reject(new Error('SVG_ABSENT'));
  if (typeof ImageCtor !== 'function' || typeof SerializerCtor !== 'function' || !documentRef)
    return Promise.reject(new Error('PNG_BROWSER_API_ABSENT'));

  let xml;
  try { xml = new SerializerCtor().serializeToString(svg); }
  catch (error) { return Promise.reject(error); }

  const vb = (svg.getAttribute('viewBox') || '0 0 240 268').trim().split(/[ ,]+/).map(Number);
  const vbW = Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 240;
  const vbH = Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 268;
  const factor = Number.isFinite(+scale) && +scale > 0 ? +scale : 3;
  const width = Math.max(1, Math.round(vbW * factor));
  const height = Math.max(1, Math.round(vbH * factor));

  let dataUrl;
  try { dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml))); }
  catch (error) { return Promise.reject(error); }

  return new Promise((resolve, reject) => {
    let img;
    try { img = new ImageCtor(); }
    catch (error) { reject(error); return; }

    img.onload = () => {
      try {
        const canvas = documentRef.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('PNG_CANVAS_CONTEXT_ABSENT')); return; }
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG_BLOB_ABSENT')), 'image/png');
      } catch (error) { reject(error); }
    };
    img.onerror = () => reject(new Error('PNG_IMAGE_LOAD_FAILED'));
    try { img.src = dataUrl; }
    catch (error) { reject(error); }
  });
}
