# Claude Pet

A living desktop companion that reacts to your Claude Code and Cowork activity. It eats tokens, reacts to real weather, changes with the time of day, and talks in Animal Crossing bleeps.

![Claude Pet demo](demo.gif)

## Features

- **Reacts to Claude activity** — automatically shows what Claude Code/Cowork is doing via hooks
- **Weather-aware** — real weather from Open-Meteo (rain, snow, storms, sunshine with sunglasses)
- **Time of day** — dawn, day, dusk, night with sky/lighting transitions, stars, sun/moon
- **Hunger system** — drains over time, pet gets sad and slow when starving
- **Speech bubbles** — random contextual dialogue with Animal Crossing-style bleep voice
- **Rate limit reactions** — slumps over with crash stars, countdown timer, confetti on recovery
- **Terminal activity log** — click the monitor on the desk to see work history
- **Food bowl** — visual token level on the desk
- **Mobile friendly** — works on phones via local network or Tailscale

## Quick Start

Requires [Node.js](https://nodejs.org/) 16 or higher.

```bash
git clone https://github.com/thomas-reeve/claude-pet.git
cd claude-pet
npm install
node server.js
```

Open http://localhost:3950 in a browser.

## Connecting to Claude Code / Cowork

Add these hooks to your `~/.claude/settings.json` so the pet reacts to Claude activity automatically:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys,json,urllib.request\ntry:\n  d=json.load(sys.stdin)\n  n=d.get('tool_name','task')\n  i=d.get('tool_input',{})\n  desc=i.get('description',i.get('command',i.get('pattern',i.get('file_path',''))))or''\n  task=(n+(' — '+desc[:50]) if desc else n)[:80]\n  body=json.dumps({'state':'working','task':task,'tokens':500}).encode()\n  req=urllib.request.Request('http://localhost:3950/status',data=body,headers={'Content-Type':'application/json'})\n  urllib.request.urlopen(req,timeout=3)\nexcept: pass\n\" 2>/dev/null || true",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import urllib.request,json; urllib.request.urlopen(urllib.request.Request('http://localhost:3950/status',data=json.dumps({'state':'idle'}).encode(),headers={'Content-Type':'application/json'}),timeout=3)\" 2>/dev/null || true",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

That's it. Claude Code and Cowork will now feed your pet automatically.

## Configuration

### Weather Location

Defaults to Northampton, UK. Set via environment variables:

```bash
LAT=40.7128 LON=-74.0060 node server.js  # New York
```

Weather is fetched from [Open-Meteo](https://open-meteo.com/) — free, no API key needed.

### Network Access

By default the server only listens on localhost. To access from other devices:

```bash
HOST=0.0.0.0 node server.js
```

### API Key (optional)

If exposing on a network, you can require an API key:

```bash
API_KEY=your-secret HOST=0.0.0.0 node server.js
```

Hooks would then need to include the key in their requests.

### Time of Day

Automatic based on system clock:
- Dawn: 05:00 - 08:00
- Day: 08:00 - 18:00
- Dusk: 18:00 - 21:00
- Night: 21:00 - 05:00

## Run as a Service (macOS)

Save as `~/Library/LaunchAgents/com.claudepet.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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
  <string>/tmp/claude-pet.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key>
    <string>0.0.0.0</string>
  </dict>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.claudepet.plist
```

## API

```bash
# Update state
curl -X POST http://localhost:3950/status \
  -H "Content-Type: application/json" \
  -d '{"state":"working","task":"processing inbox","tokens":2340}'

# Check state
curl http://localhost:3950/status

# Test feed
curl "http://localhost:3950/feed?tokens=2000&task=inbox+sweep"
```

Valid states: `idle`, `working`, `sleeping`, `rate_limited`

## License

MIT
