/* Les chaînes décimales strictes sont acceptées ; jamais de coercition booléenne. */
export function numericValue(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return { kind:'missing' };
  if (typeof value === 'number' && Number.isFinite(value)) return { kind:'number', value };
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    const number = Number(value); if (Number.isFinite(number)) return { kind:'number', value:number };
  }
  return { kind:'invalid' };
}
export function buildNumericHistogram(features, field, bins = 8) {
  if (!Number.isInteger(bins) || bins < 1 || bins > 20) throw new Error('HISTOGRAM_BINS_INVALID');
  const values=[]; let missing=0, invalid=0;
  for (const feature of features || []) {
    const properties = feature?.properties || {};
    const result = numericValue(Object.hasOwn(properties, field) ? properties[field] : undefined);
    if (result.kind === 'missing') missing++;
    else if (result.kind === 'invalid') invalid++;
    else values.push(result.value);
  }
  if (!values.length) return { min:null,max:null, bins:[], numeric:0,missing,invalid };
  let min=Infinity,max=-Infinity; for (const n of values) {min=Math.min(min,n);max=Math.max(max,n);}
  const count = min === max ? 1 : bins, groups = Array.from({length:count}, (_,i) => ({
    min: min*(1-i/count)+max*(i/count), max: min*(1-(i+1)/count)+max*((i+1)/count), count:0, upperInclusive:i===count-1
  }));
  const diff = max-min, span = max/2-min/2;
  for (const n of values) { const ratio = Number.isFinite(diff) ? (n-min)/diff : (n/2-min/2)/span; const index = count===1 ? 0 : Math.min(count-1,Math.max(0,Math.floor(ratio*count))); groups[index].count++; }
  return {min,max,bins:groups,numeric:values.length,missing,invalid};
}
export function matchesNumericRange(feature, filter) {
  if (!filter) return true;
  const result=numericValue(feature?.properties?.[filter.field]);
  return result.kind==='number' && (filter.min === null || result.value >= filter.min) && (filter.max === null || result.value <= filter.max);
}
export function validateNumericRange(field,minText,maxText) {
  if (typeof field !== 'string' || !field) throw new Error('RANGE_FIELD_REQUIRED');
  const lower = String(minText).trim(), upper=String(maxText).trim();
  if (!lower && !upper) throw new Error('RANGE_BOUND_REQUIRED');
  const a = lower ? numericValue(lower) : {kind:'number',value:null}, b=upper ? numericValue(upper) : {kind:'number',value:null};
  if (a.kind!=='number' || b.kind!=='number' || (a.value!==null && b.value!==null && a.value>b.value)) throw new Error('RANGE_INVALID');
  return {field,min:a.value,max:b.value};
}
