// Import d'un relevé bancaire CSV vers des dépenses Ardoise.
//
// Pensé pour le format Crédit Mutuel mais tolérant :
//  - séparateur ; ou , (auto-détecté par PapaParse)
//  - décimale française (virgule) ou point
//  - date JJ/MM/AAAA (ou AAAA-MM-JJ)
//  - soit une colonne "Montant" signée (débits négatifs),
//    soit deux colonnes "Débit" / "Crédit"
//  - avec ou sans ligne d'en-tête
//
// Ne garde que les DÉBITS (dépenses). Les crédits (salaire, virements
// entrants) sont ignorés. Renvoie une Promise<Array<{amount,label,categoryId,date}>>.

import Papa from "papaparse";

/* ------------------------------------------------ auto-catégorisation */

const RULES = [
  [/carrefour|leclerc|auchan|lidl|intermarch|monoprix|franprix|super\s?u|casino|biocoop|grand frais|aldi|netto/i, "alimentation"],
  [/loyer|edf|engie|gaz|eau|veolia|suez|syndic|assurance hab|foncia/i, "logement"],
  [/sncf|ratp|uber(?!\s?eats)|\bbus\b|metro|essence|total|esso|\bbp\b|station|peage|autoroute|navigo|blablacar|velib|tan\b/i, "transport"],
  [/restaurant|mcdo|mc do|burger|kfc|pizza|deliveroo|just eat|uber\s?eats|boulangerie|brasserie|\bbar\b|sushi|tacos/i, "restaurants"],
  [/pharmacie|docteur|medecin|mutuelle|dentiste|optic|hopital|laboratoire|\bkine\b/i, "sante"],
  [/fnac|amazon|darty|zalando|decathlon|leroy merlin|ikea|action|gifi|cdiscount|zara|h&m/i, "shopping"],
  [/cinema|theatre|concert|steam|playstation|nintendo|spotify|deezer|netflix|disney|canal|twitch/i, "loisirs"],
  [/free\b|orange|sfr|bouygues|sosh|abonnement|prime|icloud|google one|github|adobe|openai|anthropic/i, "abonnements"],
];

export function guessCat(label) {
  const l = (label || "").toLowerCase();
  for (const [re, id] of RULES) if (re.test(l)) return id;
  return "autre";
}

// Applique d'abord les règles utilisateur, puis les règles par défaut.
// Matching par mots individuels : une règle matche si AU MOINS UN de ses mots est présent.
// En cas de plusieurs règles qui matchent, on prend celle avec le plus de mots trouvés (plus spécifique).
export function guessCatWithRules(label, userRules = []) {
  const l = (label || "").toLowerCase();

  let bestCat = null;
  let bestScore = 0;
  let bestWordCount = 0;

  for (const { pattern, categoryId } of userRules) {
    if (!pattern) continue;
    const words = pattern.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
    const matches = words.filter((w) => l.includes(w)).length;
    if (matches === 0) continue;
    // Priorité : plus de mots matchés > plus de mots dans le pattern (plus spécifique)
    if (matches > bestScore || (matches === bestScore && words.length > bestWordCount)) {
      bestScore = matches;
      bestWordCount = words.length;
      bestCat = categoryId;
    }
  }

  if (bestCat) return bestCat;
  return guessCat(label);
}

// Retourne true si au moins une règle utilisateur matche le libellé.
export function hasUserRuleMatch(label, userRules = []) {
  const l = (label || "").toLowerCase();
  return userRules.some(({ pattern }) => pattern && l.includes(pattern.toLowerCase()));
}

/* ------------------------------------------------ helpers de parsing */

const toNumber = (raw) => {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // retire les espaces (y compris insécables) servant de séparateur de milliers
  s = s.replace(/[\s\u00A0]/g, "");
  // si virgule décimale française : enlève les points de milliers, virgule -> point
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
};

