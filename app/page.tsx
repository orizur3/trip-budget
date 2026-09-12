'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase, Expense, Currency } from '@/lib/supabase';

const TARGET_BUDGET = 40000;
const CAP_BUDGET = 50000;

const TRIP_START = '2026-09-09';
const TRIP_END = '2026-09-30';

const BASELINE = [
  { label: 'טיסות (הלוך ושוב, שני נוסעים)', amount: 13563 },
  { label: 'מלון בנגקוק - Chatrium Grand (26-29.9, 3 לילות)', amount: 1814.77 },
  { label: 'מלון קו פנגן - Varivana Resort (10-13.9, 3 לילות)', amount: 1739.01 },
  { label: 'ביטוח נסיעות ובריאות (PassportCard)', amount: 1067.5 },
];
const BASELINE_TOTAL = BASELINE.reduce((s, b) => s + b.amount, 0);

const CATEGORIES = ['תחבורה', 'אוכל', 'מלון', 'פעילות', 'קניות', 'אחר'];

const CATEGORY_COLORS: Record<string, string> = {
  'תחבורה': '#1f6f6b',
  'אוכל': '#d76a4f',
  'מלון': '#4f7cac',
  'פעילות': '#8a5fbf',
  'קניות': '#c9a227',
  'אחר': '#7a5c3e',
};
const FALLBACK_COLOR = '#9a9a9a';
function colorFor(cat: string) {
  return CATEGORY_COLORS[cat] ?? FALLBACK_COLOR;
}

const CURRENCIES: { code: Currency; label: string; sym: string }[] = [
  { code: 'THB', label: '฿ באט', sym: '฿' },
  { code: 'USD', label: '$ דולר', sym: '$' },
  { code: 'ILS', label: '₪ שקל', sym: '₪' },
];
const SYM: Record<Currency, string> = { ILS: '₪', THB: '฿', USD: '$' };

type Rates = Record<string, number>; // ILS per 1 unit of currency

function fmt(n: number) {
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(Math.round(n));
}
function fmtPrecise(n: number) {
  return new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtSigned(n: number) {
  return n >= 0 ? `${fmt(n)} ₪` : `-${fmt(Math.abs(n))} ₪`;
}
// Whole days between two 'YYYY-MM-DD' dates, inclusive of both ends.
function daysBetweenInclusive(a: string, b: string) {
  const d1 = new Date(`${a}T00:00:00`);
  const d2 = new Date(`${b}T00:00:00`);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
}
function dayLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', weekday: 'short' });
}
function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}
// Format a Date back to 'YYYY-MM-DD' using its LOCAL calendar date (never toISOString, which
// converts to UTC and shifts the date near midnight in any timezone ahead of UTC).
function toDateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayLocal() {
  return toDateStr(new Date());
}
// Last day an expense applies to (falls back to its start date for a normal, single-day expense).
function expenseEndDate(e: Pick<Expense, 'date' | 'end_date'>) {
  return e.end_date && e.end_date > e.date ? e.end_date : e.date;
}
function dateRangeLabel(e: Pick<Expense, 'date' | 'end_date'>) {
  const end = expenseEndDate(e);
  return end !== e.date ? `${shortDate(e.date)}–${shortDate(end)}` : shortDate(e.date);
}
// Every calendar day from start to end, inclusive (capped so a typo can't loop forever).
function daysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  let cur = new Date(`${start}T00:00:00`);
  const endD = new Date(`${end}T00:00:00`);
  if (endD < cur) return [start];
  let guard = 0;
  while (cur <= endD && guard < 180) {
    days.push(toDateStr(cur));
    cur = new Date(cur.getTime() + 86400000);
    guard++;
  }
  return days;
}

type FormState = {
  desc: string;
  amount: string;
  currency: Currency;
  date: string;
  spread: boolean;
  endDate: string;
  category: string;
};

