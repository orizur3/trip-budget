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

const CATEGORY_META: Record<string, { emoji: string; color: string }> = {
  'תחבורה': { emoji: '🛵', color: '#00b4d8' },
  'אוכל': { emoji: '🍜', color: '#ff6b35' },
  'מלון': { emoji: '🏨', color: '#6c5ce7' },
  'פעילות': { emoji: '🛺', color: '#06a77d' },
  'קניות': { emoji: '🛍️', color: '#e0a900' },
  'אחר': { emoji: '✨', color: '#ef476f' },
};
const FALLBACK_META = { emoji: '❔', color: '#9a9a9a' };
function metaFor(cat: string) {
  return CATEGORY_META[cat] ?? FALLBACK_META;
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
  const [sheetOpen, setSheetOpen] = useState(false);

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
  const ringColor = barState === 'over' ? 'var(--over)' : barState === 'warn' ? 'var(--warn)' : 'var(--sea)';

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
    const map = new Map<string, { date: string; total: number; entries: { expense: Expense; share: number; spanDays: number }[] }>();
    for (const e of expenses) {
      const days = daysInRange(e.date, expenseEndDate(e));
      const share = Number(e.amount) / days.length;
      days.forEach((d) => {
        let bucket = map.get(d);
        if (!bucket) {
          bucket = { date: d, total: 0, entries: [] };
          map.set(d, bucket);
        }
        bucket.total += share;
        bucket.entries.push({ expense: e, share, spanDays: days.length });
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
    return map;
  }, [expenses]);
  const maxCategoryAmount = Math.max(1, ...Array.from(categoryTotals.values()));

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

  function openAddSheet() {
    setEditingId(null);
    setForm(emptyForm());
    setSheetOpen(true);
  }

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
    setSheetOpen(true);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
    setSheetOpen(false);
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
    setSheetOpen(false);
  }

  async function handleDelete(id: string) {
    if (!window.confirm('למחוק את ההוצאה הזו? לא ניתן לשחזר.')) return;
    if (editingId === id) cancelEdit();
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) setError('מחיקת ההוצאה נכשלה. נסה שוב.');
  }

  return (
    <div dir="rtl" style={{ maxWidth: 430, margin: '0 auto', padding: '20px 16px 100px', position: 'relative' }}>
      <header style={{ marginBottom: 20, textAlign: 'right' }}>
        <h1 style={{ fontSize: 23, margin: '0 0 4px', fontWeight: 800, color: 'var(--sunset)' }}>
          🌴 תקציב הטיול לתאילנד
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>מעקב הוצאות שוטף מול תקציב היעד</p>
        <p style={{
          marginTop: 6, fontSize: 11.5, color: 'var(--sea)', background: '#e5f7fa',
          display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontWeight: 600,
        }}>
          🔗 מקור אמת אחד — מסונכרן בזמן אמת בין כל המכשירים
        </p>
      </header>

      {error && (
        <div style={{
          background: '#fdecec', border: '1px solid var(--over)', color: 'var(--over)',
          borderRadius: 12, padding: '10px 12px', fontSize: 12.5, marginBottom: 14, lineHeight: 1.5, textAlign: 'right',
        }}>
          {error}
        </div>
      )}

      {/* Budget ring card */}
      <Card>
        <div style={{ position: 'relative', width: 176, height: 176, margin: '0 auto' }}>
          <ProgressRing pct={pct} color={ringColor} />
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
          }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>הוצא עד כה</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(totalSpent)} ₪</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: ringColor }}>{Math.round(pct)}% מהיעד</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
          <MiniStat label="נשאר ליעד" value={fmtSigned(remaining)} color={remaining >= 0 ? 'var(--good)' : 'var(--over)'} />
          <MiniStat
            label={`יעד ליום (${daysRemaining} נותרו)`}
            value={fmtSigned(avgPerDayRemaining)}
            color={avgPerDayRemaining >= 0 ? 'var(--good)' : 'var(--over)'}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
          <span>יעד: {fmt(TARGET_BUDGET)} ₪</span>
          <span>תקרה: {fmt(CAP_BUDGET)} ₪</span>
        </div>

        <button
          onClick={() => setShowBaseline((s) => !s)}
          style={{
            background: 'none', border: 'none', color: 'var(--sea)', fontSize: 13,
            fontWeight: 700, padding: 0, marginTop: 14, cursor: 'pointer',
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
              color: 'var(--sunset)', paddingTop: 8, marginTop: 4, borderTop: '1px solid var(--line)',
            }}>
              <span>סה&quot;כ מראש</span>
              <span>{fmtPrecise(BASELINE_TOTAL)} ₪</span>
            </div>
          </div>
        )}
      </Card>

      {/* Category grid */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>פילוח לפי קטגוריה</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {CATEGORIES.map((cat) => {
            const amount = categoryTotals.get(cat) ?? 0;
            const meta = metaFor(cat);
            const relPct = (amount / maxCategoryAmount) * 100;
            return (
              <div key={cat} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 14, padding: 12 }}>
                <div style={{ fontSize: 26 }}>{meta.emoji}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>{cat}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: meta.color, marginTop: 2 }}>{fmt(amount)} ₪</div>
                <div style={{ height: 6, background: 'var(--line)', borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${relPct}%`, background: meta.color, transition: 'width 0.6s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Day-by-day pacing */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>פירוט לפי יום</div>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          כל יום מול היעד הממוצע הנוכחי ({fmt(avgPerDayRemaining)} ₪/יום) · הוצאה מתמשכת מחולקת שווה בשווה
        </p>

        {daySpread.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '10px 0' }}>
            עדיין אין הוצאות שוטפות לפי יום.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {daySpread.map((day) => {
              const dayNum = daysBetweenInclusive(TRIP_START, day.date);
              const overPace = day.total > avgPerDayRemaining;
              const diff = Math.abs(day.total - avgPerDayRemaining);
              return (
                <div key={day.date} style={{ borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--line)', padding: '10px 12px', animation: 'fadeInUp 0.3s ease' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--sunset)' }}>
                      יום {dayNum} · {dayLabel(day.date)}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>{fmt(day.total)} ₪</div>
                  </div>
                  <div style={{ fontSize: 10.5, marginBottom: 6 }}>
                    <span style={{
                      display: 'inline-block', padding: '1px 7px', borderRadius: 20, fontWeight: 600,
                      background: overPace ? '#fdecec' : '#e6f7f1',
                      color: overPace ? 'var(--over)' : 'var(--good)',
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
                            {metaFor(e.category).emoji} {e.desc}
                            {spanDays > 1 && (
                              <span style={{ color: 'var(--muted)' }}> · {dateRangeLabel(e)}</span>
                            )}
                          </span>
                          <span style={{ whiteSpace: 'nowrap' }}>
                            {spanDays > 1 ? (
                              `${fmtPrecise(share)} ₪/יום`
                            ) : (
                              <>
                                {cur !== 'ILS' && (
                                  <span style={{ color: 'var(--muted)' }}>{fmtPrecise(orig)} {SYM[cur]} · </span>
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

      {/* Recent expenses */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
          הוצאות שוטפות {expenses.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>({expenses.length})</span>}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          הקישו על כרטיס כדי לערוך
          {ratesUpdated && <> · שער חליפין עודכן: {new Date(ratesUpdated).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</>}
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>טוען...</div>
        ) : expenses.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>
            עדיין לא נוספו הוצאות שוטפות.<br />הראשונה תופיע כאן.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {expenses.map((e) => {
              const cur = (e.currency ?? 'ILS') as Currency;
              const orig = Number(e.original_amount ?? e.amount);
              const spanDays = daysBetweenInclusive(e.date, expenseEndDate(e));
              const meta = metaFor(e.category);
              return (
                <div
                  key={e.id}
                  onClick={() => startEdit(e)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '10px 12px', borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--line)',
                    cursor: 'pointer', animation: 'fadeInUp 0.3s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{
                      fontSize: 20, width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                      background: `${meta.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {meta.emoji}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.desc}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {dateRangeLabel(e)}
                        {cur !== 'ILS' && ` · ${fmtPrecise(orig)} ${SYM[cur]}`}
                        {spanDays > 1 && ` · ${spanDays} ימים`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtPrecise(Number(e.amount))} ₪</div>
                    <button
                      onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id); }}
                      aria-label="מחק"
                      style={delBtnStyle}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Floating action button */}
      {!sheetOpen && (
        <button onClick={openAddSheet} aria-label="הוסף הוצאה" style={fabStyle}>
          +
        </button>
      )}

      {/* Bottom sheet: add / edit expense */}
      {sheetOpen && (
        <>
          <div onClick={cancelEdit} style={overlayStyle} />
          <div style={sheetStyle}>
            <div style={{ width: 40, height: 4, background: 'var(--line)', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{editingId ? 'עריכת הוצאה' : 'הוצאה חדשה'}</div>
              <button onClick={cancelEdit} aria-label="סגור" style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

              <div style={{ fontSize: 11.5, color: 'var(--muted)', minHeight: 16, lineHeight: 1.5 }}>
                {form.currency === 'ILS' ? (
                  'סכום בשקלים — נשמר כמו שהוא'
                ) : formRate ? (
                  <>
                    1 {SYM[form.currency]} ≈ {fmtPrecise(formRate)} ₪
                    {previewIls != null && (
                      <> · ≈ <strong style={{ color: 'var(--sunset)' }}>{fmtPrecise(previewIls)} ₪</strong></>
                    )}
                    {ratesStale && ' · שער שמור (אין חיבור)'}
                  </>
                ) : (
                  'טוען שער חליפין…'
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.spread}
                  onChange={(e) => setForm((f) => ({ ...f, spread: e.target.checked, endDate: e.target.checked ? f.endDate : f.date }))}
                />
                הוצאה מתמשכת על כמה ימים (רכב שכור, מלון...) — תתחלק שווה בשווה בין הימים
              </label>

              {form.spread ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="מתאריך">
                    <Input type="date" value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} required />
                  </Field>
                  <Field label="עד תאריך (כולל)">
                    <Input type="date" value={form.endDate} onChange={(v) => setForm((f) => ({ ...f, endDate: v }))} min={form.date} required />
                  </Field>
                </div>
              ) : (
                <Field label="תאריך">
                  <Input type="date" value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} required />
                </Field>
              )}

              <div>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>קטגוריה</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                  {CATEGORIES.map((c) => {
                    const meta = metaFor(c);
                    const active = form.category === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, category: c }))}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                          padding: '10px 4px', borderRadius: 12, cursor: 'pointer',
                          border: active ? `2px solid ${meta.color}` : '2px solid transparent',
                          background: active ? `${meta.color}22` : 'var(--bg)',
                        }}
                      >
                        <span style={{ fontSize: 20 }}>{meta.emoji}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600 }}>{c}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button type="submit" style={{ ...btnAddStyle, flex: 1 }}>
                  {editingId ? 'שמור שינויים' : 'הוסף הוצאה'}
                </button>
                {editingId && (
                  <button type="button" onClick={cancelEdit} style={btnCancelStyle}>בטל</button>
                )}
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: 16, marginBottom: 14, boxShadow: '0 2px 10px rgba(45,52,54,0.04)' }}>
      {children}
    </div>
  );
}

