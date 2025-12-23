# Red Seal Plumbing Exam Engine (Local)

## How to run
1) Create folder `red-seal-exam/`
2) Save all files exactly as provided (including `data/` folder)
3) Double-click `index.html`

## Question format (JSON)
Each file in `data/*.json` is an array of question objects:

- id: string (unique)
- bank: string (core|dwv|hydronic|safety|tools|math)
- category: string (display tag)
- difficulty: 1..5 (optional)
- stem: string
- choices: string[]
- answerIndex: number
- explanation: string
- references: [{ code, location, confidence, note }]

## Clause references
We never guess clause numbers. Use:
- confidence: "verified" when you are certain (code open + checked),
- confidence: "needs_verify" if it’s a reminder to confirm in your NPC/BCPC/CSA book.
