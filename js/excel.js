/* ─────────────────────────────────────────────
   excel.js — Leitura e análise de planilhas
───────────────────────────────────────────── */
const ExcelParser = (() => {

  function normalizeHeaders(headers) {
    const usedKeys = new Set();
    return headers.map(header => {
      const base = String(header).trim() || 'Coluna';
      let cleanKey = base;
      let suffix = 2;
      while (usedKeys.has(cleanKey)) cleanKey = `${base} (${suffix++})`;
      usedKeys.add(cleanKey);
      return cleanKey;
    });
  }

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
    const originalKeys = Object.keys(rows[0]);
    const cleanKeys = normalizeHeaders(originalKeys);
    const keyMap = new Map();
    originalKeys.forEach((originalKey, index) => {
      keyMap.set(originalKey, cleanKeys[index]);
    });
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < rows.length; readIndex++) {
      const sourceRow = rows[readIndex];
      let hasValue = false;

      for (const value of Object.values(sourceRow)) {
        if (value !== '' && value !== null && value !== undefined) hasValue = true;
      }
      if (!hasValue) continue;

      let row = sourceRow;
      if (originalKeys.some(key => keyMap.get(key) !== key)) {
        row = {};
        originalKeys.forEach(key => {
          row[keyMap.get(key)] = sourceRow[key];
        });
      }
      rows[writeIndex++] = row;
    }

    rows.length = writeIndex;
    return rows;
  }

  /** Normaliza números brasileiros/internacionais para o formato decimal JS */
  function normalizeNumericValue(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return String(v);
    let clean = String(v).trim();
    const negativeParentheses = /^\(.*\)$/.test(clean);
    clean = clean
      .replace(/[()]/g, '')
      .replace(/\b(?:BRL|USD|EUR|GBP|JPY)\b/gi, '')
      .replace(/(?:R|US)\$/gi, '')
      .replace(/[$€£¥]/g, '')
      .replace(/%/g, '')
      .replace(/[\s\u00a0]/g, '');

    if (!clean) return '';
    const sign = negativeParentheses && !clean.startsWith('-') ? '-' : '';
    clean = clean.replace(/^\+/, '');
    if (/^-?\d+(?:[eE][+-]?\d+)?$/.test(clean)) return sign + clean;

    const dots = (clean.match(/\./g) ?? []).length;
    const commas = (clean.match(/,/g) ?? []).length;
    const groupedDots = /^-?[1-9]\d{0,2}(?:\.\d{3})+$/.test(clean);
    const groupedCommas = /^-?[1-9]\d{0,2}(?:,\d{3})+$/.test(clean);

    if (dots && commas) {
      if (clean.lastIndexOf('.') > clean.lastIndexOf(',')) {
        clean = clean.replace(/,/g, '');
      } else {
        clean = clean.replace(/\./g, '').replace(/,/g, '.');
      }
    } else if (groupedDots) {
      clean = clean.replace(/\./g, '');
    } else if (groupedCommas) {
      clean = clean.replace(/,/g, '');
    } else if (dots > 1) {
      const last = clean.lastIndexOf('.');
      clean = clean.slice(0, last).replace(/\./g, '') + clean.slice(last);
    } else if (commas > 1) {
      const last = clean.lastIndexOf(',');
      clean = clean.slice(0, last).replace(/,/g, '') + '.' + clean.slice(last + 1);
    } else if (commas === 1) {
      clean = clean.replace(',', '.');
    }

    return sign + clean;
  }

  function parseNumericValue(value) {
    const normalized = normalizeNumericValue(value);
    if (normalized === '') return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseDateValue(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }
    const text = String(value ?? '').trim();
    if (!text) return null;

    const br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const iso = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
    const match = br || iso;
    if (match) {
      const year = br ? (match[3].length === 2 ? Number('20' + match[3]) : Number(match[3])) : Number(match[1]);
      const month = Number(br ? match[2] : match[2]);
      const day = Number(br ? match[1] : match[3]);
      const hour = Number(match[4] ?? 0);
      const minute = Number(match[5] ?? 0);
      const second = Number(match[6] ?? 0);
      const date = new Date(year, month - 1, day, hour, minute, second);
      if (
        date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
        date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second
      ) return null;
      return date;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseTimeValue(value) {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds();
    }
    if (typeof value === 'number' && value >= 0 && value < 1) {
      return Math.round(value * 86400) % 86400;
    }
    const text = String(value ?? '').trim();
    if (!text) return null;
    const match = text.match(/^(\d{1,2})(?::|h)(\d{2})(?::(\d{2}))?$/i);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return hour * 3600 + minute * 60 + second;
  }

  function formatTimeValue(value, includeSeconds = false) {
    const total = parseTimeValue(value);
    if (total === null) return String(value ?? '');
    const hour = Math.floor(total / 3600);
    const minute = Math.floor((total % 3600) / 60);
    const second = total % 60;
    const base = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return includeSeconds || second ? `${base}:${String(second).padStart(2, '0')}` : base;
  }

  function isTimeLike(value) {
    return typeof value === 'string' &&
      /^(\d{1,2})(?::|h)(\d{2})(?::(\d{2}))?$/i.test(value.trim()) &&
      parseTimeValue(value) !== null;
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
      let timeCount = 0;
      let identifierCount = 0;
      for (const value of sample) {
        if (parseNumericValue(value) !== null) numericCount++;
        if (isDateLike(value)) dateCount++;
        if (isTimeLike(value)) timeCount++;
        if (typeof value === 'string' && /^[-+]?0\d+$/.test(value.trim())) identifierCount++;
      }

      if (identifierCount / sample.length >= 0.5) types[col] = 'identifier';
      else if (timeCount / sample.length >= 0.7) types[col] = 'time';
      else if (numericCount / sample.length >= 0.8) types[col] = 'number';
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
        const parsed = parseNumericValue(value);
        row[col] = parsed;
      }
    }
    return rows;
  }

  function tokenizeFormula(formula) {
    const source = String(formula ?? '').trim().replace(/^=/, '');
    if (!source) throw new Error('Informe uma fórmula.');
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      const rest = source.slice(index);
      const whitespace = rest.match(/^\s+/);
      if (whitespace) { index += whitespace[0].length; continue; }
      if (source[index] === '[') {
        const end = source.indexOf(']', index + 1);
        if (end < 0) throw new Error('Feche o nome da coluna com ].');
        const value = source.slice(index + 1, end).trim();
        if (!value) throw new Error('Nome de coluna vazio.');
        tokens.push({ type: 'column', value });
        index = end + 1;
        continue;
      }
      const number = rest.match(/^(?:\d+(?:[.,]\d*)?|[.,]\d+)/);
      if (number) {
        tokens.push({ type: 'number', value: Number(number[0].replace(',', '.')) });
        index += number[0].length;
        continue;
      }
      const char = source[index];
      if ('+-*/'.includes(char)) tokens.push({ type: 'operator', value: char });
      else if ('()'.includes(char)) tokens.push({ type: 'paren', value: char });
      else throw new Error(`Caractere não permitido na fórmula: ${char}`);
      index++;
    }
    return tokens;
  }

  function formulaColumns(formula) {
    return [...new Set(tokenizeFormula(formula)
      .filter(token => token.type === 'column')
      .map(token => token.value))];
  }

  function validateFormula(formula, availableColumns = []) {
    const tokens = tokenizeFormula(formula);
    const available = new Set(availableColumns);
    const missing = tokens
      .filter(token => token.type === 'column' && !available.has(token.value))
      .map(token => token.value);
    if (missing.length) throw new Error(`Coluna não encontrada: ${[...new Set(missing)].join(', ')}`);
    evaluateFormulaTokens(tokens, Object.fromEntries(availableColumns.map(column => [column, 1])));
    return tokens;
  }

  function evaluateFormulaTokens(tokens, row) {
    let position = 0;
    const parseExpression = () => {
      let value = parseTerm();
      while (tokens[position]?.type === 'operator' && ['+', '-'].includes(tokens[position].value)) {
        const operator = tokens[position++].value;
        const right = parseTerm();
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    };
    const parseTerm = () => {
      let value = parseFactor();
      while (tokens[position]?.type === 'operator' && ['*', '/'].includes(tokens[position].value)) {
        const operator = tokens[position++].value;
        const right = parseFactor();
        value = operator === '*' ? value * right : right === 0 ? NaN : value / right;
      }
      return value;
    };
    const parseFactor = () => {
      const token = tokens[position++];
      if (!token) throw new Error('Fórmula incompleta.');
      if (token.type === 'operator' && ['+', '-'].includes(token.value)) {
        const value = parseFactor();
        return token.value === '-' ? -value : value;
      }
      if (token.type === 'number') return token.value;
      if (token.type === 'column') return parseNumericValue(row[token.value]) ?? 0;
      if (token.type === 'paren' && token.value === '(') {
        const value = parseExpression();
        if (tokens[position]?.type !== 'paren' || tokens[position].value !== ')') {
          throw new Error('Parênteses não fechados.');
        }
        position++;
        return value;
      }
      throw new Error('Expressão inválida.');
    };
    const result = parseExpression();
    if (position !== tokens.length) throw new Error('Expressão inválida.');
    return Number.isFinite(result) ? result : null;
  }

  function evaluateFormula(formula, row) {
    return evaluateFormulaTokens(tokenizeFormula(formula), row);
  }

  function isDateLike(v) {
    return parseDateValue(v) !== null;
  }

  function numericColumns(types) {
    return Object.entries(types).filter(([, t]) => t === 'number').map(([c]) => c);
  }

  function stringColumns(types) {
    return Object.entries(types).filter(([, t]) => t !== 'number').map(([c]) => c);
  }

  function fmtNumber(n, decimals = 0) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const number = Number(n);
    const abs = Math.abs(number);
    const maxDecimals = Math.max(1, Math.min(4, Number(decimals) || 0));
    const compact = (divisor, suffix) =>
      (number / divisor).toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDecimals,
      }) + suffix;
    if (abs >= 1_000_000_000) return compact(1_000_000_000, 'B');
    if (abs >= 1_000_000)     return compact(1_000_000, 'M');
    if (abs >= 1_000)         return compact(1_000, 'K');
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  return {
    readFile, sanitize, normalizeHeaders, detectTypes,
    normalizeNumericValue, parseNumericValue, parseDateValue, parseTimeValue, formatTimeValue,
    hasBRFormatting, preprocessRows,
    tokenizeFormula, formulaColumns, validateFormula, evaluateFormula,
    numericColumns, stringColumns, fmtNumber,
  };
})();
