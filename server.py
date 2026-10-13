"""LETRA web server: a small Flask API and page around the Transformer engine.

Run locally:   python server.py            (http://127.0.0.1:8506/)
On the server: gunicorn -w 2 -b 127.0.0.1:8506 --timeout 10 --no-control-socket server:app

The page and the API use relative URLs, so the app works the same at "/" and
behind nginx under "/letra/".
"""
import csv
import hashlib
import json
import os
import re
import textwrap

import markdown
from flask import Flask, jsonify, request, send_from_directory

from src import letra

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, 'web')
DATA = os.path.join(BASE, 'data')
TRANSFORMATIONS = os.path.join(BASE, 'transformations')

LANGS = ('en', 'es')

# Rule files bundled with the app, as offered in the page: id -> file name.
PRESETS = {'sample': 'sample.json', 'LA_ES': 'LA_ES.json', 'ES_IPA': 'ES_IPA.json'}

# Limits, because user-supplied rules are compiled to regular expressions here.
MAX_BODY_BYTES = 256 * 1024     # request body (an uploaded rules file is inside it)
MAX_TERM_CHARS = 64
MAX_RULE_ITEMS = 1000           # entries in each of groups / rules / order
MAX_GROUP_VALUES = 20000         # expanded size of any one group (groups can reference other groups)

app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = MAX_BODY_BYTES


# ---------- texts ----------

def _html(text):
    """Markdown to HTML; a single paragraph is returned without its <p> wrapper."""
    out = markdown.markdown(textwrap.dedent(text).strip(), extensions=['sane_lists'])
    m = re.fullmatch(r'<p>(.*)</p>', out, re.S)
    return m.group(1) if m else out


def _load_strings():
    raw = {lang: {} for lang in LANGS}
    with open(os.path.join(DATA, 'localizations.csv'), encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            raw[row['lang']][row['key']] = row['value']
    html = {lang: {k: (_html(v) if v.strip() else '') for k, v in d.items()} for lang, d in raw.items()}
    return {'raw': raw, 'html': html}


def _load_about():
    out = {}
    for lang in LANGS:
        with open(os.path.join(DATA, f'LETRA_{lang}.md'), encoding='utf-8') as f:
            out[lang] = markdown.markdown(f.read(), extensions=['sane_lists', 'tables', 'fenced_code'])
    return out


STRINGS = _load_strings()
ABOUT = _load_about()


# ---------- rules ----------

class RulesError(Exception):
    """A problem with the rules file; `code` maps to an `err_<code>` text in the page."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _check_rules_text(text):
    """Cheap structural checks on a user-supplied rules file, before the engine compiles it."""
    try:
        data = json.loads(re.sub(r'(?://[^\n]*)', '', text))  # same comment stripping as the engine
    except ValueError:
        raise RulesError('invalid_json')
    if not isinstance(data, dict) or any(k not in data for k in ('groups', 'rules', 'order')):
        raise RulesError('missing_sections')
    if not (isinstance(data['groups'], dict) and isinstance(data['rules'], dict) and isinstance(data['order'], list)):
        raise RulesError('invalid_rules')
    if any(len(data[k]) > MAX_RULE_ITEMS for k in ('groups', 'rules', 'order')):
        raise RulesError('too_large')
    if not all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in data['groups'].values()):
        raise RulesError('invalid_rules')
    if not all(isinstance(v, dict) and all(isinstance(a, str) and isinstance(b, str) for a, b in v.items())
               for v in data['rules'].values()):
        raise RulesError('invalid_rules')
    if not all(isinstance(x, str) for x in data['order']):
        raise RulesError('invalid_rules')
    _check_group_sizes(data['groups'])


def _check_group_sizes(groups):
    """Groups can reference other groups, so a handful of definitions can expand to billions of
    values. Work the expanded size out symbolically (same reading of the entries as the engine's
    expand_groups) and refuse before the engine builds anything."""
    alias = {part: name for name in groups if '|' in name for part in name.split('|')}
    sizes = {}
    for name, values in groups.items():
        total = 0
        for v in values:
            if '!' in v:            # negation: only removes values
                continue
            if '<' not in v:        # fixed value
                total += 1
            else:                   # call to another group
                key = v[1:-1]
                total += sizes.get(alias.get(key, key), 0)
            if total > MAX_GROUP_VALUES:
                raise RulesError('too_large')
        sizes[name] = total


def _transform(term, preset=None, rules_text=None):
    if preset is not None:
        t = letra.Transformer(json_path=PRESETS[preset])
    else:
        _check_rules_text(rules_text)
        try:
            t = letra.Transformer(rules_text)
        except Exception:
            raise RulesError('invalid_rules')
    try:
        final = t.transform(term, verbose=False)
    except Exception:
        raise RulesError('invalid_rules')

    original_rules = t.json_dict_original.get('rules', {})
    terms = {}
    for name, info in t.transformations.items():
        rule = info['rule']
        rule_text = ' & '.join(f'"{k}" → "{v}"' for k, v in original_rules.get(rule, {}).items()) if rule else ''
        terms[name] = {'mother': info['mother'], 'rule': rule, 'rule_text': rule_text}
    return {'start': f' {term} ', 'final': final, 'all': list(t.transformations), 'terms': terms}


# ---------- routes ----------

def _version():
    """Short hash of the page assets, used to refresh browser caches after a deploy."""
    h = hashlib.sha1()
    for name in ('app.js', 'styles.css'):
        with open(os.path.join(WEB, name), 'rb') as f:
            h.update(f.read())
    return h.hexdigest()[:10]


@app.get('/')
def index():
    with open(os.path.join(WEB, 'index.html'), encoding='utf-8') as f:
        page = f.read().replace('{{VERSION}}', _version())
    resp = app.response_class(page, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.get('/static/<path:name>')
def static_file(name):
    return send_from_directory(WEB, name)


@app.get('/healthz')
def healthz():
    return 'ok'


@app.get('/api/strings')
def api_strings():
    return jsonify(STRINGS)


@app.get('/api/about')
def api_about():
    lang = request.args.get('lang', 'en')
    return jsonify({'lang': lang if lang in LANGS else 'en', 'html': ABOUT.get(lang, ABOUT['en'])})


@app.get('/api/presets')
def api_presets():
    return jsonify(list(PRESETS))


@app.get('/api/rules/<preset>')
def api_rules(preset):
    if preset not in PRESETS:
        return jsonify({'error': 'not_found'}), 404
    return send_from_directory(TRANSFORMATIONS, PRESETS[preset], mimetype='application/json')


@app.post('/api/transform')
def api_transform():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'invalid_json'}), 400
    term = body.get('term')
    if not isinstance(term, str) or not term.strip():
        return jsonify({'error': 'bad_term'}), 400
    term = term.lower()
    if len(term) > MAX_TERM_CHARS:
        return jsonify({'error': 'term_too_long'}), 400
    if any(ord(c) < 32 for c in term):
        return jsonify({'error': 'bad_term'}), 400

    preset = body.get('preset')
    rules_text = body.get('rules')
    if preset is not None:
        if preset not in PRESETS:
            return jsonify({'error': 'not_found'}), 404
        rules_text = None
    elif not isinstance(rules_text, str):
        return jsonify({'error': 'invalid_json'}), 400

    try:
        return jsonify(_transform(term, preset=preset, rules_text=rules_text))
    except RulesError as e:
        return jsonify({'error': e.code}), 400


@app.errorhandler(413)
def too_large(_):
    return jsonify({'error': 'too_large'}), 413


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8506, debug=False)
