
// ================= Safe clone (no structuredClone needed) =================
function deepClone(obj){
  return JSON.parse(JSON.stringify(obj));
}

// ================= Engine helpers =================
function uid(prefix="c"){ return prefix+"_"+Math.random().toString(16).slice(2)+"_"+Date.now().toString(16); }
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const tmp=a[i]; a[i]=a[j]; a[j]=tmp;
  }
  return a;
}
function draw(deck,n){ return { drawn: deck.slice(0,n), deck: deck.slice(n) }; }

// ----- Dobópakli -> húzópakli visszakeverés (deck refill) -----
// Egyetlen közös dobópaklit használunk (state.discard), de keveréskor csak a megfelelő típusokat tesszük vissza.
function refillDeckIfNeeded(state, deckKey, allowedKinds, neededCount){
  const s = state;
  const need = (neededCount==null) ? 1 : neededCount;
  if(!s[deckKey]) return;
  if(s[deckKey].length >= need) return;

  const pool = (s.discard||[]).filter(c => allowedKinds.includes(c.kind));
  if(pool.length===0) return;

  // vedd ki a dobóból a megfelelő lapokat
  s.discard = (s.discard||[]).filter(c => !allowedKinds.includes(c.kind));
  // keverd vissza a pakliba
  s[deckKey] = shuffle(pool.concat(s[deckKey])); // a meglévő tetejét is összekeverjük, egyszerűsítés
}

function drawFromDeck(state, deckKey, n, allowedKinds){
  refillDeckIfNeeded(state, deckKey, allowedKinds, n);
  const d = draw(state[deckKey], n);
  state[deckKey] = d.deck;
  return d.drawn;
}

function rollDiceFaces(){
  const faces=["nyomozás","nyomozás","tárgy","tárgy","képesség","képesség"];
  const out=[];
  for(let i=0;i<6;i++) out.push(faces[Math.floor(Math.random()*faces.length)]);
  return out;
}
function rollToCounts(faces){
  const c={investigate:0,item:0,skill:0};
  for(const f of faces){
    if(f==="nyomozás") c.investigate++;
    if(f==="tárgy") c.item++;
    if(f==="képesség") c.skill++;
  }
  return c;
}

const ITEM_TYPE_DEFS = [
{ name:"Kávé", rarity:"Gyakori", copies:3 },
    { name:"Zseblámpa", rarity:"Gyakori", copies:3 },
    { name:"Kesztyű", rarity:"Gyakori", copies:3 },
    { name:"Ragasztószalag", rarity:"Gyakori", copies:3 },

    { name:"Térkép", rarity:"Közepes", copies:2 },
    { name:"Nyomkövető", rarity:"Közepes", copies:2 },
    { name:"Hamiskulcs", rarity:"Közepes", copies:2 },
    { name:"Ál-szemüveg", rarity:"Közepes", copies:2 },

    { name:"Kis drón", rarity:"Ritka", copies:1 },
    { name:"Álcázó spray", rarity:"Ritka", copies:1 },

    { name:"Wildcard", rarity:"Joker", copies:2, wildcard:true, desc:"Helyettesít 1 szükséges tárgyat." }
];

