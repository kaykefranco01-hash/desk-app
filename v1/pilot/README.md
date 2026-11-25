# FOMO desk pilot

`pilot.py` runs on your own computer. It reads the desk's signed orders, checks them against your local limits, and
executes them as Jupiter swaps on Solana from a dedicated hot wallet that exists only on that computer.
The desk never holds the key and never signs a transaction.

## Install (Windows, primary)

In PowerShell:

    irm https://kaykefranco01-hash.github.io/desk-app/pilot/install.ps1 | iex

## Install (macOS / Linux)

    curl -fsSL https://kaykefranco01-hash.github.io/desk-app/pilot/install.sh | bash

The installer downloads pilot.py, creates a Python venv in `%USERPROFILE%\.fomo-pilot` (or `~/.fomo-pilot`), installs
the pinned dependencies, then asks you locally for the one-time install code (hidden input) and creates or imports the wallet.
Only the public address is shown. Fund it with SOL.

## Run / restart / stop (Windows PowerShell, copy-paste)

    & "$env:USERPROFILE\.fomo-pilot\pilot.cmd"                                                   # run (DRY by default)
    & "$env:USERPROFILE\.fomo-pilot\pilot.cmd" --stop; Start-Process "$env:USERPROFILE\.fomo-pilot\pilot.cmd"   # restart
    & "$env:USERPROFILE\.fomo-pilot\pilot.cmd" --stop; Start-Process "$env:USERPROFILE\.fomo-pilot\pilot.cmd" -ArgumentList '--race'
    & "$env:USERPROFILE\.fomo-pilot\pilot.cmd" --stop                                            # stop
    & "$env:USERPROFILE\.fomo-pilot\pilot.cmd" --status

`--stop` uses the pid file (`pilot.pid`). It never touches other Python processes. While it runs on Windows, the pilot
keeps the PC awake (SetThreadExecutionState) and releases that when it exits.

## Files (in the pilot folder)

| file | what |
|---|---|
| wallet.json | the hot wallet key, readable only by your user. Never printed or sent. |
| desk.json | desk link from the install code (data path, desk public key, pilot write secret) |
| config.json | hard local limits; `"live": true` is required for LIVE (plus desk mode LIVE) |
| desk.yaml | agents, budget, size, trail, stop, race block. Applied when pilot starts |
| state.json | positions, fills, transfers, day P&L |
| STOP | create this file to stop all transactions locally, even if the desk is offline |

## Limits

Each buy is the smallest of: the desk ticket, `max_trade_pct` of current equity (read before every order), the
`max_usd_per_trade` cap, `size` x `budget` (desk.yaml), the budget left, and free SOL above the reserve.
Daily loss is measured as realized P&L against start-of-day equity. Deposits and withdrawals move that base; they are
never counted as P&L.
