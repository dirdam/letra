/* Results: one card per word (or a table), each with its forms and the derivation of the chosen form,
   as a chain of steps or as a tree. Everything that comes from the server is inserted as text. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;
    const S = L.state.s;

    const isMark = (ch) => !!ch && /\p{M}/u.test(ch);
    const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };

    /* Forms carry a space at each end (the word boundary): show it as the boundary mark. */
    const show = (s) => s.replace(/^ /, L.state.BOUNDARY).replace(/ $/, L.state.BOUNDARY);
    const plain = (s) => s.trim();

    /* The part two strings share at the start and at the end, and the part that differs.
       Never splits a letter from its combining mark. */
    function diff(a, b) {
        const A = Array.from(a);
        const B = Array.from(b);
        let p = 0;
        while (p < A.length && p < B.length && A[p] === B[p]) p++;
        while (p > 0 && (isMark(A[p]) || isMark(B[p]))) p--;
        let q = 0;
        while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
        while (q > 0 && (isMark(A[A.length - q]) || isMark(B[B.length - q]))) q--;
        return {
            pre: A.slice(0, p).join(''),
            aMid: A.slice(p, A.length - q).join(''),
            bMid: B.slice(p, B.length - q).join(''),
            post: A.slice(A.length - q).join(''),
        };
    }

    /* "was → now" with the part that changed marked. */
    function changeNode(from, to) {
        const d = diff(show(from), show(to));
        const side = (cls, mid, other) => {
            const w = el('span', 'form-text');
            w.appendChild(document.createTextNode(d.pre));
            if (mid) w.appendChild(el('span', cls, mid));          // an empty side stays empty (no ∅ here)
            w.appendChild(document.createTextNode(d.post));
            return w;
        };
        const wrap = el('span', 'change');
        wrap.appendChild(side('del', d.aMid, d.bMid));
        wrap.appendChild(el('span', 'arrow', ' → '));
        wrap.appendChild(side('ins', d.bMid, d.aMid));
        return wrap;
    }

    /* The steps from the start to `form`, following the first path the engine found. */
    function chainFor(r, form) {
        const steps = [];
        let cur = form;
        let guard = 0;
        while (cur !== r.start && r.terms[cur] && guard++ < 500) {
            const info = r.terms[cur];
            const alsoEdges = r.edges.filter((e) => e[2] === info.mother && e[3] === cur && e[1] !== info.rule);
            const also = [...new Set(alsoEdges.map((e) => e[1]))];
            const alsoApplied = {};          // for each of the other rules that give the same result: the entries of it that applied (null: unknown)
            alsoEdges.forEach((e) => { alsoApplied[e[1]] = e[4] == null || alsoApplied[e[1]] === null ? null : [...new Set([...(alsoApplied[e[1]] || []), ...e[4]])]; });
            const edge = r.edges.find((e) => e[1] === info.rule && e[2] === info.mother && e[3] === cur);
            steps.push({ rule: info.rule, from: info.mother, to: cur, also, alsoApplied, applied: edge ? edge[4] : null });
            cur = info.mother;
        }
        return steps.reverse();
    }

    const selectedOf = (r) => (S.selected[r.term] && r.final.includes(S.selected[r.term]) ? S.selected[r.term] : r.final[0]);

    const handlers = { onRule: null, onUsedChange: null };

    function chainEl(r, form) {
        const steps = chainFor(r, form);
        const ol = el('ol', 'chain');
        const start = el('li', 'step start');
        start.appendChild(el('span', 'num', '0'));
        const sb = el('div', 'stepbody');
        sb.appendChild(el('span', 'form-text start-form', show(r.start)));
        start.appendChild(sb);
        ol.appendChild(start);
        if (!steps.length) {
            const note = el('li', 'step note');
            note.appendChild(el('span', 'num', ''));
            note.appendChild(el('div', 'stepbody dim', I.t('no_change')));
            ol.appendChild(note);
        }
        steps.forEach((st, i) => {
            const li = el('li', 'step');
            li.appendChild(el('span', 'num', String(i + 1)));
            const body = el('div', 'stepbody');
            const head = el('div', 'step-head');
            const rule = el('button', 'rule-name link', st.rule);
            rule.type = 'button';
            rule.title = I.t('go_to_rule');
            rule.addEventListener('click', () => handlers.onRule && handlers.onRule(st.rule));
            head.appendChild(rule);
            if (st.also.length) head.appendChild(el('span', 'also', I.fmt('also_rule', { rules: st.also.join(', ') })));
            body.appendChild(head);
            const entries = L.rulebook.entriesFor(st.rule);
            if (entries.length) {
                const ul = el('ul', 'step-entries');
                entries.forEach((e, n) => {
                    if (st.applied && !st.applied.includes(n)) return;          // only the entries that changed this word
                    const item = el('li');
                    item.appendChild(L.rulebook.pair(e));
                    ul.appendChild(item);
                });
                body.appendChild(ul);
            }
            body.appendChild(changeNode(st.from, st.to));
            li.appendChild(body);
            ol.appendChild(li);
        });
        return ol;
    }

    /* The tree in the full-screen viewer; a form chosen there is chosen in the card too. */
    function openMax(card, r, button) {
        L.viewer.open({
            title: r.term,
            orient: S.treeView,
            returnFocus: button,
            draw: (box, orient) => {
                const handle = L.tree.render(box, r, selectedOf(r), (f) => { select(card, r, f); handle.choose(f); }, orient, { bare: true });
                return handle;
            },
        });
    }

    /* The tree of all derivations of the word, and under it the chain of steps of the chosen form. */
    function renderDerivation(card, r) {
        const box = card.querySelector('.derivation');
        box.textContent = '';
        card._tree = null;
        if (!r.final.length) return;
        const form = selectedOf(r);
        const treeBox = el('div', 'tree-box');
        const head = el('div', 'deriv-head');
        head.appendChild(el('h4', 'deriv-title', I.t('tree_title')));
        if (L.tree.fits(r)) {
            const max = el('button', 'icon-btn max');
            max.type = 'button';
            max.appendChild(L.viewer.icon(L.viewer.ICONS.max));
            max.setAttribute('aria-label', I.t('tree_max'));
            max.setAttribute('data-tip', I.t('tree_max'));
            max.addEventListener('click', () => openMax(card, r, max));
            head.appendChild(max);
        }
        treeBox.appendChild(head);
        if (L.tree.fits(r)) card._tree = L.tree.render(treeBox, r, form, (f) => select(card, r, f), S.treeView);
        else treeBox.appendChild(el('p', 'dim', I.t('tree_too_big')));
        box.appendChild(treeBox);
        box.appendChild(el('div', 'chain-box'));
        renderChain(card, r);
    }

    function renderChain(card, r) {
        const form = selectedOf(r);
        const box = card.querySelector('.chain-box');
        box.textContent = '';
        const head = el('h4', 'deriv-title');
        const toggle = el('button', 'fold small');                    // the title folds the chain up and down
        toggle.type = 'button';
        const parts = I.t('chain_title').split('{form}');
        toggle.appendChild(document.createTextNode(parts[0]));
        toggle.appendChild(el('span', 'chain-form', plain(form)));          // the word itself, in the normal font
        toggle.appendChild(document.createTextNode(parts[1] || ''));
        head.appendChild(toggle);
        box.appendChild(head);
        box.appendChild(chainEl(r, form));
        const fold = (folded) => {
            box.classList.toggle('folded', folded);
            toggle.setAttribute('aria-expanded', String(!folded));
            S.chainFolded[r.term] = folded;
        };
        fold(!!S.chainFolded[r.term]);
        toggle.addEventListener('click', () => fold(!box.classList.contains('folded')));
    }

    /* Choosing a form updates the chips, the highlighted path in the tree (without redrawing it) and the chain. */
    function select(card, r, form) {
        S.selected[r.term] = form;
        card.querySelectorAll('.forms .form').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.form === form)));
        if (card._tree) card._tree.choose(form);
        renderChain(card, r);
        announceUsed();
    }

    function cardEl(r) {
        const card = el('article', 'entry');
        card.dataset.word = r.term;
        const head = el('header', 'entry-head');
        const title = el('h3', 'headword');
        const toggle = el('button', 'fold', r.term);          // the word is the button that folds the card up and down
        toggle.type = 'button';
        title.appendChild(toggle);
        head.appendChild(title);
        if (!r.error) head.appendChild(el('span', 'count', I.count('n_forms', r.final.length)));
        card.appendChild(head);
        const fold = (folded) => {
            card.classList.toggle('collapsed', folded);
            toggle.setAttribute('aria-expanded', String(!folded));
            S.collapsed[r.term] = folded;
            if (!folded && card._tree) card._tree.center();           // a hidden tree could not be centred on its chosen form
        };
        toggle.setAttribute('aria-expanded', 'true');
        if (S.collapsed[r.term]) { card.classList.add('collapsed'); toggle.setAttribute('aria-expanded', 'false'); }
        head.addEventListener('click', () => fold(!card.classList.contains('collapsed')));
        if (r.error) {
            card.appendChild(el('p', 'error', I.t('err_' + r.error)));
            return card;
        }
        const forms = el('div', 'forms');
        r.final.forEach((f) => {
            const b = el('button', 'form', plain(f));
            b.type = 'button';
            b.dataset.form = f;
            b.title = I.count('n_steps', chainFor(r, f).length);
            b.setAttribute('aria-pressed', String(f === selectedOf(r)));
            b.addEventListener('click', () => select(card, r, f));
            forms.appendChild(b);
        });
        if (!r.final.length) forms.appendChild(el('span', 'dim', I.t('no_results')));
        card.appendChild(forms);
        card.appendChild(el('div', 'derivation'));
        renderDerivation(card, r);
        return card;
    }

    /* The rules used by the derivations currently shown, and which of their entries (rows) applied:
       a Map rule -> Set of entry positions, or null when it is not known which rows applied (then every row counts). */
    function used() {
        const map = new Map();
        const add = (rule, positions) => {
            if (positions == null) { map.set(rule, null); return; }
            if (map.get(rule) === null) return;
            const set = map.get(rule) || new Set();
            positions.forEach((p) => set.add(p));
            map.set(rule, set);
        };
        S.results.forEach((r) => {
            if (r.error || !r.final.length) return;
            chainFor(r, selectedOf(r)).forEach((st) => { add(st.rule, st.applied); st.also.forEach((a) => add(a, st.alsoApplied[a])); });
        });
        return map;
    }

    function announceUsed() { if (handlers.onUsedChange) handlers.onUsedChange(used()); }

    function renderAll(container) {
        container.textContent = '';
        S.results.forEach((r) => container.appendChild(cardEl(r)));
        announceUsed();
    }

    L.entries = { renderAll, chainFor, selectedOf, used, diff, show, plain, handlers };
})();
