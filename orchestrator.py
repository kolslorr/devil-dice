#!/usr/bin/env python3
"""
Devil Dice 3D — Multi-Agent Orchestrator

Coordinates the self-improvement loop:

  1. Read the backlog from issues/
  2. Delegate code changes to the Architect (prints instructions for the AI)
  3. Serve the game locally
  4. Run the headless Playtester (Puppeteer)
  5. Analyze results as the Critic
  6. Write issues or merge decisions
  7. Repeat

Usage:
  python3 orchestrator.py [--mode cycle|once] [--architect-message "msg"]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import hashlib
import re
from datetime import datetime
from pathlib import Path

# ── Paths ──
ROOT = Path(__file__).resolve().parent
GAME_JS = ROOT / "game.js"
ISSUES_DIR = ROOT / "issues"
TEST_OUTPUT = ROOT / "test_output"
GOLDEN_DIR = ROOT / "golden"
GOLDEN_BASELINE = GOLDEN_DIR / "baseline.png"
PLAYTESTER = ROOT / "tests" / "playtester.js"
PYTHON = sys.executable or "python3"
NODE = shutil.which("node") or "node"

os.makedirs(ISSUES_DIR, exist_ok=True)
os.makedirs(TEST_OUTPUT, exist_ok=True)
os.makedirs(GOLDEN_DIR, exist_ok=True)


# ── Phase 1: Read backlog ──
def read_backlog():
    """Read all open issues from the issues/ directory, sorted newest first."""
    issues = sorted(ISSUES_DIR.glob("*.md"), reverse=True)
    if not issues:
        return None
    # Find the most recent unresolved issue
    for issue_path in issues:
        content = issue_path.read_text()
        if "[STATUS: OPEN]" in content or "[STATUS: OPEN]" not in content:
            return {"path": issue_path, "content": content}
    return None


def write_issue(title, body, severity="bug"):
    """Write a structured issue file."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    slug = re.sub(r'[^a-z0-9-]', '-', title.lower().strip())[:50]
    fname = f"{int(time.time())}_{slug}.md"
    content = f"""---
title: "{title}"
severity: {severity}
created: {timestamp}
status: OPEN
---

{body}

## Diagnostics
- Timestamp: {timestamp}
- Severity: {severity}
"""
    path = ISSUES_DIR / fname
    path.write_text(content)
    return path


# ── Phase 2: Architect prompt ──
def build_architect_prompt(backlog=None, feature_request=None):
    """Build the prompt for the Architect agent (DeepSeek V4 Pro)."""
    prompt_parts = [
        "# Architect Task: Improve Devil Dice 3D\n",
        f"**Working directory:** `{ROOT}`\n",
        "**File to edit:** `game.js` (single-file Three.js game engine, ~540 lines)\n",
        "**Constraints:**\n",
        "- Return ONLY the modified code block(s) — no explanations outside the code\n",
        "- Do NOT remove or break the `window.autoGameState` and `window.currentFPS` automation hooks\n",
        "- Keep the `\"use strict\";` directive intact\n",
        "- Game must remain compatible with Three.js r128 (CDN)\n",
        "- Maintain backward compatibility with mobile touch + keyboard controls\n",
    ]

    if backlog:
        prompt_parts.append(f"\n## Current Issue to Fix\n{backlog['content']}\n")
        prompt_parts.append("\nRead the current game.js, produce a targeted fix, output ONLY the diff or the full function(s) to replace.\n")
    elif feature_request:
        prompt_parts.append(f"\n## Feature Request\n{feature_request}\n")
        prompt_parts.append("\nRead the current game.js, implement the feature, output ONLY the changed code block(s).\n")
    else:
        prompt_parts.append("\n## Optimization Goal\nRead the current game.js and suggest one incremental optimization. Prefer:\n")
        prompt_parts.append("- Rendering performance (reduce draw calls, optimize textures)\n")
        prompt_parts.append("- Touch input responsiveness\n")
        prompt_parts.append("- Memory leak fixes (dispose geometries on board clear)\n")
        prompt_parts.append("- AI opponent intelligence\n")
        prompt_parts.append("- Code size reduction / minification\n")
        prompt_parts.append("\nOutput ONLY the specific code changes as a unified diff format.\n")

    return "\n".join(prompt_parts)


