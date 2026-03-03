import mongoose from "mongoose";
import { Sale } from "../models/sale";
import { Task } from "../models/task";
import { Customer } from "../models/customer";
import { Product } from "../models/product";

export interface Insight {
  id: string;
  type: "opportunity" | "risk" | "efficiency";
  title: string;
  message: string;
  action: string;
  priority: "low" | "medium" | "high";
  data?: Record<string, unknown>;
}

const getMonthLabel = (date: Date) =>
  date.toLocaleString("en-US", { month: "short" });

export const getSalesTrend = async (userId: string) => {
  const now = new Date();
  const monthsToShow = 6;
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsToShow - 1), 1);

  const results = await Sale.aggregate([
    {
      $match: {
        createdBy: new mongoose.Types.ObjectId(userId),
        status: "paid",
        date: { $gte: start },
      },
    },
    {
      $group: {
        _id: { year: { $year: "$date" }, month: { $month: "$date" } },
        revenue: { $sum: "$total" },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);

  const trend: { month: string; revenue: number }[] = [];
  for (let i = monthsToShow - 1; i >= 0; i -= 1) {
    const pointDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const match = results.find(
      (r) => r._id.year === pointDate.getFullYear() && r._id.month === pointDate.getMonth() + 1
    );
    trend.push({ month: getMonthLabel(pointDate), revenue: match?.revenue || 0 });
  }

  return trend;
};

export const getDashboardMetrics = async (userId: string) => {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalRevenueAgg,
    currentMonthAgg,
    prevMonthAgg,
    avgDealAgg,
    openTasks,
    recentTasksAgg,
    last30RevenueAgg,
    activeCustomers,
    salesTrend,
    lowStockProducts,
    pendingTasksByPriorityAgg,
    topSellingProductsAgg,
    activeCustomersLast30,
    returningCustomersLast30Agg,
  ] = await Promise.all([
    Sale.aggregate([
      { $match: { createdBy: new mongoose.Types.ObjectId(userId), status: "paid" } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Sale.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          status: "paid",
          date: { $gte: currentMonthStart },
        },
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Sale.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          status: "paid",
          date: { $gte: prevMonthStart, $lte: prevMonthEnd },
        },
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Sale.aggregate([
      { $match: { createdBy: new mongoose.Types.ObjectId(userId), status: "paid" } },
      { $group: { _id: null, avg: { $avg: "$total" }, count: { $sum: 1 } } },
    ]),
    Task.countDocuments({ createdBy: userId, status: { $ne: "done" } }),
    Task.aggregate([
      { $match: { createdBy: new mongoose.Types.ObjectId(userId), createdAt: { $gte: last30Start } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
    Sale.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          status: "paid",
          date: { $gte: last30Start },
        },
      },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    Customer.countDocuments({ createdBy: userId }),
    getSalesTrend(userId),
    Product.find({ createdBy: new mongoose.Types.ObjectId(userId), stock_quantity: { $lte: 5 } })
      .sort({ stock_quantity: 1, updatedAt: -1 })
      .limit(8)
      .select("name stock_quantity category price")
      .lean(),
    Task.aggregate([
      { $match: { createdBy: new mongoose.Types.ObjectId(userId), status: { $ne: "done" } } },
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          date: { $gte: last30Start },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          quantity: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.quantity", "$items.price"] } },
        },
      },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 5 },
    ]),
    Sale.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          date: { $gte: last30Start },
        },
      },
      { $group: { _id: "$customerId" } },
      { $count: "count" },
    ]),
    Sale.aggregate([
      {
        $match: {
          createdBy: new mongoose.Types.ObjectId(userId),
          date: { $gte: last30Start },
        },
      },
      { $group: { _id: "$customerId", orders: { $sum: 1 } } },
      { $match: { orders: { $gte: 2 } } },
      { $count: "count" },
    ]),
  ]);

  const totalRevenue = totalRevenueAgg[0]?.total || 0;
  const currentMonthRevenue = currentMonthAgg[0]?.total || 0;
  const prevMonthRevenue = prevMonthAgg[0]?.total || 0;
  const avgDealSize = avgDealAgg[0]?.avg || 0;
  const totalDeals = avgDealAgg[0]?.count || 0;
  const last30Revenue = last30RevenueAgg[0]?.total || 0;

  const monthChangePct = prevMonthRevenue
    ? ((currentMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100
    : currentMonthRevenue > 0
    ? 100
    : 0;

  const doneCount = recentTasksAgg.find((t) => t._id === "done")?.count || 0;
  const totalRecentTasks = recentTasksAgg.reduce((sum, t) => sum + t.count, 0);
  const completionRate = totalRecentTasks ? (doneCount / totalRecentTasks) * 100 : 0;

  const forecastRevenue = Math.max(0, last30Revenue * (1 + monthChangePct / 100));

  const pendingTasksByPriority = pendingTasksByPriorityAgg.reduce(
    (acc, row) => {
      const key = String(row._id || "medium");
      if (key in acc) {
        acc[key as keyof typeof acc] = row.count;
      }
      return acc;
    },
    { low: 0, medium: 0, high: 0, urgent: 0 }
  );

  const topSellingProducts = topSellingProductsAgg.map((item) => ({
    name: String(item._id || "Unknown"),
    quantity: Number(item.quantity || 0),
    revenue: Number(item.revenue || 0),
  }));

  const customerActivity = {
    activeLast30Days: activeCustomersLast30[0]?.count || 0,
    returningLast30Days: returningCustomersLast30Agg[0]?.count || 0,
    totalCustomers: activeCustomers,
    retentionRate:
      activeCustomersLast30[0]?.count > 0
        ? ((returningCustomersLast30Agg[0]?.count || 0) / activeCustomersLast30[0].count) * 100
        : 0,
  };

  const projected30DaysRevenue = Math.max(0, last30Revenue * (1 + monthChangePct / 100));
  const trendDirection = monthChangePct >= 0 ? "up" : "down";
  const predictiveInsights = {
    projected30DaysRevenue,
    trendDirection,
    confidence: Math.min(85, Math.max(55, 70 + (monthChangePct > 0 ? 8 : -6))),
  };

  const dashboardSummary = [
    monthChangePct >= 0
      ? `Revenue is up ${monthChangePct.toFixed(1)}% versus last month.`
      : `Revenue is down ${Math.abs(monthChangePct).toFixed(1)}% versus last month.`,
    `${openTasks} open tasks and ${lowStockProducts.length} low-stock products need attention.`,
    topSellingProducts[0]
      ? `Top seller this month is ${topSellingProducts[0].name}.`
      : "No top-selling product detected in the last 30 days.",
  ].join(" ");

  return {
    totalRevenue,
    currentMonthRevenue,
    monthChangePct,
    avgDealSize,
    totalDeals,
    openTasks,
    completionRate,
    forecastRevenue,
    activeCustomers,
    salesTrend,
    lowStockCount: lowStockProducts.length,
    lowStockProducts: lowStockProducts.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      stock_quantity: item.stock_quantity,
      category: item.category || "General",
      price: item.price,
    })),
    pendingTasksByPriority,
    topSellingProducts,
    customerActivity,
    predictiveInsights,
    dashboardSummary,
  };
};

