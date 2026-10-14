/* The branching tree of a word, drawn downwards: every form is a node, every change an edge labelled with
   its rule and, right below the rule name, the entries of the rule that were applied.
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

    /* Nodes, merged edges and depths of the derivation graph of a result. */
    function graph(r) {
        const nodes = new Set([r.start]);
        const merged = new Map();               // "from\0to" -> {from, to, rules: [...], items: [{rule, applied}], step}
        r.edges.forEach((e) => {
            nodes.add(e[2]);
            nodes.add(e[3]);
            const key = e[2] + '\u0000' + e[3];
            if (!merged.has(key)) merged.set(key, { from: e[2], to: e[3], rules: [], items: [], step: e[0] });
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
        return { nodes, edges, depth, parents };
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
            const entries = L.rulebook.entriesFor(it.rule).filter((_, n) => !it.applied || it.applied.includes(n));
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
    function render(box, r, form, onSelect) {
        const g = graph(r);
        if (g.nodes.size > MAX_NODES) { box.appendChild(Object.assign(document.createElement('p'), { className: 'dim', textContent: I.t('tree_too_big') })); return null; }
        const id = 'tr' + (++uid);
        const finals = new Set(r.final);

        const maxDepth = Math.max(...Array.from(g.nodes).map((n) => g.depth.get(n) || 0));
        const rows = Array.from({ length: maxDepth + 1 }, () => []);
        g.nodes.forEach((n) => rows[g.depth.get(n) || 0].push(n));

        const label = (n) => (n === r.start ? L.entries.show(n) : L.entries.plain(n));
        const nodeW = new Map();
        g.nodes.forEach((n) => nodeW.set(n, Math.max(46, width(label(n), '17px Gentium, serif') + 2 * PAD_X)));

        // The edge labels, measured, decide how far apart the forms are and how tall each gap is.
        const labelEls = g.edges.map((e) => labelEl(e.items));
        const sizes = measure(labelEls);
        const incoming = new Map();                             // form -> widest label of the edges that lead into it
        g.edges.forEach((e, i) => incoming.set(e.to, Math.max(incoming.get(e.to) || 0, sizes[i].w)));
        const reach = (n) => (incoming.has(n) ? LABEL_SIDE + incoming.get(n) : 0);

        // The tree proper: every form hangs from ONE parent (the nearest one above it), the other incoming
        // edges are drawn on top. A parent stands over the middle of its children: a single child is
        // straight below it, two children split off symmetrically.
        const primary = new Map();
        g.nodes.forEach((n) => {
            if (n === r.start) return;
            let best = null;
            (g.parents.get(n) || []).forEach((p) => { if (best === null || g.depth.get(p) > g.depth.get(best)) best = p; });
            primary.set(n, best);
        });
        const kids = new Map();
        g.edges.forEach((e) => { if (primary.get(e.to) === e.from) { if (!kids.has(e.from)) kids.set(e.from, []); kids.get(e.from).push(e.to); } });
        const ext = new Map();                                  // form -> {L, R, off}: space to its left / right, offsets of its children
        const measureTree = (n) => {
            const list = kids.get(n) || [];
            list.forEach(measureTree);
            let L = nodeW.get(n) / 2;
            let R = Math.max(nodeW.get(n) / 2, reach(n));
            const off = new Map();
            if (list.length) {
                const t = [];
                list.forEach((k, i) => { t[i] = i ? t[i - 1] + ext.get(list[i - 1]).R + ext.get(k).L + SLOT_GAP : 0; });
                const k = t.length;
                const mid = k % 2 ? t[(k - 1) / 2] : (t[k / 2 - 1] + t[k / 2]) / 2;          // over the middle child, or between the two middle ones
                list.forEach((k, i) => {
                    off.set(k, t[i] - mid);
                    L = Math.max(L, mid - t[i] + ext.get(k).L);
                    R = Math.max(R, t[i] - mid + ext.get(k).R);
                });
            }
            ext.set(n, { L, R, off });
        };
        measureTree(r.start);
        const totalW = ext.get(r.start).L + ext.get(r.start).R + 2 * MARGIN;
        const pos = new Map();                  // node -> {cx, x, y, w, d}: x,y is the top-left corner of its box
        const settle = (n, cx) => {
            pos.set(n, { cx, x: cx - nodeW.get(n) / 2, w: nodeW.get(n), y: 0, d: g.depth.get(n) || 0 });
            (kids.get(n) || []).forEach((k) => settle(k, cx + ext.get(n).off.get(k)));
        };
        settle(r.start, MARGIN + ext.get(r.start).L);

        // labels go in the gap above the form they lead to; the ones that would overlap (a form reached twice) use other lanes
        const place = g.edges.map((e, i) => ({ i, gap: pos.get(e.to).d, left: pos.get(e.to).cx + LABEL_SIDE, w: sizes[i].w, h: sizes[i].h, top: 0, lane: 0 }));
        const gapH = rows.map(() => MIN_GAP);
        rows.forEach((row, d) => {
            if (d === 0) return;
            const lanes = [];                                   // each lane: {right, h}
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
            row.forEach((n) => { pos.get(n).y = y; });
            place.filter((p) => p.gap === d).forEach((p) => { p.top += y - gapH[d]; });
            y += NODE_H;
        });
        const totalH = y + MARGIN;

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
            const x1 = a.cx;
            const y1 = a.y + NODE_H;
            const x2 = b.cx;
            const y2 = b.y;
            const ym = y1 + BAR_Y;                                          // the bar under the parent, shared by all its children
            const r = Math.min(7, Math.abs(x2 - x1) / 2, (y2 - ym) / 2);
            const sx = Math.sign(x2 - x1);
            const d = x1 === x2 ? 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2          // straight: no bend unless one is needed
                : 'M' + x1 + ' ' + y1 + ' L' + x1 + ' ' + (ym - r) + ' Q' + x1 + ' ' + ym + ' ' + (x1 + sx * r) + ' ' + ym + ' L' + (x2 - sx * r) + ' ' + ym + ' Q' + x2 + ' ' + ym + ' ' + x2 + ' ' + (ym + r) + ' L' + x2 + ' ' + y2;
            const grp = svg('g', { class: 'tree-edge' });
            grp.appendChild(svg('path', { d, 'marker-end': 'url(#' + id + 'a)' }));
            edgeLayer.appendChild(grp);
            const p = place[i];
            const fo = svg('foreignObject', { class: 'tree-elabel', x: p.left, y: p.top, width: p.w, height: p.h });
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
                grp.addEventListener('click', () => onSelect(n));
                grp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(n); } });
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
            grp.addEventListener('mouseleave', () => highlight(current));
            grp.addEventListener('blur', () => highlight(current));
        });
        const choose = (f) => {
            current = f;
            nodeEls.forEach((grp) => grp.classList.remove('chosen'));
            if (nodeEls.has(f)) nodeEls.get(f).classList.add('chosen');
            highlight(f);
        };
        choose(form);

        const scroll = document.createElement('div');
        scroll.className = 'tree-scroll';
        scroll.appendChild(root);
        const legend = document.createElement('p');
        legend.className = 'tree-legend';
        legend.textContent = I.t('tree_hint');
        box.appendChild(scroll);
        box.appendChild(legend);
        const chosen = pos.get(form);                       // bring the chosen form into view (once the box is on the page)
        const center = () => { if (chosen) scroll.scrollLeft = Math.max(0, chosen.cx - scroll.clientWidth / 2); };
        requestAnimationFrame(center);
        return { choose, center };
    }

    L.tree = { render, fits, graph, MAX_NODES };
})();
