# SEO automation and AI search (GEO), schemas 63–64 (28 October 2026)

All checks below read public pages or the project's own connected accounts. Nothing on the customer's site is changed and nothing is published.

## 1. Automatic site scan (schema 63)

- **Setting:** SEO & Blog → Site scan → "Automatic scan": off, weekly or monthly. Members with content rights set it.
- **How it runs:**
  - each scan runs as the member who set it, with their rights, and uses one audit credit from the plan;
  - if that member loses the right to scan, the schedule stops; it is never handed to someone else;
  - if the quota is used up or the site cannot be reached, the reason is shown and the scan is retried the next day.
- **First run:** the first scheduled scan comes one interval after the last scan, or on the next worker tick if there was none.
- **Alerts:** new or returning findings from a scheduled scan appear in "Needs attention" (and in email or phone notifications if those are on) for members who can fix them. A scan someone starts by hand raises no alert, because they are looking at it.

## 2. Weekly Search Console check (schema 63)

- **When:** while an automatic scan is on, Search Console clicks and impressions are read once a week.
- **Comparison:** the last 7 complete days against the 7 days before. The last three days are left out until Search Console settles.
- **Drop rule:** clicks at least 30 % lower, with at least 20 clicks in the earlier week. This is a fixed rule, not a forecast.
- **Who sees it:** the figures and the "Clicks from Google search fell" alert are visible only to members who manage connections, the same as the Search Console query rows.
- **Failure:** a failed read is shown as "unavailable", never as zero.

## 3. AI search readiness checks (part of every scan)

These are fixed rules in `lib/site-audit.ts`. They appear in the category "AI search (GEO)", ranked with the other findings.

| Check | Level | Rule |
| --- | --- | --- |
| AI search crawlers are blocked | Site | robots.txt disallows the whole site for OAI-SearchBot, ChatGPT-User, PerplexityBot or Claude-SearchBot (their own group, else `*`). Training crawlers (GPTBot, ClaudeBot, Google-Extended) are a separate business choice and are not flagged. |
| llms.txt not found | Site | `/llms.txt` returns 404/410. llms.txt is an emerging proposal; its effect is unproven. |
| The page content cannot be read without JavaScript | Page | Under 250 characters of text without scripts, at least one script, and an app shell (empty `#root`/`#app`/`#__next` mount, a "enable JavaScript" notice, or three or more scripts). A short static page with an analytics script is not flagged. |
| No structured data | Page | No JSON-LD on the page. |
| Organization details are not marked up | Home page | JSON-LD exists but only generic types (WebSite, WebPage, BreadcrumbList …). Any business type, including LocalBusiness subtypes such as CafeOrCoffeeShop, passes. |

**llms.txt draft:** when that finding is open, "Prepare the draft" builds a starting file. It uses:

- the project name;
- the approved strategy's positioning (never the brand voice);
- the ideal-customer summary;
- the pages the last scan read;
- the website.

The team edits it and publishes it at `/llms.txt` itself.

## 4. AI search visibility (schema 64)

- **Questions:** the team writes up to 10 questions a customer would ask an AI assistant without knowing the brand. SEO & Blog → "AI search visibility".
- **Asking:** each question goes to Gemini 2 or later with Google Search grounding; the brand is never named in the prompt. One AI credit per question; a failed answer is refunded.
- **What is recorded:**
  - whether the answer names the brand (project name or site address, case and Turkish letters folded, at least 3 letters);
  - whether a cited source is the project's site or a subdomain of it;
  - which competitors from Brand & competitors are named;
  - the cited domains, the search queries and the first 600 characters of the answer.
- **Failures:** a failed answer is shown as failed, never as "not named".
- **Weekly check (optional):** runs as the member who turns it on and uses one credit per question per week; it stops if that member loses the right.
- **Limits:** answers change from run to run, so this is a sample, not a ranking. Only Gemini is used; ChatGPT and Perplexity would need their own APIs and costs.
- **Open item:** check Google's terms for Grounding with Google Search before live use. Showing grounded results to end users may require displaying Google's search suggestions.

## 5. GEO-friendly content briefs

The coach's SEO brief now asks the writer to:

- answer the question directly in the first two or three sentences;
- answer customer questions in an FAQ section with FAQPage structured data;
- show the author and the update date.

This applies to both the template and the AI prompt. The no-invented-numbers rule is unchanged.

## Guided start

The Compass SEO path has two new steps:

- turn on the automatic scan;
- see how you appear in AI search.

"Be found on Google and in AI answers" in "What would you like to do?" opens SEO & Blog.

## Files and tests

- Server:
  - `lib/platform/seo-operations.ts` (`schedule`, `watchView`, `llmsDraft`, `runSeoSchedules`);
  - `lib/platform/search-console-queries.ts` (`readSearchConsoleTotals`);
  - `lib/site-audit.ts` (GEO checks), `lib/platform/seo-impact.ts`;
  - `lib/platform/team-alerts.ts` (`seo_findings`, `search_drop`);
  - `lib/platform/ai-visibility.ts` and `ai-visibility-types.ts`;
  - `app/api/platform/coach/shared.ts` (`visibilityGemini`).
- Routes: `app/api/platform/seo` (`schedule`, `?view=llms`) and `app/api/platform/ai-visibility`. Worker steps: `runSeoSchedules`, `runAiVisibilityChecks`.
- UI: `SeoOperations.tsx`, `SeoOpportunities.tsx`, `AiVisibilityPanel.tsx`, `ProjectAudit.tsx`.
- Tests:
  - `platform-seo-schedule`, `platform-geo-readiness`, `platform-ai-visibility`;
  - the Search Console and Gemini readers are stubs; no provider is contacted;
  - migrations 63 and 64 are repeatable.
