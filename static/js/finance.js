function getPageStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const monthParam = Number(params.get('month'));
    const yearParam = Number(params.get('year'));
    const now = new Date();
    const month = Number.isInteger(monthParam) && monthParam >= 0 && monthParam <= 12 ? monthParam : now.getMonth();
    const year = Number.isInteger(yearParam) && yearParam >= 1900 && yearParam <= 3000 ? yearParam : now.getFullYear();
    return { month, year };
}

function updateUrlState(replace = true) {
    const params = new URLSearchParams(window.location.search);
    params.set('month', String(currentMonth));
    params.set('year', String(selectedYear));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    if (replace) {
        window.history.replaceState(null, '', newUrl);
    } else {
        window.history.pushState(null, '', newUrl);
    }
}

function applyPageState(month, year, options = {}) {
    const { replace = true, push = false } = options;
    currentMonth = month;
    selectedYear = year;
    const yearSelect = document.getElementById('yearSelect');
    if (yearSelect) yearSelect.value = String(year);
    setActiveMonthTab(month);
    if (push) {
        updateUrlState(false);
    } else if (replace) {
        updateUrlState(true);
    }

    if (currentMonth === 12) {
        document.getElementById('monthlyView').style.display = 'none';
        document.getElementById('annualView').style.display = 'block';
        renderAnnualCharts();
        renderAnnualSummary();
    } else {
        document.getElementById('monthlyView').style.display = 'block';
        document.getElementById('annualView').style.display = 'none';
        renderAll();
    }
}

const initialPageState = getPageStateFromUrl();
let currentMonth = initialPageState.month;
// Selected year (default to current year). UI: <select id="yearSelect">
let selectedYear = initialPageState.year;
const categoryIcons = { alimentacao: '🍎', saude: '🏥', educacao: '🎓', moradia: '🏠', transporte: '🚗', lazer: '🎉', comunicacao: '📱', viagens: '✈️', restaurantes: '🍽️', comprinhas: '🛍️', imigracao: '🛂', diversos: '🔸' };
const categoryNames = { alimentacao: 'Alimentação', saude: 'Saúde', educacao: 'Educação', moradia: 'Moradia', transporte: 'Transporte', lazer: 'Lazer', comunicacao: 'Comunicação', viagens: 'Viagens', restaurantes: 'Restaurantes', comprinhas: 'Comprinhas', imigracao: 'Imigração', diversos: 'Outros' };

