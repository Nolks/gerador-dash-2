/* ---------------------------------------------
   markdown.js - Subconjunto seguro de Markdown
--------------------------------------------- */
const MarkdownRenderer = (() => {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(value) {
    const url = String(value ?? '').trim();
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return escapeHtml(url);
    return '#';
  }

  function inline(value) {
    const codeTokens = [];
    let text = escapeHtml(value).replace(/\x60([^\x60]+)\x60/g, (_, code) => {
      const token = '@@CODE_' + codeTokens.length + '@@';
      codeTokens.push('<code>' + code + '</code>');
      return token;
    });

    text = text
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
        '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

    codeTokens.forEach((html, index) => {
      text = text.replace('@@CODE_' + index + '@@', html);
    });
    return text;
  }

  function render(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let listType = '';
    let inCode = false;
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push('<p>' + inline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    function closeList() {
      if (!listType) return;
      html.push('</' + listType + '>');
      listType = '';
    }

    for (const line of lines) {
      if (/^\x60\x60\x60/.test(line.trim())) {
        flushParagraph();
        closeList();
        if (inCode) {
          html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
          codeLines = [];
        }
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        continue;
      }

      if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
        flushParagraph();
        closeList();
        html.push('<hr>');
        continue;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push('<blockquote>' + inline(quote[1]) + '</blockquote>');
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextType = unordered ? 'ul' : 'ol';
        if (listType && listType !== nextType) closeList();
        if (!listType) {
          listType = nextType;
          html.push('<' + listType + '>');
        }
        html.push('<li>' + inline((unordered || ordered)[1]) + '</li>');
        continue;
      }

      closeList();
      paragraph.push(line.trim());
    }

    if (inCode) html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    flushParagraph();
    closeList();
    return html.join('');
  }

  return { render };
})();
