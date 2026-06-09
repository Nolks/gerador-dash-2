/* ─────────────────────────────────────────────
   excel.worker.js — Parsing de Excel em background thread
───────────────────────────────────────────── */
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

function sanitizeRows(rows) {
  if (!rows.length) return rows;
  const originalKeys = Object.keys(rows[0]);
  const usedKeys = new Set();
  const keyMap = new Map();
  originalKeys.forEach(originalKey => {
    const base = String(originalKey).trim() || 'Coluna';
    let cleanKey = base;
    let suffix = 2;
    while (usedKeys.has(cleanKey)) cleanKey = `${base} (${suffix++})`;
    usedKeys.add(cleanKey);
    keyMap.set(originalKey, cleanKey);
  });
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < rows.length; readIndex++) {
    const sourceRow = rows[readIndex];
    let hasValue = false;
    for (const value of Object.values(sourceRow)) {
      if (value !== '' && value !== null && value !== undefined) { hasValue = true; break; }
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

self.onmessage = function (e) {
  const { buffer, fileName } = e.data;
  try {
    self.postMessage({ type: 'progress', msg: 'Lendo estrutura do arquivo…' });

    let wb;
    if (fileName.toLowerCase().endsWith('.csv')) {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
      wb = XLSX.read(text, { type: 'string' });
    } else {
      wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    }

    self.postMessage({ type: 'progress', msg: 'Convertendo planilhas…' });

    const rawSheets = {};
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      rawSheets[name] = sanitizeRows(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }));
    });

    self.postMessage({ type: 'done', sheetNames: wb.SheetNames, rawSheets });
  } catch (err) {
    self.postMessage({ type: 'error', msg: err.message });
  }
};
