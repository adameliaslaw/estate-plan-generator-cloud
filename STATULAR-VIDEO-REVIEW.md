# Statular video review — 2026-08-06 (second pass)

**Status: DRAFT, uncommitted, not yet signed off.** Nothing here is in HOMEWORK.md yet.

Source: five captures in Drive → `Statular/`, reviewed after the 5m42s iPhone capture that produced
sections D/E/F. The sixth file (`ScreenRecording_08-06-2026 01-09-42_1.MP4`) was already reviewed and
was skipped.

**Basis for this document.** Per the settled position recorded in HOMEWORK.md on 2026-08-06, UI and
feature observation "was never implicated" and is ordinary product analysis: describe a screen,
decide whether we want an equivalent, build our own. That is all this document is.

Nothing here draws on Statular's estate planning **documents**, which are a different source with
single-matter language on their face and are evaluation material rather than a template source. What
is recorded below is screens, controls and behaviour, written in our own words. Clause *titles* are
named only as evidence of what subject matter their library covers — not as text to reuse.

---

## 1 · C1 — the clause library decision

**No count is recommended, because no count is derivable from this evidence.** What follows records
what was observed, proposes a test for whether a clause is worth having, and proposes the audit that
would actually settle C1.

> **Struck 2026-08-06, on Adam's challenge.** An earlier draft of this section recommended
> "curate ~60" and rested that on Statular shipping 57 with a firm-authored folder reading 0. That
> reasoning was wrong and has been removed. 57 is not a gold standard — it is equally consistent with
> an early-stage tool, and an empty firm folder is equally consistent with a firm that has not got
> round to it. Neither observation says anything about whether a *particular clause* is worth having.
> The count was never the question.

### What was observed

`statular.com/app/clauses`, live production account, 2026-08-06 (frames at t=19m44s, 19m50s).

| Observation | Value |
|---|---|
| Total clauses | **57** |
| Folder `Statular Clauses` (vendor-authored) | **57** |
| Folder `My Clauses` (firm-authored) | **0** |
| Folder `Unfiled` | 0 |
| State filter | present, set to "All states"; individual clauses carry an `NJ` chip |
| Author attribution | every clause shows `Statular` |
| Date on every clause | Mar 18, 2026 — a single authored batch, not organic growth |
| Affordance | `+ New Clause` |

Tag counts, which sum to exactly 57:

| Tag | Count |
|---|---|
| Trust Administration | 16 |
| Powers | 11 |
| Distribution | 10 |
| Tax | 8 |
| Healthcare | 4 |
| Family | 4 |
| Miscellaneous | 2 |
| Administrative | 2 |

### The composition, which matters more than the count

The 57 split into two populations:

1. **NJ statutory edge-case savers**, each anchored to a citation — elective share, standby
   guardianship activation, the definition of "child" under intestacy, NJ transfer tax
   apportionment, fiduciary access to digital assets. These exist to stop a specific
   New Jersey statute producing a bad result.
2. **General trust-drafting boilerplate** — trustee power to purchase life insurance, power to
   operate a business, charitable distribution discretion, distributions to minors and incapacitated
   beneficiaries, mandatory marital-trust income distribution, tangible personal property
   memorandum, a broad definition of "education".

Placeholders are bracketed capitals (`[SETTLOR NAME]`, `[SURVIVING SPOUSE]`, `[NAME]`).

### What the observation is actually good for

Not a target number. The one durable thing here is that a clause library contains **two populations
with completely different value profiles**, and lumping them together is what makes counts
meaningless:

- **Statutory savers.** Each exists because a specific statute produces a bad result if you say
  nothing. Its value is legible: name the failure mode, cite the provision.
- **Drafting boilerplate.** Trustee powers, definitional clauses, discretionary standards. Real
  drafting content, but the base template should already carry most of it, and where it does, a
  library entry is duplication rather than coverage.

A library of 200 boilerplate variants and one of 40 statutory savers can have the same headline
count and completely different worth. **That is why C1 cannot be answered by counting, from either
direction — ours or theirs.**

### A test for whether a clause earns its place

