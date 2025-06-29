import { ApiGatewayEnvelope } from '@aws-lambda-powertools/parser/envelopes';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import middy from '@middy/core';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { createHash, randomUUID } from 'node:crypto';
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
import z from 'zod';

const logger = new Logger();

/**
 * Return a 200 response with an empty body.
 */
const ok = () => ({
	statusCode: 200,
	headers: {
		'Access-Control-Allow-Origin': '*',
	},
	body: '',
});

/**
 * Return a 200 response with a self-closing window.
 */
const closeWindow = () => ({
	statusCode: 200,
	headers: {
		'Access-Control-Allow-Origin': '*',
		'Content-Type': 'text/html',
	},
	body: `<!DOCTYPE html>
<html>
<head><title>Saving...</title></head>
<body>
  <script>window.close();</script>
  <p>Saving to Lambdalet.AI...</p>
</body>
</html>`,
});

/**
 * Return a 302 response with a redirect to the original URL.
 */
const redirect = (url: string) => ({
	statusCode: 302,
	headers: {
		'Access-Control-Allow-Origin': '*',
		Location: url,
	},
	body: '',
});

/**
 * Parse the form data from the request body into an object.
 * Inspired by JSONStringified from @aws-lambda-powertools/parser/helpers.
 */
const formUrlEncoded = <T extends z.ZodTypeAny>(schema: T) =>
	z
		.string()
		.transform((str, ctx) => {
			try {
				const params = new URLSearchParams(str);
				return Object.fromEntries(params.entries());
			} catch (err) {
				ctx.addIssue({
					code: 'custom',
					message: 'Invalid form data',
				});
			}
		})
		.pipe(schema);

/**
 * This function receives the request from the API Gateway and queues it for processing.
 * The payload is uploaded to S3 and a reference to the object is sent to SQS.
 * The URL is used to deduplicate the same request being sent multiple times.
 */
export const handler = middy()
	.use(injectLambdaContext(logger, { logEvent: true }))
	.use(
		parser({
			schema: formUrlEncoded(ApiGatewayRequestSchema),
			envelope: ApiGatewayEnvelope,
		}),
	)
	.handler(async (request): Promise<APIGatewayProxyResult> => {
		/**
		 * Parse AWS resources from the environment variables.
		 */
		const env = AwsEnvSchema.parse(process.env);

		const bucket = env.BUCKET_NAME;
		const queueUrl = env.QUEUE_URL;
		const { url, invoke } = request;

		/**
		 * Hash the URL to create a deterministic key for the S3 object and SQS deduplication ID.
		 * Using the plain URL as key could exceed the 1024 character limit for the S3 key and 128 character limit for the SQS deduplication ID.
		 */
		const hash = createHash('sha256').update(url).digest('hex');

		logger.info(`Hashed URL: ${hash}`, { url, hash });

		const key = `${hash}.json`;

		/**
		 * Upload the request payload to S3, because SQS has a limit of 256KB for the message body.
		 */
		await putObject({
			bucket,
			key,
			object: request,
		});

		logger.info(`Uploaded request payload to S3: s3://${bucket}/${key}`, {
			bucket,
			key,
		});

		// TODO temporary
		const uuid = randomUUID();

		/**
		 * Send the request to SQS to deduplicate the request and process it asynchronously.
		 * Using the hash as the group ID will allow multiple requests to be processed in parallel,
		 * but the deduplication ID will still ensure that the same request (URL) is processed only once.
		 */
		const messageId = await sendMessage<SqsMessage>({
			queueUrl,
			groupId: uuid,
			deduplicationId: uuid,
			message: {
				bucket,
				key,
			},
		});

		logger.info(`Sent message to SQS: ${queueUrl}/${messageId}`, {
			queueUrl,
			messageId,
		});

		/**
		 * Depending how the request was made, we need to return a different response.
		 * - form-blank: The request was submitted as form in a new tab (target="_blank"), so we return a self-closing window.
		 * - form-self: The request was submitted as form in the same tab (target="_self"), so we redirect back to the original URL.
		 * - fetch: The request was submitted as fetch, so we return a 200 OK.
		 */
		if (invoke === 'form-blank') return closeWindow();
		if (invoke === 'form-self') return redirect(url);

		return ok();
	});
