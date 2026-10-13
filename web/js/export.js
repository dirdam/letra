/* Copy / download results as plain text, TSV, CSV or LaTeX: either the words with their forms, or the full
   derivation of every form. Forms are written without the word-boundary spaces. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const S = L.state.s;
    const E = L.entries;

    const ok = () => S.results.filter((r) => !r.error);

    function derivation(r, form) {
        const parts = [E.plain(r.start)];
        E.chainFor(r, form).forEach((st) => parts.push(E.plain(st.to) + ' [' + st.rule + ']'));
        return parts.join(' > ');
    }

    /* Rows as arrays of cells: [word, form] or [word, form, steps, derivation], with a header row first. */
    function rows(kind) {
        if (kind === 'forms') {
            return [['word', 'form']].concat(ok().flatMap((r) => (r.final.length ? r.final : ['']).map((f) => [r.term, E.plain(f)])));
        }
        return [['word', 'form', 'steps', 'derivation']].concat(ok().flatMap((r) => r.final.map((f) => [r.term, E.plain(f), String(E.chainFor(r, f).length), derivation(r, f)])));
    }

    const csvCell = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

    const TEX = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
    const tex = (v) => v.replace(/[\\{}&%$#_~^]/g, (c) => TEX[c]);

    function plainText(kind) {
        if (kind === 'forms') return ok().map((r) => r.term + ' > ' + (r.final.map(E.plain).join(', ') || '—')).join('\n');
        return ok().map((r) => [r.term].concat(r.final.map((f) => '  ' + E.plain(f) + ': ' + derivation(r, f))).join('\n')).join('\n\n');
    }

    function latex(kind) {
        const data = rows(kind);
        const cols = data[0].length === 2 ? 'll' : 'llrl';
        const head = data[0].map((h) => tex(h.charAt(0).toUpperCase() + h.slice(1))).join(' & ');
        const body = data.slice(1).map((row) => row.map((cell, i) => (i === 3 ? tex(cell).replace(/ &gt; | > /g, ' $\\rightarrow$ ') : tex(cell))).join(' & ') + ' \\\\').join('\n');
        return '% Needs XeLaTeX or LuaLaTeX and a font with IPA (for example Gentium) for non-ASCII text.\n'
            + '\\begin{tabular}{' + cols + '}\n\\hline\n' + head + ' \\\\\n\\hline\n' + body + '\n\\hline\n\\end{tabular}\n';
    }

    const FORMATS = {
        txt: { mime: 'text/plain', ext: 'txt' },
        tsv: { mime: 'text/tab-separated-values', ext: 'tsv' },
        csv: { mime: 'text/csv', ext: 'csv' },
        tex: { mime: 'application/x-tex', ext: 'tex' },
    };

    function build(kind, format) {
        let text;
        if (format === 'txt') text = plainText(kind);
        else if (format === 'tsv') text = rows(kind).map((r) => r.join('\t')).join('\n');
        else if (format === 'csv') text = rows(kind).map((r) => r.map(csvCell).join(',')).join('\r\n');
        else text = latex(kind);
        return Object.assign({ text }, FORMATS[format]);
    }

    function filename(setId, kind, ext) { return 'letra-' + setId + '-' + (kind === 'forms' ? 'forms' : 'derivations') + '.' + ext; }

    async function copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            const ta = document.createElement('textarea');       // older browsers, or no permission for the clipboard API
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let done = false;
            try { done = document.execCommand('copy'); } catch (err) { done = false; }
            ta.remove();
            return done;
        }
    }

    function download(text, mime, name) {
        const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    L.exporter = { build, copy, download, filename, rows };
})();
