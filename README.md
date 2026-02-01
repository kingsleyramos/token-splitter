# Token Splitter CLI

A strict token-based CLI for:

- Counting tokens in text or files
- Splitting text or CSV files under a maximum token limit

Uses `tiktoken` for accurate token counting.
No approximation mode. No JSON output mode.

---

# Commands

## Count

Count tokens for inline text:

```bash
npm run count -- --text "hello world"
```

Count tokens for a file:

```bash
npm run count -- --file ./file.txt
```

### Flags

| Flag            | Required | Description          |
| --------------- | -------- | -------------------- |
| `--text <text>` | one of   | Inline text to count |
| `--file <path>` | one of   | File path to count   |

You must provide either `--text` or `--file`.

---

## Split

Split text or a file into chunks under a strict max token limit.

### Text file

```bash
npm run split -- --file ./big.txt --max 8000
```

### CSV file

```bash
npm run split -- --file ./data.csv --max 25000
```

### Inline text

```bash
npm run split -- --text "long text..." --max 8000
```

---

# Split Flags

| Flag                 | Required | Description                                             |
| -------------------- | -------- | ------------------------------------------------------- |
| `--max <n>`          | yes      | Max tokens per chunk                                    |
| `--file <path>`      | one of   | Input file (text or CSV)                                |
| `--text <text>`      | one of   | Inline text                                             |
| `--mode <type>`      | no       | Text splitting mode: `paragraph`, `sentence`, or `line` |
| `--tokenMode <type>` | no       | CSV token counting mode: `line` (default) or `cells`    |
| `--out <dir>`        | no       | Override output directory                               |

You must provide `--max` and either `--file` or `--text`.

---

# Default Behavior

### Output Location

If `--out` is not provided, output is written to:

```
./token_output/<input_name>_YYYYMMDD_HHMMSS/
```

Each run generates a new timestamped directory to prevent overwrites.

---

# CSV Behavior

- Header is preserved in every output file
- Rows are never split
- Default token counting mode is `line`
- `cells` mode joins fields before counting tokens

Assumes no multiline quoted CSV fields.

---

# Examples

### Count a large export

```bash
npm run count -- --file ./gmail_export.csv
```

### Split under a 32k model limit

```bash
npm run split -- --file ./gmail_export.csv --max 25000
```

### Split a prompt document

```bash
npm run split -- --file ./prompt.md --max 12000 --mode paragraph
```
