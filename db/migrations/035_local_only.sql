-- Open only to nationals (or residents) of the duty-station country, as the vacancy's own text says
-- ("National Consultant", "only Namibian nationals are eligible"), found by the rules or the AI when
-- the grade and title don't say so (src/lib/local-only.ts). null: not checked yet; false: checked, not said.
alter table jobs add column if not exists local_only boolean;
