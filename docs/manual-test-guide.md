# Institute Features — Manual Test Guide

A hands-on checklist to validate every feature added for the institute deployment. (Automated tests already cover the logic — 230 mocha passing; this guide is for clicking through the real UI yourself.)

## Setup

- **App:** http://localhost:3300  (start it with `CMD_PORT=3300 CMD_DOMAIN=localhost CMD_URL_ADDPORT=true NODE_ENV=development CMD_SESSION_SECRET=localdevsecret NODE_OPTIONS=--openssl-legacy-provider node app.js`)
- **Accounts** (already created on the dev DB):
  - Owner — `owner@example.com` / `ownerpass123`
  - Admin — `admin@example.com` / `adminpass123`
  - User — `user@example.com` / `user123`
- **Tip:** use two browsers (or one normal + one private window) so you can be the owner in one and a user in the other for the cross-user scenarios.
- **Sign in:** click **Sign In** → the modal shows only **Sign in via E-Mail** (no Register button — that's the locked-instance behaviour). Enter the email + password.

Each scenario: **Do** the steps, check the **Expect**. Tick the box when it passes.

---

## 1. Closed instance, roles & invites (Slice 1)

### 1.1 No public registration
- [ ] **Do:** Sign out. On the landing page click **Sign In**.
- [ ] **Expect:** the modal has an **E-Mail** form with a **Sign In** button and **no Register button**. There's no way to self-register.

### 1.2 Admin panel reaches admin + owner, not plain users
- [ ] **Do:** Sign in as the **owner**, then open http://localhost:3300/admin .
- [ ] **Expect:** an **Admin** panel with a **Create invite** form, an **Active invites** table, and a **Members** table (listing owner + admin + user, with roles).
- [ ] **Do:** Sign in as the **admin**, open `/admin`.
- [ ] **Expect:** the admin **also** reaches the panel (admin and owner both pass `requireAdmin`).
- [ ] **Do:** As the **user**, open `/admin`.
- [ ] **Expect:** access is refused (you're redirected / forbidden) — only admins and owners reach it.

### 1.3 Create an invite & redeem it (onboarding)
- [ ] **Do:** As owner (or admin) in `/admin`, under **Create invite** set max uses `1`, expires `7` days, click **Create invite**. There is **no role picker** — every invite onboards a plain **user**. Copy the generated `/invite/<token>` link.
- [ ] **Do:** Open that link in a **private window** (logged out). Set an email (e.g. `newuser@example.com`) + a password, submit.
- [ ] **Expect:** "You've registered — please sign in." You can now sign in with that new account, which has role **user**. Back in `/admin`, the invite shows `1 / 1` used, and the new member appears in **Members** as a `user`.
- [ ] **Do:** Reuse the same single-use link again.
- [ ] **Expect:** it's rejected as invalid/expired (used up).

### 1.4 Role changes are owner-only
- [ ] **Do:** As the **owner** in `/admin`, change a **user** to **admin**, then back to **user** (and try **owner**), using the per-member role control.
- [ ] **Expect:** the role control is **visible** for the owner and the role label changes each time.
- [ ] **Do:** Sign in as the **admin** and open `/admin`.
- [ ] **Expect:** the admin can create invites and activate/deactivate members, but the per-member **role control is absent** — an admin **cannot** change roles. (The role endpoint is owner-only; a direct POST as admin returns 403.)
- [ ] **Do:** As owner, try to **Deactivate** or **demote** the *only* remaining owner (yourself, if no other active owner).
- [ ] **Expect:** it's refused ("cannot remove last owner") — you can't lock everyone out of owner powers.

### 1.5 Deactivation is immediate
- [ ] **Do:** As owner (or admin), **Deactivate** the user account. Then in that user's browser, reload any page / try an action.
- [ ] **Expect:** the user is logged out / blocked on the next request (deactivation kills the live session, not just future logins). Trying to sign in as that user is refused.
- [ ] **Do:** **Activate** them again → they can sign in.

---

## 2. Personal notes dashboard (Slice 2a)

Sign in as the **user** (or owner) for this section.

### 2.1 Dashboard is the home
- [ ] **Do:** After signing in, look at the home page (`/`).
- [ ] **Expect:** a **My Notes** dashboard (folders sidebar + notes list), not the old marketing landing. A brand-new account shows an empty state ("No notes yet" + New note).

### 2.2 Create & list notes
- [ ] **Do:** Click **+ New note**, type a title (`# My First Note`) and some text, then go back to `/`.
- [ ] **Expect:** the note appears in **All notes** with its title (not blank).

### 2.3 Folders
- [ ] **Do:** In the sidebar, type a folder name (`Course`) in **New folder…** and click **+**. On a note row, pick `Course` from the folder dropdown.
- [ ] **Expect:** the folder appears with a count; filtering by it shows the note; **Unfiled** count drops. Delete the folder → its notes return to **Unfiled** (notes are *not* deleted).

### 2.4 Tags, pin, search, sort
- [ ] **Do:** On a note row, add a tag in **+ tag**; click the **pin**; use **Search keyword…**, and the **Title** / **Time** sort.
- [ ] **Expect:** the tag chip appears (removable with ×); pinned notes sort to the top; search filters live; sort reorders. All persist across reload.

---

## 3. Shared spaces & Browse (Slice 2b/2c)

You'll want **both** accounts here (owner shares, user discovers).

### 3.1 Create a space & share a note into it
- [ ] **Do:** As **owner**, on a note row in **My Notes**, use the **+ space** control to add the note to a new space (e.g. type `Lab Meetings`). 
- [ ] **Expect:** a **"Spaces: Lab Meetings"** chip appears on the row and a green **"shared"** badge.

### 3.2 Spaces are membership-gated
- [ ] **Do:** As the **user** (other browser), click the **Browse** toggle at the top of the dashboard.
- [ ] **Expect:** the **Spaces** sidebar does **not** list `Lab Meetings` — you only see spaces you're a member of, and only its creator (the **steward**) was auto-added.

### 3.3 Invite a member; they then see the space
- [ ] **Do:** As **owner** (the space's steward), in **Browse** open the space's **Members** modal (people / `fa-users` icon on the space row). Pick the **user** from the add-member `<select>` and click **Add**.
- [ ] **Expect:** the user appears in the member list. Now as the **user**, reload **Browse**: the **Spaces** sidebar lists `Lab Meetings` (with a count), and the owner's note shows the **owner's name** as note owner. Clicking the title opens the note.

### 3.4 Permissions are respected
- [ ] **Do:** As **owner**, open a note, set its permission to **private** (in the editor's permission control), and add it to a space the **user** is a member of.
- [ ] **Expect:** in the **user's** Browse, that private note does **not** appear (but the owner still sees their own).

### 3.5 Member management: invite / leave / remove / transfer
- [ ] **Do:** As the **user** (a plain member, not the steward), open the space's **Members** modal.
- [ ] **Expect:** you can **Leave** your own row, but there is **no remove ×** next to other members and **no "Make steward"** action — only the steward (or institute owner) can remove others / transfer.
- [ ] **Do:** As **owner** (steward), in the Members modal use the **remove ×** on a plain member's row.
- [ ] **Expect:** that member is removed and (on their next Browse reload) no longer sees the space. Your **own** steward row has **no remove/Leave** — the steward can't leave until transferring.
- [ ] **Do:** As **owner** (steward), click **Make steward** on the **user**'s row (invite them back first if needed), then try to **Leave**.
- [ ] **Expect:** stewardship transfers (the steward badge moves to the user); you're now a plain member and the **Leave** action appears — you can leave the space.

### 3.6 Space curation (steward/owner)
- [ ] **Do:** As the space's steward (or the institute **owner** role), in **Browse** use the rename (pencil) / delete (trash) on a space.
- [ ] **Expect:** rename updates everywhere; delete removes the space (the notes survive, just no longer in that space) and clears its memberships. As a non-steward, non-owner member (a plain **user** or an **admin**), those controls are absent — space rename/delete is steward-or-owner.

### 3.7 Institute owner oversees all spaces
- [ ] **Do:** As the institute **owner** (role, not the note-sharing persona), open **Browse**.
- [ ] **Expect:** **every** space is listed regardless of membership, and the Members modal lets you invite/remove/transfer on any of them.

---

## 4. Copy & templates — teaching workflow (Slice 3a)

### 4.1 Read-only handout
- [ ] **Do:** As **owner**, create a note `# Week 3 Handout` with instructions, and set its permission to **protected** (members can view, only you edit). Share its link (or put it in a space).
- [ ] **Do:** As the **user**, open the handout link.
- [ ] **Expect:** you can read it but the editor is read-only (you can't change the owner's note).

### 4.2 Make a copy — from the editor
- [ ] **Do:** As the **user**, while viewing the handout in the editor, open the **Menu** dropdown → **Make a copy**.
- [ ] **Expect:** a new note opens in a new tab, **owned by you** and **fully editable**, with the handout's content. The original is untouched.

### 4.3 Make a copy — from the dashboard / Browse row
- [ ] **Do:** On any note row in **My Notes** or **Browse**, click the **copy** icon.
- [ ] **Expect:** a new owned copy is created and opens. (Check `/` — your notes count went up by one.)

### 4.4 Make a copy — from the published view
- [ ] **Do:** Open a note's published view (`/s/<shortid>`, e.g. via the editor's **Publish**), click **Make a copy** in the top bar.
- [ ] **Expect:** an owned copy opens.

### 4.5 Templates
- [ ] **Do:** As **owner**, on a note row in **My Notes**, click the **star** (template toggle).
- [ ] **Expect:** a **"template"** badge appears on the row.
- [ ] **Do:** Click **★ New from template** (next to **+ New note**).
- [ ] **Expect:** a modal lists your template (title + owner). Choosing it creates and opens a fresh copy. Templates from other members that you can view also appear; another member's *private* template does not.

---

## 5. Inline comments (Slice 3b)

Open any note in the editor (use **Both** mode so you can see the editor + preview).

### 5.1 Add a line comment (editor)
- [ ] **Do:** In the editor, put the cursor on a line — a faint **+** appears in the comment gutter (just right of the line numbers) on *that line only*. Click it to open the **Comments** panel with an "Add a comment…" box; type and click **Post**. *(Alternatives: open **Menu → Comments → "+ Comment on current line"**; or click a line's 💬 marker once it has comments.)*
- [ ] **Expect:** the **+** follows the cursor (only one line at a time); after posting, a 💬 marker appears on that line (**red** = unresolved), and the comment shows with your name + time.

### 5.1b Add a comment by selecting text (view / Both mode)
- [ ] **Do:** In the rendered note (View or Both mode), **select some text**. A small **💬 Comment** button pops up by the selection — click it.
- [ ] **Expect:** the Comments panel opens for that text's source line, pre-filled with the selected text as a `>` quote; finish your comment and **Post**.

### 5.2 Persists + visible to other viewers
- [ ] **Do:** Reload the note. Then open it as **another member who can view it** (e.g. share it / a space, sign in as the user).
- [ ] **Expect:** the marker + comment are still there after reload, and the other member sees them too (comments are visible to anyone who can view the note). They can reply by adding their own comment to the line.

### 5.3 Resolve / delete + moderation
- [ ] **Do:** Click **Resolve** on a comment; then **Delete**.
- [ ] **Expect:** resolving greys it out (the gutter marker turns **orange** when nothing on the line is unresolved); deleting removes it (marker disappears when the line has none). **Resolve/Delete only show for the comment's author, the note's owner, or an institute owner** — a plain bystander viewing the note sees the comment but no moderation actions (and the server returns 403 if forced).

### 5.4 All-comments view + drift
- [ ] **Do:** Open **Menu → Comments** with no specific line → the panel lists **all** comments grouped by line (click **Line N** to jump there). Then edit the document — insert a few lines *above* a commented line.
- [ ] **Expect:** the comment re-anchors to follow its line (matched by the line's text). If you change the commented line's text entirely, it appears under an **Orphaned (anchor lost)** section rather than vanishing.

---

## Notes
- The instance is invite-only — new accounts come only from `/admin` invites (or the `bin/manage_users` CLI), never self-registration.
- "Handouts" are just CodiMD's existing **protected/locked** permission — the new part is the **Make a copy** button.
- Cloned copies are content-only and keep the source's title (disambiguate by the owner name shown in Browse / by being in your own My Notes).
- If something looks off, the server log is at `/tmp/codimd-server.log`.
