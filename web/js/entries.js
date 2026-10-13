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

    /* Forms carry a space at each end (the word boundary): show it as #, as linguists write it. */
    const show = (s) => s.replace(/^ /, '#').replace(/ $/, '#');
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
            if (mid) w.appendChild(el('span', cls, mid));
            else if (other) w.appendChild(el('span', 'gap', '∅'));
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
            const also = [...new Set(r.edges.filter((e) => e[2] === info.mother && e[3] === cur && e[1] !== info.rule).map((e) => e[1]))];
            steps.push({ rule: info.rule, from: info.mother, to: cur, also });
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
                entries.forEach((e) => {
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

    function renderDerivation(card, r) {
        const box = card.querySelector('.derivation');
        box.textContent = '';
        if (!r.final.length) return;
        const form = selectedOf(r);
        if (S.deriv === 'tree' && L.tree.fits(r)) L.tree.render(box, r, form, (f) => select(card, r, f));
        else if (S.deriv === 'tree') { box.appendChild(el('p', 'dim', I.t('tree_too_big'))); box.appendChild(chainEl(r, form)); }
        else box.appendChild(chainEl(r, form));
    }

    function select(card, r, form) {
        S.selected[r.term] = form;
        card.querySelectorAll('.forms .form').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.form === form)));
        renderDerivation(card, r);
        announceUsed();
    }

    function cardEl(r) {
        const card = el('article', 'entry');
        card.dataset.word = r.term;
        const head = el('header', 'entry-head');
        head.appendChild(el('h3', 'headword', r.term));
        if (!r.error) head.appendChild(el('span', 'count', I.count('n_forms', r.final.length)));
        card.appendChild(head);
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

    function tableEl(onOpen) {
        const table = el('table', 'results-table');
        const thead = el('thead');
        const hr = el('tr');
        ['col_word', 'col_forms', ''].forEach((k) => hr.appendChild(el('th', '', k ? I.t(k) : '')));
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = el('tbody');
        S.results.forEach((r) => {
            const tr = el('tr');
            tr.appendChild(el('th', 'word', r.term));
            const td = el('td', 'forms');
            if (r.error) {
                td.appendChild(el('span', 'error', I.t('err_' + r.error)));
            } else {
                r.final.forEach((f) => td.appendChild(el('span', 'form static', plain(f))));
                if (!r.final.length) td.appendChild(el('span', 'dim', I.t('no_results')));
            }
            tr.appendChild(td);
            const act = el('td', 'act');
            if (!r.error) {
                const b = el('button', 'btn small', I.t('open_entry'));
                b.type = 'button';
                b.addEventListener('click', () => onOpen(r.term));
                act.appendChild(b);
            }
            tr.appendChild(act);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
    }

    /* The rules used by the derivations currently shown. */
    function used() {
        const set = new Set();
        S.results.forEach((r) => {
            if (r.error || !r.final.length) return;
            chainFor(r, selectedOf(r)).forEach((st) => { set.add(st.rule); st.also.forEach((a) => set.add(a)); });
        });
        return set;
    }

    function announceUsed() { if (handlers.onUsedChange) handlers.onUsedChange(used()); }

    function renderAll(container, onOpen) {
        container.textContent = '';
        if (S.view === 'table') container.appendChild(tableEl(onOpen));
        else S.results.forEach((r) => container.appendChild(cardEl(r)));
        announceUsed();
    }

    function focusWord(container, word) {
        const card = Array.from(container.querySelectorAll('.entry')).find((c) => c.dataset.word === word);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1400);
    }

    L.entries = { renderAll, focusWord, chainFor, selectedOf, used, diff, show, plain, handlers };
})();
