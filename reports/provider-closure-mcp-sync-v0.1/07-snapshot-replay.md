# T7/T9 Immutable Snapshot and Replay

Status: PASS

- Capture pins one `asOfProjectedAt` and reads all binding, fact, relation and Runtime Evidence pages
  under that bound.
- A second capture must match the first identity; bounded movement returns `blocked_drift` and publishes
  no mixed snapshot.
- Closure content includes the authoritative bindings, selected facts, approved relations, Runtime
  semantic rows, mapping contracts and cutoff.
- Same input, cutoff and contracts produces the same closure hash and snapshot ID.
- Late evidence evaluated under a later cutoff produces a different immutable snapshot; the earlier
  manifest and detail rows remain queryable.
- Details are inserted before the manifest. Consumer views inner-join the immutable manifest, so a
  crash that leaves detail rows without the manifest cannot make them formally visible.

The remote qualification snapshot `sha256:1d7fe514fd8fa3234b247ed7f8d215777938f3de47c7b4ecd037cb024d49d1f3`
replayed deterministically and was visible through the manifest-gated v2 views.
