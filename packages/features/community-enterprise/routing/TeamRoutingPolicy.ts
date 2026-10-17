// SPDX-License-Identifier: MIT

export type RoutingDimension = "programme" | "service" | "language";

export type RoutingRule = {
  id: string;
  teamId: number;
  programme?: string | null;
  service?: string | null;
  language?: string | null;
  priority?: number;
  fallback?: boolean;
  enabled?: boolean;
};

export type RoutingRequest = {
  programme?: string | null;
  service?: string | null;
  language?: string | null;
  eligibleTeamIds: readonly number[];
};

export type RoutingDecision =
  | {
      kind: "matched";
      teamId: number;
      ruleId: string;
      fallback: boolean;
      matchedDimensions: RoutingDimension[];
      explanation: string;
    }
  | {
      kind: "no_match";
      reason: "no-eligible-team" | "no-matching-rule";
      explanation: string;
    };

const DIMENSIONS: readonly RoutingDimension[] = ["programme", "service", "language"];

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized.length ? normalized : null;
}

function validId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function ruleMatches(rule: RoutingRule, request: RoutingRequest): RoutingDimension[] | null {
  const matched: RoutingDimension[] = [];
  for (const dimension of DIMENSIONS) {
    const expected = normalize(rule[dimension]);
    const actual = normalize(request[dimension]);
    if (expected === null) continue;
    if (actual === null || expected !== actual) return null;
    matched.push(dimension);
  }
  return matched;
}

/**
 * Resolve one operator-authored rule. Wildcards are explicit null fields;
 * fallback rules are considered only after all non-fallback rules.
 */
export function resolveTeamRoute(rules: readonly RoutingRule[], request: RoutingRequest): RoutingDecision {
  const eligible = new Set(request.eligibleTeamIds.filter(validId));
  if (eligible.size === 0) {
    return {
      kind: "no_match",
      reason: "no-eligible-team",
      explanation: "No active team is eligible for this request.",
    };
  }

  const candidates = rules
    .filter((rule) => rule.enabled !== false && eligible.has(rule.teamId) && validId(rule.teamId))
    .map((rule, index) => ({ rule, index, matched: ruleMatches(rule, request) }))
    .filter((candidate): candidate is { rule: RoutingRule; index: number; matched: RoutingDimension[] } => candidate.matched !== null);

  if (candidates.length === 0) {
    return {
      kind: "no_match",
      reason: "no-matching-rule",
      explanation: "No enabled routing rule matches the requested programme, service and language.",
    };
  }

  const ordered = candidates.sort((left, right) => {
    const fallbackDifference = Number(Boolean(left.rule.fallback)) - Number(Boolean(right.rule.fallback));
    if (fallbackDifference !== 0) return fallbackDifference;
    const specificityDifference = right.matched.length - left.matched.length;
    if (specificityDifference !== 0) return specificityDifference;
    const priorityDifference = (left.rule.priority ?? 0) - (right.rule.priority ?? 0);
    if (priorityDifference !== 0) return priorityDifference;
    const idDifference = left.rule.id.localeCompare(right.rule.id);
    return idDifference !== 0 ? idDifference : left.index - right.index;
  });
  const selected = ordered[0];
  if (!selected) {
    return {
      kind: "no_match",
      reason: "no-matching-rule",
      explanation: "No enabled routing rule matches the requested programme, service and language.",
    };
  }
  const fallback = Boolean(selected.rule.fallback);
  const matchedText = selected.matched.length ? selected.matched.join(", ") : "wildcard";
  return {
    kind: "matched",
    teamId: selected.rule.teamId,
    ruleId: selected.rule.id,
    fallback,
    matchedDimensions: selected.matched,
    explanation: fallback
      ? `Fallback rule ${selected.rule.id} selected for eligible team ${selected.rule.teamId}; matched ${matchedText}.`
      : `Rule ${selected.rule.id} selected for eligible team ${selected.rule.teamId}; matched ${matchedText}.`,
  };
}
