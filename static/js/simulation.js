(async function(){
  const palette = ['#00d9ff','#7c3aed','#10b981','#f59e0b','#ef4444','#22c55e'];
  const assets = ['BTC','ETH','SOL','SPY','GLD','IBIT'];
  const assetIcons = {
    BTC: `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#F7931A" />
        <text x="12" y="16" font-size="12" text-anchor="middle" fill="#fff" font-family="system-ui, Arial">₿</text>
      </svg>`,
    ETH: `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="12,2 22,12 12,17 2,12" fill="#627EEA" />
        <polygon points="12,2 12,9 22,12 12,17" fill="#FFFFFF" opacity="0.12" />
      </svg>`,
    SOL: `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="7" width="18" height="4" rx="1.5" transform="rotate(-20 12 9)" fill="#00FFA3"/>
        <rect x="3" y="11" width="18" height="4" rx="1.5" transform="rotate(-20 12 13)" fill="#7C3AED" opacity="0.9"/>
        <rect x="3" y="15" width="18" height="4" rx="1.5" transform="rotate(-20 12 17)" fill="#00D9FF" opacity="0.85"/>
      </svg>`,
    SPY: `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="3" width="20" height="18" rx="2" fill="#0A0E1A" stroke="#2D3748" />
        <polyline points="4,14 8,10 12,13 16,8 20,12" fill="none" stroke="#10B981" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
    GLD: `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="10" r="6" fill="#D4AF37" />
        <rect x="9" y="16" width="6" height="5" rx="1.5" fill="#B8860B" />
      </svg>`,
    IBIT: `
      <svg viewBox="0 0 48 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="44" height="20" rx="3" fill="#0A84FF" />
        <text x="24" y="16" font-size="10" text-anchor="middle" fill="#fff" font-family="system-ui, Arial">IBIT</text>
      </svg>`,
    BRL: `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#F7DF1E" />
        <text x="12" y="16" font-size="11" text-anchor="middle" fill="#0a0e1a" font-family="system-ui, Arial">R$</text>
      </svg>`
  }; 
  let prices = {};
  let brlUsdRate = 0;
  let realTrades = [];
  let realCash = { cashReais:0, cashDollars:0 };

  let simPrices = {};
  // percentage overrides stored per-asset (e.g., BTC: 10 means +10%)
  let simPricePcts = {};
  let simTrades = [];
  let simCashReais = 0;
  let simCashDollars = 0;

  let simKnownSymbols = {};
  function isBRLAsset(s) { return !!(simKnownSymbols.detailed && simKnownSymbols.detailed[s] && simKnownSymbols.detailed[s].denominatedInBRL); }
  function isBRLNonBond(s) { return isBRLAsset(s) && !(simKnownSymbols.detailed[s] && simKnownSymbols.detailed[s].type === 'bond'); }
  function isBRLBond(s) { return isBRLAsset(s) && !!(simKnownSymbols.detailed[s] && simKnownSymbols.detailed[s].type === 'bond'); }

  const pieLabelPlugin = {
    id: 'pieLabelPlugin',
    afterDraw(chart, args, options) {
      if (chart.canvas.id !== 'simAllocChart') return;
      const { ctx } = chart;
      const dataset = chart.data.datasets[0];
      const meta = chart.getDatasetMeta(0);
      const total = dataset.data.reduce((a, b) => a + b, 0);
      ctx.save();

      const threshold = (options && typeof options.threshold === 'number') ? options.threshold : 5;
      const textColor = (options && options.textColor) || '#fff';
      const nameFont = (options && options.nameFont) || 'bold 12px system-ui, sans-serif';
      const pctFont = (options && options.pctFont) || '11px system-ui, sans-serif';
      const pad = 10;

      function roundRect(x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }

      const smallItems = [];
      meta.data.forEach((arc, i) => {
        const value = dataset.data[i] || 0;
        const pct = total > 0 ? (value / total) * 100 : 0;
        const label = chart.data.labels[i] || '';
        if (pct >= threshold) {
          const midAngle = (arc.startAngle + arc.endAngle) / 2;
          const r = (arc.outerRadius + (arc.innerRadius || 0)) / 2;
          const x = arc.x + Math.cos(midAngle) * r;
          const y = arc.y + Math.sin(midAngle) * r;

          ctx.font = nameFont;
          const nameW = ctx.measureText(label).width;
          ctx.font = pctFont;
          const pctText = `${pct.toFixed(1)}%`;
          const pctW = ctx.measureText(pctText).width;
          const rectW = Math.max(nameW, pctW) + pad * 2;
          const rectH = 22 + pad;

          const rectX = x - rectW / 2;
          const rectY = y - rectH / 2;
          ctx.fillStyle = 'rgba(10,14,26,0.64)';
          roundRect(rectX, rectY, rectW, rectH, 6);
          ctx.fill();

          ctx.fillStyle = textColor;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = nameFont; ctx.fillText(label, x, y - 6);
          ctx.font = pctFont; ctx.fillText(pctText, x, y + 8);
        } else {
          smallItems.push({ label, pct, color: dataset.backgroundColor ? dataset.backgroundColor[i] : '#888' });
        }
      });

      if (smallItems.length > 0) {
        const area = chart.chartArea;
        const cx = area.left + (area.right - area.left) / 2;
        const cy = area.top + (area.bottom - area.top) / 2;
        const lineH = 16;
        const totalH = Math.min(smallItems.length, 8) * lineH;
        let y = cy - totalH / 2 + lineH / 2;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '11px system-ui, sans-serif';
        const max = Math.min(smallItems.length, 8);
        for (let k = 0; k < max; k++) {
          const it = smallItems[k];
          ctx.fillStyle = it.color;
          ctx.fillRect(cx - 40, y - 7, 12, 12);
          ctx.fillStyle = '#fff';
          ctx.fillText(`${it.label} ${it.pct.toFixed(1)}%`, cx - 22, y);
          y += lineH;
        }
        if (smallItems.length > 8) {
          ctx.fillStyle = '#fff'; ctx.fillText(`+${smallItems.length - 8} more`, cx - 22, y);
        }
      }

      ctx.restore();
    }
  };
  Chart.register(pieLabelPlugin);

  function updateCompactMode() {
    const isCompact = window.innerWidth <= 430;
    document.body.classList.toggle('compact-sim', isCompact);
  }
  window.addEventListener('resize', updateCompactMode);
  window.addEventListener('orientationchange', updateCompactMode);
  updateCompactMode();

  const simAllocCtx = document.getElementById('simAllocChart').getContext('2d');
  const simAllocChart = new Chart(simAllocCtx, {
    type:'doughnut',
    data:{labels:[], datasets:[{data:[], backgroundColor:[], borderColor:'#0a0e1a', borderWidth:2}]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      cutout: '48%',
      layout:{padding:{top:8,right:8,bottom:8,left:8}},
      plugins:{ 
        legend:{display:false},
        pieLabelPlugin: {
          threshold: 5,
          textColor: '#fff',
          nameFont: 'bold 12px system-ui, sans-serif',
          pctFont: '11px system-ui, sans-serif'
        }
      }
    }
  });

  const assetsList = document.getElementById('assetsList');
  const simValueEl = document.getElementById('simValue');
  const simImpactEl = document.getElementById('simImpact');
  const simPositionsTbody = document.getElementById('simPositionsTbody');
  const simTradeHistory = document.getElementById('simTradeHistory');
  const simAllocLegend = document.getElementById('simAllocLegend');

  async function loadRealState(){
    try{
      const s = await (await fetch('/api/state')).json();
      realTrades = s.trades || [];
      realCash.cashReais = Number(s.cashReais)||0;
      realCash.cashDollars = Number(s.cashDollars)||0;
      if (isNaN(simCashReais) || simCashReais === 0) simCashReais = realCash.cashReais || 0;
      if (isNaN(simCashDollars) || simCashDollars === 0) simCashDollars = realCash.cashDollars || 0;
      simCashReais = +Number(simCashReais).toFixed(2);
      simCashDollars = +Number(simCashDollars).toFixed(2);
      document.getElementById('simCashReais').value = formatMoney(simCashReais, 'BRL');
      document.getElementById('simCashDollars').value = formatMoney(simCashDollars, 'USD');
    }catch(e){ console.warn('Failed to load state', e); }

    try{
      const p = await (await fetch('/api/prices')).json();
      prices = {};
      for(const k of Object.keys(p)){ if(['ts','cacheTTLms'].includes(k)) continue; prices[k]=p[k]; }
      brlUsdRate = p.BRLUSD || brlUsdRate || 0;
      simPrices = Object.assign({}, prices);
      for (const s of assets) {
        const base = prices[s] || 0;
        const pct = Number(simPricePcts[s]) || 0;
        if (base) simPrices[s] = +(base * (1 + pct/100)).toFixed(2);
      }
    }catch(e){ console.warn('Failed to load prices', e); }

    // Load symbols from server so adding a new ticker only requires symbols.ts change
    try {
      const symRes = await (await fetch('/api/config/symbols')).json();
      simKnownSymbols = symRes;
      const nonCurrency = (symRes.all || []).filter(s => {
        const cfg = symRes.detailed && symRes.detailed[s];
        return cfg && cfg.type !== 'currency';
      });
      if (nonCurrency.length > 0) {
        assets.length = 0;
        assets.push(...nonCurrency);
      }
      const simAssetSel = document.getElementById('simAsset');
      if (simAssetSel) {
        simAssetSel.innerHTML = '';
        for (const s of assets) {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          simAssetSel.appendChild(opt);
        }
      }
    } catch(e) { console.warn('Failed to load symbols; using defaults', e); }
  }

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

  function buildLotsFromTradesCombined(tradesCombined){
    const lots = {};
    for(const t of tradesCombined){
      if(!lots[t.symbol]) lots[t.symbol]=[];
      if(t.side==='buy'){ lots[t.symbol].push({qty:t.qty, price:t.price|| (simPrices[t.symbol]||prices[t.symbol]||0)});
      } else if(t.side==='sell'){
        let qtyToSell = t.qty;
        while(qtyToSell>0 && lots[t.symbol] && lots[t.symbol].length>0){
          const lot = lots[t.symbol][0];
          const used = Math.min(lot.qty, qtyToSell);
          lot.qty -= used; qtyToSell -= used;
          if(lot.qty<=0) lots[t.symbol].shift();
        }
      }
    }
    return lots;
  }

  function computePortfolioFromCombined(tradesCombined){
    const lots = {};
    let realized = 0;
    for(const t of tradesCombined){
      if(!lots[t.symbol]) lots[t.symbol]=[];
      if(t.side==='buy'){
        lots[t.symbol].push({qty:t.qty, price:t.price|| (simPrices[t.symbol]||prices[t.symbol]||0)});
      } else if(t.side==='sell'){
        let qtyToSell = t.qty;
        const price = t.price || (simPrices[t.symbol]||prices[t.symbol]||0);
        while(qtyToSell>0 && lots[t.symbol].length>0){
          const lot = lots[t.symbol][0];
          const used = Math.min(lot.qty, qtyToSell);
          realized += used * (price - lot.price);
          lot.qty -= used; qtyToSell -= used;
          if(lot.qty<=0) lots[t.symbol].shift();
        }
      }
    }

    const positions = {};
    for(const s of Object.keys(lots)) positions[s] = lots[s].reduce((a,b)=>a+b.qty,0);

    let totalValue = 0;
    for(const s of Object.keys(positions)){
      const current = simPrices[s] || prices[s] || 0;
      totalValue += isBRLNonBond(s) ? positions[s] * current * (brlUsdRate||1) : positions[s] * current;
    }
    totalValue += (simCashReais||0) * (brlUsdRate||1);
    totalValue += (simCashDollars||0);

    let invested = 0;
    for(const s of Object.keys(lots)){
      for(const lot of lots[s]) invested += isBRLNonBond(s) ? lot.qty * lot.price * (brlUsdRate||1) : lot.qty * lot.price;
    }
    // note: include cash as part of invested to align with main page behavior
    invested += (simCashReais||0) * (brlUsdRate||1);
    invested += (simCashDollars||0);

    const unrealized = totalValue - invested;

    return { lots, positions, realized, invested, totalValue, unrealized };
  }

  function getAssetIcon(symbol) {
    if (assetIcons[symbol]) return assetIcons[symbol];
    const fs = symbol.length > 4 ? '7' : '9';
    return `<svg viewBox="0 0 48 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2" y="2" width="44" height="20" rx="3" fill="#334155" /><text x="24" y="16" font-size="${fs}" text-anchor="middle" fill="#e2e8f0" font-family="system-ui, Arial">${symbol}</text></svg>`;
  }

  function renderAssetsControls(){
    assetsList.innerHTML = '';
    for(let i=0;i<assets.length;i++){
      const s = assets[i];
      const base = prices[s] || 0;
      const pct = Number(simPricePcts[s]) || 0;
      const price = (simPrices[s]||base||0);
      const row = document.createElement('div'); row.className='asset-row';
      const icon = getAssetIcon(s);
      const simAssetBRLNB = isBRLNonBond(s);
      const simAssetBRLB = isBRLBond(s);
      const priceFmtSim = simAssetBRLNB ? formatMoney(price,'BRL') : (simAssetBRLB ? formatMoney(price / (brlUsdRate||1),'BRL') : formatMoney(price,'USD'));
      const baseFmtSim = simAssetBRLNB ? formatMoney(base,'BRL') : (simAssetBRLB ? formatMoney(base / (brlUsdRate||1),'BRL') : formatMoney(base,'USD'));
      row.innerHTML = `
          <div class="asset-icon">${icon}</div>
        <label>${s}</label>
        <input id="price_input_${s}" class="asset-price sim-input" data-asset="${s}" type="text" value="${priceFmtSim}" />
        <div style="display:flex;align-items:center;gap:8px">
          <input id="slider_${s}" class="sim-slider" type="range" min="-100" max="300" step="1" value="${pct}" />
          <div class="small" id="pct_${s}">${pct>=0?'+':''}${pct}%</div>
        </div>
        <div style="justify-self:end" class="asset-current">Current: <span id="cur_${s}">${baseFmtSim}</span></div>`;
      assetsList.appendChild(row);

      const slider = document.getElementById('slider_'+s);
      const priceInput = document.getElementById('price_input_'+s);
      slider.addEventListener('input', (e) => {
        const p = Number(e.target.value) || 0;
        simPricePcts[s] = p;
        const basePrice = prices[s] || 0;
        const newPrice = basePrice * (1 + p/100);
        simPrices[s] = +newPrice.toFixed(2);
        const simBRLNB = isBRLNonBond(s);
        const simBRLB = isBRLBond(s);
        const displayPrice = simBRLNB ? simPrices[s] : (simBRLB ? simPrices[s] / (brlUsdRate||1) : simPrices[s]);
        const displayCurr = (simBRLNB || simBRLB) ? 'BRL' : 'USD';
        priceInput.value = displayPrice ? formatMoney(displayPrice, displayCurr) : '';
        if (document.getElementById('simAsset').value === s) {
          const spEl = document.getElementById('simPrice'); if(spEl) spEl.value = simPrices[s] ? formatMoney(simPrices[s], 'USD') : '';
          updateTotalFromQty();
        }
        document.getElementById('pct_'+s).textContent = (p>=0?'+':'') + p + '%';
        setSliderBackground(slider);
        updateAll();
      });
      priceInput.addEventListener('change', (e) => {
        const simBRLNB2 = isBRLNonBond(s);
        const simBRLB2 = isBRLBond(s);
        let parsedVal;
        if (simBRLNB2) {
          parsedVal = parseMoney(e.target.value, 'BRL') || 0;
          simPrices[s] = +parsedVal.toFixed(2);
          e.target.value = simPrices[s] ? formatMoney(simPrices[s], 'BRL') : '';
        } else if (simBRLB2) {
          parsedVal = parseMoney(e.target.value, 'BRL') || 0;
          simPrices[s] = +(parsedVal / (brlUsdRate||1)).toFixed(2);
          e.target.value = parsedVal ? formatMoney(parsedVal, 'BRL') : '';
        } else {
          parsedVal = parseMoney(e.target.value, 'USD') || 0;
          simPrices[s] = +parsedVal.toFixed(2);
          e.target.value = simPrices[s] ? formatMoney(simPrices[s],'USD') : '';
        }
        const basePrice = prices[s] || 0;
        const pctNew = basePrice ? Math.round(((simPrices[s] - basePrice) / basePrice) * 100) : 0;
        simPricePcts[s] = pctNew;
        document.getElementById('slider_'+s).value = pctNew;
        document.getElementById('pct_'+s).textContent = (pctNew>=0?'+':'') + pctNew + '%';
        if (document.getElementById('simAsset').value === s) {
          const spEl = document.getElementById('simPrice'); if(spEl) spEl.value = simPrices[s] ? formatMoney(simPrices[s], 'USD') : '';
          updateTotalFromQty();
        }
        setSliderBackground(slider);
        updateAll();
      });
      setSliderBackground(slider);
      priceInput.addEventListener('change', (e) => {
        const v = Number(e.target.value) || 0;
        simPrices[s] = +v.toFixed(2);
        const basePrice = prices[s] || 0;
        const pctNew = basePrice ? Math.round(((v - basePrice) / basePrice) * 100) : 0;
        simPricePcts[s] = pctNew;
        document.getElementById('slider_'+s).value = pctNew;
        document.getElementById('pct_'+s).textContent = (pctNew>=0?'+':'') + pctNew + '%';
        updateAll();
      });
    }

    const brlRow = document.createElement('div'); brlRow.className='asset-row';
    brlRow.innerHTML = `
      <div class="asset-icon">${assetIcons.BRL || ''}</div>
      <label>BRL per USD</label>
      <input class="asset-price sim-input" data-asset="BRLUSD" id="price_input_BRLUSD" type="text" value="${brlUsdRate ? formatMoney((1/brlUsdRate),'BRL') : ''}" />
      <div style="display:flex;align-items:center;gap:8px">
        <input id="slider_BRLUSD" class="sim-slider" type="range" min="-50" max="50" step="1" value="${Number(simPricePcts['BRLUSD']||0)}" />
        <div class="small" id="pct_BRLUSD">${Number(simPricePcts['BRLUSD']||0)>=0?'+':''}${Number(simPricePcts['BRLUSD']||0)}%</div>
      </div>
      <div style="justify-self:end" class="asset-current">Current: <span id="cur_BRLUSD">${brlUsdRate ? formatMoney((1/brlUsdRate),'BRL') : ''}</span></div>
    `;
    assetsList.appendChild(brlRow);

    document.querySelectorAll('.asset-price').forEach(inp => {
      inp.addEventListener('change', (e)=>{
        const asset = inp.dataset.asset;
        if(asset === 'BRLUSD'){
          const brlPerUsd = parseMoney(inp.value, 'BRL') || 0;
          if (brlPerUsd > 0) {
            brlUsdRate = 1 / brlPerUsd;
            const baseBrPerUsd = prices['BRLUSD'] ? (1 / prices['BRLUSD']) : (brlUsdRate ? (1/brlUsdRate) : 0);
            const pctNew = baseBrPerUsd ? Math.round(((brlPerUsd - baseBrPerUsd) / baseBrPerUsd) * 100) : 0;
            simPricePcts['BRLUSD'] = pctNew;
            const s = document.getElementById('slider_BRLUSD'); if(s) s.value = pctNew;
            const pcel = document.getElementById('pct_BRLUSD'); if(pcel) pcel.textContent = (pctNew>=0?'+':'') + pctNew + '%';
          } else brlUsdRate = 0;
          inp.value = brlPerUsd ? formatMoney(brlPerUsd,'BRL') : '';
          const cur = document.getElementById('cur_BRLUSD'); if(cur) cur.textContent = brlPerUsd ? formatMoney(brlPerUsd,'BRL') : '';
        }     else if (isBRLNonBond(asset)) {
          const val = parseMoney(inp.value, 'BRL') || 0;
          simPrices[asset] = +val.toFixed(2);
          inp.value = simPrices[asset] ? formatMoney(simPrices[asset], 'BRL') : '';
        } else if (isBRLBond(asset)) {
          const val = parseMoney(inp.value, 'BRL') || 0;
          simPrices[asset] = +(val / (brlUsdRate||1)).toFixed(2);
          inp.value = val ? formatMoney(val, 'BRL') : '';
        } else {
          const val = parseMoney(inp.value, 'USD') || 0; simPrices[asset] = +val.toFixed(2); inp.value = simPrices[asset] ? formatMoney(simPrices[asset],'USD') : '';
        }
        updateAll();
        updateCurrentSpans();
      });
    });

    const brlSlider = document.getElementById('slider_BRLUSD');
    if(brlSlider){
      brlSlider.addEventListener('input', (e)=>{
        const p = Number(e.target.value) || 0;
        simPricePcts['BRLUSD'] = p;
        const baseBrPerUsd = prices['BRLUSD'] ? (1 / prices['BRLUSD']) : (brlUsdRate ? (1/brlUsdRate) : 0);
        const newBrPerUsd = +(baseBrPerUsd * (1 + p/100)).toFixed(4);
        if(newBrPerUsd > 0) brlUsdRate = 1 / newBrPerUsd; else brlUsdRate = 0;
        const inp = document.getElementById('price_input_BRLUSD'); if(inp) inp.value = newBrPerUsd ? formatMoney(newBrPerUsd,'BRL') : '';
        const pctEl = document.getElementById('pct_BRLUSD'); if(pctEl) pctEl.textContent = (p>=0?'+':'') + p + '%';
        const cur = document.getElementById('cur_BRLUSD'); if(cur) cur.textContent = newBrPerUsd ? formatMoney(newBrPerUsd,'BRL') : '';
        setSliderBackground(brlSlider);
        updateAll();
      });
    }
  }

  function updateCurrentSpans(){
    for(const s of assets){
      const el = document.getElementById('cur_'+s);
      if(!el) continue;
      if (isBRLNonBond(s)) el.textContent = formatMoney(prices[s]||0, 'BRL');
      else if (isBRLBond(s)) el.textContent = formatMoney((prices[s]||0) / (brlUsdRate||1), 'BRL');
      else el.textContent = formatMoney(prices[s]||0,'USD');
    }
  }

  function setSliderBackground(el){
    if(!el) return;
    const min = parseFloat(el.min || -100);
    const max = parseFloat(el.max || 300);
    const val = parseFloat(el.value || 0);
    const pct = Math.round(((val - min) / (max - min)) * 100);
    const fillColor = val >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)';
    el.style.background = `linear-gradient(90deg, ${fillColor} ${pct}%, var(--bg-tertiary) ${pct}%)`;
  }
  function updateAll(){
    const combined = [...realTrades, ...simTrades];
    const st = computePortfolioFromCombined(combined);

    if (simValueEl) simValueEl.textContent = '$' + st.totalValue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    const totalImpact = st.unrealized + st.realized;
    if (simImpactEl) {
      simImpactEl.textContent = (totalImpact >= 0 ? '+' : '') + '$' + totalImpact.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
      simImpactEl.classList.toggle('positive', totalImpact >= 0);
      simImpactEl.classList.toggle('negative', totalImpact < 0);
    }

    const investedNet = Math.max(0, st.invested - st.realized);
    const unrealPct = st.invested > 0 ? (st.unrealized / st.invested) * 100 : 0;
    const brlInvested = brlUsdRate ? (investedNet / brlUsdRate) : null;
    const brlTotal = brlUsdRate ? (st.totalValue / brlUsdRate) : null;

    const investedEl = document.getElementById('sim_totalInvested');
    if (investedEl) investedEl.innerHTML = `$${(investedNet).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}<br><span class="metric-sub">${brlInvested !== null ? 'R$ ' + brlInvested.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}</span>`;

    const totalEl = document.getElementById('sim_totalValue');
    if (totalEl) totalEl.innerHTML = `$${(st.totalValue).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}<br><span class="metric-sub">${brlTotal !== null ? 'R$ ' + brlTotal.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}</span>`;

    // Total Invested = current market value of all non-cash tickers (excludes BRL cash, USD cash, and BRLUSD)
    const tickerValue = Object.keys(st.positions)
      .filter(s => s !== 'BRLUSD')
      .reduce((sum, s) => {
        const p = simPrices[s] || prices[s] || 0;
        return sum + (isBRLNonBond(s) ? (st.positions[s] || 0) * p * brlUsdRate : (st.positions[s] || 0) * p);
      }, 0);
    const investedExElem = document.getElementById('sim_totalInvestedExCash');
    if (investedExElem) investedExElem.innerHTML = `$${(tickerValue).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}<br><span class="metric-sub">${(tickerValue / brlUsdRate).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
    const investedPctElem = document.getElementById('sim_investedPct');
    const investedPct = st.totalValue > 0 ? (tickerValue / st.totalValue) * 100 : 0;
    if (investedPctElem) { investedPctElem.textContent = `${investedPct.toFixed(2)}% invested`; investedPctElem.className = 'metric-change neutral'; }
    const plElem = document.getElementById('sim_unrealizedPL');
    if (plElem) {
      const brlUnreal = brlUsdRate ? (st.unrealized / brlUsdRate) : null;
      plElem.innerHTML = `${st.unrealized >= 0 ? '+' : ''}$${(st.unrealized).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}<br><span class="metric-sub">${brlUnreal !== null ? 'R$ ' + brlUnreal.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}</span>`;
      plElem.className = st.unrealized >= 0 ? 'metric-value positive' : 'metric-value negative';
    }

    const plPct = document.getElementById('sim_unrealizedPct');
    if (plPct) { plPct.textContent = `${unrealPct >= 0 ? '+' : ''}${unrealPct.toFixed(2)}%`; plPct.className = `metric-change ${st.unrealized >= 0 ? 'positive' : 'negative'}`; }

    const valueChangeEl = document.getElementById('sim_valueChange');
    if (valueChangeEl) {
      if (Math.abs(st.unrealized) < 0.01) {
        valueChangeEl.textContent = 'Break even';
        valueChangeEl.className = 'metric-change neutral';
      } else {
        valueChangeEl.innerHTML = `${st.unrealized >= 0 ? '+' : ''}$${(st.unrealized).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${unrealPct.toFixed(2)}%)`;
        valueChangeEl.className = `metric-change ${st.unrealized >= 0 ? 'positive' : 'negative'}`;
      }
    }

    const rpElem = document.getElementById('sim_realizedPL');
    if (rpElem) {
      const brlRealized = brlUsdRate ? (st.realized / brlUsdRate) : null;
      rpElem.innerHTML = `${st.realized >= 0 ? '+' : ''}$${(st.realized).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}<br><span class="metric-sub">${brlRealized !== null ? 'R$ ' + brlRealized.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : ''}</span>`;
      rpElem.className = st.realized >= 0 ? 'metric-value positive' : 'metric-value negative';
    }

    const simCashReaisEl = document.getElementById('simCashReais'); if (simCashReaisEl) simCashReaisEl.value = formatMoney(simCashReais, 'BRL');
    const simCashDollarsEl = document.getElementById('simCashDollars'); if (simCashDollarsEl) simCashDollarsEl.value = formatMoney(simCashDollars, 'USD');
    const realizedPctEl = document.getElementById('sim_realizedPLPct');
    if (realizedPctEl) realizedPctEl.textContent = `${st.realized >= 0 ? '+' : ''}${(st.realized / Math.max(1, st.invested) * 100).toFixed(2)}% from ${simTrades.filter(t => t.side === 'sell').length} sales`;

    const combinedTrades = [...realTrades, ...simTrades];
    const firstTrade = combinedTrades.find(t => t.side === 'buy');
    const daysSinceFirst = firstTrade ? Math.max(1, (Date.now() - new Date(firstTrade.time).getTime()) / (1000*60*60*24)) : 1;
    const annualInflation = 0.03;
    const years = daysSinceFirst / 365;
    const inflationFactor = Math.pow(1 + annualInflation, years);
    const nominalFactor = st.invested > 0 ? (1 + (st.unrealized + st.realized)/st.invested) : 1;
    const realReturn = st.invested * (nominalFactor / inflationFactor - 1);
    const rrElem = document.getElementById('sim_realReturn');
    if (rrElem) {
      rrElem.innerHTML = `${realReturn >= 0 ? '+' : ''}$${(realReturn).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
      rrElem.className = realReturn >= 0 ? 'metric-value positive' : 'metric-value negative';
    }
    const rrPct = document.getElementById('sim_realReturnPct');
    const realReturnPct = st.invested > 0 ? (realReturn / st.invested) * 100 : 0;
    if (rrPct) {
      rrPct.textContent = `${realReturnPct >= 0 ? '+' : ''}${realReturnPct.toFixed(2)}% (est.)`;
      rrPct.className = `metric-change ${realReturn >= 0 ? 'positive' : 'negative'}`;
    }

    simPositionsTbody.innerHTML = '';
    const syms = Object.keys(st.positions);
    if(syms.length===0) simPositionsTbody.innerHTML = `<tr><td colspan="6" class="small">No open positions</td></tr>`;
    else{
      for(const s of syms){
        const qty = st.positions[s];
        const lots = st.lots[s] || [];
        const brlNB = isBRLNonBond(s);
        const brlB = isBRLBond(s);
        let avgFmt, curFmt, valueFmt, plFmt, plClass;
        if (brlNB) {
          const cost = lots.reduce((sum,l)=>sum+l.qty*l.price,0);
          const cur = simPrices[s] || prices[s] || 0;
          const value = qty * cur;
          const pl = value - cost;
          plClass = pl>=0 ? 'positive' : 'negative';
          avgFmt = formatMoney(qty>0 ? cost/qty : 0, 'BRL');
          curFmt = formatMoney(cur, 'BRL');
          valueFmt = formatMoney(value, 'BRL');
          plFmt = (pl>=0?'+':'') + formatMoney(pl, 'BRL');
        } else if (brlB) {
          const rate = brlUsdRate || 1;
          const costBRL = lots.reduce((sum,l)=>sum+l.qty*l.price,0) / rate;
          const curBRL = (simPrices[s] || prices[s] || 0) / rate;
          const valueBRL = qty * curBRL;
          const plBRL = valueBRL - costBRL;
          plClass = plBRL>=0 ? 'positive' : 'negative';
          avgFmt = formatMoney(qty>0 ? costBRL/qty : 0, 'BRL');
          curFmt = formatMoney(curBRL, 'BRL');
          valueFmt = formatMoney(valueBRL, 'BRL');
          plFmt = (plBRL>=0?'+':'') + formatMoney(plBRL, 'BRL');
        } else {
          const cost = lots.reduce((sum,l)=>sum+l.qty*l.price,0);
          const cur = simPrices[s] || prices[s] || 0;
          const value = qty * cur;
          const pl = value - cost;
          plClass = pl>=0 ? 'positive' : 'negative';
          avgFmt = '$' + (qty>0 ? cost/qty : 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
          curFmt = '$' + cur.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
          valueFmt = '$' + value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
          plFmt = (pl>=0?'+':'') + '$' + pl.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        }
        simPositionsTbody.innerHTML += `
          <tr>
            <td><span class="asset-icon">${assetIcons[s] || ''}</span> ${s}</td>
            <td>${qty.toFixed(4)}</td>
            <td class="currency">${avgFmt}</td>
            <td class="currency">${curFmt}</td>
            <td class="currency">${valueFmt}</td>
            <td class="${plClass}">${plFmt}</td>
          </tr>`;
      }
    }

    simTradeHistory.innerHTML = '';
    if(simTrades.length===0) simTradeHistory.innerHTML = `<tr><td colspan="6" class="small">No simulated trades</td></tr>`;
    else{
      for(const t of simTrades){
        const totalDisplay = t.total !== undefined ? (t.currency === 'BRL' ? ('R$ ' + t.total.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})) : ('$' + t.total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))) : ('$' + ((t.price||simPrices[t.symbol]||prices[t.symbol]||0)*t.qty).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
        simTradeHistory.innerHTML += `
          <tr>
            <td>${new Date(t.time).toLocaleString()}</td>
            <td>${t.symbol}</td>
            <td>${t.side.toUpperCase()}</td>
            <td>${t.qty}</td>
            <td class="currency">${formatMoney((t.price||simPrices[t.symbol]||prices[t.symbol]||0),'USD')}</td>
            <td class="currency">${totalDisplay}</td>
          </tr>`;
      }
    }

    const symbols = Object.keys(st.positions);
    const allocationValues = symbols.map(s => {
      const p = simPrices[s] || prices[s] || 0;
      return isBRLNonBond(s) ? st.positions[s] * p * brlUsdRate : st.positions[s] * p;
    });
    const cashValue = (simCashReais||0) * (brlUsdRate||1) + (simCashDollars||0);
    let totalVal = allocationValues.reduce((a,b)=>a+b,0) + cashValue;
    const labelsWithCash = [...symbols];
    const valuesWithCash = [...allocationValues];
    if(simCashReais>0){ labelsWithCash.push('BRL'); valuesWithCash.push(simCashReais*brlUsdRate); }
    if(simCashDollars>0){ labelsWithCash.push('Dollar'); valuesWithCash.push(simCashDollars); }

    const percentVals = valuesWithCash.map(v => totalVal>0? (v/totalVal)*100 : 0);
    simAllocChart.data.labels = labelsWithCash;
    simAllocChart.data.datasets[0].data = percentVals;
    simAllocChart.data.datasets[0].backgroundColor = labelsWithCash.map((_,i)=>palette[i%palette.length]);
    simAllocChart.update();

    const listEl = document.getElementById('simAllocList');
    const currentCurrency = window.simAllocCurrency || localStorage.getItem('simAllocCurrency') || 'USD';
    if (listEl) {
      listEl.innerHTML = '';
      const valuesUsd = valuesWithCash.map(v => v);
      for (let i = 0; i < labelsWithCash.length; i++) {
        const name = labelsWithCash[i];
        const valUsd = valuesUsd[i] || 0;
        const displayVal = currentCurrency === 'BRL' && brlUsdRate && brlUsdRate > 0 ? (valUsd / brlUsdRate) : valUsd;
        const currencyCode = currentCurrency === 'BRL' ? 'BRL' : 'USD';
        const row = document.createElement('div'); row.className = 'alloc-row';
        const left = document.createElement('div'); left.className = 'left';
        const sw = document.createElement('div'); sw.className = 'swatch'; sw.style.background = palette[i % palette.length];
        const lbl = document.createElement('div'); lbl.className = 'asset-label'; lbl.textContent = name;
        left.appendChild(sw); left.appendChild(lbl);
        const valEl = document.createElement('div'); valEl.className = 'asset-value'; valEl.textContent = formatMoney(displayVal, currencyCode);
        row.appendChild(left); row.appendChild(valEl);
        listEl.appendChild(row);
      }
      const note = document.getElementById('simAllocNote'); if (note) note.textContent = `Values shown in ${currentCurrency}`;
    }

    if (simAllocLegend) { simAllocLegend.innerHTML = ''; simAllocLegend.style.display = 'none'; }

  }

  document.getElementById('addSimTradeBtn').addEventListener('click', ()=>{
    const side = document.getElementById('simSide').value;
    const symbol = document.getElementById('simAsset').value;
    let qty = parseFloat(document.getElementById('simQty').value) || 0;
    const totalRaw = document.getElementById('simTotal').value;
    const totalInput = totalRaw === '' ? NaN : parseFloat(totalRaw);
    const isBRLNBSym = isBRLNonBond(symbol);
    const priceInput = parseMoney(document.getElementById('simPrice').value, isBRLNBSym ? 'BRL' : 'USD');
    const priceToUse = !isNaN(priceInput) && priceInput>0 ? priceInput : (simPrices[symbol]||prices[symbol]||0);
    // For BRL non-bond, priceToUse is in BRL; compute USD equivalent for cash accounting
    const priceUSD = isBRLNBSym ? priceToUse * (brlUsdRate||1) : priceToUse;
    const source = document.getElementById('simCashSource').value;

    if (qty <= 0) {
      if (!isNaN(totalInput) && totalInput > 0) {
        if (!priceToUse || priceToUse <= 0) return alert('Price is required to compute quantity from total');
        if (source === 'BRL' && (!brlUsdRate || brlUsdRate <= 0)) return alert('BRL/USD rate unavailable to convert total');
        let qty_computed;
        if (isBRLNBSym) {
          const totalBRL = source === 'USD' ? totalInput / (brlUsdRate||1) : totalInput;
          qty_computed = +(totalBRL / priceToUse).toFixed(4);
        } else {
          const totalUsd = source === 'USD' ? totalInput : (totalInput * brlUsdRate);
          qty_computed = +(totalUsd / priceToUse).toFixed(4);
        }
        qty = qty_computed;
        if (qty <= 0) return alert('Computed quantity is invalid; check price and total');
      } else {
        return alert('Enter valid quantity or total');
      }
    }

    let usdAmount, brlAmount;
    if (isBRLNBSym) {
      brlAmount = priceToUse * qty;
      usdAmount = brlAmount * (brlUsdRate||1);
    } else {
      usdAmount = priceToUse * qty;
      brlAmount = usdAmount / (brlUsdRate||1);
    }

    if(side==='buy'){
      if(source === 'USD'){
        if(simCashDollars < usdAmount) return alert('Not enough USD cash in scenario');
        simCashDollars = +(simCashDollars - usdAmount).toFixed(2);
      } else {
        if (!brlUsdRate || brlUsdRate <= 0) return alert('BRL/USD rate unavailable to convert total');
        if(simCashReais < brlAmount) return alert('Not enough BRL cash in scenario');
        simCashReais = +(simCashReais - brlAmount).toFixed(2);
      }
    } else {
      if(source === 'USD') { simCashDollars = +(simCashDollars + usdAmount).toFixed(2); }
      else {
        if (!brlUsdRate || brlUsdRate <= 0) return alert('BRL/USD rate unavailable to convert proceeds');
        simCashReais = +(simCashReais + brlAmount).toFixed(2);
      }
    }

    const trade = {
      symbol,
      side,
      qty,
      price: priceToUse,
      total: source === 'USD' ? +usdAmount.toFixed(2) : +brlAmount.toFixed(2),
      currency: source,
      time: new Date().toISOString()
    };
    simTrades.push(trade);
    document.getElementById('simQty').value = '';
    document.getElementById('simPrice').value = '';
    document.getElementById('simTotal').value = '';
    document.getElementById('simCashReais').value = formatMoney(simCashReais, 'BRL');
    document.getElementById('simCashDollars').value = formatMoney(simCashDollars, 'USD');
    updateAll();
  });

  document.getElementById('clearSimTradesBtn').addEventListener('click', ()=>{
    if(!confirm('Clear simulated trades and reset cash to real values?')) return;
    simTrades = [];
    simCashReais = +(realCash.cashReais || 0).toFixed(2);
    simCashDollars = +(realCash.cashDollars || 0).toFixed(2);
    document.getElementById('simCashReais').value = formatMoney(simCashReais, 'BRL');
    document.getElementById('simCashDollars').value = formatMoney(simCashDollars, 'USD');
    updateAll();
  });

  const sideBuy = document.getElementById('simSideBuy');
  const sideSell = document.getElementById('simSideSell');
  function setSide(side){ document.getElementById('simSide').value = side; sideBuy.classList.toggle('active', side==='buy'); sideSell.classList.toggle('active', side==='sell'); const hint = document.getElementById('simQtyHint'); }
  sideBuy.addEventListener('click', ()=> setSide('buy'));
  sideSell.addEventListener('click', ()=> setSide('sell'));

  const cashUSD = document.getElementById('simCashUSD');
  const cashBRL = document.getElementById('simCashBRL');
  function setCashSource(src){ document.getElementById('simCashSource').value = src; cashUSD.classList.toggle('active', src==='USD'); cashBRL.classList.toggle('active', src==='BRL'); const totalEl = document.getElementById('simTotal'); if(totalEl) totalEl.placeholder = src === 'USD' ? 'USD' : 'BRL'; if(typeof refreshPctComputed === 'function') refreshPctComputed(); }
  cashUSD.addEventListener('click', ()=> setCashSource('USD'));
  cashBRL.addEventListener('click', ()=> setCashSource('BRL'));

  setSide(document.getElementById('simSide').value || 'buy');
  setCashSource(document.getElementById('simCashSource').value || 'USD');

  document.getElementById('resetBtn').addEventListener('click', ()=>{
    if(!confirm('Reset simulation: clear trades and reset prices/cash to real values?')) return;
    simTrades = [];
    simPricePcts = {};
    simPrices = Object.assign({}, prices);
    simCashReais = realCash.cashReais;
    simCashDollars = realCash.cashDollars;
    document.querySelectorAll('[id^="price_input_"]').forEach(inp=>{ const asset = inp.dataset.asset; const val = simPrices[asset] || prices[asset] || 0; if(isBRLNonBond(asset)) inp.value = val ? formatMoney(val,'BRL') : ''; else if(isBRLBond(asset)) inp.value = val ? formatMoney(val/(brlUsdRate||1),'BRL') : ''; else inp.value = val ? formatMoney(val,'USD') : ''; });
    const baseBrPerUsd = prices['BRLUSD'] ? (1 / prices['BRLUSD']) : (brlUsdRate ? (1/brlUsdRate) : 0);
    const brlInp = document.getElementById('price_input_BRLUSD'); if(brlInp) { brlInp.value = baseBrPerUsd ? formatMoney(baseBrPerUsd,'BRL') : ''; }
    simPricePcts['BRLUSD'] = 0;
    const brlSliderReset = document.getElementById('slider_BRLUSD'); if(brlSliderReset){ brlSliderReset.value = 0; setSliderBackground(brlSliderReset); }
    const brlPctEl = document.getElementById('pct_BRLUSD'); if(brlPctEl) brlPctEl.textContent = '+0%';
    const brlCur = document.getElementById('cur_BRLUSD'); if(brlCur) brlCur.textContent = baseBrPerUsd ? formatMoney(baseBrPerUsd,'BRL') : '';

    document.querySelectorAll('[id^="slider_"]').forEach(sl=>{ sl.value = 0; setSliderBackground(sl); const aid = sl.id.replace('slider_',''); const pctel = document.getElementById('pct_'+aid); if(pctel) pctel.textContent = '+0%'; });
    const qtyPct = document.getElementById('simQtyPct'); if(qtyPct){ qtyPct.value = 0; const l = document.getElementById('simQtyPctLabel'); if(l) l.textContent = '0%'; setSliderBackground(qtyPct); const hint = document.getElementById('simQtyHint'); }

    document.getElementById('simCashReais').value = formatMoney(simCashReais, 'BRL');
    document.getElementById('simCashDollars').value = formatMoney(simCashDollars, 'USD');
    const ssel = document.getElementById('simAsset').value; const spEl = document.getElementById('simPrice'); if(spEl) spEl.value = (simPrices[ssel] || prices[ssel]) ? formatMoney((simPrices[ssel] || prices[ssel]), 'USD') : '';
    const totalEl = document.getElementById('simTotal'); if(totalEl) totalEl.value = '';
    updateAll();
  });


  document.getElementById('simCashReais').classList.add('sim-input');
  document.getElementById('simCashDollars').classList.add('sim-input');
  document.getElementById('simCashReais').addEventListener('change', (e)=>{ simCashReais = +parseMoney(e.target.value,'BRL').toFixed(2); e.target.value = formatMoney(simCashReais, 'BRL'); updateAll(); if(typeof refreshPctComputed === 'function') refreshPctComputed(); });
  document.getElementById('simCashDollars').addEventListener('change', (e)=>{ simCashDollars = +parseMoney(e.target.value,'USD').toFixed(2); e.target.value = formatMoney(simCashDollars, 'USD'); updateAll(); if(typeof refreshPctComputed === 'function') refreshPctComputed(); });

  document.getElementById('qtyInc').addEventListener('click', ()=>{ const el=document.getElementById('simQty'); el.stepUp(1); el.dispatchEvent(new Event('change')); });
  document.getElementById('qtyDec').addEventListener('click', ()=>{ const el=document.getElementById('simQty'); el.stepDown(1); el.dispatchEvent(new Event('change')); });
  document.getElementById('priceInc').addEventListener('click', ()=>{ const el=document.getElementById('simPrice'); if(!el) return; const sym2=document.getElementById('simAsset').value; const isBRL2=isBRLAsset(sym2); const cur = parseMoney(el.value, isBRL2?'BRL':'USD') || 0; const next = +(cur + 1).toFixed(2); el.value = formatMoney(next, isBRL2?'BRL':'USD'); el.dispatchEvent(new Event('change')); });
  document.getElementById('priceDec').addEventListener('click', ()=>{ const el=document.getElementById('simPrice'); if(!el) return; const sym2=document.getElementById('simAsset').value; const isBRL2=isBRLAsset(sym2); const cur = parseMoney(el.value, isBRL2?'BRL':'USD') || 0; const next = +(Math.max(0, cur - 1)).toFixed(2); el.value = formatMoney(next, isBRL2?'BRL':'USD'); el.dispatchEvent(new Event('change')); });
  const simPriceEl = document.getElementById('simPrice'); if(simPriceEl) simPriceEl.addEventListener('change', ()=>{ const sym2=document.getElementById('simAsset').value; const isBRL2=isBRLAsset(sym2); const v = parseMoney(simPriceEl.value, isBRL2?'BRL':'USD'); simPriceEl.value = v ? formatMoney(v, isBRL2?'BRL':'USD') : ''; if(typeof refreshPctComputed === 'function') refreshPctComputed(); updateTotalFromQty(); });
  const simQtyEl = document.getElementById('simQty'); if(simQtyEl) simQtyEl.addEventListener('change', ()=>{ updateTotalFromQty(); });
  const simTotalEl = document.getElementById('simTotal'); if(simTotalEl) simTotalEl.addEventListener('change', ()=>{ const source = document.getElementById('simCashSource').value; const raw = simTotalEl.value; const parsed = parseMoney(raw, source === 'USD' ? 'USD' : 'BRL'); if(parsed && parsed>0) simTotalEl.value = source === 'USD' ? formatMoney(parsed,'USD') : formatMoney(parsed,'BRL'); updateQtyFromTotal(); });

  function computeQtyFromPctFor(symbol, pct){
    const side = document.getElementById('simSide').value;
    const isBRLSym = isBRLAsset(symbol);
    const priceInputVal = document.getElementById('simPrice').value;
    const price = parseMoney(priceInputVal, isBRLSym ? 'BRL' : 'USD') || simPrices[symbol] || prices[symbol] || 0;
    if(!price || price <= 0) return 0;
    if(side === 'sell'){
      const combined = [...realTrades, ...simTrades];
      const st = computePortfolioFromCombined(combined);
      const avail = st.positions[symbol] || 0; return +(avail * pct / 100).toFixed(4);
    } else {
      const source = document.getElementById('simCashSource').value;
      if (isBRLNonBond(symbol)) {
        const availBRL = source === 'USD' ? (simCashDollars||0) / (brlUsdRate||1) : (simCashReais||0);
        return +((availBRL * pct / 100) / price).toFixed(4);
      }
      if(source === 'BRL' && (!brlUsdRate || brlUsdRate <= 0)) return 0;
      const availUsd = source === 'USD' ? simCashDollars : (simCashReais || 0) * (brlUsdRate || 0);
      const usdForPct = availUsd * pct / 100; return +(usdForPct / price).toFixed(4);
    }
  }

  function updateTotalFromQty(){
    const qty = parseFloat(document.getElementById('simQty').value) || 0;
    const sym = document.getElementById('simAsset').value;
    const isBRLSym = isBRLAsset(sym);
    const price = parseMoney(document.getElementById('simPrice').value, isBRLSym ? 'BRL' : 'USD') || simPrices[sym] || prices[sym] || 0;
    const totalEl = document.getElementById('simTotal');
    if(!totalEl) return;
    const source = document.getElementById('simCashSource').value;
    if (isBRLNonBond(sym)) {
      const brlTotal = +(qty * price).toFixed(2);
      if(!brlTotal || brlTotal <= 0) totalEl.value = '';
      else if(source === 'BRL') totalEl.value = formatMoney(brlTotal, 'BRL');
      else { if(!brlUsdRate || brlUsdRate <= 0) totalEl.value = ''; else totalEl.value = formatMoney(brlTotal * brlUsdRate, 'USD'); }
    } else {
      const usdAmount = +(qty * price).toFixed(2);
      if(!usdAmount || usdAmount <= 0) totalEl.value = '';
      else if(source === 'USD') totalEl.value = formatMoney(usdAmount, 'USD');
      else { if(!brlUsdRate || brlUsdRate <= 0) totalEl.value = ''; else totalEl.value = formatMoney(usdAmount / brlUsdRate, 'BRL'); }
    }
  }

  function updateQtyFromTotal(){
    const totalRaw = document.getElementById('simTotal').value;
    const source = document.getElementById('simCashSource').value;
    const totalInput = totalRaw === '' ? NaN : parseMoney(totalRaw, source === 'USD' ? 'USD' : 'BRL');
    if(isNaN(totalInput) || totalInput <= 0) return;
    const sym = document.getElementById('simAsset').value;
    const isBRLSym = isBRLAsset(sym);
    const price = parseMoney(document.getElementById('simPrice').value, isBRLSym ? 'BRL' : 'USD') || simPrices[sym] || prices[sym] || 0;
    if(!price || price <= 0) return;
    if (isBRLNonBond(sym)) {
      const totalBRL = source === 'USD' ? totalInput / (brlUsdRate||1) : totalInput;
      const qty = +(totalBRL / price).toFixed(4);
      document.getElementById('simQty').value = qty; return;
    }
    if(source === 'BRL'){
      if(!brlUsdRate || brlUsdRate <= 0) return;
      const usd = totalInput * brlUsdRate;
      const qty = +(usd / price).toFixed(4); document.getElementById('simQty').value = qty; return;
    }
    const qty = +(totalInput / price).toFixed(4); document.getElementById('simQty').value = qty;
  }

  const qtyPctSlider = document.getElementById('simQtyPct');
  const qtyPctLabel = document.getElementById('simQtyPctLabel');
  const maxQtyBtn = document.getElementById('maxQtyBtn');
  function refreshPctComputed(){
    const slider = document.getElementById('simQtyPct');
    if(!slider) return;
    const pct = Number(slider.value);
    const label = document.getElementById('simQtyPctLabel');
    if(label) label.textContent = pct + '%';
    const sym = document.getElementById('simAsset').value;
    const computed = computeQtyFromPctFor(sym, pct);
    const hint = document.getElementById('simQtyHint');
    
    const _sym = document.getElementById('simAsset').value;
    const isBRLSym2 = isBRLAsset(_sym);
    const price = parseMoney(document.getElementById('simPrice').value, isBRLSym2 ? 'BRL' : 'USD') || simPrices[_sym] || prices[_sym] || 0;
    const usdAmount = +(computed * price).toFixed(2);
    const totalEl = document.getElementById('simTotal');
    if(totalEl){
      const source = document.getElementById('simCashSource').value;
      if (isBRLNonBond(_sym)) {
        const brlAmount = +(computed * price).toFixed(2);
        if(!brlAmount || brlAmount <= 0) totalEl.value = '';
        else if(source === 'BRL') totalEl.value = brlAmount.toFixed(2);
        else { if(!brlUsdRate || brlUsdRate <= 0) totalEl.value = ''; else totalEl.value = (brlAmount * brlUsdRate).toFixed(2); }
      } else {
        if(!usdAmount || usdAmount <= 0) totalEl.value = '';
        else if(source === 'USD') totalEl.value = usdAmount.toFixed(2);
        else { if(!brlUsdRate || brlUsdRate <= 0) totalEl.value = ''; else totalEl.value = (usdAmount / brlUsdRate).toFixed(2); }
      }
    }
  }
  const _qtyPctSlider = document.getElementById('simQtyPct');
  if(_qtyPctSlider){
    _qtyPctSlider.addEventListener('input', ()=>{ 
      refreshPctComputed(); 
      setSliderBackground(_qtyPctSlider); 
      const sym = document.getElementById('simAsset').value;
      const computed = computeQtyFromPctFor(sym, Number(_qtyPctSlider.value));
      const qtyEl = document.getElementById('simQty'); if(qtyEl) qtyEl.value = computed;
      updateTotalFromQty();
    });
    const _max = document.getElementById('maxQtyBtn');
    if(_max) _max.addEventListener('click', ()=>{ _qtyPctSlider.value = 100; refreshPctComputed(); const sym=document.getElementById('simAsset').value; const computed=computeQtyFromPctFor(sym, 100); document.getElementById('simQty').value = computed; updateTotalFromQty(); });
  }
  document.getElementById('simAsset').addEventListener('change', ()=>{ refreshPctComputed(); const s = document.getElementById('simAsset').value; const rawP = simPrices[s] || prices[s] || 0; const displayP = isBRLBond(s) ? rawP / (brlUsdRate||1) : rawP; const spEl = document.getElementById('simPrice'); if(spEl) spEl.value = displayP ? displayP.toFixed(2) : ''; updateTotalFromQty(); });

  window.scenariosList = [];
  async function fetchScenarios() {
    try {
      const resp = await fetch('/api/scenarios');
      if (!resp.ok) throw new Error('Failed to fetch');
      const list = await resp.json();
      window.scenariosList = list;

      const ow = document.getElementById('saveModalOverwrite');
      if (ow) {
        ow.innerHTML = '<option value="">(New scenario)</option>';
        list.forEach(s => {
          const opt = document.createElement('option'); opt.value = s.id; opt.textContent = `${s.name} — ${new Date(s.updatedAt).toLocaleString()}`; ow.appendChild(opt);
        });
      }

      const tbody = document.getElementById('scenariosTableBody');
      if (tbody) {
        tbody.innerHTML = '';
        list.forEach(s => {
          const tr = document.createElement('tr');
          const created = new Date(s.createdAt).toLocaleString();
          const updated = new Date(s.updatedAt).toLocaleString();
          tr.innerHTML = `<td>${s.name}</td><td class="small">${created}</td><td class="small">${updated}</td><td><button class="btn" data-action="load" data-id="${s.id}">Load</button> <button class="btn btn-danger" data-action="delete" data-id="${s.id}">Delete</button></td>`;
          tbody.appendChild(tr);
        });
      }

      return list;
    } catch (err) {
      console.warn('Failed to fetch scenarios', err);
      return [];
    }
  }

  document.getElementById('openSaveModalBtn').addEventListener('click', ()=>{
    document.getElementById('saveModalName').value = '';
    document.getElementById('saveModalOverwrite').value = '';
    fetchScenarios();
    document.getElementById('saveModal').style.display = '';
  });
  document.getElementById('cancelSaveModalBtn').addEventListener('click', ()=>{ document.getElementById('saveModal').style.display = 'none'; });

  document.getElementById('confirmSaveModalBtn').addEventListener('click', async ()=>{
    const name = (document.getElementById('saveModalName') || { value: '' }).value.trim();
    const overwriteId = (document.getElementById('saveModalOverwrite') || { value: '' }).value;
    if (!name) return alert('Please enter a scenario name');
    const payload = { version: 1, simPrices, simTrades, simCashReais, simCashDollars, simPricePcts };
    try {
      if (overwriteId) {
        const r = await fetch('/api/scenarios/' + encodeURIComponent(overwriteId), { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, data: payload }) });
        if (!r.ok) throw new Error('Update failed');
        alert('Scenario updated');
      } else {
        const r = await fetch('/api/scenarios', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, data: payload }) });
        if (!r.ok) throw new Error('Save failed');
        alert('Scenario saved');
      }
      await fetchScenarios();
      document.getElementById('saveModal').style.display = 'none';
    } catch (err) {
      console.error('Failed to save scenario', err); alert('Failed to save scenario');
    }
  });

  document.getElementById('openScenariosBtn').addEventListener('click', async ()=>{
    await fetchScenarios();
    document.getElementById('openModal').style.display = '';
  });
  document.getElementById('closeOpenModalBtn').addEventListener('click', ()=>{ document.getElementById('openModal').style.display = 'none'; });

  document.getElementById('scenariosTableBody').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const action = btn.getAttribute('data-action'); const id = btn.getAttribute('data-id');
    if (action === 'load') {
      try {
        const r = await fetch('/api/scenarios/' + encodeURIComponent(id));
        if (!r.ok) throw new Error('Load failed');
        const j = await r.json(); const d = j.data || {};
        // Version guard: unversioned blobs are treated as v1 for backward compat (Ch. 4 — schema evolution)
        if ((d.version ?? 1) !== 1) { alert('Scenario was saved with a newer version of this app and may not load correctly.'); }
        simPrices = d.simPrices || simPrices || {};
        simPricePcts = d.simPricePcts || simPricePcts || {};
        simTrades = d.simTrades || [];
        simCashReais = typeof d.simCashReais !== 'undefined' ? d.simCashReais : simCashReais;
        simCashDollars = typeof d.simCashDollars !== 'undefined' ? d.simCashDollars : simCashDollars;
        renderAssetsControls(); updateAll(); if(typeof refreshPctComputed === 'function') refreshPctComputed();
        document.getElementById('openModal').style.display = 'none';
        alert('Scenario loaded');
      } catch (err) { console.error('Failed to load scenario', err); alert('Failed to load scenario'); }
    } else if (action === 'delete') {
      if(!confirm('Delete selected scenario?')) return;
      try { const r = await fetch('/api/scenarios/' + encodeURIComponent(id), { method: 'DELETE' }); if(!r.ok) throw new Error('Delete failed'); await fetchScenarios(); alert('Scenario deleted'); } catch (err) { console.error('Failed to delete scenario', err); alert('Failed to delete scenario'); }
    }
  });


  await loadRealState();
  renderAssetsControls();
  updateAll();
  if(typeof refreshPctComputed === 'function') refreshPctComputed();
  await fetchScenarios();

  window.simAllocCurrency = localStorage.getItem('simAllocCurrency') || 'USD';
  const btcBtn = document.getElementById('allocUsdBtn'); const brlBtn = document.getElementById('allocBrlBtn');
  function setAllocCurrency(c){ window.simAllocCurrency = c; localStorage.setItem('simAllocCurrency', c); if(btcBtn) btcBtn.classList.toggle('active', c === 'USD'); if(brlBtn) brlBtn.classList.toggle('active', c === 'BRL'); updateAll(); }
  if(btcBtn) btcBtn.addEventListener('click', ()=> setAllocCurrency('USD'));
  if(brlBtn) brlBtn.addEventListener('click', ()=> setAllocCurrency('BRL'));
  setAllocCurrency(window.simAllocCurrency);

  (function syncSimPriceToSelected(){ const s = document.getElementById('simAsset').value; const sp = simPrices[s] || prices[s] || ''; const spEl = document.getElementById('simPrice'); if(spEl) spEl.value = sp ? formatMoney(sp,'USD') : ''; updateTotalFromQty(); })();
})();