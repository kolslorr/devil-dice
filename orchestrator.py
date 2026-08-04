#!/usr/bin/env python3
"""
Dicefall (formerly Devil Dice 3D) — Multi-Agent Orchestrator

Coordinates the self-improvement loop:

  1. Read the backlog from issues/
  2. Delegate code changes to the Architect (prints instructions for the AI)
  3. Optionally apply the Architect's patch on ai-bot-dev (--apply-patch)
  4. Serve the game locally
  5. Run the headless Playtester (Puppeteer)
  6. Analyze results as the Critic
  7. Commit/merge on pass, roll back on failure, write issues as needed
  8. Repeat

Usage:
  python3 orchestrator.py [--mode cycle|once|baseline] [--architect-message "msg"] [--apply-patch patch.diff]
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
        if "[STATUS: OPEN]" in content:
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
- [STATUS: OPEN]
"""
    path = ISSUES_DIR / fname
    path.write_text(content)
    return path


# ── Phase 2: Architect prompt ──
def build_architect_prompt(backlog=None, feature_request=None):
    """Build the prompt for the Architect agent (DeepSeek V4 Pro)."""
    line_count = len(GAME_JS.read_text().splitlines())
    prompt_parts = [
        "# Architect Task: Improve Dicefall\n",
        f"**Working directory:** `{ROOT}`\n",
        f"**File to edit:** `game.js` (single-file Three.js game engine, {line_count} lines)\n",
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
def git_run(*args):
    return subprocess.run(list(args), cwd=ROOT, capture_output=True, text=True)

def git_current_branch():
    result = git_run("git", "rev-parse", "--abbrev-ref", "HEAD")
    return result.stdout.strip()

def git_branch_exists(name):
    return git_run("git", "rev-parse", "--verify", name).returncode == 0

def git_ensure_branch(name):
    """Check out branch `name`, creating it from the current HEAD if needed."""
    if git_branch_exists(name):
        git_run("git", "checkout", name)
    else:
        git_run("git", "checkout", "-b", name)

def git_apply(patch_path):
    """Apply a unified diff produced by the Architect. Returns True on success."""
    patch = Path(patch_path)
    if not patch.exists():
        print(f"  [Git] Patch file not found: {patch}")
        return False
    check = git_run("git", "apply", "--check", str(patch))
    if check.returncode != 0:
        print(f"  [Git] Patch does not apply cleanly:\n{check.stderr[:500]}")
        return False
    result = git_run("git", "apply", str(patch))
    if result.returncode != 0:
        print(f"  [Git] Patch application failed:\n{result.stderr[:500]}")
        return False
    print(f"  [Git] Patch applied: {patch}")
    return True

def git_commit(message):
    git_run("git", "add", "-A")
    result = git_run("git", "commit", "-m", message)
    return result.returncode == 0

def git_merge():
    """Merge ai-bot-dev into gesture-nav, then recreate ai-bot-dev from the merge."""
    git_ensure_branch("gesture-nav")
    result = git_run("git", "merge", "ai-bot-dev", "--no-edit")
    if result.returncode != 0:
        print(f"  [Git] Merge failed:\n{result.stderr[:500]}")
        return False
    git_run("git", "branch", "-D", "ai-bot-dev")
    git_run("git", "checkout", "-b", "ai-bot-dev")
    return True

def git_discard_changes():
    """Discard uncommitted working-tree changes (the failed patch)."""
    result = git_run("git", "restore", ".")
    if result.returncode != 0:
        # Fallback for older git versions
        result = git_run("git", "checkout", "--", ".")
    return result.returncode == 0


# ── Main orchestrator loop ──
def run_cycle(feature_request=None, mode="cycle", patch_path=None):
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

    # Phase 2.5: Apply the Architect's patch (if supplied) on the dev branch
    patch_applied = False
    if patch_path:
        print("\n[Phase 2.5] Applying Architect patch...")
        git_ensure_branch("ai-bot-dev")
        if git_apply(patch_path):
            patch_applied = True
        else:
            print("  ❌ Patch could not be applied; aborting cycle.")
            return {
                "status": "patch-failed",
                "architect_prompt_path": str(arch_prompt_path),
                "critic_report": "Patch failed to apply cleanly.",
                "playtest_result": {"passed": False, "errors": ["git apply rejected the patch"]},
            }

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

    # Report zen effects status
    if playtest_result.get("zenEffectsVerified"):
        print(f"\n  🎆 ZEN EFFECTS: Verified ✓")
        print(f"    - Ambient particles: {'Active' if playtest_result.get('zenAmbientParticles') else 'Missing'}")
        print(f"    - Active bursts:    {playtest_result.get('zenBurstsSpawned', 0)}")
    else:
        print(f"\n  ⚠️ ZEN EFFECTS: NOT VERIFIED")

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
        result_status = "passed"
        if patch_applied:
            label = backlog["path"].stem if backlog else "optimization"
            if git_commit(f"Orchestrator: applied architect fix ({label})"):
                print("  ✅ Committed to ai-bot-dev")
                if git_merge():
                    print("  ✅ Merged into gesture-nav")
                    result_status = "merged"
            # Mark the issue resolved only when a change was actually
            # applied AND verified by the playtest.
            if backlog:
                resolved_path = backlog["path"]
                content = resolved_path.read_text()
                content = content.replace("[STATUS: OPEN]", "[STATUS: RESOLVED]")
                content = content.replace("status: OPEN", "status: RESOLVED")
                resolved_path.write_text(content)
                print(f"  Issue marked RESOLVED: {resolved_path.name}")
        elif backlog:
            print("  ⚠️  No patch supplied — baseline verification only; issue NOT marked resolved")

        result = {
            "status": result_status,
            "patch_applied": patch_applied,
            "architect_prompt_path": str(arch_prompt_path),
            "critic_report": critic_report,
            "playtest_result": playtest_result,
        }
    else:
        print("\n  ❌ PLAYTEST FAILED — Issues detected")
        if patch_applied:
            print("  ↩️  Discarding the applied patch...")
            if git_discard_changes():
                print("  ✅ Patch discarded")
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
            "patch_applied": patch_applied,
            "issue_path": str(issue_path),
            "critic_report": critic_report,
            "playtest_result": playtest_result,
        }

    return result


