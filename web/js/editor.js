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
        const bad = new Map();
        last.issues.forEach((i) => { if (bad.get(i.line) !== 'error') bad.set(i.line, i.severity); });
        let nums = '';
        for (let n = 1; n <= lines; n++) nums += '<span class="ln ' + (bad.get(n) || '') + '">' + n + '</span>\n';
        els.gutter.innerHTML = nums;
        els.marks.textContent = '';
        bad.forEach((severity, line) => {
            const m = document.createElement('div');
            m.className = 'mark ' + severity;
            m.style.top = (PAD + (line - 1) * LINE) + 'px';
            els.marks.appendChild(m);
        });
        sync();
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
        els.summary.className = 'editor-summary ' + (errors ? 'bad' : last.checked && els.text.value.trim() ? 'good' : '');
        els.issues.textContent = '';
        last.issues.forEach((i) => {
            const li = document.createElement('li');
            li.className = i.severity;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'issue';
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
        if (name) S.mineName = name;
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

    function confirmReplace(onYes) {
        els.note.textContent = '';
        const span = document.createElement('span');
        span.textContent = I.t('ed_replace_q') + ' ';
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'btn small primary';
        yes.textContent = I.t('ed_replace_yes');
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'btn small';
        no.textContent = I.t('cancel');
        yes.addEventListener('click', () => { els.note.textContent = ''; onYes(); });
        no.addEventListener('click', () => { els.note.textContent = ''; });
        els.note.appendChild(span);
        els.note.appendChild(yes);
        els.note.appendChild(document.createTextNode(' '));
        els.note.appendChild(no);
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
        if (els.text.value.trim()) confirmReplace(doFork);
        else doFork();
    }

    function openFile(file) {
        if (!file) return;
        if (file.size > L.state.MAX_RULES_BYTES) { els.note.textContent = I.t('err_file_too_big'); return; }
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result), file.name);
        reader.readAsText(file, 'utf-8');
    }

    function format() {
        const text = els.text.value;
        if (/\/\//.test(text)) { els.note.textContent = I.t('ed_format_comments'); return; }
        try {
            els.text.value = JSON.stringify(JSON.parse(text), null, 2) + '\n';
            onInput();
        } catch (e) {
            els.note.textContent = I.t('err_invalid_json');
        }
    }

    function download() {
        L.exporter.download(els.text.value, 'application/json', S.mineName || 'my-rules.json');
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
    function refresh() {
        if (!els) return;
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
        };
        els.text.value = S.mine;
        els.text.addEventListener('input', onInput);
        els.text.addEventListener('scroll', sync);
        els.text.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
        els.copyOf.addEventListener('click', fork);
        $('edOpen').addEventListener('click', () => { els.file.value = ''; els.file.click(); });
        els.file.addEventListener('change', () => openFile(els.file.files[0]));
        $('edFormat').addEventListener('click', format);
        $('edDownload').addEventListener('click', download);
        $('edRun').addEventListener('click', run);
        refresh();
        if (S.mine.trim()) validateNow();
    }

    L.editor = { init, refresh, run, fork, hooks, validateNow, highlight, setText, focus: () => els && els.text.focus() };
})();
