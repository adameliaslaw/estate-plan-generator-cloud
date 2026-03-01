#!/usr/bin/env bash
# ============================================================
# NJ Estate Plan Generator — Deployment Script
# Elias Counsel, LLC
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
DEPLOY_TARGET="${1:-all}"

echo "============================================================"
echo " NJ Estate Plan Generator — Deploy"
echo " Target: $DEPLOY_TARGET"
echo "============================================================"

# Pre-flight checks
log_info "Running pre-flight checks..."

# Check Firebase CLI
if ! command -v firebase &> /dev/null; then
  log_error "Firebase CLI not found. Install: npm install -g firebase-tools"
  exit 1
fi

# Check logged in
if ! firebase projects:list &> /dev/null; then
  log_error "Not logged in to Firebase. Run: firebase login"
  exit 1
fi

log_ok "Firebase CLI authenticated"

# Navigate to project root
cd "$PROJECT_DIR"

# Step 1: Install dependencies
log_info "Installing frontend dependencies..."
npm ci --silent
log_ok "Frontend dependencies installed"

log_info "Installing Cloud Functions dependencies..."
cd functions && npm ci --silent && cd ..
log_ok "Functions dependencies installed"

# Step 2: Build frontend
log_info "Building frontend (Vite)..."
npx vite build
log_ok "Frontend built to dist/"

# Step 3: Build Cloud Functions
log_info "Building Cloud Functions (TypeScript)..."
cd functions && npm run build && cd ..
log_ok "Cloud Functions compiled to functions/lib/"

# Step 4: Type-check
log_info "Running TypeScript type-check (frontend)..."
npx tsc --noEmit
log_ok "Frontend type-check passed"

log_info "Running TypeScript type-check (functions)..."
cd functions && npx tsc --noEmit && cd ..
log_ok "Functions type-check passed"

# Step 5: Deploy
case "$DEPLOY_TARGET" in
  all)
    log_info "Deploying everything to Firebase..."
    firebase deploy --only hosting,functions,firestore:rules,storage
    ;;
  hosting)
    log_info "Deploying Hosting only..."
    firebase deploy --only hosting
    ;;
  functions)
    log_info "Deploying Cloud Functions only..."
    firebase deploy --only functions
    ;;
  rules)
    log_info "Deploying Firestore + Storage rules..."
    firebase deploy --only firestore:rules,storage
    ;;
  *)
    log_error "Unknown target: $DEPLOY_TARGET"
    echo "Usage: $0 [all|hosting|functions|rules]"
    exit 1
    ;;
esac

log_ok "Deployment complete!"

echo ""
echo "============================================================"
echo " Deployment Summary"
echo "============================================================"
echo " Target:   $DEPLOY_TARGET"
echo " Time:     $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo " Project:  $(firebase use 2>/dev/null || echo 'unknown')"
echo "============================================================"
