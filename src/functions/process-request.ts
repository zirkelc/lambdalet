import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { SqsEnvelope } from '@aws-lambda-powertools/parser/envelopes';
import { JSONStringified } from '@aws-lambda-powertools/parser/helpers';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import middy from '@middy/core';
import { extractMainContent } from '../libs/bedrock.js';
import { toMarkdown } from '../libs/markdown.js';
import { addContent, createPage } from '../libs/notion.js';
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

			const { html, url, title } = request;

			/**
			 * Convert the HTML to Markdown.
			 */
			const markdown = toMarkdown({ html, url });

			/**
			 * Create a new page in Notion.
			 */
			const pageId = await createPage({
				title,
				url,
			});

			/**
			 * Try to extract the main content from the markdown.
			 * Initialize content with the existing markdown in case of failure.
			 */
			let content = markdown;
			try {
				content = await extractMainContent({
					markdown,
					url,
				});
			} catch (error) {
				logger.error('Failed to extract main content', {
					error,
					markdown,
					url,
				});
			}

			/**
			 * Add the content to the Notion page.
			 */
			await addContent({
				pageId,
				markdown: content,
			});
		}
	});
