# Release Checklist

Use this checklist before calling ContextReply ready for real users.

The live testing steps for unchecked items are documented in `docs/live-qa-playbook.md`.

## Product readiness

- [x] Requirements documented in `docs/requirements.md`.
- [x] Implementation plan documented in `docs/implementation-plan.md`.
- [x] Architecture documented in `docs/architecture.md`.
- [x] Developer workflow documented in `docs/developer-guide.md`.
- [x] Local MVP works through static validation.
- [x] Content-script DOM behavior is covered by regression test.
- [x] Background generation behavior is covered by regression test.
- [x] Local content-script fixture verifies panel injection and insert behavior.
- [x] Local settings fixture verifies save/reload and import behavior.
- [x] Options-page DOM behavior is covered by regression test.
- [x] Privacy/security behavior documented in `docs/privacy-security.md`.
- [x] Profile-writing guidance documented in `docs/profile-guide.md`.
- [x] Release notes documented in `CHANGELOG.md`.
- [x] Product risks documented in `docs/risk-register.md`.
- [x] Completion audit documented in `docs/completion-audit.md`.
- [x] Chrome Web Store listing draft documented in `docs/chrome-store-listing.md`.
- [x] X account-safety guidance documented in `docs/x-safety-guide.md`.
- [x] Unpacked extension loads in Chrome without manifest/runtime errors.
- [ ] Authenticated X home feed composer is tested.
- [ ] Authenticated X post-detail composer is tested.
- [ ] Authenticated X modal/drawer composer is tested.
- [ ] Copy action is tested on X/HTTPS.
- [x] Clipboard failure state is tested or deliberately accepted as residual risk.
- [ ] Live OpenAI generation is tested with a valid API key.
- [x] `npm run package` creates `dist/contextreply.zip`.
- [x] Package integrity is checked with `npm run test:package`.
- [x] Documentation links are checked in `npm run validate`.

## Safety readiness

- [x] No auto-posting path exists.
- [x] No bulk-reply workflow exists.
- [x] Mock mode avoids OpenAI calls.
- [x] Profile export omits API keys.
- [x] Generated replies are filtered for links, hashtags, and common generic praise.
- [x] Runtime source passes the no-automation safety audit.
- [x] Production API-key strategy is decided before any hosted/commercial release.
- [x] Hosted API contract documented for future backend migration.

## Verification commands

```powershell
npm run validate
Get-Content manifest.json -Raw | ConvertFrom-Json | Out-Null
npm run package
npm run test:package
npm run release:check
```

Optional live API check:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run smoke:openai
```

## Manual evidence

Record browser results in `docs/qa-results.md`.
