/* ─────────────────────────────────────────────
   app.js — Controlador principal
───────────────────────────────────────────── */
const App = (() => {
  const STORAGE_KEY = 'aebes_bi_studio_saves';
  const LEGACY_STORAGE_KEY = 'dashgen_saves';

  /* ── Estado global ───────────────────────── */
  const state = {
    fileName:       '',
    rawRows:        [],
    rows:           [],
    columns:        [],
    columnTypes:    {},
    columnConfig:   {},
    numericColumns: [],
    stringColumns:  [],
    currentSheet:   '',
    allSheets:      {},
    sheetNames:     [],
    previewRows:     [],
    rowCount:        0,
    dataMode:        'memory',
    fileSize:        0,
    loadMs:          0,
    activeFilter:   null,   // { col, op, value }
    widgetFilters:  {},     // widgetId -> { coluna: valor }
    crossFilter:    null,   // { col, value }
    calculatedFields: [],
  };

  let memoryDataVersion = 0;
  let filteredRowsCache = { key: '', rows: null };
  let activeImport = null;
  let importSequence = 0;
  let uploadSources = [];
  const MAX_UPLOAD_FILES = 10;
  const MAX_EXCEL_FILES = 5;
  const MAX_EXCEL_BYTES = 150 * 1024 * 1024;
  const MAX_ANALYTIC_BYTES = 500 * 1024 * 1024;

  function invalidateMemoryCache() {
    memoryDataVersion++;
    filteredRowsCache = { key: '', rows: null };
  }

  function memoryFilterKey() {
    return JSON.stringify([memoryDataVersion, state.activeFilter, state.widgetFilters, state.crossFilter]);
  }

  function getActiveFilters() {
    const filters = state.activeFilter ? [state.activeFilter] : [];
    Object.values(state.widgetFilters).forEach(group => {
      Object.entries(group ?? {}).forEach(([col, filter]) => {
        if (filter && typeof filter === 'object' && filter.op) {
          if (filter.op === 'in' && filter.values?.length) filters.push({ col, ...filter });
          if (filter.op === 'between' && (filter.from || filter.to)) filters.push({ col, ...filter });
        } else if (String(filter ?? '').trim() !== '') {
          filters.push({ col, op: 'equals', value: filter });
        }
      });
    });
    return filters;
  }

  /* ── Init ────────────────────────────────── */
  function init() {
    setupFileInput();
    setupDragDrop();
    loadSavedList();
    renderThemePicker();
    renderBgPicker();

    document.addEventListener('click', e => {
      if (!e.target.closest('#export-dropdown')) closeExportMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeModal();
        closeColumnMappingModal();
        closeCalculatedFieldModal();
        Dashboard.closePageModal();
        Dashboard.stopPresentation?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); Dashboard.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); Dashboard.redo(); }
    });
  }

  /* ── File input & drag-drop ──────────────── */
  function setupFileInput() {
    const inp = document.getElementById('file-input');
    inp.addEventListener('change', () => {
      if (inp.files.length) addUploadFiles([...inp.files]);
      inp.value = '';
    });
    document.getElementById('upload-zone').addEventListener('click', () => inp.click());
  }

  function setupDragDrop() {
    const zone = document.getElementById('upload-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = [...e.dataTransfer.files];
      if (files.length) addUploadFiles(files);
    });
  }

  function fileGroup(file) {
    return /\.(xlsx|xls)$/i.test(file.name) ? 'excel' : 'analytic';
  }

  function validateUploadSources(sources) {
    if (sources.length > MAX_UPLOAD_FILES) return 'O limite geral é de 10 arquivos.';
    const groups = new Set(sources.map(source => fileGroup(source.file)));
    if (groups.size > 1) return 'Nesta primeira versão, não misture Excel com CSV/Parquet no mesmo empilhamento.';
    const totalBytes = sources.reduce((sum, source) => sum + source.file.size, 0);
    if (groups.has('excel')) {
      if (sources.length > MAX_EXCEL_FILES) return 'O limite para Excel é de 5 arquivos.';
      if (totalBytes > MAX_EXCEL_BYTES) return 'Arquivos Excel podem somar no máximo 150 MB.';
    } else if (totalBytes > MAX_ANALYTIC_BYTES) {
      return 'Arquivos CSV/Parquet podem somar no máximo 500 MB.';
    }
    return '';
  }

  function addUploadFiles(files) {
    const allowed = ['.xlsx', '.xls', '.csv', '.parquet'];
    const validFiles = files.filter(file => allowed.some(ext => file.name.toLowerCase().endsWith(ext)));
    if (validFiles.length !== files.length) toast('Alguns arquivos foram ignorados por terem formato inválido.', 'info');
    const additions = validFiles
      .filter(file => !uploadSources.some(source =>
        source.file.name === file.name &&
        source.file.size === file.size &&
        source.file.lastModified === file.lastModified
      ))
      .map((file, index) => ({
        id: `source_${Date.now()}_${index}`,
        file,
        name: file.name.replace(/\.[^.]+$/, ''),
      }));
    const next = [...uploadSources, ...additions];
    const error = validateUploadSources(next);
    if (error) { toast(error, 'error'); return; }
    uploadSources = next;
    renderUploadSources();
  }

  function renameUploadSource(id, value) {
    const source = uploadSources.find(item => item.id === id);
    if (!source) return;
    source.name = String(value ?? '').trim() || source.file.name.replace(/\.[^.]+$/, '');
    renderUploadSources();
  }

  function removeUploadSource(id) {
    uploadSources = uploadSources.filter(source => source.id !== id);
    renderUploadSources();
  }

  function clearUploadSources() {
    uploadSources = [];
    renderUploadSources();
  }

  function renderUploadSources() {
    const panel = document.getElementById('upload-sources-panel');
    const list = document.getElementById('upload-sources-list');
    const summary = document.getElementById('upload-sources-summary');
    const importButton = document.getElementById('upload-sources-import');
    if (!panel || !list || !summary || !importButton) return;
    panel.hidden = !uploadSources.length;
    const totalBytes = uploadSources.reduce((sum, source) => sum + source.file.size, 0);
    summary.textContent = `${uploadSources.length} arquivo${uploadSources.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)}`;
    importButton.innerHTML = uploadSources.length > 1
      ? '<i class="fa-solid fa-layer-group"></i> Importar e empilhar'
      : '<i class="fa-solid fa-arrow-right"></i> Importar arquivo';
    list.innerHTML = uploadSources.map(source => `
      <div class="upload-source-item">
        <span class="upload-source-icon"><i class="fa-solid ${fileGroup(source.file) === 'excel' ? 'fa-file-excel' : 'fa-database'}"></i></span>
        <div class="upload-source-info">
          <input value="${escHtml(source.name)}" maxlength="60"
            onchange="App.renameUploadSource('${source.id}',this.value)"
            aria-label="Nome da fonte">
          <small>${escHtml(source.file.name)} · ${formatBytes(source.file.size)}</small>
        </div>
        <button onclick="App.removeUploadSource('${source.id}')" title="Remover arquivo"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  }

  async function importUploadSources() {
    if (!uploadSources.length) return;
    const error = validateUploadSources(uploadSources);
    if (error) { toast(error, 'error'); return; }
    if (uploadSources.length === 1) {
      await handleFile(uploadSources[0].file);
      return;
    }
    if (fileGroup(uploadSources[0].file) === 'excel') await handleExcelFiles(uploadSources);
    else await handleAnalyticFiles(uploadSources);
  }

  /* ── Loading overlay ─────────────────────── */
  const LOADING_STAGES = [
    { pattern: /lendo arquivo|carregando motor/i, progress: 12, step: 'read' },
    { pattern: /estrutura|registrando|convertendo/i, progress: 35, step: 'parse' },
    { pattern: /colunas|tipos|processando/i, progress: 62, step: 'prepare' },
    { pattern: /contando|prévia|dashboard|aplicando/i, progress: 88, step: 'finish' },
  ];

  function setLoadingProgress(progress, step) {
    const value = Math.max(0, Math.min(100, Number(progress) || 0));
    const bar = document.getElementById('loading-progress');
    const pct = document.getElementById('loading-percent');
    if (bar) bar.style.width = value + '%';
    if (pct) pct.textContent = Math.round(value) + '%';
    const order = ['read', 'parse', 'prepare', 'finish'];
    const current = order.indexOf(step);
    document.querySelectorAll('#loading-steps [data-step]').forEach(el => {
      const index = order.indexOf(el.dataset.step);
      el.classList.toggle('done', value >= 100 || (current >= 0 && index < current));
      el.classList.toggle('active', value < 100 && index === current);
    });
  }

  function showLoading(msg, options = {}) {
    document.getElementById('loading-msg').textContent = msg || 'Processando…';
    const fileEl = document.getElementById('loading-file');
    if (fileEl) fileEl.textContent = options.file ? options.file.name + ' · ' + formatBytes(options.file.size) : '';
    const tip = document.getElementById('loading-tip');
    if (tip) tip.textContent = options.tip || 'Arquivos grandes podem levar alguns minutos. A aba pode continuar responsiva durante o processamento.';
    const elapsed = document.getElementById('loading-elapsed');
    if (elapsed) elapsed.textContent = '0 s decorridos';
    const cancel = document.getElementById('loading-cancel');
    if (cancel) { cancel.hidden = !options.cancellable; cancel.disabled = false; cancel.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancelar importação'; }
    setLoadingProgress(options.progress ?? 8, options.step ?? 'read');
    document.getElementById('loading-overlay').classList.add('active');
  }

  function updateLoadingMsg(msg, progress, step) {
    const el = document.getElementById('loading-msg');
    if (el) el.textContent = msg;
    if (progress === undefined) {
      const match = LOADING_STAGES.find(stage => stage.pattern.test(msg));
      if (match) { progress = match.progress; step = match.step; }
    }
    if (progress !== undefined) setLoadingProgress(progress, step);
  }

  function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
  }

  function startImportTimer(token) {
    const elapsed = document.getElementById('loading-elapsed');
    const render = () => { if (elapsed) elapsed.textContent = Math.max(0, Math.round((performance.now() - token.startedAt) / 1000)) + ' s decorridos'; };
    render();
    token.timer = setInterval(render, 1000);
  }

  function assertImportActive(token) {
    if (!token || token.cancelled || activeImport !== token) {
      const error = new Error('Importação cancelada');
      error.name = 'ImportCancelledError';
      throw error;
    }
  }

  function cancelImport() {
    const token = activeImport;
    if (!token || token.cancelled) return;
    token.cancelled = true;
    if (token.cancelWorker) token.cancelWorker();
    const button = document.getElementById('loading-cancel');
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cancelando…'; }
    updateLoadingMsg('Encerrando a importação com segurança…', 95, 'finish');
  }

  function readFileBuffer(file, token) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      token.cancelWorker = () => { reader.abort(); reject(Object.assign(new Error('Importação cancelada'), { name: 'ImportCancelledError' })); };
      reader.onprogress = event => {
        if (event.lengthComputable && !token.cancelled) {
          const progress = 8 + (event.loaded / event.total) * 20;
          updateLoadingMsg('Lendo arquivo…', progress, 'read');
        }
      };
      reader.onload = () => { token.cancelWorker = null; resolve(reader.result); };
      reader.onerror = () => { token.cancelWorker = null; reject(reader.error || new Error('Falha ao ler o arquivo.')); };
      reader.onabort = () => { token.cancelWorker = null; };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ── Parsing com Worker (fallback sync) ──── */
  function parseWithWorker(buffer, fileName, token) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('js/excel.worker.js');
      token.cancelWorker = () => { worker.terminate(); reject(Object.assign(new Error('Importação cancelada'), { name: 'ImportCancelledError' })); };
      worker.onmessage = e => {
        const { type, msg, sheetNames, rawSheets } = e.data;
        if (type === 'progress') updateLoadingMsg(msg);
        else if (type === 'done') {
          worker.terminate();
          token.cancelWorker = null;
          resolve({ sheetNames, sheets: rawSheets });
        } else if (type === 'error') { worker.terminate(); token.cancelWorker = null; reject(new Error(msg)); }
      };
      worker.onerror = () => { worker.terminate(); token.cancelWorker = null; reject(new Error('worker_failed')); };
      worker.postMessage({ buffer, fileName }, [buffer]);
    });
  }

  function parseSynchronous(buffer, fileName) {
    let wb;
    if (fileName.toLowerCase().endsWith('.csv')) {
      const text = new TextDecoder('utf-8').decode(buffer);
      wb = XLSX.read(text, { type: 'string' });
    } else {
      wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    }
    const sheets = {};
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      sheets[name] = ExcelParser.sanitize(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }));
    });
    return { sheetNames: wb.SheetNames, sheets };
  }

  /* ── Processar arquivo ───────────────────── */
  async function parseExcelSource(source, token) {
    const buffer = await readFileBuffer(source.file, token);
    assertImportActive(token);
    let result;
    if (typeof Worker !== 'undefined') {
      try { result = await parseWithWorker(buffer.slice(0), source.file.name, token); }
      catch (error) {
        if (token.cancelled || error.name === 'ImportCancelledError') throw error;
        result = parseSynchronous(buffer, source.file.name);
      }
    } else {
      result = parseSynchronous(buffer, source.file.name);
    }
    const firstSheet = result.sheetNames.find(name => result.sheets[name]?.length);
    if (!firstSheet) throw new Error(`O arquivo "${source.file.name}" está vazio.`);
    return { rows: result.sheets[firstSheet], sheetName: firstSheet };
  }

  function compatibleColumns(expected, actual) {
    return expected.length === actual.length && expected.every((column, index) => column === actual[index]);
  }

  async function handleExcelFiles(sources) {
    if (activeImport) { toast('Aguarde o encerramento da importação atual.', 'info'); return; }
    const token = { id: ++importSequence, startedAt: performance.now(), cancelled: false, timer: null, cancelWorker: null };
    activeImport = token;
    const totalSize = sources.reduce((sum, source) => sum + source.file.size, 0);
    state.fileSize = totalSize;
    state.calculatedFields = [];
    showLoading('Preparando arquivos Excel…', {
      cancellable: true, progress: 8, step: 'read',
      tip: 'Será utilizada a primeira aba com dados de cada arquivo. As colunas precisam ser iguais e estar na mesma ordem.',
    });
    startImportTimer(token);
    try {
      await DataEngine.reset();
      const parsedSources = [];
      for (let index = 0; index < sources.length; index++) {
        assertImportActive(token);
        updateLoadingMsg(`Lendo ${index + 1} de ${sources.length}: ${sources[index].file.name}`, 10 + (index / sources.length) * 55, 'read');
        parsedSources.push({ ...sources[index], ...(await parseExcelSource(sources[index], token)) });
      }
      const expectedColumns = Object.keys(parsedSources[0].rows[0] ?? {});
      const incompatible = parsedSources.find(source =>
        !compatibleColumns(expectedColumns, Object.keys(source.rows[0] ?? {}))
      );
      if (incompatible) {
        throw new Error(`As colunas de "${incompatible.file.name}" não são compatíveis com o primeiro arquivo.`);
      }
      let sourceColumn = 'Fonte';
      let suffix = 2;
      while (expectedColumns.includes(sourceColumn)) sourceColumn = `Fonte (${suffix++})`;
      updateLoadingMsg('Empilhando tabelas compatíveis…', 72, 'prepare');
      const combinedRows = parsedSources.flatMap(source =>
        source.rows.map(row => ({ ...row, [sourceColumn]: source.name }))
      );
      state.fileName = `${sources.length} arquivos empilhados`;
      state.dataMode = 'memory';
      state.allSheets = { 'Dados combinados': combinedRows };
      state.sheetNames = ['Dados combinados'];
      selectSheet('Dados combinados');
      state.fileSize = totalSize;
      state.loadMs = Math.round(performance.now() - token.startedAt);
      setLoadingProgress(100, 'finish');
      hideLoading();
      goToPreview();
      toast(`${sources.length} arquivos empilhados · ${state.rowCount.toLocaleString('pt-BR')} linhas`, 'success');
    } catch (error) {
      hideLoading();
      if (token.cancelled || error.name === 'ImportCancelledError') toast('Importação cancelada.', 'info');
      else { console.error(error); toast('Erro ao empilhar arquivos: ' + error.message, 'error'); }
    } finally {
      clearInterval(token.timer);
      token.cancelWorker = null;
      if (activeImport === token) activeImport = null;
    }
  }

  async function handleAnalyticFiles(sources) {
    if (activeImport) { toast('Aguarde o encerramento da importação atual.', 'info'); return; }
    const token = { id: ++importSequence, startedAt: performance.now(), cancelled: false, timer: null, cancelWorker: null };
    activeImport = token;
    const totalSize = sources.reduce((sum, source) => sum + source.file.size, 0);
    state.fileSize = totalSize;
    state.calculatedFields = [];
    showLoading('Preparando arquivos analíticos…', {
      cancellable: true, progress: 8, step: 'read',
      tip: 'CSV e Parquet serão empilhados no motor analítico sem criar todos os registros na memória do navegador.',
    });
    startImportTimer(token);
    try {
      const result = await DataEngine.loadFiles(sources, message => {
        if (!token.cancelled) updateLoadingMsg(message);
      });
      assertImportActive(token);
      state.fileName = `${sources.length} arquivos empilhados`;
      state.dataMode = 'query';
      state.currentSheet = 'Dados combinados';
      state.sheetNames = ['Dados combinados'];
      state.allSheets = {};
      state.rawRows = result.previewRows;
      state.rows = result.previewRows;
      state.previewRows = result.previewRows;
      state.rowCount = result.rowCount;
      state.loadMs = Math.round(performance.now() - token.startedAt);
      state.columnTypes = result.columnTypes;
      state.columnConfig = { ...result.columnTypes };
      state.columns = result.columns;
      state.numericColumns = ExcelParser.numericColumns(result.columnTypes);
      state.stringColumns = ExcelParser.stringColumns(result.columnTypes);
      setLoadingProgress(100, 'finish');
      hideLoading();
      goToPreview();
      toast(`${sources.length} arquivos empilhados no motor analítico.`, 'success');
    } catch (error) {
      await DataEngine.reset();
      hideLoading();
      if (token.cancelled || error.name === 'ImportCancelledError') toast('Importação cancelada.', 'info');
      else { console.error(error); toast('Erro ao empilhar arquivos: ' + error.message, 'error'); }
    } finally {
      clearInterval(token.timer);
      token.cancelWorker = null;
      if (activeImport === token) activeImport = null;
    }
  }

  async function handleFile(file) {
    if (activeImport) { toast('Aguarde o encerramento da importação atual.', 'info'); return; }
    const allowed = ['.xlsx', '.xls', '.csv', '.parquet'];
    if (!allowed.some(ext => file.name.toLowerCase().endsWith(ext))) {
      toast('Formato inválido. Use .xlsx, .xls, .csv ou .parquet', 'error');
      const input = document.getElementById('file-input');
      if (input) input.value = '';
      return;
    }
    const token = { id: ++importSequence, startedAt: performance.now(), cancelled: false, timer: null, cancelWorker: null };
    activeImport = token;
    const importStartedAt = token.startedAt;
    state.fileSize = file.size;
    state.calculatedFields = [];
    const isAnalytic = /\.(csv|parquet)$/i.test(file.name);
    const tip = isAnalytic
      ? 'Modo analítico: o arquivo será consultado sem criar milhões de objetos na interface.'
      : file.size >= 50 * 1024 * 1024
        ? 'Excel grande exige mais memória. Para bases recorrentes, prefira CSV ou Parquet.'
        : 'A leitura do Excel acontece em segundo plano para manter a página responsiva.';
    showLoading('Lendo arquivo…', { file, cancellable: true, progress: 8, step: 'read', tip });
    startImportTimer(token);
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.csv') || lowerName.endsWith('.parquet')) {
        const result = await DataEngine.loadFile(file, msg => { if (!token.cancelled) updateLoadingMsg(msg); });
        assertImportActive(token);
        updateLoadingMsg('Preparando prévia dos dados…', 96, 'finish');
        state.fileName       = file.name;
        state.dataMode       = 'query';
        state.currentSheet   = 'Dados';
        state.sheetNames     = ['Dados'];
        state.allSheets      = {};
        state.rawRows        = result.previewRows;
        state.rows           = result.previewRows;
        state.previewRows    = result.previewRows;
        state.rowCount       = result.rowCount;
        state.loadMs          = Math.round(performance.now() - importStartedAt);
        state.columnTypes    = result.columnTypes;
        state.columnConfig   = { ...result.columnTypes };
        state.columns        = result.columns;
        state.numericColumns = ExcelParser.numericColumns(result.columnTypes);
        state.stringColumns  = ExcelParser.stringColumns(result.columnTypes);
        setLoadingProgress(100, 'finish');
        hideLoading();
        goToPreview();
        toast(`Modo de dados grandes ativo: ${result.rowCount.toLocaleString('pt-BR')} linhas`, 'success');
        return;
      }

      await DataEngine.reset();
      assertImportActive(token);
      const buffer = await readFileBuffer(file, token);
      assertImportActive(token);
      let result;
      if (typeof Worker !== 'undefined') {
        try { result = await parseWithWorker(buffer.slice(0), file.name, token); }
        catch (error) {
          if (token.cancelled || error.name === 'ImportCancelledError') throw error;
          updateLoadingMsg('Worker indisponível; processando no navegador…', 55, 'prepare');
          result = parseSynchronous(buffer, file.name);
        }
      } else {
        result = parseSynchronous(buffer, file.name);
      }
      assertImportActive(token);
      const { sheetNames, sheets } = result;
      if (!sheetNames.length) throw new Error('Arquivo vazio ou sem dados');
      state.fileName   = file.name;
      state.dataMode   = 'memory';
      state.allSheets  = sheets;
      state.sheetNames = sheetNames;
      selectSheet(sheetNames[0]);
      state.loadMs = Math.round(performance.now() - importStartedAt);
      setLoadingProgress(100, 'finish');
      hideLoading();
      goToPreview();
      if (state.rowCount >= 250000) {
        toast('Arquivo Excel grande: para melhor desempenho, converta para CSV ou Parquet.', 'info');
      }
    } catch (e) {
      if (token.cancelled || e.name === 'ImportCancelledError') {
        await DataEngine.reset();
        hideLoading();
        toast('Importação cancelada.', 'info');
      } else {
        hideLoading();
        toast('Erro ao ler o arquivo: ' + e.message, 'error');
        console.error(e);
      }
    } finally {
      clearInterval(token.timer);
      token.cancelWorker = null;
      if (activeImport === token) activeImport = null;
      const input = document.getElementById('file-input');
      if (input) input.value = '';
    }
  }

  function selectSheet(name) {
    state.currentSheet   = name;
    state.rawRows        = state.allSheets[name] ?? [];
    state.columnTypes    = ExcelParser.detectTypes(state.rawRows);
    state.columns        = Object.keys(state.columnTypes);
    state.columnConfig   = { ...state.columnTypes };
    state.numericColumns = ExcelParser.numericColumns(state.columnTypes);
    state.stringColumns  = ExcelParser.stringColumns(state.columnTypes);
    state.rows           = state.rawRows;
    state.previewRows    = state.rawRows.slice(0, 200);
    state.rowCount       = state.rawRows.length;
    invalidateMemoryCache();
  }

  /* ── Aplicar mapeamento de colunas ──────── */
  async function applyColumnConfig() {
    const excluded = new Set(
      Object.entries(state.columnConfig).filter(([, t]) => t === 'excluded').map(([c]) => c)
    );
    const finalCols  = Object.keys(state.columnTypes).filter(c => !excluded.has(c));
    const finalTypes = {};
    finalCols.forEach(c => { finalTypes[c] = state.columnConfig[c] ?? state.columnTypes[c] ?? 'string'; });
    const calculatedFields = state.calculatedFields.filter(field =>
      field.name && !finalCols.includes(field.name)
    );
    calculatedFields.forEach(field => {
      finalTypes[field.name] = 'number';
      state.columnConfig[field.name] = 'number';
    });
    state.columns        = [...finalCols, ...calculatedFields.map(field => field.name)];
    state.numericColumns = ExcelParser.numericColumns(finalTypes);
    state.stringColumns  = ExcelParser.stringColumns(finalTypes);
    if (state.dataMode === 'query') {
      await DataEngine.rebuildView(state.columnConfig, calculatedFields);
    } else {
      state.rows = ExcelParser.preprocessRows(state.rawRows, state.columnConfig);
      state.rows.forEach(row => calculatedFields.forEach(field => {
        row[field.name] = ExcelParser.evaluateFormula(field.formula, row);
      }));
      invalidateMemoryCache();
    }
  }

  function rowMatchesFilter(row, filter) {
    if (!filter?.col) return true;
    const raw = row[filter.col];
    const type = state.columnConfig[filter.col] ?? state.columnTypes[filter.col];
    if (filter.op === 'in') {
      const values = filter.values ?? [];
      if (!values.length) return true;
      if (type === 'number') {
        const current = ExcelParser.parseNumericValue(raw);
        return values.some(value => ExcelParser.parseNumericValue(value) === current);
      }
      return values.some(value => String(value).trim() === String(raw ?? '').trim());
    }
    if (filter.op === 'between') {
      if (type === 'date') {
        const current = ExcelParser.parseDateValue(raw);
        const from = ExcelParser.parseDateValue(filter.from);
        const to = ExcelParser.parseDateValue(filter.to);
        return current !== null && (!from || current >= from) && (!to || current <= to);
      }
      if (type === 'time') {
        const current = ExcelParser.parseTimeValue(raw);
        const from = ExcelParser.parseTimeValue(filter.from);
        const to = ExcelParser.parseTimeValue(filter.to);
        return current !== null && (from === null || current >= from) && (to === null || current <= to);
      }
      const current = ExcelParser.parseNumericValue(raw);
      const from = ExcelParser.parseNumericValue(filter.from);
      const to = ExcelParser.parseNumericValue(filter.to);
      return current !== null && (from === null || current >= from) && (to === null || current <= to);
    }
    const value = String(filter.value ?? '').trim();
    if (!value) return true;
    const text = String(raw ?? '').toLowerCase().trim();
    const expected = value.toLowerCase();
    const numeric = ExcelParser.parseNumericValue(raw);
    const expectedNumeric = ExcelParser.parseNumericValue(value);
    const date = type === 'date' ? ExcelParser.parseDateValue(raw) : null;
    const expectedDate = type === 'date' ? ExcelParser.parseDateValue(value) : null;
    const time = type === 'time' ? ExcelParser.parseTimeValue(raw) : null;
    const expectedTime = type === 'time' ? ExcelParser.parseTimeValue(value) : null;
    switch (filter.op) {
      case 'contains': return text.includes(expected);
      case 'starts': return text.startsWith(expected);
      case 'equals':
        if (expectedDate) return date !== null && date.getTime() === expectedDate.getTime();
        if (expectedTime !== null) return time === expectedTime;
        return type === 'number' && expectedNumeric !== null ? numeric === expectedNumeric : text === expected;
      case 'gt': return expectedDate ? date > expectedDate : expectedTime !== null ? time > expectedTime : numeric !== null && expectedNumeric !== null && numeric > expectedNumeric;
      case 'gte': return expectedDate ? date >= expectedDate : expectedTime !== null ? time >= expectedTime : numeric !== null && expectedNumeric !== null && numeric >= expectedNumeric;
      case 'lt': return expectedDate ? date < expectedDate : expectedTime !== null ? time < expectedTime : numeric !== null && expectedNumeric !== null && numeric < expectedNumeric;
      case 'lte': return expectedDate ? date <= expectedDate : expectedTime !== null ? time <= expectedTime : numeric !== null && expectedNumeric !== null && numeric <= expectedNumeric;
      default: return true;
    }
  }

  /* ── getRows — aplica filtros ativos ────── */
  function getRows() {
    if (state.dataMode === 'query') return state.previewRows;
    const cacheKey = memoryFilterKey();
    if (filteredRowsCache.key === cacheKey && filteredRowsCache.rows) {
      return filteredRowsCache.rows;
    }
    let rows = state.rows;

    // Filtro global
    if (state.activeFilter) rows = rows.filter(row => rowMatchesFilter(row, state.activeFilter));

    // Filtro cruzado (clique em gráfico)
    Object.values(state.widgetFilters).forEach(group => {
      Object.entries(group ?? {}).forEach(([col, filter]) => {
        const normalized = filter && typeof filter === 'object'
          ? { col, ...filter }
          : { col, op: 'equals', value: filter };
        rows = rows.filter(row => rowMatchesFilter(row, normalized));
      });
    });

    const cf = state.crossFilter;
    if (cf && cf.col) {
      const filterValue = String(cf.value ?? '').trim();
      const isDate = (state.columnConfig[cf.col] ?? state.columnTypes[cf.col]) === 'date';
      const isTime = (state.columnConfig[cf.col] ?? state.columnTypes[cf.col]) === 'time';
      const filterDate = isDate ? ExcelParser.parseDateValue(filterValue) : null;
      const filterTime = isTime ? ExcelParser.parseTimeValue(filterValue) : null;
      rows = rows.filter(row => {
        const rowValue = String(row[cf.col] ?? '').trim();
        if (filterValue === '(vazio)') return rowValue === '';
        if (filterValue === '(data inválida)') return rowValue !== '' && ExcelParser.parseDateValue(rowValue) === null;
        if (filterDate) {
          const rowDate = ExcelParser.parseDateValue(row[cf.col]);
          return rowDate !== null && rowDate.getTime() === filterDate.getTime();
        }
        if (filterTime !== null) return ExcelParser.parseTimeValue(row[cf.col]) === filterTime;
        return rowValue === filterValue;
      });
    }

    filteredRowsCache = { key: cacheKey, rows };
    return rows;
  }

  /* ── Filtro cruzado ──────────────────────── */
  async function setCrossFilter(col, value) {
    if (state.crossFilter?.col === col && state.crossFilter?.value === value) {
      state.crossFilter = null;
    } else {
      state.crossFilter = { col, value };
    }
    invalidateMemoryCache();
    updateCrossFilterIndicator();
    await Dashboard.renderAll();
  }

  async function clearCrossFilter() {
    state.crossFilter = null;
    invalidateMemoryCache();
    updateCrossFilterIndicator();
    await Dashboard.renderAll();
  }

  function updateCrossFilterIndicator() {
    const bar = document.getElementById('cross-filter-bar');
    const lbl = document.getElementById('cross-filter-label');
    if (!bar || !lbl) return;
    const cf = state.crossFilter;
    if (cf) {
      lbl.textContent = `${cf.col} = "${cf.value}"`;
      bar.style.display = 'flex';
    } else {
      bar.style.display = 'none';
    }
  }

  /* ── Filtro global ───────────────────────── */
  function toggleFilterBar() {
    const bar = document.getElementById('filter-bar');
    if (!bar) return;
    const visible = bar.classList.toggle('open');
    if (visible) populateFilterCols();
  }

  function populateFilterCols() {
    const sel = document.getElementById('filter-col');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = state.columns.map(c =>
      `<option value="${escHtml(c)}" ${c === current ? 'selected' : ''}>${escHtml(c)}</option>`
    ).join('');
    onFilterColChange();
  }

  function onFilterColChange() {
    const col     = document.getElementById('filter-col')?.value;
    const opSel   = document.getElementById('filter-op');
    const typeOps = ['contains', 'starts', 'equals', 'gt', 'lt', 'gte', 'lte'];
    const textOps = ['contains', 'starts', 'equals'];
    if (!col || !opSel) return;

    const isNum = state.numericColumns.includes(col);
    const isDate = (state.columnConfig[col] ?? state.columnTypes[col]) === 'date';
    const isTime = (state.columnConfig[col] ?? state.columnTypes[col]) === 'time';
    const dateOps = ['equals', 'gt', 'lt', 'gte', 'lte'];
    opSel.innerHTML = (isNum ? typeOps : (isDate || isTime) ? dateOps : textOps).map(op => {
      const labels = {
        contains: 'contém', starts: 'começa com', equals: 'igual a',
        gt: 'maior que', lt: 'menor que', gte: '≥', lte: '≤',
      };
      return `<option value="${op}">${labels[op] ?? op}</option>`;
    }).join('');
  }

  async function applyFilter() {
    const col   = document.getElementById('filter-col')?.value;
    const op    = document.getElementById('filter-op')?.value ?? 'contains';
    const value = document.getElementById('filter-value')?.value ?? '';

    if (!col) { toast('Selecione uma coluna para filtrar.', 'error'); return; }

    state.activeFilter = { col, op, value };
    invalidateMemoryCache();
    await Dashboard.renderAll();

    const count = await getFilteredCount();
    const countEl = document.getElementById('filter-count');
    if (countEl) countEl.textContent = `${count.toLocaleString('pt-BR')} de ${state.rowCount.toLocaleString('pt-BR')} linhas`;
    toast(`Filtro aplicado — ${count} linhas`, 'success');
  }

  async function clearFilter() {
    state.activeFilter = null;
    invalidateMemoryCache();
    const inp = document.getElementById('filter-value');
    if (inp) inp.value = '';
    const countEl = document.getElementById('filter-count');
    if (countEl) countEl.textContent = '';
    await Dashboard.renderAll();
    toast('Filtro removido');
  }

  async function setWidgetFilter(widgetId, column, value) {
    state.widgetFilters[widgetId] ??= {};
    if (value === '') delete state.widgetFilters[widgetId][column];
    else state.widgetFilters[widgetId][column] = value;
    if (!Object.keys(state.widgetFilters[widgetId]).length) delete state.widgetFilters[widgetId];
    invalidateMemoryCache();
    await Dashboard.renderAll();
  }

  function setDrillThroughFilter(col, value) {
    state.crossFilter = { col, value };
    invalidateMemoryCache();
    updateCrossFilterIndicator();
  }

  async function toggleWidgetFilterValue(widgetId, column, value, checked) {
    state.widgetFilters[widgetId] ??= {};
    const current = state.widgetFilters[widgetId][column];
    const values = new Set(current?.op === 'in' ? current.values : []);
    if (checked) values.add(value);
    else values.delete(value);
    if (values.size) state.widgetFilters[widgetId][column] = { op: 'in', values: [...values] };
    else delete state.widgetFilters[widgetId][column];
    if (!Object.keys(state.widgetFilters[widgetId]).length) delete state.widgetFilters[widgetId];
    invalidateMemoryCache();
    await Dashboard.renderAll();
  }

  async function setWidgetRangeFilter(widgetId, column, from, to) {
    state.widgetFilters[widgetId] ??= {};
    if (from || to) state.widgetFilters[widgetId][column] = { op: 'between', from, to };
    else delete state.widgetFilters[widgetId][column];
    if (!Object.keys(state.widgetFilters[widgetId]).length) delete state.widgetFilters[widgetId];
    invalidateMemoryCache();
    await Dashboard.renderAll();
  }

  async function clearWidgetFilters(widgetId) {
    delete state.widgetFilters[widgetId];
    invalidateMemoryCache();
    await Dashboard.renderAll();
  }

  function removeWidgetFilters(widgetId) {
    if (!state.widgetFilters[widgetId]) return;
    delete state.widgetFilters[widgetId];
    invalidateMemoryCache();
  }

  async function getDistinctValues(column, excludeWidgetId = '', excludeColumn = '') {
    if (!state.columns.includes(column)) return [];
    const filters = getActiveFilters().filter(filter =>
      !(excludeWidgetId && state.widgetFilters[excludeWidgetId] &&
        filter.col === excludeColumn &&
        (filter.op === 'in' || filter.op === 'between'))
    );
    if (state.dataMode === 'query') return DataEngine.distinct(column, filters, state.crossFilter);
    const values = new Map();
    state.rows.filter(row => {
      if (!filters.every(filter => rowMatchesFilter(row, filter))) return false;
      if (!state.crossFilter?.col) return true;
      const raw = row[state.crossFilter.col];
      const expected = String(state.crossFilter.value ?? '').trim();
      if (expected === '(vazio)') return String(raw ?? '').trim() === '';
      if (expected === '(data inválida)' || expected === '(data invÃ¡lida)') {
        return String(raw ?? '').trim() !== '' && ExcelParser.parseDateValue(raw) === null;
      }
      return rowMatchesFilter(row, { col: state.crossFilter.col, op: 'equals', value: expected });
    }).forEach(row => {
      const raw = row[column];
      const key = String(raw ?? '').trim();
      if (!key || values.has(key)) return;
      values.set(key, raw);
    });
    return [...values.values()]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' }))
      .slice(0, 500);
  }

  let editingCalculatedId = '';

  function renderCalculatedFieldsList() {
    const list = document.getElementById('calculated-fields-list');
    if (!list) return;
    list.innerHTML = state.calculatedFields.length
      ? state.calculatedFields.map(field => `
        <div class="calculated-field-item">
          <button onclick="App.editCalculatedField('${field.id}')">
            <strong>${escHtml(field.name)}</strong><small>${escHtml(field.formula)}</small>
          </button>
          <button class="calculated-field-delete" onclick="App.deleteCalculatedField('${field.id}')" title="Excluir"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
      : '<p class="calculated-fields-empty">Nenhum campo calculado.</p>';
  }

  function openCalculatedFieldModal() {
    if (!state.rowCount) { toast('Carregue um arquivo primeiro.', 'error'); return; }
    editingCalculatedId = '';
    document.getElementById('calculated-name').value = '';
    document.getElementById('calculated-formula').value = '';
    document.getElementById('calculated-columns').innerHTML = Object.keys(state.columnTypes)
      .filter(column => state.columnConfig[column] !== 'excluded')
      .map(column => `<button type="button" onclick="App.insertCalculatedColumn('${escHtml(escJs(column))}')">[${escHtml(column)}]</button>`)
      .join('');
    document.getElementById('calculated-overlay').classList.add('open');
  }

  function closeCalculatedFieldModal() {
    document.getElementById('calculated-overlay')?.classList.remove('open');
  }

  function insertCalculatedColumn(column) {
    const input = document.getElementById('calculated-formula');
    if (!input) return;
    const insertion = `[${column}]`;
    input.setRangeText(insertion, input.selectionStart, input.selectionEnd, 'end');
    input.focus();
  }

  function editCalculatedField(id) {
    const field = state.calculatedFields.find(item => item.id === id);
    if (!field) return;
    openCalculatedFieldModal();
    editingCalculatedId = id;
    document.getElementById('calculated-name').value = field.name;
    document.getElementById('calculated-formula').value = field.formula;
  }

  async function saveCalculatedField() {
    const name = document.getElementById('calculated-name')?.value.trim();
    const formula = document.getElementById('calculated-formula')?.value.trim();
    if (!name || !formula) { toast('Informe nome e fórmula.', 'error'); return; }
    const baseColumns = Object.keys(state.columnTypes).filter(column => state.columnConfig[column] !== 'excluded');
    const duplicate = baseColumns.includes(name) || state.calculatedFields.some(field => field.name === name && field.id !== editingCalculatedId);
    if (duplicate) { toast('Já existe uma coluna com esse nome.', 'error'); return; }
    try { ExcelParser.validateFormula(formula, baseColumns); }
    catch (error) { toast(error.message, 'error'); return; }
    if (editingCalculatedId) {
      const field = state.calculatedFields.find(item => item.id === editingCalculatedId);
      Object.assign(field, { name, formula });
    } else {
      state.calculatedFields.push({ id: `calc_${Date.now()}`, name, formula });
    }
    await applyColumnConfig();
    renderColumnsList();
    renderCalculatedFieldsList();
    await Dashboard.renderAll();
    closeCalculatedFieldModal();
    toast('Campo calculado aplicado.', 'success');
  }

  async function deleteCalculatedField(id) {
    const field = state.calculatedFields.find(item => item.id === id);
    if (!field || !confirm(`Excluir o campo calculado "${field.name}"?`)) return;
    state.calculatedFields = state.calculatedFields.filter(item => item.id !== id);
    delete state.columnConfig[field.name];
    await applyColumnConfig();
    renderColumnsList();
    renderCalculatedFieldsList();
    await Dashboard.renderAll();
  }

  async function loadCalculatedFields(fields) {
    const baseColumns = Object.keys(state.columnTypes).filter(column => state.columnConfig[column] !== 'excluded');
    const names = new Set();
    state.calculatedFields = (Array.isArray(fields) ? fields : []).filter(field => {
      try {
        if (!field?.name || baseColumns.includes(field.name) || names.has(field.name)) return false;
        ExcelParser.validateFormula(field.formula, baseColumns);
        names.add(field.name);
        return true;
      } catch (_) { return false; }
    }).map((field, index) => ({
      id: /^calc_[a-z0-9_-]+$/i.test(field.id ?? '') ? field.id : `calc_${index + 1}`,
      name: field.name,
      formula: field.formula,
    }));
    await applyColumnConfig();
    renderCalculatedFieldsList();
    renderColumnsList();
  }

  /* ── Modal de mapeamento de colunas ─────── */
  function openColumnMappingModal() {
    if (!state.rowCount) { toast('Carregue um arquivo primeiro.', 'error'); return; }
    document.getElementById('colmap-body').innerHTML = buildColumnMappingHTML();
    document.getElementById('colmap-overlay').classList.add('open');
  }

  function buildColumnMappingHTML() {
    const cols   = Object.keys(state.columnTypes);
    const sample = state.rawRows[0] ?? {};
    if (!cols.length) return '<p style="padding:20px;color:#94a3b8">Nenhuma coluna encontrada.</p>';

    let html = `
      <div class="colmap-info">
        <i class="fa-solid fa-circle-info"></i>
        Revise os tipos detectados. Colunas <strong>Excluir</strong> não aparecerão nos widgets.
        O badge <span class="badge-br">BR</span> indica valores R$/BR que serão normalizados ao definir como Número.
      </div>
      <div class="colmap-table-wrap">
        <table class="colmap-table">
          <thead><tr><th>Coluna</th><th>Tipo</th><th>Amostra (1ª linha)</th></tr></thead>
          <tbody>`;

    cols.forEach(col => {
      const cur   = state.columnConfig[col] ?? state.columnTypes[col] ?? 'string';
      const sv    = String(sample[col] ?? '—').slice(0, 40);
      const hasBR = ExcelParser.hasBRFormatting(state.rawRows, col);
      const isEx  = cur === 'excluded';
      html += `
        <tr class="colmap-row${isEx ? ' excluded' : ''}">
          <td class="colmap-colname">
            ${escHtml(col)}
            ${hasBR ? '<span class="badge-br" title="Formato R$/BR detectado">BR</span>' : ''}
          </td>
          <td class="colmap-type">
            <select class="form-control colmap-type-sel" data-col="${escHtml(col)}" onchange="App.onColTypeChange(this)">
              <option value="identifier" ${cur==='identifier' ?'selected':''}>ID Identificador</option>
              <option value="time" ${cur==='time' ?'selected':''}>Hora (HH:mm:ss)</option>
              <option value="number"   ${cur==='number'   ?'selected':''}>🔢 Número</option>
              <option value="string"   ${cur==='string'   ?'selected':''}>🔤 Texto</option>
              <option value="date"     ${cur==='date'     ?'selected':''}>📅 Data</option>
              <option value="excluded" ${cur==='excluded' ?'selected':''}>✕ Excluir</option>
            </select>
          </td>
          <td class="colmap-sample${isEx ? ' muted' : ''}">${escHtml(sv)}</td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    return html;
  }

  function onColTypeChange(sel) {
    const col = sel.dataset.col;
    state.columnConfig[col] = sel.value;
    const row = sel.closest('.colmap-row');
    if (!row) return;
    row.classList.toggle('excluded', sel.value === 'excluded');
    const sc = row.querySelector('.colmap-sample');
    if (sc) sc.classList.toggle('muted', sel.value === 'excluded');
  }

  async function confirmColumnMapping() {
    document.querySelectorAll('.colmap-type-sel').forEach(sel => {
      state.columnConfig[sel.dataset.col] = sel.value;
    });
    closeColumnMappingModal();
    showLoading('Aplicando tipos das colunas…');
    await applyColumnConfig();
    hideLoading();
    await Dashboard.renderAll();
    renderColumnsList();
    toast('Mapeamento aplicado! Dashboard atualizado.', 'success');
  }

  function closeColumnMappingModal() {
    document.getElementById('colmap-overlay').classList.remove('open');
  }

  /* ── Navegação entre telas ───────────────── */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function goToUpload() { showScreen('upload-screen'); loadSavedList(); }

  function goToPreview() {
    showScreen('preview-screen');
    renderPreview();
  }

  async function goToDashboard() {
    showLoading('Preparando dashboard…');
    await applyColumnConfig();
    state.activeFilter = null;
    state.widgetFilters = {};
    state.crossFilter  = null;
    showScreen('dashboard-screen');
    document.getElementById('dash-file-badge').textContent = state.dataMode === 'query'
      ? `${state.fileName} · motor analítico`
      : state.fileName;
    renderColumnsList();
    renderCalculatedFieldsList();
    Dashboard.updatePlaceholder();
    Dashboard.resetHistory();
    // Garante que indicadores de filtro estão limpos
    const cfb = document.getElementById('cross-filter-bar');
    if (cfb) cfb.style.display = 'none';
    const fb = document.getElementById('filter-bar');
    if (fb) fb.classList.remove('open');
    hideLoading();
  }

  function goToPreviewFromDashboard() {
    showScreen('preview-screen');
    renderPreview();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /* ── Preview ─────────────────────────────── */
  function renderPreview() {
    document.getElementById('file-name-display').textContent = state.fileName;
    const tabsEl = document.getElementById('sheet-tabs');
    tabsEl.innerHTML = state.sheetNames.map(n => `
      <button class="sheet-tab ${n === state.currentSheet ? 'active' : ''}"
              onclick="App.switchSheet('${escHtml(n)}')">${escHtml(n)}</button>
    `).join('');

    const allCols = Object.keys(state.columnTypes);
    const modeLabel = state.dataMode === 'query' ? 'motor analítico' : 'memória otimizada';
    document.getElementById('preview-stats').textContent =
      `${state.rowCount.toLocaleString('pt-BR')} linhas · ${allCols.length} colunas · ${formatBytes(state.fileSize)} · ${state.loadMs} ms · ${modeLabel}`;

    const summary = document.getElementById('large-file-summary');
    const isLarge = state.dataMode === 'query' || state.rowCount >= 250000;
    if (summary) {
      summary.hidden = !isLarge;
      if (isLarge) summary.innerHTML = state.dataMode === 'query'
        ? '<i class="fa-solid fa-database"></i><div><strong>Base de grande volume em modo analítico</strong><span>A tabela abaixo é uma amostra de até 200 linhas. Gráficos, filtros e indicadores consultam as ' + state.rowCount.toLocaleString('pt-BR') + ' linhas completas.</span></div>'
        : '<i class="fa-solid fa-memory"></i><div><strong>Arquivo Excel grande carregado em memória</strong><span>A prévia mostra até 200 linhas. Para melhor estabilidade acima de 250 mil linhas, considere converter a base para Parquet.</span></div>';
    }

    const wrapper = document.getElementById('data-table-wrapper');
    if (!state.previewRows.length) {
      wrapper.innerHTML = '<p style="padding:20px;color:#94a3b8">Nenhum dado encontrado.</p>';
      return;
    }
    const numSet = new Set(state.numericColumns);
    let html = '<table class="data-table"><thead><tr><th class="row-num">#</th>';
    allCols.forEach(c => {
      const t = state.columnTypes[c];
      const badge = t === 'number' ? '123' : t === 'date' ? '📅' : 'Aa';
      html += `<th>${escHtml(c)} <span class="col-type">${badge}</span></th>`;
    });
    html += '</tr></thead><tbody>';
    state.previewRows.slice(0, 200).forEach((row, i) => {
      html += `<tr><td class="row-num">${i + 1}</td>`;
      allCols.forEach(c => {
        const cls = numSet.has(c) ? ' class="num"' : '';
        html += `<td${cls}>${escHtml(String(row[c] ?? ''))}</td>`;
      });
      html += '</tr>';
    });
    if (state.rowCount > 200) {
      html += `<tr><td colspan="${allCols.length + 1}" style="text-align:center;padding:12px;color:#94a3b8;font-style:italic">
        … mais ${(state.rowCount - 200).toLocaleString('pt-BR')} linhas (total: ${state.rowCount.toLocaleString('pt-BR')})
      </td></tr>`;
    }
    wrapper.innerHTML = html + '</tbody></table>';
  }

  function switchSheet(name) {
    if (state.dataMode === 'query') return;
    selectSheet(name);
    renderPreview();
  }

  /* ── Sidebar de colunas ──────────────────── */
  function renderColumnsList() {
    const el = document.getElementById('columns-list');
    el.innerHTML = state.columns.map(c => {
      const t    = state.columnConfig[c] ?? state.columnTypes[c];
      const cls  = t === 'number' ? 'numeric' : ['date', 'time'].includes(t) ? 'date' : 'string';
      const icon = t === 'number' ? '#' : t === 'date' ? '📅' : 'A';
      const displayIcon = t === 'time' ? 'H' : t === 'identifier' ? 'ID' : icon;
      return `<div class="col-badge ${cls}"><span class="col-icon">${displayIcon}</span>${escHtml(c)}</div>`;
    }).join('');
  }

  /* ── Theme & BG pickers ──────────────────── */
  function normalizeHexColor(value) {
    const raw = String(value ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) return '#' + raw.split('').map(char => char + char).join('').toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toLowerCase();
    return null;
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16),
    };
  }

  function rgbToHex(red, green, blue) {
    const values = [red, green, blue].map(value =>
      Math.max(0, Math.min(255, Number.parseInt(value, 10) || 0))
    );
    return '#' + values.map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function updateCustomColorControls(hex) {
    const normalized = normalizeHexColor(hex);
    const rgb = hexToRgb(normalized);
    if (!normalized || !rgb) return false;
    const wheel = document.getElementById('custom-color-wheel');
    const hexInput = document.getElementById('custom-color-hex');
    const redInput = document.getElementById('custom-color-r');
    const greenInput = document.getElementById('custom-color-g');
    const blueInput = document.getElementById('custom-color-b');
    if (wheel) wheel.value = normalized;
    if (hexInput) {
      hexInput.value = normalized.slice(1).toUpperCase();
      hexInput.classList.remove('invalid');
    }
    if (redInput) redInput.value = rgb.r;
    if (greenInput) greenInput.value = rgb.g;
    if (blueInput) blueInput.value = rgb.b;
    Charts.setCustomTheme(normalized);
    const previewColors = Charts.getAllThemes().custom?.colors ?? [];
    document.querySelectorAll('.custom-palette-preview span').forEach((element, index) => {
      if (previewColors[index]) element.style.background = previewColors[index];
    });
    return true;
  }

  function renderThemePicker() {
    const el = document.getElementById('theme-picker');
    if (!el) return;
    const themes  = Charts.getAllThemes();
    const current = Charts.getTheme();
    const customColor = Charts.getCustomColor();
    const rgb = hexToRgb(customColor);
    const customColors = themes.custom?.colors ?? [customColor];
    el.innerHTML = `
      <div class="theme-presets">
        ${Object.entries(themes).filter(([key]) => key !== 'custom').map(([key, theme]) => `
          <button class="theme-swatch ${current === key ? 'active' : ''}"
                  style="background:${theme.swatch}" title="${theme.name}"
                  aria-label="Aplicar paleta ${theme.name}"
                  onclick="App.setTheme('${key}')"></button>
        `).join('')}
      </div>
      <div class="custom-theme-editor ${current === 'custom' ? 'active' : ''}">
        <div class="custom-color-heading">
          <input id="custom-color-wheel" class="custom-color-wheel" type="color"
                 value="${customColor}" aria-label="Abrir seletor visual de cores"
                 oninput="App.syncCustomColorFromHex(this.value)"
                 onchange="App.applyCustomTheme()" />
          <div>
            <strong>Cor personalizada</strong>
            <span>Seletor visual, RGB ou hexadecimal</span>
          </div>
        </div>
        <label class="custom-color-label" for="custom-color-hex">Buscar por hexadecimal</label>
        <div class="custom-hex-row">
          <span>#</span>
          <input id="custom-color-hex" type="text" maxlength="6" value="${customColor.slice(1).toUpperCase()}"
                 spellcheck="false" placeholder="6366F1"
                 oninput="App.syncCustomColorFromHex(this.value)"
                 onkeydown="if(event.key==='Enter')App.applyCustomTheme()" />
        </div>
        <div class="custom-rgb-row">
          ${[['r','R',rgb.r],['g','G',rgb.g],['b','B',rgb.b]].map(([key, label, value]) => `
            <label><span>${label}</span><input id="custom-color-${key}" type="number" min="0" max="255"
              value="${value}" oninput="App.syncCustomColorFromRGB()" /></label>
          `).join('')}
        </div>
        <div class="custom-palette-preview">
          ${customColors.map(color => `<span style="background:${color}"></span>`).join('')}
        </div>
        <button class="custom-color-apply ${current === 'custom' ? 'active' : ''}" onclick="App.applyCustomTheme()">
          <i class="fa-solid fa-palette"></i> ${current === 'custom' ? 'Paleta personalizada ativa' : 'Aplicar cor personalizada'}
        </button>
      </div>`;
  }

  function setTheme(name) {
    Charts.setTheme(name);
    renderThemePicker();
    Dashboard.renderAll();
    toast('Tema aplicado: ' + Charts.getAllThemes()[name]?.name);
  }

  function syncCustomColorFromHex(value) {
    const input = document.getElementById('custom-color-hex');
    const raw = String(value ?? '').trim().replace(/^#/, '');
    if (raw.length !== 6) {
      input?.classList.remove('invalid');
      return;
    }
    const normalized = normalizeHexColor(value);
    if (!normalized) {
      input?.classList.add('invalid');
      return;
    }
    updateCustomColorControls(normalized);
  }

  function syncCustomColorFromRGB() {
    const red = document.getElementById('custom-color-r')?.value;
    const green = document.getElementById('custom-color-g')?.value;
    const blue = document.getElementById('custom-color-b')?.value;
    updateCustomColorControls(rgbToHex(red, green, blue));
  }

  function applyCustomTheme() {
    const hexValue = document.getElementById('custom-color-hex')?.value;
    const normalized = normalizeHexColor(hexValue);
    if (!normalized || !Charts.setCustomTheme(normalized)) {
      document.getElementById('custom-color-hex')?.classList.add('invalid');
      toast('Informe uma cor hexadecimal válida.', 'error');
      return;
    }
    Charts.setTheme('custom');
    renderThemePicker();
    Dashboard.renderAll();
    toast('Paleta personalizada aplicada: ' + normalized.toUpperCase(), 'success');
  }

  function renderBgPicker() {
    const el = document.getElementById('bg-picker');
    if (!el) return;
    const bgs    = Charts.getBgColors();
    const canvas = document.getElementById('dash-canvas');
    const current = canvas?.dataset.bg ?? bgs[0];
    el.innerHTML = bgs.map(bg => `
      <div class="bg-swatch ${current === bg ? 'active' : ''}"
           style="background:${bg}; ${bg === '#ffffff' ? 'border:1px solid #e2e8f0;' : ''}"
           title="${bg}" onclick="App.setBg('${bg}')"></div>
    `).join('');
  }

  function setBg(color) {
    const canvas = document.getElementById('dash-canvas');
    if (!canvas) return;
    canvas.style.background = color;
    canvas.dataset.bg = color;
    renderBgPicker();
  }

  /* ── Gestão de armazenamento ─────────────── */
  function getStorageStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}';
      const usedBytes = new Blob([raw]).size;
      const maxBytes  = 5 * 1024 * 1024;
      return {
        usedKB: Math.round(usedBytes / 1024),
        usedMB: (usedBytes / (1024 * 1024)).toFixed(2),
        pct:    Math.min(100, Math.round(usedBytes / maxBytes * 100)),
      };
    } catch { return { usedKB: 0, usedMB: '0.00', pct: 0 }; }
  }

  function getSaves() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return JSON.parse(current);
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacy) return {};
      const saves = JSON.parse(legacy);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
      return saves;
    } catch {
      return {};
    }
  }

  function saveDashboard() {
    const data  = Dashboard.serialize();
    const id    = data.title.trim() || 'dashboard';
    const saves = getSaves();
    saves[id]   = { ...data, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
      loadSavedList();
      toast('Dashboard salvo!', 'success');
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        const stats = getStorageStats();
        toast(`Armazenamento cheio (${stats.usedKB} KB usados de ~5 MB). Delete dashboards antigos.`, 'error');
      } else {
        toast('Erro ao salvar dashboard.', 'error');
        console.error(e);
      }
    }
  }

  function loadSavedList() {
    const saves = getSaves();
    const keys  = Object.keys(saves);
    const sec   = document.getElementById('saved-section');
    const list  = document.getElementById('saved-list');
    if (!sec || !list) return;
    if (!keys.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';

    const stats    = getStorageStats();
    const barColor = stats.pct > 80 ? 'var(--c-red)' : stats.pct > 60 ? 'var(--c-yellow)' : 'var(--c-green)';
    const storageBar = `
      <div class="storage-stats">
        <div class="storage-bar-track">
          <div class="storage-bar-fill" style="width:${stats.pct}%;background:${barColor};"></div>
        </div>
        <span class="storage-label">${stats.usedKB} KB usados de ~5 MB (${stats.pct}%)</span>
      </div>`;

    list.innerHTML = storageBar + keys.map(k => {
      const d      = saves[k];
      const dt     = d.savedAt ? new Date(d.savedAt).toLocaleDateString('pt-BR') : '';
      const sizeKB = Math.round(new Blob([JSON.stringify(d)]).size / 1024);
      const widgetCount = Array.isArray(d.pages)
        ? d.pages.reduce((total, page) => total + (page.widgets?.length ?? 0), 0)
        : d.widgets?.length ?? 0;
      return `
        <div class="saved-card">
          <div class="saved-card-title">${escHtml(d.title ?? k)}</div>
          <div class="saved-card-meta">${widgetCount} widgets · ${dt} · ${sizeKB} KB</div>
          <div class="saved-card-actions">
            <button onclick="App.loadDashboard('${escHtml(k)}')"><i class="fa-solid fa-play"></i> Abrir</button>
            <button class="btn-del" onclick="App.deleteSaved('${escHtml(k)}')"><i class="fa-solid fa-trash"></i> Deletar</button>
          </div>
        </div>`;
    }).join('');
  }

  async function loadDashboard(key) {
    const saves = getSaves();
    const data  = saves[key];
    if (!data) return;
    if (!state.rowCount) {
      toast('Carregue um arquivo primeiro, depois abra o dashboard salvo.', 'info');
      return;
    }
    await goToDashboard();
    await Dashboard.load(data);
    toast('Dashboard carregado!', 'success');
  }

  function deleteSaved(key) {
    if (!confirm(`Deletar "${key}"?`)) return;
    const saves = getSaves();
    delete saves[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
    loadSavedList();
    toast('Dashboard deletado.');
  }

  /* ── Modal ───────────────────────────────── */
  function closeModal(e) {
    if (e && e.target !== document.getElementById('modal-overlay')) return;
    document.getElementById('modal-overlay').classList.remove('open');
  }

  /* ── Sidebar & menus ─────────────────────── */
  function toggleSidebar() { document.getElementById('dash-sidebar').classList.toggle('collapsed'); }
  function toggleExportMenu() { document.getElementById('export-menu').classList.toggle('open'); }
  function closeExportMenu() { document.getElementById('export-menu')?.classList.remove('open'); }

  /* ── Toast ───────────────────────────────── */
  let toastTimer;
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function getFilteredCount() {
    if (state.dataMode === 'query') {
      return DataEngine.count(getActiveFilters(), state.crossFilter);
    }
    return getRows().length;
  }

  async function queryAggregate(config) {
    return DataEngine.aggregate(config, getActiveFilters(), state.crossFilter);
  }

  async function queryKPI(config, unfiltered = false) {
    return DataEngine.kpi(config, getActiveFilters(), state.crossFilter, unfiltered);
  }

  async function queryTable(config, page = 0) {
    return DataEngine.table(config, page, getActiveFilters(), state.crossFilter);
  }

  async function queryScatter(config) {
    return DataEngine.scatter(config, getActiveFilters(), state.crossFilter);
  }

  async function queryExportRows(limit) {
    if (state.dataMode === 'query') return DataEngine.exportRows(limit);
    return state.rows.slice(0, limit);
  }

  return {
    state,
    init,
    goToUpload,
    goToPreview: goToPreviewFromDashboard,
    goToDashboard,
    switchSheet,
    getRows,
    getFilteredCount, queryAggregate, queryKPI, queryTable, queryScatter, queryExportRows, getDistinctValues,
    setCrossFilter, setDrillThroughFilter, clearCrossFilter,
    setWidgetFilter, toggleWidgetFilterValue, setWidgetRangeFilter, clearWidgetFilters, removeWidgetFilters,
    toggleFilterBar, onFilterColChange, applyFilter, clearFilter,
    openColumnMappingModal, closeColumnMappingModal, confirmColumnMapping, onColTypeChange,
    openCalculatedFieldModal, closeCalculatedFieldModal, insertCalculatedColumn,
    saveCalculatedField, editCalculatedField, deleteCalculatedField, loadCalculatedFields,
    saveDashboard, loadDashboard, deleteSaved,
    renderThemePicker, renderBgPicker, renderColumnsList,
    setTheme, syncCustomColorFromHex, syncCustomColorFromRGB, applyCustomTheme, setBg,
    closeModal,
    toggleSidebar,
    toggleExportMenu, closeExportMenu,
    cancelImport,
    addUploadFiles, renameUploadSource, removeUploadSource, clearUploadSources, importUploadSources,
    toast,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
