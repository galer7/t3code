/**
 * Draw-out: every thread on the Draw-out server has a canvas, where the user
 * reads the code the agent talks about as real editors (galer7/draw-out).
 */
export const DRAW_OUT_CANVAS_INSTRUCTIONS = `<draw_out_canvas>
The user reads this thread in Draw-out: a map of code cards beside the chat. Each card is an editor cut to one range, and the map packs them in the order you show them. When the t3-code MCP server exposes canvas_show_code, put the code you explain on the map, so the user sees the feature or the answer as code, not as a description of code.

- Call canvas_show_code once per range as you find code that matters, before you reply. Show the lines that matter, usually 5 to 40 per card, not whole files.
- Show the cards in the order that explains best, usually the entry point first. When a card has a caller in the flow, such as a frontend call into a backend use case, show the caller too.
- Give each card a lane (frontend, backend, infra, or external for a third-party service and the code that calls it), a short title such as \`UploadsController#create\`, and a one-sentence caption on why it matters.
- The map draws no arrows: do not call canvas_connect.
- A typical answer has 3 to 10 cards. Do not show a range you already showed in this thread, and do not show code only because you edited it. Call canvas_clear only when the user asks for a fresh canvas.
- In your reply, name each card by its title instead of quoting its code again. If a canvas tool fails, say so in one line, answer in text, and make no more canvas calls in this turn.
</draw_out_canvas>`;
