# Claude Control Bar — Design Brief
## A macOS Menu-Bar Utility for Managing Local Claude Code Sessions

---

## 1. DESIGN PHILOSOPHY

**Core Principles:**

1. **Restraint Over Spectacle**
   This is a utility, not an experience. Every visual element must earn its place through clarity or calm functionality. The Marauder's Map motif is *scent*, not scenery—woven in through texture, metaphor, and animation, never through literal imagery or distracting ornamentation.

2. **Ambient Awareness**
   The app's primary job is to be *forgettable* until you need it. Status at a glance (via the menu-bar glyph and row colors), subtle micro-animations that say "something is happening" without demanding attention, and a popover that opens quiet and uncluttered.

3. **Metaphor as Narrative**
   Footprints = movement = active sessions. This isn't decoration; it's semantic. The presence or absence of footprints, their movement, and their "fading" (into idle/paused states) tell the story of what's happening *without* needing labels or status badges.

4. **Dark/Light Parity**
   Not "dark mode as an afterthought." Both themes are co-designed, with palettes that feel equally native, calm, and legible. The textural elements (map contours, ink) shift in opacity and tone to feel appropriate in each context.

5. **Calm Interaction**
   No abrupt state changes, no flashing, no FOMO. Countdowns breathe. Buttons have generous touch targets but minimal visual weight. Disabled states are soft, not screaming. The app respects the user's focus on *other* windows.

---

## 2. LIGHT & DARK THEMING

### Palette Foundation

**Semantic Status Colors** (work in both light and dark modes via careful hue/saturation tuning):

| Status | Light Mode | Dark Mode | Usage | Notes |
|--------|-----------|-----------|-------|-------|
| **Idle** | `#A0A0A0` (neutral grey) | `#707070` (lighter neutral grey) | Row text, subtle glyph when no activity | Desaturated; invites no attention |
| **Working** | `#4A90E2` (cool blue, muted) | `#6BA3F5` (same hue, higher brightness for dark) | Active row, animated glyph, pulse | Not pure blue; desaturated. Feels considered, not alarm-y |
| **Needs-You** | `#E8A935` (warm amber, muted) | `#F0B545` (same hue, lifted for dark) | Permission prompt row, flag icon | Warm but not aggressive. Invites attention; doesn't demand it. |
| **Paused (Usage Limit)** | `#C1C1C1` (soft grey, slightly desaturated blue tint) | `#5A5A5A` (dark grey with blue tint) | Paused row background, disabled input | Feels "held," not error-state |

**Backgrounds & Surfaces:**

- **Light Mode Popover:**
  - Background: `#FAFAF9` (off-white with 1% warmth, nearly pure white but *just* warm enough to feel like aged parchment without being obvious)
  - Row hover/select: `#F0EFED` (very subtle warm grey; 0.5–1px darker than background)
  - Dividers: `#E8E8E6` (soft warm grey, 1px hairline)
  - Text: `#1A1A1A` (nearly black; not pure black for gentleness)

- **Dark Mode Popover:**
  - Background: `#1E1E1C` (very dark charcoal with 1% warmth, *not* pure black; suggests aged parchment by proximity)
  - Row hover/select: `#2A2A27` (subtle warm lift, maintains contrast)
  - Dividers: `#353532` (dark warm grey, 0.5px hairline for delicacy)
  - Text: `#F5F5F3` (off-white with warmth; not pure white)

**Texture & Opacity:**

- **Map Contour Layer** (applied subtly to popover background):
  - A faint, repeating topographic-line texture (very subtle pen-stroke curves, like old map contours)
  - Light mode: opacity `2–3%` over the background (nearly imperceptible; felt more than seen)
  - Dark mode: opacity `1–2%` (even fainter, because dark backgrounds risk looking "grungy" if texture is too bold)
  - Technique: Use a CSS `background-image` (SVG or PNG) with low opacity, or a very subtle grain/noise filter with warm tones
  - **Test ruthlessly:** Show to 5 people. If more than 1 asks "is something wrong with the image?", reduce opacity by 50%.

- **Ink Lines & Dividers:**
  - Replace hard dividers with soft 0.5–1px hairlines (never 2–3px)
  - Dividers inherit the text color at 10–15% opacity (blend naturally, not a "rule")
  - Footprint animationtrails (see below) use ink-drawn character (a very subtle stroke, not filled)

