---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree **one question at a time**. The **frontier** is every decision whose prerequisites are already settled. Pick the single highest-leverage frontier question — the one that unblocks the most downstream decisions — and ask it. Give your recommended answer. Then wait.

Format each question like so:

```
❓ **Q<n>. <question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Number every question, even when you ask one at a time: `Q1`, `Q2`, and so on through the session. Never reuse a number. A follow-up on an open question takes a letter: `Q3a`. The user answers by id ("Q3: B") and refers back to earlier questions by id.

The user's answer reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier, pick the next highest-leverage question, and ask it.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
