import json
import os

import pytest

import server

HERE = os.path.dirname(__file__)
GOLDEN = json.load(open(os.path.join(HERE, 'golden.json'), encoding='utf-8'))


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    return server.app.test_client()


def post(client, **body):
    return client.post('/api/transform', json=body)


# ---------- transform ----------

@pytest.mark.parametrize('key', [k for k in GOLDEN if k.split('|')[1:2] == ['False']])
def test_presets_match_recorded_outputs(client, key):
    preset, _, term = key.split('|')
    r = post(client, preset=preset.replace('.json', ''), term=term)
    assert r.status_code == 200
    data = r.get_json()
    assert data['final'] == GOLDEN[key]['final']
    assert data['all'] == [t[0] for t in GOLDEN[key]['transformations']]
    for name, mother, rule in GOLDEN[key]['transformations']:
        assert data['terms'][name]['mother'] == mother and data['terms'][name]['rule'] == rule
    assert data['start'] == f' {term} '


def test_term_is_lowercased(client):
    assert post(client, preset='sample', term='LÍTTERAM').get_json()['start'] == ' lítteram '


def test_rule_text_shows_the_rule(client):
    data = post(client, preset='sample', term='lítteram').get_json()
    assert data['terms'][' líttera ']['rule_text'].startswith('"')
    assert '→' in data['terms'][' líttera ']['rule_text']


def test_uploaded_rules_work_and_match_the_preset(client):
    text = open(os.path.join(server.TRANSFORMATIONS, 'sample.json'), encoding='utf-8').read()
    a = post(client, rules=text, term='lítteram').get_json()
    b = post(client, preset='sample', term='lítteram').get_json()
    assert a == b


# ---------- bad input ----------

@pytest.mark.parametrize('body,status,code', [
    ({'preset': 'sample', 'term': ''}, 400, 'bad_term'),
    ({'preset': 'sample', 'term': '   '}, 400, 'bad_term'),
    ({'preset': 'sample', 'term': 'a\nb'}, 400, 'bad_term'),
    ({'preset': 'sample', 'term': 'x' * 65}, 400, 'term_too_long'),
    ({'preset': 'nope', 'term': 'a'}, 404, 'not_found'),
    ({'preset': '../app', 'term': 'a'}, 404, 'not_found'),
    ({'term': 'a'}, 400, 'invalid_json'),
    ({'rules': 'not json', 'term': 'a'}, 400, 'invalid_json'),
    ({'rules': '{}', 'term': 'a'}, 400, 'missing_sections'),
    ({'rules': '{"groups": [], "rules": {}, "order": []}', 'term': 'a'}, 400, 'invalid_rules'),
    ({'rules': '{"groups": {"g": [1]}, "rules": {}, "order": []}', 'term': 'a'}, 400, 'invalid_rules'),
    ({'rules': '{"groups": {}, "rules": {"r": {"a": 1}}, "order": []}', 'term': 'a'}, 400, 'invalid_rules'),
    ({'rules': '{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["missing_rule"]}', 'term': 'a'}, 400, 'invalid_rules'),
    ({'rules': '{"groups": {}, "rules": {"r": {"(": "b"}}, "order": ["r"]}', 'term': 'a'}, 400, 'invalid_rules'),
])
def test_bad_input_gives_a_clear_error(client, body, status, code):
    r = client.post('/api/transform', json=body)
    assert r.status_code == status
    assert r.get_json() == {'error': code}


def test_not_json_body(client):
    r = client.post('/api/transform', data='x', content_type='text/plain')
    assert r.status_code == 400 and r.get_json() == {'error': 'invalid_json'}


def test_too_many_items(client):
    rules = {'groups': {f'g{i}': ['a'] for i in range(server.MAX_RULE_ITEMS + 1)}, 'rules': {}, 'order': []}
    r = post(client, rules=json.dumps(rules), term='a')
    assert r.status_code == 400 and r.get_json() == {'error': 'too_large'}


def test_oversized_body_is_rejected(client):
    r = client.post('/api/transform', data=b'x' * (server.MAX_BODY_BYTES + 10), content_type='application/json')
    assert r.status_code == 413 and r.get_json() == {'error': 'too_large'}


# ---------- other routes ----------

def test_strings_cover_both_languages_with_the_same_keys(client):
    data = client.get('/api/strings').get_json()
    assert set(data['raw']['en']) == set(data['raw']['es'])
    assert set(data['html']['en']) == set(data['raw']['en'])
    assert len(data['raw']['en']) >= 42


def test_strings_markdown_is_rendered_and_dedented(client):
    html = client.get('/api/strings').get_json()['html']['en']
    assert '<strong>' in html['tool']
    assert '<code>' not in html['how_to_use_explain'].split('<ol>')[0]      # not turned into a code block
    assert '<ol>' in html['how_to_use_explain']
    assert not html['tool'].startswith('<p>')


@pytest.mark.parametrize('lang,word', [('en', 'Purpose'), ('es', 'Objetivo')])
def test_about(client, lang, word):
    data = client.get(f'/api/about?lang={lang}').get_json()
    assert word in data['html'] and data['lang'] == lang


def test_about_unknown_language_falls_back_to_english(client):
    assert client.get('/api/about?lang=xx').get_json()['lang'] == 'en'


def test_presets_and_downloads(client):
    assert client.get('/api/presets').get_json() == ['sample', 'LA_ES', 'ES_IPA']
    for p in ('sample', 'LA_ES', 'ES_IPA'):
        r = client.get(f'/api/rules/{p}')
        assert r.status_code == 200 and b'"rules"' in r.data
    assert client.get('/api/rules/nope').status_code == 404
    assert client.get('/api/rules/..%2Fserver.py').status_code == 404


def test_static_cannot_escape_the_web_folder(client):
    assert client.get('/static/../server.py').status_code == 404
    assert client.get('/static/..%2Fserver.py').status_code == 404


def test_healthz(client):
    assert client.get('/healthz').data == b'ok'


# ---------- groups that expand exponentially ----------

def test_exponentially_growing_groups_are_refused_quickly(client):
    groups = {'g0': ['a', 'b']}
    for i in range(1, 60):
        groups[f'g{i}'] = [f'<g{i-1}>', f'<g{i-1}>']          # doubles at every level: 2^60 values
    rules = {'groups': groups, 'rules': {'r': {'a': 'b'}}, 'order': ['r']}
    r = post(client, rules=json.dumps(rules), term='a')
    assert r.status_code == 400 and r.get_json() == {'error': 'too_large'}


def test_normal_nested_groups_are_fine(client):
    groups = {'v1': ['a', 'e'], 'v2': ['i', 'o'], 'vow': ['<v1>', '<v2>', 'u'], 'all': ['<vow>', '<vow>']}
    rules = {'groups': groups, 'rules': {'r': {'<vow>': 'x'}}, 'order': ['r']}
    r = post(client, rules=json.dumps(rules), term='casa')
    assert r.status_code == 200
