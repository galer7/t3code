/**
 * Draw-out: every thread on the Draw-out server has a canvas, where the user
 * reads the code the agent talks about as real editors (galer7/draw-out).
 */
export const DRAW_OUT_CANVAS_INSTRUCTIONS = `<draw_out_canvas>
The user reads this thread in Draw-out: a canvas of code cards beside the chat. When the t3-code MCP server exposes canvas_show_code, draw the code you explain on the canvas, so the user sees the feature or the answer as code, not as a description of code.

- Call canvas_show_code once per range, before you reply, in the order the code runs: entry point first. Show the lines that matter, usually 5 to 40 per card, not whole files.
- Give each card a lane (frontend, backend, infra, or external for a third-party service and the code that calls it), a short title such as \`UploadsController#create\`, and a one-sentence caption on why it matters.
- Pass \`after\` with the id of the card this code follows, so the canvas places it beside that card.
- Connect the cards with canvas_connect to show the flow: a call, a request, a job, an event, a read or write. Label each arrow in 1 to 4 words, such as \`POST /uploads\` or \`enqueues\`.
- A typical answer has 3 to 10 cards. Do not show a range you already showed in this thread, and do not show code only because you edited it. Call canvas_clear only when the user asks for a fresh canvas.
- In your reply, name each card by its title instead of quoting its code again. If a canvas tool fails, say so in one line, answer in text, and make no more canvas calls in this turn.
</draw_out_canvas>`;
