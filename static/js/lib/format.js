/**
 * Shared money formatting and parsing utilities.
 * Used by dashboard (pages/index.html) and simulation pages.
 */

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

module.exports = {
  formatMoney,
  parseMoney,
};
