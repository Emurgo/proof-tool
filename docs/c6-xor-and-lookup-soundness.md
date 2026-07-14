# C6 Merged XOR/AND Lookup: Soundness Failure and Removal

Date: 2026-07-13

Status: rejected and removed. The optimized V2 circuits use the original,
separate XOR and AND lookup tables, together with the independently accepted C8
constant-folding optimization. C6 contributes no constraint reduction to the
production circuit.

## Executive summary

C6 attempted to reduce circuit constraints by replacing two byte lookup queries

```text
xor = x XOR y
and = x AND y
```

with one lookup that returned both results. The combined table described each
return as eight bits, but those return widths controlled only how the lookup row
was packed. They did not independently constrain either returned field element
to the byte range `[0, 255]`.

That distinction created a nontrivial kernel in the packed representation. A
malicious hint could change the returned values together as follows:

```text
xor' = xor + 256
and' = and - 1
```

while leaving the packed lookup value unchanged. The lookup therefore accepted
values that were not the table's intended byte outputs. This is an
underconstraint: the circuit claimed that it had established the individual
XOR and AND results, but it had established only one packed linear combination
of them.

The merged lookup was removed. A sound alternative—range-constrain XOR to one
byte and derive `AND = (x + y - XOR) / 2`—was implemented and measured, but it
increased constraints substantially. Production consequently restored the two
separate lookup tables. A regression test now applies the coordinated malicious
hints while deliberately discarding both results, proving that the attack
cannot cross the separate-table boundary.

## What C6 was trying to optimize

The gnark byte API performs witness-dependent bitwise operations using lookup
tables. Before C6, XOR and AND were separate relations with separate queries and
separate hint returns:

```text
T_xor(x, y) -> xor
T_and(x, y) -> and
```

SHA-512 and related gadgets use both operations heavily. C6 proposed one table
query with two returns:

```text
T_xor_and(x, y) -> (xor, and)
```

The intended benefit was to share the input-side lookup work and obtain both
byte results from one packed row.

For honest byte inputs, the mathematical relation is correct:

```text
xor = x XOR y
and = x AND y
```

The problem was not the truth table. The problem was how two unconstrained
field-element returns were encoded into one lookup relation.

## The packed-row alias

Conceptually, a four-byte row can be packed as:

```text
row = x + 2^8*y + 2^16*xor + 2^24*and
```

The exact table machinery is less important than the resulting invariant: the
second output begins eight bits above the first output. If `xor` and `and` are
not individually range-constrained, then the following change has zero effect
on the packed row:

```text
delta(row)
  = 2^16 * delta(xor) + 2^24 * delta(and)
  = 2^16 * 256        + 2^24 * (-1)
  = 2^24              - 2^24
  = 0
```

Therefore:

```text
pack(x, y, xor + 256, and - 1)
  = pack(x, y, xor, and)
```

The declared return widths—described in the experiment as `rets=[8,8]`—were
packing metadata, not range constraints. They selected offsets in the packed
row but did not prove:

```text
0 <= xor < 256
0 <= and < 256
```

The same structural issue exists for any pair of adjacent packed returns when
the lower return can overflow by one radix unit and the higher return can
decrease by one.

## Why this is a soundness issue

Hints are untrusted witness-generation aids. A hint may calculate the honest
answer, but circuit soundness must come entirely from constraints. A prover is
allowed to supply any witness values that satisfy those constraints.

The merged construction constrained only the packed row. It did not uniquely
bind the two logical outputs. Consequently, at least two distinct output pairs
represented the same accepted lookup row:

```text
(xor,       and)
(xor + 256, and - 1)
```

The second pair is not a pair of bytes and does not represent the intended XOR
and AND results. Downstream gadgets are entitled to rely on `uints.U8` values
being canonical bytes; allowing aliased field values across that boundary can
invalidate later arithmetic and range arguments.