---

## 3. TYPOGRAPHY & SPACING

**Typography:**

- **Font Family:** System font stack (SF Pro, -apple-system, system-ui); *no* custom fonts. Restraint.
- **Menu-bar Glyph:** Icon only; footprint symbol at 16–18px in system bold/semibold weight
- **Session Row - Project/CWD:** 13px, semibold, `#1A1A1A` (light) / `#F5F5F3` (dark)
- **Session Row - Status + Last Activity:** 11px, regular, status color (idle/working/needs-you) or secondary text color
- **Button Labels (Allow/Deny, Auto-Resume, Reply):** 12px, semibold, using semantic color (not black)
- **Empty State Message:** 13px, regular, secondary text (60% opacity vs. primary text)
- **Countdown Timer Text:** 11px, monospace (SF Mono), muted amber (same as needs-you)

**Spacing & Density:**

- **Popover Padding:** 12px horizontal, 8px vertical (snug but not cramped)
- **Row Height:** 44–48px (generous touch target, not cramped; comfortable for trackpad/mouse)
- **Gap Between Rows:** 1–2px (visual breathing; one hairline divider per row, or none with just the gap)
- **Section Padding (e.g., between overview and permission prompt):** 8px vertical
- **Button Padding:** 8px horizontal, 6px vertical (icon + text inside a soft rounded rect)
- **Corner Radii:** 6–8px for popover, buttons, and session row highlights; 10–12px for larger modals (permission detail) — *soft* but not iPhone-like rounded blobs

---

## 4. MARAUDER'S MAP FLAVOR WITH RESTRAINT

### Tasteful Integration

**A. Footprint as Status Indicator**

