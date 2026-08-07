/**
 * Core ecom tools — callable from script player or a future live agent.
 * onMockImEvent hook reserved for a real OpenClaw bridge.
 */

import { getLocale } from "../i18n.js?v=20260807-topbar-fix";

export function createEcomTools(ctx) {
  const {
    seed,
    getSupplier,
    playCall,
    focusThread,
    pushIm,
    publishDeliverable,
    updatePricing,
    onMockImEvent,
  } = ctx;

  async function call_supplier(args = {}) {
    const sid = args.supplier_id || args.supplierId;
    const sup = getSupplier?.(sid) || seed?.suppliers?.find((s) => s.id === sid);
    const name = sup
      ? pick(sup, "name")
      : sid || "Supplier";
    const topic = pick(args, "topic") || "";
    const note = pick(args, "note") || "";
    const thread = sup?.thread || sid;
    if (thread) focusThread?.(thread);
    await playCall?.({
      name,
      topic,
      note,
      thread,
      agreedPrice: args.agreed_price ?? args.agreedPrice,
      durationMs: 5600,
    });
    if (thread) {
      pushIm?.({
        thread,
        from: "agent",
        kind: "text",
        text_zh: `通话纪要：${topic}${note ? " — " + note : ""}`,
        text_en: `Call notes: ${topic}${note ? " — " + note : ""}`,
      });
    }
    onMockImEvent?.({ type: "tool", name: "call_supplier", args });
    return { ok: true, supplier_id: sid, agreed_price: args.agreed_price };
  }

  async function update_inventory_pricing(args = {}) {
    const unitCost = Number(args.unit_cost ?? args.unitCost);
    const unitPrice = Number(args.unit_price ?? args.unitPrice);
    const stock = Number(args.stock ?? 0);
    const sold = Number(args.sold ?? 0);
    const revenue = +(unitPrice * sold).toFixed(1);
    const cogs = +(unitCost * sold).toFixed(1);
    const profit = +(revenue - cogs).toFixed(1);
    const kpi = { unitCost, unitPrice, stock, sold, revenue, cogs, profit, currency: "CNY" };
    await updatePricing?.(kpi);
    onMockImEvent?.({ type: "tool", name: "update_inventory_pricing", args, kpi });
    return { ok: true, kpi };
  }

  async function publish_deliverable(args = {}) {
    const item = {
      id: args.id || `d_${Date.now()}`,
      kind: args.kind || "file",
      title_zh: args.title_zh || args.title || "Deliverable",
      title_en: args.title_en || args.title || "Deliverable",
      body_zh: args.body_zh || args.body || "",
      body_en: args.body_en || args.body || "",
      highlight: Boolean(args.highlight),
      media: args.media || null,
      cover: args.cover || null,
    };
    await publishDeliverable?.(item, { announce: true });
    onMockImEvent?.({ type: "tool", name: "publish_deliverable", args: item });
    return { ok: true, id: item.id };
  }

  return {
    call_supplier,
    update_inventory_pricing,
    publish_deliverable,
    /** Tool defs for a future live agent bind. */
    definitions: [
      {
        type: "function",
        function: {
          name: "call_supplier",
          description: "Call a coffee/bean supplier, capture quote notes into IM.",
          parameters: {
            type: "object",
            properties: {
              supplier_id: { type: "string" },
              topic_zh: { type: "string" },
              topic_en: { type: "string" },
              agreed_price: { type: "number" },
              note_zh: { type: "string" },
              note_en: { type: "string" },
            },
            required: ["supplier_id"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "update_inventory_pricing",
          description: "Update unit cost/price, stock, sold and refresh P&L.",
          parameters: {
            type: "object",
            properties: {
              unit_cost: { type: "number" },
              unit_price: { type: "number" },
              stock: { type: "number" },
              sold: { type: "number" },
            },
            required: ["unit_cost", "unit_price", "stock"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "publish_deliverable",
          description: "Publish a deliverable to the wall and announce in IM.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              title_zh: { type: "string" },
              title_en: { type: "string" },
              body_zh: { type: "string" },
              body_en: { type: "string" },
            },
            required: ["title_zh"],
          },
        },
      },
    ],
  };
}

function pick(obj, key) {
  if (!obj) return "";
  const zh = obj[`${key}_zh`] ?? obj[key];
  const en = obj[`${key}_en`] ?? obj[key];
  return String(getLocale() === "en" ? en || zh || "" : zh || en || "");
}
