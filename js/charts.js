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
  let customColor = '#6366f1';

  function normalizeHex(value) {
    const raw = String(value ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      return '#' + raw.split('').map(char => char + char).join('').toLowerCase();
    }
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toLowerCase();
    return null;
  }

  function hexToHsl(hex) {
    const normalized = normalizeHex(hex) ?? '#6366f1';
    const red = parseInt(normalized.slice(1, 3), 16) / 255;
    const green = parseInt(normalized.slice(3, 5), 16) / 255;
    const blue = parseInt(normalized.slice(5, 7), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (max === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
    }
    if (hue < 0) hue += 360;
    const lightness = (max + min) / 2;
    const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
    return { h: hue, s: saturation * 100, l: lightness * 100 };
  }

  function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const segment = ((hue % 360) + 360) % 360 / 60;
    const x = chroma * (1 - Math.abs(segment % 2 - 1));
    const match = l - chroma / 2;
    const values = segment < 1 ? [chroma, x, 0]
      : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
      : segment < 4 ? [0, x, chroma]
      : segment < 5 ? [x, 0, chroma]
      : [chroma, 0, x];
    return '#' + values.map(value =>
      Math.round((value + match) * 255).toString(16).padStart(2, '0')
    ).join('');
  }

  function buildCustomColors(hex) {
    const base = hexToHsl(hex);
    const saturation = Math.max(48, base.s);
    return [
      normalizeHex(hex),
      hslToHex(base.h + 24, saturation, clampLightness(base.l + 8)),
      hslToHex(base.h - 24, Math.max(42, saturation - 8), clampLightness(base.l + 14)),
      hslToHex(base.h + 52, Math.max(45, saturation - 4), clampLightness(base.l - 6)),
      hslToHex(base.h - 52, saturation, clampLightness(base.l - 12)),
      hslToHex(base.h + 180, Math.max(42, saturation - 18), clampLightness(base.l + 4)),
      hslToHex(base.h + 90, Math.max(40, saturation - 15), clampLightness(base.l + 12)),
      hslToHex(base.h - 90, Math.max(38, saturation - 20), clampLightness(base.l + 20)),
    ];
  }

  function clampLightness(value) {
    return Math.max(24, Math.min(78, value));
  }

  function setCustomTheme(value) {
    const normalized = normalizeHex(value);
    if (!normalized) return false;
    customColor = normalized;
    THEMES.custom = {
      name: 'Personalizada',
      swatch: normalized,
      colors: buildCustomColors(normalized),
    };
    return true;
  }

  setCustomTheme(customColor);

  function getColors(n = 8) {
    const base = THEMES[currentTheme]?.colors ?? THEMES.indigo.colors;
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }

  function setTheme(name) { currentTheme = THEMES[name] ? name : 'indigo'; }
  function getTheme() { return currentTheme; }
  function getCustomColor() { return customColor; }
  function getAllThemes() { return THEMES; }
  function getBgColors() { return BG_COLORS; }

  /* ── Agregação de dados ──────────────────── */
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    return ExcelParser.parseNumericValue(value);
  }

  function parseDateValue(value) {
    return ExcelParser.parseDateValue(value);
  }

  function isoWeekLabel(date) {
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const isoYear = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
    return isoYear + ' S' + String(week).padStart(2, '0');
  }

  function formatDateLabel(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  function dateGroupLabel(value, group, xType) {
    if (!group || group === 'none') {
      if (xType === 'date') {
        if (value === '' || value === null || value === undefined) return '(vazio)';
        const date = parseDateValue(value);
        return date ? formatDateLabel(date) : '(data inválida)';
      }
      const label = String(value ?? '').trim();
      return label || '(vazio)';
    }
    const date = parseDateValue(value);
    if (!date) return '(data inválida)';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    if (group === 'year') return String(year);
    if (group === 'quarter') return year + ' T' + (Math.floor(date.getMonth() / 3) + 1);
    if (group === 'month') return year + '-' + month;
    if (group === 'week') return isoWeekLabel(date);
    return year + '-' + month + '-' + String(date.getDate()).padStart(2, '0');
  }

  function aggregate(rows, xCol, yCols, agg = 'sum', limit = 20, sortBy = 'value', sortDir = 'desc', options = {}) {
    const groups = new Map();

    for (const row of rows) {
      const key = dateGroupLabel(row[xCol], options.dateGroup, options.xType);
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
      result.sort((a, b) => {
        const aPlaceholder = a.label === '(vazio)' || a.label === '(data inválida)';
        const bPlaceholder = b.label === '(vazio)' || b.label === '(data inválida)';
        if (options.xType === 'date' && aPlaceholder !== bPlaceholder) return aPlaceholder ? 1 : -1;
        let comparison;
        if (options.xType === 'date') {
          const aDate = parseDateValue(a.label);
          const bDate = parseDateValue(b.label);
          if (aDate && bDate) comparison = aDate - bDate;
        }
        comparison ??= String(a.label).localeCompare(String(b.label), 'pt-BR', { sensitivity: 'base', numeric: true });
        return sortDir === 'asc' ? comparison : -comparison;
      });
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

    if (agg === 'count') return count;
    if (!count) return null;
    switch (agg) {
      case 'sum': return sum;
      case 'avg': return sum / count;
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
        datasets: cfg.yColumns.map((col, i) => {
          const values = preparedRows.map(row => Number(row[col] ?? 0));
          const conditional = conditionalChartColors(values, cfg);
          return {
            label: col,
            data: values,
            backgroundColor: conditional ?? (type === 'bar' ? colors[i] + 'cc' : colors[i] + '33'),
            pointBackgroundColor: conditional ?? colors[i],
            borderColor: colors[i],
            borderWidth: type === 'bar' ? 0 : 2,
            borderRadius: type === 'bar' ? 6 : 0,
            fill: type === 'area',
            tension: 0.4,
            pointRadius: type === 'line' || type === 'area' ? 4 : 0,
            pointHoverRadius: 6,
          };
        }),
      };
    } else if (['pie', 'doughnut'].includes(type)) {
      const valueCol = cfg.yColumns?.[0];
      const values = preparedRows.map(row => Number(row[valueCol] ?? 0));
      data = {
        labels: preparedRows.map(row => row.label),
        datasets: [{
          data: values,
          backgroundColor: conditionalChartColors(values, cfg) ?? colors.map(color => color + 'dd'),
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
    const xType = typeof App !== 'undefined'
      ? App.state.columnConfig[cfg.xColumn] ?? App.state.columnTypes[cfg.xColumn]
      : cfg.xType;
    const aggregationOptions = { ...cfg, xType };

    if (['bar', 'line', 'area'].includes(type)) {
      if (!cfg.xColumn || !cfg.yColumns?.length) return null;
      const agg = aggregate(rows, cfg.xColumn, cfg.yColumns, cfg.aggregation, cfg.limit, cfg.sortBy, cfg.sortDir, aggregationOptions);
      const labels = agg.map(r => r.label);

      const datasets = cfg.yColumns.map((col, i) => {
        const values = agg.map(r => r[col]);
        const conditional = conditionalChartColors(values, cfg);
        return {
          label: col,
          data: values,
          backgroundColor: conditional ?? (type === 'bar' ? colors[i] + 'cc' : colors[i] + '33'),
          pointBackgroundColor: conditional ?? colors[i],
          borderColor: colors[i],
          borderWidth: type === 'bar' ? 0 : 2,
          borderRadius: type === 'bar' ? 6 : 0,
          fill: type === 'area',
          tension: 0.4,
          pointRadius: type === 'line' || type === 'area' ? 4 : 0,
          pointHoverRadius: 6,
        };
      });

      return { labels, datasets };
    }

    if (['pie', 'doughnut'].includes(type)) {
      if (!cfg.xColumn || !cfg.yColumns?.length) return null;
      const agg = aggregate(rows, cfg.xColumn, cfg.yColumns, cfg.aggregation, cfg.limit, cfg.sortBy, cfg.sortDir, aggregationOptions);
      const values = agg.map(r => r[cfg.yColumns[0]]);
      return {
        labels: agg.map(r => r.label),
        datasets: [{
          data: values,
          backgroundColor: conditionalChartColors(values, cfg) ?? colors.map(c => c + 'dd'),
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
      for (const row of rows) {
        const x = toNumber(row[xCol]);
        const y = toNumber(row[yCol]);
        if (x === null || y === null) continue;
        pts.push({ x, y });
        if (pts.length >= limit) break;
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
      const percent = cfg.percentScale === 'fraction' ? number * 100 : number;
      return percent.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';
    }
    if (cfg.valueFormat === 'compact') return ExcelParser.fmtNumber(number, decimals);
    return number.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function conditionalChartColors(values, cfg) {
    if (!cfg.conditionalEnabled) return null;
    const threshold = Number(cfg.conditionalValue);
    if (!Number.isFinite(threshold)) return null;
    return values.map(value => Number(value) >= threshold
      ? cfg.conditionalAboveColor ?? '#22c55e'
      : cfg.conditionalBelowColor ?? '#ef4444');
  }

  function buildOptions(widget, colors) {
    const cfg     = widget.config;
    const type    = widget.type;
    const isRound = ['pie', 'doughnut'].includes(type);
    const isHorizontalBar = type === 'bar' && cfg.barOrientation === 'horizontal';

    // Filtro cruzado: clique em barra/fatia/ponto filtra todos os widgets
    const xCol = cfg.xColumn;
    const onClick = type !== 'scatter' && (!cfg.dateGroup || cfg.dateGroup === 'none') ? (event, elements) => {
      if (!elements.length) return;
      const idx   = elements[0].index;
      const label = event.chart.data.labels?.[idx];
      if (label !== undefined && xCol) {
        if (cfg.drillThrough && cfg.drillPageId) Dashboard.drillThrough(cfg.drillPageId, xCol, String(label));
        else App.setCrossFilter(xCol, String(label));
      }
    } : undefined;

    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: type === 'bar' && cfg.barOrientation === 'horizontal' ? 'y' : 'x',
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
      } : {}) : isHorizontalBar ? {
        x: {
          grid: { display: cfg.showGrid ?? true, color: '#f1f5f9' },
          ticks: { font: { size: 11 }, callback: value => formatValue(value, cfg) },
          beginAtZero: true,
        },
        y: {
          grid: { display: cfg.showGrid ?? true, color: '#f1f5f9' },
          ticks: { font: { size: 11 } },
        },
      } : {
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

  return {
    create, createPrepared, aggregate, calcKPI, formatValue,
    setTheme, setCustomTheme, getTheme, getCustomColor,
    getAllThemes, getColors, getBgColors,
  };
})();
