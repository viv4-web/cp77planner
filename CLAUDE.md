# cp77planner — Cyberpunk 2077 build planner (buildplanner.net/cyberpunk-2077/)

## Scope (hard rule)
- Work ONLY inside ~/work/cyber/. Never read, edit, delete, or run git in ~/work/w3planner, ~/work/w3planner-art or any other folder.
- Never edit, and never run anything in, ~/work/deploy/ (you may read deploy.sh and approve.sh for conventions only).
- This project has its own scripts: you may run `tools/deploy.sh build` and `tools/deploy.sh preview`. NEVER run `tools/deploy.sh live`. NEVER run `tools/approve.sh` (only Vivek does).
- Deploys: always show Vivek the rsync dry-run list first (`tools/deploy.sh preview --dry-run`). `rsync --delete` is only allowed inside the cyberpunk-2077 preview and live folders (hard-coded in tools/deploy.sh).
- If a task seems to need anything outside ~/work/cyber/, stop and ask Vivek.

## Workflow
- Vivek and Claude chat do design and briefs; you implement, test, work on branches, open PRs (main is protected), and deploy to PREVIEW only.
- Nothing goes live until Vivek has reviewed the preview himself and approved it.
- Every shared build link must keep working after every release.
- Record IDs in build links come from the append-only registry data/ids.json (record name -> n). Never change, reuse or renumber an n; add new ones with `python3 tools/ids.py add NAME`.

## Data and art
- Game files are the only data source (WolvenKit exports land in incoming/). Target: game 2.5 + Phantom Liberty, English strings for v1.
- Game art lives in art/ (gitignored, never committed) and is used only for the live build. The offline build uses original placeholder art from the same source.
- Static site, build encoded in the URL, no backend. MIT license.

## Style
- Utopian 2077 neon with chrome accents (mockup v4); full spec in docs/STYLE.md. Motion is CSS only, transform/opacity, with a Full/Calm/Off setting; respect prefers-reduced-motion.
