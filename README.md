# LETRA: LanguagE TRAnsformations

Live at **https://dirdam.squadro.app/letra/**

LETRA applies sets of rewrite rules to words and shows every possible result together with the
step-by-step derivation that produced it. Typical uses are Latin to Spanish sound change and Spanish
spelling to IPA, but the script doesn't need to represent orthography or phonetics: what it represents
is up to you. The rule syntax is described in the app's *About* tab (source:
[`data/LETRA_en.md`](data/LETRA_en.md), [`data/LETRA_es.md`](data/LETRA_es.md)).

The page is available in English and Spanish.

## What you can do

- **Evolve words** from one search bar: a word, or several separated by spaces; results update as you type.
- **Read every derivation**: each word has a card with the **tree** of all its derivations (a form
  reached by two paths is one node with two incoming edges) and, under it, the **chain** of steps of
  the form you click, with the letters that changed highlighted and `␣` (the open box) for the word boundary.
- **Browse the rule book**: the rules in the order they apply, with their alternatives, the group names
  as chips (hover for the members), search, and the rules used by what is on screen highlighted.
- **Write your own rules** in the editor: line numbers, syntax colours, live validation with the
  line and column of each problem, open / download, and *Edit a copy* of a bundled set. Your draft stays
  in your browser.
- **Export** the results (plain text, TSV, CSV, LaTeX) and **share a link** to a set of words
  (links to your own rules are not possible: they never leave your browser).
- IPA and combining marks are set in [Gentium](https://software.sil.org/gentium/) (SIL Open Font
  License), served from this app (`web/fonts/`, unmodified).

## Layout

| Path | What it is |
| --- | --- |
| `src/letra.py` | The rule engine (`Transformer`). Pure Python, standard library only |
| `src/validate.py` | Checks a rules file and reports each problem with its line and column |
| `server.py` | Flask app: the JSON API and the page |
| `web/` | The page: `index.html`, `styles.css`, `js/` (one script per concern), `fonts/` |
| `transformations/` | The bundled rule files (`sample`, `LA_ES`, `ES_IPA`, `ES_Miquitrifi`) |
| `data/` | Page texts (`localizations.csv`, English and Spanish) and the project description |
| `tests/` | Tests; `golden.json` holds outputs recorded from the engine before the web version |
| `deploy/letra.service`, `deploy.sh` | systemd unit and deploy script for the server |

## Run it

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python server.py        # http://127.0.0.1:8506/
.venv/bin/python -m pytest        # tests
```

## API

| Request | Answer |
| --- | --- |
| `POST /api/transform` `{"terms": [...], "preset": "sample"}` or `{"terms": [...], "rules": "<rules JSON text>"}` | `{"results": [...], "truncated": false}`: for each word its final forms, every intermediate form, the derivation tree and `edges` (`[step, rule, from, to, entries, pieces]`, every change applied: the rule's entries that changed the word, and the pieces they replaced as `[[was, now], ...]`). `{"term": "..."}` (one word) answers with that word's result alone |
| `POST /api/rulebook` (`preset` or `rules`) | The steps in order, the rules with their entries, and the members of each group |
| `POST /api/validate` `{"rules": "..."}` | `{"ok": bool, "issues": [{severity, code, message, params, path, line, col}]}` |
| `GET /api/presets`, `GET /api/rules/<preset>` | The bundled rule files |
| `GET /api/strings`, `GET /api/about?lang=en` | Page texts |

Words and rule text are normalised to Unicode NFC, so `é` typed as one character or as `e` plus a
combining accent means the same. Input is lower-cased.

Because rules uploaded through the page are compiled to regular expressions on the server, there are
limits: 256 KB per request, 100 words of at most 64 characters, 1000 entries per section, 20000 values
per group, 6 seconds of work per request, and a 10 second limit per request in total (gunicorn restarts
a worker that takes longer, which is what stops a runaway regular expression).

## Deploy

The app runs as `letra.service` (gunicorn on `127.0.0.1:8506`) behind nginx at `/letra/`
on dirdam.squadro.app. `./deploy.sh` pulls the latest code on the server and restarts it.

## License

MIT, see [LICENSE](LICENSE). The Gentium fonts in `web/fonts/` are under the SIL Open Font License
(`web/fonts/OFL.txt`).
