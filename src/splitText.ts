// src/splitText.ts
import { countTokens } from "./tokenizer.js";

export type SplitTextOptions = {
  maxTokens: number;
  model?: string;
  approximate?: boolean;
  // Controls how we split. "paragraph" is safest.
  // "sentence" is nicer but not perfect (regex-based).
  mode?: "paragraph" | "sentence" | "line";
};

// Basic sentence splitter (not linguistically perfect, but works well enough)
function splitIntoSentences(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n");
  const parts = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(\[])/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function splitIntoParagraphs(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n");
  const parts = cleaned
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function splitIntoLines(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n");
  const parts = cleaned
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  return parts.length ? parts : [text.trim()];
}

export async function splitTextIntoTokenChunks(
  text: string,
  opts: SplitTextOptions
): Promise<{ chunks: string[]; tokenCounts: number[] }> {
  const { maxTokens, model, approximate, mode = "paragraph" } = opts;
  if (maxTokens <= 0) throw new Error("maxTokens must be > 0");

  const units =
    mode === "sentence" ? splitIntoSentences(text) :
    mode === "line" ? splitIntoLines(text) :
    splitIntoParagraphs(text);

  const chunks: string[] = [];
  const tokenCounts: number[] = [];

  let current: string[] = [];
  let currentTokens = 0;

  for (const unit of units) {
    const unitTokens = await countTokens(unit, { model, approximate });

    // If a single unit is larger than maxTokens, we must hard-split it.
    if (unitTokens > maxTokens) {
      // flush current first
      if (current.length) {
        chunks.push(current.join(mode === "line" ? "\n" : "\n\n"));
        tokenCounts.push(currentTokens);
        current = [];
        currentTokens = 0;
      }

      // hard split by character windows, then refine if needed.
      // This is a fallback; exact token-based splitting is more complex.
      let remaining = unit;
      while (remaining.length > 0) {
        // start with a rough char slice. tokens ~ chars/4 => chars ~ tokens*4
        const guessChars = Math.max(50, maxTokens * 4);
        let slice = remaining.slice(0, guessChars);

        // if slice still too big, shrink
        while ((await countTokens(slice, { model, approximate })) > maxTokens && slice.length > 50) {
          slice = slice.slice(0, Math.floor(slice.length * 0.85));
        }

        const sliceTokens = await countTokens(slice, { model, approximate });
        chunks.push(slice);
        tokenCounts.push(sliceTokens);

        remaining = remaining.slice(slice.length).trimStart();
      }

      continue;
    }

    if (currentTokens + unitTokens > maxTokens) {
      // flush current
      if (current.length) {
        chunks.push(current.join(mode === "line" ? "\n" : "\n\n"));
        tokenCounts.push(currentTokens);
      }
      current = [unit];
      currentTokens = unitTokens;
    } else {
      current.push(unit);
      currentTokens += unitTokens;
    }
  }

  if (current.length) {
    chunks.push(current.join(mode === "line" ? "\n" : "\n\n"));
    tokenCounts.push(currentTokens);
  }

  return { chunks, tokenCounts };
}
