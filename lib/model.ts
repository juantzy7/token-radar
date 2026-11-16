/*
The model prices tokenless protocols by looking at tokenized peers and their market-cap-to-TVL
multiples, first by category and then globally. A few recorded ratios run into the tens or
hundreds because those protocols' TVL does not carry their token's value, so extreme ratios are
pulled back to the snapshot's 95th percentile before medians are taken, and thin categories lean
harder on the global median. Each candidate then gets a bounded growth tilt from 7-day change and
a bounded age tilt from how long it has been listed. No protocol name is hardcoded anywhere in the
valuation logic; only snapshot fields drive the math.
*/

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  tokenless_years: number | null;
  multiple_used: number;
  on_watchlist: boolean;
}

export interface BoardStats {
  totalProtocols: number;
  preTokenCount: number;
  watchlistCount: number;
  boardCount: number;
  totalImpliedUsd: number;
  asOf: string;
}

export interface BoardResult {
  rows: BoardRow[];
  stats: BoardStats;
}

type StepTemplate = (protocol: SnapshotProtocol) => string;

const COMPARABLE_MIN_TVL = 5_000_000;
const SHRINKAGE_WEIGHT = 6;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCLUDED_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX_RE = /\s[vV]\d+(?:\.\d+)?$/;
const WRAPPED_WORD_RE = /\b(?:wrapped|staked|staking)\b/i;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const CATEGORY_NOTES: Record<string, string> = {
  Default: 'These protocols offer onchain financial or coordination tools that do not fit a narrower bucket.',
  Lending: 'Lending protocols let users supply assets, borrow against collateral, and manage utilization-driven rates.',
  Dexs: 'Dexs let users swap tokens and provide liquidity through pools or order-routing contracts.',
  Yield: 'Yield protocols automate deposits into strategies, vaults, or loops designed to manage returns.',
  CDP: 'CDP protocols let users lock collateral and mint or manage debt against that position.',
  Derivatives: 'Derivatives protocols create onchain exposure to synthetic, leveraged, or structured payoff products.',
  Perps: 'Perps protocols offer perpetual futures markets with collateral, funding, and active position management.',
  RWA: 'RWA protocols connect onchain capital to tokenized real-world credit, bills, or other offchain assets.',
  'Risk Curators': 'Risk curator protocols organize vault, market, or collateral parameters for delegated credit decisions.',
  'Onchain Capital Allocator': 'Onchain capital allocators route funds across venues, managers, or vaults under a mandate.',
  'Collateral Markets': 'Collateral market protocols list specialized collateral and credit pairs beyond plain money markets.',
  Options: 'Options protocols let users write, buy, or structure option positions with defined expiries and strikes.',
  Launchpad: 'Launchpads handle token sale access, commitments, allocations, and post-sale claiming workflows.',
  Services: 'Services protocols provide infrastructure, middleware, or workflow layers that support onchain users.',
  Gaming: 'Gaming protocols tie wallets to game loops, item economies, quests, or tournament-style onchain actions.',
  'NFT Lending': 'NFT lending protocols use NFTs as collateral or inventory in loans, liquidity, or refinance flows.',
  Chain: 'Chain protocols are base networks where activity often means bridging in, using apps, and staying transacting.',
  'Cross Chain': 'Cross-chain protocols move assets or messages between networks and reward repeated routed activity.',
};

function stepTemplate(action: string, cost: string, timing: string, includeHonestyNote = false): StepTemplate {
  return (protocol) => {
    const chain = primaryChain(protocol);
    const capital = capitalBand(protocol.tvl_usd);
    let text = `On ${chain}, use ${protocol.name} to ${action}. Keep the workflow inside the ${capital} working-capital band, budget ${cost}, and expect ${timing}.`;
    if (includeHonestyNote) {
      text += ` ${protocol.name} records no token in this snapshot, and a launch is not guaranteed.`;
    }
    return validateStep(text);
  };
}

