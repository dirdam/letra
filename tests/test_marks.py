"""src/marks.py: which pieces of a word a rule replaced, so "was → now" marks only those."""
import json

import pytest

from src import letra, marks

HERE_TERMS = {
    'sample.json': ['lítteram', 'letra'],
    'LA_ES.json': ['lítteram', 'trophaéum', 'óperam', 'dóminum', 'quinquagínta', 'dígitum', 'fília'],
    'ES_IPA.json': ['civilización', 'chascarrillo', 'halagüeño', 'verdad', 'rejuvenecer', 'water', 'hijo'],
}


def cut(entries, word):
    return marks.pieces(entries, word)


def test_only_what_differs_inside_a_match_is_replaced():
    # "gü" → "gui" writes "ui" over "ü"; the "g" is not touched. "i" → "i" replaces nothing; "o" → "i" does.
    entries = {'(a|e|i|o|u)': 'i', 'gü': 'gui'}
    assert cut(entries, ' pingüino ') == [[' ping', ' ping'], ['ü', 'ui'], ['in', 'in'], ['o', 'i'], [' ', ' ']]


def test_a_deletion_an_insertion_and_no_change():
    assert cut({'m ': ' '}, ' líttera m '.replace('a m', 'am')) == [[' líttera', ' líttera'], ['m', ''], [' ', ' ']]
    assert cut({'^': ''}, ' ab ') == [[' ab ', ' ab ']]
    assert cut({'(?<=a)(?=b)': 'x'}, ' ab ') == [[' a', ' a'], ['', 'x'], ['b ', 'b ']]
    assert cut({'a': 'a'}, ' a ') == [[' a ', ' a ']]


def test_entries_are_replayed_in_order_and_a_later_one_can_replace_what_an_earlier_one_wrote():
    # "a" → "b" then "b" → "c": the "a" ends as "c"; it is one replaced piece, not two
    assert cut({'a': 'b', 'b': 'c'}, ' xa ') == [[' x', ' x'], ['a', 'c'], [' ', ' ']]
    # an earlier entry's insertion is replaced by a later one: "ü" → "ui", then "ui" → "u"
    assert cut({'ü': 'ui', 'ui': 'u'}, ' ü ') == [[' ', ' '], ['ü', 'u'], [' ', ' ']]


def test_a_letter_is_not_split_from_its_combining_mark():
    # "é" written as e + U+0301 becoming "e": the accent is replaced together with its letter
    assert cut({'é': 'e'}, ' ké ') == [[' k', ' k'], ['é', 'e'], [' ', ' ']]


def test_the_boundary_markers_of_the_word_can_be_part_of_a_match():
    assert cut({'a ': 'o '}, ' casa ') == [[' cas', ' cas'], ['a', 'o'], [' ', ' ']]
    assert cut({' a': ' ha'}, ' alma ') == [[' ', ' '], ['', 'h'], ['alma ', 'alma ']]


def test_users_rule_from_the_editor_marks_what_the_rule_replaced():
    rules = {
        'groups': {'vocal_atona': list('aeiou')},
        'rules': {'r': {'<vocal_atona>': '<>i', 'gü': 'gui'}},
        'order': ['r'],
    }
    t = letra.Transformer(json.dumps(rules))
    assert t.transform('pingüino') == [' pinguiini ']
    assert cut(t.json_dict['rules']['r'], ' pingüino ') == [[' ping', ' ping'], ['ü', 'ui'], ['in', 'in'], ['o', 'i'], [' ', ' ']]


@pytest.mark.parametrize('preset,term', [(p, w) for p, words in HERE_TERMS.items() for w in words])
def test_the_pieces_add_up_to_what_the_engine_did(preset, term):
    t = letra.Transformer(json_path=preset)
    t.transform(term)          # (a word the rules do not change has no edges)
    for e in t.edges:
        c = cut(t.json_dict['rules'][e['rule']], e['from'])
        assert ''.join(was for was, _ in c) == e['from']
        assert ''.join(now for _, now in c) == e['to']
        assert any(was != now for was, now in c) == (e['from'] != e['to'])          # a change replaces something; a way that leaves the term as it is replaces nothing
