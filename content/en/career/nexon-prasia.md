---
company: Nexon Korea (Client Technology Team)
title: Wars of Prasia
title_url: https://wp.nexon.com/main
period: 2021.11 ~ 2025.09
duration: 1 year pre-launch + 3 years live (launched 2023.03.30)
engine: Unreal Engine 4.27 (Windows / iOS / Android)
role: >-
  Unreal Engine engine/tool development, performance optimization, plugin/build system operations, automation (P2)

image: images/warofprasia.jpg
image_alt: Wars of Prasia key art

summary: >-
  Owned the full live-service lifecycle of Wars of Prasia **from pre-launch (`2021.11`) through launch (`2023.03`) to `2025.09`**.
  Handled **performance, quality observability, CI/CD, and developer-productivity tooling**.

highlights:
  - title: Performance
    text: |-
      Reduced hitches and stabilized frame rate in seamless areas
      - UE 4.27 **shader cache auto-collection / distribution**
      - Set criteria for and tuned **Animation Budget Allocator**
  - title: Quality Observability / Plugin Management
    text: |-
      Introduced **Backtrace** and standardized it across all platforms
      - Cut root-cause analysis time with symbol tagging, daily reports, and ANR / OOM metrics
      - **Strengthened native error handling by analyzing SDK source (GitHub)**
      - Maintained Wwise and Vivox
  - title: CI/CD / Policy Compliance
    text: |-
      Automated build verification and store-policy compliance
      - **Automated Jenkins / Perforce verification**
      - **Build-failure alerts**: notified owners; mentioned latest committer for binary changes
      - **Handled iOS / Android store policies**
  - title: Developer Productivity
    text: |-
      Helped non-engineering roles find and fix issues on their own
      - Built and supported editor tools
      - **NeverCook visualization** and editor extensions

stack:
  - group: Engine / Editor
    items:
      - Unreal Engine 4.27
      - Slate
      - Asset Registry
      - Localization
      - FExtender
      - ABA
      - Unreal Session Frontend
  - group: Languages / Scripting
    items:
      - C++
      - Python
  - group: Plugins / Solutions
    items:
      - Backtrace
      - Wwise
      - Vivox
  - group: Build / Platform
    items:
      - Jenkins
      - Perforce
      - Android Studio
      - Xcode / App Store policy
  - group: Operations / Collaboration
    items:
      - Confluence
      - Git
      - Teams automation (Power Automate)

rnd_note: R&D items were self-initiated rather than issue-driven — researched independently, then proposed back to game design

links:
  - label: Game Website
    url: https://wp.nexon.com/main
  - label: Notion Details
    url: https://app.notion.com/p/Nexon-255bed59c3638157bbc4cdf8cd119e1d
---

## Engine & Performance Optimization {#performance}