function makeSampleDecks(){
  const ITEM_TYPES = ITEM_TYPE_DEFS;

  const items = ITEM_TYPES.flatMap(t =>
    Array.from({length:t.copies}, () => ({
      kind:"item",
      id: uid("i"),
      name: t.name,
      rarity: t.rarity,
      wildcard: !!t.wildcard,
      desc: t.desc || ""
    }))
  );



  const skills = [
    // GYAKORI +2 (8)
    {name:"Elemző gondolkodás", bonus:2},
    {name:"Elemző gondolkodás", bonus:2},
    {name:"Rutinszerű eljárás", bonus:2},
    {name:"Rutinszerű eljárás", bonus:2},
    {name:"Helyszíni tapasztalat", bonus:2},
    {name:"Helyszíni tapasztalat", bonus:2},
    {name:"Megérzés", bonus:2},
    {name:"Megérzés", bonus:2},

    // KÖZEPES (6)
    {name:"Fókuszált nyomozás", bonus:3},
    {name:"Fókuszált nyomozás", bonus:3},
    {name:"Kreatív megoldás", bonus:2, bonusOnSuccess:1},
    {name:"Kreatív megoldás", bonus:2, bonusOnSuccess:1},
    {name:"Kapcsolati háló", bonus:3, penaltyOnFail:1},
    {name:"Kapcsolati háló", bonus:3, penaltyOnFail:1},

    // RITKA / HERO (4)
    {name:"Áttörés", bonus:4},
    {name:"Áttörés", bonus:4},
    {name:"Utolsó esély", bonus:3, persistOnSuccess:true},
    {name:"Utolsó esély", bonus:3, persistOnSuccess:true},
  ].map(o=>({kind:"skill",id:uid("s"),...o}));


  const thieves = [
    "Pista, a Zsebes","Lola, a Képmás","Béla, a Bilincs-bűvész","Dénes, a Drónos","Nóri, a Nyom-eltüntető","Karesz, a Kávé-tolvaj",
    "Zoli, a Zár-zenész","Misi, a Maszkos","Gizi, a Gombfocis","Tomi, a Térképész","Sanyi, a Spray-es","Vera, a Ventilátor"
  ].map(thiefName=>({kind:"thief",id:uid("t"),thiefName}));

  const cases = [
    // KÖNNYŰ (6)
    { kind:"case", id:uid("u"), title:"A Láthatatlan Szendvics",
      funnyDesc:"Valaki ellopta a büféből a szendvicset, de a kamera szerint senki sem járt ott. (A kamera a fal felé nézett.)",
      thiefName: thieves[0].thiefName, requiredAgentLevel:10, requiredItems:["Kávé"], onSuccessDelta:1, onFailDelta:-1
    },
    { kind:"case", id:uid("u"), title:"A Kávé, Ami Túl Forró",
      funnyDesc:"Az ügynökségi kávé eltűnt. A nyomok… koffeinesek. (A gyanúsított: mindenki.)",
      thiefName: thieves[5].thiefName, requiredAgentLevel:10, requiredItems:["Kávé"], onSuccessDelta:1, onFailDelta:-1
    },
    { kind:"case", id:uid("u"), title:"A Zseblámpa-összeesküvés",
      funnyDesc:"Sötétben történt bűntény. Biztosan. (Mert mindenki hunyorog.)",
      thiefName: thieves[4].thiefName, requiredAgentLevel:11, requiredItems:["Zseblámpa"], onSuccessDelta:1, onFailDelta:-1
    },
    { kind:"case", id:uid("u"), title:"A Ragasztószalag Rejtélye",
      funnyDesc:"Valaki leragasztotta a bizonyítékot. És a bizonyíték a ragasztószalagot. (Ördögi kör.)",
      thiefName: thieves[1].thiefName, requiredAgentLevel:11, requiredItems:["Ragasztószalag"], onSuccessDelta:1, onFailDelta:-1
    },
    { kind:"case", id:uid("u"), title:"A Bilincs-paradoxon",
      funnyDesc:"A bilincs eltűnt… a bilincs-szobából. A kulcs ott volt. (A bilincs nem.)",
      thiefName: thieves[2].thiefName, requiredAgentLevel:12, requiredItems:["Kesztyű"], onSuccessDelta:2, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"A Nyom, Ami Nem Nyom",
      funnyDesc:"Nyomok vannak. Csak épp mind ugyanoda vezetnek: a büfébe. (Megint.)",
      thiefName: thieves[3].thiefName, requiredAgentLevel:12, requiredItems:["Térkép"], onSuccessDelta:2, onFailDelta:-2
    },

    // KÖZEPES (8)
    { kind:"case", id:uid("u"), title:"A Maszk, Ami Túl Sok",
      funnyDesc:"A tolvaj álcázta magát… egy másik álcázással. Kettős álca, kettős gond.",
      thiefName: thieves[7].thiefName, requiredAgentLevel:12, requiredItems:["Ál-szemüveg","Kesztyű"], onSuccessDelta:2, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"A Zár-zenész Ügye",
      funnyDesc:"A zár kinyílt. A zár tagad. (A zár hangszeren játszik.)",
      thiefName: thieves[6].thiefName, requiredAgentLevel:13, requiredItems:["Hamiskulcs"], onSuccessDelta:2, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"A Nyomkövető Nyomoz",
      funnyDesc:"A nyomkövető eltűnt. Most… ki követ kit? (A nyomkövető szerint: te.)",
      thiefName: thieves[8].thiefName, requiredAgentLevel:13, requiredItems:["Nyomkövető"], onSuccessDelta:2, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"A Térkép, Ami Hazudik",
      funnyDesc:"A térkép szerint a város a tenger alatt van. (Lehet, hogy a térkép ivott.)",
      thiefName: thieves[9].thiefName, requiredAgentLevel:13, requiredItems:["Térkép","Kávé"], onSuccessDelta:2, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"A Drónos Szomszéd",
      funnyDesc:"Eltűnt a postás sapkája, de a tetőn drón-nyomokat találtunk. A drón tagad. (Kis drón nagy arc.)",
      thiefName: thieves[3].thiefName, requiredAgentLevel:14, requiredItems:["Kis drón"], onSuccessDelta:3, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"Álcázó Spray a Levegőben",
      funnyDesc:"Valaki lefújta a kamerát… álcázó spray-vel. Most a kamera „művészi”.",
      thiefName: thieves[10].thiefName, requiredAgentLevel:14, requiredItems:["Álcázó spray"], onSuccessDelta:3, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"A Kesztyű Nyoma",
      funnyDesc:"Kesztyűs kéz nyoma maradt. Igen, így. (Az ügynökség sírva tanul.)",
      thiefName: thieves[11].thiefName, requiredAgentLevel:14, requiredItems:["Kesztyű","Ragasztószalag"], onSuccessDelta:3, onFailDelta:-2
    },
    { kind:"case", id:uid("u"), title:"Wildcard-helyzet",
      funnyDesc:"Semmi sem stimmel, ezért most bármi stimmelhet. (Ez nem nyomozás, ez életérzés.)",
      thiefName: thieves[1].thiefName, requiredAgentLevel:14, requiredItems:["Wildcard"], onSuccessDelta:3, onFailDelta:-2
    },

    // NEHÉZ (4)
    { kind:"case", id:uid("u"), title:"A Kettős Zár, Kettős Csapda",
      funnyDesc:"Két zár. Két ajtó. Egy idegösszeomlás. (Az ajtó mosolyog.)",
      thiefName: thieves[6].thiefName, requiredAgentLevel:15, requiredItems:["Hamiskulcs","Nyomkövető"], onSuccessDelta:4, onFailDelta:-3
    },
    { kind:"case", id:uid("u"), title:"A Tökéletes Álca",
      funnyDesc:"A gyanúsított annyira átlagos, hogy gyanús. (Ezt is fel kell dolgozni.)",
      thiefName: thieves[7].thiefName, requiredAgentLevel:15, requiredItems:["Ál-szemüveg","Álcázó spray"], onSuccessDelta:4, onFailDelta:-3
    },
    { kind:"case", id:uid("u"), title:"A Drónos Menekülés",
      funnyDesc:"A tolvaj drónnal menekült. Te meg… gyalog. (Két világ találkozása.)",
      thiefName: thieves[3].thiefName, requiredAgentLevel:16, requiredItems:["Kis drón","Térkép"], onSuccessDelta:4, onFailDelta:-3
    },
    { kind:"case", id:uid("u"), title:"Az Ügynökség Nagytakarítása",
      funnyDesc:"Kiderült, hogy a bűnözés a szekrényben volt. (És te nyitottad ki.)",
      thiefName: thieves[0].thiefName, requiredAgentLevel:16, requiredItems:["Nyomkövető","Zseblámpa","Ál-szemüveg"], onSuccessDelta:4, onFailDelta:-3
    },
  ];


  const mixed = cases.concat(thieves).concat(skills);
  return { itemDeck: shuffle(items), skillDeck: [], mixedDeck: shuffle(mixed) };
}

