import type {
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

import {
	ADDRESS_PROPERTIES,
	buildCollectionEvents,
	fetchCollection,
	filterByFractions,
	getAddressParameters,
	getWasteTypeOptions,
	type ICollectionEvent,
	type IFetchResult,
} from './GenericFunctions';

export class BinablePollingTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Binable Polling Trigger',
		name: 'binablePollingTrigger',
		icon: 'file:binable.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=Upcoming collection · {{$parameter["leadValue"]}} {{$parameter["leadUnit"]}} before',
		description:
			'Polls binable on a schedule and triggers when a collection enters the lead-time window',
		defaults: {
			name: 'Binable Polling Trigger',
		},
		polling: true,
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'binableApi',
				// Optional: polling works anonymously, a key raises the rate limit.
				required: false,
			},
		],
		properties: [
			{
				displayName:
					'Collection dates are day-granular. A lead time below one day only affects which poll run emits the event — the reminder still refers to a whole day.',
				name: 'notice',
				type: 'notice',
				default: '',
			},

			// --- Address ---
			...ADDRESS_PROPERTIES,

			// --- Lead time ---
			{
				displayName: 'Lead Time',
				name: 'leadValue',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 1,
				required: true,
				description: 'Trigger when a collection is at most this far in the future',
			},
			{
				displayName: 'Lead Time Unit',
				name: 'leadUnit',
				type: 'options',
				options: [
					{ name: 'Days', value: 'days' },
					{ name: 'Hours', value: 'hours' },
				],
				default: 'days',
			},

			// --- Fraction filter ---
			{
				displayName: 'Fraction Names or IDs',
				name: 'fractions',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getWasteTypes',
					loadOptionsDependsOn: ['street', 'houseNumber', 'zip', 'city', 'country'],
				},
				default: [],
				description: 'Only trigger for these waste types. Leave empty for any collection. Options are loaded live for the entered address. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const address = getAddressParameters(this);
		const result: IFetchResult = await fetchCollection.call(this, address);

		const fractions = this.getNodeParameter('fractions', []) as string[];
		const allEvents = filterByFractions(buildCollectionEvents(this, result), fractions);

		// Manual execution: show a preview of the next collections without deduping.
		if (this.getMode() === 'manual') {
			const preview = allEvents.slice(0, 10);
			return preview.length > 0 ? [this.helpers.returnJsonArray(preview)] : null;
		}

		const leadValue = this.getNodeParameter('leadValue', 1) as number;
		const leadUnit = this.getNodeParameter('leadUnit', 'days') as string;
		const leadDays = leadUnit === 'hours' ? leadValue / 24 : leadValue;

		const withinWindow = allEvents.filter(
			(event) => event.daysUntil >= 0 && event.daysUntil <= leadDays,
		);

		const staticData = this.getWorkflowStaticData('node');
		const alreadyEmitted = new Set((staticData.emitted as string[]) ?? []);
		const eventId = (event: ICollectionEvent): string => `${event.date}|${event.wasteKey}`;

		const newEvents = withinWindow.filter((event) => !alreadyEmitted.has(eventId(event)));

		// Persist emitted ids, dropping any that now lie in the past so the store stays small.
		const futureIds = new Set(
			allEvents.filter((event) => event.daysUntil >= 0).map((event) => eventId(event)),
		);
		const retained = [...alreadyEmitted].filter((id) => futureIds.has(id));
		staticData.emitted = [...new Set([...retained, ...newEvents.map(eventId)])];

		return newEvents.length > 0 ? [this.helpers.returnJsonArray(newEvents)] : null;
	}
}