Proposed, to be argued with. A clause is worth carrying when it meets **all five**:

1. **Nameable failure mode.** You can state in one sentence what goes wrong in a real matter if the
   clause is absent. If you cannot, it is decoration.
2. **Anchored.** It cites a controlling statute or rule, or encodes a settled drafting convention.
   Anchoring is not decoration either — it is what makes the clause **maintainable**: when the
   statute moves, you know exactly which clauses to revisit. An unanchored clause silently rots.
3. **Reusable.** It applies across matters of a type, not to the one matter it was mined from.
4. **Non-obvious under time pressure.** A competent attorney would not reliably reproduce it from
   scratch at 6pm. Clauses that fail this are better as template defaults than as library entries.
5. **Not already in the template.** Otherwise it is a duplicate maintenance surface.

Criterion 2 is the one that matters most and the one our mined corpus is least likely to satisfy,
because mining recovers *text* and not *citations*. That is a specific, checkable worry rather than a
general one.

### What we can already test, using data we hold and they do not

We have something Statular's library structurally cannot have: **usage evidence from a real
practice's own archive.** The last catalog run recorded
`302 families / 1,394 variants / 3,965 occurrences`, plus `seedMatched=85`.

Two signals fall straight out of that, at no new cost:

- **Occurrence frequency is a reuse signal.** A family appearing across dozens of matters has
  demonstrated criterion 3 empirically. A family with one occurrence is matter-specific text that
  survived extraction, and is exactly what criterion 3 is meant to exclude. The distribution across
  those 3,965 occurrences is the first thing to look at, and nobody has looked at it.
- **`seedMatched=85` is an expert-curation signal.** Those families matched the hand-curated
  AAA WILL PIECES set — a human already judged that material worth keeping, before we mined anything.
  That is 85 families carrying independent evidence of value.

Neither number has been examined. That is the gap, not the total.

### The correction this forces on the PII question

An earlier draft claimed the PII over-aggression tuning "likely does not need doing at all." **That
followed from the struck argument and is withdrawn.**

Whether the tuning is warranted now depends on something nobody has measured: **do the 276 blocked
families carry disproportionate value?** Blocked families were written text-free, so their metadata —
including occurrence counts — survives and is inspectable **without unblocking anything**. If the
blocked set skews toward high-occurrence, seed-matched families, tuning is important and the value is
trapped. If it skews toward one-occurrence families, tuning is cleanup. It is an empirical question
with a cheap answer, and it should be answered before it is decided.

**None of this touches the PII gate itself.** Per HOMEWORK.md, `piiBlocked=276` is a confidentiality
control, not a licensing one: those are real client documents and one client's name must not surface
in another client's will. Nothing above is an argument for loosening it — only for *measuring what is
behind it*.

### The audit that would settle C1

Cheap, and it produces a defensible number rather than an asserted one:

1. Pull the occurrence-frequency distribution across all 302 families, and cross-tabulate it against
   `piiBlocked` and `seedMatched`. **No text required** — metadata only. This alone may reframe the
   question.
2. Take a stratified sample — say 30 families spanning high/medium/low occurrence — and score each
   against the five criteria.
3. Extrapolate. The output is not "curate N"; it is *what fraction of the corpus is statutory saver,
   what fraction is boilerplate duplication, and what fraction is matter-specific noise.* The number
   falls out of that, and can be defended.

Step 1 is metadata-only and could be done in an afternoon. **Recommend doing step 1 before deciding
C1 at all** — it is the cheapest thing on the list and it is upstream of the decision it would inform.

**C1 remains open. This section no longer recommends a number, and should not be read as doing so.**

---

## 2 · The three previously-uncaptured gaps

### Gap: the Drafting Assistant on a real prompt — CLOSED

`statular.com/app/chat/<uuid>` (t=19m20s–19m26s).

It is a **general chat assistant sitting beside the product, not an agent inside a matter.**
Conversations are free-standing and carry no matter context. The sidebar showed unrelated research
threads on life estates and California holographic wills. Conversations are auto-titled from their
own content after the first exchange.

Asked which AI model powers it, it declined to say and redirected to Statular support. They
deliberately do not disclose the provider.