function createGame(playerConfigs){
  const decks = makeSampleDecks();

  let itemDeck = decks.itemDeck, skillDeck = decks.skillDeck, mixedDeck = decks.mixedDeck;
  const discard = [];

  const players = playerConfigs.map((cfg,i)=>({
    id:"p"+(i+1),
    name: (cfg && cfg.name) ? cfg.name : ("Ügynök "+(i+1)),
    characterKey: (cfg && cfg.characterKey) ? cfg.characterKey : CHARACTER_DEFS.VETERAN.key,
    characterName: (CHARACTER_DEFS[(cfg && cfg.characterKey) ? cfg.characterKey : CHARACTER_DEFS.VETERAN.key] || {}).name || "",
    color: (cfg && cfg.color) ? cfg.color : null,
    agentLevel: (CHARACTER_DEFS[(cfg && cfg.characterKey) ? cfg.characterKey : CHARACTER_DEFS.VETERAN.key] || {startLevel:10}).startLevel,
    handLimit: (CHARACTER_DEFS[(cfg && cfg.characterKey) ? cfg.characterKey : CHARACTER_DEFS.VETERAN.key] || {handLimit:5}).handLimit,
        advantage:(CHARACTER_DEFS[(cfg && cfg.characterKey) ? cfg.characterKey : CHARACTER_DEFS.VETERAN.key]||{}).advantage||"",
    disadvantage:(CHARACTER_DEFS[(cfg && cfg.characterKey) ? cfg.characterKey : CHARACTER_DEFS.VETERAN.key]||{}).disadvantage||"",
eliminated:false,
    tableCards:[],
    fixedItems:[],
    partnerCallUsed:false,
    solvedCases:[],
    capturedThieves:[],
    flags:{ veteranBonusUsed:false, daredevilFreeFailUsed:false, profilerPeekUsed:false },
    nemesisThiefName:null
  }));

  // Nemezis kiosztása (ha van ilyen karakter)
  const allThiefNames = mixedDeck.filter(c=>c.kind==="thief").map(t=>t.thiefName);
  for(const p of players){
    if(p.characterKey===CHARACTER_DEFS.NEMESIS.key){
      p.nemesisThiefName = allThiefNames[Math.floor(Math.random()*allThiefNames.length)] || null;
    }
  }

  function takeItemByName(deck, name){
    const idx = deck.findIndex(c=>c.kind==="item" && c.name===name);
    if(idx>=0){
      const card = deck[idx];
      const newDeck = deck.slice(0,idx).concat(deck.slice(idx+1));
      return {deck:newDeck, card};
    }
    const d = draw(deck,1);
    return {deck:d.deck, card:d.drawn[0] || null};
  }

  // Fix induló tárgyak kiosztása karakter alapján
  // A fix tárgyak NEM a tárgy pakliból jönnek (nem fogyasztják a paklit),
  // hanem a tárgytípusok közül sorsoljuk őket. Ezeket nem lehet eldobni
  // kézlimitnél és nem "fogynak el" ügy megoldásánál sem (p.fixedItems-ben maradnak).
  function makeFixedItemFromType(t){
    return {
      kind:"item",
      id: uid("fi"),
      name: t.name,
      rarity: t.rarity,
      wildcard: !!t.wildcard,
      desc: t.desc || "",
      fixed: true,
      permanent: true
    };
  }
  function randomItemType(rarity){
    const pool = rarity ? ITEM_TYPE_DEFS.filter(t=>t.rarity===rarity) : ITEM_TYPE_DEFS;
    if(!pool.length) return null;
    return pool[Math.floor(Math.random()*pool.length)];
  }
  function giveFixedRandomItems(p, count, uniqueByName=false, rarity=null){
    const have = new Set((p.fixedItems||[]).map(x=>x && x.name).filter(Boolean));
    let safety = 100;
    while(count>0 && safety-->0){
      const t = randomItemType(rarity);
      if(!t) continue;
      if(uniqueByName && have.has(t.name)) continue;
      p.fixedItems.push(makeFixedItemFromType(t));
      have.add(t.name);
      count--;
    }
  }

  for(const p of players){
    if(p.characterKey===CHARACTER_DEFS.LOGISTIC.key){
      // Logisztikus: 1 fix random Közepes tárgy
      giveFixedRandomItems(p, 1, false, "Közepes");
    }
    if(p.characterKey===CHARACTER_DEFS.STRATEGIST.key){
      // Stratéga: 2 fix random Gyakori tárgy (névben nem egyezhet)
      giveFixedRandomItems(p, 2, true, "Gyakori");
    }
  }

// Kezdő osztás (új élmény): 3 vegyes lap (Ügy/Tolvaj/Képesség)
  for(const p of players){
    const d2 = draw(mixedDeck,3); mixedDeck=d2.deck;
    p.tableCards = p.tableCards.concat(d2.drawn);
  }

  // Nemezis tolvaj automatikus eldobása, ha valahogy kézbe kerülne
  for(const p of players){
    if(p.characterKey===CHARACTER_DEFS.NEMESIS.key && p.nemesisThiefName){
      const bad = p.tableCards.filter(c=>c.kind==="thief" && c.thiefName===p.nemesisThiefName);
      if(bad.length){
        p.tableCards = p.tableCards.filter(c=>!(c.kind==="thief" && c.thiefName===p.nemesisThiefName));
        discard.push(...bad);
      }
    }
  }

  return {
    players,
    currentPlayerIndex:0,
    itemDeck,
    skillDeck,
    mixedDeck,
    discard,
    turn:{
      phase:"AWAIT_DRAW",
      diceFaces:[],
      investigationsLeft:0,
      skillPlaysLeft:0,
      solvedCaseThisTurn:false,
      profilerPeekUsedThisTurn:false,
      daredevilFreeFailUsedThisTurn:false,
      daredevilLimitNextTurn:false
    }
  };
}


