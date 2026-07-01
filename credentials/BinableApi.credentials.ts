import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BinableApi implements ICredentialType {
	name = 'binableApi';

	displayName = 'Binable API';

	// The `-miscased` rule only applies to nodes in the n8n main repo (where this
	// is a doc slug). Community packages must use a full external URL, as enforced
	// by the conflicting `-not-http-url` rule.
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
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

	// binable authenticates via the standard "Authorization: Bearer <key>" header.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
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
