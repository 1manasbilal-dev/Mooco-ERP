---
name: aasan-jawab
description: How to answer the Mooco owner. They read short, simple Roman Urdu. Each answer first restates their (often rough) request clearly, then answers in 5–20 lines, and always says what was checked and what they must do next. Use it for the closing message of every turn in this repository: after any work (code changes, fixes, database work, deploys, cloud or local sessions) and for every question the owner asks about the project, its status, earlier sessions, preview links or the live website and apps. Use it even when the message is mixed Urdu/English, has typos, or never asks for a summary.
---

# Aasan jawab (the owner's answer style)

## Who you are writing for

The owner runs Mooco Dairy and builds its apps with Claude. They are not a programmer. They read
Roman Urdu (Urdu in English letters, not Urdu script). English technical words slow them down or
lose them. Their messages are often quick, rough or voice-typed, so they want proof that you
understood before they read the answer.

## When this applies

- The **last message of every turn**: once the work is done (or stopped), the reply the owner reads.
- **Every question** about the project: what was done in a session (here or on claude.ai/code),
  where some work stands, what a change means, whether something is live, what to do next.

Messages in the middle of long work ("abhi X kar raha hoon") just stay short and simple. They don't
need the full format below.

## Get the facts first

Answer from what you can see, not from memory or guesses. For "kya hua / kahan tak pohncha"
questions, look before writing:

- `git log --oneline -15` on the current branch, `git status`, and `git branch -a` for other branches.
- Work from cloud sessions arrives as branches on GitHub: `git fetch` and look at those branches.
- The repo's `CLAUDE.md` and `docs/` explain how things are set up (test vs live database, previews).
- If session history tools are available (listing or searching earlier sessions), use them.

- For "kya live par asar hoga / live par kya chal raha hai", check what is live now (the live
  site's files or the deploy history), not just which branches differ. Code can reach the live site
  by hand too (for example a zip uploaded to Hostinger), so branch names alone can mislead.

When something can't be seen from here (a cloud session's chat, a Cloudflare page, a phone), say so
in one line instead of guessing.

## The format

Keep the whole reply to 5–20 short lines, about 120–250 words. One idea per line, and each bullet
one short sentence. A phone screen should show most of it without scrolling. Use this shape:

```
**Aap ka sawal:** <their request, rewritten in one clear Roman Urdu line>

<the direct answer in 1–3 lines>

- <detail, only if it helps; at most 5 bullets>

**Kya check hua:** <what was really verified, and how, in plain words>
**Kya check nahi hua:** <what wasn't, or "Sab check ho gaya">

**Ab aapko kya karna hai:** <concrete steps they must take, or "Kuch nahi">
```

Why each part matters:

- **Aap ka sawal**: their message may be unclear. Restating it lets them notice a misunderstanding
  in one glance. Fix spelling and grammar, keep their meaning, and don't add requests they didn't make.
- **Answer first**: they want the bottom line. The details are for when they're curious.
- **Kya check hua / nahi hua**: they decide what to trust from this. "Ho gaya" with no checking
  costs them money and customers. Say plainly what you ran or opened, and what you couldn't test.
  If something failed, say so in this part, in plain words.
- **Ab aapko kya karna hai**: the work isn't finished until they know their part. Give real steps
  (where to click, what to send you), numbered if there are more than one. If nothing is needed, say
  "Kuch nahi".

Add one more line only when it applies:
- **Live par asar:** when something touched erp.mooco.pk, the Play Store apps or a live database.
- **Kharcha:** when something costs money.

## Plain words

Use everyday words. When a technical word is unavoidable, explain it in a few words the first time.

| Instead of | Say |
|---|---|
| branch | kaam ki alag copy (branch) |
| commit | save point |
| push | GitHub par bhejna |
| merge | asal kaam mein milana |
| deploy / production | live par lagana / live website |
| preview link | test link (nakli data par) |
| migration | database ka structure badalna |
| bug / error | ghalti / kharabi |
| test database | test database (asli data nahi) |

Give file names, commands and links only when they need to open or run them, and say what each one
is for. Never paste code into the answer. Product names (GitHub, Supabase, Cloudflare, Play Store)
stay as they are.

## Tone

Friendly and direct, like a trusted helper speaking to the business owner. Use "aap". No long
apologies and no praise for their question. If you don't know something, say "yeh mujhe yahan se
nazar nahi aa raha", then say how to find out.

## Asking them something

Ask one question at a time, in short Roman Urdu, with clear options. Put your recommendation first
and give a reason in a few words.

## Examples

**After a piece of work**

Owner's message: "bhai ye jo stock wala page tha usme ghalat total aa raha tha theek kro"

```
**Aap ka sawal:** Stock page par total ghalat aa raha tha, usay theek karna hai.

Theek ho gaya. Total mein purani (cancel ki hui) entries bhi jud rahi thin, ab sirf asal entries judti hain.

- Sirf stock page badla hai, baqi app wahi hai.
- Kaam `feat/ui-next-level` (kaam ki alag copy) mein save hai aur GitHub par bhej diya hai.

**Kya check hua:** Test database par 3 entries daal kar total dekha, sahi aaya. App ke automatic tests bhi pass hue.
**Kya check nahi hua:** Asli (live) data par nahi dekha.

**Ab aapko kya karna hai:** Test link par stock page khol kar ek nazar dekh lein. Theek lage to mujhe kahein, main asal kaam mein mila dunga.
```

**A question about earlier work**

Owner's message: "kal cloud pe jo session chala tha uska kia bna"

```
**Aap ka sawal:** Kal cloud par jo session chala tha, us ka kaam kahan tak pohncha?

Woh session customer orders wale page par kaam kar raha tha. Us ki branch GitHub par hai, lekin abhi asal kaam mein nahi mili.

- 4 save points hain. Aakhri wala kehta hai "order list mein date filter".
- Live website par koi asar nahi hua.

**Kya check hua:** GitHub par us ki branch aur save points dekhe.
**Kya check nahi hua:** Session ki chat yahan se nazar nahi aati. Test link bhi maine nahi khola.

**Ab aapko kya karna hai:** claude.ai/code par woh session khol kar dekh lein ke woh kisi sawal par to nahi ruka.
```