function discardNemesisThiefIfNeeded(s, p){
  if(!p || !s) return 0;
  if(p.characterKey!==CHARACTER_DEFS.NEMESIS.key) return 0;
  if(!p.nemesisThiefName) return 0;
  const bad = p.tableCards.filter(c=>c.kind==="thief" && c.thiefName===p.nemesisThiefName);
  if(!bad.length) return 0;
  p.tableCards = p.tableCards.filter(c=>!(c.kind==="thief" && c.thiefName===p.nemesisThiefName));
  s.discard.push(...bad);
  return bad.length;
}

function captureIfPossible(state){
  // Captures any thief card currently on the active player's table that matches a solved case thief.
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p) return s;

  const solved = {};
  for(const c of (p.solvedCases||[])){
    if(c && c.thiefName) solved[c.thiefName] = true;
  }

  const thieves = (p.tableCards||[]).filter(c=>c && c.kind==="thief" && c.thiefName);
  if(!p.capturedThieves) p.capturedThieves = [];

  for(const t of thieves){
    if(solved[t.thiefName]){
      p.tableCards = p.tableCards.filter(c=>c.id!==t.id);
      p.capturedThieves.push(t);
    }
  }

  const w = checkWinner(s);
  if(w){
    s.turn.phase = 'GAME_OVER';
    s.winner = { id:w.id, name:(w.name||w.id), color:(w.color||null) };
  }
  return s;
}


function checkWinner(state){
  for(const p of state.players){
    const solvedCount = (p.solvedCases||[]).length;
    const capCount = (p.capturedThieves||[]).length;
    if(solvedCount>=3 && capCount>=3) return p;
  }
  return null;
}


function doPreDraw(state){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p || p.eliminated) return {next:s, log:"Ez a játékos már kiesett."};
  if(s.turn.phase!=="AWAIT_DRAW") return {next:s, log:"Most nem húzhatsz (már húztál vagy nem a kör eleje van)."};
  const drawnMixed = drawFromDeck(s,'mixedDeck',3,['case','thief','skill']);
  p.tableCards = p.tableCards.concat(drawnMixed);
  // Profilozó: ha tolvajt húzott, belenézhet a vegyes pakli tetejébe (2 lap)
  if(p.characterKey===CHARACTER_DEFS.PROFILER.key && drawnMixed.some(c=>c && c.kind==="thief") && !(p.flags && p.flags.profilerPeekUsed)){
    if(!p.flags) p.flags = {};
    if(s.mixedDeck && s.mixedDeck.length>=2){
      // UI fogja elegánsan felkínálni a választást (gomb + modal), a logika ugyanaz marad.
      p.flags.profilerPeekAvailable = true;
    }
  }
  // Nemezis tolvaj automatikus eldobása, ha kijött
  discardNemesisThiefIfNeeded(s,p);
  // ha kijött olyan tolvaj ami megoldott ügyhöz kell
  captureIfPossible(s);

  s.turn.phase = "AWAIT_ROLL";
  return {next:s, log:"Húzás: +3 vegyes lap. Most dobhatsz."};
}

function doRollAndDraw(state){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p || p.eliminated) return {next:s, log:"Ez a játékos már kiesett."};
  if(s.turn.phase!=="AWAIT_ROLL") return {next:s, log:"Előbb húzz 3 lapot, utána dobhatsz (vagy már dobtál ebben a körben)."};

  // A kör eleji flagek resetje a startTurn() feladata.
  // Vegyes lap húzás nem a dobáshoz kötött (kör elején automatikus)

  const faces = rollDiceFaces();
  const counts = rollToCounts(faces);

  if(counts.item>0){
    const drawnItems = drawFromDeck(s,'itemDeck',counts.item,['item']);
    p.tableCards = p.tableCards.concat(drawnItems);
  }
  // Képesség kocka: csak azt határozza meg, hány skill lapot játszhatsz ki (nem húzol automatikusan)

  // Nemezis tolvaj automatikus eldobása
  discardNemesisThiefIfNeeded(s,p);

  captureIfPossible(s);

  s.turn.phase="AFTER_ROLL";
  s.turn.diceFaces=faces;
  s.turn.investigationsLeft=counts.investigate;
  // Veterán: maximum 1 nyomozás minden körben (kockadobástól függetlenül)
  if(p.characterKey===CHARACTER_DEFS.VETERAN.key){
    s.turn.investigationsLeft = Math.min(1, s.turn.investigationsLeft);
  }

  s.turn.skillPlaysLeft=counts.skill;
  s.turn.solvedCaseThisTurn=false;

  return {next:s, log:`🎲 Dobás kész: Nyomozás ${counts.investigate} • Tárgy ${counts.item} • Képesség ${counts.skill}.
Most választhatsz: „Megpróbálok ügyet megoldani” vagy „Passz (kör vége)”.`};
}