const PLAYBOOKS: Record<string, StepTemplate[]> = {
  Default: [
    stepTemplate('open the app, read the docs, connect a fresh wallet, and inspect the main screens before signing anything', 'gas only, usually $3 to $20', 'about 10 to 15 minutes once'),
    stepTemplate('fund the wallet with a small test amount, try the primary workflow with stable assets, and save the transaction links in notes', 'part of the band plus $3 to $25 in gas', 'about 15 to 25 minutes once'),
    stepTemplate('return once or twice a week to repeat the core flow, compare before-and-after balances, and keep usage patterns consistent', 'gas only or up to $25 per visit', '10 to 20 minutes each week'),
    stepTemplate('test a second supported path such as another pool, vault, market, or collateral type so your activity is not one-dimensional', 'an extra slice of the band plus $3 to $25 in gas', '15 to 30 minutes once'),
    stepTemplate('join the official community, watch product updates, and ask one operations question so you understand how the team expects users to behave', 'free or gas only', '10 minutes each week'),
    stepTemplate('check balances, export wallet activity, set alerts for docs changes, and unwind positions if risk, fees, or liquidity turn against you', 'gas only to monitor, more only if exiting', '15 minutes weekly and as needed to close', true),
  ],
  Lending: [
    stepTemplate('open the borrow markets, read collateral factors, connect a wallet, and review which stablecoins and majors are active', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('deposit a conservative amount of a liquid asset, enable it as collateral if the UI requires it, and borrow only a small stablecoin test amount', 'roughly 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('revisit twice a week to repay a little, top up collateral when needed, and watch utilization or borrow APR changes', 'gas only or $5 to $25 per visit', '10 to 20 minutes twice a week'),
    stepTemplate('open a second market on ${protocol.name}'.replace('${protocol.name}', '') , 'gas only', '10 minutes')
  ],
  Dexs: [
    stepTemplate('open the swap and pool pages, connect a wallet, and map which spot pairs on the venue matter most on first review', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('swap a small amount between two liquid assets, then add balanced liquidity to a simple major or stable pair', 'about 30% to 50% of the band plus $5 to $30 in gas', '15 to 25 minutes once'),
    stepTemplate('return every few days to rebalance the pool position, claim accrued fees if exposed in the UI, and note volume changes', 'gas only or $5 to $25 each visit', '10 to 20 minutes two or three times a week'),
    stepTemplate('test a second route such as concentrated liquidity, a long-tail pair, or the aggregator path so usage spans more than one screen', 'an extra 10% to 20% of the band plus $5 to $30 in gas', '15 to 30 minutes once'),
    stepTemplate('follow governance or pool-launch threads, vote when available, and log which incentives or parameters changed for active pools', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('track pool health, impermanent loss, and router behavior, then pull liquidity or swap back out when the setup no longer fits your risk', 'gas only to monitor, more only if exiting', '15 minutes weekly and as needed to close', true),
  ],
  Yield: [
    stepTemplate('open the vault list, read strategy descriptions, connect a wallet, and compare deposit, withdrawal, and harvest mechanics', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('deposit a single conservative asset into one core vault and record the share price or receipt token count right after entry', 'about 25% to 50% of the band plus $5 to $25 in gas', '15 to 20 minutes once'),
    stepTemplate('check the vault once or twice a week, harvest or compound only if the flow is user-triggered, and compare net balance changes', 'gas only or $5 to $20 per visit', '10 to 15 minutes each week'),
    stepTemplate('spread a smaller amount to a second strategy with a different risk profile so you learn how the product handles varied positions', 'an extra 10% to 20% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('read strategy updates, risk posts, or community reports and ask how the team handles vault pauses, migrations, and parameter shifts', 'free or gas only', '10 minutes weekly'),
    stepTemplate('watch share price, withdrawal queues, and strategy notices, then exit cleanly if performance, risk, or liquidity assumptions change', 'gas only to monitor, more only if withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  CDP: [
    stepTemplate('open the vault interface, review collateral ratios and liquidation rules, connect a wallet, and note which debt asset the system mints', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('lock a modest collateral amount, mint only a small debt balance well inside the safe zone, and save the target health factor', 'about 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('check the vault twice a week, repay a little when convenient, and top up collateral if price moves narrow the safety buffer', 'gas only or $5 to $25 per visit', '10 to 20 minutes twice a week'),
    stepTemplate('open a second vault type or try the repayment and redraw flow so you exercise more than the first mint transaction', 'an extra 10% to 20% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('follow governance or risk parameter updates and read any liquidation-engine notes so you understand how the system changes over time', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('monitor collateral ratio, debt balance, and shutdown procedures, then close the vault methodically before stress forces rushed actions', 'gas only to monitor, more only if repaying and withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  Derivatives: [
    stepTemplate('open the product list, connect a wallet, and read how the venue defines margin, expiry, payoff, or settlement before any trade', 'gas only, usually $3 to $20', '10 to 20 minutes once'),
    stepTemplate('post a small stable collateral amount and open one simple low-size directional or structured position to learn the ticket flow', 'about 10% to 25% of the band plus $5 to $30 in gas and fees', '15 to 25 minutes once'),
    stepTemplate('return several times a week to inspect mark prices, funding or carry, and close tiny pieces so you practice active management', 'gas only plus trading fees, often $5 to $25 per visit', '10 to 20 minutes two or three times a week'),
    stepTemplate('try a second instrument or expiry so your account touches more than one payoff shape and you learn how the protocol reports risk', 'an extra 10% to 20% of the band plus fees and gas', '15 to 30 minutes once'),
    stepTemplate('watch governance, risk, or market-maker updates and note any listing or margin changes that affect how positions are managed', 'free or gas only', '10 minutes weekly'),
    stepTemplate('maintain a close log of open positions, set clear stop levels off-platform, and flatten exposure quickly if liquidity or controls worsen', 'gas only to monitor, plus trading fees if exiting', '15 minutes weekly and as needed to close', true),
  ],
  Perps: [
    stepTemplate('open the trading terminal, connect a wallet, and read margin mode, liquidation thresholds, and funding details before trading', 'gas only, usually $3 to $20', '10 to 20 minutes once'),
    stepTemplate('deposit stable collateral and open one very small perp position with conservative leverage so the workflow is familiar without oversized risk', 'about 10% to 20% of the band plus $5 to $30 in gas and fees', '15 to 25 minutes once'),
    stepTemplate('check funding, PnL, and collateral every day or two, then reduce or add tiny size only when you can still describe the risk clearly', 'gas only plus trading fees, often $5 to $25 per visit', '10 to 15 minutes every one or two days'),
    stepTemplate('test one more market or the limit-order workflow so activity spans more than a single pair and one market order', 'an extra 5% to 15% of the band plus gas and fees', '15 to 20 minutes once'),
    stepTemplate('follow risk announcements, insurance fund notes, or governance settings that affect leverage caps and market availability', 'free or gas only', '10 minutes weekly'),
    stepTemplate('keep liquidation alerts on, export fills, and close positions if funding, spreads, or venue risk stop matching your plan', 'gas only to monitor, plus trading fees if exiting', '15 minutes weekly and as needed to close', true),
  ],
  RWA: [
    stepTemplate('open the market pages, connect a wallet, and read eligibility, redemption, and settlement details for the underlying asset exposure', 'gas only, usually $3 to $20', '10 to 20 minutes once'),
    stepTemplate('buy or deposit a modest amount of the simplest listed product, preferably a short-duration or cash-like exposure when available', 'about 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('check position reporting weekly, compare accrued value against published terms, and keep records for any offchain attestations or notices', 'gas only or $5 to $15 per visit', '10 to 15 minutes weekly'),
    stepTemplate('test a second eligible product or redemption path so you understand both entry and exit mechanics rather than only the initial buy', 'an extra 10% to 20% of the band plus $5 to $25 in gas', '15 to 30 minutes once'),
    stepTemplate('join community or governance channels and read issuer or structure updates, especially around collateral, custody, and redemptions', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('monitor issuer notices, redemption windows, and wallet receipts, then unwind early if terms, access, or transparency stop fitting your needs', 'gas only to monitor, more only if exiting', '15 minutes weekly and as needed to close', true),
  ],
  'Risk Curators': [
    stepTemplate('open the curator or vault pages, connect a wallet, and read how allocations, caps, and permissions are delegated on the platform', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('deposit a small amount into one curator-managed vault or market sleeve with clear published rules and active reporting', 'about 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('return weekly to review allocation changes, utilization, and any rebalances so you understand what the curator actually does with capital', 'gas only or $5 to $15 per visit', '10 to 15 minutes weekly'),
    stepTemplate('split a smaller amount across a second curator or risk profile to compare management style and parameter discipline', 'an extra 10% to 20% of the band plus $5 to $20 in gas', '15 to 25 minutes once'),
    stepTemplate('read curator comments, governance threads, and risk framework updates, then ask one question about mandate changes or loss handling', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('track vault moves, publish your own notes, and exit if the curator changes scope, reporting quality, or risk posture beyond your comfort', 'gas only to monitor, more only if withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  'Onchain Capital Allocator': [
    stepTemplate('open the allocation dashboard, connect a wallet, and read how the strategy routes capital across managers, venues, or vaults', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('deposit into one broad mandate with clear reporting so you can see how the allocator moves capital after entry', 'about 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('check the position weekly, compare current allocations to the last report, and note when the mandate rotates between venues', 'gas only or $5 to $15 per visit', '10 to 15 minutes weekly'),
    stepTemplate('allocate a smaller amount to a second strategy or risk bucket so you observe how different mandates are implemented', 'an extra 10% to 20% of the band plus $5 to $20 in gas', '15 to 25 minutes once'),
    stepTemplate('follow manager updates, governance posts, or public strategy reviews and ask how rebalancing and risk caps are decided', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('keep a ledger of entries, exits, and visible reallocations, and withdraw if transparency or mandate discipline stops being adequate', 'gas only to monitor, more only if withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  'Collateral Markets': [
    stepTemplate('open the market list, connect a wallet, and read collateral rules, haircuts, and supported asset types before entering', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('post a conservative collateral amount in one clear market and borrow or lend a small test amount to learn the liquidation workflow', 'about 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('check market health twice a week, watch collateral ratios, and repay or rebalance in small increments when terms move', 'gas only or $5 to $20 per visit', '10 to 20 minutes twice a week'),
    stepTemplate('use a second collateral type or a second market so your activity covers more than the easiest supported asset', 'an extra 10% to 20% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
    stepTemplate('read risk parameter changes and any governance notes around newly listed collateral or revised caps', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('watch oracle behavior, collateral health, and unwind paths, then close methodically before volatile moves force quick decisions', 'gas only to monitor, more only if repaying and withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  Options: [
    stepTemplate('open the option chain, connect a wallet, and study strikes, expiries, and settlement rules before taking any exposure', 'gas only, usually $3 to $20', '10 to 20 minutes once'),
    stepTemplate('fund the account and buy or write one very small simple option position so you learn quoting, collateral, and exercise flow', 'about 10% to 20% of the band plus $5 to $30 in gas and fees', '15 to 25 minutes once'),
    stepTemplate('check implied pricing and time decay several times a week, and trim or close small pieces so management becomes routine', 'gas only plus trading fees, often $5 to $25 per visit', '10 to 20 minutes two or three times a week'),
    stepTemplate('test a second strike or expiry and compare how margin or premium changes across the surface rather than staying in one contract', 'an extra 5% to 15% of the band plus gas and fees', '15 to 25 minutes once'),
    stepTemplate('follow governance, market-maker, or risk updates and note when new expiries or product rules are added or removed', 'free or gas only', '10 minutes weekly'),
    stepTemplate('track expiry dates, collateral locks, and settlement steps carefully, then close or let positions expire only with a documented plan', 'gas only to monitor, plus trading fees if exiting', '15 minutes weekly and as needed to close', true),
  ],
  Launchpad: [
    stepTemplate('open the sale dashboard, connect a wallet, and read eligibility, commitment rules, and claim timing before committing funds', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('complete any profile or wallet setup, then make one small commitment into a live or practice sale if the interface allows it', 'about 10% to 20% of the band plus $5 to $25 in gas', '15 to 20 minutes once'),
    stepTemplate('check the page weekly for allocation updates, vesting or claim windows, and any tasks tied to participation records', 'gas only or $5 to $15 per visit', '10 to 15 minutes weekly'),
    stepTemplate('try a second flow such as staking, refunding, or updating sale preferences so activity is broader than one commitment transaction', 'an extra 5% to 15% of the band plus $5 to $20 in gas', '15 to 25 minutes once'),
    stepTemplate('follow community channels and governance or policy posts to understand how new sales are screened and operated', 'free or gas only', '10 minutes weekly'),
    stepTemplate('track claim deadlines, vesting schedules, and wallet receipts, and cancel or unwind if the process becomes opaque or illiquid', 'gas only to monitor, more only if claiming or exiting', '15 minutes weekly and as needed to close', true),
  ],
  Services: [
    stepTemplate('open the interface, connect a wallet, and map the service workflow end to end so you know which actions are actually user-facing', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('run one small live job such as registering, routing, automating, or subscribing to the core service with a low-stakes input', 'about 10% to 20% of the band or the minimum spend plus $5 to $20 in gas', '15 to 20 minutes once'),
    stepTemplate('return weekly to repeat the service task, verify outputs, and keep receipts or transaction hashes for each run', 'gas only or the stated service fee, often $5 to $20 per visit', '10 to 15 minutes weekly'),
    stepTemplate('use one adjacent module or advanced setting so your account touches more than a single button path', 'an extra 5% to 10% of the band plus any listed fee and gas', '15 to 20 minutes once'),
    stepTemplate('join support or community channels, read release notes, and ask one question about reliability, limits, or failure handling', 'free or gas only', '10 minutes weekly'),
    stepTemplate('monitor task history, revoke unused approvals, and stop using the service if output quality or trust assumptions degrade', 'gas only to monitor, more only if revoking or withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  Gaming: [
    stepTemplate('open the game client or quest hub, connect a fresh wallet, and complete the onboarding screens before spending on any item', 'gas only, usually $3 to $20', '10 to 20 minutes once'),
    stepTemplate('fund the wallet and buy, mint, or equip the cheapest viable starter asset needed for the first real gameplay loop', 'about 10% to 20% of the band plus $5 to $25 in gas or in-game fees', '15 to 25 minutes once'),
    stepTemplate('play the core loop a few times each week, claim any visible progress rewards, and keep a short log of what actions the game recognizes', 'gas only or small in-game fees, often $5 to $20 per session', '20 to 40 minutes two or three times a week'),
    stepTemplate('try a second loop such as crafting, trading, matchmaking, or guild actions so activity is broader than onboarding alone', 'an extra 5% to 15% of the band plus gas or game fees', '20 to 40 minutes once'),
    stepTemplate('join the official community, read patch notes, and participate in one event, vote, or feedback thread if the game supports it', 'free or gas only', '10 to 20 minutes weekly'),
    stepTemplate('watch inventory value, withdrawal routes, and game-rule changes, then exit items or positions if the loop stops being worth the attention', 'gas only to monitor, more only if selling or withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  'NFT Lending': [
    stepTemplate('open the loan market, connect a wallet, and read supported collections, LTV rules, and refinance mechanics before acting', 'gas only, usually $3 to $20', '10 to 20 minutes once'),
    stepTemplate('use one lower-value NFT or a small lending offer to test listing, borrowing, or offer acceptance without stretching size', 'about 10% to 25% of the band plus $5 to $30 in gas', '15 to 25 minutes once'),
    stepTemplate('check loan health, bids, and refinance options a few times a week so you do not miss time-sensitive changes', 'gas only or $5 to $20 per visit', '10 to 20 minutes two or three times a week'),
    stepTemplate('try the opposite side of the market, such as lending after borrowing or refinancing after an initial loan, to deepen product coverage', 'an extra 5% to 15% of the band plus $5 to $25 in gas', '15 to 30 minutes once'),
    stepTemplate('follow community and risk updates on supported collections, oracle methods, and default handling', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('track due dates, liquidation risk, and wallet approvals, then close loans or cancel offers before urgency starts setting the pace', 'gas only to monitor, more only if repaying or withdrawing', '15 minutes weekly and as needed to close', true),
  ],
  Chain: [
    stepTemplate('bridge a small amount onto the network, connect a wallet to a block explorer and one native app, and confirm gas handling works', 'about 5% to 10% of the band plus $5 to $25 in bridge and gas costs', '15 to 25 minutes once'),
    stepTemplate('run one simple native action such as a swap, lend, or stake on the chain so the wallet shows real onchain usage immediately', 'another 10% to 20% of the band plus $5 to $20 in gas', '15 to 25 minutes once'),
    stepTemplate('make several small transactions each week across at least two apps so the wallet keeps a steady activity pattern on the chain', 'gas only or up to $20 per visit', '15 to 30 minutes two or three times a week'),
    stepTemplate('try a second wallet action such as deploying a simple contract, minting an NFT, or using a new app vertical if the chain supports it', 'an extra 5% to 15% of the band plus gas', '20 to 30 minutes once'),
    stepTemplate('follow ecosystem calls, governance, or validator news and note which apps or infra teams are highlighted as core network activity', 'free or gas only', '10 to 15 minutes weekly'),
    stepTemplate('track bridge routes, wallet balances, and network status, then bridge back out or consolidate funds if usage quality drops', 'gas only to monitor, more only if bridging out', '15 minutes weekly and as needed to close', true),
  ],
  'Cross Chain': [
    stepTemplate('open the bridge or router UI, connect a wallet, and check supported source and destination networks before moving anything', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
    stepTemplate('bridge one small transfer between two major networks and confirm arrival, fees, and explorer links before sizing up at all', 'about 10% to 20% of the band plus $5 to $30 in bridge and gas costs', '15 to 25 minutes once'),
    stepTemplate('repeat modest transfers weekly, alternating routes or destinations so the wallet shows consistent cross-chain usage patterns', 'gas plus route fees, often $5 to $25 per visit', '10 to 20 minutes weekly'),
    stepTemplate('test a second feature such as swaps, messaging, or a faster route if the protocol offers it, rather than only one plain bridge path', 'an extra 5% to 15% of the band plus route fees and gas', '15 to 25 minutes once'),
    stepTemplate('follow support and community channels for outage notices, listed routes, and liquidity changes before each larger transfer', 'free or gas only', '10 minutes weekly'),
    stepTemplate('keep screenshots and hashes for every route, watch pending transfers closely, and pull back to simpler paths if reliability slips', 'gas only to monitor, more only if rerouting or exiting', '15 minutes weekly and as needed to close', true),
  ],
};

PLAYBOOKS.Lending = [
  stepTemplate('open the borrow markets, read collateral factors, connect a wallet, and review which stablecoins and majors are active', 'gas only, usually $3 to $20', '10 to 15 minutes once'),
  stepTemplate('deposit a conservative amount of a liquid asset, enable it as collateral if the UI requires it, and borrow only a small stablecoin test amount', 'roughly 20% to 40% of the band plus $5 to $25 in gas', '15 to 25 minutes once'),
  stepTemplate('revisit twice a week to repay a little, top up collateral when needed, and watch utilization or borrow APR changes', 'gas only or $5 to $25 per visit', '10 to 20 minutes twice a week'),
  stepTemplate('open a second market or add a second supplied asset so your wallet history covers more than one borrow loop', 'an extra 10% to 20% of the band plus $5 to $20 in gas', '15 to 25 minutes once'),
  stepTemplate('read governance or risk updates and ask one question about listed collateral, caps, or liquidation rules when the community is active', 'free or gas only', '10 to 15 minutes weekly'),
  stepTemplate('track health factor, due exposures, and exit routes, then unwind the position well before volatility forces rushed changes', 'gas only to monitor, more only if repaying and withdrawing', '15 minutes weekly and as needed to close', true),
];

function validateStep(text: string): string {
  if (text.length < 60 || text.length > 600) {
    throw new Error(`farm step length out of bounds: ${text.length}`);
  }
  return text;
}

function hasNoToken(protocol: SnapshotProtocol): boolean {
  return protocol.gecko_id === null && protocol.symbol === null;
}

function primaryChain(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0] : 'its main chain';
}

function capitalBand(tvlUsd: number): string {
  if (tvlUsd < 25_000_000) return '$100 to $500';
  if (tvlUsd < 100_000_000) return '$500 to $2,500';
  if (tvlUsd < 500_000_000) return '$2,500 to $10,000';
  return '$10,000 to $50,000';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function nearestRankPercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.ceil(percentile * sorted.length) - 1;
  return sorted[clamp(index, 0, sorted.length - 1)];
}

function parseYmd(value: string): { year: number; month: number; day: number } {
  const match = YMD_RE.exec(value);
  if (match === null) throw new Error(`invalid date: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function daysFromCivil(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  m = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * m + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function diffDays(fromYmd: string, toYmd: string): number {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  const fromDays = daysFromCivil(from.year, from.month, from.day);
  const toDays = daysFromCivil(to.year, to.month, to.day);
  return toDays - fromDays;
}

function yearsListed(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const days = Math.max(0, diffDays(listedAt, asOf));
  return days / 365.25;
}

function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const clampedChange = clamp(change7d, -30, 30);
  return clamp(1 + clampedChange / 100, 0.7, 1.45);
}

function ageFactor(listedAt: string | null, asOf: string): number {
  const years = yearsListed(listedAt, asOf);
  if (years === null) return 1;
  return Math.min(1.35, 1 + 0.08 * Math.log(1 + years));
}

function isVersionedName(name: string): boolean {
  return VERSION_SUFFIX_RE.test(name);
}

function hasWrappedWord(name: string): boolean {
  return WRAPPED_WORD_RE.test(name);
}

function hasExcludedPrefix(name: string): boolean {
  const lowered = name.toLowerCase();
  for (const prefix of EXCLUDED_PREFIXES) {
    if (lowered.startsWith(prefix.toLowerCase())) return true;
  }
  return false;
}

function isCandidate(protocol: SnapshotProtocol): boolean {
  return (
    hasNoToken(protocol) &&
    !EXCLUDED_CATEGORIES.has(protocol.category ?? '') &&
    !isVersionedName(protocol.name) &&
    !hasWrappedWord(protocol.name) &&
    !hasExcludedPrefix(protocol.name)
  );
}

function buildComparableStats(protocols: SnapshotProtocol[]): {
  globalMedian: number;
  categoryStats: Map<string, { median: number; count: number }>;
  ratioCap: number;
} {
  const comparableRatios: Array<{ category: string | null; ratio: number }> = [];

  for (const protocol of protocols) {
    if (protocol.tvl_usd < COMPARABLE_MIN_TVL) continue;
    if (protocol.mcap_usd === null || protocol.mcap_usd <= 0) continue;
    comparableRatios.push({ category: protocol.category, ratio: protocol.mcap_usd / protocol.tvl_usd });
  }

  const ratioCap = nearestRankPercentile(
    comparableRatios.map((comparable) => comparable.ratio),
    0.95,
  );

  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const comparable of comparableRatios) {
    const clampedRatio = Math.min(comparable.ratio, ratioCap);
    ratios.push(clampedRatio);
    if (comparable.category !== null) {
      const current = byCategory.get(comparable.category) ?? [];
      current.push(clampedRatio);
      byCategory.set(comparable.category, current);
    }
  }

  const categoryStats = new Map<string, { median: number; count: number }>();
  for (const [category, values] of byCategory.entries()) {
    categoryStats.set(category, { median: median(values), count: values.length });
  }

  return {
    globalMedian: median(ratios),
    categoryStats,
    ratioCap,
  };
}

function workingMultiple(category: string | null, stats: { globalMedian: number; categoryStats: Map<string, { median: number; count: number }>; ratioCap: number }): number {
  if (category === null) return Math.min(stats.globalMedian, stats.ratioCap);
  const categoryStat = stats.categoryStats.get(category);
  if (categoryStat === undefined) return Math.min(stats.globalMedian, stats.ratioCap);
  const shrunkMedian = (categoryStat.median * categoryStat.count + stats.globalMedian * SHRINKAGE_WEIGHT) / (categoryStat.count + SHRINKAGE_WEIGHT);
  return Math.min(shrunkMedian, stats.ratioCap);
}

function impliedValueUsd(protocol: SnapshotProtocol, asOf: string, multiple: number): number {
  const value = protocol.tvl_usd * multiple * growthFactor(protocol.change_7d) * ageFactor(protocol.listed_at, asOf);
  return Math.max(1, Math.round(value));
}

function playbookFor(category: string | null): StepTemplate[] {
  const playbook = category === null ? PLAYBOOKS.Default : PLAYBOOKS[category] ?? PLAYBOOKS.Default;
  if (playbook.length !== 6) throw new Error(`playbook must have 6 steps for ${category ?? 'Default'}`);
  return playbook;
}

function renderFarmSteps(protocol: SnapshotProtocol): string[] {
  return playbookFor(protocol.category).map((template) => template(protocol));
}

function assertWatchlistCovered(rows: BoardRow[], watchlist: string[]): void {
  const rowSlugs = new Set(rows.map((row) => row.slug));
  for (const slug of watchlist) {
    if (!rowSlugs.has(slug)) {
      throw new Error(`watchlist slug missing from board: ${slug}`);
    }
  }
}

export function buildBoard(snapshot: Snapshot): BoardResult {
  const comparableStats = buildComparableStats(snapshot.protocols);
  const watchlistSet = new Set(snapshot.watchlist);
  const rows: BoardRow[] = snapshot.protocols
    .filter(isCandidate)
    .map((protocol) => {
      const multiple = workingMultiple(protocol.category, comparableStats);
      const years = yearsListed(protocol.listed_at, snapshot.as_of);
      return {
        slug: protocol.slug,
        name: protocol.name,
        rank: 0,
        implied_value_usd: impliedValueUsd(protocol, snapshot.as_of, multiple),
        farm_steps: renderFarmSteps(protocol),
        category: protocol.category ?? 'Uncategorized',
        chains: protocol.chains,
        tvl_usd: protocol.tvl_usd,
        change_7d: protocol.change_7d,
        listed_at: protocol.listed_at,
        tokenless_years: years === null ? null : roundTo(years, 1),
        multiple_used: roundTo(multiple, 4),
        on_watchlist: watchlistSet.has(protocol.slug),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));

  for (let index = 0; index < rows.length; index += 1) {
    rows[index].rank = index + 1;
  }

  assertWatchlistCovered(rows, snapshot.watchlist);

  let totalImpliedUsd = 0;
  for (const row of rows) totalImpliedUsd += row.implied_value_usd;

  return {
    rows,
    stats: {
      totalProtocols: snapshot.protocols.length,
      preTokenCount: snapshot.protocols.filter(hasNoToken).length,
      watchlistCount: snapshot.watchlist.length,
      boardCount: rows.length,
      totalImpliedUsd,
      asOf: snapshot.as_of,
    },
  };
}
