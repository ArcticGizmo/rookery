/**
 * Known Claude model ids offered as autocomplete in the workflow builder's persona
 * `model` field. This is a convenience list only — the field stays free text so a
 * newer or custom model id can always be typed. Passed through to the Agent SDK
 * verbatim (see `mapPersonaToOptions`).
 */
export const KNOWN_MODELS: readonly string[] = [
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-fable-5'
]