**Read:** this is weaker than the name implies. It is not grounded in the client's data, so it cannot
do the thing that would actually be hard to match.

### Gap: a generated Flowchart's output — MECHANISM FOUND, output still uncaptured

`statular.com/app/flowcharts` (t=19m32s–19m38s). Adam's account has none, so still no example output.

The mechanism is the finding, and it runs **backwards** from what we assumed: `Create Flowchart`
opens a dialog that asks you to **upload an existing trust document (`.docx` or `.pdf`)** and
generates a visualisation from it. List columns are Document Name / Status / Created By /
Created Date / Actions.

**Read:** it reverse-engineers a finished document. It does **not** visualise the plan being
assembled from interview data. Generating the chart forward from structured intake — which is the
data we already hold — is an opening, not a catch-up.

### Gap: the Document Selection page a matter flows through — CLOSED

Found in `New Matter.mp4` at t=52s, `/app/matters/7476/interview/...?pg=1`.

**It is not a separate page. It is page 1 of a 12-page interview wizard**, and the selections made on
it determine which of the remaining 11 pages exist. The left NAVIGATION rail is the whole interview:
Document Selection · Family Information · Contacts · Guardian Designations · PoA Provisions ·
Power of Attorney · Advance Directive · Dementia Directive · Healthcare Forms · Post-Death Choices ·
Deeds · Signing Information. Tick "Dementia Directive" as a sub-option and a Dementia Directive page
appears in the rail; the deeds page likewise.

**This is the architectural finding of the pass.** Document selection is not a picker that feeds a
generator — it is the thing that *composes the intake itself*. One page determines the shape of
everything after it.

Page 1 groups documents under **CORE DOCUMENTS** and **ANCILLARY DOCUMENTS**. Each document is a
checkbox with a one-line plain-English purpose, and ticking it reveals nested sub-options.

Three patterns worth taking:

1. **Jurisdiction-aware disabling that explains itself.** For a New Jersey matter, "Short-Form Power
   of Attorney" and "Include both forms" are greyed out, with the reason stated inline: no statutory
   POA form exists for New Jersey, so the long form will be used. The control does not merely
   disable — it teaches why. We currently have jurisdiction logic buried in generators where the user
   never sees it.
2. **Document titling is an explicit user choice that propagates.** The long-form POA title
   (Power of Attorney vs Durable Power of Attorney) and the healthcare directive title (state
   default, or one of five named variants, or free text) are chosen once and, per the field's own
   help text, flow through to the generated document, the cover letter, the signing guide and the
   summary. One setting, consistent across every derived artefact.
3. **Nested sub-options appear only when the parent is ticked** — which confirms D7 from the prior
   pass, now observed in the document-selection context rather than in settings.

Every field on the page carries both a help affordance and a **flag-for-review** affordance.

What was captured separately is the **catalog** behind the selection (t=20m04s): filtered to
New Jersey + Estate Planning it returns **53 items**, split into packages and single documents, with
`Joint` badges and an individual-vs-joint distinction.

Three behaviours worth copying outright:

- **A package is not a mandate.** Choosing one does not commit you to generating everything in it;
  the interview lets you omit documents. The list is what a package *can* include.
- **Documents are re-orderable after generation**, by drag, to match the firm's assembly or signing
  order.
- **Some documents silently bundle others** — e.g. a deed carries the state- or county-specific
  transfer form as its last page, without appearing as a separate catalog entry.

Expected to appear in `Drafting Will Package (Individual).mp4`; not yet reviewed.

---

## 3 · Features observed that we do not have

