/* The rules editor: a line-numbered JSON editor (a transparent textarea over a highlighted copy of
   its text), live validation by the server with the problems listed and marked on their lines,
   and open / download / format / run. The draft is kept in this browser only. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;
    const S = L.state.s;

    const LINE = 22;          // px, the same in CSS (.editor-text, .editor-hl, .editor-gutter)
    const PAD = 12;           // px, the editor's inner padding

    let els = null;
    let timer = null;
    let saveTimer = null;
    let abort = null;
    let seq = 0;
    let last = { ok: true, issues: [], checked: false };
    const hooks = { onRun: null, onDraftChange: null, setLabel: null };

    const $ = (id) => document.getElementById(id);
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // ---------- highlighting ----------

    /* HTML of `text` with keys, strings, numbers, punctuation, comments and <group> names coloured. */
    function highlight(text) {
        const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([{}[\],:])/g;
        let out = '';
        let lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
            out += esc(text.slice(lastIndex, m.index));
            if (m[1]) out += '<span class="c">' + esc(m[1]) + '</span>';
            else if (m[2]) {
                const inner = esc(m[2]).replace(/&lt;([^&]*?)&gt;/g, '<span class="g">&lt;$1&gt;</span>');
                out += '<span class="' + (m[3] ? 'k' : 's') + '">' + inner + '</span>' + (m[3] ? esc(m[3]) : '');
            } else if (m[4]) out += '<span class="n">' + esc(m[4]) + '</span>';
            else out += '<span class="p">' + esc(m[5]) + '</span>';
            lastIndex = re.lastIndex;
        }
        return out + esc(text.slice(lastIndex)) + '\n';       // the extra newline keeps the last empty line's height
    }

    function sync() {
        const x = -els.text.scrollLeft;
        const y = -els.text.scrollTop;
        els.hl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        els.marks.style.transform = 'translateY(' + y + 'px)';
        els.gutter.style.transform = 'translateY(' + y + 'px)';
    }

    function paint() {
        const text = els.text.value;
        els.hl.innerHTML = highlight(text);
        const lines = text.split('\n').length;
        const byLine = new Map();          // line -> its issues
        last.issues.forEach((i) => { if (!byLine.has(i.line)) byLine.set(i.line, []); byLine.get(i.line).push(i); });
        const severityOf = (issues) => (issues.some((i) => i.severity === 'error') ? 'error' : 'warning');
        els.gutter.textContent = '';
        for (let n = 1; n <= lines; n++) {
            const issues = byLine.get(n);
            const row = document.createElement('div');
            row.className = 'ln ' + (issues ? severityOf(issues) : '');
            if (issues) row.appendChild(flag(issues));
            const num = document.createElement('span');
            num.className = 'ln-num';
            num.setAttribute('aria-hidden', 'true');
            num.textContent = String(n);
            row.appendChild(num);
            els.gutter.appendChild(row);
        }
        els.marks.textContent = '';
        byLine.forEach((issues, line) => {
            const m = document.createElement('div');
            m.className = 'mark ' + severityOf(issues);
            m.style.top = (PAD + (line - 1) * LINE) + 'px';
            els.marks.appendChild(m);
        });
        sync();
    }

    const svgIcon = (paths, cls) => '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';

    // Lucide icons for the kind of warning (a warning shows only its kind; an error shows the circle-alert)
    const KIND_ICON = {
        duplicate_key: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',          // copy
        description_type: '<path d="M16 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-3"/><path d="M8 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3"/>',          // brackets
        placeholder_count: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',          // code
        order_empty: '<path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>',          // list-ordered
        rule_unused: '<path d="M20.4 20.4a2 2 0 01-1.4.6H5a2 2 0 01-2-2V5a2 2 0 01.59-1.41"/><path d="M21 15.3V5a2 2 0 00-2-2H8.7"/><path d="M22 22 2 2"/>',          // square-off
        group_unused: '<path d="m2 2 20 20"/><path d="M8.35 2.69A10 10 0 0 1 21.3 15.65"/><path d="M19.08 19.08A10 10 0 1 1 4.92 4.92"/>',          // circle-off
    };
    const MAX_ICONS = 2;          // symbols shown next to one line number (the tooltip lists every message)

    /* The symbols for some issues: an error has the circle-alert (then its kind, if it has one); warnings have only their kind. */
    function symbolsOf(issues) {
        const kinds = [...new Set(issues.map((i) => i.code).filter((code) => KIND_ICON[code]))].map((code) => KIND_ICON[code]);
        const symbols = issues.some((i) => i.severity === 'error') ? [FLAG_ICON.error, ...kinds] : kinds.length ? kinds : [FLAG_ICON.warning];
        return symbols.slice(0, MAX_ICONS);
    }

    // Lucide "circle-alert" (an error) and "triangle-alert" (a warning)
    const FLAG_ICON = {
        error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
        warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    };

    /* The alert symbol next to a line number; its tooltip (hover, tap or focus) gives the message of every issue on that line. */
    function flag(issues) {
        const severity = issues.some((i) => i.severity === 'error') ? 'error' : 'warning';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'flag ' + severity;
        b.innerHTML = symbolsOf(issues).map((paths) => svgIcon(paths)).join('');          // one tooltip for all of it
        b.setAttribute('aria-label', issues.map(issueText).join(' '));
        L.tooltip.rich(b, () => {
            const box = document.createElement('div');
            issues.forEach((i) => {
                const p = document.createElement('div');
                p.textContent = issueText(i);
                box.appendChild(p);
            });
            return box;
        });
        return b;
    }

    // ---------- validation ----------

    function issueText(i) {
        const key = 'issue_' + i.code + (i.code === 'wrong_type' ? '_' + (i.params && i.params.kind) : '');
        return I.t(key) !== key ? I.fmt(key, i.params || {}) : i.message;
    }

    function renderIssues() {
        const errors = last.issues.filter((i) => i.severity === 'error').length;
        const warnings = last.issues.length - errors;
        let summary;
        if (!els.text.value.trim()) summary = I.t('ed_empty');
        else if (!last.checked) summary = I.t('ed_checking');
        else if (!last.issues.length) summary = I.t('ed_ok');
        else summary = [errors ? I.count('ed_errors', errors) : '', warnings ? I.count('ed_warnings', warnings) : ''].filter(Boolean).join(' · ');
        els.summary.textContent = summary;
        // red with errors, amber with only warnings, green only when there is nothing to report
        els.summary.className = 'editor-summary ' + (errors ? 'bad' : warnings ? 'warn' : last.checked && els.text.value.trim() ? 'good' : '');
        els.problems.classList.toggle('has-issues', last.issues.length > 0);          // only a list with something in it opens
        if (!last.issues.length) els.problems.open = false;
        // the coloured line on the editor's left: red with errors, amber with warnings, green when valid; it keeps its colour while a new check runs
        if (!els.text.value.trim()) delete els.box.dataset.state;
        else if (last.checked) els.box.dataset.state = errors ? 'error' : warnings ? 'warning' : 'ok';
        els.issues.textContent = '';
        last.issues.forEach((i) => {
            const li = document.createElement('li');
            li.className = i.severity;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'issue';
            const sev = document.createElement('span');          // the same symbol as next to the line number
            sev.className = 'sev';
            sev.innerHTML = svgIcon(i.severity === 'error' ? FLAG_ICON.error : KIND_ICON[i.code] || FLAG_ICON.warning);
            b.appendChild(sev);
            const pos = document.createElement('span');
            pos.className = 'pos';
            pos.textContent = i.line + ':' + i.col;
            const msg = document.createElement('span');
            msg.className = 'msg';
            msg.textContent = issueText(i);
            b.appendChild(pos);
            b.appendChild(msg);
            if (i.path) {
                const path = document.createElement('span');
                path.className = 'path';
                path.textContent = i.path;
                b.appendChild(path);
            }
            b.addEventListener('click', () => goTo(i.line));
            li.appendChild(b);
            els.issues.appendChild(li);
        });
        paint();
    }

    async function validateNow() {
        clearTimeout(timer);
        const text = els.text.value;
        if (!text.trim()) { last = { ok: true, issues: [], checked: false }; renderIssues(); return last; }
        if (new Blob([text]).size > L.state.MAX_RULES_BYTES) {
            last = { ok: false, issues: [], checked: true };
            els.note.textContent = I.t('err_file_too_big');
            renderIssues();
            return last;
        }
        if (abort) abort.abort();
        abort = new AbortController();
        const mine = ++seq;
        try {
            const res = await L.api.validate(text, abort.signal);
            if (mine !== seq) return last;
            last = res.ok && res.data && res.data.issues ? Object.assign({ checked: true }, res.data) : { ok: false, issues: [], checked: false };
            if (!res.ok) els.note.textContent = I.t('err_server');
        } catch (e) {
            if (e && e.name === 'AbortError') return last;
            last = { ok: false, issues: [], checked: false };
        }
        renderIssues();
        return last;
    }

    function scheduleValidate() {
        last = Object.assign({}, last, { checked: false });
        clearTimeout(timer);
        timer = setTimeout(validateNow, 400);
    }

    function goTo(line) {
        const lines = els.text.value.split('\n');
        let start = 0;
        for (let n = 0; n < line - 1 && n < lines.length; n++) start += lines[n].length + 1;
        const end = start + (lines[line - 1] || '').length;
        els.text.focus();
        els.text.setSelectionRange(start, end);
        els.text.scrollTop = Math.max(0, PAD + (line - 1) * LINE - 3 * LINE);
        sync();
    }

    // ---------- the draft ----------

    function setText(text, name) {
        els.text.value = text;
        savedText = text;          // it comes from a file or a bundled set: nothing to lose until it is edited
        if (name) { S.mineName = name; els.name.value = name; }
        S.mine = text;
        L.state.saveMine();
        if (hooks.onDraftChange) hooks.onDraftChange();
        els.note.textContent = '';
        last = { ok: true, issues: [], checked: false };
        renderIssues();
        validateNow();
    }

    function onInput() {
        S.mine = els.text.value;
        els.note.textContent = '';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { L.state.saveMine(); if (hooks.onDraftChange) hooks.onDraftChange(); }, 500);
        paint();
        scheduleValidate();
    }

    // ---------- replacing what is in the editor ----------

    const DOWNLOAD_ICON = ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'];          // Lucide "download"
    let savedText = null;          // the text as it was last downloaded or loaded from a file or a bundled set; null: not yet
    const isSaved = () => savedText !== null && savedText === els.text.value;

    /* A modal over a semi-transparent backdrop: the text in the editor is about to be replaced. If it has not been downloaded
       since it last changed, it says so and offers to download it first. `onYes` runs only on "Replace". */
    function askReplace(onYes) {
        const previous = document.activeElement;
        const back = document.createElement('div');
        back.className = 'modal-backdrop';
        const box = document.createElement('div');
        box.className = 'modal';
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        const title = document.createElement('h3');
        title.className = 'modal-title';
        title.id = 'edModalTitle';
        title.textContent = I.t('ed_replace_q');
        box.setAttribute('aria-labelledby', title.id);
        const body = document.createElement('p');
        body.textContent = I.t('ed_replace_body');
        box.appendChild(title);
        box.appendChild(body);
        let save = null;
        if (!isSaved()) {
            const warn = document.createElement('p');
            warn.className = 'modal-warn';
            warn.textContent = I.t('ed_replace_unsaved');
            save = document.createElement('button');
            save.type = 'button';
            save.className = 'btn has-icon modal-save';
            const icon = L.viewer.icon(DOWNLOAD_ICON);
            icon.setAttribute('class', 'icon');          // sized and outlined like the icons of the other buttons
            ['fill:none', 'stroke:currentColor', 'stroke-width:2', 'stroke-linecap:round', 'stroke-linejoin:round'].forEach((a) => icon.setAttribute(a.split(':')[0], a.split(':')[1]));
            save.appendChild(icon);
            save.appendChild(document.createTextNode(I.t('ed_save_first')));
            save.addEventListener('click', () => {
                download();
                warn.textContent = I.fmt('ed_replace_saved', { name: fileName(S.mineName || DEFAULT_NAME) });
                warn.classList.remove('modal-warn');
                save.remove();
            });
            box.appendChild(warn);
        }
        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        if (save) actions.appendChild(save);          // on the left; Cancel and Replace on the right
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'btn';
        no.textContent = I.t('cancel');
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'btn primary';
        yes.textContent = I.t('ed_replace_yes');
        actions.appendChild(no);
        actions.appendChild(yes);
        box.appendChild(actions);
        back.appendChild(box);

        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            document.documentElement.classList.remove('modal-open');
            back.remove();
            if (previous && previous.focus) previous.focus();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
            if (e.key !== 'Tab') return;
            const items = Array.from(box.querySelectorAll('button')).filter((b) => !b.disabled);          // Tab stays inside the dialog
            const at = items.indexOf(document.activeElement);
            const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1);
            e.preventDefault();
            items[next].focus();
        };
        no.addEventListener('click', close);
        yes.addEventListener('click', () => { close(); onYes(); });
        back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
        document.addEventListener('keydown', onKey, true);
        document.documentElement.classList.add('modal-open');
        document.body.appendChild(back);
        no.focus();          // the safe choice has the focus
    }

    /* "Edit a copy of <set>": the bundled set's own text (with its comments) becomes the draft. */
    function fork() {
        if (S.setId === 'mine') return;
        const id = S.setId;
        const doFork = async () => {
            const res = await L.api.ruleText(id);
            if (!res.ok) { els.note.textContent = I.t('err_server'); return; }
            setText(res.text, 'my-' + id + '.json');
            els.text.focus();
        };
        if (els.text.value.trim()) askReplace(doFork);
        else doFork();
    }

    function openFile(file) {
        if (!file) return;
        if (file.size > L.state.MAX_RULES_BYTES) { els.note.textContent = I.t('err_file_too_big'); return; }
        const reader = new FileReader();
        reader.onload = () => {
            const text = String(reader.result);
            const load = () => setText(text, file.name);
            if (els.text.value.trim() && els.text.value !== text) askReplace(load);
            else load();
        };
        reader.readAsText(file, 'utf-8');
    }

    /* Re-indents a rules text the way the files are written: one entry per line, indented with tabs when the text
       uses tabs (else two spaces), short lists and objects such as ["a", "b"] or {"": ""} kept on one line when they were on one line.
       // comments stay where they are (own-line comments on their own line, trailing ones after their value), and
       so do blank lines (at most one in a row) and list items that shared a line. Returns null when the text is not JSON tokens and comments. */
    function formatText(text) {
        const re = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)|([{}[\],:])/g;
        const tokens = [];
        let last = 0;
        let m;
        while ((m = re.exec(text))) {
            const gap = text.slice(last, m.index);
            if (/\S/.test(gap)) return null;
            tokens.push({ kind: m[1] ? 'c' : m[2] ? 's' : m[3] ? 'v' : 'p', text: m[0], newlines: (gap.match(/\n/g) || []).length });
            last = re.lastIndex;
        }
        if (/\S/.test(text.slice(last))) return null;

        const indents = (text.match(/^ +(?=\S)/gm) || []).map((x) => x.length);
        const unit = /^\t/m.test(text) ? '\t' : ' '.repeat(indents.length ? Math.min(...indents) : 2);          // the text's own indentation
        const lines = [];
        let cur = null;                         // the line being written (without its indent), or null
        let depth = 0;
        let needBreak = false;                  // the next item starts a new line
        let afterOpener = false;
        const stack = [];                       // the lists and objects we are inside
        const flush = () => { if (cur !== null) { lines.push(unit.repeat(Math.max(0, depth)) + cur); cur = null; } };
        const startItem = (t) => {
            if (needBreak || cur === null) {
                flush();
                if (t.newlines > 1 && lines.length && !afterOpener) lines.push('');          // keep one blank line
                needBreak = false;
            }
            afterOpener = false;
        };
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.kind === 'c') {
                if (t.newlines === 0 && cur !== null) cur += ' ' + t.text;                 // trailing: stays on its line
                else { startItem(t); cur = t.text; needBreak = true; }
                continue;
            }
            if (t.kind === 'p' && (t.text === '}' || t.text === ']')) {
                flush();
                depth--;
                stack.pop();
                cur = t.text;
                needBreak = false;
                continue;
            }
            if (t.kind === 'p' && t.text === ',') { cur = (cur === null ? '' : cur) + ','; needBreak = true; continue; }
            if (t.kind === 'p' && t.text === ':') { cur += ': '; continue; }
            if (t.kind === 'p') {                                                         // { or [
                if (cur === null || needBreak) startItem(t);
                const next = tokens[i + 1];
                const close = t.text === '{' ? '}' : ']';
                if (cur === null) cur = '';
                {                                                                         // a short list or object written on one line stays on one line
                    let j = i + 1;
                    const plain = (x) => x.kind === 's' || x.kind === 'v' || (x.kind === 'p' && (x.text === ',' || x.text === ':'));
                    while (j < tokens.length && plain(tokens[j]) && tokens[j].newlines === 0) j++;
                    if (j > i + 1 && j < tokens.length && tokens[j].kind === 'p' && tokens[j].text === close && tokens[j].newlines === 0) {
                        cur += t.text + tokens.slice(i + 1, j).map((x) => (x.text === ',' ? ', ' : x.text === ':' ? ': ' : x.text)).join('') + close;
                        i = j;
                        continue;
                    }
                }
                if (next && next.kind === 'p' && next.text === close) { cur += t.text + close; i++; continue; }          // an empty one stays {} / []
                cur += t.text;
                flush();
                depth++;
                stack.push(t.text);
                needBreak = false;
                afterOpener = true;
                continue;
            }
            if (needBreak && cur !== null && t.newlines === 0 && cur.endsWith(',') && stack[stack.length - 1] === '[') { cur += ' '; needBreak = false; }          // list items that shared a line keep sharing it
            if (cur === null || needBreak) startItem(t);                                  // a key or a value
            cur = (cur === null ? '' : cur) + t.text;
        }
        flush();
        const out = lines.join('\n') + '\n';
        // safety: without the comments, the result must mean exactly what the text meant
        const bare = (list) => list.filter((t) => t.kind !== 'c').map((t) => t.text).join(' ');
        try {
            const a = JSON.stringify(JSON.parse(bare(tokens)));
            const re2 = new RegExp(re.source, 'g');
            const again = [];
            let n;
            while ((n = re2.exec(out))) again.push({ kind: n[1] ? 'c' : 'x', text: n[0] });
            if (a !== JSON.stringify(JSON.parse(bare(again)))) return null;
        } catch (e) {
            return null;
        }
        return out;
    }

    function format() {
        const out = formatText(els.text.value);
        if (out === null) { els.note.textContent = I.t('err_invalid_json'); return; }
        els.text.value = out;
        onInput();
    }

    // ---------- the file name (what Download calls the file) ----------

    const DEFAULT_NAME = 'my-rules.json';

    /* A name a file can have anywhere: no path or reserved characters, not empty, ending in .json. */
    function fileName(text) {
        const base = text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+/, '').replace(/\.json$/i, '');
        return (base || DEFAULT_NAME.replace(/\.json$/, '')) + '.json';
    }

    function onName() {
        S.mineName = els.name.value.trim() ? els.name.value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-') : S.mineName;
        L.state.saveMine();
        if (hooks.onDraftChange) hooks.onDraftChange();
    }

    // ---------- a new file ----------

    /* What "New" writes: transformations/template_en.json or template_es.json (a small rules file that works), from the server. */
    let lastTemplate = null;          // the template New wrote last: while it is untouched, New does not ask before writing a new one

    function newFile() {
        const make = async () => {
            let res = null;
            try { res = await L.api.template(I.lang); } catch (e) { /* network failure */ }
            if (!res || !res.ok) { els.note.textContent = I.t('err_server'); return; }
            setText(res.text, I.t('ed_filename_placeholder'));
            lastTemplate = res.text;
            els.text.focus();
            const m = /"description"\s*:\s*\[\s*"([^"\n]*)"/.exec(res.text);          // the example description is selected, so the first thing typed replaces it
            if (m) { const at = res.text.indexOf(m[1], m.index); els.text.setSelectionRange(at, at + m[1].length); }
        };
        if (els.text.value.trim() && els.text.value !== lastTemplate) askReplace(make);
        else make();
    }

    function download() {
        L.exporter.download(els.text.value, 'application/json', fileName(S.mineName || DEFAULT_NAME));
        savedText = els.text.value;
    }

    async function run() {
        if (!els.text.value.trim()) { els.note.textContent = I.t('ed_empty'); return; }
        const result = await validateNow();
        if (!result.ok) { els.note.textContent = I.t('ed_fix_first'); return; }
        S.mine = els.text.value;
        L.state.saveMine();
        if (hooks.onRun) hooks.onRun();
    }

    /* Text of the "edit a copy" button and its availability, for the set now in use. */
    // ---------- full page ----------

    const COLLAPSE_ICON = ['m14 10 7-7', 'M20 10h-6V4', 'm3 21 7-7', 'M4 14h6v6'];          // Lucide "minimize-2"; the tree viewer's expand icon is "maximize-2"

    const isFull = () => els.panel.classList.contains('editor-full');

    function renderExpand() {
        const label = I.t(isFull() ? 'ed_collapse' : 'ed_expand');
        els.expand.textContent = '';
        els.expand.appendChild(L.viewer.icon(isFull() ? COLLAPSE_ICON : L.viewer.ICONS.max));
        els.expand.setAttribute('aria-label', label);
        els.expand.setAttribute('data-tip', label);
        els.expand.setAttribute('aria-pressed', String(isFull()));
    }

    /* The editor panel (title, buttons, notes, editor, summary) fills the window; the page behind does not scroll, as in the tree viewer. */
    function setFull(on) {
        if (!els || isFull() === on) return;
        els.panel.classList.toggle('editor-full', on);
        document.documentElement.classList.toggle('viewer-open', on);
        renderExpand();
        sync();
        if (on) els.text.focus();
    }

    function refresh() {
        if (!els) return;
        renderExpand();
        const isPreset = S.setId !== 'mine';
        els.copyOf.hidden = !isPreset;
        if (isPreset && hooks.setLabel) els.copyOf.textContent = I.fmt('ed_copy_of', { set: hooks.setLabel(S.setId) });
        renderIssues();
        if (!els.text.value.trim()) validateNow();
    }

    function init() {
        els = {
            text: $('edText'), hl: $('edHl'), gutter: $('edGutter'), marks: $('edMarks'), note: $('edNote'),
            summary: $('edSummary'), issues: $('edIssues'), copyOf: $('edCopyOf'), file: $('edFile'),
            panel: $('edPanel'), expand: $('edExpand'), name: $('edName'), problems: $('edProblems'),
        };
        els.box = els.text.closest('.editor');
        els.text.value = S.mine;
        els.text.addEventListener('input', onInput);
        els.text.addEventListener('scroll', sync);
        els.text.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
        els.copyOf.addEventListener('click', fork);
        $('edNew').addEventListener('click', newFile);
        $('edOpen').addEventListener('click', () => { els.file.value = ''; els.file.click(); });
        els.file.addEventListener('change', () => openFile(els.file.files[0]));
        $('edFormat').addEventListener('click', format);
        $('edDownload').addEventListener('click', download);
        $('edRun').addEventListener('click', run);
        els.expand.addEventListener('click', () => setFull(!isFull()));
        els.summary.addEventListener('click', (e) => { if (!last.issues.length) e.preventDefault(); });          // nothing to list: it does not open
        els.name.value = S.mineName;
        els.name.addEventListener('input', onName);
        els.name.addEventListener('change', () => { S.mineName = fileName(els.name.value); els.name.value = S.mineName; L.state.saveMine(); if (hooks.onDraftChange) hooks.onDraftChange(); });          // leaving the field: the name as it will download
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setFull(false); });
        refresh();
        if (S.mine.trim()) validateNow();
    }

    L.editor = { init, refresh, run, fork, hooks, validateNow, highlight, formatText, setText, collapse: () => setFull(false), focus: () => els && els.text.focus() };
})();
