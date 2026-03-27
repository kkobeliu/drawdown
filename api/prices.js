import * as yfModule from 'yahoo-finance2';

// 解決匯出問題：自動尋找有效的 yahooFinance 對象
const yahooFinance = yfModule.default || yfModule;

const SYMBOLS = {
  VOO:  { yahoo: 'VOO',     name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',     name: '那斯達克',  unit: 'pt'  },
  SOXX: { yahoo: 'SOXX',    name: '費半 SOX',  unit: 'pt'  },
  WTI:  { yahoo: 'CL=F',    name: 'WTI 油價',  unit: 'USD' },
  GC:   { yahoo: 'GC=F',    name: '黃金',      unit: 'USD' },
  TW:   { yahoo: '0068.TW', name: '006208',    unit: 'TWD' },
};

async function fetchSymbol(symbol, range) {
  const d = new Date();
  const years = parseInt(range) || 5;
  d.setFullYear(d.getFullYear() - years);

  // 嘗試找出 chart 函數（相容多種導入路徑）
  const chart = yahooFinance.chart || (yahooFinance.default && yahooFinance.default.chart);
  
  if (!chart) {
    throw new Error(`Yahoo Finance API structure error: ${Object.keys(yahooFinance)}`);
  }

  // 使用 .call 確保 this 綁定正確
  const result = await chart.call(yahooFinance, symbol, {
    period1: d,
    interval: '1d',
  });

  if (!result || !result.quotes) return [];

  return result.quotes
    .map(quote => ({
      date: new Date(quote.date).toISOString().slice(0, 10),
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
      return {
        name: meta.name,
        unit: meta.unit,
        data: result.value.map(r => r.price),
        labels: result.value.map(r => r.date),
        current: result.value.length > 0 ? result.value[result.value.length - 1].price : 0
      };
    });

    res.status(200).json(tickers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}