# ── Phase 3: Start HTTP server ──
def start_server():
    """Start a local Python HTTP server on port 8000."""
    server_proc = subprocess.Popen(
        [PYTHON, "-m", "http.server", "8000"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(1.5)  # Wait for server to start
    return server_proc


# ── Phase 4: Run playtester ──
def run_playtester():
    """Execute the Puppeteer playtester and return parsed results."""
    print("  [Playtester] Running headless playtest...")
    result = subprocess.run(
        [NODE, str(PLAYTESTER), f"--port=8000", f"--golden={GOLDEN_BASELINE}"],
        capture_output=True, text=True, timeout=90, cwd=ROOT
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {
            "passed": False,
            "errors": [f"STDERR: {result.stderr[:500]}", f"STDOUT: {result.stdout[:500]}"],
            "warnings": ["JSON parse failed"],
            "fpsAvg": 0, "fpsMin": 0,
            "fpsSamples": [],
            "screenshot": None,
            "diffPct": None,
            "consoleLogs": [],
            "movesAttempted": 0,
            "movesCompleted": 0,
            "matchesFound": 0,
            "testId": "error",
        }
    return data


# ── Phase 5: Critic analysis ──
def critic_analyze(playtest_result):
    """Analyze playtest results and decide: merge, fix, or rollback."""
    report = []

    if playtest_result["errors"]:
        report.append(f"## ❌ CRITICAL: {len(playtest_result['errors'])} runtime error(s)")
        for err in playtest_result["errors"][:5]:
            report.append(f"  - `{err[:200]}`")
        report.append("")

    if playtest_result["warnings"]:
        report.append(f"## ⚠️ {len(playtest_result['warnings'])} warning(s)")
        for w in playtest_result["warnings"][:5]:
            report.append(f"  - {w[:200]}")
        report.append("")

    fps_avg = playtest_result.get("fpsAvg", 0)
    fps_min = playtest_result.get("fpsMin", 0)
    report.append(f"## 📊 Performance")
    report.append(f"  - Avg FPS: {fps_avg}")
    report.append(f"  - Min FPS: {fps_min}")
    report.append(f"  - Samples: {len(playtest_result.get('fpsSamples', []))}")
    report.append("")

    report.append(f"## 🎮 Playtest Stats")
    report.append(f"  - Moves attempted: {playtest_result.get('movesAttempted', 0)}")
    report.append(f"  - Moves completed: {playtest_result.get('movesCompleted', 0)}")
    report.append(f"  - Match groups found: {playtest_result.get('matchesFound', 0)}")
    report.append("")

    if playtest_result.get("diffPct") is not None:
        report.append(f"## 🖼️ Visual Regression")
        report.append(f"  - Pixel drift: {playtest_result['diffPct']:.2f}%")
        report.append(f"  - Threshold: 5.0%")
        if playtest_result["diffPct"] > 5.0:
            report.append(f"  - ❌ FAILED: Visual drift exceeds threshold")
        else:
            report.append(f"  - ✅ PASSED: Within acceptable range")
        report.append("")

    if playtest_result.get("screenshot"):
        screenshot_path = Path(playtest_result["screenshot"])
        if screenshot_path.exists():
            report.append(f"  - Screenshot: `{screenshot_path}`")
            report.append("")

    console_logs = playtest_result.get("consoleLogs", [])
    if console_logs:
        errors = [l for l in console_logs if l.get("type") == "error"]
        warnings = [l for l in console_logs if l.get("type") == "warning"]
        if errors:
            report.append(f"## 📋 Console Errors ({len(errors)})")
            for e in errors[:3]:
                report.append(f"  - {e['text'][:200]}")
        if warnings:
            report.append(f"## 📋 Console Warnings ({len(warnings)})")
            for w in warnings[:3]:
                report.append(f"  - {w['text'][:200]}")

    return "\n".join(report)


# ── Git helpers ──
def git_current_branch():
    result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                          capture_output=True, text=True, cwd=ROOT)
    return result.stdout.strip()

def git_commit(message):
    subprocess.run(["git", "add", "-A"], cwd=ROOT, capture_output=True)
    result = subprocess.run(["git", "commit", "-m", message], cwd=ROOT, capture_output=True, text=True)
    return result.returncode == 0

def git_merge():
    subprocess.run(["git", "checkout", "gesture-nav"], cwd=ROOT, capture_output=True)
    result = subprocess.run(["git", "merge", "ai-bot-dev", "--no-edit"], cwd=ROOT, capture_output=True, text=True)
    if result.returncode == 0:
        subprocess.run(["git", "branch", "-D", "ai-bot-dev"], cwd=ROOT, capture_output=True)
        subprocess.run(["git", "checkout", "-b", "ai-bot-dev"], cwd=ROOT, capture_output=True)
        return True
    return False

def git_rollback():
    """Roll back the last commit on ai-bot-dev."""
    subprocess.run(["git", "reset", "--hard", "HEAD~1"], cwd=ROOT, capture_output=True)


# ── Main orchestrator loop ──
def run_cycle(feature_request=None, mode="cycle"):
    """Run one full Architect → Playtest → Critic cycle."""
    print(f"\n{'='*60}")
    print(f"  ORCHESTRATOR CYCLE — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Branch: {git_current_branch()}")
    print(f"{'='*60}\n")

    # Phase 1: Read backlog
    print("[Phase 1] Reading issue backlog...")
    backlog = read_backlog()
    if backlog:
        print(f"  Found open issue: {backlog['path'].name}")
        architect_prompt = build_architect_prompt(backlog=backlog)
    else:
        print("  No open issues. Proceeding with general optimization.")
        architect_prompt = build_architect_prompt(feature_request=feature_request)

    # Print the architect prompt (so the DELEGATE task can use it)
    print("\n[Phase 2] Architect prompt generated:")
    print(f"  ({len(architect_prompt)} chars)")
    arch_prompt_path = TEST_OUTPUT / f"architect_prompt_{int(time.time())}.md"
    arch_prompt_path.write_text(architect_prompt)
    print(f"  Saved to: {arch_prompt_path}")

    # Phase 3: Start server
    print("\n[Phase 3] Starting HTTP server on port 8000...")
    server = start_server()
    print("  Server PID:", server.pid)

    # Phase 4: Run playtester (with current code)
    print("\n[Phase 4] Running headless playtest (current code)...")
    playtest_result = run_playtester()

    # Phase 5: Critic analysis
    print("\n[Phase 5] Critic analysis...")
    critic_report = critic_analyze(playtest_result)
    print(critic_report[:500] + "..." if len(critic_report) > 500 else critic_report)

    # Save critic report
    report_path = TEST_OUTPUT / f"critic_report_{int(time.time())}.md"
    report_path.write_text(critic_report)
    print(f"  Critic report saved: {report_path}")

    # Stop server
    server.terminate()
    server.wait()

    # Decision
    if playtest_result["passed"]:
        print("\n  ✅ PLAYTEST PASSED — Code is stable")
        # Mark the issue as resolved if there was one
        if backlog:
            resolved_path = backlog["path"]
            content = resolved_path.read_text()
            content = content.replace("status: OPEN", "status: RESOLVED")
            resolved_path.write_text(content)
            print(f"  Issue marked RESOLVED: {resolved_path.name}")

        result = {
            "status": "passed",
            "architect_prompt_path": str(arch_prompt_path),
            "critic_report": critic_report,
            "playtest_result": playtest_result,
        }
    else:
        print("\n  ❌ PLAYTEST FAILED — Issues detected")
        # Write a new issue
        error_summary = "; ".join(playtest_result["errors"][:3] if playtest_result["errors"] else playtest_result["warnings"][:3])
        issue_path = write_issue(
            title=f"Playtest Failure: {error_summary[:60]}",
            body=critic_report,
            severity="critical" if playtest_result["errors"] else "warning"
        )
        print(f"  New issue created: {issue_path}")

        result = {
            "status": "failed",
            "issue_path": str(issue_path),
            "critic_report": critic_report,
            "playtest_result": playtest_result,
        }

    return result


# ── CLI entry point ──
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Devil Dice 3D Multi-Agent Orchestrator")
    parser.add_argument("--mode", choices=["cycle", "once", "baseline"], default="once",
                       help="cycle=run continuous loop, once=single pass, baseline=capture golden screenshot")
    parser.add_argument("--architect-message", type=str, default=None,
                       help="Feature request or bug fix description for the Architect")
    args = parser.parse_args()

    if args.mode == "baseline":
        print("📸 Capturing golden master baseline screenshot...")
        server = start_server()
        try:
            # Use Puppeteer to capture a clean baseline
            subprocess.run(
                [NODE, "-e", """
                    import('puppeteer').then(async p => {
                        const browser = await p.launch({ headless: 'new', args: ['--no-sandbox'] });
                        const page = await browser.newPage();
                        await page.setViewport({ width: 450, height: 850, isMobile: true });
                        await page.goto('http://localhost:8000', { waitUntil: 'networkidle0' });
                        await page.waitForSelector('#zen-btn');
                        await page.screenshot({ path: 'golden/baseline.png', fullPage: false });
                        console.log('Baseline captured: golden/baseline.png');
                        await browser.close();
                    });
                """],
                capture_output=True, text=True, timeout=30, cwd=ROOT
            )
        finally:
            server.terminate()
            server.wait()
        print("Done.")

    elif args.mode == "once":
        result = run_cycle(feature_request=args.architect_message, mode="once")
        print(f"\n{'='*60}")
        print(f"  CYCLE RESULT: {result['status'].upper()}")
        print(f"{'='*60}")

    elif args.mode == "cycle":
        print("🔄 Continuous improvement loop started (Ctrl+C to stop)")
        cycle_count = 0
        try:
            while True:
                cycle_count += 1
                print(f"\n  ─── Cycle #{cycle_count} ───")
                result = run_cycle(mode="cycle")
                print(f"\n  Cycle #{cycle_count} result: {result['status'].upper()}")
                time.sleep(5)
        except KeyboardInterrupt:
            print(f"\n  Stopped after {cycle_count} cycles.")
