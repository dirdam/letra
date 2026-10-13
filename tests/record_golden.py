"""Records the Transformer's outputs for the bundled presets so a refactor can be
checked against them. Run from the repo root:  python3 tests/record_golden.py > tests/golden.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import src.letra as letra

TERMS = {
    'sample.json': ['lítteram', 'a', 'letra', 'xyz'],
    'LA_ES.json': ['lítteram', 'trophaéum', 'óperam', 'dóminum', 'quinquagínta', 'dígitum', 'fília'],
    'ES_IPA.json': ['civilización', 'chascarrillo', 'halagüeño', 'verdad', 'rejuvenecer', 'water', 'hijo'],
    'ES_IPA_dialects.json': ['civilización', 'chascarrillo', 'halagüeño', 'verdad', 'rejuvenecer', 'water', 'hijo'],
    'IPA.json': ['civilización', 'verdad'],
}

out = {}
for preset, terms in TERMS.items():
    for allow_identity in (False, True):
        try:
            t = letra.Transformer(json_path=preset)
        except Exception as e:  # presets that are not standalone rule files
            out[f'{preset}|init'] = {'error': type(e).__name__}
            break
        for term in terms:
            t = letra.Transformer(json_path=preset)
            final = t.transform(term, allow_identity=allow_identity, verbose=False)
            out[f'{preset}|{allow_identity}|{term}'] = {
                'final': final,
                'transformations': [[k, v['mother'], v['rule']] for k, v in t.transformations.items()],
            }
json.dump(out, sys.stdout, ensure_ascii=False, indent=1, sort_keys=False)
