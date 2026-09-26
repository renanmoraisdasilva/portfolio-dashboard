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

    const defaultFixed = [
        { name: 'Aluguel', category: 'moradia', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 },
        { name: 'Condomínio', category: 'moradia', value: 0, paymentMethod: 'boleto', normallyDueDay: 25 },
        { name: 'Luz', category: 'moradia', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 },
        { name: 'Celular claro', category: 'comunicacao', value: 0, paymentMethod: 'credito', normallyDueDay: 12 },
        { name: 'Fibra vivo', category: 'comunicacao', value: 0, paymentMethod: 'credito', normallyDueDay: 12 },
        { name: 'Escola Julia', category: 'educacao', value: 0, paymentMethod: 'boleto', normallyDueDay: 5 },
        { name: "Inglês Julia", category: 'educacao', value: 0, paymentMethod: 'boleto', normallyDueDay: 5 },
        { name: 'Praia Clube', category: 'lazer', value: 0, paymentMethod: 'boleto', normallyDueDay: 10 }
    ];

    for (let m = 0; m < 12; m++) {
        const monthArr = data.fixedExpenses[m] || [];
        const normalizeName = s => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const existingNames = new Set((monthArr || []).map(f => normalizeName((f && f.name) ? String(f.name).trim() : '')));

        defaultFixed.forEach(def => {
            const defNormalized = normalizeName(def.name);
            monthArr.forEach(item => {
                if (normalizeName(item.name || '') === defNormalized) {
                    if (item.normallyDueDay === undefined || item.normallyDueDay === null) {
                        item.normallyDueDay = def.normallyDueDay;
                    }
                }
            });
        });

        defaultFixed.forEach(def => {
            if (!existingNames.has(normalizeName(def.name))) {
                monthArr.push({ name: def.name, category: def.category, value: def.value, paymentMethod: def.paymentMethod, normallyDueDay: def.normallyDueDay });
            }
        });
        data.fixedExpenses[m] = monthArr;
    }

    return data;
}

function computeTithesForMonth(month, financeData) {
    const incomes = (financeData.incomes[month] || []);
    const stefanini = incomes.find(i => i.source === 'Stefanini')?.value || 0;
    const missionDev = incomes.find(i => i.source === 'Mission Dev')?.value || 0;
    const number8 = incomes.find(i => i.source === 'Number 8')?.value || 0;

    const stefaniniPart = 0.1 * stefanini;
    const missionDevHalf = 0.5 * missionDev;
    const number8Eighty = 0.6 * number8;
    const number8Twenty = 0.2 * number8;
    const sogroMissionPart = 0.1 * missionDevHalf;
    const sogroNumberPart = 0.1 * number8Eighty;

    const sogroTithe = stefaniniPart + sogroMissionPart + sogroNumberPart;

    const sogroBreakdown = `10% de metade Mission Dev: R$ ${sogroMissionPart.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n10% de 80% Number 8: R$ ${sogroNumberPart.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return [
        { source: 'Dízimo - Total', value: sogroTithe, breakdown: sogroBreakdown }
    ];
}

function getTithesForMonth(month, financeData) {
    const existing = financeData.tithes[month];
    if (Array.isArray(existing) && existing.length > 0) {
        return existing;
    }
    return computeTithesForMonth(month, financeData);
}

function ensureTithesForMonth(month, financeData) {
    if (!Array.isArray(financeData.tithes[month]) || financeData.tithes[month].length === 0) {
        financeData.tithes[month] = computeTithesForMonth(month, financeData);
    }
}

function ensureAnnualTithes(financeData) {
    for (let m = 0; m < 12; m++) {
        ensureTithesForMonth(m, financeData);
    }
}

function computeMonthlySummary(financeData, month) {
    const incomes = (financeData.incomes[month] || []);
    const tithes = computeTithesForMonth(month, financeData);
    const totalIncomes = incomes.reduce((sum, i) => sum + (i.value || 0), 0);
    const totalTithes = tithes.reduce((sum, t) => sum + (t.value || 0), 0);
    const fixed = (financeData.fixedExpenses[month] || []).reduce((sum, e) => sum + (e.value || 0), 0);
    const eventual = (financeData.eventualExpenses[month] || []).reduce((sum, e) => sum + (e.value || 0), 0);
    const nuRenan = (financeData.creditCards.nuRenan[month] || []).reduce((sum, e) => sum + (e.value || 0), 0);
    const nuJu = (financeData.creditCards.nuJu[month] || []).reduce((sum, e) => sum + (e.value || 0), 0);
    const nomad = (financeData.creditCards.nomad[month] || []).reduce((sum, e) => sum + (e.value || 0), 0);
    const entradasLiquidas = totalIncomes - totalTithes;
    const despesas = fixed + eventual + nuRenan + nuJu + nomad;
    const saldo = entradasLiquidas - despesas;
    return { incomes, tithes, totalIncomes, totalTithes, fixed, eventual, nuRenan, nuJu, nomad, entradasLiquidas, despesas, saldo };
}

function computeAnnualSummary(financeData) {
    const monthly = [];
    const despesasData = [];
    const saldoData = [];
    let totalIncomes = 0;
    let totalTithes = 0;
    let totalFixed = 0;
    let totalEventual = 0;
    let totalNuRenan = 0;
    let totalNuJu = 0;
    let totalNomad = 0;

    for (let m = 0; m < 12; m++) {
        const incomes = (financeData.incomes[m] || []).reduce((sum, i) => sum + (i.value || 0), 0);
        const tithes = getTithesForMonth(m, financeData);
        const fixed = (financeData.fixedExpenses[m] || []).reduce((sum, e) => sum + (e.value || 0), 0);
        const eventual = (financeData.eventualExpenses[m] || []).reduce((sum, e) => sum + (e.value || 0), 0);
        const nuRenan = (financeData.creditCards.nuRenan[m] || []).reduce((sum, e) => sum + (e.value || 0), 0);
        const nuJu = (financeData.creditCards.nuJu[m] || []).reduce((sum, e) => sum + (e.value || 0), 0);
        const nomad = (financeData.creditCards.nomad[m] || []).reduce((sum, e) => sum + (e.value || 0), 0);
        const totalTithesForMonth = tithes.reduce((sum, t) => sum + (t.value || 0), 0);
        const entradasLiquidas = incomes - totalTithesForMonth;
        const despesas = fixed + eventual + nuRenan + nuJu + nomad;
        const saldo = entradasLiquidas - despesas;

        totalIncomes += incomes;
        totalTithes += totalTithesForMonth;
        totalFixed += fixed;
        totalEventual += eventual;
        totalNuRenan += nuRenan;
        totalNuJu += nuJu;
        totalNomad += nomad;

        despesasData.push(despesas);
        saldoData.push(saldo);
        monthly.push({ month: m, incomes, tithes, fixed, eventual, nuRenan, nuJu, nomad, entradasLiquidas, despesas, saldo });
    }

    const entradasLiquidas = totalIncomes - totalTithes;
    const despesas = totalFixed + totalEventual + totalNuRenan + totalNuJu + totalNomad;
    const saldo = entradasLiquidas - despesas;

    return {
        monthly,
        despesasData,
        saldoData,
        totalIncomes,
        totalTithes,
        totalFixed,
        totalEventual,
        totalNuRenan,
        totalNuJu,
        totalNomad,
        entradasLiquidas,
        despesas,
        saldo
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeFinanceData,
        computeTithesForMonth,
        getTithesForMonth,
        ensureTithesForMonth,
        ensureAnnualTithes,
        computeMonthlySummary,
        computeAnnualSummary
    };
}