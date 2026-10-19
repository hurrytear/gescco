---
{"title":"Create short videos with ChatGPT and Skills: script, storyboard and MP4 export","category":"AI & automation","kind":"Practical notes","date":"2026-10-19","summary":"Turn a 45-second DNS troubleshooting explainer into a repeatable workflow with ChatGPT, Remotion Skills and a reusable SKILL.md, covering scripts, assets, narration, captions, previews, export and delivery checks.","tags":["ChatGPT","Skill","Remotion","Short video","FFmpeg"]}
---
Turning an operations note into a short video requires a clear message, coordinated visuals and narration, editable captions and a dependable export. This article walks through a 45-second DNS troubleshooting explainer using ChatGPT and Skills. The same process suits technical education, product explainers and internal training.

Sources were checked on 2026-10-19. This is a workflow and example guide, without a rendered demonstration video. No paid speech or video generation service was called. Available interfaces and features depend on the actual account.

## 01 / What ChatGPT, Skills and rendering tools do

ChatGPT can refine a topic, draft narration, plan shots and suggest revisions. A ChatGPT Work / Codex environment with file and execution tools can also edit a project, run previews and export files. Account, runtime and workspace settings determine access. A text response containing a script is not a downloadable video. [How to work with ChatGPT](https://learn.chatgpt.com/docs/use-chatgpt).

A Skill packages reusable instructions and supporting resources, usually with `SKILL.md` as its entry point. It can require asset inspection before storyboarding and file checks after export. MCP / plugin tools or local programs perform the actual operations. Installing a Skill does not grant access to a video model, speech service or external account. [Skills and their relationship to tools](https://developers.openai.com/plugins/concepts/skills).

This guide uses Remotion to define text, graphics and timing in a React project, then render the result. Its official Agent Skills help agents edit video projects through natural-language requests. An explainer made from editable text, arrows, icons and licensed recordings does not require a generative video model. [Remotion Agent Skills](https://www.remotion.dev/docs/ai/skills).

```text
Topic and sources → ChatGPT script → Storyboard and timeline
                         ↓
          Skill defines workflow, folders and checks
                         ↓
       Remotion project + assets + narration + captions
                         ↓
            Preview → targeted revision → render
                         ↓
            MP4, cover, subtitles and check report
```

## 02 / Write a clear production brief first

The example is a 9:16 vertical explainer at 1080 × 1920, 30 fps and 45 seconds, aimed at junior operations engineers. Use a bright blue and white background with yellow highlights. Open with a question, show an investigation sequence and finish with an actionable checklist.

Use the site's [DNS troubleshooting note](/en/notes/dns-debugging/) as source material and focus on comparing client, recursive and authoritative answers. Avoid cramming complete DNS, DNSSEC, CDN and HTTPS tutorials into one clip. Put supporting detail in the accompanying article.

Send the following brief to ChatGPT before building the project:

```text
Create a 45-second Chinese operations explainer: 9:16, 1080×1920, 30fps.
Topic: investigate DNS in layers when a domain will not open.
Audience: junior operations engineers.
Style: bright blue and white, yellow highlights, readable text, restrained motion.
Content: record the client resolver path, compare recursive and authoritative
answers, then validate HTTPS separately.
First deliver: one-sentence goal, 6 shots, narration per shot, short screen text
and an asset list.
Use examples such as example.com; do not inspect real endpoint settings or
show internal addresses or real logs.
Do not automatically install tools, call paid services or publish externally.
If narration is unavailable, label the preview as having no narration.
Do not present it as a finished narrated video.
```

The restriction on automatic installation applies to the example's production stage. The initialization steps below are a separate preparation stage in which you deliberately choose and review dependencies.

## 03 / Prepare Remotion and its Skills

If Remotion is available in the ChatGPT desktop plugin directory, review its source, permissions and instructions before installing it, then select the appropriate Skill for a new task. Remotion also documents a local coding-agent workflow, used below. A missing plugin entry does not imply that the same integration is available to your account. [Remotion project entry points](https://www.remotion.dev/docs/).

Prepare Node.js and an operating system supported by the current template. These commands download and execute an npm scaffolder, create `ops-short-video`, and install or configure dependencies or Skills. Use a separate working directory rather than adding video dependencies to this website. Review the official source and command prompts first:

```sh
# Run in a separate working directory. Downloads and executes a scaffolder.
# Do not overwrite an existing project with this name.
npx create-video@latest --yes --blank ops-short-video
cd ops-short-video

# Follow the wizard to add official Remotion Skills to this video project.
npx remotion skills add

# Record versions and retain the lockfile for the accepted dependency set.
node --version
npm ls remotion @remotion/cli

# Start local preview; use another terminal or agent session for project edits.
npm run dev
```

The setup follows [Remotion's coding-agent quickstart](https://www.remotion.dev/docs/ai/coding-agents). `@latest` is convenient for initial creation but changes over time. After validation, retain `package.json`, the lockfile, Node version and renderer version. Rebuild with `npm ci` in the same environment instead of upgrading all dependencies on each revision.

Open the video project in your agent, confirm that it discovers the Remotion Skill and explicitly request it. ChatGPT currently supports selecting Skills with `@`; Codex CLI / IDE supports `$` or `/skills`. Use the actual installed name rather than assuming an example name already exists.

## 04 / Capture your production workflow in SKILL.md

The Remotion Skill handles project implementation. A small workflow Skill can add content and delivery requirements. `ops-short-video` below is this article's custom example, not an official bundled name. In a Codex project, save it as `.agents/skills/ops-short-video/SKILL.md`. Other interfaces need their supported creation or import flow; a local directory is not a universal installation method. [Creating, discovering and invoking Skills](https://learn.chatgpt.com/docs/build-skills).

This complete instruction template defines the workflow. It does not install Remotion or create narration on its own:

```text
---
name: ops-short-video
description: Turn public technical notes into 30–60 second explainers, including scripts, storyboards, Remotion projects, captions and delivery checks; not for automatic publishing.
---

Goal: deliver an editable project, preview, final MP4, cover, SRT and check report.

1. Read the user's specified public sources; establish audience, duration,
   aspect ratio, language and output directory.
2. Inventory available rendering, captioning and narration tools; disclose gaps.
3. Draft narration and shots first. Support technical claims and use no real
   business data in examples.
4. Work in a separate video project. Use the installed official Remotion Skill
   when Remotion is required.
5. Define timing in frames with explicit shot boundaries, no gaps or overlaps.
6. Record asset sources. Shorten narration before accelerating it excessively.
7. Show stills and a low-resolution preview before making shot-specific edits.
8. Watch and listen throughout; check captions, fonts, synchronization,
   technical accuracy and sensitive information.
9. Inspect codecs, dimensions, frame rate, duration and audio after rendering.
   Do not describe a failed export as complete.
10. Deliver existing file paths, observed checks and limitations.
    Do not publish automatically or overwrite original assets.
```

Test three requests in a new session: “Make an explainer,” “Change only shot 3's captions,” and “Summarize this article.” The first two should reach appropriate workflow steps; the third should not start a video project unnecessarily. Instructions to perform checks are not evidence that the checks actually ran.

## 05 / Plan the 45-second timeline in frames

Each of the six shots communicates one point. Narration below is an initial English adaptation of the Chinese example; read it aloud and adjust it for the chosen voice rather than assuming it fits exactly.

- Shot 1, 0–4 seconds: title “Domain not opening: where to start?” Narration: “A domain won't open? Don't clear the cache just yet.”
- Shot 2, 4–10 seconds: show “Client → actual resolver.” Narration: “First identify the resolver your client actually uses. Record the symptom and error.”
- Shot 3, 10–18 seconds: cards for A, AAAA, status and TTL. Narration: “Query the recursive resolver. Record the addresses, response status and TTL.”
- Shot 4, 18–27 seconds: compare recursive and authoritative answers. Narration: “Compare the authoritative answer. If they differ, investigate caching, records and the resolution path.”
- Shot 5, 27–38 seconds: separate DNS and HTTPS checks. Narration: “Even if resolution works, validate HTTPS separately. Not every connection failure is a DNS failure.”
- Shot 6, 38–45 seconds: recap “Record → compare → verify.” Narration: “Keep query times and results. Use evidence to narrow the problem.”

45 seconds × 30 fps = 1350 frames. Save the following as `timeline.json` and explicitly instruct the agent to consume it when configuring compositions. This is **a custom schema for this article**, not a format Remotion automatically understands:

```json
{
  "videoId": "dns-first-check",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "durationInFrames": 1350,
  "scenes": [
    {"id": "hook", "startFrame": 0, "endFrame": 120},
    {"id": "client", "startFrame": 120, "endFrame": 300},
    {"id": "recursive", "startFrame": 300, "endFrame": 540},
    {"id": "authoritative", "startFrame": 540, "endFrame": 810},
    {"id": "https", "startFrame": 810, "endFrame": 1140},
    {"id": "recap", "startFrame": 1140, "endFrame": 1350}
  ]
}
```

Starts are inclusive and ends exclusive. Each shot lasts `endFrame - startFrame`; the final frame is 1349. Keep transitions within the frame budget instead of adding extra duration for each transition.

## 06 / Ask for an editable project

Define project structure and actual deliverables, not just a request to “generate a video.” Keep `brief.md`, `storyboard.md`, `timeline.json`, React source, subtitles, asset provenance and rendered outputs. The generated project must register real compositions. This example uses video ID `OpsShort` and a separate Still ID `OpsCover` for the cover.

```text
Use the installed Remotion Skill to implement the accepted storyboard here.
Read timeline.json and match its dimensions, fps, total frames and shot timing.
Register video composition OpsShort and cover Still OpsCover.
Manage narration, short screen text and captions separately; do not place the
entire narration on a title card.
Place assets in public/ and reference them using the installed Remotion version's
supported static-asset APIs.
Inspect fonts, audio and available tools before implementation.
Do not reference nonexistent files or URLs.
If narration is missing, label the preview and list unfinished work.
First provide previews of frames 0, 300, 810 and 1349 plus a low-resolution clip.
Retain the editable source; deliver MP4, JPG cover, SRT and a check report.
Do not publish or upload original assets to unspecified external services.
```

Use supported asset handling such as `public/` and `staticFile()`. Avoid absolute paths that do not exist on another machine and short-lived signed resource URLs. [Remotion assets](https://www.remotion.dev/docs/assets). Drive animations from frames rather than wall-clock time or fresh random values on every render to keep previews and exports consistent. [Frame-driven animation](https://www.remotion.dev/docs/use-current-frame).

## 07 / Order narration, captions and asset work

Read the script aloud before recording it or using an available narration tool. Adjust pauses and shots to actual audio duration. A chat interface reading text aloud does not establish that you have a downloadable, editable narration file. For generated speech, verify availability, purpose, budget and voice authorization before calling a service.

Time captions to the final narration rather than distributing text evenly by character count. Retain an independent SRT for review and editing. Screen titles can be shorter without changing the technical meaning. Exporting SRT alone does not burn captions into MP4; implement that in Remotion or a post-production tool.

- Fonts: use a fixed font with Chinese coverage in the render environment, confirm usage rights and wait for loading. Do not rely solely on the author's system fonts.
- Layout: leave room for platform controls and titles along vertical-video edges. Preview on the actual target platform instead of promising one universal safe-area pixel value.
- Sound: keep speech clear and music below narration. Listen for level jumps, clipping and abrupt cuts at the opening, transitions and ending.
- Recordings: hide notifications, credentials and identity information. Use sanitized demonstration output, clearly distinguished from real production tests.
- Assets: record origins, usage scope, fonts and music. Rebuild terminal commands or small lettering from generated images as editable text and verify them.
- Existing captions: burned-in text is part of the pixels. Replacing SRT cannot remove it; repair the affected region or rebuild the shot, then inspect for remnants.

A preview without narration can validate layout. If the agreed final deliverable includes narration, add its audio track and complete a full listening and viewing review before delivery.

## 08 / Preview before making targeted revisions

Confirm real composition IDs and settings before extracting representative frames. These commands run inside an implemented Remotion project and create review images; they do not create a missing video project:

```sh
# Inspect composition and cover IDs, dimensions, fps and frame counts.
npx remotion compositions
mkdir -p out/review

# Frame 300 is at 10 seconds; inspect shot 3's text, layout and examples.
npx remotion still OpsShort out/review/frame-0300.png --frame=300

# Inspect the final frame for a black ending, early disappearance or truncation.
npx remotion still OpsShort out/review/frame-1349.png --frame=1349
```

See [compositions](https://www.remotion.dev/docs/cli/compositions) and [still](https://www.remotion.dev/docs/cli/still) for the options. Stills check visuals; preview playback is needed for sound and transitions. A `--scale=0.5` render can provide an inexpensive review copy of the same composition without changing its layout aspect ratio.

Give revisions a time range and scope: “At 10–18 seconds, enlarge the TTL card text and keep the second line inside the frame; retain narration and colors.” Recheck the affected shot and adjacent transitions, then watch the whole clip. A one-word edit should not require regenerating all content.

## 09 / Export MP4 and inspect actual files

Export after fonts, assets, narration and captions are connected. The example assumes registered `OpsShort` and `OpsCover` IDs and selects H.264, AAC and `yuv420p`. Adjust to the destination's requirements. Rendering consumes compute and disk space; preserve existing outputs or use a new versioned name.

```sh
mkdir -p out/review

# Half-size review copy: 540×960, retaining the 30fps, 45-second timeline.
npx remotion render OpsShort out/review/dns-preview-v1.mp4 \
  --codec=h264 --audio-codec=aac --pixel-format=yuv420p --scale=0.5

# After preview approval, render at the composition's full dimensions.
npx remotion render OpsShort out/dns-zh-v1.mp4 \
  --codec=h264 --audio-codec=aac --pixel-format=yuv420p

# OpsCover must be a registered Still designed at the cover dimensions.
npx remotion still OpsCover out/dns-cover-v1.jpg
```

Check flags against the installed version using the [Remotion render CLI reference](https://www.remotion.dev/docs/cli/render). Register covers with the [Still component](https://www.remotion.dev/docs/still). Selecting AAC does not synthesize narration when the composition has no audio.

Where FFmpeg / ffprobe is installed, inspect the final file's media properties. This reads a local MP4 without uploading it and does not replace playback checks:

```sh
# Save video and audio stream properties in the check report.
ffprobe -v error \
  -show_entries 'format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,channels,duration' \
  -of json out/dns-zh-v1.mp4
```

Check 1080 × 1920 dimensions, 30 fps, approximately 45 seconds, codec and pixel format. A narrated delivery needs an audio stream. Audio packet boundaries may produce small stream-duration differences; container duration alone cannot prove synchronization. Play the complete file on a phone and check the opening, ending, captions, crop and sound. [Inspecting streams with ffprobe](https://ffmpeg.org/ffprobe.html).

## 10 / Bilingual versions, cost and delivery

Read and segment the English adaptation again instead of replacing Chinese captions while retaining every timestamp. Keep the same information structure. Shorten wording or redistribute shot budgets when English narration exceeds them, and recheck total duration. Replace narration, captions and screen text together.

Use outputs such as `dns-zh-v1.mp4` and `dns-en-v1.mp4`, each with its own language-matched SRT. Share licensed imagery and colors while managing text and audio independently. Include covers, project source, lockfile, provenance and `checks.md`. Report actual renderer versions, performed checks and limitations rather than listing planned filenames as completed files.

Costs can include agent usage, image / speech service calls, local rendering time and cloud rendering. Skill files do not supply these allowances. Check the applicable [Remotion license and terms](https://www.remotion.dev/docs/license); successful installation does not establish that every commercial use is free. This guide promises neither fixed prices nor rendering times.

Retain original assets and source, use new outputs for revisions, and clean reproducible caches or previews after acceptance. Publishing to a video platform is a separate action after the final video, cover and description have been reviewed.

## 11 / Troubleshooting and acceptance

- Skill missing: check the interface, installation scope and actual name, then confirm agent discovery. Avoid installing duplicate copies across unrelated directories.
- Only scripts or React files delivered: verify rendering access, composition registration and successful export. If MP4 is missing, state that export is unfinished.
- Preview works but export lacks assets or readable text: inspect paths, font loading, network dependencies and runtime differences. Prefer reproducible local assets.
- Captions fill the screen: separate short screen text from full narration and break lines semantically instead of only shrinking the font.
- Audio and visuals drift: retime shots and captions against final audio, checking initial silence, sample rates, edits and end padding.
- Fluent but incorrect technical content: verify each claim against sources and distinguish resolution failures from network or HTTPS failures.

Acceptance requires existing playable files, accurate content, readable captions, complete required audio, correct aspect ratio / dimensions / timing, language-matched narration and text, documented assets and editable source. Automated checks cover only part of this; watching and listening throughout remain necessary.

## References

- [OpenAI: ChatGPT, Work and Codex](https://learn.chatgpt.com/docs/use-chatgpt)
- [OpenAI: Skills and tools](https://developers.openai.com/plugins/concepts/skills)
- [OpenAI: Build and use Skills](https://learn.chatgpt.com/docs/build-skills)
- [Remotion: project creation and ChatGPT entry point](https://www.remotion.dev/docs/)
- [Remotion: coding-agent quickstart](https://www.remotion.dev/docs/ai/coding-agents)
- [Remotion: Agent Skills](https://www.remotion.dev/docs/ai/skills)
- [Remotion: importing assets](https://www.remotion.dev/docs/assets)
- [Remotion: useCurrentFrame](https://www.remotion.dev/docs/use-current-frame)
- [Remotion: compositions CLI](https://www.remotion.dev/docs/cli/compositions)
- [Remotion: still CLI](https://www.remotion.dev/docs/cli/still)
- [Remotion: render CLI](https://www.remotion.dev/docs/cli/render)
- [Remotion: Still component](https://www.remotion.dev/docs/still)
- [FFmpeg: ffprobe](https://ffmpeg.org/ffprobe.html)
- [Remotion: license and terms](https://www.remotion.dev/docs/license)
