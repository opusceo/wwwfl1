/* Živá kancelář FL1 – text tabule.
   Čistá funkce tabule(verejne) vrací text „Zakázek: N · Celkem: X Kč“.
   V prohlížeči je funkce globální, v node se při spuštění
   `node tabule.js <soubor.json>` vypíše text tabule na stdout. */

(function (global) {
  'use strict';

  var POMLCKA = '—';

  /* Částka česky: desetinná čárka a „Kč“. */
  function castkaKc(castka) {
    if (typeof castka !== 'number' || !isFinite(castka)) {
      return POMLCKA;
    }
    var zaokrouhleno = Math.round(castka * 100) / 100;
    return zaokrouhleno.toFixed(2).replace('.', ',') + ' Kč';
  }

  function cisloNeboPomlcka(hodnota) {
    if (typeof hodnota === 'number' && isFinite(hodnota)) {
      return String(hodnota);
    }
    if (typeof hodnota === 'string' && hodnota !== '') {
      return hodnota;
    }
    return POMLCKA;
  }

  /* Text tabule z veřejných dat. Chybí-li cokoli, vrací „—“ v dané části. */
  function tabule(verejne) {
    var data = verejne || {};
    var cela = data.cisla && data.cisla.cela_doba ? data.cisla.cela_doba : null;
    var pocet = cela ? cisloNeboPomlcka(cela.zakazky) : POMLCKA;

    var kurz = data.kurz_usd_czk && typeof data.kurz_usd_czk.kurz === 'number'
      ? data.kurz_usd_czk.kurz
      : null;
    var usd = cela && typeof cela.cena_usd === 'number' ? cela.cena_usd : null;

    var celkem = POMLCKA;
    if (kurz !== null && isFinite(kurz) && usd !== null && isFinite(usd)) {
      celkem = castkaKc(usd * kurz);
    }

    return 'Zakázek: ' + pocet + ' · Celkem: ' + celkem;
  }

  global.tabule = tabule;
  global.tabuleCastkaKc = castkaKc;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = tabule;
  }

  /* Spuštění v node: node tabule.js <soubor.json> */
  if (typeof process !== 'undefined' && process.argv && typeof require === 'function') {
    var argv1 = process.argv[1] || '';
    if (/tabule\.js$/.test(argv1) && process.argv[2]) {
      try {
        var fs = require('fs');
        var obsah = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
        process.stdout.write(tabule(obsah) + '\n');
      } catch (chyba) {
        process.stderr.write('CHYBA: ' + (chyba && chyba.message ? chyba.message : chyba) + '\n');
        process.exitCode = 1;
      }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
