// 使用解構賦值直接抓取內容，避免 .default 的問題
import { default as yf } from 'yahoo-finance2';

const SYMBOLS = {
  VOO:  { yahoo: 'VOO',     name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',     name: '那斯達克',  unit: 'pt'  },
  SOXX: { yahoo: 'SOXX',    name: '費半 SOX',  unit: 'pt'  },
  WTI:  { yahoo: 'CL=F',    name: 'WTI 油價',  unit: 'USD' },
  GC:   { yahoo: 'GC=F',    name: '黃金',      unit: 'USD' },
  TW:   { yahoo: '0068.TW', name: '006208',    unit: 'TWD' },
};

function getStartDate(range) {
  const d = new Date();
  const years = parseInt(range) || 5;
  d.setFullYear(d.getFullYear() - years);
  return d;
}

async function fetchSymbol(symbol, range) {
  const startDate = getStartDate(range);
  
  // 關鍵修正：確保使用的是 yf.chart
  // 如果 yf.chart 還是不行，這行會嘗試自動修正對象層級
  const chartFunc = yf.chart || (yf.default && yf.default.chart);
  
  if (!chartFunc) {
    throw new Error('Yahoo Finance chart function not found');
  }

  const result = await chartFunc.call(yf, symbol, {
    period1: startDate,
    interval: '1d',
  });

  if (!result || !result.quotes) return [];

  return result.quotes
    .map(quote => ({
      date: quote.date instanceof Date ? quote.date.toISOString().slice(0, 10) : new Date(quote.date).toISOString().slice(0, 10),
      price: quote.close
    }))
    .filter(q => q.price != null);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const range = req.query.range || '5y';

  try {
    const entries = Object.entries(SYMBOLS);
    const results = await Promise.allSettled(
      entries.map(([key, meta]) => fetchSymbol(meta.yahoo, range))
    );

    const tickers = entries.map(([key, meta], i) => {
      const result = results[i];
      if (result.status === 'rejected') {
        console.error(`Failed to fetch ${key}:`, result.reason);
        return { name: meta.name, unit: meta.unit, data: [], labels: [], current: 0, error: true };
      }

      const series = result.value;
      return {
        name: meta.name,
        unit: meta.unit,
        data: series.map(r => r.price),
        labels: series.map(r => r.date),
        current: series.length > 0 ? series[series.length - 1].price : 0
      };
    });

    res.status(200).json(tickers);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
}