# Create-project seed ZIP

The create-project page accepts a ZIP with a root `project.json` and an optional
`references/` directory. The JSON is a partial create-project request:

```json
{
  "title": "Kodak",
  "language": "vi",
  "brief": "A documentary brief",
  "referencesText": "Notes already in the seed",
  "scriptPresetId": "documentary",
  "aiProvider": "deepseek",
  "visualStylePresetId": "cinematic",
  "targetDurationSec": 180,
  "chapterCount": 3,
  "renderSettings": { "aspect": "16:9", "fps": 30 },
  "voiceId": null
}
```

Every field is optional. Files directly under `references/` with `.txt`, `.md`,
`.docx`, or `.pdf` extensions are extracted in filename order and appended to
`referencesText` with a blank line between documents. The endpoint only
prefills the form; it never creates a project.