const toISODate = (raw) => {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{2,4})$/); // JJ/MM/AAAA
  if (m) {
    const yyyy = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yyyy}-${m[2]}-${m[1]}`;
  }
  m = s.match(/^(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})$/); // AAAA-MM-JJ
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // retire les accents

/* ------------------------------------------------ mapping par en-tête */

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map(norm);
    const hasDate = cells.some((c) => c.includes("date"));
    const hasMoney = cells.some(
      (c) => c.includes("montant") || c.includes("debit") || c.includes("credit")
    );
    if (hasDate && hasMoney) return i;
  }
  return -1;
}

function colIndexes(header) {
  const h = header.map(norm);
  const find = (...keys) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  return {
    date: find("date operation", "date compt", "date"),
    label: find("libelle", "nature", "operation", "detail", "motif"),
    montant: find("montant"),
    debit: find("debit"),
    credit: find("credit"),
  };
}

/* ------------------------------------------------ extraction d'une ligne */

function rowToExpenseByHeader(row, idx) {
  const date = toISODate(row[idx.date]);
  if (!date) return null;
  const label = (row[idx.label] != null ? String(row[idx.label]) : "")
    .replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim() || "Import";

  let amount = null;
  let isCredit = false;

  if (idx.montant >= 0) {
    const m = toNumber(row[idx.montant]);
    if (m != null && m !== 0) {
      isCredit = m > 0;
      amount = Math.abs(m);
    }
  } else {
    // colonnes Débit / Crédit séparées
    if (idx.debit >= 0) {
      const d = toNumber(row[idx.debit]);
      if (d != null && d !== 0) amount = Math.abs(d);
    }
    if (amount == null && idx.credit >= 0) {
      const c = toNumber(row[idx.credit]);
      if (c != null && c !== 0) { amount = Math.abs(c); isCredit = true; }
    }
  }
  if (amount == null) return null;

  return { amount, label, categoryId: guessCat(label), date, isCredit };
}

// Fallback heuristique quand aucune en-tête n'est trouvée : on scanne la ligne.
function rowToExpenseHeuristic(row) {
  let date = null;
  let amount = null;
  let label = "";
  for (const cell of row) {
    const d = toISODate(cell);
    if (d && !date) {
      date = d;
      continue;
    }
    const n = toNumber(cell);
    if (n != null && amount === null) {
      amount = n;
      continue;
    }
    const s = String(cell || "").trim();
    if (s.length > label.length && toNumber(s) == null && !toISODate(s)) label = s;
  }
  if (date && amount != null && amount !== 0) {
    const isCredit = amount > 0;
    return { amount: Math.abs(amount), label: label || "Import", categoryId: guessCat(label), date, isCredit };
  }
  return null;
}

/* ------------------------------------------------ OFX / QFX */

export function importBankOFX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const out = [];
        // extrait tous les blocs <STMTTRN>...</STMTTRN>
        const blocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
        for (const [, block] of blocks) {
          const get = (tag) => { const m = block.match(new RegExp(`<${tag}>([^<\r\n]+)`, "i")); return m ? m[1].trim() : null; };
          const type = get("TRNTYPE") || "";
          const rawAmt = get("TRNAMT");
          const amount = rawAmt ? parseFloat(rawAmt.replace(",", ".")) : null;
          if (amount == null || amount === 0) continue;
          const isCredit = amount > 0;
          const rawDate = get("DTPOSTED") || get("DTUSER") || "";
          // format OFX : YYYYMMDDHHMMSS ou YYYYMMDD
          const y = rawDate.slice(0, 4), mo = rawDate.slice(4, 6), d = rawDate.slice(6, 8);
          const date = y && mo && d ? `${y}-${mo}-${d}` : null;
          if (!date) continue;
          const label = (get("NAME") || get("MEMO") || "Import OFX").trim();
          out.push({ amount: Math.abs(amount), label, categoryId: guessCat(label), date, isCredit });
        }
        resolve(out);
      } catch (e) { reject(e); }
    };
    reader.readAsText(file, "utf-8");
  });
}

/* ------------------------------------------------ QIF */

export function importBankQIF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      try {
        const lines = ev.target.result.split(/\r?\n/);
        const out = [];
        let cur = {};
        for (const line of lines) {
          if (line.startsWith("^")) {
            if (cur.date && cur.amount != null && cur.amount !== 0) {
              const label = cur.label || "Import QIF";
              const isCredit = cur.amount > 0;
              out.push({ amount: Math.abs(cur.amount), label, categoryId: guessCat(label), date: cur.date, isCredit });
            }
            cur = {};
          } else if (line.startsWith("D")) {
            cur.date = toISODate(line.slice(1).trim());
          } else if (line.startsWith("T") || line.startsWith("U")) {
            const n = toNumber(line.slice(1).trim().replace(/,(\d{2})$/, ".$1")); // QIF US : virgule = décimale
            if (n != null && cur.amount == null) cur.amount = n;
          } else if (line.startsWith("P")) {
            cur.label = line.slice(1).trim();
          } else if (line.startsWith("M") && !cur.label) {
            cur.label = line.slice(1).trim();
          }
        }
        resolve(out);
      } catch (e) { reject(e); }
    };
    reader.readAsText(file, "utf-8");
  });
}

/* ------------------------------------------------ API publique */

// Détecte le séparateur en comptant les candidats sur tout le texte.
// PapaParse devine sur les ~10 premières lignes seulement : insuffisant quand
// le relevé commence par un long préambule (cas Crédit Agricole).
function detectDelimiter(text) {
  const sample = text.slice(0, 50000);
  const candidates = [";", ",", "\t", "|"];
  let best = ";", bestCount = -1;
  for (const d of candidates) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return bestCount > 0 ? best : ";";
}

function parseCSVText(text, resolve) {
  Papa.parse(text, {
    skipEmptyLines: true,
    delimiter: detectDelimiter(text),
    complete: (res) => {
      const rows = (res.data || []).filter((r) => Array.isArray(r) && r.length >= 2);
      const headerRow = findHeader(rows);
      const out = [];
      if (headerRow >= 0) {
        const idx = colIndexes(rows[headerRow]);
        for (let i = headerRow + 1; i < rows.length; i++) {
          const e = rowToExpenseByHeader(rows[i], idx);
          if (e) out.push(e);
        }
      } else {
        for (const r of rows) {
          const e = rowToExpenseHeuristic(r);
          if (e) out.push(e);
        }
      }
      resolve(out);
    },
  });
}

export function importBankCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      try {
        const buf = ev.target.result;
        // Détecte UTF-8 BOM ou caractères de remplacement → fallback ISO-8859-1
        let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        if (text.includes("�")) {
          text = new TextDecoder("iso-8859-1").decode(buf);
        }
        parseCSVText(text, resolve);
      } catch (e) { reject(e); }
    };
    reader.readAsArrayBuffer(file);
  });
}
