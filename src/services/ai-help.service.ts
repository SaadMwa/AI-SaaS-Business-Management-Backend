export const aiHelpService = {
  getGuide: (role: string = "admin") => {
    const roleLabel = role === "admin" ? "Admin" : "Store";
    return {
      welcome: {
        title: `Welcome to your ${roleLabel} AI Assistant`,
        description:
          "Your AI assistant helps you manage operations with strict role boundaries and DB-grounded responses.",
      },
      role: roleLabel,
      modes:
        role === "admin"
          ? [
              { id: "analytics", label: "Analytics", description: "Revenue, trends, KPIs, and forecasting." },
              { id: "inventory", label: "Inventory", description: "Stock levels, low stock risk, reorder priorities." },
              { id: "crm", label: "CRM", description: "Customer activity, retention, top accounts." },
              { id: "operations", label: "Operations", description: "Tasks, assignments, blockers, and workflow." },
              { id: "strategy", label: "Strategy", description: "Growth recommendations and execution plans." },
            ]
          : [{ id: "store", label: "Store AI", description: "Product-only support: catalog, price, stock, recommendations." }],
      overview: [
        "Strict role-based permissions for Admin AI vs Store AI.",
        "AI answers are grounded in database records first.",
        "Includes proactive follow-up actions after each response.",
      ],
      capabilities: {
        tasks: ["Create, update, delete, assign, and unassign tasks with step-by-step prompts."],
        customers: ["Create, update, delete, and review customer details."],
        sales: ["Create sales conversationally with product, quantity, and auto total validation."],
        products: ["Create products conversationally with name, description, price, stock, category, and image URL."],
        insights: ["Ask for summaries, recent activity, and revenue trends."],
        history: ["View and manage action history with filters and retention."],
      },
      howToTalk: {
        basic: [
          "Mode analytics: summarize this month performance",
          "Mode inventory: show low stock warnings",
          "Mode strategy: what should we improve this week?",
        ],
        tasks: ["Create a task to call ACME tomorrow", "Assign task #12 to ali@company.com", "Cancel flow"],
        customers: ["Update customer #4 email to sara@acme.com", "Show customer #2 recent purchases"],
        sales: ["Create a sale for wireless mouse quantity 3", "Show sale #15 details"],
        products: [
          "Add a product with price 199.99 and stock 20",
          "Unassign task #12",
          "Update product #7 price to 149.99",
          "Show low stock products",
          "Show sales report for last 30 days",
        ],
        history: [
          "Show history of tasks",
          "Delete history older than 30 days",
          "Clear history for customer #3",
          "Export history as csv",
        ],
      },
      interactiveExamples: [
        "Mode analytics: summarize KPIs and suggest next actions",
        "Mode inventory: list low stock and featured product ideas",
        "Mode CRM: identify customers to re-engage",
        "Mode operations: find overdue tasks and assign owners",
        "Mode strategy: propose a 30-day growth plan",
        "Create a task to follow up with ACME on Monday",
        "Update sale #11 status to paid",
        "Unassign task #12",
        "Update product #7 price to 149.99",
        "Show sales report for last 30 days",
        "Show low stock products",
        "Export history as csv",
      ],
      tips: [
        "Prefix with mode when needed: Mode analytics / inventory / crm / operations / strategy.",
        "Use Cancel flow or Reset conversation to avoid state bleed.",
        "For destructive actions, AI requires confirmation.",
      ],
    };
  },
};
