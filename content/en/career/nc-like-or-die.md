---
# 경력 섹션 하나 = 이 파일 하나입니다.
# --- 사이(앞부분)는 요약 정보, 아래 본문은 '경력 상세' 펼침 목록이 됩니다.
# 여러 줄 값에 |- 를 쓰면 엔터가 화면에서도 줄바꿈이 되고, 빈 줄은 문단을 나눕니다.

company: NCSOFT
title: Like Or Die
title_url: https://likeordie.plaync.com/ko-kr/conts/260826_teasing
period: 2025.10 ~ Present
duration: Unreleased new title, {like-or-die} so far
engine: Unreal Engine 5
role: >-
  Unreal Engine 5 client development, sound/spatial audio systems, replay,
  performance optimization, editor tools/ML R&D

image: images/likeordie.webp
image_alt: Like Or Die key art

summary: |-
  Built **gameplay foundations** as Client Programmer on NCSOFT's new FPS **Like Or Die**. Drew on strengths from previous engine team to deliver **optimization and tooling**, shortening team **development iteration**.

  Used AI extensively. Went beyond simply using LLMs to research and apply **how ML and local LLMs could be brought into the project**.

highlights:
  - title: Sound / Spatial Audio
    text: |-
      Designed everything from Wwise playback architecture to spatial audio computation.
      - Routed all playback through **a single sound subsystem** with **audio component pooling**
      - Computed **occlusion / enclosure in real time in-house** instead of using Wwise built-in Spatial Audio
      - Played blocked sounds from **virtual sources along detour path**
  - title: Performance
    text: |-
      Compared before/after 1:1 in Unreal Insights to find root causes, then fixed them in engine source.
      - [VFX load −76%, editor first frame −56%, first-shot frame −44%, match-start low FPS −40%](#impact)
  - title: Replay
    text: |-
      Built required features at project level on top of engine replay (DemoNetDriver).
      - **Recording / saving**, event-based **clip replay**
      - **State restoration after Seek**, **spectate target tracking**
  - title: AI (ML)
    text: |-
      Built editor tool that **recommends footstep notifies** using model trained on foot bone trajectories.
      - PyTorch training → ONNX → **UE5 NNE** editor inference
      - Event matching **F1 0.899**, zero false generations on clips where feet never touch ground

stack:
  - group: Engine / Editor
    items:
      - Unreal Engine 5
      - Slate
      - NNE (NNERuntimeORT)
      - DemoNetDriver
      - Niagara
      - Mutable
      - Unreal Insights
      - Tasks System
      - Asset Registry
  - group: Languages / Scripting
    items:
      - C++
      - Python (PyTorch, ONNX)
  - group: Plugins / Solutions
    items:
      - Wwise (Spatial Audio, Motion, Localization, WAAPI)
  - group: Build / Platform
    items:
      - TeamCity
      - Perforce
      - Windows
  - group: Operations / Collaboration
    items:
      - Confluence
      - Jira
      - Teams (Incoming Webhook)

rnd_note: R&D items were self-initiated rather than issue-driven, researched independently and then proposed back to the game design team.

links:
  - label: Game Teaser
    url: https://likeordie.plaync.com/ko-kr/conts/260826_teasing
  - label: Official Trailer (YouTube)
    url: https://www.youtube.com/watch?v=Ap1cVaAhQ9I
  - label: Notion Details
    url: https://app.notion.com/p/NC-Like-Or-Die-336bed59c363809989dbee84d20509f8
---

## AI (ML)-Based Animation Notify Recommendation (R&D) {#ml-notify}

Built tool that runs ONNX model trained on foot bone trajectories in the editor to **recommend frames for footstep notifies and apply them in one pass**.

### Limits of Rule-Based Detection

Reference height varied per animation, and lowest foot frame often didn't match actual ground-contact frame. Foot drags and slides were also misread as contact, so no single threshold could decide.

Instead, reused notifies already placed by hand in existing assets as ground-truth labels. Trained and applied model that **learned existing judgment criteria as-is**.

### Architecture

Used rules for preprocessing only. Filtered out additive animations and segments with foot speed under 25cm/s to narrow search range; left per-frame contact decisions to model.

Integrated into editor as foot bone trajectories → **PyTorch training → ONNX conversion → UE5 NNE (NNERuntimeORT) C++ inference**.
Cached model to avoid reloading per asset.

### Tool

Built candidate list and batch apply as Slate window.
Split recommendations between legacy generic notifies and dedicated notifies; handled **migration in same tool**.

Locked feature extraction and post-processing specs to match training pipeline exactly, since even slight preprocessing differences collapse accuracy.

### Validation

- Event matching **F1 0.899** (Precision 0.876 / Recall 0.923), tolerance 0.1s (3 frames at 30Hz)
- Measured clips with and without foot contact separately; **zero false notifies on no-contact clips**

**Recall-First Tuning**
- Recommendations applied only after human review in Slate window
- False positives discarded with one uncheck, while misses require scrubbing animation to find frame, so misses cost more
- Measured no-contact clips (where feet never touch ground), where false positives hurt most, separately and held them to **zero generations**

## Unreal Slate-Based Background Notifications (R&D) {#background-notify}

Built feature that **shows separate Slate window when long-running task finishes and brings target window to front on click**. (Windows only)

### Display Conditions

Modeled on **ARC Raiders' queue window**: showed notification on key events such as match found or loading complete while game is in background. Suppressed it while game is in foreground.

Outside gameplay, also popped notification **when Live Coding finishes** so completion is visible immediately, reducing **work iteration** time. Hooked patch-complete delegate to show it even with editor in foreground.

Evolved [tray icon balloon notification from previous project](#prasia--tray-notify) into **game-specific Slate banner**.

[Background notification demo](#like-or-die-lab--notify)

### Working Around Foreground Policy

Windows blocks background processes from bringing their own windows to front. Opened notification as **topmost window that initially takes no focus**, and used user's click as trigger to gain permission.

Raised target window immediately on click. When first click was consumed by OS window activation, traced back with **app activation callback and cursor position** to confirm notification was clicked, then raised window. (One-shot, then released)

Targeted root handle of first top-level window; restored it first if minimized.

### Window Setup

Independent window separate from game window. No title bar or buttons, with per-window opacity.
Placed at bottom right of primary monitor work area with DPI correction; auto-closes after 5 seconds. (Ticker captured by weak reference)

Added **thumbnail captured from player's customized character**, so each player sees notification with their own character.
Managed banner image as asset so it ships in packaged builds; falls back to solid color if load fails.

## Unreal Editor / Runtime Load Performance Analysis and Reduction (R&D) {#load-performance}

Compared Unreal Insights traces **1:1 before and after** (same map, same DDC conditions, with control group) to find bottlenecks, fixing them **directly in engine source** when needed. Key numbers charted in [Impact](#impact).

### 1. Niagara Inheritance Drift: Recompiling on Every Load

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| VFX folder load | 18.4s | **4.5s** | −76% |
| Emitter merges | 299 / 14.7s | **15 / 0.7s** | −95% |
| Redundant loads | 14.6s | **1.1s** | −92% |
| Forced sync flushes | 97 | **1** | −99% |
| PIE frames over 50ms | 204 | **114** | −44% |

**Analysis**
Counted emitter merges in Insights at **290 runs, 14.4s** (10.2% of capture, all on game thread).
Enabled merge ChangeId logging, reloaded, and compared 3 child / parent ChangeIds; confirmed with 2 measured cases why resaving didn't fix it.

**Cause**
ChangeIds were reissued while out of sync and dirty flag was cleared right after merge, so every load repeated merge → linker reset → forced flush.

**Fix**
Cleared long-unapplied parent changes by **batch-resaving 111 assets**.
Built new **editor subsystem** to prevent recurrence. On package save events, walks AssetRegistry referencers via BFS to collect descendant assets and drives merge and save.

### 2. Mutable Plugin Sync Loads: 3-Line Referencer Class Filter

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Editor first frame | 20.8s | **9.2s** | −56% |
| Mutable tick | 19.0s | **7.6s** | −60% |
| First-tick asset load | 9.2s | **1.6s** | −83% |
| Sync package load time | 17.4s | **7.0s** | −60% |
| Unnecessary load scopes | ~190K | **0** | −100% |

**Analysis**
Of 20.84s first frame, **19.0s was a single Mutable streaming tick**. Confirmed by exporting game thread stack.
Located fix point by comparing with same plugin's compiler path, which checks class before loading.

**Cause**
`GraphTraversal::GetNodeGroupObjectNodeMappingImmersive` loaded all referencers before checking class, pulling ~200 anim sequences through character BP / AnimBP into synchronous load on first frame.

**Fix**
Added 3 lines in same function to **check class via AssetData** before loading and `continue` immediately on non-Mutable classes. Sync package loads barely changed (388 → 372) but time dropped by more than half.
Documented remaining 8.5s as cost of loading CO hierarchy itself, a limit of plugin design.

**Engine 5.8 Update**
Engine later fixed same spot (GraphTraversal.cpp) in 5.8 with slightly different approach. Mine skipped referencers one by one; 5.8 filters **at query stage** with `Filter.ClassPaths.Add(UCustomizableObject)`.

### 3. In-Game Effect Spawn Cost: Async Preload + Niagara Component Pooling

Measured across three sessions (A / B / C) in cooked builds.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| First-shot frame | 28.8ms | **16.1ms** | −44% |
| First-shot frame (round 2) | 25.7ms | **12.0ms** | −53% |
| Sync loads in that frame | 17.7ms (12) | **5.1ms (2)** | −71% |
| Component registrations | 2,640 | **324** | −88% |
| Dead components awaiting GC | 1,384 | **296** | −79% |
| Destruction cost per GC | 3.2ms | **0.8ms** | −74% |

**Fix**
Preloaded effects asynchronously before use and held them in in-game cache, preventing GC from unloading and reloading them.
Moved one-shot FX spawns to pooling path and consolidated 8 EffectType tiers.

**Measurement Conditions**
Disabled automatic / parallel GC, pinned timing with manual GC, and repeated sessions to confirm reproducible results.

**Trade-off**
VRAM increases by 56MB. Documented this cost and usage rules as **team guidelines**.

### 4. Match-Start Low FPS: Two-Stage Anim PostLoad Reduction

**Stage 1 Results**

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Low-FPS window | 53s (11–50fps) | **32s (40–80fps)** | −40% |
| Data model PostLoad (893 runs) | 9.0s | **0.06s** | −99% |
| PostLoad per anim | 17.6ms | **6.3ms** | −64% |

**Stage 2 Results**

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Sequence PostLoad (829 runs) | 5.9s | **0.05s** | −99% |
| Total frame time in load window | 46.7s | **37.2s** | −20% |
| Frames over 16.7ms | 497 | **306** | −38% |

**Analysis**
Broke down ~60s window after match start where FPS fell to 10–30 (editor build) in Insights. Of 23s game thread time, **15.2s (66%) was async loading processing**.

Culprit was anim sequence PostLoad. One anim arrived per frame, costing 17.6ms (editor-only data model 11.3ms + sequence 6.4ms) while RT was 6.5ms, making it GT-bound.

**Load Source**
Cross-referenced request roots from streaming Verbose logs with AssetRegistry dependency closure via script. Found 6 anim DBs on spawned weapon (190–230 hard references per DB) pulling in **878 packages (93% AnimSequence)**.

**Stage 1: Deferring ControlRig Initialization**
Applied engine console variable via ini to defer ControlRig hierarchy initialization during anim PostLoad.
Verified in engine code that cook path uses eager initialization, leaving cooked output unaffected.

**Stage 2: Fixing Skeleton GUID Mismatches**
Inserted 32 temporary trace scopes into engine PostLoad chain to track down remaining 6.3ms; 99.9% was **cost of replacing skeleton on every load** due to skeleton GUID mismatch.

Found 548 affected anims via Verbose logs and pinpointed in version control history the point where "anims weren't resaved after skeleton bone merge".
**Batch-resaved 543 of them** and added editor subsystem that prompts resaving affected anims when skeleton is saved.

**Scope Check**
Re-measured in packaged build and window was absent (async loading processing 0.05s). Stated scope as **editor-side perceived improvement**.
Also A/B-tested editor async loading thread. Low FPS dropped to 0s, but cost shifted to loading screen and engine race issues appeared, so put on hold.

### 5. 120fps Bottleneck Analysis: Cutting Client Tick / Anim Evaluation Cost

**Analysis**
PIE 60s trace showed **GT-bound at 13.7ms**. RT 7.5ms and RHI 9.7ms had headroom; not VSync wait either. Subtracting 5.9ms editor-only cost put standalone GT at ~7.9ms, so corrected evaluation baseline first.

Largest game-side GT item was worker anim chain wait at **2.0ms per frame (43% of world tick)**. In first person, hidden third-person full body was spending RigLogic 0.63 + ABP 0.49 + cloth 0.31×2 (body + shadow follower duplicate simulation).

Component ticks ran 120 per frame; classified empty / debug-only / authority-gated ticks with dumpticks.

**Fix: Ticks**
- Removed path where HUD ran an extra time per frame apart from engine actor tick, plus empty HUD ticks
- Disabled server-only ticks on client
- Gated debug-only ticks behind console variable

**Fix: Anim Evaluation**
- Bound shadow mesh cloth to leader pose to remove duplicate simulation
- Applied URO to mannequin; evaluated montages only when off-screen
- Added forced LOD option for hidden unified body in first person
- Added off-screen tick option for weapon meshes (including magazine meshes)

## Sound System (Wwise) {#sound}

Designed **layer that computes occlusion / enclosure directly** in place of Wwise built-in spatial audio, plus **playback foundation layer** that carries those values. Occlusion flow can be explored hands-on in [Spatial Audio Demo](#spatial-audio).

Wwise Spatial Audio relies on hand-placed Rooms / Portals, but Like Or Die lets players place blocks that change space mid-game, so chose **real-time computation** for occlusion.

- **Sound subsystem (playback gateway + component pooling)**
  Routed all playback through this single gateway. Pool **lends / returns** ownerless audio components, so even one-shot 3D sounds carry occlusion values without spawn cost.
  Sized pool proportional to physical RAM; timer gradually reclaims surplus components.
  Registered fresh Wwise game object on each lend so no stale switch / RTPC carries over. Held bank / event load handles during playback so GC never cuts sound off.
- **Occlusion**
  Converted level collision AABBs into **cell grid**; computed occlusion factor from **A\* detour path length ratio** only when direct ray is blocked.
  Made grid **double-buffered** so search and rebuild never block each other; normally updates incrementally around listener only.
- **Perceived direction (virtual source)**
  To keep blocked sound from coming through walls, walked A\* path from listener and placed **virtual source at last still-visible point (door, wall edge)**, using path length as distance.
  Moved Wwise game object to that spot so sound comes from doorway. Compare by toggling "Hear from detour direction" in [Spatial Audio Demo](#spatial-audio).
- **Enclosure**
  Cast **26-direction async rays** from character head position; computed space size and degree of enclosure from hit distance distribution.
  Applied per-direction weights (up / middle / down) and per-material absorption coefficients of hit surfaces.
- **Real-time load management**
  Cached static objects as AABBs; also cached dynamic objects such as newly placed blocks as AABBs on spawn.
  Ran search on **Unreal Tasks multithreading** to cut game thread load and cast rays as **async traces** to reduce hitches.
  Ran grid update / occlusion / enclosure on separate-interval timers; **auto-disabled computation** when game thread frame rate drops below threshold.
- **Spectator / replay support**
  Listener reference point is position-based, so spectating, replay, and pawn swaps all run through same path.
- **Wwise localization (R&D)**
  Made **Wwise voice language switch together** with game language setting. Handled language switch failure callback.
  Built cheats and guide for verifying language switch and playback. Wwise Motion pad vibration is under "Other".
- **Offline render / verification tool**
  Read event list via WAAPI and applied switch / state to export **files playable directly via offline rendering**. Also generated valid combinations from bank json, enabling Wwise output review without launching engine.

## Replay System {#replay}

Engine replay (DemoNetDriver) only records and plays back replication stream. Built **save ownership, replay-only pawn / camera, clip cutting, state restoration after Seek, and spectate target tracking** at project level.

- **Recording / saving**
  Replay subsystem manages recording start, stop, and save path.
  Supported both **client recording and dedicated server recording**; custom network version cleanly rejects files from different builds.
  Client recording suits first-person playback but misses anything outside sync range; server recording captures everything but adds file transfer and storage cost on server. Moved playback state ownership from subsystem to DemoNetDriver.
  Also added retention policy, feature hiding, and higher recording rate.
- **Replay-only controller / pawn / camera**
  Split input path so camera moves even while paused.
  Added free camera mode and unified spectator camera through PlayerCameraManager. Also fixed view target setup order issue.
- **Clip replay**
  Logged kill / damage events during recording and **played back only clip cut around that event**. (Seek → play set duration → return to lobby)
  Looked up events by network identifier; split jump-to-live-end behavior into console variable. Verified Seek re-entry and split time standard into internal absolute time and UI relative time.
- **State restoration after Seek**
  States missing from checkpoints don't come back after Seek, so **realigned presentation all at once** when Seek completes.
  Added previously unreplicated values under **replay-only replication condition**, adding no network bandwidth to live play. Equipment slot mirror values, team identifier replication, single update owner, and switching dynamic components to initial creation follow same pattern.
  Excluded instanced meshes from replication since visual state callback updates them, and added path to clean up leftover instances after Seek.
- **Spectate target tracking**
  Switched tracking reference from pawn to player state so tracking persists across pawn changes.
  Unified first-person spectator scope with attached actor rendering; corrected view direction with custom yaw replication.
- **UI / stabilization**
  Built replay HUD and timeline widget, lobby list (match info / revision), loading screen, and fade back to lobby on exit.
  Corrected objective distance and target icon display during playback; added HUD toggle cheat for capture and verification. Fixed dynamic sublevel discovery miss, listener release, and timeline scrub crash.

## Weapon Preview Tool (R&D) {#weapon-preview}

Built editor tool to check **weapon / attachment Mutable combinations and stat deltas** without launching game.

- **Combination preview**
  Opened from editor menu; picking weapon and attachments applies data table Mutable parameters as-is to **assemble customizable object on the fly and show it in 3D**. Confirmed combinations without PIE or packaged build.
- **Async loading**
  **Loaded asynchronously** Mutable instances, meshes, and animations. Kept sync load option as well.
- **Viewport controls**
  Supported left-click rotate, middle-click pan, camera / weapon reset; loops selected animation.
- **Stat sheet**
  Showed **base stats alongside attachment stat deltas**. Paired each slot's attachment name with its delta and distinguished percent / integer fields. Made table input errors and combined stats visible at a glance.

## Build Process Cleanup and Notification Feature (R&D) {#build-alert}

Restructured TeamCity build configuration into stages, posting build results **via Teams webhook and mentioning author of failed revision**.

- **Stage split**
  Split build steps by purpose so failing stage shows in build overview without opening full log.
- **Notification card**
  Sent card via **Teams incoming webhook** on build completion. (Configuration name, build number, result, VCS revision, result page link)
- **Owner mention**
  Mentioned committer of failing revision in Teams on failure. Instead of channel-wide announcements, made sure **whoever gets notified is whoever fixes it**.
- **Local build**
  Shared stage split with launcher's local build / log separation, so failure points read same way locally.

## Other {#etc}

- **Niagara first-person render propagation (R&D)**
  Engine's default Niagara anim notify doesn't pass FirstPersonPrimitiveType to spawned component, so first-person mesh effects missed first-person render path.
  Solved with **subclass** overriding only effect spawn hook. Left engine untouched; added opt-out flag for third-person / world effects.
- **Lightweight launcher (R&D)**
  Built in Python to cut repetitive work of fetching builds from team storage. Chains download straight into launch.
  Supported launch argument presets (separate server / client launch, connection target, revision display), local build, and log separation.
- **Gamepad vibration**
  Implemented light per-hit-direction vibration and strong death vibration with ForceFeedback; drove pad vibration from grenade explosion sound via **Wwise Motion**.
  Connected per-pad output paths (DualSense / DualShock4 / Xbox) to Wwise Motion and verified trigger vibration.
  Built **standalone test tool** for testing vibration and triggers without editor, editor tweak to preview vibration on all connected pads, and channel → motor mapping guide for non-programmers.
