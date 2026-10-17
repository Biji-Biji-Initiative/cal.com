# Explainable team routing ºw^~)Þt 2026-10-17

This source slice advances CAL-10.ROUTING without coupling routing to the live
deployment or silently selecting a team. The resolveTeamRoute pure policy
function lives under packages/features/community-enterprise/routing. It accepts
operator-authored rules and an explicit set of eligible team IDs.

## Contract

- programme, service and language values are normalized with trim and
  locale-stable lower-casing before comparison;
- a rule may constrain any subset of the three dimensions; an omitted or null
  dimension is an explicit wildcard;
- disabled rules, invalid team IDs and teams outside the caller-provided
  eligibility set are ignored;
- non-fallback rules always outrank fallback rules;
- among matching rules, greater specificity wins, then lower operator priority,
  then a stable rule-ID tie-breaker;
- a no-eligible-team result is distinct from a no-matching-rule result; both
  return an operator-readable explanation and never invent a team;
- the result includes the selected rule, team, fallback flag and matched
  dimensions so a caller can record why a route was selected.

## Verification

Command:

    node --test --test-reporter=spec tests/community-enterprise/routing-policy.test.cjs

Result: six tests passed, zero failures, zero skips on the current branch.
The tests cover normalization, specificity, priority, deterministic tie-breaking,
explicit fallback behavior, disabled/ineligible rules, invalid IDs and both
no-match outcomes.

This is source-level routing policy proof. It is not a claim that a production
programme catalog, live team directory, browser route or preview deployment now
uses the policy. Wiring it to those surfaces remains a separate integration
decision and acceptance.