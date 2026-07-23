import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeProperties,
	INodePropertyOptions,
	IPollFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const BINABLE_BASE_URL = 'https://binable.app';

/** The twelve fixed waste-type keys returned by POST /api/fetch. */
export const WASTE_TYPE_KEYS = [
	'residualWaste',
	'residualWasteLessFrequent',
	'residualWasteContainer',
	'residualWasteContainerLessFrequent',
	'bio',
	'paper',
	'reusableMaterials',
	'christmasTree',
	'toxic',
	'diaper',
	'hedgeTreeTrimming',
	'fleaMarket',
] as const;

/**
 * Default German labels — used only as a fallback for the fraction dropdown
 * when no address is entered yet or the live lookup fails. At runtime the real,
 * provider-specific labels come from the response `typeMap`.
 */
export const DEFAULT_WASTE_TYPE_LABELS: Record<string, string> = {
	residualWaste: 'Restmüll',
	residualWasteLessFrequent: 'Restmüll (großer Intervall)',
	residualWasteContainer: 'Restmüll (Container)',
	residualWasteContainerLessFrequent: 'Restmüll (Container / großer Intervall)',
	bio: 'Biomüll',
	paper: 'Papiermüll',
	reusableMaterials: 'Wertstoff',
	christmasTree: 'Weihnachtsbäume',
	toxic: 'Schadstoffe',
	diaper: 'Windeln',
	hedgeTreeTrimming: 'Heckenschnitt',
	fleaMarket: 'Trödelmarkt',
};

export interface IBinableAddress {
	street: string;
	houseNumber: string;
	zip: string;
	city: string;
	country: string;
}

/** The five address fields, shared verbatim across every Binable node. */
export const ADDRESS_PROPERTIES: INodeProperties[] = [
	{
		displayName: 'Street',
		name: 'street',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'Musterstraße',
		description: 'Street name of the address to look up',
	},
	{
		displayName: 'House Number',
		name: 'houseNumber',
		type: 'string',
		default: '',
		placeholder: '1a',
		description: 'House number (may include a letter, e.g. "1a")',
	},
	{
		displayName: 'ZIP Code',
		name: 'zip',
		type: 'string',
		default: '',
		required: true,
		placeholder: '12345',
		description: 'Postal code of the address',
	},
	{
		displayName: 'City',
		name: 'city',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'Musterstadt',
		description: 'City of the address',
	},
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: 'DE',
		description: 'ISO 3166-1 alpha-2 country code (e.g. DE, AT, NL)',
	},
];

interface IWasteType {
	dates?: string[];
	next?: string | null;
	nextDays?: string | null;
	last?: string | null;
}

export interface IFetchResult extends IDataObject {
	typeMap?: Record<string, string>;
	empty?: boolean;
	address?: IBinableAddress;
	provider?: { name?: string; uri?: string };
}

export interface ICollectionEvent extends IDataObject {
	wasteType: string;
	wasteKey: string;
	date: string;
	daysUntil: number;
	provider: string | null;
}

type BinableContext =
	IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions | IHookFunctions | IWebhookFunctions;

/**
 * Reads the (optional) binable API key from the `binableApi` credential.
 * Returns `undefined` when no credential is configured — read/poll operations
 * are allowed to run anonymously. Kept separate from {@link binableApiRequest}
 * so the request function never mixes credential retrieval with a raw
 * `httpRequest` call (see the `no-http-request-with-manual-auth` lint rule).
 */
async function hasBinableCredential(this: BinableContext): Promise<boolean> {
	try {
		const credentials = await this.getCredentials('binableApi');
		return ((credentials?.apiKey as string) ?? '').trim() !== '';
	} catch {
		// No credential configured — fine for anonymous read/poll requests.
		return false;
	}
}

/**
 * Performs an authenticated (or anonymous) request against the binable API.
 * The `binableApi` credential is optional on read/poll nodes: if it is present
 * n8n injects the "Authorization: ApiKey <key>" header via the credential's
 * `authenticate` block (using `httpRequestWithAuthentication`), otherwise the
 * request is sent anonymously.
 * Pass `requireAuth = true` (webhook create/delete) to fail fast when missing.
 */
