#!/usr/bin/env python3
"""FOMO desk pilot: runs on YOUR computer, executes the desk's signed signals as Jupiter (Solana) swaps.

  python pilot.py              run (normal; DRY unless the signed orders file has deskMode LIVE)
  python pilot.py --race       run with the race block of desk.yaml applied
  python pilot.py --stop       stop the running pilot (pid file; never touches other python processes)
  python pilot.py --status     wallet, balance, limits, desk.yaml, running or not
  python pilot.py setup        first run: install code + create/import the dedicated hot wallet
  python pilot.py address      print the wallet's public address
  python pilot.py once         one poll cycle and exit (testing)
  python pilot.py withdraw ADDRESS [SOL|all]   send SOL out of the pilot wallet (asks to confirm)
  python pilot.py jupiter-key  save your Jupiter API key locally (masked prompt, Ctrl+V/right-click paste, or just
                               Enter to take it from the clipboard) -> uses Jupiter Swap v2
  python pilot.py jupiter-key --clipboard      save the key straight from the clipboard (no prompt)
  python pilot.py jupiter-key --remove         delete it again (back to the free keyless v1 path)

Jupiter: with a key (env JUPITER_API_KEY, file jupiter_api_key in this folder, or "jupiter_api_key" in config.json)
the pilot uses api.jup.ag Swap v2 (GET /order -> sign HERE -> POST /execute, header x-api-key). Without a key it
keeps the keyless lite-api v1 path (quote -> swap -> sign HERE -> send via RPC). Either way the wallet key never
leaves this computer, DRY stays the default and nothing is sent unless LIVE (send() is the only exit).

Safety: the private key exists only in wallet.json in this folder (owner-only permissions). It is never printed,
logged or sent. The desk never sees it. Orders must carry a valid desk Ed25519 signature (pinned at install),
be fresh (expiry) and newer than the last seen file (replay), else they are ignored. Local limits always win.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

VERSION = "1.1.2"
SOL_MINT = "So11111111111111111111111111111111111111112"
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
LAMPORTS = 1_000_000_000
HOME = Path(os.environ.get("FOMO_PILOT_HOME") or Path(__file__).resolve().parent)
IS_WIN = os.name == "nt"
AGENTS = ("scanner", "auditor", "analyst", "executor", "risk")
MINT_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")

DEFAULT_CONFIG = {                     # config.json: local hard limits (the desk's limits are min()'d with these)
    "live": False,                     # kept for compatibility; 1.1.2 follows signed deskMode + halt
    "rpc_url": "https://api.mainnet-beta.solana.com",
    "jupiter_url": "https://lite-api.jup.ag/swap/v1",
    "price_url": "https://lite-api.jup.ag/price/v3",
    "jupiter_v2_url": "https://api.jup.ag/swap/v2",   # used only when a Jupiter API key is set (see jupiter-key)
    "price_v2_url": "https://api.jup.ag/price/v3",
    "poll_s": 10,
    "max_trade_pct": 10.0,             # % of current equity per trade
    "max_usd_per_trade": 50.0,         # optional absolute cap (null = none)
    "max_open_positions": 3,
    "max_daily_loss_pct": 10.0,        # % of start-of-day equity (deposits/withdrawals adjust the base)
    "max_slippage_bps": 300,
    "sell_max_slippage_bps": 1000,
    "max_price_impact_pct": 3.0,
    "sell_max_price_impact_pct": 15.0,
    "max_price_drift_pct": 15.0,       # skip a buy if the live quote is this much above the desk's signal price
    "sol_reserve": 0.05,               # SOL always left for fees
    "max_priority_lamports": 1_000_000,
    "min_trade_usd": 1.0,
    "dry_equity_usd": 100.0,           # DRY sizing when the wallet is still empty
}
DEFAULT_YAML = """# desk.yaml: what pilot.py does with the desk's signals. Changes apply when you restart pilot.
agents: [executor, risk]   # executor = buys, risk = exits (local stop/trail below always run)
budget: 100                # hard cap in USD the pilot may have in trades, even if the wallet holds more
size: 0.33                 # fraction of budget per trade
trail: 0.12                # trailing take-profit: sell after a 12% drop from the peak, once in profit
stop: -0.18                # stop loss: sell at -18% from entry
race:                      # only used with: python pilot.py --race
  vs: friends
  owner: pilot_clicks      # pilot_clicks = pilot executes; anything else = you act, pilot only reports
  until: "23:30"           # Lisbon time; after it no new positions
"""
YAML_KEYS = {"agents", "budget", "size", "trail", "stop", "race"}
RACE_KEYS = {"vs", "owner", "until"}
SECRET_LIKE = re.compile(r"[1-9A-HJ-NP-Za-km-z]{60,}|FP1\.|sb_secret|eyJ[A-Za-z0-9_-]{20,}")


class ConfigError(ValueError):
    pass


JUP_KEY_FILE = "jupiter_api_key"
JUP_KEY_RE = re.compile(r"[A-Za-z0-9_\-]{16,128}")


def jupiter_key(home: Path, cfg: dict) -> str | None:
    """Local Jupiter API key, or None (keyless v1). Never printed, logged or sent anywhere but api.jup.ag."""
    k = os.environ.get("JUPITER_API_KEY")
    if not k:
        try:
            k = (home / JUP_KEY_FILE).read_text(encoding="utf-8").strip()
        except OSError:
            k = None
    if not k:
        k = cfg.get("jupiter_api_key")
    k = (k or "").strip()
    return k if JUP_KEY_RE.fullmatch(k) else None


# ---------------- small utils ----------------
def canon(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def now_s() -> float:
    return time.time()


def lisbon_now(ts: float | None = None) -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.fromtimestamp(ts or now_s(), ZoneInfo("Europe/Lisbon"))


def secure_write(path: Path, text: str) -> None:
    """Write a file only the current user can read (POSIX 600; Windows ACL = current user only)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    try:
        os.replace(tmp, path)
    except PermissionError:                                # Windows: odd ACL/attrs on an old file -> drop it, retry
        path.unlink(missing_ok=True)
        os.replace(tmp, path)
    if IS_WIN:
        user = os.environ.get("USERNAME") or ""
        if user:
            subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        os.chmod(path, 0o600)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def say(msg: str) -> None:
    print(f"[{lisbon_now().strftime('%H:%M:%S')} Lisbon] {msg}", flush=True)


