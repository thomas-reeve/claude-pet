# Claude Pet 🤖

A living desktop companion for your Mac mini. Claude eats tokens, reacts to weather, changes with the time of day, and talks in Animal Crossing bleeps.

## Setup

```bash
cd claude-pet
npm install
node server.js
```

Then open `http://localhost:3950` in a fullscreen browser window.

For remote access (mobile, other devices), use Tailscale:
`http://<your-mac-mini-tailscale-ip>:3950`

Or on your local network:
`http://macmini.local:3950`

---

## Controlling Claude from Cowork / Scripts

### POST /status

```bash
# Claude starts working
curl -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d '{"state":"working","task":"processing inbox","tokens":2340}'

# Claude finishes
curl -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d '{"state":"idle"}'

# Rate limited (weekly)
curl -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d '{"state":"rate_limited","resetsAt":"2026-04-07T09:00:00Z"}'

# Rate limited (session, resets sooner)
curl -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d '{"state":"rate_limited","resetsAt":"2026-04-01T14:30:00Z"}'

# Back to idle (after limit resets) — triggers confetti + "I'M BACK"
curl -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d '{"state":"idle"}'
```

### Quick test URLs
```
http://localhost:3950/feed?tokens=2000&task=inbox+sweep
http://localhost:3950/status
```

---

## Cowork Integration (wrapper script)

Save as `~/scripts/claude-status.sh`:

```bash
#!/bin/bash
# Usage: claude-status working "summarising emails" 2340
#        claude-status idle
#        claude-status rate_limited "" "" "2026-04-07T09:00:00Z"

STATE=$1
TASK=${2:-""}
TOKENS=${3:-0}
RESETS=${4:-""}

PAYLOAD="{\"state\":\"$STATE\",\"task\":\"$TASK\",\"tokens\":$TOKENS}"
if [ -n "$RESETS" ]; then
  PAYLOAD="{\"state\":\"$STATE\",\"resetsAt\":\"$RESETS\"}"
fi

curl -s -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > /dev/null
```

Then in your Cowork task scripts:
```bash
~/scripts/claude-status.sh working "processing inbox" 2340
# ... do the work ...
~/scripts/claude-status.sh idle
```

---

## Weather

Weather auto-fetches from Open-Meteo (free, no API key).
Defaults to Northampton, UK. To change location, edit `server.js`:
```js
const LAT = 52.2368;
const LON = -0.8957;
```

---

## Time of Day

Automatic based on system clock:
- Dawn: 05:00–08:00
- Day: 08:00–18:00
- Dusk: 18:00–21:00
- Night: 21:00–05:00

---

## Run as a persistent service (launchd)

Save as `~/Library/LaunchAgents/com.claudepet.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudepet</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/path/to/claude-pet/start.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/claude-pet.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/claude-pet-err.log</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.claudepet.plist
```
