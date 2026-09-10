import { NextResponse } from 'next/server';

// Cache the upstream response for an hour; the source itself only updates once a day.
export const revalidate = 3600;

const FOREIGN = ['THB', 'USD'] as const;

export async function GET() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/ILS', {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const data = await res.json();
    if (data.result !== 'success' || !data.rates) throw new Error('bad payload');

    // data.rates[c] = units of c per 1 ILS. We want ILS per 1 unit of c.
    const rates: Record<string, number> = { ILS: 1 };
    for (const c of FOREIGN) {
      const perIls = Number(data.rates[c]);
      if (!perIls || perIls <= 0) throw new Error(`missing rate for ${c}`);
      rates[c] = 1 / perIls;
    }

    return NextResponse.json({
      rates,
      updated: data.time_last_update_utc ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'rate_unavailable' }, { status: 502 });
  }
}
