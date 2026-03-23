---
description: Add a new formatting preset from sample documents (e.g., BeyondCounsel, WealthCounsel)
---
// turbo-all

## Add Formatting Preset from Sample Documents

Follow these steps when the user provides sample `.docx` files from a new software source and wants to create a formatting preset for it.

### 1. Organize samples

Move/copy the sample `.docx` files into a subfolder under `samples/`:
```
samples/<source-name>/   (e.g., samples/beyondcounsel/)
```

### 2. Analyze formatting

Run the Python extraction script on each sample to extract paragraph styles, fonts, spacing, and indentation:
```
python tmp/extract_docx_formatting.py "samples/<source-name>/<filename>.docx"
```
Review the `_formatting.json` and `_content.txt` outputs. Document findings in a `document_formatting_analysis.md` artifact covering:
- Paragraph style names and their formatting properties
- Heading hierarchy (e.g., Article I → A. → 1. vs Section 1.01 → (a))
- Signature block layout (indentation, line style)
- Affidavit/notary block structure
- Font, size, spacing conventions

### 3. Choose a class prefix

Pick a short, unique CSS class prefix for this source. Convention:
- InteractiveLegal → `tr-` 
- BeyondCounsel → `bc-`
- WealthCounsel → `wc-`

### 4. Define the backend preset

Edit `functions/src/config/formatting-presets.ts`:

1. Create a `const <SOURCE>_PROMPT_BLOCK` string with the full paragraph class instructions (follow the same format as `INTERACTIVELEGAL_PROMPT_BLOCK`)
2. Add a new entry to the `FORMATTING_PRESETS` array:
```typescript
{
  value: '<source-value>',     // must match SOFTWARE_SOURCES value
  label: '<Source Label>',
  classPrefix: '<prefix>',
  promptBlock: <SOURCE>_PROMPT_BLOCK,
},
```

### 5. Add DOCX export styles

Edit `functions/src/export-docx.ts`:

1. Add entries to `TR_STYLE_MAP` for each new `<prefix>-*` class with the correct alignment, indentation, spacing, bold, underline, allCaps, and fontSize values
2. Add corresponding named paragraph styles to the `paragraphStyles` array in `buildDocxDocument()`

### 6. Add PDF export styles

Edit `functions/src/export-pdf.ts`:

Add CSS rules for each new `<prefix>-*` class to the `buildLegalDocumentHtml()` `<style>` block, matching the DOCX formatting.

### 7. Add frontend dropdown option

Edit `src/config/formatting-presets.ts`:

Add a new entry to `FORMATTING_PRESET_OPTIONS`:
```typescript
{ value: '<source-value>', label: '<Source Label>' },
```

### 8. Verify

1. `cd functions && npx tsc --noEmit`
2. `npm test` (from project root)
3. `npm run build`

### 9. Deploy

Run the `/deploy` workflow to commit, push, build, and deploy all changes.

### 10. Manual test

Generate a document using the new formatting preset:
1. Navigate to a client → Generate Documents
2. Set Template Source to the new source (or any source)
3. Set Document Formatting to the new preset
4. Generate → export as DOCX → verify formatting in Word
