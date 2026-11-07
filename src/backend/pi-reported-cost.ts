/*
 * Pi extension source that puts the cost an OpenAI-compatible endpoint reports on the assistant
 * message, for a model that Pi cannot price. Pi's session cost (`get_session_stats`) is the sum of
 * each message's `usage.cost.total`, so the session cost then is the endpoint's own.
 *
 * Pi gives each parsed stream chunk to `provider_stream_event` before it normalizes it, and the
 * usage chunk of a streamed completion keeps the endpoint's own fields. Two shapes carry a cost:
 * - a number in `usage.cost`: OpenRouter, and Bifrost on its OpenAI-compatible routes (`/openai/v1`);
 * - an object with `total_cost` in `usage.cost`: Bifrost on its own routes (`/v1`), in its nested
 *   shape (`input_cost`, `output_cost`, `total_cost`) and in its older flat shape
 *   (`input_tokens_cost`, `output_tokens_cost`, `request_cost`, `total_cost`).
 * Bifrost sends no cost header. A message that Pi already priced keeps its own cost.
 *
 * The source is a statement list for the body of an extension's `export default function (pi)`.
 */
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
