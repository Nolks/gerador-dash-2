# Aebes BI Studio — Business Intelligence

> Transforme arquivos Excel, CSV e Parquet em dashboards interativos diretamente no navegador.

O Aebes BI Studio é uma aplicação 100% client-side para importar dados, criar páginas de dashboard, configurar gráficos e indicadores e exportar o resultado sem enviar os arquivos para um servidor.

## Como usar

1. Sirva a pasta por HTTP, por exemplo com `python -m http.server 8080`.
2. Abra `http://localhost:8080` no navegador.
3. Selecione um ou mais arquivos compatíveis.
4. Revise a prévia e o mapeamento das colunas.
5. Adicione e configure os widgets do dashboard.
6. Salve localmente ou exporte como PNG, PDF, HTML interativo ou JSON.

> Abrir o `index.html` diretamente pode limitar recursos que dependem de Web Workers ou módulos. O uso por HTTP é recomendado.

---

## Importação de dados

### Formatos aceitos

- Excel: `.xlsx` e `.xls`
- Texto tabular: `.csv`
- Dados analíticos: `.parquet`

### Múltiplos arquivos

O sistema permite importar e empilhar arquivos com a mesma estrutura de colunas:

| Grupo | Limite de arquivos | Tamanho total |
|---|---:|---:|
| Excel | 5 | 150 MB |
| CSV/Parquet | 10 | 500 MB |

- Os arquivos precisam possuir colunas compatíveis e na mesma ordem.
- Excel não pode ser misturado com CSV/Parquet no mesmo empilhamento.
- Ao empilhar mais de um arquivo, uma coluna `Fonte` identifica a origem de cada linha.
- O nome de cada fonte pode ser editado antes da importação.
- Em um único arquivo Excel, as abas ficam disponíveis para seleção.
- No empilhamento de vários arquivos Excel, é usada a primeira aba não vazia de cada arquivo.
- Atualmente os arquivos são unidos por linhas (`UNION ALL`). Ainda não existem relacionamentos ou `JOIN` entre tabelas.

### Mapeamento de colunas

Antes de montar o dashboard, cada coluna pode ser configurada como:

- Identificador
- Hora (`HH:mm:ss`)
- Número
- Texto
- Data
- Excluída

Valores monetários e formatos numéricos brasileiros são normalizados ao mapear a coluna como número.

---

## Widgets disponíveis

| Widget | Descrição |
|---|---|
| **Barras** | Gráfico de barras verticais ou horizontais |
| **Linhas** | Séries temporais e comparações |
| **Área** | Gráfico de linhas com preenchimento |
| **Pizza** | Participação entre categorias |
| **Rosca** | Variação da pizza com espaço central |
| **Dispersão** | Correlação entre duas colunas numéricas |
| **Indicador (KPI)** | Valor agregado, meta, progresso e semáforo |
| **Tabela** | Grade de dados paginada e formatação condicional |
| **Texto** | Conteúdo Markdown com tipografia configurável |
| **Filtros** | Filtros visuais com múltipla seleção e pesquisa |
| **Imagem** | Imagens e logos enviados pelo usuário ou carregados por URL |
| **Botão** | Botão flutuante para páginas internas ou links externos |

---

## Funcionalidades

### Layout e páginas

- Movimento livre dos widgets pelo canvas.
- Redimensionamento fluido pela diagonal, alterando largura e altura simultaneamente.
- Definição exata de largura e altura em pixels.
- Tamanhos predefinidos pequeno, médio, grande e completo.
- Limites mínimos e máximos adequados a cada tipo de widget.
- Auto-scroll durante o arraste.
- Botões flutuantes sem a moldura visual padrão e posicionáveis sobre outros widgets.
- Ícones configuráveis ao lado dos títulos.
- Títulos de KPIs adaptados para widgets pequenos, com quebra de linha.
- Desfazer e refazer alterações.
- Até 5 páginas por dashboard.
- Nome e ícone editáveis por página.
- Exclusão de páginas, mantendo obrigatoriamente pelo menos uma.

### Gráficos, KPIs e tabelas

- Agregações por soma, média, contagem, máximo ou mínimo.
- Agrupamento temporal por dia, semana, mês, trimestre ou ano.
- Ordenação, limite de itens e categoria `Outros`.
- Barras com orientação vertical ou horizontal.
- Valores em formato completo, abreviado, moeda ou percentual.
- Abreviações como `3M` e `3,5M`, sem converter milhões incorretamente em milhares.
- KPIs com opção de ocultar a agregação e a quantidade de linhas.
- Metas em KPIs com valor atual, progresso e semáforo de desempenho.
- Semáforo condicional de metas nos KPIs e regras de cor em tabelas e gráficos.
- Tabelas paginadas com regras de cor por coluna e valor.
- Dashboard sugerido automaticamente conforme os tipos das colunas.

### Filtros e interações

- Filtro global por coluna e operador.
- Widget de filtros em orientação vertical ou adaptável.
- No modo adaptável, os campos formam novas colunas conforme o widget é alargado.
- Múltipla seleção por caixas de seleção.
- Pesquisa dentro das opções.
- Intervalos de data e hora.
- Filtros dependentes, atualizando as opções conforme os demais filtros.
- Filtro cruzado ao clicar em elementos de gráficos compatíveis.
- Drill-through para abrir outra página já filtrada pelo item selecionado.
- Botões para navegar entre páginas ou abrir links externos.

### Campos calculados

É possível criar, editar e excluir colunas calculadas usando outras colunas da base.

Exemplos:

