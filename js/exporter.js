/* ─────────────────────────────────────────────
   exporter.js — PNG, PDF (+ senha), HTML (+ senha), JSON
───────────────────────────────────────────── */
const Exporter = (() => {

  /* ── Utilitários internos ─────────────────── */
  function slugify(s) {
    return String(s).toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').slice(0, 40) || 'dashboard';
  }

  async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function captureCanvas() {
    const el = document.getElementById('widgets-grid');
    if (!el.children.length) throw new Error('Nenhum widget para exportar.');
    const bg = getComputedStyle(document.getElementById('dash-canvas')).backgroundColor || '#f1f5f9';
    return html2canvas(el, { scale: 2, backgroundColor: bg, useCORS: true, logging: false });
  }

  function escapeHtmlStr(s) {
    return String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ── Modal de senha (Promise) ────────────── */
  function askPassword(title, desc, notice = '') {
    return new Promise(resolve => {
      document.getElementById('pwd-title').textContent = title;
      document.getElementById('pwd-desc').textContent  = desc;
      document.getElementById('pwd-input').value = '';

      // Aviso extra (ex: comportamento especial do PDF)
      const noticeEl = document.getElementById('pwd-notice');
      if (noticeEl) {
        if (notice) {
          noticeEl.innerHTML = notice;
          noticeEl.style.display = 'flex';
        } else {
          noticeEl.style.display = 'none';
        }
      }

      document.getElementById('pwd-overlay').classList.add('open');

      const overlay = document.getElementById('pwd-overlay');
      const confirm = document.getElementById('pwd-confirm');
      const cancel  = document.getElementById('pwd-cancel');
      const eye     = document.getElementById('pwd-eye');
      const input   = document.getElementById('pwd-input');

      eye.onclick = () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.querySelector('i').className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      };

      input.onkeydown = e => { if (e.key === 'Enter') doConfirm(); };

      function cleanup() {
        overlay.classList.remove('open');
        confirm.onclick = null; cancel.onclick = null;
        input.onkeydown = null; eye.onclick = null;
        input.type = 'password';
        eye.querySelector('i').className = 'fa-solid fa-eye';
        if (noticeEl) noticeEl.style.display = 'none';
      }

      function doConfirm() { const pwd = input.value; cleanup(); resolve(pwd); }

      confirm.onclick = doConfirm;
      cancel.onclick  = () => { cleanup(); resolve(null); };
      setTimeout(() => input.focus(), 80);
    });
  }

  /* ── PNG ─────────────────────────────────── */
  async function toPNG() {
    App.closeExportMenu();
    App.toast('Gerando imagem…', 'info');
    const el = document.getElementById('widgets-grid');
    try {
      const canvas  = await captureCanvas();
      const link    = document.createElement('a');
      const title   = document.getElementById('dash-title')?.value ?? 'dashboard';
      link.download = slugify(title) + '.png';
      link.href     = canvas.toDataURL('image/png');
      link.click();
      App.toast('Imagem exportada!', 'success');
    } catch (e) {
      App.toast('Erro: ' + e.message, 'error');
    }
  }

  /* ── PDF multipágina (+ senha opcional) ─── */
  async function toPDF() {
    App.closeExportMenu();

    const hasTable = Dashboard.getWidgets().some(w => w.type === 'table');
    const largeMode = App.state.dataMode === 'query';
    const exportFullTables = hasTable && !largeMode;

    const notice = largeMode && hasTable
      ? `<div class="pwd-notice-box">
          <i class="fa-solid fa-circle-info"></i>
          <div><strong>Base de grande volume</strong><br>A página visível da tabela será incluída como imagem. A exportação integral foi desativada para evitar milhares de páginas.</div>
        </div>`
      : hasTable
      ? `<div class="pwd-notice-box">
          <i class="fa-solid fa-circle-info"></i>
          <div>
            <strong>Tabelas no PDF</strong><br>
            Cada tabela será exportada em <strong>página própria com todas as linhas</strong>,
            mantendo boa legibilidade.
          </div>
        </div>`
      : '';

    const pwd = await askPassword(
      'Exportar como PDF',
      'Defina uma senha para proteger o arquivo. Deixe em branco para exportar sem proteção.',
      notice
    );
    if (pwd === null) return;

    App.toast('Gerando PDF multipágina…', 'info');

    try {
      const { jsPDF } = window.jspdf;
      const title     = document.getElementById('dash-title')?.value ?? 'Dashboard';
      const dateStr   = new Date().toLocaleDateString('pt-BR', { dateStyle: 'full' });

      const pdfOpts = { orientation: 'landscape', unit: 'pt', format: 'a4' };
      if (pwd) {
        pdfOpts.encryption = {
          userPassword:    pwd,
          ownerPassword:   pwd + '_owner',
          userPermissions: ['print', 'copy'],
        };
      }

      const pdf = new jsPDF(pdfOpts);
      const PW  = pdf.internal.pageSize.getWidth();   // 841.89 pt (A4 landscape)
      const PH  = pdf.internal.pageSize.getHeight();  // 595.28 pt
      const HEADER_H = 32;
      const FOOTER_H = 14;
      const PAD      = 16;
      const CONTENT_H = PH - HEADER_H - FOOTER_H - PAD * 2;
      const CONTENT_W = PW - PAD * 2;

      let pageNum = 0;

      /* ── desenha cabeçalho e rodapé na página atual ── */
      function drawPageFrame() {
        pageNum++;
        // Cabeçalho
        pdf.setFillColor(30, 41, 59);
        pdf.rect(0, 0, PW, HEADER_H, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Aebes DashGen  ·  ' + title, PAD, 21);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.text(dateStr, PW - PAD, 21, { align: 'right' });

        // Rodapé
        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.5);
        pdf.line(PAD, PH - FOOTER_H, PW - PAD, PH - FOOTER_H);
        pdf.setTextColor(160, 160, 160);
        pdf.setFontSize(7);
        pdf.text(
          pwd ? '🔒 Documento protegido por senha  ·  Aebes DashGen' : 'Aebes DashGen',
          PW / 2, PH - 4, { align: 'center' }
        );
        pdf.setTextColor(180, 180, 180);
        pdf.text(`Página ${pageNum}`, PW - PAD, PH - 4, { align: 'right' });
      }

      /* ── Página 1: captura de todos os widgets NÃO-tabela ── */
      const widgetsEl = document.getElementById('widgets-grid');
      const nonTableEls = [...widgetsEl.querySelectorAll('.widget')].filter(el => {
        const w = Dashboard.getWidgets().find(x => x.id === el.dataset.id);
        return w && (w.type !== 'table' || largeMode);
      });

      if (nonTableEls.length) {
        // Esconder temporariamente os widgets de tabela para capturar só os gráficos/KPIs
        const tableEls = [...widgetsEl.querySelectorAll('.widget')].filter(el => {
          const w = Dashboard.getWidgets().find(x => x.id === el.dataset.id);
          return w && w.type === 'table' && !largeMode;
        });
        tableEls.forEach(el => { el.dataset.pdfHidden = '1'; el.style.display = 'none'; });

        const bg = getComputedStyle(document.getElementById('dash-canvas')).backgroundColor || '#f1f5f9';
        const chartCanvas = await html2canvas(widgetsEl, { scale: 2.5, backgroundColor: bg, useCORS: true, logging: false });
        const chartImg    = chartCanvas.toDataURL('image/png');

        tableEls.forEach(el => { delete el.dataset.pdfHidden; el.style.display = ''; });

        drawPageFrame();

        // Cabe na página? Escala para preencher bem
        const ratio = Math.min(CONTENT_W / chartCanvas.width, CONTENT_H / chartCanvas.height);
        const iw    = chartCanvas.width  * ratio;
        const ih    = chartCanvas.height * ratio;
        const ix    = PAD + (CONTENT_W - iw) / 2;
        const iy    = HEADER_H + PAD + (CONTENT_H - ih) / 2;

        pdf.addImage(chartImg, 'PNG', ix, iy, iw, ih);
      }

      /* ── Páginas das tabelas — renderização nativa ── */
      if (exportFullTables) {
        Dashboard.prepareForPDFExport();
        await new Promise(r => setTimeout(r, 300));

        const tableWidgets = Dashboard.getWidgets().filter(w => w.type === 'table');
        const rows         = App.getRows();
        const numColsSet   = new Set(App.state.numericColumns);

        for (const tw of tableWidgets) {
          const cfg  = tw.config;
          const cols = (cfg.columns && cfg.columns.length) ? cfg.columns : App.state.columns.slice(0, 6);

          if (pageNum > 0) pdf.addPage();
          drawPageFrame();

          // Título da tabela
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(30, 41, 59);
          pdf.text(tw.title, PAD, HEADER_H + PAD + 4);

          const rowCount = rows.length;
          pdf.setFontSize(8);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(100, 116, 139);
          pdf.text(`${rowCount} linhas · ${cols.length} colunas`, PAD, HEADER_H + PAD + 14);

          // Tabela com jsPDF autotable (via posição manual — não usa plugin)
          // Calculamos larguras de coluna uniformes
          const colW      = Math.floor(CONTENT_W / cols.length);
          const ROW_H     = 14;
          const COL_H_HDR = 16;
          let curY        = HEADER_H + PAD + 24;

          // Cabeçalho da tabela
          pdf.setFillColor(241, 245, 249);
          pdf.rect(PAD, curY, CONTENT_W, COL_H_HDR, 'F');
          pdf.setDrawColor(226, 232, 240);
          pdf.setLineWidth(0.4);
          pdf.rect(PAD, curY, CONTENT_W, COL_H_HDR, 'S');

          pdf.setFontSize(7.5);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(100, 116, 139);
          cols.forEach((c, i) => {
            const x = PAD + i * colW + 4;
            const label = String(c).length > 18 ? String(c).slice(0, 17) + '…' : String(c);
            pdf.text(label.toUpperCase(), x, curY + 11);
          });
          curY += COL_H_HDR;

          // Linhas de dados
          pdf.setFont('helvetica', 'normal');
          let rowIdx = 0;
          for (const row of rows) {
            // Nova página se acabou o espaço
            if (curY + ROW_H > PH - FOOTER_H - 4) {
              pdf.addPage();
              drawPageFrame();

              // Repete cabeçalho na nova página
              curY = HEADER_H + PAD;
              pdf.setFillColor(241, 245, 249);
              pdf.rect(PAD, curY, CONTENT_W, COL_H_HDR, 'F');
              pdf.setDrawColor(226, 232, 240);
              pdf.rect(PAD, curY, CONTENT_W, COL_H_HDR, 'S');
              pdf.setFontSize(7.5);
              pdf.setFont('helvetica', 'bold');
              pdf.setTextColor(100, 116, 139);
              cols.forEach((c, i) => {
                const label = String(c).length > 18 ? String(c).slice(0, 17) + '…' : String(c);
                pdf.text(label.toUpperCase(), PAD + i * colW + 4, curY + 11);
              });
              curY += COL_H_HDR;
              pdf.setFont('helvetica', 'normal');
            }

            // Zebra
            if (rowIdx % 2 === 0) {
              pdf.setFillColor(248, 250, 252);
              pdf.rect(PAD, curY, CONTENT_W, ROW_H, 'F');
            }
            pdf.setDrawColor(241, 245, 249);
            pdf.line(PAD, curY + ROW_H, PAD + CONTENT_W, curY + ROW_H);

            pdf.setFontSize(8);
            pdf.setTextColor(30, 41, 59);
            cols.forEach((c, i) => {
              const v      = String(row[c] ?? '');
              const isNum  = numColsSet.has(c);
              const label  = v.length > 20 ? v.slice(0, 19) + '…' : v;
              const x      = PAD + i * colW + (isNum ? colW - 4 : 4);
              const align  = isNum ? 'right' : 'left';
              if (isNum) pdf.setTextColor(99, 102, 241);
              else pdf.setTextColor(30, 41, 59);
              pdf.text(label, x, curY + 10, { align });
            });

            curY += ROW_H;
            rowIdx++;
          }
        }

        Dashboard.restoreAfterPDFExport();
      }

      pdf.save(slugify(title) + '.pdf');
      App.toast(pwd ? `PDF exportado com senha! 🔒  (${pageNum} pág.)` : `PDF exportado!  (${pageNum} pág.)`, 'success');
    } catch (e) {
      App.toast('Erro ao gerar PDF: ' + e.message, 'error');
      console.error(e);
      if (exportFullTables) Dashboard.restoreAfterPDFExport();
    }
  }

  /* ── HTML interativo (+ senha opcional) ──── */
  async function toHTML() {
    App.closeExportMenu();

    const pwd = await askPassword(
      'Exportar como HTML',
      'Com senha, o arquivo exibirá uma tela de bloqueio antes do dashboard. Deixe em branco para exportar aberto.'
    );
    if (pwd === null) return;

    App.toast('Gerando HTML…', 'info');

    try {
      const canvas  = await captureCanvas();
      const imgB64  = canvas.toDataURL('image/png');
      const title   = document.getElementById('dash-title')?.value ?? 'Dashboard';
      const theme   = Charts.getTheme();
      const primary = Charts.getAllThemes()[theme]?.swatch ?? '#6366f1';
      const dateStr = new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' });

      const pwdHash = pwd ? await sha256hex(pwd) : '';

      // Tela de bloqueio (só se houver senha)
      const lockScreen = pwd ? `
  <div id="lock" style="position:fixed;inset:0;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:18px;font-family:'Segoe UI',system-ui,sans-serif;z-index:9999;">
    <div style="font-size:56px;filter:drop-shadow(0 0 20px ${primary}80);">🔒</div>
    <h2 style="color:#fff;font-size:22px;margin:0;font-weight:800;">${escapeHtmlStr(title)}</h2>
    <p style="color:#64748b;font-size:13px;margin:0;letter-spacing:.5px;">AEBES DASHGEN · ACESSO RESTRITO</p>
    <input id="pin" type="password" placeholder="Digite a senha de acesso"
      style="padding:14px 20px;border-radius:12px;border:2px solid #334155;
             background:#1e293b;color:#fff;font-size:15px;width:300px;
             outline:none;text-align:center;letter-spacing:4px;transition:.2s;"
      onfocus="this.style.borderColor='${primary}'"
      onblur="this.style.borderColor='#334155'"
      onkeydown="if(event.key==='Enter')unlock()" />
    <button onclick="unlock()" style="padding:13px 40px;border-radius:12px;border:none;
      background:${primary};color:#fff;font-size:15px;font-weight:700;cursor:pointer;
      transition:.15s;" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
      Entrar
    </button>
    <p id="err" style="color:#ef4444;font-size:13px;min-height:18px;margin:0;"></p>
  </div>` : '';

      const unlockScript = pwd ? `
  <script>
    const HASH = '${pwdHash}';
    async function sha256(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
    async function unlock() {
      const v = document.getElementById('pin').value;
      if (!v) return;
      const h = await sha256(v);
      if (h === HASH) {
        document.getElementById('lock').remove();
        document.getElementById('dash').style.display = 'block';
      } else {
        document.getElementById('err').textContent = 'Senha incorreta. Tente novamente.';
        document.getElementById('pin').value = '';
        document.getElementById('pin').focus();
      }
    }
    document.getElementById('dash').style.display = 'none';
  <\/script>` : '';

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${escapeHtmlStr(title)} — Aebes DashGen</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f5f9;min-height:100vh;}
    header{background:#1e293b;color:#fff;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;}
    .brand{display:flex;align-items:center;gap:12px;}
    .brand-sub{font-size:10px;letter-spacing:1px;color:#64748b;font-weight:600;text-transform:uppercase;}
    .brand-title{font-size:18px;font-weight:800;}
    .meta{font-size:12px;color:#475569;}
    main{padding:28px;display:flex;justify-content:center;}
    main img{max-width:100%;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.15);}
    footer{text-align:center;padding:20px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;}
    footer strong{color:#64748b;}
  </style>
</head>
<body>
  ${lockScreen}
  <div id="dash">
    <header>
      <div class="brand">
        <div style="font-size:28px;">📊</div>
        <div>
          <div class="brand-sub">Aebes DashGen</div>
          <div class="brand-title">${escapeHtmlStr(title)}</div>
        </div>
      </div>
      <div class="meta">Exportado em ${dateStr}${pwd ? ' &nbsp;·&nbsp; 🔒 Acesso restrito' : ''}</div>
    </header>
    <main>
      <img src="${imgB64}" alt="${escapeHtmlStr(title)}"/>
    </main>
    <footer>
      Gerado por <strong>Aebes DashGen</strong> &nbsp;·&nbsp; Uso exclusivo do destinatário.
    </footer>
  </div>
  ${unlockScript}
</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const link = document.createElement('a');
      link.href  = URL.createObjectURL(blob);
      link.download = slugify(title) + '.html';
      link.click();
      App.toast(pwd ? 'HTML exportado com senha! 🔒' : 'HTML exportado!', 'success');
    } catch (e) {
      App.toast('Erro ao gerar HTML: ' + e.message, 'error');
      console.error(e);
    }
  }

  /* ── JSON (configuração do dashboard) ────── */
  function toJSON() {
    App.closeExportMenu();
    const data = Dashboard.serialize();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href  = URL.createObjectURL(blob);
    link.download = slugify(data.title) + '.aebesdash.json';
    link.click();
    App.toast('Configuração exportada!', 'success');
  }

  /* ── Validação de schema do dashboard ────── */
  function validateDashboardSchema(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Estrutura de dashboard inválida');
    if (!Array.isArray(data.widgets))
      throw new Error('Campo "widgets" ausente ou com tipo incorreto');

    const VALID_TYPES = new Set(['bar','line','area','pie','doughnut','scatter','kpi','table','text']);

    data.widgets.forEach((w, i) => {
      const label = `Widget ${i + 1}`;
      if (!w || typeof w !== 'object')
        throw new Error(`${label}: objeto inválido`);
      if (!w.id || typeof w.id !== 'string')
        throw new Error(`${label}: campo "id" ausente ou inválido`);
      if (!VALID_TYPES.has(w.type))
        throw new Error(`${label}: tipo "${w.type}" desconhecido`);
      if (!w.config || typeof w.config !== 'object')
        throw new Error(`${label}: campo "config" ausente ou inválido`);
    });
  }

  /* ── Importar JSON ───────────────────────── */
  function importJSON() {
    App.closeExportMenu();
    const inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '.json';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('O arquivo não é um JSON válido');
        }
        validateDashboardSchema(data);
        Dashboard.load(data);
        App.toast('Dashboard importado!', 'success');
      } catch (e) {
        App.toast('Importação falhou: ' + e.message, 'error');
        console.error(e);
      }
    };
    inp.click();
  }

  return { toPNG, toPDF, toHTML, toJSON, importJSON };
})();
