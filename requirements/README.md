# Requirements Loop

This folder is the queue for the build-test-deploy loop.

## The loop

1. **You write a requirement** — either paste it in chat, or drop a file here:
   `requirements/NN-short-name.md`
2. **I read** the pending requirements (lowest `NN` first).
3. **I build** the change in the codebase.
4. **I test** it with the headless playtester (`python3 orchestrator.py --mode once`:
   console errors, FPS, swipe/move accuracy, match detection, zen effects,
   visual regression against the golden baseline).
5. **I fix and retest** until the playtest is green.
6. **I deploy** — the game is served from the repo root on
   **http://localhost:8000** (no build step; refresh the page to pick up
   changes, and I restart the server if it is down).
7. **I close the item** — the requirement moves to `requirements/done/` and
   I summarize what shipped and how to verify it.

## Requirement file format

One requirement per file, plain text or Markdown:

    ---
    title: "Give the dice a neon outline"
    priority: 1
    ---

    Make the dice edges glow softly... (any detail you like)

Ordering:

- Files named `01-...`, `02-...` are processed in that order (lower number
  first, like a queue).
- Files without a number are processed in alphabetical filename order after
  the numbered ones.
- Multiple requirements can be queued at once; I work through them one by one.

## Rules of engagement

- Chat-pasted requirements work too — the file is optional persistence.
- If a requirement is ambiguous or would meaningfully change game feel, I flag
  the assumption I made and proceed, then you can correct me.
- I leave unrelated files (e.g. `.hermes/`) alone and commit when you ask.
