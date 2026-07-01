import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import {
	ADDRESS_PROPERTIES,
	buildCollectionEvents,
	buildIcalFeedUrl,
	fetchCollection,
	filterByFractions,
	getAddressParameters,
	getWasteTypeOptions,
	todayInTimezone,
	type ICollectionEvent,
	type IFetchResult,
} from './GenericFunctions';

export class Binable implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Binable',
		name: 'binable',
		icon: 'file:binable.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Query waste collection schedules from binable.app',
		defaults: {
			name: 'Binable',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'binableApi',
				// Optional: read operations work anonymously, a key raises the rate limit.
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'Collection', value: 'collection' }],
				default: 'collection',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['collection'] } },
				options: [
					{
						name: 'Get Collections by Date',
						value: 'getByDate',
						action: 'Get collections on a specific date',
						description: 'Return everything collected on one specific day',
					},
					{
						name: 'Get iCal Feed',
						value: 'getIcalFeed',
						action: 'Get the subscribable i cal feed URL',
						description: 'Return the subscribable calendar feed URL (optionally the ICS content)',
					},
					{
						name: 'Get Next Collections',
						value: 'getNext',
						action: 'Get the next upcoming collections',
						description: 'Return the next N upcoming collections across all (or selected) fractions',
					},
					{
						name: 'Get Raw Data (Fetch)',
						value: 'rawFetch',
						action: 'Get the raw fetch response',
						description: 'Return the full, unprocessed /api/fetch response',
					},
					{
						name: 'Get Schedule (Date Range)',
						value: 'getSchedule',
						action: 'Get all collections within a date range',
						description: 'Return every collection between a start and end date',
					},
					{
						name: 'List Waste Types',
						value: 'listWasteTypes',
						action: 'List the waste types available at an address',
						description: 'List the fractions that exist for this address, with next date and count',
					},
				],
				default: 'getNext',
			},

			// --- Address (all operations) ---
			...ADDRESS_PROPERTIES,

			// --- Fraction filter (list-style operations) ---
			{
				displayName: 'Fraction Names or IDs',
				name: 'fractions',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getWasteTypes',
					loadOptionsDependsOn: ['street', 'houseNumber', 'zip', 'city', 'country'],
				},
				default: [],
				description: 'Restrict the result to these waste types. Leave empty for all. Options are loaded live for the entered address. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: { operation: ['getNext', 'getSchedule', 'getByDate'] },
				},
			},

			// --- Get Next ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { operation: ['getNext'] } },
			},

			// --- Get Schedule (Date Range) ---
			{
				displayName: 'From Date',
				name: 'from',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'Start of the range (inclusive). Leave empty to start today.',
				displayOptions: { show: { operation: ['getSchedule'] } },
			},
			{
				displayName: 'To Date',
				name: 'to',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'End of the range (inclusive). Leave empty for no upper bound.',
				displayOptions: { show: { operation: ['getSchedule'] } },
			},

			// --- Get Collections by Date ---
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				default: '',
				placeholder: 'YYYY-MM-DD',
				description: 'The day to look up. Leave empty for today.',
				displayOptions: { show: { operation: ['getByDate'] } },
			},

			// --- Get iCal Feed ---
			{
				displayName: 'Download ICS Content',
				name: 'downloadContent',
				type: 'boolean',
				default: false,
				description:
					'Whether to also fetch and return the ICS file content. When off, only the feed URL is returned.',
				displayOptions: { show: { operation: ['getIcalFeed'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getWasteTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getWasteTypeOptions.call(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const address = getAddressParameters(this, i);

				if (operation === 'getIcalFeed') {
					const feedUrl = buildIcalFeedUrl(address);
					const download = this.getNodeParameter('downloadContent', i, false) as boolean;
					const output: IDataObject = { feedUrl, address: { ...address } };
					if (download) {
						output.ical = await this.helpers.httpRequest({
							method: 'GET',
							url: feedUrl,
							headers: { Accept: 'text/calendar' },
						});
					}
					returnData.push({ json: output, pairedItem: { item: i } });
					continue;
				}

				const result: IFetchResult = await fetchCollection.call(this, address);

				if (operation === 'rawFetch') {
					returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
					continue;
				}

				if (operation === 'listWasteTypes') {
					const typeMap = result.typeMap ?? {};
					for (const key of Object.keys(typeMap)) {
						const wasteType = (result[key] ?? {}) as {
							dates?: string[];
							next?: string | null;
							nextDays?: string | null;
							last?: string | null;
						};
						const dates = Array.isArray(wasteType.dates) ? wasteType.dates : [];
						if (dates.length === 0) continue;
						returnData.push({
							json: {
								wasteType: typeMap[key],
								wasteKey: key,
								next: wasteType.next ?? null,
								nextDays: wasteType.nextDays ?? null,
								last: wasteType.last ?? null,
								count: dates.length,
								provider: result.provider?.name ?? null,
							},
							pairedItem: { item: i },
						});
					}
					continue;
				}

				// getNext / getSchedule / getByDate
				const includePast = operation !== 'getNext';
				let events: ICollectionEvent[] = buildCollectionEvents(this, result, includePast);
				const fractions = this.getNodeParameter('fractions', i, []) as string[];
				events = filterByFractions(events, fractions);

				if (operation === 'getNext') {
					const limit = this.getNodeParameter('limit', i, 5) as number;
					events = events.slice(0, limit);
				} else if (operation === 'getSchedule') {
					const from = (this.getNodeParameter('from', i, '') as string).slice(0, 10);
					const to = (this.getNodeParameter('to', i, '') as string).slice(0, 10);
					const lowerBound = from !== '' ? from : todayInTimezone(this);
					events = events.filter(
						(event) => event.date >= lowerBound && (to === '' || event.date <= to),
					);
				} else if (operation === 'getByDate') {
					let date = (this.getNodeParameter('date', i, '') as string).slice(0, 10);
					if (date === '') date = todayInTimezone(this);
					events = events.filter((event) => event.date === date);
				}

				for (const event of events) {
					returnData.push({ json: event, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
