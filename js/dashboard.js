/* ─────────────────────────────────────────────
   dashboard.js — Gerenciamento de widgets
───────────────────────────────────────────── */
const Dashboard = (() => {

  let widgets    = [];
  let editingId  = null;
  const chartMap = {};   // widgetId → Chart instance
  const pageMap  = {};   // widgetId → página atual da tabela
  const renderVersion = {};
  let sortable   = null;

  /* ── Histórico para Undo/Redo ────────────── */
  const historyStack = [];
  let historyPos     = -1;
  const MAX_HISTORY  = 25;

  function pushHistory() {
    historyStack.splice(historyPos + 1);
    historyStack.push(JSON.parse(JSON.stringify(widgets)));
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    else historyPos++;
    syncUndoRedoUI();
  }

  function undo() {
    if (historyPos <= 0) return;
    historyPos--;
    applyHistoryState(historyStack[historyPos]);
    App.toast('Desfeito', 'info');
  }

  function redo() {
    if (historyPos >= historyStack.length - 1) return;
    historyPos++;
    applyHistoryState(historyStack[historyPos]);
    App.toast('Refeito', 'info');
  }

  function applyHistoryState(snapshot) {
    widgets = JSON.parse(JSON.stringify(snapshot));
    renderAll();
    syncUndoRedoUI();
    App.renderColumnsList();
  }

  function syncUndoRedoUI() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = historyPos <= 0;
    if (redoBtn) redoBtn.disabled = historyPos >= historyStack.length - 1;
  }

  function resetHistory() {
    historyStack.length = 0;
    historyPos = -1;
    syncUndoRedoUI();
  }

  const SIZES = ['sm', 'md', 'lg', 'full'];
  const SIZE_LABELS = { sm: '¼', md: '½', lg: '¾', full: '⬜' };

  /* ── Ícones por tipo ─────────────────────── */
  const TYPE_META = {
    bar:      { icon: 'fa-chart-bar',   label: 'Barras' },
    line:     { icon: 'fa-chart-line',  label: 'Linhas' },
    area:     { icon: 'fa-chart-area',  label: 'Área' },
    pie:      { icon: 'fa-chart-pie',   label: 'Pizza' },
    doughnut: { icon: 'fa-circle-dot',  label: 'Rosca' },
    scatter:  { icon: 'fa-circle-nodes',label: 'Dispersão' },
    kpi:      { icon: 'fa-gauge-high',  label: 'Indicador' },
    table:    { icon: 'fa-table',       label: 'Tabela' },
    text:     { icon: 'fa-align-left',  label: 'Texto' },
  };

  /* ── Defaults por tipo ───────────────────── */
  function defaultConfig(type, cols, numCols, strCols) {
    const xCol  = strCols[0]  ?? cols[0] ?? '';
    const yCol  = numCols[0]  ?? '';
    const yCols = numCols.slice(0, 1);

    const base = {
      xColumn: xCol, yColumns: yCols,
      aggregation: 'sum', limit: 15,
      sortBy: 'value', sortDir: 'desc',
      dateGroup: 'none', showOthers: false,
      valueFormat: 'number', valueDecimals: 0, currency: 'BRL',
      showLegend: true, showGrid: true,
    };

    if (type === 'text') return {
      content: '# Título do texto\n\nEscreva **parágrafos**, listas e outros elementos em Markdown.',
      fontSize: 16, fontFamily: 'system', color: '#334155', align: 'left',
      lineHeight: 1.6, background: '#ffffff',
    };
    if (type === 'kpi')     return { column: yCol, kpiAgg: 'sum', prefix: '', suffix: '', decimals: 0, valueFormat: 'number', valueDecimals: 0, currency: 'BRL', iconClass: 'fa-gauge-high' };
    if (type === 'table')   return { columns: cols.slice(0, 6), rowLimit: 15 };
    if (type === 'scatter') return { xColumn: numCols[0] ?? '', yColumns: [numCols[1] ?? numCols[0] ?? ''], limit: 100, showLegend: false };
    if (['pie','doughnut'].includes(type)) return { ...base, limit: 10 };
    return base;
  }

  /* ── Adicionar widget ────────────────────── */
  function addWidget(type) {
    const st   = App.state;
    const cols = st.columns;
    if (type !== 'text' && !cols.length) { App.toast('Nenhum dado carregado.', 'error'); return; }

    const numCols = st.numericColumns;
    const strCols = st.stringColumns;
    const id      = 'w_' + Date.now();
    const size    = type === 'kpi' ? 'sm' : type === 'table' ? 'lg' : 'md';

    const w = {
      id, type,
      title: TYPE_META[type]?.label ?? type,
      size,
      config: defaultConfig(type, cols, numCols, strCols),
    };

    widgets.push(w);
    renderWidget(w);
    initSortable();
    updatePlaceholder();
    pushHistory();
    openEditModal(w.id);
  }

  /* ── Renderizar todos ────────────────────── */
  async function renderAll() {
    const grid = document.getElementById('widgets-grid');
    grid.innerHTML = '';
    Object.values(chartMap).forEach(c => { try { c.destroy(); } catch(_) {} });
    for (const k in chartMap) delete chartMap[k];
    await Promise.all(widgets.map(w => renderWidget(w)));
    updatePlaceholder();
    initSortable();
  }

  /* ── Renderizar widget ───────────────────── */
  function renderWidget(w) {
    const grid = document.getElementById('widgets-grid');
    const el   = document.createElement('div');
    el.className = `widget sz-${w.size}`;
    el.dataset.id = w.id;

    const meta = TYPE_META[w.type] ?? { icon: 'fa-chart-bar', label: w.type };

    el.innerHTML = `
      <div class="widget-header">
        <div class="widget-title widget-drag" title="Arraste para reposicionar: ${escHtml(w.title)}">
          <i class="fa-solid fa-grip-vertical widget-grip" aria-hidden="true"></i>
          <i class="fa-solid ${meta.icon}" style="margin-right:6px;opacity:.5;font-size:11px;"></i>${escHtml(w.title)}
        </div>
        <div class="widget-controls">
          <button class="widget-btn resize-btn" onclick="Dashboard.resizeWidget('${w.id}')"
            title="Tamanho: ${w.size}" data-size="${w.size}">
            <span class="size-label">${SIZE_LABELS[w.size] ?? '½'}</span>
          </button>
          <button class="widget-btn" onclick="Dashboard.openEditModal('${w.id}')" title="Editar">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="widget-btn" onclick="Dashboard.duplicateWidget('${w.id}')" title="Duplicar">
            <i class="fa-solid fa-copy"></i>
          </button>
          <button class="widget-btn del" onclick="Dashboard.deleteWidget('${w.id}')" title="Remover">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <div class="widget-body" id="wb_${w.id}"></div>
      <div class="widget-resize-handle" onpointerdown="Dashboard.startResize(event, '${w.id}')" title="Arraste para alterar a largura">
        <i class="fa-solid fa-grip-lines-vertical"></i>
      </div>
    `;

    grid.appendChild(el);
    const rendered = renderWidgetContent(w);
    return rendered;
  }

  /* ── Resize por botão (ciclo de tamanhos) ── */
  function resizeWidget(id) {
    const w = widgets.find(x => x.id === id);
    if (!w) return;
    const idx = SIZES.indexOf(w.size);
    w.size = SIZES[(idx + 1) % SIZES.length];

    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) {
      el.className = el.className.replace(/sz-\w+/, '').trim() + ` sz-${w.size}`;
      const btn = el.querySelector('.resize-btn');
      if (btn) {
        btn.title = `Tamanho: ${w.size}`;
        btn.dataset.size = w.size;
        btn.querySelector('.size-label').textContent = SIZE_LABELS[w.size];
      }
    }
    // Re-renderiza chart para ajustar ao novo tamanho
    setTimeout(() => { renderWidgetContent(w); pushHistory(); }, 50);
    App.toast(`Widget → ${({sm:'Pequeno',md:'Médio',lg:'Grande',full:'Completo'})[w.size]}`);
  }

  /* ── Resize por arrasto (handle no canto) ── */
  function startResize(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const el = document.querySelector(`[data-id="${id}"]`);
    const w = widgets.find(x => x.id === id);
    if (!el || !w) return;

    const grid = document.getElementById('widgets-grid');
    const spans = [3, 6, 9, 12];
    const handle = e.currentTarget;
    const originalSize = w.size;

    el.classList.add('resizing');
    el.dataset.resizeLabel = `${spans[SIZES.indexOf(w.size)]}/12`;
    grid.classList.add('is-resizing');
    handle.setPointerCapture?.(e.pointerId);

    function onMove(ev) {
      const gridRect = grid.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const desiredWidth = Math.max(1, ev.clientX - elRect.left);
      const desiredSpan = Math.max(3, Math.min(12, Math.round((desiredWidth / gridRect.width) * 12)));
      let newIdx = 0;
      for (let i = 1; i < spans.length; i++) {
        if (Math.abs(spans[i] - desiredSpan) < Math.abs(spans[newIdx] - desiredSpan)) newIdx = i;
      }
      const newSize = SIZES[newIdx];
      if (newSize !== w.size) {
        const positions = captureGridPositions();
        w.size = newSize;
        el.className = el.className.replace(/sz-\w+/, '').trim() + ` sz-${newSize}`;
        el.dataset.resizeLabel = `${spans[newIdx]}/12`;
        animateGridFrom(positions, el);
        const btn = el.querySelector('.resize-btn');
        if (btn) {
          btn.title = `Tamanho: ${newSize}`;
          btn.dataset.size = newSize;
          btn.querySelector('.size-label').textContent = SIZE_LABELS[newSize];
        }
      }
    }

    function finish(ev, cancelled = false) {
      if (cancelled) {
        w.size = originalSize;
        el.className = el.className.replace(/sz-\w+/, '').trim() + ` sz-${originalSize}`;
        const btn = el.querySelector('.resize-btn');
        if (btn) {
          btn.title = `Tamanho: ${originalSize}`;
          btn.dataset.size = originalSize;
          btn.querySelector('.size-label').textContent = SIZE_LABELS[originalSize];
        }
      }
      el.classList.remove('resizing');
      grid.classList.remove('is-resizing');
      delete el.dataset.resizeLabel;
      handle.releasePointerCapture?.(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      if (!cancelled && w.size !== originalSize) {
        setTimeout(() => { renderWidgetContent(w); pushHistory(); }, 80);
      }
    }

    function onUp(ev) { finish(ev); }
    function onCancel(ev) { finish(ev, true); }

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  function captureGridPositions() {
    const positions = new Map();
    document.querySelectorAll('#widgets-grid > .widget').forEach(node => {
      positions.set(node, node.getBoundingClientRect());
    });
    return positions;
  }

  function animateGridFrom(positions, excluded) {
    requestAnimationFrame(() => {
      positions.forEach((before, node) => {
        if (node === excluded || !node.isConnected) return;
        const after = node.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (!dx && !dy) return;
        node.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
      });
    });
  }

  /* ── Preparação para exportação PDF ─────── */
  // Expande todas as tabelas (sem paginação) e as move para o final do grid
  function prepareForPDFExport() {
    const grid = document.getElementById('widgets-grid');
    const rows = App.state.rows;

    // 1) Renderizar cada tabela mostrando TODAS as linhas
    widgets.forEach(w => {
      if (w.type !== 'table') return;
      const body = document.getElementById(`wb_${w.id}`);
      if (!body) return;
      renderTableFull(body, w, rows);
      // Forçar largura completa no DOM temporariamente
      const el = document.querySelector(`[data-id="${w.id}"]`);
      if (el) {
        el.dataset.origSize = w.size;
        el.className = el.className.replace(/sz-\w+/, '').trim() + ' sz-full';
      }
    });

    // 2) Mover widgets de tabela para o final do grid
    const tableEls = [...grid.querySelectorAll('.widget')].filter(el => {
      const w = widgets.find(x => x.id === el.dataset.id);
      return w && w.type === 'table';
    });
    tableEls.forEach(el => grid.appendChild(el));
  }

  // Renderiza tabela completa sem paginação (só para uso interno/PDF)
  function renderTableFull(body, w, rows) {
    const cfg     = w.config;
    const cols    = (cfg.columns && cfg.columns.length) ? cfg.columns : App.state.columns.slice(0, 6);
    const numCols = new Set(App.state.numericColumns);

    let html = `<div class="widget-table-wrap" style="max-height:none;">
      <table class="widget-table"><thead><tr>`;
    cols.forEach(c => { html += `<th>${escHtml(c)}</th>`; });
    html += `</tr></thead><tbody>`;

    rows.forEach(r => {
      html += '<tr>';
      cols.forEach(c => {
        const v   = r[c] ?? '';
        const cls = numCols.has(c) ? ' class="num"' : '';
        html += `<td${cls}>${escHtml(String(v))}</td>`;
      });
      html += '</tr>';
    });

    html += `</tbody></table></div>
      <p class="pag-summary" style="text-align:right;">
        <i class="fa-solid fa-check-circle" style="color:#22c55e;margin-right:4px;"></i>
        ${rows.length} linhas — exibição completa para PDF
      </p>`;
    body.innerHTML = html;
  }

  // Restaura tudo ao estado original após a captura do PDF
  // (prepareForPDFExport usa App.state.rows — dados completos, sem filtros de view)
  function restoreAfterPDFExport() {
    widgets.forEach(w => {
      if (w.type !== 'table') return;
      const el = document.querySelector(`[data-id="${w.id}"]`);
      if (el && el.dataset.origSize) {
        el.className = el.className.replace(/sz-\w+/, '').trim() + ` sz-${el.dataset.origSize}`;
        delete el.dataset.origSize;
      }
    });
    // Re-renderiza widgets de tabela com paginação normal de volta
    widgets.forEach(w => {
      if (w.type === 'table') renderWidgetContent(w);
    });
    // Restaura ordem original dos elementos no grid
    const grid = document.getElementById('widgets-grid');
    widgets.forEach(w => {
      const el = document.querySelector(`[data-id="${w.id}"]`);
      if (el) grid.appendChild(el);
    });
  }
  async function renderWidgetContent(w) {
    const body = document.getElementById(`wb_${w.id}`);
    if (!body) return;
    const version = (renderVersion[w.id] ?? 0) + 1;
    renderVersion[w.id] = version;
    body.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px"><i class="fa-solid fa-circle-notch fa-spin"></i> Consultando dados…</div>';

    if (w.type === 'text') {
      renderTextWidget(body, w);
      return;
    }

    // Destruir chart anterior
    if (chartMap[w.id]) {
      try { chartMap[w.id].destroy(); } catch(_) {}
      delete chartMap[w.id];
    }

    if (App.state.dataMode === 'query') {
      try {
        if (w.type === 'kpi') {
          const [current, total] = await Promise.all([
            App.queryKPI(w.config),
            (App.state.activeFilter || App.state.crossFilter) ? App.queryKPI(w.config, true) : Promise.resolve(null),
          ]);
          if (renderVersion[w.id] !== version) return;
          renderQueryKPI(body, w, current, total);
          return;
        }

        if (w.type === 'table') {
          const result = await App.queryTable(w.config, pageMap[w.id] ?? 0);
          if (renderVersion[w.id] !== version) return;
          renderQueryTable(body, w, result);
          return;
        }

        const prepared = w.type === 'scatter'
          ? await App.queryScatter(w.config)
          : await App.queryAggregate(w.config);
        if (renderVersion[w.id] !== version) return;
        body.innerHTML = '';
        const canvas = document.createElement('canvas');
        body.appendChild(canvas);
        const chart = Charts.createPrepared(canvas, w, prepared);
        if (chart) chartMap[w.id] = chart;
        else renderWidgetError(body, 'Configure as colunas para visualizar o gráfico');
      } catch (error) {
        console.error(error);
        if (renderVersion[w.id] === version) renderWidgetError(body, 'Falha ao consultar os dados');
      }
      return;
    }

    const rows = App.getRows();

    if (w.type === 'kpi') {
      renderKPI(body, w, rows);
      return;
    }

    if (w.type === 'table') {
      renderTable(body, w, rows);
      return;
    }

    // Chart
    const canvas = document.createElement('canvas');
    body.appendChild(canvas);

    const chart = Charts.create(canvas, w, rows);
    if (chart) {
      chartMap[w.id] = chart;
    } else {
      body.innerHTML = `<div style="color:#94a3b8;font-size:13px;padding:20px;text-align:center;">
        <i class="fa-solid fa-triangle-exclamation" style="display:block;font-size:28px;margin-bottom:8px;opacity:.4;"></i>
        Configure as colunas para visualizar o gráfico
      </div>`;
    }
  }

  function renderTextWidget(body, w) {
    const cfg = w.config ?? {};
    const fontFamilies = {
      system: "'Segoe UI', system-ui, sans-serif",
      serif: "Georgia, 'Times New Roman', serif",
      mono: "'Courier New', monospace",
      modern: "Arial, Helvetica, sans-serif",
    };
    const fontSize = Math.max(10, Math.min(72, Number(cfg.fontSize) || 16));
    const lineHeight = Math.max(1, Math.min(2.5, Number(cfg.lineHeight) || 1.6));
    const align = ['left', 'center', 'right', 'justify'].includes(cfg.align) ? cfg.align : 'left';
    const color = /^#[0-9a-f]{6}$/i.test(cfg.color ?? '') ? cfg.color : '#334155';
    const background = /^#[0-9a-f]{6}$/i.test(cfg.background ?? '') ? cfg.background : '#ffffff';
    body.innerHTML = `<div class="markdown-widget" style="font-family:${fontFamilies[cfg.fontFamily] ?? fontFamilies.system};font-size:${fontSize}px;line-height:${lineHeight};text-align:${align};color:${color};background:${background}">${MarkdownRenderer.render(cfg.content ?? '')}</div>`;
  }

  function renderWidgetError(body, message) {
    body.innerHTML = `<div style="color:#94a3b8;font-size:13px;padding:20px;text-align:center;">
      <i class="fa-solid fa-triangle-exclamation" style="display:block;font-size:28px;margin-bottom:8px;opacity:.4;"></i>
      ${escHtml(message)}
    </div>`;
  }

  function renderQueryKPI(body, w, current, total) {
    const cfg = w.config;
    const value = current.value === null ? null : Number(current.value);
    const fmt = value !== null ? Charts.formatValue(value, { valueFormat: cfg.valueFormat ?? 'number', valueDecimals: cfg.valueDecimals ?? cfg.decimals ?? 0, currency: cfg.currency ?? 'BRL' }) : '—';
    let trendHTML = '';
    const totalValue = total?.value === null || total?.value === undefined ? null : Number(total.value);
    if (totalValue && value !== null && totalValue !== value) {
      const delta = ((value - totalValue) / Math.abs(totalValue)) * 100;
      const sign = delta >= 0 ? '+' : '';
      const color = delta >= 0 ? 'var(--c-green)' : 'var(--c-red)';
      const icon = delta >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
      trendHTML = `<div class="kpi-trend" style="color:${color}">
        <i class="fa-solid ${icon}"></i> ${sign}${delta.toFixed(1)}% vs total
      </div>`;
    }
    const labels = { sum: 'Soma', avg: 'Média', count: 'Contagem', max: 'Máximo', min: 'Mínimo' };
    body.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-value">${escHtml(cfg.prefix)}${fmt}${escHtml(cfg.suffix)}</div>
        <div class="kpi-label">${escHtml(cfg.column)}</div>
        ${trendHTML}
        <div class="kpi-sub">${labels[cfg.kpiAgg] ?? ''} · ${current.rows.toLocaleString('pt-BR')} linhas</div>
      </div>`;
  }

  function renderQueryTable(body, w, result) {
    const numCols = new Set(App.state.numericColumns);
    const totalPgs = Math.max(1, Math.ceil(result.total / result.limit));
    const page = Math.min(pageMap[w.id] ?? 0, totalPgs - 1);
    pageMap[w.id] = page;
    let html = '<div class="widget-table-wrap"><table class="widget-table"><thead><tr>';
    result.columns.forEach(col => { html += `<th>${escHtml(col)}</th>`; });
    html += '</tr></thead><tbody>';
    result.rows.forEach(row => {
      html += '<tr>';
      result.columns.forEach(col => {
        const cls = numCols.has(col) ? ' class="num"' : '';
        html += `<td${cls}>${escHtml(String(row[col] ?? ''))}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    if (totalPgs > 1) {
      html += `<div class="table-pagination">
        <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',0)" ${page===0?'disabled':''}><i class="fa-solid fa-angles-left"></i></button>
        <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',${page-1})" ${page===0?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>
        <span class="pag-info"><strong>${page+1}</strong> / ${totalPgs.toLocaleString('pt-BR')} <span class="pag-rows">(${result.offset+1}–${Math.min(result.offset+result.limit,result.total)} de ${result.total.toLocaleString('pt-BR')})</span></span>
        <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',${page+1})" ${page>=totalPgs-1?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>
        <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',${totalPgs-1})" ${page>=totalPgs-1?'disabled':''}><i class="fa-solid fa-angles-right"></i></button>
      </div>`;
    } else {
      html += `<p class="pag-summary">${result.total.toLocaleString('pt-BR')} linhas</p>`;
    }
    body.innerHTML = html;
  }

  function renderKPI(body, w, rows) {
    const cfg = w.config;
    const val = Charts.calcKPI(rows, cfg.column, cfg.kpiAgg);
    const fmt = val !== null ? Charts.formatValue(val, { valueFormat: cfg.valueFormat ?? 'number', valueDecimals: cfg.valueDecimals ?? cfg.decimals ?? 0, currency: cfg.currency ?? 'BRL' }) : '—';

    // Trend: mostra delta vs total quando filtro ou filtro cruzado está ativo
    let trendHTML = '';
    const hasFilter = App.state.activeFilter || App.state.crossFilter;
    if (hasFilter && val !== null) {
      const totalVal = Charts.calcKPI(App.state.rows, cfg.column, cfg.kpiAgg);
      if (totalVal && totalVal !== 0 && totalVal !== val) {
        const delta = ((val - totalVal) / Math.abs(totalVal)) * 100;
        const sign  = delta >= 0 ? '+' : '';
        const color = delta >= 0 ? 'var(--c-green)' : 'var(--c-red)';
        const icon  = delta >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
        trendHTML = `<div class="kpi-trend" style="color:${color}">
          <i class="fa-solid ${icon}"></i> ${sign}${delta.toFixed(1)}% vs total
        </div>`;
      }
    }

    const aggLabels = { sum: 'Soma', avg: 'Média', count: 'Contagem', max: 'Máximo', min: 'Mínimo' };
    body.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-value">${escHtml(cfg.prefix)}${fmt}${escHtml(cfg.suffix)}</div>
        <div class="kpi-label">${escHtml(cfg.column)}</div>
        ${trendHTML}
        <div class="kpi-sub">${aggLabels[cfg.kpiAgg] ?? ''} · ${rows.length} linhas</div>
      </div>
    `;
  }

  function renderTable(body, w, rows) {
    const cfg      = w.config;
    const cols     = (cfg.columns && cfg.columns.length) ? cfg.columns : App.state.columns.slice(0, 6);
    const rowLimit = cfg.rowLimit ?? 15;
    const numCols  = new Set(App.state.numericColumns);
    const total    = rows.length;
    const totalPgs = Math.max(1, Math.ceil(total / rowLimit));
    const page     = Math.min(pageMap[w.id] ?? 0, totalPgs - 1);
    const start    = page * rowLimit;
    const pageRows = rows.slice(start, start + rowLimit);

    let html = `<div class="widget-table-wrap"><table class="widget-table"><thead><tr>`;
    cols.forEach(c => { html += `<th>${escHtml(c)}</th>`; });
    html += `</tr></thead><tbody>`;

    pageRows.forEach(r => {
      html += '<tr>';
      cols.forEach(c => {
        const v   = r[c] ?? '';
        const cls = numCols.has(c) ? ' class="num"' : '';
        html += `<td${cls}>${escHtml(String(v))}</td>`;
      });
      html += '</tr>';
    });

    html += `</tbody></table></div>`;

    // Paginação
    if (totalPgs > 1) {
      html += `
        <div class="table-pagination">
          <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',0)" ${page===0?'disabled':''} title="Primeira">
            <i class="fa-solid fa-angles-left"></i>
          </button>
          <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',${page-1})" ${page===0?'disabled':''} title="Anterior">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="pag-info">
            <strong>${page+1}</strong> / ${totalPgs}
            <span class="pag-rows">(${start+1}–${Math.min(start+rowLimit,total)} de ${total})</span>
          </span>
          <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',${page+1})" ${page>=totalPgs-1?'disabled':''} title="Próxima">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
          <button class="pag-btn" onclick="Dashboard.goToPage('${w.id}',${totalPgs-1})" ${page>=totalPgs-1?'disabled':''} title="Última">
            <i class="fa-solid fa-angles-right"></i>
          </button>
        </div>`;
    } else {
      html += `<p class="pag-summary">${total} linhas</p>`;
    }

    body.innerHTML = html;
  }

  /* ── Navegar na paginação da tabela ─────── */
  async function goToPage(id, page) {
    const w = widgets.find(x => x.id === id);
    if (!w || w.type !== 'table') return;
    if (App.state.dataMode === 'query') {
      pageMap[id] = Math.max(0, page);
      await renderWidgetContent(w);
      return;
    }
    const rows     = App.getRows();
    const rowLimit = w.config.rowLimit ?? 15;
    const totalPgs = Math.max(1, Math.ceil(rows.length / rowLimit));
    pageMap[id] = Math.max(0, Math.min(page, totalPgs - 1));
    const body = document.getElementById(`wb_${id}`);
    if (body) renderTable(body, w, rows);
  }

  /* ── Sortable ────────────────────────────── */
  function initSortable() {
    const grid = document.getElementById('widgets-grid');
    if (sortable) { try { sortable.destroy(); } catch(_) {} }
    sortable = Sortable.create(grid, {
      animation: 220,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      fallbackClass: 'sortable-fallback',
      handle: '.widget-header',
      filter: '.widget-controls, .widget-controls *, .widget-resize-handle',
      preventOnFilter: false,
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: 4,
      swapThreshold: 0.62,
      invertSwap: true,
      invertedSwapThreshold: 0.72,
      scroll: true,
      scrollSensitivity: 90,
      scrollSpeed: 16,
      bubbleScroll: true,
      onChoose(evt) {
        evt.item.classList.add('is-picked-up');
      },
      onStart(evt) {
        grid.classList.add('is-dragging');
        document.body.classList.add('dashboard-dragging');
        evt.item.setAttribute('aria-grabbed', 'true');
      },
      onEnd(evt) {
        grid.classList.remove('is-dragging');
        document.body.classList.remove('dashboard-dragging');
        evt.item.classList.remove('is-picked-up');
        evt.item.setAttribute('aria-grabbed', 'false');
        const ids = [...grid.querySelectorAll('.widget')].map(el => el.dataset.id);
        widgets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        if (evt.oldIndex !== evt.newIndex) pushHistory();
      },
      onUnchoose(evt) {
        grid.classList.remove('is-dragging');
        document.body.classList.remove('dashboard-dragging');
        evt.item.classList.remove('is-picked-up');
        evt.item.setAttribute('aria-grabbed', 'false');
      },
    });
  }

  /* ── Modal de edição ─────────────────────── */
  function openEditModal(id) {
    editingId = id;
    const w = widgets.find(x => x.id === id);
    if (!w) return;

    const meta = TYPE_META[w.type] ?? { icon: 'fa-chart-bar', label: w.type };
    document.getElementById('modal-title').textContent = `Configurar — ${meta.label}`;
    document.getElementById('modal-type-icon').innerHTML = `<i class="fa-solid ${meta.icon}"></i>`;
    document.getElementById('modal-body').innerHTML = buildModalHTML(w);
    document.getElementById('modal-overlay').classList.add('open');
  }

  function buildModalHTML(w) {
    const st      = App.state;
    const cols    = st.columns;
    const numCols = st.numericColumns;
    const cfg     = w.config;

    const selCol = (arr, val, id, multi = false) => {
      if (!multi) {
        return `<select id="${id}" class="form-control">
          ${arr.map(c => `<option value="${escHtml(c)}" ${val === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>`;
      }
      const selected = Array.isArray(val) ? val : [];
      return `<div class="multi-check" id="${id}">
        ${arr.map(c => `<label class="check-item">
          <input type="checkbox" value="${escHtml(c)}" ${selected.includes(c) ? 'checked' : ''}>
          <span>${escHtml(c)}</span>
        </label>`).join('')}
      </div>`;
    };

    const sizeOpts = (cur) => ['sm','md','lg','full'].map((s, i) => {
      const labels = { sm: '¼ Pequeno', md: '½ Médio', lg: '¾ Grande', full: 'Completo' };
      return `<input type="radio" class="size-opt" name="w-size" id="sz${i}" value="${s}" ${cur===s?'checked':''}>
        <label class="size-opt-label" for="sz${i}">${labels[s]}</label>`;
    }).join('');

    const toggleRow = (id, label, checked) => `
      <label class="toggle-wrap">
        <span class="toggle"><input type="checkbox" id="${id}" ${checked?'checked':''}><span class="toggle-slider"></span></span>
        ${label}
      </label>`;

    const aggSelect = (id, val) => `
      <select id="${id}" class="form-control">
        ${[['sum','Soma'],['avg','Média'],['count','Contagem'],['max','Máximo'],['min','Mínimo']]
          .map(([v,l]) => `<option value="${v}" ${val===v?'selected':''}>${l}</option>`).join('')}
      </select>`;

    const limitSelect = (id, val) => `
      <select id="${id}" class="form-control">
        ${[5,10,15,20,30,50,100].map(n => `<option value="${n}" ${val===n||val==n?'selected':''}>${n}</option>`).join('')}
      </select>`;

    // ── Comum: título + tamanho
    let html = `
      <div class="form-section">
        <div class="form-section-title">Geral</div>
        <div class="form-grid">
          <div class="form-group full">
            <label class="form-label">Título</label>
            <input id="w-title" class="form-control" type="text" value="${escHtml(w.title)}" placeholder="Título do widget">
          </div>
          <div class="form-group full">
            <label class="form-label">Tamanho</label>
            <div class="size-picker">${sizeOpts(w.size)}</div>
          </div>
        </div>
      </div>
    `;

    // ── Texto / Markdown
    if (w.type === 'text') {
      html += `
        <div class="form-section">
          <div class="form-section-title">Conteúdo Markdown</div>
          <div class="form-group full">
            <textarea id="w-text-content" class="form-control markdown-editor" rows="11" placeholder="# Título">${escHtml(cfg.content ?? '')}</textarea>
            <div class="markdown-help"><strong>Markdown:</strong> # título, **negrito**, *itálico*, código, listas e [links](https://...)</div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Tipografia e cores</div>
          <div class="form-grid">
            <div class="form-group"><label class="form-label">Fonte</label>
              <select id="w-text-font" class="form-control">
                <option value="system" ${cfg.fontFamily==='system'?'selected':''}>Sistema</option>
                <option value="serif" ${cfg.fontFamily==='serif'?'selected':''}>Serifada</option>
                <option value="modern" ${cfg.fontFamily==='modern'?'selected':''}>Arial</option>
                <option value="mono" ${cfg.fontFamily==='mono'?'selected':''}>Monoespaçada</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Tamanho da fonte</label><input id="w-text-size" class="form-control" type="number" min="10" max="72" value="${cfg.fontSize ?? 16}"></div>
            <div class="form-group"><label class="form-label">Alinhamento</label>
              <select id="w-text-align" class="form-control">
                <option value="left" ${cfg.align==='left'?'selected':''}>Esquerda</option>
                <option value="center" ${cfg.align==='center'?'selected':''}>Centro</option>
                <option value="right" ${cfg.align==='right'?'selected':''}>Direita</option>
                <option value="justify" ${cfg.align==='justify'?'selected':''}>Justificado</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Espaçamento entre linhas</label><input id="w-text-line-height" class="form-control" type="number" min="1" max="2.5" step="0.1" value="${cfg.lineHeight ?? 1.6}"></div>
            <div class="form-group"><label class="form-label">Cor do texto</label><input id="w-text-color" class="form-control color-control" type="color" value="${escHtml(cfg.color ?? '#334155')}"></div>
            <div class="form-group"><label class="form-label">Cor do fundo</label><input id="w-text-bg" class="form-control color-control" type="color" value="${escHtml(cfg.background ?? '#ffffff')}"></div>
          </div>
        </div>`;
      return html;
    }

    // ── KPI
    if (w.type === 'kpi') {
      html += `
        <div class="form-section">
          <div class="form-section-title">Indicador</div>
          <div class="form-grid">
            <div class="form-group full">
              <label class="form-label">Coluna numérica</label>
              ${selCol(numCols, cfg.column, 'w-kpi-col')}
            </div>
            <div class="form-group">
              <label class="form-label">Agregação</label>
              ${aggSelect('w-kpi-agg', cfg.kpiAgg)}
            </div>
            <div class="form-group"><label class="form-label">Formato</label>
              <select id="w-value-format" class="form-control">
                <option value="number" ${(cfg.valueFormat??'number')==='number'?'selected':''}>Número</option>
                <option value="compact" ${cfg.valueFormat==='compact'?'selected':''}>Compacto (1,2 mi)</option>
                <option value="currency" ${cfg.valueFormat==='currency'?'selected':''}>Moeda</option>
                <option value="percent" ${cfg.valueFormat==='percent'?'selected':''}>Percentual</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Casas decimais</label>
              <select id="w-decimals" class="form-control">
                ${[0,1,2,3,4].map(n => `<option value="${n}" ${(cfg.valueDecimals??cfg.decimals??0)==n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label class="form-label">Moeda</label>
              <select id="w-currency" class="form-control">${['BRL','USD','EUR'].map(code => `<option value="${code}" ${(cfg.currency??'BRL')===code?'selected':''}>${code}</option>`).join('')}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Prefixo <em>(ex: R$)</em></label>
              <input id="w-prefix" class="form-control" type="text" value="${escHtml(cfg.prefix??'')}" placeholder="R$">
            </div>
            <div class="form-group">
              <label class="form-label">Sufixo <em>(ex: %)</em></label>
              <input id="w-suffix" class="form-control" type="text" value="${escHtml(cfg.suffix??'')}" placeholder="%">
            </div>
          </div>
        </div>`;
      return html;
    }

    // ── Tabela
    if (w.type === 'table') {
      html += `
        <div class="form-section">
          <div class="form-section-title">Colunas a exibir</div>
          ${selCol(cols, cfg.columns??[], 'w-tbl-cols', true)}
        </div>
        <div class="form-section">
          <div class="form-section-title">Limite de linhas</div>
          ${limitSelect('w-tbl-limit', cfg.rowLimit??15)}
        </div>`;
      return html;
    }

    // ── Scatter
    if (w.type === 'scatter') {
      html += `
        <div class="form-section">
          <div class="form-section-title">Eixos</div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Eixo X (numérico)</label>
              ${selCol(numCols, cfg.xColumn, 'w-xcol')}
            </div>
            <div class="form-group">
              <label class="form-label">Eixo Y (numérico)</label>
              ${selCol(numCols, cfg.yColumns?.[0]??'', 'w-ycol-single')}
            </div>
            <div class="form-group">
              <label class="form-label">Limite de pontos</label>
              ${limitSelect('w-limit', cfg.limit??100)}
            </div>
          </div>
        </div>`;
      return html;
    }

    // ── Bar, Line, Area, Pie, Doughnut
    const isRound = ['pie','doughnut'].includes(w.type);
    html += `
      <div class="form-section">
        <div class="form-section-title">${isRound ? 'Dados' : 'Eixos'}</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">${isRound ? 'Coluna de rótulos' : 'Eixo X (categorias)'}</label>
            ${selCol(cols, cfg.xColumn, 'w-xcol')}
          </div>
          <div class="form-group">
            <label class="form-label">Agregação</label>
            ${aggSelect('w-agg', cfg.aggregation)}
          </div>
          <div class="form-group">
            <label class="form-label">Agrupar datas</label>
            <select id="w-date-group" class="form-control">
              <option value="none" ${(cfg.dateGroup??'none')==='none'?'selected':''}>Sem agrupamento</option>
              <option value="day" ${cfg.dateGroup==='day'?'selected':''}>Dia</option>
              <option value="week" ${cfg.dateGroup==='week'?'selected':''}>Semana</option>
              <option value="month" ${cfg.dateGroup==='month'?'selected':''}>Mês</option>
              <option value="quarter" ${cfg.dateGroup==='quarter'?'selected':''}>Trimestre</option>
              <option value="year" ${cfg.dateGroup==='year'?'selected':''}>Ano</option>
            </select>
          </div>
          <div class="form-group full">
            <label class="form-label">${isRound ? 'Coluna de valores' : 'Eixo Y — colunas numéricas'} <em>${isRound ? '(escolha uma)' : '(pode selecionar mais de uma)'}</em></label>
            ${isRound
              ? selCol(numCols, cfg.yColumns?.[0]??'', 'w-ycol-single')
              : selCol(numCols, cfg.yColumns??[], 'w-ycols', true)}
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Filtros e ordenação</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Limite de itens</label>
            ${limitSelect('w-limit', cfg.limit)}
          </div>
          <div class="form-group">
            <label class="form-label">Ordenar por</label>
            <select id="w-sortby" class="form-control">
              <option value="value" ${cfg.sortBy==='value'?'selected':''}>Valor</option>
              <option value="label" ${cfg.sortBy==='label'?'selected':''}>Rótulo</option>
              <option value="none"  ${cfg.sortBy==='none' ?'selected':''}>Original</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Direção</label>
            <select id="w-sortdir" class="form-control">
              <option value="desc" ${cfg.sortDir==='desc'?'selected':''}>Decrescente</option>
              <option value="asc"  ${cfg.sortDir==='asc' ?'selected':''}>Crescente</option>
            </select>
          </div>
          <div class="form-group full">
            ${toggleRow('w-others', 'Agrupar itens excedentes como “Outros” (soma/contagem)', cfg.showOthers ?? false)}
          </div>
        </div>
      </div>
      <div class="form-section">
        <div class="form-section-title">Formato dos valores</div>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Formato</label>
            <select id="w-value-format" class="form-control">
              <option value="number" ${(cfg.valueFormat??'number')==='number'?'selected':''}>Número</option>
              <option value="compact" ${cfg.valueFormat==='compact'?'selected':''}>Compacto (1,2 mi)</option>
              <option value="currency" ${cfg.valueFormat==='currency'?'selected':''}>Moeda</option>
              <option value="percent" ${cfg.valueFormat==='percent'?'selected':''}>Percentual</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Casas decimais</label>
            <select id="w-value-decimals" class="form-control">${[0,1,2,3,4].map(n => `<option value="${n}" ${(cfg.valueDecimals??0)==n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label class="form-label">Moeda</label>
            <select id="w-currency" class="form-control">${['BRL','USD','EUR'].map(code => `<option value="${code}" ${(cfg.currency??'BRL')===code?'selected':''}>${code}</option>`).join('')}</select>
          </div>
        </div>
      </div>`;

    if (!isRound) {
      html += `
        <div class="form-section">
          <div class="form-section-title">Exibição</div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;">
            ${toggleRow('w-legend', 'Mostrar legenda', cfg.showLegend ?? true)}
            ${toggleRow('w-grid', 'Mostrar grade', cfg.showGrid ?? true)}
          </div>
        </div>`;
    }

    return html;
  }

  /* ── Salvar widget (vindo do modal) ─────── */
  async function saveWidget() {
    const w = widgets.find(x => x.id === editingId);
    if (!w) return;

    w.title = document.getElementById('w-title')?.value.trim() || w.title;
    w.size  = document.querySelector('input[name="w-size"]:checked')?.value ?? w.size;

    if (w.type === 'text') {
      w.config.content = document.getElementById('w-text-content')?.value ?? '';
      w.config.fontFamily = document.getElementById('w-text-font')?.value ?? 'system';
      w.config.fontSize = Math.max(10, Math.min(72, parseInt(document.getElementById('w-text-size')?.value ?? '16')));
      w.config.align = document.getElementById('w-text-align')?.value ?? 'left';
      w.config.lineHeight = Math.max(1, Math.min(2.5, parseFloat(document.getElementById('w-text-line-height')?.value ?? '1.6')));
      w.config.color = document.getElementById('w-text-color')?.value ?? '#334155';
      w.config.background = document.getElementById('w-text-bg')?.value ?? '#ffffff';
    } else if (w.type === 'kpi') {
      w.config.column   = document.getElementById('w-kpi-col')?.value   ?? w.config.column;
      w.config.kpiAgg   = document.getElementById('w-kpi-agg')?.value   ?? w.config.kpiAgg;
      w.config.decimals = parseInt(document.getElementById('w-decimals')?.value ?? '0');
      w.config.valueDecimals = w.config.decimals;
      w.config.valueFormat = document.getElementById('w-value-format')?.value ?? 'number';
      w.config.currency = document.getElementById('w-currency')?.value ?? 'BRL';
      w.config.prefix   = document.getElementById('w-prefix')?.value    ?? '';
      w.config.suffix   = document.getElementById('w-suffix')?.value    ?? '';
    } else if (w.type === 'table') {
      w.config.columns  = [...document.querySelectorAll('#w-tbl-cols input:checked')].map(i => i.value);
      w.config.rowLimit = parseInt(document.getElementById('w-tbl-limit')?.value ?? '15');
    } else if (w.type === 'scatter') {
      w.config.xColumn  = document.getElementById('w-xcol')?.value ?? w.config.xColumn;
      w.config.yColumns = [document.getElementById('w-ycol-single')?.value ?? ''];
      w.config.limit    = parseInt(document.getElementById('w-limit')?.value ?? '100');
    } else {
      w.config.xColumn = document.getElementById('w-xcol')?.value ?? w.config.xColumn;
      w.config.aggregation = document.getElementById('w-agg')?.value ?? 'sum';
      w.config.limit   = parseInt(document.getElementById('w-limit')?.value ?? '15');
      w.config.sortBy  = document.getElementById('w-sortby')?.value  ?? 'value';
      w.config.sortDir = document.getElementById('w-sortdir')?.value ?? 'desc';
      w.config.dateGroup = document.getElementById('w-date-group')?.value ?? 'none';
      w.config.showOthers = document.getElementById('w-others')?.checked ?? false;
      w.config.valueFormat = document.getElementById('w-value-format')?.value ?? 'number';
      w.config.valueDecimals = parseInt(document.getElementById('w-value-decimals')?.value ?? '0');
      w.config.currency = document.getElementById('w-currency')?.value ?? 'BRL';

      const isRound = ['pie','doughnut'].includes(w.type);
      if (isRound) {
        w.config.yColumns = [document.getElementById('w-ycol-single')?.value ?? ''];
      } else {
        w.config.yColumns = [...document.querySelectorAll('#w-ycols input:checked')].map(i => i.value);
        w.config.showLegend = document.getElementById('w-legend')?.checked ?? true;
        w.config.showGrid   = document.getElementById('w-grid')?.checked ?? true;
      }
    }

    // Atualiza tamanho no DOM
    const el = document.querySelector(`[data-id="${w.id}"]`);
    if (el) {
      el.className = el.className.replace(/sz-\w+/, '').trim() + ` sz-${w.size}`;
      el.querySelector('.widget-title').innerHTML =
        `<i class="fa-solid fa-grip-vertical widget-grip" aria-hidden="true"></i><i class="fa-solid ${TYPE_META[w.type]?.icon ?? 'fa-chart-bar'}" style="margin-right:6px;opacity:.5;font-size:11px;"></i>${escHtml(w.title)}`;
    }

    await renderWidgetContent(w);
    pushHistory();
    App.closeModal();
    App.toast('Widget atualizado!', 'success');
  }

  /* ── Remover ─────────────────────────────── */
  function deleteWidget(id) {
    if (chartMap[id]) { try { chartMap[id].destroy(); } catch(_) {} delete chartMap[id]; }
    widgets = widgets.filter(w => w.id !== id);
    document.querySelector(`[data-id="${id}"]`)?.remove();
    updatePlaceholder();
    pushHistory();
  }

  /* ── Duplicar ────────────────────────────── */
  function duplicateWidget(id) {
    const orig = widgets.find(w => w.id === id);
    if (!orig) return;
    const clone = JSON.parse(JSON.stringify(orig));
    clone.id    = 'w_' + Date.now();
    clone.title = clone.title + ' (cópia)';
    widgets.push(clone);
    renderWidget(clone);
    initSortable();
    updatePlaceholder();
    pushHistory();
    App.toast('Widget duplicado!');
  }

  /* ── Limpar tudo ─────────────────────────── */
  function clearAll() {
    if (!widgets.length) return;
    if (!confirm('Remover todos os widgets do dashboard?')) return;
    widgets = [];
    Object.values(chartMap).forEach(c => { try { c.destroy(); } catch(_) {} });
    for (const k in chartMap) delete chartMap[k];
    document.getElementById('widgets-grid').innerHTML = '';
    updatePlaceholder();
    pushHistory();
  }

  function updatePlaceholder() {
    const empty = document.getElementById('canvas-empty');
    const canvas = document.getElementById('dash-canvas');
    if (empty) empty.classList.toggle('hidden', widgets.length > 0);
    if (canvas) canvas.classList.toggle('has-widgets', widgets.length > 0);
  }

  /* ── Serialização ────────────────────────── */
  function serialize() {
    return {
      title:  document.getElementById('dash-title')?.value ?? 'Meu Dashboard',
      theme:  Charts.getTheme(),
      bg:     document.getElementById('dash-canvas')?.dataset.bg ?? '',
      widgets: widgets,
    };
  }

  async function load(data) {
    document.getElementById('dash-title').value = data.title ?? 'Dashboard';
    if (data.theme) Charts.setTheme(data.theme);
    if (data.bg) {
      const canvas = document.getElementById('dash-canvas');
      canvas.style.background = data.bg;
      canvas.dataset.bg = data.bg;
    }
    widgets = data.widgets ?? [];
    historyStack.length = 0;
    historyPos = -1;
    await renderAll();
    pushHistory();
    App.renderThemePicker();
    App.renderBgPicker();
  }

  function getWidgets() { return widgets; }

  async function generateSuggestedDashboard() {
    const st = App.state;
    if (!st.columns.length || !st.numericColumns.length) { App.toast('Carregue dados com ao menos uma coluna numérica.', 'error'); return; }
    if (widgets.length && !confirm('Substituir os widgets atuais pelas sugestões automáticas?')) return;
    const numCols = st.numericColumns;
    const strCols = st.stringColumns;
    const dateCols = st.columns.filter(col => (st.columnConfig[col] ?? st.columnTypes[col]) === 'date');
    const category = strCols.find(col => !dateCols.includes(col)) ?? strCols[0] ?? st.columns[0];
    const metric = numCols[0];
    let seq = Date.now();
    const make = (type, title, size, config) => ({ id: 'w_' + seq++, type, title, size, config });
    const suggested = [];
    numCols.slice(0, 2).forEach(col => suggested.push(make('kpi', col, 'sm', { column: col, kpiAgg: 'sum', prefix: '', suffix: '', decimals: 0, valueFormat: 'compact', valueDecimals: 1, currency: 'BRL', iconClass: 'fa-gauge-high' })));
    if (dateCols.length) suggested.push(make('line', metric + ' por período', 'full', { ...defaultConfig('line', st.columns, numCols, strCols), xColumn: dateCols[0], yColumns: [metric], dateGroup: 'month', limit: 30, sortBy: 'label', sortDir: 'asc', valueFormat: 'compact', valueDecimals: 1 }));
    if (category) {
      suggested.push(make('bar', 'Top ' + category + ' por ' + metric, 'md', { ...defaultConfig('bar', st.columns, numCols, strCols), xColumn: category, yColumns: [metric], limit: 10, showOthers: true, valueFormat: 'compact', valueDecimals: 1 }));
      suggested.push(make('doughnut', 'Participação por ' + category, 'md', { ...defaultConfig('doughnut', st.columns, numCols, strCols), xColumn: category, yColumns: [metric], limit: 8, showOthers: true, valueFormat: 'compact', valueDecimals: 1 }));
    }
    suggested.push(make('table', 'Detalhamento dos dados', 'full', { columns: st.columns.slice(0, 8), rowLimit: 15 }));
    widgets = suggested;
    historyStack.length = 0; historyPos = -1;
    await renderAll(); pushHistory(); App.renderColumnsList();
    App.toast('Dashboard sugerido com base nos tipos das colunas.', 'success');
  }

  return {
    addWidget, renderAll, renderWidget,
    openEditModal, saveWidget,
    deleteWidget, duplicateWidget, clearAll,
    resizeWidget, startResize, goToPage,
    prepareForPDFExport, restoreAfterPDFExport,
    serialize, load, getWidgets, generateSuggestedDashboard,
    updatePlaceholder,
    undo, redo, resetHistory,
  };
})();

/* helper global */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
