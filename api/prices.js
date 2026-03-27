// pages/api/prices.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Market Drawdown API
//  GET /api/prices?range=5y
//
//  需要安裝：npm install yahoo-finance2
//  台股 006208 使用 Yahoo 代號 "0068.TW"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import yahooFinance from 'yahoo-finance2';

// 指數對應的 Yahoo Finance symbol
const SYMBOLS = {
  VOO:  { yahoo: 'VOO',     name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',     name: '那斯達克',  unit: 'pt'  },  // 用 QQQ 代替那斯達克指數
  SOXX: { yahoo: 'SOXX',    name: '費半 SOX',  unit: 'pt'  },  // iShares 費半 ETF
  WTI:  { yahoo: 'CL=F',    name: 'WTI 油價',  unit: 'USD' },  // WTI 原油期貨
  GC:   { yahoo: 'GC=F',    name: '黃金',      unit: 'USD' },  // 黃金期貨
  TW:   { yahoo: '0068.TW', name: '006208',    unit: 'TWD' },  // 富邦台50
};

// 快取：避免每次請求都打 Yahoo Finance（Vercel 無狀態，這是 in-memory cache）
const cache = {};
const CACHE_TTL = 1000 * 60 * 30; // 30 分鐘

function rangeToYF(range) {
  const map = { '1y':'1y', '3y':'5y', '5y':'5y', '10y':'10y' };
  return map[range] || '5y';
}

async function fetchSymbol(symbol, range) {
  const key = `${symbol}_${range}`;
  const now = Date.now();

  if (cache[key] && now - cache[key].ts < CACHE_TTL) {
    return cache[key].data;
  }

  const result = await yahooFinance.historical(symbol, {
    period1: getStartDate(range),
    interval: '1wk',  // 週線，減少數據量
  });

  const data = result
    .filter(r => r.close != null)
    .map(r => ({ date: r.date.toISOString().slice(0,10), price: +r.close.toFixed(2) }));

  cache[key] = { ts: now, data };
  return data;
}

function getStartDate(range) {
  const d = new Date();
  const years = parseInt(range) || 5;
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0,10);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const range = req.query.range || '5y'; // '1y' | '3y' | '5y' | '10y'

  try {
    // 並行抓取所有指數
    const entries = Object.entries(SYMBOLS);
    const results = await Promise.allSettled(
      entries.map(([key, meta]) => fetchSymbol(meta.yahoo, range))
    );

    const tickers = entries.map(([key, meta], i) => {
      const result = results[i];
      if (result.status === 'rejected') {
        console.error(`Failed to fetch ${key}:`, result.reason);
        return { name: meta.name, unit: meta.unit, data: [], error: true };
      }

      const series = result.value;
      return {
        name: meta.name,
        unit: meta.unit,
        data: series.map(r => r.price),   // 純價格陣列
        labels: series.map(r => r.date),  // 日期陣列
        current: series[series.length - 1]?.price || 0,
      };
    });

    // 找最近一個有數據的日期作為更新時間
    const updatedAt = new Date().toISOString();

    res.status(200).json({ tickers, updatedAt, range });

  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to fetch market data', detail: error.message });
  }
}
