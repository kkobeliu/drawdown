// api/prices.js — 修正006208代號版
const SYMBOLS = {
  VOO:  { yahoo: 'VOO',     name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',     name: '那斯達克',  unit: 'pt'  },
  SOXX: { yahoo: 'SOXX',    name: '費半 SOX',  unit: 'pt'  },
  WTI:  { yahoo: 'USO',     name: 'WTI 油價',  unit: 'USD' },  // USO ETF 追蹤原油，避免期貨換月跳價問題
  GC:   { yahoo: 'GC=F',    name: '黃金',      unit: 'USD' },
  TW:   { yahoo: '006208.TW', name: '006208',  unit: 'TWD' },
};

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

async function fetchSymbol(symbol, years) {
  const cacheKey = `${symbol}_${years}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const period1 = Math.floor(Date.now() / 1000) - years * 365 * 24 * 3600;
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1wk&includePrePost=false`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketMonitor/1.0)' }
  });

  if (!res.ok) throw new Error(`Yahoo API ${res.status} for ${symbol}`);
  const json = await res.json();
  const chart = json?.chart?.result?.[0];
  if (!chart) throw new Error(`No data for ${symbol}`);

  const timestamps = chart.timestamp || [];
  const closes = chart.indicators?.quote?.[0]?.close || [];

  const data = timestamps
    .map((ts, i) => ({
      date:  new Date(ts * 1000).toISOString().slice(0, 10),
      price: closes[i] != null ? +closes[i].toFixed(2) : null,
    }))
    .filter(p => p.price != null);

  cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rangeStr = req.query.range || '5y';
  const years = parseInt(rangeStr) || 5;

  try {
    const entries = Object.entries(SYMBOLS);
    const results = await Promise.allSettled(
      entries.map(([, meta]) => fetchSymbol(meta.yahoo, years))
    );

    const tickers = entries.map(([, meta], i) => {
      const r = results[i];
      if (r.status === 'rejected') {
        console.error(`[prices] X ${meta.name}:`, r.reason?.message);
        return { name: meta.name, unit: meta.unit, data: [], labels: [], current: 0, error: true };
      }
      const series = r.value;
      return {
        name:    meta.name,
        unit:    meta.unit,
        data:    series.map(p => p.price),
        labels:  series.map(p => p.date),
        current: series.length ? series[series.length - 1].price : 0,
        error:   false,
      };
    });

    res.status(200).json({ tickers, updatedAt: new Date().toISOString(), range: rangeStr });
  } catch (err) {
    console.error('[prices] Fatal:', err);
    res.status(500).json({ error: err.message });
  }
}
