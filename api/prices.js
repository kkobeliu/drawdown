// api/prices.js — 修正006208代號版
const SYMBOLS = {
  VOO:  { yahoo: 'VOO',     name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',     name: '那斯達克',  unit: 'pt'  },
  SOXX: { yahoo: 'SOXX',    name: '費半 SOX',  unit: 'pt'  },
  WTI:  { yahoo: 'CL=F',    name: 'WTI 油價',  unit: 'USD' },
  GC:   { yahoo: 'GC=F',    name: '黃金',      unit: 'USD' },
  TW:   { yahoo: '006208.TW', name: '006208',  unit: 'TWD' },
};

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

async function fetchSymbol(symbol, period1Unix, period2Unix, cacheKey) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1Unix}&period2=${period2Unix}&interval=1d&range=5y&includePrePost=false`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketMonitor/1.0)' }
  });

  if (!res.ok) throw new Error(`Yahoo API ${res.status} for ${symbol}`);
  const json = await res.json();
  const chart = json?.chart?.result?.[0];
  if (!chart) throw new Error(`No data for ${symbol}`);

  const timestamps = chart.timestamp || [];
  const closes = chart.indicators?.quote?.[0]?.close || [];

  let data = timestamps
    .map((ts, i) => ({
      date:  new Date(ts * 1000).toISOString().slice(0, 10),
      price: closes[i] != null ? +closes[i].toFixed(2) : null,
    }))
    .filter(p => p.price != null);

  // 過濾換月跳價異常值：若某點與前一點價差超過 25%，用前一點替換
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].price;
    const curr = data[i].price;
    if (Math.abs(curr - prev) / prev > 0.25) {
      data[i] = { ...data[i], price: prev };
    }
  }

  cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 日期區間解析
  let period1Unix, period2Unix, cacheKeySuffix;
  if (req.query.from && req.query.to) {
    period1Unix = Math.floor(new Date(req.query.from).getTime() / 1000);
    period2Unix = Math.floor(new Date(req.query.to).getTime() / 1000);
    cacheKeySuffix = `${req.query.from}_${req.query.to}`;
  } else {
    const rangeStr = req.query.range || '5y';
    const years = parseInt(rangeStr) || 5;
    period2Unix = Math.floor(Date.now() / 1000);
    period1Unix = period2Unix - years * 365 * 24 * 3600;
    cacheKeySuffix = rangeStr;
  }

  // 支援自訂 symbols 參數（用於新增標的驗證）
  // ?symbols=AAPL 或預設使用 SYMBOLS 設定
  let entries;
  if (req.query.symbols) {
    const customSymbols = req.query.symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    entries = customSymbols.map(s => [s, { yahoo: s, name: s, unit: '' }]);
  } else {
    entries = Object.entries(SYMBOLS);
  }

  try {
    const results = await Promise.allSettled(
      entries.map(([, meta]) => fetchSymbol(meta.yahoo, period1Unix, period2Unix, `${meta.yahoo}_${cacheKeySuffix}`))
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

    res.status(200).json({ tickers, updatedAt: new Date().toISOString(), range: cacheKeySuffix });
  } catch (err) {
    console.error('[prices] Fatal:', err);
    res.status(500).json({ error: err.message });
  }
}
