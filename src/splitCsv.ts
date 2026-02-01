// src/splitCsv.ts
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {countTokens} from './tokenizer.js';

export type SplitCsvOptions = {
    inputPath: string;
    outDir: string;
    maxTokens: number;
    model?: string;
    approximate?: boolean;
    // how to count tokens per row:
    // "line" counts entire CSV line including commas
    // "cells" counts only cell text joined by a delimiter (less punctuation-heavy)
    tokenMode?: 'line' | 'cells';
    delimiter?: string; // default ","
    quote?: string; // default '"'
    // For huge CSVs: treat as line-based CSV (fast). Works best when CSV lines are not multi-line quoted fields.
    // If your CSV can have embedded newlines inside quoted fields, you need a real CSV parser.
    assumeNoMultilineFields?: boolean;
};

// Basic CSV line -> cells parser (handles simple quotes, no multiline fields)
function parseCsvLine(line: string, delimiter = ',', quote = '"'): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === quote) {
            // handle escaped quotes ""
            const next = line[i + 1];
            if (inQuotes && next === quote) {
                cur += quote;
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (!inQuotes && ch === delimiter) {
            cells.push(cur);
            cur = '';
            continue;
        }

        cur += ch;
    }

    cells.push(cur);
    return cells;
}

export async function splitCsvByTokens(opts: SplitCsvOptions): Promise<{
    parts: number;
    partPaths: string[];
}> {
    const {
        inputPath,
        outDir,
        maxTokens,
        model,
        approximate,
        tokenMode = 'line',
        delimiter = ',',
        quote = '"',
        assumeNoMultilineFields = true,
    } = opts;

    if (!fs.existsSync(inputPath))
        throw new Error(`Input not found: ${inputPath}`);
    if (maxTokens <= 0) throw new Error('maxTokens must be > 0');

    fs.mkdirSync(outDir, {recursive: true});

    // Read header line + stream body.
    // WARNING: if your CSV has multiline quoted fields, readline line-based reading can break it.
    // Your Gmail exports are usually safe, but if you have multiline in body columns,
    // consider exporting with escaped newlines or using a real CSV parser.
    if (!assumeNoMultilineFields) {
        throw new Error(
            'assumeNoMultilineFields=false is not supported in this lightweight implementation. ' +
                "If you need multiline CSV support, tell me and I'll swap in a streaming CSV parser approach.",
        );
    }

    const inStream = fs.createReadStream(inputPath, {encoding: 'utf-8'});
    const rl = readline.createInterface({input: inStream, crlfDelay: Infinity});

    let header: string | null = null;

    let part = 0;
    let currentTokens = 0;
    let currentLines: string[] = [];
    const partPaths: string[] = [];

    async function flushPart() {
        if (!header) throw new Error('Missing header');
        if (currentLines.length === 0) return;

        part++;
        const base = path.basename(inputPath, path.extname(inputPath));
        const outPath = path.join(
            outDir,
            `${base}_part${String(part).padStart(3, '0')}.csv`,
        );

        const content = [header, ...currentLines].join('\n') + '\n';
        fs.writeFileSync(outPath, content, 'utf-8');
        partPaths.push(outPath);

        currentLines = [];
        currentTokens = 0;
    }

    for await (const line of rl) {
        // skip empty lines
        if (line.trim().length === 0) continue;

        if (!header) {
            header = line;
            continue;
        }

        let rowTextForTokens = line;
        if (tokenMode === 'cells') {
            const cells = parseCsvLine(line, delimiter, quote);
            rowTextForTokens = cells.join(' | ');
        }

        const rowTokens = await countTokens(rowTextForTokens, {
            model,
            approximate,
        });

        // If a single row exceeds maxTokens, we still write it alone in a part.
        // (Because CSV row is atomic unless you want to split a row, which breaks CSV integrity.)
        if (rowTokens > maxTokens) {
            await flushPart();
            currentLines = [line];
            currentTokens = rowTokens;
            await flushPart();
            continue;
        }

        if (currentTokens + rowTokens > maxTokens) {
            await flushPart();
        }

        currentLines.push(line);
        currentTokens += rowTokens;
    }

    await flushPart();

    return {parts: part, partPaths};
}
