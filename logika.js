/* Živá kancelář FL1 – čisté výpočty pro scénu.
   Žádný DOM, žádný canvas, žádné knihovny.
   V prohlížeči globální objekt FL1Logika, v node module.exports se stejnými funkcemi. */

(function (global) {
  'use strict';

  var MIN_VELIKOST = 9;    /* nejmenší písmo tabule */
  var MAX_VELIKOST = 16;   /* největší písmo tabule */
  var VYSKA_RADKU = 1.3;   /* výška řádku jako násobek písma */
  var KC = 'Kč';           /* měna, která se nikdy neodtrhne od částky */
  var ODDELOVAC = '·';     /* oddělovač, který nezačíná ani nekončí řádek */

  /* Číslo z hodnoty, jinak náhrada. */
  function cislo(hodnota, nahrada) {
    return typeof hodnota === 'number' && isFinite(hodnota) ? hodnota : nahrada;
  }

  /* Čas události v ms: číslo zůstane, ISO text se převede, jinak null. */
  function naMs(hodnota) {
    if (typeof hodnota === 'number' && isFinite(hodnota)) {
      return hodnota;
    }
    if (typeof hodnota === 'string' && hodnota !== '') {
      var prevedeno = Date.parse(hodnota);
      return isFinite(prevedeno) ? prevedeno : null;
    }
    return null;
  }

  /* Stavy postav v zadaném čase záznamu.
     udalosti = pole {cas, postava, typ, druh}; vstup se nemění. */
  function stavyVCase(udalosti, casDotaz, minPraceMs) {
    var vysledek = {};
    var seznam = Array.isArray(udalosti) ? udalosti : [];
    var minPrace = cislo(minPraceMs, 0);
    if (!(minPrace > 0)) {
      minPrace = 0;
    }
    var dotaz = cislo(casDotaz, 0);

    /* Roztřídění událostí podle postavy (vstup zůstává nedotčený). */
    var podleJmena = {};
    var jmena = [];
    seznam.forEach(function (udalost, poradi) {
      if (!udalost) {
        return;
      }
      var jmeno = udalost.postava;
      if (jmeno === null || jmeno === undefined || jmeno === '') {
        return;
      }
      var klic = String(jmeno);
      if (!podleJmena[klic]) {
        podleJmena[klic] = [];
        jmena.push(klic);
      }
      podleJmena[klic].push({
        cas: naMs(udalost.cas),
        typ: udalost.typ || null,
        druh: udalost.druh || null,
        poradi: poradi
      });
    });

    jmena.forEach(function (klic) {
      /* Kopie pole se řadí podle času; původní vstup zůstává beze změny. */
      var udalostiPostavy = podleJmena[klic].slice().sort(function (a, b) {
        if (a.cas === null && b.cas === null) {
          return a.poradi - b.poradi;
        }
        if (a.cas === null) {
          return 1;
        }
        if (b.cas === null) {
          return -1;
        }
        return a.cas - b.cas || a.poradi - b.poradi;
      });

      var intervaly = [];
      var otevreno = null;   /* čas otevřené práce, jinak null */
      var druh = null;

      udalostiPostavy.forEach(function (udalost) {
        if (!druh && udalost.druh) {
          druh = udalost.druh;   /* první neprázdný druh postavy */
        }
        if (udalost.cas === null) {
          return;
        }
        var typ = udalost.typ;
        if (typ === 'start' || typ === 'rozdeleni') {
          if (otevreno === null) {
            otevreno = udalost.cas;
          }
          return;
        }
        if (typ === 'hotovo' || typ === 'schvaleno' || typ === 'vraceno') {
          if (otevreno !== null) {
            intervaly.push([otevreno, Math.max(udalost.cas, otevreno + minPrace)]);
            otevreno = null;
          } else {
            /* hotovo bez otevřené práce: práce se dopočítá před dokončením */
            intervaly.push([udalost.cas - minPrace, udalost.cas]);
          }
        }
        /* nastroj, sluzba a jiné typy stav nemění */
      });

      if (otevreno !== null) {
        intervaly.push([otevreno, Infinity]);
      }

      var pracuje = false;
      for (var i = 0; i < intervaly.length; i += 1) {
        if (dotaz >= intervaly[i][0] && dotaz < intervaly[i][1]) {
          pracuje = true;
          break;
        }
      }

      vysledek[klic] = { stav: pracuje ? 'pracuje' : 'nic', druh: druh };
    });

    return vysledek;
  }

  /* y jmenovky: pod nohama, a když by vlezla do pásu lišt, nad hlavou. */
  function jmenovkaY(nohyY, vyskaPostavy, vyskaJmenovky, hranaPasu) {
    var nohy = cislo(nohyY, 0);
    var postava = cislo(vyskaPostavy, 0);
    var jmenovka = cislo(vyskaJmenovky, 0);
    var hrana = cislo(hranaPasu, 0);
    var y = nohy + 4;
    if (y + jmenovka > hrana) {
      y = nohy - postava - jmenovka - 2;
    }
    return Math.max(0, Math.round(y));
  }

  /* Zkrácení textu na šířku s „…“ na konci. */
  function zkratText(text, maxSirka, sirkaFn) {
    var plny = text === null || text === undefined ? '' : String(text);
    if (sirkaFn(plny) <= maxSirka) {
      return plny;
    }
    var znaky = plny.split('');
    for (var delka = znaky.length - 1; delka >= 0; delka -= 1) {
      /* začátek bez koncových mezer, aby před „…“ mezera nezůstala */
      var zacatek = znaky.slice(0, delka).join('').replace(/\s+$/, '');
      var kandidat = zacatek + '\u2026';
      if (sirkaFn(kandidat) <= maxSirka) {
        return kandidat;
      }
    }
    return '\u2026';
  }

  /* Slova k zalomení; „Kč“ se drží předchozího slova jako jeden celek. */
  function jednotkyTextu(text) {
    var slova = String(text === null || text === undefined ? '' : text)
      .split(/\s+/)
      .filter(function (slovo) { return slovo !== ''; });
    var jednotky = [];
    slova.forEach(function (slovo) {
      if (slovo === KC && jednotky.length) {
        jednotky[jednotky.length - 1] += ' ' + slovo;
      } else {
        jednotky.push(slovo);
      }
    });
    return jednotky;
  }

  /* Oddělovač na konci řádku se vynechá. */
  function bezOddelovace(radek) {
    return String(radek).replace(/\s*·\s*$/, '');
  }

  /* Zalomení textu na řádky, které se vejdou do šířky.
     Samostatný oddělovač „·“ nikdy nezačíná ani nekončí řádek. */
  function zalomText(text, maxSirka, velikost, sirkaFn) {
    var jednotky = jednotkyTextu(text);
    var radky = [];
    var radek = '';
    jednotky.forEach(function (jednotka) {
      if (jednotka === ODDELOVAC) {
        if (!radek) {
          return;                              /* nikdy nezačíná řádek */
        }
        var sOddelovacem = radek + ' ' + jednotka;
        if (sirkaFn(sOddelovacem, velikost) <= maxSirka) {
          radek = sOddelovacem;                /* vejde se doprostřed řádku */
        }
        /* nevejde-li se, oddělovač se z řádku vynechá */
        return;
      }
      var zkus = radek ? radek + ' ' + jednotka : jednotka;
      if (radek && sirkaFn(zkus, velikost) > maxSirka) {
        radky.push(bezOddelovace(radek));
        radek = jednotka;
      } else {
        radek = zkus;
      }
    });
    if (radek) {
      radky.push(bezOddelovace(radek));
    }
    return radky;
  }

  /* Rozvržení textu tabule: největší písmo, řádky na středu rámu. */
  function rozvrhTabule(text, ram, sirkaFn, okraj) {
    var r = ram || {};
    var x = cislo(r.x, 0);
    var y = cislo(r.y, 0);
    var w = cislo(r.w, 0);
    var h = cislo(r.h, 0);
    var mez = cislo(okraj, 0);
    var vnitrniSirka = w - 2 * mez;
    var vnitrniVyska = h - 2 * mez;

    var sestav = function (radky, velikost, vyskaRadku) {
      var celkem = vyskaRadku * radky.length;
      var stredX = x + w / 2;
      var stredY = y + h / 2;
      return {
        velikost: velikost,
        radky: radky.map(function (radek, poradi) {
          return {
            text: radek,
            x: stredX,
            y: stredY - celkem / 2 + vyskaRadku * (poradi + 0.5)
          };
        })
      };
    };

    var posledni = null;
    for (var velikost = MAX_VELIKOST; velikost >= MIN_VELIKOST; velikost -= 1) {
      var radky = zalomText(text, vnitrniSirka, velikost, sirkaFn);
      var vyskaRadku = Math.round(velikost * VYSKA_RADKU);
      if (!radky.length) {
        return { velikost: velikost, radky: [] };
      }
      var vejdeSe = vyskaRadku * radky.length <= vnitrniVyska;
      if (vejdeSe) {
        for (var i = 0; i < radky.length; i += 1) {
          if (sirkaFn(radky[i], velikost) > vnitrniSirka) {
            vejdeSe = false;
            break;
          }
        }
      }
      if (vejdeSe) {
        return sestav(radky, velikost, vyskaRadku);
      }
      posledni = { radky: radky, vyskaRadku: vyskaRadku };
    }

    /* Nevejde se ani nejmenší písmo: jen tolik řádků, kolik se vejde (aspoň 1). */
    if (!posledni) {
      return { velikost: MIN_VELIKOST, radky: [] };
    }
    var maxRadku = Math.max(1, Math.floor(vnitrniVyska / posledni.vyskaRadku));
    return sestav(posledni.radky.slice(0, maxRadku), MIN_VELIKOST, posledni.vyskaRadku);
  }

  /* Počáteční vodorovný posun scény, aby záběr začínal na středu. */
  function pocatecniPosun(sirkaPlatna, sirkaOkna) {
    var platno = cislo(sirkaPlatna, 0);
    var okno = cislo(sirkaOkna, 0);
    return Math.max(0, Math.round((platno - okno) / 2));
  }

  /* Viditelná část scény v souřadnicích scény. */
  function viditelnyRozsah(posun, sirkaOkna, sirkaPlatna, sirkaSceny) {
    var posunuta = cislo(posun, 0);
    var okno = cislo(sirkaOkna, 0);
    var platno = cislo(sirkaPlatna, 0);
    var scena = cislo(sirkaSceny, platno);
    if (!(platno > 0)) {
      platno = scena > 0 ? scena : 1;
    }
    var meritko = scena / platno;
    return {
      x0: Math.round(posunuta * meritko),
      x1: Math.round(Math.min(scena, (posunuta + okno) * meritko))
    };
  }

  /* Rozmístění štítků hlavičky ve viditelné části scény.
     Na šířku se vejdou vedle sebe, jinak jde „aktualizováno“ na druhý řádek. */
  function rozvrhStitku(rozsah, sirkaRezim, sirkaAkt) {
    var r = rozsah || {};
    var x0 = cislo(r.x0, 0);
    var x1 = cislo(r.x1, x0);
    var rezim = cislo(sirkaRezim, 0);
    var akt = cislo(sirkaAkt, 0);
    var odsazeni = 18;      /* od okraje viditelné části */
    var mezera = 18;        /* mezi štítky */
    var vyskaStitku = 34;
    var svisle = 6;         /* mezi řádky štítků */
    var vysledek = {
      rezim: { x: x0 + odsazeni, y: odsazeni },
      akt: null
    };
    if (x0 + odsazeni + rezim + mezera + akt <= x1 - odsazeni) {
      vysledek.akt = { x: x1 - odsazeni - akt, y: odsazeni };
    } else {
      vysledek.akt = { x: x0 + odsazeni, y: odsazeni + vyskaStitku + svisle };
    }
    return vysledek;
  }

  var API = {
    stavyVCase: stavyVCase,
    jmenovkaY: jmenovkaY,
    zkratText: zkratText,
    rozvrhTabule: rozvrhTabule,
    pocatecniPosun: pocatecniPosun,
    viditelnyRozsah: viditelnyRozsah,
    rozvrhStitku: rozvrhStitku
  };

  global.FL1Logika = API;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})(typeof window !== 'undefined' ? window : globalThis);
