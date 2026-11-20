# infra/mesh — reference only, nothing deployed

These files are Helm values sketches kept as a decision aid for the service
mesh evaluation in `docs/architecture/service-mesh-evaluation.md`.

**Nothing in this directory is applied to any environment.** The production
topology is a single-host Docker Compose stack (`infra/origin/compose.yaml`)
with no Kubernetes, and the evaluation's conclusion is that a service mesh is
overkill until the triggers in the doc's §6 are met.

- `linkerd-values.yaml` — mTLS/policy sketch for a hypothetical K8s move.
- `cilium-values.yaml` — preferred K8s mesh (eBPF, no sidecars) sketch for
  the same hypothetical.

If a trigger fires, start from the doc, pick a platform, then adapt these
values rather than re-running the evaluation from scratch.
