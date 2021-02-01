import {
	IExecuteFunctions,
} from 'n8n-core';

import {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import {
	billFields,
	billOperations,
	customerFields,
	customerOperations,
	employeeFields,
	employeeOperations,
	estimateFields,
	estimateOperations,
	invoiceFields,
	invoiceOperations,
	itemFields,
	itemOperations,
	paymentFields,
	paymentOperations,
	vendorFields,
	vendorOperations,
} from './descriptions';

import {
	getRefAndSyncToken,
	getSyncToken,
	handleBinaryData,
	handleListing,
	loadResource,
	populateFields,
	processLines,
	quickBooksApiRequest,
} from './GenericFunctions';

import {
	capitalCase,
} from 'change-case';

import {
	isEmpty,
} from 'lodash';

export class QuickBooks implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QuickBooks',
		name: 'quickbooks',
		icon: 'file:quickbooks.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Consume the QuickBooks API',
		defaults: {
			name: 'QuickBooks',
			color: '#2CA01C',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'quickBooksOAuth2Api',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				options: [
					{
						name: 'Bill',
						value: 'bill',
					},
					{
						name: 'Customer',
						value: 'customer',
					},
					{
						name: 'Employee',
						value: 'employee',
					},
					{
						name: 'Estimate',
						value: 'estimate',
					},
					{
						name: 'Invoice',
						value: 'invoice',
					},
					{
						name: 'Item',
						value: 'item',
					},
					{
						name: 'Payment',
						value: 'payment',
					},
					{
						name: 'Vendor',
						value: 'vendor',
					},
				],
				default: 'customer',
				description: 'Resource to consume',
			},
			...billOperations,
			...billFields,
			...customerOperations,
			...customerFields,
			...employeeOperations,
			...employeeFields,
			...estimateOperations,
			...estimateFields,
			...invoiceOperations,
			...invoiceFields,
			...itemOperations,
			...itemFields,
			...paymentOperations,
			...paymentFields,
			...vendorOperations,
			...vendorFields,
		],
	};

	methods = {
		loadOptions: {
			async getCustomers(this: ILoadOptionsFunctions) {
				return await loadResource.call(this, 'customer');
			},

			async getVendors(this: ILoadOptionsFunctions) {
				return await loadResource.call(this, 'vendor');
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		let responseData;
		const returnData: IDataObject[] = [];

		const { oauthTokenData } = this.getCredentials('quickBooksOAuth2Api') as IDataObject;
		// @ts-ignore
		const companyId = oauthTokenData.realmId;

		for (let i = 0; i < items.length; i++) {

			// *********************************************************************
			// 															  bill
			// *********************************************************************

			if (resource === 'bill')	{

				// ----------------------------------
				//         bill: create
				// ----------------------------------

				if (operation === 'create') {

					const lines = this.getNodeParameter('Line', i) as IDataObject[];

					if (!lines.length) {
						throw new Error(`Please enter at least one line for the ${resource}.`);
					}

					if (lines.some(line => line.DetailType === undefined || line.Amount === undefined || line.Description === undefined)) {
						throw new Error('Please enter detail type, amount and description for every line.');
					}

					lines.forEach(line => {
						if (line.DetailType === 'AccountBasedExpenseLineDetail' && line.accountId === undefined) {
							throw new Error('Please enter an account ID for the associated line.');
						} else if (line.DetailType === 'ItemBasedExpenseLineDetail' && line.itemId === undefined) {
							throw new Error('Please enter an item ID for the associated line.');
						}
					});

					let body = {
						VendorRef: {
							value: this.getNodeParameter('VendorRef', i),
						},
					} as IDataObject;

					body.Line = processLines.call(this, body, lines, resource);

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         bill: get
				// ----------------------------------

				} else if (operation === 'get') {

					const billId = this.getNodeParameter('billId', i);
					const endpoint = `/v3/company/${companyId}/${resource}/${billId}`;
					responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         bill: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         bill: update
				// ----------------------------------

				} else if (operation === 'update') {

					const { ref, syncToken } = await getRefAndSyncToken.call(this, i, companyId, resource, 'VendorRef');

					let body = {
						Id: this.getNodeParameter('billId', i),
						SyncToken: syncToken,
						sparse: true,
						VendorRef: {
							name: ref.name,
							value: ref.value,
						},
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				}

			// *********************************************************************
			// 															customer
			// *********************************************************************

			} else if (resource === 'customer') {

				// ----------------------------------
				//         customer: create
				// ----------------------------------

				if (operation === 'create') {

					let body = {
						DisplayName: this.getNodeParameter('displayName', i),
					} as IDataObject;

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         customer: get
				// ----------------------------------

				} else if (operation === 'get') {

					const customerId = this.getNodeParameter('customerId', i);
					const endpoint = `/v3/company/${companyId}/${resource}/${customerId}`;
					responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         customer: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         customer: update
				// ----------------------------------

				} else if (operation === 'update') {

					let body = {
						Id: this.getNodeParameter('customerId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
						sparse: true,
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				}

			// *********************************************************************
			// 															employee
			// *********************************************************************

			} else if (resource === 'employee') {

				// ----------------------------------
				//         employee: create
				// ----------------------------------

				if (operation === 'create') {

					let body = {
						FamilyName: this.getNodeParameter('FamilyName', i),
						GivenName: this.getNodeParameter('GivenName', i),
					} as IDataObject;

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         employee: get
				// ----------------------------------

				} else if (operation === 'get') {

					const employeeId = this.getNodeParameter('employeeId', i);
					const endpoint = `/v3/company/${companyId}/${resource}/${employeeId}`;
					responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         employee: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         employee: update
				// ----------------------------------

				} else if (operation === 'update') {

					let body = {
						Id: this.getNodeParameter('employeeId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
						sparse: true,
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				}

			// *********************************************************************
			// 															estimate
			// *********************************************************************

			// https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/estimate

			} else if (resource === 'estimate') {

				// ----------------------------------
				//         estimate: create
				// ----------------------------------

				if (operation === 'create') {

					const lines = this.getNodeParameter('Line', i) as IDataObject[];

					if (!lines.length) {
						throw new Error(`Please enter at least one line for the ${resource}.`);
					}

					if (lines.some(line => line.DetailType === undefined || line.Amount === undefined || line.Description === undefined)) {
						throw new Error('Please enter detail type, amount and description for every line.');
					}

					lines.forEach(line => {
						if (line.DetailType === 'SalesItemLineDetail' && line.itemId === undefined) {
							throw new Error('Please enter an item ID for the associated line.');
						}
					});

					let body = {
						CustomerRef: {
							value: this.getNodeParameter('CustomerRef', i),
						},
					} as IDataObject;

					body.Line = processLines.call(this, body, lines, resource);

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         estimate: get
				// ----------------------------------

				} else if (operation === 'get') {

					const estimateId = this.getNodeParameter('estimateId', i) as string;
					const download = this.getNodeParameter('download', i) as boolean;

					if (download) {

						return await handleBinaryData.call(this, items, i, companyId, resource, estimateId);

					} else {

						const endpoint = `/v3/company/${companyId}/${resource}/${estimateId}`;
						responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
						responseData = responseData[capitalCase(resource)];

					}

				// ----------------------------------
				//         estimate: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         estimate: update
				// ----------------------------------

				} else if (operation === 'update') {

					const { ref, syncToken } = await getRefAndSyncToken.call(this, i, companyId, resource, 'CustomerRef');

					let body = {
						Id: this.getNodeParameter('estimateId', i),
						SyncToken: syncToken,
						sparse: true,
						CustomerRef: {
							name: ref.name,
							value: ref.value,
						},
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				}

			// *********************************************************************
			// 															invoice
			// *********************************************************************

			// https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/invoice

			} else if (resource === 'invoice') {

				// ----------------------------------
				//         invoice: create
				// ----------------------------------

				if (operation === 'create') {

					const lines = this.getNodeParameter('Line', i) as IDataObject[];

					if (!lines.length) {
						throw new Error(`Please enter at least one line for the ${resource}.`);
					}

					if (lines.some(line => line.DetailType === undefined || line.Amount === undefined || line.Description === undefined)) {
						throw new Error('Please enter detail type, amount and description for every line.');
					}

					lines.forEach(line => {
						if (line.DetailType === 'SalesItemLineDetail' && line.itemId === undefined) {
							throw new Error('Please enter an item ID for the associated line.');
						}
					});

					let body = {
						CustomerRef: {
							value: this.getNodeParameter('CustomerRef', i),
						},
					} as IDataObject;

					body.Line = processLines.call(this, body, lines, resource);

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         invoice: delete
				// ----------------------------------

				} else if (operation === 'delete') {

					const qs = {
						operation: 'delete',
					} as IDataObject;

					const body = {
						Id: this.getNodeParameter('invoiceId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
					} as IDataObject;

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, qs, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         invoice: get
				// ----------------------------------

				} else if (operation === 'get') {

					const invoiceId = this.getNodeParameter('invoiceId', i) as string;
					const download = this.getNodeParameter('download', i) as boolean;

					if (download) {

						return await handleBinaryData.call(this, items, i, companyId, resource, invoiceId);

					} else {

						const endpoint = `/v3/company/${companyId}/${resource}/${invoiceId}`;
						responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
						responseData = responseData[capitalCase(resource)];

					}

				// ----------------------------------
				//         invoice: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         invoice: send
				// ----------------------------------

				} else if (operation === 'send') {

					const invoiceId = this.getNodeParameter('invoiceId', i) as string;

					const qs = {
						sendTo: this.getNodeParameter('email', i) as string,
					} as IDataObject;

					const endpoint = `/v3/company/${companyId}/${resource}/${invoiceId}/send`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, qs, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         invoice: update
				// ----------------------------------

				} else if (operation === 'update') {

					const { ref, syncToken } = await getRefAndSyncToken.call(this, i, companyId, resource, 'CustomerRef');

					let body = {
						Id: this.getNodeParameter('invoiceId', i),
						SyncToken: syncToken,
						sparse: true,
						CustomerRef: {
							name: ref.name,
							value: ref.value,
						},
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         invoice: void
				// ----------------------------------

				} else if (operation === 'void') {

					const qs = {
						Id: this.getNodeParameter('invoiceId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
						operation: 'void',
					} as IDataObject;

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, qs, {});
					responseData = responseData[capitalCase(resource)];

				}

			// *********************************************************************
			// 															  item
			// *********************************************************************

			// https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/item

			} else if (resource === 'item')	{

				// ----------------------------------
				//         item: get
				// ----------------------------------

				if (operation === 'get') {

					const item = this.getNodeParameter('itemId', i);
					const endpoint = `/v3/company/${companyId}/${resource}/${item}`;
					responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         item: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				}

			// *********************************************************************
			// 															payment
			// *********************************************************************

			// https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/payment

			} else if (resource === 'payment') {

				// ----------------------------------
				//         payment: create
				// ----------------------------------

				if (operation === 'create') {

					let body = {
						CustomerRef: {
							value: this.getNodeParameter('CustomerRef', i),
						},
						TotalAmt: this.getNodeParameter('TotalAmt', i),
					} as IDataObject;

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         payment: delete
				// ----------------------------------

				} else if (operation === 'delete') {

					const qs = {
						operation: 'delete',
					} as IDataObject;

					const body = {
						Id: this.getNodeParameter('paymentId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
					} as IDataObject;

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, qs, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         payment: get
				// ----------------------------------

				} else if (operation === 'get') {

					const paymentId = this.getNodeParameter('paymentId', i) as string;
					const download = this.getNodeParameter('download', i) as boolean;

					if (download) {

						return await handleBinaryData.call(this, items, i, companyId, resource, paymentId);

					} else {

						const endpoint = `/v3/company/${companyId}/${resource}/${paymentId}`;
						responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
						responseData = responseData[capitalCase(resource)];

					}

				// ----------------------------------
				//         payment: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         payment: send
				// ----------------------------------

				} else if (operation === 'send') {

					const paymentId = this.getNodeParameter('paymentId', i) as string;

					const qs = {
						sendTo: this.getNodeParameter('email', i) as string,
					} as IDataObject;

					const endpoint = `/v3/company/${companyId}/${resource}/${paymentId}/send`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, qs, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         payment: update
				// ----------------------------------

				} else if (operation === 'update') {

					const { ref, syncToken } = await getRefAndSyncToken.call(this, i, companyId, resource, 'CustomerRef');

					let body = {
						Id: this.getNodeParameter('paymentId', i),
						SyncToken: syncToken,
						sparse: true,
						CustomerRef: {
							name: ref.name,
							value: ref.value,
						},
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         payment: void
				// ----------------------------------

				} else if (operation === 'void') {

					const qs = {
						Id: this.getNodeParameter('paymentId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
						operation: 'void',
					} as IDataObject;

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, qs, {});
					responseData = responseData[capitalCase(resource)];

				}

			// *********************************************************************
			// 															vendor
			// *********************************************************************

			// https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/vendor

			} else if (resource === 'vendor') {

				// ----------------------------------
				//         vendor: create
				// ----------------------------------

				if (operation === 'create') {

					let body = {
						DisplayName: this.getNodeParameter('displayName', i),
					} as IDataObject;

					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					body = populateFields.call(this, body, additionalFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         vendor: get
				// ----------------------------------

				} else if (operation === 'get') {

					const vendorId = this.getNodeParameter('vendorId', i);
					const endpoint = `/v3/company/${companyId}/${resource}/${vendorId}`;
					responseData = await quickBooksApiRequest.call(this, 'GET', endpoint, {}, {});
					responseData = responseData[capitalCase(resource)];

				// ----------------------------------
				//         vendor: getAll
				// ----------------------------------

				} else if (operation === 'getAll') {

					const endpoint = `/v3/company/${companyId}/query`;
					responseData = await handleListing.call(this, i, endpoint, resource);

				// ----------------------------------
				//         vendor: update
				// ----------------------------------

				} else if (operation === 'update') {

					let body = {
						Id: this.getNodeParameter('vendorId', i),
						SyncToken: await getSyncToken.call(this, i, companyId, resource),
						sparse: true,
					} as IDataObject;

					const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;

					if (isEmpty(updateFields)) {
						throw new Error(`Please enter at least one field to update for the ${resource}.`);
					}

					body = populateFields.call(this, body, updateFields, resource);

					const endpoint = `/v3/company/${companyId}/${resource}`;
					responseData = await quickBooksApiRequest.call(this, 'POST', endpoint, {}, body);
					responseData = responseData[capitalCase(resource)];

				}

			}

			Array.isArray(responseData)
				? returnData.push(...responseData)
				: returnData.push(responseData);

			}

		return [this.helpers.returnJsonArray(returnData)];

	}
}