function profilerPeek(state, payload){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p || p.eliminated) return {next:s, log:"Nincs aktív játékos."};
  if(p.characterKey!==CHARACTER_DEFS.PROFILER.key) return {next:s, log:"Ez a képesség csak a Profilozónak elérhető."};
  if(!(p.flags && p.flags.profilerPeekAvailable)) return {next:s, log:"Most nem használható (csak akkor, ha ebben a körben tolvajt húztál a vegyes pakliból)."};
  if(p.flags && p.flags.profilerPeekUsed) return {next:s, log:"Ezt már használtad ebben a körben."};
  if(!(s.turn.phase==="AWAIT_ROLL" || s.turn.phase==="AFTER_ROLL")) return {next:s, log:"Most nem használhatod."};
  if(s.mixedDeck.length<2) return {next:s, log:"Nincs elég lap a vegyes pakliban."};

  const keep = payload && payload.keep!=null ? String(payload.keep) : null;
  if(keep!=='1' && keep!=='2'){
    return {next:s, log:"Profilozó: válassz, melyik maradjon felül (1 vagy 2)."};
  }

  const a = s.mixedDeck[0], b = s.mixedDeck[1];
  if(keep==='2'){
    // 2 marad felül -> csere
    s.mixedDeck[0]=b; s.mixedDeck[1]=a;
  }
  p.flags.profilerPeekUsed = true;
  p.flags.profilerPeekAvailable = false;
  return {next:s, log: keep==='2'
    ? "🧠 Profilozó: átrendezted a vegyes pakli tetejét (2 került felülre)."
    : "🧠 Profilozó: megnézted a tetejét (1 maradt felül)."};
}


function attemptCase(state, payload){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p || p.eliminated) return {next:s, log:"Kiesett játékos."};
  if(s.turn.phase!=="AFTER_ROLL") return {next:s, log:"Most nem próbálhatsz ügyet (előbb dobj)."};
  if(s.turn.investigationsLeft<=0) return {next:s, log:"Nincs több nyomozás dobásod ebben a körben."};

  const caseId = payload.caseId;
  const usedItemIds = payload.usedItemIds || [];
  const usedSkillIds = payload.usedSkillIds || [];

  const partnerId = (payload && payload.partnerId!=null) ? String(payload.partnerId) : null;

  const c = p.tableCards.find(x=>x.kind==="case" && x.id===caseId);
  if(!c) return {next:s, log:"Az ügy nem található a kártyáid között."};
  if(usedSkillIds.length > s.turn.skillPlaysLeft) return {next:s, log:`Túl sok képességet jelöltél ki (limit: ${s.turn.skillPlaysLeft}).`};

  const usedSkills = usedSkillIds.map(id=>p.tableCards.find(x=>x.kind==="skill" && x.id===id)).filter(Boolean);
  const usedItems  = usedItemIds.map(id=>p.tableCards.find(x=>x.kind==="item" && x.id===id)).filter(Boolean);

  let bonus=0;
for(const sc of usedSkills) bonus += (sc.bonus||0);

// Partner (TÁRS) – automata segítség
let partner = null;
let partnerUsedItems = [];
let partnerUsedSkills = [];
if(partnerId){
  if(p.partnerCallUsed){
    return {next:s, log:"A TÁRS hívást már felhasználtad ebben a játékban."};
  }
  partner = s.players.find(x=>x && x.id===partnerId) || null;
  if(!partner) return {next:s, log:"A kiválasztott társ nem található."};
  if(partner.id===p.id) return {next:s, log:"Nem választhatod saját magad társnak."};
  if(partner.eliminated) return {next:s, log:"A kiválasztott társ kiesett."};
}

const itemsByName = {};
for(const it of usedItems) itemsByName[it.name]=true;
for(const fit of (p.fixedItems||[])) itemsByName[fit.name]=true;

const req = c.requiredItems || [];

// helper: wildcard?
const isWildcard = (it)=>!!(it && (it.wildcard || it.rarity==="Joker" || it.name==="Wildcard"));

// count wildcards from requester fixed/used
const requesterWildcardCount =
  usedItems.filter(isWildcard).length +
  (p.fixedItems||[]).filter(isWildcard).length;

// Partner fixed items always count (no cost)
let partnerFixedNames = {};
let partnerFixedWildcardCount = 0;
if(partner){
  for(const fit of (partner.fixedItems||[])){
    if(fit && fit.name) partnerFixedNames[fit.name]=true;
  }
  partnerFixedWildcardCount = (partner.fixedItems||[]).filter(isWildcard).length;
  for(const n in partnerFixedNames) itemsByName[n]=true;
}

// Items check with requester + partner FIXED items
let missing = req.filter(r=>!itemsByName[r]);
let wildcardCount = requesterWildcardCount + partnerFixedWildcardCount;
let itemsOk = (missing.length <= wildcardCount);

// Nemesis bonus only for requester
const nemesisBonus = (p.characterKey===CHARACTER_DEFS.NEMESIS.key && p.nemesisThiefName && c.thiefName===p.nemesisThiefName) ? 1 : 0;

