/* ─────────────────────────────────────────────
   charts.js — Renderização e dados dos gráficos
───────────────────────────────────────────── */
const Charts = (() => {

  /* ── Paletas ─────────────────────────────── */
  const THEMES = {
    indigo:  { name: 'Índigo',     swatch: '#6366f1', colors: ['#6366f1','#8b5cf6','#a78bfa','#818cf8','#4f46e5','#7c3aed','#4338ca','#c4b5fd'] },
    ocean:   { name: 'Oceano',     swatch: '#0ea5e9', colors: ['#0ea5e9','#06b6d4','#22d3ee','#38bdf8','#0284c7','#0891b2','#0369a1','#67e8f9'] },
    sunset:  { name: 'Pôr do Sol', swatch: '#f97316', colors: ['#f97316','#ef4444','#f59e0b','#ec4899','#fb923c','#dc2626','#d97706','#fca5a5'] },
    forest:  { name: 'Floresta',   swatch: '#22c55e', colors: ['#22c55e','#10b981','#84cc16','#16a34a','#059669','#65a30d','#15803d','#a3e635'] },
    night:   { name: 'Noite',      swatch: '#a855f7', colors: ['#a855f7','#ec4899','#6366f1','#8b5cf6','#db2777','#9333ea','#7c3aed','#f472b6'] },
    pastel:  { name: 'Pastel',     swatch: '#f9a8d4', colors: ['#f9a8d4','#a5b4fc','#6ee7b7','#fde68a','#c4b5fd','#93c5fd','#fca5a5','#d9f99d'] },
  };

  const BG_COLORS = [
    '#f1f5f9','#ffffff','#0f172a','#1e1b4b','#f0fdf4','#fef9c3','#fff1f2','#f0f9ff'
  ];

  let currentTheme = 'indigo';

  function getColors(n = 8) {
    const base = THEMES[currentTheme]?.colors ?? THEMES.indigo.colors;
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }

  function setTheme(name) { currentTheme = name; }
  function getTheme() { return currentTheme; }
  function getAllThemes() { return THEMES; }
  function getBgColors() { return BG_COLORS; }

  /* ── Agregação de dados ──────────────────── */
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = ExcelParser.normalizeNumericValue(value);
    if (normalized === '') return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const text = String(value ?? '').trim();
    const br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (br) {
      const year = br[3].length === 2 ? Number('20' + br[3]) : Number(br[3]);
      const date = new Date(year, Number(br[2]) - 1, Number(br[1]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateGroupLabel(value, group) {
    if (!group || group === 'none') return String(value ?? '(vazio)').trim();
    const date = parseDateValue(value);
    if (!date) return '(data inválida)';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    if (group === 'year') return String(year);
    if (group === 'quarter') return year + ' T' + (Math.floor(date.getMonth() / 3) + 1);
    if (group === 'month') return year + '-' + month;
    if (group === 'week') {
      const first = new Date(year, 0, 1);
      const week = Math.ceil((((date - first) / 86400000) + first.getDay() + 1) / 7);
      return year + ' S' + String(week).padStart(2, '0');
    }
    return year + '-' + month + '-' + String(date.getDate()).padStart(2, '0');
  }

  function aggregate(rows, xCol, yCols, agg = 'sum', limit = 20, sortBy = 'value', sortDir = 'desc', options = {}) {
    const groups = new Map();

    for (const row of rows) {
      const key = dateGroupLabel(row[xCol], options.dateGroup);
      let group = groups.get(key);
      if (!group) {
        group = { rowCount: 0, values: Object.create(null) };
        for (const col of yCols) {
          group.values[col] = { sum: 0, count: 0, min: Infinity, max: -Infinity, first: 0 };
        }
        groups.set(key, group);
      }

      group.rowCount++;
      for (const col of yCols) {
        const value = toNumber(row[col]);
        if (value === null) continue;
        const stats = group.values[col];
        if (stats.count === 0) stats.first = value;
        stats.sum += value;
        stats.count++;
        if (value < stats.min) stats.min = value;
        if (value > stats.max) stats.max = value;
      }
    }

    const result = [];
    for (const [label, group] of groups) {
      const entry = { label };
      for (const col of yCols) {
        const stats = group.values[col];
        switch (agg) {
          case 'sum': entry[col] = stats.sum; break;
          case 'avg': entry[col] = stats.count ? stats.sum / stats.count : 0; break;
          case 'count': entry[col] = group.rowCount; break;
          case 'max': entry[col] = stats.count ? stats.max : 0; break;
          case 'min': entry[col] = stats.count ? stats.min : 0; break;
          default: entry[col] = stats.count ? stats.first : 0;
        }
      }
      result.push(entry);
    }

    if (sortBy === 'value' && yCols.length) {
      result.sort((a, b) => sortDir === 'asc' ? a[yCols[0]] - b[yCols[0]] : b[yCols[0]] - a[yCols[0]]);
    } else if (sortBy === 'label') {
      result.sort((a, b) => sortDir === 'asc'
        ? String(a.label).localeCompare(String(b.label))
        : String(b.label).localeCompare(String(a.label)));
    }

    const visible = result.slice(0, limit);
    if (options.showOthers && ['sum', 'count'].includes(agg) && result.length > limit) {
      const others = { label: 'Outros' };
      for (const col of yCols) others[col] = 0;
      for (let i = limit; i < result.length; i++) {
        for (const col of yCols) others[col] += Number(result[i][col] ?? 0);
      }
      visible.push(others);
    }
    return visible;
  }

  /* ── KPI ─────────────────────────────────── */
  function calcKPI(rows, col, agg = 'sum') {
    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;

    for (const row of rows) {
      const value = toNumber(row[col]);
      if (value === null) continue;
      sum += value;
      count++;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    if (!count) return null;
    switch (agg) {
      case 'sum': return sum;
      case 'avg': return sum / count;
      case 'count': return count;
      case 'max': return max;
      case 'min': return min;
      default: return sum;
    }
  }

  /* ── Cria Chart.js ───────────────────────── */
  function create(canvasEl, widget, rows) {
    const cfg = widget.config;
    const type = widget.type;
    const colors = getColors(Math.max(cfg.yColumns?.length ?? 1, 12));

    if (type === 'kpi' || type === 'table') return null;

    let chartType = type;
    if (type === 'area') chartType = 'line';

    const data = buildChartData(widget, rows, colors);
    if (!data) return null;

    const options = buildOptions(widget, colors);

    return new Chart(canvasEl, { type: chartType, data, options });
  }

  function createPrepared(canvasEl, widget, preparedRows) {
    const cfg = widget.config;
    const type = widget.type;
    const colors = getColors(Math.max(cfg.yColumns?.length ?? 1, 12));
    let data;

    if (type === 'scatter') {
      data = {
        datasets: [{
          label: `${cfg.xColumn} vs ${cfg.yColumns?.[0] ?? ""}`,
          data: preparedRows.map(row => ({ x: Number(row.x), y: Number(row.y) })),
          backgroundColor: colors[0] + 'aa',
          borderColor: colors[0],
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      };
    } else if (['bar', 'line', 'area'].includes(type)) {
      data = {
        labels: preparedRows.map(row => row.label),
        datasets: cfg.yColumns.map((col, i) => ({
          label: col,
          data: preparedRows.map(row => Number(row[col] ?? 0)),
          backgroundColor: type === 'bar' ? colors[i] + 'cc' : colors[i] + '33',
          borderColor: colors[i],
          borderWidth: type === 'bar' ? 0 : 2,
          borderRadius: type === 'bar' ? 6 : 0,
          fill: type === 'area',
          tension: 0.4,
          pointRadius: type === 'line' || type === 'area' ? 4 : 0,
          pointHoverRadius: 6,
        })),
      };
    } else if (['pie', 'doughnut'].includes(type)) {
      const valueCol = cfg.yColumns?.[0];
      data = {
        labels: preparedRows.map(row => row.label),
        datasets: [{
          data: preparedRows.map(row => Number(row[valueCol] ?? 0)),
          backgroundColor: colors.map(color => color + 'dd'),
          borderColor: '#fff',
          borderWidth: 2,
          hoverOffset: 8,
        }],
      };
    } else {
      return null;
    }

    const chartType = type === 'area' ? 'line' : type;
    return new Chart(canvasEl, { type: chartType, data, options: buildOptions(widget, colors) });
  }

  function buildChartData(widget, rows, colors) {
    const cfg = widget.config;
    const type = widget.type;

    if (['bar', 'line', 'area'].includes(type)) {
      if (!cfg.xColumn || !cfg.yColumns?.length) return null;
      const agg = aggregate(rows, cfg.xColumn, cfg.yColumns, cfg.aggregation, cfg.limit, cfg.sortBy, cfg.sortDir, cfg);
      const labels = agg.map(r => r.label);

      const datasets = cfg.yColumns.map((col, i) => ({
        label: col,
        data: agg.map(r => r[col]),
        backgroundColor: type === 'bar' ? colors[i] + 'cc' : colors[i] + '33',
        borderColor: colors[i],
        borderWidth: type === 'bar' ? 0 : 2,
        borderRadius: type === 'bar' ? 6 : 0,
        fill: type === 'area',
        tension: 0.4,
        pointRadius: type === 'line' || type === 'area' ? 4 : 0,
        pointHoverRadius: 6,
      }));

      return { labels, datasets };
    }

    if (['pie', 'doughnut'].includes(type)) {
      if (!cfg.xColumn || !cfg.yColumns?.length) return null;
      const agg = aggregate(rows, cfg.xColumn, cfg.yColumns, cfg.aggregation, cfg.limit, cfg.sortBy, cfg.sortDir, cfg);
      return {
        labels: agg.map(r => r.label),
        datasets: [{
          data: agg.map(r => r[cfg.yColumns[0]]),
          backgroundColor: colors.map(c => c + 'dd'),
          borderColor: '#fff',
          borderWidth: 2,
          hoverOffset: 8,
        }],
      };
    }

    if (type === 'scatter') {
      if (!cfg.xColumn || !cfg.yColumns?.length) return null;
      const xCol = cfg.xColumn;
      const yCol = cfg.yColumns[0];
      const limit = Math.max(1, Number.parseInt(cfg.limit, 10) || 100);
      const pts = [];
      let validCount = 0;
      for (const row of rows) {
        const x = toNumber(row[xCol]);
        const y = toNumber(row[yCol]);
        if (x === null || y === null) continue;
        validCount++;
        const point = { x, y };
        if (pts.length < limit) {
          pts.push(point);
        } else {
          const index = Math.floor(Math.random() * validCount);
          if (index < limit) pts[index] = point;
        }
      }
      return {
        datasets: [{
          label: `${xCol} vs ${yCol}`,
          data: pts,
          backgroundColor: colors[0] + 'aa',
          borderColor: colors[0],
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      };
    }

    return null;
  }

  function formatValue(value, cfg = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value ?? '');
    const decimals = Math.max(0, Math.min(6, Number(cfg.valueDecimals) || 0));
    if (cfg.valueFormat === 'currency') {
      return number.toLocaleString('pt-BR', { style: 'currency', currency: cfg.currency || 'BRL', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    if (cfg.valueFormat === 'percent') {
      return number.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';
    }
    if (cfg.valueFormat === 'compact') return ExcelParser.fmtNumber(number, decimals);
    return number.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function buildOptions(widget, colors) {
    const cfg     = widget.config;
    const type    = widget.type;
    const isRound = ['pie', 'doughnut'].includes(type);

    // Filtro cruzado: clique em barra/fatia/ponto filtra todos os widgets
    const xCol = cfg.xColumn;
    const onClick = type !== 'scatter' && (!cfg.dateGroup || cfg.dateGroup === 'none') ? (event, elements) => {
      if (!elements.length) return;
      const idx   = elements[0].index;
      const label = event.chart.data.labels?.[idx];
      if (label !== undefined && xCol) App.setCrossFilter(xCol, String(label));
    } : undefined;

    return {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 500 },
      onClick,
      plugins: {
        legend: {
          display: cfg.showLegend ?? true,
          position: isRound ? 'right' : 'top',
          labels: { usePointStyle: true, padding: 14, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = typeof ctx.raw === 'object' ? `(${formatValue(ctx.raw.x, cfg)}, ${formatValue(ctx.raw.y, cfg)})` : formatValue(ctx.raw, cfg);
              return ` ${ctx.dataset.label ?? ctx.label}: ${v}`;
            },
          },
        },
      },
      scales: isRound || type === 'scatter' ? (type === 'scatter' ? {
        x: { grid: { color: '#f1f5f9' } },
        y: { grid: { color: '#f1f5f9' } },
      } : {}) : {
        x: {
          grid: { display: cfg.showGrid ?? true, color: '#f1f5f9' },
          ticks: { maxRotation: 40, font: { size: 11 } },
        },
        y: {
          grid: { display: cfg.showGrid ?? true, color: '#f1f5f9' },
          ticks: { font: { size: 11 }, callback: value => formatValue(value, cfg) },
          beginAtZero: true,
        },
      },
    };
  }

  return { create, createPrepared, aggregate, calcKPI, formatValue, setTheme, getTheme, getAllThemes, getColors, getBgColors };
})();