# ── CLI entry point ──
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dicefall Multi-Agent Orchestrator")
    parser.add_argument("--mode", choices=["cycle", "once", "baseline"], default="once",
                       help="cycle=run continuous loop, once=single pass, baseline=capture golden screenshot")
    parser.add_argument("--architect-message", type=str, default=None,
                       help="Feature request or bug fix description for the Architect")
    parser.add_argument("--apply-patch", type=str, default=None,
                       help="Path to a unified diff produced by the Architect to apply before playtesting")
    args = parser.parse_args()

    if args.mode == "baseline":
        print("📸 Capturing golden master baseline screenshot...")
        server = start_server()
        try:
            # Capture the baseline at the same deterministic, settled,
            # in-game state that the playtester screenshots for comparison.
            result = subprocess.run(
                [NODE, str(PLAYTESTER), "--baseline", "--golden=golden/baseline.png", "--port=8000"],
                capture_output=True, text=True, timeout=60, cwd=ROOT
            )
            if result.returncode == 0:
                print("  Baseline captured: golden/baseline.png")
            else:
                print(f"  Baseline capture FAILED:\n{result.stdout[:500]}\n{result.stderr[:500]}")
        finally:
            server.terminate()
            server.wait()
        print("Done.")

    elif args.mode == "once":
        result = run_cycle(feature_request=args.architect_message, mode="once", patch_path=args.apply_patch)
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
                result = run_cycle(mode="cycle", patch_path=args.apply_patch)
                print(f"\n  Cycle #{cycle_count} result: {result['status'].upper()}")
                time.sleep(5)
        except KeyboardInterrupt:
            print(f"\n  Stopped after {cycle_count} cycles.")
