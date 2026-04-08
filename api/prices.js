// api/prices.js — 美股走 Yahoo、台股走 TWSE + stale 檢查

const SYMBOLS = {
  VOO:  { yahoo: 'VOO',        name: 'VOO',      unit: 'USD' },
  QQQ:  { yahoo: 'QQQ',        name: 'QQQ',      unit: 'USD' },   // 修正
  SOXX: { yahoo: 'SOXX',       name: 'SOXX',     unit: 'USD' },   // 修正
  WTI:  { yahoo: 'CL=F',       name: 'WTI 油價',  unit: 'USD' },
  GC:   { yahoo: 'GC=F',       name: '黃金',      unit: 'USD' },
  TW:   { twse: '006208',      name: '006208',   unit: 'TWD' },
};

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;
const ONE_DAY = 86400;

// ===== 時區格式化 =====
function formatDate(date, tz) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// ===== range 處理 =====
function parseRange(req) {
  let period1, period2, key;

  if (req.query.from && req.query.to) {
    period1 = Math.floor(new Date(req.query.from).getTime() / 1000);
    period2 = Math.floor(new Date(req.query.to).getTime() / 1000) + ONE_DAY;
    key = `${req.query.from}_${req.query.to}`;
  } else {
    const years = parseInt(req.query.range || '5') || 5;
    period2 = Math.floor(Date.now() / 1000) + ONE_DAY;
    period1 = period2 - years * 365 * ONE_DAY;
    key = `${years}y`;
  }

  return { period1, period2, key };
}

// ===== Yahoo (美股) =====
async function fetchYahoo(symbol, p1, p2, key) {
  const cacheKey = `Y_${symbol}_${key}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d`;

  const res = await fetch(url);
  const json = await res.json();

  const chart = json.chart.result[0];
  const tz = chart.meta.exchangeTimezoneName || 'America/New_York';

  const data = chart.timestamp.map((t, i) => ({
    date: formatDate(new Date(t * 1000), tz),
    price: chart.indicators.quote[0].close[i],
  })).filter(x => x.price != null);

  cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

// ===== TWSE =====
async function fetchTWSE(stockNo, p1, p2, key) {
  const cacheKey = `TW_${stockNo}_${key}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const start = new Date(p1 * 1000);
  const end = new Date(p2 * 1000);

  let y = start.getFullYear();
  let m = start.getMonth() + 1;

  const months = [];
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth() + 1)) {
    months.push(`${y}${String(m).padStart(2, '0')}`);
    m++;
    if (m === 13) { m = 1; y++; }
  }

  let all = [];

  for (const ym of months) {
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${ym}01&stockNo=${stockNo}`;
    const res = await fetch(url);
    const json = await res.json();

    const rows = json.data || [];

    for (const r of rows) {
      const [rocDate, , , , , , close] = r;

      if (!close || close === '--') continue;

      const [yy, mm, dd] = rocDate.split('/');
      const date = `${Number(yy)+1911}-${mm}-${dd}`;

      all.push({
        date,
        price: Number(close.replace(/,/g, '')),
      });
    }
  }

  all.sort((a, b) => a.date.localeCompare(b.date));

  // ===== stale 檢查 =====
  const last = new Date(all[all.length - 1].date + 'T00:00:00+08:00');
  const diff = (Date.now() - last) / 86400000;

  if (diff > 7) {
    throw new Error(`TWSE stale: ${stockNo}`);
  }

  cache.set(cacheKey, { ts: Date.now(), data: all });
  return all;
}

// ===== handler =====
export default async function handler(req, res) {
  const { period1, period2, key } = parseRange(req);

  const entries = Object.entries(SYMBOLS);

  const results = await Promise.allSettled(
    entries.map(([_, meta]) => {
      if (meta.twse) return fetchTWSE(meta.twse, period1, period2, key);
      return fetchYahoo(meta.yahoo, period1, period2, key);
    })
  );

  const tickers = entries.map(([_, meta], i) => {
    const r = results[i];

    if (r.status !== 'fulfilled') {
      return { name: meta.name, unit: meta.unit, data: [], labels: [], current: 0, error: true };
    }

    const data = r.value;

    return {
      name: meta.name,
      unit: meta.unit,
      data: data.map(x => x.price),
      labels: data.map(x => x.date),
      current: data.at(-1)?.price || 0,
      error: false,
    };
  });

  res.status(200).json({ tickers });
}
