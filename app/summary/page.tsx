'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase, Expense, Currency } from '@/lib/supabase';
import {
  TARGET_BUDGET, TRIP_START, TRIP_END, TRAVELERS, BASELINE, BASELINE_TOTAL, SYM,
  metaFor, fmt, fmtPrecise, daysBetweenInclusive, daysInRange, dayLabel, shortDate, dateRangeLabel, spreadByDay,
} from '@/lib/trip';

// Color roles on this page: turquoise = planned / paid in advance, orange = spent during the trip.
const PLAN = 'var(--sea)';
const SPENT = 'var(--sunset)';
const INK_MUTED = '#8a7f76';
const GRID = '#f3e9df';

type DayPoint = { date: string; dayNum: number; total: number };

export default function SummaryPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from('expenses').select('*').then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError('לא הצלחנו לטעון את ההוצאות. בדוק את החיבור ל-Supabase.');
      else setExpenses(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const totalTripDays = daysBetweenInclusive(TRIP_START, TRIP_END);
  const plannedDaily = (TARGET_BUDGET - BASELINE_TOTAL) / totalTripDays;

  const s = useMemo(() => {
    const onTrip = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const total = BASELINE_TOTAL + onTrip;

    // Every trip day, including ones with nothing spent
    const spread = new Map(spreadByDay(expenses).map((d) => [d.date, d.total]));
    const days: DayPoint[] = daysInRange(TRIP_START, TRIP_END).map((date, i) => ({
      date, dayNum: i + 1, total: spread.get(date) ?? 0,
    }));
    const priciest = days.reduce((m, d) => (d.total > m.total ? d : m), days[0]);
    const cheapest = days.reduce((m, d) => (d.total < m.total ? d : m), days[0]);
    const daysOver = days.filter((d) => d.total > plannedDaily).length;

    // Where the money went: prepaid items folded into the matching categories
    const prepaidHotels = BASELINE.filter((b) => b.label.startsWith('מלון')).reduce((sum, b) => sum + b.amount, 0);
    const flights = BASELINE.find((b) => b.label.startsWith('טיסות'))?.amount ?? 0;
    const insurance = BASELINE.find((b) => b.label.startsWith('ביטוח'))?.amount ?? 0;
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + Number(e.amount));
    const composition = [
      { key: 'טיסות', emoji: '✈️', amount: flights, prepaid: flights },
      { key: 'לינה', emoji: '🏨', amount: prepaidHotels + (byCat.get('מלון') ?? 0), prepaid: prepaidHotels },
      { key: 'ביטוח', emoji: '🛡️', amount: insurance, prepaid: insurance },
      ...Array.from(byCat.entries())
        .filter(([cat]) => cat !== 'מלון')
        .map(([cat, amount]) => ({ key: cat, emoji: metaFor(cat).emoji, amount, prepaid: 0 })),
    ].sort((a, b) => b.amount - a.amount);

    // Currencies actually paid in
    const cur = new Map<Currency, { original: number; ils: number; count: number }>();
    for (const e of expenses) {
      const c = (e.currency ?? 'ILS') as Currency;
      const row = cur.get(c) ?? { original: 0, ils: 0, count: 0 };
      row.original += Number(e.original_amount ?? e.amount);
      row.ils += Number(e.amount);
      row.count += 1;
      cur.set(c, row);
    }
    const currencies = Array.from(cur.entries()).sort((a, b) => b[1].ils - a[1].ils);

    const top5 = [...expenses].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);

    return { onTrip, total, days, priciest, cheapest, daysOver, composition, currencies, top5 };
  }, [expenses, plannedDaily]);

  const diff = TARGET_BUDGET - s.total;

  return (
    <div dir="rtl" style={{ maxWidth: 430, margin: '0 auto', padding: '20px 16px 60px', textAlign: 'right' }}>
      <Link href="/" style={{ fontSize: 13, fontWeight: 700, color: 'var(--sea)', textDecoration: 'none' }}>
        → חזרה למעקב
      </Link>

      <header style={{ margin: '12px 0 18px' }}>
        <h1 style={{ fontSize: 23, margin: '0 0 4px', fontWeight: 800, color: 'var(--sunset)' }}>🏁 סיכום הטיול</h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          תאילנד · {shortDate(TRIP_START)}–{shortDate(TRIP_END)}.2026 · {totalTripDays} ימים · {TRAVELERS} נוסעים
        </p>
      </header>

      {error && (
        <div style={{ background: '#fdecec', border: '1px solid var(--over)', color: 'var(--over)', borderRadius: 12, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>טוען...</div>
      ) : (
        <>
          {/* Hero: the one number */}
          <Card>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>עלות הטיול הכוללת</div>
            <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1.1, margin: '2px 0 8px' }}>{fmt(s.total)} ₪</div>
            <span style={{
              display: 'inline-block', fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
              background: diff >= 0 ? '#e6f7f1' : '#fdecec', color: diff >= 0 ? 'var(--good)' : 'var(--over)',
            }}>
              {diff >= 0
                ? `✓ ${fmt(diff)} ₪ מתחת ליעד (${Math.round((diff / TARGET_BUDGET) * 100)}%)`
                : `⚠ חריגה של ${fmt(-diff)} ₪ מהיעד`}
            </span>

            <BudgetMeter prepaid={BASELINE_TOTAL} onTrip={s.onTrip} target={TARGET_BUDGET} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <Tile label="לאדם" value={`${fmt(s.total / TRAVELERS)} ₪`} />
              <Tile label="ליום טיול (הכל כלול)" value={`${fmt(s.total / totalTripDays)} ₪`} />
            </div>
          </Card>

          {/* Key stats */}
          <Card>
            <SectionTitle>במספרים</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Tile label="הוצאה ממוצעת ליום בטיול" value={`${fmt(s.onTrip / totalTripDays)} ₪`} sub={`תכנון: ${fmt(plannedDaily)} ₪`} />
              <Tile label="ימים מעל התקציב היומי" value={`${s.daysOver} מתוך ${totalTripDays}`} />
              <Tile label="היום היקר ביותר" value={`${fmt(s.priciest.total)} ₪`} sub={`יום ${s.priciest.dayNum} · ${shortDate(s.priciest.date)}`} />
              <Tile label="היום החסכוני ביותר" value={`${fmt(s.cheapest.total)} ₪`} sub={`יום ${s.cheapest.dayNum} · ${shortDate(s.cheapest.date)}`} />
              <Tile label="מספר הוצאות" value={`${expenses.length}`} sub={`כ-${(expenses.length / totalTripDays).toFixed(1)} ביום`} />
              <Tile label="ששולם מראש" value={`${fmt(BASELINE_TOTAL)} ₪`} sub={`${Math.round((BASELINE_TOTAL / s.total) * 100)}% מהעלות`} />
            </div>
          </Card>

          {/* Cumulative pace */}
          <Card>
            <SectionTitle>הקצב המצטבר מול התכנון</SectionTitle>
            <p style={captionStyle}>
              מתחיל מ-{fmt(BASELINE_TOTAL)} ₪ ששולמו מראש. הקו המקווקו הוא קצב שמגיע בדיוק ליעד ביום האחרון.
            </p>
            <Legend items={[{ label: 'בפועל', color: SPENT, kind: 'line' }, { label: 'קצב מתוכנן', color: PLAN, kind: 'dash' }]} />
            <CumulativeChart days={s.days} plannedDaily={plannedDaily} />
          </Card>

          {/* Daily spend */}
          <Card>
            <SectionTitle>הוצאות לפי יום</SectionTitle>
            <p style={captionStyle}>
              הוצאות במהלך הטיול בלבד. הוצאה על כמה ימים (מלון, רכב) מחולקת ביניהם. הקו: {fmt(plannedDaily)} ₪ — התקציב היומי שהיה מביא בדיוק ליעד.
            </p>
            <DailyChart days={s.days} plannedDaily={plannedDaily} />
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sea)', cursor: 'pointer' }}>הצג כטבלה</summary>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', textAlign: 'right' }}>
                    <th style={thStyle}>יום</th><th style={thStyle}>תאריך</th><th style={thStyle}>הוצאה</th><th style={thStyle}>מול התכנון</th>
                  </tr>
                </thead>
                <tbody>
                  {s.days.map((d) => {
                    const delta = d.total - plannedDaily;
                    return (
                      <tr key={d.date} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={tdStyle}>{d.dayNum}</td>
                        <td style={tdStyle}>{dayLabel(d.date)}</td>
                        <td style={tdStyle}>{fmt(d.total)} ₪</td>
                        <td style={{ ...tdStyle, color: delta > 0 ? 'var(--over)' : 'var(--good)' }}>
                          {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))} ₪
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          </Card>

          {/* Where the money went */}
          <Card>
            <SectionTitle>לאן הלך הכסף</SectionTitle>
            <p style={captionStyle}>כל עלות הטיול, כולל מה ששולם מראש. מלונות מראש ובמהלך הטיול מאוחדים תחת לינה.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {s.composition.map((c) => {
                const pct = (c.amount / s.total) * 100;
                return (
                  <div key={c.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700 }}>{c.emoji} {c.key}</span>
                      <span>
                        <strong>{fmt(c.amount)} ₪</strong>
                        <span style={{ color: 'var(--muted)' }}> · {pct < 1 ? pct.toFixed(1) : Math.round(pct)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 8, background: GRID, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(c.amount / s.composition[0].amount) * 100}%`, background: SPENT, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Currencies */}
          <Card>
            <SectionTitle>במה שילמתם</SectionTitle>
            <p style={captionStyle}>הוצאות במהלך הטיול, לפי המטבע שבו שולמו (השער נקבע ביום ההוצאה).</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.currencies.map(([code, r]) => (
                <div key={code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(r.original)} {SYM[code]}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {r.count} הוצאות
                      {code !== 'ILS' && ` · שער ממוצע 1 ${SYM[code]} = ${(r.ils / r.original).toFixed(code === 'THB' ? 4 : 2)} ₪`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(r.ils)} ₪</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{Math.round((r.ils / s.onTrip) * 100)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Biggest expenses */}
          <Card>
            <SectionTitle>5 ההוצאות הגדולות במהלך הטיול</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.top5.map((e, i) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ width: 20, color: 'var(--muted)', fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }}>{metaFor(e.category).emoji} {e.desc}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{dateRangeLabel(e)}</span>
                  </span>
                  <strong style={{ whiteSpace: 'nowrap' }}>{fmt(Number(e.amount))} ₪</strong>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ---------- Budget meter: prepaid | on-trip | remaining, on the target's scale ---------- */

function BudgetMeter({ prepaid, onTrip, target }: { prepaid: number; onTrip: number; target: number }) {
  const scale = Math.max(target, prepaid + onTrip);
  const remaining = Math.max(0, target - prepaid - onTrip);
  const segs = [
    { label: 'שולם מראש', value: prepaid, color: PLAN },
    { label: 'במהלך הטיול', value: onTrip, color: SPENT },
  ];
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', gap: 2, height: 14 }}>
        {segs.map((sg, i) => (
          <div key={sg.label} style={{
            width: `${(sg.value / scale) * 100}%`, background: sg.color,
            borderRadius: i === 0 ? '0 4px 4px 0' : remaining > 0 ? 0 : '4px 0 0 4px',
          }} />
        ))}
        {remaining > 0 && (
          <div style={{ flex: 1, background: GRID, borderRadius: '4px 0 0 4px' }} />
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 10, fontSize: 12 }}>
        {segs.map((sg) => (
          <span key={sg.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: sg.color }} />
            {sg.label} <strong>{fmt(sg.value)} ₪</strong>
          </span>
        ))}
        {remaining > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: GRID, border: '1px solid var(--line)' }} />
            נשאר מהיעד <strong>{fmt(remaining)} ₪</strong>
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Charts (inline SVG; time runs right-to-left, like the rest of the app) ---------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(min: number, max: number, maxTicks = 5) {
  const span = max - min;
  const steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  const step = steps.find((st) => span / st <= maxTicks) ?? 10000;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

const AXIS_W = 40;   // y-axis tick band, on the right
const X_BAND = 22;   // x-axis label band, below the plot

function DailyChart({ days, plannedDaily }: { days: DayPoint[]; plannedDaily: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotH = 170;
  const top = 18;
  const max = Math.max(plannedDaily, ...days.map((d) => d.total));
  const { hi, ticks } = niceTicks(0, max, 4);
  const plotW = Math.max(0, width - AXIS_W - 4);
  const slot = plotW / days.length;
  const barW = Math.min(24, slot - 2);
  // index 0 (day 1) sits at the right edge, next to the axis
  const xCenter = (i: number) => plotW - slot * i - slot / 2;
  const y = (v: number) => top + plotH - (v / hi) * plotH;
  const maxIdx = days.reduce((m, d, i) => (d.total > days[m].total ? i : m), 0);
  const labelEvery = days.length > 14 ? 5 : 1;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={top + plotH + X_BAND} style={{ display: 'block', direction: 'ltr', overflow: 'visible' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={plotW + 6} y={y(t) + 4} fontSize={10} fill={INK_MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {t >= 1000 ? `${t / 1000}K` : t}
              </text>
            </g>
          ))}

          {days.map((d, i) => {
            const h = Math.max(0, plotH - (y(d.total) - top));
            const x = xCenter(i) - barW / 2;
            return (
              <path key={d.date} d={colPath(x, y(d.total), barW, h, 4)} fill={SPENT} opacity={hover === null || hover === i ? 1 : 0.45} />
            );
          })}

          {/* planned daily budget */}
          <line x1={0} x2={plotW} y1={y(plannedDaily)} y2={y(plannedDaily)} stroke={PLAN} strokeWidth={2} strokeDasharray="5 4" />

          {/* direct label on the extreme */}
          <text x={xCenter(maxIdx)} y={y(days[maxIdx].total) - 5} fontSize={10.5} fontWeight={700} fill="#2d3436" textAnchor="middle">
            {fmt(days[maxIdx].total)}
          </text>

          {days.map((d, i) => (i % labelEvery === 0 || i === days.length - 1) && (
            <text key={d.date} x={xCenter(i)} y={top + plotH + 15} fontSize={10} fill={INK_MUTED} textAnchor="middle">
              {d.dayNum}
            </text>
          ))}

          {/* hit targets: whole slot, full height */}
          {days.map((d, i) => (
            <rect
              key={d.date}
              x={xCenter(i) - slot / 2} y={top} width={slot} height={plotH}
              fill="transparent" tabIndex={0} style={{ outline: 'none', cursor: 'pointer' }}
              // mouse: follow the pointer. touch: a tap toggles (touch fires pointerleave right after the tap)
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(i)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
              onPointerUp={(e) => e.pointerType !== 'mouse' && setHover((h) => (h === i ? null : i))}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            />
          ))}
        </svg>
      )}
      <div style={{ fontSize: 10.5, color: INK_MUTED, textAlign: 'center' }}>יום בטיול</div>
      {hover !== null && width > 0 && (
        <Tooltip x={xCenter(hover)} y={y(days[hover].total)} width={plotW}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{fmt(days[hover].total)} ₪</div>
          <div style={{ fontSize: 11, color: INK_MUTED }}>יום {days[hover].dayNum} · {dayLabel(days[hover].date)}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: days[hover].total > plannedDaily ? 'var(--over)' : 'var(--good)' }}>
            {days[hover].total > plannedDaily ? '+' : '−'}{fmt(Math.abs(days[hover].total - plannedDaily))} ₪ מול התכנון
          </div>
        </Tooltip>
      )}
    </div>
  );
}

function CumulativeChart({ days, plannedDaily }: { days: DayPoint[]; plannedDaily: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotH = 170;
  const top = 18;

  // point 0 = before the trip (only the prepaid part), point n = end of day n
  const actual = [BASELINE_TOTAL];
  days.forEach((d) => actual.push(actual[actual.length - 1] + d.total));
  const planned = actual.map((_, i) => BASELINE_TOTAL + plannedDaily * i);
  const n = actual.length - 1;

  const { lo, hi, ticks } = niceTicks(Math.min(...actual), Math.max(TARGET_BUDGET, ...actual), 5);
  const plotW = Math.max(0, width - AXIS_W - 4);
  const x = (i: number) => plotW - (i / n) * plotW;
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const pathOf = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  function onMove(ev: React.PointerEvent<SVGRectElement>) {
    const rect = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    setHover(Math.max(0, Math.min(n, Math.round(((plotW - px) / plotW) * n))));
  }

  const endGap = actual[n] - planned[n];

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={top + plotH + X_BAND} style={{ display: 'block', direction: 'ltr', overflow: 'visible' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={plotW + 6} y={y(t) + 4} fontSize={10} fill={INK_MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {`${t / 1000}K`}
              </text>
            </g>
          ))}

          <path d={pathOf(planned)} fill="none" stroke={PLAN} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
          <path d={pathOf(actual)} fill="none" stroke={SPENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* end labels: the two numbers the chart is about */}
          <circle cx={x(n)} cy={y(actual[n])} r={4} fill={SPENT} stroke="#fff" strokeWidth={2} />
          <text x={x(n) + 8} y={y(actual[n]) + (endGap < 0 ? 14 : -6)} fontSize={10.5} fontWeight={700} fill="#2d3436">
            {fmt(actual[n])}
          </text>
          <text x={x(n) + 8} y={y(planned[n]) + (endGap < 0 ? -6 : 14)} fontSize={10.5} fill={INK_MUTED}>
            יעד {fmt(planned[n])}
          </text>

          {[0, 5, 10, 15, 20].filter((i) => i <= n - 3).concat([n]).map((i) => (
            <text key={i} x={x(i)} y={top + plotH + 15} fontSize={10} fill={INK_MUTED} textAnchor="middle">{i}</text>
          ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} stroke={INK_MUTED} strokeWidth={1} />
              <circle cx={x(hover)} cy={y(planned[hover])} r={4} fill={PLAN} stroke="#fff" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(actual[hover])} r={4} fill={SPENT} stroke="#fff" strokeWidth={2} />
            </g>
          )}

          <rect
            x={0} y={top} width={plotW} height={plotH} fill="transparent" tabIndex={0}
            style={{ outline: 'none', touchAction: 'pan-y' }}
            onPointerMove={onMove} onPointerDown={onMove}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
            onFocus={() => setHover(n)} onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setHover((h) => Math.min(n, (h ?? 0) + 1));
              if (e.key === 'ArrowRight') setHover((h) => Math.max(0, (h ?? 0) - 1));
            }}
          />
        </svg>
      )}
      <div style={{ fontSize: 10.5, color: INK_MUTED, textAlign: 'center' }}>סוף יום בטיול</div>
      {hover !== null && width > 0 && (
        <Tooltip x={x(hover)} y={y(Math.max(actual[hover], planned[hover]))} width={plotW}>
          <div style={{ fontSize: 11, color: INK_MUTED, marginBottom: 2 }}>
            {hover === 0 ? 'לפני הטיול' : `סוף יום ${hover} · ${shortDate(days[hover - 1].date)}`}
          </div>
          <TooltipRow color={SPENT} label="בפועל" value={actual[hover]} />
          <TooltipRow color={PLAN} label="מתוכנן" value={planned[hover]} dashed />
          {hover > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2, color: actual[hover] > planned[hover] ? 'var(--over)' : 'var(--good)' }}>
              {actual[hover] > planned[hover] ? 'לפני התכנון ב-' : 'אחרי התכנון ב-'}{fmt(Math.abs(actual[hover] - planned[hover]))} ₪
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

// Column with a 4px rounded top, square at the baseline.
function colPath(x: number, yTop: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  const yb = yTop + h;
  return `M${x},${yb} L${x},${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} L${x + w - rr},${yTop} Q${x + w},${yTop} ${x + w},${yTop + rr} L${x + w},${yb} Z`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const W = 150;
  const left = Math.max(0, Math.min(width - W, x - W / 2));
  return (
    <div style={{
      position: 'absolute', left, top: Math.max(0, y - 78), width: W, pointerEvents: 'none',
      background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '6px 10px',
      boxShadow: '0 4px 14px rgba(45,52,54,0.12)', textAlign: 'right', zIndex: 2,
    }}>
      {children}
    </div>
  );
}

function TooltipRow({ color, label, value, dashed }: { color: string; label: string; value: number; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ width: 12, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      <strong>{fmt(value)} ₪</strong>
      <span style={{ color: INK_MUTED }}>{label}</span>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; kind: 'line' | 'dash' }[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 12, margin: '0 0 8px' }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 16, borderTop: `2px ${it.kind === 'dash' ? 'dashed' : 'solid'} ${it.color}` }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ---------- Small pieces ---------- */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18, padding: 16, marginBottom: 14, boxShadow: '0 2px 10px rgba(45,52,54,0.04)' }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{children}</div>;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const captionStyle: React.CSSProperties = { fontSize: 11.5, color: 'var(--muted)', margin: '0 0 10px', lineHeight: 1.5 };
const thStyle: React.CSSProperties = { fontWeight: 600, padding: '4px 2px', textAlign: 'right' };
const tdStyle: React.CSSProperties = { padding: '5px 2px' };
