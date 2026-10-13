# LETRA: LanguagE TRAnsformations

Live at **https://dirdam.squadro.app/letra/**

LETRA converts a script into a different one through a set of _transformation rules_: write the
rules in a JSON file, enter a term, and see every possible result together with the step-by-step
chain of rules that produced it. Typical uses are Latin to Spanish sound change and Spanish
spelling to IPA. The script doesn't need to represent orthography or phonetics; what it
represents is up to you. The full description, with the rule syntax, is in the app's
_Project description_ tab (source: [`data/LETRA_en.md`](data/LETRA_en.md),
[`data/LETRA_es.md`](data/LETRA_es.md)).

The page is available in English and Spanish.

## Layout

| Path | What it is |
| --- | --- |
| `src/letra.py` | The rule engine (`Transformer`). Pure Python, standard library only |
| `server.py` | Flask app: the JSON API and the page |
| `web/` | The page (`index.html`, `app.js`, `styles.css`) |
| `transformations/` | The bundled rule files (`sample`, `LA_ES`, `ES_IPA`) |
| `data/` | Page texts (`localizations.csv`) and the project description |
| `tests/` | Tests; `golden.json` holds outputs recorded from the engine |
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
| `POST /api/transform` `{"term": "...", "preset": "sample"}` or `{"term": "...", "rules": "<rules JSON text>"}` | The final terms, every intermediate term and the derivation tree |
| `GET /api/presets`, `GET /api/rules/<preset>` | The bundled rule files |
| `GET /api/strings`, `GET /api/about?lang=en` | Page texts |

Rules files uploaded through the page are processed on the server, so there are limits:
256 KB per request, 64 characters per term, 1000 entries per section, 20000 values per group,
and a 10 second time limit per request (gunicorn restarts a worker that takes longer).

## Deploy

The app runs as `letra.service` (gunicorn on `127.0.0.1:8506`) behind nginx at `/letra/`
on dirdam.squadro.app. `./deploy.sh` pulls the latest code on the server and restarts it.

## License

MIT, see [LICENSE](LICENSE).
