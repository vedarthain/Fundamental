-- 0067 — thematic stock groupings ("themes"), imported from an external
-- editorial taxonomy and resolved onto our own NSE universe.
--
-- WHY A NEW GROUPING AT ALL: app.meta_cluster / app.cluster already give every
-- scored stock a two-level home (sector → peer cluster), and that taxonomy is
-- the one the scoring engine uses — percentiles are computed WITHIN a cluster,
-- so a cluster must be a set of genuinely comparable businesses. That
-- constraint is exactly why it cannot express a theme. "Drone" spans defence
-- electronics, plastics and software; "Green Hydrogen" spans utilities,
-- engineering and gas. Forcing those into the scoring tree would corrupt the
-- peer sets. Themes are therefore a SECOND, ORTHOGONAL grouping: many-to-many,
-- non-exhaustive, editorial, and deliberately NOT an input to any score.
--
-- WHY WE IMPORT MEMBERSHIP AND NOTHING ELSE: the upstream source publishes
-- prices, day changes and sparklines alongside each list. We take none of it.
-- Every number rendered on a theme page comes from cluster_stocks_panel_cache
-- like every other surface, so themes inherit our freshness, our intraday
-- overlay and our return definitions. Importing their prices would have
-- created a second, slower, differently-defined price path — the exact class
-- of divergence we spent 7cd17bd..fee6eea removing from the portfolio tabs.
-- The import is a list of company NAMES and nothing more.
--
-- WHY THE ALIAS TABLE EXISTS: the source carries no NSE symbol and no ISIN.
-- Identity resolution is therefore a name match against universe.company_name,
-- and measured on the full 1,297-name catalogue a normalised exact match
-- resolves 1,121 (86.4%), leaves 9 ambiguous and 167 unmatched. The residue is
-- not noise to be fuzzed away: a trigram matcher confidently proposed
-- "Solarium Green Energy" → SOLARINDS (Solar Industries India), a different
-- company two orders of magnitude larger. One wrong constituent discredits a
-- whole theme page, so unresolved names are PARKED for human adjudication
-- rather than guessed. theme_alias is both that review queue and the permanent
-- override map — a decision made once is replayed by every later run.
--
-- A large share of the unmatched tail is not our matcher's fault: 472 of 2,622
-- active universe rows carry company_name = symbol (no company name at all).
-- Those can never be matched by name and will sit in the queue until
-- sync-universe is fixed to populate them.

BEGIN;

-- ---------------------------------------------------------------------------
-- app.theme — one row per editorial grouping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.theme (
    id            SERIAL PRIMARY KEY,
    source        TEXT NOT NULL DEFAULT 'financialexpress',
    -- The source's own numeric id. Kept because slugs get renamed for SEO
    -- while ids do not, so this is the stable join key across refreshes.
    source_id     INTEGER,
    slug          TEXT NOT NULL,
    label         TEXT NOT NULL,
    -- 'sector' = duplicates a grouping our cluster tree already expresses
    -- (Banks, Cement, Textiles…); 'theme' = a narrative grouping we cannot
    -- derive (Drone, Data Center, Green Hydrogen). Stored rather than computed
    -- so the UI can default to showing themes without hardcoding a list.
    kind          TEXT NOT NULL DEFAULT 'theme'
                  CHECK (kind IN ('sector', 'theme')),
    display_order INTEGER NOT NULL DEFAULT 0,
    -- Set false when a theme disappears upstream. We never DELETE: a theme
    -- that vanishes for a week and returns should keep its identity, and a
    -- dead theme's membership is still useful history.
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    -- Last time the importer successfully read this theme's page.
    refreshed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source, slug)
);

CREATE INDEX IF NOT EXISTS theme_active_kind_idx
    ON app.theme (is_active, kind, display_order);

-- ---------------------------------------------------------------------------
-- app.theme_member — resolved membership. Symbols only; no prices, no returns.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.theme_member (
    theme_id     INTEGER NOT NULL REFERENCES app.theme (id) ON DELETE CASCADE,
    symbol       TEXT    NOT NULL REFERENCES app.universe (symbol) ON DELETE CASCADE,
    -- The upstream display name this row was resolved FROM. Kept verbatim so a
    -- later rename upstream is visible as a new unresolved name rather than
    -- silently dropping the member.
    source_name  TEXT NOT NULL,
    -- How identity was established. 'exact' = normalised name matched exactly
    -- and uniquely; 'alias' = a human approved it in app.theme_alias. There is
    -- deliberately no 'fuzzy' — see the header.
    match_method TEXT NOT NULL CHECK (match_method IN ('exact', 'alias')),
    resolved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (theme_id, symbol)
);

-- The dominant read is "give me every member of theme X" (theme page); the
-- secondary is "which themes is this stock in" (stock page chips).
CREATE INDEX IF NOT EXISTS theme_member_symbol_idx ON app.theme_member (symbol);

-- ---------------------------------------------------------------------------
-- app.theme_alias — review queue AND permanent name→symbol override.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.theme_alias (
    source_name  TEXT PRIMARY KEY,
    -- NULL while pending, and NULL for a permanent rejection (a BSE-only or
    -- SME name that will never have an NSE symbol). status disambiguates.
    symbol       TEXT REFERENCES app.universe (symbol) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
    -- What the matcher would have guessed, shown to the reviewer as a starting
    -- point. Never acted on automatically.
    suggestion   TEXT,
    note         TEXT,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at   TIMESTAMPTZ,
    decided_by   TEXT,
    -- Guard rail: an approved alias must name a symbol, a rejected one must
    -- not. Prevents a half-finished review from injecting a NULL member.
    CHECK ((status = 'approved') = (symbol IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS theme_alias_status_idx ON app.theme_alias (status);

COMMIT;