# ---------------- desk.yaml ----------------
def validate_yaml_doc(doc) -> dict:
    """Strict: known keys only, typed, ranged. Returns the normalized dict."""
    if not isinstance(doc, dict):
        raise ConfigError("desk.yaml must be a mapping")
    extra = set(doc) - YAML_KEYS
    if extra:
        raise ConfigError(f"unknown key(s): {', '.join(sorted(map(str, extra)))}")
    missing = {"agents", "budget", "size", "trail", "stop"} - set(doc)
    if missing:
        raise ConfigError(f"missing key(s): {', '.join(sorted(missing))}")
    ag = doc["agents"]
    if not isinstance(ag, list) or not ag or any(a not in AGENTS for a in ag) or len(set(ag)) != len(ag):
        raise ConfigError(f"agents must be a list from {', '.join(AGENTS)}, no repeats")

    def num(k, lo, hi):
        v = doc[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ConfigError(f"{k} must be a number")
        if not lo <= v <= hi:
            raise ConfigError(f"{k} must be between {lo} and {hi}")
        return float(v)
    out = {"agents": list(ag), "budget": num("budget", 5, 100_000), "size": num("size", 0.01, 1.0),
           "trail": num("trail", 0.01, 0.9), "stop": num("stop", -0.9, -0.01), "race": None}
    r = doc.get("race")
    if r is not None:
        if not isinstance(r, dict):
            raise ConfigError("race must be a mapping")
        extra = set(r) - RACE_KEYS
        if extra:
            raise ConfigError(f"unknown race key(s): {', '.join(sorted(map(str, extra)))}")
        vs, owner, until = r.get("vs", ""), r.get("owner", ""), r.get("until")
        if not isinstance(vs, str) or not re.fullmatch(r"[A-Za-z0-9 _.@-]{0,40}", vs):
            raise ConfigError("race.vs: up to 40 letters, digits, space _ . @ -")
        if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,30}", owner):
            raise ConfigError("race.owner: pilot_clicks or a short name (letters, digits, _)")
        if isinstance(until, int) and not isinstance(until, bool):       # YAML 1.1 reads 23:30 as 1410 (sexagesimal)
            until = f"{until // 60:02d}:{until % 60:02d}" if 0 <= until < 1440 else str(until)
        if until is not None and (not isinstance(until, str) or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", until)):
            raise ConfigError('race.until must be "HH:MM" (Lisbon)')
        out["race"] = {"vs": vs, "owner": owner, "until": until}
    return out


def parse_yaml(text: str) -> dict:
    import yaml
    if len(text) > 4000:
        raise ConfigError("desk.yaml too long")
    if SECRET_LIKE.search(text):
        raise ConfigError("desk.yaml looks like it contains a key or code; it must not")
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise ConfigError(f"not valid YAML ({str(e).splitlines()[0]})")
    return validate_yaml_doc(doc)


def yaml_text(c: dict) -> str:
    """Canonical desk.yaml text (the desk generates proposals with this exact function)."""
    lines = [
        "# desk.yaml: what pilot.py does with the desk's signals. Changes apply when you restart pilot.",
        f"agents: [{', '.join(c['agents'])}]",
        f"budget: {c['budget']:g}", f"size: {c['size']:g}", f"trail: {c['trail']:g}", f"stop: {c['stop']:g}"]
    if c.get("race"):
        r = c["race"]
        lines += ["race:", f"  vs: {r['vs']}" if r["vs"] else '  vs: ""', f"  owner: {r['owner']}"]
        if r.get("until"):
            lines.append(f'  until: "{r["until"]}"')
    return "\n".join(lines) + "\n"


def race_active(c: dict, race_flag: bool) -> bool:
    return bool(race_flag and c.get("race"))


def race_blocks_buys(c: dict, race_flag: bool, ts: float | None = None) -> str | None:
    if not race_active(c, race_flag):
        return None
    r = c["race"]
    if r["owner"] != "pilot_clicks":
        return f"race owner is {r['owner']}: you act, pilot only reports"
    if r.get("until"):
        hh, mm = map(int, r["until"].split(":"))
        t = lisbon_now(ts)
        if (t.hour, t.minute) >= (hh, mm):
            return f"race ended at {r['until']} Lisbon: no new positions"
    return None


def diff_lines(old: str, new: str) -> list[str]:
    import difflib
    return [ln for ln in difflib.unified_diff(old.splitlines(), new.splitlines(), "running", "proposed", lineterm="", n=0)
            if not ln.startswith(("---", "+++", "@@"))]


# ---------------- keep awake ----------------
ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001


def keep_awake(on: bool) -> str:
    if IS_WIN:
        flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED if on else ES_CONTINUOUS
        ok = ctypes.windll.kernel32.SetThreadExecutionState(flags)  # type: ignore[attr-defined]
        return "Windows: PC kept awake while pilot runs" if (ok and on) else ("released" if ok else "SetThreadExecutionState failed")
    if sys.platform == "darwin":
        return "macOS: to keep the Mac awake run:  caffeinate -i python3 pilot.py"
    return "Linux: to keep the machine awake run:  systemd-inhibit --what=sleep python3 pilot.py"


# ---------------- wallet ----------------
def load_keypair():
    from solders.keypair import Keypair
    w = read_json(HOME / "wallet.json")
    if not w:
        raise SystemExit("No wallet yet. Run:  python pilot.py setup")
    return Keypair.from_base58_string(w["secret"])


def make_wallet(imported: str | None = None):
    import base58
    from solders.keypair import Keypair
    if imported:
        s = imported.strip()
        kp = Keypair.from_bytes(bytes(json.loads(s))) if s.startswith("[") else Keypair.from_bytes(base58.b58decode(s))
    else:
        kp = Keypair()
    secure_write(HOME / "wallet.json", json.dumps({"secret": base58.b58encode(bytes(kp)).decode(),
                                                    "created": now_s()}))
    return kp


# ---------------- install code ----------------
def decode_install_code(code: str, pilot_sha: str | None = None, now: float | None = None) -> dict:
    code = code.strip()
    if not code.startswith("FP1."):
        raise ConfigError("not a pilot install code")
    raw = code[4:]
    try:
        d = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except Exception:
        raise ConfigError("install code is damaged")
    for k in ("u", "f", "d", "k", "w", "x"):
        if not d.get(k):
            raise ConfigError("install code is incomplete")
    if (now or now_s()) > d["x"]:
        raise ConfigError("install code expired: ask the desk for a new one")
    if pilot_sha and d.get("h") and d["h"] != pilot_sha:
        raise ConfigError("pilot.py does not match the desk's version (download damaged or changed): reinstall")
    return {"storage": d["u"], "write_fn": d["f"], "data_path": d["d"], "desk_pubkey": d["k"], "write_secret": d["w"],
            "installed": now or now_s()}


def self_sha() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


# ---------------- signed orders ----------------
def verify_doc(doc, desk_pubkey_b58: str, last_seq: int, now: float | None = None) -> tuple[dict | None, str]:
    """-> (payload, "ok") or (None, reason). Rejects forged, expired, replayed, malformed."""
    import base58
    from nacl.exceptions import BadSignatureError
    from nacl.signing import VerifyKey
    now = now or now_s()
    if not isinstance(doc, dict) or not isinstance(doc.get("payload"), dict) or not isinstance(doc.get("sig"), str):
        return None, "malformed"
    p = doc["payload"]
    try:
        VerifyKey(base58.b58decode(desk_pubkey_b58)).verify(canon(p), base64.b64decode(doc["sig"]))
    except (BadSignatureError, ValueError, TypeError):
        return None, "bad signature (forged or altered file ignored)"
    if p.get("v") != 1 or not isinstance(p.get("seq"), int):
        return None, "unknown version"
    if not isinstance(p.get("expires"), (int, float)) or p["expires"] < now:
        return None, "expired file"
    if p.get("issued", 0) > now + 120:
        return None, "issued in the future (check the PC clock)"
    if p["seq"] < last_seq:
        return None, "replayed (older than the last file seen)"
    if p["seq"] == last_seq:
        return None, "unchanged"
    return p, "ok"


def effective_limits(local: dict, desk: dict | None) -> dict:
    """min() of local and desk (max_usd_per_trade None = no cap); sol_reserve = max()."""
    desk = desk or {}
    out = {}
    for k in ("max_trade_pct", "max_open_positions", "max_daily_loss_pct", "max_slippage_bps", "sell_max_slippage_bps",
              "max_price_impact_pct"):
        vals = [v for v in (local.get(k), desk.get(k)) if isinstance(v, (int, float))]
        out[k] = min(vals) if vals else DEFAULT_CONFIG[k]
    caps = [v for v in (local.get("max_usd_per_trade"), desk.get("max_usd_per_trade")) if isinstance(v, (int, float))]
    out["max_usd_per_trade"] = min(caps) if caps else None
    out["sol_reserve"] = max(float(local.get("sol_reserve") or 0), float(desk.get("sol_reserve") or 0))
    for k in ("sell_max_price_impact_pct", "max_price_drift_pct", "max_priority_lamports", "min_trade_usd"):
        out[k] = local.get(k, DEFAULT_CONFIG[k])
    return out


def size_trade(order_usd: float, equity_usd: float, deployed_usd: float, sol_free_usd: float, lim: dict, y: dict) -> tuple[float, str]:
    """USD for one buy. Every cap applies; the smallest wins. Budget is a hard cap on what is in trades."""
    base = min(equity_usd, y["budget"])
    caps = {"desk ticket": order_usd, "% of equity": equity_usd * lim["max_trade_pct"] / 100,
            "size x budget": y["size"] * base, "budget left": y["budget"] - deployed_usd, "free SOL": sol_free_usd}
    if lim.get("max_usd_per_trade") is not None:
        caps["USD cap"] = lim["max_usd_per_trade"]
    k = min(caps, key=caps.get)
    return max(0.0, round(caps[k], 2)), k


# ---------------- the pilot ----------------
class Pilot:
    def __init__(self, home: Path = HOME, http=None, race: bool = False, keypair=None):
        import httpx
        self.home = home
        self.http = http or httpx.Client(timeout=20, headers={"user-agent": f"fomo-pilot/{VERSION}"})
        self.race = race
        self.cfg = {**DEFAULT_CONFIG, **(read_json(home / "config.json", {}) or {})}
        self.desk = read_json(home / "desk.json")
        if not self.desk:
            raise SystemExit("Not set up yet. Run:  python pilot.py setup")
        self.kp = keypair or load_keypair()
        self.address = str(self.kp.pubkey())
        self.state = read_json(home / "state.json") or {}
        st = self.state
        st.setdefault("last_seq", 0); st.setdefault("done", {}); st.setdefault("positions", {})
        st.setdefault("dry_positions", {}); st.setdefault("fills", []); st.setdefault("transfers", [])
        st.setdefault("pending", {}); st.setdefault("day", None); st.setdefault("expected_lamports", None)
        self.last_error = None
        self.halt_reason = None
        self.desk_payload = None
        self.yaml_text = ""
        self.y = self.load_yaml()
        self._decimals: dict[str, int] = {}
        self._last_hb = 0.0
        self._last_exit_check = 0.0
        self._jup_key = jupiter_key(home, self.cfg)
        self.jupiter = "v2" if self._jup_key else "v1-keyless"
        self._v2_pending: dict[bytes, str] = {}           # signed v2 tx bytes -> Jupiter requestId (for /execute)

    # ---- config ----
    def load_yaml(self) -> dict:
        p = self.home / "desk.yaml"
        if not p.exists():
            p.write_text(DEFAULT_YAML, encoding="utf-8")
        self.yaml_text = p.read_text(encoding="utf-8")
        return parse_yaml(self.yaml_text)

    def apply_signed_config(self, payload: dict) -> bool:
        """At startup only: a desk-proposed desk.yaml (inside the signed orders file) replaces the local one."""
        c = (payload or {}).get("config") or {}
        rev, text = c.get("rev"), c.get("yaml")
        if not rev or not text or rev <= self.state.get("config_rev", 0):
            return False
        parse_yaml(text)                                   # strict; raises on anything odd
        p = self.home / "desk.yaml"
        if p.exists():
            (self.home / "desk.yaml.bak").write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        p.write_text(text, encoding="utf-8")
        self.state["config_rev"] = rev
        self.y = self.load_yaml()
        say(f"desk.yaml updated from the signed desk config (rev {rev}); old copy in desk.yaml.bak")
        return True

    def save(self) -> None:
        self.state["fills"] = self.state["fills"][-200:]
        self.state["transfers"] = self.state["transfers"][-200:]
        cut = now_s() - 7 * 86400
        self.state["done"] = {k: v for k, v in self.state["done"].items() if v.get("ts", 0) > cut}
        secure_write(self.home / "state.json", json.dumps(self.state, separators=(",", ":")))

    # ---- network ----
    def rpc(self, method: str, params: list):
        r = self.http.post(self.cfg["rpc_url"], json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        j = r.json()
        if "error" in j:
            raise RuntimeError(f"rpc {method}: {j['error'].get('message', '')[:120]}")
        return j["result"]

    def sol_lamports(self) -> int:
        return int(self.rpc("getBalance", [self.address, {"commitment": "confirmed"}])["value"])

    def token_raw(self, mint: str) -> int:
        res = self.rpc("getTokenAccountsByOwner", [self.address, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}])
        return sum(int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for a in res["value"])

    def decimals(self, mint: str) -> int:
        if mint not in self._decimals:
            self._decimals[mint] = int(self.rpc("getTokenSupply", [mint])["value"]["decimals"])
        return self._decimals[mint]

    def sol_price(self) -> float:
        """Jupiter price v3 (cached 20 s); falls back to a 1 SOL -> USDC quote."""
        c = getattr(self, "_solpx", None)
        if c and now_s() - c[1] < 20:
            return c[0]
        px = None
        try:
            if self._jup_key:
                j = self.http.get(self.cfg["price_v2_url"], params={"ids": SOL_MINT},
                                  headers={"x-api-key": self._jup_key}).json()
            else:
                j = self.http.get(self.cfg["price_url"], params={"ids": SOL_MINT}).json()
            px = float(j[SOL_MINT]["usdPrice"])
        except Exception:
            q = self.quote(SOL_MINT, USDC_MINT, LAMPORTS, 50)
            px = int(q["outAmount"]) / 1e6
        self._solpx = (px, now_s())
        return px

    def quote(self, inp: str, out: str, amount: int, slippage_bps: int) -> dict:
        if self._jup_key:
            return self.order_v2(inp, out, amount, slippage_bps)
        for i in range(4):                                   # keyless Jupiter rate-limits (429): back off briefly
            r = self.http.get(f"{self.cfg['jupiter_url']}/quote", params={
                "inputMint": inp, "outputMint": out, "amount": str(int(amount)), "slippageBps": str(int(slippage_bps)),
                "restrictIntermediateTokens": "true"})
            if r.status_code != 429:
                break
            time.sleep(2 ** (i + 1))
        if r.status_code != 200:
            raise RuntimeError(f"jupiter quote HTTP {r.status_code}")
        return r.json()

    def order_v2(self, inp: str, out: str, amount: int, slippage_bps: int) -> dict:
        """Swap v2 GET /order (taker = this wallet): quote + assembled tx in one call. Normalised to the v1 fields the
        rest of the pilot reads (inAmount, outAmount, priceImpactPct as a ratio); the tx rides along in _v2."""
        hdr = {"x-api-key": self._jup_key}
        params = {"inputMint": inp, "outputMint": out, "amount": str(int(amount)), "slippageBps": str(int(slippage_bps)),
                  "taker": self.address}
        for i in range(4):
            r = self.http.get(f"{self.cfg['jupiter_v2_url']}/order", params=params, headers=hdr)
            if r.status_code != 429:
                break
            time.sleep(2 ** (i + 1))
        if r.status_code != 200:
            raise RuntimeError(f"jupiter v2 order HTTP {r.status_code}")
        o = r.json()
        if not o.get("outAmount"):
            raise RuntimeError(f"jupiter v2 order refused: {o.get('router', '?')} code {o.get('errorCode', '?')}")
        pi = o.get("priceImpact")
        if isinstance(pi, (int, float)):
            impact = abs(float(pi)) / 100                       # v2: percentage points -> v1-style ratio
        else:
            impact = abs(float(o.get("priceImpactPct") or 0))
        return {"inAmount": str(o.get("inAmount") or amount), "outAmount": str(o["outAmount"]), "priceImpactPct": str(impact),
                "slippageBps": o.get("slippageBps", slippage_bps), "inputMint": inp, "outputMint": out,
                "_v2": {"transaction": o.get("transaction"), "requestId": o.get("requestId"), "router": o.get("router"),
                        "feeBps": o.get("feeBps"), "prioritizationFeeLamports": o.get("prioritizationFeeLamports"),
                        "signatureFeePayer": o.get("signatureFeePayer"), "errorCode": o.get("errorCode")}}

    def sign_v2(self, q: dict):
        """Sign Jupiter's v2 transaction HERE (only our signature slot). Refuses a tx this wallet is not a signer of,
        a missing requestId, or a priority fee above max_priority_lamports."""
        from solders.message import to_bytes_versioned
        from solders.transaction import VersionedTransaction
        v2 = q["_v2"]
        if not v2.get("transaction") or not v2.get("requestId"):
            if not self.is_live():                       # DRY (e.g. empty wallet): the quote is enough, nothing to sign
                return None
            raise RuntimeError(f"jupiter v2: no transaction in the order (code {v2.get('errorCode', '?')})")
        fee = v2.get("prioritizationFeeLamports")
        if isinstance(fee, (int, float)) and fee > int(self.cfg["max_priority_lamports"]):
            raise RuntimeError(f"jupiter v2 priority fee {int(fee)} > max {int(self.cfg['max_priority_lamports'])} lamports")
        tx = VersionedTransaction.from_bytes(base64.b64decode(v2["transaction"]))
        msg = tx.message
        n = msg.header.num_required_signatures
        signers = [str(k) for k in msg.account_keys[:n]]
        if self.address not in signers:
            raise RuntimeError("jupiter v2: this wallet is not a signer of the returned transaction")
        sigs = list(tx.signatures)
        sigs[signers.index(self.address)] = self.kp.sign_message(to_bytes_versioned(msg))
        signed = VersionedTransaction.populate(msg, sigs)
        self._v2_pending = {bytes(signed): v2["requestId"]}       # only the latest order can be executed
        return signed

    def build_swap(self, q: dict):
        if q.get("_v2"):
            return self.sign_v2(q)
        from solders.transaction import VersionedTransaction
        body = {"quoteResponse": q, "userPublicKey": self.address, "wrapAndUnwrapSol": True,
                "dynamicComputeUnitLimit": True, "dynamicSlippage": False,
                "prioritizationFeeLamports": {"priorityLevelWithMaxLamports": {
                    "maxLamports": int(self.cfg["max_priority_lamports"]), "priorityLevel": "high"}}}
        for i in range(4):
            r = self.http.post(f"{self.cfg['jupiter_url']}/swap", json=body)
            if r.status_code != 429:
                break
            time.sleep(2 ** (i + 1))
        if r.status_code != 200:
            raise RuntimeError(f"jupiter swap HTTP {r.status_code}")
        tx = VersionedTransaction.from_bytes(base64.b64decode(r.json()["swapTransaction"]))
        return VersionedTransaction(tx.message, [self.kp])

    def simulate(self, tx) -> str | None:
        if tx is None:
            return "jupiter v2 built no transaction (DRY quote only)"
        res = self.rpc("simulateTransaction", [base64.b64encode(bytes(tx)).decode(), {
            "encoding": "base64", "sigVerify": False, "replaceRecentBlockhash": True, "commitment": "processed"}])
        err = res["value"].get("err")
        return None if err is None else json.dumps(err)[:160]

    def send(self, tx) -> str:
        """THE ONLY place a transaction leaves this computer. Reached only when is_live() is true."""
        if not self.is_live():
            raise RuntimeError("send() refused: not LIVE")
        req = self._v2_pending.pop(bytes(tx), None)
        if req is not None:                                  # Swap v2: Jupiter lands it (POST /execute)
            r = self.http.post(f"{self.cfg['jupiter_v2_url']}/execute",
                               json={"signedTransaction": base64.b64encode(bytes(tx)).decode(), "requestId": req},
                               headers={"x-api-key": self._jup_key, "content-type": "application/json"})
            try:
                res = r.json()
            except Exception:
                res = {}
            if r.status_code == 200 and res.get("status") == "Success" and res.get("signature"):
                return res["signature"]
            if res.get("signature"):                         # failed on chain: fee may be paid; finish_live reads it
                return res["signature"]
            raise RuntimeError(f"jupiter v2 execute failed: HTTP {r.status_code} code {res.get('code', '?')}")
        return self.rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(), {
            "encoding": "base64", "skipPreflight": False, "maxRetries": 3, "preflightCommitment": "confirmed"}])

    def tx_meta(self, sig: str):
        return self.rpc("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0,
                                                 "commitment": "confirmed"}])

    # ---- desk files ----
    def fetch_orders(self):
        url = f"{self.desk['storage']}/d/{self.desk['data_path']}/pilot/orders.json"
        r = self.http.get(url, params={"t": int(now_s() * 1000)}, headers={"cache-control": "no-cache"})
        return r.json() if r.status_code == 200 else None

    def write_desk(self, name: str, obj: dict) -> bool:
        try:
            r = self.http.post(self.desk["write_fn"], content=json.dumps(obj, separators=(",", ":")), headers={
                "x-desk-secret": self.desk["write_secret"], "x-desk-path": self.desk["data_path"],
                "x-desk-name": f"pilot/in/{name}", "content-type": "application/json"})
            return r.status_code == 200
        except Exception:
            return False

    # ---- modes / halts ----
    def is_live(self) -> bool:
        """Live execution follows the signed desk orders: deskMode LIVE and the kill switch off.
        A local STOP file still wins (halted()). The local config 'live' flag is no longer required
        so the owner's PAPER/LIVE app button can switch the pilot without editing this PC."""
        p = self.desk_payload or {}
        return bool(p.get("deskMode") == "LIVE" and not p.get("halt"))

    def halted(self) -> str | None:
        if (self.home / "STOP").exists():
            return "local STOP file"
        if (self.desk_payload or {}).get("halt"):
            return "desk kill switch (Telegram: pilot start to resume)"
        return None

    # ---- accounting ----
    def positions(self, live: bool | None = None) -> dict:
        live = self.is_live() if live is None else live
        return self.state["positions"] if live else self.state["dry_positions"]

    def reconcile(self, lamports: int, sol_px: float) -> None:
        """Wallet SOL that moved without a pilot trade = deposit or withdrawal, never P&L."""
        st = self.state
        exp = st["expected_lamports"]
        if exp is None:
            st["expected_lamports"] = lamports
            if lamports:
                self._transfer(lamports, sol_px, "initial balance")
            return
        diff = lamports - exp
        if abs(diff) > 10_000:                       # > 0.00001 SOL: not rounding
            self._transfer(diff, sol_px, "deposit" if diff > 0 else "withdrawal")
        st["expected_lamports"] = lamports

    def _transfer(self, lamports: int, sol_px: float, kind: str) -> None:
        usd = lamports / LAMPORTS * sol_px
        self.state["transfers"].append({"ts": now_s(), "kind": kind, "sol": lamports / LAMPORTS, "usd": round(usd, 2)})
        d = self.state.get("day")
        if d and kind != "initial balance":
            d["base_usd"] = round(d["base_usd"] + usd, 2)
            d["flows_usd"] = round(d.get("flows_usd", 0) + usd, 2)
        say(f"{kind}: {lamports / LAMPORTS:+.4f} SOL (${usd:+,.2f}), counted as a transfer, not P&L")

    def reconcile_tokens(self, mint: str, raw_now: int) -> None:
        """Tokens moved out by hand: shrink the position and its cost basis (a withdrawal, not a loss)."""
        p = self.state["positions"].get(mint)
        if not p or raw_now >= p["raw"]:
            return
        frac = raw_now / p["raw"] if p["raw"] else 0
        gone_usd = p["cost_usd"] * (1 - frac)
        self.state["transfers"].append({"ts": now_s(), "kind": "token withdrawal", "mint": mint, "usd": -round(gone_usd, 2)})
        d = self.state.get("day")
        if d:
            d["base_usd"] = round(d["base_usd"] - gone_usd, 2)
        p["raw"], p["cost_usd"] = raw_now, round(p["cost_usd"] * frac, 4)
        if raw_now == 0:
            self.state["positions"].pop(mint)

    def equity(self, lamports: int, sol_px: float, live: bool) -> float:
        pos = self.positions(live)
        val = sum(p.get("mark_usd", p["cost_usd"]) for p in pos.values())
        sol_usd = lamports / LAMPORTS * sol_px
        if not live and lamports == 0:
            sol_usd = float(self.cfg["dry_equity_usd"])
        return round(sol_usd + val, 2)

    def roll_day(self, equity_usd: float) -> dict:
        key = datetime.now().strftime("%Y-%m-%d")             # the PC's own calendar day
        d = self.state.get("day")
        if not d or d["key"] != key:
            d = {"key": key, "base_usd": equity_usd, "realized_usd": 0.0, "flows_usd": 0.0, "stopped": False}
            self.state["day"] = d
        return d

    def daily_stop(self, lim: dict) -> str | None:
        d = self.state["day"]
        if d["stopped"]:
            return "daily loss limit hit: no new buys until tomorrow"
        limit = d["base_usd"] * lim["max_daily_loss_pct"] / 100
        if d["base_usd"] > 0 and d["realized_usd"] <= -limit:
            d["stopped"] = True
            say(f"daily loss {d['realized_usd']:,.2f} reached -{limit:,.2f} ({lim['max_daily_loss_pct']:g}% of ${d['base_usd']:,.2f}): buys stop for today")
            return "daily loss limit hit: no new buys until tomorrow"
        return None

    # ---- fills ----
    def fill(self, order: dict, kind: str, mint: str, dry: bool, ok: bool, **kw) -> dict:
        f = {"id": secrets.token_hex(8), "orderId": order.get("id"), "ts": now_s(), "kind": kind, "mint": mint,
             "dry": dry, "ok": ok, "txSig": kw.get("tx"), "usdIn": kw.get("usd_in"), "usdOut": kw.get("usd_out"),
             "tokens": kw.get("tokens"), "priceUsd": kw.get("price"), "feeUsd": kw.get("fee"),
             "solPriceUsd": kw.get("sol_px"), "error": kw.get("error"), "reason": kw.get("reason"),
             "limitedBy": kw.get("limited_by")}
        self.state["fills"].append(f)
        self.write_desk("fills", {"v": 1, "address": self.address, "fills": self.state["fills"][-200:]})
        word = ("DRY would " if dry else "") + kind
        if ok:
            say(f"{word} {mint[:4]}…{mint[-4:]} usd_in={f['usdIn']} usd_out={f['usdOut']} price={f['priceUsd']}"
                + (f" tx={f['txSig']}" if f["txSig"] else ""))
        else:
            say(f"{word} {mint[:4]}…{mint[-4:]} skipped: {f['error']}")
        return f

    def confirm(self, sig: str, wait_s: float = 75) -> str:
        t0 = now_s()
        while now_s() - t0 < wait_s:
            st = self.rpc("getSignatureStatuses", [[sig], {"searchTransactionHistory": True}])["value"][0]
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"):
                return "failed" if st.get("err") else "confirmed"
            time.sleep(2)
        return "unknown"

    def live_amounts(self, sig: str, mint: str) -> dict:
        """Real amounts from the confirmed tx: SOL delta of the wallet, fee, token delta."""
        tx = self.tx_meta(sig)
        meta = tx["meta"]
        keys = [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
        i = keys.index(self.address)
        sol_delta = meta["postBalances"][i] - meta["preBalances"][i]
        def tok(bals):
            return sum(int(b["uiTokenAmount"]["amount"]) for b in (bals or []) if b.get("owner") == self.address and b.get("mint") == mint)
        return {"sol_delta": sol_delta, "fee": int(meta["fee"]), "tok_delta": tok(meta.get("postTokenBalances")) - tok(meta.get("preTokenBalances"))}

    # ---- buy / sell ----
    def do_buy(self, order: dict, lim: dict, lamports: int, sol_px: float) -> dict:
        live = self.is_live()
        mint = order["mint"]
        pos = self.positions(live)
        def skip(why):
            return self.fill(order, "buy", mint, not live, False, error=why, sol_px=sol_px)
        if "executor" not in self.y["agents"]:
            return skip("executor not in desk.yaml agents")
        why = self.daily_stop(lim) or race_blocks_buys(self.y, self.race)
        if why:
            return skip(why)
        if mint in pos:
            return skip("already holding this coin")
        if len(pos) >= lim["max_open_positions"]:
            return skip(f"max open positions ({lim['max_open_positions']})")
        eq = self.equity(lamports, sol_px, live)
        deployed = sum(p["cost_usd"] for p in pos.values())
        free_sol = lamports / LAMPORTS - lim["sol_reserve"] - 0.01        # 0.01 SOL: fees + token account rent
        free_usd = max(0.0, free_sol * sol_px) if (live or lamports) else float(self.cfg["dry_equity_usd"])
        usd, by = size_trade(float(order.get("usd") or 0), eq, deployed, free_usd, lim, self.y)
        if usd < float(lim["min_trade_usd"]):
            return skip(f"size ${usd:.2f} below min (limited by {by})")
        lam_in = int(usd / sol_px * LAMPORTS)
        q = self.quote(SOL_MINT, mint, lam_in, lim["max_slippage_bps"])
        impact = float(q.get("priceImpactPct") or 0) * 100
        if impact > lim["max_price_impact_pct"]:
            return skip(f"price impact {impact:.2f}% > {lim['max_price_impact_pct']:g}%")
        dec = self.decimals(mint)
        tokens = int(q["outAmount"]) / 10 ** dec
        px = usd / tokens if tokens else 0
        sp = float(order.get("signalPrice") or 0)
        if sp and px > sp * (1 + lim["max_price_drift_pct"] / 100):
            return skip(f"price ran {100 * (px / sp - 1):.1f}% above the signal (max {lim['max_price_drift_pct']:g}%)")
        tx = self.build_swap(q)
        if not live:
            sim = self.simulate(tx) if lamports else "wallet empty: simulation skipped"
            self.state["dry_positions"][mint] = {"raw": int(q["outAmount"]), "cost_usd": usd, "entry": px, "peak": px,
                                                 "opened": now_s(), "decimals": dec}
            return self.fill(order, "buy", mint, True, True, usd_in=usd, tokens=tokens, price=px, fee=None, sol_px=sol_px,
                             limited_by=by, error=(f"simulation: {sim}" if sim else None))
        sig = self.send(tx)
        return self.finish_live(sig, order, "buy", mint, sol_px, by, int(q["inAmount"]))

    def finish_live(self, sig: str, order: dict, kind: str, mint: str, sol_px: float, by: str | None, lam_in: int = 0,
                    raw_sold: int = 0, reason: str | None = None) -> dict:
        st = self.confirm(sig)
        if st == "unknown":
            self.state["pending"][sig] = {"order": order, "kind": kind, "mint": mint, "ts": now_s(), "lam_in": lam_in,
                                          "raw_sold": raw_sold, "reason": reason}
            say(f"{kind} {sig[:8]}… sent, not confirmed yet; checking again next polls")
            return {"pending": sig}
        if st == "failed":
            a = self.live_amounts(sig, mint)
            self.state["expected_lamports"] += a["sol_delta"]
            return self.fill(order, kind, mint, False, False, tx=sig, fee=a["fee"] / LAMPORTS * sol_px, sol_px=sol_px,
                             error="transaction failed on chain (fee paid)")
        a = self.live_amounts(sig, mint)
        self.state["expected_lamports"] += a["sol_delta"]                  # trade delta, so it is not a "transfer"
        fee_usd = a["fee"] / LAMPORTS * sol_px
        dec = self.decimals(mint)
        if kind == "buy":
            spent = -a["sol_delta"]
            usd_in = lam_in / LAMPORTS * sol_px
            extra = max(0, spent - a["fee"] - lam_in) / LAMPORTS * sol_px    # token-account rent etc.
            tokens = a["tok_delta"] / 10 ** dec
            px = usd_in / tokens if tokens else 0
            self.state["positions"][mint] = {"raw": a["tok_delta"], "cost_usd": round(usd_in + fee_usd + extra, 4),
                                             "entry": px, "peak": px, "opened": now_s(), "decimals": dec,
                                             "fees_usd": fee_usd + extra}
            return self.fill(order, "buy", mint, False, True, tx=sig, usd_in=round(usd_in, 4), tokens=tokens, price=px,
                             fee=round(fee_usd + extra, 4), sol_px=sol_px, limited_by=by)
        got = (a["sol_delta"] + a["fee"]) / LAMPORTS * sol_px
        tokens = -a["tok_delta"] / 10 ** dec
        p = self.state["positions"].pop(mint, None) or {"cost_usd": 0}
        pnl = got - fee_usd - p["cost_usd"]
        self.state["day"]["realized_usd"] = round(self.state["day"]["realized_usd"] + pnl, 4)
        return self.fill(order, "sell", mint, False, True, tx=sig, usd_out=round(got, 4), tokens=tokens,
                         price=(got / tokens if tokens else 0), fee=round(fee_usd, 4), sol_px=sol_px, reason=reason)

    def do_sell(self, order: dict, lim: dict, sol_px: float, reason: str) -> dict:
        live = self.is_live()
        mint = order["mint"]
        pos = self.positions(live)
        p = pos.get(mint)
        if not p:
            return self.fill(order, "sell", mint, not live, False, error="no position in this wallet", sol_px=sol_px)
        raw = self.token_raw(mint) if live else p["raw"]
        if live:
            self.reconcile_tokens(mint, raw)
            if raw == 0:
                return self.fill(order, "sell", mint, False, False, error="no tokens left (moved out by hand)", sol_px=sol_px)
        q = self.quote(mint, SOL_MINT, raw, lim["sell_max_slippage_bps"])
        impact = float(q.get("priceImpactPct") or 0) * 100
        if impact > lim["sell_max_price_impact_pct"]:
            return self.fill(order, "sell", mint, not live, False, sol_px=sol_px,
                             error=f"sell price impact {impact:.2f}% > {lim['sell_max_price_impact_pct']:g}%, retrying next poll")
        got = int(q["outAmount"]) / LAMPORTS * sol_px
        tx = self.build_swap(q)
        if not live:
            sim = self.simulate(tx) if self.state.get("expected_lamports") else "wallet empty: simulation skipped"
            pos.pop(mint)
            tokens = raw / 10 ** p["decimals"]
            return self.fill(order, "sell", mint, True, True, usd_out=round(got, 4), tokens=tokens,
                             price=(got / tokens if tokens else 0), sol_px=sol_px, reason=reason,
                             error=(f"simulation: {sim}" if sim else None))
        sig = self.send(tx)
        return self.finish_live(sig, order, "sell", mint, sol_px, None, raw_sold=raw, reason=reason)

    def check_pending(self, sol_px: float) -> None:
        for sig, pd in list(self.state["pending"].items()):
            st = self.confirm(sig, wait_s=1)
            if st != "unknown" or now_s() - pd["ts"] > 300:
                self.state["pending"].pop(sig)
                if st == "unknown":
                    self.fill(pd["order"], pd["kind"], pd["mint"], False, False, tx=sig, sol_px=sol_px,
                              error="not confirmed after 5 min (dropped)")
                else:
                    self.finish_live(sig, pd["order"], pd["kind"], pd["mint"], sol_px, None, pd["lam_in"], pd["raw_sold"], pd["reason"])

    def local_exits(self, lim: dict, sol_px: float) -> None:
        """desk.yaml stop / trail, checked by the pilot itself (so exits still happen if the desk is offline)."""
        live = self.is_live()
        for mint, p in list(self.positions(live).items()):
            try:
                q = self.quote(mint, SOL_MINT, p["raw"], lim["sell_max_slippage_bps"])
            except Exception:
                continue
            val = int(q["outAmount"]) / LAMPORTS * sol_px
            p["mark_usd"] = round(val, 4)
            entry_val = p["cost_usd"]
            p["peak_usd"] = max(p.get("peak_usd", entry_val), val)
            reason = None
            if val <= entry_val * (1 + self.y["stop"]):
                reason = "stop"
            elif p["peak_usd"] > entry_val and val <= p["peak_usd"] * (1 - self.y["trail"]):
                reason = "trail"
            if reason:
                say(f"local {reason}: {mint[:4]}…{mint[-4:]} value ${val:,.2f} (cost ${entry_val:,.2f}, peak ${p['peak_usd']:,.2f})")
                self.do_sell({"id": f"L-{mint[:6]}-{int(now_s())}", "mint": mint}, lim, sol_px, reason)

    # ---- one poll ----
    def cycle(self, startup: bool = False) -> dict:
        res = {"orders": 0, "actions": 0, "status": None}
        doc = None
        try:
            doc = self.fetch_orders()
        except Exception as e:
            self.last_error = f"orders fetch: {type(e).__name__}"
        p, why = (verify_doc(doc, self.desk["desk_pubkey"], self.state["last_seq"]) if doc else (None, "no orders file"))
        if p:
            self.state["last_seq"] = p["seq"]
            self.desk_payload = p
            if startup:
                self.apply_signed_config(p)
        elif why not in ("unchanged",):
            if why.startswith(("bad signature", "replayed", "expired", "malformed", "unknown")):
                self.last_error = why
                say(f"orders file ignored: {why}")
            if why != "replayed" and (self.desk_payload or {}).get("expires", 0) < now_s():
                self.desk_payload = {**(self.desk_payload or {}), "orders": [], "stale": True}
        res["status"] = why
        lam = self.sol_lamports()
        sol_px = self.sol_price()
        live = self.is_live()
        self.check_pending(sol_px)
        self.reconcile(lam, sol_px)
        eq = self.equity(lam, sol_px, live)
        self.roll_day(eq)
        lim = effective_limits(self.cfg, (self.desk_payload or {}).get("limits"))
        self.halt_reason = self.halted()
        payload = self.desk_payload or {}
        if not self.halt_reason and not payload.get("stale"):
            for o in payload.get("orders") or []:
                if not isinstance(o, dict) or o.get("id") in self.state["done"]:
                    continue
                if o.get("kind") not in ("buy", "sell") or not MINT_RE.match(str(o.get("mint") or "")):
                    continue
                if float(o.get("expires") or 0) < now_s():
                    continue
                if o["kind"] == "sell" and "risk" not in self.y["agents"]:
                    continue
                res["orders"] += 1
                try:
                    lam = self.sol_lamports()                          # fresh balance before every order
                    f = self.do_buy(o, lim, lam, sol_px) if o["kind"] == "buy" else self.do_sell(o, lim, sol_px, o.get("reason") or "risk")
                    retry = isinstance(f, dict) and not f.get("ok") and "retrying" in (f.get("error") or "")
                    if not retry:
                        self.state["done"][o["id"]] = {"ts": now_s(), "ok": bool(f.get("ok") or f.get("pending"))}
                    res["actions"] += 1
                except Exception as e:
                    n = self.state.setdefault("attempts", {}).get(o["id"], 0) + 1
                    self.state["attempts"][o["id"]] = n
                    self.last_error = f"{o['kind']} {o['id']}: {type(e).__name__}: {str(e)[:120]}"
                    say(self.last_error)
                    if n >= 3:
                        self.state["done"][o["id"]] = {"ts": now_s(), "ok": False}
                        self.fill(o, o["kind"], o["mint"], not live, False, error=self.last_error, sol_px=sol_px)
            if now_s() - self._last_exit_check >= 30:
                self._last_exit_check = now_s()
                self.local_exits(lim, sol_px)
        self.save()
        if now_s() - self._last_hb >= 30 or res["actions"]:
            self.heartbeat(lam, sol_px, lim)
        return res

    def heartbeat(self, lam: int, sol_px: float, lim: dict) -> bool:
        live = self.is_live()
        d = self.state.get("day") or {}
        hb = {"v": 1, "ts": now_s(), "version": VERSION, "mode": "LIVE" if live else "DRY", "address": self.address,
              "solBalance": round(lam / LAMPORTS, 6), "solPriceUsd": sol_px, "equityUsd": self.equity(lam, sol_px, live),
              "openPositions": len(self.positions(live)), "dailyPnlUsd": round(d.get("realized_usd", 0), 2),
              "dayBaseUsd": d.get("base_usd"), "transfersToday": d.get("flows_usd", 0),
              "halted": bool(self.halt_reason or d.get("stopped")),
              "haltReason": self.halt_reason or ("daily loss limit" if d.get("stopped") else None),
              "race": race_active(self.y, self.race), "raceBlock": race_blocks_buys(self.y, self.race),
              "budgetUsd": self.y["budget"], "deployedUsd": round(sum(p["cost_usd"] for p in self.positions(live).values()), 2),
              "deskYaml": self.yaml_text, "configRev": self.state.get("config_rev", 0), "limits": lim,
              "lastError": self.last_error, "os": sys.platform, "keepAwake": IS_WIN, "jupiter": self.jupiter}
        self._last_hb = now_s()
        return self.write_desk("hb", hb)


# ---------------- process control ----------------
PID_FILE = "pilot.pid"


def pid_alive(pid: int) -> bool:
    if IS_WIN:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout
        return "python" in out.lower()
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:                                                     # a zombie (exited, not yet reaped) is not running
        return Path(f"/proc/{pid}/stat").read_text().split(")")[-1].split()[0] != "Z"
    except OSError:
        return True


def stop_running(home: Path = HOME, wait_s: float = 20) -> str:
    pf = home / PID_FILE
    info = read_json(pf)
    if not info:
        return "pilot is not running (no pid file)"
    pid = int(info["pid"])
    if not pid_alive(pid):
        pf.unlink(missing_ok=True)
        return f"pilot was not running (stale pid {pid} cleared)"
    (home / "stop.request").write_text(str(pid))            # graceful: the loop sees it within 1 s
    t0 = time.time()
    while time.time() - t0 < wait_s:
        if not pid_alive(pid):
            return f"pilot stopped (pid {pid})"
        time.sleep(0.5)
    if IS_WIN:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    else:
        os.kill(pid, signal.SIGTERM)
    pf.unlink(missing_ok=True)
    return f"pilot did not stop in {wait_s:.0f}s, terminated pid {pid}"


def run_loop(race: bool, max_cycles: int | None = None, pilot: Pilot | None = None) -> None:
    home = pilot.home if pilot else HOME
    pf = home / PID_FILE
    old = read_json(pf)
    if old and int(old["pid"]) != os.getpid() and pid_alive(int(old["pid"])):
        raise SystemExit(f"pilot already running (pid {old['pid']}). Stop it first:  python pilot.py --stop")
    (home / "stop.request").unlink(missing_ok=True)
    secure_write(pf, json.dumps({"pid": os.getpid(), "started": now_s(), "race": race}))
    stop = {"now": False}
    def handler(*_):
        stop["now"] = True
    signal.signal(signal.SIGINT, handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handler)
    say(keep_awake(True))
    try:
        pl = pilot or Pilot(race=race)
        say(f"pilot {VERSION} wallet {pl.address} · {'RACE ' if race_active(pl.y, race) else ''}"
            f"budget ${pl.y['budget']:g} · size {pl.y['size']:g} · stop {pl.y['stop']:g} · trail {pl.y['trail']:g}")
        n = 0
        while not stop["now"]:
            t0 = time.time()
            try:
                r = pl.cycle(startup=(n == 0))
                if n == 0:
                    say(f"mode {'LIVE' if pl.is_live() else 'DRY'} (desk {(pl.desk_payload or {}).get('deskMode', '?')},"
                        f" config live={pl.cfg.get('live')}) · jupiter {pl.jupiter} · orders file: {r['status']}")
            except Exception as e:
                pl.last_error = f"{type(e).__name__}: {str(e)[:120]}"
                say(f"poll failed: {pl.last_error}")
            n += 1
            if max_cycles and n >= max_cycles:
                break
            while time.time() - t0 < float(pl.cfg["poll_s"]) and not stop["now"]:
                if (home / "stop.request").exists():
                    stop["now"] = True
                time.sleep(0.5)
    finally:
        say(keep_awake(False) if IS_WIN else "stopped")
        (home / "stop.request").unlink(missing_ok=True)
        info = read_json(pf)
        if info and int(info["pid"]) == os.getpid():
            pf.unlink(missing_ok=True)


# ---------------- commands ----------------
def cmd_setup() -> None:
    import getpass
    HOME.mkdir(parents=True, exist_ok=True)
    if not (HOME / "desk.json").exists():
        code = getpass.getpass("Paste the one-time install code from the desk (hidden): ")
        try:
            desk = decode_install_code(code, self_sha())
        except ConfigError as e:
            raise SystemExit(f"Install code refused: {e}")
        secure_write(HOME / "desk.json", json.dumps(desk))
        print("Desk link saved (desk signing key pinned).")
    else:
        print("Desk link already set up (desk.json).")
    if not (HOME / "wallet.json").exists():
        a = input("Wallet: [N]ew dedicated hot wallet or [I]mport one? [N/i]: ").strip().lower()
        if a.startswith("i"):
            kp = make_wallet(getpass.getpass("Paste the private key (base58 or [..] array, hidden): "))
        else:
            kp = make_wallet()
        print("Wallet saved in wallet.json (only your user can read it). The key is never shown or sent.")
    else:
        kp = load_keypair()
    if not (HOME / "config.json").exists():
        (HOME / "config.json").write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
    if not (HOME / "desk.yaml").exists():
        (HOME / "desk.yaml").write_text(DEFAULT_YAML, encoding="utf-8")
    print(f"\nPilot wallet address (send SOL here to fund it):\n  {kp.pubkey()}\n")
    print("Mode is DRY: it quotes and reports, sends nothing. LIVE needs desk LIVE + \"live\": true in config.json.")


def cmd_status() -> None:
    cfg = {**DEFAULT_CONFIG, **(read_json(HOME / "config.json", {}) or {})}
    info = read_json(HOME / PID_FILE)
    running = bool(info and pid_alive(int(info["pid"])))
    print(f"pilot {VERSION} · folder {HOME}")
    print(f"running: {'yes, pid ' + str(info['pid']) + (' (race)' if info.get('race') else '') if running else 'no'}")
    try:
        kp = load_keypair()
        print(f"wallet: {kp.pubkey()}")
        import httpx
        r = httpx.post(cfg["rpc_url"], json={"jsonrpc": "2.0", "id": 1, "method": "getBalance", "params": [str(kp.pubkey())]}, timeout=15)
        print(f"balance: {r.json()['result']['value'] / LAMPORTS:.4f} SOL")
    except SystemExit as e:
        print(e)
    except Exception as e:
        print(f"balance: unavailable ({type(e).__name__})")
    try:
        y = parse_yaml((HOME / "desk.yaml").read_text(encoding="utf-8"))
        print(f"desk.yaml: budget ${y['budget']:g} · size {y['size']:g} · stop {y['stop']:g} · trail {y['trail']:g} · agents {','.join(y['agents'])}"
              + (f" · race vs {y['race']['vs']} owner {y['race']['owner']} until {y['race']['until']}" if y["race"] else ""))
    except Exception as e:
        print(f"desk.yaml: INVALID ({e})")
    print(f"config.json: live={cfg['live']} · {cfg['max_trade_pct']:g}% per trade (cap ${cfg['max_usd_per_trade']}) · "
          f"{cfg['max_open_positions']} open · daily loss {cfg['max_daily_loss_pct']:g}% · reserve {cfg['sol_reserve']:g} SOL")
    print("local STOP file: " + ("present (no transactions)" if (HOME / "STOP").exists() else "none"))
    print("jupiter: " + ("Swap v2 with your API key (api.jup.ag)" if jupiter_key(HOME, cfg) else "keyless v1 (lite-api.jup.ag)"))


def read_clipboard() -> str:
    """Text on the clipboard ('' if none/unavailable). Used only by jupiter-key; the value is never printed."""
    if IS_WIN:
        cmds = [["powershell", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"]]
    elif sys.platform == "darwin":
        cmds = [["pbpaste"]]
    else:
        cmds = [["wl-paste", "--no-newline"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "-b", "-o"]]
    for c in cmds:
        try:
            r = subprocess.run(c, capture_output=True, text=True, timeout=10,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if IS_WIN else 0)
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode == 0 and r.stdout:
            return r.stdout
    return ""


def _clean_key(s: str) -> str:
    """Drop control chars and bracketed-paste markers, trim outer whitespace. Inner spaces stay (then fail the check)."""
    s = (s or "").replace("\x1b[200~", "").replace("\x1b[201~", "")
    return "".join(ch for ch in s if ch.isprintable() or ch in " \t\r\n").strip()


def masked_input_windows(prompt: str, msvcrt_mod=None, clipboard=read_clipboard, out=None) -> str:
    """Windows console prompt that shows one '*' per character, so pasting visibly works.
    Typed or terminal-pasted (Ctrl+V / right-click in Windows Terminal) chars arrive as keystrokes; a raw Ctrl+V
    (classic console) reads the clipboard. Backspace deletes, Enter ends, Ctrl+C raises KeyboardInterrupt."""
    m = msvcrt_mod
    if m is None:
        import msvcrt as m                                 # noqa: PLC0415  (Windows only)
    out = out or sys.stdout
    out.write(prompt)
    out.flush()
    buf: list[str] = []
    while True:
        ch = m.getwch()
        if ch in ("\r", "\n"):
            break
        if ch == "\x03":
            out.write("\n")
            out.flush()
            raise KeyboardInterrupt
        if ch in ("\x00", "\xe0"):                         # arrows/F-keys: two-part code, ignore
            m.getwch()
            continue
        if ch in ("\b", "\x7f"):
            if buf:
                buf.pop()
                out.write("\b \b")
            out.flush()
            continue
        if ch == "\x16":                                   # Ctrl+V reached us: paste from the clipboard
            add = _clean_key(clipboard())
        else:
            add = ch if ch.isprintable() else ""
        if add:
            buf.extend(add)
            out.write("*" * len(add))
            out.flush()
    out.write("\n")
    out.flush()
    return "".join(buf)


def _mask_key(k: str) -> str:
    return ("jup_" if k.startswith("jup_") else "") + "\u2026" + k[-4:]


def cmd_jupiter_key(remove: bool = False, from_clipboard: bool = False) -> None:
    """Save (or remove) the Jupiter API key in this folder, owner-only. The key is never echoed or printed in full."""
    p = HOME / JUP_KEY_FILE
    if remove:
        p.unlink(missing_ok=True)
        print("Jupiter key removed: the pilot uses keyless v1 after its next restart.")
        return
    try:
        if from_clipboard:
            k = _clean_key(read_clipboard())
            if not k:
                raise SystemExit("The clipboard is empty. Copy the key on portal.jup.ag (copy button) and run this again "
                                 "(nothing saved).")
        else:
            if IS_WIN:
                k = masked_input_windows("Paste your Jupiter API key (Ctrl+V or right-click; shows ****), then Enter.\n"
                                         "Or just press Enter to use the key you copied: ")
            else:
                import getpass
                k = getpass.getpass("Paste your Jupiter API key (hidden; or just press Enter to use the clipboard): ")
            k = _clean_key(k)
            if not k:
                k = _clean_key(read_clipboard())
                if not JUP_KEY_RE.fullmatch(k):
                    raise SystemExit("Nothing was pasted and the clipboard does not hold a Jupiter key. Copy the key on "
                                     "portal.jup.ag (copy button) and run this again (nothing saved).")
                print("Using the key from the clipboard.")
    except (KeyboardInterrupt, EOFError):
        raise SystemExit("Cancelled (nothing saved).") from None
    if not JUP_KEY_RE.fullmatch(k):
        raise SystemExit(f"That does not look like a Jupiter API key ({len(k)} characters; expected 16-128 letters, "
                         "digits, _ or -). Copy it again with the copy button on portal.jup.ag (nothing saved).")
    secure_write(p, k)
    print(f"Jupiter key saved ({_mask_key(k)}) in this folder (only your user can read it).")
    cfg = {**DEFAULT_CONFIG, **(read_json(HOME / "config.json", {}) or {})}
    print("jupiter: " + ("Swap v2 with your API key (api.jup.ag)" if jupiter_key(HOME, cfg) else "keyless v1 (lite-api.jup.ag)"))
    print("Restart the pilot to use Swap v2.")


def cmd_withdraw(to: str, amount: str) -> None:
    from solders.hash import Hash
    from solders.message import MessageV0
    from solders.pubkey import Pubkey
    from solders.system_program import TransferParams, transfer
    from solders.transaction import VersionedTransaction
    import httpx
    cfg = {**DEFAULT_CONFIG, **(read_json(HOME / "config.json", {}) or {})}
    kp = load_keypair()
    dest = Pubkey.from_string(to)
    def rpc(m, p):
        return httpx.post(cfg["rpc_url"], json={"jsonrpc": "2.0", "id": 1, "method": m, "params": p}, timeout=20).json()["result"]
    bal = rpc("getBalance", [str(kp.pubkey())])["value"]
    lam = bal - 10_000 if amount == "all" else int(float(amount) * LAMPORTS)
    if lam <= 0 or lam > bal - 5_000:
        raise SystemExit("amount too large for the balance")
    if input(f"Send {lam / LAMPORTS:.6f} SOL to {dest}? type yes: ").strip() != "yes":
        raise SystemExit("cancelled")
    bh = Hash.from_string(rpc("getLatestBlockhash", [])["value"]["blockhash"])
    msg = MessageV0.try_compile(kp.pubkey(), [transfer(TransferParams(from_pubkey=kp.pubkey(), to_pubkey=dest, lamports=lam))], [], bh)
    tx = VersionedTransaction(msg, [kp])
    sig = rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64"}])
    print(f"sent: {sig} (the pilot counts it as a withdrawal, not a loss)")


def main(argv=None) -> None:
    for s in (sys.stdout, sys.stderr):                     # Windows consoles/redirects in cp1252: never crash on "…"
        try:
            s.reconfigure(errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(prog="pilot.py", description="FOMO desk pilot (DRY by default)")
    ap.add_argument("command", nargs="?", default="run", choices=["run", "setup", "status", "address", "once", "withdraw",
                                                                         "jupiter-key"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--race", action="store_true", help="apply the race block of desk.yaml")
    ap.add_argument("--stop", action="store_true", help="stop the running pilot")
    ap.add_argument("--status", action="store_true", help="show status")
    ap.add_argument("--remove", action="store_true", help="with jupiter-key: delete the saved key")
    ap.add_argument("--clipboard", action="store_true", help="with jupiter-key: take the key from the clipboard")
    a = ap.parse_args(argv)
    if a.stop:
        print(stop_running())
        return
    if a.status or a.command == "status":
        cmd_status()
        return
    if a.command == "setup":
        cmd_setup()
    elif a.command == "jupiter-key":
        cmd_jupiter_key(a.remove, a.clipboard)
    elif a.command == "address":
        print(load_keypair().pubkey())
    elif a.command == "once":
        run_loop(a.race, max_cycles=1)
    elif a.command == "withdraw":
        if not a.args:
            raise SystemExit("usage: python pilot.py withdraw ADDRESS [SOL|all]")
        cmd_withdraw(a.args[0], a.args[1] if len(a.args) > 1 else "all")
    else:
        run_loop(a.race)


if __name__ == "__main__":
    main()