// Level check (requester only so far)
let levelOk = (p.agentLevel + bonus + nemesisBonus) >= c.requiredAgentLevel;

// If partner selected, try to auto-use partner cards ONLY if they can make the attempt succeed.
if(partner){
  // --------- Partner ITEMS ----------
  if(!itemsOk){
    const partnerItems = (partner.tableCards||[]).filter(x=>x && x.kind==="item");
    const partnerWild = partnerItems.filter(isWildcard);
    const partnerExactPool = partnerItems.filter(it=>!isWildcard(it));
    const chosen = [];
    const usedIds = new Set();

    // choose exact required items first
    for(const name of missing){
      const idx = partnerExactPool.findIndex(it=>it && it.name===name && !usedIds.has(it.id));
      if(idx>=0){
        const it = partnerExactPool[idx];
        chosen.push(it);
        usedIds.add(it.id);
      }
    }
    // recompute missing after adding chosen names
    const tempNames = {...itemsByName};
    for(const it of chosen){ if(it && it.name) tempNames[it.name]=true; }
    let missing2 = req.filter(r=>!tempNames[r]);

    // compute wildcards if we add chosen + optional partner wildcards
    let wildNow = wildcardCount + chosen.filter(isWildcard).length;
    const needExtraWild = Math.max(0, missing2.length - wildNow);

    if(missing2.length <= wildNow){
      // success via exact matches only
      partnerUsedItems = chosen;
      for(const it of partnerUsedItems){ itemsByName[it.name]=true; }
      // itemsOk remains false? recompute:
      missing = req.filter(r=>!itemsByName[r]);
      itemsOk = (missing.length <= wildcardCount); // wildcardCount unchanged; exact matches reduce missing
    } else if(needExtraWild <= partnerWild.length){
      // we can cover remaining missing with wildcards
      const wildChosen = partnerWild.slice(0, needExtraWild);
      partnerUsedItems = chosen.concat(wildChosen);
      // apply
      for(const it of partnerUsedItems){ if(it && it.name) itemsByName[it.name]=true; }
      wildcardCount = wildcardCount + wildChosen.length; // add partner wildcards used (fixed already counted)
      missing = req.filter(r=>!itemsByName[r]);
      itemsOk = (missing.length <= wildcardCount);
    } else {
      // cannot make item requirements pass -> do not burn partner items
      partnerUsedItems = [];
    }
  }

  // --------- Partner SKILLS ----------
  if(!levelOk){
    const deficit = c.requiredAgentLevel - (p.agentLevel + bonus + nemesisBonus);
    const partnerSkills = (partner.tableCards||[]).filter(x=>x && x.kind==="skill").slice()
      .sort((a,b)=>(b.bonus||0)-(a.bonus||0));
    const totalAvail = partnerSkills.reduce((acc,x)=>acc+(x.bonus||0),0);
    if(deficit>0 && totalAvail >= deficit){
      let sum=0;
      for(const sk of partnerSkills){
        if(sum>=deficit) break;
        partnerUsedSkills.push(sk);
        sum += (sk.bonus||0);
      }
      bonus += partnerUsedSkills.reduce((acc,x)=>acc+(x.bonus||0),0);
      levelOk = (p.agentLevel + bonus + nemesisBonus) >= c.requiredAgentLevel;
    } else {
      partnerUsedSkills = [];
    }
  }
}

const success = itemsOk && levelOk;
  // discard used
  for(const sc of usedSkills){
    p.tableCards = p.tableCards.filter(x=>x.id!==sc.id);
    s.discard.push(sc);
  }
  for(const it of usedItems){
    p.tableCards = p.tableCards.filter(x=>x.id!==it.id);
    s.discard.push(it);
  }

if(partner){
  for(const sc of partnerUsedSkills){
    partner.tableCards = partner.tableCards.filter(x=>x.id!==sc.id);
    s.discard.push(sc);
  }
  for(const it of partnerUsedItems){
    // partnerUsedItems are normal (non-fixed) items from tableCards
    partner.tableCards = partner.tableCards.filter(x=>x.id!==it.id);
    s.discard.push(it);
  }
}

  // remove case card
  p.tableCards = p.tableCards.filter(x=>x.id!==c.id);

  s.turn.investigationsLeft -= 1;
  s.turn.skillPlaysLeft -= usedSkills.length;

  if(success){
    p.agentLevel += c.onSuccessDelta;
    if(partner){ partner.agentLevel += c.onSuccessDelta; }
    // Veterán: az első sikeres ügy extra +1 szint
    if(p.characterKey===CHARACTER_DEFS.VETERAN.key && p.flags && !p.flags.veteranBonusUsed){
      p.agentLevel += 1;
      p.flags.veteranBonusUsed = true;
      s._veteranExtra = true;
    }
    p.solvedCases.push(c);
    s.turn.solvedCaseThisTurn = true;
    discardNemesisThiefIfNeeded(s,p);
    captureIfPossible(s);
  } else {
    // Vakmerő: az első bukás körönként nem csökkenti a szintet
    if(p.characterKey===CHARACTER_DEFS.DAREDEVIL.key && p.flags && !p.flags.daredevilFreeFailUsed){
      p.flags.daredevilFreeFailUsed = true;
      s._daredevilNoLoss = true;
    } else {
      p.agentLevel += c.onFailDelta;
    }
    if(partner){ partner.agentLevel += c.onFailDelta; }
    s.discard.push(c);
  }

  if(partner){ p.partnerCallUsed = true; }

  if(p.agentLevel <= 0) eliminatePlayer(s, s.currentPlayerIndex);
  if(partner){
    const pidx = s.players.findIndex(x=>x && x.id===partner.id);
    if(pidx>=0 && s.players[pidx].agentLevel <= 0) eliminatePlayer(s, pidx);
  }

  const reqItemsTxt = req.length ? `Tárgy: ${req.join(", ")}` : "Tárgy: —";
  const reqLevelTxt = `Szint: ${c.requiredAgentLevel}`;
  const log = success
    ? `✅ Siker! „${c.title}” megoldva. (+${c.onSuccessDelta}${s._veteranExtra ? " +1 (Veterán)" : ""} szint) • ${reqLevelTxt} • ${reqItemsTxt}`
    : `❌ Bukás! „${c.title}” nem sikerült. (${s._daredevilNoLoss ? "0 (Vakmerő)" : c.onFailDelta} szint) • ${reqLevelTxt} • ${reqItemsTxt}`;

  const winner = checkWinner(s);
  if(winner){
    s.turn.phase="GAME_OVER";
    return {next:s, log: log + `\n🏆 Játék vége! Nyertes: ${winner.name}`};
  }
  return {next:s, log};
}


