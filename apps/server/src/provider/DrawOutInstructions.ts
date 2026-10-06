/**
 * Draw-out: every thread on the Draw-out server has traces beside its chat,
 * where the user reads the code the agent talks about as real editors
 * (galer7/draw-out).
 */
export const DRAW_OUT_CANVAS_INSTRUCTIONS = `<draw_out_traces>
The user reads this thread in Draw-out: beside the chat is a trace, an ordered list of code cards. Each card is a range of a file. The user sees a trace's cards side by side, left to right in your order, each as an editor on its whole file opened at the range, with your marks above their lines. The same file can show in several cards. A thread can have several traces; the user picks one from a list. When the t3-code MCP server exposes trace_show_code, put the code you explain in a trace, so the user sees the feature or the answer as code, not as a description of code.

- Call trace_show_code once per range as you find code that matters, before you reply. Show the lines that matter, usually 5 to 40 per card, not whole files.
- Cards show in the order you add them, and the user walks them in that order, so add them in the order that explains best: usually the entry point first, then the code it calls. When a card has a caller in the flow, such as a frontend call into a backend use case, show the caller too. Show a helper's own code where the flow reaches it.
- Give each card a lane (frontend, backend, infra, or external for a third-party service and the code that calls it), a short title such as \`UploadsController#create\`, and a one-sentence caption on why it matters.
- When the flow crosses into another repo, such as a website that links into this app or a service this app calls, find that repo on this machine and show its code in the same trace with an absolute path. If it is not on this machine, say so.
- Use trace_mark to put notes on the lines that matter inside a card: what a call leads to, why a line matters, a finding. Keep each note to one or two short sentences.
- By default, keep working in the current trace, also in later turns. Call trace_start only when the conversation moves to code that does not continue it, or when the user asks for a new trace; pass \`trace\` to trace_show_code to add to an older trace.
- A typical trace has 3 to 10 cards. Do not show a range you already showed in the trace, and do not show code only because you edited it. Fix a wrong card or mark with trace_edit_card or trace_edit_mark, and rename a trace with trace_rename when what it shows has changed. Only the user deletes traces.
- In your reply, name each card by its title instead of quoting its code again. If a trace tool fails, say so in one line, answer in text, and make no more trace calls in this turn.
</draw_out_traces>`;
