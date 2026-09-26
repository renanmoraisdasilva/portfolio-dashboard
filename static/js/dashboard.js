async function testNotify() {
  const btn = document.getElementById('testNotifyBtn');
  const message = prompt('Enter test notification message (leave blank for default)') || 'Test notification from portfolio-dashboard';
  const title = 'Portfolio Test Notification';
  try {
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const res = await fetch('/api/alerts/test-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message })
    });

    if (!res.ok) {
      let details = '';
      try { const j = await res.json(); details = j && j.details ? ' — ' + j.details : ''; } catch(e) {}
      showToast('Notification failed' + details, 'error');
      console.error('Test notify failed', res.status, await res.text());
    } else {
      showToast('Notification sent successfully', 'success');
    }
  } catch (err) {
    console.error('Failed to call test notify', err);
    showToast('Error sending notification: ' + (err && err.message ? err.message : String(err)), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Notify';
  }
}

function showToast(text, kind = 'success', timeout = 4000) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind === 'error' ? 'error' : 'success');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.addEventListener('transitionend', () => t.remove()); }, timeout - 200);
  setTimeout(() => { if (t.parentNode) t.remove(); }, timeout + 200);
}

async function clearHistory() {
  try {
    await fetch('/api/history', { method: 'DELETE' });
  } catch (err) {
    console.warn('Failed to clear history on server, clearing local history only', err);
  }
  history = [];
  refresh();
  alert('History cleared!');
}

let prices = {};
let priceMeta = {}; // keyed by symbol; holds bond meta (priceBRL, taxaCompra, taxaVenda, etc.)
let history = [];
let trades = [];
let allocationShowCash = localStorage.getItem('allocationShowCash') !== 'false'; // default true

function setAllocationMode(mode) {
  allocationShowCash = mode === 'withCash';
  localStorage.setItem('allocationShowCash', allocationShowCash ? 'true' : 'false');
  // toggle active classes
  const withBtn = document.getElementById('allocWithCashBtn');
  const invBtn = document.getElementById('allocInvestmentsBtn');
  if (withBtn && invBtn) {
    withBtn.classList.toggle('active', allocationShowCash);
    invBtn.classList.toggle('active', !allocationShowCash);
  }
  // recompute current positions and refresh the allocation chart
  try {
    const lots = buildLotsFromTrades();
    const positions = computePositionsFromLots(lots);
    refreshCharts(positions, lots);
  } catch (err) {
    // fallback: do a full refresh if helpers aren't available yet
    refresh();
  }
}

let cashReais = 0;
let cashDollars = 0;
let knownSymbols = { all: [], detailed: {}, crypto: [], stocks: [], currencies: [] };
function isBRLAsset(s) { return !!(knownSymbols.detailed[s] && knownSymbols.detailed[s].denominatedInBRL); }
function isBRLNonBond(s) { return isBRLAsset(s) && !(knownSymbols.detailed[s] && knownSymbols.detailed[s].type === 'bond'); }
function isBRLBond(s) { return isBRLAsset(s) && !!(knownSymbols.detailed[s] && knownSymbols.detailed[s].type === 'bond'); }

async function loadSymbols() {
  if (knownSymbols.all.length > 0) return;
  try {
    const res = await fetch('/api/config/symbols');
    if (!res.ok) throw new Error('Failed to load symbols');
    knownSymbols = await res.json();
  } catch (e) {
    console.warn('Failed to load symbols from server; using defaults', e);
    knownSymbols = {
      all: ['BTC','ETH','SOL','SPY','GLD','IBIT','BRLUSD'],
      crypto: ['BTC','ETH','SOL'],
      stocks: ['SPY','GLD','IBIT'],
      currencies: ['BRLUSD'],
      detailed: {}
    };
  }
  // Populate trade asset select
  const symbolSel = document.getElementById('symbol');
  if (symbolSel && symbolSel.options.length === 0) {
    for (const s of knownSymbols.all) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      symbolSel.appendChild(opt);
    }
  }
  // Populate alert asset select (keep blank first option)
  const alertSel = document.getElementById('alertSymbol');
  if (alertSel) {
    const existing = new Set([...alertSel.options].map(o => o.value));
    for (const s of knownSymbols.all) {
      if (!existing.has(s)) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        alertSel.appendChild(opt);
      }
    }
  }
}
let interestReais = 0;
let interestDollars = 0;
let interestReaisMonths = [];
let interestDollarsMonths = [];
let interestMonthsCollapsed = true; // default collapsed on page load
let interestUSDMonthsCollapsed = true;
let cdiRate = 0;
let brlUsdRate = 0;

async function loadStateFromServer() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('Failed to fetch state from server');
    const s = await res.json();
    trades = s.trades || [];
    history = s.history || [];
    cashReais = Number(s.cashReais) || 0;
    cashDollars = Number(s.cashDollars) || 0;
    interestReais = Number(s.interestReais) || 0;
    interestDollars = Number(s.interestDollars) || 0;
    interestReaisMonths = s.interestReaisMonths || [];
    interestDollarsMonths = s.interestDollarsMonths || [];
    // keep UI preference local (if user has previously set it)
    const storedCollapsed = localStorage.getItem('interestMonthsCollapsed');
    if (storedCollapsed !== null) interestMonthsCollapsed = storedCollapsed === 'true';
    const storedUSDCollapsed = localStorage.getItem('interestUSDMonthsCollapsed');
    if (storedUSDCollapsed !== null) interestUSDMonthsCollapsed = storedUSDCollapsed === 'true';
    // write a local backup
    save();
  } catch (err) {
    console.warn('Could not load state from server', err);
    history = [];
    trades = [];

    cashReais = 0;
    cashDollars = 0;
    interestReais = 0;
    interestDollars = 0;
    interestReaisMonths = [];
    interestDollarsMonths = [];
    const storedCollapsedFallback = localStorage.getItem('interestMonthsCollapsed');
    if (storedCollapsedFallback !== null) interestMonthsCollapsed = storedCollapsedFallback === 'true';
  }

  // Ensure cash inputs show localized formatted values on load
  const cr = document.getElementById('cashReais');
  const cd = document.getElementById('cashDollars');
  if (cr) cr.value = formatMoney(cashReais, 'BRL');
  if (cd) cd.value = formatMoney(cashDollars, 'USD');
}

function save() {
  // persist only UI preferences locally; financial data lives exclusively on the server
  localStorage.setItem('interestMonthsCollapsed', interestMonthsCollapsed ? 'true' : 'false');
  localStorage.setItem('interestUSDMonthsCollapsed', interestUSDMonthsCollapsed ? 'true' : 'false');
}

const allocationCtx = document.getElementById("allocationChart");
const plCtx = document.getElementById("plChart");

let valueChart = null;
let valueSeries = null;
let projSeries = null;
let valueResizeObserver = null;
let activeMetric = 'value'; // 'value' | 'pnl'
let historyOHLC = [];      // value OHLC
let pnlOHLC = [];          // P/L OHLC

async function loadHistoryOHLC(range, metric = 'value') {
  try {
    const url = '/api/history/ohlc?range=' + encodeURIComponent(range) + '&metric=' + metric;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('Failed to load OHLC history', err);
    return [];
  }
}

function createValueChart() {
  const valueChartContainer = document.getElementById('valueChart');
  if (!valueChartContainer || valueChart) return;

  valueChart = LightweightCharts.createChart(valueChartContainer, {
    width: valueChartContainer.clientWidth || 800,
    height: valueChartContainer.clientHeight || 320,
    layout: {
      background: { color: 'transparent' },
      textColor: '#94a3b8',
    },
    grid: {
      vertLines: { color: 'rgba(45,55,72,0.5)' },
      horzLines: { color: 'rgba(45,55,72,0.5)' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(45,55,72,0.5)' },
    timeScale: {
      borderColor: 'rgba(45,55,72,0.5)',
      timeVisible: true,
      secondsVisible: false,
      barSpacing: 8,
      minBarSpacing: 4,
      fixRightEdge: true,
      rightOffset: 5,
    },
  });

  valueSeries = valueChart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    priceLineVisible: false,
    lastValueVisible: true,
  });

  projSeries = valueChart.addLineSeries({
    color: 'rgba(0, 217, 255, 0.85)',
    lineWidth: 1.8,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    visible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: true,
  });

  valueResizeObserver = new ResizeObserver(() => {
    if (valueChart && valueChartContainer) {
      valueChart.applyOptions({ width: valueChartContainer.clientWidth });
    }
  });
  valueResizeObserver.observe(valueChartContainer);
}

createValueChart();

// Doughnut labeling plugin: draw name + pct inside sufficiently large slices with a dark rounded background; list small slices in the center
const pieLabelPlugin = {
  id: 'pieLabelPlugin',
  afterDraw(chart, args, options) {
    if (chart.canvas.id !== 'allocationChart') return;
    const { ctx } = chart;
    const dataset = chart.data.datasets[0];
    const meta = chart.getDatasetMeta(0);
    const total = dataset.data.reduce((a, b) => a + b, 0);
    ctx.save();

    const threshold = (options && typeof options.threshold === 'number') ? options.threshold : 5; // percent threshold
    const textColor = (options && options.textColor) || '#fff';
    const nameFont = (options && options.nameFont) || 'bold 12px system-ui, sans-serif';
    const pctFont = (options && options.pctFont) || '11px system-ui, sans-serif';
    const padX = 8; // horizontal padding (reduced)
    const padY = 6; // vertical padding (increased slightly)

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y,   x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x,   y + h, r);
      ctx.arcTo(x,   y + h, x,   y,   r);
      ctx.arcTo(x,   y,   x + w, y,   r);
      ctx.closePath();
    }

    const smallItems = [];
    meta.data.forEach((arc, i) => {
      const pct = total > 0 ? (dataset.data[i] / total) * 100 : 0;
      const mid = (arc.startAngle + arc.endAngle) / 2;
      const cx = arc.x;
      const cy = arc.y;
      const radius = (arc.outerRadius + arc.innerRadius) / 2;
      const x = cx + Math.cos(mid) * radius;
      const y = cy + Math.sin(mid) * radius;

      if (pct >= threshold) {
        // draw a rounded dark pill with name and percentage
        ctx.save();
        ctx.fillStyle = 'rgba(10,14,26,0.72)';
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;

        ctx.font = nameFont;
        const name = chart.data.labels[i] || '';
        const nameW = ctx.measureText(name).width;
        ctx.font = pctFont;
        const pctText = `${pct.toFixed(1)}%`;
        const pctW = ctx.measureText(pctText).width;
        const w = Math.max(nameW, pctW) + padX * 2;
        const h = 20 + padY * 2; // adjust height with vertical padding
        roundRect(x - w / 2, y - h / 2, w, h, 8);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.font = nameFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, x, y - (padY / 2 + 2));
        ctx.font = pctFont;
        ctx.fillText(pctText, x, y + (padY / 2 + 6));
        ctx.restore();
      } else {
        smallItems.push({ label: chart.data.labels[i] || '', pct: pct });
      }
    });

    // Draw small items list in the center of the doughnut
    if (smallItems.length > 0) {
      ctx.save();
      const centerX = chart.width / 2;
      const centerY = chart.height / 2;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = smallItems.map(s => `${s.label} ${s.pct.toFixed(1)}%`);
      const lineHeight = 16;
      const totalH = lines.length * lineHeight;
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], centerX, centerY - totalH / 2 + i * lineHeight + lineHeight / 2);
      ctx.restore();
    }

    ctx.restore();
  }
};
Chart.register(pieLabelPlugin);

const allocationChart = new Chart(allocationCtx, {
  type: 'doughnut',
  data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: '#0a0e1a', borderWidth: 2 }] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '48%',
    layout: { padding: { top: 8, right: 8, bottom: 8, left: 8 } },
    plugins: { legend: { display: false } }
  }
});

