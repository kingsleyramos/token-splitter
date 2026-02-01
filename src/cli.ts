import fs from 'node:fs';
import path from 'node:path';
import {Command} from 'commander';
import chalk from 'chalk';

import {withTokenizer, countTokens} from './tokenizer.js';
import {splitTextIntoTokenChunks} from './splitText.js';
import {splitCsvByTokens} from './splitCsv.js';

type GlobalOpts = {
    model?: string;
    approx?: boolean;
    json?: boolean;
};

function getTimestamp() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        now.getFullYear() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        '_' +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds())
    );
}

function getDefaultOutDir(baseName: string) {
    const dir = path.join(
        process.cwd(),
        'token_output',
        `${baseName}_${getTimestamp()}`,
    );
    fs.mkdirSync(dir, {recursive: true});
    return dir;
}

const program = new Command();

program
    .name('token-splitter')
    .description('Token counting and splitting for text/CSV.')
    .option('--model <model>', 'Model hint for tokenizer')
    .option('--approx', 'Force approximate token counting', false)
    .option('--json', 'Output JSON', false);

function divider() {
    console.log(chalk.gray('─'.repeat(44)));
}
function nfmt(n: number) {
    return n.toLocaleString();
}

program
    .command('count')
    .description('Count tokens for a string or file.')
    .option('--text <text>', 'Inline text to count')
    .option('--file <path>', 'File to count')
    .action(async (opts) => {
        const g = program.opts<GlobalOpts>();
        await withTokenizer(async () => {
            let text = '';
            let source = '';

            if (opts.text) {
                text = opts.text;
                source = 'inline text';
            } else if (opts.file) {
                text = fs.readFileSync(opts.file, 'utf-8');
                source = opts.file;
            } else {
                throw new Error('Provide --text or --file');
            }

            const tokens = await countTokens(text, {
                model: g.model,
                approximate: g.approx,
            });

            if (g.json) {
                console.log(
                    JSON.stringify(
                        {
                            tokens,
                            source,
                            approximate: !!g.approx,
                            model: g.model ?? null,
                        },
                        null,
                        2,
                    ),
                );
                return;
            }

            console.log();
            console.log(chalk.bold('Token Count'));
            divider();
            console.log(`Tokens : ${chalk.bold(nfmt(tokens))}`);
            console.log(`Mode   : ${g.approx ? 'approximate' : 'tiktoken'}`);
            if (g.model) console.log(`Model  : ${g.model}`);
            console.log(`Source : ${source}`);
            console.log();
        });
    });

program
    .command('split')
    .description('Split text or a file into chunks under a max token limit.')
    .requiredOption('--max <n>', 'Max tokens per chunk/file', (v) =>
        parseInt(v, 10),
    )
    .option('--text <text>', 'Inline text to split')
    .option('--file <path>', 'File to split (CSV or text)')
    .option('--out <dir>', 'Output directory', 'token_output')
    .option('--mode <mode>', 'paragraph|sentence|line (text only)', 'paragraph')
    .option('--tokenMode <mode>', 'cells|line (CSV only)', 'cells')
    .action(async (opts) => {
        const g = program.opts<GlobalOpts>();

        await withTokenizer(async () => {
            const maxTokens = opts.max as number;
            let outDir: string;

            if (opts.out) {
                outDir = opts.out;
                fs.mkdirSync(outDir, {recursive: true});
            } else {
                if (opts.file) {
                    const ext = path.extname(opts.file);
                    const base = path.basename(opts.file, ext);
                    outDir = getDefaultOutDir(base);
                } else {
                    outDir = getDefaultOutDir('text');
                }
            }

            // Case A: inline text
            if (opts.text) {
                const {chunks, tokenCounts} = await splitTextIntoTokenChunks(
                    opts.text,
                    {
                        maxTokens,
                        model: g.model,
                        approximate: g.approx,
                        mode: opts.mode,
                    },
                );

                const baseName = 'text';
                chunks.forEach((chunk: string, i: number) => {
                    const fileName = `${baseName}_part${String(i + 1).padStart(3, '0')}.txt`;
                    fs.writeFileSync(
                        path.join(outDir, fileName),
                        chunk,
                        'utf-8',
                    );
                });

                const totalTokens = tokenCounts.reduce(
                    (a: number, b: number) => a + b,
                    0,
                );

                if (g.json) {
                    console.log(
                        JSON.stringify(
                            {
                                type: 'text',
                                chunks: chunks.length,
                                totalTokens,
                                maxTokens,
                                outDir,
                            },
                            null,
                            2,
                        ),
                    );
                    return;
                }

                console.log();
                console.log(chalk.bold('Split Complete (text)'));
                divider();
                console.log(`Chunks       : ${chalk.bold(chunks.length)}`);
                console.log(`Total tokens : ${nfmt(totalTokens)}`);
                console.log(`Max/chunk    : ${nfmt(maxTokens)}`);
                console.log(`Output dir   : ${outDir}`);
                console.log();
                return;
            }

            // Case B: file input (auto-detect CSV vs text by extension)
            if (opts.file) {
                const ext = path.extname(opts.file).toLowerCase();
                const baseName = path.basename(opts.file, ext);

                if (ext === '.csv') {
                    const result = await splitCsvByTokens({
                        inputPath: opts.file,
                        outDir,
                        maxTokens,
                        model: g.model,
                        approximate: g.approx,
                        tokenMode: opts.tokenMode,
                        assumeNoMultilineFields: true,
                    });

                    if (g.json) {
                        console.log(
                            JSON.stringify(
                                {
                                    type: 'csv',
                                    parts: result.parts,
                                    maxTokens,
                                    outDir,
                                },
                                null,
                                2,
                            ),
                        );
                        return;
                    }

                    console.log();
                    console.log(chalk.bold('Split Complete (csv)'));
                    divider();
                    console.log(`Parts      : ${chalk.bold(result.parts)}`);
                    console.log(`Max/part   : ${nfmt(maxTokens)}`);
                    console.log(`Output dir : ${outDir}`);
                    console.log();
                    return;
                }

                // Treat everything else as text
                const text = fs.readFileSync(opts.file, 'utf-8');
                const {chunks, tokenCounts} = await splitTextIntoTokenChunks(
                    text,
                    {
                        maxTokens,
                        model: g.model,
                        approximate: g.approx,
                        mode: opts.mode,
                    },
                );

                chunks.forEach((chunk: string, i: number) => {
                    const fileName = `${baseName}_part${String(i + 1).padStart(3, '0')}.txt`;
                    fs.writeFileSync(
                        path.join(outDir, fileName),
                        chunk,
                        'utf-8',
                    );
                });

                const totalTokens = tokenCounts.reduce(
                    (a: number, b: number) => a + b,
                    0,
                );

                if (g.json) {
                    console.log(
                        JSON.stringify(
                            {
                                type: 'text-file',
                                chunks: chunks.length,
                                totalTokens,
                                maxTokens,
                                outDir,
                            },
                            null,
                            2,
                        ),
                    );
                    return;
                }

                console.log();
                console.log(chalk.bold('Split Complete (text file)'));
                divider();
                console.log(`Chunks       : ${chalk.bold(chunks.length)}`);
                console.log(`Total tokens : ${nfmt(totalTokens)}`);
                console.log(`Max/chunk    : ${nfmt(maxTokens)}`);
                console.log(`Output dir   : ${outDir}`);
                console.log();
                return;
            }

            throw new Error('Provide --text or --file');
        });
    });

program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red('Error:'), err?.message ?? err);
    process.exit(1);
});
