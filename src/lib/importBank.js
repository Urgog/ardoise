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

// Applique d'abord les règles utilisateur (simples sous-chaînes), puis les règles par défaut.
export function guessCatWithRules(label, userRules = []) {
  const l = (label || "").toLowerCase();
  for (const { pattern, categoryId } of userRules) {
    if (pattern && l.includes(pattern.toLowerCase())) return categoryId;
  }
  return guessCat(label);
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
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
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
  const label = (row[idx.label] != null ? String(row[idx.label]) : "").trim() || "Import";

  let amount = null;
  if (idx.montant >= 0) {
    const m = toNumber(row[idx.montant]);
    if (m != null && m < 0) amount = Math.abs(m); // débit
  } else if (idx.debit >= 0) {
    const d = toNumber(row[idx.debit]);
    if (d != null && d !== 0) amount = Math.abs(d);
  }
  if (amount == null) return null; // crédit ou ligne sans débit -> ignorée

  return { amount, label, categoryId: guessCat(label), date };
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
  if (date && amount != null && amount < 0) {
    return { amount: Math.abs(amount), label: label || "Import", categoryId: guessCat(label), date };
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
          if (amount == null || amount >= 0) continue; // on ne garde que les débits
          const rawDate = get("DTPOSTED") || get("DTUSER") || "";
          // format OFX : YYYYMMDDHHMMSS ou YYYYMMDD
          const y = rawDate.slice(0, 4), mo = rawDate.slice(4, 6), d = rawDate.slice(6, 8);
          const date = y && mo && d ? `${y}-${mo}-${d}` : null;
          if (!date) continue;
          const label = (get("NAME") || get("MEMO") || "Import OFX").trim();
          out.push({ amount: Math.abs(amount), label, categoryId: guessCat(label), date });
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
            if (cur.date && cur.amount != null && cur.amount < 0) {
              const label = cur.label || "Import QIF";
              out.push({ amount: Math.abs(cur.amount), label, categoryId: guessCat(label), date: cur.date });
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

export function importBankCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: true,
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
      error: reject,
    });
  });
}