- Documented **hitch measurement and root-cause analysis** with Unreal Session Frontend; tested and adopted mobile **PSO cache** to reduce stutter in seamless areas
- Optimized screen-significance-based computation by **setting criteria for and tuning** [**Animation Budget Allocator**](https://dev.epicgames.com/documentation/ko-kr/unreal-engine/animation-budget-allocator-in-unreal-engine)
- **Unified helmet On/Off meshes**: replaced two SkeletalMesh sets (helmet on / off) with **a single mesh storing on / off state in Vertex Color**
  - Body meshes 2 → 1; face (beard) and hair meshes also 2 → 1
  - Fewer assets → **lower runtime memory**; no duplicate upkeep → **lower asset management cost**
  - Followed up with **helmet system polish** (hood On/Off, part clipping prevention)
- **Shader Cache**: Defined and documented policies per patch type; built an **automated distribution pipeline** for package-time cache files, improving consistency and lead time
- **Automated rendering metrics tool**: Traversed waypoints, visualized per-node DP (DrawCall, Primitive) as colors on a minimap, periodically delivered profile data and optimization guidelines

## Quality/Crash Observability Plugin (Backtrace) {#backtrace}

Owned the **migration from Firebase Crashlytics to Backtrace** through ongoing maintenance. Made crash tracking easier; sped up response through automation.

- **SDK source analysis and native error handling**
  Read Backtrace GitHub source directly to pinpoint issues and fixes; strengthened **error handling to work reliably in native environments**
- **Collection automation**
  Added **automatic symbol upload and tagging** and **daily reports** across AOS / iOS / Windows; unified per-platform crashes in one view
- **ANR / OOM**
  Tracked ANR and OOM collection issues; systematized **missing-Attribute and gap correction**. Automated iOS OOM metrics and reports
- **Operations**
  Reviewed Jira integration, managed storage capacity; monitored per-platform Backtrace issues and responded per version

## Plugins (Audio/Voice) {#audio-plugins}

- **Sole maintainer** after initial adoption
- **Vivox**: Reworked Bluetooth permission popup and permission request flow; handled session/crash issues
- **Wwise**: Handled no-playback issues, built **playback-state visibility logging**, analyzed AudioUnit init/Starvation logs

## Editor/Tooling & Data Pipeline (R&D) {#editor-tooling}

- Enhanced **NeverCook visual tool** (icons, filters, Dev exceptions/warnings); built **a tool automating manual blacklist updates**. [View demo](#prasia-lab--nevercook)
- **Standalone Excel Import/Export script**; strengthened error handling and messages; **improved duplicate messages/sorting/exception handling**; enhanced DataValidate
- **Unreal Slate & Python extension utilities**: Config Sheet Import All, CuidForClient.csv viewer, Text CUID tracking, particle referencing validation, Missing Bone check, bulk Sector string edits, etc.
- **Security/Encryption**: UAsset/Text double encryption with per-item and full decryption; improved DataDecrypt; ran periodic reminders for text encryption key rotation

## Cinematics/Sequencer & UI/UX {#cinematic}

- Built **cinema level activation system (fixed-time events)**, **sequence skip policy (first-time only/delay/skip button activation)**, **graceful UI exit during cinematics**; made AspectRatioAxisConstraint (aspect ratio) configurable
- **Refactored** CinematicActor/TriggerVolume/Skip widget/PlayLevelSequence **and fixed related crashes**
- Implemented **Entity hiding logic during sequence playback**; polished login sequence camera and world loading issues

## CI/CD & Build Automation (R&D) {#ci-cd}

- **Jenkins**: Per-stream **cross builds**, **build number/package type validation utility**, Jenkins Job for missing-permission cases, script-based **automatic symbol backup**
- **Iterative cooking validation**; standardized validation logs
- **Notification automation (Power Automate)**: Sent build failure / server validation error / low disk space alerts to Teams. Routed build failures to owners; when caused by binary (asset) rather than code changes, **mentioned the latest committer** via Perforce history to cut iterations
- **Python EXE utilities**: Automated Excel-based data lookup, **auto Perforce Workspace setup** from run path, **recent history/CL tracking** by asset path
- **Windows**: WinDist/Windows Binary Only distribution, built and documented PC debugging environment, improved Dev logs

## Mobile Platform Support {#mobile}

- **iOS**: Applied Privacy Manifest, **auto provisioning renewal/expiry alerts**, Device Profile, **Memory Budget** measurement and management
- **Android**: Mitigated OOM crashes via **post-hoc OOM management** using exitinfo and budget tuning; developed and applied Backtrace-specific code
- Analyzed cause of mobile **texture resolution degradation**; fixed **TextureGroup MaxLODSize not being applied**
- **Set up mobile debugging environment**: documented Android Studio debugging

## Windows Tray Notification + Balloon Messages (R&D) {#tray-notify}

Built a **tray icon** and **balloon messages** with Win API `Shell_NotifyIcon` so key events aren't missed while the game window is hidden.

- Tray menu **Show Game / Hide Game / Exit** shows, hides, or closes the game window
- Balloon messages are native Windows notifications, shown at bottom-right like OS alerts. e.g., party invites
- Clicking a balloon (`NIN_BALLOONUSERCLICK`) restores the hidden game window and **brings it to the foreground**
- Evolved this into a [game-specific Slate banner](#like-or-die--background-notify) in Like Or Die
- Demo: try the balloon message and tray menu in [Prasia Lab's tray notification](#prasia-lab--tray)
