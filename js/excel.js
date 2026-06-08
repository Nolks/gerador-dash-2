/* ─────────────────────────────────────────────
   excel.js — Leitura e análise de planilhas
───────────────────────────────────────────── */
const ExcelParser = (() => {

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    let wb;
    if (file.name.endsWith('.csv')) {
      const text = new TextDecoder('utf-8').decode(buf);
      wb = XLSX.read(text, { type: 'string' });
    } else {
      wb = XLSX.read(buf, { type: 'array', cellDates: true });
    }
    const sheets = {};
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      sheets[name] = sanitize(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }));
    });
    return { sheetNames: wb.SheetNames, sheets };
  }

  function sanitize(rows) {
    if (!rows.length) return rows;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < rows.length; readIndex++) {
      const row = rows[readIndex];
      let hasValue = false;
      let needsRename = false;

      for (const [key, value] of Object.entries(row)) {
        if (value !== '' && value !== null && value !== undefined) hasValue = true;
        if (String(key).trim() !== key) needsRename = true;
      }
      if (!hasValue) continue;

      if (needsRename) {
        for (const key of Object.keys(row)) {
          const cleanKey = String(key).trim();
          if (cleanKey !== key) {
            row[cleanKey] = row[key];
            delete row[key];
          }
        }
      }
      rows[writeIndex++] = row;
    }

    rows.length = writeIndex;
    return rows;
  }

  /** Normaliza um valor para número: suporta R$, ponto milhar, vírgula decimal */
  function normalizeNumericValue(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return String(v);
    const clean = String(v).trim()
      .replace(/^R\$\s*/i, '')
      .replace(/^[$€£¥]\s*/, '')
      .replace(/\s/g, '');
    return clean.includes(',')
      ? clean.replace(/\./g, '').replace(',', '.')
      : clean;
  }

  /** Detecta se a coluna contém valores com formatação BR/currency */
  function hasBRFormatting(rows, col) {
    let found = 0;
    for (let i = 0; i < rows.length && found < 20; i++) {
      const value = String(rows[i][col] ?? '');
      if (!value) continue;
      found++;
      if (/R\$|,\d{2}$|^\d{1,3}(\.\d{3})+,/.test(value)) return true;
    }
    return false;
  }

  function detectTypes(rows) {
    if (!rows.length) return {};
    const cols = Object.keys(rows[0]);
    const types = {};

    for (const col of cols) {
      const sample = [];
      for (let i = 0; i < rows.length && sample.length < 50; i++) {
        const value = rows[i][col];
        if (value !== '' && value !== null && value !== undefined) sample.push(value);
      }

      if (!sample.length) { types[col] = 'string'; continue; }
      let numericCount = 0;
      let dateCount = 0;
      for (const value of sample) {
        const normalized = normalizeNumericValue(value);
        const parsed = Number.parseFloat(normalized);
        if (normalized !== '' && Number.isFinite(parsed)) numericCount++;
        if (isDateLike(value)) dateCount++;
      }

      if (numericCount / sample.length >= 0.8) types[col] = 'number';
      else if (dateCount / sample.length >= 0.7) types[col] = 'date';
      else types[col] = 'string';
    }

    return types;
  }

  /**
   * Pré-processa rows com base na configuração de colunas:
   * Normaliza valores numéricos (R$, formato BR) sem duplicar as linhas
   */
  function preprocessRows(rows, columnConfig) {
    if (!rows.length) return rows;
    const numCols = Object.entries(columnConfig)
      .filter(([, type]) => type === 'number')
      .map(([col]) => col);
    if (!numCols.length) return rows;

    for (const row of rows) {
      for (const col of numCols) {
        const value = row[col];
        if (typeof value === 'number' || value === '' || value === null || value === undefined) continue;
        const normalized = normalizeNumericValue(value);
        const parsed = Number.parseFloat(normalized);
        if (Number.isFinite(parsed)) row[col] = parsed;
      }
    }
    return rows;
  }

  function isDateLike(v) {
    if (v instanceof Date) return true;
    if (typeof v === 'string') {
      return /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(v.trim()) ||
             /^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(v.trim());
    }
    return false;
  }

  function numericColumns(types) {
    return Object.entries(types).filter(([, t]) => t === 'number').map(([c]) => c);
  }

  function stringColumns(types) {
    return Object.entries(types).filter(([, t]) => t !== 'number').map(([c]) => c);
  }

  function fmtNumber(n, decimals = 0) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (abs >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'M';
    if (abs >= 10_000)        return (n / 1_000).toFixed(1) + 'K';
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  return {
    readFile, sanitize, detectTypes,
    normalizeNumericValue, hasBRFormatting, preprocessRows,
    numericColumns, stringColumns, fmtNumber,
  };
})();
