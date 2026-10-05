# Repository Guidelines

## Project Structure & Module Organization

- `content/notes/` contains Chinese Markdown articles; `content/notes/en/` contains matching English translations.
- `scripts/build.mjs` renders static pages, search indexes, RSS feeds, and the sitemap. `scripts/i18n.mjs` defines categories and localized UI text.
- `scripts/check.mjs` validates generated output; `scripts/serve.mjs` provides local preview.
- `public/assets/` holds browser JavaScript, CSS, and the favicon. `public/_headers` and `public/_redirects` configure hosting behavior.
- `docs/deployment.md` records deployment settings. Generated `dist/` and local `artifacts/` are ignored; edit source files instead.

## Build, Test, and Development Commands

Use Node.js 22 or newer; no dependency installation is needed.

- `npm run dev`: build once and serve at `http://127.0.0.1:4173`.
- `npm run build`: regenerate `dist/`, including hashed CSS/JS assets.
- `npm run check`: validate the existing build.
- `npm run preview`: serve existing output; optionally set `PORT`.

There is no watch mode. Rebuild after edits and refresh the browser. Run `npm run build && npm run check` before submitting code or article changes.

## Coding Style & Naming Conventions

Use ES modules, `node:` imports for built-ins, two-space JavaScript indentation, single-quoted strings, semicolons, and camelCase identifiers. Follow nearby formatting and preserve the compact CSS style. No formatter or linter is configured.

Name articles with lowercase hyphenated slugs, such as `dns-debugging.md`. Use JSON metadata between `---` delimiters with `title`, `category`, `kind`, `date`, `summary`, and `tags`.

## Article & Translation Guidelines

Create both language files with identical filenames. Match category mappings, dates, section counts, executable examples, and reference URLs. Translate prose and labels. Use supported Markdown: paragraphs, `##` headings, flat bullet lists, inline markup, and fenced code; avoid raw HTML, tables, and nested lists.

## Testing Guidelines

Validation uses `node:assert/strict`; there is no separate test framework, test-file naming convention, or coverage target. Extend `scripts/check.mjs` for relevant regressions. Checks cover local links, anchors, language metadata, translation parity, references, and private-data patterns. For UI changes, manually verify both languages, search/filtering, language-switch state, and mobile layouts.

## Commit & Pull Request Guidelines

Follow history with concise imperative subjects prefixed `docs:`, `fix:`, or `feat:`. PRs should describe the change, link relevant issues, report validation, and include desktop/mobile screenshots for visual changes.

## Security & Configuration

Use public references, example domains, and documentation IPs. Exclude credentials, internal addresses, and real logs. Explain prerequisites for state-changing commands. Pushes to `main` trigger Cloudflare Pages deployment.
