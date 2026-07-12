# You Don't Own Your Database

*Draft 1 — Fable, 2026-07-10. Target: saagarpatel.dev essay. Public-safe: mechanisms only, no workspace contents. Voice: Light & Warm per profile. Companion to the planned interactive explainer "One Writer, No Lies."*

---

Every so often, Cloudflare blocks one of my page updates because of what the markdown says.

Not an expired token. Not a rate limit. A 403 with Cloudflare's "sorry, you have been blocked" page in the body, served from the edge in front of Notion's API, on a request whose only crime was the text it carried. Somewhere in my sync tool there is a function called `isNotionPolicyBlockedError` whose entire job is to recognize that page and route around it, and I'd like to explain why a personal project-tracking tool needs a firewall-evasion strategy for its own notes.

The short version: I built a system where my machine is the source of truth about my projects and Notion is just where I look at it. The long version is a tour of everything that goes wrong when the database you're writing to belongs to someone else.

## The premise

My project state lives on my machine. Build sessions, commits, audit results, "this thing shipped": local files and a small SQLite database, written by the tools doing the work, at the moment they do it. That layer is the truth, and nothing else gets to be one.

Notion is where I read it. It holds a portfolio database, a build log, weekly review pages, dashboards. It's good at that job. It is where decisions actually happen, because a decision needs a surface you'll actually look at over coffee, and a terminal full of JSON is not that surface.

The reason it's Notion is not technical. It was free, looked nice, and was as easy to start using as Excel. I can open it on my phone, in any browser, or in the desktop app, and I can point an AI agent at the same pleasant interface without first building, hosting, and maintaining another product. There were no trials, no hoops, no adoption project. It's simply a solid tool that is easy and fun to use.

So the architecture is one sentence: truth flows one way, from my machine into Notion, through a CLI that treats Notion as a materialized view it rents rather than a database it owns. The CLI is called Notion OS. The renting part is what this essay is about, because a landlord can change the locks, repaint the walls, and occasionally call security on your markdown, and none of that is allowed to make the build log wrong.

There's decent prior art for pieces of this. Tools that sync local files into Notion pages exist. Reverse-ETL products will happily pump warehouse rows into Notion databases. What I haven't seen elsewhere is the posture: Notion as a *projection* of local truth, with the projection machinery built like it expects to be lied to. Which it should. It is.

## One writer per field

Start with the problem everyone assumes you'll have: conflicts. Two processes write the same field, last writer wins, somebody's data quietly loses. The distributed-systems literature has a glamorous answer for this, the CRDT, a data structure with a merge function so cleverly designed that concurrent edits always converge. There's a lovely interactive essay by Jake Lazaroff where you watch two divergent replicas [merge themselves back together](https://jakelazaroff.com/words/an-interactive-intro-to-crdts/). The local-first movement, whose [founding essay](https://www.inkandswitch.com/essay/local-first/) is genuinely worth your time, built a whole world on that trick.

I didn't need the trick. A merge algebra is what you reach for when you can't decide who owns a field. I could decide. It's my machine.

So Notion OS runs on a constitution instead: every derived field in the portfolio database has exactly one command that is allowed to write it. The control-tower sync owns Operating Queue, Next Review Date, Evidence Freshness. The signal sync owns the deployment and PR fields. The recommendation engine owns its lane and score. And the fields I edit by hand in Notion are constitutionally separate from all of them: no command touches a manual field, ever. Concurrency control by org chart. Conflicts aren't resolved. They're structurally impossible, which is the cheapest kind of resolved.

This sounds obvious written down. It wasn't obvious for the shared pages. A weekly review page has sections written by four different commands: signals, morning brief, recommendations, trend analysis. They can't each own a whole page, so they own *regions* of one, fenced by HTML comment markers. Each writer extracts everyone else's fenced sections from the current page before re-rendering its own, splices them back, and patches only what it owns. A tiny merge protocol over a document, with ownership instead of cleverness doing the hard part.

## "Did anything change?" turns out to be a hard question

An idempotent sync needs to answer one question constantly: does the remote already match what I'm about to write? If yes, don't write. Skip the API call, skip the churn, leave the page's edit history clean.

With a database you own, that's a string comparison. With Notion, it's philosophy.