This conclusion does not depend on demonstrating a complete forged ownership
proof. A reusable byte primitive that admits unintended witnesses is already
outside the circuit's claimed relation and cannot be included in a production
proof system.

## How the issue was reproduced

The adversarial test overrides the production XOR and AND hints:

```text
corruptXor: xor -> xor + 256
corruptAnd: and -> and - 1
```

The important regression circuit deliberately discards both returned values.
This prevents later equality assertions from hiding whether the lookup boundary
itself is sound. Under the rejected merged table, the coordinated changes could
preserve the packed lookup row. With the restored separate tables, the same
overrides fail.

The retained test is:

```text
internal/circuit/uintsopt/merged_xor_and_test.go
  TestC6RejectedMultiReturnAliasCannotCrossSeparateProductionTables
```

The same file also checks 1,000 deterministic XOR/AND reference cases,
XOR-to-AND and AND-to-XOR transitions, and independent corrupt-result
rejections.

## Alternatives considered

### 1. Keep the merged table and add explicit output ranges

Both returned values could be independently constrained to eight bits. That
would remove the alias because `xor + 256` would be rejected. It would also add
range-check work that eroded the proposed saving. This form was not adopted.

### 2. Keep one XOR lookup and derive AND algebraically

For byte integers:

```text
x + y = (x XOR y) + 2*(x AND y)
```

so a circuit can use:

```text
xor = T_xor(x, y)
assert 0 <= xor < 256
and = (x + y - xor) / 2
```

This construction was implemented with an explicit eight-bit bound on XOR and
was sound under the reviewed attack. It was rejected for performance: it
increased rather than reduced the constraint counts.

| Circuit | Pre-C6/restored | Sound XOR-derived-AND alternative | Regression |
| --- | ---: | ---: | ---: |
| `root-ownership-v1` | 2,353,814 | 2,939,560 | +585,746 |
| `root-ownership-destination-v1` | 2,353,930 | 2,939,676 | +585,746 |
| `root-ownership-multi-destination-v1-count2` | 4,575,977 | 5,813,136 | +1,237,159 |

The first two circuits regressed by about 24.9%; the count-two multi circuit
regressed by about 27.0%. That was incompatible with C6's purpose.

### 3. Restore separate production tables

This is the adopted replacement:

```text
T_xor(x, y) -> xor
T_and(x, y) -> and
```

Each query has one return and its own table relation. An overflow in the XOR
return cannot be canceled by changing an AND return in a different query. The
coordinated `xor += 256` / `and -= 1` test rejects even when both results are
otherwise unused.

The accepted C8 optimization remains in place. C8 folds XOR, AND, or OR only
when both operands are compiler constants that have already passed byte-width
checks. That path introduces no witness-dependent hint outputs and therefore
does not recreate C6's alias.

## Final production decision

- The merged multi-return XOR/AND table is absent from production.
- The experimental C6 patch was removed.
- Separate XOR and AND lookup tables were restored exactly.
- C8 constant folding remains enabled for compiler-constant operands.
- C6 records no constraint saving in the V2 constraint ledger.
- Reconsidering a merged lookup requires a new construction with independently
  constrained canonical outputs, malicious-hint tests at the primitive
  boundary, and a favorable full-circuit constraint measurement.

## Verification

The focused regression can be run from the repository root:

```bash
go test ./internal/circuit/uintsopt -run 'TestC6'
```

Full acceptance also requires the circuit gate suites, golden credential and
public-input equality, one-commitment invariant, and vendor patch drift replay.

## Related evidence

- `docs/single-claim-optimization-execplan.md`, C6 progress entry and Phase
  3.3 finding 6.
- `docs/circuit-v2-constraint-ledger.md`, C6 rows.
- `internal/circuit/uintsopt/merged_xor_and_test.go`, retained differential and
  malicious-hint regressions.
- `experiments/wasm-prover/patches/uints-constant-fold.patch`, retained C8
  constant-folding patch.