function getCategoryName(cat) {
    if (!cat) return 'Outros';
    return categoryNames[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
}

function getCategoryIcon(cat) {
    return categoryIcons[cat] || '🔸';
}

// Parse numbers entered in BR format (e.g. "1.234,56" or "101,50") into JS Number
function parseBRNumber(str) {
    if (typeof str === 'number') return str;
    str = String(str || '').trim();
    if (str === '') return 0;
    // Remove spaces and thousands separators (dots), then replace comma with dot
    const cleaned = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
}

function formatBRNumber(n) {
    return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

// ====================================================================
// API helper — centralises all server communication
// ====================================================================
const API = {
    /** Low-level fetch wrapper. Returns parsed JSON, true for 204, or null on failure. */
    async _request(url, method = 'GET', body = undefined) {
        try {
            const opts = { method, headers: { 'Content-Type': 'application/json' } };
            if (body !== undefined) opts.body = JSON.stringify(body);
            const resp = await fetch(url, opts);
            if (!resp.ok) { console.warn(`API ${method} ${url} → ${resp.status}`); return null; }
            if (resp.status === 204) return true;
            return await resp.json();
        } catch (err) { console.warn(`API ${method} ${url} error`, err); return null; }
    },
    // Incomes
    createIncome(data)       { return API._request('/api/finance/incomes', 'POST', data); },
    updateIncome(id, data)   { return API._request(`/api/finance/incomes/${id}`, 'PUT', data); },
    deleteIncome(id)         { return API._request(`/api/finance/incomes/${id}`, 'DELETE'); },
    // Fixed
    createFixed(data)        { return API._request('/api/finance/fixed', 'POST', data); },
    updateFixed(id, data)    { return API._request(`/api/finance/fixed/${id}`, 'PUT', data); },
    deleteFixed(id)          { return API._request(`/api/finance/fixed/${id}`, 'DELETE'); },
    // Eventual
    createEventual(data)     { return API._request('/api/finance/eventual', 'POST', data); },
    updateEventual(id, data) { return API._request(`/api/finance/eventual/${id}`, 'PUT', data); },
    deleteEventual(id)       { return API._request(`/api/finance/eventual/${id}`, 'DELETE'); },
    // Credit cards
    createCredit(data)       { return API._request('/api/finance/credit', 'POST', data); },
    updateCredit(id, data)   { return API._request(`/api/finance/credit/${id}`, 'PUT', data); },
    deleteCredit(id)         { return API._request(`/api/finance/credit/${id}`, 'DELETE'); },
    // Years
    getYears()               { return API._request('/api/finance/years'); },
    createYear(year)         { return API._request('/api/finance/years', 'POST', { year }); },
    resetYear(year)          { return API._request(`/api/finance/years/${year}/reset`, 'POST'); },
    // Full state
    load(year)               { return API._request(`/api/finance?year=${year}`); },
    importData(payload)      { return API._request('/api/finance/import', 'POST', payload); },
};


function createEmptyDataset() {
    return {
        incomes: Array.from({ length: 12 }, () => []),
        tithes: Array.from({ length: 12 }, () => []),
        fixedExpenses: Array.from({ length: 12 }, () => []),
        eventualExpenses: Array.from({ length: 12 }, () => []),
        creditCards: {
            nuRenan: Array.from({ length: 12 }, () => []),
            nuJu: Array.from({ length: 12 }, () => []),
            nomad: Array.from({ length: 12 }, () => [])
        }
    };
}

async function loadFinanceData(year) {
    const json = await API.load(year);
    if (!json) throw new Error('Failed to load finance data from server');
    normalizeFinanceData(json);
    if (typeof json.year === 'number') {
        selectedYear = json.year;
        const sel = document.getElementById('yearSelect'); if (sel) sel.value = String(selectedYear);
    }
    return json;
}

function loadData(year) {
    return createEmptyDataset();
}

function saveData() {
    // No-op persistence wrapper; data is stored on the server through API calls.
}

function normalizeFinanceData(data) {
    const ensureMonths = (arr) => {
        if (!Array.isArray(arr)) arr = [];
        while (arr.length < 12) arr.push([]);
        return arr.map(item => Array.isArray(item) ? item : []);
    };
    data.incomes = ensureMonths(data.incomes);
    data.tithes = ensureMonths(data.tithes);
    data.fixedExpenses = ensureMonths(data.fixedExpenses);
    data.eventualExpenses = ensureMonths(data.eventualExpenses);
    data.creditCards = data.creditCards || {};
    data.creditCards.nuRenan = ensureMonths(data.creditCards.nuRenan);
    data.creditCards.nuJu = ensureMonths(data.creditCards.nuJu);
    data.creditCards.nomad = ensureMonths(data.creditCards.nomad);

    // Migrate legacy 'mercado' category → 'alimentacao' (frontend-only normalization)
    const migrateMercado = (arr) => {
        for (let m = 0; m < 12; m++) {
            (arr[m] || []).forEach(item => { if (item && item.category === 'mercado') item.category = 'alimentacao'; });
        }
    };
    migrateMercado(data.fixedExpenses);
    migrateMercado(data.eventualExpenses);
    ['nuRenan','nuJu','nomad'].forEach(card => {
        (data.creditCards[card] || []).forEach(monthArr => monthArr.forEach(item => { if (item && item.category === 'mercado') item.category = 'alimentacao'; }));
    });

    // Seed default fixed expenses (frontend-only defaults, value = 0).
    // Keep this list small and id-less so server will assign ids if persisted.
    const defaultFixed = [
        { name: 'Aluguel', category: 'moradia', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 },
        { name: 'Condomínio', category: 'moradia', value: 0, paymentMethod: 'boleto', normallyDueDay: 25 },
        { name: 'Luz', category: 'moradia', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 },
        { name: 'Celular claro', category: 'comunicacao', value: 0, paymentMethod: 'credito', normallyDueDay: 12 },
        { name: 'Fibra vivo', category: 'comunicacao', value: 0, paymentMethod: 'credito', normallyDueDay: 12 },
        { name: 'Escola Julia', category: 'educacao', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 },
        { name: "Inglês Julia", category: 'educacao', value: 0, paymentMethod: 'boleto', normallyDueDay: 5 },
        { name: 'Praia Clube', category: 'lazer', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 }
    ];

    // For each month, add any missing default fixed expenses (do not duplicate by name)
    // ALSO merge normallyDueDay from defaults into existing items
    for (let m = 0; m < 12; m++) {
        const monthArr = data.fixedExpenses[m] || [];
        const normalizeName = s => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const existingNames = new Set((monthArr || []).map(f => normalizeName((f && f.name) ? String(f.name).trim() : '')));
        
        // First pass: merge normallyDueDay from defaults into existing items
        defaultFixed.forEach(def => {
            const defNormalized = normalizeName(def.name);
            monthArr.forEach(item => {
                if (normalizeName(item.name || '') === defNormalized) {
                    // Merge normallyDueDay if not already set
                    if (item.normallyDueDay === undefined || item.normallyDueDay === null) {
                        item.normallyDueDay = def.normallyDueDay;
                    }
                }
            });
        });
        
        // Second pass: add any missing default items
        defaultFixed.forEach(def => {
            if (!existingNames.has(normalizeName(def.name))) {
                // push a shallow copy so we don't accidentally reference the default list
                monthArr.push({ name: def.name, category: def.category, value: def.value, paymentMethod: def.paymentMethod, normallyDueDay: def.normallyDueDay });
            }
        });
        data.fixedExpenses[m] = monthArr;
    }
}

function exportData() {
    // Include year in export so server can import correctly for that year
    const payload = { ...data, year: selectedYear };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-data-${selectedYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function validateData(d) {
    const errors = [];
    const warnings = [];
    const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

    const checkNumber = (val) => typeof val === 'number' && isFinite(val);

    if (!d || typeof d !== 'object') {
        errors.push('Arquivo inválido: JSON não é um objeto.');
        return { errors, warnings };
    }

    const ensureArray = (v, name) => {
        if (!Array.isArray(v)) errors.push(`Propriedade "${name}" ausente ou não é um array.`);
    };

    ensureArray(d.incomes, 'incomes');
    ensureArray(d.tithes, 'tithes');
    ensureArray(d.fixedExpenses, 'fixedExpenses');
    ensureArray(d.eventualExpenses, 'eventualExpenses');

    if (!d.creditCards || typeof d.creditCards !== 'object') errors.push('Propriedade "creditCards" ausente ou inválida.');



    // Per-month validation
    for (let m = 0; m < 12; m++) {
        const mn = monthNames[m];
        const incomes = (d.incomes && d.incomes[m]) || [];
        const sourceCounts = {};
        incomes.forEach((inc, idx) => {
            if (!inc || typeof inc !== 'object') { errors.push(`${mn}: entrada #${idx+1} inválida.`); return; }
            if (!inc.source || typeof inc.source !== 'string') errors.push(`${mn}: entrada #${idx+1} sem 'source' válido.`);
            if (!checkNumber(inc.value)) errors.push(`${mn}: entrada '${inc.source || ('#'+(idx+1))}' tem 'value' inválido.`);
            else if (inc.value < 0) warnings.push(`${mn}: entrada '${inc.source}' tem valor negativo.`);
            if (inc.source) sourceCounts[inc.source] = (sourceCounts[inc.source] || 0) + 1;
        });
        Object.entries(sourceCounts).forEach(([src, cnt]) => {
            if (cnt > 1) warnings.push(`${mn}: entradas duplicadas para fonte '${src}' (${cnt} vezes).`);
        });

        const checkExpenses = (arr, label) => {
            (arr || []).forEach((e, idx) => {
                if (!e || typeof e !== 'object') { errors.push(`${mn}: ${label} #${idx+1} inválido.`); return; }
                if (label === 'fixed' && (!e.name || typeof e.name !== 'string')) errors.push(`${mn}: gasto fixo #${idx+1} sem 'name'.`);
                if (!e.category || typeof e.category !== 'string') warnings.push(`${mn}: ${label} #${idx+1} sem 'category' ou categoria inválida.`);
                if (!checkNumber(e.value)) errors.push(`${mn}: ${label} '${e.name || e.category || ('#'+(idx+1))}' tem 'value' inválido.`);
                else if (e.value < 0) warnings.push(`${mn}: ${label} '${e.name || e.category}' tem valor negativo.`);
                // paymentMethod optional for older data, but prefer to warn if missing
                if (!e.paymentMethod || typeof e.paymentMethod !== 'string') warnings.push(`${mn}: ${label} #${idx+1} sem 'paymentMethod'.`);
            });
        };

        checkExpenses((d.fixedExpenses && d.fixedExpenses[m]) || [], 'fixed');
        checkExpenses((d.eventualExpenses && d.eventualExpenses[m]) || [], 'eventual');

        ['nuRenan','nuJu','nomad'].forEach(card => {
            const arr = (d.creditCards && d.creditCards[card] && d.creditCards[card][m]) || [];
            arr.forEach((e, idx) => {
                if (!e || typeof e !== 'object') { errors.push(`${mn}: cartão ${card} item #${idx+1} inválido.`); return; }
                if (!e.category || typeof e.category !== 'string') warnings.push(`${mn}: cartão ${card} item #${idx+1} sem 'category'.`);
                if (!checkNumber(e.value)) errors.push(`${mn}: cartão ${card} item #${idx+1} tem 'value' inválido.`);
                else if (e.value < 0) warnings.push(`${mn}: cartão ${card} item #${idx+1} tem valor negativo.`);
            });
        });

    }

    return { errors, warnings };
}

function showImportErrorsModal(errors, warnings) {
    const list = document.getElementById('importErrorsList');
    const summary = document.getElementById('importErrorsSummary');
    list.innerHTML = '';
    errors.forEach(msg => {
        const li = document.createElement('li');
        li.style.color = '#f87171';
        li.style.marginBottom = '0.5rem';
        li.textContent = 'Erro: ' + msg;
        list.appendChild(li);
    });
    warnings.forEach(msg => {
        const li = document.createElement('li');
        li.style.color = '#f59e0b';
        li.style.marginBottom = '0.5rem';
        li.textContent = 'Aviso: ' + msg;
        list.appendChild(li);
    });
    summary.textContent = `Encontrados ${errors.length} erro(s) e ${warnings.length} aviso(s).`;
    // If there are no errors, allow importing even if warnings
    const btn = document.getElementById('importAnywayBtn');
    if (errors.length > 0) {
        btn.textContent = 'Forçar Importação (não recomendado)';
        btn.disabled = false;
    } else {
        btn.textContent = 'Importar mesmo assim';
        btn.disabled = false;
    }
    document.getElementById('importErrorsModal').classList.add('active');
}

async function importAnyway() {
    if (!window._pendingImportData) return closeModal('importErrorsModal');
    const tmp = window._pendingImportData;
    tmp.year = Number.isFinite(tmp.year) ? tmp.year : selectedYear;

    const result = await API.importData(tmp);
    if (result) {
        await loadFromServer();
        closeModal('importErrorsModal');
        alert('Dados importados no servidor com sucesso!');
        window._pendingImportData = null;
        return;
    }

    // Fallback to local import
    if (Number.isFinite(tmp.year)) { selectedYear = tmp.year; const sel = document.getElementById('yearSelect'); if (sel) sel.value = String(selectedYear); }
    data = tmp;
    normalizeFinanceData(data);
    saveData();
    renderAll();
    closeModal('importErrorsModal');
    alert('Dados importados localmente (servidor indisponível). Verifique os avisos/erros listados.');
    window._pendingImportData = null;
}

async function importData() {
    const file = document.getElementById('importFile').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const tmp = JSON.parse(e.target.result);
            normalizeFinanceData(tmp);
            const { errors, warnings } = validateData(tmp);

            if (errors.length > 0) {
                window._pendingImportData = tmp;
                showImportErrorsModal(errors, warnings);
                return;
            }

            if (warnings.length > 0) {
                console.warn('Import warnings:', warnings);
                alert(`Avisos encontrados (${warnings.length}). Os dados serão enviados ao servidor.`);
            }

            tmp.year = Number.isFinite(tmp.year) ? tmp.year : selectedYear;
            const result = await API.importData(tmp);
            if (result) {
                await loadFromServer();
                alert('Dados importados e carregados do servidor com sucesso!');
                return;
            }

            // Fallback to client-side import
            if (Number.isFinite(tmp.year)) { selectedYear = tmp.year; const sel = document.getElementById('yearSelect'); if (sel) sel.value = String(selectedYear); }
            data = tmp; normalizeFinanceData(data); saveData(); renderAll();
            alert('Dados importados localmente (server indisponível).');
        } catch (err) {
            alert('Erro ao importar: ' + (err && err.message ? err.message : String(err)));
        }
    };
    reader.readAsText(file);
}

async function loadFromServer(silent = false) {
    try {
        const json = await loadFinanceData(selectedYear);
        data = json;
        renderAll();
        if (!silent) alert('Dados carregados do servidor com sucesso!');
        return true;
    } catch (err) {
        console.warn('Failed to load from server', err);
        if (!silent) alert('Falha ao carregar do servidor: ' + (err && err.message ? err.message : String(err)));
        return false;
    }
}



let data = loadData(selectedYear);
normalizeFinanceData(data);
saveData();

let categoryChart, evolutionChart, annualExpensesVsBalanceChart, annualChart2;

async function setupYearSelect() {
    const sel = document.getElementById('yearSelect');
    sel.innerHTML = '';
    const curr = new Date().getFullYear();

    // Fetch years from server; fallback to a small range if server unavailable
    const years = await API.getYears();

    if (Array.isArray(years) && years.length > 0) {
        years.forEach(y => {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            sel.appendChild(opt);
        });
        const requestedYear = selectedYear;
        const yearInList = years.includes(requestedYear);
        selectedYear = requestedYear;
        if (!yearInList) {
            const opt = document.createElement('option');
            opt.value = String(selectedYear);
            opt.textContent = `${selectedYear} (local)`;
            sel.insertBefore(opt, sel.firstChild);
        }
        sel.value = String(selectedYear);
    } else {
        for (let y = curr - 3; y <= curr + 1; y++) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            if (y === selectedYear) opt.selected = true;
            sel.appendChild(opt);
        }
        if (!sel.value) {
            const opt = document.createElement('option');
            opt.value = String(selectedYear);
            opt.textContent = `${selectedYear} (local)`;
            sel.insertBefore(opt, sel.firstChild);
            sel.value = String(selectedYear);
        }
    }

    sel.addEventListener('change', async () => {
        selectedYear = Number(sel.value);
        data = createEmptyDataset();
        normalizeFinanceData(data);
        renderAll();
        updateUrlState(false);
        await loadFromServer(true);
    });

    // Helper: create an empty dataset for a year
    function emptyDataset() {
        return {
            incomes: Array.from({ length: 12 }, () => []),
            tithes: Array.from({ length: 12 }, () => []),
            fixedExpenses: Array.from({ length: 12 }, () => []),
            eventualExpenses: Array.from({ length: 12 }, () => []),
            creditCards: { nuRenan: Array.from({ length: 12 }, () => []), nuJu: Array.from({ length: 12 }, () => []), nomad: Array.from({ length: 12 }, () => []) },
        };
    }

    // Add year button
    const addBtn = document.getElementById('addYearBtn');
    if (addBtn) addBtn.addEventListener('click', async () => {
        const input = prompt('Adicionar ano (YYYY):', String(selectedYear + 1));
        if (!input) return;
        const y = parseInt(input.trim(), 10);
        if (!Number.isFinite(y) || y < 1900 || y > 3000) { alert('Ano inválido'); return; }

        const result = await API.createYear(y);
        if (result) {
            await setupYearSelect();
            const sel2 = document.getElementById('yearSelect'); if (sel2) sel2.value = String(y);
            selectedYear = y;
            data = emptyDataset();
            normalizeFinanceData(data); saveData(); renderAll();
            alert('Ano criado com sucesso: ' + y);
        } else {
            // Fallback: add locally
            const opt = document.createElement('option'); opt.value = String(y); opt.textContent = `${y} (local)`; sel.insertBefore(opt, sel.firstChild);
            sel.value = String(y); selectedYear = y;
            data = emptyDataset();
            normalizeFinanceData(data); saveData(); renderAll();
            alert('Ano criado localmente (servidor indisponível).');
        }
    });

    // Reset year button
    const resetBtn = document.getElementById('resetYearBtn');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
        if (!confirm(`Resetar todos os dados do ano ${selectedYear}? Esta ação é permanente. Deseja continuar?`)) return;
        const result = await API.resetYear(selectedYear);
        if (result) {
            const ok = await loadFromServer();
            if (ok) { alert('Ano resetado com sucesso e dados recarregados do servidor.'); }
            else {
                data = createEmptyDataset(); normalizeFinanceData(data); renderAll();
                alert('Ano resetado localmente.');
            }
        } else {
            data = createEmptyDataset(); normalizeFinanceData(data); renderAll();
            alert('Falha ao resetar no servidor. Dados limpos para o ano ' + selectedYear);
        }
    });

    // Initialize an empty dataset for the selected year while waiting for server data
    data = createEmptyDataset();
    normalizeFinanceData(data);
    renderAll();
}

