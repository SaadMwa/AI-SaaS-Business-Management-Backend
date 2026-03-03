import { AgentEntity, IntentResult, IntentType } from "../types";
import { PerceptionResult } from "../perception/perception";

const INTENT_RULES: Array<{
  intent: IntentType;
  patterns: RegExp[];
  weight: number;
}> = [
  {
    intent: "create_task",
    patterns: [/\bcreate task\b/, /\bcreate a task\b/, /\badd task\b/, /\badd a task\b/, /\bnew task\b/],
    weight: 0.85,
  },
  {
    intent: "update_task",
    patterns: [
      /\bupdate task\b/,
      /\bupdate the task\b/,
      /\bedit task\b/,
      /\bchange task\b/,
      /\bunassign task\b/,
      /\bmake the priority\b/,
      /\bset the priority\b/,
    ],
    weight: 0.75,
  },
  { intent: "delete_task", patterns: [/\bdelete task\b/, /\bremove task\b/], weight: 0.85 },
  { intent: "assign_task", patterns: [/\bassign task\b/, /\bassign\b.*\btask\b/], weight: 0.7 },
  {
    intent: "change_status",
    patterns: [/\bchange status\b/, /\bset status\b/, /\bmark task\b/, /\bmove task\b/],
    weight: 0.85,
  },
  {
    intent: "change_priority",
    patterns: [/\bchange priority\b/, /\bset priority\b/, /\bmake priority\b/],
    weight: 0.85,
  },
  {
    intent: "list_tasks",
    patterns: [/\blist tasks\b/, /\bshow tasks\b/, /\btask list\b/, /\bmy tasks\b/],
    weight: 0.65,
  },
  {
    intent: "create_customer",
    patterns: [/\bcreate customer\b/, /\badd customer\b/, /\bnew customer\b/],
    weight: 0.8,
  },
  {
    intent: "update_customer",
    patterns: [/\bupdate customer\b/, /\bedit customer\b/, /\bchange customer\b/],
    weight: 0.8,
  },
  {
    intent: "delete_customer",
    patterns: [/\bdelete customer\b/, /\bremove customer\b/],
    weight: 0.85,
  },
  {
    intent: "view_customer",
    patterns: [/\bview customer\b/, /\bshow customer\b/, /\bget customer\b/],
    weight: 0.7,
  },
  {
    intent: "list_customers",
    patterns: [/\blist customers\b/, /\bshow customers\b/, /\bcustomer list\b/],
    weight: 0.7,
  },
  {
    intent: "create_sale",
    patterns: [/\bcreate sale\b/, /\badd sale\b/, /\bnew sale\b/],
    weight: 0.8,
  },
  {
    intent: "update_sale",
    patterns: [/\bupdate sale\b/, /\bedit sale\b/, /\bchange sale\b/],
    weight: 0.8,
  },
  {
    intent: "delete_sale",
    patterns: [/\bdelete sale\b/, /\bremove sale\b/],
    weight: 0.85,
  },
  {
    intent: "view_sale",
    patterns: [/\bview sale\b/, /\bshow sale\b/, /\bget sale\b/],
    weight: 0.7,
  },
  {
    intent: "assign_sale",
    patterns: [/\bassign sale\b/, /\bassign\b.*\bsale\b/],
    weight: 0.75,
  },
  {
    intent: "change_sale_status",
    patterns: [/\bchange sale status\b/, /\bset sale status\b/],
    weight: 0.75,
  },
  {
    intent: "list_sales",
    patterns: [/\blist sales\b/, /\bshow sales\b/, /\bsales list\b/],
    weight: 0.7,
  },
  { intent: "reprioritize_tasks", patterns: [/\breprioritize\b/, /\bchange priority\b/], weight: 0.7 },
  { intent: "optimize_workload", patterns: [/\boptimize workload\b/, /\bbalance workload\b/], weight: 0.7 },
  { intent: "schedule_plan", patterns: [/\bschedule\b/, /\bplan\b.*\btask\b/], weight: 0.6 },
  { intent: "generate_report", patterns: [/\breport\b/, /\bdaily summary\b/, /\bweekly summary\b/], weight: 0.7 },
  { intent: "analyze_productivity", patterns: [/\bproductivity\b/, /\bperformance\b/], weight: 0.65 },
  { intent: "detect_risk", patterns: [/\brisk\b/, /\balert\b/, /\bissue\b/], weight: 0.6 },
  { intent: "automate_workflow", patterns: [/\bautomate\b/, /\bauto\b.*\bworkflow\b/], weight: 0.7 },
  { intent: "negotiate_deadline", patterns: [/\bmove deadline\b/, /\bextend\b.*\bdue\b/], weight: 0.7 },
  { intent: "strategic_planning", patterns: [/\bstrategy\b/, /\bstrategic\b/, /\blong[- ]term\b/], weight: 0.6 },
];

export const detectIntent = (perception: PerceptionResult): IntentResult => {
  let bestIntent: IntentType = "chat";
  let bestScore = 0.1;
  const rationale: string[] = [];

  const createHeuristic =
    /\b(create|add|new)\b.*\btask\b/.test(perception.normalized) ||
    /\btask\b.*\b(create|add|new)\b/.test(perception.normalized);
  if (createHeuristic) {
    bestIntent = "create_task";
    bestScore = Math.max(bestScore, 0.7);
    rationale.push("heuristic:create_task");
  }

  const updateHeuristic =
    /\bupdate\b.*\btask\b/.test(perception.normalized) ||
    /\bchange\b.*\bpriority\b/.test(perception.normalized) ||
    /\bmake\b.*\bpriority\b/.test(perception.normalized);
  if (updateHeuristic && bestIntent === "chat") {
    bestIntent = "update_task";
    bestScore = Math.max(bestScore, 0.7);
    rationale.push("heuristic:update_task");
  }

  INTENT_RULES.forEach((rule) => {
    const matches = rule.patterns.some((pattern) => pattern.test(perception.normalized));
    if (matches) {
      const score = rule.weight;
      if (score > bestScore) {
        bestScore = score;
        bestIntent = rule.intent;
      }
      rationale.push(`matched:${rule.intent}`);
    }
  });

  const confidence = Math.min(1, Math.max(bestScore, 0.1));

  return {
    intent: bestIntent,
    confidence,
    entities: perception.entities as AgentEntity,
    rationale,
  };
};
