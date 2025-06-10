import { ApiGatewayEnvelope } from '@aws-lambda-powertools/parser/envelopes';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import middy from '@middy/core';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { createHash } from 'node:crypto';
import { putObject } from '../libs/s3.js';
import { sendMessage } from '../libs/sqs.js';
import {
	type ApiGatewayRequest,
	ApiGatewayRequestSchema,
	AwsEnvSchema,
	type SqsMessage,
} from '../schema.js';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Logger } from '@aws-lambda-powertools/logger';
import { JSONStringified } from '@aws-lambda-powertools/parser/helpers';

const logger = new Logger();

const json = (statusCode: number, body: Record<string, unknown>) => ({
	statusCode,
	headers: {
		'Access-Control-Allow-Origin': '*',
	},
	body: JSON.stringify(body),
});

/**
 * This function receives the request from the API Gateway and queues it for processing.
 * The payload is uploaded to S3 and a reference to the object is sent to SQS.
 * The URL is used to deduplicate the same request being sent multiple times.
 */
export const handler = middy()
	.use(injectLambdaContext(logger, { logEvent: true }))
	.use(
		parser({
			schema: JSONStringified(ApiGatewayRequestSchema),
			envelope: ApiGatewayEnvelope,
		}),
	)
	.handler(async (event): Promise<APIGatewayProxyResult> => {
		/**
		 * Parse AWS resources from the environment variables.
		 */
		const env = AwsEnvSchema.parse(process.env);

		const bucket = env.BUCKET_NAME;
		const queueUrl = env.QUEUE_URL;
		const { url } = event;

		/**
		 * Hash the URL to create a deterministic key for the S3 object.
		 * The same URL will always produce the same key and overwrite the previous object.
		 */
		const hash = createHash('sha256').update(url).digest('hex');
		const key = `${hash}.json`;

		/**
		 * Upload the request payload to S3, because SQS has a limit of 256KB for the message body.
		 */
		await putObject<ApiGatewayRequest>({
			bucket,
			key,
			object: event,
		});

		/**
		 * Send the request to SQS to process the request asynchronously.
		 * Use the URL as the deduplication ID to avoid processing the same request multiple times.
		 */
		await sendMessage<SqsMessage>({
			queueUrl,
			groupId: 'lambdalet',
			deduplicationId: url,
			message: {
				bucket,
				key,
			},
		});

		return json(202, { message: 'Accepted' });
	});