function applyPassPenaltyIfNeeded(s){
  const p = s.players[s.currentPlayerIndex];
  if(!p || p.eliminated) return "";
  if(s.turn.solvedCaseThisTurn) return "";

  // Vakmerő: passz esetén minden NEM ügy kártyát eldob (ügyek maradnak), nincs szintvesztés
  if(p.characterKey===CHARACTER_DEFS.DAREDEVIL.key){
    const keepCases = p.tableCards.filter(c=>c.kind==="case");
    const discardRest = p.tableCards.filter(c=>c.kind!=="case");
    if(discardRest.length) s.discard.push(...discardRest);
    p.tableCards = keepCases;
    return "\n⚠️ Vakmerő passz: minden nem-ügy lapodat eldobtad, az ügyeid megmaradtak.";
  }

  // Alap passz büntetés: -1 (Stratég: -2)
  const delta = (p.characterKey===CHARACTER_DEFS.STRATEGIST.key) ? 2 : 1;
  p.agentLevel -= delta;
  if(p.agentLevel <= 0) eliminatePlayer(s, s.currentPlayerIndex);
  return `
⚠️ Passzoltál megoldott ügy nélkül: -${delta} ügynökszint.`;
}




function eliminatePlayer(state, playerIndex){
  // mark for UI
  state._lastEliminated = { id: state.players[playerIndex].id, name: state.players[playerIndex].name, color: state.players[playerIndex].color||null };

  // Pause progression until the eliminated player acknowledges.
  // The UI will show a blocking modal, then call ackElimination() to continue.
  state.turn = state.turn || {};
  state.turn.phase = "ELIMINATION_PAUSE";

  const s = state;
  const p = s.players[playerIndex];
  if(!p || p.eliminated) return;
  // minden kártya vissza a dobóba (vegyes + tárgy), hogy mások átvehessék az ügyeket
  const toDiscard = []
    .concat(p.tableCards||[])
    .concat(p.solvedCases||[])
    .concat(p.capturedThieves||[])
    .concat(p.fixedItems||[]);
  s.discard = (s.discard||[]).concat(toDiscard);

  // ürítsük ki a játékos készleteit
  p.tableCards = [];
  p.solvedCases = [];
  p.capturedThieves = [];
  p.fixedItems = [];

  p.eliminated = true;
}

function _activePlayers(state){
  return (state.players||[]).filter(p=>p && !p.eliminated);
}

function _nextActiveIndex(state, fromIndex){
  const n = (state.players||[]).length;
  if(!n) return 0;
  let idx = (typeof fromIndex==="number") ? fromIndex : (state.currentPlayerIndex||0);
  for(let i=0;i<n;i++){
    idx = (idx + 1) % n;
    const p = state.players[idx];
    if(p && !p.eliminated) return idx;
  }
  return state.currentPlayerIndex||0;
}

function ackElimination(state){
  const s = deepClone(state);
  // If already game over, no-op
  if(s.turn && s.turn.phase==="GAME_OVER"){
    s._lastEliminated = null;
    return {next:s, log:""};
  }

  // If only one player remains, they win.
  const actives = _activePlayers(s);
  if(actives.length<=1){
    const winner = actives[0] || null;
    if(winner){
      s.turn = s.turn || {};
      s.turn.phase = "GAME_OVER";
      s.winner = { id:winner.id, name:(winner.name||""), color:(winner.color||null) };
      s._lastEliminated = null;
      return {next:s, log:`🏆 Játék vége! Nyertes: ${winner.name||winner.id}`};
    }
  }

  // Clear the last eliminated marker and advance to the next active player.
  s._lastEliminated = null;
  s.currentPlayerIndex = _nextActiveIndex(s, s.currentPlayerIndex);
  const started = startTurn(s);
  return {next: started.next || s, log: started.log || ""};
}
function beginPassToEndTurn(state){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p) return {next:s, log:"Nincs aktív játékos."};
  if(s.turn.phase==="DISCARDING") return {next:s, log:"Már PASSZ-oltál: jelöld ki az eldobandó lapokat, majd ELDOBÁS."};
  if(s.turn.phase!=="AFTER_ROLL") return {next:s, log:"Most nem tudsz passzolni (előbb dobj)."};
  const note = applyPassPenaltyIfNeeded(s);

  if(s.turn && s.turn.phase==="ELIMINATION_PAUSE"){
    const who = (s._lastEliminated && s._lastEliminated.name) ? s._lastEliminated.name : "";
    return {next:s, log: who ? `💥 Kiesett: ${who}${note}` : `💥 Kiesettél!${note}`};
  }

  const need = Math.max(0, p.tableCards.length - (p.handLimit||5));
  if(need>0){
    s.turn.phase="DISCARDING";
    return {next:s, log:`Kör vége: dobj el ${need} lapot (${p.handLimit||5} lap limit).${note}`};
  }
  const res = endTurn(s, []);
  return {next:res.next, log:res.log + note};
}

