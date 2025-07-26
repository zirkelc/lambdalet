import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { SqsEnvelope } from '@aws-lambda-powertools/parser/envelopes';
import { JSONStringified } from '@aws-lambda-powertools/parser/helpers';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import middy from '@middy/core';
import { addComment, createPage, updateStatus } from '../libs/notion.js';
import { getObject, putObject } from '../libs/s3.js';
import { createMessageId, sendMessage } from '../libs/sqs.js';
import {
	ApiGatewayRequestSchema,
	AwsEnvSchema,
	SqsMessageSchema,
	type SqsMessage,
} from '../schema.js';

const logger = new Logger();

/**
 * This function fetches HTML for requests that don't have HTML content.
 * It downloads the request payload from S3, fetches the HTML from the URL,
 * updates the payload with the HTML, and sends it to the main processing queue.
 */
export const handler = middy()
	.use(injectLambdaContext(logger, { logEvent: true }))
	.use(
		parser({
			schema: JSONStringified(SqsMessageSchema),
			envelope: SqsEnvelope,
		}),
	)
	.handler(async (items): Promise<void> => {
		/**
		 * Parse AWS resources from the environment variables.
		 */
		const env = AwsEnvSchema.parse(process.env);

		/**
		 * Items contains only one item, because we set the batch size to 1.
		 */
		for (const item of items) {
			const { bucket, key } = item;

			/**
			 * Download the request payload from S3.
			 */
			const request = await getObject({
				bucket,
				key,
				schema: ApiGatewayRequestSchema,
			});

			logger.info(`Downloaded request payload from S3: s3://${bucket}/${key}`);

			const { url, title } = request;
			if (request.html) {
				logger.info(`Request already has HTML, skipping fetch: ${url}`);
				continue;
			}

			/**
			 * Fetch the HTML if it's not provided.
			 */
			try {
				logger.info(`Fetching HTML from ${url}`);
				const response = await fetch(url);
				const html = await response.text();
				logger.info(`Fetched HTML from ${url}`);

				/**
				 * Update the request payload with the fetched HTML.
				 */
				const updatedRequest = { ...request, html };

				/**
				 * Upload the updated request payload back to S3.
				 */
				await putObject({
					bucket,
					key,
					object: updatedRequest,
				});

				logger.info(`Updated request payload in S3: s3://${bucket}/${key}`);

				const hash = createMessageId(url);

				logger.info(`Hashed URL: ${hash}`, { url, hash });

				/**
				 * Send the request to the main processing queue.
				 */
				const messageId = await sendMessage<SqsMessage>({
					queueUrl: env.QUEUE_URL,
					groupId: hash,
					deduplicationId: hash,
					message: {
						bucket,
						key,
					},
				});

				logger.info(
					`Sent message to main processing queue: ${env.QUEUE_URL}/${messageId}`,
				);
			} catch (error) {
				logger.error(`Failed to fetch HTML from ${url}`, { error });

				/**
				 * Create a Notion page and add error comment.
				 */
				try {
					const pageId = await createPage({
						title,
						url,
					});

					await addComment({
						pageId,
						comment: `❌ HTML fetch failed: Unable to fetch content from ${url}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
					});

					await updateStatus({
						pageId,
						status: 'Failed',
					});

					logger.info(`Created failed page in Notion: ${pageId}`);
				} catch (notionError) {
					logger.error('Failed to create Notion page for fetch error', {
						notionError,
					});
				}

				throw error;
			}
		}
	});
