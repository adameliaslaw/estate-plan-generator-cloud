#!/usr/bin/env bash
# Chunked storm-recovery deploy for Cloud Functions v2. Invoked by
# .github/workflows/firebase-functions-deploy.yml. See that file's
# "CHUNKED STORM-RECOVERY DEPLOY" comment for the full rationale.
#
# GitHub runs `run:` blocks with `bash -e`; disable errexit so a failing
# deploy attempt doesn't abort before we read its exit code and react.
set +e -uo pipefail

PROJECT=estate-plan-generator
CHUNK_SIZE=5
# Per-function failures Firebase logs as WARNINGS while still exiting 0.
FAIL_RE='failed to (update|create) function|unable to queue the operation'

# converged <logfile> <exit-code> -> 0 (true) when the deploy fully succeeded:
# process exit 0 AND zero per-function failures in its output.
converged() {
  local log="$1" code="$2" fails
  fails=$(grep -ciE "$FAIL_RE" "$log" || true)
  [ "$code" -eq 0 ] && [ "$fails" -eq 0 ]
}

# ── Phase 1 — full deploy (common case + the only place rules deploy) ─────────
# A normal push changes a few functions; this converges in one shot and also
# releases firestore:rules + storage. Only a shared-module change that touches
# many functions at once trips the v2 concurrent-op ceiling (HTTP 409 "unable to
# queue the operation") — that storm is handled by Phase 2/3 below.
echo "::group::Phase 1 — full deploy (functions + rules)"
firebase deploy --only functions,firestore:rules,storage \
  --project "$PROJECT" --non-interactive --force 2>&1 | tee deploy-full.log
code=${PIPESTATUS[0]}
echo "::endgroup::"
if converged deploy-full.log "$code"; then
  echo "✅ Full deploy converged (no storm). Rules + functions current."
  exit 0
fi

echo "⚠️ Full deploy did not converge — 409 storm. Falling back to chunked deploy."

# ── Phase 2 — chunked deploy of the default codebase ──────────────────────────
# Small batches (≤5) stay under the v2 op ceiling and succeed 100%. Already
# converged functions deploy as fast no-ops; only stragglers do real work.
# Enumerate from prod via firebase (already authed via GOOGLE_APPLICATION_
# CREDENTIALS — no gcloud auth needed). The backfill codebase (3 dormant jobs)
# is left to the Phase 3 full pass.
mapfile -t FUNCS < <(
  firebase functions:list --project "$PROJECT" --json 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const r=JSON.parse(s).result||[];for(const f of r){if(f.codebase==='default'&&f.id)console.log(f.id);}}catch(e){}})" \
    | sort
)
echo "Enumerated ${#FUNCS[@]} default-codebase functions; deploying in chunks of $CHUNK_SIZE."
if [ "${#FUNCS[@]}" -eq 0 ]; then
  echo "⚠️ Enumeration returned 0 functions — skipping chunked phase, letting Phase 3 decide."
fi

i=0
while [ "$i" -lt "${#FUNCS[@]}" ]; do
  chunk=("${FUNCS[@]:i:CHUNK_SIZE}")
  # codebase-qualified targets (functions:default:<id>) are unambiguous and
  # scope the predeploy build to the default codebase only (skips backfill tsc).
  only=$(printf 'functions:default:%s,' "${chunk[@]}"); only=${only%,}
  ca=1
  while :; do
    echo "::group::Chunk @${i} attempt ${ca}: ${chunk[*]}"
    firebase deploy --only "$only" --project "$PROJECT" --non-interactive --force 2>&1 | tee chunk.log
    ccode=${PIPESTATUS[0]}
    echo "::endgroup::"
    if converged chunk.log "$ccode"; then break; fi
    ca=$((ca + 1))
    if [ "$ca" -gt 3 ]; then
      echo "Chunk @${i} still failing after 3 attempts — Phase 3 verify will catch it."
      break
    fi
    echo "Retrying chunk @${i} in 20s…"
    sleep 20
  done
  i=$((i + CHUNK_SIZE))
done

# ── Phase 3 — final full verify (gate; catches new + deleted functions) ───────
# After chunked convergence, all existing functions are "unchanged", so this
# full pass only touches brand-new or deleted functions — no storm — and is the
# authoritative pass/fail gate.
fa=1
while [ "$fa" -le 3 ]; do
  echo "::group::Phase 3 — final verify deploy (attempt ${fa}/3)"
  firebase deploy --only functions --project "$PROJECT" --non-interactive --force 2>&1 | tee verify.log
  vcode=${PIPESTATUS[0]}
  echo "::endgroup::"
  if converged verify.log "$vcode"; then
    echo "✅ Converged — every function is on current code."
    exit 0
  fi
  echo "⚠️ Verify attempt ${fa} not converged (exit=$vcode). Stragglers:"
  grep -iE 'failed to (update|create) function' verify.log \
    | sed -E 's#.*/functions/##; s/[^a-zA-Z0-9].*$//' | sort -u || true
  fa=$((fa + 1))
  [ "$fa" -le 3 ] && sleep 30
done

echo "❌ Did NOT converge after full + chunked + verify. Some functions are on old code."
echo "   Re-run this workflow, or small-batch deploy stragglers locally:"
echo "   firebase deploy --only functions:default:a,functions:default:b  (≤5 at a time)."
exit 1
