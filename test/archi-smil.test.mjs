import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { animateSvg, SMIL_KINDS } from '../public/js/archi-smil.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">' +
  '<defs><pattern id="h"><rect width="9" height="9" fill="#fff"/></pattern></defs>' +
  '<rect x="0" y="0" width="1080" height="1920" fill="#f7f3ea"/>' +
  '<rect x="10" y="10" width="50" height="20" fill="#111" opacity="0.9"/>' +
  '<line x1="0" y1="0" x2="9" y2="9" stroke="#e87722" stroke-width="1.6" opacity="0.92"/>' +
  '<line x1="0" y1="0" x2="9" y2="9" stroke="#2f5f9e" stroke-width="1.6"/>' +
  '<text x="5" y="5">titre</text></svg>';

describe('animateSvg (SMIL)', () => {
  test('ajoute un balayage en boucle sur toutes les planches', () => {
    for (const kind of SMIL_KINDS) {
      const out = animateSvg(SVG, kind);
      assert.ok(out.includes('repeatCount="indefinite"'), kind + ' : boucle infinie');
      assert.ok(out.includes('attributeName="x"'), kind + ' : balayage horizontal');
      assert.ok(out.endsWith('</svg>'));
    }
  });

  test('cascade sur les formes (sauf planche), en gardant l’opacité cible', () => {
    const out = animateSvg(SVG, 'profil');
    const anims = out.match(/<animate /g) || [];
    assert.ok(anims.length >= 5, 'une animation par forme + balayage : ' + anims.length);
    assert.ok(out.includes('values="0;0.9;0.9"'), 'opacité existante 0.9 conservée comme cible');
    const forced = out.match(/values="0;1;1"/g) || [];
    assert.equal(forced.length, 2, 'seuls les 2 éléments sans opacité ont la cible 1 (fond + texte)');
    const planche = animateSvg(SVG, 'planche');
    assert.equal((planche.match(/<animate /g) || []).length, 1, 'planche : balayage seul');
  });

  test('ombres : les rayons orange/bleu pulsent heure par heure', () => {
    const out = animateSvg(SVG, 'ombres');
    const rays = out.match(/values="0;0\.92;0\.92;0"/g) || [];
    assert.equal(rays.length, 2, 'deux rayons animés (été + hiver)');
    assert.ok(out.includes('dur="8s"'));
    assert.ok(out.includes('fill="#e87722"'), 'balayage chaud sur la planche ombres');
  });

  test('ne touche pas aux éléments non auto-fermants et reste une chaîne SVG valide', () => {
    const weird = '<svg width="10" height="10"><g><rect x="0" y="0" width="1" height="1"></rect></g></svg>';
    const out = animateSvg(weird, 'usages');
    assert.ok(out.includes('</svg>'));
    assert.ok(out.includes('attributeName="x"'));
  });
});
