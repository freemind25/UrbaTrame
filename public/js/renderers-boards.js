/* UrbaTrame — planches Max
   Huit analyses vectorielles composées au format A3 paysage. Elles utilisent
   les couches OSM déjà planifiées et normalisées par l’application. */
(function (G) {
  'use strict';
  const E = G.FMEngine;
  const R = G.FMRender;
  const esc = E.esc;
  const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
  const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
  const W = 420, H = 297;

  const PALETTES = [
    { paper:'#F4F1E8', panel:'#FCFBF7', map:'#F1EFE6', ink:'#21342F', muted:'#718078', line:'#D8DCD3', grid:'#E1E2DA', accent:'#27665A', hot:'#D97559', road:'#C8BFAE', major:'#9C8A70', building:'#D6D1C5', green:'#8FAF90', water:'#9EC5CF', land:'#E8E2D2', civic:'#A6B5C2', retail:'#E2B875', industry:'#C9B0A5', other:'#BBB9B1', pale:'#E8EEE7', deep:'#19483F', mid:'#5C8879', high:'#B95445', white:'#FFFFFF', shadow:'#AEB7AD' },
    { paper:'#EDF3F0', panel:'#FAFCFB', map:'#EAF0ED', ink:'#1E3435', muted:'#6E8281', line:'#D4DFDB', grid:'#DDE7E3', accent:'#267C78', hot:'#D18A56', road:'#BBCBC6', major:'#779891', building:'#D3DEDA', green:'#77AA91', water:'#85BCC5', land:'#D9E7DD', civic:'#91AEBB', retail:'#E5C184', industry:'#B9A3A0', other:'#AFBCB8', pale:'#E1EEEA', deep:'#1D5F5B', mid:'#4B9690', high:'#C16A46', white:'#FFFFFF', shadow:'#A6B8B2' },
    { paper:'#F2EFF6', panel:'#FCFAFE', map:'#F0EDF5', ink:'#312C3C', muted:'#7D7589', line:'#DDD7E5', grid:'#E5E0EA', accent:'#705B98', hot:'#CC6D66', road:'#C8C1D1', major:'#91839E', building:'#D9D2E1', green:'#A0B69A', water:'#9DBDD1', land:'#E6E0EA', civic:'#ADA0C1', retail:'#E4BA8D', industry:'#C3A3A0', other:'#B9B2C0', pale:'#ECE7F3', deep:'#57437D', mid:'#8773AA', high:'#B6535E', white:'#FFFFFF', shadow:'#B8B0C3' },
    { paper:'#202A28', panel:'#293633', map:'#1D2926', ink:'#EAF1EC', muted:'#A6B5AC', line:'#465650', grid:'#35443E', accent:'#76B5A2', hot:'#F08B6E', road:'#65766D', major:'#A6B09F', building:'#59665F', green:'#5D8C72', water:'#5D8790', land:'#536356', civic:'#738A94', retail:'#B59B61', industry:'#92766F', other:'#6C7770', pale:'#34453E', deep:'#315E51', mid:'#6CA58C', high:'#ED826A', white:'#FFFFFF', shadow:'#18211E' },
    { paper:'#F7F0E9', panel:'#FFFCF8', map:'#F6EEE7', ink:'#3A2D2A', muted:'#897871', line:'#E5D9D1', grid:'#EDE1D8', accent:'#A85543', hot:'#D5964C', road:'#D0BDAE', major:'#AA8875', building:'#E2D2C8', green:'#97AE8A', water:'#9CBFC8', land:'#EFE0D2', civic:'#B29AAA', retail:'#E3BB76', industry:'#C5917A', other:'#C1B2A6', pale:'#F1E4DA', deep:'#803E33', mid:'#B16A53', high:'#C45444', white:'#FFFFFF', shadow:'#C9B6A9' },
    { paper:'#EEF1F5', panel:'#FCFDFE', map:'#EBEFF4', ink:'#28323F', muted:'#737F8F', line:'#D9E0E8', grid:'#E1E7ED', accent:'#416A9A', hot:'#C96D55', road:'#BEC9D5', major:'#7C8FA3', building:'#D4DAE0', green:'#91B29F', water:'#8FB8CE', land:'#DFE5E9', civic:'#91AFC8', retail:'#D8B77B', industry:'#B69FA0', other:'#B6BDC5', pale:'#E3EAF2', deep:'#31557E', mid:'#668CB2', high:'#B94F46', white:'#FFFFFF', shadow:'#ADB9C7' }
  ];
  let clipSerial = 0;

  const tr = (ctx, fr, en) => ctx && ctx.lang === 'en' ? en : fr;
  const nval = (x, d=0) => Number.isFinite(+x) ? +x : d;
  const safe = x => esc(String(x == null ? '' : x));
  const norm = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const nfmt = x => Math.round(nval(x)).toLocaleString('fr-FR');
  const distanceLabel = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',') + ' km' : Math.round(m) + ' m';
  const areaLabel = a => a >= 1000000 ? (a / 1000000).toFixed(2).replace('.', ',') + ' km²' : Math.round(a).toLocaleString('fr-FR') + ' m²';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const palette = sc => PALETTES[((Math.floor(nval(sc)) % PALETTES.length) + PALETTES.length) % PALETTES.length];
  const escFont = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function siteOf(ctx) {
    return {
      lat: Number.isFinite(+ctx.sLat) ? +ctx.sLat : 0,
      lon: Number.isFinite(+ctx.sLng) ? +ctx.sLng : 0,
      radius: Math.max(1, nval(ctx.curR, 600))
    };
  }
  function localXY(ctx, lat, lon) {
    const s = siteOf(ctx), c = Math.cos(s.lat * Math.PI / 180);
    return { e: (nval(lon, s.lon) - s.lon) * 111320 * c, n: (nval(lat, s.lat) - s.lat) * 111320 };
  }
  function coords(g) {
    return (Array.isArray(g) ? g : []).map(p => Array.isArray(p)
      ? [nval(p[0], NaN), nval(p[1], NaN)]
      : [nval(p && p.lat, NaN), nval(p && (p.lon == null ? p.lng : p.lon), NaN)])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
  function ringCoords(g) {
    const pts = coords(g);
    if (pts.length > 3 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-10 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-10) pts.pop();
    return pts;
  }
  function geometryEN(g, ctx) { return ringCoords(g).map(p => localXY(ctx, p[0], p[1])); }
  function segmentLengthInCircle(a,b,r) {
    const dx=b.e-a.e,dy=b.n-a.n,A=dx*dx+dy*dy;
    if(A<1e-12) return 0;
    const B=2*(a.e*dx+a.n*dy),C=a.e*a.e+a.n*a.n-r*r,disc=B*B-4*A*C;
    if(disc<0) return C<=0?Math.sqrt(A):0;
    const root=Math.sqrt(disc),lo=Math.max(0,(-B-root)/(2*A)),hi=Math.min(1,(-B+root)/(2*A));
    return hi>lo?Math.sqrt(A)*(hi-lo):0;
  }
  function segmentLengthInSquare(a,b,r) {
    const dx=b.e-a.e,dy=b.n-a.n;let lo=0,hi=1;
    for(const [p,q] of [[-dx,a.e+r],[dx,r-a.e],[-dy,a.n+r],[dy,r-a.n]]) {
      if(Math.abs(p)<1e-12) { if(q<0) return 0; continue; }
      const t=q/p;
      if(p<0) lo=Math.max(lo,t); else hi=Math.min(hi,t);
      if(hi<=lo) return 0;
    }
    return Math.hypot(dx,dy)*(hi-lo);
  }
  function lineLengthWithin(ctx,g) {
    const pts=coords(g).map(p=>localXY(ctx,p[0],p[1])),s=siteOf(ctx),r=s.radius*1.02;
    let sum=0;
    for(let i=1;i<pts.length;i++) {
      const a=pts[i-1],b=pts[i];
      if((ctx.shape==='square'||ctx.shape==='rect')&&!Array.isArray(ctx.sitePolygon)) sum+=segmentLengthInSquare(a,b,r);
      else if(Array.isArray(ctx.sitePolygon)&&ctx.sitePolygon.length>=3) {
        const length=Math.hypot(b.e-a.e,b.n-a.n),steps=Math.max(2,Math.ceil(length/12));
        for(let j=0;j<steps;j++) {
          const f=(j+0.5)/steps,q={e:a.e+(b.e-a.e)*f,n:a.n+(b.n-a.n)*f};
          if(inExtentEN(ctx,q.e,q.n)) sum+=length/steps;
        }
      } else sum+=segmentLengthInCircle(a,b,r);
    }
    return sum;
  }
  function areaAndCenter(g, ctx) {
    const pts = geometryEN(g, ctx);
    if (pts.length < 3) return { area: 0, e: 0, n: 0 };
    let a2 = 0, ce = 0, cn = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], cross = a.e * b.n - b.e * a.n;
      a2 += cross; ce += (a.e + b.e) * cross; cn += (a.n + b.n) * cross;
    }
    if (Math.abs(a2) < 1e-7) {
      return { area: 0, e: pts.reduce((s,p)=>s+p.e,0)/pts.length, n: pts.reduce((s,p)=>s+p.n,0)/pts.length };
    }
    return { area: Math.abs(a2) / 2, e: ce / (3 * a2), n: cn / (3 * a2) };
  }
  function siteArea(ctx) {
    const s = siteOf(ctx), shape = String(ctx.shape || 'circle');
    const p = Array.isArray(ctx.sitePolygon) ? ctx.sitePolygon.map(q => Array.isArray(q)
      ? { e: localXY(ctx, q[0], q[1]).e, n: localXY(ctx, q[0], q[1]).n }
      : localXY(ctx, q && q.lat, q && (q.lon == null ? q.lng : q.lon))) : [];
    if (p.length >= 3) {
      let twice = 0;
      for (let i=0;i<p.length;i++) twice += p[i].e*p[(i+1)%p.length].n - p[(i+1)%p.length].e*p[i].n;
      if (Math.abs(twice)>0) return Math.abs(twice)/2;
    }
    return shape === 'circle' ? Math.PI*s.radius*s.radius : 4*s.radius*s.radius;
  }
  function centroidGeo(g, ctx) {
    const c = areaAndCenter(g, ctx), s = siteOf(ctx), cos = Math.cos(s.lat * Math.PI / 180) || 1;
    return { e: c.e, n: c.n, lat: s.lat + c.n / 111320, lon: s.lon + c.e / (111320 * cos), area: c.area };
  }
  function inExtentEN(ctx,e,n,radius) {
    const s=siteOf(ctx),r=radius==null?s.radius:Math.max(1,nval(radius,s.radius));
    if(radius!=null&&r<s.radius*0.999) return Math.hypot(e,n)<=r*1.02;
    if(Array.isArray(ctx.sitePolygon)&&ctx.sitePolygon.length>=3) {
      const poly=ctx.sitePolygon.map(q=>Array.isArray(q)?localXY(ctx,q[0],q[1]):localXY(ctx,q&&q.lat,q&&(q.lon==null?q.lng:q.lon)));
      let inside=false;
      for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
        const a=poly[i],b=poly[j];
        if((a.n>n)!==(b.n>n)&&e<(b.e-a.e)*(n-a.n)/(b.n-a.n)+a.e) inside=!inside;
      }
      return inside;
    }
    if(ctx.shape==='square'||ctx.shape==='rect') return Math.abs(e)<=r*1.02&&Math.abs(n)<=r*1.02;
    return Math.hypot(e,n)<=r*1.02;
  }
  function inExtent(ctx,lat,lon,radius) {
    const q=localXY(ctx,lat,lon);
    return inExtentEN(ctx,q.e,q.n,radius);
  }
  function geometryCenterInExtent(ctx,g) {
    const c=areaAndCenter(g,ctx);
    return c.area>0&&inExtentEN(ctx,c.e,c.n);
  }

  function text(x, y, value, size, fill, opts={}) {
    const anchor = opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '';
    const weight = opts.weight ? ' font-weight="' + opts.weight + '"' : '';
    const family = opts.mono ? MONO : FONT;
    const opacity = opts.opacity == null ? '' : ' opacity="' + opts.opacity + '"';
    const letter = opts.letter == null ? '' : ' letter-spacing="' + opts.letter + '"';
    return '<text x="' + (+x).toFixed(2) + '" y="' + (+y).toFixed(2) + '" font-family="' + family + '" font-size="' + size + '" fill="' + fill + '"' + anchor + weight + opacity + letter + '>' + safe(value) + '</text>';
  }
  function rounded(x,y,w,h,fill,stroke,r=2,sw=0.35) {
    return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"/>';
  }
  function line(x1,y1,x2,y2,stroke,width=0.4,dash='') {
    return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+stroke+'" stroke-width="'+width+'"'+(dash?' stroke-dasharray="'+dash+'"':'')+'/>';
  }
  function metricTile(ctx,p,x,y,w,label,value,detail='') {
    let s = rounded(x,y,w,27,p.panel,p.line,1.5,0.3);
    s += text(x+3,y+6,label.toUpperCase(),2.3,p.muted,{weight:700,letter:0.18});
    s += text(x+3,y+17,String(value),6.2,p.ink,{weight:700,mono:true});
    if (detail) s += text(x+3,y+23,detail,2.25,p.muted);
    return s;
  }
  function panelTitle(x,y,w,label,p) {
    return text(x,y,label.toUpperCase(),2.65,p.muted,{weight:700,letter:0.22}) + line(x,y+3,w+x,y+3,p.line,0.35);
  }
  function legendItem(x,y,color,label,p,shape='rect') {
    const mark = shape === 'line' ? line(x,y-1,x+5,y-1,color,0.8) : shape === 'circle'
      ? '<circle cx="'+(x+2.2)+'" cy="'+(y-1)+'" r="1.5" fill="'+color+'"/>'
      : '<rect x="'+x+'" y="'+(y-2.5)+'" width="4.5" height="3" rx="0.5" fill="'+color+'"/>';
    return mark + text(x+7,y,label,2.5,p.ink);
  }
  function bar(ctx,p,x,y,w,label,value,max,color) {
    const denom = Math.max(1, nval(max,1));
    let s = text(x,y,label,2.5,p.ink);
    s += rounded(x,y+1.5,w,2.5,p.grid,p.grid,1,0);
    s += rounded(x,y+1.5,Math.max(0.5,w*clamp(nval(value)/denom,0,1)),2.5,color,color,1,0);
    s += text(x+w,y, nfmt(value),2.3,p.muted,{anchor:'end',mono:true});
    return s;
  }
  function truncate(s,n=24) { s=String(s||'').trim(); return s.length>n ? s.slice(0,n-1)+'…' : (s||'—'); }

  function mapProjector(ctx, box, radius) {
    const s = siteOf(ctx), r = Math.max(1,nval(radius,s.radius));
    const side = Math.max(20,Math.min(box.w,box.h)-9);
    const scale = side/(2*r);
    const cx = box.x + box.w/2, cy = box.y + box.h/2;
    const project = (lat,lon) => {
      const q = localXY(ctx,lat,lon);
      return [cx+q.e*scale,cy-q.n*scale];
    };
    const projectEN = (e,n) => [cx+e*scale,cy-n*scale];
    const id = 'utb-map-' + (++clipSerial);
    let shape = 'circle';
    if (r >= s.radius*0.999 && ctx.shape === 'square') shape = 'square';
    else if (r >= s.radius*0.999 && ctx.shape === 'rect') shape = 'rect';
    let custom = [];
    if (r >= s.radius*0.999 && Array.isArray(ctx.sitePolygon)) {
      custom = ctx.sitePolygon.map(q => Array.isArray(q) ? project(q[0],q[1]) : project(q && q.lat,q && (q.lon == null ? q.lng : q.lon)));
      if (custom.length < 3 || custom.some(q=>!Number.isFinite(q[0])||!Number.isFinite(q[1]))) custom=[];
    }
    let path;
    if (custom.length>=3) path='<polygon points="'+custom.map(q=>q[0].toFixed(2)+','+q[1].toFixed(2)).join(' ')+'"/>';
    else if (shape==='square') path='<rect x="'+(cx-r*scale)+'" y="'+(cy-r*scale)+'" width="'+(2*r*scale)+'" height="'+(2*r*scale)+'"/>';
    else if (shape==='rect') path='<rect x="'+(cx-r*scale)+'" y="'+(cy-r*scale)+'" width="'+(2*r*scale)+'" height="'+(2*r*scale)+'" rx="2.5"/>';
    else path='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*scale)+'"/>';
    return { box, radius:r, scale, cx,cy,project,projectEN,id,clipShape:path,siteRadiusPx:s.radius*scale, shape,extentPx:r*scale };
  }
  function mapShell(ctx,p,m,inside,opts={}) {
    const b=m.box, borderColor=opts.border || p.line;
    const bg='<rect x="'+b.x+'" y="'+b.y+'" width="'+b.w+'" height="'+b.h+'" rx="1.5" fill="'+p.map+'" stroke="'+borderColor+'" stroke-width="0.4"/>';
    const clip='<defs><clipPath id="'+m.id+'" clipPathUnits="userSpaceOnUse">'+m.clipShape+'</clipPath></defs>';
    const boundary='<g clip-path="url(#'+m.id+')">'+inside+'</g>';
    const outline=m.clipShape.replace(/<(circle|rect|polygon) /,(_match,tag)=>'<'+tag+' fill="none" stroke="'+p.accent+'" stroke-width="0.65" stroke-dasharray="2.2 1.4" ');
    let aux='';
    if(opts.north!==false) {
      const x=b.x+b.w-10,y=b.y+11;
      aux+=text(x,y-4,'N',2.4,p.ink,{anchor:'middle',weight:700});
      aux+='<path d="M '+x+' '+(y+4)+' L '+(x-2.1)+' '+(y+0.4)+' L '+x+' '+(y-5)+' L '+(x+2.1)+' '+(y+0.4)+' Z" fill="'+p.ink+'"/>';
      aux+='<path d="M '+x+' '+(y+4)+' L '+(x-2.1)+' '+(y+0.4)+' L '+x+' '+(y-5)+' Z" fill="'+p.paper+'"/>';
    }
    if(opts.scale!==false) aux+=scaleBar(ctx,p,m);
    return bg+clip+boundary+outline+aux;
  }
  function scaleBar(ctx,p,m) {
    const b=m.box, maxPx=Math.min(34,b.w*0.22), candidates=[2000,1000,500,250,100,50,25];
    let metres=candidates.find(v=>v*m.scale<=maxPx && v*m.scale>=12) || 10;
    const px=metres*m.scale, x=b.x+7,y=b.y+b.h-7;
    return line(x,y,x+px,y,p.ink,0.65)+line(x,y-1.4,x,y+1.2,p.ink,0.55)+line(x+px,y-1.4,x+px,y+1.2,p.ink,0.55)+
      text(x,y-2.3,distanceLabel(metres),2.35,p.ink,{mono:true});
  }
  function projectGeom(g,m) {
    return coords(g).map(q=>m.project(q[0],q[1]));
  }
  function ptsAttr(pts) { return pts.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join(' '); }
  function pathAttr(pts) { return pts.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' '); }
  function landClass(g) {
    const t=norm([g.lu,g.k,g.n].join(' '));
    if(g.k==='w'||/water|wetland|basin|reservoir|coast/.test(t)) return 'water';
    if(/industrial|construction|works|railway|military/.test(t)) return 'industry';
    if(/commercial|retail|market|shop/.test(t)) return 'retail';
    if(/school|hospital|clinic|public|civic|cemetery|relig|gare routiere/.test(t)) return 'civic';
    if(/residential|housing|habitat/.test(t)) return 'residential';
    if(/park|garden|forest|wood|meadow|grass|nature|green|parc|arboretum|scrub/.test(t)||g.k==='g') return 'green';
    return 'land';
  }
  function buildingClass(b) {
    const t=norm([b.t,b.u,b.n].join(' '));
    if(/industrial|warehouse|factory|works|workshop|hangar/.test(t)) return 'industry';
    if(/school|university|college|hospital|clinic|police|civic|public|administr|mosque|church|place of worship|townhall/.test(t)) return 'civic';
    if(/commercial|retail|shop|office|market|restaurant|hotel|store/.test(t)) return 'retail';
    if(/apartments|residential|house|detached|terrace|dormitory|bungalow|semidetached/.test(t)) return 'residential';
    return 'other';
  }
  function poiClass(p) {
    const t=norm([p.k,p.a,p.s,p.l,p.to,p.n].join(' '));
    if(p.k==='transit'||/bus station|bus stop|tram stop|station|public transport|subway entrance|railway/.test(t)) return 'transit';
    if(/school|university|college|hospital|clinic|doctor|pharmacy|police|townhall|post office|library|place of worship/.test(t)) return 'civic';
    if(/shop|supermarket|market|restaurant|cafe|bakery|bank|commercial|retail|fast food|butcher/.test(t)) return 'retail';
    if(/park|garden|playground/.test(t)) return 'green';
    return 'other';
  }
  function classColor(p,k) {
    return ({water:p.water,industry:p.industry,retail:p.retail,civic:p.civic,residential:p.building,green:p.green,land:p.land,other:p.other,transit:p.hot})[k] || p.other;
  }
  function greenLayer(ctx,p,m,opts={}) {
    let out='';
    for(const g of (ctx.D&&ctx.D.green)||[]) {
      const pts=projectGeom(g.g,m); if(pts.length<3) continue;
      const k=landClass(g), fill=opts.color ? opts.color(g,k) : classColor(p,k);
      out+='<polygon points="'+ptsAttr(pts)+'" fill="'+fill+'" fill-opacity="'+(opts.opacity==null?0.82:opts.opacity)+'" stroke="'+p.panel+'" stroke-width="0.22"/>';
    }
    return out;
  }
  function buildingLayer(ctx,p,m,opts={}) {
    let out='';
    for(const b of (ctx.D&&ctx.D.build)||[]) {
      const pts=projectGeom(b.g,m); if(pts.length<3) continue;
      const fill=opts.color ? opts.color(b,buildingClass(b)) : p.building;
      out+='<polygon points="'+ptsAttr(pts)+'" fill="'+fill+'" fill-opacity="'+(opts.opacity==null?0.91:opts.opacity)+'" stroke="'+(opts.stroke||p.panel)+'" stroke-width="0.2"/>';
    }
    return out;
  }
  function roadLayer(ctx,p,m,opts={}) {
    let out='';
    for(const r of (ctx.D&&ctx.D.roads)||[]) {
      const pts=projectGeom(r.g,m); if(pts.length<2) continue;
      const h=norm(r.h), major=/motorway|trunk|primary|secondary/.test(h), foot=/footway|path|steps|cycleway/.test(h);
      const stroke=major?p.major:(opts.roadColor||p.road), sw=major?0.95:(foot?0.28:0.46);
      out+='<path d="'+pathAttr(pts)+'" fill="none" stroke="'+stroke+'" stroke-width="'+sw+'" stroke-linecap="round" stroke-linejoin="round" opacity="'+(opts.opacity==null?0.94:opts.opacity)+'"/>';
    }
    return out;
  }
  function railLayer(ctx,p,m) {
    let out='';
    for(const r of (ctx.D&&ctx.D.rail)||[]) {
      const pts=projectGeom(r.g,m); if(pts.length<2) continue;
      out+='<path d="'+pathAttr(pts)+'" fill="none" stroke="'+p.hot+'" stroke-width="0.8" stroke-dasharray="2.1 1.2" stroke-linecap="round"/>';
    }
    return out;
  }
  function coastLayer(ctx,p,m) {
    let out='';
    for(const c of (ctx.D&&ctx.D.coast)||[]) {
      const pts=projectGeom(c.g,m); if(pts.length<2) continue;
      out+='<path d="'+pathAttr(pts)+'" fill="none" stroke="'+p.water+'" stroke-width="0.9" stroke-linecap="round"/>';
    }
    return out;
  }
  function poiLayer(ctx,p,m,opts={}) {
    let out='';
    for(const q of (ctx.D&&ctx.D.pois)||[]) {
      const [x,y]=m.project(q.y,q.x); if(!Number.isFinite(x)||!Number.isFinite(y)) continue;
      const k=poiClass(q), c=opts.color ? opts.color(q,k) : (k==='transit'?p.hot:k==='civic'?p.civic:k==='retail'?p.retail:k==='green'?p.green:p.accent);
      if(k==='transit') out+='<rect x="'+(x-0.9)+'" y="'+(y-0.9)+'" width="1.8" height="1.8" fill="'+c+'" stroke="'+p.panel+'" stroke-width="0.3" transform="rotate(45 '+x+' '+y+')"/>';
      else out+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="'+(opts.r||0.85)+'" fill="'+c+'" stroke="'+p.panel+'" stroke-width="0.28"/>';
    }
    return out;
  }
  function siteDot(m,p) {
    return '<circle cx="'+m.cx+'" cy="'+m.cy+'" r="2.1" fill="'+p.paper+'" stroke="'+p.accent+'" stroke-width="0.8"/><circle cx="'+m.cx+'" cy="'+m.cy+'" r="0.75" fill="'+p.accent+'"/>';
  }
  function mapBase(ctx,p,m,opts={}) {
    let s='';
    if(opts.green!==false) s+=greenLayer(ctx,p,m,opts.greenOptions||{});
    if(opts.buildings!==false) s+=buildingLayer(ctx,p,m,opts.buildingOptions||{});
    if(opts.coast) s+=coastLayer(ctx,p,m);
    if(opts.rail) s+=railLayer(ctx,p,m);
    if(opts.roads!==false) s+=roadLayer(ctx,p,m,opts.roadOptions||{});
    if(opts.pois) s+=poiLayer(ctx,p,m,opts.poiOptions||{});
    return s;
  }

  function page(ctx,id,p,conf,body) {
    const title=tr(ctx,conf.title,conf.en), sub=tr(ctx,conf.sub,conf.subEn);
    const siteName=truncate(ctx.siteName||tr(ctx,'Site étudié','Study site'),42);
    const s=siteOf(ctx), wm=(!ctx.isPro && ctx.watermark!==false);
    let watermark='';
    if(wm) {
      let tiles='';
      for(let y=55;y<288;y+=48) for(let x=20;x<440;x+=102)
        tiles+='<text x="'+x+'" y="'+y+'" font-family="'+MONO+'" font-size="3.1" fill="'+(p.dark?'#FFFFFF':'#1A1917')+'" fill-opacity="0.085" transform="rotate(-27 '+x+' '+y+')">UrbaTrame · essai</text>';
      watermark='<g data-fm-watermark="true" pointer-events="none">'+tiles+'</g>';
    }
    let out='<svg viewBox="0 0 '+W+' '+H+'" width="420mm" height="297mm" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+safe('UrbaTrame — '+title)+'">';
    out+='<title>'+safe('UrbaTrame — '+title+' — '+siteName)+'</title><rect width="420" height="297" fill="'+p.paper+'"/>';
    out+=text(15,10,'URBATRAME   /   ANALYSE DES SITES URBAINS',2.5,p.accent,{weight:700,letter:0.26});
    out+=text(15,24,title,8.2,p.ink,{weight:700});
    out+=text(15,32.5,sub,3.0,p.muted);
    out+=text(405,10,siteName,3.1,p.ink,{anchor:'end',weight:700});
    out+=text(405,16,Number.isFinite(s.lat)&&Number.isFinite(s.lon)?s.lat.toFixed(5)+'°, '+s.lon.toFixed(5)+'°':'—',2.55,p.muted,{anchor:'end',mono:true});
    out+=text(405,22,'R = '+Math.round(s.radius)+' m',2.55,p.muted,{anchor:'end',mono:true});
    out+=line(15,38,405,38,p.line,0.45);
    out+=body;
    out+=line(15,281,405,281,p.line,0.4);
    out+=text(15,288,'© OpenStreetMap contributors · ODbL',2.45,p.muted,{weight:600});
    out+=text(405,288,tr(ctx,'Lecture indicative des objets cartographiés · non cadastrale','Indicative reading of mapped features · not cadastral'),2.3,p.muted,{anchor:'end'});
    out+=watermark+'</svg>';
    return out;
  }
  function mainMap(ctx,p,opts={}) { return mapProjector(ctx,{x:15,y:43,w:280,h:229},opts.radius==null?siteOf(ctx).radius:opts.radius); }
  function sideBox(p,x=303,y=43,w=102,h=229) { return rounded(x,y,w,h,p.panel,p.line,1.8,0.4); }
  function simpleSiteLegend(ctx,p,x,y) {
    let s=legendItem(x,y,p.road,tr(ctx,'Voirie','Roads'),p,'line');
    s+=legendItem(x+38,y,p.building,tr(ctx,'Bâti','Buildings'),p);
    s+=legendItem(x,y+7,p.green,tr(ctx,'Vert','Green'),p);
    s+=legendItem(x+38,y+7,p.accent,tr(ctx,'POI','POIs'),p,'circle');
    return s;
  }
  function distanceOf(ctx,p) { const q=localXY(ctx,p.y,p.x); return Math.hypot(q.e,q.n); }
  function poiName(ctx,p) {
    const name=String(p.n||'').trim();
    if(name) return truncate(name,25);
    const cls=poiClass(p);
    return ({transit:tr(ctx,'Arrêt / station','Stop / station'),civic:tr(ctx,'Équipement','Facility'),retail:tr(ctx,'Commerce','Shop'),green:tr(ctx,'Espace vert','Green space'),other:tr(ctx,'Point cartographié','Mapped point')})[cls];
  }
  function row(ctx,p,x,y,w,idx,label,detail,color) {
    let s='<circle cx="'+(x+2)+'" cy="'+(y-1.2)+'" r="1.65" fill="'+color+'"/>';
    s+=text(x+6,y,idx+'. '+truncate(label,21),2.55,p.ink,{weight:600});
    if(detail) s+=text(x+w,y,detail,2.35,p.muted,{anchor:'end',mono:true});
    return s;
  }

  /* 1 · Planche de contexte : carte OSM générale, inventaire et repères. */
  R.mappingboard = (ctx,sc) => {
    const p=palette(sc), m=mainMap(ctx,p), d=ctx.D||{};
    const buildingFeatures=(d.build||[]).filter(b=>geometryCenterInExtent(ctx,b.g));
    const greenFeatures=(d.green||[]).filter(g=>geometryCenterInExtent(ctx,g.g));
    const poiFeatures=(d.pois||[]).filter(q=>inExtent(ctx,q.y,q.x));
    const roadLengths=(d.roads||[]).map(r=>lineLengthWithin(ctx,r.g)).filter(length=>length>0);
    const build=buildingFeatures.length, roads=roadLengths.length, greens=greenFeatures.length, pois=poiFeatures.length;
    const roadKm=roadLengths.reduce((a,length)=>a+length,0)/1000;
    const greenA=greenFeatures.reduce((a,g)=>a+areaAndCenter(g.g,ctx).area,0);
    let body=mapShell(ctx,p,m,mapBase(ctx,p,m,{green:true,buildings:true,roads:true,pois:true,rail:true,coast:true})+siteDot(m,p));
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Repères du site','Site markers'),p);
    body+=text(309,61,truncate(ctx.siteName||tr(ctx,'Périmètre étudié','Study area'),31),3.1,p.ink,{weight:700});
    body+=metricTile(ctx,p,309,67,45,tr(ctx,'Bâtiments','Buildings'),nfmt(build),tr(ctx,'emprises OSM','OSM footprints'));
    body+=metricTile(ctx,p,358,67,41,tr(ctx,'Voirie','Roads'),nfmt(roads),roadKm.toFixed(1)+' km');
    body+=metricTile(ctx,p,309,98,45,tr(ctx,'Points','Points'),nfmt(pois),tr(ctx,'POI / nœuds','POIs / nodes'));
    body+=metricTile(ctx,p,358,98,41,tr(ctx,'Vert & eau','Green & water'),nfmt(greens),areaLabel(greenA));
    body+=panelTitle(309,137,93,tr(ctx,'Lecture cartographique','Map reading'),p);
    body+=text(309,147,tr(ctx,'Couches observées dans l’emprise','Mapped layers in the study area'),2.55,p.muted);
    body+=simpleSiteLegend(ctx,p,309,157);
    body+=line(309,177,399,177,p.line,0.35);
    body+=text(309,187,tr(ctx,'Surface d’étude','Study area'),2.5,p.muted,{weight:700});
    body+=text(399,187,areaLabel(siteArea(ctx)),3.1,p.ink,{anchor:'end',mono:true,weight:700});
    body+=text(309,197,tr(ctx,'Réseau viaire mesuré','Mapped road length'),2.45,p.muted);
    body+=text(399,197,roadKm.toFixed(2)+' km',2.6,p.ink,{anchor:'end',mono:true});
    body+=text(309,207,tr(ctx,'Polygones verts / eau','Green / water polygons'),2.45,p.muted);
    body+=text(399,207,nfmt(greens),2.6,p.ink,{anchor:'end',mono:true});
    body+=rounded(309,220,90,37,p.pale,p.line,1.5,0.25);
    body+=text(314,229,tr(ctx,'SOURCE & PORTÉE','SOURCE & SCOPE'),2.2,p.accent,{weight:700,letter:0.14});
    body+=text(314,237,tr(ctx,'Objets présents dans OpenStreetMap.','Features currently mapped in OpenStreetMap.'),2.25,p.ink);
    body+=text(314,245,tr(ctx,'La densité varie selon la couverture locale.','Coverage varies by location.'),2.2,p.muted);
    body+=text(314,252,tr(ctx,'Aucune limite parcellaire inventée.','No parcel boundaries are fabricated.'),2.2,p.muted);
    return page(ctx,'mappingboard',p,{title:'Planche de contexte',en:'Context mapping board',sub:'Cartographie de synthèse · données OpenStreetMap',subEn:'Context map · OpenStreetMap data'},body);
  };

  /* 2 · Nœuds urbains : regroupements spatiaux de POI et pôles de transport. */
  function clusterPoints(ctx,m) {
    const groups=new Map(), step=18;
    for(const q of (ctx.D&&ctx.D.pois)||[]) {
      if(!Number.isFinite(+q.x)||!Number.isFinite(+q.y)||!inExtent(ctx,q.y,q.x,m.radius)) continue;
      const [x,y]=m.project(q.y,q.x), gx=Math.floor((x-m.cx+m.extentPx)/step), gy=Math.floor((y-m.cy+m.extentPx)/step), key=gx+':'+gy;
      let g=groups.get(key); if(!g){g={x:0,y:0,n:0,transit:0,civic:0,retail:0,items:[]};groups.set(key,g);}
      g.x+=x;g.y+=y;g.n++;g.items.push(q);const k=poiClass(q);if(k==='transit')g.transit++;if(k==='civic')g.civic++;if(k==='retail')g.retail++;
    }
    return [...groups.values()].map(g=>({...g,x:g.x/g.n,y:g.y/g.n})).sort((a,b)=>b.n-a.n);
  }
  R.urbanstations = (ctx,sc) => {
    const p=palette(sc),m=mainMap(ctx,p),pois=(ctx.D&&ctx.D.pois)||[],inPois=pois.filter(q=>inExtent(ctx,q.y,q.x)),clusters=clusterPoints(ctx,m);
    let inside='';
    for(const r of [250,500,1000]) if(r<m.radius*0.96) inside+='<circle cx="'+m.cx+'" cy="'+m.cy+'" r="'+(r*m.scale)+'" fill="none" stroke="'+p.mid+'" stroke-width="0.4" stroke-dasharray="2 1.6" opacity="0.7"/>';
    inside+=mapBase(ctx,p,m,{green:true,buildings:true,roads:true,rail:true,coast:true});
    for(let i=0;i<clusters.length;i++) {
      const g=clusters[i], r=clamp(2.5+Math.sqrt(g.n)*0.95,3.2,8.8), c=g.transit?p.hot:p.accent;
      inside+='<circle cx="'+g.x.toFixed(2)+'" cy="'+g.y.toFixed(2)+'" r="'+(r+1).toFixed(2)+'" fill="'+p.panel+'" opacity="0.86"/>';
      inside+='<circle cx="'+g.x.toFixed(2)+'" cy="'+g.y.toFixed(2)+'" r="'+r.toFixed(2)+'" fill="'+c+'" fill-opacity="0.86" stroke="'+p.ink+'" stroke-width="0.32"/>';
      inside+=text(g.x,g.y+0.9,String(g.n),2.25,p.white,{anchor:'middle',weight:700,mono:true});
      if(g.transit) inside+='<path d="M '+(g.x-r-1)+' '+g.y+' l 1.4 -1.4 l 1.4 1.4 l -1.4 1.4 Z" fill="'+p.hot+'" stroke="'+p.panel+'" stroke-width="0.2"/>';
    }
    inside+=siteDot(m,p);
    let body=mapShell(ctx,p,m,inside);
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Pôles & nœuds OSM','OSM hubs & nodes'),p);
    const transit=inPois.filter(q=>poiClass(q)==='transit').length, named=inPois.filter(q=>String(q.n||'').trim()).length;
    body+=metricTile(ctx,p,309,58,43,tr(ctx,'POI cartographiés','Mapped POIs'),inPois.length,tr(ctx,'dans l’emprise','in the study area'));
    body+=metricTile(ctx,p,356,58,43,tr(ctx,'Transport','Transit'),transit,tr(ctx,'arrêts / stations','stops / stations'));
    body+=text(309,94,clusters.length+' '+tr(ctx,'regroupements spatiaux','spatial clusters'),2.5,p.muted);
    body+=panelTitle(309,104,93,tr(ctx,'Pôles les plus denses','Densest hubs'),p);
    const top=clusters.slice(0,6);
    if(!top.length) body+=text(309,119,tr(ctx,'Aucun point cartographié','No mapped points'),2.55,p.muted);
    for(let i=0;i<top.length;i++) {
      const g=top[i], dist=Math.hypot(g.x-m.cx,g.y-m.cy)/m.scale;
      body+=row(ctx,p,309,116+i*11,91,String(i+1).padStart(2,'0'),tr(ctx,'Pôle de services','Service hub')+' · '+g.n,distanceLabel(dist),g.transit?p.hot:p.accent);
    }
    body+=panelTitle(309,190,93,tr(ctx,'Équipements proches','Nearby places'),p);
    const nearest=inPois.slice().sort((a,b)=>distanceOf(ctx,a)-distanceOf(ctx,b)).slice(0,4);
    for(let i=0;i<nearest.length;i++) body+=row(ctx,p,309,202+i*10.5,91,String(i+1).padStart(2,'0'),poiName(ctx,nearest[i]),distanceLabel(distanceOf(ctx,nearest[i])),poiClass(nearest[i])==='transit'?p.hot:p.accent);
    body+=text(309,253,tr(ctx,'Cercles pointillés : 250 / 500 / 1 000 m','Dashed rings: 250 / 500 / 1,000 m'),2.15,p.muted);
    body+=text(309,262,named+' '+tr(ctx,'points nommés dans OSM','named OSM points'),2.15,p.muted);
    return page(ctx,'urbanstations',p,{title:'Nœuds & polarités urbaines',en:'Urban nodes & hubs',sub:'Points de service et transport regroupés spatialement',subEn:'Service and transit points grouped by location'},body);
  };

  /* 3 · Trame de données urbaines : densité OSM agrégée par cellule. */
  R.urbangrid = (ctx,sc) => {
    const p=palette(sc),m=mainMap(ctx,p),N=6,cells=Array.from({length:N*N},()=>({b:0,p:0,g:0})),R0=m.radius;
    const idx=(e,n)=>{
      const i=Math.floor((e+R0)/(2*R0)*N), j=Math.floor((R0-n)/(2*R0)*N);
      return i>=0&&j>=0&&i<N&&j<N?j*N+i:-1;
    };
    for(const b of (ctx.D&&ctx.D.build)||[]) { const c=areaAndCenter(b.g,ctx),i=idx(c.e,c.n); if(i>=0&&inExtentEN(ctx,c.e,c.n))cells[i].b++; }
    for(const q of (ctx.D&&ctx.D.pois)||[]) { const c=localXY(ctx,q.y,q.x),i=idx(c.e,c.n); if(i>=0&&inExtentEN(ctx,c.e,c.n))cells[i].p++; }
    for(const g of (ctx.D&&ctx.D.green)||[]) { const c=areaAndCenter(g.g,ctx),i=idx(c.e,c.n); if(i>=0&&inExtentEN(ctx,c.e,c.n))cells[i].g++; }
    const maxB=Math.max(1,...cells.map(c=>c.b)), maxP=Math.max(1,...cells.map(c=>c.p));
    let inside=greenLayer(ctx,p,m,{opacity:0.42});
    const cell=2*R0*m.scale/N, x0=m.cx-R0*m.scale,y0=m.cy-R0*m.scale;
    for(let j=0;j<N;j++) for(let i=0;i<N;i++) {
      const c=cells[j*N+i],v=c.b/maxB,co=v>0.72?p.high:v>0.42?p.hot:v>0.15?p.mid:p.pale;
      const x=x0+i*cell,y=y0+j*cell;
      inside+='<rect x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+(cell+0.08).toFixed(2)+'" height="'+(cell+0.08).toFixed(2)+'" fill="'+co+'" fill-opacity="'+(c.b?0.34+v*0.47:0.13)+'" stroke="'+p.ink+'" stroke-opacity="0.36" stroke-width="0.28"/>';
      if(c.p) inside+=text(x+cell-2,y+4,String(c.p),2.3,p.ink,{anchor:'end',weight:700,mono:true});
    }
    inside+=buildingLayer(ctx,p,m,{color:()=>p.ink,opacity:0.54,stroke:p.paper});
    inside+=roadLayer(ctx,p,m,{roadColor:p.paper,opacity:0.9});
    inside+=siteDot(m,p);
    let body=mapShell(ctx,p,m,inside), totalB=cells.reduce((a,c)=>a+c.b,0), totalP=cells.reduce((a,c)=>a+c.p,0), active=cells.filter(c=>c.b||c.p).length;
    const hottest=cells.reduce((best,c,i)=>c.b>cells[best].b?i:best,0), hotCell=cells[hottest];
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Lecture de la trame','Grid reading'),p);
    body+=metricTile(ctx,p,309,58,43,tr(ctx,'Bâtiments','Buildings'),nfmt(totalB),tr(ctx,'centroïdes par cellule','centroid count / cell'));
    body+=metricTile(ctx,p,356,58,43,tr(ctx,'Points d’intérêt','Points of interest'),nfmt(totalP),tr(ctx,'nœuds OSM','OSM nodes'));
    body+=text(309,95,tr(ctx,'Cellules actives','Active cells'),2.45,p.muted);
    body+=text(399,95,active+' / '+(N*N),3.0,p.ink,{anchor:'end',mono:true,weight:700});
    body+=bar(ctx,p,309,104,87,tr(ctx,'Cellule la plus bâtie','Most built cell'),hotCell.b,maxB,p.hot);
    body+=panelTitle(309,124,93,tr(ctx,'Intensité bâtie','Building intensity'),p);
    body+=legendItem(309,135,p.pale,tr(ctx,'faible','low'),p);
    body+=legendItem(354,135,p.mid,tr(ctx,'moyenne','medium'),p);
    body+=legendItem(309,144,p.high,tr(ctx,'forte','high'),p);
    body+=text(309,163,tr(ctx,'Cellules','Cells')+' '+N+' × '+N,2.6,p.ink,{weight:700});
    body+=text(309,173,tr(ctx,'Bâti classé par centroïde; POI','Buildings assigned by centroid; POIs'),2.25,p.muted);
    body+=text(309,180,tr(ctx,'comptés par position.','counted by location.'),2.25,p.muted);
    body+=rounded(309,198,90,49,p.pale,p.line,1.5,0.25);
    body+=text(314,207,tr(ctx,'À LIRE COMME UN INDICATEUR','READ AS AN INDICATOR'),2.15,p.accent,{weight:700});
    body+=text(314,216,tr(ctx,'Agrégation spatiale des objets OSM,','Spatial aggregation of OSM features,'),2.3,p.ink);
    body+=text(314,224,tr(ctx,'pas une mesure de population.','not a population estimate.'),2.3,p.ink);
    body+=text(314,235,tr(ctx,'Maille de calcul : 6 × 6 cellules.','Analysis mesh: 6 × 6 cells.'),2.15,p.muted);
    body+=text(309,261,tr(ctx,'Chiffres affichés dans les cellules : POI.','Numbers shown in cells: POIs.'),2.15,p.muted);
    return page(ctx,'urbangrid',p,{title:'Trame des données urbaines',en:'Urban data grid',sub:'Densité relative du bâti et des points cartographiés',subEn:'Relative building and mapped-point density'},body);
  };

  /* 4 · Axonométrie annotée : emprises OSM extrudées et repères numérotés. */
  function axoProjector(ctx,box) {
    const s=siteOf(ctx),side=Math.min(box.w,box.h),k=0.88*side/(2*s.radius),cx=box.x+box.w/2,cy=box.y+box.h*0.57,hs=0.62;
    const project=(e,n,h=0)=>[cx+(e-n)*0.7071*k,cy+(e+n)*0.35355*k-h*hs];
    return {box,cx,cy,k,hs,project,id:'utb-axo-'+(++clipSerial)};
  }
  function axoShell(p,a,inside) {
    const b=a.box;
    const rect='<rect x="'+b.x+'" y="'+b.y+'" width="'+b.w+'" height="'+b.h+'" rx="1.5" fill="'+p.map+'" stroke="'+p.line+'" stroke-width="0.4"/>';
    const clip='<defs><clipPath id="'+a.id+'"><rect x="'+(b.x+1)+'" y="'+(b.y+1)+'" width="'+(b.w-2)+'" height="'+(b.h-2)+'" rx="1"/></clipPath></defs>';
    return rect+clip+'<g clip-path="url(#'+a.id+')">'+inside+'</g>'+line(b.x+2,b.y+b.h-4,b.x+18,b.y+b.h-4,p.ink,0.65)+text(b.x+2,b.y+b.h-6, 'N  ·  30°',2.3,p.muted,{mono:true});
  }
  function axoPoint(ctx,a,lat,lon,h=0) { const q=localXY(ctx,lat,lon); return a.project(q.e,q.n,h); }
  R.axocallout = (ctx,sc) => {
    const p=palette(sc),box={x:15,y:43,w:280,h:229},a=axoProjector(ctx,box),d=ctx.D||{},s=siteOf(ctx);
    const ground=[[-s.radius,-s.radius],[s.radius,-s.radius],[s.radius,s.radius],[-s.radius,s.radius]].map(q=>a.project(q[0],q[1],0));
    let inside='<polygon points="'+ptsAttr(ground)+'" fill="'+p.pale+'" stroke="'+p.line+'" stroke-width="0.5"/>';
    for(const g of d.green||[]) {
      if(!geometryCenterInExtent(ctx,g.g)) continue;
      const pts=geometryEN(g.g,ctx).map(q=>a.project(q.e,q.n,0));
      if(pts.length>2) inside+='<polygon points="'+ptsAttr(pts)+'" fill="'+(landClass(g)==='water'?p.water:p.green)+'" fill-opacity="0.55"/>';
    }
    for(const r of d.roads||[]) {
      if(lineLengthWithin(ctx,r.g)<=0) continue;
      const pts=coords(r.g).map(q=>axoPoint(ctx,a,q[0],q[1]));
      if(pts.length>1) inside+='<path d="'+pathAttr(pts)+'" fill="none" stroke="'+p.road+'" stroke-width="0.46"/>';
    }
    for(const r of d.rail||[]) {
      if(lineLengthWithin(ctx,r.g)<=0) continue;
      const pts=coords(r.g).map(q=>axoPoint(ctx,a,q[0],q[1]));
      if(pts.length>1) inside+='<path d="'+pathAttr(pts)+'" fill="none" stroke="'+p.hot+'" stroke-width="0.8" stroke-dasharray="2.1 1.2"/>';
    }
    for(const c of d.coast||[]) {
      if(lineLengthWithin(ctx,c.g)<=0) continue;
      const pts=coords(c.g).map(q=>axoPoint(ctx,a,q[0],q[1]));
      if(pts.length>1) inside+='<path d="'+pathAttr(pts)+'" fill="none" stroke="'+p.water+'" stroke-width="0.9"/>';
    }
    const buildings=[]; let known=0,missing=0;
    for(const b of (d.build||[]).filter(b=>geometryCenterInExtent(ctx,b.g))) {
      const geo=geometryEN(b.g,ctx); if(geo.length<3) continue;
      const center=areaAndCenter(b.g,ctx), ar=center.area, measured=nval(b.h)>0, h=measured?nval(b.h):9;
      if(measured)known++;else missing++;
      const base=geo.map(q=>a.project(q.e,q.n,0)),top=geo.map(q=>a.project(q.e,q.n,h));
      const z=base.reduce((v,q)=>v+q[1],0)/base.length;
      const cat=buildingClass(b), topColor=cat==='civic'?p.civic:cat==='retail'?p.retail:cat==='industry'?p.industry:p.building;
      let shape='';
      for(let i=0;i<base.length;i++) {
        const j=(i+1)%base.length, shade=(base[i][0]+base[j][0])/2<a.cx?p.mid:p.deep;
        shape+='<polygon points="'+ptsAttr([base[i],base[j],top[j],top[i]])+'" fill="'+shade+'" fill-opacity="0.88" stroke="'+p.paper+'" stroke-width="0.16"/>';
      }
      shape+='<polygon points="'+ptsAttr(top)+'" fill="'+topColor+'" stroke="'+p.ink+'" stroke-opacity="0.24" stroke-width="0.22"/>';
      buildings.push({svg:shape,z,centroid:a.project(center.e,center.n,h),h,measured,area:ar,building:b,cat});
    }
    buildings.sort((x,y)=>x.z-y.z);
    inside+=buildings.map(b=>b.svg).join('');
    for(const q of d.pois||[]) {
      if(!Number.isFinite(+q.x)||!Number.isFinite(+q.y)||!inExtent(ctx,q.y,q.x)) continue;
      const k=poiClass(q),c=k==='transit'?p.hot:k==='civic'?p.civic:k==='retail'?p.retail:k==='green'?p.green:p.accent;
      const [x,y]=axoPoint(ctx,a,q.y,q.x,0.4),r=k==='transit'?1.1:0.75;
      inside+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="'+r+'" fill="'+c+'" stroke="'+p.white+'" stroke-width="0.25"/>';
    }
    inside+='<circle cx="'+a.cx+'" cy="'+a.cy+'" r="2.2" fill="'+p.hot+'" stroke="'+p.white+'" stroke-width="0.7"/>';
    let body=axoShell(p,a,inside);
    const ranked=buildings.slice().sort((x,y)=>(y.measured?1:0)-(x.measured?1:0)||y.h-x.h||y.area-x.area).slice(0,5);
    for(let i=0;i<ranked.length;i++) {
      const b=ranked[i],q=b.centroid,x=q[0],y=q[1]-4;
      body+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="2.4" fill="'+p.hot+'" stroke="'+p.white+'" stroke-width="0.45"/>';
      body+=text(x,y+0.8,String(i+1),2.3,p.white,{anchor:'middle',weight:700,mono:true});
    }
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Volumes repérés','Selected volumes'),p);
    body+=metricTile(ctx,p,309,58,43,tr(ctx,'Bâtiments','Buildings'),buildings.length,tr(ctx,'emprises extrudées','extruded footprints'));
    body+=metricTile(ctx,p,356,58,43,tr(ctx,'Hauteurs OSM','OSM heights'),known,tr(ctx,'renseignées','recorded'));
    body+=text(309,95,tr(ctx,'Repères en planche','Callouts'),2.5,p.muted);
    if(!ranked.length) body+=text(309,107,tr(ctx,'Aucun bâtiment cartographié','No mapped buildings'),2.45,p.muted);
    for(let i=0;i<ranked.length;i++) {
      const b=ranked[i], yy=107+i*13;
      body+='<circle cx="311" cy="'+(yy-1.1)+'" r="2.05" fill="'+p.hot+'"/>';
      body+=text(311,yy-0.35,String(i+1),2.1,p.white,{anchor:'middle',weight:700,mono:true});
      body+=text(316,yy,truncate(b.building.n||b.building.t||tr(ctx,'Bâtiment','Building'),17),2.45,p.ink,{weight:600});
      body+=text(399,yy,b.measured?b.h.toFixed(1)+' m':'≈ 9 m*',2.35,p.muted,{anchor:'end',mono:true});
      body+=text(316,yy+4.1,areaLabel(b.area),2.1,p.muted);
    }
    body+=line(309,183,399,183,p.line,0.35);
    body+=text(309,192,tr(ctx,'Source des hauteurs','Height source'),2.45,p.muted,{weight:700});
    body+=text(309,201,known+' '+tr(ctx,'mesurées / calculées','measured / derived'),2.35,p.ink);
    body+=text(309,209,missing+' '+tr(ctx,'sans hauteur OSM','without OSM height'),2.35,p.ink);
    body+=text(309,217,tr(ctx,'* Extrusion graphique par défaut : 9 m.','* Graphic default extrusion: 9 m.'),2.15,p.muted);
    body+=legendItem(309,226,p.accent,'POI',p,'circle');
    body+=legendItem(340,226,p.hot,tr(ctx,'Rail','Rail'),p,'line');
    body+=legendItem(370,226,p.water,tr(ctx,'Côte','Coast'),p,'line');
    body+=rounded(309,231,90,25,p.pale,p.line,1.4,0.25);
    body+=text(314,240,tr(ctx,'Perspective axonométrique 30°','30° axonometric projection'),2.3,p.accent,{weight:700});
    body+=text(314,248,tr(ctx,'Hauteurs non renseignées signalées *','Unmapped heights marked *'),2.1,p.muted);
    return page(ctx,'axocallout',p,{title:'Volumétrie axonométrique annotée',en:'Annotated axonometric massing',sub:'Emprises de bâtiments OSM extrudées · repères sélectionnés',subEn:'Extruded OSM building footprints · selected callouts'},body);
  };

  /* 5 · Planche d’insertion : vue générale, repère et fenêtre de détail. */
  R.insetboard = (ctx,sc) => {
    const p=palette(sc),d=ctx.D||{},m=mainMap(ctx,p),R0=m.radius,zoom=Math.max(80,Math.min(R0,Math.round(R0*0.34/10)*10));
    const buildingCount=(d.build||[]).filter(b=>geometryCenterInExtent(ctx,b.g)).length;
    const roadCount=(d.roads||[]).filter(r=>lineLengthWithin(ctx,r.g)>0).length;
    let inside=mapBase(ctx,p,m,{green:true,buildings:true,roads:true,pois:true,rail:true,coast:true});
    const zr=zoom*m.scale;
    if(zoom<R0*0.96) inside+='<circle cx="'+m.cx+'" cy="'+m.cy+'" r="'+zr.toFixed(2)+'" fill="none" stroke="'+p.hot+'" stroke-width="1" stroke-dasharray="2.5 1.3"/>';
    inside+=siteDot(m,p);
    let body=mapShell(ctx,p,m,inside);
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Repérage','Locator'),p);
    body+=text(309,60,tr(ctx,'Emprise étudiée','Study area'),2.3,p.muted);
    body+=text(309,67,truncate(ctx.siteName||tr(ctx,'Site','Site'),28),3,p.ink,{weight:700});
    body+=text(309,74,siteOf(ctx).lat.toFixed(5)+'°, '+siteOf(ctx).lon.toFixed(5)+'°',2.25,p.muted,{mono:true});
    body+=line(309,80,399,80,p.line,0.35);
    body+=text(309,88,tr(ctx,'Détail central · rayon','Central detail · radius'),2.35,p.muted);
    body+=text(399,88,distanceLabel(zoom),2.45,p.hot,{anchor:'end',mono:true,weight:700});
    const mini={x:311,y:93,w:86,h:77},zm=mapProjector(ctx,mini,zoom);
    body+=mapShell(ctx,p,zm,mapBase(ctx,p,zm,{green:true,buildings:true,roads:true,pois:true,rail:true,coast:true}),{north:false,scale:false});
    body+=panelTitle(309,181,93,tr(ctx,'Lecture des encarts','Inset reading'),p);
    body+=legendItem(309,191,p.hot,tr(ctx,'cercle tireté : zone agrandie','dashed circle: zoom area'),p,'line');
    body+=legendItem(309,200,p.accent,tr(ctx,'point central du site','site center'),p,'circle');
    body+=line(309,208,399,208,p.line,0.35);
    body+=text(309,218,tr(ctx,'Surface étudiée','Study area'),2.4,p.muted);
    body+=text(399,218,areaLabel(siteArea(ctx)),2.5,p.ink,{anchor:'end',mono:true});
    body+=text(309,228,tr(ctx,'Bâtiments OSM','OSM buildings'),2.4,p.muted);
    body+=text(399,228,nfmt(buildingCount),2.5,p.ink,{anchor:'end',mono:true});
    body+=text(309,238,tr(ctx,'Voirie OSM','OSM road segments'),2.4,p.muted);
    body+=text(399,238,nfmt(roadCount),2.5,p.ink,{anchor:'end',mono:true});
    body+=text(309,251,tr(ctx,'Les encarts réutilisent les mêmes données OSM.','Insets use the same OSM dataset.'),2.15,p.muted);
    body+=text(309,259,tr(ctx,'Aucune donnée n’est extrapolée hors emprise.','No data is extrapolated beyond the study area.'),2.05,p.muted);
    return page(ctx,'insetboard',p,{title:'Planche d’insertion du site',en:'Site inset board',sub:'Vue d’ensemble et agrandissement dérivés du même jeu OSM',subEn:'Overview and zoom derived from the same OSM dataset'},body);
  };

  /* 6 · Cônes de vue indicatifs depuis le centre de l’emprise. */
  function visibleBuildings(ctx) {
    const R0=siteOf(ctx).radius, bins=72, horizon=new Float32Array(bins).fill(-1e6), rows=[];
    for(const b of (ctx.D&&ctx.D.build)||[]) {
      const c=areaAndCenter(b.g,ctx); if(!c.area||!inExtentEN(ctx,c.e,c.n)) continue;
      const dist=Math.hypot(c.e,c.n); if(dist<24) continue;
      const h=nval(b.h)>0?nval(b.h):9, ring=geometryEN(b.g,ctx);
      const rad=ring.reduce((a,q)=>Math.max(a,Math.hypot(q.e-c.e,q.n-c.n)),0);
      const angle=Math.atan2(c.e,c.n), half=clamp(Math.atan2(Math.max(2,rad),dist),2*Math.PI/180,15*Math.PI/180);
      const elev=Math.atan2(Math.max(0.3,h-1.7),dist), start=Math.floor(((angle-half+2*Math.PI)%(2*Math.PI))/(2*Math.PI)*bins), count=Math.max(1,Math.ceil(half*2/(2*Math.PI)*bins));
      const binIds=[];for(let j=0;j<=count;j++)binIds.push((start+j)%bins);
      const maxH=binIds.reduce((a,i)=>Math.max(a,horizon[i]),-1e6), vis=elev>maxH+0.004;
      rows.push({b,e:c.e,n:c.n,dist,h,measured:nval(b.h)>0,elev,angle,half,rad,visible:vis,binIds});
      for(const i of binIds) horizon[i]=Math.max(horizon[i],elev);
    }
    return rows.filter(x=>x.visible);
  }
  function wedgePath(m,item,pad=0) {
    const r=m.extentPx,half=Math.max(item.half,4*Math.PI/180)+pad, a=item.angle;
    const p1=[m.cx+Math.sin(a-half)*r,m.cy-Math.cos(a-half)*r],p2=[m.cx+Math.sin(a+half)*r,m.cy-Math.cos(a+half)*r];
    const big=(half*2)>Math.PI?1:0;
    return 'M '+m.cx+' '+m.cy+' L '+p1[0].toFixed(2)+' '+p1[1].toFixed(2)+' A '+r.toFixed(2)+' '+r.toFixed(2)+' 0 '+big+' 1 '+p2[0].toFixed(2)+' '+p2[1].toFixed(2)+' Z';
  }
  R.viewcones = (ctx,sc) => {
    const p=palette(sc),m=mainMap(ctx,p),visible=visibleBuildings(ctx),targets=[];
    const candidates=visible.slice().sort((a,b)=>b.elev-a.elev||b.dist-a.dist);
    for(const q of candidates) {
      if(targets.every(t=>Math.abs(Math.atan2(Math.sin(t.angle-q.angle),Math.cos(t.angle-q.angle)))>13*Math.PI/180)) targets.push(q);
      if(targets.length>=6) break;
    }
    const cols=[p.hot,p.accent,p.mid,p.civic,p.retail,p.deep];
    let inside=greenLayer(ctx,p,m,{opacity:0.34})+buildingLayer(ctx,p,m,{opacity:0.62})+coastLayer(ctx,p,m)+railLayer(ctx,p,m)+roadLayer(ctx,p,m,{opacity:0.78});
    targets.forEach((t,i)=>inside+='<path d="'+wedgePath(m,t)+'" fill="'+cols[i]+'" fill-opacity="0.15" stroke="'+cols[i]+'" stroke-opacity="0.65" stroke-width="0.38"/>');
    targets.forEach((t,i)=>{
      const q=m.projectEN(t.e,t.n), color=cols[i];
      inside+='<line x1="'+m.cx+'" y1="'+m.cy+'" x2="'+q[0].toFixed(2)+'" y2="'+q[1].toFixed(2)+'" stroke="'+color+'" stroke-width="0.65" stroke-dasharray="2 1"/>';
      const pts=projectGeom(t.b.g,m);
      if(pts.length>2) inside+='<polygon points="'+ptsAttr(pts)+'" fill="'+color+'" fill-opacity="0.83" stroke="'+p.ink+'" stroke-width="0.35"/>';
      inside+='<circle cx="'+q[0].toFixed(2)+'" cy="'+q[1].toFixed(2)+'" r="2.25" fill="'+color+'" stroke="'+p.white+'" stroke-width="0.55"/>';
      inside+=text(q[0],q[1]+0.85,String(i+1),2.2,p.white,{anchor:'middle',weight:700,mono:true});
    });
    inside+=siteDot(m,p);
    let body=mapShell(ctx,p,m,inside);
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Cibles visibles','Visible targets'),p);
    body+=text(309,59,tr(ctx,'Depuis le centre · œil 1,7 m','From center · eye 1.7 m'),2.2,p.muted);
    if(!targets.length) body+=text(309,72,tr(ctx,'Aucun volume repérable','No visible volume found'),2.45,p.muted);
    for(let i=0;i<targets.length;i++) {
      const t=targets[i],yy=72+i*12;
      body+='<circle cx="311" cy="'+(yy-1.1)+'" r="2.0" fill="'+cols[i]+'"/>';
      body+=text(311,yy-0.35,String(i+1),2.05,p.white,{anchor:'middle',weight:700,mono:true});
      body+=text(316,yy,truncate(t.b.n||t.b.t||tr(ctx,'Bâtiment','Building'),16),2.4,p.ink,{weight:600});
      body+=text(399,yy,distanceLabel(t.dist),2.3,p.muted,{anchor:'end',mono:true});
      body+=text(316,yy+4.1,(t.measured?t.h.toFixed(1):'≈9')+' m'+(t.measured?'':'*')+' · '+(t.elev*180/Math.PI).toFixed(1)+'°',2.15,p.muted);
    }
    body+=line(309,153,399,153,p.line,0.35);
    body+=panelTitle(309,163,93,tr(ctx,'Méthode & limites','Method & limits'),p);
    body+=text(309,173,tr(ctx,'Cônes orientés vers des bâtiments','Cones point toward buildings'),2.3,p.ink);
    body+=text(309,181,tr(ctx,'dont la hauteur apparente dépasse','whose apparent height exceeds'),2.3,p.ink);
    body+=text(309,189,tr(ctx,'l’horizon des volumes plus proches.','the horizon of nearer volumes.'),2.3,p.ink);
    body+=rounded(309,202,90,48,p.pale,p.line,1.4,0.25);
    body+=text(314,211,tr(ctx,'INDICATIF — PAS UN VUESHED','INDICATIVE — NOT A FULL VIEWSHED'),2.05,p.accent,{weight:700});
    body+=text(314,220,tr(ctx,'Relief, végétation et hauteur réelle','Terrain, vegetation and actual heights'),2.15,p.ink);
    body+=text(314,228,tr(ctx,'des objets inconnus non modélisés.','of unmapped objects are not modelled.'),2.15,p.ink);
    body+=text(314,240,tr(ctx,'* Hauteur de rendu par défaut : 9 m.','* Default display height: 9 m.'),2.05,p.muted);
    body+=text(309,262,tr(ctx,'Sources : emprises et hauteurs OSM.','Sources: OSM footprints and heights.'),2.15,p.muted);
    return page(ctx,'viewcones',p,{title:'Cônes de vue indicatifs',en:'Indicative view cones',sub:'Bâtiments saillants visibles depuis le centre · sans relief',subEn:'Prominent buildings seen from center · terrain not modelled'},body);
  };

  /* 7 · Zonage fonctionnel dérivé des usages OSM, jamais réglementaire. */
  R.zoningplan = (ctx,sc) => {
    const p=palette(sc),m=mainMap(ctx,p),d=ctx.D||{};
    const counts={residential:0,retail:0,civic:0,industry:0,green:0,water:0,other:0};
    const addCount=k=>{const key=(k==='land'||k==='transit'||!Object.hasOwn(counts,k))?'other':k;counts[key]++;};
    for(const b of d.build||[]) if(geometryCenterInExtent(ctx,b.g)) addCount(buildingClass(b));
    for(const g of d.green||[]) if(geometryCenterInExtent(ctx,g.g)) addCount(landClass(g));
    for(const q of d.pois||[]) if(inExtent(ctx,q.y,q.x)) addCount(poiClass(q));
    const zoneColor=(obj,k)=>classColor(p,k);
    let inside=greenLayer(ctx,p,m,{opacity:0.72,color:zoneColor});
    inside+=buildingLayer(ctx,p,m,{opacity:0.93,color:zoneColor,stroke:p.panel});
    inside+=coastLayer(ctx,p,m)+railLayer(ctx,p,m)+roadLayer(ctx,p,m,{roadColor:p.paper,opacity:0.96});
    for(const q of d.pois||[]) {
      const [x,y]=m.project(q.y,q.x),c=classColor(p,poiClass(q));
      inside+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="0.9" fill="'+c+'" stroke="'+p.paper+'" stroke-width="0.28"/>';
    }
    inside+=siteDot(m,p);
    let body=mapShell(ctx,p,m,inside);
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Usages cartographiés','Mapped uses'),p);
    const zones=[['residential',tr(ctx,'Habitat','Residential')],['retail',tr(ctx,'Commerce / activité','Commerce / activity')],['civic',tr(ctx,'Équipements','Civic facilities')],['industry',tr(ctx,'Industrie / service','Industry / service')],['green',tr(ctx,'Espaces verts','Green spaces')],['water',tr(ctx,'Eau','Water')],['other',tr(ctx,'Autres objets','Other features')]];
    zones.forEach((z,i)=>{
      const yy=62+i*12;
      body+='<rect x="309" y="'+(yy-4.2)+'" width="5.5" height="5.5" rx="0.7" fill="'+classColor(p,z[0])+'"/>';
      body+=text(318,yy,z[1],2.45,p.ink);
      body+=text(399,yy,nfmt(counts[z[0]]),2.5,p.muted,{anchor:'end',mono:true,weight:700});
    });
    body+=line(309,151,399,151,p.line,0.35);
    body+=panelTitle(309,161,93,tr(ctx,'Légende thématique','Thematic legend'),p);
    body+=text(309,171,tr(ctx,'Couleur issue des tags OSM','Color derived from OSM tags'),2.3,p.muted);
    body+=text(309,181,tr(ctx,'bâtiment, landuse, amenity, shop…','building, landuse, amenity, shop…'),2.1,p.muted);
    body+=rounded(309,197,90,53,p.pale,p.line,1.4,0.25);
    body+=text(314,206,tr(ctx,'USAGE INDICATIF','INDICATIVE USE'),2.2,p.accent,{weight:700,letter:0.15});
    body+=text(314,215,tr(ctx,'Ce rendu n’est pas un document','This map is not a document'),2.35,p.ink);
    body+=text(314,223,tr(ctx,'d’urbanisme et ne représente pas','of planning regulation and does not'),2.35,p.ink);
    body+=text(314,231,tr(ctx,'un zonage légal ou réglementaire.','represent legal or statutory zoning.'),2.35,p.ink);
    body+=text(309,260,tr(ctx,'Comptages d’objets par classe · classes indicatives.','Feature counts by class · indicative categories.'),2.1,p.muted);
    return page(ctx,'zoningplan',p,{title:'Zonage fonctionnel OSM',en:'Functional OSM zoning',sub:'Usages inférés des tags cartographiques · non réglementaire',subEn:'Uses inferred from map tags · not a statutory zoning plan'},body);
  };

  /* 8 · Réseau radial : pôles mesurés à vol d’oiseau par distance et direction. */
  const SECTORS=['N','NE','E','SE','S','SO','O','NO'];
  R.radialnet = (ctx,sc) => {
    const p=palette(sc),m=mainMap(ctx,p),pois=(ctx.D&&ctx.D.pois)||[],R0=m.radius;
    const sectors=ctx.lang==='en'?['N','NE','E','SE','S','SW','W','NW']:SECTORS;
    const inPois=pois.filter(q=>inExtent(ctx,q.y,q.x,R0));
    const sectorCounts=Array(8).fill(0), rings=[0,0,0,0], annotated=[];
    for(const q of inPois) {
      const c=localXY(ctx,q.y,q.x),dist=Math.hypot(c.e,c.n),angle=(Math.atan2(c.e,c.n)*180/Math.PI+360)%360,sector=Math.floor(((angle+22.5)%360)/45);
      sectorCounts[sector]++;
      const band=dist<=250?0:dist<=500?1:dist<=1000?2:3;rings[band]++;
      annotated.push({q,dist,angle,sector});
    }
    let inside=greenLayer(ctx,p,m,{opacity:0.36})+buildingLayer(ctx,p,m,{opacity:0.55})+coastLayer(ctx,p,m)+railLayer(ctx,p,m);
    for(const r of [250,500,1000]) if(r<R0*0.98) inside+='<circle cx="'+m.cx+'" cy="'+m.cy+'" r="'+(r*m.scale)+'" fill="none" stroke="'+p.accent+'" stroke-width="0.42" stroke-dasharray="2 1.8" opacity="0.82"/>';
    for(let i=0;i<8;i++) {
      const a=i*Math.PI/4,e=Math.sin(a)*R0,n=Math.cos(a)*R0,q=m.projectEN(e,n);
      inside+='<line x1="'+m.cx+'" y1="'+m.cy+'" x2="'+q[0].toFixed(2)+'" y2="'+q[1].toFixed(2)+'" stroke="'+p.line+'" stroke-width="0.3" stroke-dasharray="1.5 1.6"/>';
      const lx=m.cx+Math.sin(a)*(m.extentPx-4),ly=m.cy-Math.cos(a)*(m.extentPx-4);
      inside+=text(lx,ly+0.8,sectors[i],2.2,p.muted,{anchor:'middle',weight:700,mono:true});
    }
    inside+=roadLayer(ctx,p,m,{roadColor:p.major,opacity:0.75});
    for(const q of inPois) {
      const [x,y]=m.project(q.y,q.x),k=poiClass(q),c=k==='transit'?p.hot:k==='civic'?p.civic:k==='retail'?p.retail:k==='green'?p.green:p.accent;
      const r=k==='transit'?1.25:0.85;
      inside+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="'+r+'" fill="'+c+'" stroke="'+p.panel+'" stroke-width="0.26"/>';
    }
    const nearest=annotated.slice().sort((a,b)=>a.dist-b.dist).slice(0,4);
    nearest.forEach((it,i)=>{
      const [x,y]=m.project(it.q.y,it.q.x), [sx,sy]=[m.cx,m.cy], c=poiClass(it.q)==='transit'?p.hot:p.accent;
      inside+='<line x1="'+sx+'" y1="'+sy+'" x2="'+x.toFixed(2)+'" y2="'+y.toFixed(2)+'" stroke="'+c+'" stroke-width="0.48" stroke-dasharray="1.8 1.3"/>';
      inside+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="1.55" fill="'+c+'" stroke="'+p.white+'" stroke-width="0.42"/>';
      inside+=text(x+2.4,y-1.4,String(i+1),2.1,p.ink,{weight:700,mono:true});
    });
    inside+=siteDot(m,p);
    let body=mapShell(ctx,p,m,inside);
    body+=sideBox(p);
    body+=panelTitle(309,51,93,tr(ctx,'Centralité à vol d’oiseau','Straight-line centrality'),p);
    const transit=inPois.filter(q=>poiClass(q)==='transit').length;
    body+=metricTile(ctx,p,309,58,43,tr(ctx,'Pôles OSM','OSM destinations'),inPois.length,tr(ctx,'objets ponctuels','point features'));
    body+=metricTile(ctx,p,356,58,43,tr(ctx,'Transport','Transit'),transit,tr(ctx,'arrêts / nœuds','stops / nodes'));
    body+=panelTitle(309,96,93,tr(ctx,'Répartition radiale','Radial distance bands'),p);
    const bands=[tr(ctx,'0–250 m','0–250 m'),tr(ctx,'250–500 m','250–500 m'),tr(ctx,'500–1 km','500–1 km'),tr(ctx,'> 1 km','> 1 km')];
    for(let i=0;i<4;i++) {
      const yy=107+i*9;
      body+=text(309,yy,bands[i],2.3,p.muted);
      body+=rounded(341,yy-3,43,2.5,p.grid,p.grid,0.8,0);
      const max=Math.max(1,...rings),w=43*rings[i]/max;
      if(w>0) body+=rounded(341,yy-3,w,2.5,[p.accent,p.mid,p.hot,p.civic][i],[p.accent,p.mid,p.hot,p.civic][i],0.8,0);
      body+=text(399,yy,nfmt(rings[i]),2.3,p.ink,{anchor:'end',mono:true});
    }
    body+=panelTitle(309,151,93,tr(ctx,'Pôles par direction','Destinations by bearing'),p);
    const maxSector=Math.max(1,...sectorCounts);
    for(let i=0;i<8;i++) {
      const xx=310+i*11.15, h=18*sectorCounts[i]/maxSector;
      body+=line(xx+3,184-h,xx+3,184,p.line,2.5);
      body+=line(xx+3,184-h,xx+3,184,p.accent,2.5);
      body+=text(xx+3,190,sectors[i],2.0,p.muted,{anchor:'middle',mono:true});
      body+=text(xx+3,179-h,nfmt(sectorCounts[i]),2.0,p.ink,{anchor:'middle',mono:true});
    }
    body+=panelTitle(309,201,93,tr(ctx,'Plus proches repères','Nearest mapped places'),p);
    for(let i=0;i<Math.min(4,nearest.length);i++) body+=row(ctx,p,309,213+i*9.2,91,String(i+1),poiName(ctx,nearest[i].q),distanceLabel(nearest[i].dist),poiClass(nearest[i].q)==='transit'?p.hot:p.accent);
    body+=rounded(309,255,90,13,p.pale,p.line,1.1,0.2);
    body+=text(313,263,tr(ctx,'Distances directes — pas d’itinéraire réseau.','Direct distances — not routed journeys.'),2.05,p.ink);
    return page(ctx,'radialnet',p,{title:'Centralité & accès radial',en:'Radial centrality & access',sub:'Distances directes vers les pôles cartographiés · directions cardinales',subEn:'Straight-line distances to mapped destinations · cardinal sectors'},body);
  };

})(typeof globalThis !== 'undefined' ? globalThis : this);
