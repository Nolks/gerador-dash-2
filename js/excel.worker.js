/* ─────────────────────────────────────────────
   excel.worker.js — Parsing de Excel em background thread
───────────────────────────────────────────── */
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

function sanitizeRows(rows) {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < rows.length; readIndex++) {
    const row = rows[readIndex];
    let hasValue = false;
    for (const value of Object.values(row)) {
      if (value !== '' && value !== null && value !== undefined) { hasValue = true; break; }
    }
    if (!hasValue) continue;
    for (const key of Object.keys(row)) {
      const cleanKey = String(key).trim();
      if (cleanKey !== key) {
        row[cleanKey] = row[key];
        delete row[key];
      }
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
