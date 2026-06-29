import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Plus, Trash2, ShoppingCart, Home, Car, UtensilsCrossed, Gamepad2, HeartPulse,
  Repeat, ShoppingBag, MoreHorizontal, Tag, Upload, Download, X, TrendingDown,
  TrendingUp, Wallet, Calendar, Search, PieChart as PieIcon,
} from "lucide-react";
import { storage } from "./lib/storage";
import { importBankCSV } from "./lib/importBank";

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

const DEFAULT_CATS = [
  { id: "alimentation", label: "Alimentation", color: "#34D399", builtin: true },
  { id: "logement", label: "Logement", color: "#60A5FA", builtin: true },
  { id: "transport", label: "Transport", color: "#FBBF24", builtin: true },
  { id: "restaurants", label: "Restaurants", color: "#F472B6", builtin: true },
  { id: "loisirs", label: "Loisirs", color: "#A78BFA", builtin: true },
  { id: "sante", label: "Santé", color: "#F87171", builtin: true },
  { id: "abonnements", label: "Abonnements", color: "#2DD4BF", builtin: true },
  { id: "shopping", label: "Shopping", color: "#FB923C", builtin: true },
  { id: "autre", label: "Autre", color: "#94A3B8", builtin: true },
];

const ICONS = {
  alimentation: ShoppingCart, logement: Home, transport: Car, restaurants: UtensilsCrossed,
  loisirs: Gamepad2, sante: HeartPulse, abonnements: Repeat, shopping: ShoppingBag, autre: MoreHorizontal,
};
const CatIcon = ({ id, ...p }) => {
  const I = ICONS[id] || Tag;
  return <I {...p} />;
};