// allocation currency toggle wiring (default USD)
window.allocCurrency = localStorage.getItem('allocCurrency') || 'USD';
function setupAllocCurrencyBtns() {
  const usdB = document.getElementById('allocUsdBtn');
  const brlB = document.getElementById('allocBrlBtn');
  if (usdB) usdB.addEventListener('click', () => { window.allocCurrency = 'USD'; localStorage.setItem('allocCurrency', 'USD'); refresh(); });
  if (brlB) brlB.addEventListener('click', () => { window.allocCurrency = 'BRL'; localStorage.setItem('allocCurrency', 'BRL'); refresh(); });
}
setupAllocCurrencyBtns();

const plChart = new Chart(plCtx, {
  type: 'bar',
  data: { labels: [], datasets: [{ label: 'Unrealized P/L', data: [], backgroundColor: [], borderWidth: 1 }] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#2d3748' } },
      x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
    }
  }
});



async function updateCashPositions() {
  const crEl = document.getElementById('cashReais');
  const cdEl = document.getElementById('cashDollars');
  if (crEl) cashReais = +parseMoney(crEl.value, 'BRL').toFixed(2);
  if (cdEl) cashDollars = +parseMoney(cdEl.value, 'USD').toFixed(2);
  save();
  updateInterestMonthsUI();
  updateInterestUSDMonthsUI();

  // keep inputs formatted after saving
  if (crEl) crEl.value = formatMoney(cashReais, 'BRL');
  if (cdEl) cdEl.value = formatMoney(cashDollars, 'USD');

  refresh();
}

async function addInterestMonth() {
  const month = document.getElementById('interestMonth').value; // format YYYY-MM
  const raw = document.getElementById('interestMonthAmount').value;
  const amount = +parseMoney(raw, 'BRL').toFixed(2) || 0;
  if (!month) return alert('Please select a month');
  // replace or add
  const idx = interestReaisMonths.findIndex(m => m.month === month);
  if (idx >= 0) interestReaisMonths[idx].amount = amount;
  else interestReaisMonths.push({ month, amount });
  // keep sorted newest-first
  interestReaisMonths.sort((a,b) => b.month.localeCompare(a.month));
  // limit to 12 months
  if (interestReaisMonths.length > 12) {
    alert('Keeping only latest 12 months; oldest entry removed.');
    interestReaisMonths = interestReaisMonths.slice(0,12);
  }
  // when adding a month, auto-expand list so user sees the new entry
  interestMonthsCollapsed = false;
  save();
  updateInterestMonthsUI();
  try {
    await fetch('/api/interest/months', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, amount }) });
  } catch (err) {
    console.warn('Failed to sync interest month to server', err);
  }
  refresh();
  document.getElementById('interestMonth').value = '';
  document.getElementById('interestMonthAmount').value = '';
}

async function deleteInterestMonth(month) {
  interestReaisMonths = interestReaisMonths.filter(m => m.month !== month);
  save();
  updateInterestMonthsUI();
  try {
    await fetch(`/api/interest/months/${month}`, { method: 'DELETE' });
  } catch (err) {
    console.warn('Failed to delete interest month on server', err);
  }
  refresh();
}

function updateInterestMonthsUI() {
  const container = document.getElementById('interestMonthsList');
  if (!container) return;
  const summaryEl = document.getElementById('interestMonthsSummary');
  const rowsEl = document.getElementById('interestMonthsRows');
  const toggleBtn = document.getElementById('toggleInterestListBtn');

  if (!interestReaisMonths || interestReaisMonths.length === 0) {
    if (summaryEl) summaryEl.innerHTML = '<div class="empty-state">No monthly interest recorded.</div>';
    if (rowsEl) rowsEl.innerHTML = '';
    if (toggleBtn) {
      toggleBtn.style.display = 'none';
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  const total = interestReaisMonths.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  if (summaryEl) summaryEl.innerHTML = `${interestReaisMonths.length} month(s) recorded • Total: ${formatMoney(total, 'BRL')}`;
  if (toggleBtn) {
    toggleBtn.style.display = '';
    toggleBtn.innerText = interestMonthsCollapsed ? 'Show ▲' : 'Hide ▼';
    toggleBtn.setAttribute('aria-expanded', interestMonthsCollapsed ? 'false' : 'true');
  }

  const rows = interestReaisMonths.map(m => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="flex:1">${m.month}</div>
      <div style="width:120px;text-align:right">${formatMoney(Number(m.amount || 0), 'BRL')}</div>
      <div><button class="btn btn-danger" style="padding:4px 8px" onclick="deleteInterestMonth('${m.month}')">Delete</button></div>
    </div>
  `).join('');

  if (rowsEl) {
    rowsEl.innerHTML = rows + `<div style="margin-top:8px;font-size:0.9rem;color:#94a3b8">Total (months recorded): R$ ${total.toFixed(2)}</div>`;
    rowsEl.style.display = interestMonthsCollapsed ? 'none' : '';
  }
}

function toggleInterestList() {
  interestMonthsCollapsed = !interestMonthsCollapsed;
  localStorage.setItem('interestMonthsCollapsed', interestMonthsCollapsed ? 'true' : 'false');
  updateInterestMonthsUI();
}

async function addInterestUSDMonth() {
  const month = document.getElementById('interestUSDMonth').value;
  const raw = document.getElementById('interestUSDMonthAmount').value;
  const amount = +parseMoney(raw, 'USD').toFixed(2) || 0;
  if (!month) return alert('Please select a month');
  const idx = interestDollarsMonths.findIndex(m => m.month === month);
  if (idx >= 0) interestDollarsMonths[idx].amount = amount;
  else interestDollarsMonths.push({ month, amount, currency: 'USD' });
  interestDollarsMonths.sort((a, b) => b.month.localeCompare(a.month));
  interestUSDMonthsCollapsed = false;
  save();
  updateInterestUSDMonthsUI();
  try {
    await fetch('/api/interest/months', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, amount, currency: 'USD' }) });
  } catch (err) {
    console.warn('Failed to sync USD interest month to server', err);
  }
  refresh();
  document.getElementById('interestUSDMonth').value = '';
  document.getElementById('interestUSDMonthAmount').value = '';
}

async function deleteInterestUSDMonth(month) {
  interestDollarsMonths = interestDollarsMonths.filter(m => m.month !== month);
  save();
  updateInterestUSDMonthsUI();
  try {
    await fetch(`/api/interest/months/${month}?currency=USD`, { method: 'DELETE' });
  } catch (err) {
    console.warn('Failed to delete USD interest month on server', err);
  }
  refresh();
}

function updateInterestUSDMonthsUI() {
  const summaryEl = document.getElementById('interestUSDMonthsSummary');
  const rowsEl = document.getElementById('interestUSDMonthsRows');
  const toggleBtn = document.getElementById('toggleInterestUSDListBtn');

  if (!interestDollarsMonths || interestDollarsMonths.length === 0) {
    if (summaryEl) summaryEl.innerHTML = '<div class="empty-state">No monthly USD interest recorded.</div>';
    if (rowsEl) rowsEl.innerHTML = '';
    if (toggleBtn) { toggleBtn.style.display = 'none'; toggleBtn.setAttribute('aria-expanded', 'false'); }
    return;
  }

  const total = interestDollarsMonths.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  if (summaryEl) summaryEl.innerHTML = `${interestDollarsMonths.length} month(s) recorded • Total: ${formatMoney(total, 'USD')}`;
  if (toggleBtn) {
    toggleBtn.style.display = '';
    toggleBtn.innerText = interestUSDMonthsCollapsed ? 'Show ▲' : 'Hide ▼';
    toggleBtn.setAttribute('aria-expanded', interestUSDMonthsCollapsed ? 'false' : 'true');
  }

  const rows = interestDollarsMonths.map(m => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="flex:1">${m.month}</div>
      <div style="width:120px;text-align:right">${formatMoney(Number(m.amount || 0), 'USD')}</div>
      <div><button class="btn btn-danger" style="padding:4px 8px" onclick="deleteInterestUSDMonth('${m.month}')">Delete</button></div>
    </div>
  `).join('');

  if (rowsEl) {
    rowsEl.innerHTML = rows + `<div style="margin-top:8px;font-size:0.9rem;color:#94a3b8">Total (months recorded): $ ${total.toFixed(2)}</div>`;
    rowsEl.style.display = interestUSDMonthsCollapsed ? 'none' : '';
  }
}

function toggleInterestUSDList() {
  interestUSDMonthsCollapsed = !interestUSDMonthsCollapsed;
  localStorage.setItem('interestUSDMonthsCollapsed', interestUSDMonthsCollapsed ? 'true' : 'false');
  updateInterestUSDMonthsUI();
}

async function exportData() {
  try {
    const resp = await fetch('/api/state/export');
    if (!resp.ok) throw new Error('Export failed');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portfolio_data.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return;
  } catch (err) {
    console.warn('Server export failed, falling back to local export', err);
  }
  const data = {
    trades,
    history,
    cashReais,
    cashDollars,
    interestReais,
    interestDollars,
    interestReaisMonths
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'portfolio_data.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      // If it's a portfolio export, import to portfolio server/state
      if (Array.isArray(data.trades) && Array.isArray(data.history)) {
        try {
          const resp = await fetch('/api/state/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
          if (!resp.ok) throw new Error('Server import failed');
          alert('Data imported to server!');
          await loadStateFromServer();
          await refresh();
          return;
        } catch (err) {
          console.warn('Server import failed, importing locally', err);
        }
        trades = data.trades;
        history = data.history;
        cashReais = typeof data.cashReais === 'number' ? data.cashReais : 0;
        cashDollars = typeof data.cashDollars === 'number' ? data.cashDollars : 0;
        interestReais = typeof data.interestReais === 'number' ? data.interestReais : 0;
        interestDollars = typeof data.interestDollars === 'number' ? data.interestDollars : 0;
        interestReaisMonths = Array.isArray(data.interestReaisMonths) ? data.interestReaisMonths : [];
        save();
        refresh();
        alert('Data imported locally!');
      } else {
        alert('Invalid file format.');
      }
    } catch (err) {
      alert('Invalid JSON.');
    }
  };
  reader.readAsText(file);
}

function showEraseModal() {
  document.getElementById('modal').style.display = '';
}
function hideEraseModal() {
  document.getElementById('modal').style.display = 'none';
}
function openSettingsModal() {
  document.getElementById('settingsModal').style.display = '';
}
function closeSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
}
function eraseAll() {
  trades = [];
  history = [];
  // Clear cash and interest data as well
  cashReais = 0;
  cashDollars = 0;
  interestReais = 0;
  interestDollars = 0;
  interestReaisMonths = [];
  interestMonthsCollapsed = false;
  save();
  refresh();
  hideEraseModal();
}


async function addTrade() {
  // For BRL bonds the price field shows R$; convert to USD for storage. BRL non-bond stores BRL as-is.
  const rawInputPrice = price.value ? parseFloat(price.value) : null;
  let resolvedPrice;
  if (isBRLBond(symbol.value)) {
    const brlP = rawInputPrice !== null ? rawInputPrice
      : (priceMeta[symbol.value] && typeof priceMeta[symbol.value].priceBRL === 'number' ? priceMeta[symbol.value].priceBRL
        : (prices[symbol.value] && brlUsdRate > 0 ? prices[symbol.value] / brlUsdRate : null));
    resolvedPrice = brlP !== null && brlUsdRate > 0 ? brlP / brlUsdRate : (prices[symbol.value] || null);
  } else {
    resolvedPrice = rawInputPrice !== null ? rawInputPrice : (prices[symbol.value] || null);
  }
  const trade = {
    symbol: symbol.value,
    side: side.value,
    qty: parseFloat(qty.value),
    price: resolvedPrice,
    time: new Date().toISOString(),
    _tmpId: 'tmp-' + Date.now() + '-' + Math.floor(Math.random()*1000)
  };

  // Optimistic local update — push trade and refresh UI now
  trades.push(trade);
  save();
  updateAvailDisplay();
  const lots = buildLotsFromTrades();
  const positions = computePositionsFromLots(lots);
  const investedWithCash = computeInvestedFromLots(lots);
  let total = 0;
  for (const s in positions) total += positions[s] * (prices[s] || 0);
  total += cashReais * brlUsdRate;
  total += cashDollars;
  refreshUI(total, investedWithCash, positions, lots);

  // Persist to server in background — replace optimistic trade with server one if successful
  (async () => {
    try {
      const cashSource = document.getElementById('cashSource').value || 'USD';
      const tradePayload = { ...trade, cashSource };
      const res = await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tradePayload) });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Server rejected trade');
      }
      const data = await res.json();
      const idx = trades.findIndex(t => t._tmpId && t._tmpId === trade._tmpId);
      if (idx >= 0) {
        trades[idx] = data.trade;
        save();
        refresh();
        _cashEntriesAll = null; // Clear cache to fetch fresh entries
        await loadCashEntries();
        // Show confirmation with actual server-created cash entry
        if (data.cashEntry) {
          const amount = Math.abs(data.cashEntry.amount);
          const currency = data.cashEntry.currency === 'BRL' ? 'BRL' : 'USD';
          const symbol = currency === 'BRL' ? 'R$ ' : '$';
          const formatted = currency === 'BRL' 
            ? amount.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
            : amount.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
          showToast(`Trade recorded. Cash ${trade.side === 'buy' ? 'deducted' : 'added'}: ${symbol}${formatted} ${currency}`, 'success');
        }
      }
    } catch (err) {
      console.warn('Failed to persist trade to server', err);
      showToast(`Error: ${err.message}`, 'error', 5000);
      // Keep local record but mark it as failed sync
      save();
      refresh();
    }
  })();

  // clear inputs and update cash form fields
  symbol.value = 'BTC';
  side.value = 'buy';
  qty.value = '';
  price.value = '';
  document.getElementById('tradeTotal').value = '';
  const crEl = document.getElementById('cashReais'); if (crEl) crEl.value = (cashReais !== undefined && cashReais !== null) ? formatMoney(cashReais,'BRL') : '';
  const cdEl = document.getElementById('cashDollars'); if (cdEl) cdEl.value = (cashDollars !== undefined && cashDollars !== null) ? formatMoney(cashDollars,'USD') : '';
}



