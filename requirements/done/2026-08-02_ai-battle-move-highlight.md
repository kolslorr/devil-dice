---
title: "Make the AI-moved die more visible in battle mode"
status: DONE
completed: 2026-08-02
---

**Requirement (from chat):** In AI battle mode, the die being moved by the AI
should be more visible — highlight it or add other visual feedback.

**Implementation:** Added a gold pulsing marker in `game.js` that appears on
the die the AI moves: a ring around the die base plus a bobbing arrow above it
(gold `#ffcc00`, matching the AI "ACTIVE" HUD color). It appears at the moment
the AI picks its move, follows the die through the roll/slide animation, and
lingers ~1.1s so the move is readable. Battle-mode only — player moves and
other modes are unaffected. Marker is hidden on game over/quit/new game and
cleaned up on all transitions.

**Verification:**
- Battle-mode headless check: marker visible on AI moves, +831 gold pixels on
  screen vs baseline, AI board changes confirmed, zero console errors.
- Full regression playtest: PASSED (52/53 moves landed, 0.03% visual drift,
  zen effects verified).
- Deployed: live at http://localhost:8000 (server confirmed serving new code).