function endTurn(state, discardingIds){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p) return {next:s, log:"Nincs aktív játékos."};

  const need = Math.max(0, p.tableCards.length - (p.handLimit||5));
  if(need>0){
    if(!discardingIds || discardingIds.length !== need){
      return {next:s, log:`Pontosan ${need} lapot kell eldobni. (Most: ${(discardingIds||[]).length})`};
    }
    for(const id of discardingIds){
      const card = p.tableCards.find(c=>c.id===id);
      if(!card) continue;
      p.tableCards = p.tableCards.filter(c=>c.id!==id);
      s.discard.push(card);
    }
  }

  // If someone got eliminated during this turn, pause here and wait for acknowledgement.
  if(s.turn && s.turn.phase==="ELIMINATION_PAUSE"){
    const who = (s._lastEliminated && s._lastEliminated.name) ? s._lastEliminated.name : "";
    return {next:s, log: who ? `💥 Kiesett: ${who}` : `💥 Kiesettél!`};
  }

  const winner = checkWinner(s);
  if(winner){
    s.turn.phase="GAME_OVER";
    return {next:s, log:`🏆 Játék vége! Nyertes: ${winner.name}`};
  }

  s.currentPlayerIndex = (s.currentPlayerIndex + 1) % s.players.length;

  // Következő játékos körének indítása: automatikus 3 vegyes húzás
  const started = startTurn(s);
  return {next: started.next, log: "Kör vége. " + started.log};
}


function startTurn(state){
  const s = deepClone(state);
  const p = s.players[s.currentPlayerIndex];
  if(!p || p.eliminated) return {next:s, log:"Nincs aktív játékos."};

  // kör alapértékek
  s.turn.phase = "AWAIT_DRAW";
  s.turn.diceFaces = [];
  s.turn.investigationsLeft = 0;
  s.turn.skillPlaysLeft = 0;
  s.turn.solvedCaseThisTurn = false;

  // kör eleji flag reset
  p.flags = p.flags || {};
  p.flags.daredevilFreeFailUsed = false;
  p.flags.profilerPeekUsed = false;
  p.flags.profilerPeekAvailable = false;

  // Kör eleji húzás: a játékos indítja a "Húzás (3 lap)" gombbal

  // Nemezis tolvaj automatikus eldobása, ha kijött
  discardNemesisThiefIfNeeded(s,p);

  // Ha már van megoldott ügyhöz tolvaj, azonnal számoljuk
  captureIfPossible(s);

  return {next:s, log:"Kör eleje: nyomd meg a „Húzás (3 lap)” gombot, majd dobhatsz."};
}

// ================= DOM helper =================


const CHARACTER_DEFS = {
  VETERAN: { key:"VETERAN", name:"Veterán", startLevel:12, handLimit:5,
    advantage:"Az első megoldott ügyénél +1 extra ügynökszintet kap",
    disadvantage:"Maximum 1 nyomozás minden körben (kockadobástól függetlenül)"
  },
  LOGISTIC: { key:"LOGISTIC", name:"Logisztikus", startLevel:10, handLimit:4,
    advantage:"1 fix induló közepes tárgy",
    disadvantage:"Kézlimit: 4 (nem 5)"
  },
  STRATEGIST: { key:"STRATEGIST", name:"Stratéga", startLevel:13, handLimit:5,
    advantage:"2 fix induló gyakori tárgy",
    disadvantage:"Passz = -2 ügynökszint"
  },
  PROFILER: { key:"PROFILER", name:"Profilozó", startLevel:9, handLimit:5,
    advantage:"Tolvaj húzásakor belenézhet a vegyes pakli felső 2 lapjába: egyet felül hagy, egyet alulra tesz",
    disadvantage:"—"
  },
  NEMESIS: { key:"NEMESIS", name:"Nemezis Vadász", startLevel:10, handLimit:5,
    advantage:"Kap 1 titkos Nemezis Tolvajt; a hozzá tartozó ügy megoldásánál +1 bónuszt kap",
    disadvantage:"A nemezis tolvajt nem tudja elfogni (ha kihúzza: dobópakliba kerül, nem trófea)"
  },
  DAREDEVIL: { key:"DAREDEVIL", name:"Vakmerő", startLevel:11, handLimit:5,
    advantage:"Az első bukott ügy körönként nem csökkenti az ügynökszintjét",
    disadvantage:"Passz esetén eldobja az összes lapját, kivéve az ügy kártyákat"
  }
};

// ===== Export engine API for MVP_19 GUI =====
window.Engine = {
  eliminatePlayer,
  ackElimination,
createGame,
  doPreDraw,
  startTurn,
  drawFromDeck,
  doRollAndDraw,
  profilerPeek,
  attemptCase,
  beginPassToEndTurn,
  endTurn,
  makeSampleDecks,
  ITEM_TYPES: (typeof ITEM_TYPES !== "undefined" ? ITEM_TYPES : null),
  CHARACTER_DEFS: (typeof CHARACTER_DEFS !== "undefined" ? CHARACTER_DEFS : null),
  captureIfPossible,
};