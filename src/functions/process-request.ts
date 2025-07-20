import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { SqsEnvelope } from '@aws-lambda-powertools/parser/envelopes';
import { JSONStringified } from '@aws-lambda-powertools/parser/helpers';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import middy from '@middy/core';
import { extractMainContent } from '../libs/bedrock.js';
import { toMarkdown } from '../libs/markdown.js';
import { addContent, createPage, updateStatus } from '../libs/notion.js';
import { getObject } from '../libs/s3.js';
import { ApiGatewayRequestSchema, SqsMessageSchema } from '../schema.js';

const logger = new Logger();

/**
 * This function processes the request from SQS and creates a new page in Notion.
 * It tries to extract only the main content from the body.
 * If it fails, it will use the entire body as the content.
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

			const { url, title, mode } = request;
			let { html } = request;

			logger.info(`Processing request: ${url}`);

			/**
			 * Create a new page in Notion.
			 */
			const pageId = await createPage({
				title,
				url,
			});

			logger.info(`Created page in Notion: ${pageId}`);

			/**
			 * Fetch the HTML if it's not provided.
			 */
			if (!html) {
				try {
					logger.info(`Fetching HTML from ${url}`);
					const response = await fetch(url);
					html = await response.text();
					logger.info(`Fetched HTML from ${url}`);
				} catch (error) {
					logger.error(`Failed to fetch HTML from ${url}`, { error });
					return;
				}
			}

			/**
			 * Convert the HTML to Markdown.
			 */
			let markdown = toMarkdown({ html, url });

			/**
			 * Try to extract the main content from the markdown.
			 * Only relevant if the request contains a full document.
			 */
			if (mode === 'document') {
				try {
					logger.info(`Extracting main content from markdown`);

					markdown = await extractMainContent({
						markdown,
						url,
					});

					logger.info(`Completed extracting main content from markdown`);
				} catch (error) {
					logger.error('Failed to extract main content', {
						error,
						markdown,
						url,
					});

					// TODO add error as comment to the page

					/**
					 * Set the status to failed.
					 */
					await updateStatus({
						pageId,
						status: 'Failed',
					});

					logger.info(`Updated status to failed`);
				}
			}

			/**
			 * Add the content to the Notion page.
			 */
			await addContent({
				pageId,
				markdown,
			});

			logger.info(`Added content to Notion page: ${pageId}`);

			/**
			 * Update the status to done.
			 */
			await updateStatus({
				pageId,
				status: 'Done',
			});

			logger.info(`Updated status to done`);
		}
	});