function setActiveMonthTab(month) {
    document.querySelectorAll('.month-tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.month) === month);
    });
}

async function init() { 
    setupMonthTabs(); 
    setupForms(); 
    setupNameChips(); 
    await setupYearSelect();
    applyPageState(currentMonth, selectedYear, { replace: true });
    window.addEventListener('popstate', async () => {
        const state = getPageStateFromUrl();
        const yearChanged = state.year !== selectedYear;
        currentMonth = state.month;
        selectedYear = state.year;
        if (yearChanged) {
            data = createEmptyDataset();
            normalizeFinanceData(data);
            await loadFromServer(true);
        }
        applyPageState(currentMonth, selectedYear, { replace: true });
    });

    if (!window._chartResizeHandlerAdded) {
        window.addEventListener('resize', () => {
            const pos = window.innerWidth <= 768 ? 'bottom' : 'right';
            if (categoryChart) { categoryChart.options.plugins.legend.position = pos; categoryChart.update(); }
            if (evolutionChart) { evolutionChart.options.plugins.legend.position = pos; evolutionChart.update(); }
        });
        window._chartResizeHandlerAdded = true;
    }

    // Attempt to load canonical state from server silently; fallback will keep the current in-memory dataset
    // This ensures the server is the primary source but doesn't block UI rendering
    loadFromServer(true);
}



function setupMonthTabs() {
    document.querySelectorAll('.month-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const month = parseInt(tab.dataset.month, 10);
            applyPageState(month, selectedYear, { push: true });
        });
    });
}

