import { getDashboardMetrics } from "./analytics.service";
import { taskService } from "./task.service";

type EntityType = "task" | "sale" | "customer" | "product";

const toPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const summarizeTopRisk = (params: {
  highPriority: number;
  overdue: number;
  lowStock: number;
  monthChangePct: number;
}) => {
  if (params.overdue > 0) {
    return `${params.overdue} overdue task${params.overdue > 1 ? "s are" : " is"} blocking execution.`;
  }
  if (params.highPriority >= 5) {
    return `${params.highPriority} high-priority tasks are still open.`;
  }
  if (params.lowStock > 0) {
    return `${params.lowStock} low-stock products need attention.`;
  }
  if (params.monthChangePct < 0) {
    return `Revenue is trending ${toPercent(params.monthChangePct)} month-over-month.`;
  }
  return "Operations look stable today.";
};

export const adminAiInsightsService = {
  async buildPostActionInsight(
    userId: string,
    entityType: EntityType,
    entityLabel: string
  ) {
    const [metrics, taskSummary] = await Promise.all([
      getDashboardMetrics(userId),
      taskService.getTaskSummary(userId),
    ]);

    const highPriorityOpen = taskSummary.highPriorityTasks + taskSummary.urgentTasks;
    const risk = summarizeTopRisk({
      highPriority: highPriorityOpen,
      overdue: taskSummary.overdueTasks,
      lowStock: metrics.lowStockCount || 0,
      monthChangePct: metrics.monthChangePct || 0,
    });

    const suggestions: string[] = [];

    if (entityType === "sale" && metrics.monthChangePct < 8) {
      suggestions.push("Run a short upsell campaign for your top 5 customers this week.");
    }
    if (entityType === "product" && (metrics.lowStockCount || 0) > 0) {
      suggestions.push("Reorder low-stock items before promoting this catalog update.");
    }
    if (entityType === "task" && highPriorityOpen >= 5) {
      suggestions.push(`You have ${highPriorityOpen} high-priority tasks pending. Triage owners today.`);
    }
    if (!suggestions.length) {
      suggestions.push("Track this update on tomorrow's KPI check-in.");
    }

    return [
      `${entityLabel}`,
      `Insight: ${risk}`,
      `KPI note: Revenue ${toPercent(metrics.monthChangePct || 0)} vs last month, ${metrics.openTasks} open task(s).`,
      `Suggestion: ${suggestions[0]}`,
    ].join("\n");
  },

  async buildDashboardNarrative(userId: string) {
    const [metrics, taskSummary] = await Promise.all([
      getDashboardMetrics(userId),
      taskService.getTaskSummary(userId),
    ]);

    const growthText =
      metrics.monthChangePct >= 0
        ? `Revenue is up ${metrics.monthChangePct.toFixed(1)}% month-over-month.`
        : `Revenue is down ${Math.abs(metrics.monthChangePct).toFixed(1)}% month-over-month.`;

    const risk = summarizeTopRisk({
      highPriority: taskSummary.highPriorityTasks + taskSummary.urgentTasks,
      overdue: taskSummary.overdueTasks,
      lowStock: metrics.lowStockCount || 0,
      monthChangePct: metrics.monthChangePct || 0,
    });

    return `${growthText} ${risk}`;
  },
};
