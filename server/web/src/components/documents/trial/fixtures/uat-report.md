# Ledgerline release 4.2: user acceptance test report

> [!NOTE]
> **Illustrative fixture.** The release, the cases, the testers and every
> identifier below are invented to exercise the deliverable reader. Testers are
> named by role only.

Round 2 of acceptance testing for the fictional Ledgerline 4.2 release, run on
two acceptance environments over five working days.

## 1. Result at a glance

| Status | Cases | Share |
| --- | ---: | ---: |
| Pass | 122 | 76% |
| Fail | 25 | 16% |
| Blocked | 4 | 2% |
| Skipped | 9 | 6% |
| **Total** | **160** | 100% |

**Recommendation:** release after the two high-severity findings are fixed and
re-tested (section 4). Nothing blocked is in a payment path.

## 2. Scope and environments

| Environment | Build | Data set | Window | Owner |
| --- | --- | --- | --- | --- |
| UAT-1 | `4.2.0-rc.3` (`9f3c2ab`) | synthetic set S-7 | days 1–3 | Test lead |
| UAT-2 | `4.2.0-rc.4` (`b71e0d4`) | synthetic set S-7 | days 3–5 | Test lead |

## 3. Results by area

| Area | Cases | Pass | Fail | Blocked | Skipped | Exit criteria met |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Sign-in | 16 | 10 | 4 | 0 | 2 | No |
| Accounts | 16 | 15 | 0 | 1 | 0 | No |
| Payments | 16 | 14 | 1 | 1 | 0 | No |
| Refunds | 16 | 10 | 3 | 1 | 2 | No |
| Float | 16 | 15 | 1 | 0 | 0 | No |
| Sync | 16 | 13 | 2 | 0 | 1 | No |
| Reports | 16 | 13 | 2 | 0 | 1 | No |
| Settings | 16 | 9 | 5 | 0 | 2 | No |
| Offline | 16 | 11 | 3 | 1 | 1 | No |
| Export | 16 | 12 | 4 | 0 | 0 | No |

## 4. Findings

Severity follows the release policy: **High** blocks release, **Medium** needs
a decision, **Low** is logged for a later release.

