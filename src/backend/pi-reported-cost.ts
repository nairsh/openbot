export const PI_REPORTED_COST_SOURCE = `
  const reportedCostOf = (usage) => {
    const cost = usage?.cost;
    const total = typeof cost === "number" ? cost : cost?.total_cost;
    return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : 0;
  };
  let reportedCost = 0;
  pi.on("provider_stream_event", (event) => {
    const cost = reportedCostOf(event.data?.usage);
    if (cost > 0) reportedCost = cost;
  });
  pi.on("message_end", (event) => {
    const cost = reportedCost;
    reportedCost = 0;
    const message = event.message;
    if (message.role !== "assistant" || cost <= 0 || !message.usage?.cost || message.usage.cost.total > 0) return;
    return { message: { ...message, usage: { ...message.usage, cost: { ...message.usage.cost, total: cost } } } };
  });
`;
