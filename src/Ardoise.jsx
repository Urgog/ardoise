import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Plus, Trash2, ShoppingCart, Home, Car, UtensilsCrossed, Gamepad2, HeartPulse,
  Repeat, ShoppingBag, MoreHorizontal, Tag, Upload, Download, X, TrendingDown,
  TrendingUp, Wallet, Calendar, Search, PieChart as PieIcon, Pencil, Check,
  FileJson, BarChart2, AlertTriangle, ChevronLeft, ChevronRight, BookOpen,
  Settings, RotateCcw, ClipboardList, UserPlus, Users,
} from "lucide-react";
import { storage } from "./lib/storage";
import { importBankCSV, importBankOFX, importBankQIF, guessCatWithRules, hasUserRuleMatch } from "./lib/importBank";

/* ---------------------------------------------------------------- utilitaires */

const KEY = "data";
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

/* ---------------------------------------------------------------- palette couleurs */

// Palette de 16 teintes bien réparties sur la roue chromatique
const PALETTE = [
  "#F87171", // rouge
  "#FB923C", // orange
  "#FBBF24", // ambre
  "#FDE047", // jaune
  "#4ADE80", // vert clair
  "#34D399", // émeraude
  "#2DD4BF", // teal
  "#38BDF8", // ciel
  "#60A5FA", // bleu
  "#818CF8", // indigo
  "#A78BFA", // violet
  "#C084FC", // violet clair
  "#E879F9", // fuchsia
  "#F472B6", // rose
  "#94A3B8", // ardoise (neutre)
  "#64748B", // ardoise foncé
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

// Retourne la couleur de la palette la plus éloignée des couleurs existantes
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
  const [budgets, setBudgets] = useState({});
  const [rules, setRules] = useState([]);
  const [forecastPeople, setForecastPeople] = useState([{ id: "p1", name: "Moi" }, { id: "p2", name: "Autre" }]);
  const [forecastItems, setForecastItems] = useState([]);
  const fileRef = useRef(null);
  const jsonRef = useRef(null);

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
        if (d.rules) setRules(d.rules);
        if (d.forecastPeople?.length) setForecastPeople(d.forecastPeople);
        if (d.forecastItems) setForecastItems(d.forecastItems);
      } catch { /* ignore */ }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    storage.set(KEY, JSON.stringify({ expenses, categories: cats, budgets, rules, forecastPeople, forecastItems }));
  }, [expenses, cats, budgets, rules, forecastPeople, forecastItems, loaded]);

  // Reclassifie les dépenses en "Autre" sans manualCat quand les règles changent ou au démarrage
  useEffect(() => {
    if (!loaded) return;
    setExpenses((prev) => prev.map((e) => {
      if (e.manualCat || e.categoryId !== "autre") return e;
      const categoryId = guessCatWithRules(e.label, rules);
      const needsReview = categoryId === "autre";
      return { ...e, categoryId, needsReview };
    }));
  }, [rules, loaded]);

  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);

  const months = useMemo(() => {
    const set = new Set(expenses.map((e) => monthOf(e.date)));
    set.add(monthOf(todayISO()));
    return [...set].sort().reverse();
  }, [expenses]);

  const monthExp = useMemo(
    () => expenses.filter((e) => monthOf(e.date) === month),
    [expenses, month]
  );
  const isTransfer = (e) => catById[e.categoryId]?.excludeFromTotal;
  const monthTotal = useMemo(() => monthExp.filter((e) => !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0), [monthExp, catById]);

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
      const total = expenses.filter((e) => monthOf(e.date) === ym && !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0);
      out.push({ ym, total, lbl: d.toLocaleDateString("fr-FR", { month: "short" }), cur: ym === month });
    }
    return out;
  }, [expenses, month]);

  const visible = useMemo(() => {
    return monthExp
      .filter((e) => filterCat === "all" ? true : filterCat === "__review__" ? e.needsReview : e.categoryId === filterCat)
      .filter((e) => !query || e.label.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [monthExp, filterCat, query]);

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

  const removeExpense = (id) => setExpenses((x) => x.filter((e) => e.id !== id));

  const resetData = () => {
    if (!window.confirm("Supprimer toutes les dépenses ? Les catégories, budgets et règles sont conservés. Cette action est irréversible.")) return;
    setExpenses([]);
  };

  const updateCat = (id, categoryId) => {
    // Marque la dépense comme catégorisée manuellement + apprend une règle automatiquement
    setExpenses((x) => x.map((e) => {
      if (e.id !== id) return e;
      // Apprentissage auto : extrait un pattern du libellé et ajoute une règle utilisateur
      const pattern = e.label.trim().toLowerCase()
        .replace(/^(vir(ement)?(\s+sepa)?|cb|prlv|prelevement|paiement|achat|retrait)\s+/i, "")
        .split(/\s+/).slice(0, 3).join(" ")
        .trim();
      if (pattern.length >= 3) {
        setRules((prev) => {
          const already = prev.findIndex((r) => r.pattern.toLowerCase() === pattern);
          if (already >= 0) {
            const updated = [...prev];
            updated[already] = { ...updated[already], categoryId };
            return updated;
          }
          return [...prev, { pattern, categoryId }];
        });
      }
      return { ...e, categoryId, manualCat: true, needsReview: false };
    }));
  };

  const updateExpense = (id, patch) =>
    setExpenses((x) => x.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const setCatBudget = (catId, value) =>
    setBudgets((b) => ({ ...b, [catId]: value }));

  const exportJSON = () => {
    const data = JSON.stringify({ expenses, categories: cats, budgets, rules }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ardoise-sauvegarde.json"; a.click();
    URL.revokeObjectURL(url);
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
        if (d.rules) setRules(d.rules);
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
      // applique les règles utilisateur par-dessus l'auto-cat
      parsed = parsed.map((e) => {
        const categoryId = guessCatWithRules(e.label, rules) || e.categoryId;
        const needsReview = categoryId === "autre" && !hasUserRuleMatch(e.label, rules);
        return { ...e, categoryId, ...(needsReview ? { needsReview: true } : {}) };
      });
      if (!parsed.length) {
        alert("Aucune dépense détectée. Vérifie que le fichier contient une colonne date et une colonne montant ou débit.");
        return;
      }
      setExpenses((x) => {
        const existing = new Set(x.map((e) => `${e.date}|${e.amount}|${e.label}`));
        const news = parsed.filter((e) => !existing.has(`${e.date}|${e.amount}|${e.label}`));
        const added = news.map((e) => ({ id: uid(), ...e }));
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
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 font-sans antialiased">
      <style>{`
        select option { background:#0f172a; }
        ::-webkit-scrollbar{height:8px;width:8px}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:8px}
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        input[type=number]{-moz-appearance:textfield}
      `}</style>

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
            <button
              onClick={() => setShowSettings(true)}
              title="Paramètres"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
            >
              <Settings size={15} />
            </button>
          </div>
        </header>

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

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Moyenne / jour" value={fmtEUR.format(monthTotal / daysElapsed)} />
          <Stat label="Nombre d'achats" value={monthExp.length} mono />
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
            <input ref={fileRef} type="file" accept=".csv,.ofx,.qfx,.qif,text/csv" hidden
              onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ""; }} />
            <input ref={jsonRef} type="file" accept=".json,application/json" hidden
              onChange={(e) => { if (e.target.files?.[0]) importJSONFile(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </section>

        {showYear ? (
          <YearView expenses={expenses} year={month.slice(0, 4)} cats={cats} catById={catById} />
        ) : empty ? (
          <EmptyState />
        ) : (
          <>
            <section className="mb-6 grid gap-4 lg:grid-cols-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-2">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
                  <PieIcon size={15} className="text-emerald-400" /> Répartition du mois
                </h3>
                {byCat.length ? (
                  <div className="flex items-center gap-3">
                    <div className="relative h-40 w-40 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={byCat} dataKey="value" nameKey="label" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
                            {byCat.map((c) => <Cell key={c.id} fill={c.color} />)}
                          </Pie>
                          <Tooltip content={<DonutTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-mono text-sm font-semibold text-slate-100">{fmtShort(monthTotal)}</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">total</span>
                      </div>
                    </div>
                    <ul className="flex-1 space-y-1.5 text-sm">
                      {byCat.slice(0, 6).map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-slate-300">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                            {c.label}
                          </span>
                          <span className="font-mono text-slate-400">{fmtEUR.format(c.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="py-10 text-center text-sm text-slate-500">Aucune dépense ce mois-ci.</p>}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-3">
                <h3 className="mb-3 text-sm font-medium text-slate-300">Évolution sur 12 mois</h3>
                <div className="h-48 w-full">
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
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              {(() => {
                const toReview = monthExp.filter((e) => e.needsReview);
                return toReview.length > 0 && (
                  <button
                    onClick={() => setFilterCat("__review__")}
                    className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-300 hover:bg-amber-500/20 transition"
                  >
                    <AlertTriangle size={14} className="shrink-0" />
                    <span><strong>{toReview.length}</strong> dépense{toReview.length > 1 ? "s" : ""} sans catégorie claire — clique pour les catégoriser</span>
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
          cats={cats} byCat={byCat} budgets={budgets} rules={rules}
          onAddCat={addCat} onRemoveCat={removeCat} onUpdateCat={updateCatDef}
          onChangeRules={(newRules) => {
            setRules(newRules);
            setExpenses((x) => x.map((e) => {
              if (e.manualCat) return e;
              const categoryId = guessCatWithRules(e.label, newRules);
              const needsReview = categoryId === "autre";
              return { ...e, categoryId, needsReview };
            }));
          }} onExportJSON={exportJSON}
          onImportJSON={() => jsonRef.current?.click()}
          onReset={resetData} onClose={() => setShowSettings(false)}
        />
      )}
      {editExpense && (
        <EditExpenseModal expense={editExpense} cats={cats} onSave={(patch) => { updateExpense(editExpense.id, { ...patch, manualCat: true }); setEditExpense(null); }} onClose={() => setEditExpense(null)} />
      )}
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

function SettingsPanel({ cats, rules, onAddCat, onRemoveCat, onUpdateCat, onChangeRules, onExportJSON, onImportJSON, onReset, onClose }) {
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

        {/* Règles */}
        {tab === "rules" && (
          <>
            <p className="mb-3 text-xs text-slate-500">Si le libellé contient le mot-clé, la catégorie est appliquée à l'import. Les règles perso ont priorité sur les règles par défaut.</p>
            <ul className="mb-3 max-h-52 space-y-1 overflow-y-auto">
              {rules.length === 0 && <li className="py-4 text-center text-xs text-slate-600">Aucune règle personnalisée.</li>}
              {rules.map((r, i) => {
                const cat = cats.find((c) => c.id === r.categoryId);
                return (
                  <li key={i} className="rounded-lg border border-transparent hover:border-slate-800 hover:bg-slate-800/30">
                    {editRuleIdx === i ? (
                      /* Mode édition */
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <input autoFocus value={editRulePattern}
                          onChange={(e) => setEditRulePattern(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveEditRule(); if (e.key === "Escape") setEditRuleIdx(null); }}
                          className="flex-1 rounded border border-emerald-600 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-100 outline-none" />
                        <select value={editRuleCatId} onChange={(e) => setEditRuleCatId(e.target.value)}
                          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500">
                          {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        <button onClick={saveEditRule} className="text-emerald-400 hover:text-emerald-300"><Check size={15} /></button>
                        <button onClick={() => setEditRuleIdx(null)} className="text-slate-500 hover:text-slate-300"><X size={15} /></button>
                      </div>
                    ) : (
                      /* Mode affichage */
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="flex-1 font-mono text-sm text-slate-200">"{r.pattern}"</span>
                        <span className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span className="h-2 w-2 rounded-full" style={{ background: cat?.color || "#94A3B8" }} />
                          {cat?.label || r.categoryId}
                        </span>
                        <button onClick={() => { setEditRuleIdx(i); setEditRulePattern(r.pattern); setEditRuleCatId(r.categoryId); }}
                          className="text-slate-600 hover:text-slate-300"><Pencil size={14} /></button>
                        <button onClick={() => onChangeRules(rules.filter((_, idx) => idx !== i))}
                          className="text-slate-600 hover:text-rose-400"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-2">
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="mot-clé"
                onKeyDown={(e) => { if (e.key === "Enter" && pattern.trim()) { onChangeRules([...rules, { pattern: pattern.trim(), categoryId: ruleCatId }]); setPattern(""); } }}
                className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
              <select value={ruleCatId} onChange={(e) => setRuleCatId(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500">
                {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button disabled={!pattern.trim()} onClick={() => { onChangeRules([...rules, { pattern: pattern.trim(), categoryId: ruleCatId }]); setPattern(""); }}
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
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    const ym = `${year}-${m}`;
    const exps = expenses.filter((e) => e.date.startsWith(ym));
    const total = exps.reduce((s, e) => s + (e.isCredit ? -e.amount : e.amount), 0);
    const label = new Date(+year, i, 1).toLocaleDateString("fr-FR", { month: "short" });
    return { ym, label, total, exps };
  });
  const yearTotal = months.reduce((s, m) => s + m.total, 0);
  const max = Math.max(...months.map((m) => m.total), 1);

  const [selYear, setSelYear] = useState(+year);
  const displayMonths = months.map((m, i) => ({
    ...m,
    label: new Date(selYear, i, 1).toLocaleDateString("fr-FR", { month: "short" }),
    ym: `${selYear}-${String(i + 1).padStart(2, "0")}`,
    total: expenses.filter((e) => e.date.startsWith(`${selYear}-${String(i + 1).padStart(2, "0")}`) && !e.isCredit && !catById[e.categoryId]?.excludeFromTotal).reduce((s, e) => s + e.amount, 0),
  }));
  const displayMax = Math.max(...displayMonths.map((m) => m.total), 1);
  const displayTotal = displayMonths.reduce((s, m) => s + m.total, 0);

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
      <div className="mb-4 grid grid-cols-12 items-end gap-1" style={{ height: 120 }}>
        {displayMonths.map((m) => (
          <div key={m.ym} className="flex flex-col items-center gap-1">
            <div className="w-full rounded-t" style={{ height: `${(m.total / displayMax) * 100}%`, background: m.total ? "#34D399" : "#1e293b", minHeight: m.total ? 4 : 0 }}
              title={fmtEUR.format(m.total)} />
            <span className="text-[10px] text-slate-500">{m.label}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-800 pt-4">
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
              <td className="pt-3 text-right font-mono font-semibold text-emerald-400">{fmtEUR.format(displayTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

