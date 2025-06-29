import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import middy from '@middy/core';
import type {
	APIGatewayAuthorizerResult,
	APIGatewayRequestAuthorizerEvent,
} from 'aws-lambda';

const logger = new Logger();

/**
 * Custom authorizer that extracts API key from query string parameters.
 * This allows the API key to be passed as a query parameter instead of a header.
 */
export const handler = middy<APIGatewayRequestAuthorizerEvent>()
	.use(injectLambdaContext(logger, { logEvent: true }))
	.handler(async (event): Promise<APIGatewayAuthorizerResult> => {
		/**
		 * Extract the API key from query string parameters.
		 */
		const apiKey = event.queryStringParameters?.apiKey;

		if (!apiKey) {
			logger.error('No API key found in query string parameters');
			throw new Error('Unauthorized: No API key provided');
		}

		logger.info('API key extracted from query string', { apiKey });

		/**
		 * Create a policy that allows access to the specific method.
		 */
		const policy: APIGatewayAuthorizerResult = {
			principalId: 'user',
			policyDocument: {
				Version: '2012-10-17',
				Statement: [
					{
						Action: 'execute-api:Invoke',
						Effect: 'Allow',
						Resource: event.methodArn,
					},
				],
			},
			context: {
				apiKey,
			},
			usageIdentifierKey: apiKey,
		};

		logger.info('Authorization policy generated', { policy });

		return policy;
	});
