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
    assert len(data['raw']['en']) >= 130


def test_strings_markdown_is_rendered(client):
    html = client.get('/api/strings').get_json()['html']['en']
    assert '<ol>' in html['howto'] and '<strong>' in html['howto']
    assert '<ul>' in html['syntax'] and '<code>' in html['syntax']
    assert not html['tab_evolve'].startswith('<p>')            # a single paragraph comes without its wrapper


def test_indented_markdown_is_not_turned_into_a_code_block():
    out = server._html('\n    1. first\n    2. second\n')
    assert '<ol>' in out and '<code>' not in out


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


# ---------- edges ----------

def test_transform_returns_edges_as_step_rule_from_to(client):
    data = post(client, preset='sample', term='lítteram').get_json()
    assert data['edges'] and all(len(e) == 5 and isinstance(e[0], int) for e in data['edges'])
    first = data['edges'][0]
    assert first[2] == ' lítteram ' and first[1] == 'remove_m'


# ---------- batches ----------

def test_batch_returns_one_result_per_word_in_order(client):
    r = post(client, preset='LA_ES', terms=['lítteram', 'dóminum', 'quinquagínta'])
    assert r.status_code == 200
    data = r.get_json()
    assert data['truncated'] is False
    assert [x['term'] for x in data['results']] == ['lítteram', 'dóminum', 'quinquagínta']
    assert len(data['results'][2]['final']) == 12
    single = post(client, preset='LA_ES', term='dóminum').get_json()
    assert data['results'][1] == single


def test_batch_reports_a_bad_word_without_failing_the_others(client):
    data = post(client, preset='sample', terms=['lítteram', '', 'x' * 65, 'a\nb']).get_json()
    assert 'final' in data['results'][0]
    assert [x.get('error') for x in data['results'][1:]] == ['bad_term', 'term_too_long', 'bad_term']


def test_batch_limits(client):
    assert post(client, preset='sample', terms=['a'] * (server.MAX_WORDS + 1)).get_json() == {'error': 'too_many_terms'}
    assert post(client, preset='sample', terms=[]).status_code == 400
    assert post(client, preset='sample', terms=['a', 3]).status_code == 400
    assert post(client, preset='sample', terms='lítteram').status_code == 400
    assert post(client, preset='sample', terms=['a'] * server.MAX_WORDS).status_code == 200


def test_batch_stops_when_the_time_budget_is_spent(client, monkeypatch):
    monkeypatch.setattr(server, 'TIME_BUDGET', -1)       # already over budget after the first word
    data = post(client, preset='sample', terms=['lítteram', 'letra', 'casa']).get_json()
    assert data['truncated'] is True and len(data['results']) == 1


def test_batch_with_broken_rules_is_one_error(client):
    r = post(client, rules='{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["missing"]}', terms=['a', 'b'])
    assert r.status_code == 400 and r.get_json() == {'error': 'invalid_rules'}


# ---------- unicode and case ----------

def test_decomposed_input_gives_the_same_result_as_composed(client):
    composed = post(client, preset='sample', term='lítteram').get_json()
    decomposed = post(client, preset='sample', term='lítteram').get_json()
    assert decomposed == composed and decomposed['term'] == 'lítteram'


def test_uploaded_rules_are_normalised_too(client):
    rules = {'groups': {}, 'rules': {'r': {'é': 'X'}}, 'order': ['r']}       # decomposed é in the rule
    data = post(client, rules=json.dumps(rules, ensure_ascii=False), term='café').get_json()   # composed é typed
    assert data['final'] == [' cafX ']


def test_case_is_ignored_unless_asked_otherwise(client):
    rules = json.dumps({'groups': {}, 'rules': {'r': {'A': 'x'}}, 'order': ['r']})
    assert post(client, rules=rules, term='CASA').get_json()['final'] == [' casa ']          # lowercased first
    assert post(client, rules=rules, term='CASA', match_case=True).get_json()['final'] == [' CxSx ']


# ---------- rule book ----------

def test_rulebook_lists_steps_rules_and_groups(client):
    data = client.post('/api/rulebook', json={'preset': 'LA_ES'}).get_json()
    assert data['order'][0] and isinstance(data['order'], list)
    assert any('|' in step for step in data['order'])                  # branching steps keep their alternatives
    name, entries = next(iter(data['rules'].items()))
    assert entries and all(len(e) == 2 for e in entries)
    g = next(iter(data['groups'].values()))
    assert g['total'] == len(g['members']) or len(g['members']) == server.GROUP_MEMBERS_SHOWN


def test_rulebook_for_uploaded_rules_and_errors(client):
    ok = client.post('/api/rulebook', json={'rules': json.dumps({'groups': {'v': ['a', 'e']}, 'rules': {'r': {'<v>': 'x'}}, 'order': ['r']})})
    assert ok.status_code == 200 and ok.get_json()['groups']['v'] == {'members': ['a', 'e'], 'total': 2}
    assert client.post('/api/rulebook', json={'rules': 'nope'}).get_json() == {'error': 'invalid_json'}
    assert client.post('/api/rulebook', json={'preset': 'zzz'}).status_code == 404
    assert client.post('/api/rulebook', json={}).status_code == 400


# ---------- validate ----------

def test_validate_endpoint_reports_positions(client):
    text = '{\n "groups": {},\n "rules": {"a": {"x": "y"}},\n "order": ["a",\n "ghost"]\n}'
    data = client.post('/api/validate', json={'rules': text}).get_json()
    assert data['ok'] is False
    bad = [i for i in data['issues'] if i['code'] == 'unknown_rule_in_order'][0]
    assert bad['line'] == 5 and bad['severity'] == 'error'


def test_validate_endpoint_inputs(client):
    assert client.post('/api/validate', json={'rules': GOOD_RULES}).get_json() == {'ok': True, 'issues': []}
    assert client.post('/api/validate', json={}).status_code == 400
    assert client.post('/api/validate', json={'rules': 3}).status_code == 400
    assert client.post('/api/validate', data=b'x' * (server.MAX_BODY_BYTES + 5), content_type='application/json').status_code == 413


GOOD_RULES = '{"groups": {"v": ["a"]}, "rules": {"r": {"<v>": "<v>"}}, "order": ["r"]}'


# ---------- page assets ----------

def test_version_changes_when_any_page_file_changes(tmp_path, monkeypatch):
    web = tmp_path / 'web'
    (web / 'fonts').mkdir(parents=True)
    (web / 'app.js').write_text('a')
    (web / 'fonts' / 'f.woff2').write_text('font')
    monkeypatch.setattr(server, 'WEB', str(web))
    v1 = server._version()
    (web / 'fonts' / 'f.woff2').write_text('other font')          # fonts are cached by name: not part of the hash
    assert server._version() == v1
    (web / 'app.js').write_text('b')
    assert server._version() != v1
