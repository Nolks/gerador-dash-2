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
  let sourceFileNames = [];
  let active = false;
  let rowCount = 0;
  let columns = [];
  let baseColumns = [];
  let sourceColumns = {};
  let columnTypes = {};
  let columnConfig = {};
  let queryQueue = Promise.resolve();
  const ROW_ID = '__dashgen_row_id';

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
    if (/^TIME(?:\s|$|\()/.test(t)) return 'time';
    if (/DATE|TIMESTAMP|INTERVAL/.test(t)) return 'date';
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
    baseColumns = [];
    sourceColumns = {};
    columnTypes = {};
    columnConfig = {};
    queryQueue = Promise.resolve();
    if (!conn || !db) return;
    try { await conn.query('DROP VIEW IF EXISTS dash_data'); } catch (_) {}
    try { await conn.query('DROP VIEW IF EXISTS dash_source'); } catch (_) {}
    try { await conn.query('DROP TABLE IF EXISTS dash_source'); } catch (_) {}
    for (const sourceFileName of sourceFileNames) {
      try { await db.dropFile(sourceFileName); } catch (_) {}
    }
    sourceFileNames = [];
  }

  async function loadFile(file, onProgress = () => {}) {
    return loadFiles([{ file, name: file.name }], onProgress);
  }

  async function loadFiles(sources, onProgress = () => {}) {
    if (!Array.isArray(sources) || !sources.length) throw new Error('Nenhum arquivo informado.');
    await init(onProgress);
    await reset();

    const registered = [];
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      const sourceFileName = `dash_${Date.now()}_${index}_${source.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      sourceFileNames.push(sourceFileName);
      onProgress(`Registrando arquivo ${index + 1} de ${sources.length}...`);
      await db.registerFileHandle(
        sourceFileName,
        source.file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
        true
      );
      const lower = source.file.name.toLowerCase();
      const scan = lower.endsWith('.parquet')
        ? `read_parquet(${quoteString(sourceFileName)})`
        : `read_csv_auto(${quoteString(sourceFileName)}, header=true, sample_size=100000, all_varchar=true)`;
      const schemaRows = arrowToRows(await conn.query(`DESCRIBE SELECT * FROM ${scan}`));
      const originalColumns = schemaRows.map(row => row.column_name);
      const normalizedColumns = ExcelParser.normalizeHeaders(originalColumns);
      registered.push({ ...source, scan, originalColumns, normalizedColumns });
    }

    const expectedColumns = registered[0].normalizedColumns;
    const incompatible = registered.find(source =>
      source.normalizedColumns.length !== expectedColumns.length ||
      source.normalizedColumns.some((column, index) => column !== expectedColumns[index])
    );
    if (incompatible) {
      throw new Error(`As colunas de "${incompatible.file.name}" não são compatíveis com o primeiro arquivo.`);
    }

    const includeSourceColumn = registered.length > 1;
    let sourceColumn = includeSourceColumn ? 'Fonte' : null;
    let suffix = 2;
    while (sourceColumn && expectedColumns.includes(sourceColumn)) sourceColumn = `Fonte (${suffix++})`;
    const unions = registered.map(source => {
      const projections = source.originalColumns.map((original, index) =>
        `CAST(${quoteId(original)} AS VARCHAR) AS ${quoteId(expectedColumns[index])}`
      );
      if (sourceColumn) {
        projections.push(`${quoteString(source.name || source.file.name)} AS ${quoteId(sourceColumn)}`);
      }
      return `SELECT ${projections.join(', ')} FROM ${source.scan}`;
    });

    onProgress('Empilhando tabelas compatíveis...');
    await conn.query(`CREATE TABLE dash_source AS
      SELECT ROW_NUMBER() OVER () AS ${quoteId(ROW_ID)}, combined.*
      FROM (${unions.join(' UNION ALL ')}) AS combined`);
    const schemaRows = arrowToRows(await conn.query('DESCRIBE SELECT * FROM dash_source'));
    const visibleSchemaRows = schemaRows.filter(row => row.column_name !== ROW_ID);
    const originalColumns = visibleSchemaRows.map(row => row.column_name);
    baseColumns = ExcelParser.normalizeHeaders(originalColumns);
    columns = [...baseColumns];
    sourceColumns = Object.fromEntries(baseColumns.map((column, index) => [column, originalColumns[index]]));
    const sampleRows = arrowToRows(await conn.query(
      `SELECT ${baseColumns.map(column => `${quoteId(sourceColumns[column])} AS ${quoteId(column)}`).join(', ')}
       FROM dash_source ORDER BY ${quoteId(ROW_ID)} LIMIT 200`
    ));
    const sampledTypes = ExcelParser.detectTypes(sampleRows);
    columnTypes = Object.fromEntries(
      visibleSchemaRows.map((row, index) => {
        const column = baseColumns[index];
        const nativeType = duckTypeToApp(row.column_type);
        return [column, nativeType === 'string' ? sampledTypes[column] ?? 'string' : nativeType];
      })
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
      sourceColumn,
    };
  }

  function numericCastExpression(id) {
    const raw = `TRIM(REGEXP_REPLACE(CAST(${id} AS VARCHAR), '(R\\$|US\\$|BRL|USD|EUR|GBP|JPY|[$€£¥%]|\\s)', '', 'gi'))`;
    const text = `REGEXP_REPLACE(${raw}, '[()]', '', 'g')`;
    const unsigned = `REGEXP_REPLACE(${text}, '^\\+', '')`;
    const normalized = `CASE
      WHEN REGEXP_MATCHES(${unsigned}, '^-?[0-9]+([eE][+-]?[0-9]+)?$') THEN ${unsigned}
      WHEN REGEXP_MATCHES(${unsigned}, '^-?[1-9][0-9]{0,2}(\\.[0-9]{3})+$') THEN REPLACE(${unsigned}, '.', '')
      WHEN REGEXP_MATCHES(${unsigned}, '^-?[1-9][0-9]{0,2}(,[0-9]{3})+$') THEN REPLACE(${unsigned}, ',', '')
      WHEN POSITION('.' IN ${unsigned}) > 0 AND POSITION(',' IN ${unsigned}) > 0
        AND REGEXP_MATCHES(${unsigned}, '\\.[0-9]+$') THEN REPLACE(${unsigned}, ',', '')
      WHEN POSITION('.' IN ${unsigned}) > 0 AND POSITION(',' IN ${unsigned}) > 0
        THEN REPLACE(REPLACE(${unsigned}, '.', ''), ',', '.')
      WHEN POSITION(',' IN ${unsigned}) > 0 THEN REPLACE(${unsigned}, ',', '.')
      ELSE ${unsigned}
    END`;
    const signed = `CASE WHEN REGEXP_MATCHES(${raw}, '^\\(.*\\)$') AND NOT STARTS_WITH(${normalized}, '-') THEN '-' || ${normalized} ELSE ${normalized} END`;
    return `TRY_CAST(${signed} AS DOUBLE)`;
  }

  function dateCastExpression(id) {
    const text = `TRIM(CAST(${id} AS VARCHAR))`;
    return `COALESCE(
      TRY_CAST(${id} AS TIMESTAMP),
      TRY_STRPTIME(${text}, '%d/%m/%Y %H:%M:%S'),
      TRY_STRPTIME(${text}, '%d/%m/%Y %H:%M'),
      TRY_STRPTIME(${text}, '%d/%m/%Y'),
      TRY_STRPTIME(${text}, '%d-%m-%Y'),
      TRY_STRPTIME(${text}, '%d.%m.%Y'),
      TRY_STRPTIME(${text}, '%Y/%m/%d'),
      TRY_STRPTIME(${text}, '%Y.%m.%d')
    )`;
  }

  function dateToSqlTimestamp(value) {
    const date = ExcelParser.parseDateValue(value);
    if (!date) return null;
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ];
    const time = [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join(':');
    return `${parts[0]}-${parts[1]}-${parts[2]} ${time}`;
  }

  function timeCastExpression(id) {
    return `TRY_CAST(TRIM(CAST(${id} AS VARCHAR)) AS TIME)`;
  }

  function timeToSqlTime(value) {
    const total = ExcelParser.parseTimeValue(value);
    if (total === null) return null;
    const hour = String(Math.floor(total / 3600)).padStart(2, '0');
    const minute = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const second = String(total % 60).padStart(2, '0');
    return `${hour}:${minute}:${second}`;
  }

  function formulaSql(formula, visibleColumns) {
    ExcelParser.validateFormula(formula, visibleColumns);
    return ExcelParser.tokenizeFormula(formula).map(token => {
      if (token.type === 'column') return `COALESCE(TRY_CAST(${quoteId(token.value)} AS DOUBLE), 0)`;
      if (token.type === 'number') return String(token.value);
      return token.value;
    }).join(' ');
  }

  async function rebuildView(config, calculatedFields = []) {
    columnConfig = { ...config };
    const visibleBaseColumns = baseColumns
      .filter(col => columnConfig[col] !== 'excluded')
    const visibleProjections = visibleBaseColumns
      .map(col => {
        const id = quoteId(sourceColumns[col] ?? col);
        const alias = quoteId(col);
        const type = columnConfig[col] ?? columnTypes[col];
        if (type === 'number') {
          return `${numericCastExpression(id)} AS ${alias}`;
        }
        if (type === 'date') return `CAST(${id} AS VARCHAR) AS ${alias}`;
        return `CAST(${id} AS VARCHAR) AS ${alias}`;
      });

    if (!visibleProjections.length) throw new Error('Mantenha ao menos uma coluna no conjunto de dados.');
    const baseProjections = [`${quoteId(ROW_ID)}`, ...visibleProjections];
    const calculatedProjections = calculatedFields.map(field =>
      `TRY_CAST((${formulaSql(field.formula, visibleBaseColumns)}) AS DOUBLE) AS ${quoteId(field.name)}`
    );
    columns = [...visibleBaseColumns, ...calculatedFields.map(field => field.name)];
    calculatedFields.forEach(field => {
      columnTypes[field.name] = 'number';
      columnConfig[field.name] = 'number';
    });
    await conn.query('DROP VIEW IF EXISTS dash_data');
    await conn.query(`CREATE VIEW dash_data AS
      SELECT base_data.*${calculatedProjections.length ? `, ${calculatedProjections.join(', ')}` : ''}
      FROM (SELECT ${baseProjections.join(', ')} FROM dash_source) AS base_data`);
  }

  function buildWhere(activeFilter, crossFilter) {
    const clauses = [];
    const filters = (Array.isArray(activeFilter) ? activeFilter : [activeFilter]).filter(Boolean);
    filters.forEach(activeFilter => {
    if (activeFilter?.col && (
      (activeFilter.op === 'in' && Array.isArray(activeFilter.values) && activeFilter.values.length) ||
      (activeFilter.op === 'between' && (activeFilter.from || activeFilter.to)) ||
      String(activeFilter.value ?? '').trim() !== ''
    )) {
      const col = quoteId(activeFilter.col);
      const value = String(activeFilter.value).trim();
      const textValue = quoteString(value.toLowerCase());
      const numeric = ExcelParser.parseNumericValue(value);
      const type = columnConfig[activeFilter.col] ?? columnTypes[activeFilter.col];
      const dateValue = type === 'date' ? dateToSqlTimestamp(value) : null;
      const timeValue = type === 'time' ? timeToSqlTime(value) : null;
      switch (activeFilter.op) {
        case 'in': {
          const values = activeFilter.values ?? [];
          if (!values.length) break;
          if (type === 'number') {
            const numericValues = values.map(ExcelParser.parseNumericValue).filter(item => item !== null);
            if (numericValues.length) clauses.push(`${col} IN (${numericValues.join(', ')})`);
          } else {
            clauses.push(`LOWER(TRIM(CAST(${col} AS VARCHAR))) IN (${values.map(item => quoteString(String(item).toLowerCase().trim())).join(', ')})`);
          }
          break;
        }
        case 'between': {
          const from = type === 'date'
            ? dateToSqlTimestamp(activeFilter.from)
            : type === 'time' ? timeToSqlTime(activeFilter.from) : ExcelParser.parseNumericValue(activeFilter.from);
          const to = type === 'date'
            ? dateToSqlTimestamp(activeFilter.to)
            : type === 'time' ? timeToSqlTime(activeFilter.to) : ExcelParser.parseNumericValue(activeFilter.to);
          const expression = type === 'date'
            ? dateCastExpression(col)
            : type === 'time' ? timeCastExpression(col) : `TRY_CAST(${col} AS DOUBLE)`;
          const literal = item => type === 'date'
            ? `TIMESTAMP ${quoteString(item)}`
            : type === 'time' ? `TIME ${quoteString(item)}` : item;
          if (from !== null && from !== '') {
            clauses.push(`${expression} >= ${literal(from)}`);
          }
          if (to !== null && to !== '') {
            clauses.push(`${expression} <= ${literal(to)}`);
          }
          break;
        }
        case 'contains':
          clauses.push(`LOWER(CAST(${col} AS VARCHAR)) LIKE '%' || ${textValue} || '%'`);
          break;
        case 'starts':
          clauses.push(`LOWER(CAST(${col} AS VARCHAR)) LIKE ${textValue} || '%'`);
          break;
        case 'equals':
          if (type === 'date' && dateValue) {
            clauses.push(`${dateCastExpression(col)} = TIMESTAMP ${quoteString(dateValue)}`);
          } else if (type === 'time' && timeValue) {
            clauses.push(`${timeCastExpression(col)} = TIME ${quoteString(timeValue)}`);
          } else if (type === 'number' && numeric !== null) {
            clauses.push(`${col} = ${numeric}`);
          } else {
            clauses.push(`LOWER(TRIM(CAST(${col} AS VARCHAR))) = ${textValue}`);
          }
          break;
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          if (type === 'date' && dateValue) {
            const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
            clauses.push(`${dateCastExpression(col)} ${operators[activeFilter.op]} TIMESTAMP ${quoteString(dateValue)}`);
            break;
          }
          if (type === 'time' && timeValue) {
            const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
            clauses.push(`${timeCastExpression(col)} ${operators[activeFilter.op]} TIME ${quoteString(timeValue)}`);
            break;
          }
          if (numeric === null) break;
          const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
          clauses.push(`TRY_CAST(${col} AS DOUBLE) ${operators[activeFilter.op]} ${numeric}`);
          break;
        }
        default:
          break;
      }
    }
    });
    if (crossFilter?.col) {
      const col = quoteId(crossFilter.col);
      const value = String(crossFilter.value ?? '').trim();
      const type = columnConfig[crossFilter.col] ?? columnTypes[crossFilter.col];
      const dateValue = type === 'date' ? dateToSqlTimestamp(value) : null;
      const timeValue = type === 'time' ? timeToSqlTime(value) : null;
      if (value === '(vazio)') {
        clauses.push(`(${col} IS NULL OR TRIM(CAST(${col} AS VARCHAR)) = '')`);
      } else if (value === '(data inválida)' && type === 'date') {
        clauses.push(`TRIM(CAST(${col} AS VARCHAR)) <> '' AND ${dateCastExpression(col)} IS NULL`);
      } else if (dateValue) {
        clauses.push(`${dateCastExpression(col)} = TIMESTAMP ${quoteString(dateValue)}`);
      } else if (timeValue) {
        clauses.push(`${timeCastExpression(col)} = TIME ${quoteString(timeValue)}`);
      } else {
        clauses.push(`TRIM(CAST(${col} AS VARCHAR)) = ${quoteString(value)}`);
      }
    }
    return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  }

  function queryRows(sql) {
    if (!conn) throw new Error('Motor de dados nao inicializado.');
    const task = queryQueue.then(async () => arrowToRows(await conn.query(sql)));
    queryQueue = task.catch(() => {});
    return task;
  }

  async function count(activeFilter, crossFilter) {
    const where = buildWhere(activeFilter, crossFilter);
    const result = await queryRows(`SELECT COUNT(*) AS total FROM dash_data${where}`);
    return Number(result[0]?.total ?? 0);
  }

  async function distinct(column, activeFilter, crossFilter) {
    if (!columns.includes(column)) return [];
    const col = quoteId(column);
    const where = buildWhere(activeFilter, crossFilter);
    const conditions = where
      ? `${where} AND ${col} IS NOT NULL AND TRIM(CAST(${col} AS VARCHAR)) <> ''`
      : ` WHERE ${col} IS NOT NULL AND TRIM(CAST(${col} AS VARCHAR)) <> ''`;
    const rows = await queryRows(`
      SELECT DISTINCT ${col} AS value
      FROM dash_data
      ${conditions}
      ORDER BY LOWER(CAST(value AS VARCHAR))
      LIMIT 500
    `);
    return rows.map(row => row.value);
  }

  async function aggregate(config, activeFilter, crossFilter) {
    if (!columns.includes(config.xColumn)) return [];
    const sourceId = quoteId(config.xColumn);
    const yCols = (config.yColumns ?? []).filter(col => columns.includes(col));
    if (!yCols.length) return [];
    const where = buildWhere(activeFilter, crossFilter);
    const agg = ['sum', 'avg', 'count', 'max', 'min'].includes(config.aggregation)
      ? config.aggregation.toUpperCase()
      : 'SUM';
    const dateGroup = ['day', 'week', 'month', 'quarter', 'year'].includes(config.dateGroup)
      ? config.dateGroup
      : 'none';
    const timestampExpr = dateCastExpression(sourceId);
    const dateExpressions = {
      day: `STRFTIME(${timestampExpr}, '%Y-%m-%d')`,
      week: `STRFTIME(${timestampExpr}, '%G S%V')`,
      month: `STRFTIME(${timestampExpr}, '%Y-%m')`,
      quarter: `STRFTIME(${timestampExpr}, '%Y') || ' T' || CAST(QUARTER(${timestampExpr}) AS VARCHAR)`,
      year: `STRFTIME(${timestampExpr}, '%Y')`,
    };
    const xType = columnConfig[config.xColumn] ?? columnTypes[config.xColumn];
    const groupExpr = dateGroup === 'none'
      ? xType === 'date'
        ? `CASE
            WHEN ${sourceId} IS NULL OR TRIM(CAST(${sourceId} AS VARCHAR)) = '' THEN '(vazio)'
            ELSE COALESCE(STRFTIME(${timestampExpr}, '%Y-%m-%d %H:%M:%S'), '(data inválida)')
          END`
        : `COALESCE(NULLIF(TRIM(CAST(${sourceId} AS VARCHAR)), ''), '(vazio)')`
      : `COALESCE(${dateExpressions[dateGroup]}, '(data inválida)')`;
    const firstOrder = `MIN(${quoteId(ROW_ID)}) AS ${quoteId('__first_order')}`;
    const measures = yCols.map(col => {
      const id = quoteId(col);
      const expr = agg === 'COUNT' ? 'COUNT(*)' : `COALESCE(${agg}(${id}), 0)`;
      return `${expr} AS ${id}`;
    });
    const limit = safeInt(config.limit, 20, 1000);
    const direction = config.sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderClause = config.sortBy === 'none'
      ? `${quoteId('__first_order')} ASC`
      : config.sortBy === 'label'
        ? xType === 'date'
          ? `CASE WHEN label IN ('(vazio)', '(data inválida)') THEN 1 ELSE 0 END ASC, LOWER(label) ${direction}, ${quoteId('__first_order')} ASC`
          : `CASE WHEN TRY_CAST(label AS DOUBLE) IS NULL THEN 1 ELSE 0 END ASC, TRY_CAST(label AS DOUBLE) ${direction}, LOWER(label) ${direction}, ${quoteId('__first_order')} ASC`
        : `${quoteId(yCols[0])} ${direction}, ${quoteId('__first_order')} ASC`;
    const showOthers = Boolean(config.showOthers) && ['SUM', 'COUNT'].includes(agg) && yCols.length;

    if (showOthers) {
      const selectedMeasures = yCols.map(quoteId).join(', ');
      const otherMeasures = yCols.map(col => `SUM(${quoteId(col)}) AS ${quoteId(col)}`).join(', ');
      return queryRows(`
        WITH grouped AS (
          SELECT ${groupExpr} AS label, ${measures.join(', ')}, ${firstOrder}
          FROM dash_data${where}
          GROUP BY 1
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER (ORDER BY ${orderClause}) AS rn
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
      SELECT ${groupExpr} AS label, ${measures.join(', ')}, ${firstOrder}
      FROM dash_data${where}
      GROUP BY 1
      ORDER BY ${orderClause}
      LIMIT ${limit}
    `);
  }

  async function kpi(config, activeFilter, crossFilter, unfiltered = false) {
    if (!columns.includes(config.column)) return { value: null, rows: 0 };
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
    const selected = (config.columns ?? []).filter(col => columns.includes(col));
    const cols = selected.length ? selected : columns.slice(0, 6);
    const limit = safeInt(config.rowLimit, 15, 500);
    const offset = Math.max(0, safeInt(page, 0, 10000000) * limit);
    const where = buildWhere(activeFilter, crossFilter);
    const [rows, total] = await Promise.all([
      queryRows(
        `SELECT ${cols.map(quoteId).join(', ')} FROM dash_data${where} ORDER BY ${quoteId(ROW_ID)} LIMIT ${limit} OFFSET ${offset}`
      ),
      count(activeFilter, crossFilter),
    ]);
    return { rows, total, columns: cols, limit, offset };
  }

  async function scatter(config, activeFilter, crossFilter) {
    if (!columns.includes(config.xColumn) || !columns.includes(config.yColumns?.[0])) return [];
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
      ORDER BY ${quoteId(ROW_ID)}
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
    loadFiles,
    reset,
    rebuildView,
    count,
    aggregate,
    kpi,
    table,
    scatter,
    distinct,
    isActive,
    getRowCount,
  };
})();