| Feature | Mechanics observed | Note |
|---|---|---|
| **Deed pulling** | Per-property "request deed pull" on each Real Property asset; Assets tab shows a pending-request count; explicit, explained failure when a deed is unobtainable (pre-1980s not digitised, address mismatch, recorder offline) | Nearest thing we have is `property-data.ts` |
| **Trust accounting** | Court-style schedules (property on hand at beginning/end, receipts and disbursements split principal/income, proposed distributions, notes). **A period cannot close unless the reconciliation balances.** Closed periods are immutable; reopening warns that an amended accounting may be required. Full audit trail, amounts to the cent, per-sub-trust or combined views for A/B/C splits | The hardest item here to build and the most defensible once built |
| **Community forum** | In-product, real firms posting under firm names, Statular Team posting product updates, likes and comment counts, tagging | Support deflection plus a moat. Posters observed were overwhelmingly California |
| **Smart Import (AI intake from files and text)** | Plus cross-package matter conversion on an explicitly "best-effort" basis, with named preconditions (same client, interview saved, compatible package) | Honest about lossiness — worth imitating |
| **Combine & Download** | Whole package merged into a single Word file, alongside individual download and ZIP | Small and obvious |
| **PNC (Potential New Client)** | Auto-created when a prospect completes a public intake questionnaire; the questionnaire auto-attaches to the new record | Clean top-of-funnel |
| **Portal access as status, not deletion** | Six client statuses map to allowed/blocked portal access. Blocked clients can still sign in and see an explanation rather than an error. Nothing is deleted — access is paused | Better failure mode than ours |
| **Send Test on client emails** | Test send goes to the operator's own inbox, never the client, with a stated checklist of what to verify | |
| **Document Suggestions** | Post-generation analysis in four classes: spelling inconsistency, missing information, formatting, and *legal considerations* | The fourth class is the interesting one |

---

## 4 · Weaknesses observed

- **Code Search recall looks poor.** A query for "No Contest Clause" returned Internal Revenue Code
  hits on first-year elections, valuing farms, pooled income funds and qualified plan annuity
  contracts — nothing on in terrorem clauses. Their own guide calls the feature
  "California Code Search".
- **The Drafting Assistant is not matter-grounded** (above).
- **Flowcharts only run backwards from a finished document** (above).
- **Manual Word edits do not survive regeneration.** Their guide is explicit that regenerated
  documents come from interview data and that edits made outside the product will not flow back,
  and it prescribes a manual download/track-changes/PDF discipline to work around it.

**Strategic read, offered to be argued with:** the clause library is NJ-tagged, but the forum
community and the code search are California. Statular looks California-first with New Jersey
coverage added. New Jersey depth is our wedge — and the bar for it is roughly 60 well-cited clauses,
not 302 mined ones.

---

## 5 · The matter lifecycle

From `New Matter.mp4` (59s) and `Matter Dashboard.mp4` (2m14s).

### Creating a matter

A single modal: Client (with an inline "don't see your client? create one" escape hatch),
Preparing Attorney, State, Practice Area, Matter type. One checkbox — email a client questionnaire —
which stays **disabled with an explanatory hint** until a matter type is chosen. Same
teach-don't-just-disable pattern as the document selection page.

The clients list shows child and asset counts as **repeated glyphs rather than numbers**
("+1 more" past a threshold), which reads faster than a count column at a glance.

### The matter workspace

Tabs: General · Import · Client · Billing · Notes (badged with a count) · History. A status chip
tracks the matter through at least `CREATED` → `GENERATED`. The attorney of record is changeable
inline from the header.

**A default task checklist is seeded on matter creation**, grouped by phase — DRAFTING, SIGNING,
POST-SIGNING — with a progress meter, and a `Configure default checklist` link to edit the firm-level
template. The seeded tasks are real practice steps (review drafts against the client's wishes,
schedule the review meeting, schedule signing, confirm date and time with notary and witnesses, scan
and upload executed copies). This is process knowledge shipped as defaults.

### Generated documents — the richest screen observed

- **Version selector** (`Version 1 (created ...)`) over the whole document set.
- A **Highlighting toggle**, which appears to mark provenance within the generated text.
- An aggregate **suggestion count** for the version, plus **per-document dot indicators** so you can
  see which documents carry the issues without opening them.
- Per-row: drag handle to reorder, download, preview, and a format chip.
- **Mixed output formats by document nature** — drafted instruments render DOCX, while the statutory
  NJ funeral-agent appointment renders **PDF**. Form-shaped output stays a form.
- **Combine & Download** alongside Download All.
- Auto-generated orientation documents ship with every package: Cover Page, Cover Letter, Summary of
  Estate Plan, Summary of Client Information, Summary of Designations.