// Manual "Add Point" functionality removed — history points are now collected automatically by the server's scheduler.

// --- Trade helpers: quantity/total sliders, cash source and auto-deduct ---
function formatMoney(val, currency){
  if (typeof val !== 'number') val = Number(val) || 0;
  if (currency === 'BRL') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}
function parseMoney(str, currency){
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if (cleaned === '') return 0;
  if (currency === 'BRL'){
    const normalized = cleaned.replace(/\./g,'').replace(/,/g,'.');
    return parseFloat(normalized) || 0;
  }
  const normalized = cleaned.replace(/,/g,'');
  return parseFloat(normalized) || 0;
}

// compute qty from pct (for buy -> pct of available cash; for sell -> pct of position)
function computeQtyFromPct(symbol, pct){
  const side = document.getElementById('side').value;
  const priceInputVal = document.getElementById('price').value;
  const price = priceInputVal ? parseFloat(priceInputVal) : (prices[symbol] || 0);
  if (!price || price <= 0) return 0;
  if (side === 'sell'){
    const lots = buildLotsFromTrades();
    const pos = (lots[symbol] || []).reduce((s,l)=>s+l.qty,0);
    return +( (pos * pct / 100) ).toFixed(4);
  } else {
    const source = document.getElementById('cashSource').value || 'USD';
    if (isBRLNonBond(symbol)) {
      // price is in BRL; compute qty directly from BRL available
      const availBRL = source === 'USD' ? (cashDollars || 0) / (brlUsdRate || 1) : (cashReais || 0);
      return +((availBRL * pct / 100) / price).toFixed(4);
    }
    let availableUsd = 0;
    if (source === 'USD') availableUsd = cashDollars || 0;
    else availableUsd = (cashReais || 0) * brlUsdRate;
    const qty = (availableUsd * (pct/100)) / price;
    return +(qty).toFixed(4);
  }
}

