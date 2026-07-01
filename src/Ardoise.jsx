import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Plus, Trash2, ShoppingCart, Home, Car, UtensilsCrossed, Gamepad2, HeartPulse,
  Repeat, ShoppingBag, MoreHorizontal, Tag, Upload, Download, X, TrendingDown,
  TrendingUp, Wallet, Calendar, Search, PieChart as PieIcon, Pencil, Check,
  FileJson, BarChart2, AlertTriangle, ChevronLeft, ChevronRight, BookOpen,
  Settings, RotateCcw, ClipboardList, UserPlus, Users, Sun, Moon,
} from "lucide-react";
import { storage } from "./lib/storage";
import { importBankCSV, importBankOFX, importBankQIF, guessCatWithRules, hasUserRuleMatch, ruleMatchesLabel } from "./lib/importBank";

/* ---------------------------------------------------------------- utilitaires */

const KEY = "data";
const EMPTY = []; // référence stable pour les mois sans dépense
const fmtEUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const fmtShort = (n) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} k€` : `${Math.round(n)} €`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthOf = (iso) => iso.slice(0, 7);
const monthLabel = (ym) => {
  const [y, m] = ym.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------------------------------------------------------- extraction pattern bancaire */

// Mots trop génériques / bancaires : présents dans beaucoup de dépenses sans
// rapport, ils ne doivent jamais devenir des mots-clés de règle (sinon une règle
// sur-matche). Filtrés quelle que soit leur position dans le libellé.
const STOPWORDS = new Set([
  "paiement", "paiements", "paie", "paye", "payment",
  "cb", "carte", "cartes", "bleue", "credit", "debit",
  "virement", "virements", "vir", "prelevement", "prelevements", "prel", "prlv",
  "sepa", "achat", "achats", "retrait", "retraits", "dab", "gab", "web", "inst",
  "mandat", "cheque", "cheques", "recu", "emis", "emise", "vers", "faveur", "votre",
  "compte", "comptes", "operation", "operations", "frais", "avoir", "remise",
  "cotisation", "cotisations", "commission", "commissions", "interet", "interets",
  "mensuel", "mensuelle", "echeance", "reference",
]);

// Un vrai mot-clé cohérent : uniquement des lettres (pas de chiffres ni de codes),
// 3 à 15 caractères, au moins une voyelle, hors mots génériques. Rejette les
// références type "CK3W26180M072679", "PAYLI2469664", les suites de consonnes, etc.
const isValidKeyword = (w) =>
  w.length >= 3 && w.length <= 15 && /^[a-z]+$/.test(w) && /[aeiouy]/.test(w) && !STOPWORDS.has(w);

const extractPattern = (label) => {
  let s = label.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    // tout ce qui n'est pas une lettre (chiffres, ponctuation, *, /, ') → espace :
    // supprime dates, codes, montants et références sans reformater les mots.
    .replace(/[^a-z\s]/g, " ")
    .trim();

  let prev;
  do {
    prev = s;
    s = s.replace(
      /^(virements?|vir|sepa|cb|carte(\s+bleue)?|prlv|prelevements?|prel|paiements?|achat|retrait|ret|dab|gab|frais|avoir|remise|cheques?|cotisations?|commissions?|interets?|de|du|mr|mme|par|pour|chez|au|aux)\s+/i,
      ""
    ).trim();
  } while (s !== prev);

  s = s.replace(/\b(sarl|sas|eurl|spa|inc|ltd|groupe|group|agence|magasin|boutique|store|market|france|paris|lyon|marseille|bordeaux|lille|nantes|strasbourg|metz|toulouse)\b/g, "");
  s = s.replace(/\s+/g, " ").trim();

  const words = s.split(/\s+/).filter(isValidKeyword);
  const pattern = words.slice(0, 3).join(" ").trim();
  return pattern.length >= 3 ? pattern : null;
};

/* ---------------------------------------------------------------- fusion catégories banque */

const normCat = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Correspondance des catégories/sous-catégories banque (ex. Crédit Agricole) vers
// les catégories Ardoise existantes. Valeurs spéciales :
//   "@review"  → à catégoriser (needsReview)
//   "@frais"   → résolu vers la catégorie utilisateur évoquant les frais bancaires
//   "@defer"   → laisser les règles/libellé décider (catégorie banque trop ambiguë)
const BANK_TO_CAT = {
  // restauration
  "sorties / restaurant": "restaurants", "snacks / repas au travail": "restaurants",
  "cafe / jeux / tabac": "restaurants", "hebergement / restauration": "restaurants",
  // alimentation
  "grande surface": "alimentation", "petit commercant": "alimentation", "alimentation": "alimentation",
  // loisirs
  "culture": "loisirs", "passion": "loisirs", "sport": "loisirs",
  "jeux et divertissements": "loisirs", "vacances / weekend": "loisirs", "vacances / weekend, divers": "loisirs",
  // transport
  "transport": "transport", "transport / taxi / location": "transport", "vehicule": "transport",
  // shopping
  "shopping": "shopping", "habillement": "shopping", "achats high tech": "shopping",
  "equipement / ameublement": "shopping", "soin du corps / coiffeur / cosmetique": "shopping",
  // abonnements / télécom (catégories banque fiables)
  "internet (ou triple play)": "abonnements", "abonnements tv": "abonnements",
  "telephonie mobile": "abonnements",
  // "Numérique" est trop large (Amazon, Netflix, Steam, Apple...) : on délègue aux
  // règles/libellé plutôt que de tout forcer en abonnements.
  "numerique": "@defer", "numerique, divers": "@defer",
  // logement
  "logement / maison": "logement", "loyer / charges": "logement",
  "energies / eau": "logement", "entretien / bricolage": "logement", "entretien": "logement",
  // santé
  "assurances / prevoyance / dependance": "sante",
  // revenus
  "revenus professionnels": "revenus", "revenus de placement": "revenus", "revenus exceptionnels": "revenus",
  "autres revenus": "revenus", "salaire / prime": "revenus", "retraites": "revenus",
  "allocations": "revenus", "revenu foncier": "revenus",
  // transferts internes : SEULE la sous-catégorie "Virements internes" → inter-comptes.
  // "Hors budget" (catégorie parente) ne doit pas forcer inter-comptes par lui-même.
  "virements internes": "inter-comptes", "virement interne": "inter-comptes", "hors budget": "@defer",
  // frais bancaires → catégorie utilisateur (résolu par mot-clé)
  "frais bancaires": "@frais",
  // à catégoriser → revue par l'utilisateur
  "a categoriser": "@review", "a categoriser, divers": "@review",
  // trop ambigu → on laisse les règles/libellé décider
  "autres depenses": "@defer", "autres depenses, divers": "@defer", "vie quotidienne": "@defer",
  "famille": "@defer", "enfants & scolarite": "@defer", "impots / taxes": "@defer",
  "impot / taxes, divers": "@defer", "animaux": "@defer", "animaux, divers": "@defer",
  "don / cadeaux": "@defer", "cadeaux": "@defer", "dons caritatifs": "@defer",
  "cartes credit / credits conso": "@defer", "frais professionnels": "@defer",
  "retrait d'argent": "@defer", "virements": "@defer", "virements recus": "@defer",
};

// Résout une catégorie banque vers une catégorie Ardoise existante.
// Renvoie { categoryId } | { review: true } | null (= ambigu, déléguer aux règles).
// La sous-catégorie (niveau fin) est AUTORITAIRE : la catégorie parente ne sert
// que si la sous-catégorie n'a aucune correspondance. Évite qu'un parent comme
// "Hors budget" écrase l'intention d'une sous-catégorie (ex. "Virements" externe).
const resolveBankCategory = (bankCat, bankSubCat, cats) => {
  const token = BANK_TO_CAT[normCat(bankSubCat)] ?? BANK_TO_CAT[normCat(bankCat)];
  if (!token || token === "@defer") return null;
  if (token === "@review") return { review: true };
  if (token === "@frais") {
    const found = cats.find((c) => /frais|bancaire|banque/i.test(c.label));
    return found ? { categoryId: found.id } : { review: true };
  }
  return cats.some((c) => c.id === token) ? { categoryId: token } : null;
};

/* ---------------------------------------------------------------- nettoyage des règles */

// Retire les mots interdits (STOPWORDS) et trop courts des patterns de règles
// déjà enregistrées ; supprime les règles devenues vides. Supprime aussi les
// règles pointant vers "inter-comptes" : cette catégorie ne doit venir QUE de la
// sous-catégorie banque "Virements internes", jamais d'une règle de mot-clé.
const sanitizeRules = (rules = []) =>
  rules
    .map((r) => {
      if (!r || !r.pattern || r.categoryId === "inter-comptes") return null;
      // ne garde que les vrais mots-clés cohérents (idem extractPattern)
      const words = r.pattern.split(/\s+/).filter((w) => isValidKeyword(normCat(w)));
      const pattern = words.join(" ").trim();
      return pattern ? { ...r, pattern } : null;
    })
    .filter(Boolean);

/* ---------------------------------------------------------------- palette couleurs */

const PALETTE = [
  "#F87171", "#FB923C", "#FBBF24", "#FDE047", "#4ADE80", "#34D399",
  "#2DD4BF", "#38BDF8", "#60A5FA", "#818CF8", "#A78BFA", "#C084FC",
  "#E879F9", "#F472B6", "#94A3B8", "#64748B",
];

const hexToHue = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
        : max === g ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return h * 360;
};

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const pickColor = (existingColors = []) => {
  const hues = existingColors.map(hexToHue);
  return PALETTE.reduce((best, c) => {
    const h = hexToHue(c);
    const minDist = hues.length ? Math.min(...hues.map((eh) => hueDist(h, eh))) : 360;
    return minDist > best.dist ? { color: c, dist: minDist } : best;
  }, { color: PALETTE[0], dist: -1 }).color;
};
const DEFAULT_CATS = [
  { id: "alimentation", label: "Alimentation", color: "#34D399", builtin: true },
  { id: "logement",     label: "Logement",      color: "#60A5FA", builtin: true },
  { id: "transport",    label: "Transport",      color: "#FBBF24", builtin: true },
  { id: "restaurants",  label: "Restaurants",    color: "#F472B6", builtin: true },
  { id: "loisirs",      label: "Loisirs",        color: "#A78BFA", builtin: true },
  { id: "sante",        label: "Santé",           color: "#F87171", builtin: true },
  { id: "abonnements",  label: "Abonnements",    color: "#2DD4BF", builtin: true },
  { id: "shopping",     label: "Shopping",        color: "#FB923C", builtin: true },
  { id: "autre",        label: "Autre",           color: "#94A3B8", builtin: true },
  { id: "revenus",      label: "Revenus",         color: "#4ADE80", builtin: true },
  { id: "inter-comptes", label: "Inter-comptes", color: "#818CF8", builtin: true, excludeFromTotal: true },
];

const ICONS = {
  alimentation: ShoppingCart, logement: Home, transport: Car, restaurants: UtensilsCrossed,
  loisirs: Gamepad2, sante: HeartPulse, abonnements: Repeat, shopping: ShoppingBag, autre: MoreHorizontal,
};
const CatIcon = ({ id, ...p }) => {
  const I = ICONS[id] || Tag;
  return <I {...p} />;
};


/* ---------------------------------------------------------------- composant */

export default function Ardoise() {
  const [cats, setCats] = useState(DEFAULT_CATS);
  const [expenses, setExpenses] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // formulaire
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [catId, setCatId] = useState("alimentation");
  const [date, setDate] = useState(todayISO());

  // ui
  const [month, setMonth] = useState(monthOf(todayISO()));
  const [filterCat, setFilterCat] = useState("all");
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [editCatId, setEditCatId] = useState(null);
  const [editExpense, setEditExpense] = useState(null);
  const [showYear, setShowYear] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [showPiePanel, setShowPiePanel] = useState(true);
  const [showBarPanel, setShowBarPanel] = useState(true);
  const [theme, setTheme] = useState(() => (storage.get("theme")?.value === "light" ? "light" : "dark"));
  const [budgets, setBudgets] = useState({});
  const [rules, setRules] = useState([]);
  const [forecastPeople, setForecastPeople] = useState([{ id: "p1", name: "Moi" }, { id: "p2", name: "Autre" }]);
  const [forecastItems, setForecastItems] = useState([]);
  const [undo, setUndo] = useState(null); // { snapshot: [...expenses], label } pour annuler une suppression
  const [reviewMode, setReviewMode] = useState(false); // file de revue plein écran
  const [installPrompt, setInstallPrompt] = useState(null); // événement PWA beforeinstallprompt
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches);
  const [showBudgets, setShowBudgets] = useState(() => storage.get("ui:budgets")?.value !== "0");
  const [showSavings, setShowSavings] = useState(true);
  const [showInsights, setShowInsights] = useState(true);
  const [showRecurring, setShowRecurring] = useState(true);
  const [backupHidden, setBackupHidden] = useState(false);
  const fileRef = useRef(null);
  const jsonRef = useRef(null);

  /* PWA : capte l'invite d'installation de Chrome pour proposer un bouton dédié */
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => { setInstallPrompt(null); setInstalled(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const doInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  /* persistance */
  useEffect(() => {
    const r = storage.get(KEY);
    if (r && r.value) {
      try {
        const d = JSON.parse(r.value);
        if (d.categories?.length) {
          const saved = d.categories;
          const savedIds = new Set(saved.map((c) => c.id));
          const missingBuiltins = DEFAULT_CATS.filter((c) => c.builtin && !savedIds.has(c.id));
          // Sync couleurs des built-ins depuis DEFAULT_CATS (corrige doublons/palettes obsolètes)
          const defaultColorById = Object.fromEntries(DEFAULT_CATS.map((c) => [c.id, c.color]));
          const synced = saved.map((c) => c.builtin && defaultColorById[c.id] ? { ...c, color: defaultColorById[c.id] } : c);
          setCats([...synced, ...missingBuiltins]);
        }
        if (d.expenses) setExpenses(d.expenses);
        if (d.budgets) setBudgets(d.budgets);
        if (d.rules) setRules(sanitizeRules(d.rules));
        if (d.forecastPeople?.length) setForecastPeople(d.forecastPeople);
        if (d.forecastItems) setForecastItems(d.forecastItems);
      } catch { /* ignore */ }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const payload = JSON.stringify({ expenses, categories: cats, budgets, rules, forecastPeople, forecastItems });
    // Débounce : coalesce les écritures rapprochées (saisie, import) en une seule.
    const t = setTimeout(() => {
      const ok = storage.set(KEY, payload);
      if (!ok) {
        alert("Sauvegarde impossible : le stockage du navigateur est saturé. Exporte tes données (JSON) pour ne rien perdre.");
      } else if (payload.length > 4_000_000) {
        // localStorage ~5 Mo : on prévient avant d'atteindre la limite.
        console.warn(`Ardoise : données volumineuses (${Math.round(payload.length / 1024)} Ko), proche de la limite de stockage.`);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [expenses, cats, budgets, rules, forecastPeople, forecastItems, loaded]);

  // Reclassifie les dépenses en "Autre" sans manualCat quand les règles changent ou au démarrage
  useEffect(() => {
    if (!loaded) return;
    setExpenses((prev) => prev.map((e) => {
      if (e.manualCat) return e;
      const categoryId = guessCatWithRules(e.label, rules);
      const needsReview = categoryId === "autre";
      return { ...e, categoryId, needsReview };
    }));
  }, [rules, loaded]);

  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);

  // Index des dépenses par mois : évite de re-filtrer tout le tableau à chaque
  // agrégation (perf). Purement pour l'affichage — n'affecte pas la propagation.
  const byMonth = useMemo(() => {
    const m = {};
    for (const e of expenses) (m[monthOf(e.date)] ||= []).push(e);
    return m;
  }, [expenses]);

  const months = useMemo(() => {
    const set = new Set(Object.keys(byMonth));
    set.add(monthOf(todayISO()));
    return [...set].sort().reverse();
  }, [byMonth]);

  const monthExp = byMonth[month] || EMPTY;
  const isTransfer = (e) => catById[e.categoryId]?.excludeFromTotal;
  const monthTotal = useMemo(() => monthExp.filter((e) => !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0), [monthExp, catById]);
  // Argent gagné dans le mois : crédits hors transferts inter-comptes.
  const monthIncome = useMemo(() => monthExp.filter((e) => e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0), [monthExp, catById]);

  const prevMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [month]);
  const prevTotal = useMemo(
    () => expenses.filter((e) => monthOf(e.date) === prevMonth && !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0),
    [expenses, prevMonth]
  );
  const delta = prevTotal ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;

  const byCat = useMemo(() => {
    const m = {};
    monthExp.filter((e) => !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).forEach((e) => (m[e.categoryId] = (m[e.categoryId] || 0) + e.amount));
    return Object.entries(m)
      .map(([id, value]) => ({ id, value, ...(catById[id] || { label: id, color: "#94A3B8" }) }))
      .sort((a, b) => b.value - a.value);
  }, [monthExp, catById]);

  const topCat = byCat[0];

  const series = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const total = (byMonth[ym] || EMPTY).filter((e) => !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0);
      out.push({ ym, total, lbl: d.toLocaleDateString("fr-FR", { month: "short" }), cur: ym === month });
    }
    return out;
  }, [byMonth, catById, month]);

  // Épargne NETTE du mois : argent sorti vers l'épargne (débits inter-comptes)
  // moins l'argent récupéré de l'épargne (crédits inter-comptes).
  const monthSavings = useMemo(() => monthExp
    .filter((e) => catById[e.categoryId]?.excludeFromTotal)
    .reduce((s, e) => s + (e.isCredit ? -e.amount : e.amount), 0), [monthExp, catById]);
  // Catégories d'investissement (PEA, bourse, placement…), détectées par libellé.
  const investIds = useMemo(() => new Set(
    cats.filter((c) => /investiss|\bpea\b|bourse|placement|\bper\b|assurance[\s-]?vie|crypto/i.test(c.label)).map((c) => c.id)
  ), [cats]);
  const hasInvest = investIds.size > 0;
  // Investissement NET du mois (débits − crédits) sur ces catégories.
  const monthInvest = useMemo(() => monthExp
    .filter((e) => investIds.has(e.categoryId))
    .reduce((s, e) => s + (e.isCredit ? -e.amount : e.amount), 0), [monthExp, investIds]);
  const savingsRate = monthIncome > 0 ? ((monthIncome - monthTotal) / monthIncome) * 100 : null;

  // Insights : plus grosses variations par catégorie vs mois précédent.
  const insights = useMemo(() => {
    const prevM = {};
    (byMonth[prevMonth] || EMPTY).filter((e) => !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).forEach((e) => (prevM[e.categoryId] = (prevM[e.categoryId] || 0) + e.amount));
    const ids = new Set([...byCat.map((c) => c.id), ...Object.keys(prevM)]);
    const rows = [];
    ids.forEach((id) => {
      const cur = byCat.find((c) => c.id === id)?.value || 0;
      const prev = prevM[id] || 0;
      const diff = cur - prev;
      if (Math.abs(diff) < 1) return;
      rows.push({ id, diff, cat: catById[id] || { label: id, color: "#94A3B8" }, pct: prev ? (diff / prev) * 100 : null });
    });
    return rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 4);
  }, [byMonth, prevMonth, byCat, catById]);

  // Dépenses récurrentes : même libellé (pattern) sur au moins 3 mois distincts.
  const recurring = useMemo(() => {
    const groups = {};
    for (const e of expenses) {
      if (e.isCredit || catById[e.categoryId]?.excludeFromTotal) continue;
      const p = extractPattern(e.label);
      if (!p) continue;
      (groups[p] ||= []).push(e);
    }
    const out = [];
    for (const [p, list] of Object.entries(groups)) {
      const monthsSet = new Set(list.map((e) => monthOf(e.date)));
      if (monthsSet.size < 3) continue;
      const last = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const avg = list.reduce((s, e) => s + e.amount, 0) / list.length;
      out.push({ pattern: p, months: monthsSet.size, avg, last: last.amount, label: last.label, catId: last.categoryId, changed: avg > 0 && Math.abs(last.amount - avg) / avg > 0.15 });
    }
    return out.sort((a, b) => b.months - a.months).slice(0, 8);
  }, [expenses, catById]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const isNum = /^\d+([.,]\d+)?$/.test(q); // requête purement numérique → montant
    return monthExp
      .filter((e) => filterCat === "all" ? true : filterCat === "__review__" ? e.needsReview : e.categoryId === filterCat)
      .filter((e) => {
        if (!q) return true;
        if (isNum) {
          // montant uniquement (pas les nombres dans les libellés)
          const amt = String(e.amount).replace(".", ",");
          return q.includes(",")
            ? amt.startsWith(q)                                  // "1,99" → montant exact/préfixe
            : String(Math.trunc(e.amount)).includes(q);          // "200" → partie entière contient 200
        }
        const cat = (catById[e.categoryId]?.label || "").toLowerCase();
        return e.label.toLowerCase().includes(q) || cat.includes(q);
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [monthExp, filterCat, query, catById]);

  // Rappel de sauvegarde : jamais exporté, ou dernière sauvegarde > 14 jours.
  const backupDue = useMemo(() => {
    if (expenses.length === 0 || backupHidden) return false;
    const last = storage.get("lastBackup")?.value;
    return !last || Date.now() - Number(last) > 14 * 24 * 60 * 60 * 1000;
  }, [expenses.length, backupHidden]);

  const daysElapsed = useMemo(() => {
    const cur = monthOf(todayISO());
    if (month > cur) return 1;
    if (month < cur) {
      const [y, m] = month.split("-").map(Number);
      return new Date(y, m, 0).getDate();
    }
    return new Date().getDate();
  }, [month]);

  /* actions */
  const addExpense = () => {
    const a = parseFloat(String(amount).replace(",", "."));
    if (!a || a <= 0) return;
    setExpenses((x) => [
      { id: uid(), amount: Math.round(a * 100) / 100, label: label.trim() || catById[catId]?.label || "Dépense", categoryId: catId, date },
      ...x,
    ]);
    setAmount(""); setLabel("");
    setMonth(monthOf(date));
  };

  const removeExpense = (id) => setExpenses((x) => {
    if (x.some((e) => e.id === id)) setUndo({ snapshot: x, label: "Dépense supprimée" });
    return x.filter((e) => e.id !== id);
  });

  const resetData = () => {
    if (!window.confirm("Supprimer toutes les dépenses ? Les catégories, budgets et règles sont conservés.")) return;
    setExpenses((x) => { if (x.length) setUndo({ snapshot: x, label: `${x.length} dépense(s) supprimée(s)` }); return []; });
  };

  // Auto-fermeture du bandeau « Annuler » après 6 s.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const updateCat = (id, categoryId) => {
    const target = expenses.find((e) => e.id === id);
    if (!target) return;
    const oldCat = target.categoryId;
    const pattern = extractPattern(target.label);

    setRules((prev) => {
      let next = prev;
      // Correction active : si la dépense changeait de catégorie, retire les règles
      // utilisateur qui matchent ce libellé ET pointaient vers l'ancienne catégorie
      // (= la règle fautive qui avait causé le mauvais classement).
      if (oldCat && oldCat !== categoryId) {
        next = next.filter((r) => !(r.categoryId === oldCat && ruleMatchesLabel(target.label, r.pattern)));
      }
      // Apprentissage : ajoute / met à jour la règle vers la bonne catégorie.
      // Exception : on n'apprend JAMAIS de règle vers "inter-comptes" — cette
      // catégorie ne doit venir que de la sous-catégorie banque "Virements internes".
      if (pattern && categoryId !== "inter-comptes") {
        const i = next.findIndex((r) => r.pattern.toLowerCase() === pattern);
        if (i >= 0) {
          next = next.map((r, idx) => (idx === i ? { ...r, categoryId } : r));
        } else {
          next = [...next, { pattern, categoryId }];
        }
      }
      return next;
    });

    setExpenses((x) => x.map((e) => {
      // La dépense recatégorisée : choix manuel explicite, verrouillé.
      if (e.id === id) return { ...e, categoryId, manualCat: true, needsReview: false };
      // Propagation immédiate à toutes les dépenses similaires (même pattern),
      // tous mois confondus — y compris celles verrouillées par la banque qui
      // étaient dans l'ancienne catégorie. On épargne les choix manuels portant
      // sur une AUTRE catégorie (décisions délibérées de l'utilisateur).
      if (
        pattern && categoryId !== "inter-comptes" &&
        ruleMatchesLabel(e.label, pattern) &&
        (!e.manualCat || e.categoryId === oldCat)
      ) {
        return { ...e, categoryId, needsReview: false };
      }
      return e;
    }));
  };

  const updateExpense = (id, patch) =>
    setExpenses((x) => x.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const setCatBudget = (catId, value) =>
    setBudgets((b) => ({ ...b, [catId]: value }));

  const exportJSON = () => {
    const data = JSON.stringify({ expenses, categories: cats, budgets, rules, forecastPeople, forecastItems }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ardoise-sauvegarde.json"; a.click();
    URL.revokeObjectURL(url);
    storage.set("lastBackup", String(Date.now()));
    setBackupHidden(true);
  };

  const importJSONFile = (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (!Array.isArray(d.expenses)) throw new Error("Format invalide");
        if (!window.confirm(`Restaurer ${d.expenses.length} dépense(s) ? Les données actuelles seront remplacées.`)) return;
        if (d.categories?.length) setCats(d.categories);
        setExpenses(d.expenses);
        if (d.budgets) setBudgets(d.budgets);
        if (d.rules) setRules(sanitizeRules(d.rules));
        if (d.forecastPeople?.length) setForecastPeople(d.forecastPeople);
        if (d.forecastItems) setForecastItems(d.forecastItems);
        alert("Restauration réussie.");
      } catch {
        alert("Fichier JSON invalide ou corrompu.");
      }
    };
    reader.readAsText(file);
  };

  const addCat = (lbl, color) => {
    const id = uid();
    setCats((c) => {
      const autoColor = color || pickColor(c.map((x) => x.color));
      return [...c.slice(0, c.length - 1), { id, label: lbl, color: autoColor, builtin: false }, c[c.length - 1]];
    });
    return id;
  };
  const removeCat = (id) => {
    if (catById[id]?.builtin) return;
    setExpenses((x) => x.map((e) => (e.categoryId === id ? { ...e, categoryId: "autre" } : e)));
    setCats((c) => c.filter((x) => x.id !== id));
  };
  const updateCatDef = (id, patch) =>
    setCats((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const handleImport = async (file) => {
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let parsed;
      if (ext === "ofx" || ext === "qfx") parsed = await importBankOFX(file);
      else if (ext === "qif") parsed = await importBankQIF(file);
      else parsed = await importBankCSV(file);
      // Catégorisation à l'import. Priorité : catégorie banque (claire) >
      // règles/libellé > à catégoriser. La catégorie banque est verrouillée
      // (manualCat) pour rester stable ; l'utilisateur peut toujours la corriger.
      parsed = parsed.map(({ bankCat, bankSubCat, ...e }) => {
        const bank = resolveBankCategory(bankCat, bankSubCat, cats);
        if (bank?.categoryId) {
          return { ...e, categoryId: bank.categoryId, manualCat: true, needsReview: false };
        }
        const categoryId = guessCatWithRules(e.label, rules) || e.categoryId;
        if (categoryId !== "autre") return { ...e, categoryId };
        // Ni catégorie banque exploitable, ni règle : à catégoriser.
        const needsReview = bank?.review || !hasUserRuleMatch(e.label, rules);
        return { ...e, categoryId: "autre", ...(needsReview ? { needsReview: true } : {}) };
      });
      if (!parsed.length) {
        alert("Aucune dépense détectée. Vérifie que le fichier contient une colonne date et une colonne montant ou débit.");
        return;
      }
      setExpenses((x) => {
        // Déduplication par comptage : on ne saute une ligne que si ce couple
        // (date|montant|libellé) existe déjà AUTANT de fois en base. Deux vraies
        // transactions identiques le même jour sont donc conservées.
        const remaining = new Map();
        for (const e of x) {
          const k = `${e.date}|${e.amount}|${e.label}`;
          remaining.set(k, (remaining.get(k) || 0) + 1);
        }
        const added = [];
        for (const e of parsed) {
          const k = `${e.date}|${e.amount}|${e.label}`;
          const n = remaining.get(k) || 0;
          if (n > 0) remaining.set(k, n - 1); // déjà présent → on saute cette occurrence
          else added.push({ id: uid(), ...e });
        }
        const skipped = parsed.length - added.length;
        const msg = added.length
          ? `${added.length} dépense(s) importée(s)${skipped ? ` · ${skipped} doublon(s) ignoré(s)` : ""}.`
          : `Aucune nouvelle dépense — ${skipped} doublon(s) ignoré(s).`;
        setTimeout(() => alert(msg), 0);
        return added.length ? [...added, ...x] : x;
      });
    } catch {
      alert("Impossible de lire ce fichier CSV.");
    }
  };

  const exportCSV = () => {
    const rows = [["date", "libelle", "categorie", "montant"]];
    expenses.forEach((e) => rows.push([e.date, e.label, catById[e.categoryId]?.label || e.categoryId, String(e.amount).replace(".", ",")]));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ardoise-depenses.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------------------------------------------------------------- rendu */

  const empty = expenses.length === 0;

  return (
    <div className={`min-h-screen w-full bg-slate-950 text-slate-100 font-sans antialiased ${theme === "light" ? "theme-light" : ""}`}>
      <style>{`
        select option { background:#0f172a; }
        ::-webkit-scrollbar{height:8px;width:8px}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:8px}
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        input[type=number]{-moz-appearance:textfield}

        /* ---- Thème clair : remappe les couleurs sombres sous .theme-light uniquement ---- */
        .theme-light{ color-scheme:light; background-color:#f1f5f9 !important; color:#0f172a !important; }
        .theme-light select option{ background:#ffffff; }
        .theme-light ::-webkit-scrollbar-thumb{ background:#cbd5e1; }
        /* fonds */
        .theme-light .bg-slate-950{ background-color:#f1f5f9 !important; }
        .theme-light .bg-slate-900{ background-color:#ffffff !important; }
        .theme-light .bg-slate-800{ background-color:#e2e8f0 !important; }
        .theme-light .bg-slate-700{ background-color:#cbd5e1 !important; }
        /* dégradé de l'encart total */
        .theme-light .from-slate-900{ --tw-gradient-from:#ffffff var(--tw-gradient-from-position) !important; --tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to) !important; }
        .theme-light .to-slate-900\\/40{ --tw-gradient-to:rgba(241,245,249,0.6) var(--tw-gradient-to-position) !important; }
        /* textes (du plus clair au plus sombre en dark → inversion) */
        .theme-light .text-slate-50,
        .theme-light .text-slate-100,
        .theme-light .text-slate-200{ color:#0f172a !important; }
        .theme-light .text-slate-300{ color:#334155 !important; }
        .theme-light .text-slate-400{ color:#475569 !important; }
        .theme-light .text-slate-500{ color:#64748b !important; }
        .theme-light .text-slate-600{ color:#94a3b8 !important; }
        /* bordures */
        .theme-light .border-slate-800{ border-color:#e2e8f0 !important; }
        .theme-light .border-slate-700{ border-color:#cbd5e1 !important; }
        .theme-light .border-slate-600{ border-color:#94a3b8 !important; }
        .theme-light .border-slate-500{ border-color:#64748b !important; }
        .theme-light .divide-slate-800 > * + *{ border-color:#e2e8f0 !important; }
        /* hovers */
        .theme-light .hover\\:bg-slate-800:hover{ background-color:#e2e8f0 !important; }
        .theme-light .hover\\:border-slate-600:hover{ border-color:#94a3b8 !important; }
        .theme-light .hover\\:border-slate-500:hover{ border-color:#64748b !important; }
      `}</style>
      <input ref={fileRef} type="file" accept=".csv,.ofx,.qfx,.qif,text/csv" hidden
        onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ""; }} />
      <input ref={jsonRef} type="file" accept=".json,application/json" hidden
        onChange={(e) => { if (e.target.files?.[0]) importJSONFile(e.target.files[0]); e.target.value = ""; }} />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">

        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-400">
              <Wallet size={18} />
              <span className="text-xs font-semibold uppercase tracking-[0.25em]">Ardoise</span>
            </div>
            <h1 className="mt-1 text-sm text-slate-400">Suivi de dépenses · {monthLabel(month)}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (showForecast) { setShowForecast(false); } else { setShowYear((v) => !v); } }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${showYear && !showForecast ? "border-emerald-500 text-emerald-400" : "border-slate-800 text-slate-400 hover:border-slate-600"}`}
            >
              <BarChart2 size={14} /> {showYear && !showForecast ? "Vue mois" : showForecast ? "Vue mois" : "Vue année"}
            </button>
            <button
              onClick={() => { setShowForecast((v) => !v); setShowYear(false); }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${showForecast ? "border-emerald-500 text-emerald-400" : "border-slate-800 text-slate-400 hover:border-slate-600"}`}
            >
              <ClipboardList size={14} /> Prévis.
            </button>
            {!showYear && !showForecast && (
              <>
                <Calendar size={15} className="text-slate-500" />
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500"
                >
                  {months.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
              </>
            )}
            {installPrompt && !installed && (
              <button
                onClick={doInstall}
                title="Installer l'application"
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500 px-3 py-1.5 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/10"
              >
                <Download size={14} /> Installer
              </button>
            )}
            <button
              onClick={() => setTheme((t) => { const next = t === "dark" ? "light" : "dark"; storage.set("theme", next); return next; })}
              title={theme === "dark" ? "Thème clair" : "Thème sombre"}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              title="Paramètres"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
            >
              <Settings size={15} />
            </button>
          </div>
        </header>

        {backupDue && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
            <span className="flex items-center gap-2"><Download size={15} className="shrink-0" /> Pense à sauvegarder tes données (export JSON) — elles ne sont stockées que dans ce navigateur.</span>
            <span className="flex items-center gap-2">
              <button onClick={exportJSON} className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400">Sauvegarder</button>
              <button onClick={() => setBackupHidden(true)} className="text-sky-400/70 hover:text-sky-300"><X size={16} /></button>
            </span>
          </div>
        )}

        {showForecast && (
          <ForecastView
            people={forecastPeople} items={forecastItems}
            onChangePeople={setForecastPeople} onChangeItems={setForecastItems}
          />
        )}

        {!showForecast && <><section className="mb-6 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-900/40 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-500">Dépensé ce mois</p>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-slate-50 sm:text-5xl">
                {fmtEUR.format(monthTotal)}
              </p>
            </div>
            {delta !== null && (
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${delta > 0 ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                {delta > 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                {delta > 0 ? "+" : ""}{delta.toFixed(0)} % vs {monthLabel(prevMonth).split(" ")[0]}
              </div>
            )}
          </div>

          {monthTotal > 0 && (
            <div className="mt-5">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                {byCat.map((c) => (
                  <div key={c.id} title={`${c.label} · ${fmtEUR.format(c.value)}`}
                    style={{ width: `${(c.value / monthTotal) * 100}%`, background: c.color }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {byCat.slice(0, 6).map((c) => {
                  const budget = budgets[c.id];
                  const over = budget > 0 && c.value > budget;
                  return (
                    <span key={c.id} className="flex items-center gap-1.5 text-xs text-slate-400">
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                      {c.label}
                      <span className="font-mono text-slate-500">{Math.round((c.value / monthTotal) * 100)}%</span>
                      {over && <AlertTriangle size={11} className="text-amber-400" title={`Budget dépassé (${fmtEUR.format(budget)})`} />}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {(() => {
          const withBudget = cats.filter((c) => budgets[c.id] > 0 && !c.excludeFromTotal);
          if (!withBudget.length) return null;
          return (
            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <button className="mb-3 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300"
                onClick={() => setShowBudgets((v) => { const nv = !v; storage.set("ui:budgets", nv ? "1" : "0"); return nv; })}>
                <span className="flex items-center gap-2"><Wallet size={15} className="text-emerald-400" /> Budgets du mois</span>
                <ChevronRight size={14} className={`text-slate-500 transition-transform ${showBudgets ? "rotate-90" : ""}`} />
              </button>
              {showBudgets && (
                <ul className="space-y-2.5">
                  {withBudget.map((c) => {
                    const spent = byCat.find((b) => b.id === c.id)?.value || 0;
                    const budget = budgets[c.id];
                    const pct = Math.min(100, (spent / budget) * 100);
                    const over = spent > budget;
                    const near = !over && spent > budget * 0.8;
                    const barColor = over ? "#F87171" : near ? "#FBBF24" : c.color;
                    return (
                      <li key={c.id}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-slate-300"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}</span>
                          <span className={`font-mono ${over ? "text-rose-400" : "text-slate-400"}`}>{fmtEUR.format(spent)} / {fmtEUR.format(budget)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })()}

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Dépensé ce mois" value={fmtEUR.format(monthTotal)} mono color="#F87171" />
          <Stat label="Gagné ce mois" value={fmtEUR.format(monthIncome)} mono color="#34D399" />
          <Stat label="Moyenne / jour" value={fmtEUR.format(monthTotal / daysElapsed)} />
          <Stat label="Nombre d'achats" value={monthExp.filter((e) => !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).length} mono />
          <Stat
            label="Poste principal"
            value={topCat ? topCat.label : "—"}
            sub={topCat ? fmtEUR.format(topCat.value) : null}
            color={topCat?.color}
          />
        </section>

        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
            <div className="col-span-2 sm:col-span-3">
              <Field label="Montant (€)">
                <input
                  inputMode="decimal" placeholder="0,00" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addExpense()}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-lg text-slate-100 outline-none focus:border-emerald-500"
                />
              </Field>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <Field label="Libellé">
                <input
                  placeholder="Courses, essence…" value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addExpense()}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
                />
              </Field>
            </div>
            <div className="col-span-1 sm:col-span-3">
              <Field label="Catégorie">
                <select value={catId} onChange={(e) => setCatId(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500">
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <Field label="Date">
                <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={addExpense}
              className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
              <Plus size={16} /> Ajouter la dépense
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100">
              <Upload size={15} /> Importer un relevé (CSV)
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100">
              <Download size={15} /> Exporter
            </button>
          </div>
        </section>

        {showYear ? (
          <YearView expenses={expenses} year={month.slice(0, 4)} cats={cats} catById={catById} />
        ) : empty ? (
          <EmptyState />
        ) : (
          <>
            <section className="mb-6 grid items-start gap-4 lg:grid-cols-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-2">
                <button className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300" onClick={() => setShowPiePanel((v) => !v)}>
                  <span className="flex items-center gap-2"><PieIcon size={15} className="text-emerald-400" /> Répartition du mois</span>
                  <ChevronRight size={14} className={`text-slate-500 transition-transform ${showPiePanel ? "rotate-90" : ""}`} />
                </button>
                {showPiePanel && (byCat.length ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative h-56 w-56 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={byCat} dataKey="value" nameKey="label" innerRadius={68} outerRadius={100} paddingAngle={2} stroke="none"
                            onClick={(d) => setFilterCat((f) => f === d.id ? "all" : d.id)}>
                            {byCat.map((c) => (
                              <Cell key={c.id} fill={c.color}
                                opacity={filterCat === "all" || filterCat === c.id ? 1 : 0.3}
                                style={{ cursor: "pointer" }} />
                            ))}
                          </Pie>
                          <Tooltip content={<DonutTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-mono text-sm font-semibold text-slate-100">{fmtShort(monthTotal)}</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">total</span>
                      </div>
                    </div>
                    <ul className="w-full space-y-1 text-sm">
                      {byCat.map((c) => (
                        <li key={c.id}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 transition-colors ${filterCat === c.id ? "bg-slate-700" : "hover:bg-slate-800"}`}
                          onClick={() => setFilterCat((f) => f === c.id ? "all" : c.id)}>
                          <span className="flex items-center gap-2 text-slate-300">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                            {c.label}
                          </span>
                          <span className="font-mono text-slate-400">{fmtEUR.format(c.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="py-10 text-center text-sm text-slate-500">Aucune dépense ce mois-ci.</p>)}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-3">
                <button className="mb-3 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300" onClick={() => setShowBarPanel((v) => !v)}>
                  <span>Évolution sur 12 mois</span>
                  <ChevronRight size={14} className={`text-slate-500 transition-transform ${showBarPanel ? "rotate-90" : ""}`} />
                </button>
                {showBarPanel && <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                      <XAxis dataKey="lbl" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtShort} width={56} />
                      <Tooltip content={<BarTip />} cursor={{ fill: "#1e293b66" }} />
                      <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                        {series.map((s) => <Cell key={s.ym} fill={s.cur ? "#34D399" : "#334155"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>}
              </div>
            </section>

            <section className="mb-6 grid items-start gap-4 sm:grid-cols-2">
              {/* Épargne du mois */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <button className="mb-3 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300" onClick={() => setShowSavings((v) => !v)}>
                  <span className="flex items-center gap-2"><TrendingUp size={15} className="text-emerald-400" /> Épargne du mois</span>
                  <ChevronRight size={14} className={`text-slate-500 transition-transform ${showSavings ? "rotate-90" : ""}`} />
                </button>
                {showSavings && (
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center justify-between"><span className="text-slate-400">Épargne livrets <span className="text-slate-600">(inter-comptes)</span></span><span className={`font-mono ${monthSavings >= 0 ? "text-slate-200" : "text-amber-400"}`}>{fmtEUR.format(monthSavings)}</span></li>
                    {hasInvest && (
                      <li className="flex items-center justify-between"><span className="text-slate-400">Investissement <span className="text-slate-600">(PEA, bourse…)</span></span><span className={`font-mono ${monthInvest >= 0 ? "text-slate-200" : "text-amber-400"}`}>{fmtEUR.format(monthInvest)}</span></li>
                    )}
                    <li className="flex items-center justify-between border-t border-slate-800 pt-2"><span className="text-slate-400">Non dépensé <span className="text-slate-600">(gagné − dépensé)</span></span><span className={`font-mono ${monthIncome - monthTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtEUR.format(monthIncome - monthTotal)}</span></li>
                    <li className="flex items-center justify-between"><span className="text-slate-400">Taux d'épargne</span><span className="font-mono text-slate-200">{savingsRate != null ? `${Math.round(savingsRate)} %` : "—"}</span></li>
                  </ul>
                )}
              </div>
              {/* Insights */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <button className="mb-3 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300" onClick={() => setShowInsights((v) => !v)}>
                  <span className="flex items-center gap-2"><BarChart2 size={15} className="text-emerald-400" /> Variations vs mois dernier</span>
                  <ChevronRight size={14} className={`text-slate-500 transition-transform ${showInsights ? "rotate-90" : ""}`} />
                </button>
                {showInsights && (
                  insights.length ? (
                    <ul className="space-y-1.5 text-sm">
                      {insights.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-slate-300"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.cat.color }} />{r.cat.label}</span>
                          <span className={`flex items-center gap-1 font-mono ${r.diff > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                            {r.diff > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {r.diff > 0 ? "+" : "−"}{fmtEUR.format(Math.abs(r.diff))}
                            {r.pct != null && <span className="text-slate-500">({r.pct > 0 ? "+" : ""}{Math.round(r.pct)}%)</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="py-4 text-center text-xs text-slate-600">Pas de variation notable.</p>
                )}
              </div>
            </section>

            {recurring.length > 0 && (
              <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <button className="mb-3 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300" onClick={() => setShowRecurring((v) => !v)}>
                  <span className="flex items-center gap-2"><Repeat size={15} className="text-emerald-400" /> Dépenses récurrentes ({recurring.length})</span>
                  <ChevronRight size={14} className={`text-slate-500 transition-transform ${showRecurring ? "rotate-90" : ""}`} />
                </button>
                {showRecurring && (
                  <ul className="space-y-1.5 text-sm">
                    {recurring.map((r) => {
                      const cat = catById[r.catId] || { label: r.catId, color: "#94A3B8" };
                      return (
                        <li key={r.pattern} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 text-slate-300">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
                            <span className="truncate">{r.label}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs">
                            <span className="rounded-full px-2 py-0.5" style={{ background: cat.color + "22", color: cat.color }}>{cat.label}</span>
                            <span className="text-slate-500">{r.months} mois</span>
                            {r.changed && <span title="Montant récent différent de la moyenne" className="text-amber-400">≠</span>}
                            <span className="font-mono text-slate-300">{fmtEUR.format(r.last)}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              {(() => {
                const toReview = expenses.filter((e) => e.needsReview);
                return toReview.length > 0 && (
                  <button
                    onClick={() => setReviewMode(true)}
                    className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-300 hover:bg-amber-500/20 transition"
                  >
                    <AlertTriangle size={14} className="shrink-0" />
                    <span><strong>{toReview.length}</strong> dépense{toReview.length > 1 ? "s" : ""} sans catégorie claire (tous mois) — clique pour les catégoriser</span>
                  </button>
                );
              })()}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-slate-300">{visible.length} dépense(s)</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5">
                    <Search size={14} className="text-slate-500" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher"
                      className="w-28 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600" />
                  </div>
                  <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500">
                    <option value="all">Toutes catégories</option>
                    <option value="__review__">⚠ À catégoriser</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <ul className="divide-y divide-slate-800/70">
                {visible.map((e) => {
                  const c = catById[e.categoryId] || { label: "Autre", color: "#94A3B8", id: "autre" };
                  return (
                    <li key={e.id} className={`group flex items-center gap-3 py-2.5 ${e.needsReview ? "rounded-lg px-2 -mx-2 bg-amber-500/5" : ""}`}>
                      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: c.color + "22", color: c.color }}>
                        <CatIcon id={c.id} size={17} />
                        {e.needsReview && (
                          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500">
                            <AlertTriangle size={8} className="text-slate-950" />
                          </span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-200">{e.label}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(e.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                          {" · "}
                          {editCatId === e.id ? (
                            <select
                              autoFocus
                              value={e.categoryId}
                              onChange={(ev) => { updateCat(e.id, ev.target.value); setEditCatId(null); }}
                              onBlur={() => setEditCatId(null)}
                              className="rounded border border-slate-700 bg-slate-800 px-1 text-xs text-slate-200 outline-none"
                            >
                              {cats.map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
                            </select>
                          ) : (
                            <button
                              onClick={() => setEditCatId(e.id)}
                              className={`underline decoration-dotted underline-offset-2 hover:text-slate-300 ${e.needsReview ? "text-amber-400" : ""}`}
                            >
                              {e.needsReview ? "À catégoriser" : c.label}
                            </button>
                          )}
                        </p>
                      </div>
                      {catById[e.categoryId]?.excludeFromTotal && (
                        <span className="rounded px-1.5 py-0.5 text-xs text-slate-500 border border-slate-700">non compté</span>
                      )}
                      <span className={`font-mono text-sm tabular-nums ${catById[e.categoryId]?.excludeFromTotal ? "text-slate-500" : e.isCredit ? "text-emerald-400" : "text-rose-400"}`}>
                        {e.isCredit ? "+" : "−"}{fmtEUR.format(e.amount)}
                      </span>
                      <button onClick={() => setEditExpense(e)}
                        className="text-slate-600 opacity-0 transition group-hover:opacity-100 hover:text-emerald-400">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => removeExpense(e.id)}
                        className="text-slate-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-400">
                        <Trash2 size={16} />
                      </button>
                    </li>
                  );
                })}
                {!visible.length && <li className="py-8 text-center text-sm text-slate-500">Rien à afficher.</li>}
              </ul>
            </section>
          </>
        )}

        <p className="mt-6 text-center text-xs text-slate-600">
          Données stockées localement dans ton navigateur · {expenses.length} dépense(s) au total
        </p></>}

      </div>

      {showSettings && (
        <SettingsPanel
          cats={cats} byCat={byCat} budgets={budgets} rules={rules} expenses={expenses}
          onAddCat={addCat} onRemoveCat={removeCat} onUpdateCat={updateCatDef}
          onSetBudget={setCatBudget}
          onChangeRules={(newRules) => setRules(newRules)}
          onExportJSON={exportJSON}
          onImportJSON={() => jsonRef.current?.click()}
          onReset={resetData} onClose={() => setShowSettings(false)}
        />
      )}
      {reviewMode && (
        <ReviewQueue
          items={expenses.filter((e) => e.needsReview)}
          cats={cats} catById={catById}
          onPick={updateCat}
          onClose={() => setReviewMode(false)}
        />
      )}
      {editExpense && (
        <EditExpenseModal expense={editExpense} cats={cats} onSave={(patch) => { updateExpense(editExpense.id, { ...patch, manualCat: true }); setEditExpense(null); }} onClose={() => setEditExpense(null)} />
      )}
      {undo && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-200 shadow-lg">
            <span>{undo.label}</span>
            <button
              onClick={() => { setExpenses(undo.snapshot); setUndo(null); }}
              className="flex items-center gap-1 font-semibold text-emerald-400 hover:text-emerald-300"
            >
              <RotateCcw size={14} /> Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- ReviewQueue — file de revue plein écran des dépenses à catégoriser */

function ReviewQueue({ items, cats, catById, onPick, onClose }) {
  const cur = items[0];
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-slate-950/95 p-4">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <ClipboardList size={15} className="text-amber-400" /> À catégoriser
            {items.length > 0 && <span className="text-slate-500">· {items.length} restante{items.length > 1 ? "s" : ""}</span>}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={20} /></button>
        </div>
        {cur ? (
          <div className="flex flex-1 flex-col">
            <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
              <p className="text-lg font-medium text-slate-100">{cur.label}</p>
              <p className="mt-1 text-sm text-slate-500">{new Date(cur.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
              <p className={`mt-3 font-mono text-2xl font-semibold ${cur.isCredit ? "text-emerald-400" : "text-rose-400"}`}>{cur.isCredit ? "+" : "−"}{fmtEUR.format(cur.amount)}</p>
            </div>
            <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Choisis une catégorie</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cats.filter((c) => c.id !== "autre").map((c) => (
                <button key={c.id} onClick={() => onPick(cur.id, c.id)}
                  className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-200 transition hover:border-slate-600 hover:bg-slate-800">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate">{c.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => onPick(cur.id, "autre")} className="mt-3 text-center text-xs text-slate-500 hover:text-slate-300">Laisser en « Autre »</button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"><Check size={32} /></div>
            <p className="text-lg font-medium text-slate-200">Tout est catégorisé 🎉</p>
            <button onClick={onClose} className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Revenir à la vue classique</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- NumInput — input numérique sans spinner, stable pendant la saisie décimale */

function NumInput({ value, onCommit, className, min, max, step }) {
  const fmt = (v) => String(v ?? "").replace(".", ",");
  const parse = (s) => parseFloat(String(s).replace(",", ".")) || 0;

  const [local, setLocal] = useState(fmt(value));
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setLocal(fmt(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      value={local}
      onChange={(e) => setLocal(e.target.value.replace(".", ","))}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; onCommit(String(parse(local))); setLocal(fmt(parse(local))); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
    />
  );
}

/* ---------------------------------------------------------------- ForecastView */

function ForecastView({ people, items, onChangePeople, onChangeItems }) {
  const [newLabel, setNewLabel] = useState("");
  const [editingPerson, setEditingPerson] = useState(null);
  const [editingPersonName, setEditingPersonName] = useState("");

  const fmtEUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

  const personAmount = (item, pid) => (parseFloat(item.total) || 0) * (parseFloat(item.pcts?.[pid]) || 0) / 100;
  const totalPerson = (pid) => items.reduce((s, it) => s + personAmount(it, pid), 0);
  const grandTotal = items.reduce((s, it) => s + (parseFloat(it.total) || 0), 0);

  // Quand le % d'une personne change, les autres sont ajustés proportionnellement pour rester à 100 %
  const applyPct = (it, pid, pct) => {
    const others = people.filter((p) => p.id !== pid);
    if (others.length === 0) return { ...it, pcts: { ...it.pcts, [pid]: pct } };
    const remaining = 100 - pct;
    const othersSum = others.reduce((s, p) => s + (parseFloat(it.pcts?.[p.id]) || 0), 0);
    const newPcts = { ...it.pcts, [pid]: pct };
    others.forEach((p) => {
      const ratio = othersSum > 0 ? (parseFloat(it.pcts?.[p.id]) || 0) / othersSum : 1 / others.length;
      newPcts[p.id] = Math.round(ratio * remaining * 100) / 100;
    });
    return { ...it, pcts: newPcts };
  };

  const updateTotal = (itemId, val) =>
    onChangeItems(items.map((it) => it.id === itemId ? { ...it, total: val === "" ? "" : parseFloat(val) || 0 } : it));

  const updatePct = (itemId, pid, val) =>
    onChangeItems(items.map((it) => it.id === itemId ? applyPct(it, pid, val === "" ? 0 : parseFloat(val) || 0) : it));

  const updateAmount = (itemId, pid, val) =>
    onChangeItems(items.map((it) => {
      if (it.id !== itemId) return it;
      const amount = val === "" ? 0 : parseFloat(val) || 0;
      const total = parseFloat(it.total) || 0;
      if (total > 0) {
        // Total fixe : on dérive le % depuis le montant saisi, le total ne bouge pas
        const pct = Math.min(100, Math.max(0, Math.round((amount / total) * 10000) / 100));
        return applyPct(it, pid, pct);
      }
      // Total non défini : on le calcule depuis le montant et le % existant
      const existingPct = parseFloat(it.pcts?.[pid]) || 0;
      if (existingPct > 0) {
        const newTotal = Math.round((amount / (existingPct / 100)) * 100) / 100;
        return { ...it, total: newTotal };
      }
      return applyPct({ ...it, total: amount }, pid, 100);
    }));

  const addItem = () => {
    if (!newLabel.trim()) return;
    const pcts = {};
    const share = people.length ? Math.round(100 / people.length) : 0;
    people.forEach((p, i) => (pcts[p.id] = i === people.length - 1 ? 100 - share * (people.length - 1) : share));
    onChangeItems([...items, { id: Date.now().toString(36), label: newLabel.trim(), total: 0, pcts }]);
    setNewLabel("");
  };

  const removeItem = (id) => onChangeItems(items.filter((it) => it.id !== id));

  const addPerson = () => {
    const id = "p" + Date.now().toString(36);
    onChangePeople([...people, { id, name: "Nouveau" }]);
    onChangeItems(items.map((it) => ({ ...it, pcts: { ...it.pcts, [id]: 0 } })));
  };

  const removePerson = (pid) => {
    onChangePeople(people.filter((p) => p.id !== pid));
    onChangeItems(items.map((it) => { const p = { ...it.pcts }; delete p[pid]; return { ...it, pcts: p }; }));
  };

  const renamePerson = (pid, name) =>
    onChangePeople(people.map((p) => p.id === pid ? { ...p, name } : p));

  const inputCls = (color) =>
    `w-20 rounded border bg-slate-950 px-2 py-1 text-right font-mono text-xs outline-none focus:border-emerald-500 ${color}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">Dépenses prévisionnelles</p>
          <p className="mt-0.5 font-mono text-3xl font-semibold tabular-nums text-slate-50">
            {fmtEUR.format(grandTotal)}<span className="ml-2 text-sm font-normal text-slate-500">/ mois</span>
          </p>
        </div>
        <button onClick={addPerson}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200">
          <UserPlus size={13} /> Ajouter une personne
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full min-w-max text-sm border-collapse">
          <thead>
            {/* Ligne 1 : noms des personnes sur 2 colonnes chacune */}
            <tr className="border-b border-slate-800">
              <th rowSpan={2} className="py-3 pl-4 pr-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500 border-r border-slate-800">Dépense</th>
              <th rowSpan={2} className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500 border-r border-slate-800">Prix total</th>
              {people.map((p, i) => (
                <th key={p.id} colSpan={2} className={`px-3 py-2 text-center text-xs font-medium uppercase tracking-wider text-slate-400 ${i < people.length - 1 ? "border-r border-slate-800" : ""}`}>
                  <div className="flex items-center justify-center gap-1.5">
                    {editingPerson === p.id ? (
                      <input autoFocus value={editingPersonName}
                        onChange={(e) => setEditingPersonName(e.target.value)}
                        onBlur={() => { renamePerson(p.id, editingPersonName || p.name); setEditingPerson(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { renamePerson(p.id, editingPersonName || p.name); setEditingPerson(null); } }}
                        className="w-20 rounded border border-emerald-600 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100 outline-none" />
                    ) : (
                      <button onClick={() => { setEditingPerson(p.id); setEditingPersonName(p.name); }}
                        className="flex items-center gap-1 hover:text-slate-200">
                        {p.name} <Pencil size={11} className="opacity-40" />
                      </button>
                    )}
                    {people.length > 1 && <button onClick={() => removePerson(p.id)} className="text-slate-700 hover:text-rose-400"><X size={13} /></button>}
                  </div>
                </th>
              ))}
              <th rowSpan={2} className="w-8" />
            </tr>
            {/* Ligne 2 : sous-colonnes % et € */}
            <tr className="border-b border-slate-800">
              {people.map((p, i) => (
                <React.Fragment key={p.id}>
                  <th className="px-2 py-1.5 text-center text-xs font-normal text-slate-600">%</th>
                  <th className={`px-2 py-1.5 text-center text-xs font-normal text-slate-600 ${i < people.length - 1 ? "border-r border-slate-800" : ""}`}>€</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {items.length === 0 && (
              <tr><td colSpan={2 + people.length * 2 + 1} className="py-10 text-center text-xs text-slate-600">Aucune dépense fixe. Ajoute une ligne ci-dessous.</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.id} className="group hover:bg-slate-800/30">
                <td className="py-2 pl-4 pr-3 font-medium text-slate-200 border-r border-slate-800">{item.label}</td>
                <td className="px-3 py-2 border-r border-slate-800">
                  <div className="flex items-center justify-end gap-1">
                    <NumInput min="0" step="0.01"
                      value={item.total ?? 0}
                      onCommit={(v) => updateTotal(item.id, v)}
                      className={inputCls("border-slate-700 text-slate-200")} />
                    <span className="text-xs text-slate-600">€</span>
                  </div>
                </td>
                {people.map((p, i) => (
                  <React.Fragment key={p.id}>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <NumInput min="0" max="100" step="0.01"
                          value={Math.round((parseFloat(item.pcts?.[p.id]) || 0) * 100) / 100}
                          onCommit={(v) => updatePct(item.id, p.id, v)}
                          className={inputCls("border-slate-700 text-slate-300")} />
                        <span className="text-xs text-slate-600">%</span>
                      </div>
                    </td>
                    <td className={`px-2 py-2 ${i < people.length - 1 ? "border-r border-slate-800" : ""}`}>
                      <div className="flex items-center gap-1">
                        <NumInput min="0" step="0.01"
                          value={Math.round(personAmount(item, p.id) * 100) / 100}
                          onCommit={(v) => updateAmount(item.id, p.id, v)}
                          className={inputCls("border-slate-700 text-emerald-400")} />
                        <span className="text-xs text-slate-600">€</span>
                      </div>
                    </td>
                  </React.Fragment>
                ))}
                <td className="px-2 py-2">
                  <button onClick={() => removeItem(item.id)} className="text-slate-700 opacity-0 transition group-hover:opacity-100 hover:text-rose-400">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-700">
            <tr className="bg-slate-900/80">
              <td className="py-3 pl-4 pr-3 text-xs font-semibold uppercase tracking-wider text-slate-400 border-r border-slate-800">Total</td>
              <td className="px-3 py-3 text-right font-mono font-semibold text-slate-200 tabular-nums border-r border-slate-800">{fmtEUR.format(grandTotal)}</td>
              {people.map((p, i) => (
                <React.Fragment key={p.id}>
                  <td className="px-2 py-3" />
                  <td className={`px-2 py-3 text-right font-mono font-semibold text-emerald-400 tabular-nums ${i < people.length - 1 ? "border-r border-slate-800" : ""}`}>
                    {fmtEUR.format(totalPerson(p.id))}
                  </td>
                </React.Fragment>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Ajouter une ligne */}
      <div className="flex gap-2">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Nouvelle dépense fixe (ex : Loyer, EDF…)"
          className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
        <button onClick={addItem} disabled={!newLabel.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40">
          <Plus size={15} /> Ajouter
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- sous-composants */

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, mono, color }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold text-slate-100 ${mono ? "font-mono" : ""}`}
        style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="font-mono text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function DonutTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl">
      <span className="font-medium text-slate-200">{p.label}</span>
      <span className="ml-2 font-mono text-slate-400">{fmtEUR.format(p.value)}</span>
    </div>
  );
}
function BarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-xl">
      <span className="text-slate-400">{label} · </span>
      <span className="font-mono text-slate-100">{fmtEUR.format(payload[0].value)}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
        <Wallet size={22} />
      </div>
      <h3 className="text-base font-medium text-slate-200">Commence ton ardoise</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
        Ajoute ta première dépense ci-dessus ou importe un relevé bancaire au format CSV.
      </p>
    </section>
  );
}

function SettingsPanel({ cats, rules, budgets, expenses = [], onAddCat, onRemoveCat, onUpdateCat, onSetBudget, onChangeRules, onExportJSON, onImportJSON, onReset, onClose }) {
  const [tab, setTab] = useState("categories");
  // catégories
  const [lbl, setLbl] = useState("");
  const [color, setColor] = useState(() => pickColor(cats.map((c) => c.color)));
  const [editCat, setEditCat] = useState(null); // {id, label, color}
  // règles
  const [pattern, setPattern] = useState("");
  const [ruleCatId, setRuleCatId] = useState(cats[0]?.id || "autre");
  const [editRuleIdx, setEditRuleIdx] = useState(null); // index en cours d'édition
  const [editRulePattern, setEditRulePattern] = useState("");
  const [editRuleCatId, setEditRuleCatId] = useState("");

  const TABS = [
    { id: "categories", label: "Catégories" },
    { id: "budgets", label: "Budgets" },
    { id: "rules", label: "Règles" },
    { id: "data", label: "Données" },
  ];

  const saveEditCat = () => {
    if (!editCat) return;
    onUpdateCat(editCat.id, { label: editCat.label, color: editCat.color });
    setEditCat(null);
  };

  const saveEditRule = () => {
    if (editRuleIdx === null) return;
    const updated = rules.map((r, i) => i === editRuleIdx ? { pattern: editRulePattern, categoryId: editRuleCatId } : r);
    onChangeRules(updated);
    setEditRuleIdx(null);
  };

  // Mots-clés regroupés par catégorie (une "ligne" de mots-clés par catégorie).
  const keywordsByCat = {};
  for (const r of rules) {
    if (!r.pattern) continue;
    for (const w of r.pattern.split(/\s+/).filter(Boolean)) {
      (keywordsByCat[r.categoryId] ||= []);
      if (!keywordsByCat[r.categoryId].includes(w)) keywordsByCat[r.categoryId].push(w);
    }
  }
  const rebuildRules = (map) =>
    Object.entries(map).filter(([, ws]) => ws.length).map(([categoryId, ws]) => ({ pattern: ws.join(" "), categoryId }));
  const addKeyword = (categoryId, kw) => {
    const w = kw.trim().toLowerCase();
    if (!w) return;
    const map = {};
    // retire le mot de toutes les catégories (pas de doublon inter-catégories)
    for (const [cid, ws] of Object.entries(keywordsByCat)) map[cid] = ws.filter((x) => x !== w);
    (map[categoryId] ||= []).push(w);
    onChangeRules(rebuildRules(map));
  };
  const removeKeyword = (categoryId, kw) => {
    const map = {};
    for (const [cid, ws] of Object.entries(keywordsByCat)) map[cid] = cid === categoryId ? ws.filter((x) => x !== kw) : [...ws];
    onChangeRules(rebuildRules(map));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl border border-slate-800 bg-slate-900 p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>

        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Settings size={14} className="text-slate-400" /> Paramètres
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={18} /></button>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${tab === t.id ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Catégories */}
        {tab === "categories" && (
          <>
            <ul className="mb-3 max-h-56 space-y-1 overflow-y-auto">
              {cats.map((c) => (
                <li key={c.id} className="rounded-lg border border-transparent hover:border-slate-800 hover:bg-slate-800/30">
                  {editCat?.id === c.id ? (
                    /* Mode édition */
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <input type="color" value={editCat.color}
                        onChange={(e) => setEditCat((x) => ({ ...x, color: e.target.value }))}
                        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent" />
                      <input autoFocus value={editCat.label}
                        onChange={(e) => setEditCat((x) => ({ ...x, label: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEditCat(); if (e.key === "Escape") setEditCat(null); }}
                        className="flex-1 rounded border border-emerald-600 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none" />
                      <button onClick={saveEditCat} className="text-emerald-400 hover:text-emerald-300"><Check size={15} /></button>
                      <button onClick={() => setEditCat(null)} className="text-slate-500 hover:text-slate-300"><X size={15} /></button>
                    </div>
                  ) : (
                    /* Mode affichage */
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="flex-1 text-sm text-slate-200">{c.label}</span>
                      <button onClick={() => setEditCat({ id: c.id, label: c.label, color: c.color })}
                        className="text-slate-600 hover:text-slate-300"><Pencil size={14} /></button>
                      {!c.builtin && (
                        <button onClick={() => onRemoveCat(c.id)} className="text-slate-600 hover:text-rose-400"><Trash2 size={14} /></button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-700 bg-transparent" />
              <input value={lbl} onChange={(e) => setLbl(e.target.value)} placeholder="Nouvelle catégorie"
                onKeyDown={(e) => { if (e.key === "Enter" && lbl.trim()) { onAddCat(lbl.trim(), color); setLbl(""); setColor(pickColor([...cats.map((c) => c.color), color])); } }}
                className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
              <button disabled={!lbl.trim()} onClick={() => { onAddCat(lbl.trim(), color); setLbl(""); setColor(pickColor([...cats.map((c) => c.color), color])); }}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40">
                <Plus size={16} />
              </button>
            </div>
          </>
        )}

        {/* Budgets */}
        {tab === "budgets" && (
          <>
            <p className="mb-3 text-xs text-slate-500">Budget mensuel par catégorie. Laisse vide (0) pour aucun budget. Une barre de progression apparaît sur l'accueil.</p>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {cats.filter((c) => !c.excludeFromTotal).map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 truncate text-sm text-slate-200">{c.label}</span>
                  <NumInput
                    value={budgets[c.id] || ""}
                    onCommit={(v) => onSetBudget(c.id, parseFloat(v) > 0 ? parseFloat(v) : 0)}
                    className="w-24 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-right font-mono text-sm text-slate-100 outline-none focus:border-emerald-500" />
                  <span className="text-xs text-slate-500">€</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Règles — un jeu de mots-clés par catégorie (pas de doublon inter-catégories) */}
        {tab === "rules" && (
          <>
            <p className="mb-3 text-xs text-slate-500">Un mot-clé présent dans le libellé applique la catégorie à l'import. Un même mot-clé ne peut appartenir qu'à une seule catégorie.</p>
            <ul className="mb-3 max-h-60 space-y-2 overflow-y-auto">
              {cats.filter((c) => (keywordsByCat[c.id] || []).length).map((c) => {
                const kws = keywordsByCat[c.id];
                const matchCount = expenses.filter((e) => kws.some((w) => ruleMatchesLabel(e.label, w))).length;
                return (
                  <li key={c.id} className="rounded-lg border border-slate-800 p-2">
                    <div className="mb-1.5 flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      <span className="font-medium text-slate-200">{c.label}</span>
                      <span className="text-slate-500">· {matchCount} dépense{matchCount > 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {kws.map((w) => (
                        <span key={w} className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-200">
                          {w}
                          <button onClick={() => removeKeyword(c.id, w)} className="text-slate-500 hover:text-rose-400"><X size={11} /></button>
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
              {rules.length === 0 && <li className="py-4 text-center text-xs text-slate-600">Aucun mot-clé personnalisé.</li>}
            </ul>
            <div className="flex gap-2">
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="nouveau mot-clé"
                onKeyDown={(e) => { if (e.key === "Enter" && pattern.trim()) { addKeyword(ruleCatId, pattern); setPattern(""); } }}
                className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
              <select value={ruleCatId} onChange={(e) => setRuleCatId(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button disabled={!pattern.trim()} onClick={() => { addKeyword(ruleCatId, pattern); setPattern(""); }}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40">
                <Plus size={16} />
              </button>
            </div>
          </>
        )}

        {/* Données */}
        {tab === "data" && (
          <div className="space-y-3">
            <button onClick={onExportJSON}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100">
              <FileJson size={16} className="shrink-0 text-slate-400" />
              <div className="text-left">
                <p className="font-medium">Sauvegarder (JSON)</p>
                <p className="text-xs text-slate-500">Exporte toutes les dépenses, catégories et règles</p>
              </div>
            </button>
            <button onClick={onImportJSON}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100">
              <FileJson size={16} className="shrink-0 text-slate-400" />
              <div className="text-left">
                <p className="font-medium">Restaurer (JSON)</p>
                <p className="text-xs text-slate-500">Remplace les données actuelles par une sauvegarde</p>
              </div>
            </button>
            <div className="border-t border-slate-800 pt-3">
              <button onClick={onReset}
                className="flex w-full items-center gap-3 rounded-lg border border-rose-900 px-4 py-3 text-sm text-rose-400 transition hover:bg-rose-900/30">
                <RotateCcw size={16} className="shrink-0" />
                <div className="text-left">
                  <p className="font-medium">Remettre à zéro</p>
                  <p className="text-xs text-rose-500/70">Supprime toutes les données de l'application</p>
                </div>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function EditExpenseModal({ expense, cats, onSave, onClose }) {
  const [amount, setAmount] = useState(String(expense.amount));
  const [label, setLabel] = useState(expense.label);
  const [catId, setCatId] = useState(expense.categoryId);
  const [date, setDate] = useState(expense.date);

  const handleSave = () => {
    const a = parseFloat(String(amount).replace(",", "."));
    if (!a || a <= 0) return;
    onSave({ amount: Math.round(a * 100) / 100, label: label.trim() || expense.label, categoryId: catId, date });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl border border-slate-800 bg-slate-900 p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Modifier la dépense</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <Field label="Montant (€)">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-lg text-slate-100 outline-none focus:border-emerald-500" />
          </Field>
          <Field label="Libellé">
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Catégorie">
              <select value={catId} onChange={(e) => setCatId(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500">Annuler</button>
          <button onClick={handleSave} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            <Check size={15} /> Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

function YearView({ expenses, year, catById }) {
  const [selYear, setSelYear] = useState(+year);
  const [showCats, setShowCats] = useState(true);
  const [showMonths, setShowMonths] = useState(true);

  const inYear = expenses.filter((e) => e.date.startsWith(`${selYear}-`) && !catById[e.categoryId]?.excludeFromTotal);
  const displayMonths = Array.from({ length: 12 }, (_, i) => {
    const ym = `${selYear}-${String(i + 1).padStart(2, "0")}`;
    const total = inYear.filter((e) => !e.isCredit && e.date.startsWith(ym)).reduce((s, e) => s + e.amount, 0);
    return { ym, label: new Date(selYear, i, 1).toLocaleDateString("fr-FR", { month: "short" }), total };
  });
  const displayMax = Math.max(...displayMonths.map((m) => m.total), 1);
  const spentTotal = displayMonths.reduce((s, m) => s + m.total, 0);
  const incomeTotal = inYear.filter((e) => e.isCredit).reduce((s, e) => s + e.amount, 0);

  const catTotals = {};
  inYear.filter((e) => !e.isCredit).forEach((e) => (catTotals[e.categoryId] = (catTotals[e.categoryId] || 0) + e.amount));
  const yearCats = Object.entries(catTotals)
    .map(([id, value]) => ({ id, value, ...(catById[id] || { label: id, color: "#94A3B8" }) }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Récap annuel</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setSelYear((y) => y - 1)} className="text-slate-500 hover:text-slate-200"><ChevronLeft size={16} /></button>
          <span className="font-mono text-sm text-slate-200">{selYear}</span>
          <button onClick={() => setSelYear((y) => y + 1)} className="text-slate-500 hover:text-slate-200"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Dépensé</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-rose-400">{fmtEUR.format(spentTotal)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Gagné</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-400">{fmtEUR.format(incomeTotal)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Solde</p>
          <p className={`mt-0.5 font-mono text-sm font-semibold ${incomeTotal - spentTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtEUR.format(incomeTotal - spentTotal)}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-12 items-end gap-1" style={{ height: 120 }}>
        {displayMonths.map((m) => (
          <div key={m.ym} className="flex flex-col items-center gap-1">
            <div className="w-full rounded-t" style={{ height: `${(m.total / displayMax) * 100}%`, background: m.total ? "#34D399" : "#1e293b", minHeight: m.total ? 4 : 0 }}
              title={fmtEUR.format(m.total)} />
            <span className="text-[10px] text-slate-500">{m.label}</span>
          </div>
        ))}
      </div>

      {yearCats.length > 0 && (
        <div className="border-t border-slate-800 pt-4">
          <button onClick={() => setShowCats((v) => !v)} className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300">
            <span>Par catégorie</span>
            <ChevronRight size={14} className={`text-slate-500 transition-transform ${showCats ? "rotate-90" : ""}`} />
          </button>
          {showCats && (
            <ul className="mb-3">
              {yearCats.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-1 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 truncate text-slate-300">{c.label}</span>
                  <span className="font-mono text-slate-400">{fmtEUR.format(c.value)}</span>
                  <span className="w-10 text-right text-xs text-slate-600">{Math.round((c.value / spentTotal) * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="border-t border-slate-800 pt-4">
        <button onClick={() => setShowMonths((v) => !v)} className="mb-2 flex w-full items-center justify-between gap-2 text-sm font-medium text-slate-300">
          <span>Par mois</span>
          <ChevronRight size={14} className={`text-slate-500 transition-transform ${showMonths ? "rotate-90" : ""}`} />
        </button>
        {showMonths && (
          <table className="w-full text-sm">
            <tbody>
              {displayMonths.filter((m) => m.total > 0).map((m) => (
                <tr key={m.ym} className="border-b border-slate-800/50">
                  <td className="py-1.5 capitalize text-slate-400">{m.label}</td>
                  <td className="py-1.5 text-right font-mono text-slate-200">{fmtEUR.format(m.total)}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-3 font-medium text-slate-300">Total {selYear}</td>
                <td className="pt-3 text-right font-mono font-semibold text-emerald-400">{fmtEUR.format(spentTotal)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

