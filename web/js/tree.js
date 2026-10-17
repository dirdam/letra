/* The branching tree of a word, drawn downwards ('v') or to the right ('h'): every form is a node, every
   change an edge labelled with its rule (the applied entries show in a tooltip).
   A form reached from two different parents is ONE node with two incoming edges (the chain view only
   shows the first path). Rows are derivation depth: the longest path from the start. */
(function () {
    'use strict';
    const L = (window.Letra = window.Letra || {});
    const I = L.i18n;
    const NS = 'http://www.w3.org/2000/svg';
    const MAX_NODES = 300;
    const NODE_H = 32;
    const PAD_X = 14;
    const MARGIN = 18;
    const SLOT_GAP = 28;           // px between two forms of a row
    const MIN_GAP = 56;            // px between two rows, at least
    const LABEL_SIDE = 12;         // px between an edge and its label
    const LABEL_CLEAR = 20;        // px between a label and the next form's edge
    const BAR_ROOM = 24;           // px under a row kept free for the bars of the edges
    const BAR_Y = 16;              // px between a form and the bar its children split off from
    const MIN_GAP_H = 64;          // px between two columns of a horizontal tree, at least
    let uid = 0;

    function svg(tag, attrs, text) {
        const e = document.createElementNS(NS, tag);
        Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
        if (text !== undefined) e.textContent = text;
        return e;
    }

    const measureCtx = document.createElement('canvas').getContext('2d');
    function width(text, font) {
        measureCtx.font = font;
        return measureCtx.measureText(text).width;
    }

    /* Nodes, merged edges and depths of the derivation graph of a result.
       A step with alternatives can leave a form as it is (an edge from a form to itself, such as `iden` or any alternative
       that does not change it): that way through the step is drawn as a copy of the form, so the step shows as a split.
       A node id is the form, plus "\0k" for its k-th copy. */
    function graph(r) {
        const shownEdges = L.state.s.splitIdentity ? r.edges : r.edges.filter((e) => e[2] !== e[3]);          // without "Split on identity" the identity branches are left out
        const stays = new Map();                // form -> the steps at which it passes through unchanged
        shownEdges.forEach((e) => { if (e[2] === e[3]) { if (!stays.has(e[2])) stays.set(e[2], new Set()); stays.get(e[2]).add(e[0]); } });
        const stepsOf = (form) => Array.from(stays.get(form) || []).sort((a, b) => a - b);
        const idAt = (form, k) => (k ? form + '\u0000' + k : form);
        const before = (form, step) => idAt(form, stepsOf(form).filter((s) => s < step).length);          // the form as it enters a step
        const after = (form, step) => idAt(form, stepsOf(form).filter((s) => s <= step).length);          // and as it leaves it
        const formOf = (id) => id.split('\u0000')[0];
        const lastId = (form) => idAt(form, stepsOf(form).length);          // the copy of a final form that ends the path
        const nodes = new Set([r.start]);
        const merged = new Map();               // {from, to} -> {from, to, rules: [...], items: [{rule, applied}], step}
        shownEdges.forEach((e) => {
            const from = before(e[2], e[0]);
            const to = after(e[3], e[0]);
            nodes.add(from);
            nodes.add(to);
            const key = JSON.stringify([from, to]);
            if (!merged.has(key)) merged.set(key, { from, to, rules: [], items: [], step: e[0] });
            const m = merged.get(key);
            if (!m.rules.includes(e[1])) { m.rules.push(e[1]); m.items.push({ rule: e[1], applied: e[4] || null }); }
        });
        const edges = Array.from(merged.values());
        const depth = new Map([[r.start, 0]]);
        for (let pass = 0, changed = true; changed && pass <= nodes.size; pass++) {   // longest path; it is a DAG, so it settles
            changed = false;
            edges.forEach((e) => {
                const d = (depth.get(e.from) || 0) + 1;
                if (d > (depth.get(e.to) || 0)) { depth.set(e.to, d); changed = true; }
            });
        }
        const parents = new Map();
        edges.forEach((e) => {
            if (!parents.has(e.to)) parents.set(e.to, new Set());
            parents.get(e.to).add(e.from);
        });
        return { nodes, edges, depth, parents, formOf, lastId };
    }

    const fits = (r) => graph(r).nodes.size <= MAX_NODES;

    function ancestors(g, node) {
        const seen = new Set([node]);
        const stack = [node];
        while (stack.length) {
            const n = stack.pop();
            (g.parents.get(n) || []).forEach((p) => { if (!seen.has(p)) { seen.add(p); stack.push(p); } });
        }
        return seen;
    }

    const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    };

    /* The label of an edge: just the name of the rule (or rules). */
    function labelEl(items) {
        const box = el('div', 'tree-label');
        items.forEach((it) => box.appendChild(el('span', 'tree-rule', it.rule)));
        if (L.tooltip) L.tooltip.rich(box, () => changeTip(items));
        return box;
    }

    /* What the hover tooltip of an edge shows: the entries of the rule that were applied, as in the chain of changes. */
    function changeTip(items) {
        const tip = el('div', 'tl-tip');
        items.forEach((it) => {
            const item = el('div', 'tl-item');
            if (items.length > 1) item.appendChild(el('span', 'tl-name', it.rule));
            const entries = L.rulebook.entriesFor(it.rule).filter((_, n) => !it.applied || !it.applied.length || it.applied.includes(n));          // no entry applied (a branch that leaves the form as it is): the rule as in the rule book
            const ul = el('ul', 'tl-entries');
            entries.forEach((entry) => {
                const li = el('li');
                li.appendChild(L.rulebook.pair(entry));
                li.querySelectorAll('[title]').forEach((e) => e.removeAttribute('title'));      // no tooltips inside a tooltip
                ul.appendChild(li);
            });
            item.appendChild(entries.length ? ul : el('span', 'tl-name', it.rule));
            tip.appendChild(item);
        });
        return tip;
    }

    /* Sizes of the labels, measured off-screen (they are HTML, so the browser lays them out). */
    function measure(labels) {
        const probe = el('div', 'tree-measure');
        labels.forEach((l) => probe.appendChild(l));
        document.body.appendChild(probe);
        const sizes = labels.map((l) => { const r = l.getBoundingClientRect(); return { w: Math.ceil(r.width) + 2, h: Math.ceil(r.height) + 2 }; });
        probe.remove();
        return sizes;
    }

    /* Draws the tree of `r` into `box`; `form` is the chosen final form, `onSelect(form)` is called for a click. */
    function render(box, r, form, onSelect, orient, opts) {
        const horiz = orient === 'h';
        const g = graph(r);
        if (g.nodes.size > MAX_NODES) { box.appendChild(Object.assign(document.createElement('p'), { className: 'dim', textContent: I.t('tree_too_big') })); return null; }
        const id = 'tr' + (++uid);
        const finals = new Set(r.final.map(g.lastId));

        const maxDepth = Math.max(...Array.from(g.nodes).map((n) => g.depth.get(n) || 0));
        const rows = Array.from({ length: maxDepth + 1 }, () => []);
        g.nodes.forEach((n) => rows[g.depth.get(n) || 0].push(n));

        const label = (n) => L.entries.plain(g.formOf(n));          // no word-boundary mark on the forms of the tree
        const nodeW = new Map();
        g.nodes.forEach((n) => nodeW.set(n, Math.max(46, width(label(n), '17px Gentium, serif') + 2 * PAD_X)));

        // The edge labels, measured, decide how far apart the forms are and how much room each gap needs.
        // Everything is laid out on two axes: MAIN (the direction the tree grows: down, or to the right)
        // and CROSS (across it). The tree is drawn by mapping them to y/x (vertical) or x/y (horizontal).
        const labelEls = g.edges.map((e) => labelEl(e.items));
        const sizes = measure(labelEls);
        const into = new Map();                                 // form -> indices of the edges that lead into it
        g.edges.forEach((e, i) => { if (!into.has(e.to)) into.set(e.to, []); into.get(e.to).push(i); });
        const nodeMain = (n) => (horiz ? nodeW.get(n) : NODE_H);
        const nodeCross = (n) => (horiz ? NODE_H : nodeW.get(n));
        const stackH = (n) => (into.has(n) ? into.get(n).reduce((sum, i) => sum + sizes[i].h, 0) + 4 * (into.get(n).length - 1) : 0);
        const widest = (n) => (into.has(n) ? Math.max(...into.get(n).map((i) => sizes[i].w)) : 0);
        // space a form needs on each side of its centre, across the tree: its labels stand to the right of its
        // edge (vertical tree) or above it (horizontal tree)
        const sideL = (n) => (horiz ? Math.max(nodeCross(n) / 2, into.has(n) ? 8 + stackH(n) : 0) : nodeCross(n) / 2);
        const sideR = (n) => (horiz ? nodeCross(n) / 2 : Math.max(nodeCross(n) / 2, into.has(n) ? LABEL_SIDE + widest(n) : 0));

        // The tree proper: every form hangs from ONE parent (the nearest one before it), the other incoming
        // edges are drawn on top. A parent stands level with the middle of its children: a single child is
        // straight in line with it, two children split off symmetrically.
        const primary = new Map();
        g.nodes.forEach((n) => {
            if (n === r.start) return;
            let best = null;
            (g.parents.get(n) || []).forEach((p) => { if (best === null || g.depth.get(p) > g.depth.get(best)) best = p; });
            primary.set(n, best);
        });
        const kids = new Map();
        g.edges.forEach((e) => { if (primary.get(e.to) === e.from) { if (!kids.has(e.from)) kids.set(e.from, []); kids.get(e.from).push(e.to); } });
        const ext = new Map();                                  // form -> {L, R, off}: room before / after it across the tree, offsets of its children
        const measureTree = (n) => {
            const list = kids.get(n) || [];
            list.forEach(measureTree);
            let before = sideL(n);
            let after = sideR(n);
            const off = new Map();
            if (list.length) {
                const t = [];
                list.forEach((k, i) => { t[i] = i ? t[i - 1] + ext.get(list[i - 1]).R + ext.get(k).L + SLOT_GAP : 0; });
                const count = t.length;
                const mid = count % 2 ? t[(count - 1) / 2] : (t[count / 2 - 1] + t[count / 2]) / 2;          // level with the middle child, or between the two middle ones
                list.forEach((k, i) => {
                    off.set(k, t[i] - mid);
                    before = Math.max(before, mid - t[i] + ext.get(k).L);
                    after = Math.max(after, t[i] - mid + ext.get(k).R);
                });
            }
            ext.set(n, { L: before, R: after, off });
        };
        measureTree(r.start);
        const crossTotal = ext.get(r.start).L + ext.get(r.start).R + 2 * MARGIN;
        const cc = new Map();                                   // form -> centre across the tree
        const settle = (n, c) => { cc.set(n, c); (kids.get(n) || []).forEach((k) => settle(k, c + ext.get(n).off.get(k))); };
        settle(r.start, MARGIN + ext.get(r.start).L);

        const depthOf = (n) => g.depth.get(n) || 0;
        const mainAt = [];                                      // depth -> where its forms start along the tree
        const labelBox = [];                                    // edge index -> {x, y, w, h}
        let mainTotal;
        if (horiz) {
            const colW = rows.map((row) => Math.max(0, ...row.map(nodeMain)));
            const gapLen = rows.map((row, d) => (d === 0 ? 0 : Math.max(MIN_GAP_H, BAR_Y + 10 + Math.max(0, ...row.map(widest)) + 18)));
            let m = MARGIN;
            rows.forEach((row, d) => { m += gapLen[d]; mainAt[d] = m; m += colW[d]; });
            mainTotal = m + MARGIN;
            g.edges.forEach((e, i) => {                         // above the last stretch of the edge, stacked when a form is reached twice
                const list = into.get(e.to);
                const k = list.indexOf(i);
                const below = list.slice(0, k).reduce((sum, j) => sum + sizes[j].h + 4, 0);
                const d = depthOf(e.to);
                labelBox[i] = { x: mainAt[d] - gapLen[d] + BAR_Y + 10, y: cc.get(e.to) - 6 - sizes[i].h - below, w: sizes[i].w, h: sizes[i].h };
            });
        } else {
            // each label goes in the gap above the form it leads to; labels that would overlap use other lanes of the gap
            const place = g.edges.map((e, i) => ({ i, gap: depthOf(e.to), left: cc.get(e.to) + LABEL_SIDE, w: sizes[i].w, h: sizes[i].h, top: 0, lane: 0 }));
            const gapH = rows.map(() => MIN_GAP);
            rows.forEach((row, d) => {
                if (d === 0) return;
                const lanes = [];                               // each lane: {right, h}
                place.filter((p) => p.gap === d).sort((p, q) => p.left - q.left).forEach((p) => {
                    let lane = lanes.findIndex((l) => l.right + 8 <= p.left);
                    if (lane < 0) { lane = lanes.length; lanes.push({ right: -1, h: 0 }); }
                    lanes[lane].right = p.left + p.w;
                    lanes[lane].h = Math.max(lanes[lane].h, p.h);
                    p.lane = lane;
                });
                const offsets = [];
                let used = BAR_ROOM;
                lanes.forEach((l, k) => { offsets[k] = used; used += l.h + 6; });
                place.filter((p) => p.gap === d).forEach((p) => { p.top = offsets[p.lane]; });
                gapH[d] = Math.max(MIN_GAP, used + 6);
            });
            let y = MARGIN;
            rows.forEach((row, d) => {
                if (d > 0) y += gapH[d];
                mainAt[d] = y;
                place.filter((p) => p.gap === d).forEach((p) => { p.top += y - gapH[d]; });
                y += NODE_H;
            });
            mainTotal = y + MARGIN;
            place.forEach((p) => { labelBox[p.i] = { x: p.left, y: p.top, w: p.w, h: p.h }; });
        }
        const pos = new Map();                                  // form -> {x, y, w, c, m, d}: x,y is the top-left corner of its box
        g.nodes.forEach((n) => {
            const m = mainAt[depthOf(n)];
            const c = cc.get(n);
            pos.set(n, horiz ? { x: m, y: c - NODE_H / 2, w: nodeW.get(n), c, m, d: depthOf(n) } : { x: c - nodeW.get(n) / 2, y: m, w: nodeW.get(n), c, m, d: depthOf(n) });
        });
        const totalW = horiz ? mainTotal : crossTotal;
        const totalH = horiz ? crossTotal : mainTotal;

        const root = svg('svg', { width: totalW, height: totalH, viewBox: '0 0 ' + totalW + ' ' + totalH, role: 'group', 'aria-label': I.fmt('tree_label', { word: r.term }) });
        const defs = svg('defs');
        const marker = svg('marker', { id: id + 'a', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
        marker.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: 'tree-arrow' }));
        defs.appendChild(marker);
        root.appendChild(defs);

        const edgeEls = [];
        const edgeLayer = svg('g', { class: 'tree-edges' });
        const labelLayer = svg('g', { class: 'tree-labels' });
        g.edges.forEach((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            const pt = (m, c) => (horiz ? m + ' ' + c : c + ' ' + m);
            const m1 = a.m + (horiz ? a.w : NODE_H);                        // where the edge leaves its parent
            const m2 = b.m;                                                 // and where it enters the child
            const mBar = m1 + BAR_Y;                                        // the bar the children of a parent split off from
            const rad = Math.min(7, Math.abs(b.c - a.c) / 2, (m2 - mBar) / 2);
            const sc = Math.sign(b.c - a.c);
            const d = a.c === b.c ? 'M' + pt(m1, a.c) + ' L' + pt(m2, b.c)                  // straight: no bend unless one is needed
                : 'M' + pt(m1, a.c) + ' L' + pt(mBar - rad, a.c) + ' Q' + pt(mBar, a.c) + ' ' + pt(mBar, a.c + sc * rad) + ' L' + pt(mBar, b.c - sc * rad) + ' Q' + pt(mBar, b.c) + ' ' + pt(mBar + rad, b.c) + ' L' + pt(m2, b.c);
            const grp = svg('g', { class: 'tree-edge' });
            grp.appendChild(svg('path', { d, 'marker-end': 'url(#' + id + 'a)' }));
            edgeLayer.appendChild(grp);
            const p = labelBox[i];
            const fo = svg('foreignObject', { class: 'tree-elabel', x: p.x, y: p.y, width: p.w, height: p.h });
            fo.appendChild(labelEls[i]);
            labelLayer.appendChild(fo);
            edgeEls.push({ e, grp, fo });
        });
        root.appendChild(edgeLayer);

        const nodeEls = new Map();
        const nodeLayer = svg('g', { class: 'tree-nodes' });
        g.nodes.forEach((n) => {
            const p = pos.get(n);
            const kind = n === r.start ? 'start' : finals.has(n) ? 'final' : 'mid';
            const grp = svg('g', { class: 'tree-node ' + kind, transform: 'translate(' + p.x + ' ' + p.y + ')' });
            grp.appendChild(svg('rect', { width: p.w, height: NODE_H, rx: 8 }));
            grp.appendChild(svg('text', { x: p.w / 2, y: NODE_H / 2 + 5.5, 'text-anchor': 'middle' }, label(n)));
            if (kind === 'final') {
                grp.setAttribute('tabindex', '0');
                grp.setAttribute('role', 'button');
                grp.setAttribute('aria-label', label(n));
                grp.addEventListener('click', () => onSelect(g.formOf(n)));
                grp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(g.formOf(n)); } });
            }
            nodeEls.set(n, grp);
            nodeLayer.appendChild(grp);
        });
        root.appendChild(nodeLayer);
        root.appendChild(labelLayer);

        let current = form;
        const highlight = (target) => {
            const on = target ? ancestors(g, target) : new Set();
            nodeEls.forEach((grp, n) => grp.classList.toggle('on', on.has(n)));
            edgeEls.forEach(({ e, grp, fo }) => { const lit = on.has(e.from) && on.has(e.to); grp.classList.toggle('on', lit); fo.classList.toggle('on', lit); });
            root.classList.toggle('has-path', on.size > 0);
        };
        nodeEls.forEach((grp, n) => {
            grp.addEventListener('mouseenter', () => highlight(n));
            grp.addEventListener('focus', () => highlight(n));
            grp.addEventListener('mouseleave', () => highlight(g.lastId(current)));
            grp.addEventListener('blur', () => highlight(g.lastId(current)));
        });
        const choose = (f) => {
            current = f;
            nodeEls.forEach((grp) => grp.classList.remove('chosen'));
            if (nodeEls.has(g.lastId(f))) nodeEls.get(g.lastId(f)).classList.add('chosen');
            highlight(g.lastId(f));
        };
        choose(form);

        if (opts && opts.bare) {                            // for the full-screen viewer: just the drawing, which it zooms and moves itself
            box.appendChild(root);
            return { choose, center: () => {}, size: { w: totalW, h: totalH } };
        }
        const scroll = document.createElement('div');
        scroll.className = 'tree-scroll';
        scroll.appendChild(root);
        const legend = document.createElement('p');
        legend.className = 'tree-legend';
        legend.textContent = I.t('tree_hint');
        box.appendChild(scroll);
        box.appendChild(legend);
        const chosen = pos.get(g.lastId(form));             // bring the chosen form into view (once the box is on the page)
        const center = () => { if (chosen) scroll.scrollLeft = Math.max(0, (horiz ? chosen.x + chosen.w / 2 : chosen.c) - scroll.clientWidth / 2); };
        requestAnimationFrame(center);
        return { choose, center };
    }

    L.tree = { render, fits, graph, MAX_NODES };
})();
