#!/bin/bash
set -euo pipefail
ssh root@46.225.104.62 'cd /opt/dirdam/letra && git pull && ./venv/bin/pip install -q -r requirements.txt && systemctl restart letra'
echo "✓ LETRA deployed: https://dirdam.squadro.app/letra/"
