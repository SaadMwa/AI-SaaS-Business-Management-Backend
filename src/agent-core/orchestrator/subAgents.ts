import { IntentType } from "../types";

export const pickSubAgent = (intent: IntentType) => {
  if (intent.includes("task") || intent.includes("workload")) return "OpsAgent";
  if (intent.includes("report") || intent.includes("productivity") || intent.includes("risk"))
    return "AnalystAgent";
  if (intent.includes("strategic")) return "StrategyAgent";
  return "ManagerAgent";
};
