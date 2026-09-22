// Description templates (SPEC §7.3, seeds from Appendix B.6).
//
// Every spec in a description comes from the record, never from free text —
// that is the whole point of §2.2. Placeholders are {{field}} and resolve
// against a context built by generate.js.

export const PROCESS_SHORT =
  'Every piece starts the same way: the whole panel is scorched black. Then I carve back into it, '
  + 'removing char to reveal the pale wood underneath. The image emerges by subtraction. '
  + 'There’s no undo.';

export const PROCESS_LONG =
  'Most wood burning starts with a blank panel and adds dark lines. I work the other way around. '
  + 'Every piece begins by scorching the entire surface black. Then I carve back into it, cutting away '
  + 'char to uncover the pale wood underneath. Every light area you see is wood I removed. Nothing is '
  + 'drawn on, and there is no undo — a slip doesn’t get erased, it becomes part of the piece. '
  + 'That’s why a small portrait can take forty hours and a large landscape fifteen. It depends on how '
  + 'much detail has to come out of the dark, not on how big the panel is.';

// B.6 verbatim would emit "took about  hours." for a piece with no hours
// recorded, and "Measures  ×  in." for one with no dimensions — and §2.1 says
// every field except title is optional, so both are the normal case. The
// fragile placeholders are therefore whole sentences composed in generate.js,
// each of which vanishes cleanly when the record cannot supply it. The raw
// values are still in the context for anyone editing a template by hand.
export const SEED_TEMPLATES = {
  original: `{{subject_line}} — burned and carved into {{substrate}}. One of a kind, signed, {{framed_phrase}}.

{{process_short}}

{{history_paragraph}}

{{measures_sentence}} {{substrate_note_sentence}} {{frame_sentence}} {{hardware_sentence}}`,

  print: `{{subject_line}} — a {{print_substrate}} print of an original burned and carved into wood.

{{process_short}}

{{original_size_sentence}} {{original_status_sentence}}

Sizes
{{variant_lines}}

{{print_substrate_sentence}} {{hardware_sentence}} Made to order.`,

  custom: `A hand-carved portrait in burnt wood, made from your photograph.

I don't draw on the wood. The whole panel gets scorched black first, then I carve back into it, cutting away char to uncover the pale wood underneath. Every highlight is wood I removed. Nothing is added, and there's no undo.

That's why a portrait takes 25 to 50 hours depending on how many subjects are in it.

How it works
1. Message me with your photo before ordering so I can tell you whether it will carve well
2. Choose your size and number of subjects
3. I send progress photos as I go
4. Your piece ships framed, signed, and ready to hang

What makes a good photo: strong light, clear contrast, faces in focus. I'll tell you honestly before you pay if yours won't work.

Sizes and pricing
{{commission_price_lines}}

Timing: {{processing_min}} to {{processing_max}} weeks. Holiday orders by {{holiday_cutoff}}.{{sports_line}}`,
};

/** B.6: the sports custom listing adds one line. */
export const SPORTS_CUSTOM_LINE =
  'Portraits are made from your own photograph of your own athlete.';

/**
 * Fill {{placeholders}}. A missing value resolves to an empty string rather
 * than "undefined", and the tidy pass below removes the debris that leaves —
 * so a piece with no frame does not ship a description with a dangling
 * "Framed in ." in it.
 */
export function render(template, context) {
  const filled = String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === null || value === undefined ? '' : String(value);
  });
  return tidy(filled);
}

export function placeholdersIn(template) {
  return [...new Set([...String(template).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
}

/** Which placeholders a template asks for that the context cannot supply. */
export function missingPlaceholders(template, context) {
  return placeholdersIn(template).filter((key) => {
    const value = context[key];
    return value === null || value === undefined || String(value).trim() === '';
  });
}

// Acronyms that take "an" although they start with a consonant letter.
const VOWEL_SOUND_ACRONYMS = ['MDF', 'UV', 'LED', 'HD'];

function tidy(text) {
  return text
    .replace(
      new RegExp(`\\b(A|a) (?=(?:${VOWEL_SOUND_ACRONYMS.join('|')})\\b)`, 'g'),
      (_, article) => (article === 'A' ? 'An ' : 'an '),
    )
    // "Measures 12 × 12 ×  in." — a missing depth leaves a stray dimension slot.
    .replace(/(\d[\d.]*)\s*×\s*(\d[\d.]*)\s*×\s*(?=\s*in\b)/g, '$1 × $2 ')
    .replace(/×\s*×/g, '×')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,;:])/g, '$1')
    .replace(/([.,;:])\1+/g, '$1')
    // A sentence that lost its only content: ". ." or a line that is just punctuation.
    .replace(/^[ \t]*[.,;:]+[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((line) => line.trim()).join('\n')
    .trim();
}
