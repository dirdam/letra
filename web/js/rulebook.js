/* The rule book: the rules of the current set in reading order. Also the shared way of showing a
   rule's pattern -> replacement, with group names as chips and # for the word boundary. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;

    let current = null;                 // {key, data}: the rule book of the set in use
    const cache = new Map();

    function keyOf(set) {
        if (set.preset) return 'p:' + set.preset;
        let h = 5381;
        for (let i = 0; i < set.rules.length; i++) h = ((h << 5) + h + set.rules.charCodeAt(i)) | 0;
        return 'r:' + h + ':' + set.rules.length;
    }

    /* Loads (once per set) the rule book from the server. Resolves to the data, or {error: code}. */
    async function load(set) {
        const key = keyOf(set);
        if (cache.has(key)) { current = { key, data: cache.get(key) }; return current.data; }
        const res = await L.api.rulebook(set);
        if (!res.ok || !res.data || res.data.error) {
            current = null;
            return { error: (res.data && res.data.error) || 'server' };
        }
        cache.set(key, res.data);
        current = { key, data: res.data };
        return res.data;
    }

    const info = () => (current && current.data) || null;

    function stats() {
        const d = info();
        return d ? { groups: Object.keys(d.groups).length, rules: Object.keys(d.rules).length, steps: d.order.length } : null;
    }

    const entriesFor = (rule) => (info() && info().rules[rule]) || [];

    /* Tooltip text for a group placeholder such as "cons*" or "vow|cons": the members of each group. */
    function groupTitle(inner) {
        const groups = info() && info().groups;
        if (!groups) return '';
        return inner.split('|').map((part) => {
            const name = part.replace(/[*=]/g, '');
            const g = groups[name];
            if (!g) return name;
            return name + ': ' + g.members.slice(0, 14).join(' ') + (g.total > 14 ? ' … (' + g.total + ')' : '');
        }).join('\n');
    }

    function span(cls, text, title) {
        const e = document.createElement('span');
        e.className = cls;
        e.textContent = text;
        if (title) e.title = title;
        return e;
    }

    /* A pattern or replacement as DOM: <group> placeholders as chips, a leading or trailing space as the boundary mark (the open box ␣). */
    function pattern(str) {
        const frag = document.createDocumentFragment();
        if (str === '') { frag.appendChild(span('empty', '∅', I.t('nothing_title'))); return frag; }
        let body = str;
        const boundary = () => span('wb', L.state.BOUNDARY, I.t('boundary_title'));
        if (body === ' ') { frag.appendChild(boundary()); return frag; }
        if (body.startsWith(' ')) { frag.appendChild(boundary()); body = body.slice(1); }
        let trailing = false;
        if (body.endsWith(' ')) { trailing = true; body = body.slice(0, -1); }
        let last = 0;
        const re = /<([^<>]*)>/g;
        let m;
        while ((m = re.exec(body))) {
            if (m.index > last) frag.appendChild(span('lit', body.slice(last, m.index)));
            frag.appendChild(span('grp', '⟨' + (m[1] === '' ? '∅' : m[1]) + '⟩', m[1] === '' ? I.t('deleted_group_title') : groupTitle(m[1])));
            last = m.index + m[0].length;
        }
        if (last < body.length) frag.appendChild(span('lit', body.slice(last)));
        if (trailing) frag.appendChild(boundary());
        return frag;
    }

    /* "pattern → replacement" for one entry of a rule. */
    function pair(entry) {
        const e = span('pair', '');
        e.appendChild(pattern(entry[0]));
        e.appendChild(span('arrow', ' → '));
        e.appendChild(pattern(entry[1]));
        return e;
    }

    // ---------- the Rule book tab ----------

    function ruleBlock(name, extraClass) {
        const block = document.createElement('div');
        block.className = 'rb-rule' + (extraClass ? ' ' + extraClass : '');
        block.dataset.rule = name;
        const head = document.createElement('div');
        head.className = 'rb-rule-head';
        head.appendChild(span('rule-name', name === 'iden' ? I.t('rb_iden') : name));
        block.appendChild(head);
        if (name !== 'iden') {
            const ul = document.createElement('ul');
            ul.className = 'rb-entries';
            entriesFor(name).forEach((entry) => {
                const li = document.createElement('li');
                li.appendChild(pair(entry));
                ul.appendChild(li);
            });
            block.appendChild(ul);
        }
        return block;
    }

    function matches(name, needle) {
        if (!needle) return true;
        if (name.toLowerCase().includes(needle)) return true;
        return entriesFor(name).some((e) => e[0].toLowerCase().includes(needle) || e[1].toLowerCase().includes(needle));
    }

    /* Draws the rule book into `body`; `needle` filters (lower-case text), `used` is a Set of rule names to mark. */
    function render(body, needle, used) {
        const d = info();
        body.textContent = '';
        if (!d) { body.appendChild(span('empty-note', I.t('rb_unavailable'))); return; }
        needle = (needle || '').trim().toLowerCase();

        const steps = document.createElement('div');
        steps.className = 'rb-steps';
        let shown = 0;
        d.order.forEach((stepText, i) => {
            const alts = stepText.split('|');
            if (!alts.some((a) => matches(a, needle))) return;
            shown++;
            const step = document.createElement('div');
            step.className = 'rb-step' + (alts.length > 1 ? ' branch' : '');
            step.appendChild(span('rb-num', String(i + 1)));
            const box = document.createElement('div');
            box.className = 'rb-alts';
            if (alts.length > 1) box.appendChild(span('rb-branch-note', I.t('rb_alternatives')));
            alts.forEach((a) => box.appendChild(ruleBlock(a)));
            step.appendChild(box);
            steps.appendChild(step);
        });
        if (!shown) steps.appendChild(span('empty-note', I.t('rb_no_match')));
        body.appendChild(steps);

        const inOrder = new Set(d.order.flatMap((s) => s.split('|')));
        const unused = Object.keys(d.rules).filter((r) => !inOrder.has(r) && matches(r, needle));
        if (unused.length) {
            const sec = document.createElement('details');
            sec.className = 'rb-unused';
            sec.open = !!needle;
            const sum = document.createElement('summary');
            sum.textContent = I.count('rb_unused', unused.length);
            sec.appendChild(sum);
            unused.forEach((r) => sec.appendChild(ruleBlock(r, 'unused')));
            body.appendChild(sec);
        }

        const names = Object.keys(d.groups).filter((g) => !needle || g.toLowerCase().includes(needle));
        if (names.length) {
            const sec = document.createElement('details');
            sec.className = 'rb-groups';
            sec.open = !!needle;
            const sum = document.createElement('summary');
            sum.textContent = I.count('rb_groups', names.length);
            sec.appendChild(sum);
            const dl = document.createElement('dl');
            names.forEach((g) => {
                const dt = document.createElement('dt');
                dt.appendChild(span('grp', '⟨' + g + '⟩'));
                const dd = document.createElement('dd');
                const info1 = d.groups[g];
                dd.textContent = info1.members.map((m) => (m === ' ' ? L.state.BOUNDARY : m)).join('  ') + (info1.total > info1.members.length ? '  … (' + info1.total + ')' : '');
                dl.appendChild(dt);
                dl.appendChild(dd);
            });
            sec.appendChild(dl);
            body.appendChild(sec);
        }
        mark(body, used);
    }

    /* Marks the rules used by the derivations on screen. */
    function mark(body, used) {
        body.querySelectorAll('.rb-rule').forEach((el) => el.classList.toggle('used', !!used && used.has(el.dataset.rule)));
    }

    L.rulebook = { load, info, stats, entriesFor, pattern, pair, render, mark };
})();