function setupForms() {
    const importBtn = document.getElementById('importBtn');
    if (importBtn) importBtn.addEventListener('click', () => document.getElementById('importFile').click());

    // Auto-resize textarea for income description so it grows when user types or presses Enter
    const incomeDescEl = document.getElementById('incomeDesc');
    function autoResizeIncomeDesc() {
        if (!incomeDescEl) return;
        incomeDescEl.style.height = 'auto';
        incomeDescEl.style.height = Math.min(incomeDescEl.scrollHeight, 240) + 'px';
    }
    if (incomeDescEl) {
        incomeDescEl.addEventListener('input', autoResizeIncomeDesc);
        incomeDescEl.addEventListener('keydown', (ev) => {
            // allow Enter to add a newline inside the textarea and then resize
            if (ev.key === 'Enter') setTimeout(autoResizeIncomeDesc, 0);
        });
    }

    document.getElementById('incomeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const source = document.getElementById('incomeSource').value;
        const value = parseBRNumber(document.getElementById('incomeValue').value);
        const description = document.getElementById('incomeDesc').value;
        if (Number.isNaN(value)) { alert('Valor inválido. Use formato 101,50'); return; }

        try {
            if (!data.incomes[currentMonth]) data.incomes[currentMonth] = [];

            if (window.editingIncomeIndex !== undefined) {
                // Edit existing
                const existing = data.incomes[currentMonth][window.editingIncomeIndex] || {};
                existing.source = source; existing.value = value; existing.description = description;
                if (existing.id) {
                    const r = await API.updateIncome(existing.id, { source, value, description });
                    if (r?.income) data.incomes[currentMonth][window.editingIncomeIndex] = r.income;
                } else {
                    const r = await API.createIncome({ month: currentMonth, source, value, description, year: selectedYear });
                    if (r?.income?.id) existing.id = r.income.id;
                }
                delete window.editingIncomeIndex;
            } else {
                // Add new — merge with existing source locally
                const existingIncome = data.incomes[currentMonth].find(i => i.source === source);
                if (existingIncome) {
                    existingIncome.value += value;
                    if (description) existingIncome.description = description;
                    if (existingIncome.id) {
                        await API.updateIncome(existingIncome.id, { source: existingIncome.source, value: existingIncome.value, description: existingIncome.description });
                    } else {
                        const r = await API.createIncome({ month: currentMonth, source: existingIncome.source, value: existingIncome.value, description: existingIncome.description, year: selectedYear });
                        if (r?.income?.id) existingIncome.id = r.income.id;
                    }
                } else {
                    const obj = { source, value, description };
                    data.incomes[currentMonth].push(obj);
                    const r = await API.createIncome({ month: currentMonth, source, value, description, year: selectedYear });
                    if (r?.income?.id) obj.id = r.income.id;
                }
            }

            closeModal('incomeModal');
            renderAll();
            saveData();
        } catch (err) {
            console.error('Error handling income submit', err);
            alert('Erro ao salvar entrada');
        }
    });

    document.getElementById('fixedForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newNameInput = document.getElementById('fixedNewName');
        const selectedChip = document.querySelector('#fixedNameChips .name-chip.selected');
        let name = '';
        if (newNameInput.style.display !== 'none' && newNameInput.value.trim() !== '') {
            name = newNameInput.value.trim();
        } else if (selectedChip && selectedChip.dataset && String(selectedChip.dataset.name).trim() !== '') {
            name = String(selectedChip.dataset.name).trim();
        } else {
            name = (selectedChip?.textContent || newNameInput.value || '').toString().trim();
        }
        if (!name) name = 'Sem nome';
        const category = document.getElementById('fixedCategory').value;
        const paymentMethod = document.getElementById('fixedPaymentMethod').value;
        const value = parseBRNumber(document.getElementById('fixedValue').value);
        
        // Normalize normallyDueDay: must be 1-31 or null
        const dueDayInput = String(document.getElementById('fixedNormallyDueDay').value || '').trim();
        let normallyDueDay = null;
        if (dueDayInput !== '') {
            const parsed = Number(dueDayInput);
            if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1 && parsed <= 31) {
                normallyDueDay = parsed;
            }
        }
        
        const paidOnDateInput = String(document.getElementById('fixedPaidOnDate').value || '').trim();
        const paidOnDate = paidOnDateInput === '' ? null : paidOnDateInput;
        if (Number.isNaN(value)) { alert('Valor inválido. Use formato 101,50'); return; }
        if (!data.fixedExpenses[currentMonth]) data.fixedExpenses[currentMonth] = [];

        try {
            if (window.editingFixedIndex !== undefined) {
                const existing = data.fixedExpenses[currentMonth][window.editingFixedIndex] || {};
                existing.name = name; existing.category = category; existing.value = value; existing.paymentMethod = paymentMethod; existing.normallyDueDay = normallyDueDay; existing.paidOnDate = paidOnDate;
                if (existing.id) {
                    await API.updateFixed(existing.id, { name, category, value, paymentMethod, normallyDueDay, paidOnDate });
                } else {
                    const r = await API.createFixed({ month: currentMonth, year: selectedYear, name, category, value, paymentMethod, normallyDueDay, paidOnDate });
                    if (r?.fixed?.id) existing.id = r.fixed.id;
                }
                data.fixedExpenses[currentMonth][window.editingFixedIndex] = existing;
                delete window.editingFixedIndex;
            } else {
                const obj = { name, category, value, paymentMethod, normallyDueDay, paidOnDate };
                data.fixedExpenses[currentMonth].push(obj);
                const r = await API.createFixed({ month: currentMonth, year: selectedYear, ...obj });
                if (r?.fixed?.id) obj.id = r.fixed.id;
            }
            closeModal('fixedModal');
            renderAll();
            saveData();
        } catch (err) {
            console.error('Error handling fixed submit', err);
            alert('Erro ao salvar gasto fixo');
        }
    });

    document.getElementById('eventualForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const category = document.getElementById('eventualCategory').value;
        const paymentMethod = document.getElementById('eventualPaymentMethod').value;
        const value = parseBRNumber(document.getElementById('eventualValue').value);
        const description = document.getElementById('eventualDesc').value;
        if (Number.isNaN(value)) { alert('Valor inválido. Use formato 101,50'); return; }

        try {
            if (window.editingEventualIndex !== undefined) {
                // Editing an existing item (credit card or eventual)
                if (window.editingEventualCard) {
                    const card = window.editingEventualCard;
                    const existing = data.creditCards[card][currentMonth][window.editingEventualIndex];
                    existing.category = category; existing.value = value; existing.description = description; existing.paymentMethod = 'credito';
                    if (existing.id) await API.updateCredit(existing.id, existing);
                    delete window.editingEventualCard;
                } else {
                    const existing = data.eventualExpenses[currentMonth][window.editingEventualIndex];
                    existing.category = category; existing.value = value; existing.description = description; existing.paymentMethod = paymentMethod;
                    if (existing.id) await API.updateEventual(existing.id, existing);
                }
                delete window.editingEventualIndex;
            } else if (window.currentCreditCard) {
                // New credit card expense
                const card = window.currentCreditCard;
                if (!data.creditCards[card]) data.creditCards[card] = Array.from({ length: 12 }, () => []);
                if (!data.creditCards[card][currentMonth]) data.creditCards[card][currentMonth] = [];
                const obj = { category, value, description, paymentMethod: 'credito' };
                data.creditCards[card][currentMonth].push(obj);
                const r = await API.createCredit({ card, month: currentMonth, year: selectedYear, category, value, paymentMethod: 'credito', description });
                if (r?.credit?.id) obj.id = r.credit.id;
                window.currentCreditCard = null;
            } else {
                // New eventual expense
                const obj = { category, value, description, paymentMethod };
                if (!data.eventualExpenses[currentMonth]) data.eventualExpenses[currentMonth] = [];
                data.eventualExpenses[currentMonth].push(obj);
                const r = await API.createEventual({ month: currentMonth, year: selectedYear, ...obj });
                if (r?.eventual?.id) obj.id = r.eventual.id;
            }
            closeModal('eventualModal');
            renderAll();
            saveData();
        } catch (err) { console.error('Error handling eventual submit', err); alert('Erro ao salvar gasto eventual'); }
    });

    // Health plan UI removed — handler deleted.
}

