const http = await import('http');
const BASE = 'http://localhost:3000';

const allTicks = await new Promise((resolve) => {
  http.get(`${BASE}/api/quantum/stream`, r => {
    let buf = '';
    r.on('data', c => {
      buf += c.toString();
      const parts = buf.split('\n\n');
      for (const part of parts) {
        const line = part.replace('data: ', '');
        if (!line) continue;
        try {
          const d = JSON.parse(line);
          if (d.type === 'snapshot') { r.destroy(); resolve(d.data); }
        } catch {}
      }
    });
  });
});

let mismatchCount = 0;
let totalChecked = 0;
const problems = [];

for (const t of allTicks) {
  if (t.ma60_dev_15m === undefined || t.ma60_dev_15m === null) continue;
  totalChecked++;

  // Replicate exact backend logic: 61 candles, drop last, sum of 59, + livePrice
  const r = await fetch(`${BASE}/api/quantum/klines?symbol=${encodeURIComponent(t.symbol)}&interval=15m&limit=61`);
  const j = await r.json();
  const allCloses = j.candles.map(c => c.close);
  const completed = allCloses.slice(0, -1);
  const last59 = completed.slice(-59);
  const sum59 = last59.reduce((s, v) => s + v, 0);
  const liveMA = (sum59 + t.price) / 60;
  const freshDev = ((t.price - liveMA) / liveMA) * 100;
  const diff = Math.abs(t.ma60_dev_15m - freshDev);

  if (diff > 1) {
    mismatchCount++;
    problems.push({ sym: t.symbol, backend: t.ma60_dev_15m, fresh: Number(freshDev.toFixed(3)), diff: Number(diff.toFixed(1)) });
  }
}

console.log(`=== 15m Deviation Accuracy (sum59 method) ===`);
console.log(`Checked: ${totalChecked} symbols`);
console.log(`Mismatches (>1%): ${mismatchCount}`);
if (problems.length > 0) {
  problems.sort((a, b) => b.diff - a.diff);
  problems.forEach(p => console.log(`  ${p.sym.padEnd(14)} backend=${p.backend}%  fresh=${p.fresh}%  gap=${p.diff}%`));
} else {
  console.log('ALL symbols within 1% accuracy! Fix confirmed.');
}

process.exit(0);