| ID | Severity | Area | Finding | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| F-01 | High | Refunds | A partial refund on a split payment books against the first tender only | UAT-024, build `b71e0d4`, screenshot E-11 | Open |
| F-02 | High | Sync | A device offline for more than 24 hours re-sends one batch after reconnecting | UAT-016, `pnpm test:sync` exit 1, log E-14 | Fix in review ([PR 812](https://example.test/pr/812)) |
| F-03 | Medium | Reports | Daily totals round half-down where the policy says half-even | UAT-047, query output E-19 | Decision needed |
| F-04 | Medium | Export | CSV export omits the currency column when only one currency is present | UAT-060, file E-21 | Open |
| F-05 | Low | Settings | The timezone picker lists a retired zone | UAT-038 | Logged |
| F-06 | Low | Sign-in | Error text says "account" where the glossary says "workspace" | UAT-001, screenshot E-02 | Logged |

### 4.1 F-01 in detail

A payment split across card and cash, refunded in part, books the whole refund
against the card tender. The ledger then shows a negative card balance for the
day. Reproduced on both environments.

### 4.2 F-02 in detail

After 26 hours offline, the device relay re-sent the first batch it had already
shipped. The sync service deduplicated it, so nothing was double-booked, but the
operator view counted it twice. The fix is in review.

## 5. Evidence register

| Ref | What | Where | Command or source | Exit |
| --- | --- | --- | --- | ---: |
| E-02 | Sign-in error text | screenshot | manual, UAT-2 | — |
| E-11 | Refund booked to card | screenshot | manual, UAT-2 | — |
| E-14 | Relay re-send | device log | `pnpm test:sync --device sim-7` | 1 |
| E-19 | Rounding difference | query output | `ledger-report daily --date 2026-10-14` | 0 |
| E-21 | CSV without currency | export file | `ledger-export --format csv` | 0 |
| E-30 | Full regression | CI run | `pnpm test` at `b71e0d4` | 0 |

## 6. Case log

Every case run in this round, in case order. The table is wide on purpose: it
is the shape a real acceptance log takes.

| Case | Area | Scenario | Env | Client | Tester | Steps | Duration | Status | Build | Defect | Note |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |
| UAT-001 | Sign-in | sign-in scenario 1 | UAT-1 | Android WebView | Tester C | 11 | 60s | **Pass** | `1bc0107` | — | as expected |
| UAT-002 | Accounts | accounts scenario 1 | UAT-2 | iOS WebView | Tester D | 12 | 8s | **Pass** | `ac7dc11` | — | as expected |
| UAT-003 | Payments | payments scenario 1 | UAT-2 | Firefox 133 | Tester B | 4 | 10s | **Pass** | `80fe9ab` | — | as expected |
| UAT-004 | Refunds | refunds scenario 1 | UAT-2 | Safari 18 | Tester A | 8 | 78s | **Pass** | `e3a79ba` | — | as expected |
| UAT-005 | Float | float scenario 1 | UAT-2 | Safari 18 | Tester D | 10 | 30s | **Pass** | `4dcc9c5` | — | as expected |
| UAT-006 | Sync | sync scenario 1 | UAT-1 | Chromium 131 | Tester B | 10 | 24s | **Pass** | `30869d9` | — | as expected |
| UAT-007 | Reports | reports scenario 1 | UAT-1 | Chromium 131 | Tester C | 8 | 85s | **Skipped** | `7523510` | — | out of scope for this round |
| UAT-008 | Settings | settings scenario 1 | UAT-2 | Safari 18 | Tester C | 13 | 88s | **Pass** | `fb77282` | — | as expected |
| UAT-009 | Offline | offline scenario 1 | UAT-1 | iOS WebView | Tester C | 7 | 17s | **Fail** | `473c3ab` | DEF-109 | see finding |
| UAT-010 | Export | export scenario 1 | UAT-1 | Chromium 131 | Tester D | 4 | 23s | **Fail** | `0017f5a` | DEF-110 | see finding |
| UAT-011 | Sign-in | sign-in scenario 2 | UAT-1 | Android WebView | Tester C | 4 | 55s | **Fail** | `0d96efd` | DEF-111 | see finding |
| UAT-012 | Accounts | accounts scenario 2 | UAT-2 | Safari 18 | Tester A | 11 | 27s | **Pass** | `5acb7eb` | — | as expected |
| UAT-013 | Payments | payments scenario 2 | UAT-2 | Chromium 131 | Tester C | 11 | 4s | **Pass** | `34765d4` | — | as expected |
| UAT-014 | Refunds | refunds scenario 2 | UAT-1 | Chromium 131 | Tester A | 14 | 69s | **Pass** | `c50c817` | — | as expected |
| UAT-015 | Float | float scenario 2 | UAT-2 | Chromium 131 | Tester B | 8 | 93s | **Pass** | `45d2d48` | — | as expected |
| UAT-016 | Sync | sync scenario 2 | UAT-2 | Android WebView | Tester D | 3 | 22s | **Pass** | `aead3c1` | — | as expected |
| UAT-017 | Reports | reports scenario 2 | UAT-2 | iOS WebView | Tester A | 4 | 90s | **Pass** | `7050e2b` | — | as expected |
| UAT-018 | Settings | settings scenario 2 | UAT-2 | Chromium 131 | Tester C | 5 | 90s | **Pass** | `c258e0d` | — | as expected |
| UAT-019 | Offline | offline scenario 2 | UAT-2 | Firefox 133 | Tester B | 3 | 34s | **Pass** | `e7c0257` | — | as expected |
| UAT-020 | Export | export scenario 2 | UAT-2 | Android WebView | Tester C | 7 | 51s | **Pass** | `93e9dfc` | — | as expected |
| UAT-021 | Sign-in | sign-in scenario 3 | UAT-2 | Firefox 133 | Tester D | 6 | 71s | **Fail** | `2b9e9ac` | DEF-121 | see finding |
| UAT-022 | Accounts | accounts scenario 3 | UAT-1 | iOS WebView | Tester B | 12 | 14s | **Pass** | `e4f7bd3` | — | as expected |
| UAT-023 | Payments | payments scenario 3 | UAT-2 | Android WebView | Tester D | 4 | 58s | **Pass** | `98d3610` | — | as expected |
| UAT-024 | Refunds | refunds scenario 3 | UAT-1 | Safari 18 | Tester C | 3 | 41s | **Fail** | `5a1f3cd` | DEF-124 | see finding |
| UAT-025 | Float | float scenario 3 | UAT-1 | Safari 18 | Tester B | 5 | 45s | **Pass** | `e7703fb` | — | as expected |
| UAT-026 | Sync | sync scenario 3 | UAT-2 | iOS WebView | Tester D | 11 | 78s | **Pass** | `98c2509` | — | as expected |
| UAT-027 | Reports | reports scenario 3 | UAT-1 | Firefox 133 | Tester D | 5 | 57s | **Pass** | `8111744` | — | as expected |
| UAT-028 | Settings | settings scenario 3 | UAT-2 | Firefox 133 | Tester B | 13 | 29s | **Skipped** | `5076575` | — | out of scope for this round |
| UAT-029 | Offline | offline scenario 3 | UAT-1 | Firefox 133 | Tester C | 14 | 25s | **Blocked** | `70d1efa` | — | environment unavailable |
| UAT-030 | Export | export scenario 3 | UAT-2 | Android WebView | Tester C | 3 | 13s | **Pass** | `22837fc` | — | as expected |
| UAT-031 | Sign-in | sign-in scenario 4 | UAT-1 | Safari 18 | Tester C | 7 | 89s | **Pass** | `443f2e4` | — | as expected |
| UAT-032 | Accounts | accounts scenario 4 | UAT-2 | Firefox 133 | Tester A | 3 | 23s | **Pass** | `529af09` | — | as expected |
| UAT-033 | Payments | payments scenario 4 | UAT-2 | Firefox 133 | Tester A | 7 | 49s | **Pass** | `4a30947` | — | as expected |
| UAT-034 | Refunds | refunds scenario 4 | UAT-1 | iOS WebView | Tester B | 6 | 78s | **Fail** | `d1b6c30` | DEF-134 | see finding |
| UAT-035 | Float | float scenario 4 | UAT-1 | Chromium 131 | Tester B | 9 | 95s | **Pass** | `71a4978` | — | as expected |
| UAT-036 | Sync | sync scenario 4 | UAT-1 | Safari 18 | Tester A | 8 | 56s | **Pass** | `994ad29` | — | as expected |
| UAT-037 | Reports | reports scenario 4 | UAT-2 | Safari 18 | Tester C | 6 | 61s | **Pass** | `ed3e18d` | — | as expected |
| UAT-038 | Settings | settings scenario 4 | UAT-2 | Chromium 131 | Tester D | 13 | 47s | **Fail** | `2d5877c` | DEF-138 | see finding |
| UAT-039 | Offline | offline scenario 4 | UAT-2 | Chromium 131 | Tester A | 4 | 77s | **Pass** | `6c883c8` | — | as expected |
| UAT-040 | Export | export scenario 4 | UAT-1 | Firefox 133 | Tester D | 13 | 82s | **Pass** | `4d1ce92` | — | as expected |
| UAT-041 | Sign-in | sign-in scenario 5 | UAT-1 | Safari 18 | Tester A | 11 | 7s | **Pass** | `878515a` | — | as expected |
| UAT-042 | Accounts | accounts scenario 5 | UAT-1 | Chromium 131 | Tester C | 11 | 49s | **Pass** | `4944589` | — | as expected |
| UAT-043 | Payments | payments scenario 5 | UAT-1 | iOS WebView | Tester A | 10 | 18s | **Pass** | `f6c5eff` | — | as expected |
| UAT-044 | Refunds | refunds scenario 5 | UAT-1 | Safari 18 | Tester B | 9 | 89s | **Fail** | `52007ac` | DEF-144 | see finding |
| UAT-045 | Float | float scenario 5 | UAT-1 | Safari 18 | Tester B | 9 | 75s | **Pass** | `4945757` | — | as expected |
| UAT-046 | Sync | sync scenario 5 | UAT-2 | Android WebView | Tester A | 3 | 6s | **Pass** | `38f5a71` | — | as expected |
| UAT-047 | Reports | reports scenario 5 | UAT-2 | iOS WebView | Tester A | 5 | 49s | **Pass** | `3a87411` | — | as expected |
| UAT-048 | Settings | settings scenario 5 | UAT-1 | Safari 18 | Tester C | 4 | 85s | **Pass** | `791c77c` | — | as expected |
| UAT-049 | Offline | offline scenario 5 | UAT-1 | Safari 18 | Tester D | 8 | 31s | **Pass** | `9d1940b` | — | as expected |
| UAT-050 | Export | export scenario 5 | UAT-2 | Chromium 131 | Tester A | 6 | 32s | **Pass** | `5c74be7` | — | as expected |
| UAT-051 | Sign-in | sign-in scenario 6 | UAT-1 | Android WebView | Tester A | 12 | 28s | **Fail** | `8f07799` | DEF-151 | see finding |
| UAT-052 | Accounts | accounts scenario 6 | UAT-1 | Chromium 131 | Tester A | 4 | 63s | **Pass** | `7219010` | — | as expected |
| UAT-053 | Payments | payments scenario 6 | UAT-2 | Chromium 131 | Tester C | 6 | 76s | **Pass** | `32b2635` | — | as expected |
| UAT-054 | Refunds | refunds scenario 6 | UAT-2 | Firefox 133 | Tester C | 6 | 56s | **Pass** | `e2e4c91` | — | as expected |
| UAT-055 | Float | float scenario 6 | UAT-1 | Android WebView | Tester C | 14 | 49s | **Pass** | `50ee639` | — | as expected |
| UAT-056 | Sync | sync scenario 6 | UAT-1 | Firefox 133 | Tester C | 3 | 36s | **Pass** | `e051926` | — | as expected |
| UAT-057 | Reports | reports scenario 6 | UAT-1 | Android WebView | Tester B | 4 | 93s | **Pass** | `9c373b2` | — | as expected |
| UAT-058 | Settings | settings scenario 6 | UAT-1 | Firefox 133 | Tester B | 6 | 67s | **Pass** | `7856f29` | — | as expected |
| UAT-059 | Offline | offline scenario 6 | UAT-2 | Safari 18 | Tester B | 12 | 40s | **Pass** | `85d4970` | — | as expected |
| UAT-060 | Export | export scenario 6 | UAT-2 | Firefox 133 | Tester D | 13 | 75s | **Pass** | `03a0b9e` | — | as expected |
| UAT-061 | Sign-in | sign-in scenario 7 | UAT-1 | Safari 18 | Tester D | 13 | 66s | **Pass** | `92ad0e6` | — | as expected |
| UAT-062 | Accounts | accounts scenario 7 | UAT-2 | Chromium 131 | Tester D | 13 | 7s | **Pass** | `210c4f9` | — | as expected |
| UAT-063 | Payments | payments scenario 7 | UAT-2 | Android WebView | Tester B | 10 | 51s | **Pass** | `2d29ace` | — | as expected |
| UAT-064 | Refunds | refunds scenario 7 | UAT-1 | Android WebView | Tester B | 8 | 86s | **Pass** | `5c20fd5` | — | as expected |
| UAT-065 | Float | float scenario 7 | UAT-1 | Android WebView | Tester A | 3 | 20s | **Pass** | `b9dcdd4` | — | as expected |
| UAT-066 | Sync | sync scenario 7 | UAT-1 | Safari 18 | Tester B | 9 | 47s | **Fail** | `545e103` | DEF-166 | see finding |
| UAT-067 | Reports | reports scenario 7 | UAT-2 | Android WebView | Tester B | 3 | 11s | **Fail** | `295361b` | DEF-167 | see finding |
| UAT-068 | Settings | settings scenario 7 | UAT-2 | Chromium 131 | Tester D | 7 | 46s | **Fail** | `ad66c28` | DEF-168 | see finding |
| UAT-069 | Offline | offline scenario 7 | UAT-2 | Chromium 131 | Tester A | 8 | 39s | **Pass** | `5045d2c` | — | as expected |
| UAT-070 | Export | export scenario 7 | UAT-2 | Chromium 131 | Tester B | 14 | 49s | **Fail** | `3dccea0` | DEF-170 | see finding |
| UAT-071 | Sign-in | sign-in scenario 8 | UAT-1 | Android WebView | Tester B | 10 | 50s | **Fail** | `9edebc3` | DEF-171 | see finding |
| UAT-072 | Accounts | accounts scenario 8 | UAT-2 | Firefox 133 | Tester B | 5 | 19s | **Blocked** | `429dac5` | — | environment unavailable |
| UAT-073 | Payments | payments scenario 8 | UAT-2 | Firefox 133 | Tester D | 3 | 61s | **Fail** | `d0b9b5d` | DEF-173 | see finding |
| UAT-074 | Refunds | refunds scenario 8 | UAT-2 | Chromium 131 | Tester A | 5 | 57s | **Skipped** | `506c9a3` | — | out of scope for this round |
| UAT-075 | Float | float scenario 8 | UAT-2 | Android WebView | Tester C | 4 | 39s | **Pass** | `ee142a2` | — | as expected |
| UAT-076 | Sync | sync scenario 8 | UAT-2 | Android WebView | Tester B | 7 | 35s | **Pass** | `81b7736` | — | as expected |
| UAT-077 | Reports | reports scenario 8 | UAT-1 | Chromium 131 | Tester C | 14 | 18s | **Pass** | `dba0f2a` | — | as expected |
| UAT-078 | Settings | settings scenario 8 | UAT-1 | Firefox 133 | Tester C | 14 | 47s | **Fail** | `a284873` | DEF-178 | see finding |
| UAT-079 | Offline | offline scenario 8 | UAT-1 | Safari 18 | Tester B | 14 | 37s | **Fail** | `fae6c8a` | DEF-179 | see finding |
| UAT-080 | Export | export scenario 8 | UAT-1 | Chromium 131 | Tester C | 13 | 15s | **Pass** | `3692436` | — | as expected |
| UAT-081 | Sign-in | sign-in scenario 9 | UAT-1 | Safari 18 | Tester B | 4 | 14s | **Skipped** | `ab863f7` | — | out of scope for this round |
| UAT-082 | Accounts | accounts scenario 9 | UAT-1 | Android WebView | Tester D | 6 | 64s | **Pass** | `d8a04ff` | — | as expected |
| UAT-083 | Payments | payments scenario 9 | UAT-1 | Android WebView | Tester B | 9 | 36s | **Pass** | `6c8fa45` | — | as expected |
| UAT-084 | Refunds | refunds scenario 9 | UAT-1 | iOS WebView | Tester B | 4 | 9s | **Pass** | `3dc5c9b` | — | as expected |
| UAT-085 | Float | float scenario 9 | UAT-1 | Android WebView | Tester D | 12 | 75s | **Pass** | `44e21ba` | — | as expected |
| UAT-086 | Sync | sync scenario 9 | UAT-1 | Safari 18 | Tester A | 7 | 83s | **Pass** | `4f53a59` | — | as expected |
| UAT-087 | Reports | reports scenario 9 | UAT-1 | iOS WebView | Tester C | 8 | 66s | **Pass** | `a212dba` | — | as expected |
| UAT-088 | Settings | settings scenario 9 | UAT-2 | Firefox 133 | Tester A | 14 | 95s | **Pass** | `6d242fa` | — | as expected |
| UAT-089 | Offline | offline scenario 9 | UAT-2 | Safari 18 | Tester C | 4 | 7s | **Pass** | `47a46e5` | — | as expected |
| UAT-090 | Export | export scenario 9 | UAT-2 | Safari 18 | Tester B | 6 | 64s | **Fail** | `40da5cd` | DEF-190 | see finding |
| UAT-091 | Sign-in | sign-in scenario 10 | UAT-2 | Android WebView | Tester B | 3 | 59s | **Skipped** | `82d835d` | — | out of scope for this round |
| UAT-092 | Accounts | accounts scenario 10 | UAT-1 | Android WebView | Tester D | 8 | 71s | **Pass** | `e1c6df9` | — | as expected |
| UAT-093 | Payments | payments scenario 10 | UAT-2 | Chromium 131 | Tester D | 6 | 43s | **Pass** | `1313a0a` | — | as expected |
| UAT-094 | Refunds | refunds scenario 10 | UAT-1 | Firefox 133 | Tester C | 7 | 89s | **Pass** | `f8746ad` | — | as expected |
| UAT-095 | Float | float scenario 10 | UAT-2 | Firefox 133 | Tester A | 3 | 31s | **Pass** | `ebb6eee` | — | as expected |
| UAT-096 | Sync | sync scenario 10 | UAT-1 | Firefox 133 | Tester D | 8 | 19s | **Pass** | `730778b` | — | as expected |
| UAT-097 | Reports | reports scenario 10 | UAT-1 | Android WebView | Tester A | 13 | 38s | **Pass** | `2f75341` | — | as expected |
| UAT-098 | Settings | settings scenario 10 | UAT-2 | Safari 18 | Tester C | 11 | 83s | **Pass** | `d2bb350` | — | as expected |
| UAT-099 | Offline | offline scenario 10 | UAT-2 | Chromium 131 | Tester B | 4 | 31s | **Pass** | `ca76bb2` | — | as expected |
| UAT-100 | Export | export scenario 10 | UAT-1 | Android WebView | Tester A | 4 | 77s | **Pass** | `1e03b7d` | — | as expected |
| UAT-101 | Sign-in | sign-in scenario 11 | UAT-2 | Safari 18 | Tester C | 7 | 7s | **Pass** | `f774d13` | — | as expected |
| UAT-102 | Accounts | accounts scenario 11 | UAT-1 | Firefox 133 | Tester B | 12 | 19s | **Pass** | `65e811e` | — | as expected |
| UAT-103 | Payments | payments scenario 11 | UAT-2 | iOS WebView | Tester D | 7 | 32s | **Pass** | `5a90d43` | — | as expected |
| UAT-104 | Refunds | refunds scenario 11 | UAT-1 | Android WebView | Tester A | 5 | 30s | **Pass** | `096f79f` | — | as expected |
| UAT-105 | Float | float scenario 11 | UAT-2 | Safari 18 | Tester B | 12 | 66s | **Pass** | `e1c7629` | — | as expected |
| UAT-106 | Sync | sync scenario 11 | UAT-2 | Chromium 131 | Tester D | 11 | 63s | **Pass** | `683e6b2` | — | as expected |
| UAT-107 | Reports | reports scenario 11 | UAT-2 | Chromium 131 | Tester D | 12 | 31s | **Fail** | `60c2a56` | DEF-207 | see finding |
| UAT-108 | Settings | settings scenario 11 | UAT-1 | Safari 18 | Tester C | 6 | 13s | **Pass** | `8a511ee` | — | as expected |
| UAT-109 | Offline | offline scenario 11 | UAT-1 | Firefox 133 | Tester B | 3 | 62s | **Pass** | `ee6c0f0` | — | as expected |
| UAT-110 | Export | export scenario 11 | UAT-2 | Firefox 133 | Tester C | 8 | 57s | **Pass** | `025eeec` | — | as expected |
| UAT-111 | Sign-in | sign-in scenario 12 | UAT-2 | Firefox 133 | Tester B | 6 | 74s | **Pass** | `1c8b752` | — | as expected |
| UAT-112 | Accounts | accounts scenario 12 | UAT-2 | iOS WebView | Tester B | 4 | 73s | **Pass** | `f9898fe` | — | as expected |
| UAT-113 | Payments | payments scenario 12 | UAT-1 | iOS WebView | Tester B | 9 | 49s | **Pass** | `873aadf` | — | as expected |
| UAT-114 | Refunds | refunds scenario 12 | UAT-2 | Android WebView | Tester B | 3 | 59s | **Pass** | `97ccfee` | — | as expected |
| UAT-115 | Float | float scenario 12 | UAT-2 | Firefox 133 | Tester B | 14 | 29s | **Pass** | `f11047c` | — | as expected |
| UAT-116 | Sync | sync scenario 12 | UAT-2 | Chromium 131 | Tester C | 3 | 41s | **Skipped** | `3ca0033` | — | out of scope for this round |
| UAT-117 | Reports | reports scenario 12 | UAT-2 | Android WebView | Tester D | 6 | 70s | **Pass** | `6c2ad8c` | — | as expected |
| UAT-118 | Settings | settings scenario 12 | UAT-2 | iOS WebView | Tester B | 13 | 42s | **Skipped** | `a92ba22` | — | out of scope for this round |
| UAT-119 | Offline | offline scenario 12 | UAT-2 | Safari 18 | Tester A | 14 | 30s | **Skipped** | `82bf725` | — | out of scope for this round |
| UAT-120 | Export | export scenario 12 | UAT-2 | Safari 18 | Tester D | 3 | 54s | **Fail** | `46a5469` | DEF-220 | see finding |
| UAT-121 | Sign-in | sign-in scenario 13 | UAT-1 | Android WebView | Tester A | 9 | 62s | **Pass** | `8960450` | — | as expected |
| UAT-122 | Accounts | accounts scenario 13 | UAT-2 | Safari 18 | Tester A | 6 | 58s | **Pass** | `565b4ec` | — | as expected |
| UAT-123 | Payments | payments scenario 13 | UAT-1 | Firefox 133 | Tester C | 6 | 50s | **Pass** | `75eee25` | — | as expected |
| UAT-124 | Refunds | refunds scenario 13 | UAT-2 | iOS WebView | Tester B | 3 | 84s | **Pass** | `32f311f` | — | as expected |
| UAT-125 | Float | float scenario 13 | UAT-2 | Firefox 133 | Tester C | 11 | 33s | **Pass** | `e7f26f5` | — | as expected |
| UAT-126 | Sync | sync scenario 13 | UAT-1 | Chromium 131 | Tester B | 13 | 42s | **Pass** | `c4c0432` | — | as expected |
| UAT-127 | Reports | reports scenario 13 | UAT-2 | Android WebView | Tester D | 3 | 19s | **Pass** | `a0c3b1c` | — | as expected |
| UAT-128 | Settings | settings scenario 13 | UAT-1 | Safari 18 | Tester D | 14 | 68s | **Fail** | `f95fcbd` | DEF-228 | see finding |
| UAT-129 | Offline | offline scenario 13 | UAT-2 | Android WebView | Tester C | 11 | 73s | **Pass** | `0feb4d8` | — | as expected |
| UAT-130 | Export | export scenario 13 | UAT-2 | Android WebView | Tester A | 11 | 74s | **Pass** | `3ac883d` | — | as expected |
| UAT-131 | Sign-in | sign-in scenario 14 | UAT-1 | iOS WebView | Tester B | 3 | 47s | **Pass** | `8d6ddca` | — | as expected |
| UAT-132 | Accounts | accounts scenario 14 | UAT-1 | Safari 18 | Tester D | 5 | 64s | **Pass** | `080457a` | — | as expected |
| UAT-133 | Payments | payments scenario 14 | UAT-2 | Firefox 133 | Tester B | 13 | 82s | **Pass** | `f99b1ed` | — | as expected |
| UAT-134 | Refunds | refunds scenario 14 | UAT-1 | iOS WebView | Tester A | 12 | 68s | **Pass** | `ea6bd4f` | — | as expected |
| UAT-135 | Float | float scenario 14 | UAT-2 | iOS WebView | Tester C | 10 | 69s | **Pass** | `a72eac9` | — | as expected |
| UAT-136 | Sync | sync scenario 14 | UAT-2 | Chromium 131 | Tester C | 7 | 63s | **Pass** | `a81d00c` | — | as expected |
| UAT-137 | Reports | reports scenario 14 | UAT-2 | Chromium 131 | Tester C | 14 | 74s | **Pass** | `9c42d18` | — | as expected |
| UAT-138 | Settings | settings scenario 14 | UAT-2 | Firefox 133 | Tester D | 10 | 22s | **Pass** | `aa86f12` | — | as expected |
| UAT-139 | Offline | offline scenario 14 | UAT-1 | Firefox 133 | Tester D | 8 | 86s | **Pass** | `4b6f17e` | — | as expected |
| UAT-140 | Export | export scenario 14 | UAT-2 | Firefox 133 | Tester A | 10 | 51s | **Pass** | `adc0500` | — | as expected |
| UAT-141 | Sign-in | sign-in scenario 15 | UAT-2 | Chromium 131 | Tester B | 5 | 25s | **Pass** | `78c5f38` | — | as expected |
| UAT-142 | Accounts | accounts scenario 15 | UAT-1 | Chromium 131 | Tester C | 9 | 56s | **Pass** | `86b6a35` | — | as expected |
| UAT-143 | Payments | payments scenario 15 | UAT-2 | Safari 18 | Tester C | 7 | 15s | **Pass** | `3023334` | — | as expected |
| UAT-144 | Refunds | refunds scenario 15 | UAT-2 | Chromium 131 | Tester D | 5 | 28s | **Skipped** | `59bc638` | — | out of scope for this round |
| UAT-145 | Float | float scenario 15 | UAT-2 | Android WebView | Tester B | 12 | 65s | **Pass** | `12f1a06` | — | as expected |
| UAT-146 | Sync | sync scenario 15 | UAT-1 | Chromium 131 | Tester D | 12 | 56s | **Fail** | `f77cacd` | DEF-246 | see finding |
| UAT-147 | Reports | reports scenario 15 | UAT-1 | Safari 18 | Tester B | 13 | 27s | **Pass** | `25348dc` | — | as expected |
| UAT-148 | Settings | settings scenario 15 | UAT-2 | Android WebView | Tester C | 8 | 69s | **Pass** | `fa9a772` | — | as expected |
| UAT-149 | Offline | offline scenario 15 | UAT-2 | Safari 18 | Tester D | 5 | 37s | **Pass** | `0d1bd38` | — | as expected |
| UAT-150 | Export | export scenario 15 | UAT-1 | Safari 18 | Tester B | 6 | 26s | **Pass** | `b908b54` | — | as expected |
| UAT-151 | Sign-in | sign-in scenario 16 | UAT-1 | iOS WebView | Tester B | 7 | 15s | **Pass** | `180f69a` | — | as expected |
| UAT-152 | Accounts | accounts scenario 16 | UAT-1 | iOS WebView | Tester D | 14 | 60s | **Pass** | `c9d4973` | — | as expected |
| UAT-153 | Payments | payments scenario 16 | UAT-2 | Safari 18 | Tester C | 13 | 37s | **Blocked** | `28139d9` | — | environment unavailable |
| UAT-154 | Refunds | refunds scenario 16 | UAT-1 | iOS WebView | Tester C | 3 | 72s | **Blocked** | `cef85d5` | — | environment unavailable |
| UAT-155 | Float | float scenario 16 | UAT-1 | Safari 18 | Tester D | 9 | 34s | **Fail** | `bae54e0` | DEF-255 | see finding |
| UAT-156 | Sync | sync scenario 16 | UAT-1 | Firefox 133 | Tester A | 13 | 78s | **Pass** | `60bdfa7` | — | as expected |
| UAT-157 | Reports | reports scenario 16 | UAT-2 | Chromium 131 | Tester B | 5 | 17s | **Pass** | `7816d7e` | — | as expected |
| UAT-158 | Settings | settings scenario 16 | UAT-2 | Chromium 131 | Tester B | 12 | 41s | **Fail** | `5d9bf55` | DEF-258 | see finding |
| UAT-159 | Offline | offline scenario 16 | UAT-2 | Chromium 131 | Tester A | 5 | 86s | **Fail** | `36feeec` | DEF-259 | see finding |
| UAT-160 | Export | export scenario 16 | UAT-2 | Android WebView | Tester C | 11 | 7s | **Pass** | `ff58ed4` | — | as expected |

## 7. Sign-off

| Role | Decision | Date |
| --- | --- | --- |
| Test lead | Conditional pass | 2026-10-16 |
| Product owner | Pending F-01, F-02 | — |
| Operations | Pass | 2026-10-16 |
