const HTMLExportRuntime = (() => {
  function run(payload) {
    const charts = {};
    const filters = payload.widgetFilters && typeof payload.widgetFilters === 'object'
      ? JSON.parse(JSON.stringify(payload.widgetFilters))
      : {};
    let crossFilter = payload.crossFilter && typeof payload.crossFilter === 'object'
      ? { ...payload.crossFilter }
      : null;
    let activePage = Math.max(0, Math.min(payload.pages.length - 1, Number(payload.activePage) || 0));
    const icons = {
      bar: 'fa-chart-bar', line: 'fa-chart-line', area: 'fa-chart-area',
      pie: 'fa-chart-pie', doughnut: 'fa-circle-dot', scatter: 'fa-circle-nodes',
      kpi: 'fa-gauge-high', table: 'fa-table', text: 'fa-align-left',
      filter: 'fa-filter', image: 'fa-image', button: 'fa-link',
    };

    function esc(value) {
      return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function num(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      let text = String(value ?? '').trim().replace(/[^\d,.\-+eE]/g, '');
      if (!text) return null;
      if (text.includes('.') && text.includes(',')) {
        text = text.lastIndexOf(',') > text.lastIndexOf('.')
          ? text.replace(/\./g, '').replace(',', '.')
          : text.replace(/,/g, '');
      } else if ((text.match(/,/g) || []).length === 1) text = text.replace(',', '.');
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function time(value) {
      const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const second = Number(match[3] || 0);
      return hour < 24 && minute < 60 && second < 60 ? hour * 3600 + minute * 60 + second : null;
    }

    function date(value) {
      const text = String(value ?? '').trim();
      const br = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
      if (br) {
        const year = Number(br[3].length === 2 ? '20' + br[3] : br[3]);
        const parsed = new Date(year, Number(br[2]) - 1, Number(br[1]));
        return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
      }
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    }

    function typeOf(column) {
      return payload.columnConfig[column] || payload.columnTypes[column] || 'string';
    }

    function matches(row, column, filter) {
      const type = typeOf(column);
      const raw = row[column];
      if (filter.op === 'in') {
        if (!filter.values?.length) return true;
        if (type === 'number') {
          const current = num(raw);
          return filter.values.some(value => num(value) === current);
        }
        return filter.values.some(value => String(value) === String(raw ?? ''));
      }
      if (filter.op === 'between') {
        const parser = type === 'date' ? date : type === 'time' ? time : num;
        const current = parser(raw);
        const from = parser(filter.from);
        const to = parser(filter.to);
        return current !== null && (from === null || current >= from) && (to === null || current <= to);
      }
      return true;
    }

    function rowsFor(excludeWidget = '', excludeColumn = '') {
      return payload.rows.filter(row => {
        for (const [widgetId, group] of Object.entries(filters)) {
          for (const [column, filter] of Object.entries(group || {})) {
            if (widgetId === excludeWidget && column === excludeColumn) continue;
            if (!matches(row, column, filter)) return false;
          }
        }
        return !crossFilter || String(row[crossFilter.column] ?? '') === String(crossFilter.value);
      });
    }

    function format(value, config = {}) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      const decimals = Math.max(0, Math.min(6, Number(config.valueDecimals ?? config.decimals) || 0));
      if (config.valueFormat === 'currency') {
        return number.toLocaleString('pt-BR', {
          style: 'currency', currency: config.currency || 'BRL',
          minimumFractionDigits: decimals, maximumFractionDigits: decimals,
        });
      }
      if (config.valueFormat === 'percent') {
        const percent = config.percentScale === 'fraction' ? number * 100 : number;
        return percent.toLocaleString('pt-BR', {
          minimumFractionDigits: decimals, maximumFractionDigits: decimals,
        }) + '%';
      }
      if (config.valueFormat === 'compact') {
        return new Intl.NumberFormat('pt-BR', {
          notation: 'compact', maximumFractionDigits: Math.max(1, decimals),
        }).format(number);
      }
      return number.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      });
    }

    function kpiValue(rows, column, aggregation) {
      if (aggregation === 'count') return rows.filter(row => row[column] !== '' && row[column] != null).length;
      const values = rows.map(row => num(row[column])).filter(value => value !== null);
      if (!values.length) return null;
      if (aggregation === 'avg') return values.reduce((sum, value) => sum + value, 0) / values.length;
      if (aggregation === 'max') return Math.max(...values);
      if (aggregation === 'min') return Math.min(...values);
      return values.reduce((sum, value) => sum + value, 0);
    }

    function groupLabel(value, group) {
      if (!group || group === 'none') return String(value ?? '(vazio)');
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value ?? '(data inválida)');
      const year = parsed.getFullYear();
      if (group === 'year') return String(year);
      if (group === 'quarter') return `${year} T${Math.floor(parsed.getMonth() / 3) + 1}`;
      if (group === 'month') return `${year}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
      return parsed.toLocaleDateString('pt-BR');
    }

    function aggregate(rows, config) {
      const groups = new Map();
      for (const row of rows) {
        const label = groupLabel(row[config.xColumn], config.dateGroup);
        if (!groups.has(label)) groups.set(label, Object.fromEntries((config.yColumns || []).map(column => [column, []])));
        for (const column of config.yColumns || []) {
          const value = num(row[column]);
          if (config.aggregation === 'count') {
            if (row[column] !== '' && row[column] != null) groups.get(label)[column].push(1);
          } else if (value !== null) groups.get(label)[column].push(value);
        }
      }
      let result = [...groups.entries()].map(([label, values]) => {
        const item = { label };
        for (const column of config.yColumns || []) {
          const list = values[column];
          if (!list.length) item[column] = 0;
          else if (config.aggregation === 'avg') item[column] = list.reduce((a, b) => a + b, 0) / list.length;
          else if (config.aggregation === 'max') item[column] = Math.max(...list);
          else if (config.aggregation === 'min') item[column] = Math.min(...list);
          else item[column] = list.reduce((a, b) => a + b, 0);
        }
        return item;
      });
      const metric = config.yColumns?.[0];
      if (config.sortBy === 'label') result.sort((a, b) => String(a.label).localeCompare(String(b.label), 'pt-BR', { numeric: true }));
      else if (config.sortBy !== 'none' && metric) result.sort((a, b) => Number(a[metric]) - Number(b[metric]));
      if ((config.sortDir || 'desc') === 'desc') result.reverse();
      return result.slice(0, Math.max(1, Number(config.limit) || 15));
    }

    function colors(values, config, fallback) {
      if (!config.conditionalEnabled) return fallback;
      const threshold = Number(config.conditionalValue);
      return values.map(value => Number(value) >= threshold
        ? config.conditionalAboveColor || '#22c55e'
        : config.conditionalBelowColor || '#ef4444');
    }

    function renderChart(body, widget, rows) {
      if (!window.Chart) {
        body.innerHTML = '<div class="x-empty">Chart.js não pôde ser carregado.</div>';
        return;
      }
      const config = widget.config || {};
      const canvas = document.createElement('canvas');
      body.appendChild(canvas);
      const chartType = widget.type === 'area' ? 'line' : widget.type;
      let data;
      if (widget.type === 'scatter') {
        const xColumn = config.xColumn;
        const yColumn = config.yColumns?.[0];
        data = { datasets: [{
          label: `${xColumn} vs ${yColumn}`,
          data: rows.map(row => ({ x: num(row[xColumn]), y: num(row[yColumn]) }))
            .filter(point => point.x !== null && point.y !== null)
            .slice(0, Number(config.limit) || 100),
          backgroundColor: payload.primary + 'aa',
        }] };
      } else {
        const prepared = aggregate(rows, config);
        const labels = prepared.map(item => item.label);
        if (['pie', 'doughnut'].includes(widget.type)) {
          const metric = config.yColumns?.[0];
          const values = prepared.map(item => Number(item[metric] || 0));
          const palette = ['#6366f1','#8b5cf6','#a78bfa','#818cf8','#4f46e5','#7c3aed','#c4b5fd','#60a5fa'];
          data = { labels, datasets: [{ data: values, backgroundColor: colors(values, config, palette), borderColor: '#fff', borderWidth: 2 }] };
        } else {
          data = { labels, datasets: (config.yColumns || []).map((column, index) => {
            const values = prepared.map(item => Number(item[column] || 0));
            const color = index ? '#8b5cf6' : payload.primary;
            return {
              label: column, data: values,
              backgroundColor: colors(values, config, widget.type === 'bar' ? color + 'cc' : color + '28'),
              pointBackgroundColor: colors(values, config, color),
              borderColor: color, borderWidth: widget.type === 'bar' ? 0 : 2,
              borderRadius: widget.type === 'bar' ? 5 : 0, tension: .35, fill: widget.type === 'area',
            };
          }) };
        }
      }
      charts[widget.id] = new Chart(canvas, {
        type: chartType, data,
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: widget.type === 'bar' && config.barOrientation === 'horizontal' ? 'y' : 'x',
          plugins: {
            legend: { display: config.showLegend ?? true, position: ['pie','doughnut'].includes(widget.type) ? 'right' : 'top' },
            tooltip: { callbacks: { label: context => ` ${context.dataset.label || context.label}: ${format(context.raw, config)}` } },
          },
          scales: ['pie','doughnut'].includes(widget.type) ? {} : {
            x: { grid: { display: config.showGrid ?? true } },
            y: { grid: { display: config.showGrid ?? true }, ticks: { callback: value => format(value, config) } },
          },
          onClick: (_, elements) => {
            if (!elements.length || widget.type === 'scatter' || (config.dateGroup && config.dateGroup !== 'none')) return;
            const label = data.labels?.[elements[0].index];
            if (label === undefined || !config.xColumn) return;
            crossFilter = { column: config.xColumn, value: String(label) };
            if (config.drillThrough && config.drillPageId) {
              const target = payload.pages.findIndex(page => page.id === config.drillPageId);
              if (target >= 0) activePage = target;
            }
            renderPage();
          },
        },
      });
    }

    function renderKpi(body, widget, rows) {
      const config = widget.config || {};
      const value = kpiValue(rows, config.column, config.kpiAgg);
      const labels = { sum: 'Soma', avg: 'Média', count: 'Contagem', max: 'Máximo', min: 'Mínimo' };
      const suffix = config.valueFormat === 'percent' && String(config.suffix || '').trim() === '%'
        ? ''
        : config.suffix || '';
      body.innerHTML = `<div class="x-kpi">
        <strong>${esc(config.prefix || '')}${format(value, config)}${esc(suffix)}</strong>
        <span>${esc(config.column || '')}</span>
        ${config.showSummary === false ? '' : `<small>${labels[config.kpiAgg] || ''} · ${rows.length.toLocaleString('pt-BR')} linhas</small>`}
      </div>`;
    }

    function renderTable(body, widget, rows) {
      const config = widget.config || {};
      const configured = (config.columns || []).filter(column => payload.columns.includes(column));
      const columns = configured.length ? configured : payload.columns.slice(0, 6);
      const visible = rows.slice(0, Number(config.rowLimit) || 15);
      body.innerHTML = `<div class="x-table"><table><thead><tr>${columns.map(column => `<th>${esc(column)}</th>`).join('')}</tr></thead>
        <tbody>${visible.map(row => `<tr>${columns.map(column => `<td>${esc(row[column] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="x-table-count">${visible.length.toLocaleString('pt-BR')} de ${rows.length.toLocaleString('pt-BR')} linhas</div>`;
    }

    function renderFilter(body, widget) {
      const config = widget.config || {};
      const columns = (config.columns || []).filter(column => payload.columns.includes(column));
      const wrapper = document.createElement('div');
      wrapper.className = `x-filter ${config.orientation === 'horizontal' ? 'horizontal' : 'vertical'}`;
      const controls = document.createElement('div');
      controls.className = 'x-filter-controls';
      for (const column of columns) {
        const field = document.createElement('label');
        field.className = 'x-filter-field';
        const title = document.createElement('span');
        title.textContent = column;
        field.appendChild(title);
        const current = filters[widget.id]?.[column];
        const type = typeOf(column);
        if (type === 'date' || type === 'time') {
          const range = document.createElement('div');
          range.className = 'x-range';
          for (const side of ['from', 'to']) {
            const input = document.createElement('input');
            input.type = type === 'time' ? 'time' : 'date';
            if (type === 'time') input.step = '1';
            input.value = current?.[side] || '';
            input.addEventListener('change', () => {
              filters[widget.id] ||= {};
              const value = filters[widget.id][column] || { op: 'between', from: '', to: '' };
              value[side] = input.value;
              if (value.from || value.to) filters[widget.id][column] = value;
              else delete filters[widget.id][column];
              renderPage();
            });
            range.appendChild(input);
          }
          field.appendChild(range);
        } else {
          const search = document.createElement('input');
          search.type = 'search';
          search.placeholder = 'Pesquisar...';
          search.className = 'x-filter-search';
          const options = document.createElement('div');
          options.className = 'x-filter-options';
          const sourceRows = config.dependent === false ? payload.rows : rowsFor(widget.id, column);
          const values = [...new Set(sourceRows.map(row => String(row[column] ?? '')).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).slice(0, 500);
          const selected = new Set(current?.op === 'in' ? current.values.map(String) : []);
          for (const value of values) {
            const option = document.createElement('label');
            option.dataset.text = value.toLowerCase();
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selected.has(value);
            checkbox.addEventListener('change', () => {
              filters[widget.id] ||= {};
              const selectedValues = new Set(filters[widget.id][column]?.values || []);
              if (checkbox.checked) selectedValues.add(value); else selectedValues.delete(value);
              if (selectedValues.size) filters[widget.id][column] = { op: 'in', values: [...selectedValues] };
              else delete filters[widget.id][column];
              renderPage();
            });
            const text = document.createElement('span');
            text.textContent = value;
            option.append(checkbox, text);
            options.appendChild(option);
          }
          search.addEventListener('input', () => {
            const query = search.value.trim().toLowerCase();
            options.querySelectorAll('label').forEach(option => {
              option.hidden = query && !option.dataset.text.includes(query);
            });
          });
          if (config.showSearch !== false) field.appendChild(search);
          field.appendChild(options);
        }
        controls.appendChild(field);
      }
      const clear = document.createElement('button');
      clear.innerHTML = '<i class="fa-solid fa-eraser"></i> Limpar filtros';
      clear.addEventListener('click', () => {
        delete filters[widget.id];
        crossFilter = null;
        renderPage();
      });
      wrapper.append(controls, clear);
      body.appendChild(wrapper);
    }

    function markdown(value) {
      return esc(value || '').replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
    }

    function renderStatic(body, widget) {
      const config = widget.config || {};
      if (widget.type === 'text') {
        body.innerHTML = `<div class="x-text" style="font-size:${Number(config.fontSize) || 16}px;color:${config.color || '#334155'};background:${config.background || '#fff'};text-align:${config.align || 'left'}">${markdown(config.content)}</div>`;
      } else if (widget.type === 'image') {
        body.innerHTML = config.source
          ? `<div class="x-image" style="background:${config.background || '#fff'}"><img src="${esc(config.source)}" alt="${esc(config.alt || 'Imagem')}" style="object-fit:${config.fit || 'contain'}"></div>`
          : '<div class="x-empty">Imagem não configurada</div>';
      } else if (widget.type === 'button') {
        const button = document.createElement('button');
        button.className = 'x-link';
        button.style.background = config.background || payload.primary;
        button.style.color = config.textColor || '#fff';
        button.textContent = config.label || 'Abrir';
        button.addEventListener('click', () => {
          if (config.destinationType === 'external') window.open(config.url, '_blank', 'noopener');
          else {
            const target = payload.pages.findIndex(page => page.id === config.pageId);
            if (target >= 0) { activePage = target; renderPage(); }
          }
        });
        body.appendChild(button);
      }
    }

    function renderPage() {
      Object.values(charts).forEach(chart => chart?.destroy?.());
      Object.keys(charts).forEach(key => delete charts[key]);
      const page = payload.pages[activePage] || payload.pages[0];
      const nav = document.getElementById('x-pages');
      nav.innerHTML = '';
      payload.pages.forEach((item, index) => {
        const button = document.createElement('button');
        button.className = index === activePage ? 'active' : '';
        button.innerHTML = `<i class="fa-solid ${item.icon || 'fa-file'}"></i><span>${esc(item.name)}</span>`;
        button.addEventListener('click', () => { activePage = index; renderPage(); });
        nav.appendChild(button);
      });
      const grid = document.getElementById('x-grid');
      grid.innerHTML = '';
      const rows = rowsFor();
      let bottom = 300;
      for (const widget of page.widgets || []) {
        const layout = widget.layout || { x: 0, y: bottom, width: 420, height: 300 };
        const element = document.createElement('section');
        element.className = `x-widget x-widget-${widget.type}`;
        element.style.left = `${layout.x || 0}px`;
        element.style.top = `${layout.y || 0}px`;
        element.style.width = `${layout.width || 420}px`;
        element.style.height = `${layout.height || 300}px`;
        if (widget.type !== 'button') {
          const header = document.createElement('header');
          const selectedIcon = widget.config?.titleIcon;
          const icon = selectedIcon === 'none' ? '' : selectedIcon && selectedIcon !== 'auto'
            ? selectedIcon
            : icons[widget.type] || 'fa-chart-bar';
          header.innerHTML = `${icon ? `<i class="fa-solid ${icon}"></i>` : ''}<span>${esc(widget.title || '')}</span>`;
          element.appendChild(header);
        }
        const body = document.createElement('div');
        body.className = 'x-body';
        element.appendChild(body);
        grid.appendChild(element);
        if (widget.type === 'filter') renderFilter(body, widget);
        else if (widget.type === 'kpi') renderKpi(body, widget, rows);
        else if (widget.type === 'table') renderTable(body, widget, rows);
        else if (['bar','line','area','pie','doughnut','scatter'].includes(widget.type)) renderChart(body, widget, rows);
        else renderStatic(body, widget);
        bottom = Math.max(bottom, Number(layout.y || 0) + Number(layout.height || 300) + 20);
      }
      grid.style.height = `${bottom}px`;
      document.getElementById('x-count').textContent = `${rows.length.toLocaleString('pt-BR')} linhas visíveis`;
    }

    renderPage();
  }

  function source() {
    return `(${run.toString()})`;
  }

  function styles() {
    return `
      *{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#f1f5f9;color:#1e293b}
      .x-top{background:#1e293b;color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
      .x-brand{display:flex;align-items:center;gap:10px}.x-brand img{width:36px;height:36px;object-fit:contain}.x-brand small{display:block;color:#94a3b8;text-transform:uppercase;letter-spacing:1px}.x-brand strong{display:block;font-size:18px}
      .x-meta{font-size:12px;color:#cbd5e1}.x-pages{display:flex;gap:6px;padding:8px 20px;background:#fff;border-bottom:1px solid #e2e8f0;overflow:auto}
      .x-pages button{display:flex;align-items:center;gap:7px;padding:8px 13px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer}
      .x-pages button.active{color:#fff;background:var(--primary);border-color:var(--primary)}.x-warning{padding:9px 20px;color:#92400e;background:#fef3c7;font-size:12px}
      .x-main{padding:20px;overflow:auto}.x-grid{position:relative;min-width:1000px}.x-widget{position:absolute;display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(15,23,42,.1);overflow:hidden}
      .x-widget>header{display:flex;align-items:center;gap:8px;min-height:42px;padding:10px 14px 6px;color:#64748b;font-size:13px;font-weight:700}.x-widget>header i{color:var(--primary)}
      .x-body{flex:1;min-height:0;padding:0 14px 14px;display:flex;flex-direction:column;overflow:hidden}.x-body canvas{width:100%!important;height:100%!important}
      .x-kpi{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;text-align:center}.x-kpi strong{font-size:42px;color:var(--primary);line-height:1}.x-kpi span{color:#64748b}.x-kpi small{color:#94a3b8}
      .x-table{flex:1;overflow:auto;border:1px solid #e2e8f0;border-radius:8px}.x-table table{width:100%;border-collapse:collapse;font-size:12px}.x-table th,.x-table td{padding:7px 9px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:nowrap}.x-table th{position:sticky;top:0;background:#f8fafc}.x-table-count{text-align:right;color:#94a3b8;font-size:10px;margin-top:5px}
      .x-filter{height:100%;display:flex;flex-direction:column;gap:10px}.x-filter-controls{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px}.x-filter.horizontal .x-filter-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
      .x-filter-field{display:flex;flex-direction:column;gap:5px}.x-filter-field>span{font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase}.x-filter-search,.x-range input{width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:7px}
      .x-filter-options{max-height:140px;overflow:auto;padding:4px;border:1px solid #e2e8f0;border-radius:7px}.x-filter-options label{display:flex;gap:7px;padding:5px;font-size:11px}.x-filter-options label[hidden]{display:none}.x-range{display:grid;grid-template-columns:1fr 1fr;gap:5px}
      .x-filter>button{width:100%;max-width:290px;padding:8px;border:0;border-radius:7px;color:#fff;background:var(--primary);font-weight:700;cursor:pointer}
      .x-text,.x-image{width:100%;height:100%;padding:15px;overflow:auto;border-radius:8px}.x-image{display:flex;align-items:center;justify-content:center}.x-image img{width:100%;height:100%}
      .x-widget-button{background:transparent;box-shadow:none}.x-widget-button .x-body{padding:0;align-items:center;justify-content:center}.x-link{padding:12px 22px;border:0;border-radius:9px;font-weight:700;cursor:pointer;box-shadow:0 5px 14px rgba(15,23,42,.18)}
      .x-empty{margin:auto;color:#94a3b8}footer{text-align:center;padding:18px;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;background:#fff}
      @media(max-width:760px){.x-grid{min-width:0;height:auto!important}.x-widget{position:relative!important;left:auto!important;top:auto!important;width:100%!important;margin-bottom:15px}.x-main{padding:12px}}
    `;
  }

  return { source, styles };
})();