export const generateInsights = async (userId: string): Promise<Insight[]> => {
  const metrics = await getDashboardMetrics(userId);
  const now = new Date();

  const overdueTasks = await Task.countDocuments({
    createdBy: userId,
    status: { $ne: "done" },
    dueDate: { $lt: now },
  });

  const topCustomerAgg = await Sale.aggregate([
    { $match: { createdBy: new mongoose.Types.ObjectId(userId), status: "paid" } },
    { $group: { _id: "$customerId", revenue: { $sum: "$total" } } },
    { $sort: { revenue: -1 } },
    { $limit: 1 },
  ]);

  const topCustomerRevenue = topCustomerAgg[0]?.revenue || 0;
  const topCustomerShare = metrics.totalRevenue
    ? topCustomerRevenue / metrics.totalRevenue
    : 0;

  const insights: Insight[] = [];

  if (metrics.monthChangePct <= -10) {
    insights.push({
      id: "rev-down",
      type: "risk",
      title: "Revenue is down month-over-month",
      message: `This month is ${Math.abs(metrics.monthChangePct).toFixed(
        1
      )}% lower than last month.`,
      action: "Re-engage your top 5 customers with a targeted offer this week.",
      priority: "high",
      data: { monthChangePct: metrics.monthChangePct },
    });
  } else if (metrics.monthChangePct >= 15) {
    insights.push({
      id: "rev-up",
      type: "opportunity",
      title: "Revenue momentum is strong",
      message: `Revenue is up ${metrics.monthChangePct.toFixed(1)}% vs last month.`,
      action: "Increase outreach to similar customer segments to sustain growth.",
      priority: "medium",
    });
  }

  if (topCustomerShare >= 0.4) {
    insights.push({
      id: "customer-concentration",
      type: "risk",
      title: "Customer concentration risk detected",
      message: `Top customer represents ${(topCustomerShare * 100).toFixed(0)}% of revenue.`,
      action: "Prioritize pipeline for 3 mid-size accounts to diversify revenue.",
      priority: "medium",
    });
  }

  if (overdueTasks >= 3) {
    insights.push({
      id: "overdue-tasks",
      type: "efficiency",
      title: "Overdue tasks are building up",
      message: `${overdueTasks} tasks are past due. This can slow delivery.`,
      action: "Run a 15-minute team triage and close the top 3 blockers today.",
      priority: "high",
    });
  }

  if (metrics.completionRate < 60) {
    insights.push({
      id: "completion-rate",
      type: "efficiency",
      title: "Task completion rate is below target",
      message: `Only ${metrics.completionRate.toFixed(0)}% of tasks finished in the last 30 days.`,
      action: "Break large tasks into smaller milestones and assign clear owners.",
      priority: "medium",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "steady-state",
      type: "opportunity",
      title: "Operations are stable",
      message: "No major risks detected. You can focus on growth initiatives.",
      action: "Launch a new upsell campaign to increase average deal size.",
      priority: "low",
    });
  }

  return insights;
};
