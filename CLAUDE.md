# CLAUDE.md — Commodity Brokerage Platform

> **Purpose of this file:** This is the master context document for an end-to-end mobile brokerage platform for dry agri-commodities (rice, pulses, channa, dal, etc.). Give this file to Claude (chat or Claude Code) to load full project context instantly. It captures product requirements, domain rules, data model, architecture decisions, and open questions. Keep it updated as the single source of truth.

---

## 0. Current Status & Next Step

- **Requirements:** captured in this file; refined after ingesting two real supplier sheets (Rajat & Kunj Bihari, see §4.7). Their structural differences drove the **per-supplier learned-template** parsing strategy (§4.8) — the target approach, phased to Phase 2. Several decisions locked, some open (see §10).
- **Prototypes:** built in **Claude Design** — a **Seller app** (login, home, scan sheet, review, manual add w/ optional quantity field, bulk edit, listing detail, 2 AM expiry) and a **Buyer app** (login, home/today's market, browse-by-commodity with cheapest-seller-first, listing detail, contact/enquiry, past trades). Shared design system, mock data seeded from both real sheets (Rajat + Kunj Bihari sub-entities). Mobile portrait, no backend — for feedback.
- **Design ↔ spec reconciliation (as of latest review):**
  - *Confirmed by both designs:* quantity in bags is captured (buyer enquiry + trades; seller has an optional qty field) — still logged as open per founder, but leaning "yes".
  - *Decision locked:* buyer↔seller contact is **direct eBay-style negotiation**, NOT broker-mediated enquiry. The current buyer design's "enquiry goes through the broker" model must change to direct negotiation. Broker still earns commission via the trade-accept broker capture (§4.6) and admin still watches deals via live-negotiation visibility (§4.4).
  - *Design gap to close:* buyer app is currently browse-and-enquire only. **The "buyer posts a buy requirement that sellers can browse and act on" flow (§4.3, two-sided marketplace) is missing from the design** and needs to be added.
  - *Deferred in design (expected):* full negotiation UI and the broker/commission trade-accept screen (§4.6) are not built yet.
- **Next step:** in Claude Design, (a) add the buyer-posts-requirement flow + seller-browses-requirements lane, (b) replace broker-mediated enquiry with direct negotiation, (c) build the trade-accept + broker-capture screen, (d) build the **admin panel mock** (desktop-first, mobile-later — screen brief in §4.4.1), and (e) design the **Freight page** (§4.9) + its admin upload screen. Then reconcile and expand this file into the engineer-facing design doc.

---

## 0.1 Claude Design — Build Sequence (do these one at a time)

**How to use this:** Attach this whole file to the Claude Design session for context, then run **one step per session** in this order. For each step, paste the prompt below *and* the referenced section text. Don't try to do multiple steps in one prompt — the model spreads thin and screens come out shallow. Each step lists what "done" looks like so you know when to move on. Steps build on each other, so keep the order.

**Existing state:** a Buyer app and a Seller app already exist in the Design project (shared design system, mock data from the Rajat + Kunj Bihari sheets). These steps *modify and extend* them.

### Step 1 — Nav rework (foundational; everything hangs off it)
> **Prompt:** "In both the Buyer app and Seller app, rebuild the bottom navigation to the 4-tab structure in §4.0: **Browse · Trades · Post/Add · Freight**. Browse is the prominent default landing tab. Render the buyer variant or seller variant of each tab per the table in §4.0. Mode is fixed at login (not a live toggle); put profile + 'switch buyer/seller mode' behind a top-right avatar/menu, not a tab. Leave the tab screens as stubs for now if they don't exist yet — this step is just the nav shell."
> **Done when:** both apps show the same 4-tab bar, Browse lands by default, and the buyer/seller labels differ correctly (Post Requirement vs Add Listing).

### Step 2 — Buyer Post Requirement flow + seller-browses-requirements (the biggest gap)
> **Prompt:** "Build the two-sided marketplace from §4.3. (a) In the Buyer app, build the **Post Requirement** flow: buyer enters commodity/category, item, quality, target price, quantity (bags), optional notes → posts a buy requirement. Show the buyer's own posted requirements somewhere they can manage them. (b) In the Seller app, build the **Browse → buy requirements** view: sellers see buy requirements they can act on, with a way to open one and start contact. Use the same real seed commodities. Keep buy requirement and sell listing visually consistent — they're the same shape with opposite `side`."
> **Done when:** a buyer can post a requirement and see it; a seller can browse buy requirements and open one.

### Step 3 — Direct negotiation (eBay-style) + Trades tab
> **Prompt:** "Replace the current broker-mediated 'enquiry' with **direct buyer↔seller negotiation** per §4.3 and **§5 (read the detailed rules)**. Build the eBay 'Best Offer' thread: from a listing or a buy requirement, a party opens a negotiation and can **Offer / Counter / Accept / Decline / Retract (pending)**, with full visible offer history. Rules to reflect in the UI: **price only** (no qty/terms negotiated); **unlimited counters**; an offer is live until accepted/countered/declined or the 2 AM expiry (then shows **expired**); **first-accept-wins** — when one negotiation is accepted the listing closes and other open negotiations on it show a **'sold to another buyer' voided** state. Both-accept leads to the trade-accept screen (Step 4). Surface **active negotiations and pending trades** in the **Trades tab** (both modes) — **completed history goes in Profile (§4.10), not this tab.** Broker is NOT in the conversation (can watch/nudge separately, admin side)."
> **Done when:** two parties can go back-and-forth on price to an accept, and the negotiation shows up in the Trades tab.

### Step 4 — Trade-accept + broker capture
> **Prompt:** "Build the final **trade-accept screen** from §4.6. When both parties accept a price, capture the trade: quantity (bags), final price, and the **broker** — a dropdown of a finite broker list, plus a free-text field for a name not listed, plus a **'Self'** option. On confirm, show a confirmation state and add the trade to the Trades history. Note the commission model is still open — leave any commission amount as a 'FOR DISCUSSION' placeholder."
> **Done when:** accepting a negotiated price leads to a broker-capture screen and a confirmed trade in history.

### Step 5 — Admin panel (its own session; desktop-first)
> **Prompt:** "Build a **desktop-first admin panel** mock per the screen brief in §4.4.1. Use the same design system. Build the 8 areas: Dashboard, Users, Listings oversight, Negotiations (live + nudge), Trades & brokerage, Settings, Audit log, Freight management. Follow the [Mobile-essential]/[Desktop-primary] tags for responsive priority. Keep the 'FOR DISCUSSION' flags (commission model, quantity, tiered admins). Seed with the same real data."
> **Done when:** the 7+1 admin screens exist as a navigable desktop layout, with the mobile-essential ones sensibly collapsible.

### Step 6 — Freight page + admin upload
> **Prompt:** "Build the **Freight page** (§4.9) as the Freight tab in both apps: origin tabs (one per origin city; no state level), then a **destination → price** table, prices as ranges or single values, per quintal, with a truck-capacity note — read-only for buyers/sellers. Then in the admin panel, build the **Freight management** screen: upload freight Excel → review parsed routes → publish, plus manual add/edit of a route. Same 2 AM expiry as commodity prices."
> **Done when:** the Freight tab renders the state→destination→price reference view, and the admin can upload/review/publish freight routes.

### Step 7 — Profile
> **Prompt:** "Build the **Profile** screen per §4.10 in both apps. Include: account/identity (name, firm, verified phone, city, optional logo); the **buyer/seller mode switch** (mode is set here, per §4.0); read-only role badges; seller settings (default payment terms, firm logistics notes, default bag weight, contacts/salesmen list); **completed trade history** (this is its home — it was removed from the Trades tab); links out to My Listings/My Requirements; **notification toggles (push/WhatsApp/SMS)**; language slot; contact-broker/help, terms, logout. No self-service account deletion (admin-only). Profile owns identity+settings+history and links out to tabs for active views — don't duplicate the active lists here."
> **Done when:** profile shows identity + settings + mode switch + completed trade history, and the Trades tab no longer shows completed history.

**After Step 7:** bring the finished flows back to the main chat to reconcile against this file, resolve the remaining open questions (§10), and expand into the engineer-facing design doc.

---

---

## 1. Background & Problem

The founder's father is a **commodity broker** in India who has run a **rice and pulses brokerage** entirely offline his whole life — closing deals over the phone between buyers and sellers and earning brokerage (commission) on each trade.

He wants to move this online via a **mobile app** where his existing, already-interested buyers and sellers can:
- List what they want to sell (commodity, quality, price)
- List what they want to buy (commodity, quality, price)
- Meet, negotiate, and close trade deals
- Let the broker earn brokerage from completed trades

He already has a trusted network of buyers and sellers to bootstrap with. **This is a closed, invite-only system to start.**

**Who is building it:** A founder (product owner, writing this doc, will also code some modules in Claude Code) plus a team of BE and FE engineers.

---

## 2. Product Principles & Non-Negotiables

1. **Mobile-first, but architected for desktop later.** Build API-driven; keep business logic server-side so a web/desktop client can reuse the same backend. Do not bake logic into the mobile client.
2. **Multi-commodity from day one.** Rice today; channa, dal, pulses next; other commodities later. **Never hardcode "rice."** Commodity is a data-driven, extensible taxonomy.
3. **Closed / invite-only.** Only invited buyers and sellers can join. No open signup.
4. **Passwordless auth.** Mobile number + OTP. WhatsApp login is a strong option (very popular in India). **No passwords, ever.**
5. **Low-friction for non-technical users.** Users are traders, often not tech-savvy. UX must be dead simple, tolerant of messy input, and support bulk actions.
6. **Trust-based network.** Relationships already exist offline. The app digitizes and speeds up an existing trust network — it is not a cold marketplace.

---

## 3. Roles

| Role | Description |
|------|-------------|
| **Seller** | Lists commodities they want to sell (with quality & price). Can negotiate, bulk-edit prices, set payment terms. |
| **Buyer** | Posts buying requirements (commodity, quality, target price). Can negotiate. |
| **Broker** | Earns brokerage on a completed trade. The father is the first/primary broker. **Multiple brokers can exist.** A trade records which broker facilitated it (or "self" if none). |
| **Admin** | Platform operator (initially also the father). Invites users, views all listings & completed trades, edits listings/prices on behalf of users who call in, controls global settings (e.g., price expiry time). |

> **Design note:** *Broker* and *Admin* are **separate roles/concepts** even though the father holds both initially. Model them independently so the platform scales to multiple brokers and a dedicated admin. A single user account may hold multiple roles.

> **Design note — one account, buyer AND seller:** A user is **both** a buyer and a seller from the same account and phone number. Roles are **capabilities/modes on one account, not separate account types**. **Mode is set once at login / in profile** (a stance for the session, not a per-tap live toggle) and is **easy to switch in profile** (since a person can genuinely be both). Concretely:
> - The **account = the person/firm** (one phone, one login, one profile). Onboarding is role-agnostic; a user can act as either without a second signup.
> - **Selling and buying produce their own objects** owned by that account: a *sell listing* (side=SELL) and a *buy requirement* (side=BUY). This is exactly why the data model uses **one polymorphic `Listing` table with a `side` field** — same shape, opposite direction. One account can own many rows of both sides at once.
> - **Self-trade guard (must-build validation):** matching/negotiation must never let an account's buy requirement pair with its own sell listing. Enforce `buyer_id != seller_id` on every negotiation. Flag to engineers up front — it's a rule, not a schema change.
> - **Unchanged by this:** login (one phone + OTP), invite system (invite a *person*, who can act as either), and commission/broker capture (still per-trade).

---

## 4. Functional Requirements

### 4.0 App Navigation (LOCKED)

**Bottom nav — 4 tabs, rendered per mode.** Mode (buyer/seller) is fixed at login (see §3 design note), so the nav renders the buyer variant *or* the seller variant — it does not live-swap on a toggle. **Browse is the prominent/default landing tab.**

| Tab | Buyer mode | Seller mode |
|---|---|---|
| **Browse** *(default landing, prominent)* | Live prices — sellers' sell listings | Buy requirements — what buyers are seeking |
| **Trades** | **Active deals only** — in-progress negotiations & pending trades (completed history lives in Profile, §4.10) | Same (active deals only) |
| **Post Requirement** *(buyer)* / **Add Listing** *(seller)* | Post a buy requirement | Two-path fork: **Add Listing (manual)** or **Scan Sheet** |
| **Freight** | Freight rates (read-only reference, §4.9) | Freight rates (read-only reference, §4.9) |

- **Profile / account** (including **switch buyer↔seller mode**) is a top-right avatar or a Menu entry — **not** a bottom-nav tab. Keep mode-switch discoverable.
- **Admin** is a **separate surface** (desktop-first panel, §4.4.1) — not in this bottom nav.
- The richer nav in the freight reference screenshot (Live Prices / Buy / Trade / Sell / Brand / Menu) is **superseded by this 4-tab structure**. "Brand" is dropped for now (see §10 if revisited).
- Rationale: Browse-prominent reflects that users open the app to *see the market first*, then act — matches the offline trading habit. Both mode-dependent tabs (Browse, Post/Add) flip label + content by mode; Trades and Freight are the same in both.

#### 4.0.1 Browse tab — two grouping views (LOCKED)

The Browse tab has a **header toggle with two grouping modes of the same underlying data** (no new nav tab, no data-model change — it's the same listings re-grouped):

- **Buyer mode:** toggle = **By Commodity | By Seller** (buyers browse sellers' listings).
- **Seller mode:** toggle = **By Commodity | By Buyer** (mirror — sellers browse buy-requirements).

**By Commodity (default, primary view):** listings grouped under commodity headers (e.g. "Chana · Kabli Chana · 30KG bag") with rows of `[grade/quality] [firm name] [price]`, sorted cheapest-first within a commodity. This is the main, most-used view.

**By Seller / By Buyer (secondary view):** same listings **regrouped under firm headers** — each seller (or buyer) is a header with their listings/requirements beneath. Includes a **search box on top** to jump to a specific firm (essential once there are many). Use case: a buyer who habitually buys from one seller.

**Tap behavior (locked):**
- In **By Commodity**, tapping a **row → listing detail**. The seller/firm page is **not** opened from the row (keeps dense rows to one clear action).
- **Listing detail** contains a **"View all listings from [firm]" CTA** → opens the **Seller Listings page**.
- In **By Seller/By Buyer**, tapping a **firm header → the same Seller Listings page**.

**Seller Listings page (build once, reached from both entry points):** shows the firm's info (name, and relevant payment terms / logistics from their profile) + **all their active listings grouped by commodity**. The buyer-mode equivalent is a **Buyer Requirements page** (all of one buyer's active buy-requirements) — same screen, `side` flipped.

**Why efficient:** reuses the existing listing-row component and the polymorphic `Listing` model; By Commodity vs By Seller is a grouping/sort change, and the firm page is a single screen reached two ways. No new tab, no new entity.

### 4.1 Authentication & Onboarding
- Passwordless login via **mobile number + OTP**.
- **WhatsApp-based OTP/login** as a preferred channel (evaluate WhatsApp Business API / Meta login).
- **Invite-only:** an admin (or broker) invites a user by phone number. Only invited numbers can complete onboarding.
- On first login, capture minimal profile: name, business/firm name, phone (verified), role(s), city/mandi (optional), default payment terms (for sellers).

#### 4.1.1 Terms of Service acceptance
- **When it appears:** a ToS/Privacy gate shown **(a)** during first-time onboarding, **after OTP verification, before entering the app**; and **(b)** again on next login only when a **new version** of the terms has been published (re-accept on change). **NOT shown on every routine login** — that trains users to tap through blindly.
- **Consent method (chosen):** **implied consent** — "By continuing, you agree to the Terms of Service and Privacy Policy," with the primary button acting as the agreement (e.g. "Agree & Continue"). *(Explicit checkbox is a trivial swap if legal counsel later prefers it.)*
- **Screen:** title "Terms of Service & Privacy Policy"; scrollable terms text (placeholder now — legal copy TBD); tappable links to the full **Terms** and **Privacy Policy** (open in web view); primary **Agree & Continue** button. No confusing "Decline" dump — a user who doesn't agree simply cannot proceed (may close the app); optional subtle "Contact broker" link.
- **⚠ Must record (legal record — more important than the UI):** on acceptance, store per user **which version** was accepted + **timestamp**, tied to the verified phone. This is what proves consent and lets the app re-prompt *only* users who haven't accepted the current version. Requires the terms to carry a **version number**.
- **Also:** a persistent link to Terms & Privacy in **Profile → Support** (§4.10) so users can re-read anytime.
- **Out of scope (flag, don't build):** a separate "trading rules / code of conduct" distinct from the legal ToS — a possible later product addition; don't conflate with the legal terms.

### 4.2 Seller
1. **Listing ingestion — two paths:**
   - **(a) Screenshot / spreadsheet upload:** Seller uploads a screenshot of their price sheet or a spreadsheet file. The app parses it into structured listings. Typical sheet = **15–20 rows**, each with **commodity name, quality, price**. *(Sample sheet TBD — see Open Questions.)*
   - **(b) Manual entry:** Seller adds/edits listings one by one in the app.
2. **Price expiry:** Prices expire at an **admin-controlled time**, defaulting to **2:00 AM** daily. On expiry, **keep the listing but clear the price** (same items get re-listed daily; seller just re-enters fresh morning prices). Expired listings are hidden from buyers until repriced.
3. **Edit anytime:** Seller can change a price anytime **before expiry**.
4. **Bulk edit:** Seller can apply a delta (e.g., **+50 / −50**) to **all** listings or to **selected** listings at once. Support both absolute set and relative delta.

### 4.3 Buyer
1. **Requirements as visible listings:** Buyer posts what they want to buy — commodity, quality, target buying price, (and quantity — see §10). This **buy requirement is itself a listing (`side=BUY`) that sellers can browse and act on** — not just a private note. Sellers can discover matching buy requirements and **contact the buyer / initiate a negotiation**.
2. **Two-sided discovery (both lanes):** The marketplace is genuinely two-sided and symmetric:
   - Buyers browse **sell listings** (supply) and can initiate contact with a seller.
   - Sellers browse **buy requirements** (demand) and can initiate contact with a buyer.
   - Either side can start a negotiation; the "browse" and "contact/initiate" flows must exist **symmetrically for both roles**, not only buyer→seller.
3. **Negotiation (DIRECT, not broker-mediated):** Buyer and seller negotiate price **directly with each other** in-app — **replicate eBay's "Best Offer" back-and-forth** (see §5). **Decision locked:** the broker does **not** sit in the middle of the conversation. The broker still earns commission (captured on the trade-accept screen, §4.6) and the admin/broker can still *watch and nudge* live negotiations (§4.4) — but the offer/counter flow is buyer↔seller direct. Negotiation can be initiated from either a sell listing or a buy requirement.
4. **Trade confirmation:** When **both** buyer and seller accept a price, send confirmation to **buyer, seller, and the relevant broker/admin** that the trade is completed.

> **Design note — symmetry:** buy requirements and sell listings share the same `Listing` shape (differ only by `side`). Wherever the app shows/browses/filters listings, it should handle both sides. This keeps supply and demand as mirror images and avoids building two divergent systems.

> **⚠ Design gap (open, to build in Claude Design):** The current Buyer app prototype is **browse-and-enquire only** — a buyer can browse seller listings and send a one-shot enquiry, but **cannot post a buy requirement that sellers browse and act on**, and there is **no direct negotiation** (the prototype routes a single enquiry "through the broker"). Two things must be added to the design: **(a)** the buyer-posts-requirement flow + the seller-browses-requirements lane (the two-sided marketplace above), and **(b)** direct eBay-style negotiation replacing the broker-mediated enquiry. The trade-accept + broker-capture screen (§4.6) also still needs building.

### 4.4 Admin Panel

**The admin panel is a first-class, Phase-1 deliverable** — roughly co-equal in build effort with the seller/buyer apps, not a thin add-on. The father runs the whole brokerage *through* it; it is the digital version of his phone-based operation. Scope decisions locked: **full panel from MVP**, **admin can see in-progress negotiations**, **a few trusted admins** (multi-admin role with audit trail).

**Functional areas:**

1. **User & access management**
   - Invite users by phone number; revoke/cancel invites.
   - View all users, their role(s)/modes, active status, and who invited them.
   - Assign/adjust roles; (later) suspend or block a bad actor.

2. **Listings oversight**
   - View **all sell listings and all buy requirements** across every user.
   - Filter/search by commodity, supplier, category, status.
   - **Edit price/details on behalf** of a user who calls in (writes to `AuditLog`).
   - Force-expire or remove a listing.

3. **Negotiations (live visibility + nudge)** — *father explicitly wants this*
   - See **in-progress negotiations**, not just completed trades — the digital form of watching deals in flight.
   - Ability to **nudge**: message a party and/or edit an offer on their behalf (audited).
   - **Trust/privacy note:** in this closed network it's accepted that the broker/admin can see live negotiations. Make this an explicit, understood property of the platform, not a hidden one.

4. **Trades & brokerage**
   - View all **completed trades**; see which broker facilitated each (or "self").
   - Running view of **brokerage owed/earned** per broker; export (CSV).
   - *(Exact commission calculation still an open question — see §10.)*

5. **Platform settings**
   - **Price-expiry time** (global, default 2:00 AM, Asia/Kolkata).
   - **Commodity taxonomy management** — add/edit categories and commodities (keeps the platform commodity-agnostic without code changes).
   - **Broker list** management (the finite dropdown used on the trade-accept screen).
   - **Payment-terms** defaults.

6. **Supplier templates (Phase 2)**
   - Manage the **per-supplier learned parse templates** from §4.8 (view, re-teach, version).

7. **Audit log**
   - Surface the `AuditLog` — every admin edit-on-behalf and nudge, with actor, before/after, timestamp. Essential because **multiple admins** can act.

**Multi-admin implication:** admin is a proper multi-user role; every admin action is attributable via `AuditLog`. Tiered/limited-access admin permissions are a *later* refinement, not MVP.

#### 4.4.1 Admin Panel — screen-by-screen build brief (for Claude Design)

**Platform:** **Desktop-first (primary), scale to a mobile app later.** Not "shrink the desktop tables onto a phone" — use **responsive priority**: on mobile the panel collapses to the few things done away from a desk (watch/nudge live deals, approve invites, glance at today's trades); heavy management tables stay desktop-primary. Each screen is tagged **[Mobile-essential]** or **[Desktop-primary]**.

**Shell:**
- Left nav (desktop): Dashboard, Users, Listings, Negotiations, Trades & Brokerage, Settings, Audit Log. Collapses to bottom-tab/hamburger on mobile showing only mobile-essential sections.
- Top bar: signed-in admin, global search, today's date + 2:00 AM expiry countdown.
- Reuse the existing buyer/seller **design system** (same tokens/components). Seed with the same real data (Rajat & Company + Kunj Bihari sub-entities).

1. **Dashboard / home — [Mobile-essential].** At-a-glance: counts of live sell listings & buy requirements, active negotiations now, trades closed today, brokerage earned today. A "needs attention" strip (pending invites, stalled/near-expiry negotiations, users who called in for a manual edit).

2. **User & access management — [Mobile-essential: invite/approve; Desktop-primary: full table].** Invite by phone; view/revoke pending invites. Table of all users: name/firm, phone, role(s)/modes (buyer/seller/both shown as tags — a user can be both), status, invited-by, last active. Row actions: adjust roles, deactivate/suspend.

3. **Listings oversight — [Desktop-primary].** One table across **both sell listings and buy requirements** (a `side` column SELL/BUY). Columns: supplier/firm (+ sub-entity, e.g. Kunj Bihari Impex), category, item, weight, price (₹; N/A shown as real state), status (active/price-expired/traded/withdrawn), valid-until. Filters: side, commodity/category, supplier, status. Row actions: **edit on behalf** (audited dialog), force-expire, remove.

4. **Negotiations (live visibility + nudge) — [Mobile-essential].** The father's phone job, digitized. List of **in-progress negotiations**: the two parties, listing/requirement, offer/counter history (eBay-style thread), current standing offer, time-to-expiry. Actions: message a party, nudge/relay an offer on their behalf (audited). Filter active vs. completed. Surface the design note that admin *can* see live negotiations — explicit, not hidden. Most important screen to have on mobile (deals move in real time).

5. **Trades & brokerage — [Desktop-primary, with a mobile "today" summary].** Table of completed trades: buyer, seller, commodity/item, quantity (bags), final price, date, **broker who facilitated** (finite list / free-text / "self"). Brokerage summary per broker + totals + CSV export. Commission calculation still open (%/flat-per-bag/recorded) → show a placeholder column flagged "FOR DISCUSSION".

6. **Settings — [Desktop-primary].** Price-expiry time (default 2:00 AM, Asia/Kolkata); commodity taxonomy management (add/edit categories & items); broker list management; payment-terms defaults; per-supplier parse templates (Phase 2 stub — view/re-teach/version).

7. **Audit log — [Desktop-primary].** Chronological, filterable record of every admin action (esp. edits-on-behalf and nudges): actor, action, entity, before/after, timestamp. Can be a stub table in the mock but include it.

8. **Freight management — [Desktop-primary].** Daily **freight sheet upload** (Excel now; OCR later) → review parsed routes → publish. Table of freight routes: origin (state or city), destination, price (range or single), unit (per quintal), truck capacity, valid-until. Manual add/edit a route. Same 2 AM expiry as commodity prices. This is the admin side of the §4.9 Freight page.

**Keep as visible "FOR DISCUSSION" flags in the mock (don't resolve):** commission model; quantity as a locked field; tiered admin permissions (full vs. limited-access staff — not MVP).

**Out of scope for this mock:** buyer/seller apps (already designed); actual backend/data; the parse-template teaching UI (Phase 2 stub only).

### 4.5 Listing Specification
| Field | Requirement |
|-------|-------------|
| Commodity **category** | Required (taxonomy, e.g., "Rajma", "Kabli", "Chana", "Urad Dal") — the left grouping column on the real sheet |
| Commodity **name / trademark** | Required (e.g., "Chitra Pila Badshah", "Garbanzo Dry White") — the specific product line; on the real sheet this is one free-text string carrying grade/origin/color |
| **Quality** | **Free text** (confirmed by real sheet — origin, grade, color are embedded in the name string; do NOT force a controlled dropdown). May be same field as name or a secondary note. |
| **Weight / packing** | **Optional, with supplier-level default.** Sheet A has a per-row weight column (30/35/45KG); Sheet B has no weight at all. So weight can be per-listing, inherited from a supplier default, or absent. When present, price is **per bag of this weight**. |
| **Price / rate** | Required for an active listing; cleared on expiry. `N/A` is a valid "not available today" state (null price, row kept). Price is per bag when a weight is set, otherwise a per-item rate. Note format variance: bare integers (Sheet A) vs. `/-` suffix (Sheet B) — normalize on parse. |
| **Photo** | Optional |
| **Moisture** | Optional |
| **Color** | Optional (note: color is often already embedded in the name — Pila=yellow, Lal=red, Hara=green, Nila=blue) |
| **Size** | Optional |
| **Payment terms** | Set at **seller/firm level** (applies to all their listings) with **per-listing override**. Real sheet carries firm-level terms in the header (see §4.7). |

### 4.7 Real Sample Price Sheets — Ground Truth (from founder's actual data)

**Two real seller sheets have been provided, from two different suppliers. They differ structurally in almost every way — this variance is itself a core requirement (see §4.8 on per-supplier templates).** Both are authoritative references for the parser and listing model.

#### Sheet A — Rajat & Company Commodities Pvt Ltd (28-07-2026)

**Structure — three effective columns per row + a grouping column:**
- **Category** (left, vertically merged): RAJMA, RAJMA LAL, LOBIYA, KABLI, CHANA DALL, BESAN, CHANA, MATAR, URAD SABUT, URAD DHOWA, URAD DAL, MOONG DHOWA, MOONG SABUT, MASOOR, MALKA, DALL MASOOR. → maps to **CommodityType/Category**.
- **Trademark / Item name** (free text): e.g., "CHITRA PILA BADSHAH", "GARBANZO DRY WHITE (AUSTRELIA)", "RUSSIAN ORANGE BALAY BALAY". → maps to **Commodity name + quality**, kept as free text.
- **Weight**: 30KG (most common), 35KG (Besan, Matar Besan), 45KG (one Garbanzo row). Note messy formatting ("30 KG" with a space, "30kg" lowercase) — parser must normalize.
- **Price**: integer per bag of the stated weight. `N/A` appears and means "not available today" → store null price, keep row.

**Header / firm-level metadata (NOT per-listing):**
- Date of the sheet (28-07-2026) — effectively the listing day.
- Firm name & logo (Rajat & Company / RT Group).
- **Logistics & payment terms**, e.g.: goods must be outward within two days of order confirmation; program received only before 5:00 PM; no tempo loading after 10 PM; prices subject to market conditions; late-payment warning (parties later than ~15 days may be refused). → these are **seller/firm-level payment_terms & notes**, shown across all listings.
- **Salesmen with phone numbers** (Ratan 9810871966, Sanjay 7665899003, Naveen 8950278270) → a firm can have **multiple contacts/salesmen**; consider a `contacts[]` on the seller/firm.

**Visual cues:**
- Some rows are **highlighted yellow** — meaning unknown (featured? changed today? hot item?). **Ask the father** what yellow signifies; may become a "featured"/"updated" flag. See Open Questions.

**Parsing implications (Sheet A):**
- OCR/screenshot parsing must: detect the grouping/category from merged cells, split item vs. weight vs. price, normalize weight strings, treat `N/A` as null price, and ignore header/footer metadata rows.
- Output must go to a **seller review/correction screen** before going live (rows are messy; never auto-publish).

#### Sheet B — Kunj Bihari group (08-08-2026)

Structurally very different from Sheet A. Documents the format variance the parser must handle:
- **Multiple business entities on one sheet:** Kunj Bihari Food Industries, Kunj Bihari Agro Products, Kunj Bihari Pulses Pvt Ltd, Kunj Bihari Impex, and a "Mill Program". One supplier → **many sub-entities/brands** on a single price list.
- **Two-column magazine layout:** two independent `category → item → rate` tables side by side, not one table. Parser must handle multi-column page layout.
- **No weight column at all.** Rate is per item; bag weight is implied/known offline. → confirms **weight must be OPTIONAL**, not required (contradicts Sheet A, which had it).
- **Price format:** `11400/-` style with a `/-` suffix (vs. Sheet A's bare integers). Parser must strip/normalize.
- **Brand + color embedded in item name:** brand lines like "Nach Baliye", "Rapid Metro", "Meri Delhi", "Wah Taj"; colors (Green/Red/Blue/Golden/Pink/Orange) in parentheses. Same free-text quality treatment as Sheet A.
- **Many salesmen + accountants with phones** in the header → reinforces `contacts[]` at supplier level.
- **Footer note (Hindi):** delivery must be taken within 15 days of a deal or market-rate interest applies → firm-level payment/logistics term.

**Combined takeaway across A and B:**
- **No single universal parser is realistic.** The two sheets share almost no structure. Weight present vs. absent; one table vs. two-column; bare integer vs. `/-`; single firm vs. five entities.
- Therefore: parse against a **per-supplier learned template** (see §4.8), not a one-size-fits-all extractor.
- **Weight is optional** with a supplier-level default; do not make it a required per-row field.
- A **Supplier can contain multiple sub-entities/brands** — the data model needs a level above category.

### 4.8 Per-Supplier Learned Template (parsing strategy)

**Core idea (founder's proposal, adopted):** each supplier's sheet format is stable day-to-day — they send the same layout every morning with only prices changing. So instead of parsing cold each time, the platform learns a **saved template per supplier** on first upload, then does a fast, high-confidence parse against that template every day after.

**Flow:**
- **First upload from a supplier (teach-once):** parser makes a best effort; the seller/admin confirms the mapping — which columns are category/item/weight/price, how many table-columns on the page, whether weight exists, price format (`/-` etc.), and any sub-entity groupings. This confirmed mapping is saved as the **supplier's template**.
- **Every subsequent upload (fast-parse):** parse directly against the saved template → high confidence, minimal correction. Still routes through the **review screen** as a safety net.
- **Template versioning:** if a supplier changes their format, re-teach / version the template. Detect low parse confidence as a trigger to re-teach.

**Status / phasing:** This is the **target architecture, but Phase 2**, not MVP. It is a real feature to build (template store, per-supplier parse config, teach/confirm UI, versioning) — not a free win. **MVP** = manual entry + basic parse-and-review. **Phase 2** = per-supplier learned templates + fast daily parse. Document now, build later.

**Pattern reference:** analogous to how invoice/expense tools handle recurring vendor formats — learn the vendor layout once, then auto-extract on subsequent documents.

### 4.9 Freight Page (admin-published reference data)

A **Freight page** is a top-level section of the app showing transport rates by route. **It is admin-controlled and updated daily** by uploading a freight sheet — the same upload→parse→review→publish pattern as commodity sheets, but freight is **reference data, NOT a `Listing`**: no buyer/seller, no negotiation, no trade, no commission. Everyone reads it; only admins publish it.

**What it looks like (from the reference screenshot):** an origin (e.g. Punjab, with cities like Amritsar/Jalalabad/Fazilka) selected via **state tabs** (Punjab / Haryana / Rajasthan / …), then a table of **destination → price**. Destinations are typically ports/mandis (Kandla Port, Mundra Port, Nhava Sheva). Prices are shown as **ranges** (e.g. ₹160–165) and quoted **per quintal** (different unit from commodity sheets, which are per bag). A truck-capacity note (e.g. 30–35 MT) is shown.

**Locked decisions:**
- **Upload format:** **Excel/spreadsheet now; photo/OCR later** (mirrors the commodity-sheet phasing).
- **Price format:** **range OR single value, admin's choice** — store as an optional low/high pair; a single value is `low == high`. One field design covers both.
- **Route structure:** **origin → destination → price**, city to city (e.g. Ludhiana → Amritsar). There is **no state/city level** — `origin_level` was dropped; origin and destination are free-text names, trimmed and matched case-insensitively. One route per (origin, destination) pair (DB-unique, case-insensitive). The read API groups routes **by origin name** so the client can show one tab per origin.
- **Expiry:** freight has its **own expiry time**, setting `freight_expiry_time` (`{ "time": "HH:mm" }`, Asia/Kolkata, default 02:00), independent of listings' `price_expiry_time`. It is stamped into each route's `price_valid_until` at write time; the existing hourly expiry job flips `active` → `price_expired`. Routes are kept; non-admin reads return `null` prices for expired routes (also evaluated at read time, so job lag can't leak a stale price). Admins still see the last price.
- **Unit:** per quintal (vs. per bag for commodities). Store the unit explicitly so the two don't get conflated.

**Architecture note:** freight is effectively a **third daily-upload source format**, which confirms that the per-supplier learned-template idea (§4.8) generalizes to "**per-source** learned template" — the parser learns the freight sheet layout once and fast-parses it daily, same as a supplier sheet. Freight upload/parsing beyond a basic Excel import is **Phase 2** (learned template + OCR); a basic Excel import + review can be MVP if freight is needed early.

**Admin panel:** freight upload + review + publish, and manual edit of a freight rate, live in the **admin panel** (add to §4.4.1 as a Freight management screen — Desktop-primary, with the daily upload being the main action).

**Nav note:** Freight is one of the 4 locked bottom-nav tabs (**Browse · Trades · Post/Add · Freight**) — see §4.0. It's a read-only reference tab for both buyer and seller modes; the admin-side upload/publish lives in the admin panel (§4.4.1 #8).

### 4.6 Negotiation → Trade → Commission
- On the **final trade-accept screen**, capture the **broker**:
  - A **dropdown of a finite broker list**.
  - An **open text field** to add a broker name not in the list.
  - A **"Self"** option selectable by buyer/seller (meaning no broker / direct).
- Record broker per trade so brokerage can be attributed. *(Commission calculation/rate model — see Open Questions.)*

### 4.10 Profile

The profile is the user's identity + settings hub, and the **home for completed trade history** (deliberately moved out of the Trades tab, which holds active deals only — see §4.0). Principle: **profile owns identity, settings, mode-switch, and history; it links out to the tabs for active views rather than duplicating them.**

**Account & identity**
- Name (person); firm/business name (firms are first-class — Rajat & Company, Kunj Bihari).
- Phone number — verified via OTP; shown, changing it requires re-verification (it's the login identity).
- City / mandi.
- Profile photo / firm logo (optional).

**Mode & role**
- **Current mode: Buyer / Seller — the switch-mode control lives here** (mode is set at login and changed in profile, per §4.0). This is its home.
- Role badges (buyer / seller / both / broker) — read-only; roles are admin-granted in an invite-only system.

**Seller settings** (shown in seller mode / for sellers)
- **Default payment terms** (apply across all listings; per-listing override — §4.5).
- **Firm logistics/notes** (e.g. "goods outward within 2 days", "no tempo after 10 PM" — from the real sheets).
- **Default bag weight** (supplier-level default; weight is optional per-listing).
- **Contacts / salesmen** — manage the list (real sheets list multiple: Ratan/Sanjay/Naveen; Deepak/Mukesh/Palan).
- *(Phase 2)* saved supplier parse template.

**History & activity**
- **Past / completed trades** — the primary home for trade history (as buyer and as seller). Moved here from the Trades tab.
- **My listings / My requirements** — quick links to their own active posts (owned by Browse/Post tabs; link, don't duplicate).

**Preferences**
- **Notification toggles — push / WhatsApp / SMS** (MVP). Controls trade confirmations and offer activity; WhatsApp already used for OTP.
- **Language** — leave the slot even if MVP is English-only (user base is bilingual Hindi/English).

**Support & account actions**
- **Contact broker / admin / help** — one tap; in an invite-only trust network the broker is the real support channel.
- **Terms / privacy**; **Logout**.
- **No self-service account deletion** — deactivation is an admin action (§4.4). Stated deliberately, not an omission.

**Explicitly NOT in profile:** broker selection (per-trade, on the trade-accept screen §4.6) and price-expiry time (global admin setting §4.4).

---

## 5. Negotiation Mechanic (eBay "Best Offer" style) — DETAILED

A negotiation is a **thread between one buyer and one seller on one listing** (a sell listing or a buy requirement), consisting of a sequence of offers. Direct between the two parties — the broker is **not** a party (but can watch/nudge, see below).

### 5.1 Core flow
- A listing has a **listed price** (seller's ask, or buyer's bid on a buy requirement).
- A party opens a negotiation and makes an **offer**. The counterparty can **Accept**, **Decline**, or **Counter** with a new price.
- **Deal is done only when both parties have explicitly accepted the same price.** Accept → **trade-accept + broker-capture screen** (§4.6) → confirmed trade. No silent auto-commit.

### 5.2 Locked rules (decided with founder)
- **What's negotiated:** **PRICE ONLY** (MVP). Quantity and payment terms are **not** negotiated in-app.
  - *Deliberate MVP simplification:* quantity is either fixed on the listing or agreed off-app (phone/WhatsApp). Payment terms inherit from the seller. Revisit if quantity becomes a negotiated field later. Interacts with the first-accept-wins rule below (the whole listing closes regardless of quantity actually taken).
- **Counters:** **unlimited** back-and-forth. Full offer history visible in the thread. (Auto-accept/decline thresholds and any soft cap = Phase 2.)
- **Offer validity:** an offer is live **until accepted / countered / declined / or the 2:00 AM price expiry — whichever comes first.** A counter supersedes the previous offer. At 2 AM the offer **dies with the price**; the thread remains visible marked **expired** so parties can re-open next morning. *(This resolves the former open question about expiry mid-negotiation.)*
- **Multiple negotiations on one listing → FIRST-ACCEPT-WINS:** multiple buyers may negotiate the same sell listing simultaneously. **The moment one negotiation is accepted, the listing is marked `traded` and all other open negotiations on it are VOIDED.** The other buyers get a clear **"this listing was sold to another buyer"** notification and their thread shows a voided state. (Mirror applies to a buy requirement with multiple sellers.)
- **Initiation is symmetric:** a buyer can offer on a sell listing, AND a seller can offer on a buy requirement. The negotiation screen works both directions (same component, `side` flipped).
- **Retract:** a party may **withdraw a pending offer** before the other party accepts. Once accepted, it is binding (→ trade).

### 5.3 Offer states (state machine)
- **Offer:** `pending` → (`accepted` | `declined` | `countered` | `retracted` | `expired`)
- **Negotiation:** `open` → (`accepted` | `declined` | `voided` (lost to another accept) | `expired` (2 AM))
- **Listing:** `active` → `traded` (on first accept) — which cascades: all other `open` negotiations on that listing → `voided`.

### 5.4 Broker / admin visibility (from §4.4)
- The broker/admin can **see live in-progress negotiations** and **nudge** (message a party, or relay/edit an offer on their behalf — audited). The broker is **not** a party to the offers and does not accept on anyone's behalf silently. This is an explicit, understood property of the closed network.

### 5.5 Notifications
- Every **offer / counter / accept / decline / retract / void / expiry** notifies the affected party (push + WhatsApp/SMS). This is what makes the negotiation feel live. The "your listing was sold to someone else" void notification especially must be clear and non-alarming.

### 5.6 Phase 2 (not MVP)
- Auto-accept threshold (accept ≥ X) and auto-decline threshold (reject ≤ Y).
- Quantity-aware partial fills (listing stays open for remaining stock) — only if quantity becomes a real negotiated field.
- Soft cap on counters, if ever needed.

---

## 6. Core Data Model (draft)

Entities are intentionally commodity-agnostic and role-flexible.

- **User**: `id, phone (verified), name, firm_name, roles[] (buyer|seller|broker|admin), city/mandi, default_payment_terms, firm_notes (logistics/terms shown on all listings), contacts[] (salesman name+phone — real sheet lists multiple), tos_accepted_version, tos_accepted_at, invited_by, status, created_at`
- **ToSVersion**: `id, version, effective_date, terms_url, privacy_url, published_at` — the current version drives whether a user must re-accept (see §4.1.1).
- **Invite**: `id, phone, invited_by, role_hint, status (pending|accepted|revoked), created_at`
- **CommodityType**: `id, name` (e.g., Rice, Pulses) — extensible taxonomy
- **Commodity**: `id, type_id, name` (e.g., Basmati 1121) — extensible
- **QualityGrade** *(optional/TBD)*: `id, commodity_id, label`
- **Supplier / Firm**: `id, name, roles (usually seller), contacts[] (name+phone salesmen/accountants), default_payment_terms, firm_notes, default_weight_kg?` — a supplier maps to one or more user accounts.
- **SubEntity** (optional): `id, supplier_id, name` — one supplier can list under multiple business entities/brands (e.g., Kunj Bihari Food Industries / Agro Products / Pulses / Impex). Listings may reference a sub-entity. Decide whether buyers see sub-entities or a flattened supplier — see §10.
- **SupplierTemplate** (Phase 2): `id, supplier_id, version, column_map, has_weight bool, price_format, table_layout, subentity_map, confidence_threshold, created_at` — the learned parse template per supplier (see §4.8).
- **Listing** (sell) / **Requirement** (buy) — can be one polymorphic `Listing` table with `side (SELL|BUY)`:
  - `id, side, user_id, supplier_id, subentity_id?, category_id, commodity_id, item_name (free text), quality (free text), weight_kg? (OPTIONAL per-bag packing size; may inherit supplier default or be absent), price (nullable when N/A or expired), currency, photo_url?, moisture?, color?, size?, payment_terms (nullable → inherits supplier default), notes?, is_featured? (maps to the yellow-highlight cue, TBD), status (active|price_expired|na|withdrawn|traded), price_valid_until, created_at, updated_at`
  - **Note:** price is *per bag of `weight_kg`* when weight is set, otherwise a per-item rate. Do not assume a global unit — Sheet A mixes 30/35/45 KG bags, Sheet B has no weight.
- **Negotiation**: `id, listing_id, buyer_id, seller_id, status (open|accepted|declined|voided|expired), created_at` — **enforce `buyer_id != seller_id`** (self-trade guard). `voided` = another negotiation on the same listing was accepted first; `expired` = 2 AM. See §5.
- **Offer**: `id, negotiation_id, by_user_id, price, type (offer|counter|accept|decline|retract), status (pending|accepted|declined|countered|retracted|expired), created_at` — price only (MVP). Latest pending offer supersedes prior.
- **Trade**: `id, negotiation_id, buyer_id, seller_id, commodity_id, quality, final_price, quantity?, broker_id? (nullable), broker_name_freetext? (nullable), is_self bool, payment_terms, confirmed_at`
- **Broker**: `id, user_id?, name` (finite list; free-text names get captured on the trade)
- **FreightRoute**: `id, origin_name, destination_name, price_low, price_high (== price_low when single value), unit (default 'per_quintal'), truck_capacity? (e.g. '30-35 MT'), price_valid_until, status (active|price_expired), updated_by (admin), created_at, updated_at` — admin-published reference data; NOT a listing (no buyer/seller/negotiation/trade). Expires on its own `freight_expiry_time` setting. Unique per (origin, destination), case-insensitive.
- **SourceTemplate** (Phase 2, generalizes SupplierTemplate): learned parse template per **source** — a supplier sheet OR the freight sheet. Same teach-once/fast-parse-daily idea (§4.8).
- **Setting**: `key, value` (e.g., `price_expiry_time = 02:00`, timezone `Asia/Kolkata`)
- **AuditLog**: `id, actor_user_id, action, entity, entity_id, before, after, created_at` (critical — admin edits on behalf of users must be auditable)

> **Units/quantity are underspecified** in the current requirements (the price sheet is commodity+quality+price with no quantity). Confirm whether trades need quantity, and the price unit. See §10.

---

## 7. Architecture Notes

- **API-first backend.** All business logic server-side. Mobile and future desktop are thin clients over the same REST/GraphQL API.
- **Timezone:** All expiry logic in **Asia/Kolkata**. Store timestamps in UTC.
- **Scheduled job** for daily price expiry (clears prices, sets `price_expired`, preserves listing rows). **Applies to both commodity listings and freight routes** (§4.9) — same 2 AM job.
- **Notifications:** push + WhatsApp/SMS for OTP, trade confirmations, and (optionally) offer activity.
- **File/image handling:** screenshot & spreadsheet upload → parsing service. Consider OCR (for screenshots) + spreadsheet parser (for xlsx/csv). Parsing produces a **review screen** where the seller confirms/corrects parsed rows before they go live (never trust parse blindly).
- **Per-supplier learned templates (Phase 2):** supplier sheet formats vary wildly (see §4.7/§4.8) but are stable per supplier. Learn a template on first upload (teach-once), then fast-parse against it daily. Requires a template store + teach/confirm UI + versioning. MVP stays on manual entry + basic parse-and-review.
- **Extensibility:** commodity taxonomy, payment terms, and optional attributes are data-driven so new commodity classes don't require schema/code changes.
- **Auditability:** every admin/broker edit-on-behalf writes to `AuditLog`.
- **Suggested stack (not locked):** BE — Node/TypeScript or Python; Postgres; object storage for images. FE — React Native / Flutter for mobile; React web later. Confirm with the eng team.

---

## 8. Phasing (proposed)

- **Phase 1 (MVP):** Invite + OTP login; single account with buyer/seller mode toggle; manual listing entry (sell) & requirements (buy); daily price expiry; browse listings; eBay-style negotiation; both-accept → trade confirmation; broker capture on trade; bulk price edit; **full admin panel** (user mgmt, listings oversight, live-negotiation visibility + nudge, trades & brokerage, platform settings, audit log — see §4.4). Multi-admin with audit trail. **Freight page** (admin-published) with **basic Excel upload** if needed early (§4.9).
- **Phase 2:** Screenshot/spreadsheet upload + basic parse with review screen; **per-source learned templates** (supplier sheets AND freight sheet — teach-once, fast daily parse — §4.8); freight **OCR** upload; WhatsApp login; auto-accept/decline thresholds; richer notifications.
- **Phase 3:** Desktop/web client; commission accounting/reports; analytics; more commodity classes.

---

## 9. Glossary
- **Mandi:** Indian wholesale agri market.
- **Quintal:** 100 kg (common Indian trade unit).
- **Brokerage/Commission:** the broker's fee on a completed trade.
- **Buy requirement / buy listing:** a buyer's posted demand (mirror of a sell listing).

---

## 10. Open Questions (need founder input to lock)

**Resolved by the real sample sheets (§4.7):**
- ~~Sample price sheet~~ → two received (Rajat & Kunj Bihari); schemas documented in §4.7.
- ~~Price unit~~ → **price is per bag when a weight is set (Sheet A: 30/35/45 KG), else a per-item rate (Sheet B: no weight). Weight is OPTIONAL with a supplier default — not a required field.**
- ~~Quality free text vs. graded~~ → **free text** (grade/origin/color/brand are embedded in the item name).
- ~~One universal parser~~ → **no; use per-supplier learned templates (§4.8), Phase 2.**
- ~~Buyer↔seller contact routing~~ → **direct eBay-style negotiation between buyer and seller; broker is NOT the middleman (earns commission via trade-accept capture, watches/nudges via admin panel). See §4.3.**
- ~~Top-level navigation~~ → **LOCKED: 4 bottom-nav tabs — Browse (prominent/default) · Trades · Post Requirement/Add Listing · Freight. Rendered per mode. See §4.0.**
- ~~Buyer/seller mode switching~~ → **set once at login / changeable in profile (not a live per-tap toggle). See §3 & §4.0.**
- ~~Expiry mid-negotiation~~ → **offer dies at 2 AM with the price; thread stays visible as `expired`, re-openable next morning. See §5.2.**
- ~~Negotiation depth / offer validity / multiple-negotiations-per-listing~~ → **unlimited counters; offer valid until accepted/countered/declined/2 AM; first-accept-wins (listing closes, other negotiations voided w/ notification); price-only. See §5.**
- ~~"Brand" nav item~~ → **dropped from scope for now; not one of the 4 tabs. Revisit later if needed.**

**Still open:**
1. **Quantity per trade:** The sheets have no quantity (they're price lists). When a deal closes, do we capture **how many bags** are being traded? **Kept open per founder — but both the Buyer and Seller design prototypes already capture quantity (bags), so this is leaning strongly toward "yes, required".** Confirm, and confirm whether buyers specify quantity when posting a requirement.
2. **Yellow highlighting:** What does a yellow-highlighted row mean on Sheet A (featured / changed today / hot / low stock)? Determines whether we add an `is_featured`/flag field.
3. **Supplier sub-entities:** Kunj Bihari lists under 5 business entities on one sheet. Do buyers see/care about the sub-entity, or does the app flatten everything to one supplier? Affects whether `SubEntity` ships in MVP.
4. **Commission model:** Is brokerage a %, flat fee per bag, or just recorded (calculated offline)? Who pays — buyer, seller, or split?
6. **Visibility:** Can every buyer see every seller's listings (open pool), or is visibility scoped (by broker, region, or invite group)?
7. **Trade settlement:** Does the app track payment/delivery status after a trade is confirmed (the sheet emphasizes payment timelines heavily), or does it stop at "trade agreed"?
8. **WhatsApp login:** Confirm appetite for WhatsApp Business API onboarding (cost/approval overhead) vs. plain SMS OTP for MVP.
9. **Multiple brokers:** In Phase 1, is there only the father as broker, or should the multi-broker + broker-list UI ship in MVP?
10. **Multiple salesmen/contacts:** The real firm lists 3 salesmen with phones. Do buyers contact a specific salesman, or is contact abstracted away by the app entirely?
11. **Weight normalization edge cases:** Sheet has "30 KG", "30kg", "45KG" — confirm the full set of allowed bag weights so the parser/dropdown can be constrained.
12. **Freight expiry behavior:** On 2 AM expiry, do freight routes keep the row and clear the price (like listings), or hide entirely? (Defaulted to keep-row-clear-price.)

---

**Reference assets:** two real supplier sheets are the ground truth for the parser and listing model — **Sheet A: Rajat & Company (28-07-2026)** and **Sheet B: Kunj Bihari group (08-08-2026)** — see §4.7. They differ structurally on purpose; keep both images alongside this file in the repo as parser test cases.

*Last updated: revised after ingesting a second supplier sheet (Kunj Bihari), which drove the per-supplier learned-template strategy (§4.8), made weight optional, and added the Supplier/SubEntity model. Update this file as decisions are locked; treat it as the single source of truth for both product and Claude Code sessions.*
CLAUDE.md
Displaying CLAUDE.md.