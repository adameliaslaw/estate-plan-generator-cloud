/**
 * Project-wide Cloud Functions defaults.
 *
 * Imported FIRST in index.ts (before any function module) so setGlobalOptions
 * runs before function definitions evaluate — v2 captures options at definition
 * time, so a later call would be ignored.
 *
 * memory 512MiB: the Node 22 runtime bump raised the baseline enough that the
 * firebase-functions v2 default of 256MiB OOMs many functions on cold start
 * (instance fails its readiness check before it can respond → surfaces as a
 * generic CORS/internal error). 512MiB is the safe floor. Functions needing
 * more (generators, embedding triggers) still set memory explicitly and that
 * per-function value overrides this default.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ memory: '512MiB' });
