# Risk Register

## Open Risks

| Risk | Impact | Mitigation | Status |
| --- | --- | --- | --- |
| X/Twitter DOM changes break composer detection | The panel may stop appearing or attach in the wrong place | Keep content-script DOM regression tests, run live X QA before release, keep selectors narrow | Open |
| Authenticated X flows are not yet live-tested | Release could miss feed/detail/modal composer defects | Follow `docs/live-qa-playbook.md` with an authenticated X session | Open |
| Live OpenAI generation is not yet tested with a real key | Prompt/API assumptions may fail in production | Run `npm run smoke:openai` and live extension generation with `OPENAI_API_KEY` | Open |
| Local extension storage contains API key in personal MVP mode | Local machine compromise could expose key | Omit keys from exports, document local-key limitation, use hosted backend for commercial release | Mitigated for MVP |
| Clipboard behavior can vary by browser/origin | Copy may fail on X/HTTPS even if local fixtures pass | Show visible copy failure, test specifically on X/HTTPS before release | Partially mitigated |
| Generated replies can still sound generic or promotional | Product value depends on reply quality | Use profile guide, bad examples, forbidden phrases, product relevance gate, and safety filtering | Partially mitigated |

## Closed Risks

| Risk | Evidence |
| --- | --- |
| Extension accidentally includes auto-posting automation | `scripts/safety-audit.js` passes in `npm run validate` |
| Package misses linked docs or runtime files | `npm run test:package` verifies required package contents and README links |
| Version drift between manifest, package, and changelog | `scripts/validate.js` and `scripts/package-integrity-test.js` check version consistency |
| Exported profile leaks API key | Export code deletes `apiKey`; options regression test and validation cover behavior |
