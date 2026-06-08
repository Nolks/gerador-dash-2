/* ---------------------------------------------
   data-engine.js - Consultas analiticas com DuckDB-Wasm
--------------------------------------------- */
const DataEngine = (() => {
  const DUCKDB_VERSION = '1.32.0';
  const MODULE_URL =
    `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;

  let duckdb = null;
  let db = null;
  let conn = null;
  let sourceFileName = '';
  let active = false;
  let rowCount = 0;
  let columns = [];
  let columnTypes = {};
  let columnConfig = {};

  function quoteId(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function quoteString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  function safeInt(value, fallback, max = 10000) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(parsed, max));
  }

  function normalizeValue(value) {
    if (typeof value === 'bigint') {
      const number = Number(value);
      return Number.isSafeInteger(number) ? number : value.toString();
    }
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  function arrowToRows(table) {
    return table.toArray().map(row => {
      const json = row.toJSON();
      return Object.fromEntries(
        Object.entries(json).map(([key, value]) => [key, normalizeValue(value)])
      );
    });
  }

  function duckTypeToApp(type) {
    const t = String(type).toUpperCase();
    if (/TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|DECIMAL|FLOAT|DOUBLE|REAL/.test(t)) {
      return 'number';
    }
    if (/DATE|TIME|TIMESTAMP|INTERVAL/.test(t)) return 'date';
    return 'string';
  }

  async function init(onProgress = () => {}) {
    if (db && conn) return;
    onProgress('Carregando motor analitico...');
    duckdb = await import(MODULE_URL);
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const worker = await duckdb.createWorker(bundle.mainWorker);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    conn = await db.connect();
  }

  async function reset() {
    active = false;
    rowCount = 0;
    columns = [];
    columnTypes = {};
    columnConfig = {};
    if (!conn || !db) return;
    try { await conn.query('DROP VIEW IF EXISTS dash_data'); } catch (_) {}
    try { await conn.query('DROP VIEW IF EXISTS dash_source'); } catch (_) {}
    try { await conn.query('DROP TABLE IF EXISTS dash_source'); } catch (_) {}
    if (sourceFileName) {
      try { await db.dropFile(sourceFileName); } catch (_) {}
    }
    sourceFileName = '';
  }

  async function loadFile(file, onProgress = () => {}) {
    await init(onProgress);
    await reset();

    sourceFileName = `dash_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    onProgress('Registrando arquivo no motor...');
    await db.registerFileHandle(
      sourceFileName,
      file,
      duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
      true
    );

    const lower = file.name.toLowerCase();
    const scan = lower.endsWith('.parquet')
      ? `read_parquet(${quoteString(sourceFileName)})`
      : `read_csv_auto(${quoteString(sourceFileName)}, header=true, sample_size=100000)`;

    onProgress('Detectando colunas e tipos...');
    await conn.query(`CREATE TABLE dash_source AS SELECT * FROM ${scan}`);
    const schemaRows = arrowToRows(await conn.query('DESCRIBE SELECT * FROM dash_source'));
    columns = schemaRows.map(row => row.column_name);
    columnTypes = Object.fromEntries(
      schemaRows.map(row => [row.column_name, duckTypeToApp(row.column_type)])
    );
    columnConfig = { ...columnTypes };
    await rebuildView(columnConfig);

    onProgress('Contando registros...');
    rowCount = Number((await queryRows('SELECT COUNT(*) AS total FROM dash_data'))[0]?.total ?? 0);
    active = true;

    return {
      columns: [...columns],
      columnTypes: { ...columnTypes },
      rowCount,
      previewRows: await queryRows('SELECT * FROM dash_data LIMIT 200'),
    };
  }

  async function rebuildView(config) {
    columnConfig = { ...config };
    const projections = columns
      .filter(col => columnConfig[col] !== 'excluded')
      .map(col => {
        const id = quoteId(col);
        const type = columnConfig[col] ?? columnTypes[col];
        if (type === 'number') {
          const text = `TRIM(REPLACE(CAST(${id} AS VARCHAR), 'R$', ''))`;
          return `TRY_CAST(CASE WHEN POSITION(',' IN ${text}) > 0 THEN REPLACE(REPLACE(${text}, '.', ''), ',', '.') ELSE ${text} END AS DOUBLE) AS ${id}`;
        }
        if (type === 'date') return `TRY_CAST(${id} AS TIMESTAMP) AS ${id}`;
        return `CAST(${id} AS VARCHAR) AS ${id}`;
      });

    if (!projections.length) throw new Error('Mantenha ao menos uma coluna no conjunto de dados.');
    await conn.query('DROP VIEW IF EXISTS dash_data');
    await conn.query(`CREATE VIEW dash_data AS SELECT ${projections.join(', ')} FROM dash_source`);
  }

  function buildWhere(activeFilter, crossFilter) {
    const clauses = [];
    if (activeFilter?.col && String(activeFilter.value ?? '').trim() !== '') {
      const col = quoteId(activeFilter.col);
      const value = String(activeFilter.value).trim();
      const textValue = quoteString(value.toLowerCase());
      const numeric = Number(value.replace(',', '.'));
      switch (activeFilter.op) {
        case 'contains':
          clauses.push(`LOWER(CAST(${col} AS VARCHAR)) LIKE '%' || ${textValue} || '%'`);
          break;
        case 'starts':
          clauses.push(`LOWER(CAST(${col} AS VARCHAR)) LIKE ${textValue} || '%'`);
          break;
        case 'equals':
          clauses.push(`LOWER(CAST(${col} AS VARCHAR)) = ${textValue}`);
          break;
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          if (!Number.isFinite(numeric)) break;
          const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
          clauses.push(`TRY_CAST(${col} AS DOUBLE) ${operators[activeFilter.op]} ${numeric}`);
          break;
        }
        default:
          break;
      }
    }
    if (crossFilter?.col) {
      clauses.push(
        `CAST(${quoteId(crossFilter.col)} AS VARCHAR) = ${quoteString(crossFilter.value)}`
      );
    }
    return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  }

  async function queryRows(sql) {
    if (!conn) throw new Error('Motor de dados nao inicializado.');
    return arrowToRows(await conn.query(sql));
  }

  async function count(activeFilter, crossFilter) {
    const where = buildWhere(activeFilter, crossFilter);
    const result = await queryRows(`SELECT COUNT(*) AS total FROM dash_data${where}`);
    return Number(result[0]?.total ?? 0);
  }

  async function aggregate(config, activeFilter, crossFilter) {
    const sourceId = quoteId(config.xColumn);
    const yCols = (config.yColumns ?? []).filter(Boolean);
    const where = buildWhere(activeFilter, crossFilter);
    const agg = ['sum', 'avg', 'count', 'max', 'min'].includes(config.aggregation)
      ? config.aggregation.toUpperCase()
      : 'SUM';
    const dateGroup = ['day', 'week', 'month', 'quarter', 'year'].includes(config.dateGroup)
      ? config.dateGroup
      : 'none';
    const timestampExpr = `TRY_CAST(${sourceId} AS TIMESTAMP)`;
    const dateExpressions = {
      day: `STRFTIME(${timestampExpr}, '%Y-%m-%d')`,
      week: `STRFTIME(${timestampExpr}, '%G S%V')`,
      month: `STRFTIME(${timestampExpr}, '%Y-%m')`,
      quarter: `STRFTIME(${timestampExpr}, '%Y') || ' T' || CAST(QUARTER(${timestampExpr}) AS VARCHAR)`,
      year: `STRFTIME(${timestampExpr}, '%Y')`,
    };
    const groupExpr = dateGroup === 'none'
      ? `COALESCE(CAST(${sourceId} AS VARCHAR), '(vazio)')`
      : `COALESCE(${dateExpressions[dateGroup]}, '(data inválida)')`;
    const measures = yCols.map(col => {
      const id = quoteId(col);
      const expr = agg === 'COUNT' ? 'COUNT(*)' : `${agg}(${id})`;
      return `${expr} AS ${id}`;
    });
    const limit = safeInt(config.limit, 20, 1000);
    const direction = config.sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderExpr = config.sortBy === 'label' || !yCols.length ? 'label' : quoteId(yCols[0]);
    const showOthers = Boolean(config.showOthers) && ['SUM', 'COUNT'].includes(agg) && yCols.length;

    if (showOthers) {
      const selectedMeasures = yCols.map(quoteId).join(', ');
      const otherMeasures = yCols.map(col => `SUM(${quoteId(col)}) AS ${quoteId(col)}`).join(', ');
      return queryRows(`
        WITH grouped AS (
          SELECT ${groupExpr} AS label, ${measures.join(', ')}
          FROM dash_data${where}
          GROUP BY 1
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER (ORDER BY ${orderExpr} ${direction}) AS rn
          FROM grouped
        ), combined AS (
          SELECT label, ${selectedMeasures}, rn AS sort_order FROM ranked WHERE rn <= ${limit}
          UNION ALL
          SELECT 'Outros' AS label, ${otherMeasures}, ${limit + 1} AS sort_order FROM ranked WHERE rn > ${limit}
        )
        SELECT label, ${selectedMeasures} FROM combined
        WHERE label <> 'Outros' OR EXISTS (SELECT 1 FROM ranked WHERE rn > ${limit})
        ORDER BY sort_order
      `);
    }

    return queryRows(`
      SELECT ${groupExpr} AS label, ${measures.join(', ')}
      FROM dash_data${where}
      GROUP BY 1
      ORDER BY ${orderExpr} ${direction}
      LIMIT ${limit}
    `);
  }

  async function kpi(config, activeFilter, crossFilter, unfiltered = false) {
    const col = quoteId(config.column);
    const agg = ['sum', 'avg', 'count', 'max', 'min'].includes(config.kpiAgg)
      ? config.kpiAgg.toUpperCase()
      : 'SUM';
    const expression = agg === 'COUNT' ? `COUNT(${col})` : `${agg}(${col})`;
    const where = unfiltered ? '' : buildWhere(activeFilter, crossFilter);
    const rows = await queryRows(`SELECT ${expression} AS value, COUNT(*) AS rows FROM dash_data${where}`);
    return { value: rows[0]?.value ?? null, rows: Number(rows[0]?.rows ?? 0) };
  }

  async function table(config, page, activeFilter, crossFilter) {
    const selected = (config.columns ?? []).filter(Boolean);
    const cols = selected.length ? selected : columns.slice(0, 6);
    const limit = safeInt(config.rowLimit, 15, 500);
    const offset = Math.max(0, safeInt(page, 0, 10000000) * limit);
    const where = buildWhere(activeFilter, crossFilter);
    const [rows, total] = await Promise.all([
      queryRows(
        `SELECT ${cols.map(quoteId).join(', ')} FROM dash_data${where} LIMIT ${limit} OFFSET ${offset}`
      ),
      count(activeFilter, crossFilter),
    ]);
    return { rows, total, columns: cols, limit, offset };
  }

  async function scatter(config, activeFilter, crossFilter) {
    const x = quoteId(config.xColumn);
    const y = quoteId(config.yColumns?.[0]);
    const where = buildWhere(activeFilter, crossFilter);
    const conditions = where
      ? `${where} AND ${x} IS NOT NULL AND ${y} IS NOT NULL`
      : ` WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL`;
    const limit = safeInt(config.limit, 100, 5000);
    return queryRows(`
      SELECT TRY_CAST(${x} AS DOUBLE) AS x, TRY_CAST(${y} AS DOUBLE) AS y
      FROM dash_data${conditions}
      LIMIT ${limit}
    `);
  }

  function isActive() {
    return active;
  }

  function getRowCount() {
    return rowCount;
  }

  return {
    loadFile,
    reset,
    rebuildView,
    count,
    aggregate,
    kpi,
    table,
    scatter,
    isActive,
    getRowCount,
  };
})();