const emptyForm = (): FormState => {
  const today = todayLocal();
  return {
    desc: '',
    amount: '',
    currency: 'THB',
    date: today,
    spread: false,
    endDate: today,
    category: 'תחבורה',
  };
};

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [rates, setRates] = useState<Rates | null>(null);
  const [ratesUpdated, setRatesUpdated] = useState<string | null>(null);
  const [ratesStale, setRatesStale] = useState(false);
  const [tab, setTab] = useState<'track' | 'categories'>('track');

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('date', { ascending: false });

      if (cancelled) return;
      if (error) {
        setError('לא הצלחנו לטעון את ההוצאות. בדוק את החיבור ל-Supabase.');
      } else {
        setExpenses(data || []);
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Daily exchange rates (THB/USD -> ILS)
  useEffect(() => {
    let cancelled = false;

    async function loadRates() {
      try {
        const res = await fetch('/api/rates');
        const data = await res.json();
        if (cancelled) return;
        if (!data.rates) throw new Error('no rates');
        setRates(data.rates);
        setRatesUpdated(data.updated ?? null);
        setRatesStale(false);
        try {
          localStorage.setItem('fx', JSON.stringify({ rates: data.rates, updated: data.updated ?? null }));
        } catch { /* ignore */ }
      } catch {
        if (cancelled) return;
        try {
          const cached = localStorage.getItem('fx');
          if (cached) {
            const data = JSON.parse(cached);
            setRates(data.rates);
            setRatesUpdated(data.updated ?? null);
            setRatesStale(true);
          }
        } catch { /* ignore */ }
      }
    }

    loadRates();
    return () => { cancelled = true; };
  }, []);

  // Realtime subscription so both devices sync live
  useEffect(() => {
    const channel = supabase
      .channel('expenses-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, (payload) => {
        setExpenses((current) => {
          if (payload.eventType === 'INSERT') {
            const newRow = payload.new as Expense;
            if (current.some((e) => e.id === newRow.id)) return current;
            return [newRow, ...current].sort((a, b) => (a.date < b.date ? 1 : -1));
          }
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Expense;
            return current.map((e) => (e.id === updated.id ? updated : e));
          }
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as Expense).id;
            return current.filter((e) => e.id !== deletedId);
          }
          return current;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const dailyTotal = useMemo(() => expenses.reduce((s, e) => s + Number(e.amount), 0), [expenses]);
  const totalSpent = BASELINE_TOTAL + dailyTotal;
  const remaining = TARGET_BUDGET - totalSpent;
  const pct = Math.min(100, (totalSpent / TARGET_BUDGET) * 100);
  const barState = totalSpent > CAP_BUDGET ? 'over' : totalSpent > TARGET_BUDGET ? 'warn' : 'ok';

  // Daily pace: split what's left of the target budget across the days remaining in the trip.
  const todayStr = todayLocal();
  const clampedToday = todayStr < TRIP_START ? TRIP_START : todayStr > TRIP_END ? TRIP_END : todayStr;
  const totalTripDays = daysBetweenInclusive(TRIP_START, TRIP_END);
  const daysRemaining = Math.max(1, daysBetweenInclusive(clampedToday, TRIP_END));
  const avgPerDayRemaining = remaining / daysRemaining;

  // Spread every expense evenly across the days it covers (a normal expense covers just its own
  // day; a multi-day one like a car rental or hotel covers date..end_date), grouped by day,
  // chronological (trip order), each day's items kept in the order they were entered.
  const daySpread = useMemo(() => {
    const map = new Map<string, { date: string; total: number; entries: { expense: Expense; share: number; spanDays: number }[]; byCategory: Record<string, number> }>();
    for (const e of expenses) {
      const days = daysInRange(e.date, expenseEndDate(e));
      const share = Number(e.amount) / days.length;
      days.forEach((d) => {
        let bucket = map.get(d);
        if (!bucket) {
          bucket = { date: d, total: 0, entries: [], byCategory: {} };
          map.set(d, bucket);
        }
        bucket.total += share;
        bucket.entries.push({ expense: e, share, spanDays: days.length });
        bucket.byCategory[e.category] = (bucket.byCategory[e.category] ?? 0) + share;
      });
    }
    Array.from(map.values()).forEach((bucket) => {
      bucket.entries.sort((a, b) => (a.expense.created_at < b.expense.created_at ? -1 : a.expense.created_at > b.expense.created_at ? 1 : 0));
    });
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [expenses]);

  // Overall category totals (each expense counts once, in full, under its category).
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) {
      map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount));
    }
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);
  const categoryGrandTotal = categoryTotals.reduce((s, c) => s + c.amount, 0);

  // Rate for the currency currently selected in the form
  const editing = editingId ? expenses.find((e) => e.id === editingId) : undefined;
  const formRate =
    form.currency === 'ILS'
      ? 1
      : editing && editing.currency === form.currency
        ? Number(editing.rate)
        : rates?.[form.currency];

  const amountNumRaw = parseFloat(form.amount);
  const previewIls =
    !isNaN(amountNumRaw) && amountNumRaw > 0 && formRate ? amountNumRaw * formRate : null;

  function startEdit(exp: Expense) {
    setEditingId(exp.id);
    const end = expenseEndDate(exp);
    setForm({
      desc: exp.desc,
      amount: String(exp.original_amount ?? exp.amount),
      currency: exp.currency ?? 'ILS',
      date: exp.date,
      spread: end !== exp.date,
      endDate: end,
      category: exp.category,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const originalAmount = parseFloat(form.amount);
    if (!form.desc.trim() || isNaN(originalAmount) || originalAmount <= 0 || !form.date) return;

    const endDateValue = form.spread ? form.endDate : form.date;
    if (form.spread && endDateValue < form.date) {
      setError('תאריך הסיום חייב להיות אחרי תאריך ההתחלה.');
      return;
    }

    const rate =
      form.currency === 'ILS'
        ? 1
        : editing && editing.currency === form.currency
          ? Number(editing.rate)
          : rates?.[form.currency];

    if (!rate || rate <= 0) {
      setError('שער החליפין עדיין לא נטען. נסו שוב עוד רגע.');
      return;
    }

    setError(null);

    const row = {
      desc: form.desc.trim(),
      amount: Number((originalAmount * rate).toFixed(2)),
      original_amount: originalAmount,
      currency: form.currency,
      rate: Number(rate.toFixed(6)),
      date: form.date,
      end_date: endDateValue > form.date ? endDateValue : null,
      category: form.category,
    };

    if (editingId) {
      const { error } = await supabase.from('expenses').update(row).eq('id', editingId);
      if (error) {
        setError('שמירת השינויים נכשלה. נסה שוב.');
        return;
      }
      cancelEdit();
      return;
    }

    const { error } = await supabase.from('expenses').insert(row);
    if (error) {
      setError('הוספת ההוצאה נכשלה. נסה שוב.');
      return;
    }

    setForm(emptyForm());
  }

  async function handleDelete(id: string) {
    if (editingId === id) cancelEdit();
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) setError('מחיקת ההוצאה נכשלה. נסה שוב.');
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 700, color: 'var(--lagoon-deep)' }}>
          🌴 תקציב הטיול לתאילנד
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--teak)' }}>מעקב הוצאות שוטף מול תקציב היעד</p>
        <p style={{
          marginTop: 6, fontSize: 11.5, color: 'var(--lagoon-deep)', background: '#e7ede2',
          display: 'inline-block', padding: '3px 9px', borderRadius: 20,
        }}>
          🔗 מקור אמת אחד — מסונכרן בזמן אמת בין כל המכשירים
        </p>
      </header>

      {error && (
        <div style={{
          background: '#fbe9e4', border: '1px solid var(--over)', color: 'var(--over)',
          borderRadius: 10, padding: '10px 12px', fontSize: 12.5, marginBottom: 14, lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Stat label="הוצא עד כה" value={`${fmt(totalSpent)} ₪`} />
          <Stat
            label="נשאר ליעד"
            value={fmtSigned(remaining)}
            color={remaining >= 0 ? 'var(--good)' : 'var(--over)'}
          />
          <Stat
            full
            label={`יעד ממוצע ליום (${daysRemaining} ימים נותרו מתוך ${totalTripDays})`}
            value={`${fmtSigned(avgPerDayRemaining)} / יום`}
            color={avgPerDayRemaining >= 0 ? 'var(--good)' : 'var(--over)'}
          />
          <div style={{ gridColumn: '1 / -1', padding: 12, borderRadius: 10, background: '#f9f4ea' }}>
            <div style={{ fontSize: 11, color: 'var(--teak)', marginBottom: 3 }}>
              התקדמות ביחס ליעד ({fmt(TARGET_BUDGET)} ₪)
            </div>
            <div style={{ height: 10, background: '#eee2cf', borderRadius: 6, overflow: 'hidden', marginTop: 10 }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  borderRadius: 6,
                  transition: 'width 0.4s ease',
                  background: barState === 'over' ? 'var(--over)' : barState === 'warn' ? 'var(--warn)' : 'var(--lagoon)',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--teak)', marginTop: 6 }}>
              <span>{Math.round(pct)}% מהיעד</span>
              <span>תקרה: {fmt(CAP_BUDGET)} ₪</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowBaseline((s) => !s)}
          style={{
            background: 'none', border: 'none', color: 'var(--lagoon)', fontSize: 13,
            fontWeight: 600, padding: 0, marginTop: 12, cursor: 'pointer',
          }}
        >
          {showBaseline ? 'הסתר פירוט הוצאות שנקבעו מראש ▴' : 'הצג פירוט הוצאות שנקבעו מראש (טיסות ומלונות) ▾'}
        </button>

        {showBaseline && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginTop: 10 }}>
            {BASELINE.map((b) => (
              <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{b.label}</span>
                <span style={{ fontWeight: 600 }}>{fmtPrecise(b.amount)} ₪</span>
              </div>
            ))}
            <div style={{
              display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700,
              color: 'var(--lagoon-deep)', paddingTop: 8, marginTop: 4, borderTop: '1px solid var(--line)',
            }}>
              <span>סה"כ מראש</span>
              <span>{fmtPrecise(BASELINE_TOTAL)} ₪</span>
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, background: '#f0e9da', padding: 4, borderRadius: 10 }}>
        <TabButton active={tab === 'track'} onClick={() => setTab('track')}>מעקב יומי</TabButton>
        <TabButton active={tab === 'categories'} onClick={() => setTab('categories')}>קטגוריות</TabButton>
      </div>

      {tab === 'track' && (
        <>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--lagoon-deep)', marginBottom: 4 }}>
              פירוט לפי יום
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--teak)', margin: '0 0 10px' }}>
              כל יום מול היעד הממוצע הנוכחי ({fmt(avgPerDayRemaining)} ₪/יום) · הוצאה מתמשכת מחולקת שווה בשווה
            </p>

            {daySpread.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--teak)', fontSize: 13, padding: '10px 0' }}>
                עדיין אין הוצאות שוטפות לפי יום.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {daySpread.map((day) => {
                  const dayNum = daysBetweenInclusive(TRIP_START, day.date);
                  const overPace = day.total > avgPerDayRemaining;
                  const diff = Math.abs(day.total - avgPerDayRemaining);
                  return (
                    <div key={day.date} style={{ borderRadius: 10, background: '#f9f4ea', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--lagoon-deep)' }}>
                          יום {dayNum} · {dayLabel(day.date)}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(day.total)} ₪</div>
                      </div>
                      <div style={{ fontSize: 10.5, marginBottom: 6 }}>
                        <span style={{
                          display: 'inline-block', padding: '1px 7px', borderRadius: 20,
                          background: overPace ? '#fbe9e4' : '#e7ede2',
                          color: overPace ? 'var(--over)' : 'var(--lagoon-deep)',
                        }}>
                          {overPace ? `+${fmt(diff)} ₪ מעל היעד היומי` : `${fmt(diff)} ₪ מתחת ליעד היומי`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {day.entries.map(({ expense: e, share, spanDays }) => {
                          const cur = (e.currency ?? 'ILS') as Currency;
                          const orig = Number(e.original_amount ?? e.amount);
                          return (
                            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                              <span>
                                {e.desc}
                                <span style={{ color: 'var(--teak)' }}> · {e.category}</span>
                                {spanDays > 1 && (
                                  <span style={{ color: 'var(--teak)' }}> · {dateRangeLabel(e)}</span>
                                )}
                              </span>
                              <span style={{ whiteSpace: 'nowrap' }}>
                                {spanDays > 1 ? (
                                  `${fmtPrecise(share)} ₪/יום`
                                ) : (
                                  <>
                                    {cur !== 'ILS' && (
                                      <span style={{ color: 'var(--teak)' }}>{fmtPrecise(orig)} {SYM[cur]} · </span>
                                    )}
                                    {fmtPrecise(Number(e.amount))} ₪
                                  </>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--lagoon-deep)', marginBottom: 10 }}>
              {editingId ? 'עריכת הוצאה' : 'הוסף הוצאה'}
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Input
                placeholder="תיאור ההוצאה (למשל: מונית, ארוחת ערב)"
                value={form.desc}
                onChange={(v) => setForm((f) => ({ ...f, desc: v }))}
                required
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="סכום"
                  value={form.amount}
                  onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                  min={0}
                  step="0.01"
                  required
                />
                <select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}
                  style={selectStyle}
                  aria-label="מטבע"
                >
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>

              <div style={{ fontSize: 11.5, color: 'var(--teak)', minHeight: 16, lineHeight: 1.5 }}>
                {form.currency === 'ILS' ? (
                  'סכום בשקלים — נשמר כמו שהוא'
                ) : formRate ? (
                  <>
                    1 {SYM[form.currency]} ≈ {fmtPrecise(formRate)} ₪
                    {previewIls != null && (
                      <> · ≈ <strong style={{ color: 'var(--lagoon-deep)' }}>{fmtPrecise(previewIls)} ₪</strong></>
                    )}
                    {ratesStale && ' · שער שמור (אין חיבור)'}
                  </>
                ) : (
                  'טוען שער חליפין…'
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(v) => setForm((f) => ({ ...f, date: v, endDate: f.spread ? f.endDate : v }))}
                  required
                />
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  style={selectStyle}
                  aria-label="קטגוריה"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--teak)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.spread}
                  onChange={(e) => setForm((f) => ({ ...f, spread: e.target.checked, endDate: e.target.checked ? f.endDate : f.date }))}
                />
                הוצאה מתמשכת על כמה ימים (רכב שכור, מלון...) — תתחלק שווה בשווה
              </label>

              {form.spread && (
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(v) => setForm((f) => ({ ...f, endDate: v }))}
                  min={form.date}
                  required
                />
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" style={{ ...btnAddStyle, flex: 1, background: editingId ? 'var(--coral)' : 'var(--lagoon)' }}>
                  {editingId ? 'שמור שינויים' : 'הוסף הוצאה'}
                </button>
                {editingId && (
                  <button type="button" onClick={cancelEdit} style={btnCancelStyle}>בטל</button>
                )}
              </div>
            </form>
          </Card>

          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--lagoon-deep)', marginBottom: 4 }}>
              הוצאות שוטפות {expenses.length > 0 && <span style={{ fontSize: 12, color: 'var(--teak)', fontWeight: 400 }}>({expenses.length})</span>}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--teak)', margin: '0 0 10px' }}>
              לחצו על ✎ כדי לערוך הוצאה קיימת
              {ratesUpdated && <> · שער חליפין עודכן: {new Date(ratesUpdated).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</>}
            </p>

            {loading ? (
              <div style={{ textAlign: 'center', color: 'var(--teak)', fontSize: 13, padding: '20px 0' }}>טוען...</div>
            ) : expenses.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--teak)', fontSize: 13, padding: '20px 0' }}>
                עדיין לא נוספו הוצאות שוטפות.<br />הראשונה תופיע כאן.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {expenses.map((e) => {
                  const cur = (e.currency ?? 'ILS') as Currency;
                  const orig = Number(e.original_amount ?? e.amount);
                  const spanDays = daysBetweenInclusive(e.date, expenseEndDate(e));
                  return (
                    <div key={e.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 4px', borderBottom: '1px solid var(--line)',
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{e.desc}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--teak)' }}>
                          <span style={{
                            display: 'inline-block', fontSize: 10.5, padding: '1px 7px', borderRadius: 20,
                            background: '#e7ede2', color: 'var(--lagoon-deep)', marginLeft: 6,
                          }}>
                            {e.category}
                          </span>
                          {dateRangeLabel(e)}
                          {cur !== 'ILS' && ` · ${fmtPrecise(orig)} ${SYM[cur]}`}
                          {spanDays > 1 && ` · ${spanDays} ימים`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtPrecise(Number(e.amount))} ₪</div>
                        <button onClick={() => startEdit(e)} aria-label="ערוך" style={editBtnStyle}>✎</button>
                        <button onClick={() => handleDelete(e.id)} aria-label="מחק" style={delBtnStyle}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'categories' && (
        <>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--lagoon-deep)', marginBottom: 10 }}>
              פילוח קטגוריות — סה"כ הוצאות שוטפות
            </div>
            {categoryTotals.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--teak)', fontSize: 13, padding: '20px 0' }}>
                עדיין אין הוצאות לפילוח.
              </div>
            ) : (
              <>
                <Donut segments={categoryTotals} total={categoryGrandTotal} />
                <CategoryLegend segments={categoryTotals} total={categoryGrandTotal} />
              </>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--lagoon-deep)', marginBottom: 4 }}>
              פילוח קטגוריות לפי יום
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--teak)', margin: '0 0 10px' }}>
              הוצאה מתמשכת (רכב/מלון) מחולקת שווה בשווה על פני הימים שלה
            </p>
            {daySpread.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--teak)', fontSize: 13, padding: '10px 0' }}>
                עדיין אין נתונים.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {daySpread.map((day) => {
                  const dayNum = daysBetweenInclusive(TRIP_START, day.date);
                  const cats = Object.entries(day.byCategory).sort((a, b) => b[1] - a[1]);
                  return (
                    <div key={day.date}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>יום {dayNum} · {dayLabel(day.date)}</span>
                        <span>{fmt(day.total)} ₪</span>
                      </div>
                      <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: '#eee2cf' }}>
                        {cats.map(([cat, amt]) => (
                          <div key={cat} title={`${cat}: ${fmtPrecise(amt)} ₪`} style={{ width: `${(amt / day.total) * 100}%`, background: colorFor(cat) }} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <CategoryLegend segments={categoryTotals} total={categoryGrandTotal} />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Stat({ label, value, color, full }: { label: string; value: string; color?: string; full?: boolean }) {
  return (
    <div style={{ padding: 12, borderRadius: 10, background: '#f9f4ea', gridColumn: full ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--teak)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || 'var(--ink)' }}>{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 600,
        background: active ? 'var(--paper)' : 'transparent',
        color: active ? 'var(--lagoon-deep)' : 'var(--teak)',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function Donut({ segments, total }: { segments: { category: string; amount: number }[]; total: number }) {
  if (total <= 0) return null;
  let acc = 0;
  const stops = segments.map((s) => {
    const from = (acc / total) * 100;
    acc += s.amount;
    const to = (acc / total) * 100;
    return `${colorFor(s.category)} ${from}% ${to}%`;
  });
  return (
    <div style={{ position: 'relative', width: 168, height: 168, margin: '0 auto' }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(${stops.join(', ')})` }} />
      <div style={{
        position: 'absolute', inset: 26, borderRadius: '50%', background: 'var(--paper)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: 10.5, color: 'var(--teak)' }}>סה&quot;כ</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(total)} ₪</div>
      </div>
    </div>
  );
}

function CategoryLegend({ segments, total }: { segments: { category: string; amount: number }[]; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
      {segments.map((s) => (
        <div key={s.category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorFor(s.category), display: 'inline-block' }} />
            {s.category}
          </span>
          <span>
            {fmtPrecise(s.amount)} ₪
            <span style={{ color: 'var(--teak)' }}> · {total > 0 ? Math.round((s.amount / total) * 100) : 0}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Input({
  value, onChange, ...rest
}: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 15, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8,
  background: 'var(--paper)', color: 'var(--ink)', width: '100%',
};
const selectStyle: React.CSSProperties = { ...inputStyle };
const btnAddStyle: React.CSSProperties = {
  color: 'white', border: 'none', borderRadius: 8, padding: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
};
const btnCancelStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: 12,
  fontSize: 15, fontWeight: 600, color: 'var(--teak)', flex: 1, cursor: 'pointer',
};
const editBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--lagoon)', fontSize: 15, padding: '2px 6px', cursor: 'pointer',
};
const delBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--over)', fontSize: 18, padding: '2px 6px', cursor: 'pointer',
};
