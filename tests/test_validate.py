import json
import os
import random

import pytest

from src import validate

HERE = os.path.dirname(__file__)
TRANSFORMATIONS = os.path.join(HERE, '..', 'transformations')


def codes(text):
    return [(i['severity'], i['code']) for i in validate.check(text)['issues']]


def issue(text, code):
    found = [i for i in validate.check(text)['issues'] if i['code'] == code]
    assert found, f'no {code} issue in {codes(text)}'
    return found[0]


GOOD = '''{
  // a comment line
  "groups": {
    "vow": ["a", "e"],
    "cons": ["t", "m"]
  },
  "rules": {
    "drop_m": {"m ": " "},
    "swap": {"<vow>": "<vow>", "<cons>": "<cons>"}
  },
  "order": ["drop_m", "swap"]
}'''


def test_good_file_has_no_issues():
    r = validate.check(GOOD)
    assert r == {'ok': True, 'issues': []}


@pytest.mark.parametrize('name', ['sample', 'LA_ES', 'ES_IPA', 'ES_Miquitrifi'])
def test_bundled_rule_files_are_valid(name):
    text = open(os.path.join(TRANSFORMATIONS, f'{name}.json'), encoding='utf-8').read()
    assert validate.check(text)['ok']


# ---------- positions ----------

def test_syntax_error_line_ignores_comment_lines():
    text = '// one\n// two\n{\n  "groups": {},\n  "rules": {,\n}'
    i = issue(text, 'json_syntax')
    assert (i['line'], i['severity']) == (5, 'error')


def test_comments_do_not_shift_later_lines_or_columns():
    text = GOOD.replace('"swap": {"<vow>": "<vow>", "<cons>": "<cons>"}', '"swap": {"<nope>": "<vow>", "<cons>": "<cons>"}')
    i = issue(text, 'unknown_group')
    assert i['line'] == 9                                  # the rule's key, after the comment on line 2
    assert i['path'] == 'rules.swap.<nope>'
    assert i['col'] == text.splitlines()[8].index('"<nope>"') + 1


def test_order_entry_points_at_its_own_line():
    text = '{\n "groups": {},\n "rules": {"a": {"x": "y"}},\n "order": [\n   "a",\n   "ghost"\n ]\n}'
    i = issue(text, 'unknown_rule_in_order')
    assert i['line'] == 6 and 'ghost' in i['message']


def test_duplicate_key_is_a_warning_on_the_second_one():
    text = '{\n "groups": {},\n "rules": {"a": {"x": "y"}},\n "order": ["a"],\n "order": ["a"]\n}'
    i = issue(text, 'duplicate_key')
    assert i['severity'] == 'warning' and i['line'] == 5


def test_issues_come_sorted_by_position():
    text = '{\n "groups": {"g": ["<z>"]},\n "rules": {"a": {"<q>": "y"}},\n "order": ["a", "b"]\n}'
    lines = [i['line'] for i in validate.check(text)['issues']]
    assert lines == sorted(lines) and len(lines) >= 2


# ---------- structure ----------

@pytest.mark.parametrize('text,code', [
    ('[]', 'not_object'),
    ('{}', 'missing_section'),
    ('{"groups": [], "rules": {}, "order": []}', 'wrong_type'),
    ('{"groups": {"g": [1]}, "rules": {}, "order": []}', 'group_values'),
    ('{"groups": {}, "rules": {"r": {"a": 2}}, "order": []}', 'rule_values'),
    ('{"groups": {}, "rules": {}, "order": [3]}', 'order_items'),
    ('{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["nope"]}', 'unknown_rule_in_order'),
    ('{"groups": {}, "rules": {"r": {"<g": "b"}}, "order": ["r"]}', 'unbalanced_brackets'),
    ('{"groups": {"g": ["<h>"]}, "rules": {}, "order": []}', 'unknown_group'),
    ('{"groups": {"g": ["<h>"], "h": ["a"]}, "rules": {}, "order": []}', 'group_defined_later'),
    ('{"groups": {"g": ["a", "<g>"]}, "rules": {}, "order": []}', 'group_self_reference'),
    ('{"groups": {}, "rules": {"r": {"(": "b"}}, "order": ["r"]}', 'regex_error'),
    ('{"groups": {"g": ["a"]}, "rules": {"r": {"<g>": "\\\\5"}}, "order": ["r"]}', 'regex_error'),
])
def test_each_problem_is_reported_with_its_code(text, code):
    assert any(c == code for _, c in codes(text))
    assert not validate.check(text)['ok'] or code in ('duplicate_key',)


def test_iden_is_a_valid_order_entry():
    assert validate.check('{"groups": {}, "rules": {"r": {"a": "b"}}, "order": ["r|iden"]}')['ok']


def test_warnings_do_not_make_the_file_invalid():
    r = validate.check('{"groups": {}, "rules": {"r": {"a": "b"}, "unused": {"c": "d"}}, "order": ["r"]}')
    assert r['ok'] and ('warning', 'rule_unused') in codes('{"groups": {}, "rules": {"r": {"a": "b"}, "unused": {"c": "d"}}, "order": ["r"]}')


