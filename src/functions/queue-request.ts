import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { APIGatewayProxyEventSchema } from '@aws-lambda-powertools/parser/schemas';
import middy from '@middy/core';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { createHash } from 'node:crypto';
import z from 'zod';
import { putObject } from '../libs/s3.js';
import { createMessageId, sendMessage } from '../libs/sqs.js';
import {
	type ApiGatewayRequest,
	ApiGatewayRequestSchema,
	AwsEnvSchema,
	type SqsMessage,
} from '../schema.js';

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
			} catch {
				ctx.addIssue({
					code: 'custom',
					message: 'Invalid form data',
				});
			}
		})
		.pipe(schema);

const decodeFormData = (body: string) => {
	const params = new URLSearchParams(body);
	return Object.fromEntries(params.entries());
};

/**
 * This function receives the request from the API Gateway and queues it for processing.
 * The payload is uploaded to S3 and a reference to the object is sent to SQS.
 * The URL is used to deduplicate the same request being sent multiple times.
 */
export const handler = middy()
	.use(injectLambdaContext(logger, { logEvent: true }))
	.use(
		parser({
			schema: APIGatewayProxyEventSchema,
		}),
	)
	.handler(async (event): Promise<APIGatewayProxyResult> => {
		/**
		 * Parse AWS resources from the environment variables.
		 */
		const env = AwsEnvSchema.parse(process.env);

		const request =
			event.httpMethod === 'POST'
				? ApiGatewayRequestSchema.parse(decodeFormData(event.body ?? ''))
				: ApiGatewayRequestSchema.parse(event.queryStringParameters ?? {});

		const bucket = env.BUCKET_NAME;
		const queueUrl = env.QUEUE_URL;
		const fetchQueueUrl = env.FETCH_QUEUE_URL;

		const { url, invoke, html } = request;

		const hash = createMessageId(url);
		logger.info(`Hashed URL: ${hash}`, { url, hash });

		const key = `${hash}.json`;

		/**
		 * Upload the request payload to S3, because SQS has a limit of 256KB for the message body.
		 */
		await putObject<ApiGatewayRequest>({
			bucket,
			key,
			object: request,
		});

		logger.info(`Uploaded request payload to S3: s3://${bucket}/${key}`, {
			bucket,
			key,
		});

		/**
		 * Route the request based on whether HTML is present.
		 * If HTML is missing (typically GET requests), send to fetch queue first.
		 * Otherwise, send directly to main processing queue.
		 */
		let messageId: string;

		if (!html) {
			/**
			 * Send to fetch queue for HTML retrieval.
			 */
			messageId = await sendMessage<SqsMessage>({
				queueUrl: fetchQueueUrl,
				groupId: hash,
				deduplicationId: hash,
				message: {
					bucket,
					key,
				},
			});
			logger.info(
				`Sent message to fetch queue: ${fetchQueueUrl}/${messageId}`,
				{
					queueUrl: fetchQueueUrl,
					messageId,
				},
			);
		} else {
			/**
			 * Send directly to main processing queue.
			 */
			messageId = await sendMessage<SqsMessage>({
				queueUrl,
				groupId: hash,
				deduplicationId: hash,
				message: {
					bucket,
					key,
				},
			});
			logger.info(
				`Sent message to main processing queue: ${queueUrl}/${messageId}`,
				{
					queueUrl,
					messageId,
				},
			);
		}

		/**
		 * Depending how the request was made, we need to return a different response.
		 * - form-blank: The request was submitted as form in a new tab (target="_blank"), so we return a self-closing window.
		 * - form-self: The request was submitted as form in the same tab (target="_self"), so we redirect back to the original URL.
		 * - window-open: The request was opened via window.open fallback, so we return a self-closing window.
		 * - fetch: The request was submitted as fetch, so we return a 200 OK.
		 */
		if (invoke === 'form-blank') return closeWindow();
		if (invoke === 'form-self') return redirect(url);
		if (invoke === 'window-open') return closeWindow();

		return ok();
	});
