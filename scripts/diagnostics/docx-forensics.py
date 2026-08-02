#!/usr/bin/env python3
"""
docx_forensics.py — recover a document-assembly engine's behavior from its output.

Two subcommands:

  inspect <paths...>          Fingerprint each .docx/.pdf: what tool built it, what
                              templating traces survive, what structure it uses.

  diff <a.docx> <b.docx>      Clause-level diff of two generated packages. Run the
                              same questionnaire twice with one answer changed and
                              this shows you exactly which prose that answer controls.

Stdlib only. No install step.
"""

import argparse
import json
import os
import re
import sys
import zipfile
from difflib import SequenceMatcher
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Traces that identify the generating engine. Ordered most-specific first.
ENGINE_SIGNATURES = [
    ("HotDocs", [r"HotDocs"]),
    ("Contract Express", [r"ContractExpress", r"Contract Express"]),
    ("Documate/Gavel", [r"documate", r"gavel\.io"]),
    ("XpressDox", [r"XpressDox"]),
    ("docassemble (docxtpl/python-docx)", [r"python-docx", r"docxtpl", r"docassemble"]),
    ("docxtemplater (JS)", [r"docxtemplater"]),
    ("docx (npm, dolanmiu)", [r"dolanmiu", r"docx\.js"]),
    ("Aspose.Words", [r"Aspose"]),
    ("Syncfusion DocIO", [r"Syncfusion"]),
    ("OpenXML SDK (.NET)", [r"Open XML Power Tools", r"DocumentFormat\.OpenXml"]),
    ("LibreOffice / OpenOffice", [r"LibreOffice", r"OpenOffice"]),
    ("Google Docs export", [r"Google Docs", r"Skia/PDF"]),
    ("Microsoft Word (human-authored or Word automation)", [r"Microsoft Office Word", r"Microsoft Word"]),
    ("Pages", [r"Pages\b"]),
]

PDF_PRODUCERS = [
    ("Puppeteer / headless Chromium", [r"Skia/PDF", r"Chromium", r"HeadlessChrome"]),
    ("jsPDF", [r"jsPDF"]),
    ("PDFKit", [r"PDFKit"]),
    ("wkhtmltopdf", [r"wkhtmltopdf", r"Qt\s"]),
    ("Prince", [r"Prince"]),
    ("ReportLab", [r"ReportLab"]),
    ("LaTeX", [r"pdfTeX", r"XeTeX", r"LuaTeX"]),
    ("Word/Office export", [r"Microsoft.*Word", r"Acrobat Distiller"]),
    ("LibreOffice export", [r"LibreOffice"]),
]


def _read(zf, name):
    try:
        return zf.read(name).decode("utf-8", "replace")
    except KeyError:
        return ""


def _match_engine(haystack, table):
    hits = []
    for label, patterns in table:
        for p in patterns:
            if re.search(p, haystack, re.I):
                hits.append(label)
                break
    return hits


def paragraphs(document_xml):
    """Plain-text paragraphs, in order. The unit we diff on."""
    if not document_xml:
        return []
    try:
        root = ET.fromstring(document_xml)
    except ET.ParseError:
        return []
    out = []
    for p in root.iter(f"{W}p"):
        text = "".join(t.text or "" for t in p.iter(f"{W}t"))
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out.append(text)
    return out


def inspect_docx(path):
    rep = {"file": os.path.basename(path), "type": "docx"}
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        app = _read(zf, "docProps/app.xml")
        core = _read(zf, "docProps/core.xml")
        custom = _read(zf, "docProps/custom.xml")
        settings = _read(zf, "word/settings.xml")
        document = _read(zf, "word/document.xml")

        def tag(xml, name):
            m = re.search(rf"<[^>]*{name}[^>]*>([^<]*)</[^>]*{name}>", xml)
            return m.group(1).strip() if m else None

        rep["application"] = tag(app, "Application")
        rep["app_version"] = tag(app, "AppVersion")
        rep["company"] = tag(app, "Company")
        rep["template"] = tag(app, "Template")
        rep["total_edit_time_min"] = tag(app, "TotalTime")
        rep["created"] = tag(core, "created")
        rep["modified"] = tag(core, "modified")
        rep["creator"] = tag(core, "creator")
        rep["last_modified_by"] = tag(core, "lastModifiedBy")
        rep["revision"] = tag(core, "revision")

        rep["engine_guess"] = _match_engine(
            " ".join([app, core, custom, settings]), ENGINE_SIGNATURES
        ) or ["unknown — no engine trace in metadata"]

        # Templating machinery that survived into the output.
        field_codes = re.findall(r"<w:instrText[^>]*>([^<]+)</w:instrText>", document)
        joined_fields = " ".join(field_codes)
        rep["structure"] = {
            "paragraphs": len(paragraphs(document)),
            "content_controls_sdt": document.count("<w:sdt>"),
            "bookmarks": len(re.findall(r"<w:bookmarkStart", document)),
            "field_codes": len(field_codes),
            "mergefields": len(re.findall(r"MERGEFIELD", joined_fields, re.I)),
            "docvariables": len(re.findall(r"DOCVARIABLE", joined_fields, re.I)),
            "if_fields": len(re.findall(r"\bIF\b", joined_fields)),
            "ref_fields": len(re.findall(r"\bREF\b", joined_fields)),
            "revision_save_ids": len(re.findall(r"<w:rsid ", settings)),
            "tracked_changes": len(re.findall(r"<w:(ins|del) ", document)),
            "comments": 1 if "word/comments.xml" in names else 0,
            "embedded_parts": [n for n in names if n.startswith("word/embeddings/")],
        }

        # Leftover placeholder syntax — the single loudest tell.
        leaked = set()
        for pat in [r"\{\{[^}]{1,60}\}\}", r"\{%[^%]{1,60}%\}", r"\[\[[^\]]{1,60}\]\]",
                    r"«[^»]{1,60}»", r"\$\{[^}]{1,60}\}"]:
            for m in re.findall(pat, " ".join(paragraphs(document))):
                leaked.add(m)
        rep["leaked_placeholders"] = sorted(leaked)[:40]

        rep["parts"] = len(names)
    return rep