export async function binableApiRequest(
	this: BinableContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	requireAuth = false,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BINABLE_BASE_URL}${endpoint}`,
		headers: {
			Accept: 'application/json',
		},
		json: true,
	};

	if (body !== undefined) {
		options.body = body;
	}
	if (qs !== undefined && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	const authenticated = await hasBinableCredential.call(this);

	if (!authenticated && requireAuth) {
		throw new NodeApiError(this.getNode(), {
			message: 'A Binable API credential is required for this operation.',
			description:
				'Webhook subscriptions can only be created or removed with an API key. Add a "Binable API" credential to this node.',
		});
	}

	try {
		if (authenticated) {
			// Delegate auth to n8n: the credential's `authenticate` block adds the
			// "Authorization: ApiKey <key>" header, and future improvements like
			// token refresh / audit logging apply automatically.
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'binableApi',
				options,
			)) as IDataObject;
		}
		// Anonymous path: read/poll operations work without a key.
		return (await this.helpers.httpRequest(options)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** Fetches the full collection schedule for an address via POST /api/fetch. */
export async function fetchCollection(
	this: BinableContext,
	address: IBinableAddress,
): Promise<IFetchResult> {
	const body: IDataObject = { ...address };
	return (await binableApiRequest.call(this, 'POST', '/api/fetch', body)) as IFetchResult;
}

/** Reads the five address parameters. `itemIndex` is only used in execute() contexts. */
export function getAddressParameters(ctx: BinableContext, itemIndex?: number): IBinableAddress {
	const read = (name: string): string => {
		const value =
			itemIndex === undefined
				? // Trigger/hook/webhook/poll contexts: no item index.
					(ctx as ILoadOptionsFunctions).getNodeParameter(name, '')
				: (ctx as IExecuteFunctions).getNodeParameter(name, itemIndex, '');
		return String(value ?? '').trim();
	};

	return {
		street: read('street'),
		houseNumber: read('houseNumber'),
		zip: read('zip'),
		city: read('city'),
		country: read('country') || 'DE',
	};
}

/** Today as YYYY-MM-DD in the workflow's timezone (falls back to UTC). */
export function todayInTimezone(ctx: BinableContext): string {
	let timeZone = 'UTC';
	const getTz = (ctx as IExecuteFunctions).getTimezone;
	if (typeof getTz === 'function') {
		try {
			timeZone = getTz.call(ctx) || 'UTC';
		} catch {
			timeZone = 'UTC';
		}
	}
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date());
}

/** Whole-day difference between two YYYY-MM-DD strings (`date - reference`). */
export function daysBetween(date: string, reference: string): number {
	const a = Date.parse(`${date}T00:00:00Z`);
	const b = Date.parse(`${reference}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
	return Math.round((a - b) / 86_400_000);
}

/**
 * Flattens a fetch result into one event per (waste type, date), sorted by date.
 * Past dates are dropped unless `includePast` is set.
 */
export function buildCollectionEvents(
	ctx: BinableContext,
	result: IFetchResult,
	includePast = false,
): ICollectionEvent[] {
	const today = todayInTimezone(ctx);
	const typeMap = result.typeMap ?? {};
	const keys = Object.keys(typeMap).length > 0 ? Object.keys(typeMap) : [...WASTE_TYPE_KEYS];
	const providerName = result.provider?.name ?? null;

	const events: ICollectionEvent[] = [];
	for (const key of keys) {
		const label = typeMap[key] ?? DEFAULT_WASTE_TYPE_LABELS[key] ?? key;
		const wasteType = result[key] as IWasteType | undefined;
		const dates = Array.isArray(wasteType?.dates) ? (wasteType!.dates as string[]) : [];
		for (const date of dates) {
			const daysUntil = daysBetween(date, today);
			if (!includePast && daysUntil < 0) continue;
			events.push({ wasteType: label, wasteKey: key, date, daysUntil, provider: providerName });
		}
	}

	events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return events;
}

/** Filters events by the selected fraction labels (empty selection = keep all). */
export function filterByFractions(
	events: ICollectionEvent[],
	fractions: string[],
): ICollectionEvent[] {
	if (!fractions || fractions.length === 0) return events;
	const set = new Set(fractions);
	return events.filter((event) => set.has(event.wasteType));
}

/** Builds the subscribable iCal feed URL for an address. */
export function buildIcalFeedUrl(address: IBinableAddress): string {
	const params = new URLSearchParams({
		street: address.street,
		houseNumber: address.houseNumber,
		zip: address.zip,
		city: address.city,
		country: address.country,
	});
	return `${BINABLE_BASE_URL}/download/ics/subscribe?${params.toString()}`;
}

/**
 * loadOptions method: returns the fraction labels available for the address that
 * is currently entered on the node. Falls back to the default German labels when
 * the address is incomplete or the lookup fails, so the dropdown is never empty.
 */
export async function getWasteTypeOptions(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const read = (name: string): string => String(this.getCurrentNodeParameter(name) ?? '').trim();

	const address: IBinableAddress = {
		street: read('street'),
		houseNumber: read('houseNumber'),
		zip: read('zip'),
		city: read('city'),
		country: read('country') || 'DE',
	};

	if (address.street !== '' && address.zip !== '' && address.city !== '') {
		try {
			const result = await fetchCollection.call(this, address);
			const typeMap = result.typeMap ?? {};
			const options: INodePropertyOptions[] = [];
			for (const key of Object.keys(typeMap)) {
				const wasteType = result[key] as IWasteType | undefined;
				const hasDates =
					Array.isArray(wasteType?.dates) && (wasteType!.dates as string[]).length > 0;
				if (hasDates) {
					options.push({ name: typeMap[key], value: typeMap[key] });
				}
			}
			if (options.length > 0) {
				options.sort((a, b) => a.name.localeCompare(b.name));
				return options;
			}
		} catch {
			// Fall through to the static fallback below.
		}
	}

	return WASTE_TYPE_KEYS.map((key) => ({
		name: DEFAULT_WASTE_TYPE_LABELS[key],
		value: DEFAULT_WASTE_TYPE_LABELS[key],
	}));
}
