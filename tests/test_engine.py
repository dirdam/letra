"""The Transformer must keep producing exactly what it produced before the web move.
tests/golden.json was recorded from the unmodified engine (tests/record_golden.py)."""
import json
import os

import pytest

import src.letra as letra

HERE = os.path.dirname(__file__)
GOLDEN = json.load(open(os.path.join(HERE, 'golden.json'), encoding='utf-8'))
CASES = [(k, v) for k, v in GOLDEN.items() if not k.endswith('|init')]


@pytest.mark.parametrize('key,expected', CASES, ids=[k for k, _ in CASES])
def test_matches_recorded_output(key, expected):
    preset, allow_identity, term = key.split('|')
    t = letra.Transformer(json_path=preset)
    final = t.transform(term, allow_identity=(allow_identity == 'True'), verbose=False)
    assert final == expected['final']
    assert [[k, v['mother'], v['rule']] for k, v in t.transformations.items()] == expected['transformations']


def test_works_from_any_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    t = letra.Transformer(json_path='sample.json')
    assert t.transform('lítteram') == [' létra ', ' liétra ']


# ---------- edges (every change applied, including the paths `transformations` drops) ----------

@pytest.mark.parametrize('key,expected', CASES, ids=[k for k, _ in CASES])
def test_edges_include_every_recorded_step(key, expected):
    preset, allow_identity, term = key.split('|')
    t = letra.Transformer(json_path=preset)
    t.transform(term, allow_identity=(allow_identity == 'True'))
    edges = {(e['rule'], e['from'], e['to']) for e in t.edges}
    for name, mother, rule in expected['transformations']:
        if mother:                                       # every first-path step is also an edge
            assert (rule, mother, name) in edges
    assert all(e['from'] != e['to'] or e['entries'] == [] for e in t.edges)          # (an alternative that leaves the term as it is is an edge to itself)
    assert all(0 <= e['step'] < len(t.json_dict['order']) for e in t.edges)


def test_edges_keep_the_paths_the_tree_loses():
    # two alternative rules that give the same form: `transformations` keeps only the first path
    rules = '{"groups": {}, "rules": {"x": {"a": "b"}, "y": {"a": "b"}}, "order": ["x|y"]}'
    t = letra.Transformer(rules)
    assert t.transform('a') == [' b ']
    assert t.transformations[' b ']['rule'] == 'x'
    assert {(e['rule'], e['from'], e['to']) for e in t.edges} == {('x', ' a ', ' b '), ('y', ' a ', ' b ')}


def test_edges_are_a_tree_when_branches_do_not_meet():
    t = letra.Transformer(json_path='LA_ES.json')
    t.transform('quinquagínta')
    assert len(t.transformations) == len([e for e in t.edges if e['from'] != e['to']]) + 1      # every term but the start has one edge (an edge to itself is a way through a step that leaves the term as it is)


def test_groups_are_kept_as_lists_of_values():
    t = letra.Transformer(json_path='sample.json')
    assert all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in t.groups_expanded.values())
    assert t.groups_expanded


@pytest.mark.parametrize('name', ['sample', 'LA_ES', 'ES_IPA', 'ES_Miquitrifi'])
def test_bundled_rule_files_are_already_nfc(name):
    import unicodedata
    text = open(os.path.join(HERE, '..', 'transformations', f'{name}.json'), encoding='utf-8').read()
    assert unicodedata.normalize('NFC', text) == text


# ---------- which entries of a rule changed the word ----------

def test_edges_name_the_entries_that_changed_the_word():
    t = letra.Transformer('{"groups": {}, "rules": {"r": {"a": "b", "x": "y", "c": "d"}}, "order": ["r"]}')
    t.transform('ac')
    assert [(e['rule'], e['entries']) for e in t.edges] == [('r', [0, 2])]


def test_halagueno_applies_only_one_entry_of_its_rule():
    t = letra.Transformer(json_path='ES_IPA.json')
    t.transform('halagüeño')
    original = t.json_dict_original['rules']
    for e in t.edges:
        if e['from'] == e['to']:                 # a way through a step that leaves the term as it is: no entry applied
            assert e['entries'] == []
            continue
        entries = list(original[e['rule']].items())
        assert e['entries'] and all(0 <= n < len(entries) for n in e['entries'])
    g = [e for e in t.edges if e['rule'] == 'g']
    assert g and len(g[0]['entries']) == 1 and list(original['g'].items())[g[0]['entries'][0]][0].startswith('gü')


# ---------- comments: a // inside a "string" is not one ----------

def test_a_double_slash_inside_a_string_is_kept_and_a_comment_after_it_is_dropped():
    text = '{"a": "see https://example.org/x", // a comment with "quotes" and https://too.org\n "b": 1}'
    assert json.loads(letra.strip_comments(text)) == {'a': 'see https://example.org/x', 'b': 1}


