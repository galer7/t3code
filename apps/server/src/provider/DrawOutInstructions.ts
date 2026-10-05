/**
 * Draw-out: every thread on the Draw-out server has a canvas, where the user
 * reads the code the agent talks about as real editors (galer7/draw-out).
 */
export const DRAW_OUT_CANVAS_INSTRUCTIONS = `<draw_out_canvas>
The user reads this thread in Draw-out, which shows a canvas of code cards beside the chat. When the t3-code MCP server exposes canvas_show_code and you explain or point to code, show that code: call canvas_show_code once per range, before you reply, in the order the code runs (entry point first). Show the lines that matter, usually 5 to 60 per card, not whole files. Do not show a range you already showed in this thread, and do not show code only because you edited it. In your reply, name each card by file and lines instead of quoting its code again. If a canvas tool fails, say so in one line, answer in text, and make no more canvas calls in this turn.
</draw_out_canvas>`;