function ProgressRing({ pct, color, size = 176, stroke = 16 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c * (1 - clamped / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
    </svg>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
      {children}
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
  fontSize: 15, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10,
  background: 'var(--bg)', color: 'var(--text)', width: '100%', textAlign: 'right',
};
const selectStyle: React.CSSProperties = { ...inputStyle };
const btnAddStyle: React.CSSProperties = {
  color: 'white', border: 'none', borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700,
  cursor: 'pointer', background: 'var(--sunset)', boxShadow: '0 4px 14px rgba(255,107,53,0.35)',
};
const btnCancelStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--line)', borderRadius: 12, padding: 14,
  fontSize: 15, fontWeight: 700, color: 'var(--muted)', flex: 1, cursor: 'pointer',
};
const delBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--over)', fontSize: 16, padding: '4px 6px', cursor: 'pointer',
};
const fabStyle: React.CSSProperties = {
  position: 'fixed', bottom: 24, left: 24, width: 60, height: 60, borderRadius: '50%',
  background: 'var(--sunset)', color: '#fff', border: 'none', fontSize: 30, lineHeight: 1,
  boxShadow: '0 8px 22px rgba(255,107,53,0.45)', cursor: 'pointer', zIndex: 40,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(45,52,54,0.45)', zIndex: 50, animation: 'fadeIn 0.2s ease',
};
const sheetStyle: React.CSSProperties = {
  position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 430, margin: '0 auto',
  background: 'var(--card)', borderRadius: '22px 22px 0 0', padding: '16px 18px 24px',
  zIndex: 51, maxHeight: '88vh', overflowY: 'auto', animation: 'slideUp 0.25s ease',
  boxShadow: '0 -10px 30px rgba(0,0,0,0.15)', textAlign: 'right',
};
