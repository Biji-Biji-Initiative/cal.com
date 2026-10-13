# One repository, existing branch

Owner decision: 13 October 2026.

Use `Biji-Biji-Initiative/cal.com` and
`work/cal-diy-enterprise-20261010` as the single development path.
The canonical task graph stays `docs/community-enterprise/TASK_GRAPH.json`;
issues #78 and #79 stay the delivery and research context.

The owner rejected a separate successor repository. Do not redirect agents,
CI, image publication, domains or infrastructure to another application repo.
Do not delete/recreate this repo, detach it from its fork network, rewrite
history, or rename it to implement this decision.

## Preserve work, not a parallel product

Continue from the current enterprise branch, not an older imported snapshot.
Keep existing CAL identities, prerequisites, proof records and release gates.
Unpublished draft research and attempted source changes must be inspected,
compared with current code, and tested before any carry-over. Their presence
on a working machine is not proof of a GitHub commit or successful acceptance.
CAL-01.REUSE remains responsible for this bounded reconciliation.
No completed work is reset and no task is marked complete by this correction.

## Source privacy is separate from repository identity

Readback found the existing repository public. The earlier private hosted
product intent remains; the owner's choice of this repository does not itself
change GitHub visibility or authorize publishing privately held material.
Preserve that material without creating another development home. The
visibility/access question must be handled on the existing repository without
sacrificing history, issues or established integrations. No access settings
were changed by this correction.

## Verification scope

The only intended repository changes are this decision record and top-level
task-graph mandate/tracking metadata. Existing task objects, milestones and
execution dependencies remain unchanged. Run the existing graph validator
and graph regression suite. This is source-governance verification, not
a new application build, deployment or runtime health claim.
