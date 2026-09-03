import { createHmac } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import {
	ADDRESS_PROPERTIES,
	binableApiRequest,
	getAddressParameters,
	getWasteTypeOptions,
} from './GenericFunctions';

export class BinableTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Binable Trigger',
		name: 'binableTrigger',
		icon: { light: 'file:binable.svg', dark: 'file:binable.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '=Upcoming collection · {{$parameter["daysBeforeCollection"]}}d before',
		description: 'Starts the workflow when a waste collection is coming up (push webhook)',
		defaults: {
			name: 'Binable Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'binableApi',
				// Required: creating/deleting the webhook subscription needs an API key.
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'binable pushes a notification once a day (around 18:00 server time) when a collection is due in the configured number of days. Sub-day lead times are not supported by the webhook — use the polling trigger for that.',
				name: 'notice',
				type: 'notice',
				default: '',
			},

			// --- Address ---
			...ADDRESS_PROPERTIES,

			// --- Lead time ---
			{
				displayName: 'Days Before Collection',
				name: 'daysBeforeCollection',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 7 },
				default: 1,
				required: true,
				description: 'How many days before a collection the webhook fires (1–7)',
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
				description:
					'Only trigger for these waste types. Leave empty to trigger for any collection. Options are loaded live for the entered address. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},

			// --- Options ---
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description:
					'Whether to verify the X-Binable-Signature HMAC header against the stored webhook secret and reject forged requests',
			},
			{
				displayName: 'Split Collections',
				name: 'splitCollections',
				type: 'boolean',
				default: false,
				description:
					'Whether to emit one item per collected fraction instead of a single item containing the whole payload',
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

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				return Boolean(staticData.webhookId);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const address = getAddressParameters(this);
				const daysBeforeCollection = this.getNodeParameter('daysBeforeCollection') as number;

				const response = await binableApiRequest.call(
					this,
					'POST',
					'/api/webhook',
					{ url: webhookUrl, daysBeforeCollection, ...address },
					undefined,
					true,
				);

				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = response.id;
				staticData.webhookSecret = response.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;
				if (webhookId) {
					try {
						await binableApiRequest.call(
							this,
							'DELETE',
							`/api/webhook/${webhookId}`,
							undefined,
							undefined,
							true,
						);
					} catch (error) {
						// A 404 means binable already removed the subscription — that is the
						// state we want, so continue and clear the local ids. Anything else
						// (auth, network, 5xx) must surface so deactivation does not silently
						// leave a live webhook pointing at this workflow.
						if ((error as NodeApiError).httpCode !== '404') {
							throw new NodeApiError(this.getNode(), error as JsonObject);
						}
					}
					delete staticData.webhookId;
					delete staticData.webhookSecret;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		const staticData = this.getWorkflowStaticData('node');

		// --- Signature verification ---
		const verify = this.getNodeParameter('verifySignature', true) as boolean;
		const secret = staticData.webhookSecret as string | undefined;
		if (verify && secret) {
			const req = this.getRequestObject();
			const rawBody = (req as unknown as { rawBody?: Buffer | string }).rawBody;
			const payload =
				rawBody !== undefined && rawBody !== null ? rawBody.toString() : JSON.stringify(body);
			const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
			const received = this.getHeaderData()['x-binable-signature'];
			if (received !== expected) {
				const response = this.getResponseObject();
				response.status(403).json({ message: 'Invalid signature' });
				return { noWebhookResponse: true };
			}
		}

		// --- Fraction filter ---
		const fractions = this.getNodeParameter('fractions', []) as string[];
		let collections = Array.isArray(body.collections) ? (body.collections as IDataObject[]) : [];
		if (fractions.length > 0) {
			const allowed = new Set(fractions);
			collections = collections.filter((collection) => allowed.has(collection.type as string));
			if (collections.length === 0) {
				// Nothing relevant for this subscription — acknowledge but do not trigger.
				return { webhookResponse: { received: true, matched: false } };
			}
		}

		// --- Emit ---
		const splitCollections = this.getNodeParameter('splitCollections', false) as boolean;
		let items: IDataObject[];
		if (splitCollections) {
			const rest: IDataObject = { ...body };
			delete rest.collections;
			items = collections.map((collection) => ({ ...rest, collection }));
		} else {
			items = [{ ...body, collections }];
		}

		return { workflowData: [this.helpers.returnJsonArray(items)] };
	}
}
