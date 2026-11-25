#!/usr/bin/env bash
# FOMO desk pilot installer for macOS / Linux. Run:
#   curl -fsSL https://kaykefranco01-hash.github.io/desk-app/pilot/install.sh | bash
set -euo pipefail
BASE="${FOMO_PILOT_BASE:-https://kaykefranco01-hash.github.io/desk-app/pilot}"
DIR="${FOMO_PILOT_HOME:-$HOME/.fomo-pilot}"
echo "FOMO pilot -> $DIR"
mkdir -p "$DIR"; chmod 700 "$DIR"
for f in pilot.py requirements.txt; do curl -fsSL "$BASE/$f?t=$(date +%s)" -o "$DIR/$f"; done
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.10+ not found (macOS: brew install python@3.12)"; exit 1; }
[ -x "$DIR/venv/bin/python" ] || "$PY" -m venv "$DIR/venv"
"$DIR/venv/bin/python" -m pip install --disable-pip-version-check -q --upgrade pip
"$DIR/venv/bin/python" -m pip install --disable-pip-version-check -q -r "$DIR/requirements.txt"
printf '#!/usr/bin/env bash\nD="$(cd "$(dirname "$0")" && pwd)"\nexec "$D/venv/bin/python" "$D/pilot.py" "$@"\n' > "$DIR/pilot.sh"
chmod 700 "$DIR/pilot.sh"
if [ "${FOMO_PILOT_SKIP_SETUP:-0}" != "1" ]; then "$DIR/venv/bin/python" "$DIR/pilot.py" setup < /dev/tty; fi
echo
echo "Done. Start (DRY by default):  $DIR/pilot.sh"
if [ "$(uname)" = "Darwin" ]; then echo "Keep the Mac awake:  caffeinate -i $DIR/pilot.sh"; fi
echo "Restart:  $DIR/pilot.sh --stop; nohup $DIR/pilot.sh >> $DIR/pilot.log 2>&1 &"
