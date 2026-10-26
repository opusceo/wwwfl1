/* Živá kancelář FL1 – scéna, animace, polling.
   Jedna scéna v canvasu 1536×864, vlastní JS bez knihoven a bez CDN.
   Všechna čísla pocházejí z verejne.json; chybí-li údaj, kreslí se „—“.
   Souřadnice a rozměry jsou v assets/mista.json. */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* 1. Konstanty a stav                                              */
  /* ---------------------------------------------------------------- */

  var SIRKA = 1536;
  var VYSKA = 864;
  var POLL_MS = 60000;             /* načítání verejne.json každých 60 s */
  var RUCNI_PLATNOST_MS = 300000;  /* ruční volba režimu platí 5 minut */
  var PREHRANI_MS = 60000;         /* záznam dne se přehraje za ~60 s */
  var DEN_MS = 86400000;           /* 24 h v milisekundách */
  var NOC_OD = 19;                 /* noc 19:00–6:59 pražského času */
  var NOC_DO = 7;

  var PLATNO = document.getElementById('platno');
  var CTX = PLATNO ? PLATNO.getContext('2d') : null;
  if (CTX) {
    CTX.imageSmoothingEnabled = false;
  }

  var LISTA_STAV = document.getElementById('stav');
  var PREPINAC = document.getElementById('prepinac');

  var STAV = {
    data: null,
    mista: null,
    obrazky: {},
    postavy: [],
    rezim: 'zive',
    rucniRezim: null,
    rucniDo: 0,
    zapis: null,
    mince: [],
    texty: [],
    karta: null,
    ticker: [],
    tickerIdx: 0,
    tickerOd: 0,
    casNacitani: 0,
    casPoslednihoSnimku: 0,
    snimek: 0
  };

  /* Vedení firmy má vždy sprite „stoji“ (sprity „sedi“ obsahují vlastní stůl). */
  var VEDENI = ['marcus', 'antoninus', 'catulus', 'maximus', 'sextus'];

  /* Druhy práce lidskou řečí pro ticker. */
  var SLOVESA = {
    'hledání na webu': 'hledá na webu',
    'plánování': 'plánuje',
    'programování': 'programuje',
    'kontrola kódu': 'kontroluje kód',
    'kreslení': 'kreslí',
    'psaní textů': 'píše texty',
    'testy': 'testuje',
    'čtení textů': 'čte texty',
    'shrnutí a úvahy': 'shrnoval a uvažoval',
    'provádí postup': 'provádí postup',
    'ověřování faktů': 'ověřuje fakta',
    'drobné úkoly': 'dělá drobné úkoly'
  };

  var SNIZENY_POHYB = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (window.matchMedia) {
    try {
      var dotazPohybu = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (dotazPohybu.addEventListener) {
        dotazPohybu.addEventListener('change', function (udalost) {
          SNIZENY_POHYB = !!udalost.matches;
        });
      }
    } catch (chyba) {
      console.error('Nelze sledovat prefers-reduced-motion:', chyba);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 2. Pomocné funkce                                                */
  /* ---------------------------------------------------------------- */

  function prazdno(hodnota) {
    return hodnota === null || hodnota === undefined || hodnota === '';
  }

  function neboPomlcka(hodnota) {
    return prazdno(hodnota) ? '—' : String(hodnota);
  }

  function kcText(castka) {
    if (typeof castka !== 'number' || !isFinite(castka)) {
      return '—';
    }
    var zaokrouhleno = Math.round(castka * 100) / 100;
    return zaokrouhleno.toFixed(2).replace('.', ',') + ' Kč';
  }

  function formatPraha(datum, volby) {
    if (!datum || isNaN(datum.getTime())) {
      return '—';
    }
    var zaklad = { timeZone: 'Europe/Prague' };
    if (volby) {
      Object.keys(volby).forEach(function (klic) { zaklad[klic] = volby[klic]; });
    }
    try {
      return new Intl.DateTimeFormat('cs-CZ', zaklad).format(datum);
    } catch (chyba) {
      console.error('Chyba formátu pražského času:', chyba);
      return '—';
    }
  }

  function hodinaPraha(datum) {
    if (!datum || isNaN(datum.getTime())) {
      return null;
    }
    try {
      var text = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Prague',
        hour: '2-digit',
        hour12: false
      }).format(datum);
      var hodina = parseInt(text, 10);
      return isFinite(hodina) ? hodina : null;
    } catch (chyba) {
      console.error('Chyba hodiny Europe/Prague:', chyba);
      return null;
    }
  }

  function jeNoc(datum) {
    var hodina = hodinaPraha(datum || new Date());
    if (hodina === null) {
      return false;
    }
    return hodina >= NOC_OD || hodina < NOC_DO;
  }

  function hodinyMinuty(datum) {
    if (!datum || isNaN(datum.getTime())) {
      return '—';
    }
    return formatPraha(datum, { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function parsujCas(text) {
    if (!text) {
      return null;
    }
    var datum = new Date(text);
    if (isNaN(datum.getTime())) {
      return null;
    }
    return datum;
  }

  function klicJmena(jmeno) {
    return String(jmeno || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function bod(pozice) {
    return { x: pozice && isFinite(pozice.x) ? pozice.x : SIRKA / 2,
      y: pozice && isFinite(pozice.y) ? pozice.y : VYSKA / 2 };
  }

  function normalizujStav(stav) {
    if (stav === 'pracuje') {
      return 'pracuje';
    }
    return 'nic';
  }

  function najdiPostavu(jmeno) {
    var klic = klicJmena(jmeno);
    for (var i = 0; i < STAV.postavy.length; i += 1) {
      if (STAV.postavy[i].klic === klic) {
        return STAV.postavy[i];
      }
    }
    return null;
  }

  function nastavListu(text) {
    if (!LISTA_STAV) {
      return;
    }
    if (text) {
      LISTA_STAV.textContent = text;
      return;
    }
    var data = STAV.data;
    var kousek = STAV.rezim === 'zaznam' ? 'záznam dne' : 'živě';
    var razitko = data ? hodinyMinuty(parsujCas(data.vypocteno)) : '—';
    LISTA_STAV.textContent = kousek + ' · data z ' + razitko;
  }

  /* ---------------------------------------------------------------- */
  /* 3. Načítání dat a souřadnic                                      */
  /* ---------------------------------------------------------------- */

  function nactiMista() {
    return fetch('assets/mista.json', { cache: 'no-store' })
      .then(function (odpoved) {
        if (!odpoved.ok) {
          throw new Error('HTTP ' + odpoved.status + ' (assets/mista.json)');
        }
        return odpoved.json();
      })
      .then(function (mista) {
        STAV.mista = mista;
        pripravPostavy();
      })
      .catch(function (chyba) {
        console.error('Načtení assets/mista.json selhalo:', chyba);
        STAV.mista = null;
      });
  }

  function nactiData() {
    return fetch('verejne.json', { cache: 'no-store' })
      .then(function (odpoved) {
        if (!odpoved.ok) {
          throw new Error('HTTP ' + odpoved.status + ' (verejne.json)');
        }
        return odpoved.json();
      })
      .then(function (data) {
        if (!data || typeof data !== 'object') {
          throw new Error('verejne.json neobsahuje objekt');
        }
        STAV.data = data;
        STAV.casNacitani = Date.now();
        pouzijRezimZDat(data);
        pripravPostavy();
        pripravTicker();
        pripravZaznam();
        nastavListu();
      })
      .catch(function (chyba) {
        console.error('Načtení verejne.json selhalo:', chyba);
        nastavListu('data nedostupná');
      });
  }

  function nactiObrazek(klic, cesta) {
    return new Promise(function (hotovo) {
      var obrazek = new Image();
      obrazek.onload = function () {
        STAV.obrazky[klic] = obrazek;
        hotovo(obrazek);
      };
      obrazek.onerror = function () {
        console.error('Chybí obrázek: ' + cesta);
        STAV.obrazky[klic] = null;
        hotovo(null);
      };
      obrazek.src = cesta;
    });
  }

  function nactiAssety() {
    var seznam = [
      ['noc', 'assets/noc.png'],
      ['den', 'assets/den.png'],
      ['mince', 'assets/mince.png']
    ];
    var jmena = {};
    var postavy = STAV.data && Array.isArray(STAV.data.postavy) ? STAV.data.postavy : [];
    postavy.forEach(function (postava) {
      var klic = klicJmena(postava.postava);
      if (!klic) {
        return;
      }
      jmena[klic] = true;
    });
    Object.keys(jmena).forEach(function (klic) {
      seznam.push([klic + '-stoji', 'assets/' + klic + '-stoji.png']);
      if (VEDENI.indexOf(klic) < 0) {
        seznam.push([klic + '-sedi-zady', 'assets/' + klic + '-sedi-zady.png']);
      }
    });
    return Promise.all(seznam.map(function (dvojice) {
      return nactiObrazek(dvojice[0], dvojice[1]);
    }));
  }

  /* ---------------------------------------------------------------- */
  /* 4. Místa postav (domov = odpočívárna / vlastní místo, práce)     */
  /* ---------------------------------------------------------------- */

  function poziceProPostavu(jmeno, idxPrac) {
    var mista = STAV.mista;
    var vysledek = { domov: null, prace: null, obrazovka: null, sedi: false };
    var klic = klicJmena(jmeno);
    if (!mista) {
      return vysledek;
    }

    if (klic === 'marcus' && mista.marcus) {
      vysledek.domov = bod({ x: mista.marcus.spodek_x, y: mista.marcus.spodek_y });
      vysledek.prace = vysledek.domov;
      return vysledek;
    }
    if (klic === 'antoninus' && mista.antoninus) {
      vysledek.domov = bod({ x: mista.antoninus.spodek_x, y: mista.antoninus.spodek_y });
      vysledek.prace = vysledek.domov;
      vysledek.obrazovka = 'antoninus';
      return vysledek;
    }
    if (klic === 'catulus' && mista.stojan) {
      vysledek.domov = bod({ x: mista.stojan.spodek_x, y: mista.stojan.spodek_y });
      vysledek.prace = vysledek.domov;
      return vysledek;
    }
    if (klic === 'maximus' && mista.dilna && mista.dilna[0]) {
      vysledek.domov = bod({ x: mista.dilna[0].spodek_x, y: mista.dilna[0].spodek_y });
      vysledek.prace = vysledek.domov;
      vysledek.obrazovka = 'dilna-' + mista.dilna[0].id;
      return vysledek;
    }
    if (klic === 'sextus' && mista.dilna && mista.dilna[1]) {
      vysledek.domov = bod({ x: mista.dilna[1].spodek_x, y: mista.dilna[1].spodek_y });
      vysledek.prace = vysledek.domov;
      vysledek.obrazovka = 'dilna-' + mista.dilna[1].id;
      return vysledek;
    }

    /* Pracovníci: domov v odpočívárně O1–O7, práce na stoličce S1–S7. */
    var odpocivarna = Array.isArray(mista.odpocivarna) ? mista.odpocivarna : [];
    var stoly = Array.isArray(mista.stoly) ? mista.stoly : [];
    if (odpocivarna.length) {
      var misto = odpocivarna[idxPrac % odpocivarna.length];
      vysledek.domov = bod({ x: misto.spodek_x, y: misto.spodek_y });
    }
    if (stoly.length) {
      var stul = stoly[idxPrac % stoly.length];
      vysledek.prace = bod({ x: stul.spodek_x, y: stul.spodek_y });
      vysledek.obrazovka = 'stul-' + stul.id;
      vysledek.sedi = true;
    }
    return vysledek;
  }

  function pripravPostavy() {
    var data = STAV.data;
    if (!data) {
      return;
    }
    var seznam = Array.isArray(data.postavy) ? data.postavy : [];
    var pracovnici = seznam.filter(function (postava) {
      return VEDENI.indexOf(klicJmena(postava.postava)) < 0;
    });
    var nove = [];
    seznam.forEach(function (postava, poradi) {
      var klic = klicJmena(postava.postava);
      if (!klic) {
        return;
      }
      var vedeni = VEDENI.indexOf(klic) >= 0;
      var idxPrac = vedeni ? -1 : pracovnici.indexOf(postava);
      if (!vedeni && idxPrac < 0) {
        idxPrac = poradi;
      }
      var poz = poziceProPostavu(postava.postava, idxPrac < 0 ? 0 : idxPrac);
      var stara = najdiPostavu(postava.postava);
      var domov = bod(poz.domov || { x: SIRKA / 2, y: VYSKA / 2 });
      nove.push({
        jmeno: postava.postava,
        klic: klic,
        vedeni: vedeni,
        idxPrac: idxPrac,
        stav: normalizujStav(postava.stav),
        stavData: postava.stav || null,
        druh: postava.druh || null,
        cenaKc: typeof postava.cena_kc === 'number' ? postava.cena_kc : null,
        od: postava.od || null,
        domov: domov,
        prace: bod(poz.prace || domov),
        obrazovka: poz.obrazovka,
        sedi: !!poz.sedi,
        pozice: stara ? bod(stara.pozice) : bod(domov),
        cil: stara ? bod(stara.cil) : bod(domov)
      });
    });
    STAV.postavy = nove;
    STAV.karta = null;
  }

  /* ---------------------------------------------------------------- */
  /* 5. Režim ŽIVĚ / ZÁZNAM DNE                                       */
  /* ---------------------------------------------------------------- */

  function rezimZDat(data) {
    return data && data.rezim === 'zaznam' ? 'zaznam' : 'zive';
  }

  function pouzijRezimZDat(data) {
    var ted = Date.now();
    if (STAV.rucniDo > ted && STAV.rucniRezim) {
      /* Ruční volba má přednost, dokud neuplyne 5 minut. */
      STAV.rezim = STAV.rucniRezim;
      return;
    }
    STAV.rucniDo = 0;
    STAV.rucniRezim = null;
    STAV.rezim = rezimZDat(data);
  }

  function prehodRezim() {
    var novy = STAV.rezim === 'zaznam' ? 'zive' : 'zaznam';
    STAV.rezim = novy;
    STAV.rucniRezim = novy;
    STAV.rucniDo = Date.now() + RUCNI_PLATNOST_MS;
    if (novy === 'zaznam') {
      pripravZaznam(true);
    }
    aktualizujPrepinac();
    nastavListu();
  }

  function aktualizujPrepinac() {
    if (!PREPINAC) {
      return;
    }
    PREPINAC.textContent = STAV.rezim === 'zaznam' ? 'ZÁZNAM DNE' : 'ŽIVĚ';
    PREPINAC.setAttribute('title', 'Přepnout na ' + (STAV.rezim === 'zaznam' ? 'ŽIVĚ' : 'ZÁZNAM DNE'));
  }

  function pohlidatRucniVolbu() {
    if (STAV.rucniDo && Date.now() > STAV.rucniDo) {
      STAV.rucniDo = 0;
      STAV.rucniRezim = null;
      STAV.rezim = rezimZDat(STAV.data);
      if (STAV.rezim === 'zaznam') {
        pripravZaznam(true);
      }
      aktualizujPrepinac();
      nastavListu();
    }
  }

  function pripravZaznam(vynutit) {
    var data = STAV.data;
    if (!data) {
      return;
    }
    if (STAV.zapis && !vynutit) {
      return;
    }
    var konec = parsujCas(data.vypocteno);
    if (!konec) {
      konec = new Date();
    }
    var start = konec.getTime() - DEN_MS;
    var udalosti = Array.isArray(data.udalosti) ? data.udalosti.slice() : [];
    var vybrane = [];
    udalosti.forEach(function (udalost) {
      var cas = parsujCas(udalost && udalost.cas);
      if (!cas) {
        return;
      }
      var ms = cas.getTime();
      if (ms >= start && ms <= konec.getTime()) {
        vybrane.push({
          cas: ms,
          postava: udalost.postava || null,
          typ: udalost.typ || null,
          druh: udalost.druh || null,
          cenaKc: typeof udalost.cena_kc === 'number' ? udalost.cena_kc : null
        });
      }
    });
    vybrane.sort(function (a, b) { return a.cas - b.cas; });
    STAV.zapis = {
      start: start,
      konec: konec.getTime(),
      udalosti: vybrane,
      t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      hotovo: false,
      zobrazenyCas: start,
      posledniIndex: -1
    };
  }

  function zaznamHotovy() {
    return !!(STAV.zapis && STAV.zapis.hotovo);
  }

  function casZaznamu() {
    var zapis = STAV.zapis;
    if (!zapis) {
      return null;
    }
    return new Date(zapis.zobrazenyCas);
  }

  /* Stavy postav podle událostí přehraných do zadaného času. */
  function stavyZeZaznamu(casMs) {
    var mapa = {};
    var zapis = STAV.zapis;
    if (!zapis) {
      return mapa;
    }
    for (var i = 0; i < zapis.udalosti.length; i += 1) {
      var udalost = zapis.udalosti[i];
      if (udalost.cas > casMs) {
        break;
      }
      if (!udalost.postava) {
        continue;
      }
      var klic = klicJmena(udalost.postava);
      var stav = mapa[klic] || { stav: 'nic', druh: null };
      if (udalost.druh) {
        stav.druh = udalost.druh;
      }
      if (udalost.typ === 'start' || udalost.typ === 'rozdeleni') {
        stav.stav = 'pracuje';
      } else if (udalost.typ === 'hotovo' || udalost.typ === 'schvaleno' || udalost.typ === 'vraceno') {
        stav.stav = 'nic';
      }
      mapa[klic] = stav;
    }
    return mapa;
  }

  /* ---------------------------------------------------------------- */
  /* 6. Scéna: pozadí, záře, sprity                                   */
  /* ---------------------------------------------------------------- */

  function kresliPozadi() {
    var noc = jeNoc(new Date());
    var obrazek = noc ? STAV.obrazky.noc : STAV.obrazky.den;
    if (!obrazek) {
      obrazek = STAV.obrazky.den || STAV.obrazky.noc;
    }
    CTX.imageSmoothingEnabled = false;
    if (obrazek) {
      CTX.drawImage(obrazek, 0, 0, SIRKA, VYSKA);
    } else {
      CTX.fillStyle = noc ? '#120f1c' : '#242018';
      CTX.fillRect(0, 0, SIRKA, VYSKA);
      console.error('Chybí pozadí scény (noc/den).');
    }
  }

  /* Jemné pulzování záře; při omezeném pohybu je záře stálá. */
  function pulz(rychlost, faze) {
    if (SNIZENY_POHYB) {
      return 1;
    }
    var cas = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return 0.82 + 0.18 * Math.sin(cas / rychlost + (faze || 0));
  }

  function kresliZari(x, y, polomer, barva, intenzita) {
    if (!isFinite(x) || !isFinite(y) || !(polomer > 0) || !(intenzita > 0)) {
      return;
    }
    var prechod = CTX.createRadialGradient(x, y, 0, x, y, polomer);
    prechod.addColorStop(0, 'rgba(' + barva + ',' + (0.5 * intenzita).toFixed(3) + ')');
    prechod.addColorStop(0.45, 'rgba(' + barva + ',' + (0.2 * intenzita).toFixed(3) + ')');
    prechod.addColorStop(1, 'rgba(' + barva + ',0)');
    CTX.fillStyle = prechod;
    CTX.beginPath();
    CTX.arc(x, y, polomer, 0, Math.PI * 2);
    CTX.fill();
  }

  /* Plameny: záře jen v noci (19:00–6:59 Praha), ve dne nic. */
  function kresliPlameny() {
    var mista = STAV.mista;
    if (!mista || !Array.isArray(mista.plameny)) {
      return;
    }
    if (!jeNoc(new Date())) {
      return;
    }
    mista.plameny.forEach(function (plamen, poradi) {
      if (!isFinite(plamen.x) || !isFinite(plamen.y)) {
        return;
      }
      kresliZari(plamen.x, plamen.y, 100 * pulz(900, poradi * 1.3), '255,206,120', 1);
    });
  }

  /* Obrazovky: x, y v mista.json je STŘED, záře jen u pracující postavy. */
  function kresliObrazovky() {
    var mista = STAV.mista;
    if (!mista || !Array.isArray(mista.obrazovky)) {
      return;
    }
    var obsazene = {};
    STAV.postavy.forEach(function (postava) {
      if (postava.stav === 'pracuje' && postava.obrazovka) {
        obsazene[postava.obrazovka] = true;
      }
    });
    mista.obrazovky.forEach(function (obrazovka, poradi) {
      if (!obsazene[obrazovka.id]) {
        return;
      }
      var stredX = isFinite(obrazovka.x) ? obrazovka.x : null;
      var stredY = isFinite(obrazovka.y) ? obrazovka.y : null;
      if (stredX === null || stredY === null) {
        return;
      }
      var zaklad = Math.max(obrazovka.w || 0, obrazovka.h || 0) * 1.2;
      kresliZari(stredX, stredY, zaklad * pulz(1300, poradi), '150,210,255', 1);
    });
  }

  function cekaNaOwnera() {
    var data = STAV.data;
    if (!data) {
      return 0;
    }
    var hodnota = data.ceka_na_ownera;
    if (typeof hodnota === 'number' && isFinite(hodnota) && hodnota > 0) {
      return hodnota;
    }
    return 0;
  }

  /* Schránka: pulzující záře, když ceka_na_ownera > 0. */
  function kresliSchranku() {
    var mista = STAV.mista;
    if (!mista || !mista.schranka) {
      return;
    }
    var ceka = cekaNaOwnera();
    if (!ceka) {
      return;
    }
    var sila = Math.min(1, 0.35 + ceka * 0.15);
    kresliZari(mista.schranka.stred_x, mista.schranka.stred_y, 92 * pulz(700), '255,190,90', sila);
  }

  function denPraha(datum) {
    if (!datum || isNaN(datum.getTime())) {
      return null;
    }
    return formatPraha(datum, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function referencniDatum() {
    var data = STAV.data;
    var razitko = data ? parsujCas(data.vypocteno) : null;
    return razitko || new Date();
  }

  /* Události dnešního pražského dne (podle vypocteno). */
  function dnesniUdalosti() {
    var data = STAV.data;
    var vysledek = [];
    if (!data || !Array.isArray(data.udalosti)) {
      return vysledek;
    }
    var dnes = denPraha(referencniDatum());
    data.udalosti.forEach(function (udalost) {
      var cas = parsujCas(udalost && udalost.cas);
      if (!cas) {
        return;
      }
      if (denPraha(cas) !== dnes) {
        return;
      }
      vysledek.push({
        cas: cas.getTime(),
        postava: udalost.postava || null,
        typ: udalost.typ || null,
        druh: udalost.druh || null,
        cenaKc: typeof udalost.cena_kc === 'number' ? udalost.cena_kc : null
      });
    });
    return vysledek;
  }

  function utrataDnes() {
    var data = STAV.data || {};
    if (data.dnes && typeof data.dnes.cena_kc === 'number' && isFinite(data.dnes.cena_kc)) {
      return data.dnes.cena_kc;
    }
    return null;
  }

  /* Prahy pokladničky z dat; v datech nemusí být, pak rozhoduje medián dne. */
  function prahyPokladnicky() {
    var data = STAV.data || {};
    var kandidati = [data.prahy, data.prahy_pokladnicky, data.cisla ? data.cisla.prahy : null];
    for (var i = 0; i < kandidati.length; i += 1) {
      var prahy = kandidati[i];
      if (!prahy) {
        continue;
      }
      if (Array.isArray(prahy)) {
        if (typeof prahy[0] === 'number') {
          return { jedna: prahy[0], dve: typeof prahy[1] === 'number' ? prahy[1] : null };
        }
        continue;
      }
      if (typeof prahy === 'object') {
        var jedna = typeof prahy.jedna === 'number' ? prahy.jedna
          : (typeof prahy['1'] === 'number' ? prahy['1'] : null);
        var dve = typeof prahy.dve === 'number' ? prahy.dve
          : (typeof prahy['2'] === 'number' ? prahy['2'] : null);
        if (jedna !== null) {
          return { jedna: jedna, dve: dve };
        }
      }
    }
    return null;
  }

  function medianDnesnichHotovych() {
    var ceny = [];
    dnesniUdalosti().forEach(function (udalost) {
      if (udalost.typ === 'hotovo' && typeof udalost.cenaKc === 'number' && isFinite(udalost.cenaKc)) {
        ceny.push(udalost.cenaKc);
      }
    });
    if (!ceny.length) {
      return null;
    }
    ceny.sort(function (a, b) { return a - b; });
    var stred = Math.floor(ceny.length / 2);
    if (ceny.length % 2 === 1) {
      return ceny[stred];
    }
    return (ceny[stred - 1] + ceny[stred]) / 2;
  }

  /* Stav pokladničky 0/1/2 podle dnešní útraty. */
  function stavPokladnicky() {
    var utrata = utrataDnes();
    if (utrata === null) {
      return null;
    }
    if (!(utrata > 0)) {
      return 0;
    }
    var prahy = prahyPokladnicky();
    if (prahy && typeof prahy.jedna === 'number') {
      if (typeof prahy.dve === 'number' && utrata > prahy.dve) {
        return 2;
      }
      if (utrata > prahy.jedna) {
        return 2;
      }
      return 1;
    }
    var median = medianDnesnichHotovych();
    if (median !== null && utrata > median) {
      return 2;
    }
    return 1;
  }

  /* Pokladnička je v pozadí, kreslí se jen záře podle stavu a mince. */
  function kresliPokladnicku() {
    var mista = STAV.mista;
    if (!mista || !mista.pokladnicka) {
      return;
    }
    var stavCislo = stavPokladnicky();
    if (stavCislo === null || stavCislo === 0) {
      return;
    }
    var sila = stavCislo >= 2 ? 1 : 0.6;
    kresliZari(mista.pokladnicka.stred_x, mista.pokladnicka.stred_y, 88 * pulz(1100), '255,215,120', sila);
  }

  function spriteKlic(postava) {
    if (postava.stav === 'pracuje' && !postava.vedeni && postava.sedi) {
      return postava.klic + '-sedi-zady';
    }
    return postava.klic + '-stoji';
  }

  function kresliSprite(postava) {
    var klic = spriteKlic(postava);
    var obrazek = STAV.obrazky[klic];
    var pozice = postava.pozice;
    if (obrazek && obrazek.width && obrazek.height) {
      var sirka = obrazek.width;
      var vyska = obrazek.height;
      postava.sirka = sirka;
      postava.vyska = vyska;
      CTX.imageSmoothingEnabled = false;
      CTX.drawImage(obrazek, Math.round(pozice.x - sirka / 2), Math.round(pozice.y - vyska));
      return;
    }
    /* Zástupný obdélník, když sprite chybí. */
    var zastupnaSirka = 60;
    var zastupnaVyska = 130;
    postava.sirka = zastupnaSirka;
    postava.vyska = zastupnaVyska;
    CTX.fillStyle = '#6b5237';
    CTX.fillRect(Math.round(pozice.x - zastupnaSirka / 2),
      Math.round(pozice.y - zastupnaVyska), zastupnaSirka, zastupnaVyska);
    CTX.fillStyle = '#2B1D14';
    CTX.fillRect(Math.round(pozice.x - zastupnaSirka / 2) + 8,
      Math.round(pozice.y - zastupnaVyska) + 10, zastupnaSirka - 16, 18);
    console.error('Chybí sprite ' + klic + ' pro postavu ' + postava.jmeno);
  }

  /* Jmenovka: přesahovala-li by spodní okraj plátna, kreslí se nad hlavou. */
  function kresliJmenovku(postava) {
    var text = String(postava.jmeno || '');
    if (!text) {
      return;
    }
    CTX.font = 'bold 13px system-ui, sans-serif';
    var sirka = Math.ceil(CTX.measureText(text).width) + 12;
    var vyska = 18;
    var pozice = postava.pozice;
    var x = Math.round(pozice.x - sirka / 2);
    var y = Math.round(pozice.y + 4);
    if (y + vyska > VYSKA) {
      y = Math.round(pozice.y - (postava.vyska || 130) - vyska - 2);
    }
    if (y < 0) {
      y = 0;
    }
    if (x < 0) {
      x = 0;
    }
    if (x + sirka > SIRKA) {
      x = SIRKA - sirka;
    }
    CTX.fillStyle = 'rgba(43,29,20,0.72)';
    CTX.fillRect(x, y, sirka, vyska);
    CTX.textAlign = 'center';
    CTX.textBaseline = 'middle';
    CTX.fillStyle = '#d8c9a8';
    CTX.fillText(text, x + sirka / 2, y + vyska / 2 + 1);
    CTX.textAlign = 'left';
    CTX.textBaseline = 'alphabetic';
  }

  /* Cedulka s druhem práce jen u stavu „pracuje“, šířka podle textu. */
  function kresliCedulku(postava) {
    if (postava.stav !== 'pracuje' || !postava.druh) {
      return;
    }
    var text = String(postava.druh);
    CTX.font = '13px system-ui, sans-serif';
    var sirka = Math.ceil(CTX.measureText(text).width) + 16;
    var vyska = 20;
    var pozice = postava.pozice;
    var x = Math.round(pozice.x - sirka / 2);
    var y = Math.round(pozice.y - (postava.vyska || 130) - vyska - 10);
    if (y < 0) {
      y = 0;
    }
    if (x < 0) {
      x = 0;
    }
    if (x + sirka > SIRKA) {
      x = SIRKA - sirka;
    }
    CTX.fillStyle = 'rgba(43,29,20,0.88)';
    CTX.fillRect(x, y, sirka, vyska);
    CTX.font = '13px system-ui, sans-serif';
    CTX.textAlign = 'left';
    CTX.textBaseline = 'middle';
    CTX.lineJoin = 'round';
    CTX.lineWidth = 3;
    CTX.strokeStyle = '#2B1D14';
    CTX.strokeText(text, x + 8, y + vyska / 2);
    CTX.fillStyle = '#F3E9D2';
    CTX.fillText(text, x + 8, y + vyska / 2);
    CTX.textBaseline = 'alphabetic';
  }

  function kresliPostavy() {
    var serazene = STAV.postavy.slice().sort(function (a, b) {
      return a.pozice.y - b.pozice.y;
    });
    serazene.forEach(function (postava) {
      kresliSprite(postava);
      kresliJmenovku(postava);
      kresliCedulku(postava);
    });
  }

  /* Text tabule ze společného modulu tabule.js. */
  function textTabule() {
    if (typeof window.tabule === 'function') {
      try {
        return window.tabule(STAV.data || {});
      } catch (chyba) {
        console.error('Výpočet tabule selhal:', chyba);
        return '—';
      }
    }
    console.error('Chybí funkce tabule() z tabule.js');
    return '—';
  }

  function rozdelText(text, maxSirka) {
    var slova = String(text).split(' ');
    var radky = [];
    var radek = '';
    slova.forEach(function (slovo) {
      var zkus = radek ? radek + ' ' + slovo : slovo;
      if (radek && CTX.measureText(zkus).width > maxSirka) {
        radky.push(radek);
        radek = slovo;
      } else {
        radek = zkus;
      }
    });
    if (radek) {
      radky.push(radek);
    }
    return radky;
  }

  function kresliTabule() {
    var mista = STAV.mista;
    if (!mista || !mista.tabule) {
      return;
    }
    var ram = mista.tabule;
    var sirka = isFinite(ram.w) ? ram.w : 120;
    var x = isFinite(ram.x) ? ram.x : 60;
    var y = isFinite(ram.y) ? ram.y : 235;
    CTX.font = '11px system-ui, sans-serif';
    var radky = rozdelText(textTabule(), sirka - 14);
    CTX.textAlign = 'center';
    CTX.textBaseline = 'middle';
    CTX.fillStyle = '#F3E9D2';
    radky.forEach(function (radek, poradi) {
      CTX.fillText(radek, x + sirka / 2, y + 22 + poradi * 15);
    });
    CTX.textAlign = 'left';
    CTX.textBaseline = 'alphabetic';
  }

  /* ---------------------------------------------------------------- */
  /* 7. Mince, plovoucí ceny                                          */
  /* ---------------------------------------------------------------- */

  function pridejMinci(odkud) {
    var mista = STAV.mista;
    if (!mista || !mista.pokladnicka || !odkud) {
      return;
    }
    STAV.mince.push({
      x: odkud.x,
      y: odkud.y - 40,
      cilX: isFinite(mista.pokladnicka.stred_x) ? mista.pokladnicka.stred_x : SIRKA / 2,
      cilY: isFinite(mista.pokladnicka.stred_y) ? mista.pokladnicka.stred_y : VYSKA / 2,
      kx: odkud.x,
      ky: odkud.y - 40,
      t: 0,
      trvani: SNIZENY_POHYB ? 1 : 950
    });
    if (STAV.mince.length > 40) {
      STAV.mince.shift();
    }
  }

  function pridejText(x, y, text) {
    if (!text) {
      return;
    }
    STAV.texty.push({
      x: isFinite(x) ? x : SIRKA / 2,
      y: isFinite(y) ? y : VYSKA / 2,
      text: text,
      t: 0,
      trvani: SNIZENY_POHYB ? 1 : 1700
    });
    if (STAV.texty.length > 12) {
      STAV.texty.shift();
    }
  }

  function aktualizujMince(dt) {
    var zbyle = [];
    STAV.mince.forEach(function (mince) {
      mince.t += dt;
      var podil = Math.min(1, mince.t / Math.max(1, mince.trvani));
      mince.kx = mince.x + (mince.cilX - mince.x) * podil;
      mince.ky = mince.y + (mince.cilY - mince.y) * podil - Math.sin(podil * Math.PI) * 90;
      if (podil < 1) {
        zbyle.push(mince);
      }
    });
    STAV.mince = zbyle;
  }

  function kresliMince() {
    STAV.mince.forEach(function (mince) {
      var obrazek = STAV.obrazky.mince;
      if (obrazek && obrazek.width && obrazek.height) {
        var sirka = 20;
        var vyska = Math.round(obrazek.height * (sirka / obrazek.width));
        CTX.imageSmoothingEnabled = false;
        CTX.drawImage(obrazek, Math.round(mince.kx - sirka / 2),
          Math.round(mince.ky - vyska / 2), sirka, vyska);
        return;
      }
      CTX.fillStyle = '#e8c15a';
      CTX.beginPath();
      CTX.arc(mince.kx, mince.ky, 8, 0, Math.PI * 2);
      CTX.fill();
    });
  }

  function aktualizujTexty(dt) {
    var zbyle = [];
    STAV.texty.forEach(function (text) {
      text.t += dt;
      if (text.t < text.trvani) {
        zbyle.push(text);
      }
    });
    STAV.texty = zbyle;
  }

  function kresliTexty() {
    CTX.font = 'bold 15px system-ui, sans-serif';
    CTX.textAlign = 'center';
    CTX.textBaseline = 'middle';
    STAV.texty.forEach(function (text) {
      var podil = Math.min(1, text.t / Math.max(1, text.trvani));
      var y = text.y - podil * 40;
      var pruhlednost = 1 - podil * 0.75;
      CTX.lineJoin = 'round';
      CTX.lineWidth = 3;
      CTX.strokeStyle = '#2B1D14';
      CTX.globalAlpha = pruhlednost;
      CTX.strokeText(text.text, text.x, y);
      CTX.fillStyle = '#F3D98A';
      CTX.fillText(text.text, xNeboText(text), y);
      CTX.globalAlpha = 1;
    });
    CTX.textAlign = 'left';
    CTX.textBaseline = 'alphabetic';
  }

  function xNeboText(text) {
    return isFinite(text.x) ? text.x : SIRKA / 2;
  }

  /* ---------------------------------------------------------------- */
  /* 8. Režimy: ŽIVĚ, ZÁZNAM DNE, časová osa                          */
  /* ---------------------------------------------------------------- */

  function aktualizujCile() {
    if (STAV.rezim === 'zaznam' && STAV.zapis) {
      var mapa = stavyZeZaznamu(STAV.zapis.zobrazenyCas);
      STAV.postavy.forEach(function (postava) {
        var info = mapa[postava.klic];
        postava.stav = info && info.stav ? info.stav : 'nic';
        if (info && info.druh) {
          postava.druh = info.druh;
        }
        postava.cil = bod(postava.stav === 'pracuje' ? postava.prace : postava.domov);
      });
      return;
    }
    var data = STAV.data;
    var zdroj = {};
    if (data && Array.isArray(data.postavy)) {
      data.postavy.forEach(function (polozka) {
        zdroj[klicJmena(polozka.postava)] = polozka;
      });
    }
    STAV.postavy.forEach(function (postava) {
      var polozka = zdroj[postava.klic];
      postava.stav = polozka ? normalizujStav(polozka.stav) : 'nic';
      postava.stavData = polozka ? polozka.stav || null : null;
      postava.druh = polozka ? polozka.druh || null : null;
      postava.cenaKc = polozka && typeof polozka.cena_kc === 'number' ? polozka.cena_kc : null;
      postava.od = polozka ? polozka.od || null : null;
      postava.cil = bod(postava.stav === 'pracuje' ? postava.prace : postava.domov);
    });
  }

  /* Plynulý přesun postav – interpolace pozice k cíli. */
  function posunPostav(dt) {
    STAV.postavy.forEach(function (postava) {
      if (SNIZENY_POHYB) {
        postava.pozice.x = postava.cil.x;
        postava.pozice.y = postava.cil.y;
        return;
      }
      var rozdilX = postava.cil.x - postava.pozice.x;
      var rozdilY = postava.cil.y - postava.pozice.y;
      if (Math.abs(rozdilX) < 0.4 && Math.abs(rozdilY) < 0.4) {
        postava.pozice.x = postava.cil.x;
        postava.pozice.y = postava.cil.y;
        return;
      }
      var podil = 1 - Math.exp(-dt / 220);
      postava.pozice.x += rozdilX * podil;
      postava.pozice.y += rozdilY * podil;
    });
  }

  function casPrehrani() {
    if (typeof performance !== 'undefined') {
      return performance.now();
    }
    return Date.now();
  }

  /* Posun přehrávání záznamu dne. */
  function aktualizujZaznam() {
    var zapis = STAV.zapis;
    if (!zapis) {
      return;
    }
    var uplynulo = casPrehrani() - zapis.t0;
    var podil = uplynulo / PREHRANI_MS;
    if (podil >= 1) {
      podil = 1;
      zapis.hotovo = true;
    }
    zapis.podil = podil;
    zapis.zobrazenyCas = zapis.start + (zapis.konec - zapis.start) * podil;
    zpracujPrehraneUdalosti();
    if (zapis.hotovo && uplynulo > PREHRANI_MS + 8000) {
      /* po pauze se záznam přehraje znovu */
      pripravZaznam(true);
    }
  }

  /* Mince a ceny u událostí „hotovo“, které přehrání právě překročilo. */
  function zpracujPrehraneUdalosti() {
    var zapis = STAV.zapis;
    if (!zapis) {
      return;
    }
    for (var i = zapis.posledniIndex + 1; i < zapis.udalosti.length; i += 1) {
      var udalost = zapis.udalosti[i];
      if (udalost.cas > zapis.zobrazenyCas) {
        break;
      }
      zapis.posledniIndex = i;
      if (udalost.typ !== 'hotovo') {
        continue;
      }
      var postava = najdiPostavu(udalost.postava);
      var odkud = postava ? bod(postava.pozice) : { x: SIRKA / 2, y: VYSKA / 2 };
      pridejMinci(odkud);
      if (typeof udalost.cenaKc === 'number') {
        pridejText(odkud.x, odkud.y - 150, kcText(udalost.cenaKc));
      }
    }
  }

  /* Nové události „hotovo“ v režimu ŽIVĚ – mince letí do pokladničky. */
  function zpracujNoveUdalosti() {
    var data = STAV.data;
    if (!data || !Array.isArray(data.udalosti)) {
      return;
    }
    var hranice = STAV.posledniUdalostCas || 0;
    var vypocet = parsujCas(data.vypocteno);
    if (vypocet) {
      STAV.posledniUdalostCas = vypocet.getTime();
    }
    if (!hranice) {
      return;
    }
    data.udalosti.forEach(function (udalost) {
      var cas = parsujCas(udalost && udalost.cas);
      if (!cas || cas.getTime() <= hranice) {
        return;
      }
      if (udalost.typ !== 'hotovo') {
        return;
      }
      var postava = najdiPostavu(udalost.postava);
      var odkud = postava ? bod(postava.pozice) : { x: SIRKA / 2, y: VYSKA / 2 };
      pridejMinci(odkud);
      if (typeof udalost.cena_kc === 'number') {
        pridejText(odkud.x, odkud.y - 150, kcText(udalost.cena_kc));
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* 9. Ticker lidskou řečí                                           */
  /* ---------------------------------------------------------------- */

  function slovesoPro(druh) {
    if (!druh) {
      return 'pracuje';
    }
    return SLOVESA[druh] || ('pracuje na: ' + druh);
  }

  function zpravaZUdalosti(udalost) {
    var jmeno = udalost.postava || 'Někdo';
    var druh = udalost.druh || null;
    var cena = typeof udalost.cena_kc === 'number' ? udalost.cena_kc : null;
    if (udalost.typ === 'nastroj') {
      return 'Firma si postavila nový nástroj';
    }
    if (udalost.typ === 'sluzba') {
      return 'Hlídač drží noční službu';
    }
    if (udalost.typ === 'start') {
      return jmeno + ' ' + slovesoPro(druh);
    }
    if (udalost.typ === 'rozdeleni') {
      return jmeno + ' rozdělil práci' + (druh ? ' (' + druh + ')' : '');
    }
    if (udalost.typ === 'hotovo') {
      return jmeno + ' dokončil ' + (druh || 'úkol') + ' · ' + (cena !== null ? kcText(cena) : '—');
    }
    if (udalost.typ === 'schvaleno') {
      return 'Schváleno: ' + (druh || 'práce');
    }
    if (udalost.typ === 'vraceno') {
      return 'Vráceno k přepracování: ' + (druh || 'práce');
    }
    return jmeno + ' · ' + (druh || udalost.typ || '—');
  }

  function pripravTicker() {
    var data = STAV.data;
    var zpravy = [];
    var udalosti = Array.isArray(data && data.udalosti) ? data.udalosti : [];
    var od = referencniDatum().getTime() - DEN_MS;
    udalosti.forEach(function (udalost) {
      var cas = parsujCas(udalost && udalost.cas);
      if (!cas || cas.getTime() < od) {
        return;
      }
      var zprava = zpravaZUdalosti(udalost);
      if (zprava) {
        zpravy.push(zprava);
      }
    });
    zpravy.reverse();
    STAV.ticker = zpravy.slice(0, 40);
    if (STAV.tickerIdx >= STAV.ticker.length) {
      STAV.tickerIdx = 0;
    }
    STAV.tickerOd = casPrehrani();
  }

  function aktualniTicker() {
    if (!STAV.ticker.length) {
      return STAV.data ? 'klidná kancelář · —' : 'načítám data…';
    }
    var ted = casPrehrani();
    if (!SNIZENY_POHYB && ted - STAV.tickerOd > 4200) {
      STAV.tickerOd = ted;
      STAV.tickerIdx = (STAV.tickerIdx + 1) % STAV.ticker.length;
    }
    return STAV.ticker[STAV.tickerIdx];
  }

  function kresliTicker() {
    var text = aktualniTicker();
    var vyska = 30;
    var y = VYSKA - vyska - 6;
    CTX.fillStyle = 'rgba(18,13,9,0.8)';
    CTX.fillRect(8, y, SIRKA - 16, vyska);
    CTX.font = '16px system-ui, sans-serif';
    CTX.textBaseline = 'middle';
    CTX.fillStyle = '#F3E9D2';
    var popis = '◆ ' + text;
    var maxSirka = SIRKA - 48;
    while (popis.length > 3 && CTX.measureText(popis).width > maxSirka) {
      popis = popis.slice(0, -2);
    }
    CTX.fillText(popis, 20, y + vyska / 2);
    CTX.textBaseline = 'alphabetic';
  }

  /* Časová osa dole – jen v režimu ZÁZNAM DNE. */
  function kresliCasovouOsu() {
    if (STAV.rezim !== 'zaznam' || !STAV.zapis) {
      return;
    }
    var zapis = STAV.zapis;
    var x = 28;
    var y = VYSKA - 36 - 30;
    var sirka = SIRKA - 56;
    var vyska = 10;
    CTX.fillStyle = 'rgba(18,13,9,0.7)';
    CTX.fillRect(x - 10, y - 10, sirka + 20, vyska + 20);
    CTX.fillStyle = 'rgba(243,233,210,0.22)';
    CTX.fillRect(x, y, sirka, vyska);
    var podil = typeof zapis.podil === 'number' ? Math.max(0, Math.min(1, zapis.podil)) : 0;
    CTX.fillStyle = '#d8a84a';
    CTX.fillRect(x, y, sirka * podil, vyska);
    CTX.font = '13px system-ui, sans-serif';
    CTX.textBaseline = 'alphabetic';
    CTX.fillStyle = '#d8c9a8';
    CTX.textAlign = 'left';
    CTX.fillText(hodinyMinuty(new Date(zapis.start)), x, y - 14);
    CTX.textAlign = 'center';
    CTX.fillText('ZÁZNAM DNE · ' + hodinyMinuty(casZaznamu()), x + sirka / 2, y - 14);
    CTX.textAlign = 'right';
    CTX.fillText(hodinyMinuty(new Date(zapis.konec)), x + sirka, y - 14);
    CTX.textAlign = 'left';
  }

  /* ---------------------------------------------------------------- */
  /* 10. Hlavička scény (aktualizováno HH:MM, režim)                  */
  /* ---------------------------------------------------------------- */

  function kresliHlavicku() {
    var data = STAV.data;
    var razitko = data ? hodinyMinuty(parsujCas(data.vypocteno)) : '—';
    var text = 'aktualizováno ' + razitko;
    CTX.font = 'bold 19px system-ui, sans-serif';
    var sirka = Math.ceil(CTX.measureText(text).width) + 24;
    var x = SIRKA - sirka - 18;
    var y = 18;
    CTX.fillStyle = 'rgba(20,14,10,0.62)';
    CTX.fillRect(x, y, sirka, 34);
    CTX.fillStyle = '#F3E9D2';
    CTX.textBaseline = 'middle';
    CTX.fillText(text, x + 12, y + 18);
    CTX.textBaseline = 'alphabetic';

    var rezimText = STAV.rezim === 'zaznam' ? 'ZÁZNAM DNE' : 'ŽIVĚ';
    CTX.font = 'bold 19px system-ui, sans-serif';
    var rezimSirka = Math.ceil(CTX.measureText(rezimText).width) + 24;
    CTX.fillStyle = 'rgba(20,14,10,0.62)';
    CTX.fillRect(18, y, rezimSirka, 34);
    CTX.fillStyle = STAV.rezim === 'zaznam' ? '#d8a84a' : '#8fd18a';
    CTX.textBaseline = 'middle';
    CTX.fillText(rezimText, 30, y + 18);
    CTX.textBaseline = 'alphabetic';
  }

  /* ---------------------------------------------------------------- */
  /* 11. Karta postavy po kliknutí                                    */
  /* ---------------------------------------------------------------- */

  function dnesniCislaPostavy(jmeno) {
    var klic = klicJmena(jmeno);
    var vysledek = { ukol: 0, kc: 0 };
    dnesniUdalosti().forEach(function (udalost) {
      if (klicJmena(udalost.postava) !== klic) {
        return;
      }
      if (udalost.typ === 'hotovo') {
        vysledek.ukol += 1;
        if (typeof udalost.cenaKc === 'number') {
          vysledek.kc += udalost.cenaKc;
        }
      }
    });
    return vysledek;
  }

  function radkyKarty(postava) {
    var radky = [];
    radky.push({ text: String(postava.jmeno || '—'), velikost: 20, barva: '#F3E9D2', tucne: true });
    /* role = druh práce z verejne.json */
    radky.push({ text: 'role: ' + neboPomlcka(postava.druh), velikost: 14, barva: '#d8c9a8' });
    if (STAV.data) {
      var cisla = dnesniCislaPostavy(postava.jmeno);
      radky.push({ text: 'dnes úkolů: ' + cisla.ukol, velikost: 14, barva: '#d8c9a8' });
      radky.push({ text: 'dnes: ' + kcText(cisla.kc), velikost: 14, barva: '#d8c9a8' });
    } else {
      radky.push({ text: 'dnes úkolů: —', velikost: 14, barva: '#d8c9a8' });
      radky.push({ text: 'dnes: —', velikost: 14, barva: '#d8c9a8' });
    }
    radky.push({ text: 'klikni mimo kartu pro zavření', velikost: 12, barva: '#8d7d64' });
    return radky;
  }

  function kresliKartu() {
    var postava = STAV.karta;
    if (!postava || !postava.pozice) {
      return;
    }
    var radky = radkyKarty(postava);
    var sirkaTextu = 0;
    var vyskaTextu = 8;
    radky.forEach(function (radek) {
      CTX.font = (radek.tucne ? 'bold ' : '') + radek.velikost + 'px system-ui, sans-serif';
      sirkaTextu = Math.max(sirkaTextu, Math.ceil(CTX.measureText(radek.text).width));
      vyskaTextu += radek.velikost + 12;
    });
    var sirka = sirkaTextu + 30;
    var vyska = vyskaTextu + 6;
    var x = postava.pozice.x + 46;
    var y = postava.pozice.y - vyska - 24;
    if (x + sirka > SIRKA - 12) {
      x = postava.pozice.x - sirka - 46;
    }
    if (x < 12) {
      x = 12;
    }
    if (y < 60) {
      y = 60;
    }
    if (y + vyska > VYSKA - 44) {
      y = VYSKA - 44 - vyska;
    }
    CTX.fillStyle = 'rgba(24,17,12,0.92)';
    CTX.fillRect(x, y, sirka, vyska);
    CTX.strokeStyle = '#6b5237';
    CTX.lineWidth = 2;
    CTX.strokeRect(x + 1, y + 1, sirka - 2, vyska - 2);
    var radekY = y + 12;
    CTX.textBaseline = 'top';
    CTX.textAlign = 'left';
    radky.forEach(function (radek) {
      CTX.font = (radek.tucne ? 'bold ' : '') + radek.velikost + 'px system-ui, sans-serif';
      CTX.fillStyle = radek.barva;
      CTX.fillText(radek.text, x + 15, radekY);
      radekY += radek.velikost + 12;
    });
    CTX.textBaseline = 'alphabetic';
  }

  function souradniceKliku(udalost) {
    var obdelnik = PLATNO.getBoundingClientRect();
    var meritkoX = SIRKA / (obdelnik.width || SIRKA);
    var meritkoY = VYSKA / (obdelnik.height || VYSKA);
    return {
      x: (udalost.clientX - obdelnik.left) * meritkoX,
      y: (udalost.clientY - obdelnik.top) * meritkoY
    };
  }

  function postavaNaBode(bodX, bodY) {
    var serazene = STAV.postavy.slice().sort(function (a, b) {
      return b.pozice.y - a.pozice.y;
    });
    for (var i = 0; i < serazene.length; i += 1) {
      var postava = serazene[i];
      var sirka = postava.sirka || 60;
      var vyska = postava.vyska || 130;
      var x0 = postava.pozice.x - sirka / 2;
      var y0 = postava.pozice.y - vyska;
      if (bodX >= x0 && bodX <= x0 + sirka && bodY >= y0 && bodY <= postava.pozice.y + 20) {
        return postava;
      }
    }
    return null;
  }

  function klikNaPlatno(udalost) {
    if (!CTX) {
      return;
    }
    var bodKliku = souradniceKliku(udalost);
    var postava = postavaNaBode(bodKliku.x, bodKliku.y);
    if (postava) {
      STAV.karta = postava;
    } else {
      STAV.karta = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 12. Vykreslení jednoho snímku                                    */
  /* ---------------------------------------------------------------- */

  function vykresli() {
    if (!CTX) {
      return;
    }
    CTX.setTransform(1, 0, 0, 1, 0, 0);
    CTX.clearRect(0, 0, SIRKA, VYSKA);
    kresliPozadi();
    kresliPlameny();
    kresliObrazovky();
    kresliSchranku();
    kresliPokladnicku();
    kresliTabule();
    kresliPostavy();
    kresliMince();
    kresliTexty();
    kresliCasovouOsu();
    kresliTicker();
    kresliHlavicku();
    kresliKartu();
  }

  function snimek(cas) {
    var dt = STAV.casPoslednihoSnimku ? Math.min(120, cas - STAV.casPoslednihoSnimku) : 16;
    STAV.casPoslednihoSnimku = cas;
    STAV.snimek = cas;
    pohlidatRucniVolbu();
    if (STAV.rezim === 'zaznam') {
      aktualizujZaznam();
    }
    aktualizujCile();
    posunPostav(dt);
    aktualizujMince(dt);
    aktualizujTexty(dt);
    vykresli();
    requestAnimationFrame(snimek);
  }

  /* ---------------------------------------------------------------- */
  /* 13. Start                                                        */
  /* ---------------------------------------------------------------- */

  function start() {
    if (!CTX) {
      console.error('Chybí plátno #platno, scénu nelze kreslit.');
      return;
    }
    if (PREPINAC) {
      PREPINAC.addEventListener('click', prehodRezim);
    }
    PLATNO.addEventListener('click', klikNaPlatno);
    aktualizujPrepinac();

    nactiMista()
      .then(nactiData)
      .then(nactiAssety)
      .then(function () {
        zpracujNoveUdalosti();
        pripravZaznam(true);
        aktualizujCile();
        STAV.postavy.forEach(function (postava) {
          postava.pozice = bod(postava.cil);
        });
        aktualizujPrepinac();
        nastavListu();
        requestAnimationFrame(snimek);
      })
      .catch(function (chyba) {
        console.error('Start scény selhal:', chyba);
      });

    /* Polling: verejne.json každých 60 s. */
    setInterval(function () {
      nactiData().then(zpracujNoveUdalosti);
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
