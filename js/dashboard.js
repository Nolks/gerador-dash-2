/* ─────────────────────────────────────────────
   dashboard.js — Gerenciamento de widgets
───────────────────────────────────────────── */
const Dashboard = (() => {

  let widgets    = [];
  let editingId  = null;
  let pages = [
    { id: 'page_1', name: 'Página 1', icon: 'fa-chart-pie', widgets: [] },
  ];
  let activePageIndex = 0;
  let editingPageIndex = 0;
  const chartMap = {};   // widgetId → Chart instance
  const pageMap  = {};   // widgetId → página atual da tabela
  const renderVersion = {};
  let layoutEventsReady = false;

  /* ── Histórico para Undo/Redo ────────────── */
  const historyStack = [];
  let historyPos     = -1;
  const MAX_HISTORY  = 25;

  function pushHistory() {
    syncCurrentPage();
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
    syncCurrentPage();
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
  const SIZE_RATIOS = { sm: 0.25, md: 0.5, lg: 0.75, full: 1 };
  const LAYOUT_GAP = 20;
  const MIN_WIDGET_WIDTH = 260;
  const MIN_WIDGET_HEIGHT = 140;
  const MAX_WIDGET_HEIGHT = 1200;
  const MAX_PAGES = 5;

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
    filter:   { icon: 'fa-filter',      label: 'Filtros' },
    image:    { icon: 'fa-image',       label: 'Imagem / Logo' },
    button:   { icon: 'fa-link',        label: 'Botão' },
  };

  const TITLE_ICONS = [
    { value: 'auto', icon: 'fa-wand-magic-sparkles', label: 'Automático' },
    { value: 'none', icon: 'fa-ban', label: 'Sem ícone' },
    { value: 'fa-chart-column', icon: 'fa-chart-column', label: 'Gráfico' },
    { value: 'fa-coins', icon: 'fa-coins', label: 'Valores' },
    { value: 'fa-dollar-sign', icon: 'fa-dollar-sign', label: 'Financeiro' },
    { value: 'fa-users', icon: 'fa-users', label: 'Pessoas' },
    { value: 'fa-user', icon: 'fa-user', label: 'Usuário' },
    { value: 'fa-calendar-days', icon: 'fa-calendar-days', label: 'Calendário' },
    { value: 'fa-clock', icon: 'fa-clock', label: 'Tempo' },
    { value: 'fa-bullseye', icon: 'fa-bullseye', label: 'Meta' },
    { value: 'fa-trophy', icon: 'fa-trophy', label: 'Resultado' },
    { value: 'fa-cart-shopping', icon: 'fa-cart-shopping', label: 'Vendas' },
    { value: 'fa-briefcase', icon: 'fa-briefcase', label: 'Negócios' },
    { value: 'fa-building', icon: 'fa-building', label: 'Empresa' },
    { value: 'fa-globe', icon: 'fa-globe', label: 'Global' },
    { value: 'fa-location-dot', icon: 'fa-location-dot', label: 'Localização' },
    { value: 'fa-database', icon: 'fa-database', label: 'Dados' },
    { value: 'fa-bolt', icon: 'fa-bolt', label: 'Destaque' },
    { value: 'fa-star', icon: 'fa-star', label: 'Favorito' },
    { value: 'fa-circle-check', icon: 'fa-circle-check', label: 'Concluído' },
    { value: 'fa-triangle-exclamation', icon: 'fa-triangle-exclamation', label: 'Alerta' },
    { value: 'fa-lightbulb', icon: 'fa-lightbulb', label: 'Insight' },
  ];
  const PAGE_ICONS = TITLE_ICONS.filter(item => !['auto', 'none'].includes(item.value));
  const BUTTON_ICONS = [
    { value: 'none', icon: 'fa-ban', label: 'Sem ícone' },
    { value: 'fa-arrow-right', icon: 'fa-arrow-right', label: 'Avançar' },
    { value: 'fa-arrow-left', icon: 'fa-arrow-left', label: 'Voltar' },
    { value: 'fa-link', icon: 'fa-link', label: 'Link' },
    { value: 'fa-up-right-from-square', icon: 'fa-up-right-from-square', label: 'Externo' },
    { value: 'fa-house', icon: 'fa-house', label: 'Início' },
    ...PAGE_ICONS,
  ];

  function resolveTitleIcon(widget) {
    const selected = widget.config?.titleIcon ?? 'auto';
    if (selected === 'none') return '';
    if (selected === 'auto') return TYPE_META[widget.type]?.icon ?? 'fa-chart-bar';
    return TITLE_ICONS.some(item => item.value === selected) ? selected : TYPE_META[widget.type]?.icon ?? 'fa-chart-bar';
  }

  function widgetTitleHTML(widget) {
    const icon = resolveTitleIcon(widget);
    return `<i class="fa-solid fa-grip-vertical widget-grip" aria-hidden="true"></i>` +
      (icon ? `<i class="fa-solid ${icon} widget-title-icon" aria-hidden="true"></i>` : '') +
      `<span class="widget-title-text">${escHtml(widget.title)}</span>`;
  }

  /* ── Defaults por tipo ───────────────────── */
  function defaultConfig(type, cols, numCols, strCols) {
    const xCol  = strCols[0]  ?? cols[0] ?? '';
    const yCol  = numCols[0]  ?? '';
    const yCols = numCols.slice(0, 1);

    const base = {
      titleIcon: 'auto',
      xColumn: xCol, yColumns: yCols,
      aggregation: 'sum', limit: 15,
      sortBy: 'value', sortDir: 'desc',
      dateGroup: 'none', showOthers: false,
      valueFormat: 'number', valueDecimals: 0, percentScale: 'direct', currency: 'BRL',
      showLegend: true, showGrid: true,
    };

    if (type === 'text') return {
      titleIcon: 'auto',
      content: '# Título do texto\n\nEscreva **parágrafos**, listas e outros elementos em Markdown.',
      fontSize: 16, fontFamily: 'system', color: '#334155', align: 'left',
      lineHeight: 1.6, background: '#ffffff',
    };
    if (type === 'filter') return {
      titleIcon: 'auto',
      columns: cols.slice(0, Math.min(5, cols.length)),
      orientation: 'vertical',
    };
    if (type === 'image') return {
      titleIcon: 'none',
      source: '',
      alt: 'Imagem',
      fit: 'contain',
      height: 220,
      background: '#ffffff',
    };
    if (type === 'button') return {
      titleIcon: 'none',
      label: 'Abrir página',
      destinationType: 'page',
      pageId: pages[0]?.id ?? '',
      url: 'https://',
      icon: 'fa-arrow-right',
      background: '#6366f1',
      textColor: '#ffffff',
      fontFamily: 'system',
      fontSize: 16,
      align: 'center',
      fullWidth: false,
    };
    if (type === 'kpi')     return { titleIcon: 'auto', column: yCol, kpiAgg: 'sum', prefix: '', suffix: '', decimals: 0, valueFormat: 'number', valueDecimals: 0, percentScale: 'direct', currency: 'BRL', iconClass: 'fa-gauge-high' };
    if (type === 'table')   return { titleIcon: 'auto', columns: cols.slice(0, 6), rowLimit: 15 };
    if (type === 'scatter') return { titleIcon: 'auto', xColumn: numCols[0] ?? '', yColumns: [numCols[1] ?? numCols[0] ?? ''], limit: 100, showLegend: false };
    if (['pie','doughnut'].includes(type)) return { ...base, limit: 10 };
    return base;
  }

  /* ── Adicionar widget ────────────────────── */
  function addWidget(type) {
    const st   = App.state;
    const cols = st.columns;
    if (!['text', 'image', 'button'].includes(type) && !cols.length) { App.toast('Nenhum dado carregado.', 'error'); return; }

    const numCols = st.numericColumns;
    const strCols = st.stringColumns;
    const id      = 'w_' + Date.now();
    const size    = ['kpi', 'button'].includes(type) ? 'sm' : type === 'table' ? 'lg' : type === 'filter' ? 'sm' : 'md';

    const w = {
      id, type,
      title: TYPE_META[type]?.label ?? type,
      size,
      config: defaultConfig(type, cols, numCols, strCols),
    };

    widgets.push(w);
    placeNewWidget(w);
    renderWidget(w);
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
    ensureWidgetLayouts();
    await Promise.all(widgets.map(w => renderWidget(w)));
    updatePlaceholder();
    updateCanvasBounds();
    initLayoutEvents();
    renderPageNav();
  }

  /* ── Renderizar widget ───────────────────── */
  function renderWidget(w) {
    const grid = document.getElementById('widgets-grid');
    const el   = document.createElement('div');
    el.className = `widget sz-${w.size}${w.type === 'button' ? ' widget-button-floating' : ''}`;
    el.dataset.id = w.id;
    applyWidgetLayout(w, el);

    el.innerHTML = `
      <div class="widget-header" onpointerdown="Dashboard.startDrag(event, '${w.id}')">
        <div class="widget-title widget-drag" title="Arraste para reposicionar: ${escHtml(w.title)}">
          ${widgetTitleHTML(w)}
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
      <div class="widget-resize-handle" onpointerdown="Dashboard.startResize(event, '${w.id}')" title="Arraste na diagonal para alterar largura e altura">
        <i class="fa-solid fa-grip-lines-vertical"></i>
      </div>
    `;

    grid.appendChild(el);
    const rendered = renderWidgetContent(w);
    Promise.resolve(rendered).finally(updateCanvasBounds);
    return rendered;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getGridWidth() {
    return Math.max(0, document.getElementById('widgets-grid')?.clientWidth ?? 0);
  }

  function widthForSize(size, gridWidth = getGridWidth()) {
    const ratio = SIZE_RATIOS[size] ?? SIZE_RATIOS.md;
    return clamp(Math.round(gridWidth * ratio - LAYOUT_GAP * (1 - ratio)), Math.min(MIN_WIDGET_WIDTH, gridWidth), gridWidth);
  }

  function estimatedWidgetHeight(widget) {
    if (widget.type === 'kpi') return 190;
    if (widget.type === 'button') return 170;
    if (widget.type === 'text') return 240;
    if (widget.type === 'filter') {
      const fieldCount = Math.max(1, widget.config?.columns?.length ?? 1);
      return widget.config?.orientation === 'horizontal' ? 230 : Math.min(620, 130 + fieldCount * 66);
    }
    if (widget.type === 'image') return Math.max(180, Math.min(860, (Number(widget.config?.height) || 220) + 58));
    if (widget.type === 'table') return 480;
    return 390;
  }

  function minHeightForWidget(widget) {
    if (widget.type === 'kpi') return 150;
    if (widget.type === 'button') return 120;
    if (widget.type === 'filter') return 170;
    if (widget.type === 'table') return 220;
    if (['bar', 'line', 'area', 'pie', 'doughnut', 'scatter'].includes(widget.type)) return 240;
    return MIN_WIDGET_HEIGHT;
  }

  function ensureWidgetLayouts() {
    const gridWidth = getGridWidth();
    if (!gridWidth) return;
    let cursorX = 0;
    let cursorY = 0;
    let rowHeight = 0;

    widgets.forEach(widget => {
      if (widget.layout && Number.isFinite(widget.layout.x) && Number.isFinite(widget.layout.y) && Number.isFinite(widget.layout.width)) {
        widget.layout.width = clamp(widget.layout.width, Math.min(MIN_WIDGET_WIDTH, gridWidth), gridWidth);
        widget.layout.height = clamp(
          Number.isFinite(widget.layout.height) ? widget.layout.height : estimatedWidgetHeight(widget),
          minHeightForWidget(widget),
          MAX_WIDGET_HEIGHT
        );
        widget.layout.x = clamp(widget.layout.x, 0, Math.max(0, gridWidth - widget.layout.width));
        widget.layout.y = Math.max(0, widget.layout.y);
        return;
      }

      const width = widthForSize(widget.size, gridWidth);
      if (cursorX > 0 && cursorX + width > gridWidth) {
        cursorX = 0;
        cursorY += rowHeight + LAYOUT_GAP;
        rowHeight = 0;
      }
      const height = estimatedWidgetHeight(widget);
      widget.layout = { x: cursorX, y: cursorY, width, height };
      cursorX += width + LAYOUT_GAP;
      rowHeight = Math.max(rowHeight, height);
    });
  }

  function placeNewWidget(widget) {
    const gridWidth = getGridWidth();
    if (!gridWidth) return;
    const width = widthForSize(widget.size, gridWidth);
    const bottom = widgets
      .filter(item => item !== widget && item.layout)
      .reduce((max, item) => {
        return Math.max(max, item.layout.y + (item.layout.height || estimatedWidgetHeight(item)));
      }, 0);
    widget.layout = {
      x: 0,
      y: bottom ? bottom + LAYOUT_GAP : 0,
      width,
      height: estimatedWidgetHeight(widget),
    };
  }

  function applyWidgetLayout(widget, element = document.querySelector(`[data-id="${widget.id}"]`)) {
    if (!element || !widget.layout) return;
    element.style.left = `${Math.round(widget.layout.x)}px`;
    element.style.top = `${Math.round(widget.layout.y)}px`;
    element.style.width = `${Math.round(widget.layout.width)}px`;
    element.style.height = `${Math.round(widget.layout.height || estimatedWidgetHeight(widget))}px`;
  }

  function updateCanvasBounds() {
    const grid = document.getElementById('widgets-grid');
    if (!grid) return;
    if (window.matchMedia('(max-width: 768px)').matches) {
      grid.style.height = 'auto';
      return;
    }
    let bottom = MIN_WIDGET_HEIGHT;
    grid.querySelectorAll(':scope > .widget').forEach(element => {
      const widget = widgets.find(item => item.id === element.dataset.id);
      if (!widget?.layout) return;
      bottom = Math.max(bottom, widget.layout.y + (widget.layout.height || element.offsetHeight));
    });
    grid.style.height = `${Math.ceil(bottom + LAYOUT_GAP)}px`;
  }

  function updateSizeButton(widget, element = document.querySelector(`[data-id="${widget.id}"]`)) {
    const button = element?.querySelector('.resize-btn');
    if (!button) return;
    button.title = `Tamanho: ${widget.size}`;
    button.dataset.size = widget.size;
    button.querySelector('.size-label').textContent = SIZE_LABELS[widget.size] ?? '½';
  }

  function syncSizeFromWidth(widget) {
    const gridWidth = getGridWidth();
    if (!gridWidth) return;
    const ratio = widget.layout.width / gridWidth;
    widget.size = SIZES.reduce((closest, size) =>
      Math.abs(SIZE_RATIOS[size] - ratio) < Math.abs(SIZE_RATIOS[closest] - ratio) ? size : closest
    , 'md');
  }

  function initLayoutEvents() {
    if (layoutEventsReady) return;
    layoutEventsReady = true;
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const gridWidth = getGridWidth();
        if (!gridWidth) return;
        widgets.forEach(widget => {
          if (!widget.layout) return;
          widget.layout.width = clamp(widget.layout.width, Math.min(MIN_WIDGET_WIDTH, gridWidth), gridWidth);
          widget.layout.x = clamp(widget.layout.x, 0, Math.max(0, gridWidth - widget.layout.width));
          applyWidgetLayout(widget);
        });
        updateCanvasBounds();
      }, 100);
    });
  }

  /* ── Movimento livre pelo cabeçalho ─────── */
  function startDrag(e, id) {
    if (e.button !== 0 || e.target.closest('.widget-controls')) return;
    const element = document.querySelector(`[data-id="${id}"]`);
    const widget = widgets.find(item => item.id === id);
    const grid = document.getElementById('widgets-grid');
    const canvas = document.getElementById('dash-canvas');
    if (!element || !widget?.layout || !grid) return;

    e.preventDefault();
    const header = e.currentTarget;
    const origin = { ...widget.layout };
    const pointer = { x: e.clientX, y: e.clientY };
    let moved = false;

    element.classList.add('dragging-free');
    grid.classList.add('is-dragging');
    document.body.classList.add('dashboard-dragging');
    header.setPointerCapture?.(e.pointerId);

    function onMove(event) {
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const maxX = Math.max(0, grid.clientWidth - widget.layout.width);
      widget.layout.x = clamp(origin.x + dx, 0, maxX);
      widget.layout.y = Math.max(0, origin.y + dy);
      moved ||= Math.abs(dx) > 2 || Math.abs(dy) > 2;
      applyWidgetLayout(widget, element);
      updateCanvasBounds();

      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        if (event.clientY > rect.bottom - 45) canvas.scrollTop += 14;
        else if (event.clientY < rect.top + 45) canvas.scrollTop -= 14;
      }
    }

    function finish(event, cancelled = false) {
      if (cancelled) {
        widget.layout = origin;
        applyWidgetLayout(widget, element);
      }
      element.classList.remove('dragging-free');
      grid.classList.remove('is-dragging');
      document.body.classList.remove('dashboard-dragging');
      header.releasePointerCapture?.(event.pointerId);
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onUp);
      header.removeEventListener('pointercancel', onCancel);
      updateCanvasBounds();
      if (!cancelled && moved) pushHistory();
    }

    function onUp(event) { finish(event); }
    function onCancel(event) { finish(event, true); }

    header.addEventListener('pointermove', onMove);
    header.addEventListener('pointerup', onUp);
    header.addEventListener('pointercancel', onCancel);
  }

  /* ── Resize por botão (ciclo de tamanhos) ── */
  function resizeWidget(id) {
    const w = widgets.find(x => x.id === id);
    if (!w) return;
    const idx = SIZES.indexOf(w.size);
    w.size = SIZES[(idx + 1) % SIZES.length];

    const el = document.querySelector(`[data-id="${id}"]`);
    const gridWidth = getGridWidth();
    w.layout ??= { x: 0, y: 0, width: widthForSize(w.size, gridWidth), height: estimatedWidgetHeight(w) };
    w.layout.width = widthForSize(w.size, gridWidth);
    w.layout.x = clamp(w.layout.x, 0, Math.max(0, gridWidth - w.layout.width));
    applyWidgetLayout(w, el);
    updateSizeButton(w, el);
    updateCanvasBounds();
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
    if (!el || !w?.layout) return;

    const grid = document.getElementById('widgets-grid');
    const handle = e.currentTarget;
    const originalLayout = { ...w.layout };
    const originalSize = w.size;
    const startX = e.clientX;
    const startY = e.clientY;
    const originalHeight = Number(w.layout.height) || el.offsetHeight || estimatedWidgetHeight(w);

    el.classList.add('resizing');
    el.dataset.resizeLabel = `${Math.round(w.layout.width)} × ${Math.round(originalHeight)} px`;
    grid.classList.add('is-resizing');
    handle.setPointerCapture?.(e.pointerId);

    function onMove(ev) {
      const minWidth = Math.min(MIN_WIDGET_WIDTH, grid.clientWidth);
      const maxWidth = Math.max(minWidth, grid.clientWidth - w.layout.x);
      w.layout.width = clamp(originalLayout.width + ev.clientX - startX, minWidth, maxWidth);
      w.layout.height = clamp(originalHeight + ev.clientY - startY, minHeightForWidget(w), MAX_WIDGET_HEIGHT);
      syncSizeFromWidth(w);
      applyWidgetLayout(w, el);
      updateSizeButton(w, el);
      el.dataset.resizeLabel = `${Math.round(w.layout.width)} × ${Math.round(w.layout.height)} px`;
      updateCanvasBounds();
    }

    function finish(ev, cancelled = false) {
      if (cancelled) {
        w.layout = originalLayout;
        w.size = originalSize;
        applyWidgetLayout(w, el);
        updateSizeButton(w, el);
      }
      el.classList.remove('resizing');
      grid.classList.remove('is-resizing');
      delete el.dataset.resizeLabel;
      handle.releasePointerCapture?.(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      const widthChanged = Math.round(w.layout.width) !== Math.round(originalLayout.width);
      const heightChanged = Math.round(w.layout.height) !== Math.round(originalHeight);
      if (!cancelled && (widthChanged || heightChanged)) {
        setTimeout(() => { renderWidgetContent(w); pushHistory(); }, 80);
      }
    }

    function onUp(ev) { finish(ev); }
    function onCancel(ev) { finish(ev, true); }

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
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
        el.dataset.origLayout = JSON.stringify(w.layout ?? {});
        el.style.left = '0px';
        el.style.width = `${grid.clientWidth}px`;
        el.style.height = 'auto';
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
    const cols    = configuredTableColumns(cfg);
    const numCols = new Set(App.state.numericColumns);

    let html = `<div class="widget-table-wrap" style="max-height:none;">
      <table class="widget-table"><thead><tr>`;
    cols.forEach(c => { html += `<th>${escHtml(c)}</th>`; });
    html += `</tr></thead><tbody>`;

    rows.forEach(r => {
      html += '<tr>';
      cols.forEach(c => {
        const v   = formatTableValue(r[c], c);
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
      if (el && el.dataset.origLayout) {
        applyWidgetLayout(w, el);
        delete el.dataset.origLayout;
      }
    });
    // Re-renderiza widgets de tabela com paginação normal de volta
    widgets.forEach(w => {
      if (w.type === 'table') renderWidgetContent(w);
    });
    updateCanvasBounds();
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
    if (w.type === 'image') {
      renderImageWidget(body, w);
      return;
    }
    if (w.type === 'button') {
      renderButtonWidget(body, w);
      return;
    }
    if (w.type === 'filter') {
      await renderFilterWidget(body, w);
      return;
    }

    const configError = validateWidgetColumns(w);
    if (configError) {
      renderWidgetError(body, configError);
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
            (App.state.activeFilter || Object.keys(App.state.widgetFilters).length || App.state.crossFilter)
              ? App.queryKPI(w.config, true)
              : Promise.resolve(null),
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

  function safeImageSource(value) {
    const source = String(value ?? '').trim();
    if (!source) return '';
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(source)) return source;
    if (/^(https?:\/\/|blob:|\/|\.{0,2}\/)/i.test(source)) return source;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
    return '';
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { resolve(''); return; }
      if (!file.type.startsWith('image/')) { reject(new Error('Arquivo inválido')); return; }
      if (file.size > 3 * 1024 * 1024) { reject(new Error('A imagem deve ter no máximo 3 MB')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Não foi possível ler a imagem'));
      reader.readAsDataURL(file);
    });
  }

  function renderImageWidget(body, w) {
    const cfg = w.config ?? {};
    const source = safeImageSource(cfg.source);
    const fit = ['contain', 'cover', 'fill'].includes(cfg.fit) ? cfg.fit : 'contain';
    const background = /^#[0-9a-f]{6}$/i.test(cfg.background ?? '') ? cfg.background : '#ffffff';
    if (!source) {
      body.innerHTML = `<div class="image-widget-empty">
        <i class="fa-solid fa-image"></i>
        <span>Adicione uma imagem ou logo</span>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="image-widget" style="background:${background}">
      <img src="${escHtml(source)}" alt="${escHtml(cfg.alt ?? 'Imagem')}" style="object-fit:${fit}">
    </div>`;
  }

  function normalizeExternalUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'https://') return '';
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    return /^(https?:|mailto:)/i.test(candidate) ? candidate : '';
  }

  function renderButtonWidget(body, w) {
    const cfg = w.config ?? {};
    const background = /^#[0-9a-f]{6}$/i.test(cfg.background ?? '') ? cfg.background : '#6366f1';
    const textColor = /^#[0-9a-f]{6}$/i.test(cfg.textColor ?? '') ? cfg.textColor : '#ffffff';
    const fontSize = Math.max(10, Math.min(42, Number(cfg.fontSize) || 16));
    const fontFamilies = {
      system: "'Segoe UI', system-ui, sans-serif",
      serif: "Georgia, 'Times New Roman', serif",
      modern: "Arial, Helvetica, sans-serif",
      mono: "'Courier New', monospace",
    };
    const align = ['left', 'center', 'right'].includes(cfg.align) ? cfg.align : 'center';
    const icon = BUTTON_ICONS.some(item => item.value === cfg.icon) && cfg.icon !== 'none'
      ? `<i class="fa-solid ${cfg.icon}"></i>`
      : '';
    const style = `background:${background};color:${textColor};font-size:${fontSize}px;font-family:${fontFamilies[cfg.fontFamily] ?? fontFamilies.system}`;
    const content = `${icon}<span>${escHtml(cfg.label ?? 'Abrir')}</span>`;
    let control;
    if (cfg.destinationType === 'external') {
      const url = normalizeExternalUrl(cfg.url);
      control = url
        ? `<a class="dashboard-link-button ${cfg.fullWidth ? 'full' : ''}" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" style="${style}">${content}</a>`
        : `<button class="dashboard-link-button ${cfg.fullWidth ? 'full' : ''}" disabled style="${style}">${content}</button>`;
    } else {
      const targetExists = pages.some(page => page.id === cfg.pageId);
      control = `<button class="dashboard-link-button ${cfg.fullWidth ? 'full' : ''}" ${targetExists ? `onclick="Dashboard.switchPageById('${escHtml(escJs(cfg.pageId))}')"` : 'disabled'} style="${style}">${content}</button>`;
    }
    body.innerHTML = `<div class="button-widget-align ${align}">${control}</div>`;
  }

  async function renderFilterWidget(body, w) {
    const cfg = w.config ?? {};
    const columns = (cfg.columns ?? []).filter(column => App.state.columns.includes(column));
    const orientation = cfg.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    if (!columns.length) {
      renderWidgetError(body, 'Selecione ao menos uma coluna para filtrar');
      return;
    }
    const optionGroups = await Promise.all(columns.map(column => App.getDistinctValues(column)));
    const selected = App.state.widgetFilters[w.id] ?? {};
    const controls = columns.map((column, index) => {
      const options = optionGroups[index].map(value => {
        const stringValue = String(value ?? '');
        return `<option value="${escHtml(stringValue)}" ${String(selected[column] ?? '') === stringValue ? 'selected' : ''}>${escHtml(stringValue)}</option>`;
      }).join('');
      return `<label class="filter-widget-field">
        <span>${escHtml(column)}</span>
        <select class="form-control" onchange="App.setWidgetFilter('${w.id}','${escHtml(escJs(column))}',this.value)">
          <option value="">Todos</option>
          ${options}
        </select>
      </label>`;
    }).join('');
    body.innerHTML = `<div class="filter-widget ${orientation}">
      <div class="filter-widget-controls">${controls}</div>
      <button class="filter-widget-clear" onclick="App.clearWidgetFilters('${w.id}')">
        <i class="fa-solid fa-eraser"></i> Limpar filtros
      </button>
    </div>`;
  }

  function renderWidgetError(body, message) {
    body.innerHTML = `<div style="color:#94a3b8;font-size:13px;padding:20px;text-align:center;">
      <i class="fa-solid fa-triangle-exclamation" style="display:block;font-size:28px;margin-bottom:8px;opacity:.4;"></i>
      ${escHtml(message)}
    </div>`;
  }

  function validateWidgetColumns(widget) {
    const available = new Set(App.state.columns);
    const numeric = new Set(App.state.numericColumns);
    const cfg = widget.config ?? {};
    if (['image', 'text', 'button'].includes(widget.type)) return '';
    if (widget.type === 'filter') {
      return (cfg.columns ?? []).some(column => available.has(column))
        ? ''
        : 'Selecione ao menos uma coluna válida para filtrar';
    }
    if (widget.type === 'kpi') {
      return numeric.has(cfg.column) ? '' : 'Selecione uma coluna numérica válida para o indicador';
    }
    if (widget.type === 'table') return '';
    if (widget.type === 'scatter') {
      return numeric.has(cfg.xColumn) && numeric.has(cfg.yColumns?.[0])
        ? ''
        : 'Selecione duas colunas numéricas válidas para a dispersão';
    }
    if (!available.has(cfg.xColumn)) return 'Selecione uma coluna válida para as categorias';
    if (!(cfg.yColumns ?? []).length || cfg.yColumns.some(col => !numeric.has(col))) {
      return 'Selecione ao menos uma coluna numérica válida';
    }
    return '';
  }

  function configuredTableColumns(config) {
    const available = new Set(App.state.columns);
    const selected = (config.columns ?? []).filter(col => available.has(col));
    return selected.length ? selected : App.state.columns.slice(0, 6);
  }

  function formatTableValue(value, column) {
    const type = App.state.columnConfig[column] ?? App.state.columnTypes[column];
    if (type === 'date') {
      const date = ExcelParser.parseDateValue(value);
      if (date) return date.toLocaleDateString('pt-BR');
    }
    return String(value ?? '');
  }

  function renderQueryKPI(body, w, current, total) {
    const cfg = w.config;
    const value = current.value === null ? null : Number(current.value);
    const fmt = value !== null ? Charts.formatValue(value, cfg) : '—';
    const suffix = cfg.valueFormat === 'percent' && String(cfg.suffix ?? '').trim() === '%' ? '' : cfg.suffix;
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
        <div class="kpi-value">${escHtml(cfg.prefix)}${fmt}${escHtml(suffix)}</div>
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
        html += `<td${cls}>${escHtml(formatTableValue(row[col], col))}</td>`;
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
    const fmt = val !== null ? Charts.formatValue(val, cfg) : '—';
    const suffix = cfg.valueFormat === 'percent' && String(cfg.suffix ?? '').trim() === '%' ? '' : cfg.suffix;

    // Trend: mostra delta vs total quando filtro ou filtro cruzado está ativo
    let trendHTML = '';
    const hasFilter = App.state.activeFilter || Object.keys(App.state.widgetFilters).length || App.state.crossFilter;
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
        <div class="kpi-value">${escHtml(cfg.prefix)}${fmt}${escHtml(suffix)}</div>
        <div class="kpi-label">${escHtml(cfg.column)}</div>
        ${trendHTML}
        <div class="kpi-sub">${aggLabels[cfg.kpiAgg] ?? ''} · ${rows.length} linhas</div>
      </div>
    `;
  }

  function renderTable(body, w, rows) {
    const cfg      = w.config;
    const cols     = configuredTableColumns(cfg);
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
        const v   = formatTableValue(r[c], c);
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

    const iconOpts = (current) => TITLE_ICONS.map(item => `
      <label class="icon-opt" title="${item.label}">
        <input type="radio" name="w-title-icon" value="${item.value}" ${(current ?? 'auto') === item.value ? 'checked' : ''}>
        <span>
          <i class="fa-solid ${item.icon}"></i>
          <small>${item.label}</small>
        </span>
      </label>
    `).join('');

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
            <label class="form-label">Ícone ao lado do título</label>
            <div class="icon-picker">${iconOpts(cfg.titleIcon)}</div>
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

    if (w.type === 'button') {
      const buttonIconOpts = BUTTON_ICONS.map(item => `
        <label class="icon-opt" title="${item.label}">
          <input type="radio" name="w-button-icon" value="${item.value}" ${(cfg.icon ?? 'fa-arrow-right') === item.value ? 'checked' : ''}>
          <span><i class="fa-solid ${item.icon}"></i><small>${item.label}</small></span>
        </label>
      `).join('');
      html += `
        <div class="form-section">
          <div class="form-section-title">Conteúdo do botão</div>
          <div class="form-grid">
            <div class="form-group full">
              <label class="form-label">Texto</label>
              <input id="w-button-label" class="form-control" type="text" value="${escHtml(cfg.label ?? 'Abrir página')}" maxlength="60">
            </div>
            <div class="form-group full">
              <label class="form-label">Ícone do botão</label>
              <div class="icon-picker">${buttonIconOpts}</div>
            </div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Destino</div>
          <div class="form-grid">
            <div class="form-group full">
              <label class="form-label">Tipo de link</label>
              <select id="w-button-destination" class="form-control" onchange="Dashboard.toggleButtonDestinationFields()">
                <option value="page" ${(cfg.destinationType ?? 'page') === 'page' ? 'selected' : ''}>Página deste dashboard</option>
                <option value="external" ${cfg.destinationType === 'external' ? 'selected' : ''}>Link externo</option>
              </select>
            </div>
            <div class="form-group full" id="w-button-page-group">
              <label class="form-label">Página de destino</label>
              <select id="w-button-page" class="form-control">
                ${pages.map(page => `<option value="${escHtml(page.id)}" ${cfg.pageId === page.id ? 'selected' : ''}>${escHtml(page.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group full" id="w-button-url-group">
              <label class="form-label">Endereço externo</label>
              <input id="w-button-url" class="form-control" type="text" value="${escHtml(cfg.url ?? 'https://')}" placeholder="https://exemplo.com">
            </div>
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title">Aparência</div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Cor do botão</label>
              <input id="w-button-bg" class="form-control color-control" type="color" value="${escHtml(cfg.background ?? '#6366f1')}">
            </div>
            <div class="form-group">
              <label class="form-label">Cor da fonte</label>
              <input id="w-button-text-color" class="form-control color-control" type="color" value="${escHtml(cfg.textColor ?? '#ffffff')}">
            </div>
            <div class="form-group">
              <label class="form-label">Fonte</label>
              <select id="w-button-font" class="form-control">
                <option value="system" ${(cfg.fontFamily ?? 'system') === 'system' ? 'selected' : ''}>Sistema</option>
                <option value="modern" ${cfg.fontFamily === 'modern' ? 'selected' : ''}>Arial</option>
                <option value="serif" ${cfg.fontFamily === 'serif' ? 'selected' : ''}>Serifada</option>
                <option value="mono" ${cfg.fontFamily === 'mono' ? 'selected' : ''}>Monoespaçada</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Tamanho da fonte</label>
              <input id="w-button-font-size" class="form-control" type="number" min="10" max="42" value="${cfg.fontSize ?? 16}">
            </div>
            <div class="form-group">
              <label class="form-label">Alinhamento</label>
              <select id="w-button-align" class="form-control">
                <option value="left" ${cfg.align === 'left' ? 'selected' : ''}>Esquerda</option>
                <option value="center" ${(cfg.align ?? 'center') === 'center' ? 'selected' : ''}>Centro</option>
                <option value="right" ${cfg.align === 'right' ? 'selected' : ''}>Direita</option>
              </select>
            </div>
            <div class="form-group">
              ${toggleRow('w-button-full', 'Ocupar toda a largura', cfg.fullWidth ?? false)}
            </div>
          </div>
        </div>`;
      setTimeout(toggleButtonDestinationFields, 0);
      return html;
    }

    if (w.type === 'image') {
      const urlValue = /^data:/i.test(cfg.source ?? '') ? '' : cfg.source ?? '';
      html += `
        <div class="form-section">
          <div class="form-section-title">Imagem ou logo</div>
          <div class="form-grid">
            <div class="form-group full">
              <label class="form-label">Enviar arquivo</label>
              <input id="w-image-file" class="form-control" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml">
            </div>
            <div class="form-group full">
              <label class="form-label">Ou usar URL da imagem</label>
              <input id="w-image-url" class="form-control" type="url" value="${escHtml(urlValue)}" placeholder="https://...">
            </div>
            <div class="form-group">
              <label class="form-label">Texto alternativo</label>
              <input id="w-image-alt" class="form-control" type="text" value="${escHtml(cfg.alt ?? 'Imagem')}">
            </div>
            <div class="form-group">
              <label class="form-label">Ajuste</label>
              <select id="w-image-fit" class="form-control">
                <option value="contain" ${cfg.fit==='contain'?'selected':''}>Conter sem cortar</option>
                <option value="cover" ${cfg.fit==='cover'?'selected':''}>Preencher e cortar</option>
                <option value="fill" ${cfg.fit==='fill'?'selected':''}>Esticar</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Cor de fundo</label>
              <input id="w-image-bg" class="form-control color-control" type="color" value="${escHtml(cfg.background ?? '#ffffff')}">
            </div>
          </div>
        </div>`;
      return html;
    }

    if (w.type === 'filter') {
      html += `
        <div class="form-section">
          <div class="form-section-title">Campos de filtro</div>
          ${selCol(cols, cfg.columns ?? [], 'w-filter-cols', true)}
        </div>
        <div class="form-section">
          <div class="form-section-title">Organização dos campos</div>
          <select id="w-filter-orientation" class="form-control">
            <option value="vertical" ${(cfg.orientation ?? 'vertical') === 'vertical' ? 'selected' : ''}>Vertical — um abaixo do outro</option>
            <option value="horizontal" ${cfg.orientation === 'horizontal' ? 'selected' : ''}>Adaptável — cria colunas ao esticar</option>
          </select>
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
                <option value="number" ${(cfg.valueFormat??'number')==='number'?'selected':''}>Número completo</option>
                <option value="compact" ${cfg.valueFormat==='compact'?'selected':''}>Abreviado</option>
                <option value="currency" ${cfg.valueFormat==='currency'?'selected':''}>Moeda</option>
                <option value="percent" ${cfg.valueFormat==='percent'?'selected':''}>Percentual</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Casas decimais</label>
              <select id="w-decimals" class="form-control">
                ${[0,1,2,3,4].map(n => `<option value="${n}" ${(cfg.valueDecimals??cfg.decimals??0)==n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label class="form-label">Escala percentual</label>
              <select id="w-percent-scale" class="form-control">
                <option value="direct" ${(cfg.percentScale??'direct')==='direct'?'selected':''}>Já está em percentual</option>
                <option value="fraction" ${cfg.percentScale==='fraction'?'selected':''}>Fração decimal</option>
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
          ${w.type === 'bar' ? `<div class="form-group">
            <label class="form-label">Orientação das barras</label>
            <select id="w-bar-orientation" class="form-control">
              <option value="vertical" ${(cfg.barOrientation ?? 'vertical') === 'vertical' ? 'selected' : ''}>Vertical</option>
              <option value="horizontal" ${cfg.barOrientation === 'horizontal' ? 'selected' : ''}>Horizontal</option>
            </select>
          </div>` : ''}
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
              <option value="number" ${(cfg.valueFormat??'number')==='number'?'selected':''}>Número completo</option>
              <option value="compact" ${cfg.valueFormat==='compact'?'selected':''}>Abreviado</option>
              <option value="currency" ${cfg.valueFormat==='currency'?'selected':''}>Moeda</option>
              <option value="percent" ${cfg.valueFormat==='percent'?'selected':''}>Percentual</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Casas decimais</label>
            <select id="w-value-decimals" class="form-control">${[0,1,2,3,4].map(n => `<option value="${n}" ${(cfg.valueDecimals??0)==n?'selected':''}>${n}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label class="form-label">Escala percentual</label>
            <select id="w-percent-scale" class="form-control">
              <option value="direct" ${(cfg.percentScale??'direct')==='direct'?'selected':''}>Já está em percentual</option>
              <option value="fraction" ${cfg.percentScale==='fraction'?'selected':''}>Fração decimal</option>
            </select>
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

  function toggleButtonDestinationFields() {
    const type = document.getElementById('w-button-destination')?.value ?? 'page';
    const pageGroup = document.getElementById('w-button-page-group');
    const urlGroup = document.getElementById('w-button-url-group');
    if (pageGroup) pageGroup.style.display = type === 'page' ? '' : 'none';
    if (urlGroup) urlGroup.style.display = type === 'external' ? '' : 'none';
  }

  /* ── Salvar widget (vindo do modal) ─────── */
  async function saveWidget() {
    const w = widgets.find(x => x.id === editingId);
    if (!w) return;

    w.title = document.getElementById('w-title')?.value.trim() || w.title;
    w.config.titleIcon = document.querySelector('input[name="w-title-icon"]:checked')?.value ?? 'auto';
    const previousSize = w.size;
    w.size = document.querySelector('input[name="w-size"]:checked')?.value ?? w.size;

    if (w.type === 'text') {
      w.config.content = document.getElementById('w-text-content')?.value ?? '';
      w.config.fontFamily = document.getElementById('w-text-font')?.value ?? 'system';
      w.config.fontSize = Math.max(10, Math.min(72, parseInt(document.getElementById('w-text-size')?.value ?? '16')));
      w.config.align = document.getElementById('w-text-align')?.value ?? 'left';
      w.config.lineHeight = Math.max(1, Math.min(2.5, parseFloat(document.getElementById('w-text-line-height')?.value ?? '1.6')));
      w.config.color = document.getElementById('w-text-color')?.value ?? '#334155';
      w.config.background = document.getElementById('w-text-bg')?.value ?? '#ffffff';
    } else if (w.type === 'button') {
      const destinationType = document.getElementById('w-button-destination')?.value ?? 'page';
      const url = document.getElementById('w-button-url')?.value.trim() ?? '';
      if (destinationType === 'external' && !normalizeExternalUrl(url)) {
        App.toast('Informe um link externo válido.', 'error');
        return;
      }
      w.config.label = document.getElementById('w-button-label')?.value.trim() || 'Abrir';
      w.config.destinationType = destinationType;
      w.config.pageId = document.getElementById('w-button-page')?.value ?? pages[0]?.id ?? '';
      w.config.url = destinationType === 'external' ? normalizeExternalUrl(url) : url;
      w.config.icon = document.querySelector('input[name="w-button-icon"]:checked')?.value ?? 'none';
      w.config.background = document.getElementById('w-button-bg')?.value ?? '#6366f1';
      w.config.textColor = document.getElementById('w-button-text-color')?.value ?? '#ffffff';
      w.config.fontFamily = document.getElementById('w-button-font')?.value ?? 'system';
      w.config.fontSize = Math.max(10, Math.min(42, parseInt(document.getElementById('w-button-font-size')?.value ?? '16')));
      w.config.align = document.getElementById('w-button-align')?.value ?? 'center';
      w.config.fullWidth = document.getElementById('w-button-full')?.checked ?? false;
    } else if (w.type === 'image') {
      const file = document.getElementById('w-image-file')?.files?.[0];
      const url = document.getElementById('w-image-url')?.value.trim() ?? '';
      try {
        if (file) w.config.source = await readImageFile(file);
        else if (url) {
          const safeUrl = safeImageSource(url);
          if (!safeUrl) throw new Error('Use uma URL http(s) válida');
          w.config.source = safeUrl;
        }
      } catch (error) {
        App.toast(error.message, 'error');
        return;
      }
      w.config.alt = document.getElementById('w-image-alt')?.value.trim() || 'Imagem';
      w.config.fit = document.getElementById('w-image-fit')?.value ?? 'contain';
      w.config.background = document.getElementById('w-image-bg')?.value ?? '#ffffff';
    } else if (w.type === 'filter') {
      w.config.columns = [...document.querySelectorAll('#w-filter-cols input:checked')].map(input => input.value);
      w.config.orientation = document.getElementById('w-filter-orientation')?.value ?? 'vertical';
      const activeValues = App.state.widgetFilters[w.id] ?? {};
      Object.keys(activeValues).forEach(column => {
        if (!w.config.columns.includes(column)) delete activeValues[column];
      });
      if (!Object.keys(activeValues).length) App.removeWidgetFilters(w.id);
    } else if (w.type === 'kpi') {
      w.config.column   = document.getElementById('w-kpi-col')?.value   ?? w.config.column;
      w.config.kpiAgg   = document.getElementById('w-kpi-agg')?.value   ?? w.config.kpiAgg;
      w.config.decimals = parseInt(document.getElementById('w-decimals')?.value ?? '0');
      w.config.valueDecimals = w.config.decimals;
      w.config.valueFormat = document.getElementById('w-value-format')?.value ?? 'number';
      w.config.percentScale = document.getElementById('w-percent-scale')?.value ?? 'direct';
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
      w.config.percentScale = document.getElementById('w-percent-scale')?.value ?? 'direct';
      w.config.currency = document.getElementById('w-currency')?.value ?? 'BRL';
      if (w.type === 'bar') w.config.barOrientation = document.getElementById('w-bar-orientation')?.value ?? 'vertical';

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
      if (w.size !== previousSize) {
        const gridWidth = getGridWidth();
        w.layout.width = widthForSize(w.size, gridWidth);
        w.layout.x = clamp(w.layout.x, 0, Math.max(0, gridWidth - w.layout.width));
        applyWidgetLayout(w, el);
      }
      updateSizeButton(w, el);
      el.querySelector('.widget-title').innerHTML = widgetTitleHTML(w);
    }

    if (w.type === 'filter') await renderAll();
    else await renderWidgetContent(w);
    updateCanvasBounds();
    pushHistory();
    App.closeModal();
    App.toast('Widget atualizado!', 'success');
  }

  /* ── Remover ─────────────────────────────── */
  function deleteWidget(id) {
    if (chartMap[id]) { try { chartMap[id].destroy(); } catch(_) {} delete chartMap[id]; }
    App.removeWidgetFilters(id);
    widgets = widgets.filter(w => w.id !== id);
    document.querySelector(`[data-id="${id}"]`)?.remove();
    updatePlaceholder();
    updateCanvasBounds();
    pushHistory();
  }

  /* ── Duplicar ────────────────────────────── */
  function duplicateWidget(id) {
    const orig = widgets.find(w => w.id === id);
    if (!orig) return;
    const clone = JSON.parse(JSON.stringify(orig));
    clone.id    = 'w_' + Date.now();
    clone.title = clone.title + ' (cópia)';
    if (clone.layout) {
      const gridWidth = getGridWidth();
      clone.layout.x = clamp(clone.layout.x + 24, 0, Math.max(0, gridWidth - clone.layout.width));
      clone.layout.y += 24;
    }
    widgets.push(clone);
    renderWidget(clone);
    updatePlaceholder();
    updateCanvasBounds();
    pushHistory();
    App.toast('Widget duplicado!');
  }

  /* ── Limpar tudo ─────────────────────────── */
  function clearAll() {
    if (!widgets.length) return;
    if (!confirm('Remover todos os widgets do dashboard?')) return;
    widgets.forEach(widget => App.removeWidgetFilters(widget.id));
    widgets = [];
    Object.values(chartMap).forEach(c => { try { c.destroy(); } catch(_) {} });
    for (const k in chartMap) delete chartMap[k];
    document.getElementById('widgets-grid').innerHTML = '';
    updatePlaceholder();
    updateCanvasBounds();
    pushHistory();
  }

  function updatePlaceholder() {
    const empty = document.getElementById('canvas-empty');
    const canvas = document.getElementById('dash-canvas');
    if (empty) empty.classList.toggle('hidden', widgets.length > 0);
    if (canvas) canvas.classList.toggle('has-widgets', widgets.length > 0);
    renderPageNav();
  }

  function syncCurrentPage() {
    if (pages[activePageIndex]) pages[activePageIndex].widgets = widgets;
  }

  function renderPageNav() {
    const container = document.getElementById('dashboard-page-tabs');
    if (!container) return;
    const pageButtons = pages.map((page, index) => `
      <div class="dashboard-page-item ${index === activePageIndex ? 'active' : ''}">
        <button class="dashboard-page-button" onclick="Dashboard.switchPage(${index})">
          <i class="fa-solid ${page.icon}"></i>
          <span>${escHtml(page.name)}</span>
        </button>
        <button class="dashboard-page-edit" onclick="Dashboard.openPageModal(${index})" title="Editar nome e ícone">
          <i class="fa-solid fa-pen"></i>
        </button>
      </div>
    `).join('');
    const addButton = `
      <button class="dashboard-page-add" onclick="Dashboard.addPage()" ${pages.length >= MAX_PAGES ? 'disabled' : ''} title="${pages.length >= MAX_PAGES ? 'Limite de 5 páginas atingido' : 'Adicionar página'}">
        <i class="fa-solid fa-plus"></i>
        <span>Adicionar página</span>
      </button>`;
    container.innerHTML = pageButtons + addButton;
  }

  async function addPage() {
    if (pages.length >= MAX_PAGES) {
      App.toast('O dashboard permite no máximo 5 páginas.', 'info');
      return;
    }
    syncCurrentPage();
    const number = pages.length + 1;
    pages.push({
      id: `page_${Date.now()}`,
      name: `Página ${number}`,
      icon: number % 2 === 0 ? 'fa-chart-line' : 'fa-chart-pie',
      widgets: [],
    });
    await switchPage(pages.length - 1);
    App.toast(`Página ${number} criada.`, 'success');
  }

  async function switchPage(index) {
    if (!pages[index] || index === activePageIndex) return;
    syncCurrentPage();
    activePageIndex = index;
    widgets = pages[index].widgets ?? [];
    resetHistory();
    await renderAll();
    pushHistory();
    App.renderColumnsList();
  }

  function switchPageById(pageId) {
    const index = pages.findIndex(page => page.id === pageId);
    if (index < 0) {
      App.toast('A página de destino não existe.', 'error');
      return;
    }
    return switchPage(index);
  }

  function openPageModal(index) {
    if (!pages[index]) return;
    editingPageIndex = index;
    document.getElementById('page-name-input').value = pages[index].name;
    const deleteButton = document.getElementById('page-delete-button');
    if (deleteButton) {
      deleteButton.disabled = pages.length <= 1;
      deleteButton.title = pages.length <= 1 ? 'O dashboard precisa ter ao menos uma página' : 'Excluir esta página';
    }
    document.getElementById('page-icon-picker').innerHTML = PAGE_ICONS.map(item => `
      <label class="icon-opt" title="${item.label}">
        <input type="radio" name="page-icon" value="${item.value}" ${pages[index].icon === item.value ? 'checked' : ''}>
        <span><i class="fa-solid ${item.icon}"></i><small>${item.label}</small></span>
      </label>
    `).join('');
    document.getElementById('page-modal-overlay').classList.add('open');
  }

  function closePageModal() {
    document.getElementById('page-modal-overlay')?.classList.remove('open');
  }

  function savePageSettings() {
    const page = pages[editingPageIndex];
    if (!page) return;
    page.name = document.getElementById('page-name-input')?.value.trim() || `Página ${editingPageIndex + 1}`;
    page.icon = document.querySelector('input[name="page-icon"]:checked')?.value ?? page.icon;
    renderPageNav();
    closePageModal();
    App.toast('Botão da página atualizado.', 'success');
  }

  async function deletePage() {
    if (pages.length <= 1) {
      App.toast('O dashboard precisa ter ao menos uma página.', 'info');
      return;
    }
    const page = pages[editingPageIndex];
    if (!page) {
      App.toast('Página não encontrada.', 'error');
      return;
    }
    if (!window.confirm(`Excluir a página "${page.name}" e todos os widgets dela?`)) return;

    syncCurrentPage();
    const removedIndex = editingPageIndex;
    const removedPage = pages.splice(removedIndex, 1)[0];
    if (removedIndex < activePageIndex) activePageIndex--;
    else if (removedIndex === activePageIndex) activePageIndex = Math.min(removedIndex, pages.length - 1);
    activePageIndex = Math.max(0, Math.min(activePageIndex, pages.length - 1));
    widgets = pages[activePageIndex].widgets ?? [];
    closePageModal();

    (removedPage?.widgets ?? []).forEach(widget => App.removeWidgetFilters(widget.id));
    resetHistory();
    await renderAll();
    pushHistory();
    App.renderColumnsList();
    App.toast('Página excluída.', 'success');
  }

  /* ── Serialização ────────────────────────── */
  function serialize() {
    syncCurrentPage();
    return {
      title:  document.getElementById('dash-title')?.value ?? 'Meu Dashboard',
      theme:  Charts.getTheme(),
      customColor: Charts.getCustomColor(),
      bg:     document.getElementById('dash-canvas')?.dataset.bg ?? '',
      widgets: pages[0].widgets,
      pages,
      activePage: activePageIndex,
    };
  }

  async function load(data) {
    document.getElementById('dash-title').value = data.title ?? 'Dashboard';
    if (data.customColor) Charts.setCustomTheme(data.customColor);
    if (data.theme) Charts.setTheme(data.theme);
    if (data.bg) {
      const canvas = document.getElementById('dash-canvas');
      canvas.style.background = data.bg;
      canvas.dataset.bg = data.bg;
    }
    if (Array.isArray(data.pages) && data.pages.length) {
      pages = data.pages.slice(0, MAX_PAGES).map((page, index) => ({
        id: page.id ?? `page_${index + 1}`,
        name: page.name ?? `Página ${index + 1}`,
        icon: PAGE_ICONS.some(item => item.value === page.icon) ? page.icon : index ? 'fa-chart-line' : 'fa-chart-pie',
        widgets: Array.isArray(page.widgets) ? page.widgets : [],
      }));
      activePageIndex = Math.max(0, Math.min(pages.length - 1, Number(data.activePage) || 0));
    } else {
      pages = [
        { id: 'page_1', name: 'Página 1', icon: 'fa-chart-pie', widgets: data.widgets ?? [] },
      ];
      activePageIndex = 0;
    }
    widgets = pages[activePageIndex].widgets;
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
    resizeWidget, startResize, startDrag, goToPage,
    prepareForPDFExport, restoreAfterPDFExport,
    serialize, load, getWidgets, generateSuggestedDashboard,
    updatePlaceholder,
    addPage, switchPage, switchPageById, openPageModal, closePageModal, savePageSettings, deletePage,
    toggleButtonDestinationFields,
    undo, redo, resetHistory,
  };
})();

/* helper global */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
