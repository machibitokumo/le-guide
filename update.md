# Ombyggnad: generate-and-verify-loop

## Bakgrund

Nuvarande pipeline (Gemini 2.5 Flash för OCR + Gemini 3.1 Flash Image Preview för redigering) har inget intelligent valideringssteg. Vi genererar en ny kvittobild och hoppas att den stämmer. När totalen, momsen eller datumet blir fel märks det först när användaren öppnar resultatet.

Den här ombyggnaden ersätter blind generering med en **generate-and-verify-loop** där en domare läser av den genererade bilden och beslutar om den ska godkännas eller skickas tillbaka för korrigering.

## Målarkitektur

Specialiserade roller per modell:

| Roll | Modell | Användning |
|------|--------|------------|
| Vision (OCR + re-OCR) | Qwen-VL | Extraktion av text + bounding boxes, **+ klassificering av dokumenttyp (kvitto vs faktura)**, samt re-OCR av genererad bild |
| Redigeringsplanerare | Qwen reasoning | **Bestämmer hur måltotalen ska uppnås**: lägg till rader, multiplicera kvantiteter, justera enskilda priser, ta bort rader, omfördela VAT mellan rater. För fakturor även: ändra fakturanummer, förfallodatum, kund, OCR-nr, ref. |
| Bildgenerering | Gemini 3 Pro Image Preview (Nano Banana Pro) | Surgisk redigering enligt planen |
| Domare | GPT-5.5 | Jämför `target.md` mot re-OCR av genererad bild, beslutar PASS eller skriver specifik korrigeringsprompt |

### Loop

```
1. Användare laddar upp dokument (kvitto eller faktura)
2. Qwen-VL OCR + classify   →  { docType: "kvitto" | "faktura", items, fields }  →  temp.md
3. Användare anger mål        (kvitto: ny total, datum, tid; faktura: ny total, fakturanr, förfallodatum, ev. kund/ref)
4. Qwen reasoning planerar  →  plan.json + target.md
                                (operationer: ADD_ITEM / MODIFY_ITEM / DELETE_ITEM / MULTIPLY_QTY /
                                 SET_FIELD för fakturafält + ny VAT-fördelning)
5. Gemini Nano Banana Pro    →  edited.jpg
6. Qwen-VL re-OCR(edited.jpg) →  actual.md
7. GPT-5.5 judge(target.md, actual.md):
     ├─ PASS     →  klart, leverera till användare
     └─ FAIL     →  skriv korrigeringsprompt → tillbaka till steg 5
```

### Dokumenttyper

**Kvitto**: detaljhandel, restaurang. Redigerbara fält:
- `total`, `date`, `time`
- Item-rader (lägg till, ta bort, ändra pris/antal)
- VAT-rader (omfördelning mellan 6/12/25 %)
- Identifierare (kvittonr, hex-strängar, AID, streckkoder) — randomiseras alltid

**Faktura**: B2B/B2C-faktura. Redigerbara fält (utöver kvittots):
- `invoice_number`, `due_date`, `invoice_date`, `payment_reference` (OCR-nr / KID)
- Kund-block (`customer_name`, `customer_org_nr`, `customer_address`)
- Säljarens info skyddas (org-nr, bankgiro, plusgiro) — randomiseras inte
- Item-rader har beskrivning + a-pris + antal + radsumma (alla fyra länkade — ändring av en kräver omräkning av övriga)

Qwen-VL klassificerar dokumentet i steg 2 utifrån heuristik: faktura har explicit "Faktura"/"Invoice"-rubrik, fakturanr, förfallodatum, kund-block; kvitto har "Kvitto"/butiksnamn-i-topp + endast en transaktion utan referens.

### Plan-format (output från redigeringsplaneraren)

```json
{
  "docType": "kvitto" | "faktura",
  "operations": [
    { "op": "MODIFY_ITEM",  "id": "...", "field": "price",    "newValue": 49.90 },
    { "op": "MULTIPLY_QTY", "id": "...", "factor": 2 },
    { "op": "ADD_ITEM",     "name": "Mjölk 1L", "qty": 1, "unitPrice": 14.90, "vatRate": 12 },
    { "op": "DELETE_ITEM",  "id": "..." },
    { "op": "SET_FIELD",    "field": "due_date", "newValue": "2026-06-15" }
  ],
  "vatBreakdown": [
    { "rate": 25, "net": 100.00, "vat": 25.00, "gross": 125.00 },
    { "rate": 12, "net":  50.00, "vat":  6.00, "gross":  56.00 }
  ],
  "warnings": ["Lade till 1 rad Mjölk för att nå måltotal"]
}
```

Planeraren väljer **minimal förändring**: justera befintligt pris hellre än att lägga till rad, multiplicera kvantitet hellre än att ändra a-pris. Endast när befintliga rader inte räcker till skapas nya. Operationer prioriteras i ordning: `MODIFY_ITEM` (pris) → `MULTIPLY_QTY` → `ADD_ITEM` → `DELETE_ITEM`.

