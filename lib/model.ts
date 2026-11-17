// Token launch radar — comparables-calibrated implied-value model (radar-2).
//
// Every number below is derived from the sealed snapshot itself, at run time. No protocol name is
// ever special-cased and no value is hand-picked: the same function scores every row.
//
//   1. Comparables multiple. For each category, take the live-token protocols in the snapshot and
//      compute the MEDIAN of (market cap / TVL). A token that already trades is the market's own
//      verdict on what a unit of TVL in that sector is worth. Categories with fewer than 3 live
//      peers fall back to the snapshot-wide median (0.205 here). Multiples are clamped to
//      [0.04, 0.85] so one outlier sector (bridges trade above 1x) cannot dominate the board.
//   2. Launch haircut. A launch is not a mature listing: multiply by 0.55. A protocol that has
//      run for years with no token has earned the market's trust, but a first listing still
//      prices below seasoned peers.
//   3. Growth. change_7d clamped to [-40, +80]%; multiplier = 1 + growth/100 * 0.6. A protocol
//      bleeding TVL is worth less than its stock of TVL suggests; a fast grower is worth more.
//   4. Maturity (log age). multiplier = 0.70 + 0.30 * ln(1+min(age,1095)) / ln(1+1095).
//      Age is days since DefiLlama first listed the protocol — how long it has run with no
//      token on record. Log, not linear: the jump from 30 to 300 days matters more than from
//      800 to 1095. Unknown age uses 365 days.
//   5. Breadth. multiplier = 1 + 0.03 * min(chains-1, 8): a protocol live on many chains has
//      more distribution surface than a single-chain one, capped at +24%.
//
//   implied = round(TVL x multiple x 0.55 x growthMult x maturityMult x breadthMult)
//
// The board ranks EVERY rankable pre-token protocol (197 here), not just the watchlist. A
// protocol is rankable when its record shows no token (mcap, gecko_id and symbol all null)
// AND it is not a wrapped, staked or bridged product of a token that already trades — the
// same exclusion the snapshot's watchlist rule applies (Bridge / Canonical Bridge / Liquid
// Staking / Liquid Restaking / Restaked BTC / Cross Chain Bridge / CEX categories, versioned
// pool names, names carrying the whole word wrapped/staked/staking, names beginning with an
// exchange's name). That is why WBTC, exchange bridges and staked-ETH wrappers never appear:
// their underlying token already trades, so there is no launch left to rank. Live-token
// protocols are set aside in their own view, priced by their market cap, never by the model.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  launch_haircut: number; growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number; unknown_age_days: number;
  multiple_floor: number; multiple_cap: number; min_peers: number; breadth_step: number; breadth_max_extra: number;
}
export const MODEL: ModelConstants = {
  launch_haircut: 0.55, growth_weight: 0.6, growth_floor: -40, growth_cap: 80,
  maturity_floor: 0.7, maturity_range: 0.3, maturity_days: 1095, unknown_age_days: 365,
  multiple_floor: 0.04, multiple_cap: 0.85, min_peers: 3, breadth_step: 0.03, breadth_max_extra: 8,
};
export const MODEL_VERSION = 'radar-2';
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null; token_status: 'pre-token';
  age_days: number | null; implied_value_usd: number; watchlist: boolean;
  model: {
    multiple: number; multiple_peers: number; multiple_source: string;
    growth_pct: number; growth_multiplier: number; maturity_multiplier: number;
    breadth_multiplier: number; launch_haircut: number; age_days: number | null;
  };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; implied_value_usd: number; watchlist: boolean;
  multiple: number; multiple_peers: number; growth_multiplier: number;
  maturity_multiplier: number; breadth_multiplier: number; farm_steps: string[];
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface CategoryMultiple { category: string; multiple: number; peers: number; source: string; }
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number;
  live_size: number; overall_multiple: number; multiples: CategoryMultiple[];
  rows: RadarRow[]; live: LiveRow[];
}
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median mcap/TVL per category among live-token protocols, plus the snapshot-wide median. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, { multiple: number; peers: number }>; overall: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(ratio);
    byCat.set(key, arr);
  }
  const overall = Math.min(model.multiple_cap, Math.max(model.multiple_floor, median(all)));
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [cat, ratios] of byCat) {
    if (ratios.length >= model.min_peers) {
      byCategory.set(cat, { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, median(ratios))), peers: ratios.length });
    }
  }
  return { byCategory, overall };
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Cross Chain Bridge', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A wrapped, staked or bridged product of a token that already trades — no launch left to rank. */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  return (p.category !== null && EXCLUDED_CATEGORIES.has(p.category))
    || VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name);
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

