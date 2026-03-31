#!/bin/bash
# Claude Pet launcher — finds node automatically so the plist works on any machine
DIR="$(cd "$(dirname "$0")" && pwd)"

# Try common node locations
for candidate in /usr/local/bin/node /opt/homebrew/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$DIR/server.js"
  fi
done

# Fallback to PATH
exec node "$DIR/server.js"
