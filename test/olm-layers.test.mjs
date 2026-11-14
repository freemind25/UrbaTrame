import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const olm = readFileSync(new URL('../public/js/openlandmap.mjs', import.meta.url), 'utf8');
const map = readFileSync(new URL('../public/js/atelier/map.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const cat = readFileSync(new URL('../public/js/catalog.js', import.meta.url), 'utf8');
const plan = readFileSync(new URL('../public/js/plan-2d.mjs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../public/js/renderers-core.js', import.meta.url), 'utf8');
const eng = readFileSync(new URL('../public/js/engine.js', import.meta.url), 'utf8');

test('couches données « imagerie satellite » et « urban settlement » déclarées de bout en bout', () => {
  for (const id of ['satellite', 'urban']) {
    assert.ok(cat.includes(`id: '${id}'`), `catalogue: ${id}`);
    assert.ok(plan.includes(`${id}:`), `DEPS: ${id}`);
    assert.ok(plan.includes(`'${id}'`), `FREE_IDS: ${id}`);
    assert.ok(eng.includes(`${id}: [`), `SCH: ${id}`);
    assert.ok(core.includes(`R.${id} =`), `renderer: ${id}`);
  }
  assert.ok(olm.includes('OLM_MSZ_COLORMAP') && olm.includes('olmTileUrlFor'), 'colormap + tuiles MSZ');
  assert.ok(map.includes("'msz'"), 'fond msz dans map.mjs');
  assert.ok(html.includes('value="msz"'), 'option msz dans le sélecteur');
});