Notion doesn't store markdown. It stores a tree of JSON blocks, and this was a [deliberate design decision](https://www.notion.com/blog/creating-the-notion-api), reasonably argued: markdown dialects disagree with each other, plenty of Notion blocks have no markdown equivalent, and you can paginate a block tree in ways you can't paginate a text file. The cost lands on people like me: markdown goes in, gets converted to blocks, comes back out *almost* the same. Links get re-escaped. URLs get canonicalized. Whitespace shifts. Byte-for-byte equality is gone the moment your text touches their storage.

So Notion OS carries its own definition of "same": a normalizer that strips the escaping Notion adds, canonicalizes the URLs Notion rewrites, collapses the whitespace Notion reflows, and compares the results, with and without the leading title, since that boundary is also unstable. Every no-op check, every convergence test, every "would this change anything" answer in the system runs through that homemade equivalence relation.

I want to be honest about what this is: a pile of regexes encoding the current behavior of someone else's serializer. It works. It's also the single most fragile thing in the system, because if Notion changes how they round-trip a link, my definition of "unchanged" silently drifts, and the failure mode is the polite one where the tool rewrites pages that didn't need rewriting, forever, without anyone noticing. Renting the view means renting its quirks, and equality is a quirk.

## The ladder

Now the fun part: actually writing.

A managed-section update in Notion OS doesn't attempt one write. It descends a ladder, five rungs, each blunter than the last:

1. **Do nothing.** The normalized comparison says remote already matches. Most runs end here, which is the point.
2. **Surgical swap.** Replace exactly the old fenced section with the new one, a targeted search-and-replace inside the page. Smallest possible footprint.
3. **Full replace.** Rewrite the whole page body, but only after a guard confirms the new content doesn't drop any child pages or embedded databases. A re-render is never allowed to orphan children.
4. **Anchored insert.** Slip the section in after the page's one unique heading, or after a tail chunk of text that provably occurs exactly once. The blunt instruments, uniqueness-checked so blunt doesn't become wrong.
5. **Read-back.** The write threw a transport error. Read the page again and compare. If the remote now matches what we meant to write, declare victory and stop.

Rung five is my favorite, because it encodes a distinction most production systems fumble: a lost acknowledgment is not a lost write. The request died on the way back, not on the way in. The Two Generals problem says you can never be sure a message arrived; you can, however, just go look. In the literature this is read-repair, fixing consistency at read time. In the code it's a return value called `read_back_converged`, which I'd translate as "it landed, calm down."

And rungs three and four exist substantially because of the firewall. When Cloudflare decides a patch payload looks suspicious, the surgical path is dead no matter how correct it is, so the ladder falls through to shapes of request the edge will tolerate. Graceful degradation, where one of the failure modes being degraded around is *your own database's security theater misreading your prose.* I checked whether other people had this problem. Mostly what I found were tool authors [discovering](https://altf4.blog/blog/2024-02-25-building-a-notion-to-markdown-tool-is-annoying-actually/) adjacent horrors in the block model. The WAF appears to be a boutique betrayal.

## Receipts, and the lane that could lie