def inspect_pdf(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    head = blob[:4096].decode("latin-1", "replace")
    tail = blob[-8192:].decode("latin-1", "replace")

    def field(name):
        m = re.search(rf"/{name}\s*\(([^)]{{0,200}})\)", blob.decode("latin-1", "replace"))
        return m.group(1) if m else None

    return {
        "file": os.path.basename(path),
        "type": "pdf",
        "version": head[:8].strip(),
        "producer": field("Producer"),
        "creator": field("Creator"),
        "creation_date": field("CreationDate"),
        "engine_guess": _match_engine(
            " ".join(filter(None, [field("Producer"), field("Creator")])) or "",
            PDF_PRODUCERS,
        ) or ["unknown"],
        "has_acroform": "/AcroForm" in tail or "/AcroForm" in head,
        "tagged": "/MarkInfo" in blob.decode("latin-1", "replace")[:200000],
    }


def cmd_inspect(args):
    reports = []
    for path in args.paths:
        try:
            if path.lower().endswith(".pdf"):
                reports.append(inspect_pdf(path))
            else:
                reports.append(inspect_docx(path))
        except Exception as exc:  # noqa: BLE001 — report, don't abort the batch
            reports.append({"file": os.path.basename(path), "error": str(exc)})

    if args.json:
        print(json.dumps(reports, indent=2))
        return

    for r in reports:
        print("=" * 72)
        print(r["file"])
        print("=" * 72)
        if "error" in r:
            print(f"  ERROR: {r['error']}\n")
            continue
        print(f"  engine guess     : {', '.join(r['engine_guess'])}")
        if r["type"] == "docx":
            for k in ("application", "app_version", "company", "template", "creator",
                      "last_modified_by", "created", "modified", "revision",
                      "total_edit_time_min"):
                if r.get(k):
                    print(f"  {k:<17}: {r[k]}")
            s = r["structure"]
            print("  --- templating traces ---")
            for k, v in s.items():
                if v:
                    print(f"  {k:<17}: {v}")
            if r["leaked_placeholders"]:
                print(f"  LEAKED PLACEHOLDERS: {r['leaked_placeholders']}")
        else:
            for k in ("version", "producer", "creator", "creation_date",
                      "has_acroform", "tagged"):
                if r.get(k) is not None:
                    print(f"  {k:<17}: {r[k]}")
        print()


def cmd_diff(args):
    a = paragraphs(zipfile.ZipFile(args.a).read("word/document.xml").decode("utf-8", "replace"))
    b = paragraphs(zipfile.ZipFile(args.b).read("word/document.xml").decode("utf-8", "replace"))

    sm = SequenceMatcher(None, a, b, autojunk=False)
    ratio = sm.ratio()
    print(f"A: {os.path.basename(args.a)}  ({len(a)} paragraphs)")
    print(f"B: {os.path.basename(args.b)}  ({len(b)} paragraphs)")
    print(f"similarity: {ratio:.1%}  —  {(1-ratio)*100:.1f}% of the prose is input-dependent\n")

    only_a, only_b, changed = [], [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "delete":
            only_a.extend(a[i1:i2])
        elif op == "insert":
            only_b.extend(b[j1:j2])
        elif op == "replace":
            changed.append((a[i1:i2], b[j1:j2]))

    def show(title, items, limit):
        if not items:
            return
        print(f"--- {title} ({len(items)}) ---")
        for x in items[:limit]:
            print(f"  · {x[:args.width]}")
        if len(items) > limit:
            print(f"  … {len(items)-limit} more")
        print()

    show("CLAUSES ONLY IN A  (switched OFF by B's answers)", only_a, args.limit)
    show("CLAUSES ONLY IN B  (switched ON by B's answers)", only_b, args.limit)

    if changed:
        print(f"--- REWRITTEN BLOCKS ({len(changed)}) ---")
        for old, new in changed[:args.limit]:
            print(f"  A: {' '.join(old)[:args.width]}")
            print(f"  B: {' '.join(new)[:args.width]}")
            print()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("inspect", help="fingerprint generated documents")
    i.add_argument("paths", nargs="+")
    i.add_argument("--json", action="store_true")
    i.set_defaults(func=cmd_inspect)

    d = sub.add_parser("diff", help="clause-level diff of two generated packages")
    d.add_argument("a")
    d.add_argument("b")
    d.add_argument("--limit", type=int, default=25, help="max clauses shown per bucket")
    d.add_argument("--width", type=int, default=160, help="max chars per clause")
    d.set_defaults(func=cmd_diff)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    # Reports run long and are routinely piped to head/less. Without this,
    # closing the pipe early raises BrokenPipeError out of print().
    try:
        main()
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
    except KeyboardInterrupt:
        sys.exit(130)