def test_blanking_comments_keeps_lines_and_columns_and_the_strings():
    text = '{"a": "x//y", // c\n"b": "\\"//"} // end'
    blank = letra.strip_comments(text, keep_length=True)
    assert len(blank) == len(text) and blank.count('\n') == text.count('\n')
    assert '"x//y"' in blank and '"\\"//"' in blank and 'c' not in blank.split('\n')[0][10:] and blank.rstrip().endswith('}')


def test_rules_with_a_link_in_their_description_load():
    t = letra.Transformer('{"description": ["[x](https://example.org/a//b)"], "groups": {}, "rules": {"r": {"a": "b"}}, "order": ["r"]}')
    assert t.transform('a') == [' b ']
    assert t.json_dict_original['description'] == ['[x](https://example.org/a//b)']


# ---------- alternatives that leave the term as it is are edges too ----------

def test_an_alternative_that_leaves_the_term_unchanged_is_an_edge_to_itself():
    rules = '{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["iden|r"]}'
    t = letra.Transformer(rules)
    assert sorted(x.strip() for x in t.transform('a')) == ['a', 'b']
    assert {(e['step'], e['rule'], e['from'], e['to'], tuple(e['entries'])) for e in t.edges} == {(0, 'iden', ' a ', ' a ', ()), (0, 'r', ' a ', ' b ', (0,))}


def test_a_rule_named_identity_is_a_branch_too_but_only_where_another_alternative_changes_the_term():
    rules = '{"groups": {}, "rules": {"identity": {"": ""}, "r": {"a": "b"}}, "order": ["identity|r"]}'
    t = letra.Transformer(rules)
    t.transform('ac')
    assert {(e['rule'], e['from'], e['to']) for e in t.edges} == {('identity', ' ac ', ' ac '), ('r', ' ac ', ' bc ')}
    t.transform('cc')          # r does not apply here: nothing splits, so there is nothing to draw
    assert t.edges == []


def test_the_branches_of_a_step_keep_the_order_the_alternatives_are_written_in():
    rules = '{"groups": {}, "rules": {"first": {"": ""}, "second": {"a": "b"}, "third": {"a": "c"}}, "order": ["first|second|third"]}'
    t = letra.Transformer(rules)
    t.transform('a')
    assert [e['rule'] for e in t.edges] == ['first', 'second', 'third']          # the one that leaves the term as it is comes first, as written
    t2 = letra.Transformer(rules.replace('first|second|third', 'second|first|third'))
    t2.transform('a')
    assert [e['rule'] for e in t2.edges] == ['second', 'first', 'third']


def test_alternatives_that_none_of_which_changes_the_term_leave_no_edge():
    t = letra.Transformer('{"groups": {}, "rules": {"p": {"x": "y"}, "q": {"z": "w"}}, "order": ["p|q"]}')
    assert t.transform('a') == [' a ']
    assert t.edges == []


def test_a_step_with_a_single_rule_has_no_edge_for_a_word_it_does_not_change():
    t = letra.Transformer('{"groups": {}, "rules": {"r": {"x": "y"}}, "order": ["r"]}')
    t.transform('a')
    assert t.edges == []


# ---------- which rules are the identity: the ones that change nothing ----------

def identity_of(rules_json):
    return letra.Transformer(rules_json).identity_rules()


def test_a_rule_whose_only_entry_is_empty_to_empty_is_an_identity_rule_whatever_its_name_and_comments():
    rules = '{"groups": {}, "rules": {"rule_0": {"": "" // identity\n}, "r": {"a": "b"}}, "order": ["rule_0|r"]}'
    assert identity_of(rules) == {'rule_0'}


def test_a_group_that_is_only_the_empty_string_makes_an_identity_rule_too():
    rules = '{"groups": {"iden": [""], "ab": ["a", "b"]}, "rules": {"keep": {"<iden>": "<iden>"}, "also": {"<>": "<>"}, "r": {"a": "b"}, "g": {"<ab>": "<ab>"}}, "order": ["keep|r"]}'
    assert identity_of(rules) == {'keep', 'also'}          # `g` keeps a letter: a rule that maps a group to itself is not the identity


def test_a_rule_with_any_other_entry_is_not_the_identity():
    rules = '{"groups": {}, "rules": {"mixed": {"": "", "a": "b"}, "same": {"a": "a"}, "empty": {}}, "order": ["mixed"]}'
    assert identity_of(rules) == set()


def test_the_builtin_iden_counts_when_the_order_uses_it():
    assert identity_of('{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["iden|r"]}') == {'iden'}
    assert identity_of('{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["r"]}') == set()


def test_only_identity_rules_split_a_step_where_another_alternative_changes_the_term():
    rules = '{"groups": {"iden": [""]}, "rules": {"nothing": {"<iden>": "<iden>"}, "r": {"a": "b"}, "other": {"x": "y"}}, "order": ["nothing|other|r"]}'
    t = letra.Transformer(rules)
    t.transform('a')
    assert [(e['rule'], e['from'] == e['to']) for e in t.edges] == [('nothing', True), ('r', False)]          # `other` changes nothing but is no identity rule: no branch