The build log is the part of this system I actually care about. When a work session ships something, a row lands in a local SQLite database. A sync command later drains those rows into Notion's build log, one page per shipped thing. That local table has a name in the distributed-systems canon: it's a [transactional outbox](https://dzone.com/articles/outbox-pattern-reliable-messaging-distributed-systems). The event is recorded next to the work, durably, and delivery to the pretty view happens later, with retries.

Delivery with retries means at-least-once, and at-least-once means duplicates unless something makes redelivery safe. The standard something is an idempotency key. Gunnar Morling has the cleanest recent [writeup](https://www.morling.dev/blog/on-idempotency-keys/), with the line I'd frame: idempotency gives you *deterministic convergence under retries*, not exactly-once. You don't prevent the duplicate delivery. You make the duplicate delivery converge to the same result.

The sync also does something I've come to think of as the signature move of the whole system: after creating the Notion page, it writes the page's ID *back into the local database*, next to the row it drained. The queue holds a receipt proving it was drained, pointing at the exact downstream artifact. Provenance in both directions. When an event can't be routed to a project at all, it's never dropped and never marked done; it stays in the queue, retries every run, and pings me through a notification channel until I deal with it. Visible purgatory. The system prefers nagging to lying.

Here's the confession. While writing this essay I went looking for the gap between that philosophy and the implementation, and found it in about an hour. The write sequence was: create the Notion page, then write the receipt. If the receipt write failed, the crash left the row unconfirmed, and the next run would happily create a second page for the same shipped thing. At-least-once delivery, no idempotency key, in the one lane whose entire purpose is being an honest record. The punchline is that a different lane in the same codebase, the one that executes governed GitHub actions, had proper idempotency keys the whole time. Same repository. Same problem. Two answers.

The fix is exactly the boring thing the literature prescribes: a deterministic key derived from the source row, stamped onto the Notion page, checked before any create. [Here is the implementation receipt.](https://github.com/saagpatel/notion-operating-system/commit/5f358a2) Redelivery now finds the existing page, writes the missing receipt, and converges. I'm not embarrassed by the bug so much as instructed by it. The pattern was already in the building. It just hadn't been made a policy.

## Trust nothing, including yourself

By now the shape of the thing should be visible: this is a system that refuses to take anyone's word for anything, including its own.

It doesn't trust the schema: every sync asserts the shape of the remote database before writing a byte, because Notion schemas drift when a human (me) fiddles with a property, and Notion itself ships [breaking API changes](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03) that reorganize what a "database" even is. It doesn't trust names: build-log routing prefers stable registry IDs over matching project titles, because titles get renamed and the fuzzy matcher is a fallback, not a foundation. It doesn't trust its own writes, which is what the ladder was. And it doesn't trust me, which is where it gets interesting.

Every command in the system defaults to dry-run. That began as ordinary caution and turned into the feature I use most, because of a naming decision buried in the shared status contract: when a dry run detects it *would* change something, the status it reports isn't "pending" or "ready." It's `drift`. Run the whole suite dry and you get a map of every place local truth and the rented view currently disagree, without writing anything. The literature calls the periodic version of this anti-entropy. I call it running the truth with the safety on.

The weekly orchestrator institutionalizes the paranoia. A full live refresh always runs a complete dry pass first, and the live pass executes only if the preflight came back clean *and* found actual work to do. A broken preflight can't escalate to writes. And the lane that touches the outside world (filing GitHub issues, poking deployments) runs a gate I'd cheerfully recommend to teams: an action needs a human approval recorded in Notion *and* a fresh, recent, successful dry run, and every live execution consumes that readiness, resetting it. One approval never authorizes two executions. Approval here isn't a state you're in. It's a token you spend.

## The bill

Time to say the quiet part. This is roughly sixty-four thousand lines of TypeScript and about forty-nine CLI commands, pointed at one person's project dashboard. There are Fortune 500 internal tools with less machinery. If you're feeling generous, it's a production-grade reconciler that happens to have one user. If you're not, it's the most elaborate way anyone has ever avoided updating a status column by hand.

Both readings are correct, and I'd defend the trade anyway, because the alternative isn't "the same dashboard with less code." The alternative is a dashboard that drifts from reality at the speed of my willingness to do data entry, which is to say instantly. A build log you update by hand is a diary. A build log your tools update, with receipts, is a record. I wanted a record.

But you shouldn't build this, mostly. If your project tracker being wrong costs you a shrug, let it be wrong. The machinery only pays for itself when the view feeds real decisions, when wrong data quietly becomes wrong choices. What transfers, even if you never write a line of it:

Keep truth where the work happens, and treat every pretty surface as a rented projection of it. Give every field exactly one writer, because the cheapest conflict resolution is jurisdiction. Define equality yourself, because your storage provider's serializer will not preserve your bytes and "did anything change" is too important to outsource. Keep receipts in both directions, so the queue can prove it was drained. Make duplicates converge instead of pretending they won't happen. And run everything dry first, because a diff between what is and what should be is the report you will actually act on.

Notion gets to keep the furniture. The locks, the walls, the firewall with opinions about my markdown: all theirs, and honestly the rent is fair for what I get back. The record is mine.

Rent the view. Own the truth.

---

*Companion explainer: ["One Writer, No Lies"](https://saagarpatel.dev/authority) lets you drop acks, duplicate deliveries, and kill a sync mid-write, and watch the receipts converge anyway.*
