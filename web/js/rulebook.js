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
        let res;
        try { res = await L.api.rulebook(set); } catch (e) { current = null; return { error: 'server' }; }          // network failure
        if (!res.ok || !res.data || res.data.error) {
            current = null;
            return { error: (res.data && res.data.error) || 'server' };
        }
        cache.set(key, res.data);
        current = { key, data: res.data };
        return res.data;
    }

    const info = () => (current && current.data) || null;

    /* The description the rules file carries (a list of ready-made HTML bullets) for the set in use and the page's language;
       null when the file has none or the set's rule book is not the one loaded. */
    function description(set, lang) {
        const d = current && set && current.key === keyOf(set) && current.data && current.data.description;
        return d ? (d[lang] || d['*'] || d.en || d[Object.keys(d)[0]] || null) : null;
    }

    function stats() {
        const d = info();
        return d ? { groups: Object.keys(d.groups).length, rules: Object.keys(d.rules).length, steps: d.order.length } : null;
    }

    const entriesFor = (rule) => (info() && info().rules[rule]) || [];

    const TIP_MEMBERS = 24;       // values shown in a group's tooltip before "…"

    /* Tooltip text for a group placeholder such as "cons*" or "vow|cons": just the values, without the group names. */
    function groupTitle(inner) {
        const groups = info() && info().groups;
        if (!groups) return '';
        const values = [];
        let more = false;
        inner.split('|').forEach((part) => {
            const g = groups[part.replace(/[*=]/g, '')];
            if (!g) return;
            if (g.total > g.members.length) more = true;
            g.members.forEach((m) => { if (!values.includes(m)) values.push(m); });
        });
        if (!values.length) return '';
        if (values.length > TIP_MEMBERS) more = true;
        return values.slice(0, TIP_MEMBERS).map((m) => (m === ' ' ? L.state.BOUNDARY : m)).join(' ') + (more ? ' …' : '');
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
            entriesFor(name).forEach((entry, position) => {
                const li = document.createElement('li');
                li.dataset.pos = String(position);
                li.appendChild(pair(entry));
                li.appendChild(span('used-badge', I.t('rb_in_use'), I.t('rb_in_use_title')));      // shown only on the rows that are being applied
                ul.appendChild(li);
            });
            block.appendChild(ul);
        }
        return block;
    }

    /* A curly brace "{" that stretches to the height of the rules it groups (non-scaling stroke keeps the line thin). */
    function brace() {
        const NS = 'http://www.w3.org/2000/svg';
        const holder = document.createElement('div');
        holder.className = 'rb-brace';
        holder.setAttribute('aria-hidden', 'true');
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 14 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', 'M13 1 Q7 1 7 9 L7 41 Q7 50 1 50 Q7 50 7 59 L7 91 Q7 99 13 99');
        svg.appendChild(path);
        holder.appendChild(svg);
        return holder;
    }

    function matches(name, needle) {
        if (!needle) return true;
        if (name.toLowerCase().includes(needle)) return true;
        return entriesFor(name).some((e) => e[0].toLowerCase().includes(needle) || e[1].toLowerCase().includes(needle));
    }

    /* The last step of each column gets no dashed line under it. CSS cannot pick "the last item of a column",
       so the steps whose next step sits elsewhere (or that have none) are marked; the line turns transparent
       rather than disappearing, so the columns keep their height. Re-run whenever the layout changes. */
    function markColumnEnds(steps) {
        const list = Array.from(steps.querySelectorAll('.rb-step'));
        list.forEach((el, i) => {
            const next = list[i + 1];
            el.classList.toggle('col-end', !next || Math.abs(next.getBoundingClientRect().left - el.getBoundingClientRect().left) > 1);
        });
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
            if (alts.length > 1) {
                box.appendChild(span('rb-branch-note', I.t('rb_alternatives')));      // the label stays above; the brace covers only the rules
                const branch = document.createElement('div');
                branch.className = 'rb-branch';
                branch.appendChild(brace());
                const rulesBox = document.createElement('div');
                rulesBox.className = 'rb-branch-rules';
                alts.forEach((a) => rulesBox.appendChild(ruleBlock(a)));
                branch.appendChild(rulesBox);
                box.appendChild(branch);
            } else {
                box.appendChild(ruleBlock(alts[0]));
            }
            step.appendChild(box);
            steps.appendChild(step);
        });
        if (!shown) steps.appendChild(span('empty-note', I.t('rb_no_match')));
        body.appendChild(steps);
        if (shown && typeof ResizeObserver === 'function') new ResizeObserver(() => markColumnEnds(steps)).observe(steps);

        const inOrder = new Set(d.order.flatMap((s) => s.split('|')));
        const unused = Object.keys(d.rules).filter((r) => !inOrder.has(r) && matches(r, needle));
        if (unused.length) {
            const sec = document.createElement('details');
            sec.className = 'rb-unused';
            sec.open = !!needle;
            const sum = document.createElement('summary');
            sum.textContent = I.count('rb_unused', unused.length);
            sec.appendChild(sum);
            const list = document.createElement('div');
            list.className = 'rb-columns';
            unused.forEach((r) => list.appendChild(ruleBlock(r, 'unused')));
            sec.appendChild(list);
            body.appendChild(sec);
        }

        // groups with exactly the same members (e.g. an abbreviation and the full name) share one line
        const lines = new Map();
        Object.keys(d.groups).filter((g) => !needle || g.toLowerCase().includes(needle)).forEach((g) => {
            const key = d.groups[g].total + '\u0000' + d.groups[g].members.join('\u0000');
            if (!lines.has(key)) lines.set(key, []);
            lines.get(key).push(g);
        });
        if (lines.size) {
            const sec = document.createElement('details');
            sec.className = 'rb-groups';
            sec.open = !!needle;
            const sum = document.createElement('summary');
            sum.textContent = I.count('rb_groups', lines.size);
            sec.appendChild(sum);
            const list = document.createElement('div');
            list.className = 'rb-columns rb-group-list';
            lines.forEach((names) => {
                const item = document.createElement('div');
                item.className = 'rb-group';
                const tags = document.createElement('span');
                tags.className = 'rb-group-names';
                names.forEach((g) => tags.appendChild(span('grp', '⟨' + g + '⟩')));
                item.appendChild(tags);
                const info1 = d.groups[names[0]];
                item.appendChild(span('members', info1.members.map((m) => (m === ' ' ? L.state.BOUNDARY : m)).join('  ') + (info1.total > info1.members.length ? '  … (' + info1.total + ')' : '')));
                list.appendChild(item);
            });
            sec.appendChild(list);
            body.appendChild(sec);
        }
        mark(body, used);
    }

    /* Marks what the derivations on screen use. `used` maps a rule to the positions of its rows that applied (null: all rows).
       The rule keeps a `used` class, but the callout and the badge go on the rows themselves, not on the whole rule. */
    function mark(body, used) {
        body.querySelectorAll('.rb-rule').forEach((el) => {
            const on = !!used && used.has(el.dataset.rule);
            const rows = on ? used.get(el.dataset.rule) : undefined;
            el.classList.toggle('used', on);
            el.querySelectorAll('.rb-entries > li').forEach((li) => li.classList.toggle('used', on && (rows === null || rows.has(Number(li.dataset.pos)))));
        });
    }

    L.rulebook = { load, info, description, stats, entriesFor, pattern, pair, render, mark };
})();