// Validate and enable/disable Add Trade button
// live available cash updater used by trade UI
function updateAvailDisplay(){
  const u = document.getElementById('availUsd');
  const r = document.getElementById('availBrl');
  if (u) u.textContent = `$${(cashDollars || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  if (r) r.textContent = `R$ ${(cashReais || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

function updateTotalFromQty(){
  const q = parseFloat(document.getElementById('qty').value) || 0;
  const symVal = document.getElementById('symbol').value;
  const priceVal = parseFloat(document.getElementById('price').value) || prices[symVal] || 0;
  if (!priceVal || priceVal <= 0) return;
  const source = document.getElementById('cashSource').value || 'USD';
  if (isBRLAsset(symVal)) {
    // priceVal is in BRL for both BRL non-bond and BRL bond (bond price field shows BRL)
    const brl = q * priceVal;
    document.getElementById('tradeTotal').value = source === 'USD' ? formatMoney(brl * brlUsdRate, 'USD') : formatMoney(brl, 'BRL');
  } else {
    const usd = q * priceVal;
    document.getElementById('tradeTotal').value = source === 'USD' ? formatMoney(usd,'USD') : formatMoney(usd / brlUsdRate, 'BRL');
  }
}
function updateQtyFromTotal(){
  const source = document.getElementById('cashSource').value || 'USD';
  const symVal = document.getElementById('symbol').value;
  const raw = document.getElementById('tradeTotal').value;
  const total = parseMoney(raw, source === 'USD' ? 'USD' : 'BRL');
  if (!total || total <= 0) return;
  const priceVal = parseFloat(document.getElementById('price').value) || prices[symVal] || 0;
  if (!priceVal || priceVal <= 0) return;
  let q;
  if (isBRLAsset(symVal)) {
    // priceVal is in BRL; total is in selected currency
    const totalBRL = source === 'USD' ? total / brlUsdRate : total;
    q = +(totalBRL / priceVal).toFixed(4);
  } else {
    const totalUsd = source === 'USD' ? total : (total * brlUsdRate);
    q = +(totalUsd / priceVal).toFixed(4);
  }
  document.getElementById('qty').value = q;
}

// wire up controls
(function(){
  const qtyInc = document.getElementById('qtyInc');
  const qtyDec = document.getElementById('qtyDec');
  const priceInc = document.getElementById('priceInc');
  const priceDec = document.getElementById('priceDec');
  const qtyEl = document.getElementById('qty');
  const priceEl = document.getElementById('price');
  const qtyPct = document.getElementById('qtyPct');
  const qtyPctLabel = document.getElementById('qtyPctLabel');
  const maxBtn = document.getElementById('maxQtyBtn');
  const totalEl = document.getElementById('tradeTotal');
  const cashUSD = document.getElementById('cashUSD');
  const cashBRL = document.getElementById('cashBRL');

  if(qtyInc){ qtyInc.addEventListener('click', ()=>{ qtyEl.stepUp(1); qtyEl.dispatchEvent(new Event('change')); }); }
  if(qtyDec){ qtyDec.addEventListener('click', ()=>{ qtyEl.stepDown(1); qtyEl.dispatchEvent(new Event('change')); }); }
  if(priceInc){ priceInc.addEventListener('click', ()=>{ const cur = parseFloat(priceEl.value) || 0; priceEl.value = +(cur + 1).toFixed(2); priceEl.dispatchEvent(new Event('change')); }); }
  if(priceDec){ priceDec.addEventListener('click', ()=>{ const cur = parseFloat(priceEl.value) || 0; priceEl.value = +(Math.max(0, cur - 1)).toFixed(2); priceEl.dispatchEvent(new Event('change')); }); }

  if(priceEl) priceEl.addEventListener('change', ()=>{ updateTotalFromQty(); });
  if(qtyEl) qtyEl.addEventListener('change', ()=>{ updateTotalFromQty(); if(qtyPct){ const pct = computePctFromQty(document.getElementById('symbol').value, parseFloat(qtyEl.value)||0); qtyPct.value = pct; qtyPctLabel.textContent = pct + '%'; setSliderBackground(qtyPct); } });
  if(totalEl) totalEl.addEventListener('change', ()=>{ const source = document.getElementById('cashSource').value; const parsed = parseMoney(totalEl.value, source === 'USD' ? 'USD' : 'BRL'); if(parsed && parsed>0) totalEl.value = source === 'USD' ? formatMoney(parsed,'USD') : formatMoney(parsed,'BRL'); updateQtyFromTotal(); });

  // wire live update of available cash from Cash Positions inputs (no server persist)
  const cashReaisInput = document.getElementById('cashReais');
  const cashDollarsInput = document.getElementById('cashDollars');
  if (cashReaisInput) cashReaisInput.addEventListener('input', (e) => { cashReais = parseFloat(e.target.value) || 0; updateAvailDisplay(); });
  if (cashDollarsInput) cashDollarsInput.addEventListener('input', (e) => { cashDollars = parseFloat(e.target.value) || 0; updateAvailDisplay(); });

  if(qtyPct){ qtyPct.addEventListener('input', ()=>{ const pct = parseInt(qtyPct.value||0,10); qtyPctLabel.textContent = pct + '%'; setSliderBackground(qtyPct); const s = document.getElementById('symbol').value; const q = computeQtyFromPct(s, pct); document.getElementById('qty').value = q; updateTotalFromQty(); }); }
  if(maxBtn){ maxBtn.addEventListener('click', ()=>{ if(qtyPct) { qtyPct.value = 100; qtyPct.dispatchEvent(new Event('input')); } }); }

  function setCashSource(src){
    const prev = document.getElementById('cashSource').value || 'USD';
    document.getElementById('cashSource').value = src;
    cashUSD.classList.toggle('active', src==='USD');
    cashBRL.classList.toggle('active', src==='BRL');
    const tot = document.getElementById('tradeTotal');
    if (tot) {
      tot.placeholder = src === 'USD' ? 'enter total in USD' : 'enter total in BRL';
      // If a value is present, try to convert it between currencies using brlUsdRate (best-effort)
      if (tot.value) {
        try {
          const parsed = parseMoney(tot.value, prev === 'USD' ? 'USD' : 'BRL');
          let converted = parsed;
          if (prev !== src && brlUsdRate && brlUsdRate > 0) {
            if (prev === 'USD' && src === 'BRL') converted = parsed / brlUsdRate;
            else if (prev === 'BRL' && src === 'USD') converted = parsed * brlUsdRate;
          }
          tot.value = src === 'USD' ? formatMoney(converted,'USD') : formatMoney(converted,'BRL');
          updateQtyFromTotal();
        } catch (e) { /* ignore conversion errors */ }
      }
    }
  }
  if(cashUSD) cashUSD.addEventListener('click', ()=> setCashSource('USD'));
  if(cashBRL) cashBRL.addEventListener('click', ()=> setCashSource('BRL'));
  // initialize placeholder and button state based on hidden input
  setCashSource(document.getElementById('cashSource').value || 'USD');

  // Update price label and auto-fill price when symbol changes to a BRL asset
  const symbolSelectEl = document.getElementById('symbol');
  if (symbolSelectEl) {
    symbolSelectEl.addEventListener('change', () => {
      const s = symbolSelectEl.value;
      const priceLabel = document.getElementById('priceLabel');
      const priceEl = document.getElementById('price');
      if (isBRLAsset(s)) {
        if (priceLabel) priceLabel.textContent = 'Price (R$)';
        const brlPrice = isBRLNonBond(s)
          ? (prices[s] || 0)
          : (priceMeta[s] && typeof priceMeta[s].priceBRL === 'number' ? priceMeta[s].priceBRL
            : (prices[s] && brlUsdRate > 0 ? prices[s] / brlUsdRate : 0));
        if (priceEl && brlPrice > 0) priceEl.value = brlPrice.toFixed(2);
        else if (priceEl) priceEl.value = '';
      } else {
        if (priceLabel) priceLabel.textContent = 'Price (USD)';
      }
      updateTotalFromQty();
    });
  }

  // Side (Buy / Sell) control
  const sideBuyBtn = document.getElementById('sideBuy');
  const sideSellBtn = document.getElementById('sideSell');
  function setSide(s) {
    const prev = document.getElementById('side').value || 'buy';
    document.getElementById('side').value = s;
    if (sideBuyBtn) sideBuyBtn.classList.toggle('active', s === 'buy');
    if (sideSellBtn) sideSellBtn.classList.toggle('active', s === 'sell');
    // recalc dependent UI
    updateTotalFromQty();
    if (document.getElementById('qtyPct')) {
      const pct = computePctFromQty(document.getElementById('symbol').value, parseFloat(document.getElementById('qty').value)||0);
      const slider = document.getElementById('qtyPct');
      if (slider) { slider.value = pct; setSliderBackground(slider); }
      const lbl = document.getElementById('qtyPctLabel'); if (lbl) lbl.textContent = pct + '%';
    }
  }
  if (sideBuyBtn) sideBuyBtn.addEventListener('click', ()=> setSide('buy'));
  if (sideSellBtn) sideSellBtn.addEventListener('click', ()=> setSide('sell'));
  // initialize side from hidden input
  setSide(document.getElementById('side').value || 'buy');

  // helper: compute pct from qty (for slider sync)
  function computePctFromQty(symbol, qty){
    const side = document.getElementById('side').value;
    const price = parseFloat(document.getElementById('price').value) || prices[symbol] || 0;
    if(!price || price<=0) return 0;
    if(side === 'sell'){
      const lots = buildLotsFromTrades();
      const pos = (lots[symbol] || []).reduce((s,l)=>s+l.qty,0);
      const pct = pos>0 ? Math.round((qty/pos)*100) : 0;
      return Math.min(100,Math.max(0,pct));
    } else {
      const source = document.getElementById('cashSource').value || 'USD';
      const usdAvailable = source === 'USD' ? (cashDollars||0) : ((cashReais||0) * brlUsdRate);
      const usdNeeded = qty * price;
      const pct = usdAvailable>0 ? Math.round((usdNeeded / usdAvailable) * 100) : 0;
      return Math.min(100,Math.max(0,pct));
    }
  }

  // style slider background (visual)
  function setSliderBackground(sl){ if(!sl) return; const val = sl.value || 0; sl.style.background = `linear-gradient(90deg,#7c3aed ${val}%, rgba(255,255,255,0.06) ${val}% )`; }
  if(qtyPct) setSliderBackground(qtyPct);
})();

async function fetchPrices() {
  try {
    const res = await fetch('/api/prices');
    if (!res.ok) throw new Error('Failed to fetch prices from server');
    const obj = await res.json();
    prices = {};
    for (const k of Object.keys(obj)) {
      if (['ts', 'cacheTTLms'].includes(k)) continue;
      if (k.endsWith('_meta')) {
        priceMeta[k.slice(0, -5)] = obj[k];
        continue;
      }
      prices[k] = obj[k];
    }
    if (typeof obj.BRLUSD !== 'undefined') brlUsdRate = obj.BRLUSD;
    if (typeof obj.CDI !== 'undefined') cdiRate = obj.CDI;
  } catch (err) {
    console.warn('Price fetch failed', err);
    showCoinGeckoError('Unable to fetch current prices from the server.');
  }

  // Detect stale prices using timestamps returned from server (e.g., BTC_ts)
  try {
    const cacheTTL = (typeof obj !== 'undefined' && obj.cacheTTLms) ? obj.cacheTTLms : 600000;
    const checkSymbols = knownSymbols.all.length > 0 ? knownSymbols.all : Object.keys(prices);
    const stale = [];
    if (typeof obj !== 'undefined') {
      for (const s of checkSymbols) {
        const key = `${s}_ts`;
        const ts = obj[key];
        const val = obj[s];
        if (typeof ts === 'undefined' || ts === null) {
          if (typeof val === 'undefined' || val === 0) stale.push({ s, reason: 'no data' });
        } else {
          const age = Date.now() - ts;
          if (age > cacheTTL) stale.push({ s, age });
        }
      }
    }

    if (stale.length > 0) {
      const parts = stale.map(it => it.age ? `${it.s} (${Math.round(it.age/60000)}m)` : `${it.s} (no timestamp)`);
      showPriceStaleWarning('Price may be stale for: ' + parts.join(', ') + '. Displaying cached values.');
    } else {
      removePriceStaleWarning();
    }

  } catch (err) {
    // ignore stale detection errors
  }

  let zeroPriceAssets = Object.keys(prices).filter(k => prices[k] == null || prices[k] === 0);
  if (zeroPriceAssets.length > 0) {
    showCoinGeckoError('Price for ' + zeroPriceAssets.join(', ') + ' is 0. This usually means the price could not be fetched.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function showCoinGeckoError(msg) {
  let cgErr = document.getElementById('coingeckoError');
  if (!cgErr) {
    cgErr = document.createElement('div');
    cgErr.id = 'coingeckoError';
    cgErr.style.color = '#ef4444';
    cgErr.style.background = '#fff0f0';
    cgErr.style.padding = '12px';
    cgErr.style.fontWeight = 'bold';
    cgErr.style.fontSize = '1.1em';
    cgErr.style.borderBottom = '2px solid #ef4444';
    cgErr.innerHTML = `🚫 ${msg}`;
    const dash = document.querySelector('.dashboard');
    if (dash) {
      dash.prepend(cgErr);
    } else {
      // Fallback: insert at top of body
      document.body.insertBefore(cgErr, document.body.firstChild);
    }
  } else {
    cgErr.innerHTML = `🚫 ${msg}`;
  }
}

function showPriceStaleWarning(msg) {
  let el = document.getElementById('priceFetchWarning');
  if (!el) {
    el = document.createElement('div');
    el.id = 'priceFetchWarning';
    el.style.color = '#b45309';
    el.style.background = '#fffbeb';
    el.style.padding = '12px';
    el.style.fontWeight = '600';
    el.style.fontSize = '1.0em';
    el.style.borderBottom = '1px solid #fbbf24';
    el.innerHTML = `⚠️ ${msg}`;
    const dash = document.querySelector('.dashboard');
    if (dash) dash.prepend(el);
    else document.body.insertBefore(el, document.body.firstChild);
  } else {
    el.innerHTML = `⚠️ ${msg}`;
  }
}

function removePriceStaleWarning() {
  const el = document.getElementById('priceFetchWarning');
  if (el) el.remove();
}

function buildLotsFromTrades() {
  const lots = {};
  for (const t of trades) {
    if (!lots[t.symbol]) lots[t.symbol] = [];
    if (t.side === 'buy') {
      lots[t.symbol].push({ qty: t.qty, price: t.price || prices[t.symbol] || 0 });
    } else if (t.side === 'sell') {
      let qtyToSell = t.qty;
      while (qtyToSell > 0 && lots[t.symbol].length > 0) {
        const lot = lots[t.symbol][0];
        const used = Math.min(lot.qty, qtyToSell);
        lot.qty -= used;
        qtyToSell -= used;
        if (lot.qty === 0) lots[t.symbol].shift();
      }
    }
  }
  return lots;
}

function computePositionsFromLots(lots) {
  const positions = {};
  for (const s in lots) {
    positions[s] = lots[s].reduce((sum, lot) => sum + lot.qty, 0);
  }
  return positions;
}

function computeInvestedFromLots(lots) {
  let invested = 0;
  for (const s in lots) {
    for (const lot of lots[s]) invested += isBRLNonBond(s) ? lot.qty * lot.price * brlUsdRate : lot.qty * lot.price;
  }
  // Add cash positions to invested
  invested += cashReais * brlUsdRate; // BRL value converted to USD
  invested += cashDollars; // Dollar value (pure dollars)
  return invested;
}

function refreshUI(total, investedWithCash, positions, lots, hasError = false) {
  if (hasError) {
    document.getElementById('totalInvested').textContent = '***';
    document.getElementById('totalValue').textContent = '***';
    document.getElementById('unrealizedPL').textContent = '***';
    document.getElementById('plPercentage').textContent = '***';
    document.getElementById('realizedPL').textContent = '***';
    document.getElementById('realizedPLPct').textContent = '***';
    document.getElementById('totalInvestedExCash').textContent = '***';
    document.getElementById('investedPct').textContent = '***';
    document.getElementById('valueChange').textContent = '***';
  
    document.getElementById("positionsTable").innerHTML = '<tr><td colspan="7" class="empty-state">Error fetching prices.</td></tr>';
    document.getElementById('tradeHistoryTable').innerHTML = '<tr><td colspan="8" class="empty-state">Error fetching prices.</td></tr>';
    return;
  }

  // realized P/L (closed trades + interest)
  const interestFromBRLMonths = Array.isArray(interestReaisMonths) ? interestReaisMonths.reduce((s,m) => s + (Number(m.amount) || 0), 0) : 0;
  const interestFromUSDMonths = Array.isArray(interestDollarsMonths) ? interestDollarsMonths.reduce((s,m) => s + (Number(m.amount) || 0), 0) : 0;
  const realized = trades.filter(t => t.side === 'sell').reduce((sum, t) => {
    const p = t.profit || 0; return sum + (isBRLNonBond(t.symbol) ? p * brlUsdRate : p);
  }, 0) + (interestFromBRLMonths * brlUsdRate) + interestFromUSDMonths;

  // investedWithCash = cost basis of current holdings + cash positions
  // investedNet = net invested excluding realized P/L (what user put in)
  const investedNet = Math.max(0, investedWithCash - realized);

  // unrealized is strictly holdings value minus cost basis (should NOT include realized)
  const unrealized = total - investedWithCash;
  const unrealizedPct = investedWithCash > 0 ? (unrealized / investedWithCash) * 100 : 0;

  const allProfit = unrealized + realized;
  const allProfitPct = investedWithCash > 0 ? (allProfit / investedWithCash) * 100 : 0;
  
  // Estimate inflation (3% annual = ~0.008% daily)
  const firstTrade = trades.find(t => t.side === 'buy');
  const daysSinceFirstTrade = firstTrade ? Math.max(1, (Date.now() - new Date(firstTrade.time).getTime()) / (1000 * 60 * 60 * 24)) : 1;
  const annualInflation = 0.03;
  // Use multiplicative inflation adjustment for a better estimate of real return
  const years = daysSinceFirstTrade / 365;
  const inflationFactor = Math.pow(1 + annualInflation, years); // > 1
  const nominalFactor = investedWithCash > 0 ? (1 + allProfit / investedWithCash) : 1;
  const realReturn = investedWithCash * (nominalFactor / inflationFactor - 1);
  const realReturnPct = investedWithCash > 0 ? (realReturn / investedWithCash) * 100 : 0;

  // Display: Total Invested should be net of realized P/L
  document.getElementById('totalInvested').innerHTML = `$${(investedNet).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br><span style="font-size: 0.6rem; color: #64748b; margin-top: -0.3rem; display: block;">R$ ${(investedNet / brlUsdRate).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`;
  document.getElementById('totalValue').innerHTML = `$${(total).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br><span style="font-size: 0.6rem; color: #64748b; margin-top: -0.3rem; display: block;">R$ ${(total / brlUsdRate).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`;

  const plElem = document.getElementById('unrealizedPL');
  plElem.innerHTML = `${unrealized >= 0 ? '+' : ''}$${(unrealized).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br><span style="font-size: 0.6rem; color: #64748b; margin-top: -0.3rem; display: block;">R$ ${(unrealized / brlUsdRate).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`;
  plElem.className = unrealized >= 0 ? 'metric-value positive' : 'metric-value negative';

  const plPctElem = document.getElementById('plPercentage');
  plPctElem.textContent = `${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%`;
  plPctElem.className = `metric-change ${unrealized >= 0 ? 'positive' : 'negative'}`;

  const rpElem = document.getElementById('realizedPL');
  rpElem.innerHTML = `${realized >= 0 ? '+' : ''}$${(realized).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br><span style="font-size: 0.6rem; color: #64748b; margin-top: -0.3rem; display: block;">R$ ${(realized / brlUsdRate).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`;
  rpElem.className = realized >= 0 ? 'metric-value positive' : 'metric-value negative';
  const rpPctElem = document.getElementById('realizedPLPct');
  rpPctElem.textContent = `${realized >= 0 ? '+' : ''}${(realized / Math.max(1, investedWithCash) * 100).toFixed(2)}% from ${trades.filter(t => t.side === 'sell').length} sales + interest`;
  rpPctElem.className = `metric-change ${realized >= 0 ? 'positive' : 'negative'}`;

  // Total Invested = current market value of all non-cash tickers (excludes BRL cash, USD cash, and BRLUSD)
  const tickerValue = Object.keys(positions)
    .filter(s => s !== 'BRLUSD')
    .reduce((sum, s) => {
      const p = prices[s] || 0;
      return sum + (isBRLNonBond(s) ? (positions[s] || 0) * p * brlUsdRate : (positions[s] || 0) * p);
    }, 0);
  const investedExElem = document.getElementById('totalInvestedExCash');
  investedExElem.innerHTML = `$${(tickerValue).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br><span style="font-size: 0.6rem; color: #64748b; margin-top: -0.3rem; display: block;">R$ ${(tickerValue / brlUsdRate).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`;
  investedExElem.className = 'metric-value';
  const investedPctElem = document.getElementById('investedPct');
  // Percentage invested = (ticker value) / (total current portfolio value)
  const investedPct = total > 0 ? (tickerValue / total) * 100 : 0;
  investedPctElem.textContent = `${investedPct.toFixed(2)}% invested`;
  investedPctElem.className = 'metric-change neutral';

  const valueChange = document.getElementById('valueChange');
  if (Math.abs(unrealized) < 0.01) {
    valueChange.textContent = 'Break even';
    valueChange.className = 'metric-change neutral';
  } else {
    valueChange.innerHTML = `${unrealized >= 0 ? '+' : ''}$${(unrealized).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${unrealizedPct.toFixed(2)}%)`;
    valueChange.className = `metric-change ${unrealized >= 0 ? 'positive' : 'negative'}`;
  }



  // Update quick available cash display in Add New Trade card
  const availUsdEl = document.getElementById('availUsd');
  const availBrlEl = document.getElementById('availBrl');
  if (availUsdEl) availUsdEl.textContent = formatMoney(cashDollars || 0, 'USD');
  if (availBrlEl) availBrlEl.textContent = formatMoney(cashReais || 0, 'BRL');

  // Update Cash Positions balance display
  const cashBrlBalEl = document.getElementById('cashBrlBalance');
  const cashUsdBalEl = document.getElementById('cashUsdBalance');
  if (cashBrlBalEl) cashBrlBalEl.textContent = formatMoney(cashReais || 0, 'BRL');
  if (cashUsdBalEl) cashUsdBalEl.textContent = formatMoney(cashDollars || 0, 'USD');

  // Keep available cash display in sync
  if (typeof updateAvailDisplay === 'function') updateAvailDisplay();

  const positionsTbody = document.getElementById("positionsTable");
  positionsTbody.innerHTML = '';
  const symbols = Object.keys(positions);
  if (symbols.length === 0) {
    positionsTbody.innerHTML = `<tr><td colspan="7" class="empty-state">No open positions yet.</td></tr>`;
  } else {
    for (const s of symbols) {
      const qty = positions[s];
      const brlNB = isBRLNonBond(s);
      const brlB = isBRLBond(s);
      let avgFmt, curFmt, valueFmt, plFmt, plPct, plClass;
      if (brlNB) {
        // BRL non-bond (BOVA11/IVVB11): prices and lot costs are in BRL
        const costBRL = (lots[s] || []).reduce((sum, lot) => sum + lot.qty * lot.price, 0);
        const curBRL = prices[s] || 0;
        const valueBRL = qty * curBRL;
        const plBRL = valueBRL - costBRL;
        plPct = costBRL > 0 ? (plBRL / costBRL) * 100 : 0;
        plClass = plBRL >= 0 ? 'positive' : 'negative';
        avgFmt = formatMoney(qty > 0 ? costBRL / qty : 0, 'BRL');
        curFmt = formatMoney(curBRL, 'BRL');
        valueFmt = formatMoney(valueBRL, 'BRL');
        plFmt = (plBRL >= 0 ? '+' : '') + formatMoney(plBRL, 'BRL');
      } else if (brlB) {
        // BRL bond (RENDA2065): lot costs and prices stored in USD, display in BRL
        const rate = brlUsdRate || 1;
        const costBRL = (lots[s] || []).reduce((sum, lot) => sum + lot.qty * lot.price, 0) / rate;
        const meta = priceMeta[s];
        const curBRL = (meta && typeof meta.priceBRL === 'number') ? meta.priceBRL : (prices[s] || 0) / rate;
        const valueBRL = qty * curBRL;
        const plBRL = valueBRL - costBRL;
        plPct = costBRL > 0 ? (plBRL / costBRL) * 100 : 0;
        plClass = plBRL >= 0 ? 'positive' : 'negative';
        avgFmt = formatMoney(qty > 0 ? costBRL / qty : 0, 'BRL');
        curFmt = formatMoney(curBRL, 'BRL');
        valueFmt = formatMoney(valueBRL, 'BRL');
        plFmt = (plBRL >= 0 ? '+' : '') + formatMoney(plBRL, 'BRL');
      } else {
        const cost = (lots[s] || []).reduce((sum, lot) => sum + lot.qty * lot.price, 0);
        const currentPrice = prices[s] || 0;
        const value = qty * currentPrice;
        const pl = value - cost;
        plPct = cost > 0 ? (pl / cost) * 100 : 0;
        plClass = pl >= 0 ? 'positive' : 'negative';
        avgFmt = '$' + (qty > 0 ? cost / qty : 0).toFixed(2);
        curFmt = '$' + currentPrice.toFixed(2);
        valueFmt = '$' + value.toFixed(2);
        plFmt = (pl >= 0 ? '+' : '') + '$' + pl.toFixed(2);
      }
      positionsTbody.innerHTML += `
        <tr>
          <td>${s}</td>
          <td>${qty.toFixed(4)}</td>
          <td>${avgFmt}</td>
          <td>${curFmt}</td>
          <td>${valueFmt}</td>
          <td class="${plClass}">${plFmt}</td>
          <td class="${plClass}">${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%</td>
        </tr>
      `;
    }
    
    // Add cash positions
    if (cashReais > 0 || (interestReaisMonths && interestReaisMonths.length>0)) {
      const usdValue = cashReais * brlUsdRate;
      const interestFromMonthsBRL = Array.isArray(interestReaisMonths) ? interestReaisMonths.reduce((s,m) => s + (Number(m.amount) || 0), 0) : 0;
      const pl = interestFromMonthsBRL;
      const plPct = cashReais > 0 ? (pl / cashReais) * 100 : 0;
      const plClass = pl >= 0 ? 'positive' : 'negative';
      positionsTbody.innerHTML += `
        <tr>
          <td>BRL (100% CDI)</td>
          <td>${cashReais.toFixed(2)}</td>
          <td>$${brlUsdRate.toFixed(4)}</td>
          <td>$${brlUsdRate.toFixed(4)}</td>
          <td>$${usdValue.toFixed(2)}</td>
          <td class="${plClass}">${pl >= 0 ? '+' : ''}R$${pl.toFixed(2)}</td>
          <td class="${plClass}">${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%</td>
        </tr>
      `;
    }
    
    const interestFromUSD = Array.isArray(interestDollarsMonths) ? interestDollarsMonths.reduce((s,m) => s + (Number(m.amount) || 0), 0) : 0;
    if (cashDollars > 0 || interestFromUSD > 0) {
      const dollarsValue = cashDollars;
      const pl = interestFromUSD;
      const plPct = cashDollars > 0 ? (pl / cashDollars) * 100 : 0;
      const plClass = pl >= 0 ? 'positive' : 'negative';
      positionsTbody.innerHTML += `
        <tr>
          <td>Dollar</td>
          <td>${cashDollars.toFixed(2)}</td>
          <td>-</td>
          <td>-</td>
          <td>$${dollarsValue.toFixed(2)}</td>
          <td class="${plClass}">${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}</td>
          <td class="${plClass}">${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%</td>
        </tr>
      `;
    }
  }

  const tradeTbody = document.getElementById('tradeHistoryTable');
  tradeTbody.innerHTML = '';
  if (trades.length === 0) {
    tradeTbody.innerHTML = `<tr><td colspan="8" class="empty-state">No trades yet.</td></tr>`;
  } else {
    trades.forEach((t, idx) => {
      const brlNB = isBRLNonBond(t.symbol);
      const brlB = isBRLBond(t.symbol);
      let priceFmt, totalFmt, profitCell;
      if (brlNB) {
        // BRL non-bond: trade.price and profit are in BRL
        const rawPrice = t.price || prices[t.symbol] || 0;
        const totalBRL = t.qty * rawPrice;
        priceFmt = t.price !== null ? formatMoney(rawPrice, 'BRL') : '-';
        totalFmt = formatMoney(totalBRL, 'BRL');
        profitCell = '<span class="neutral">-</span>';
        if (t.side === 'sell' && typeof t.profit === 'number') {
          profitCell = `<span class="${t.profit >= 0 ? 'positive' : 'negative'}">${t.profit >= 0 ? '+' : ''}${formatMoney(t.profit, 'BRL')}</span>`;
        }
      } else if (brlB) {
        // BRL bond: trade.price stored in USD, display in BRL
        const rate = brlUsdRate || 1;
        const rawPriceUSD = t.price || prices[t.symbol] || 0;
        const rawPriceBRL = rawPriceUSD / rate;
        const totalBRL = t.qty * rawPriceBRL;
        priceFmt = t.price !== null ? formatMoney(rawPriceBRL, 'BRL') : '-';
        totalFmt = formatMoney(totalBRL, 'BRL');
        profitCell = '<span class="neutral">-</span>';
        if (t.side === 'sell' && typeof t.profit === 'number') {
          const profitBRL = t.profit / rate;
          profitCell = `<span class="${profitBRL >= 0 ? 'positive' : 'negative'}">${profitBRL >= 0 ? '+' : ''}${formatMoney(profitBRL, 'BRL')}</span>`;
        }
      } else {
        const total = t.qty * (t.price || prices[t.symbol] || 0);
        priceFmt = t.price !== null ? '$' + t.price.toFixed(2) : '-';
        totalFmt = '$' + total.toFixed(2);
        profitCell = '<span class="neutral">-</span>';
        if (t.side === 'sell' && typeof t.profit === 'number') {
          profitCell = `<span class="${t.profit >= 0 ? 'positive' : 'negative'}">$${t.profit.toFixed(2)}</span>`;
        }
      }
      const badge = t.side === 'buy' ? 'badge-success' : 'badge-danger';
      tradeTbody.innerHTML += `
        <tr>
          <td>${new Date(t.time).toLocaleString()}</td>
          <td>${t.symbol}</td>
          <td><span class="badge ${badge}">${t.side.toUpperCase()}</span></td>
          <td>${t.qty}</td>
          <td>${priceFmt}</td>
          <td>${totalFmt}</td>
          <td>${profitCell}</td>
          <td><button class="btn btn-danger" style="padding:2px 8px;font-size:0.9em;" onclick="deleteTrade(${idx})">✖</button></td>
        </tr>
      `;
    });
  }

window.pendingDeleteIdx = null;

window.deleteTrade = function(idx) {
  window.pendingDeleteIdx = idx;
  document.getElementById('deleteTradeModal').style.display = '';
}

window.hideDeleteTradeModal = function() {
  document.getElementById('deleteTradeModal').style.display = 'none';
  window.pendingDeleteIdx = null;
}

window.confirmDeleteTrade = async function() {
  if (window.pendingDeleteIdx !== null) {
    const t = trades[window.pendingDeleteIdx];
    if (t && t.id) {
      try {
        await fetch(`/api/trades/${t.id}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('Failed to delete trade on server, will remove locally', err);
      }
    }
    trades.splice(window.pendingDeleteIdx, 1);
    save();
    refresh();
  }
  window.hideDeleteTradeModal();
}
}

function formatHistoryLabelPoint(pt) {
  const locale = navigator.language || 'en-US';
  let date = null;
  if (pt && typeof pt.ts === 'number') date = new Date(pt.ts);
  else if (pt && pt.t) {
    const d = new Date(pt.t);
    if (!isNaN(d)) date = d;
  }
  if (!date) return (pt && pt.t) || '';

  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function refreshCharts(positions, lots) {
  const chartHistory = history;

  if (!valueChart) createValueChart();
  if (!valueSeries) return;

  const projPoints = projectionEnabled ? computeProjection(chartHistory, PROJ_DAYS) : [];

  const sourceOHLC = activeMetric === 'pnl' ? pnlOHLC : historyOHLC;
  const candleData = sourceOHLC.map(c => ({
    time: Math.floor(c.ts / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  valueSeries.setData(candleData);

  if (projPoints.length > 0 && activeMetric === 'value') {
    const projLine = projPoints.map(p => ({ time: Math.floor(p.ts / 1000), value: p.v }));
    projSeries.setData(projLine);
    projSeries.applyOptions({ visible: true });
  } else {
    projSeries.setData([]);
    projSeries.applyOptions({ visible: false });
  }

  if (valueChart && typeof valueChart.timeScale === 'function') {
    valueChart.timeScale().fitContent();
  }

  const symbols = Object.keys(positions);
  const palette = [
    '#dc2626', '#15803d', '#0891b2', '#1e40af', '#7c3aed',
    '#d97706', '#06b6d4', '#22c55e', '#f97316', '#eab308',
    '#a855f7', '#3b82f6'
  ];

  const allocationValues = symbols.map(s => {
    const p = prices[s] || 0;
    return isBRLNonBond(s) ? positions[s] * p * brlUsdRate : positions[s] * p;
  });
  const cashValue = (cashReais * brlUsdRate) + cashDollars;
  // choose labels/values based on allocationShowCash
  const labels = [...symbols];
  const values = [...allocationValues];
  if (allocationShowCash) {
    if (cashReais > 0) {
      labels.push('BRL');
      values.push(cashReais * brlUsdRate);
    }
    if (cashDollars > 0) {
      labels.push('Dollar');
      values.push(cashDollars);
    }
  }
  let totalValue = allocationValues.reduce((a, b) => a + b, 0) + (allocationShowCash ? cashValue : 0);
  allocationChart.data.labels = labels;
  allocationChart.data.datasets[0].data = values.map(v => totalValue > 0 ? (v / totalValue) * 100 : 0);
  allocationChart.data.datasets[0].backgroundColor = labels.map((_, i) => palette[i % palette.length]);
  allocationChart.update();
  if (typeof allocationChart.resize === 'function') allocationChart.resize();

  const allocList = document.getElementById('allocList');
  const currentCurrency = window.allocCurrency || localStorage.getItem('allocCurrency') || 'USD';
  window.allocCurrency = currentCurrency;
  const usdBtn = document.getElementById('allocUsdBtn');
  const brlBtn = document.getElementById('allocBrlBtn');
  if (usdBtn) usdBtn.classList.toggle('active', currentCurrency === 'USD');
  if (brlBtn) brlBtn.classList.toggle('active', currentCurrency === 'BRL');

  if (!allocList) return;
  if (labels.length === 0) {
    allocList.innerHTML = '<div class="empty-state">No allocation yet.</div>';
  } else {
    allocList.innerHTML = labels.map((s, i) => {
      const usdValue = values[i];
      const display = currentCurrency === 'USD'
        ? `$${usdValue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`
        : `R$ ${((brlUsdRate && brlUsdRate>0) ? (usdValue / brlUsdRate) : 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      return `<div class="alloc-row"><div class="left"><div class="swatch" style="background:${palette[i%palette.length]}"></div><div class="asset-label">${s}</div></div><div class="asset-value">${display}</div></div>`;
    }).join('');
  }


  const plValues = symbols.map(s => {
    const cost = (lots[s] || []).reduce((sum, lot) => sum + lot.qty * lot.price, 0);
    const value = positions[s] * (prices[s] || 0);
    const pl = value - cost;
    return isBRLNonBond(s) ? pl * brlUsdRate : pl;
  });
  plChart.data.labels = symbols;
  plChart.data.datasets[0].data = plValues;
  plChart.data.datasets[0].backgroundColor = plValues.map(v => v >= 0 ? '#10b981' : '#ef4444');
  plChart.update();

}

function setChipActive(series, active) {
  const chip = document.querySelector(`.chip[data-series="${series}"]`);
  if (!chip) return;
  chip.classList.toggle('active', active);
}

function toggleSeries(series) {
  if (series === 'all' || series === 'value') {
    activeMetric = 'value';
  } else if (series === 'pnl') {
    activeMetric = 'pnl';
  }
  setChipActive('all', series === 'all');
  setChipActive('value', activeMetric === 'value' && series !== 'all');
  setChipActive('pnl', activeMetric === 'pnl');
  _syncProjectionAfterSeriesChange();
}

function _syncProjectionAfterSeriesChange() {
  // Re-run chart refresh so projection visibility is re-evaluated
  const lots = buildLotsFromTrades();
  const positions = computePositionsFromLots(lots);
  refreshCharts(positions, lots);
}

let projectionEnabled = false;

function toggleProjection() {
  projectionEnabled = !projectionEnabled;
  const btn = document.getElementById('projToggleBtn');
  if (btn) btn.classList.toggle('active', projectionEnabled);
  const lots = buildLotsFromTrades();
  const positions = computePositionsFromLots(lots);
  refreshCharts(positions, lots);
}

// Project 6 months (182.5 days) ahead
const PROJ_DAYS = 182.5;

/**
 * Linear regression over sourceHistory → project forward by projDays.
 * Returns array of { ts, v } future data points.
 * Uses the same visible data (chartHistory) so the trend matches what's on screen.
 */
function computeProjection(sourceHistory, projDays) {
  const n = sourceHistory.length;
  if (n < 2) return [];
  // Normalise timestamps to hours to avoid floating-point precision loss
  const t0 = sourceHistory[0].ts || 0;
  const xs = sourceHistory.map(h => ((h.ts || 0) - t0) / (1000 * 60 * 60));
  const ys = sourceHistory.map(h => h.v || 0);
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]; sumY += ys[i];
    sumXY += xs[i] * ys[i]; sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return [];
  const slope = (n * sumXY - sumX * sumY) / denom; // $ per hour
  const intercept = (sumY - slope * sumX) / n;
  const lastTs = sourceHistory[n - 1].ts || Date.now();
  // Match the point density of the historical data so the projection looks consistent
  // but cap at 200 points max to avoid overwhelming the chart
  const histDurationDays = ((sourceHistory[n - 1].ts || 0) - (sourceHistory[0].ts || 0)) / (1000 * 60 * 60 * 24) || 1;
  const pointsPerDay = n / histDurationDays;
  const numPoints = Math.min(200, Math.max(10, Math.round(pointsPerDay * projDays)));
  const step = (projDays * 24 * 60 * 60 * 1000) / numPoints;
  const points = [];
  for (let i = 1; i <= numPoints; i++) {
    const ts = lastTs + i * step;
    const x = (ts - t0) / (1000 * 60 * 60);
    points.push({ ts, v: Math.max(0, slope * x + intercept) });
  }
  return points;
}

async function refresh() {
  await loadSymbols();
  await fetchPrices();
  // Prevent further updates if any asset price is 0 or error is present
  let zeroPriceAssets = Object.keys(prices).filter(k => prices[k] == null || prices[k] === 0);
  const cgErr = document.getElementById('coingeckoError');
  if (zeroPriceAssets.length > 0 || cgErr) {
    // Don't record a data point or update UI with bad data, but hide figures
    refreshUI(0, 0, {}, {}, true);
    return;
  }
  // If no errors, remove any previous error message
  if (cgErr) cgErr.remove();
  const lots = buildLotsFromTrades();
  const positions = computePositionsFromLots(lots);
  const investedWithCash = computeInvestedFromLots(lots); // cost basis + cash
  // realized P/L (closed trades + interest)
  const interestFromBRLMonths = Array.isArray(interestReaisMonths) ? interestReaisMonths.reduce((s,m) => s + (Number(m.amount) || 0), 0) : 0;
  const interestFromUSDMonths = Array.isArray(interestDollarsMonths) ? interestDollarsMonths.reduce((s,m) => s + (Number(m.amount) || 0), 0) : 0;
  const realized = trades.filter(t => t.side === 'sell').reduce((sum, t) => {
    const p = t.profit || 0; return sum + (isBRLNonBond(t.symbol) ? p * brlUsdRate : p);
  }, 0) + (interestFromBRLMonths * brlUsdRate) + interestFromUSDMonths;
  // Net invested excluding realized P/L
  const investedNet = Math.max(0, investedWithCash - realized);

  let total = 0;
  for (const s in positions) {
    const p = prices[s] || 0;
    total += isBRLNonBond(s) ? positions[s] * p * brlUsdRate : positions[s] * p;
  }
  // Add cash positions to total
  total += cashReais * brlUsdRate; // Reais value converted to USD
  total += cashDollars; // Dollar value (pure dollars)

  // Fetch latest history from server (server is responsible for inserting points every 30 minutes)
  try {
    const resp = await fetch('/api/history?range=all');
    if (resp.ok) {
      const rows = await resp.json();
      if (Array.isArray(rows)) history = rows;
    }
  } catch (err) {
    console.warn('Failed to fetch server history', err);
  }

  // Load OHLC data for the portfolio value candlestick chart
  try {
    const [ohlc, ohlcPnl] = await Promise.all([
      loadHistoryOHLC('all', 'value'),
      loadHistoryOHLC('all', 'pnl'),
    ]);
    if (Array.isArray(ohlc) && ohlc.length > 0) historyOHLC = ohlc;
    else if (history.length > 0) historyOHLC = history.map(h => ({ ts: h.ts, open: h.v, high: h.v, low: h.v, close: h.v }));
    if (Array.isArray(ohlcPnl) && ohlcPnl.length > 0) pnlOHLC = ohlcPnl;
  } catch (err) {
    console.warn('Failed to obtain OHLC history', err);
    if (history.length > 0) historyOHLC = history.map(h => ({ ts: h.ts, open: h.v, high: h.v, low: h.v, close: h.v }));
  }

  refreshUI(total, investedWithCash, positions, lots);
  refreshCharts(positions, lots);
  
  // Update cash position inputs (localized format)
  const crInput = document.getElementById('cashReais');
  const cdInput = document.getElementById('cashDollars');
  if (crInput) crInput.value = (cashReais !== undefined && cashReais !== null) ? formatMoney(cashReais, 'BRL') : '';
  if (cdInput) cdInput.value = (cashDollars !== undefined && cashDollars !== null) ? formatMoney(cashDollars, 'USD') : '';

  // Wire change handlers to parse localized input and keep UI consistent
  if (crInput && !crInput._localeBound) {
    crInput._localeBound = true;
    crInput.addEventListener('change', (e) => {
      cashReais = +parseMoney(e.target.value, 'BRL').toFixed(2);
      e.target.value = formatMoney(cashReais, 'BRL');
      save();
      refreshCharts(computePositionsFromLots(buildLotsFromTrades()), buildLotsFromTrades());
      // keep other displays in sync
      const availBrlEl = document.getElementById('availBrl'); if (availBrlEl) availBrlEl.textContent = formatMoney(cashReais, 'BRL');
    });
  }
  if (cdInput && !cdInput._localeBound) {
    cdInput._localeBound = true;
    cdInput.addEventListener('change', (e) => {
      cashDollars = +parseMoney(e.target.value, 'USD').toFixed(2);
      e.target.value = formatMoney(cashDollars, 'USD');
      save();
      refreshCharts(computePositionsFromLots(buildLotsFromTrades()), buildLotsFromTrades());
      const availUsdEl = document.getElementById('availUsd'); if (availUsdEl) availUsdEl.textContent = formatMoney(cashDollars, 'USD');
    });
  }

  // interest inputs: format and bind localized parsing
  const interestDEl = document.getElementById('interestDollars');
  if (interestDEl && !interestDEl._localeBound) {
    interestDEl._localeBound = true;
    interestDEl.addEventListener('change', (e) => {
      interestDollars = +parseMoney(e.target.value, 'USD').toFixed(2);
      e.target.value = formatMoney(interestDollars, 'USD');
      save();
      // refresh charts/summary that depend on interest values
      refreshCharts(computePositionsFromLots(buildLotsFromTrades()), buildLotsFromTrades());
      const availUsdEl = document.getElementById('availUsd'); if (availUsdEl) availUsdEl.textContent = formatMoney(cashDollars, 'USD');
    });
  }

  const interestMonthEl = document.getElementById('interestMonthAmount');
  if (interestMonthEl && !interestMonthEl._localeBound) {
    interestMonthEl._localeBound = true;
    interestMonthEl.addEventListener('change', (e) => {
      const v = +parseMoney(e.target.value, 'BRL').toFixed(2);
      e.target.value = v ? formatMoney(v, 'BRL') : '';
    });
  }
  // Render monthly interest lists
  updateInterestMonthsUI();
  updateInterestUSDMonthsUI();
}

(async () => {
  await loadStateFromServer();
  await refresh();
  // initialize allocation toggle visual state
  setAllocationMode(allocationShowCash ? 'withCash' : 'investments');

  // Auto-refresh prices every 60 seconds
  setInterval(async () => { await refresh(); }, 60000);
})();

// Tab switching logic
function showTab(tab) {
  document.getElementById('dashboardSection').style.display = tab === 'dashboard' ? '' : 'none';
  document.getElementById('assetChartsSection').style.display = tab === 'assetCharts' ? '' : 'none';
  document.getElementById('tabDashboard').classList.toggle('btn-primary', tab === 'dashboard');
  document.getElementById('tabAssetCharts').classList.toggle('btn-primary', tab === 'assetCharts');
}
showTab('dashboard');

// Asset price chart logic
const assetCharts = {};
let selectedDays = 60;
async function fetchAssetHistory(symbol) {
  // Returns { labels: [...], prices: [...] }
  try {
    const resp = await fetch(`/api/asset/${symbol}/history?days=${selectedDays}`);
    if (resp.ok) {
      const data = await resp.json();
      const result = { labels: data.labels || [], prices: data.prices || [] };
      return result;
    }
  } catch (err) {
    console.warn('Asset history fetch failed, falling back to client method', err);
  }

  // fallback to client-side fetchers (unchanged existing behavior)
  // (preserve original behavior for robustness)
  let result = { labels: [], prices: [] };
  if (["BTC","ETH","SOL"].includes(symbol)) {
    const ids = {BTC:'bitcoin',ETH:'ethereum',SOL:'solana'};
    const url = `https://api.coingecko.com/api/v3/coins/${ids[symbol]}/market_chart?vs_currency=usd&days=${selectedDays}&interval=daily`;
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.prices) {
        const labels = data.prices.map(x => new Date(x[0]).toLocaleDateString());
        const prices = data.prices.map(x => x[1]);
        result = { labels, prices };
      }
    } catch (e) {
      result = { labels: [], prices: [] };
    }
  }
  return result;
}

// Fetch OHLC candles for an asset from price_ticks via the backend.
// Returns [] if the endpoint fails or returns no data (caller falls back to history API).
async function fetchAssetOHLC(symbol) {
  try {
    const resp = await fetch(`/api/asset/${symbol}/ohlc?days=${selectedDays}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('Asset OHLC fetch failed for', symbol, err);
    return [];
  }
}

function setChartDays(days) {
  selectedDays = days;
  document.querySelectorAll('.chart-controls .chip').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.days) === days);
  });
  
  let displayText = `${days} Days`;
  if (days === 180) displayText = '6 Months';
  else if (days === 365) displayText = '1 Year';
  else if (days === 730) displayText = '2 Years';
  else if (days === 1825) displayText = '5 Years';
  
  document.querySelector('.card-title').innerHTML = `<span class="card-icon">📊</span>Asset Price Charts (Last ${displayText})`;
  renderAssetCharts();
}

async function renderAssetCharts() {
  // Ensure we have up-to-date prices to show next to each asset
  await loadSymbols();
  await fetchPrices();

  // Build asset list from server config: non-currency symbols + 'BRL' for the BRLUSD rate chart
  const nonCurrency = knownSymbols.all.filter(s => {
    const cfg = knownSymbols.detailed[s];
    return cfg && cfg.type !== 'currency';
  });
  const hasBrlusd = (knownSymbols.currencies || []).includes('BRLUSD');
  const assets = [...nonCurrency, ...(hasBrlusd ? ['BRL'] : [])];

  // Destroy existing charts and rebuild containers as divs for LightweightCharts
  const assetGrid = document.querySelector('#assetChartsSection .asset-grid');
  if (assetGrid) {
    for (const sym of Object.keys(assetCharts)) {
      if (assetCharts[sym]) { assetCharts[sym].remove(); assetCharts[sym] = null; }
    }
    assetGrid.innerHTML = '';
    for (const sym of assets) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'text-align:center;height:300px;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;';
      const label = document.createElement('b');
      label.textContent = sym;
      const inner = document.createElement('div');
      inner.style.cssText = 'flex:1;width:100%;';
      const chartDiv = document.createElement('div');
      chartDiv.id = 'chart' + sym;
      chartDiv.style.cssText = 'height:240px;width:100%;';
      inner.appendChild(chartDiv);
      wrapper.appendChild(label);
      wrapper.appendChild(inner);
      assetGrid.appendChild(wrapper);
    }
  }

  for (const sym of assets) {
    const chartEl = document.getElementById('chart' + sym);
    if (!chartEl) continue;
    // 'BRL' is a frontend alias; backend stores it as 'BRLUSD'
    const fetchSym = (sym === 'BRL') ? 'BRLUSD' : sym;

    if (assetCharts[sym]) { assetCharts[sym].remove(); assetCharts[sym] = null; }

    const lwChart = LightweightCharts.createChart(chartEl, {
      width: chartEl.clientWidth || 280,
      height: 240,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: {
        vertLines: { color: 'rgba(45,55,72,0.5)' },
        horzLines: { color: 'rgba(45,55,72,0.5)' },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(45,55,72,0.5)' },
      timeScale: {
        borderColor: 'rgba(45,55,72,0.5)',
        timeVisible: selectedDays <= 7,
        secondsVisible: false,
        fixRightEdge: true,
        rightOffset: 2,
      },
    });
    assetCharts[sym] = lwChart;

    const candleSeries = lwChart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Fetch OHLC from price_ticks; fall back to flat candles from daily history cache
    let candles = [];
    try {
      candles = await fetchAssetOHLC(fetchSym);
    } catch (e) { candles = []; }

    if (!candles || candles.length < 2) {
      const { labels, prices: assetPrices } = await fetchAssetHistory(fetchSym);
      // Reconstruct approximate timestamps evenly spaced up to now (labels are locale strings,
      // not reliably parseable; spacing by selectedDays is a safe approximation).
      const nowMs = Date.now();
      const stepMs = selectedDays * 24 * 60 * 60 * 1000 / Math.max(assetPrices.length, 1);
      candles = assetPrices
        .map((p, i) => {
          if (typeof p !== 'number') return null;
          const ts = nowMs - (assetPrices.length - 1 - i) * stepMs;
          return { ts, open: p, high: p, low: p, close: p };
        })
        .filter(Boolean);
    }

    const candleData = candles
      .map(c => ({ time: Math.floor(c.ts / 1000), open: c.open, high: c.high, low: c.low, close: c.close }))
      .filter(c => c.open > 0);

    if (candleData.length > 0) {
      candleSeries.setData(candleData);
      lwChart.timeScale().fitContent();
    }

    // Keep chart width in sync with container
    new ResizeObserver(() => {
      if (assetCharts[sym] && chartEl.clientWidth > 0) {
        assetCharts[sym].applyOptions({ width: chartEl.clientWidth });
      }
    }).observe(chartEl);

    // Header: price badge + period % change
    const bTag = chartEl.parentElement.previousElementSibling;
    const isBond = knownSymbols.detailed && knownSymbols.detailed[sym] && knownSymbols.detailed[sym].type === 'bond';
    const currentPrice = (sym === 'BRL') ? (brlUsdRate ? (1 / brlUsdRate) : null) : (prices[sym] ?? null);
    const meta = priceMeta[sym];
    let priceHtml = '';
    if (typeof currentPrice === 'number' && !isNaN(currentPrice)) {
      if (sym === 'BRL') {
        priceHtml = `<span style="margin-left:8px;color:#94a3b8;font-weight:600;font-size:0.9rem">R$${currentPrice.toFixed(4)}</span>`;
      } else if (isBond) {
        const priceBRL = (meta && typeof meta.priceBRL === 'number') ? meta.priceBRL
          : (brlUsdRate ? currentPrice / brlUsdRate : null);
        const brlStr = priceBRL != null ? `R$${priceBRL.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '';
        const yieldBadge = (meta && typeof meta.taxaCompra === 'number')
          ? ` <span title="Taxa de compra (IPCA+X%)" style="color:#60a5fa;font-size:0.82rem">IPCA+${meta.taxaCompra.toFixed(2)}%</span>`
          : '';
        priceHtml = `<span style="margin-left:8px;color:#94a3b8;font-weight:600;font-size:0.9rem">${brlStr}${yieldBadge}</span>`;
      } else if (isBRLNonBond(sym)) {
        priceHtml = `<span style="margin-left:8px;color:#94a3b8;font-weight:600;font-size:0.9rem">R$${currentPrice.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>`;
      } else {
        priceHtml = `<span style="margin-left:8px;color:#94a3b8;font-weight:600;font-size:0.9rem">$${currentPrice.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>`;
      }
    }

    const firstCandle = candles.find(c => c.open > 0);
    const lastCandle = [...candles].reverse().find(c => c.close > 0);
    if (firstCandle && lastCandle && firstCandle.open !== 0) {
      const pct = ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100;
      const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
      const pctClass = pct >= 0 ? 'positive' : 'negative';
      if (bTag) bTag.innerHTML = `${sym} ${priceHtml} <span class="${pctClass}" style="margin-left:8px">${pctStr}</span>`;
    } else {
      if (bTag) bTag.innerHTML = `${sym} ${priceHtml}`;
    }
  }
}

document.getElementById('tabAssetCharts').addEventListener('click', renderAssetCharts);

// ===== ALERTS FEATURE =====
async function loadAlerts() {
  try {
    const response = await fetch('/api/alerts');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const alerts = await response.json();
    displayAlerts(alerts);
  } catch (err) {
    console.error('Failed to load alerts', err);
    document.getElementById('alertsList').innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Error loading alerts.</p>';
  }
}

function displayAlerts(alerts) {
  const listDiv = document.getElementById('alertsList');
  
  if (alerts.length === 0) {
    listDiv.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No alerts configured yet.</p>';
    return;
  }

  listDiv.innerHTML = alerts.map(alert => {
    const alertIsBRL = isBRLAsset(alert.symbol);
    const alertLocale = alertIsBRL ? 'pt-BR' : 'en-US';
    const alertCurr = alertIsBRL ? 'R$ ' : '$';
    let typeLabel = '';
    if (alert.alert_type === 'value') {
      typeLabel = `${alert.condition === 'below' ? 'Falls Below' : 'Rises Above'} ${alertCurr}${alert.threshold.toLocaleString(alertLocale, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    } else {
      typeLabel = `${alert.condition === 'below' ? 'Down' : 'Up'} ${alert.threshold.toFixed(2)}% from ${alertCurr}${(alert.reference_price || 0).toLocaleString(alertLocale, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border);">
        <div style="flex: 1;">
          <strong style="font-size: 1rem; color: var(--text-primary);">${alert.symbol}</strong>
          <span style="margin-left: 12px; color: var(--text-secondary); font-size: 0.9rem;">${typeLabel}</span>
          <span style="margin-left: 12px; color: var(--text-muted); font-size: 0.85rem;">Active: ${alert.is_active ? '✓' : '✗'}</span>
        </div>
        <button onclick="deleteAlert('${alert.id}')" class="btn btn-danger" style="padding: 6px 12px; font-size: 0.85rem;">Delete</button>
      </div>
    `;
  }).join('');
}

function updateAlertTypeDisplay() {
  const alertType = document.getElementById('alertType').value;
  const alertSym = document.getElementById('alertSymbol').value;
  const refPriceContainer = document.getElementById('referenceRefPriceContainer');
  const thresholdLabel = document.getElementById('thresholdLabel');
  const isBRL = alertSym && isBRLAsset(alertSym);
  
  if (alertType === 'percentage') {
    refPriceContainer.style.display = 'block';
    thresholdLabel.textContent = 'Change %';
  } else {
    refPriceContainer.style.display = 'none';
    thresholdLabel.textContent = isBRL ? 'Threshold (R$)' : 'Threshold ($)';
  }
}

async function createAlert() {
  const symbol = document.getElementById('alertSymbol').value;
  const alertType = document.getElementById('alertType').value;
  const condition = document.getElementById('alertCondition').value;
  const threshold = parseFloat(document.getElementById('alertThreshold').value);
  const referencePrice = alertType === 'percentage' ? parseFloat(document.getElementById('alertReferencePrice').value) : null;

  if (!symbol || isNaN(threshold)) {
    alert('Please fill in all fields');
    return;
  }

  if (alertType === 'percentage' && (isNaN(referencePrice) || referencePrice <= 0)) {
    alert('Please enter a valid reference price for percentage-based alerts');
    return;
  }

  try {
    const body = { symbol, alert_type: alertType, threshold, condition };
    if (alertType === 'percentage') {
      body.reference_price = referencePrice;
    }
    
    const response = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create alert');
    }

    // Clear form
    document.getElementById('alertSymbol').value = '';
    document.getElementById('alertThreshold').value = '';
    document.getElementById('alertReferencePrice').value = '';
    document.getElementById('alertType').value = 'value';
    document.getElementById('alertCondition').value = 'below';
    updateAlertTypeDisplay();

    // Reload alerts
    await loadAlerts();
    // Refresh triggered alerts too
    await loadTriggeredAlerts();
  } catch (err) {
    console.error('Error creating alert', err);
    alert('Error: ' + err.message);
  }
}

async function deleteAlert(alertId) {
  if (!confirm('Are you sure you want to delete this alert?')) return;

  try {
    const response = await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadAlerts();
    await loadTriggeredAlerts();
  } catch (err) {
    console.error('Error deleting alert', err);
    alert('Error deleting alert');
  }
}

async function loadTriggeredAlerts() {
  try {
    const response = await fetch('/api/alerts/triggered');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const triggered = await response.json();
    displayTriggeredAlerts(triggered);
  } catch (err) {
    console.error('Failed to load triggered alerts', err);
  }
}

function displayTriggeredAlerts(triggered) {
  const banner = document.getElementById('triggeredAlertsBanner');
  const content = document.getElementById('alertsBannerContent');

  if (triggered.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'block';
  
  content.innerHTML = triggered.map(alert => {
    const triggeredIsBRL = isBRLAsset(alert.symbol);
    const tLocale = triggeredIsBRL ? 'pt-BR' : 'en-US';
    const tCurr = triggeredIsBRL ? 'R$ ' : '$';
    const priceText = alert.alert_type === 'value'
      ? `${tCurr}${alert.current_price.toLocaleString(tLocale, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
      : `${alert.percentage_change ? alert.percentage_change.toFixed(2) : '0'}%`;
    
    const details = alert.previous_price && alert.percentage_change
      ? `from ${tCurr}${alert.previous_price.toLocaleString(tLocale, {minimumFractionDigits: 2})} to ${tCurr}${alert.current_price.toLocaleString(tLocale, {minimumFractionDigits: 2})} (${alert.percentage_change.toFixed(2)}% change)`
      : `Currently at ${tCurr}${alert.current_price.toLocaleString(tLocale, {minimumFractionDigits: 2})}`;
    
    const triggeredTime = new Date(alert.triggered_at).toLocaleString();

    return `
      <div class="alert-item">
        <div class="alert-item-info">
          <strong>${alert.symbol}</strong> - <span style="color: var(--text-secondary);">${priceText}</span>
          <br>
          <span style="font-size: 0.85rem; color: var(--text-muted);">${details} • Triggered: ${triggeredTime}</span>
        </div>
        <button class="alert-item-close" onclick="dismissAlert('${alert.id}')">Dismiss</button>
      </div>
    `;
  }).join('');
}

async function dismissAlert(triggeredAlertId) {
  try {
    const response = await fetch(`/api/alerts/dismiss/${triggeredAlertId}`, { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadTriggeredAlerts();
  } catch (err) {
    console.error('Error dismissing alert', err);
    alert('Error dismissing alert');
  }
}

async function clearAllDismissedAlerts() {
  if (!confirm('Dismiss all active alerts?')) return;
  
  try {
    const response = await fetch('/api/alerts/triggered');
    const triggered = await response.json();
    
    // Dismiss all triggered alerts
    await Promise.all(triggered.map(alert => 
      fetch(`/api/alerts/dismiss/${alert.id}`, { method: 'POST' })
    ));
    
    await loadTriggeredAlerts();
  } catch (err) {
    console.error('Error dismissing all alerts', err);
    alert('Error dismissing alerts');
  }
}

// Load alerts on initial load
window.addEventListener('load', async () => {
  await loadAlerts();
  await loadTriggeredAlerts();
  await loadCashEntries();
  // Refresh triggered alerts every 2 minutes
  setInterval(loadTriggeredAlerts, 2 * 60 * 1000);
});



// ---------------------------------------------------------------------------
// Cash Positions card
// ---------------------------------------------------------------------------

let cashEntriesCurrentPage = 1;
const CASH_ENTRIES_PAGE_SIZE = 5;

function setEntryCurrency(cur) {
  document.getElementById('entryCurrency').value = cur;
  document.getElementById('entryCurrencyBRL').classList.toggle('active', cur === 'BRL');
  document.getElementById('entryCurrencyUSD').classList.toggle('active', cur === 'USD');
}

let _cashEntriesAll = null;

async function loadCashEntries(page) {
  if (page !== undefined) cashEntriesCurrentPage = page;

  if (_cashEntriesAll === null) {
    try {
      const res = await fetch('/api/cash/entries');
      _cashEntriesAll = res.ok ? await res.json() : null;
    } catch (e) { _cashEntriesAll = null; }
  }

  const entries = _cashEntriesAll;
  const tbody = document.getElementById('cashEntriesTable');
  const pager = document.getElementById('cashEntriesPager');
  if (!tbody) return;

  if (!entries || entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">No cash entries yet.</td></tr>';
    if (pager) pager.style.display = 'none';
    return;
  }

  const totalPages = Math.ceil(entries.length / CASH_ENTRIES_PAGE_SIZE);
  cashEntriesCurrentPage = Math.max(1, Math.min(cashEntriesCurrentPage, totalPages));
  const start = (cashEntriesCurrentPage - 1) * CASH_ENTRIES_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + CASH_ENTRIES_PAGE_SIZE);

  tbody.innerHTML = pageEntries.map(e => {
    const date = new Date(e.ts).toLocaleDateString('pt-BR');
    const amount = e.currency === 'BRL'
      ? formatMoney(e.amount, 'BRL')
      : formatMoney(e.amount, 'USD');
    return `<tr>
      <td>${date}</td>
      <td>${e.currency}</td>
      <td class="${e.amount >= 0 ? 'positive' : 'negative'}">${amount}</td>
      <td><button class="btn btn-sm" onclick="deleteCashEntry('${e.id}')" style="padding:2px 10px;font-size:0.75rem;">Delete</button></td>
    </tr>`;
  }).join('');

  if (pager) {
    if (totalPages <= 1) {
      pager.style.display = 'none';
    } else {
      pager.style.display = 'flex';
      pager.style.justifyContent = 'center';
      pager.style.alignItems = 'center';
      pager.style.gap = '8px';
      pager.style.marginTop = '0px';
      pager.style.marginBottom = '24px';
      const cur = cashEntriesCurrentPage;
      pager.innerHTML = `
        <button class="btn btn-sm" ${cur === 1 ? 'disabled' : ''} onclick="loadCashEntries(${cur - 1})" style="padding:2px 10px;font-size:0.75rem;">‹ Prev</button>
        <span style="font-size:0.85rem;color:var(--text-muted);">Page ${cur} of ${totalPages}</span>
        <button class="btn btn-sm" ${cur === totalPages ? 'disabled' : ''} onclick="loadCashEntries(${cur + 1})" style="padding:2px 10px;font-size:0.75rem;">Next ›</button>
      `;
    }
  }
}

async function addCashEntry() {
  const currency = document.getElementById('entryCurrency').value;
  const rawAmount = document.getElementById('entryAmount').value.trim();
  const dateVal = document.getElementById('entryDate').value;

  const amount = parseFloat(rawAmount.replace(/[^\d.-]/g, ''));
  if (!rawAmount || isNaN(amount) || amount === 0) {
    alert('Enter a non-zero amount (e.g. +1000 or -500)');
    return;
  }
  const ts = dateVal ? new Date(dateVal + 'T12:00:00').getTime() : Date.now();

  try {
    const res = await fetch('/api/cash/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency, amount, ts }),
    });
    if (!res.ok) { alert('Failed to add cash entry'); return; }
  } catch (e) { alert('Failed to add cash entry'); return; }

  document.getElementById('entryAmount').value = '';
  document.getElementById('entryDate').value = '';

  _cashEntriesAll = null;
  cashEntriesCurrentPage = 1;
  await loadStateFromServer();
  await loadCashEntries();
  refresh();
}

window.deleteCashEntry = async function(id) {
  if (!confirm('Delete this cash entry?')) return;
  try {
    const res = await fetch(`/api/cash/entries/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert('Failed to delete cash entry'); return; }
  } catch (e) { alert('Failed to delete cash entry'); return; }
  _cashEntriesAll = null;
  await loadStateFromServer();
  await loadCashEntries();
  refresh();
};

async function fillGaps() {
  const btn = document.getElementById('settingsFillGapsBtn');
  const log = document.getElementById('logFillGaps');
  btn.disabled = true;
  btn.textContent = 'Running…';
  log.style.display = 'block';
  log.textContent = 'Calling /api/history/fill-gaps…';
  try {
    const res = await fetch('/api/history/fill-gaps', { method: 'POST' });
    const data = await res.json();
    log.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    log.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

async function runMigration(endpoint, logId, btn) {
  const log = document.getElementById(logId);
  btn.disabled = true;
  btn.textContent = 'Running…';
  log.style.display = 'block';
  log.textContent = `Calling /api/migrations/${endpoint}…`;
  try {
    const res = await fetch(`/api/migrations/${endpoint}`, { method: 'POST' });
    const data = await res.json();
    log.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    log.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run';
  }
}

// Refresh triggered alerts when refresh() is called (every price update)
const originalRefresh = window.refresh;
window.refresh = async function() {
  const result = await originalRefresh.call(this);
  await loadTriggeredAlerts();
  return result;
};
