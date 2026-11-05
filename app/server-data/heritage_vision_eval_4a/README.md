# Less GO Vision evaluation dataset

This folder contains only the empty schema template. User photos, reviewed labels, permissions, and run output belong in the ignored local directory `app/.local/heritage_vision_eval_4a/` and must not be added to Git.

Copy `dataset.example.json` to `.local/heritage_vision_eval_4a/dataset.json`. Put personally captured or otherwise authorized JPG, PNG, or WEBP photos in `.local/heritage_vision_eval_4a/images/`, then add records using the schema below.

```json
{
  "imageId": "unique-local-id",
  "imagePath": "images/photo.jpg",
  "spotId": "jeongneung",
  "spotName": "정릉",
  "groundTruthName": "정자각",
  "groundTruthAliases": [],
  "groundTruthSubjectLevel": "facility",
  "reviewer": "reviewer identifier",
  "reviewedAt": "YYYY-MM-DD",
  "evidence": "How the correct label was checked",
  "labelStatus": "verified",
  "usagePermission": {
    "status": "confirmed",
    "permittedForGemini": true,
    "reviewer": "permission reviewer",
    "reviewedAt": "YYYY-MM-DD",
    "basis": "Documented permission basis"
  },
  "notes": null
}
```

Use `labelStatus: "unverified"` and null ground-truth/reviewer fields while a label is unresolved. Such records are excluded from accuracy metrics. `groundTruthAliases` are mapping hints only; predictions count as aliases only when the existing official heritage evidence registry contains the same alias for that exact place and object. Do not add guesses. Allowed `groundTruthSubjectLevel` values are `place`, `facility`, or `feature`.

## Commands

From the `app/` directory:

- `npm run eval:heritage:validate` validates the local dataset without network access.
- `npm run eval:heritage:self-test` runs offline metric and filtering tests using in-memory fixtures only.
- `npm run eval:heritage:live -- --limit=1` explicitly makes real Gemini Vision requests for at most one eligible photo. Node loads `app/.env.local`; the key is never printed. Only records with a verified reviewed label and complete Gemini usage permission are eligible.

The live evaluator sends only the selected image, `spotId`, and place-name context plus the same official visual-name suggestions used by the app. Ground-truth names, aliases, evidence, reviewer, notes, and filenames are never included in the Gemini prompt. Reference-photo comparison is disabled; this tool never loads the 33-photo reference dataset.

Each eligible image gets one Gemini request, without automatic retries, so `--limit=N` is also the maximum number of actual Gemini requests. The maximum is 20 images per invocation. Invalid data, missing permission, unsupported types, oversized images, invalid model responses, and API errors are reported without logging image bytes, local paths, keys, request URLs, or raw upstream bodies. Interrupted runs preserve results completed before interruption.

Output is written under ignored `.local/heritage_vision_eval_4a/runs/<timestamp>/` as `results.json`, `summary.json`, and `report.md`. Accuracy denominators include only records with reviewed labels and successful valid model responses. Unverified labels and API failures are listed separately and never count as correct. Empty datasets produce null accuracy values, not fabricated percentages.

This tool measures a small, manually reviewed sample; results do not establish calibrated per-photo confidence. Do not display a confidence percentage in the app based on this evaluation alone.
