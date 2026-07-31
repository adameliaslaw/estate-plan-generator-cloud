/**
 * ClauseCalibrationPage — Adam's bounded 1-hour calibration session (§11 P1).
 *
 * Renders the packet STAGE=calibrate emitted and captures the two label
 * artifacts the tuner consumes: (1) same/different verdicts on the ~30
 * candidate pairs from the decision band — the load-bearing input, tuning
 * cannot run without them; (2) boundary confirmations on the curated seed
 * pieces (ok / should split / should merge). Progress autosaves to
 * localStorage so a closed tab costs nothing; Submit writes through the
 * staff-only callable. "When in doubt, answer different" is shown because
 * over-merge is the catastrophic error the whole checkpoint exists for.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Loader2, Scale } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import {
  getCalibrationPacket,
  submitCalibrationLabels,
  type BoundaryMark,
  type CalibrationPacket,
  type PairLabel,
} from '@/services/clause-calibration-service';
import { cn } from '@/lib/utils';

const RUN_ID = 'pilot-1';

function draftKey(firmId: string) {
  return `clause-calibration-${firmId}-${RUN_ID}`;
}

interface Draft {
  pairs: Record<string, PairLabel>;
  marks: Record<string, BoundaryMark>;
}

export default function ClauseCalibrationPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const [packet, setPacket] = useState<CalibrationPacket | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>({ pairs: {}, marks: {} });
  const [submitState, setSubmitState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!firmId) return;
    let cancelled = false;
    (async () => {
      try {
        const { packet: p, labels } = await getCalibrationPacket(firmId, RUN_ID);
        if (cancelled) return;
        setPacket(p);
        // Precedence: server labels (a finished session) > local draft.
        const local = localStorage.getItem(draftKey(firmId));
        const base: Draft = local ? (JSON.parse(local) as Draft) : { pairs: {}, marks: {} };
        for (const entry of labels?.pairs ?? []) base.pairs[entry.pairId] = entry.label;
        for (const entry of labels?.boundaryMarks ?? []) base.marks[entry.pieceId] = entry.mark;
        setDraft(base);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load the packet.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  const persistDraft = useCallback(
    (next: Draft) => {
      setDraft(next);
      localStorage.setItem(draftKey(firmId), JSON.stringify(next));
    },
    [firmId],
  );

  const labelPair = (pairId: string, label: PairLabel) =>
    persistDraft({ ...draft, pairs: { ...draft.pairs, [pairId]: label } });
  const markPiece = (pieceId: string, mark: BoundaryMark) =>
    persistDraft({ ...draft, marks: { ...draft.marks, [pieceId]: mark } });

  const pairsDone = useMemo(
    () => (packet ? packet.labelPairs.filter((p) => draft.pairs[p.pairId]).length : 0),
    [packet, draft.pairs],
  );
  const allPairsLabelled = packet !== null && pairsDone === packet.labelPairs.length;

  async function handleSubmit() {
    if (!packet) return;
    setSubmitState('busy');
    setSubmitError(null);
    try {
      await submitCalibrationLabels({
        firmId,
        runId: RUN_ID,
        pairs: Object.entries(draft.pairs).map(([pairId, label]) => ({ pairId, label })),
        boundaryMarks: Object.entries(draft.marks).map(([pieceId, mark]) => ({ pieceId, mark })),
      });
      setSubmitState('done');
    } catch (err) {
      setSubmitState('error');
      setSubmitError(err instanceof Error ? err.message : 'Submit failed.');
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (loadError || !packet) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-gray-900">Calibration packet not available</p>
              <p className="mt-1 text-sm text-gray-600">{loadError}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[#1a365d]">
            <Scale className="h-5 w-5" />
            Clause Calibration — run {packet.runId}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{packet.instructions}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">
            Pairs {pairsDone}/{packet.labelPairs.length}
          </p>
          <Button
            className="mt-1"
            disabled={!allPairsLabelled || submitState === 'busy' || submitState === 'done'}
            onClick={handleSubmit}
          >
            {submitState === 'busy' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {submitState === 'done' ? (
              <>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Submitted
              </>
            ) : (
              'Submit labels'
            )}
          </Button>
          {submitError && <p className="mt-1 text-xs text-red-600">{submitError}</p>}
          {!allPairsLabelled && (
            <p className="mt-1 text-xs text-gray-400">Label every pair to submit.</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="pairs">
        <TabsList>
          <TabsTrigger value="pairs">Same or different? ({packet.labelPairs.length})</TabsTrigger>
          <TabsTrigger value="pieces">Clause boundaries ({packet.seedPieces.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pairs" className="space-y-4">
          <p className="text-sm text-gray-500">
            Are these the <strong>same clause</strong> — interchangeable once names and values are
            filled in — or <strong>different clauses</strong>? When in doubt, answer{' '}
            <strong>different</strong>.
          </p>
          {packet.labelPairs.map((pair, i) => {
            const chosen = draft.pairs[pair.pairId];
            return (
              <Card key={pair.pairId} data-testid={`pair-${pair.pairId}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm font-medium">
                    <span>
                      Pair {i + 1} of {packet.labelPairs.length}
                    </span>
                    <span className="flex items-center gap-2">
                      {chosen && (
                        <Badge variant={chosen === 'same' ? 'default' : 'secondary'}>
                          <Check className="mr-1 h-3 w-3" />
                          {chosen}
                        </Badge>
                      )}
                      <span className="text-xs font-normal text-gray-400">
                        similarity {(pair.score * 100).toFixed(0)}%
                      </span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2">
                    <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-serif text-sm">
                      {pair.aText}
                    </pre>
                    <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-serif text-sm">
                      {pair.bText}
                    </pre>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant={chosen === 'same' ? 'default' : 'outline'}
                      onClick={() => labelPair(pair.pairId, 'same')}
                    >
                      Same clause
                    </Button>
                    <Button
                      size="sm"
                      variant={chosen === 'different' ? 'default' : 'outline'}
                      onClick={() => labelPair(pair.pairId, 'different')}
                    >
                      Different clauses
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="pieces" className="space-y-3">
          <p className="text-sm text-gray-500">
            Each entry below was read out of your clause library as <strong>one</strong> clause. Mark
            any that should be split into several, or merged with a neighbour. Unmarked pieces count
            as confirmed.
          </p>
          {packet.seedPieces.map((piece) => {
            const mark = draft.marks[piece.pieceId];
            return (
              <Card key={piece.pieceId}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {piece.title ?? '(untitled piece)'}
                        {piece.trustRelevant && (
                          <Badge className="ml-2" variant="secondary">
                            trust
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">{piece.seedFileName}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {(['ok', 'split', 'merge'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => markPiece(piece.pieceId, m)}
                          className={cn(
                            'rounded-md border px-2 py-1 text-xs',
                            mark === m
                              ? 'border-[#1a365d] bg-[#1a365d] text-white'
                              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                          )}
                        >
                          {m === 'ok' ? 'One clause' : m === 'split' ? 'Should split' : 'Should merge'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-3 font-serif text-xs text-gray-700">
                    {piece.normText}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
