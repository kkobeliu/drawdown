// api/prices.js — 修正版
// 問題：yahoo-finance2 在 Vercel ESM 環境下 .chart() 無法使用
// 解法：改用 .historical()，並用 createRequire 強制 CommonJS 載入

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const yahooFinance = require('yahoo-finance2').default;

const SYMBOLS = {
  VOO:  { yahoo: 'VOO',     name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',     name: '那斯達克',  unit: 'pt'  },
  SOXX: { yahoo: 'SOXX',    name: '費半 SOX',  unit: 'pt'  },
  WTI:  { yahoo: 'CL=F',    name: 'WTI 油價',  unit: 'USD' },
  GC:   { yahoo: 'GC=F',    name: '黃金',      unit: 'USD' },
  TW:   { yahoo: '0068.TW', name: '006208',    unit: 'TWD' },
};

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

async function fetchSymbol(symbol, years) {
  const cacheKey = `${symbol}_${years}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - years);

  const rows = await yahooFinance.historical(symbol, {
    period1,
    interval: '1wk',
  });

  const data = rows
    .filter(r => r.close != null)
    .map(r => ({
      date:  r.date.toISOString().slice(0, 10),
      price: +r.close.toFixed(2),
    }));

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
        console.error(`[prices] X ${meta.name}:`, r.reason?.message || r.reason);
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