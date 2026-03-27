// scripts/send-report.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  每日市場回撤 Email 報表
//  使用方式：node scripts/send-report.js
//
//  需要安裝：npm install @sendgrid/mail yahoo-finance2
//  環境變數：
//    SENDGRID_KEY   — SendGrid API Key（免費方案每天 100 封）
//    RECIPIENT      — 收件人 Email（可逗號分隔多人）
//    FROM_EMAIL     — 寄件人 Email（需在 SendGrid 驗證）
//    DD_THRESHOLD   — 回撤警示閾值（預設 10）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import sgMail from '@sendgrid/mail';
import yahooFinance from 'yahoo-finance2';

// ── CONFIG ──────────────────────────────────────────────
const SENDGRID_KEY  = process.env.SENDGRID_KEY;
const RECIPIENTS    = (process.env.RECIPIENT || '').split(',').map(e=>e.trim()).filter(Boolean);
const FROM_EMAIL    = process.env.FROM_EMAIL || 'noreply@yourdomain.com';
const DD_THRESHOLD  = parseFloat(process.env.DD_THRESHOLD || '10');
const TZ            = 'Asia/Taipei';

const SYMBOLS = [
  { key:'VOO',      yahoo:'VOO',     name:'VOO（S&P500）', unit:'USD' },
  { key:'QQQ',      yahoo:'QQQ',     name:'那斯達克 QQQ',  unit:'USD' },
  { key:'SOXX',     yahoo:'SOXX',    name:'費半 SOXX',     unit:'USD' },
  { key:'WTI',      yahoo:'CL=F',    name:'WTI 原油',      unit:'USD' },
  { key:'GOLD',     yahoo:'GC=F',    name:'黃金',          unit:'USD' },
  { key:'006208',   yahoo:'0068.TW', name:'006208（台50）', unit:'TWD' },
];

// ── FETCH DATA ───────────────────────────────────────────
async function fetchDrawdowns() {
  const results = await Promise.allSettled(
    SYMBOLS.map(async s => {
      const hist = await yahooFinance.historical(s.yahoo, {
        period1: (() => { const d=new Date(); d.setFullYear(d.getFullYear()-1); return d; })(),
        interval: '1d',
      });
      const prices = hist.filter(r=>r.close!=null).map(r=>r.close);
      if (!prices.length) throw new Error('no data');

      const cur   = prices[prices.length-1];
      const ath   = Math.max(...prices);
      const dd    = (cur-ath)/ath*100;
      const week  = prices.length>=5 ? (cur-prices[prices.length-5])/prices[prices.length-5]*100 : 0;
      const month = prices.length>=21 ? (cur-prices[prices.length-21])/prices[prices.length-21]*100 : 0;

      return { ...s, cur:+cur.toFixed(2), ath:+ath.toFixed(2),
               dd:+dd.toFixed(2), week:+week.toFixed(2), month:+month.toFixed(2) };
    })
  );

  return results.map((r,i) =>
    r.status==='fulfilled' ? r.value : { ...SYMBOLS[i], error:true, cur:0, ath:0, dd:0 }
  );
}

