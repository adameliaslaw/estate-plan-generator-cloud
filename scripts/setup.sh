#!/usr/bin/env bash
# ============================================================
# NJ Estate Plan Generator — First-Time Setup
# Elias Counsel, LLC
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "============================================================"
echo " NJ Estate Plan Generator — Project Setup"
echo " Elias Counsel, LLC"
echo "============================================================"
echo ""

cd "$PROJECT_DIR"

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v node &> /dev/null; then
  log_error "Node.js not found. Install Node.js 20+: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  log_error "Node.js 20+ required. Current: $(node -v)"
  exit 1
fi
log_ok "Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
  log_error "npm not found."
  exit 1
fi
log_ok "npm $(npm -v)"

if ! command -v firebase &> /dev/null; then
  log_warn "Firebase CLI not found. Installing globally..."
  npm install -g firebase-tools
fi
log_ok "Firebase CLI $(firebase --version)"

# Install dependencies
log_info "Installing frontend dependencies..."
npm install
log_ok "Frontend dependencies installed"

log_info "Installing Cloud Functions dependencies..."
cd functions && npm install && cd ..
log_ok "Functions dependencies installed"

# Environment file
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    log_warn "Created .env from .env.example — fill in your Firebase config values!"
  else
    log_warn "No .env file found. Create one with your Firebase configuration."
  fi
else
  log_ok ".env file exists"
fi

# Verify builds
log_info "Verifying frontend build..."
npx tsc --noEmit
log_ok "Frontend TypeScript check passed"

log_info "Verifying functions build..."
cd functions && npx tsc --noEmit && cd ..
log_ok "Functions TypeScript check passed"

echo ""
echo "============================================================"
echo " Setup Complete!"
echo "============================================================"
echo ""
echo " Next steps:"
echo "   1. Edit .env with your Firebase project credentials"
echo "   2. Run: firebase login"
echo "   3. Run: firebase use --add (select your project)"
echo "   4. Set secrets:"
echo "      firebase functions:secrets:set OPENAI_API_KEY"
echo "      firebase functions:secrets:set SENDGRID_API_KEY"
echo "   5. Deploy: bash scripts/deploy.sh"
echo ""
echo " For local development with emulators:"
echo "   Set VITE_USE_EMULATORS=true in .env"
echo "   Run: firebase emulators:start"
echo "   Run: npm run dev (in another terminal)"
echo ""
echo "============================================================"
