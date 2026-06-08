# Aebes DashGen — Gerador de Dashboards

> Transforme planilhas Excel em dashboards interativos direto no navegador.

## Como usar

1. **Sirva** a pasta por HTTP (por exemplo: `python3 -m http.server 8080`) e abra no navegador
2. **Envie** um arquivo `.xlsx`, `.xls`, `.csv` ou `.parquet`
3. **Pré-visualize** os dados e selecione a aba desejada
4. **Monte** seu dashboard adicionando widgets pelo painel lateral
5. **Configure** cada widget (colunas, agregação, cores, tamanho)
6. **Salve** no navegador ou **exporte** como PNG / PDF

---

## Estrutura de arquivos

```
gerador-dash/
├── index.html          ← Entrada principal
├── css/
│   └── style.css       ← Estilos completos
├── js/
│   ├── app.js          ← Controlador principal + navegação
│   ├── excel.js        ← Leitura de planilhas (SheetJS)
│   ├── charts.js       ← Gráficos (Chart.js) + agregação de dados
│   ├── dashboard.js    ← Gerenciamento de widgets
│   └── exporter.js     ← Exportação PNG / PDF / JSON
└── README.md
```

---

## Widgets disponíveis

| Widget      | Descrição                                          |
|-------------|--------------------------------------------------- |
| **Barras**  | Gráfico de barras verticais agrupadas              |
| **Linhas**  | Série temporal ou comparação entre linhas          |
| **Área**    | Igual a linhas, mas com preenchimento              |
| **Pizza**   | Proporção entre categorias                         |
| **Rosca**   | Variação da pizza com espaço central               |
| **Dispersão** | Correlação entre duas colunas numéricas          |
| **Indicador** | Card com valor único (Soma, Média, Máx, etc.)    |
| **Tabela**  | Grade de dados paginada                            |
| **Texto**   | Textos e parágrafos com Markdown e tipografia       |

---

## Funcionalidades

- **Detecção automática** de colunas numéricas, texto e data
- **Agregação** por Soma, Média, Contagem, Máximo ou Mínimo
- **Filtros** por limite de itens e ordenação
- **Agrupamento temporal** por dia, semana, mês, trimestre ou ano
- **Categoria Outros** para consolidar itens fora do Top N
- **Formatação de valores** como número, compacto, moeda ou percentual
- **Dashboard sugerido** automaticamente a partir dos tipos das colunas
- **Drag & drop fluido** pelo cabeçalho, com preview do destino, auto-scroll e animações
- **Redimensionamento por encaixe** em 3, 6, 9 ou 12 colunas
- **6 paletas de cores** (Índigo, Oceano, Pôr do Sol, Floresta, Noite, Pastel)
- **8 fundos de canvas** personalizáveis
- **Salvar** múltiplos dashboards no `localStorage`
- **Exportar** como imagem PNG, documento PDF ou JSON reutilizável
- **Importar** configuração JSON salva anteriormente

---

## Formato do arquivo Excel

- Primeira linha = **cabeçalho** (nomes das colunas)
- Linhas seguintes = dados
- Suporte a múltiplas abas em arquivos Excel
- Detecta automaticamente números, datas e texto

### Exemplo mínimo:

| Região   | Mês    | Vendas | Meta  |
|----------|--------|--------|-------|
| Sul      | Jan    | 12500  | 10000 |
| Norte    | Jan    | 8700   | 9000  |
| Sul      | Fev    | 14200  | 12000 |

---

## Tecnologias (100% client-side)

| Biblioteca      | Versão  | Uso                         |
|-----------------|---------|-----------------------------|
| SheetJS (xlsx)  | 0.18.5  | Leitura de .xlsx/.xls       |
| DuckDB-Wasm      | 1.32.0  | CSV/Parquet e grandes bases |
| Chart.js        | 4.4.0   | Renderização de gráficos    |
| SortableJS      | 1.15.2  | Drag & drop de widgets      |
| html2canvas     | 1.4.1   | Captura do canvas           |
| jsPDF           | 2.5.1   | Geração de PDF              |
| Font Awesome    | 6.5.0   | Ícones                      |

> Sem backend. Sem banco de dados. Sem instalação.  
> Todos os dados ficam **apenas no seu navegador**.

---

## Modo de dados grandes

Arquivos CSV e Parquet são processados pelo DuckDB-Wasm em um Web Worker. Os widgets recebem somente resultados agregados ou a página visível da tabela, evitando carregar milhões de objetos JavaScript na interface.

- Recomendado para bases com centenas de milhares ou milhões de linhas.
- CSV e Parquet usam o motor analítico automaticamente.
- XLS/XLSX continuam no modo de compatibilidade em memória.
- No modo analítico, a exportação PDF não materializa a tabela completa; inclui apenas a página visível.
- O navegador ainda possui limites de memória. Para bases muito grandes, prefira Parquet.

### Experiência durante importações grandes

- O painel de carregamento mostra arquivo, tamanho, etapa atual, percentual estimado e tempo decorrido.
- A importação pode ser cancelada; arquivos Excel interrompem o Worker imediatamente e cargas analíticas encerram a operação corrente com segurança.
- Mensagens contextuais explicam quando o motor analítico está ativo e quando vale converter Excel para Parquet.
- A prévia informa explicitamente que exibe até 200 linhas, enquanto gráficos e filtros consultam a base completa.

### Otimizacoes do modo Excel

- O resultado de filtros e compartilhado entre todos os widgets.
- Agregacoes e KPIs usam acumuladores, sem arrays intermediarios por grupo.
- Graficos de dispersao usam amostragem reservoir.
- Sanitizacao e conversao numerica evitam duplicar todas as linhas.
- Arquivos Excel com 250 mil linhas ou mais exibem recomendacao para CSV/Parquet.

### Widget de texto

Permite criar títulos, textos explicativos e notas em Markdown. Oferece fonte, tamanho, cor do texto, fundo, alinhamento, espaçamento entre linhas e os tamanhos padrão do dashboard. HTML digitado é escapado por segurança.

### Sugestões automáticas

O botão **Gerar dashboard sugerido** cria KPIs, série temporal (quando existe uma coluna de data), ranking por categoria, gráfico de participação e tabela detalhada. A composição pode ser editada normalmente depois de criada.