- **Menu-bar Glyph:**
  - Idle: Single footprint, `#707070` (dark mode) / `#A0A0A0` (light mode), static
  - Working: Footprint with a *subtle* "walking" animation—footprints appear to step forward in a slow 2–3 second loop (or a very gentle pulsing glow around the footprint, like it's "lighting up")
  - Needs-You: Footprint in amber (`#E8A935` / `#F0B545`), *no* animation (stillness = "waiting for you")
  - Paused: Footprint faded/desaturated, possibly with a faint diagonal hatching or translucent overlay (visual "frozen" state)

- **Session Row Status Indicator (left edge):**
  - A 2–3px left border on each row in the semantic status color
  - *Or* a tiny footprint icon (12–14px) at the start of each row, colored by status, animated subtly if working (gentle scale pulse: 95% → 100% → 95%, 2s loop)
  - Option: If using the footprint icon per row, make it *very* small and soft (don't make the icon feel separate; it's a glyph, not a graphic)

**B. Map Contours & Ink**

- **Parchment Texture:**
  - As described in section 2: low-opacity topographic lines in the popover background
  - *Not* a "scroll" or "parchment paper" photo; just faint, elegant line-work
  - Think: the very faint grid/crosshatch you'd see on an old survey map, not the rolled-up-scroll aesthetic

- **Hairline Dividers:**
  - Dividers between sessions and sections use a very soft ink-drawn aesthetic: slightly irregular, 0.5–1px, warm-toned
  - Use `border-bottom: 1px solid rgba(0, 0, 0, 0.12)` (light) or `rgba(255, 255, 255, 0.08)` (dark), slightly tapered or feathered if technically feasible (CSS `box-shadow` trick)

**C. Flavor Text (Empty State Only)**

- When there are no active sessions, show a brief, understated message:
  - *"No footprints yet. Start a session to begin."* (or)
  - *"All footprints have faded."* (or)
  - *"Waiting for movement…"*
  - Style: 11px, secondary text color at 70% opacity, centered, 20px top/bottom margin
  - **Never** use actual spell quotes or trademarked phrases; the flavor is metaphor, not fandom

**D. Ink-Drawn Animation Trails (Experimental)**

- If implementing an animated glyph showing active sessions, consider a *very* subtle "ink-drawn" effect: a thin line that traces a footprint path onscreen as the session becomes active
- This would be a micro-animation (<1 second) on the session row or menu-bar glyph when status changes from idle to working
- **Only if:** it can be done at <15ms frame rate smoothly; otherwise, skip (don't compromise performance for flavor)

### Anti-Patterns & Kitsch to Avoid

**DO NOT:**

1. **Use literal Harry Potter language or references** — no "I solemnly swear," "Marauders," "magic," etc. (unless the user explicitly asks). The app is *inspired by* the motif, not branded by it.
2. **Add decorative illustrations** — no wands, owls, cauldrons, or map scenery. No small character illustrations in corners.
3. **Overuse texture** — more than 3% opacity on the contour layer in light mode = visual noise, not elegance. Test early.
4. **Animate everything** — only the glyph and active session rows should animate. Everything else is static. Blinking, flashing, or constant motion = anxiety-inducing, not delightful.
5. **Mix metaphors** — footprints are the motif. Don't add "wand waves" or "spell effects." Consistency matters.
6. **Create a "gamified" UI** — no progress bars disguised as potions, no level-up effects, no achievement badges. This is a tool, not a game.
7. **Force dark/grungy aesthetics in dark mode** — dark mode should feel like aged parchment *in moonlight*, not a dark tavern. Keep it clean and cool.
8. **Use color alone for status** — always pair color with position (left border), a glyph (footprint icon), or text (status label).

**The Line:**

- **Delightful:** A glyph that gently pulses when active, faint texture that you notice only when you look closely, a single metaphor (footprints) that's consistent across all states
- **Overdone:** A glyph that spins or bounces, texture you see immediately, multiple metaphors (footprints *and* map lines *and* ink splatters), explicit Harry Potter references, or animations that interrupt focus

---

## 5. SCENARIO SURFACES & UX GUIDANCE

### 5.1 Overview List (Default State)

**What it shows:** All sessions, color-coded rows, one per row. Focus is **calm scanning**.

**Hierarchy & Emphasis:**
- Session identifier (project name or `~/path/to/cwd`) is the primary read: 13px semibold, highest contrast
- Status (working/idle/needs-you) is secondary: color + icon (footprint or left border) + optional small text label (11px, muted)
- Last activity timestamp: tertiary, 11px, 50% opacity, right-aligned
- A small "usage battery" meter (see below) can sit in the top-right corner of the popover, 60–80px wide, unobtrusive

**Footprint Motif:**
- Working rows: animated footprint icon (pulse or walking cycle, 2–3s loop)
- Idle rows: static grey footprint icon
- Needs-you rows: static amber footprint icon
- Paused rows: faded/translucent footprint icon

**Interaction:**
- Hovering a row slightly lifts it (`background-color` shift to `#F0EFED` light / `#2A2A27` dark) and makes the row feel "interactive" (cursor pointer)
- Clicking a row either opens the session detail (if owned) or does nothing (if external)
- No click is required to see basic status; the visual is self-sufficient

---

### 5.2 Permission Request (Needs-You State)

**What it shows:** A single row or modal prompting the user to approve/deny a permission the Claude Code session is requesting.

**Hierarchy & Emphasis:**
- The request itself: *"Allow access to [system resource]?"* — 13px, bold, primary text
- Brief explanation: 11px, 70% opacity, one line max ("This helps the session read your file system", etc.)
- Countdown: 11px, monospace, muted amber, right-aligned ("Expires in 45s")
- Buttons: Allow (blue, semantic working color) and Deny (grey, neutral) — 12px, 8–10px padding, 6px corner radius, soft shadows

**Visual Cue:**
- Amber row border (left 2–3px) and row background tinted very lightly with amber (4–6% opacity tint)
- Optional: a small amber footprint icon *with a small exclamation mark or "!" overlay* (subtle, not aggressive)
- The row should feel "active" (slightly elevated shadow) without feeling like an error state

**Interaction & Animation:**
- The countdown timer gently fades as time runs out (text opacity drops from 100% → 50% in the final 10 seconds)
- Buttons have soft hover states: 2–3% lightness shift, no bold transitions
- If the timer expires, the row fades out and is removed (over 300ms); the session reverts to a "paused" or "denied" state
- **Restraint:** No flashing, no beeping, no vibration. Silent and calm.

---

### 5.3 Owned Session Detail (Reply Box Active)

**What it shows:** A drill-down into a session the user owns (i.e., can interact with). Includes session info, conversation history (optional; could be just the last exchange), and an input box for sending a reply.

**Hierarchy & Emphasis:**
- Session header: project name + status indicator (12px semibold, status color)
- Brief context: *"Running Python analysis in ~/projects/ml/"* (11px, 70% opacity)
- Conversation snippet or last message (if applicable): 12px, regular, monospace background (very subtle, `#F0EFED` light / `#2A2A27` dark)
- Input box: 44px tall, "Reply…" placeholder, semibold 13px, soft border (`1px solid divider-color`), focus state is a 1px inset shadow (no bold outline)
- Send button: inside the input (far right), tiny arrow icon (→ or ⏎), blue, 24px square with 6px corner radius

**Footprint Motif:**
- The animated footprint glyph in the session header pulses or "steps" gently as long as the session is active
- If the session is working on your input, the footprint continues its animation after you send

**Interaction:**
- Input field is always enabled and focused (if this detail view is open)
- Sending a message: the input clears, and the message appears briefly in the conversation snippet (or just disappears, for simplicity)
- No loading spinner; instead, the footprint continues its subtle animation to indicate the session is processing
- **Restraint:** No success pop-up, no confetti. Just a calm, functional reply exchange.

---

### 5.4 Attached/External Session Detail (Monitor-Only)

**What it shows:** A drill-down into a session the user doesn't own (e.g., another Claude Code instance running elsewhere). Shows info and recent activity but *no* input box.

**Hierarchy & Emphasis:**
- Session header: project name + "External" or "Attached" label (11px, secondary text color)
- Status + last activity: same as owned detail
- Last message or activity log (read-only): 11px, monospace, in a soft box with faint border
- A note at the bottom: *"This session is managed elsewhere. You can view its progress here."* (10px, 50% opacity, center-aligned, italic or secondary text color)

**Footprint Motif:**
- The footprint glyph is present but *not* as dynamic as owned sessions (optional subtle pulse, but very muted compared to active owned sessions)
- Visually, it's "watching" the footprints of another session, not controlling them

**Interaction:**
- Read-only. No buttons, no input. User can close this detail and return to the list.
- Clicking on the activity log does nothing (no affordance for interactivity)
- **Restraint:** This is a passive view; the UI should feel calm and observational.

---

### 5.5 Usage Limit / Paused State Row

**What it shows:** A session has hit the usage limit and is paused. Shows the pause reason and an "Auto-Resume" toggle.

**Hierarchy & Emphasis:**
- Status: *"Session paused (usage limit)"* — 12px, semibold, status color (soft grey/blue tint, #C1C1C1 light / #5A5A5A dark)
- Explanation: *"Claude Code will resume when your limit resets at [time]"* (11px, 70% opacity)
- Toggle: "Auto-Resume" (11px, semibold), with a soft toggle switch (macOS-native style: oval, 40px wide, `#C1C1C1` background, white dot)

**Footprint Motif:**
- Footprint icon is faded/desaturated (60% opacity) and possibly has a subtle "frozen" visual (very faint crosshatch or overlay)
- No animation. The footprint is *still*, reinforcing the pause state.

**Interaction:**
- Toggle switch enables/disables auto-resume. On toggle, a brief confirmation message appears: *"Will auto-resume ✓"* (9px, green, fade out after 1.5s)
- If auto-resume is enabled and the limit resets, the session smoothly returns to idle state (no harsh transition)
- **Restraint:** No countdown timer here (unlike permission prompts). The user has control; let them decide.

---

### 5.6 Empty State (No Sessions)

**What it shows:** The popover when there are no active or recent sessions.

**Hierarchy & Emphasis:**
- Centered message: *"No footprints yet. Start a session to begin."* (13px, regular, 70% opacity)
- Optional flavor line (only here, nowhere else): *"All footprints have faded."* (11px, 50% opacity, italic)
- Call-to-action button: "Start a New Session" (12px, semibold, blue, soft rounded rect)

**Visual:**
- The empty popover is completely serene: just the background color, the message, and the button. No placeholder illustrations or decorative elements.
- The button has a subtle 1px border and a soft shadow on hover, making it feel interactive but not aggressive

**Interaction:**
- Clicking "Start a New Session" opens the user's terminal (Warp or Terminal.app) with Claude Code CLI ready to go
- The popover closes; the glyph returns to idle state
- **Restraint:** No animation, no emoji, no "lonely" tone. Just calm and actionable.

---

### 5.7 Usage Battery Meter

**What it shows:** A small visual indicator of the user's Claude Code usage against their limit.

**Design:**
- A horizontal bar, 60–80px wide, 6–8px tall, soft 6px corner radius
- Background: very light grey (`#E8E8E6` light / `#35353240%` dark, semi-transparent)
- Fill: a gradient or solid color (blue to amber, or just working-blue), sized to the usage percentage
- Optional: a tiny label (8px, monospace, "72% used") to the right or inside the bar (if space allows)

**Placement:**
- Top-right corner of the popover (inside the padding, about 12px from the top-right corner)
- Small and unobtrusive; it's informational, not a primary focus

**Interaction:**
- Hovering the meter shows a tooltip: *"72% of monthly usage"* (appears after 500ms, fades out on mouseout)
- No click action; it's read-only

**Footprint Motif:**
- Optional: the fill color transitions from working-blue to needs-you-amber as usage approaches the limit (semantic color shift)
- No animation; it's a static progress indicator

> **NOTE — superseded in the final designs:** the usage meter is now a separate **hourglass** glyph (not a battery), and the **footprint encodes session state only, never usage**. See `plan.md` §5.8 and §6, and `final-designs.html`.

---

## 6. MICRO-INTERACTIONS & ANIMATION GUIDANCE

**Philosophy:** Animations should be **felt, not seen**. They're part of the ambient experience, supporting focus, not breaking it.

### What SHOULD Animate

1. **Menu-bar Glyph (Working State)**
   - A subtle footprint "walking" cycle or pulsing glow (2–3 second loop, easing function is `ease-in-out`)
   - Opacity pulse: 100% → 80% → 100% (or scale: 100% → 105% → 100%)
   - Duration: 2.5s, infinite loop
   - Cubic bezier: `cubic-bezier(0.4, 0, 0.6, 1)` for smoothness
   - **Alternative:** A very faint circular glow that expands and fades around the footprint (radius: 0 → 8px, opacity: 100% → 0%, 2s loop)

2. **Session Row Footprint Icon (Active)**
   - Same as menu-bar glyph: gentle pulse or scale (95% → 100% → 95%, 2s loop)
   - Only animates when session status is "working"
   - Starts/stops instantly when status changes (no fade-in/out of the animation itself)

3. **Row Hover State**
   - Background color shift: `#FAFAF9` → `#F0EFED` (light) or `#1E1E1C` → `#2A2A27` (dark)
   - Duration: 150ms, easing: `cubic-bezier(0.4, 0, 0.6, 1)`
   - A very soft box-shadow appears on hover (0px 2px 8px rgba(0,0,0,0.06) light / rgba(0,0,0,0.15) dark)

4. **Button Hover/Active States**
   - Background shift: 2–3% brightness change, 100ms
   - Shadow on hover: 0px 2px 6px rgba(0,0,0,0.08) light / rgba(0,0,0,0.2) dark
   - Press (active): shadow increases to 0px 4px 12px, very brief (50ms)

5. **Countdown Timer (Permission Prompt)**
   - Text opacity fades: 100% → 50% in the final 10 seconds (linear fade, no jitter)
   - Duration: 10s, starting when 10s remain
   - **Optional:** a very faint color shift from amber to red in the final 5 seconds (6–8% opacity tint change)

6. **Popover Entry/Exit**
   - Fade-in: opacity 0% → 100%, 150ms, `ease-out`
   - Slide-up (optional, if you want more flavor): transform `translateY(4px) → translateY(0)` simultaneously with fade, 150ms
   - Exit: reverse, 100ms (faster closeout feels snappier)

7. **Session Row Fading (When Removed/Paused)**
   - Opacity fade: 100% → 0%, 300ms, `ease-out`
   - Optional: slight scale-down (100% → 98%) during fade for a subtle "shrinking" effect

8. **Message Confirmation (e.g., "Will auto-resume ✓")**
   - Fade-in: 150ms, `ease-out`
   - Dwell: 1.5s at full opacity
   - Fade-out: 150ms, `ease-out`
   - Total duration: 1.8s

### What SHOULD NOT Animate

- **Divider lines** — static always
- **Text labels** — static (except countdowns, which fade, not animate letter-by-letter)
- **Backgrounds** (except on hover) — no color transitions, no gradients shifting
- **Session status indicators** (left border or text) — color changes instantly (no transition) when status updates
- **Disabled states** — no "greyed out" fade-ins; they're instantly present
- **Scrolling content** — if session history or activity log is present, scrolling is instant (no smooth scroll in this context; it's too small and would feel laggy)

### Timing & Easing

- **Default easing:** `cubic-bezier(0.4, 0, 0.6, 1)` (smooth, not bouncy or snappy)
- **Entrance (popover, messages):** `ease-out` (fast start, slow end; feels natural)
- **Exit (rows removed, notifications fade):** `ease-out` (same logic)
- **Loops (glyph pulse):** `ease-in-out` (symmetrical, meditative feel)
- **All durations:** keep < 300ms for interactivity (except loops), < 200ms for micro-interactions

**Frame rate:** Aim for 60fps; if the device can't support smooth animation at this rate, disable animation and go static (degradation, not jankiness).

---

## 7. ACCESSIBILITY

### Color-Blindness Safety

Since status is color-coded (idle grey, working blue, needs-you amber, paused grey), **never rely on color alone**:

1. **Always pair color with shape/icon:**
   - Use a footprint icon (always present) + left border color
   - Or footprint icon + left border + optional status text label (e.g., "Working" in 10px next to the footprint)

2. **Test with colorblind-safe palettes:**
   - The chosen blues (`#4A90E2` light, `#6BA3F5` dark) and ambers (`#E8A935` light, `#F0B545` dark) are chosen to remain distinct for red-green colorblind users
   - Test the palette with [Contrast Ratio](https://contrast-ratio.com/) and a colorblind simulator (e.g., [Coblis](https://www.color-blindness.com/coblis-color-blindness-simulator/))
   - Aim for at least 3:1 contrast between semantic colors and neutral greys, 4.5:1 for text

3. **Iconography as primary:**
   - The footprint is the primary status indicator. Color is secondary and supporting.
   - Idle: footprint (grey)
   - Working: footprint (blue) + optional glow/pulse animation
   - Needs-you: footprint (amber) + optional exclamation-mark overlay
   - Paused: footprint (faded grey with optional hatching)

### Contrast in Both Modes

**Light Mode:**
- Text vs. background: primary text (`#1A1A1A`) on `#FAFAF9` = 15:1 contrast (excellent)
- Secondary text (70% opacity) vs. background: ~5.5:1 contrast (WCAG AA, acceptable for secondary content)
- Divider (`#E8E8E6`) vs. background (`#FAFAF9`): 1.3:1 (subtle but discernible on hover)

**Dark Mode:**
- Text vs. background: primary text (`#F5F5F3`) on `#1E1E1C` = 14:1 contrast (excellent)
- Secondary text (70% opacity) vs. background: ~4.8:1 contrast (WCAG AA)
- Divider (`#35353240%`) vs. background (`#1E1E1C`): slightly faded but legible

**Semantic Colors (Contrast with Background):**
- Working blue (`#4A90E2` light) on `#FAFAF9`: 8:1 contrast (AA for large text; AAA for 14px+)
- Needs-you amber (`#E8A935` light) on `#FAFAF9`: 7:1 contrast (AA)
- Same in dark mode (colors are lifted; contrast remains solid)

### Motion & Vestibular Sensitivity

1. **Respect prefers-reduced-motion:**
   ```css
   @media (prefers-reduced-motion: reduce) {
     /* Disable all animations */
     * { animation: none !important; transition: none !important; }
   }
   ```

2. **Avoid flashing/strobing:**
   - No animations that cycle faster than 3 Hz (3 times per second)
   - Our animations (2–3s loops) are well below this threshold

3. **Gestalt & cognitive load:**
   - The popover should never require scrolling (keep session list concise; old sessions fade from the list)
   - The UI is scannable in <2 seconds; no dense walls of text
   - Countdowns are linear (not exponential), so time passage feels predictable

### Keyboard Navigation (Optional but Recommended)

- **Tab order:** Allow/Deny buttons → Auto-Resume toggle → Reply input → Send button → "Start New Session" button
- **Enter key:** In the reply input, `Enter` sends the message (or `Cmd+Enter` for multi-line support)
- **Escape key:** Closes the popover or exits the detail view
- **Arrow keys:** (Optional) Up/Down arrows cycle through session rows when the popover is focused

---

## 8. VISUAL SUMMARY TABLE

| Element | Light Mode | Dark Mode | Notes |
|---------|-----------|----------|-------|
| **Popover Background** | `#FAFAF9` | `#1E1E1C` | Warm off-white/dark charcoal |
| **Primary Text** | `#1A1A1A` | `#F5F5F3` | Nearly black/off-white |
| **Secondary Text** | `#1A1A1A` @ 70% | `#F5F5F3` @ 70% | Reduced opacity |
| **Idle Status Color** | `#A0A0A0` | `#707070` | Neutral grey |
| **Working Status Color** | `#4A90E2` | `#6BA3F5` | Muted cool blue |
| **Needs-You Status Color** | `#E8A935` | `#F0B545` | Muted warm amber |
| **Paused Status Color** | `#C1C1C1` | `#5A5A5A` | Soft grey/blue-tint grey |
| **Divider Color** | `#E8E8E6` @ 50% | `#35353240%` | Soft hairline |
| **Row Hover Background** | `#F0EFED` | `#2A2A27` | Subtle warm lift |
| **Button Background (Primary)** | `#4A90E2` | `#6BA3F5` | Working blue |
| **Button Background (Neutral)** | `#A0A0A0` | `#707070` | Idle grey |
| **Focus Outline** | `1px inset shadow, working blue` | `1px inset shadow, working blue` | Soft, not harsh |
| **Map Contour Texture Opacity** | 2–3% | 1–2% | Very faint topographic lines |
| **Corner Radius** | 6–8px | 6–8px | Soft, not iOS-like |
| **Box Shadow (Hover)** | `0px 2px 8px rgba(0,0,0,0.06)` | `0px 2px 8px rgba(0,0,0,0.15)` | Subtle elevation |

---

## 9. DO's & DON'Ts CHECKLIST

### DO

- Use footprints as the *only* metaphor; be consistent
- Pair color with icon/shape for status indication
- Test all colors in both light and dark modes; ensure they feel native to each
- Keep animations < 300ms; use `ease-in-out` or `ease-out`
- Use soft, 0.5–1px hairlines for dividers
- Maintain high contrast (4.5:1 minimum for text)
- Honor `prefers-reduced-motion`
- Keep the popover uncluttered (max 6–8 session rows before scrolling)
- Use generous touch targets (44–48px row height)
- Keep texture opacity very low (test relentlessly)

### DON'T

- Use multiple metaphors (no wands + footprints + spell effects)
- Animate everything; only active elements (glyph, working rows, hovers)
- Use pure black/white; always go off-white/dark charcoal
- Apply heavy shadows or 3D effects
- Add decorative illustrations or characters
- Use color alone to communicate status
- Exceed 3% texture opacity in light mode
- Force dark mode to look "edgy" or "grungy"
- Use Harry Potter trademarked language or explicit references
- Ignore accessibility (colorblindness, contrast, motion sensitivity)
- Make the app "cute" or "gamified"

---

## 10. IMPLEMENTATION PRIORITIES

### Phase 1 (MVP)
- Menu-bar glyph (idle/working/needs-you static, no animation)
- Session list (overview, color-coded rows)
- Permission prompt (Allow/Deny buttons, countdown)
- Empty state
- Usage battery meter

### Phase 2 (Enhancement)
- Owned session detail with reply box
- External session detail (monitor-only)
- Glyph animation (pulse/walking)
- Popover entry/exit animation

### Phase 3 (Polish)
- Paused/usage-limit state with auto-resume toggle
- Map contour texture (if it passes accessibility tests)
- Message confirmation animations
- Keyboard navigation
- Hover state refinements

---

## CLOSING NOTE

This design balances restraint with flavor. The footprint motif is *earned*—it appears in every status indicator, every animation, every color choice (working = footprints moving; idle = footprints still; needs-you = footprints waiting). The Marauder's Map feeling comes from texture, metaphor, and careful color, not from literal imagery or kitsch.

Test early with real users. If the texture reads as "something's wrong with the image," it's too bold. If the animations feel like they're demanding attention, they're too loud. If a user asks "where's the wand?" you've lost the restraint.

The goal: an app that feels like a beloved macOS utility—quiet, thoughtful, and perfect for its job.