### Client questionnaire, from the matter side

The control changes state with the workflow: *Send Questionnaire via Email* / status Not Sent
becomes **Review & Sync** / status Sent, with a Re-Email affordance. Inbound client answers are
reviewed and synced into the interview rather than silently overwriting it.

### Billing

A per-matter invoice with line items (description plus a narrative sub-description), quantity,
subtotal, and negative lines for deposits received. A rich-text **Invoice Message**. A
`Configure default invoice items` link to the firm-level template — same shipped-defaults pattern as
the task checklist.

The invoice generates as **.docx** and previews **inside an embedded Microsoft Word Online session**
("Edit a Copy", Accessibility Mode). Filenames are timestamp-prefixed:
`20260806_123350_Invoice_John_Smith_7477`.

**The embedded Word Online preview is worth flagging on its own.** It means in-browser preview and
editing of generated documents without building a viewer or an editor. We currently render our own.

### History

A per-matter audit trail in plain language with relative timestamps, recording matter creation,
document generation by version, combined downloads, questionnaires sent, **custom emails sent
distinctly from questionnaires**, and notes added.

---

## 6 · The client-facing questionnaire

From `Client Questionnaire.mp4` (2m32s). Served at `statular.com/questionnaire/<long token>` — a
**tokenised public link with no login**, which answers the question a firm asked on their own forum.

Chrome: firm name, address, email and phone in the left rail (white-labelled, not Statular-branded);
a persistent "all data is securely transmitted and encrypted" banner with a link to the security
policy; an autosave stamp; a **language selector**; a progress bar; Previous/Next.

Sections: Introduction · Family Information · Fiduciaries · Assets · Distribution · Health Care ·
End-of-life Wishes · Additional Questions · Review & Submit.

### Field-level patterns worth taking

- **"Clear selection" under every radio group.** Radios normally cannot be unset once touched. They
  fixed it everywhere, and the same link appears in the attorney interview.
- **Per-field revert control** (a small undo affordance beside date inputs).
- **Address autocomplete that decomposes into street / city / state / ZIP / county.** Capturing
  **county** at intake matters for NJ deed work and we should not be inferring it later.
- **Marital status with six options**, including registered domestic partnership and unmarried
  partnership, and "not currently married (divorce, annulment, etc.)" as distinct from widowed.
- **Placeholders are worked examples, not hints.** Asset value shows `10,000`; an account note shows
  a fully written sentence naming a bank and masked account digits. Every free-text field models the
  answer rather than describing it.

### Assets

Categorised (bank, investment, retirement, …), each with plain-English guidance, an empty state, and
a per-category **Add Asset**. The modal takes name, estimated current value, **supporting document
upload** ("upload a copy of your bank statement"), and free-text additional information.

**Client-side document upload attached to a specific asset** is the notable one — the statement
arrives bound to the account it evidences, not into a general file dump.

### Distribution — the three-tier contingency ladder

Asked of the *client*, in plain English, as three separate questions:

1. Specific gifts.
2. The remainder, with staged ages modelled in the placeholder (half at 25, half at 35).
3. **Backup takers** if a preferred beneficiary cannot receive.
4. **Last-resort preference** if the backups also fail — explicitly offering a class ("all my nieces
   and nephews"), named people, or charities.

This maps directly onto our residue and allocation model (#210) and is the clearest evidence yet
that the ladder is worth asking at intake rather than deriving at draft time.

### An observed defect

The custom email received in the client's inbox rendered as `John SmithDear John Smith,` and
`John SmithJohn Smith` — a template variable concatenated ahead of the salutation and signature.
Their custom-email merge has a real bug. Worth knowing that the polish is not uniform.

---

## 7 · Drafting a will package, and the review engine

From `Drafting Will Package (Individual).mp4` (7m45s). Route: clients → client → matter → interview
pages 1–15 → generated files.

### Confirmed: the interview is composed by document selection

The Advance Directives package produced a **12-page** interview. The will package produces a
**15-page** one, adding **Executors**, **Distribution** and **Will Provisions**. Same page 1, longer
tail. Page count is a function of what was selected, not a fixed wizard.

### Clause Library and Draft with AI sit on individual fields

Confirmed on the Advance Directive page (7 of 15): free-text questions such as "any restrictions on
anatomical gifts?" and "other healthcare wishes" each carry a **Clause Library** link and a
**Draft with AI** button, plus a "what is this?" explainer. This is the pattern noted at HOMEWORK
line 595, now seen in situ — assistance is offered **per field at the point of drafting**, not as a
separate mode.

Health-care questions are checkbox-with-question-prose ("does the client wish to die at home if
possible, rather than in a hospital or nursing home?"), and anatomical gifts offers a
**defer-to-agent-or-registry** middle option rather than a binary.

### Analysis & Review — the strongest thing observed in the whole pass

After generation an async check runs ("checking document…"), then an **Analysis & Review** panel
opens, versioned `v1`, filterable by document, with a suggestion count. Columns, all sortable:
**Document · Location · Priority · Reason · Explanation**, each row individually **dismissible**.

Locations are section-precise: `Signature`, `Signing Block`, `Section 1.05(b)`, `Section 2.02(c)`,
`Section 5.02`. The reason taxonomy observed: **Missing Location · Inconsistency ·
Legal Best Practice · Other**.

The findings themselves are the point. Four classes were observed working:

1. **Unfilled placeholders in rendered output.** It caught an execution line reading "in , New
   Jersey" with the municipality blank, and separately caught a literal `[SIGNING CITY]` placeholder
   surviving into three different documents.
2. **Cross-party inconsistency.** One individual was listed without a relationship descriptor while
   another was identified as "my spouse", in two separate sections of the same document.
3. **Statutory conflict, with citation.** It flagged that a will authorised UTMA custodianship until
   age 25 while New Jersey's Uniform Transfers to Minors Act caps termination at 21, cited the
   statute section, and concluded the provision may be unenforceable.
4. **Logical dead-ends across cross-referenced provisions.** It flagged that a guardianship clause
   disqualifies a named guardian on marriage and directs that guardianship "shall pass to the next
   nominated successor guardian as set forth above" — while that person is *last* in the list, so
   the provision appoints no one if both named guardians are unavailable.

**Read.** (1) and (2) are template-hygiene checks we could build quickly and should. (3) is a
jurisdiction rules engine — this is the same territory as our NJ apportionment work in PR #280 and is
the one place their product is clearly ahead on legal substance. (4) is the hardest: it requires
reasoning over the document's own internal references, not over the intake data.

This is the direct competitor to our package review engine and findings panel from PR #280. It should
be the benchmark we measure that work against, and the four classes above are a ready-made test set.

---

## 8 · Method, for the next session

The prior session's pipeline notes are partly **out of date**:

- `yt-dlp` downloads Drive files directly and needs no virus-scan interstitial handling —
  `yt-dlp -o NAME "https://drive.google.com/file/d/<ID>/view"`. Simpler than the documented curl
  dance. (The Drive **connector** still caps at 10 MB; that part stands.)
- `apt-get install ffmpeg` **does work**, provided `apt-get update` runs first. The
  `imageio-ffmpeg` workaround is no longer needed.
- **These captures are desktop, not iPhone**: h264 / yuv420p / 2560x1036. The HDR tonemapping
  filter is unnecessary for them. It is still required for phone captures.

**New technique worth keeping — the URL contact sheet.** Before spending context on full frames,
crop the browser tab-and-URL strip from a frame every 15s and tile them:

```bash
ffmpeg -i VIDEO.mp4 -vf "fps=1/15,crop=1700:62:60:0,scale=1150:-1,tile=1x14" -q:v 3 idx_%02d.jpg
```

Six small images indexed all 20 minutes by URL, which is what revealed that the last three minutes
were live product UI covering two of the three open gaps. Reading full frames blind would have cost
several times the context and might have missed it.

**Sanity note that still applies:** `Full User Experience.mp4` is 60%+ a scroll through Statular's own
User Guide, not a product walkthrough. Do not assume a long capture is a long demo.
