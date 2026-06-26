# Rotating `BRANCH_PROTECTION_PAT` to a least-privilege token

The `branch-protection-audit` workflow runs `check-branch-protection.sh` with
`GH_TOKEN = secrets.BRANCH_PROTECTION_PAT` to assert that `check-alias-guard`
stays a **required** status check on `main`. Reading branch protection requires
**repo-admin** rights, so the stored token must belong to an admin of
`d3hospitality/lingua-franca`.

Today the secret holds the **bootstrap token** — a broad `gh auth token` carrying
`repo`, `workflow`, `gist`, `read:org`. The audit only ever needs to *read*
branch protection. This runbook swaps that broad token for a **fine-grained PAT
scoped to one repo with `Administration: Read-only`** — the minimum that still
lets the gate verify (exit 0).

> The swap is a **human action**: GitHub fine-grained PATs can only be minted in
> the web UI. Agents cannot create them. Run the one command in step 3 with the
> token you minted.

---

## Why shrink it?

| Token | Can read protection? | Blast radius if leaked |
|-------|----------------------|------------------------|
| Bootstrap (`repo`+`workflow`+`gist`) | ✅ | **Full read/write to all repo code, Actions, gists** |
| Fine-grained, this repo, `Administration: Read-only` | ✅ | Read-only on one repo's settings — cannot push code or alter Actions |

Same audit result, a fraction of the exposure. Least privilege.

---

## Fast path — the guided wizard (recommended)

One command collapses steps 1–4 into a single guided flow. It prints the exact
field values, opens the mint page, then — reusing the one token you paste —
pre-flights it, stores it only if it genuinely reads protection, and confirms the
gate really re-verifies (by reading the audit log, not just its conclusion):

```bash
cd lingua-franca-api
./scripts/mint-branch-protection-pat.sh
```

The only thing it can't do for you is the mint itself — that's the irreducible
human action (GitHub mints fine-grained PATs only behind a web-UI consent click).
You click **Generate**, copy, and paste; the wizard does the rest and rolls back
guidance if anything fails. Prefer the manual steps below if you want to inspect
each stage by hand.

---

## 1 — Mint the fine-grained PAT (GitHub UI, ~2 min)

1. <https://github.com/settings/personal-access-tokens/new>
2. **Token name:** `lingua-franca-branch-protection-audit`
3. **Resource owner:** `d3hospitality` (the org that owns the repo — *not* your
   personal account, or it won't see the repo's protection).
4. **Expiration:** 90 days (re-run this runbook when it lapses).
5. **Repository access → Only select repositories →** `d3hospitality/lingua-franca`.
6. **Permissions → Repository permissions → Administration → Read-only.**
   (Metadata: Read-only is added automatically. Add nothing else.)
7. **Generate token** and copy the `github_pat_…` value.

You must be an **admin** of `d3hospitality/lingua-franca` for the token to read
protection. If you only have write access, the pre-flight in step 2 fails with
exit 1 and nothing is stored.

## 2 — Pre-flight it (no write — proves the token before storing)

```bash
cd lingua-franca-api
BP_PAT=github_pat_xxx ./scripts/set-branch-protection-pat.sh --verify-only
```

- **exit 0** → token reads protection. Proceed.
- **exit 1** → token can see the repo but *not* its protection (not a repo admin,
  or wrong permission). Fix the PAT; nothing was stored.
- **exit 2** → inconclusive (no `gh`, no token, API unreachable).

## 3 — Store it (verify-then-store, atomic)

```bash
cd lingua-franca-api
BP_PAT=github_pat_xxx ./scripts/set-branch-protection-pat.sh
```

The script **re-runs the pre-flight against the live API** and only calls
`gh secret set BRANCH_PROTECTION_PAT` if the token genuinely reads
`required_status_checks` — so a dud token can never silently turn the audit into
an exit-2 warning.

## 4 — Confirm the gate still verifies with the new token

```bash
cd lingua-franca-api
./scripts/confirm-rotation.sh
```

This dispatches `branch-protection-audit`, waits for the fresh run, and asserts
it **really** verified the gate — exit 0 only if the log carries
`PASS  'check-alias-guard' is a required status check`.

> **Why not just check `conclusion: success`?** Because a degraded token doesn't
> turn the run red. When the stored PAT can't read protection,
> `check-branch-protection.sh` exits 2, and the workflow deliberately maps exit 2
> → exit 0 with a `::warning` (a missing secret must not page as a real
> regression). So a *neutered* token still shows `conclusion: success`. Eyeballing
> the conclusion can't tell a real verification from a silent neutral-pass — the
> exact failure this whole rotation guards against. `confirm-rotation.sh` reads the
> log and **exits 1** on a neutral exit-2 warning, telling you to roll back.

Manual fallback if you prefer to inspect by hand:

```bash
gh workflow run branch-protection-audit -R d3hospitality/lingua-franca
# wait ~30s, then read the LOG (not just the conclusion):
gh run view -R d3hospitality/lingua-franca \
  "$(gh run list -R d3hospitality/lingua-franca --workflow branch-protection-audit -L 1 --json databaseId --jq '.[0].databaseId')" --log \
  | grep "is a required status check"
```

Expect the line `PASS  'check-alias-guard' is a required status check`. The audit
also runs daily on schedule.

## 5 — Retire the broad bootstrap token (only when provably safe)

The bootstrap token (a broad `gh auth token`) stays in place until the
fine-grained PAT is **proven** to be the gate's credential — retiring it any
earlier silently strands the audit (it falls to the exit-2 neutral warning and
verifies nothing). Don't eyeball this; run the gate:

```bash
./scripts/retire-bootstrap-token.sh          # kind-check + live audit, then exact retire steps
./scripts/retire-bootstrap-token.sh --check  # readiness only (no audit dispatch)
```

It refuses (**exit 1**) unless BOTH hold:
1. the repo variable `BRANCH_PROTECTION_PAT_KIND` is `fine-grained` — stamped
   automatically by `set-branch-protection-pat.sh` from the stored token's prefix,
   so it can't lie about which token the secret holds; and
2. a fresh `branch-protection-audit` really re-verifies the gate now (via
   `confirm-rotation.sh`, log-inspected, not just the conclusion).

Only then does it print the precise, token-type-aware revoke steps. It never
revokes anything itself — the irreducible human click at
<https://github.com/settings/tokens> is all that remains.

---

## Rollback

If the fine-grained PAT misbehaves, re-store the bootstrap token to restore the
prior state:

```bash
BP_PAT="$(gh auth token)" ./scripts/set-branch-protection-pat.sh
```

Then mint a fresh fine-grained PAT and retry from step 1.

## Reference

- Guided wizard (steps 1–4 in one command): [`mint-branch-protection-pat.sh`](./mint-branch-protection-pat.sh)
- Storer / pre-flight: [`set-branch-protection-pat.sh`](./set-branch-protection-pat.sh)
- Step-4 confirmer (dispatch + assert real PASS): [`confirm-rotation.sh`](./confirm-rotation.sh)
- Step-5 safe-retire gate (kind-check + live audit, then exact revoke steps): [`retire-bootstrap-token.sh`](./retire-bootstrap-token.sh)
- Gate assertion run by the workflow: [`check-branch-protection.sh`](./check-branch-protection.sh)
- Workflow: [`../../.github/workflows/branch-protection-audit.yml`](../../.github/workflows/branch-protection-audit.yml)
