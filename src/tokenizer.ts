// src/tokenizer.ts
// Token counting with best-effort correctness:
// - Prefers tiktoken (accurate for many OpenAI encodings).
// - Falls back to approximation if unavailable.
//
// Note: different model families tokenize differently.
// We treat "model" as a hint. If tiktoken can't resolve it, we still count.

export type TokenizerOptions = {
    model?: string; // e.g. "gpt-4o-mini", "gpt-4.1", etc.
    approximate?: boolean; // force approximation
};

let cachedEncode: ((text: string) => number[]) | null = null;
let cachedFree: (() => void) | null = null;

async function initTiktoken(modelHint?: string) {
    if (cachedEncode) return;

    try {
        // tiktoken has different entry points depending on package version.
        // We'll try a couple common imports dynamically.
        const tk = await import('tiktoken');
        // @ts-ignore
        const {encoding_for_model, get_encoding} = tk;

        // Best effort: try encoding_for_model first; otherwise fall back to cl100k_base
        let enc: any;
        try {
            if (modelHint && typeof encoding_for_model === 'function') {
                enc = encoding_for_model(modelHint as any);
            }
        } catch {
            // ignore
        }

        if (!enc && typeof get_encoding === 'function') {
            enc = get_encoding('cl100k_base');
        }

        if (!enc)
            throw new Error('No encoding available from tiktoken import.');

        cachedEncode = (text: string) => enc.encode(text);
        cachedFree = () => {
            try {
                enc.free?.();
            } catch {
                // ignore
            }
            cachedEncode = null;
            cachedFree = null;
        };
    } catch {
        cachedEncode = null;
        cachedFree = null;
    }
}

// A practical approximation when real tokenization isn't available.
// Heuristic: tokens are often ~ 3–4 chars in English on average,
// but varies widely. We'll use ~4 chars/token with some bias for whitespace/punct.
export function approximateTokenCount(text: string): number {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return 0;

    // add a small bump for punctuation which tends to add tokens
    const punct = (normalized.match(/[.,;:!?()[\]{}"']/g) ?? []).length;
    const chars = normalized.length;

    // base estimate
    const base = Math.ceil(chars / 4);

    // punctuation tends to increase token count slightly
    const bump = Math.ceil(punct / 6);

    return Math.max(1, base + bump);
}

export async function countTokens(
    text: string,
    opts: TokenizerOptions = {},
): Promise<number> {
    const {model, approximate} = opts;
    if (approximate) return approximateTokenCount(text);

    await initTiktoken(model);
    if (cachedEncode) {
        return cachedEncode(text).length;
    }
    return approximateTokenCount(text);
}

export async function withTokenizer<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } finally {
        try {
            cachedFree?.();
        } catch {
            // ignore
        }
    }
}