// ── BUILD HTML EMAIL ────────────────────────────────────
function buildHtml(data, now) {
  const alerts = data.filter(d=>!d.error && Math.abs(d.dd)>DD_THRESHOLD);
  const dateStr = now.toLocaleString('zh-TW', {timeZone:TZ,
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

  const rows = data.map(d => {
    if(d.error) return `<tr><td>${d.name}</td><td colspan="5" style="color:#999">數據取得失敗</td></tr>`;
    const ddColor = Math.abs(d.dd)>20?'#f85a5a':Math.abs(d.dd)>10?'#f5a623':'#22d3a0';
    const wkColor = d.week>=0?'#22d3a0':'#f85a5a';
    const moColor = d.month>=0?'#22d3a0':'#f85a5a';
    const status  = Math.abs(d.dd)>20?'⚠️ 高回撤':Math.abs(d.dd)>10?'⚡ 中回撤':'✅ 健康';
    return `
      <tr style="border-bottom:1px solid #1e293b">
        <td style="padding:12px 16px;font-weight:500">${d.name}</td>
        <td style="padding:12px 16px;font-family:monospace">${d.unit} ${d.cur.toLocaleString()}</td>
        <td style="padding:12px 16px;font-family:monospace;color:${ddColor};font-weight:600">${d.dd.toFixed(2)}%</td>
        <td style="padding:12px 16px;font-family:monospace;color:${wkColor}">${d.week>=0?'+':''}${d.week.toFixed(2)}%</td>
        <td style="padding:12px 16px;font-family:monospace;color:${moColor}">${d.month>=0?'+':''}${d.month.toFixed(2)}%</td>
        <td style="padding:12px 16px">${status}</td>
      </tr>`;
  }).join('');

  const alertBanner = alerts.length ? `
    <div style="background:#1e1010;border:1px solid #f85a5a44;border-radius:8px;padding:14px 18px;margin-bottom:24px">
      <p style="color:#f85a5a;font-weight:600;margin:0 0 8px">⚠️ 回撤警示（超過 ${DD_THRESHOLD}%）</p>
      ${alerts.map(d=>`<p style="margin:4px 0;color:#e2e8f8;font-size:14px">
        <strong>${d.name}</strong>：從高點回撤 <span style="color:#f85a5a">${d.dd.toFixed(2)}%</span>，現價 ${d.unit} ${d.cur.toLocaleString()}
      </p>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f8">
<div style="max-width:640px;margin:0 auto;padding:32px 20px">

  <!-- Header -->
  <div style="margin-bottom:28px">
    <h1 style="font-size:22px;font-weight:600;color:#fff;margin:0 0 4px">📊 市場回撤日報</h1>
    <p style="font-size:13px;color:#8899bb;margin:0">${dateStr}（台灣時間）</p>
  </div>

  ${alertBanner}

  <!-- Table -->
  <div style="background:#111827;border:1px solid #2a3650;border-radius:12px;overflow:hidden;margin-bottom:24px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1a2235;border-bottom:1px solid #2a3650">
          <th style="padding:11px 16px;text-align:left;color:#8899bb;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px">指數</th>
          <th style="padding:11px 16px;text-align:left;color:#8899bb;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px">現價</th>
          <th style="padding:11px 16px;text-align:left;color:#8899bb;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px">從高點</th>
          <th style="padding:11px 16px;text-align:left;color:#8899bb;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px">近1週</th>
          <th style="padding:11px 16px;text-align:left;color:#8899bb;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px">近1月</th>
          <th style="padding:11px 16px;text-align:left;color:#8899bb;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.5px">狀態</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="border-top:1px solid #2a3650;padding-top:16px">
    <p style="font-size:11px;color:#4a5a7a;margin:0;line-height:1.8">
      此報表由自動化系統每日產生 · 數據來源：Yahoo Finance<br>
      警示閾值：從高點回撤超過 ${DD_THRESHOLD}%<br>
      ⚠ 僅供參考，不構成投資建議
    </p>
  </div>
</div>
</body>
</html>`;
}

// ── SEND EMAIL ───────────────────────────────────────────
async function sendEmail(html, hasAlerts) {
  sgMail.setApiKey(SENDGRID_KEY);

  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-TW',{timeZone:TZ,month:'2-digit',day:'2-digit'});
  const subject = hasAlerts
    ? `⚠️ 市場回撤警示 ${dateStr} — 有指數超過 ${DD_THRESHOLD}% 回撤`
    : `📊 市場回撤日報 ${dateStr}`;

  await sgMail.send({
    to: RECIPIENTS,
    from: { email: FROM_EMAIL, name: '市場回撤監控' },
    subject,
    html,
  });
}

// ── MAIN ────────────────────────────────────────────────
async function main() {
  console.log('[report] 開始抓取數據...');

  if (!SENDGRID_KEY) { console.error('❌ 缺少 SENDGRID_KEY'); process.exit(1); }
  if (!RECIPIENTS.length) { console.error('❌ 缺少 RECIPIENT'); process.exit(1); }

  const now = new Date();
  const data = await fetchDrawdowns();

  console.log('[report] 數據取得完成：');
  data.forEach(d => {
    if(d.error) console.log(`  ❌ ${d.name} — 失敗`);
    else console.log(`  ✅ ${d.name}: ${d.cur} (DD: ${d.dd}%)`);
  });

  const hasAlerts = data.some(d=>!d.error && Math.abs(d.dd)>DD_THRESHOLD);
  const html = buildHtml(data, now);
  await sendEmail(html, hasAlerts);

  console.log(`[report] ✅ Email 已寄出至 ${RECIPIENTS.join(', ')}`);
  if(hasAlerts) console.log(`[report] ⚠️  有 ${data.filter(d=>Math.abs(d.dd)>DD_THRESHOLD).length} 個警示`);
}

main().catch(e => { console.error('[report] 錯誤:', e); process.exit(1); });