const SAMPLE = () => {
  const base = new Date();
  const mk = (daysAgo, amount, label, categoryId) => {
    const d = new Date(base); d.setDate(d.getDate() - daysAgo);
    return { id: uid(), amount, label, categoryId, date: d.toISOString().slice(0, 10) };
  };
  return [
    mk(1, 62.4, "Carrefour", "alimentation"), mk(2, 13.9, "Boulangerie du coin", "restaurants"),
    mk(3, 9.99, "Spotify", "abonnements"), mk(4, 48, "Plein essence", "transport"),
    mk(6, 1050, "Loyer", "logement"), mk(8, 34.5, "Restaurant midi", "restaurants"),
    mk(9, 22, "Pharmacie", "sante"), mk(11, 79.9, "Decathlon", "shopping"),
    mk(14, 15.5, "Cinéma", "loisirs"), mk(18, 88.2, "Intermarché", "alimentation"),
    mk(40, 1050, "Loyer", "logement"), mk(42, 71, "Auchan", "alimentation"),
    mk(45, 55, "Plein essence", "transport"), mk(50, 12.99, "Netflix", "loisirs"),
  ];
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
  const [showCats, setShowCats] = useState(false);
  const [editCatId, setEditCatId] = useState(null);
  const fileRef = useRef(null);

  /* persistance */
  useEffect(() => {
    const r = storage.get(KEY);
    if (r && r.value) {
      try {
        const d = JSON.parse(r.value);
        if (d.categories?.length) setCats(d.categories);
        if (d.expenses) setExpenses(d.expenses);
      } catch { /* ignore */ }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    storage.set(KEY, JSON.stringify({ expenses, categories: cats }));
  }, [expenses, cats, loaded]);

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
  const monthTotal = useMemo(() => monthExp.reduce((s, e) => s + e.amount, 0), [monthExp]);

  const prevMonth = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [month]);
  const prevTotal = useMemo(
    () => expenses.filter((e) => monthOf(e.date) === prevMonth).reduce((s, e) => s + e.amount, 0),
    [expenses, prevMonth]
  );
  const delta = prevTotal ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;

  const byCat = useMemo(() => {
    const m = {};
    monthExp.forEach((e) => (m[e.categoryId] = (m[e.categoryId] || 0) + e.amount));
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
      const total = expenses.filter((e) => monthOf(e.date) === ym).reduce((s, e) => s + e.amount, 0);
      out.push({ ym, total, lbl: d.toLocaleDateString("fr-FR", { month: "short" }), cur: ym === month });
    }
    return out;
  }, [expenses, month]);

  const visible = useMemo(() => {
    return monthExp
      .filter((e) => filterCat === "all" || e.categoryId === filterCat)
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

  const updateCat = (id, categoryId) =>
    setExpenses((x) => x.map((e) => (e.id === id ? { ...e, categoryId } : e)));

  const addCat = (lbl, color) => {
    const id = uid();
    setCats((c) => [...c.slice(0, c.length - 1), { id, label: lbl, color, builtin: false }, c[c.length - 1]]);
    return id;
  };
  const removeCat = (id) => {
    if (catById[id]?.builtin) return;
    setExpenses((x) => x.map((e) => (e.categoryId === id ? { ...e, categoryId: "autre" } : e)));
    setCats((c) => c.filter((x) => x.id !== id));
  };

  const handleImport = async (file) => {
    try {
      const parsed = await importBankCSV(file);
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
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-900/40 p-6">
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
                {byCat.slice(0, 6).map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    {c.label} <span className="font-mono text-slate-500">{Math.round((c.value / monthTotal) * 100)}%</span>
                  </span>
                ))}
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
            <button onClick={() => setShowCats(true)}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100">
              <Tag size={15} /> Catégories
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </section>

        {empty ? (
          <EmptyState onSample={() => setExpenses(SAMPLE())} />
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
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <ul className="divide-y divide-slate-800/70">
                {visible.map((e) => {
                  const c = catById[e.categoryId] || { label: "Autre", color: "#94A3B8", id: "autre" };
                  return (
                    <li key={e.id} className="group flex items-center gap-3 py-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: c.color + "22", color: c.color }}>
                        <CatIcon id={c.id} size={17} />
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
                              className="underline decoration-dotted underline-offset-2 hover:text-slate-300"
                            >
                              {c.label}
                            </button>
                          )}
                        </p>
                      </div>
                      <span className="font-mono text-sm tabular-nums text-slate-100">{fmtEUR.format(e.amount)}</span>
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
        </p>
      </div>

      {showCats && (
        <CatManager cats={cats} byCat={byCat} onAdd={addCat} onRemove={removeCat} onClose={() => setShowCats(false)} />
      )}
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

function EmptyState({ onSample }) {
  return (
    <section className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
        <Wallet size={22} />
      </div>
      <h3 className="text-base font-medium text-slate-200">Commence ton ardoise</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
        Ajoute ta première dépense ci-dessus, importe un relevé bancaire au format CSV,
        ou charge un jeu d'exemple pour voir les graphiques.
      </p>
      <button onClick={onSample}
        className="mt-5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-emerald-500 hover:text-emerald-400">
        Charger un exemple
      </button>
    </section>
  );
}

function CatManager({ cats, byCat, onAdd, onRemove, onClose }) {
  const [lbl, setLbl] = useState("");
  const [color, setColor] = useState("#22D3EE");
  const totalById = Object.fromEntries(byCat.map((c) => [c.id, c.value]));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl border border-slate-800 bg-slate-900 p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Catégories</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={18} /></button>
        </div>
        <ul className="mb-4 max-h-64 space-y-1 overflow-y-auto">
          {cats.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800/50">
              <span className="flex items-center gap-2 text-sm text-slate-200">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                {c.label}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-slate-500">{totalById[c.id] ? fmtEUR.format(totalById[c.id]) : "—"}</span>
                {!c.builtin && (
                  <button onClick={() => onRemove(c.id)} className="text-slate-600 hover:text-rose-400"><Trash2 size={15} /></button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
            className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-700 bg-transparent" />
          <input value={lbl} onChange={(e) => setLbl(e.target.value)} placeholder="Nouvelle catégorie"
            onKeyDown={(e) => { if (e.key === "Enter" && lbl.trim()) { onAdd(lbl.trim(), color); setLbl(""); } }}
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500" />
          <button disabled={!lbl.trim()} onClick={() => { onAdd(lbl.trim(), color); setLbl(""); }}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40">
            <Plus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