def test_placeholder_count_mismatch_is_a_warning():
    r = validate.check('{"groups": {"g": ["a"]}, "rules": {"r": {"<g><g>": "<g>"}}, "order": ["r"]}')
    assert r['ok'] and any(i['code'] == 'placeholder_count' for i in r['issues'])


def test_replacing_a_group_by_plain_text_needs_an_empty_bracket():
    r = validate.check('{"groups": {"g": ["a"]}, "rules": {"r": {"<g>b": "c"}}, "order": ["r"]}')
    assert r['ok'] and [i['code'] for i in r['issues']] == ['placeholder_count']
    assert validate.check('{"groups": {"g": ["a"]}, "rules": {"r": {"<g>b": "<>c"}}, "order": ["r"]}') == {'ok': True, 'issues': []}


def test_exponential_groups_are_refused():
    groups = {'g0': ['a', 'b']}
    for i in range(1, 60):
        groups[f'g{i}'] = [f'<g{i-1}>', f'<g{i-1}>']
    text = json.dumps({'groups': groups, 'rules': {'r': {'a': 'b'}}, 'order': ['r']})
    assert ('error', 'group_too_large') in codes(text)


def test_group_sizes_matches_the_engine():
    from src import letra
    text = open(os.path.join(TRANSFORMATIONS, 'LA_ES.json'), encoding='utf-8').read()
    t = letra.Transformer(text)
    groups = json.loads(validate.blank_comments(text))['groups']
    sizes = validate.group_sizes(groups)
    for name in groups:                                     # a name like "a|b" defines both a and b
        for part in name.split('|'):                        # sizes count duplicates and ignore negations
            assert sizes[name] >= len(t.groups_expanded[part])


# ---------- robustness ----------

def test_checker_never_raises_on_garbage():
    rnd = random.Random(7)
    pieces = ['{', '}', '[', ']', '"', ',', ':', '//', '\n', 'a', '<', '>', '|', '*', '=', '!', 'null', '1', '"groups"', '"rules"', '"order"']
    for _ in range(400):
        text = ''.join(rnd.choice(pieces) for _ in range(rnd.randint(0, 40)))
        r = validate.check(text)
        assert set(r) == {'ok', 'issues'} and isinstance(r['ok'], bool)
        for i in r['issues']:
            assert i['line'] >= 1 and i['col'] >= 1


def test_blank_comments_keeps_length_and_lines():
    t = 'a // x\nb // yy\n'
    b = validate.blank_comments(t)
    assert len(b) == len(t) and b.count('\n') == t.count('\n') and '//' not in b


def test_every_issue_carries_params_for_translation():
    text = '{"groups": {"g": ["<h>"]}, "rules": {"r": {"<q>": "y"}}, "order": ["r", "ghost"]}'
    by_code = {i['code']: i for i in validate.check(text)['issues']}
    assert by_code['unknown_group']['params']['name'] in ('h', 'q')
    assert by_code['unknown_rule_in_order']['params'] == {'step': 2, 'name': 'ghost'}
    assert all(isinstance(i['params'], dict) for i in validate.check(text)['issues'])
    assert validate.check('{ nope')['issues'][0]['params']['detail']


# ---------- groups nothing uses ----------

def unused_groups(text):
    return [i['params']['name'] for i in validate.check(text)['issues'] if i['code'] == 'group_unused']


def test_a_group_no_rule_uses_is_a_warning_on_its_line():
    text = '{\n  "groups": {\n    "v": ["a"],\n    "spare": ["b"]\n  },\n  "rules": {"r": {"<v>": "<v>"}},\n  "order": ["r"]\n}'
    r = validate.check(text)
    assert r['ok'] and [(i['severity'], i['code'], i['line']) for i in r['issues']] == [('warning', 'group_unused', 4)]


def test_a_group_is_used_by_a_rule_through_modifiers_alternatives_and_aliases():
    text = '{"groups": {"a": ["x"], "b": ["y"], "c|d": ["z"], "e": ["w"]}, "rules": {"r": {"<a*><b|e><d=>": "<a*><><d>"}}, "order": ["r"]}'
    assert unused_groups(text) == []


def test_a_group_is_used_when_a_used_group_includes_it_but_not_when_only_an_unused_one_does():
    used = '{"groups": {"a": ["x"], "ab": ["<a>", "y"]}, "rules": {"r": {"<ab>": "<ab>"}}, "order": ["r"]}'
    assert unused_groups(used) == []
    unused = '{"groups": {"a": ["x"], "ab": ["<a>", "y"], "v": ["z"]}, "rules": {"r": {"<v>": "<v>"}}, "order": ["r"]}'
    assert unused_groups(unused) == ['a', 'ab']


def test_a_link_in_the_description_is_not_taken_for_a_comment():
    text = '{\n  "description": ["see [it](https://example.org/a)"], // a real comment\n  "groups": {},\n  "rules": {"r": {"a": "b"}},\n  "order": ["r", "ghost"]\n}'
    i = issue(text, 'unknown_rule_in_order')
    assert i['line'] == 5 and validate.check(text.replace(', "ghost"', ''))['issues'] == []
