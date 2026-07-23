import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BinableApi implements ICredentialType {
	name = 'binableApi';

	displayName = 'Binable API';

	icon: Icon = { light: 'file:binable.svg', dark: 'file:binable.dark.svg' };

	// Community packages must use a full external URL here.
	documentationUrl = 'https://binable.app/integration/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your binable API key. Get one for free via e-mail registration at binable.app. Required to create/delete webhooks; optional (but recommended for higher rate limits) for read operations and polling.',
		},
	];

	// binable authenticates via the "Authorization: ApiKey <key>" header.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=ApiKey {{$credentials.apiKey}}',
			},
		},
	};

	// A valid key returns 200 for POST /api/fetch on a known-good address; an
	// invalid key returns 401. (Anonymous requests also return 200, so the test
	// only proves the key is *not rejected* — which is exactly what we want.)
	test: ICredentialTestRequest = {
		request: {
			// @todo change to real endpoint incl. meta information
			baseURL: 'https://binable.app',
			url: '/api/fetch',
			method: 'POST',
			body: {
				street: 'Schürhornweg',
				houseNumber: '1',
				zip: '33649',
				city: 'Bielefeld',
				country: 'DE',
			},
		},
	};
}