```text
[Receita] - [Custo]
([Receita] - [Custo]) / [Receita] * 100
[Faturamento] / [Quantidade]
```

São aceitos números, referências no formato `[Nome da coluna]`, parênteses e os operadores `+`, `-`, `*` e `/`.

### Aparência

- 6 paletas prontas: Índigo, Oceano, Pôr do Sol, Floresta, Noite e Pastel.
- Paleta personalizada por seletor visual, RGB ou hexadecimal.
- 8 opções de fundo para o canvas.
- Fontes de sistema, Arial, serifada e monoespaçada em widgets compatíveis.
- Cores de botão, texto, fundo e regras condicionais configuráveis.

### Modo apresentação

- Exibição em tela cheia.
- Rotação automática entre páginas.
- Intervalos de 5, 10, 15 ou 30 segundos.
- Contador regressivo.
- Controles para pausar, continuar, avançar, voltar e sair.

---

## Salvamento e exportação

### Salvamento local

- Múltiplos dashboards podem ser salvos no `localStorage`.
- Páginas, widgets, campos calculados, configurações dos filtros e aparência são persistidos.
- O painel informa o espaço aproximado utilizado no navegador.
- Para abrir um dashboard salvo, primeiro carregue uma base com as colunas esperadas.

### Formatos de exportação

| Formato | Comportamento |
|---|---|
| **PNG** | Captura visual do dashboard |
| **PDF** | Documento com opção de senha e tratamento especial para tabelas |
| **HTML interativo** | Mantém páginas, filtros, gráficos, KPIs, tabelas, botões e drill-through |
| **JSON** | Configuração reutilizável do dashboard |

### HTML interativo

- Pode ser protegido por senha.
- Incorpora os dados necessários no próprio arquivo.
- Mantém filtros de múltipla seleção, pesquisa, data, hora e filtros dependentes.
- Preserva os filtros ativos no momento da exportação.
- Atualiza gráficos, KPIs e tabelas após cada filtro.
- Incorpora no máximo 100 mil linhas. Acima disso, o arquivo informa que os filtros atuam sobre a amostra incorporada.
- Chart.js e Font Awesome são carregados por CDN, portanto gráficos e ícones precisam de acesso à internet ao abrir o HTML exportado.

---

## Modo de dados grandes

Arquivos CSV e Parquet são processados pelo DuckDB-Wasm. Os widgets consultam resultados agregados ou páginas limitadas em vez de materializar toda a base como objetos JavaScript.

- Recomendado para bases com centenas de milhares ou milhões de linhas.
- A prévia exibe até 200 linhas, mas gráficos e filtros consultam a base completa.
- CSV e Parquet usam automaticamente o motor analítico.
- Excel permanece no modo de compatibilidade em memória.
- Arquivos Excel com 250 mil linhas ou mais exibem recomendação para conversão em CSV ou Parquet.
- No modo analítico, o PDF não materializa tabelas completas para evitar milhares de páginas.
- O navegador ainda possui limites de memória; para grandes volumes, prefira Parquet.

### Experiência de carregamento

- Progresso por etapa e tempo decorrido.
- Identificação do arquivo em processamento.
- Cancelamento seguro da importação.
- Indicador discreto de consulta nos widgets.
- Cache compartilhado de filtros no modo Excel.
- Agregações e KPIs com acumuladores.
- Amostragem para gráficos de dispersão.

---

## Estrutura do projeto

```text
gerador-dash-2/
├── index.html                  # Entrada principal e interface
├── image/
│   └── aebes-logo.svg          # Marca AEBES usada na interface e exportações
├── css/
│   └── style.css               # Estilos da aplicação
├── js/
│   ├── app.js                  # Importação, estado, filtros e navegação
│   ├── excel.js                # Leitura, tipos, números e fórmulas
│   ├── excel.worker.js         # Processamento de Excel em Worker
│   ├── data-engine.js          # DuckDB-Wasm e consultas analíticas
│   ├── charts.js               # Gráficos, temas e agregações
│   ├── markdown.js             # Renderização segura de Markdown
│   ├── dashboard.js            # Widgets, páginas, layout e apresentação
│   ├── html-export-runtime.js  # Runtime do HTML interativo exportado
│   └── exporter.js             # Exportações PNG, PDF, HTML e JSON
└── README.md
```

---

## Tecnologias

| Biblioteca | Versão | Uso |
|---|---:|---|
| SheetJS | 0.18.5 | Leitura de `.xlsx` e `.xls` |
| DuckDB-Wasm | 1.32.0 | CSV, Parquet e consultas de grandes bases |
| Chart.js | 4.4.0 | Renderização dos gráficos |
| html2canvas | 1.4.1 | Captura visual do dashboard |
| jsPDF | 2.5.1 | Geração de PDF |
| Font Awesome | 6.5.0 | Ícones da interface |

> Não existe backend nesta versão. Os arquivos e dados permanecem no navegador do usuário.

---

## Formato recomendado dos dados

- Primeira linha com os nomes das colunas.
- Linhas seguintes com os registros.
- Colunas consistentes entre arquivos que serão empilhados.
- Nomes de colunas únicos.
- Datas e horas em formatos reconhecíveis.
- Para grande volume, prefira Parquet.

### Exemplo

| Região | Data | Hora | Vendas | Meta |
|---|---|---|---:|---:|
| Sul | 01/01/2026 | 08:30:00 | 12500 | 10000 |
| Norte | 01/01/2026 | 09:15:00 | 8700 | 9000 |
| Sul | 01/02/2026 | 10:00:00 | 14200 | 12000 |