export function impliedValue(
  protocol: SnapshotProtocol, asOf: string, model: ModelConstants,
  multiples: { byCategory: Map<string, { multiple: number; peers: number }>; overall: number },
): { implied: number; multiple: number; peers: number; source: string; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = multiples.byCategory.get(protocol.category ?? 'Other');
  const multiple = peer ? peer.multiple : multiples.overall;
  const peers = peer ? peer.peers : 0;
  const source = peer ? `median of ${peers} live ${protocol.category ?? 'Other'} peers` : 'snapshot-wide median (fewer than 3 live peers in category)';
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (Math.log1p(Math.min(Math.max(ageForModel, 0), model.maturity_days)) / Math.log1p(model.maturity_days));
  const breadthMult = 1 + model.breadth_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * model.launch_haircut * growthMult * maturityMult * breadthMult));
  return { implied, multiple, peers, source, growthPct, growthMult, maturityMult, breadthMult, age };
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
/** Primary + secondary actions per category, so the plan fits what the protocol actually does. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return [
    `Supply $${capital} of USDC to ${n} on ${chain} as a lender and keep the position open`,
    `Borrow a small amount against the supply (under 40% of its value) and repay it within a week`];
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('amm')) return [
    `Provide $${capital} of liquidity to ${n}'s main pool on ${chain} and keep the position open`,
    `Swap $25 through the same pool once a week so the wallet shows trading as well as liquidity`];
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return [
    `Deposit $${capital} of USDC as margin on ${n} and open one small hedged position`,
    `Close and reopen a small position once a week, keeping total exposure under $${capital}`];
  if (c.includes('prediction')) return [
    `Fund $${capital} on ${n} and place one market position with a 2-week horizon`,
    `Place one more small position in a different market the following week`];
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('risk')) return [
    `Deposit $${capital} into a ${n} vault on ${chain} and keep the shares for the full hold`,
    `Deposit a second, smaller tranche ($25) into a different vault of the same protocol`];
  if (c.includes('stable')) return [
    `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it`,
    `Use the minted asset once in the protocol's own app, then return it to the position`];
  if (c.includes('rwa')) return [
    `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it`,
    `Reinvest the first yield payout back into the same asset instead of withdrawing it`];
  if (c.includes('insurance')) return [
    `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active`,
    `Renew or extend the cover once before it lapses so the wallet shows two policy periods`];
  if (c.includes('restak') || c.includes('staking')) return [
    `Stake $${capital} of the chain's staking asset through ${n} and keep the receipt token`,
    `Restake or delegate the receipt once more in a second validator or pool`];
  if (c.includes('bridge')) return [
    `Bridge $${capital} of USDC to ${chain} through ${n} and use the bridged funds in its app`,
    `Bridge a smaller amount back the following week so the wallet shows both directions`];
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open`,
    `Use the protocol's main feature once a week — a swap, a deposit or a vote — from the same wallet`];
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [primary, secondary] = actionsFor(p, capital, chain);
  const extra = p.chains.length > 1 ? ` Repeat the deposit on ${p.chains[1]} with $25 so the wallet is active on two chains.` : '';
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: `${primary}.`, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: `${secondary}.`, cost: 'about $2 of gas per action', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.${extra}`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Open the protocol's own points or rewards page once a week and record the points balance in a farm log`, cost: 'no fee to check', time: '5 minutes a week' },
    { text: `Before you withdraw, open the protocol's own page and claim only from the link it publishes; never pay a fee to claim`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it safely`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols.filter(isRankable).map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at, gecko_id: s.p.gecko_id, symbol: s.p.symbol,
    token_status: 'pre-token', age_days: s.age, implied_value_usd: s.implied, watchlist: watch.has(s.p.slug),
    model: {
      multiple: s.multiple, multiple_peers: s.peers, multiple_source: s.source,
      growth_pct: round4(s.growthPct), growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult), breadth_multiplier: round4(s.breadthMult),
      launch_haircut: model.launch_haircut, age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd, watchlist: row.watchlist,
    multiple: row.model.multiple, multiple_peers: row.model.multiple_peers,
    growth_multiplier: row.model.growth_multiplier, maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier, farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const multTable: CategoryMultiple[] = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: round4(v.multiple), peers: v.peers, source: `median of ${v.peers} live peers` }))
    .sort((a, b) => b.multiple - a.multiple);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, live_size: live.length,
    overall_multiple: round4(multiples.overall), multiples: multTable,
    rows: board.map(radarRow), live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
