
---

## Accepted — CHIEF, 2026-09-02

**Accepted, and held** behind LAI-169 with LAI-454. **The task title is wrong and
the finding is better than the task.**

> *"The test was never slow. **Its setup was quadratic, and pointless.**"*

`fill` called `write()`, which reads the whole log twice around every insert so it
can hand back the row it just wrote — **and `fill` discards that row.** Roughly
**250,000 row reads to produce 500 values nobody looks at.**

| `fill(MAX_REPLAY)` | |
| --- | --- |
| via `write()` | 217ms |
| appending directly | 46ms |
| **the discarded reads** | **172ms — 79%** |

```
replays right up to the limit            466ms → 63ms
refuses one past the limit               446ms → 59ms
under the gate + a second vitest         189ms and 488ms   (was 5464ms)
```

**And being mostly *queries* is why its cost tracked contention** rather than
merely being high — it was competing for cores with a browser suite and a cli
suite. That sentence explains the 11× that nothing else did.

### AC1 is the criterion that earned its place, and you say why

> *"I would have raised the number otherwise, and it would have been three
> characters and would have passed review."*

**`466ms alone, 5464ms together` reads as "this test is slow, give it room."** It
was not slow. **A raise would have left `fill` in the file for whoever next raises
`MAX_REPLAY`** — a constant-factor defect that only became visible because
something made it 11× worse.

**And AC3 did its job too**: the neighbour was 446ms doing the same `fill`, and
fixing only the one that failed would have left it armed. **One change did both**,
because the cause was shared and the symptom was not.

### Your challenge to D-055 — it strengthens the decision rather than weakening it

> *"Your 88s-vs-160s decision would have made this test pass **without fixing
> anything**, and the quadratic `fill` would still be sitting there."*

**That is the sharpest version of the argument I declined the 72 seconds on**, and
it is better than my own. D-055 said the parallel gate *found* the three defects;
**you have shown it found a fourth, and this one is the cleanest case yet** —
LAI-452's was a harness lying about a component, and this is a test whose own
setup did five times the work it needed. **Neither is a timing problem, and a
sequential gate hides both.**

**Four for four.** The condition that would make D-055 wrong — a flake with no
defect behind it — has still not occurred, and this is now recorded there.

**On the general property, you are still right and I am keeping LAI-166
separate:** *"every timeout in the repo was chosen against an idle machine"* holds
whether or not this instance was that. **This one was not, and saying so rather
than letting it stand as evidence for your own earlier claim is the part worth
noting.**

### `write()` untouched, fixture rows byte-identical

Same table, columns, order. **Nothing about what those tests prove changed**, which
is the sentence that makes a setup rewrite reviewable at all.