## Filer som påverkas

### Ersätts

- `src/app/api/process-receipt/route.ts` — byt Gemini-anrop mot Qwen-VL + dokumenttyp-klassificering
- `src/app/api/edit-image/route.ts` — byt modell till `gemini-3-pro-image-preview`, planerare + verify-loop
- `src/lib/prompt-engine.ts` — utöka med fakturaprompts + plan-till-prompt-konvertering, behåll OCR-prompten
- `src/lib/silent-ledger.ts` — `reconcile()` blir fallback om planeraren faller

### Nya filer

- `src/lib/qwen-vl.ts` — wrapper för OCR/re-OCR + dokumenttyp-klassificering mot DashScope
- `src/lib/qwen-reason.ts` — **redigeringsplanerare** (lägg till/ändra/multiplicera/ta bort rader + VAT-fördelning + fakturafält). Returnerar `EditPlan`, inte bara VAT.
- `src/lib/judge.ts` — GPT-5.5 domare som returnerar `{ verdict: "PASS" | "FAIL", correction?: string }`
- `src/lib/verify-loop.ts` — orkestrerar generate→re-OCR→judge→retry
- `src/lib/document-types.ts` — typer för `DocType`, `EditPlan`, `EditOperation`, fält-schemas per dokumenttyp

### Behålls oförändrat

- `src/lib/pdf-to-image.ts` — PDF→JPEG-konvertering är modelloberoende
- EXIF-pipeline (`cleanImage()`, `injectExif()`) — körs på slutbilden efter PASS
- Supabase activity-logg — utöka med nya event-typer (`reocr`, `judge_pass`, `judge_fail`, `retry`)
- Filvalideringen (HEIC reject, 10 MB-gräns)

## Miljövariabler

```bash
# OpenAI (domare)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5            # default, override-bar för test

# Qwen / DashScope (vision + reasoning)
QWEN_API_KEY=sk-...             # samma nyckel för båda
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_VL_MODEL=qwen3-vl-plus          # initial OCR + dokumenttyp-klassificering
QWEN_VL_VERIFY_MODEL=qwen-vl-ocr-latest  # re-OCR — dedikerad OCR-modell, högre textfidelitet vid verifiering
QWEN_REASON_MODEL=qwen3-max               # Qwen3-Max — 262k kontext, thinking mode

# Google (bildgenerering)
GOOGLE_API_KEY=...              # befintlig
GEMINI_IMAGE_MODEL=gemini-3-pro-image-preview
```

Kommentar: vi kör `qwen3-vl-plus` för första OCR-passet (snabbare/billigare) och `qwen-vl-max` för re-OCR där noggrannheten styr loopens utfall.

## Retry-strategi

**Beslut: GPT-styrt avbrott med hård gräns.**

- Max 3 iterationer (1 generering + 2 retries).
- Domaren returnerar `verdict: "FAIL"` med antingen `correction` (ny prompt till Nano) eller `bailout: true` om felet inte går att åtgärda surgiskt.
- Varje iteration loggas i Supabase med diff mellan `target.md` och `actual.md`.
- Vid `bailout` eller efter 3 iterationer levereras bästa kandidaten med en varning till användaren.

## Domarkontrakt (GPT-5.5)

Input:
- `target.md` — vad bilden _ska_ visa
- `actual.md` — vad re-OCR säger att den faktiskt visar
- `attempt: number` — vilken iteration vi är på

Output (strict JSON):
```json
{
  "verdict": "PASS" | "FAIL",
  "diff_summary": "kort beskrivning av avvikelser",
  "correction": "specifik prompt till Nano Banana Pro om FAIL",
  "bailout": false,
  "confidence": 0.0
}
```

PASS-kriterier: totalsumma, datum, tid, momsrader och artikellinjer matchar exakt. Tolerans noll på siffror, fuzzy match på radbrytningar.

## Implementeringsordning

1. **`src/lib/qwen-vl.ts`** + ersätt OCR-anropet i `process-receipt/route.ts`. Verifiera att bounding boxes-formatet matchar nuvarande UI.
2. **`src/lib/qwen-reason.ts`** + flytta `reconcile()`-logiken. Kör båda parallellt och jämför utfall i en vecka innan gamla raderas.
3. **`src/lib/judge.ts`** + `verify-loop.ts`. Bygg loopen runt befintlig `edit-image`-route bakom feature flag.
4. **Byt bildmodell** till `gemini-3-pro-image-preview` när loopen är stabil.
5. **EXIF-pipelinen körs sist** — endast på den bild som klarat PASS.
6. **Logga + analysera** första 100 produktionskörningarna innan flaggan tas bort.

## Öppna frågor

- Ska vi spara `temp.md`/`target.md`/`actual.md` per session i Supabase Storage för debugging? (Förslag: ja, 30 dagars TTL.)
- Pris-tak per kvitto? En full loop med 3 iterationer kan kosta märkbart mer än nuvarande single-shot.
- UI: ska användaren se iterationer live, eller bara slutresultatet?