function setupNameChips() {
    document.querySelectorAll('#fixedNameChips .name-chip:not(.add-new)').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#fixedNameChips .name-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected'); 
            document.getElementById('fixedNewName').style.display = 'none';
        });
    });
}

function showNewNameInput() {
    const input = document.getElementById('fixedNewName'); 
    input.style.display = 'block'; 
    input.focus();
    document.querySelectorAll('#fixedNameChips .name-chip').forEach(c => c.classList.remove('selected'));
}

function renderAll() { 
    if (currentMonth === 12) {
        renderAnnualSummary();
        renderAnnualCharts();
        return;
    }
    calculateSummary(); 
    renderIncomes(); 
    renderTithes();
    renderPaymentMethods();
    renderCategories(); 
    renderFixedExpenses(); 
    renderEventualExpenses(); 
    renderCreditCards(); 
    renderCharts(); 
}

function calculateSummary() {
    const summary = computeMonthlySummary(data, currentMonth);
    data.tithes[currentMonth] = summary.tithes;

    document.getElementById('saldoValue').textContent = `R$ ${summary.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('entradasValue').textContent = `R$ ${summary.entradasLiquidas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('despesasValue').textContent = `R$ ${summary.despesas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('incomesTotalDisplay').textContent = `R$ ${summary.totalIncomes.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('fixedTotalDisplay').textContent = `R$ ${summary.fixed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('eventualTotalDisplay').textContent = `R$ ${summary.eventual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderIncomes() {
    const container = document.getElementById('incomesContainer');
    const incomes = data.incomes[currentMonth] || [];
    container.innerHTML = incomes.map((income, index) => 
        `<div class="item" title="${income.description || ''}" onclick="editIncome(${index})">
            <div class="item-info">
                <div class="item-name">${income.source}</div>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <div class="item-value income-green">R$ ${income.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <button class="btn-delete" title="Excluir" onclick="event.stopPropagation(); deleteIncomeItem(${index})">×</button>
            </div>
        </div>`
    ).join('');
}

async function deleteIncomeItem(index) {
    if (!confirm('Remover entrada? Esta ação é permanente.')) return;
    try {
        const item = (data.incomes[currentMonth] || [])[index];
        if (item && item.id) await API.deleteIncome(item.id);
        if (data.incomes && data.incomes[currentMonth]) data.incomes[currentMonth].splice(index, 1);
        renderAll();
        saveData();
    } catch (err) {
        console.error('Error deleting income', err);
        alert('Erro ao deletar entrada');
    }
}

function editIncome(index) {
    const income = (data.incomes[currentMonth] || [])[index] || {};
    document.getElementById('incomeSource').value = income.source || '';
    document.getElementById('incomeValue').value = formatBRNumber(income.value) || '';
    document.getElementById('incomeDesc').value = income.description || '';
    if (typeof autoResizeIncomeDesc === 'function') autoResizeIncomeDesc();
    document.getElementById('incomeModal').classList.add('active');
    window.editingIncomeIndex = index;
}

function renderTithes() {
    const container = document.getElementById('tithesContainer');
    const tithes = data.tithes[currentMonth] || [];
    container.innerHTML = tithes.map(tithe => 
        `<div class="item" title="${tithe.breakdown || ''}">
            <div class="item-info">
                <div class="item-name">${tithe.source.replace('Dízimo - ', '')}</div>
            </div>
            <div class="item-value">R$ ${tithe.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>`
    ).join('');
}

function renderPaymentMethods() {
    const container = document.getElementById('paymentMethodsContainer');
    const allExpenses = [
        ...(data.fixedExpenses[currentMonth] || []),
        ...(data.eventualExpenses[currentMonth] || []),
        ...(data.creditCards.nuRenan[currentMonth] || []),
        ...(data.creditCards.nuJu[currentMonth] || []),
        ...(data.creditCards.nomad[currentMonth] || [])
    ];
    
    const paymentMethods = {};
    allExpenses.forEach(expense => {
        const method = expense.paymentMethod || 'credito'; // default for old data
        if (!paymentMethods[method]) paymentMethods[method] = 0;
        paymentMethods[method] += expense.value;
    });
    
    const methods = [
        { name: 'Crédito', key: 'credito' },
        { name: 'Débito', key: 'debito' },
        { name: 'Dinheiro', key: 'dinheiro' },
        { name: 'Pix', key: 'pix' },
        { name: 'Boleto', key: 'boleto' }
    ];
    
    container.innerHTML = methods.map(method => 
        `<div class="item">
            <div class="item-info">
                <div class="item-name">${method.name}</div>
            </div>
            <div class="item-value">R$ ${(paymentMethods[method.key] || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>`
    ).join('');
}

function renderCategories() {
    // Start with all known categories fixed at zero so every category is always shown
    const categories = Object.keys(categoryNames).reduce((acc, k) => { acc[k] = 0; return acc; }, {});

    const fixed = data.fixedExpenses[currentMonth] || [];
    const eventual = data.eventualExpenses[currentMonth] || [];
    const nuRenan = data.creditCards.nuRenan[currentMonth] || [];
    const nuJu = data.creditCards.nuJu[currentMonth] || [];
    const nomad = data.creditCards.nomad[currentMonth] || [];

    // Sum all expenses into the pre-seeded categories (missing categories remain zero)
    [...fixed, ...eventual, ...nuRenan, ...nuJu, ...nomad].forEach(expense => {
        const cat = (expense && expense.category) ? expense.category : 'diversos';
        categories[cat] = (categories[cat] || 0) + (expense.value || 0);
    });

    // health plans removed — do not add to 'saude' category

    // Group food-related subcategories into a single 'alimentacao' display entry
    const foodKeys = ['restaurantes', 'alimentacao'];
    const foodSub = {};
    const foodTotal = foodKeys.reduce((s, k) => { const v = categories[k] || 0; foodSub[k] = v; return s + v; }, 0);

    // Build display categories: collapse Restaurantes into Alimentação but keep all categories (zeros allowed)
    const display = Object.assign({}, categories);
    ['restaurantes'].forEach(k => { if (display[k] !== undefined) delete display[k]; });
    display['alimentacao'] = foodTotal;

    // Ordenar alfabeticamente pelo nome da categoria (pt-BR)
    const sorted = Object.entries(display).sort((a, b) => getCategoryName(a[0]).localeCompare(getCategoryName(b[0]), 'pt-BR'));
    const container = document.getElementById('categoriesContainer');

    container.innerHTML = sorted.map(([category, value]) => {
        if (category === 'alimentacao') {
            // show subcategory breakdown
            const restaurantesVal = foodSub['restaurantes'] || 0;
            const alimentacaoVal = (categories['alimentacao'] && !foodTotal ? categories['alimentacao'] : (foodSub['alimentacao'] || 0));

            return `
                <div class="item">
                    <div class="item-icon cat-alimentacao">${getCategoryIcon('alimentacao')}</div>
                    <div class="item-info">
                        <div class="item-name">${getCategoryName('alimentacao')}</div>
                        <div class="item-desc" style="margin-top:0.5rem; font-size:0.85rem; color:#94a3b8;">
                            <div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:center;">
                                <div>🍽️ Restaurantes: <strong>R$ ${restaurantesVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                                <div>🍎 Alimentação: <strong>R$ ${alimentacaoVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                            </div>
                        </div>
                    </div>
                    <div class="item-value">R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>`;
        }

        return `
            <div class="item">
                <div class="item-icon cat-${category}">${getCategoryIcon(category)}</div>
                <div class="item-info">
                    <div class="item-name">${getCategoryName(category)}</div>
                </div>
                <div class="item-value">R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>`;
    }).join('');
}

function parseDateStringToLocal(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const normalized = dateStr.trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        return new Date(year, month, day);
    }
    const dt = new Date(normalized);
    return isNaN(dt.getTime()) ? null : dt;
}

function renderFixedExpenses() {
    const container = document.getElementById('fixedExpensesContainer');
    const expenses = data.fixedExpenses[currentMonth] || [];
    container.innerHTML = expenses.map((expense, index) => {
        const valueNum = Number((expense && expense.value) || 0);

        // Normalize paidOnDate: treat empty strings, null, undefined, and '0000-00-00' as not paid
        let paidOnRaw = expense && (expense.paidOnDate !== undefined ? expense.paidOnDate : null);
        let hasPaidDate = false;
        if (paidOnRaw !== undefined && paidOnRaw !== null) {
            if (typeof paidOnRaw === 'string') {
                const s = paidOnRaw.trim();
                hasPaidDate = s !== '' && s !== '0000-00-00';
            } else if (paidOnRaw instanceof Date) {
                hasPaidDate = !isNaN(paidOnRaw.getTime());
            } else {
                hasPaidDate = Boolean(paidOnRaw);
            }
        }

        const isPaid = hasPaidDate || valueNum > 0;
        const checkedAttr = isPaid ? 'checked' : '';

        // Extract and validate normallyDueDay: must be a number between 1-31
        // Null, undefined, 0, and invalid values all result in no due day text
        const normallyDueDay = expense && expense.normallyDueDay;
        const isValidDueDay = Number.isInteger(normallyDueDay) && normallyDueDay >= 1 && normallyDueDay <= 31;
        const dueDayText = (!isPaid && isValidDueDay) ? `Vence dia ${normallyDueDay}` : '';

        // If the expense has an explicit paid date, render a "Pago em <date>" line
        let paidOnMarkup = '';
        if (hasPaidDate) {
            let paidStr = '';
            if (typeof paidOnRaw === 'string') {
                const s = paidOnRaw.trim();
                const dt = parseDateStringToLocal(s);
                paidStr = (dt && !isNaN(dt.getTime())) ? dt.toLocaleDateString('pt-BR') : s;
            } else if (paidOnRaw instanceof Date) {
                paidStr = paidOnRaw.toLocaleDateString('pt-BR');
            } else {
                paidStr = String(paidOnRaw);
            }
            if (paidStr) {
                paidOnMarkup = `<div style="font-size: 0.75rem; color: #10b981; margin-top: 0.25rem; font-weight: 500;">Pago em ${paidStr}</div>`;
            }
        }

        return `<div class="item" onclick="editFixedExpense(${index})">
            <input type="checkbox" class="item-checkbox" ${checkedAttr} onclick="event.preventDefault(); event.stopPropagation(); editFixedExpense(${index});" onmousedown="event.preventDefault()">
            <div class="item-info">
                <div class="item-name">${expense.name}<span class="expense-chip desc-${expense.category}">${getCategoryName(expense.category)}</span></div>
                ${paidOnMarkup || (dueDayText ? `<div style="font-size: 0.75rem; color: #f59e0b; margin-top: 0.25rem; font-weight: 500;">${dueDayText}</div>` : '')}
            </div>
            <div class="item-value">R$ ${Number(expense.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <button class="btn-delete" onclick="event.stopPropagation(); deleteFixedExpense(${index})">×</button>
        </div>`;
    }).join('');
}

function deleteFixedExpense(index) {
    window.deletingIndex = index;
    window.deleteType = 'fixed';
    document.getElementById('deleteConfirmModal').classList.add('active');
}

async function confirmDeleteFixed() {
    try {
        if (window.deleteType === 'fixed') {
            const item = data.fixedExpenses[currentMonth][window.deletingIndex];
            if (item && item.id) await API.deleteFixed(item.id);
            data.fixedExpenses[currentMonth].splice(window.deletingIndex, 1);
        } else if (window.deleteType === 'eventual') {
            const item = data.eventualExpenses[currentMonth][window.deletingIndex];
            if (item && item.id) await API.deleteEventual(item.id);
            data.eventualExpenses[currentMonth].splice(window.deletingIndex, 1);
        }
        closeModal('deleteConfirmModal');
        renderAll();
        saveData();
    } catch (err) { console.error('Error deleting item', err); alert('Erro ao deletar item'); }
}

function deleteEventualExpense(index) {
    window.deletingIndex = index;
    window.deleteType = 'eventual';
    document.getElementById('deleteConfirmModal').classList.add('active');
}

function editFixedExpense(index) {
    const expense = (data.fixedExpenses[currentMonth] || [])[index];
    if (!expense) return;
    // select chip or show custom name
    document.getElementById('fixedNewName').style.display = 'none';
    document.querySelectorAll('#fixedNameChips .name-chip').forEach(c => c.classList.remove('selected'));
    // try exact attribute match first; fallback to diacritics/case-insensitive match
    let chip = document.querySelector(`#fixedNameChips .name-chip[data-name="${expense.name}"]`);
    if (!chip) {
        const normalize = s => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const target = normalize(expense.name);
        chip = Array.from(document.querySelectorAll('#fixedNameChips .name-chip:not(.add-new)')).find(c => normalize(c.dataset.name) === target || normalize(c.textContent) === target);
    }
    if (chip) chip.classList.add('selected');
    else { document.getElementById('fixedNewName').style.display = 'block'; document.getElementById('fixedNewName').value = expense.name; }
    document.getElementById('fixedCategory').value = expense.category || 'alimentacao';
    document.getElementById('fixedPaymentMethod').value = expense.paymentMethod || 'dinheiro';
    document.getElementById('fixedValue').value = formatBRNumber(expense.value) || '';
    
    // Load normallyDueDay: only show if it's a valid day (1-31)
    const normallyDueDay = expense && expense.normallyDueDay;
    document.getElementById('fixedNormallyDueDay').value = (Number.isInteger(normallyDueDay) && normallyDueDay >= 1 && normallyDueDay <= 31) ? String(normallyDueDay) : '';
    
    // Load paidOnDate: show if it's set
    const paidOnDate = expense && expense.paidOnDate;
    document.getElementById('fixedPaidOnDate').value = (paidOnDate && typeof paidOnDate === 'string' && paidOnDate.trim()) ? paidOnDate : '';
    
    window.editingFixedIndex = index;
    openModal('fixed');
}

function editEventualExpense(index) {
    const expense = (data.eventualExpenses[currentMonth] || [])[index];
    if (!expense) return;
    document.getElementById('eventualCategory').value = expense.category || 'alimentacao';
    // default to 'debito' when paymentMethod is missing or unsupported
    document.getElementById('eventualPaymentMethod').value = (expense.paymentMethod && (expense.paymentMethod === 'pix' || expense.paymentMethod === 'debito')) ? expense.paymentMethod : 'debito';
    document.getElementById('eventualValue').value = formatBRNumber(expense.value) || '';
    document.getElementById('eventualDesc').value = expense.description || '';
    document.getElementById('eventualModal').classList.add('active');
    window.editingEventualIndex = index;
    window.editingEventualCard = undefined;
}

function editCreditCardExpense(card, index) {
    const expense = ((data.creditCards[card] && data.creditCards[card][currentMonth]) || [])[index];
    if (!expense) return;
    // Open modal like credit add, but in edit mode
    openModal('credit', card);
    // openModal sets window.currentCreditCard; switch to editing mode
    window.currentCreditCard = null;
    window.editingEventualCard = card;
    window.editingEventualIndex = index;
    document.getElementById('eventualCategory').value = expense.category || 'alimentacao';
    document.getElementById('eventualValue').value = expense.value || '';
    document.getElementById('eventualDesc').value = expense.description || '';
}

function openCreditPaidModal(card, index) {
    window._pendingCreditPaid = { card, index };
    const el = document.getElementById('creditPaidDate');
    if (el) el.value = new Date().toISOString().split('T')[0];
    document.getElementById('creditPaidModal').classList.add('active');
}

function markCardAsPaid(cardName) {
    const checkbox = document.getElementById(`cardCheckbox_${cardName}`);
    // If no checkbox found or checkbox is disabled/not-checked, open modal to set paid date
    if (!checkbox || checkbox.disabled || !checkbox.checked) {
        window._pendingCardPaid = { cardName };
        const el = document.getElementById('creditPaidDate');
        if (el) el.value = new Date().toISOString().split('T')[0];
        document.getElementById('creditPaidModal').classList.add('active');
        // Keep the checkbox visually unchecked/disabled until confirmation
        if (checkbox) { checkbox.checked = false; checkbox.disabled = true; }
        return;
    }

    // If checkbox is checked and enabled, treat as user wanting to clear paid dates
    if (checkbox.checked) {
        if (!confirm('Desmarcar todas as transações deste cartão como pagas?')) {
            checkbox.checked = true;
            return;
        }
        clearCardPaymentDates(cardName);
    }
}

async function clearCardPaymentDates(cardName) {
    const arr = (data.creditCards && data.creditCards[cardName] && data.creditCards[cardName][currentMonth]) || [];
    if (arr.length === 0) { return; }

    try {
        for (const item of arr) {
            if (item.id) {
                await API.updateCredit(item.id, { paidOnDate: '' });
            }
            item.paidOnDate = null;
        }
    } catch (err) {
        console.warn('Failed to clear paid dates on server', err);
    }

    saveData();
    renderAll();
}

async function confirmCreditPaid() {
    // Handle card-level payment (all expenses in card)
    if (window._pendingCardPaid) {
        const pending = window._pendingCardPaid;
        const cardName = pending.cardName;
        const dateEl = document.getElementById('creditPaidDate');
        const dateVal = dateEl ? String(dateEl.value || '').trim() : '';
        if (!dateVal) { alert('Selecione a data de pagamento'); return; }

        const arr = (data.creditCards && data.creditCards[cardName] && data.creditCards[cardName][currentMonth]) || [];
        if (arr.length === 0) { alert('Nenhuma transação para marcar como paga'); closeModal('creditPaidModal'); return; }

        try {
            // Update all expenses in the card with the same paid date
            for (const item of arr) {
                if (item.id) {
                    await API.updateCredit(item.id, { paidOnDate: dateVal });
                }
                item.paidOnDate = dateVal;
            }
        } catch (err) {
            console.warn('Failed to save paid date to server', err);
        }

        saveData();
        closeModal('creditPaidModal');
        renderAll();
        window._pendingCardPaid = null;
        return;
    }

    // Handle individual expense payment (legacy)
    const pending = window._pendingCreditPaid;
    if (!pending) return closeModal('creditPaidModal');
    const card = pending.card;
    const index = pending.index;
    const dateEl = document.getElementById('creditPaidDate');
    const dateVal = dateEl ? String(dateEl.value || '').trim() : '';
    if (!dateVal) { alert('Selecione a data de pagamento'); return; }

    const arr = (data.creditCards && data.creditCards[card] && data.creditCards[card][currentMonth]) || [];
    const item = arr[index];
    if (!item) { alert('Item não encontrado'); closeModal('creditPaidModal'); return; }

    item.paidOnDate = dateVal;
    try {
        if (item.id) {
            await API.updateCredit(item.id, { paidOnDate: dateVal });
        }
    } catch (err) {
        console.warn('Failed to save paid date to server', err);
    }

    saveData();
    closeModal('creditPaidModal');
    renderAll();
    window._pendingCreditPaid = null;
}

function renderEventualExpenses() {
    const container = document.getElementById('eventualExpensesContainer');
    const expenses = data.eventualExpenses[currentMonth] || [];
    
    container.innerHTML = expenses.map((expense, index) => {
        const omitCheckbox = expense && (expense.paymentMethod === 'pix' || expense.paymentMethod === 'debito');
        const checkboxHtml = omitCheckbox ? '' : '<input type="checkbox" class="item-checkbox" checked onclick="event.stopPropagation()">';
        return `
            <div class="item" title="${expense.description || ''}" onclick="editEventualExpense(${index})">
                ${checkboxHtml}
                <div class="item-info">
                    <div class="item-name">${getCategoryName(expense.category)}</div>
                </div>
                <div class="item-value">R$ ${expense.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <button class="btn-delete" onclick="event.stopPropagation(); deleteEventualExpense(${index})">×</button>
            </div>`;
    }).join('');
}

function renderCreditCards() {
    ['nuRenan', 'nuJu', 'nomad'].forEach(cardName => {
        const expenses = (data.creditCards && data.creditCards[cardName] && data.creditCards[cardName][currentMonth]) || [];
        const total = expenses.reduce((sum, e) => sum + (e.value || 0), 0);

        document.getElementById(`${cardName}Total`).textContent = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const container = document.getElementById(`${cardName}Expenses`);

        // Render each transaction individually so it can be edited/deleted (no checkboxes)
        container.innerHTML = expenses.map((expense, idx) => {
            const category = expense.category || 'diversos';
            const label = expense.description ? `${expense.description}` : getCategoryName(category);

            return `
                <div class="item" onclick="editCreditCardExpense('${cardName}', ${idx})" role="button" tabindex="0">
                    <div class="item-info">
                        <div class="item-name">${label}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <div class="item-value">R$ ${Number(expense.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <button class="btn-delete" title="Excluir" onclick="event.stopPropagation(); deleteCreditCardExpense('${cardName}', ${idx})">×</button>
                    </div>
                </div>
            `;
        }).join('');

        // Update card header checkbox and paid text
        const cardCheckbox = document.getElementById(`cardCheckbox_${cardName}`);
        const cardPaidText = document.getElementById(`cardPaidText_${cardName}`);

        // Check if all expenses are paid on the same date
        const allPaidDate = getCardPaymentDate(cardName);
        if (cardCheckbox) {
            if (allPaidDate) {
                cardCheckbox.checked = true;
                cardCheckbox.disabled = false;
                cardPaidText.textContent = `Pago em ${allPaidDate}`;
                // remove overlay if present
                const existingOverlay = document.getElementById(`cardOverlay_${cardName}`);
                if (existingOverlay) existingOverlay.remove();
            } else {
                cardCheckbox.checked = false;
                cardCheckbox.disabled = true; // visually disabled by default
                cardPaidText.textContent = '';
                // create overlay to capture clicks and open the modal
                let overlay = document.getElementById(`cardOverlay_${cardName}`);
                if (!overlay) {
                    overlay = document.createElement('button');
                    overlay.type = 'button';
                    overlay.id = `cardOverlay_${cardName}`;
                    overlay.className = 'card-checkbox-overlay';
                    overlay.setAttribute('aria-label', 'Marcar cartão como pago');
                    overlay.onclick = function(e) { e.stopPropagation(); markCardAsPaid(cardName); };
                    const parent = cardCheckbox.parentElement;
                    if (parent) parent.appendChild(overlay);
                }
            }
        }
    });
}

function getCardPaymentDate(cardName) {
    const expenses = (data.creditCards && data.creditCards[cardName] && data.creditCards[cardName][currentMonth]) || [];
    if (expenses.length === 0) return null;
    
    // Get all paid dates from expenses
    const paidDates = expenses
        .map(e => e.paidOnDate)
        .filter(date => date !== undefined && date !== null && String(date).trim() !== '')
        .map(date => String(date).trim());
    
    // If all expenses are paid, return the (first) paid date
    if (paidDates.length === expenses.length && paidDates.length > 0) {
        const firstDate = paidDates[0];
        const dt = parseDateStringToLocal(firstDate);
        if (dt && !isNaN(dt.getTime())) {
            return dt.toLocaleDateString('pt-BR');
        }
        return firstDate;
    }
    
    return null;
}

async function deleteCreditCardExpense(card, index) {
    if (!confirm('Remover transação do cartão? Esta ação é permanente.')) return;
    try {
        const item = ((data.creditCards && data.creditCards[card] && data.creditCards[card][currentMonth]) || [])[index];
        if (item && item.id) await API.deleteCredit(item.id);
        if (data.creditCards && data.creditCards[card] && data.creditCards[card][currentMonth]) {
            data.creditCards[card][currentMonth].splice(index, 1);
        }
        renderAll();
        saveData();
    } catch (err) {
        console.error('Error deleting credit card item', err);
        alert('Erro ao deletar transação do cartão');
    }
}

function renderCharts() { 
    renderCategoryChart(); 
    renderEvolutionChart(); 
}



function renderCategoryChart() {
    const categories = {};
    const fixed = data.fixedExpenses[currentMonth];
    const eventual = data.eventualExpenses[currentMonth];
    const nuRenan = data.creditCards.nuRenan[currentMonth];
    const nuJu = data.creditCards.nuJu[currentMonth];
    const nomad = data.creditCards.nomad[currentMonth];
    [...fixed, ...eventual, ...nuRenan, ...nuJu, ...nomad].forEach(expense => {
        const cat = expense.category || 'diversos';
        if (!categories[cat]) categories[cat] = 0;
        categories[cat] += expense.value || 0;
    });
    // health plans removed — do not include in 'saude' category

    // Merge 'restaurantes' into 'alimentacao' for the distribution donut (UI-only)
    if (categories['restaurantes']) {
        categories['alimentacao'] = (categories['alimentacao'] || 0) + categories['restaurantes'];
        delete categories['restaurantes'];
    }

    const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    const ctx = document.getElementById('categoryChart');
    
    if (categoryChart) categoryChart.destroy();
    
    const colors = {
        alimentacao: '#14b8a6',
        saude: '#10b981',
        educacao: '#f59e0b',
        moradia: '#ef4444',
        transporte: '#6b7280',
        lazer: '#ec4899',
        restaurantes: '#fb923c',
        comunicacao: '#f97316',
        viagens: '#3b82f6',
        comprinhas: '#db2777',
        imigracao: '#8b5cf6',
        diversos: '#64748b'
    };

    const total = sorted.reduce((sum, [, val]) => sum + val, 0);
    
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sorted.map(([cat]) => getCategoryName(cat)),
            datasets: [{
                data: sorted.map(([, val]) => val),
                backgroundColor: sorted.map(([cat]) => colors[cat] || '#64748b'),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#e2e8f0',
                        padding: 12,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderEvolutionChart() {
    const incomes = data.incomes[currentMonth].reduce((sum, i) => sum + i.value, 0);
    const tithes = data.tithes[currentMonth].reduce((sum, t) => sum + t.value, 0);
    const fixed = data.fixedExpenses[currentMonth].reduce((sum, i) => sum + i.value, 0);
    const eventual = data.eventualExpenses[currentMonth].reduce((sum, i) => sum + i.value, 0);
    const nuRenan = data.creditCards.nuRenan[currentMonth].reduce((sum, i) => sum + i.value, 0);
    const nuJu = data.creditCards.nuJu[currentMonth].reduce((sum, i) => sum + i.value, 0);
    const nomad = data.creditCards.nomad[currentMonth].reduce((sum, i) => sum + i.value, 0);
    
    const entradasLiquidas = incomes - tithes;
    const despesas = fixed + eventual + nuRenan + nuJu + nomad;
    const saldo = entradasLiquidas - despesas;
    
    const ctx = document.getElementById('evolutionChart');
    if (evolutionChart) evolutionChart.destroy();
    
    const total = Math.abs(despesas) + Math.abs(saldo);
    
    evolutionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Despesas', saldo >= 0 ? 'Saldo' : 'Déficit'],
            datasets: [{
                data: [despesas, Math.abs(saldo)],
                backgroundColor: ['#ef4444', saldo >= 0 ? '#10b981' : '#f59e0b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#e2e8f0',
                        padding: 12,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderAnnualCharts() {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const summary = computeAnnualSummary(data);
    const despesasData = summary.despesasData;
    const saldoData = summary.saldoData;

    const ctx = document.getElementById('annualExpensesVsBalanceChart');
    if (annualExpensesVsBalanceChart) annualExpensesVsBalanceChart.destroy();

    annualExpensesVsBalanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Despesas',
                data: despesasData,
                backgroundColor: '#ef4444',
                borderColor: '#ef4444',
                borderWidth: 1
            }, {
                label: 'Saldo',
                data: saldoData,
                backgroundColor: saldoData.map(s => s >= 0 ? '#10b981' : '#f59e0b'),
                borderColor: saldoData.map(s => s >= 0 ? '#10b981' : '#f59e0b'),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: '#e2e8f0' },
                    grid: { color: 'rgba(148, 163, 184, 0.2)' }
                },
                y: {
                    stacked: true,
                    ticks: { color: '#e2e8f0' },
                    grid: { color: 'rgba(148, 163, 184, 0.2)' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#e2e8f0' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                    }
                }
            }
        }
    });

    const ctx2 = document.getElementById('annualChart2');
    if (annualChart2) annualChart2.destroy();

    annualChart2 = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: 'Saldo',
                data: saldoData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                x: {
                    ticks: { color: '#e2e8f0' },
                    grid: { color: 'rgba(148, 163, 184, 0.2)' }
                },
                y: {
                    ticks: { color: '#e2e8f0' },
                    grid: { color: 'rgba(148, 163, 184, 0.2)' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#e2e8f0' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Saldo: R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        }
                    }
                }
            }
        }
    });
}

function renderAnnualSummary() {
    const summary = computeAnnualSummary(data);

    document.getElementById('annualSaldoValue').textContent = `R$ ${summary.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('annualEntradasValue').textContent = `R$ ${summary.entradasLiquidas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('annualDespesasValue').textContent = `R$ ${summary.despesas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function openModal(type, card = null) {
    const modals = { income: 'incomeModal', fixed: 'fixedModal', eventual: 'eventualModal' };
    if (type === 'credit') {
        window.currentCreditCard = card;
        document.getElementById('eventualModal').classList.add('active');
        document.querySelector('.modal-title').textContent = 'Adicionar Gasto no Cartão';
        const formGroups = document.querySelectorAll('#eventualModal .form-group');
        formGroups[1].style.display = 'none'; // forma de pagamento
        formGroups[3].style.display = 'none'; // descrição
    } else if (type === 'eventual') {
        document.getElementById('eventualModal').classList.add('active');
        const formGroups = document.querySelectorAll('#eventualModal .form-group');
        formGroups[3].style.display = 'none'; // descrição
    } else if (type === 'fixed') {
        document.getElementById(modals[type]).classList.add('active');
        // If the paid-on field is empty, prefill with today's date (works for new items)
        const paidEl = document.getElementById('fixedPaidOnDate');
        if (paidEl && String(paidEl.value || '').trim() === '') {
            paidEl.value = new Date().toISOString().split('T')[0];
        }
    } else {
        document.getElementById(modals[type]).classList.add('active');
        if (type === 'income') window.editingIncomeIndex = undefined;
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    document.querySelectorAll('form').forEach(form => form.reset());
    const _incDesc = document.getElementById('incomeDesc'); if (_incDesc) _incDesc.style.height = '';
    document.getElementById('fixedNewName').style.display = 'none';
    document.querySelectorAll('.name-chip').forEach(c => c.classList.remove('selected'));
    window.editingIncomeIndex = undefined;
    window.editingFixedIndex = undefined;
    window.editingEventualIndex = undefined;
    window.editingEventualCard = undefined;
    window.currentCreditCard = null;
    // Re-enable fields
    document.getElementById('incomeSource').disabled = false;
    document.getElementById('incomeValue').disabled = false;
    // Clear any pending modal state so cancelling does not leave a pending action
    window._pendingCardPaid = null;
    window._pendingCreditPaid = null;
    // Reset eventual modal
    if (modalId === 'eventualModal') {
        document.querySelector('.modal-title').textContent = 'Adicionar Gasto Eventual Pix/Débito';
        const formGroups = document.querySelectorAll('#eventualModal .form-group');
        formGroups[1].style.display = ''; // forma de pagamento
        formGroups[3].style.display = ''; // descrição
    }
}

init();