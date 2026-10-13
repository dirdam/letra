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
        if (name !== 'iden') head.appendChild(span('used-badge', I.t('rb_in_use'), I.t('rb_in_use_title')));      // shown only while the rule is in use
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

        const names = Object.keys(d.groups).filter((g) => !needle || g.toLowerCase().includes(needle));
        if (names.length) {
            const sec = document.createElement('details');
            sec.className = 'rb-groups';
            sec.open = !!needle;
            const sum = document.createElement('summary');
            sum.textContent = I.count('rb_groups', names.length);
            sec.appendChild(sum);
            const list = document.createElement('div');
            list.className = 'rb-columns rb-group-list';
            names.forEach((g) => {
                const item = document.createElement('div');
                item.className = 'rb-group';
                item.appendChild(span('grp', '⟨' + g + '⟩'));
                const info1 = d.groups[g];
                item.appendChild(span('members', info1.members.map((m) => (m === ' ' ? L.state.BOUNDARY : m)).join('  ') + (info1.total > info1.members.length ? '  … (' + info1.total + ')' : '')));
                list.appendChild(item);
            });
            sec.appendChild(list);
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
